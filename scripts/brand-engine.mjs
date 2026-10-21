// Applies a8a branding to the installed n8n editor (mint colours, logo, favicon)
// and prunes files that are never loaded at runtime. Safe to run repeatedly.
import { readdirSync, readFileSync, writeFileSync, statSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arch = process.argv[2] || process.arch;
const modules = join(root, 'runtime', arch, 'engine', 'node_modules');
const editor = join(modules, 'n8n-editor-ui', 'dist');

// n8n brand coral/red → a8a mint
const HEX = {
  ff6d5a: '3ecfa0', e74266: '1fb386', ea4b71: '23b98b', db4061: '19a47a', cf3c5c: '15946e',
  FF6D5A: '3ECFA0', E74266: '1FB386', EA4B71: '23B98B', DB4061: '19A47A', CF3C5C: '15946E',
};
const hexRe = new RegExp(`#(${Object.keys(HEX).join('|')})\\b`, 'g');

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

let patched = 0;
for (const f of walk(join(editor, 'assets'))) {
  if (!/\.(css|js)$/.test(f)) continue;
  const src = readFileSync(f, 'utf8');
  let out = src.replace(hexRe, (_, h) => `#${HEX[h]}`);
  if (f.endsWith('.css')) {
    out = out
      .replace(/--color--primary--h:7([;}])/g, '--color--primary--h:162$1')
      .replace(/--color--primary--s:100%/g, '--color--primary--s:62%')
      .replace(/--color--primary--l:68%/g, '--color--primary--l:46%');
  }
  if (out !== src) { writeFileSync(f, out); patched++; }
}

const logo = readFileSync(join(root, 'assets', 'logo.svg'));
await sharp(logo).resize(256, 256).png().toFile(join(editor, 'static', 'n8n-logo.png'));
// favicon.ico may hold a PNG payload; browsers sniff the content
await sharp(logo).resize(64, 64).png().toFile(join(editor, 'favicon.ico'));
const index = join(editor, 'index.html');
writeFileSync(index, readFileSync(index, 'utf8').replace(/<title>[^<]*<\/title>/, '<title>a8a</title>'));

// Prune: source maps, type declarations (except packages that read them at runtime)
// and native prebuilds for other platforms.
const keepTypes = /node_modules\/(typescript|@n8n|n8n-[^/]+|@types)\//;
let freed = 0;
for (const f of walk(modules)) {
  const drop =
    f.endsWith('.map') ||
    (/\.d\.[cm]?ts$/.test(f) && !keepTypes.test(f)) ||
    /\/prebuilds\/(linux|win32|android|freebsd)-/.test(f) ||
    /-(linux|win32)-(x64|arm64|ia32)\.node$/.test(f);
  if (drop) { freed += statSync(f).size; rmSync(f); }
}
console.log(`Branded ${patched} editor files, pruned ${(freed / 1048576).toFixed(0)} MB`);
