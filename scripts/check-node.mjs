/**
 * Refuses to build on a Node line the repo is not pinned to.
 *
 * `.nvmrc` is the single source of that pin — `nvm use` and
 * `actions/setup-node`'s `node-version-file` both read it, so keeping the check
 * pointed at the same file means there is one number to change, not three.
 *
 * This exists because nothing else actually enforces it. `engines` in
 * package.json is advisory, and pnpm's `engine-strict` only prints a warning
 * and still exits 0 — a build on the wrong major would otherwise succeed
 * quietly here and fail somewhere far less obvious in production.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pinned = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();
const wanted = Number(pinned.replace(/^v/, '').split('.')[0]);
const running = Number(process.versions.node.split('.')[0]);

if (running !== wanted) {
  const nvmrc = fileURLToPath(new URL('../.nvmrc', import.meta.url));
  console.error(
    `\nThis repo builds on Node ${wanted} (the active LTS line), and you are on Node ${process.versions.node}.\n` +
      `\n  nvm use            # reads ${nvmrc}\n` +
      `\nIf the LTS line has moved on, change .nvmrc and the "engines" field in package.json together.\n`,
  );
  process.exit(1);
}
