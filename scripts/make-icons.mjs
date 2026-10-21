// Renders assets/logo.svg into the app icon (.icns/.png) and the DMG background.
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'assets', 'logo.svg'));
const build = join(root, 'build');
mkdirSync(build, { recursive: true });

const png = (size, out) => sharp(svg, { density: 72 * (size / 1024) * 4 }).resize(size, size).png().toFile(out);

await png(1024, join(build, 'icon.png'));
await png(256, join(root, 'src', 'ui', 'logo.png'));

const iconset = join(build, 'icon.iconset');
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset);
for (const s of [16, 32, 128, 256, 512]) {
  await png(s, join(iconset, `icon_${s}x${s}.png`));
  await png(s * 2, join(iconset, `icon_${s}x${s}@2x.png`));
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(build, 'icon.icns')]);
rmSync(iconset, { recursive: true, force: true });

// DMG window background (540x380, rendered @2x for Retina)
const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="760" viewBox="0 0 540 380">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#F2FFFA"/><stop offset="1" stop-color="#CFF7E8"/></linearGradient></defs>
  <rect width="540" height="380" fill="url(#g)"/>
  <circle cx="470" cy="40" r="120" fill="#3ECFA0" opacity=".12"/>
  <circle cx="60" cy="350" r="90" fill="#0E9F77" opacity=".08"/>
  <path d="M232 190 H300" stroke="#2BBF90" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 12"/>
  <path d="M296 178 L312 190 L296 202" fill="none" stroke="#2BBF90" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="270" y="330" text-anchor="middle" font-family="-apple-system, Helvetica" font-size="14" fill="#0B6E53">Drag a8a into Applications to install</text>
</svg>`;
await sharp(Buffer.from(bg)).png().toFile(join(build, 'background@2x.png'));
await sharp(Buffer.from(bg)).resize(540, 380).png().toFile(join(build, 'background.png'));
console.log('Icons written to build/');
