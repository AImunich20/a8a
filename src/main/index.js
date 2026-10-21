const { app, BrowserWindow, dialog, shell, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Engine } = require('./engine');
const { Updater } = require('./updater');
const { buildMenu } = require('./menu');
const { RENDERER, LOGO_SVG } = require('./paths');

app.setName('a8a');
if (!app.requestSingleInstanceLock()) app.quit();

const engine = new Engine(app);
const updater = new Updater({ beforeInstall: () => engine.stop() });
let splash = null;
let mainWindow = null;
let quitting = false;

const logoUri = `url("data:image/svg+xml;base64,${fs
  .readFileSync(LOGO_SVG)
  .toString('base64')}")`;
const themeCss = `:root { --a8a-logo: ${logoUri}; }\n${fs.readFileSync(path.join(RENDERER, 'theme.css'), 'utf8')}`;

function brandTitle(title) {
  return title.replace(/\bn8n\b/g, 'a8a') || 'a8a';
}

function applyBranding(win) {
  win.webContents.on('dom-ready', () => win.webContents.insertCSS(themeCss));
  win.on('page-title-updated', (e, title) => {
    e.preventDefault();
    win.setTitle(brandTitle(title));
  });
}

function isEngineUrl(url) {
  try {
    const u = new URL(url);
    return ['localhost', '127.0.0.1'].includes(u.hostname) && Number(u.port) === engine.port;
  } catch {
    return false;
  }
}

function createSplash() {
  splash = new BrowserWindow({
    width: 380, height: 300, frame: false, resizable: false, transparent: true,
    show: false, center: true, skipTaskbar: true,
  });
  splash.loadFile(path.join(RENDERER, 'splash.html'));
  splash.once('ready-to-show', () => splash.show());
  splash.on('closed', () => (splash = null));
}

function setSplashStatus(text) {
  if (!splash || splash.isDestroyed()) return;
  splash.webContents.executeJavaScript(`setStatus(${JSON.stringify(text)})`).catch(() => {});
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600, show: false,
    title: 'a8a',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1f1d' : '#f7fbf9',
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false },
  });
  applyBranding(mainWindow);

  // OAuth flows open a sized popup and expect window.opener to receive the callback,
  // so popups stay in-app; plain new-tab links go to the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url, features }) => {
    if (features || isEngineUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 620, height: 760, autoHideMenuBar: true } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-create-window', (child) => applyBranding(child));
  mainWindow.webContents.on('will-navigate', (e, target) => {
    if (!isEngineUrl(target)) {
      e.preventDefault();
      shell.openExternal(target);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    splash?.close();
  });
  mainWindow.on('close', (e) => {
    // Keep the engine (and active workflows/triggers) running when the window closes.
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.loadURL(url);
}

function showMain() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
}

async function startEngine() {
  createSplash();
  engine.on('log', (line) => {
    if (!engine.ready) setSplashStatus(line.length > 70 ? `${line.slice(0, 70)}…` : line);
  });
  try {
    const url = await engine.start();
    createMainWindow(url);
  } catch (err) {
    splash?.close();
    const { response } = await dialog.showMessageBox({
      type: 'error',
      message: 'The a8a engine could not start',
      detail: `${err.message}\n\n${engine.tail.slice(-12).join('\n')}`,
      buttons: ['Quit', 'Open Logs'],
    });
    if (response === 1) shell.showItemInFolder(engine.logFile);
    app.quit();
  }
}

engine.on('crash', async ({ code, wasReady }) => {
  if (quitting || !wasReady) return;
  const { response } = await dialog.showMessageBox({
    type: 'error',
    message: 'The a8a engine stopped unexpectedly',
    detail: `Exit code ${code}.\n\n${engine.tail.slice(-10).join('\n')}`,
    buttons: ['Restart Engine', 'Open Logs', 'Quit'],
  });
  if (response === 0) {
    await engine.start();
    mainWindow?.loadURL(engine.url);
  } else if (response === 1) {
    shell.showItemInFolder(engine.logFile);
  } else {
    app.quit();
  }
});

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => app.quit());

app.on('second-instance', showMain);
app.on('activate', showMain);

app.on('before-quit', (e) => {
  quitting = true;
  if (!engine.proc) return;
  e.preventDefault();
  engine.stop().then(() => app.quit());
});

app.whenReady().then(() => {
  buildMenu({ engine, updater, showMain, getMainWindow: () => mainWindow });
  startEngine();
  if (app.isPackaged) updater.start();
});

app.on('window-all-closed', () => {
  // macOS convention: stay alive in the Dock; the engine keeps running workflows.
});
