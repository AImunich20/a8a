// Self-updater backed by GitHub Releases. Works without an Apple Developer ID:
// it downloads the release .zip, swaps the .app bundle after quit and relaunches.
const { app, dialog, shell, BrowserWindow, Notification } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');

const run = promisify(execFile);
const REPO = require('../package.json').a8a.updateRepo;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

function appBundlePath() {
  // .../a8a.app/Contents/MacOS/a8a → .../a8a.app
  return path.resolve(process.execPath, '..', '..', '..');
}

class Updater {
  constructor({ beforeInstall }) {
    this.beforeInstall = beforeInstall;
    this.busy = false;
    this.skipped = null;
    this.timer = null;
  }

  start() {
    setTimeout(() => this.check({ silent: true }), 15_000);
    this.timer = setInterval(() => this.check({ silent: true }), CHECK_INTERVAL);
  }

  async latestRelease() {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `a8a/${app.getVersion()}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    return res.json();
  }

  async check({ silent }) {
    if (this.busy) return;
    this.busy = true;
    try {
      const rel = await this.latestRelease();
      const current = app.getVersion();
      if (!rel || compareVersions(rel.tag_name, current) <= 0) {
        if (!silent) {
          dialog.showMessageBox({ type: 'info', message: 'a8a is up to date', detail: `You are running version ${current}.` });
        }
        return;
      }
      const version = rel.tag_name.replace(/^v/, '');
      if (silent && this.skipped === version) return;

      const asset = rel.assets.find((a) => a.name.endsWith(`-${process.arch}-mac.zip`));
      const { response } = await dialog.showMessageBox({
        type: 'info',
        message: `a8a ${version} is available`,
        detail: `You have ${current}.\n\n${(rel.body || '').slice(0, 1200)}`,
        buttons: asset ? ['Install and Restart', 'Later', 'Skip This Version'] : ['Open Download Page', 'Later', 'Skip This Version'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 2) this.skipped = version;
      if (response !== 0) return;
      if (!asset || !this.canSelfInstall()) {
        shell.openExternal(rel.html_url);
        return;
      }
      await this.install(asset, version);
    } catch (err) {
      if (!silent) dialog.showErrorBox('Update check failed', String(err.message || err));
    } finally {
      this.busy = false;
    }
  }

  canSelfInstall() {
    if (!app.isPackaged) return false;
    const bundle = appBundlePath();
    if (bundle.startsWith('/Volumes/')) {
      dialog.showMessageBox({ type: 'warning', message: 'Move a8a to Applications first', detail: 'a8a is running from the disk image. Drag it into Applications, open it from there, then update.' });
      return false;
    }
    try {
      fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  setProgress(p) {
    for (const w of BrowserWindow.getAllWindows()) w.setProgressBar(p);
  }

  async install(asset, version) {
    const work = path.join(app.getPath('userData'), 'updates');
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const zip = path.join(work, asset.name);

    new Notification({ title: 'a8a', body: `Downloading a8a ${version}…` }).show();
    const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': `a8a/${app.getVersion()}` } });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || asset.size;
    let received = 0;
    const meter = new Transform({
      transform: (chunk, _enc, cb) => {
        received += chunk.length;
        this.setProgress(received / total);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(zip));
    this.setProgress(2); // indeterminate while extracting

    const extracted = path.join(work, 'app');
    await run('/usr/bin/ditto', ['-x', '-k', zip, extracted]);
    const newApp = fs.readdirSync(extracted).find((n) => n.endsWith('.app'));
    if (!newApp) throw new Error('Update archive does not contain an app bundle');
    const newPath = path.join(extracted, newApp);
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', newPath]).catch(() => {});
    fs.rmSync(zip, { force: true });
    this.setProgress(-1);

    const script = path.join(work, 'install.sh');
    fs.writeFileSync(
      script,
      `#!/bin/bash
PID="$1"; OLD="$2"; NEW="$3"
while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done
rm -rf "$OLD.previous"
if mv "$OLD" "$OLD.previous"; then
  if mv "$NEW" "$OLD" || /usr/bin/ditto "$NEW" "$OLD"; then
    rm -rf "$OLD.previous"
  else
    mv "$OLD.previous" "$OLD"
  fi
fi
/usr/bin/open "$OLD"
`,
      { mode: 0o755 },
    );
    await this.beforeInstall();
    spawn('/bin/bash', [script, String(process.pid), appBundlePath(), newPath], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  }
}

module.exports = { Updater, compareVersions };
