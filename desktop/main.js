// SPDX-License-Identifier: GPL-3.0-only
// Electron shell for the SLOOP FM-1 web editor.
// Serves web/editor.html unmodified over sloop://editor/ so the page gets a
// real, secure origin — required for a stable Web MIDI grant and for
// localStorage / IndexedDB to persist across restarts.
'use strict';

const { app, BrowserWindow, Menu, dialog, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  APP_SCHEME, APP_HOST, allowPermission, classifyRequest, isAllowedNavigation
} = require('./policy.js');

// net.fetch rejects on directories as well as missing paths, so the guard has
// to be "is a regular file", not "exists".
function isRegularFile(p) {
  const st = fs.statSync(p, { throwIfNoEntry: false });
  return st !== undefined && st.isFile();
}

const override = process.env.SLOOP_EDITOR_HTML;
const HTML_ROOT = override ? path.dirname(path.resolve(override)) : __dirname;
const INDEX = override ? path.basename(override) : 'editor.html';
const START_URL = `${APP_SCHEME}://${APP_HOST}/${INDEX}`;
const SELFTEST = process.env.SLOOP_SELFTEST === '1';

// Sets the userData path to ~/.config/sloop-editor. Must precede app ready.
app.setName('sloop-editor');

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true }
  }
]);

function serve(req) {
  // new URL() already strips ?query and #fragment from pathname.
  let host, pathname;
  try {
    ({ host, pathname } = new URL(req.url));
  } catch (e) {
    return new Response('bad request', { status: 400 });
  }
  const { status, file } = classifyRequest({
    root: HTML_ROOT,
    host,
    pathname,
    index: INDEX,
    isFile: isRegularFile
  });
  if (status !== 200) {
    return new Response(status === 400 ? 'bad request' : 'not found', { status });
  }
  return net.fetch(pathToFileURL(file).toString());
}

function openExternally(url) {
  if (url.startsWith('https://') || url.startsWith('http://')) {
    shell.openExternal(url);
  }
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [{ role: 'quit' }]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    }
  ]);
}

const PROBE = `(async () => {
  const access = await navigator.requestMIDIAccess({ sysex: true });
  return {
    sysex: access.sysexEnabled,
    inputs: Array.from(access.inputs.values(), (p) => p.name),
    outputs: Array.from(access.outputs.values(), (p) => p.name)
  };
})()`;

async function runSelfTest(win) {
  try {
    const r = await win.webContents.executeJavaScript(PROBE, true);
    console.log('requestMIDIAccess({sysex:true}) resolved');
    console.log('  sysexEnabled:', r.sysex);
    console.log('  inputs: ', r.inputs.length ? r.inputs.join(', ') : '(none)');
    console.log('  outputs:', r.outputs.length ? r.outputs.join(', ') : '(none)');
    if (!r.sysex) {
      console.error('FAIL: MIDI access granted without SysEx');
      app.exit(1);
      return;
    }
    console.log('PASS');
    app.exit(0);
  } catch (err) {
    console.error('FAIL: requestMIDIAccess rejected:', err && err.message ? err.message : err);
    app.exit(1);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: !SELFTEST,
    backgroundColor: '#000000',
    title: 'SLOOP Editor',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url, INDEX)) return;
    // Anything else — the editor's dead ../installer/ link as much as an
    // external site — must not replace the window. There is no Back control.
    event.preventDefault();
    openExternally(url);
  });

  if (SELFTEST) {
    win.webContents.once('did-finish-load', () => { runSelfTest(win); });
    // Without these the self-test hangs forever on exactly the failures it
    // exists to report: a refused scheme never fires did-finish-load.
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error(`FAIL: load failed (${code} ${desc}) for ${url}`);
      app.exit(1);
    });
    setTimeout(() => {
      console.error('FAIL: timed out after 30s without completing the probe');
      app.exit(1);
    }, 30_000).unref();
  }

  win.loadURL(START_URL).catch((err) => {
    console.error('FAIL: loadURL rejected:', err && err.message ? err.message : err);
    app.exit(1);
  });
  return win;
}

// Launching twice from the application grid otherwise collides on Chromium's
// profile lock in ~/.config/sloop-editor and the second instance dies with a
// LevelDB error. Focus the window we already have instead. The self-test opts
// out so concurrent probe runs do not silently no-op.
if (!SELFTEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  start();
}

function start() {
  app.whenReady().then(() => {
    const indexPath = path.join(HTML_ROOT, INDEX);
    if (!isRegularFile(indexPath)) {
      const msg = `Editor HTML not usable:\n\n${indexPath}\n\n` +
        (override
          ? 'SLOOP_EDITOR_HTML must name an editor.html file, not a directory ' +
            'or a missing path.'
          : 'The application package is incomplete.');
      console.error(msg);
      if (!SELFTEST) dialog.showErrorBox('SLOOP Editor', msg);
      app.exit(1);
      return;
    }

    protocol.handle(APP_SCHEME, serve);

    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      callback(allowPermission(permission, details && details.requestingUrl));
    });
    ses.setPermissionCheckHandler((wc, permission, requestingOrigin) =>
      allowPermission(permission, requestingOrigin));
    // WebUSB / Web Serial / WebHID are already denied above; this closes the
    // device-chooser path too, which does not go through the permission
    // handlers.
    ses.setDevicePermissionHandler(() => false);

    Menu.setApplicationMenu(buildMenu());
    createWindow();
  });

  app.on('window-all-closed', () => { app.quit(); });
}
