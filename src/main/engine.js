// Runs the bundled n8n engine as a child process using the bundled Node runtime.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ROOT } = require('./paths');

const PREFERRED_PORT = 5678;

function runtimeDir(app) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'runtime')
    : path.join(ROOT, 'runtime', process.arch);
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

function randomFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function pickPort(preferred) {
  return (await isPortFree(preferred)) ? preferred : randomFreePort();
}

class Engine extends EventEmitter {
  constructor(app) {
    super();
    this.app = app;
    this.proc = null;
    this.port = null;
    this.ready = false;
    this.stopping = false;
    this.tail = [];
    this.logDir = path.join(app.getPath('userData'), 'logs');
    this.logFile = path.join(this.logDir, 'engine.log');
    this.pidFile = path.join(app.getPath('userData'), 'engine.pid');
  }

  // An engine left behind by a crashed/killed app would hold the port and the database.
  async killStale() {
    let pid;
    try {
      pid = Number(fs.readFileSync(this.pidFile, 'utf8'));
    } catch {
      return;
    }
    try {
      const cmd = require('node:child_process').execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
      // n8n rewrites its process title to "n8n start"
      if (!/\bn8n\b/.test(cmd)) return;
      // An orphan's stdout pipe is gone, so it may hang on graceful shutdown: give it a moment,
      // then kill the whole process group (engine + task runner).
      process.kill(pid, 'SIGTERM');
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 500));
        process.kill(pid, 0);
      }
      process.kill(-pid, 'SIGKILL');
    } catch {
      // ps/kill throw once the process is gone
    } finally {
      fs.rmSync(this.pidFile, { force: true });
    }
  }

  get url() {
    return `http://localhost:${this.port}`;
  }

  get version() {
    try {
      const pkg = path.join(runtimeDir(this.app), 'engine', 'node_modules', 'n8n', 'package.json');
      return JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
    } catch {
      return 'unknown';
    }
  }

  openLog() {
    fs.mkdirSync(this.logDir, { recursive: true });
    try {
      if (fs.statSync(this.logFile).size > 10 * 1024 * 1024) {
        fs.renameSync(this.logFile, `${this.logFile}.1`);
      }
    } catch {}
    return fs.createWriteStream(this.logFile, { flags: 'a' });
  }

  async start() {
    const dir = runtimeDir(this.app);
    const nodeBin = path.join(dir, 'node', 'bin', 'node');
    const n8nBin = path.join(dir, 'engine', 'node_modules', 'n8n', 'bin', 'n8n');
    if (!fs.existsSync(nodeBin) || !fs.existsSync(n8nBin)) {
      throw new Error(`Engine runtime not found in ${dir}. Run "npm run runtime" first.`);
    }

    await this.killStale();
    this.port = await pickPort(PREFERRED_PORT);
    const brokerPort = await pickPort(this.port + 1);
    const userFolder = this.app.getPath('userData');

    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_')) delete env[k];
    Object.assign(env, {
      PATH: `${path.join(dir, 'node', 'bin')}:${env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'}`,
      NODE_ENV: 'production',
      N8N_RELEASE_TYPE: 'stable',
      N8N_USER_FOLDER: userFolder,
      N8N_PORT: String(this.port),
      N8N_HOST: 'localhost',
      N8N_LISTEN_ADDRESS: '127.0.0.1',
      N8N_PROTOCOL: 'http',
      N8N_WEBHOOK_URL: `http://localhost:${this.port}/`,
      N8N_SECURE_COOKIE: 'false',
      N8N_RUNNERS_BROKER_PORT: String(brokerPort),
      N8N_RUNNERS_TASK_TIMEOUT: '300',
      N8N_DIAGNOSTICS_ENABLED: 'false',
      N8N_VERSION_NOTIFICATIONS_ENABLED: 'false', // a8a ships its own updater
      N8N_HIRING_BANNER_ENABLED: 'false',
      N8N_UNVERIFIED_PACKAGES_ENABLED: 'true',
      N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'true',
      N8N_LOG_OUTPUT: 'console',
    });

    const log = this.openLog();
    log.write(`\n=== a8a ${this.app.getVersion()} / n8n ${this.version} starting ${new Date().toISOString()} on port ${this.port} ===\n`);

    this.stopping = false;
    this.ready = false;
    this.proc = spawn(nodeBin, [n8nBin, 'start'], {
      env, cwd: userFolder, stdio: ['ignore', 'pipe', 'pipe'], detached: true, // own process group
    });
    fs.writeFileSync(this.pidFile, String(this.proc.pid));

    const onData = (buf) => {
      log.write(buf);
      for (const line of buf.toString().split('\n')) {
        const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (!clean) continue;
        this.tail.push(clean);
        if (this.tail.length > 40) this.tail.shift();
        this.emit('log', clean);
      }
    };
    this.proc.stdout.on('data', onData);
    this.proc.stderr.on('data', onData);
    this.proc.on('exit', (code, signal) => {
      log.end(`=== engine exited code=${code} signal=${signal} ===\n`);
      fs.rmSync(this.pidFile, { force: true });
      const wasReady = this.ready;
      this.proc = null;
      this.ready = false;
      if (!this.stopping) this.emit('crash', { code, signal, wasReady });
    });

    await this.waitHealthy(240_000);
    this.ready = true;
    this.emit('ready', this.url);
    return this.url;
  }

  async waitHealthy(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.proc) throw new Error('Engine exited during startup');
      try {
        // /healthz answers before the editor is served; readiness + the real page confirm it is up.
        const res = await fetch(`http://127.0.0.1:${this.port}/healthz/readiness`);
        if (res.ok) {
          const page = await (await fetch(`http://127.0.0.1:${this.port}/`)).text();
          if (!page.includes('is starting up')) return;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Engine did not become ready in time');
  }

  stop() {
    const proc = this.proc;
    if (!proc) return Promise.resolve();
    this.stopping = true;
    return new Promise((resolve) => {
      const kill = setTimeout(() => {
        try {
          process.kill(-proc.pid, 'SIGKILL');
        } catch {}
      }, 15_000);
      proc.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });
      proc.kill('SIGTERM');
    });
  }
}

module.exports = { Engine };
