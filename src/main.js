const { app, BrowserWindow, Menu, dialog, shell, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Engine } = require('./engine');
const { Updater } = require('./updater');

app.setName('a8a');
if (!app.requestSingleInstanceLock()) app.quit();

const UI = path.join(__dirname, 'ui');
const engine = new Engine(app);
const updater = new Updater({ beforeInstall: () => engine.stop() });
let splash = null;
let mainWindow = null;
let quitting = false;

const logoUri = `url("data:image/svg+xml;base64,${fs
  .readFileSync(path.join(__dirname, '..', 'assets', 'logo.svg'))
  .toString('base64')}")`;
const themeCss = `:root { --a8a-logo: ${logoUri}; }\n${fs.readFileSync(path.join(UI, 'theme.css'), 'utf8')}`;

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
  splash.loadFile(path.join(UI, 'splash.html'));
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

function buildMenu() {
  const template = [
    {
      label: 'a8a',
      submenu: [
        { label: 'About a8a', click: showAbout },
        { label: 'Check for Updates…', click: () => updater.check({ silent: false }) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: () => mainWindow?.loadURL(engine.url) },
        { role: 'reload' }, { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      role: 'windowMenu',
      submenu: [
        { label: 'Show a8a', accelerator: 'CmdOrCtrl+0', click: showMain },
        { role: 'minimize' }, { role: 'zoom' }, { role: 'close' },
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Open in Browser', click: () => shell.openExternal(engine.url) },
        { label: 'Open Data Folder', click: () => shell.openPath(app.getPath('userData')) },
        { label: 'Show Engine Log', click: () => shell.showItemInFolder(engine.logFile) },
        { type: 'separator' },
        { label: 'Workflow Documentation', click: () => shell.openExternal('https://docs.n8n.io') },
        { label: 'a8a on GitHub', click: () => shell.openExternal(`https://github.com/${require('../package.json').a8a.updateRepo}`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAbout() {
  dialog.showMessageBox({
    type: 'info',
    icon: path.join(UI, 'logo.png'),
    message: `a8a ${app.getVersion()}`,
    detail:
      `Workflow engine: n8n ${engine.version}\n` +
      `Engine URL: ${engine.url}\n` +
      `Data: ${app.getPath('userData')}\n\n` +
      'Powered by n8n (https://n8n.io), used under the n8n Sustainable Use License.',
  });
}

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
  buildMenu();
  startEngine();
  if (app.isPackaged) updater.start();
});

app.on('window-all-closed', () => {
  // macOS convention: stay alive in the Dock; the engine keeps running workflows.
});
