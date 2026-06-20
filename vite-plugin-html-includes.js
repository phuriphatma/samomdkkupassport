// Tiny build-time HTML partials for this vanilla/no-framework repo.
//
//   <include src="partials/topbar.html"></include>   (or self-closing <include ... />)
//
// `src` resolves relative to the file doing the including, so partials can nest
// and reference siblings. Runs as a `pre` transform so any <link>/<script> tags
// inside a partial are still seen and bundled by Vite's core HTML handling.
// Works in `vite dev` and `vite build`; partial edits trigger a full reload in dev.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const INCLUDE_RE = /<include\s+src=["']([^"']+)["']\s*\/?>(?:\s*<\/include>)?/g;

function expand(html, baseDir, seen) {
  return html.replace(INCLUDE_RE, (_, src) => {
    const file = resolve(baseDir, src);
    if (seen.has(file)) throw new Error(`html-includes: circular include of ${file}`);
    let content;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      throw new Error(`html-includes: cannot read partial "${src}" (resolved to ${file})`);
    }
    return expand(content, dirname(file), new Set(seen).add(file));
  });
}

export default function htmlIncludes() {
  return {
    name: 'html-includes',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        return expand(html, dirname(ctx.filename), new Set());
      },
    },
    configureServer(server) {
      server.watcher.on('change', (file) => {
        if (file.replace(/\\/g, '/').includes('/partials/') && file.endsWith('.html')) {
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
  };
}
