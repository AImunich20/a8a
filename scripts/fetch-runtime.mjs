// Downloads a standalone Node.js runtime and installs the n8n engine with it,
// so native modules are built for the exact Node ABI that ships inside the app.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const NODE_VERSION = pkg.a8a.nodeVersion;
const N8N_VERSION = pkg.a8a.n8nVersion;
const arch = process.argv[2] || process.arch; // arm64 | x64

const runtimeDir = join(root, 'runtime', arch);
const nodeDir = join(runtimeDir, 'node');
const engineDir = join(runtimeDir, 'engine');
const stamp = join(runtimeDir, '.stamp');
const want = `${NODE_VERSION}|${N8N_VERSION}`;

if (existsSync(stamp) && readFileSync(stamp, 'utf8') === want) {
  console.log(`runtime/${arch} already up to date (${want})`);
  process.exit(0);
}

rmSync(runtimeDir, { recursive: true, force: true });
mkdirSync(nodeDir, { recursive: true });
mkdirSync(engineDir, { recursive: true });

const name = `node-${NODE_VERSION}-darwin-${arch}`;
const url = `https://nodejs.org/dist/${NODE_VERSION}/${name}.tar.gz`;
const tgz = join(runtimeDir, `${name}.tar.gz`);
console.log(`Downloading ${url}`);
execFileSync('curl', ['-fL', '--retry', '3', '-o', tgz, url], { stdio: 'inherit' });
execFileSync('tar', ['-xzf', tgz, '-C', nodeDir, '--strip-components=1'], { stdio: 'inherit' });
rmSync(tgz);

const nodeBin = join(nodeDir, 'bin', 'node');
const npmCli = join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
writeFileSync(join(engineDir, 'package.json'), JSON.stringify({
  name: 'a8a-engine', private: true, dependencies: { n8n: N8N_VERSION },
}, null, 2));

console.log(`Installing n8n@${N8N_VERSION} for ${arch}…`);
execFileSync(nodeBin, [npmCli, 'install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], {
  cwd: engineDir,
  stdio: 'inherit',
  env: { ...process.env, PATH: `${join(nodeDir, 'bin')}:${process.env.PATH}`, npm_config_arch: arch },
});

// npm (lib/) is kept: n8n needs it to install community nodes.
for (const p of ['include', 'share', 'CHANGELOG.md', 'README.md']) {
  rmSync(join(nodeDir, p), { recursive: true, force: true });
}
execFileSync(process.execPath, [join(root, 'scripts', 'brand-engine.mjs'), arch], { stdio: 'inherit' });
writeFileSync(stamp, want);
console.log('Runtime ready:', runtimeDir);
