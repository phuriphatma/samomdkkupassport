#!/usr/bin/env node
// ============================================================
// deploy-gas.mjs — push gas/Upload.gs to the live Apps Script project and roll
// the EXISTING web-app deployment onto a new version.
//
// Ported from the samomdkkuweb repo's tool of the same name. Same guarantees,
// two deliberate differences, both noted where they bite:
//   * the source file is gas/Upload.gs, not appscript/prform.gs
//   * the live /exec URL lives in VITE_GAS_UPLOAD_URL (.env.local, then .env)
//     rather than a committed config.js, because this app reads it from env at
//     build time. That file is gitignored, so the deployment id is NOT in git.
//
// This is a DIFFERENT Apps Script project from samomdkkuweb's (verified: its
// deployment is not in that script's list, and one script can only have one
// doPost). Deploying here cannot affect that one, or vice versa.
//
// ── THE THING THIS MUST NEVER DO ────────────────────────────────────────────
// `clasp deploy` (create-deployment) mints a NEW deployment with a NEW /exec
// URL, while VITE_GAS_UPLOAD_URL is baked into the built bundle — so a new
// deployment reads as "badge/certificate upload silently stopped working". We
// always create-version + update-deployment against the SAME deployment id.
//
// ── SAFETY ──────────────────────────────────────────────────────────────────
// Pulls the remote first and diffs it. If someone edited the script in the
// browser, that shows up here and the deploy stops unless you pass --force —
// pushing is otherwise a silent overwrite of work you cannot recover.
//
// Pushes from a STAGING directory rather than gas/, so the remote manifest
// (appsscript.json — oauth scopes, webapp access) is round-tripped instead of
// authored blind, and the remote code file KEEPS ITS NAME.
//
// ── SETUP (one-time, yours — these are credentials) ─────────────────────────
//   1. npx clasp login              (writes ~/.clasprc.json — NEVER commit it)
//   2. Apps Script API ON for the same account:
//        https://script.google.com/home/usersettings
//   3. Add to .env.local (gitignored):
//        GAS_SCRIPT_ID=<Apps Script → ⚙ Project Settings → IDs → Script ID>
//
// ── RUN ─────────────────────────────────────────────────────────────────────
//   npm run deploy:gas                 # diff, push, version, redeploy, verify
//   npm run deploy:gas -- --dry-run    # diff + report only, no writes
//   npm run deploy:gas -- --force      # proceed even if the remote has drifted
//   npm run deploy:gas -- --verify     # only probe the live endpoint
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'gas', 'Upload.gs');
const STAGE = join(ROOT, '.gas-build');
const PULLED = join(ROOT, '.gas-remote');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const DRY = has('--dry-run');
const FORCE = has('--force');
const VERIFY_ONLY = has('--verify');

/** Merge .env.local over .env — same precedence Vite uses, so the URL this
 *  tool verifies is the URL the built bundle actually calls. */
function env() {
  const out = {};
  for (const name of ['.env', '.env.local']) {
    const p = join(ROOT, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line.includes('=') || line.trim().startsWith('#')) continue;
      const i = line.indexOf('=');
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return out;
}
const ENV = env();
// A real environment wins over the dotfiles — lets CI (or a one-off
// `GAS_SCRIPT_ID=… npm run deploy:gas`) drive this without editing .env.local.
// Allow-listed rather than spread, so unrelated shell vars can't leak in.
for (const k of ['GAS_SCRIPT_ID', 'GAS_DEPLOYMENT_ID', 'VITE_GAS_UPLOAD_URL']) {
  if (process.env[k]) ENV[k] = process.env[k];
}

function die(msg, hint) {
  console.error(`\n✗ ${msg}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
}

/** Run clasp in `cwd`. Returns stdout; throws with stderr attached on failure. */
function clasp(args, cwd, { quiet = false } = {}) {
  try {
    const out = execFileSync('npx', ['clasp', ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!quiet) process.stdout.write(out);
    return out;
  } catch (e) {
    const detail = `${e.stdout || ''}${e.stderr || ''}`.trim();
    const err = new Error(detail || e.message);
    err.detail = detail;
    throw err;
  }
}

function writeClaspJson(dir, scriptId) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.clasp.json'),
    `${JSON.stringify({ scriptId, rootDir: '.' }, null, 2)}\n`);
}

/**
 * The /exec URL the app actually calls. Its path segment IS the deployment id,
 * which makes the env var the single source of truth for BOTH "which endpoint
 * do we verify" and "which deployment do we roll" — they cannot diverge.
 */
function liveEndpoint() {
  const url = ENV.VITE_GAS_UPLOAD_URL || '';
  const m = url.match(/https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec/);
  return m ? { url: m[0], deploymentId: m[1] } : null;
}

/**
 * Probe with `{action:'ping'}` — inert on BOTH sides, which is what makes it
 * safe as well as informative:
 *   new code -> returns {ok:true, layout:"IT Database/Passport"} immediately
 *   old code -> no ping branch, falls into handleUpload_, whose first statement
 *               is Utilities.base64Decode(undefined) — throws before any Drive
 *               call, and doPost's catch turns it into {"error": …}
 * Do NOT "improve" this by sending a realistic body: an upload handler resolves
 * (and CREATES) folders before it validates, so a probe is only inert for the
 * exact input that fails at the first guard.
 */
async function probeLive() {
  const ep = liveEndpoint();
  if (!ep) return { ok: false, reason: 'VITE_GAS_UPLOAD_URL is not set in .env.local or .env' };
  try {
    const r = await fetch(ep.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'ping' }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await r.text();
    if (/"ok"\s*:\s*true/.test(body)) return { ok: true, url: ep.url, body };
    if (/"error"/.test(body)) return { ok: false, url: ep.url, body, stale: true };
    return { ok: false, url: ep.url, body, reason: 'unrecognised response' };
  } catch (e) {
    return { ok: false, url: ep.url, reason: String(e.message || e) };
  }
}

async function main() {
  if (VERIFY_ONLY) {
    const v = await probeLive();
    console.log(v.ok
      ? `✓ live endpoint runs the NEW code\n  ${v.url}\n  ${v.body}`
      : `✗ ${v.stale ? 'live endpoint still runs the OLD code (no ping branch)' : 'probe failed'}\n  ${v.body || v.reason}`);
    process.exit(v.ok ? 0 : 1);
  }

  const scriptId = ENV.GAS_SCRIPT_ID;
  if (!scriptId) {
    die('GAS_SCRIPT_ID is not set in .env.local',
      'Get it from the Apps Script project ("samopassport", now filed under\n'
      + 'My Drive/IT Database/_Scripts/) → ⚙ Project Settings → IDs → Script ID,\n'
      + 'then add to .env.local (gitignored):\n\n  GAS_SCRIPT_ID=1AbC...\n');
  }
  if (!existsSync(SRC)) die(`missing ${SRC}`);

  try {
    clasp(['show-authorized-user'], ROOT, { quiet: true });
  } catch (e) {
    die('clasp is not logged in',
      'Run:  npx clasp login\n\nThen enable the Apps Script API for the SAME account:\n'
      + `  https://script.google.com/home/usersettings\n\n(${String(e.detail || e.message).slice(0, 200)})`);
  }
  console.log(`→ script: ${scriptId}`);

  // ---- 1. pull the remote and diff -----------------------------------------
  rmSync(PULLED, { recursive: true, force: true });
  writeClaspJson(PULLED, scriptId);
  try {
    clasp(['pull'], PULLED, { quiet: true });
  } catch (e) {
    const d = String(e.detail || e.message);
    if (/Apps Script API/i.test(d)) {
      die('the Apps Script API is not enabled for this account',
        'Turn it on (one toggle, takes effect immediately):\n'
        + '  https://script.google.com/home/usersettings');
    }
    die(`clasp pull failed:\n${d.slice(0, 600)}`);
  }

  const remoteCode = readdirSync(PULLED).filter((f) => /\.(gs|js)$/.test(f));
  if (remoteCode.length !== 1) {
    die(`expected exactly one code file in the remote project, found: ${remoteCode.join(', ') || '(none)'}`,
      'This tool assumes the single-file project described in gas/Upload.gs.\n'
      + 'Reconcile the project by hand before automating it.');
  }
  const mainName = remoteCode[0];
  const remoteSrc = readFileSync(join(PULLED, mainName), 'utf8');
  const localSrc = readFileSync(SRC, 'utf8');

  const norm = (s) => s.replace(/\r\n/g, '\n').trimEnd();
  console.log(`→ remote file: ${mainName} (${remoteSrc.length} bytes)`);
  console.log(`→ local  file: gas/Upload.gs (${localSrc.length} bytes)`);

  if (norm(remoteSrc) === norm(localSrc)) {
    console.log('→ remote code already matches the repo (only the deployment may be stale)');
  } else {
    const localLines = new Set(norm(localSrc).split('\n'));
    const remoteLines = new Set(norm(remoteSrc).split('\n'));
    const onlyRemote = norm(remoteSrc).split('\n').filter((l) => l.trim() && !localLines.has(l));
    const onlyLocal = norm(localSrc).split('\n').filter((l) => l.trim() && !remoteLines.has(l));

    if (!onlyRemote.length) {
      // The repo is a strict superset — the ordinary "we added things" case.
      // Dressing this up as a warning would train you to ignore the real one.
      console.log(`→ repo is AHEAD of the remote by ${onlyLocal.length} line(s); nothing on the remote would be lost`);
    } else {
      console.log(`\n⚠ the remote has ${onlyRemote.length} line(s) the repo does NOT — someone edited it in the browser:`);
      onlyRemote.slice(0, 25).forEach((l) => console.log(`    ${l.slice(0, 120)}`));
      if (onlyRemote.length > 25) console.log(`    … and ${onlyRemote.length - 25} more`);
      console.log('\n  A copy of the remote is in .gas-remote/ — diff it properly with:');
      console.log(`    diff .gas-remote/${mainName} gas/Upload.gs\n`);
      if (!FORCE && !DRY) {
        die('refusing to overwrite remote-only changes',
          'If those lines are stale, re-run with --force.\n'
          + 'If they are real, copy them into gas/Upload.gs first.');
      }
    }
  }

  if (DRY) {
    console.log('\n(--dry-run) stopping before any write.');
    const v = await probeLive();
    console.log(v.ok ? '  live endpoint: NEW code' : `  live endpoint: ${v.stale ? 'OLD code' : v.reason}`);
    return;
  }

  // ---- 2. stage ------------------------------------------------------------
  rmSync(STAGE, { recursive: true, force: true });
  writeClaspJson(STAGE, scriptId);
  const manifestPath = join(PULLED, 'appsscript.json');
  if (!existsSync(manifestPath)) {
    die('the remote project has no appsscript.json',
      'Refusing to synthesise one — it controls oauth scopes and web-app access.');
  }
  writeFileSync(join(STAGE, 'appsscript.json'), readFileSync(manifestPath, 'utf8'));
  writeFileSync(join(STAGE, mainName), localSrc);

  // ---- 3. push -------------------------------------------------------------
  console.log('\n→ pushing…');
  clasp(['push', '-f'], STAGE);

  // ---- 4. new immutable version -------------------------------------------
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const desc = `repo deploy ${stamp}`;
  console.log('\n→ creating version…');
  const versionOut = clasp(['create-version', desc], STAGE);
  const vm = versionOut.match(/(\d+)/);
  if (!vm) die(`could not read the new version number from clasp output:\n${versionOut}`);
  const version = vm[1];
  console.log(`→ version ${version}`);

  // ---- 5. roll the EXISTING deployment ------------------------------------
  const deploymentId = ENV.GAS_DEPLOYMENT_ID || liveEndpoint()?.deploymentId;
  if (!deploymentId) {
    die('could not determine which deployment to update',
      'VITE_GAS_UPLOAD_URL has no recognisable /exec URL. Set it explicitly:\n\n'
      + '  GAS_DEPLOYMENT_ID=AKfycb...    (in .env.local)\n');
  }
  const list = clasp(['list-deployments'], STAGE, { quiet: true });
  if (!list.includes(deploymentId)) {
    die(`deployment ${deploymentId} does not belong to script ${scriptId}`,
      'VITE_GAS_UPLOAD_URL points at a deployment this script does not have.\n'
      + 'Either GAS_SCRIPT_ID is the wrong project (note there are THREE Apps\n'
      + 'Script projects on this Drive and the names mislead), or the env is stale.\n\n'
      + `clasp list-deployments said:\n${list}`);
  }
  console.log(`\n→ updating deployment ${deploymentId} → version ${version}`);
  clasp(['update-deployment', deploymentId, '-V', version, '-d', desc], STAGE);

  // ---- 6. prove it ---------------------------------------------------------
  // GAS takes a moment to swap the served version; one immediate probe gives a
  // false "still old".
  console.log('\n→ verifying the live endpoint…');
  let v = null;
  for (let i = 0; i < 5; i++) {
    v = await probeLive();
    if (v.ok) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!v?.ok) {
    die(`deployed, but the live endpoint does not report the new code:\n  ${v?.body || v?.reason}`,
      'Check Deploy → Manage deployments in the editor: the web-app deployment\n'
      + `should now point at version ${version}.`);
  }
  console.log(`✓ live: ${v.body}`);
  console.log(`✓ ${v.url}`);
  console.log('\nDone. The /exec URL is unchanged.');
}

main().catch((e) => { console.error(e); process.exit(1); });
