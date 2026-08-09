/**
 * SAMO Passport — Drive upload web app (Google Apps Script)
 *
 * Lets the admin terminal upload badge / certificate images straight to the SAMO
 * Google Drive (uses its 2TB, because this script runs AS the SAMO account), and
 * delete them again when an activity is removed.
 *
 * ── One-time setup ───────────────────────────────────────────────────────────
 * 1. https://script.google.com (as the SAMO account) → New project → paste this.
 * 2. Deploy → New deployment → "Web app": Execute as = Me, Who has access = Anyone.
 *    Copy the /exec URL.
 * 3. Put it in env as VITE_GAS_UPLOAD_URL (.env + Cloudflare) and rebuild.
 *
 * Re-deploying after edits: Deploy → Manage deployments → ✏️ → Version = New version.
 *
 * Files are organised into per-type subfolders ("badges", "certificates") and
 * named sequentially within each folder: 0001.png, 0002.png, …
 *
 * ── Where the folders live ───────────────────────────────────────────────────
 *   My Drive / IT Database / Passport / {badges, certificates}
 *
 * `IT Database` is shared with the samoweb script's tree (PR, Projects, Shop,
 * Team) — see that repo's `appscript/prform.gs`, which resolves its own
 * top-level folders the same way. Both scripts run as the same SAMO account,
 * so resolving by NAME keeps them in agreement with no folder id to copy
 * between the two Apps Script projects and keep in sync.
 *
 * `badges/` and `certificates/` sitting at My Drive root (where earlier
 * versions created them) are MOVED under `Passport/` on the next upload, never
 * recreated: a Drive move preserves the folder id and every file id inside it,
 * so every badge/certificate URL already stored in Postgres keeps resolving and
 * nothing needs backfilling. A fresh empty folder would also have restarted the
 * 0001/0002 sequential naming.
 *
 * Set FOLDER_ID only to override the container entirely.
 *
 * Request body (JSON, sent as text/plain):
 *   upload: { filename, mimeType, folder, data(base64) }
 *   delete: { action: "delete", fileId }
 */

var APP_ROOT_FOLDER_NAME = 'IT Database';
var APP_FOLDER_NAME = 'Passport';   // groups this app's folders inside the container
var UPLOAD_FOLDERS = ['badges', 'certificates'];   // the only subfolders uploads may target
var FOLDER_ID = ''; // override the container by id; empty = My Drive/IT Database

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    // Deploy canary. Inert BOTH ways, which is what makes it usable to tell
    // new code from old: here it returns before touching anything, and on the
    // pre-ping version it falls through to handleUpload_, whose very first
    // statement is Utilities.base64Decode(body.data) — undefined, so it throws
    // before any Drive call. `layout` names the folder scheme so the probe
    // proves WHICH version is serving, not merely that something answered.
    if (body.action === 'ping') {
      return json_({ ok: true, layout: APP_ROOT_FOLDER_NAME + '/' + APP_FOLDER_NAME });
    }

    if (body.action === 'delete') {
      return handleDelete_(body.fileId);
    }
    return handleUpload_(body);
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function handleUpload_(body) {
  var bytes = Utilities.base64Decode(body.data);
  var blob = Utilities.newBlob(bytes, body.mimeType || 'application/octet-stream', 'tmp');

  // Allow-list the subfolder. The admin UI only ever sends these two
  // (js/admin-page.js wireUpload), and this endpoint is ANYONE_ANONYMOUS with a
  // publicly-readable URL, so an unconstrained value let any caller carve
  // arbitrary folder trees into the SAMO Drive.
  var parent = getAppFolder_();
  if (body.folder) {
    if (UPLOAD_FOLDERS.indexOf(String(body.folder)) === -1) {
      return json_({ error: 'folder must be one of: ' + UPLOAD_FOLDERS.join(', ') });
    }
    parent = getOrCreateAppSubfolder_(parent, body.folder);
  }

  // Sequential, zero-padded name within this folder: 0001, 0002, …
  var count = 0;
  var files = parent.getFiles();
  while (files.hasNext()) { files.next(); count++; }
  var ext = String(body.filename || '').split('.').pop().toLowerCase();
  var hasExt = ext && ext.length <= 5 && ext !== body.filename;
  var name = ('0000' + (count + 1)).slice(-4) + (hasExt ? '.' + ext : '');

  var file = parent.createFile(blob.setName(name));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return json_({ url: 'https://drive.google.com/file/d/' + file.getId() + '/view', name: name });
}

/** Get-or-create the container: FOLDER_ID if set, else `My Drive/IT Database`. */
function getAppRoot_() {
  if (FOLDER_ID) return DriveApp.getFolderById(FOLDER_ID);
  var myDrive = DriveApp.getRootFolder();
  var it = myDrive.getFoldersByName(APP_ROOT_FOLDER_NAME);
  return it.hasNext() ? it.next() : myDrive.createFolder(APP_ROOT_FOLDER_NAME);
}

/** Get-or-create `<container>/Passport`, this app's own folder. */
function getAppFolder_() {
  var root = getAppRoot_();
  var it = root.getFoldersByName(APP_FOLDER_NAME);
  return it.hasNext() ? it.next() : root.createFolder(APP_FOLDER_NAME);
}

/**
 * Resolve `name` under `parent`, ADOPTING a same-named folder still sitting at
 * My Drive root by moving it in. Never creates a duplicate over existing
 * content — a fresh empty folder would leave every earlier badge/certificate
 * somewhere no future upload looks AND restart the 0001/0002 naming.
 *
 * The adoption is skipped entirely when FOLDER_ID overrides the container,
 * since then we have no basis to assume a root folder of that name is ours.
 */
function getOrCreateAppSubfolder_(parent, name) {
  var here = parent.getFoldersByName(name);
  if (here.hasNext()) {
    var found = here.next();
    if (!FOLDER_ID && DriveApp.getRootFolder().getFoldersByName(name).hasNext()) {
      // Both places hold one. Don't merge automatically on an upload path —
      // just make it loud; migrateDriveLayout() reports the same thing.
      console.warn('Drive layout SPLIT: "' + name + '" exists in both ' +
                   APP_ROOT_FOLDER_NAME + '/' + APP_FOLDER_NAME + ' and My Drive root.');
    }
    return found;
  }
  if (!FOLDER_ID) {
    var legacy = DriveApp.getRootFolder().getFoldersByName(name);
    if (legacy.hasNext()) {
      var f = legacy.next();
      f.moveTo(parent);   // id preserved -> stored file URLs unaffected
      return f;
    }
  }
  return parent.createFolder(name);
}

/**
 * READ-ONLY inventory — run this FIRST from the Apps Script editor
 * (Run > inspectDriveLayout). Touches nothing; reports exactly what
 * migrateDriveLayout would do.
 */
function inspectDriveLayout() {
  var names = UPLOAD_FOLDERS;
  var myDrive = DriveApp.getRootFolder();
  var rootIt = myDrive.getFoldersByName(APP_ROOT_FOLDER_NAME);
  var root = rootIt.hasNext() ? rootIt.next() : null;
  var appIt = root ? root.getFoldersByName(APP_FOLDER_NAME) : null;
  var app = (appIt && appIt.hasNext()) ? appIt.next() : null;

  var lines = [APP_ROOT_FOLDER_NAME + ': ' + (root ? 'exists' : 'does not exist yet'),
               APP_FOLDER_NAME + ': ' + (app ? 'exists (' + app.getId() + ')' : 'does not exist yet')];

  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var hereIt = app ? app.getFoldersByName(name) : null;
    var here = (hereIt && hereIt.hasNext()) ? hereIt.next() : null;
    var legacyIt = myDrive.getFoldersByName(name);
    var legacy = legacyIt.hasNext() ? legacyIt.next() : null;

    if (here && legacy) {
      lines.push('!! ' + name + ': SPLIT - in BOTH ' + APP_FOLDER_NAME + ' ' +
                 JSON.stringify(countChildren_(here)) + ' and My Drive root ' +
                 JSON.stringify(countChildren_(legacy)) + '. Will REFUSE; merge by hand.');
    } else if (here) {
      lines.push('   ' + name + ': already in place ' + JSON.stringify(countChildren_(here)));
    } else if (legacy) {
      lines.push('-> ' + name + ': at My Drive root ' + JSON.stringify(countChildren_(legacy)) +
                 ' - will be MOVED into ' + APP_FOLDER_NAME + ' (same id, same contents)');
    } else {
      lines.push('   ' + name + ': not found anywhere - nothing to do (will NOT be created)');
    }
  }
  var out = lines.join('\n');
  console.log(out);
  return out;
}

/**
 * ONE-SHOT tidy-up, run by hand from the Apps Script editor
 * (Run > migrateDriveLayout). Moves `badges` / `certificates` from My Drive
 * root into `IT Database/Passport` now instead of on their next upload.
 *
 * Cannot lose data: it only calls Folder.moveTo() - nothing is created,
 * copied, renamed or trashed - verifies the child counts match before and
 * after, refuses when the same name exists in both places (that needs a human
 * merge), and never creates a folder that does not already exist.
 */
function migrateDriveLayout() {
  var names = UPLOAD_FOLDERS;
  var myDrive = DriveApp.getRootFolder();
  var app = getAppFolder_();
  var report = [];

  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var hereIter = app.getFoldersByName(name);
    var here = hereIter.hasNext() ? hereIter.next() : null;
    var legacyIter = myDrive.getFoldersByName(name);
    var legacy = legacyIter.hasNext() ? legacyIter.next() : null;

    if (here && legacy) { report.push('!! ' + name + ': REFUSED - exists in both places. Merge by hand, then re-run.'); continue; }
    if (here)           { report.push('   ' + name + ': already in place'); continue; }
    if (!legacy)        { report.push('   ' + name + ': not found (nothing to move)'); continue; }

    var before = countChildren_(legacy);
    legacy.moveTo(app);
    var after = countChildren_(legacy);
    var intact = before.id === after.id && before.files === after.files && before.folders === after.folders;
    report.push((intact ? '-> ' : '!! ') + name + ': MOVED into ' + APP_ROOT_FOLDER_NAME + '/' + APP_FOLDER_NAME +
                ' - ' + (intact ? 'verified intact ' : 'COUNT MISMATCH ') +
                JSON.stringify(before) + ' -> ' + JSON.stringify(after));
  }
  var out = report.join('\n');
  console.log(out);
  return out;
}

/** Immediate child counts - fingerprint proving a move changed nothing else. */
function countChildren_(folder) {
  var files = 0, folders = 0;
  var fi = folder.getFiles();   while (fi.hasNext()) { fi.next(); files++; }
  var fo = folder.getFolders(); while (fo.hasNext()) { fo.next(); folders++; }
  return { id: folder.getId(), files: files, folders: folders };
}

/**
 * Is `file` somewhere under this app's own folder? Compares folder IDs, not
 * names, so a rename of the container can never widen or break the check.
 */
function fileLivesUnderAppFolder_(file) {
  var target = getAppFolder_().getId();
  var stack = [], seen = {};
  var ps = file.getParents();
  while (ps.hasNext()) stack.push(ps.next());
  while (stack.length) {
    var f = stack.pop(), id = f.getId();
    if (seen[id]) continue;
    seen[id] = true;
    if (id === target) return true;
    var ups = f.getParents();
    while (ups.hasNext()) stack.push(ups.next());
  }
  return false;
}

/**
 * Trash a badge/certificate image.
 *
 * SCOPED ON PURPOSE. This web app is deployed ANYONE_ANONYMOUS and its /exec
 * URL ships inside the public admin bundle, so this handler is reachable by
 * anyone on the internet. Without the ancestry check below, `fileId` was an
 * unauthenticated "trash any file this account owns" primitive — Drive ids of
 * shared files are guessable/discoverable, and the SAMO account's Drive holds
 * far more than this app.
 *
 * The frontend only ever deletes images it uploaded (js/upload.js
 * deleteFromDrive / deleteFromDriveBeacon, always under this app's folder), so
 * the guard costs nothing legitimate. A pasted EXTERNAL Drive link is now
 * refused rather than trashed — also correct: that file is not ours to delete.
 */
function handleDelete_(fileId) {
  if (!fileId) return json_({ error: 'no fileId' });
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    // Already gone / not visible — not fatal, and callers must not retry.
    return json_({ ok: false, error: String(err) });
  }
  if (!fileLivesUnderAppFolder_(file)) {
    return json_({ ok: false, error: 'file is not inside ' + APP_FOLDER_NAME });
  }
  // REVOKE FIRST, THEN TRASH. `setTrashed(true)` alone is NOT a removal:
  // proven live on 2026-08-09 in the samoweb repo, a trashed file that is
  // shared "anyone with the link" still returns HTTP 200 and the real image
  // from `lh3.googleusercontent.com/d/<id>` — which is the URL form this app
  // stores and renders. So a badge someone deleted stayed publicly readable for
  // the whole 30-day undo window, and forever if the trash is never emptied.
  //
  // Revoking closes that immediately while keeping the undo window. Best-effort:
  // a file whose sharing cannot be changed must still be trashed rather than
  // left both visible AND present.
  try {
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } catch (e) {
    console.warn('handleDelete_: could not revoke sharing: ' + e);
  }
  file.setTrashed(true);   // trash, not purge — 30-day recovery window
  return json_({ ok: true });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
