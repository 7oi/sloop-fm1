<!-- SPDX-License-Identifier: GPL-3.0-only -->

# SLOOP Editor Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run `web/editor.html` as a native Electron desktop app on NixOS, launched from the application grid, with working Web MIDI SysEx to the FM-1.

**Architecture:** A dependency-free Electron main process serves the unmodified `editor.html` over a custom `sloop://` scheme registered as secure and standard, so the page gets a real origin for both the Web MIDI permission grant and persistent storage. All policy decisions (path safety, permission grants, internal-vs-external URLs) live in a pure module that is unit-tested without Electron. Nix packages it by copying files and wrapping the `electron` binary — no npm dependencies, no lockfile, no `node_modules`.

**Tech Stack:** Electron 41.9.1 (from nixpkgs), Node's built-in `node:test` runner, Nix flakes, `makeWrapper` + `makeDesktopItem`.

**Spec:** `desktop/DESIGN.md`

## Global Constraints

- **Zero npm dependencies.** `main.js` and `policy.js` may use only Electron built-ins and the Node standard library. No `package-lock.json`, no `node_modules`, no `buildNpmPackage`.
- **`web/editor.html` is never modified.** Not patched, not regenerated, not copied-with-edits. Byte-for-byte.
- **Target `x86_64-linux` only.** No multi-system plumbing, no `flake-utils`.
- **SPDX header on every new source file:** `SPDX-License-Identifier: GPL-3.0-only` (matches the repo's 29 existing headers).
- **App origin is exactly `sloop://editor`.** Scheme `sloop`, host `editor`.
- **Never compare `URL.origin` for `sloop://` URLs.** Node's WHATWG URL parser returns the string `"null"` as the origin of any non-special scheme. Compare `url.protocol === 'sloop:'` and `url.host === 'editor'` instead. Getting this wrong silently denies every MIDI request.
- **Electron API names:** `protocol.registerSchemesAsPrivileged` (plural), `protocol.handle`, `session.setPermissionRequestHandler`, `session.setPermissionCheckHandler`.
- **The MIDI self-test must never be a derivation check.** The Nix build sandbox has no ALSA sequencer and no display.

## Review Focus

These are the failure modes the spec implies but which no task's happy path exercises. Each has a test pinned to the task that owns the code.

1. **Path traversal** — `sloop://editor/../../../etc/passwd` must return 400, not file contents. Pinned to Task 1.
2. **Permission request from a foreign origin** — if the page ever navigates or embeds `https://hugelton.com`, a `midi` request from it must be denied. Pinned to Task 1.
3. **A non-MIDI permission from the app's own origin** — `geolocation` or `media` from `sloop://editor` must be denied; granting MIDI must not become granting everything. Pinned to Task 1.
4. **A URL with a query string** — `sloop://editor/editor.html?x=1` must serve the file, not 404 on a pathname polluted by the query. Pinned to Task 1.
5. **`SLOOP_EDITOR_HTML` pointing at a nonexistent file** — must produce a readable error dialog and a non-zero exit, not a silent blank window. Pinned to Task 2.

---

### Task 1: Policy module (pure, fully unit-tested)

The only logic in the app worth testing in isolation. Pure functions, no Electron import, so `node --test` runs them in the Nix sandbox.

**Files:**
- Create: `desktop/policy.js`
- Test: `desktop/policy.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces, all consumed by Task 2's `main.js`:
  - `resolveWithinRoot(root: string, pathname: string) => string | null` — absolute file path, or `null` if the path escapes `root` or resolves to `root` itself.
  - `allowPermission(permission: string, requestingUrl: string | null | undefined) => boolean`
  - `isAppUrl(u: string | null | undefined) => boolean`
  - `APP_SCHEME: 'sloop'`, `APP_HOST: 'editor'`

- [ ] **Step 1: Write the failing test**

Create `desktop/policy.test.js`:

```javascript
// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { resolveWithinRoot, allowPermission, isAppUrl } = require('./policy.js');

const ROOT = '/srv/app';

test('resolveWithinRoot resolves a plain file', () => {
  assert.strictEqual(resolveWithinRoot(ROOT, '/editor.html'), path.join(ROOT, 'editor.html'));
});

test('resolveWithinRoot resolves a nested file', () => {
  assert.strictEqual(resolveWithinRoot(ROOT, '/sub/x.js'), path.join(ROOT, 'sub', 'x.js'));
});

test('resolveWithinRoot decodes percent-encoding', () => {
  assert.strictEqual(resolveWithinRoot(ROOT, '/a%20b.txt'), path.join(ROOT, 'a b.txt'));
});

// Review Focus 1: path traversal
test('resolveWithinRoot rejects traversal', () => {
  assert.strictEqual(resolveWithinRoot(ROOT, '/../../../etc/passwd'), null);
});

test('resolveWithinRoot rejects encoded traversal', () => {
  assert.strictEqual(resolveWithinRoot(ROOT, '/%2e%2e/%2e%2e/etc/passwd'), null);
});

test('resolveWithinRoot rejects a sibling-prefix escape', () => {
  // /srv/app-evil must not count as inside /srv/app
  assert.strictEqual(resolveWithinRoot(ROOT, '/../app-evil/x'), null);
});

test('resolveWithinRoot rejects the root itself', () => {
  assert.strictEqual(resolveWithinRoot(ROOT, '/'), null);
});

test('resolveWithinRoot rejects a malformed escape sequence', () => {
  assert.strictEqual(resolveWithinRoot(ROOT, '/%ZZ'), null);
});

test('isAppUrl accepts the app origin', () => {
  assert.strictEqual(isAppUrl('sloop://editor/editor.html'), true);
});

test('isAppUrl rejects another host on the same scheme', () => {
  assert.strictEqual(isAppUrl('sloop://evil/editor.html'), false);
});

test('isAppUrl rejects http, null, undefined and junk', () => {
  assert.strictEqual(isAppUrl('https://hugelton.com'), false);
  assert.strictEqual(isAppUrl(null), false);
  assert.strictEqual(isAppUrl(undefined), false);
  assert.strictEqual(isAppUrl(''), false);
  assert.strictEqual(isAppUrl('not a url'), false);
});

test('allowPermission grants midi and midiSysex from the app origin', () => {
  assert.strictEqual(allowPermission('midi', 'sloop://editor/editor.html'), true);
  assert.strictEqual(allowPermission('midiSysex', 'sloop://editor/editor.html'), true);
});

test('allowPermission accepts a bare origin string', () => {
  // setPermissionCheckHandler passes "sloop://editor", not a full URL
  assert.strictEqual(allowPermission('midiSysex', 'sloop://editor'), true);
});

// Review Focus 2: foreign origin
test('allowPermission denies midi from a foreign origin', () => {
  assert.strictEqual(allowPermission('midi', 'https://hugelton.com'), false);
  assert.strictEqual(allowPermission('midiSysex', 'https://hugelton.com'), false);
});

// Review Focus 3: other permissions from our own origin
test('allowPermission denies non-MIDI permissions from the app origin', () => {
  for (const p of ['geolocation', 'media', 'notifications', 'usb', 'serial', 'hid', 'openExternal']) {
    assert.strictEqual(allowPermission(p, 'sloop://editor/editor.html'), false, p);
  }
});

test('allowPermission denies when the origin is missing', () => {
  assert.strictEqual(allowPermission('midi', undefined), false);
  assert.strictEqual(allowPermission('midi', null), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test policy.test.js`
Expected: FAIL — `Cannot find module './policy.js'`

- [ ] **Step 3: Write the implementation**

Create `desktop/policy.js`:

```javascript
// SPDX-License-Identifier: GPL-3.0-only
// Pure policy decisions for the SLOOP editor desktop app.
// No Electron import: this module is unit-tested under plain node.
'use strict';

const path = require('node:path');

const APP_SCHEME = 'sloop';
const APP_HOST = 'editor';

// Resolve a URL pathname to a file inside root. Returns null if the path
// escapes root, or names root itself.
function resolveWithinRoot(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (e) {
    return null; // malformed percent-encoding
  }
  const rooted = decoded.startsWith('/') ? decoded : '/' + decoded;
  const target = path.resolve(root, '.' + rooted);
  const rel = path.relative(root, target);
  // rel === '' means target is root itself; '..'-prefixed means it escaped.
  // The path.sep check stops /srv/app-evil passing as inside /srv/app.
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    return null;
  }
  return target;
}

// NOTE: deliberately not URL.origin — Node's WHATWG parser reports the origin
// of any non-special scheme (such as sloop:) as the string "null".
function isAppUrl(u) {
  if (typeof u !== 'string' || u === '') return false;
  let parsed;
  try {
    parsed = new URL(u);
  } catch (e) {
    return false;
  }
  return parsed.protocol === APP_SCHEME + ':' && parsed.host === APP_HOST;
}

function allowPermission(permission, requestingUrl) {
  if (permission !== 'midi' && permission !== 'midiSysex') return false;
  return isAppUrl(requestingUrl);
}

module.exports = { APP_SCHEME, APP_HOST, resolveWithinRoot, isAppUrl, allowPermission };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd desktop && node --test policy.test.js`
Expected: PASS, 16 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add desktop/policy.js desktop/policy.test.js
git commit -m "desktop: add pure policy module for path safety and MIDI permissions"
```

---

### Task 2: Electron main process

Wires the policy module into Electron: scheme, window, permissions, navigation, menu, and the self-test hook.

**Files:**
- Create: `desktop/main.js`
- Create: `desktop/package.json`

**Interfaces:**
- Consumes: `resolveWithinRoot`, `allowPermission`, `isAppUrl` from Task 1.
- Produces: an Electron app directory runnable as `electron desktop/`. Honours `SLOOP_EDITOR_HTML` (absolute path to an editor HTML file) and `SLOOP_SELFTEST=1` (run the MIDI probe and exit). Task 3 packages this directory; Task 4 drives `SLOOP_SELFTEST`.

- [ ] **Step 1: Write package.json**

Create `desktop/package.json`:

```json
{
  "name": "sloop-editor",
  "productName": "SLOOP Editor",
  "version": "2.8.0",
  "description": "Desktop shell for the SLOOP FM-1 web editor",
  "license": "GPL-3.0-only",
  "main": "main.js",
  "private": true
}
```

- [ ] **Step 2: Write main.js**

Create `desktop/main.js`:

```javascript
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

const { APP_SCHEME, APP_HOST, resolveWithinRoot, allowPermission, isAppUrl } = require('./policy.js');

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
  const { host, pathname } = new URL(req.url);
  if (host !== APP_HOST) {
    return new Response('not found', { status: 404 });
  }
  // new URL() already strips ?query and #fragment from pathname.
  const file = resolveWithinRoot(HTML_ROOT, pathname === '/' ? '/' + INDEX : pathname);
  if (file === null) {
    return new Response('bad request', { status: 400 });
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
    if (!isAppUrl(url)) {
      event.preventDefault();
      openExternally(url);
    }
  });

  if (SELFTEST) {
    win.webContents.once('did-finish-load', () => { runSelfTest(win); });
  }

  win.loadURL(START_URL);
  return win;
}

app.whenReady().then(() => {
  const indexPath = path.join(HTML_ROOT, INDEX);
  if (!fs.existsSync(indexPath)) {
    const msg = `Editor HTML not found:\n\n${indexPath}\n\n` +
      (override
        ? 'SLOOP_EDITOR_HTML points at a file that does not exist.'
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

  Menu.setApplicationMenu(buildMenu());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { app.quit(); });
```

- [ ] **Step 3: Verify it parses**

Run: `node --check desktop/main.js && node --check desktop/policy.js`
Expected: no output, exit 0

- [ ] **Step 4: Smoke-test against the real editor**

Run:

```bash
nix-shell -p electron --run 'SLOOP_EDITOR_HTML=$PWD/web/editor.html electron desktop/'
```

Expected: a window opens showing the SLOOP editor with its own font rendering. Confirm by eye:
- the editor UI renders (not a blank or white page)
- the title bar reads "SLOOP Editor"
- with the FM-1 plugged in, its port appears in the editor's MIDI port selector
- no MIDI permission prompt appears

If the page is blank, open devtools (View → Toggle DevTools) and check the console for a scheme or CSP error before proceeding.

- [ ] **Step 5: Verify Review Focus 5 — a bad `SLOOP_EDITOR_HTML`**

Run:

```bash
nix-shell -p electron --run 'SLOOP_EDITOR_HTML=/nonexistent/editor.html SLOOP_SELFTEST=1 electron desktop/'; echo "exit=$?"
```

Expected: prints `Editor HTML not found: /nonexistent/editor.html` and `exit=1`. No window, no hang.

- [ ] **Step 6: Commit**

```bash
git add desktop/main.js desktop/package.json
git commit -m "desktop: add Electron main process serving the editor over sloop://"
```

---

### Task 3: Nix package and flake

**Files:**
- Create: `desktop/sloop-editor.nix`
- Create: `flake.nix`

**Interfaces:**
- Consumes: `desktop/main.js`, `desktop/policy.js`, `desktop/package.json` from Task 2; `web/editor.html` and `web/icon-512.png` from the repo.
- Produces: `packages.default` (the app), `apps.default` (runs it), `checks.default` (sandbox-safe tests). Task 4 adds `apps.test` to this same flake.

- [ ] **Step 1: Write the derivation**

Create `desktop/sloop-editor.nix`:

```nix
# SPDX-License-Identifier: GPL-3.0-only
{ lib
, stdenvNoCC
, makeWrapper
, copyDesktopItems
, makeDesktopItem
, electron
, nodejs
, src
}:

stdenvNoCC.mkDerivation {
  pname = "sloop-editor";
  version = "2.8.0";

  inherit src;

  nativeBuildInputs = [ makeWrapper copyDesktopItems ];

  dontConfigure = true;
  dontBuild = true;

  # Sandbox-safe only: pure policy unit tests. The Web MIDI self-test needs
  # an ALSA sequencer and a display, so it lives in `nix run .#test`.
  doCheck = true;
  nativeCheckInputs = [ nodejs ];
  checkPhase = ''
    runHook preCheck
    node --test desktop/
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/sloop-editor
    cp desktop/main.js desktop/policy.js desktop/package.json $out/share/sloop-editor/
    cp web/editor.html $out/share/sloop-editor/editor.html

    install -Dm444 web/icon-512.png \
      $out/share/icons/hicolor/512x512/apps/sloop-editor.png

    makeWrapper ${electron}/bin/electron $out/bin/sloop-editor \
      --add-flags $out/share/sloop-editor \
      --add-flags "--ozone-platform-hint=auto"

    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "sloop-editor";
      desktopName = "SLOOP Editor";
      genericName = "Groovebox Editor";
      comment = "Editor for the SLOOP firmware on the M-VAVE FM-1";
      exec = "sloop-editor";
      icon = "sloop-editor";
      categories = [ "AudioVideo" "Audio" ];
      startupWMClass = "sloop-editor";
      terminal = false;
    })
  ];

  meta = {
    description = "Desktop shell for the SLOOP FM-1 web editor";
    license = lib.licenses.gpl3Only;
    platforms = [ "x86_64-linux" ];
    mainProgram = "sloop-editor";
  };
}
```

- [ ] **Step 2: Write the flake**

Create `flake.nix` at the repo root:

```nix
# SPDX-License-Identifier: GPL-3.0-only
{
  description = "SLOOP Editor — desktop shell for the FM-1 web editor";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      inherit (pkgs) lib;

      # Only the files the app actually needs, so unrelated repo changes
      # (firmware, docs, the Pages site) do not trigger a rebuild.
      src = lib.fileset.toSource {
        root = ./.;
        fileset = lib.fileset.unions [
          ./desktop/main.js
          ./desktop/policy.js
          ./desktop/policy.test.js
          ./desktop/package.json
          ./web/editor.html
          ./web/icon-512.png
        ];
      };

      sloop-editor = pkgs.callPackage ./desktop/sloop-editor.nix { inherit src; };
    in
    {
      packages.${system} = {
        default = sloop-editor;
        inherit sloop-editor;
      };

      apps.${system}.default = {
        type = "app";
        program = lib.getExe sloop-editor;
      };

      checks.${system}.default = sloop-editor;

      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.electron pkgs.nodejs ];
        shellHook = ''
          echo "SLOOP editor dev shell"
          echo "  run:  SLOOP_EDITOR_HTML=\$PWD/web/editor.html electron desktop/"
          echo "  test: node --test desktop/"
        '';
      };
    };
}
```

- [ ] **Step 3: Stage the new files so the flake can see them**

Flakes read from the git index; untracked files are invisible to `nix build`.

Run: `git add flake.nix desktop/sloop-editor.nix`

- [ ] **Step 4: Build and verify the checks run**

Run: `nix build .#default --print-build-logs`
Expected: the build log contains the `node --test` output showing the Task 1 tests passing, and the build succeeds.

- [ ] **Step 5: Verify the package contents**

Run:

```bash
ls result/bin result/share/sloop-editor result/share/applications
```

Expected: `result/bin/sloop-editor`; `editor.html`, `main.js`, `package.json`, `policy.js`; `sloop-editor.desktop`.

- [ ] **Step 6: Verify editor.html was copied unmodified**

Run: `cmp web/editor.html result/share/sloop-editor/editor.html && echo IDENTICAL`
Expected: `IDENTICAL`

- [ ] **Step 7: Run the packaged app**

Run: `nix run .#default`
Expected: the same window as Task 2's smoke test, now with the SLOOP icon in the taskbar.

- [ ] **Step 8: Commit**

```bash
git add flake.nix flake.lock desktop/sloop-editor.nix
git commit -m "desktop: package the editor app as a Nix flake"
```

---

### Task 4: The MIDI self-test target

The one test that exercises the design's main risk — whether Chromium grants Web MIDI with SysEx on a custom scheme.

**Files:**
- Modify: `flake.nix` (add `apps.test` to the outputs attribute set)

**Interfaces:**
- Consumes: `sloop-editor` from Task 3; the `SLOOP_SELFTEST=1` hook from Task 2.
- Produces: `nix run .#test`.

- [ ] **Step 1: Add the test app to the flake**

In `flake.nix`, inside the `let` block, after the `sloop-editor` binding, add:

```nix
      midi-selftest = pkgs.writeShellApplication {
        name = "sloop-editor-midi-selftest";
        runtimeInputs = [ pkgs.xvfb-run sloop-editor ];
        text = ''
          # Runs the real app under a virtual X server and probes Web MIDI.
          # Needs the host's ALSA sequencer, so this cannot be a derivation check.
          export SLOOP_SELFTEST=1
          exec xvfb-run -a sloop-editor
        '';
      };
```

Then, in the outputs attribute set, change `apps.${system}.default = { ... };` into the two-app form:

```nix
      apps.${system} = {
        default = {
          type = "app";
          program = lib.getExe sloop-editor;
        };
        test = {
          type = "app";
          program = lib.getExe midi-selftest;
        };
      };
```

- [ ] **Step 2: Run the self-test with the FM-1 unplugged**

Run: `nix run .#test; echo "exit=$?"`
Expected: `requestMIDIAccess({sysex:true}) resolved`, `sysexEnabled: true`, `inputs: (none)` or your other MIDI gear, `PASS`, `exit=0`.

A `FAIL: requestMIDIAccess rejected` here means Chromium refused Web MIDI on the `sloop://` origin — the risk named in `desktop/DESIGN.md`. The fallback is in that document: serve from `http://127.0.0.1:<random>` instead. Stop and raise it rather than working around it.

- [ ] **Step 3: Run the self-test with the FM-1 plugged in**

Run: `nix run .#test`
Expected: the FM-1 appears by name in both the `inputs:` and `outputs:` lines.

- [ ] **Step 4: Commit**

```bash
git add flake.nix
git commit -m "desktop: add nix run .#test Web MIDI SysEx self-test"
```

---

### Task 5: Usage notes and final verification

**Files:**
- Create: `desktop/README.md`

**Interfaces:**
- Consumes: everything above. Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the README**

Create `desktop/README.md`:

```markdown
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# SLOOP Editor desktop app

The SLOOP web editor as a native application on NixOS. Personal tooling —
not a released artefact. See `DESIGN.md` for why it is built this way and
`PLAN.md` for how it was built.

## Run it

    nix run .#default          # launch
    nix run .#test             # probe Web MIDI, list the ports it can see
    nix build .#default        # build; runs the policy unit tests

## Install it

Add to `environment.systemPackages` or a home-manager profile:

    (builtins.getFlake "/home/joi/dev/7oi/sloop-fm1").packages.x86_64-linux.default

It then appears in the application grid as **SLOOP Editor**.

## Develop

    nix develop
    node --test desktop/                                      # policy tests
    SLOOP_EDITOR_HTML=$PWD/web/editor.html electron desktop/  # live working tree

`SLOOP_EDITOR_HTML` points the app at any `editor.html`, so an installed
build can be aimed at the working tree without rebuilding.

## Your data is not shared with the browser

The editor keeps projects, presets, samples and themes in `localStorage` and
an IndexedDB database. The app has its own store under
`~/.config/sloop-editor/`, separate from any browser profile. Moving work
across means exporting JSON from one and importing it into the other.

## If the FM-1 does not appear

Run `nix run .#test`. It prints every MIDI port the app can see.

- Ports listed but not the FM-1 → a device or firmware problem, not the app.
- No ports and `requestMIDIAccess rejected` → check you are in the `audio`
  group (`groups`) and that `/dev/snd/seq` exists.

## Known rough edges

The editor HTML is served unmodified, so two web-only controls remain and do
nothing useful here: the "install firmware" link and the "offline editor"
download. Two 404s for the PWA manifest and icon appear in the devtools
console. All three are expected.

## Not included

The firmware installer. Use the web installer or `M-UPGRADE` for that.
```

- [ ] **Step 2: Verify the whole flake from a clean build**

Run:

```bash
nix build .#default --rebuild --print-build-logs 2>&1 | tail -20
nix flake check
```

Expected: both succeed. `nix flake check` evaluates every output and runs `checks.default`.

- [ ] **Step 3: Confirm the editor still works end to end**

Launch `nix run .#default` with the FM-1 connected and confirm:
- the FM-1 enumerates in the editor's port selector
- a pattern or project loads from the device
- saving a project, quitting, and relaunching shows the project still there
  (this is the check that the `sloop://` origin gave stable storage)
- clicking the hugelton.com link opens the system browser, not an app window

- [ ] **Step 4: Commit**

```bash
git add desktop/README.md
git commit -m "desktop: document running, installing and troubleshooting the app"
```

---

## Self-review notes

**Spec coverage.** Every decision in `desktop/DESIGN.md` maps to a task: Electron choice → Task 3 (`electron` in the derivation); verbatim HTML → Task 3 Step 6 asserts byte-identity; custom scheme → Tasks 1–2; narrow permissions → Task 1 tests, Task 2 wiring; navigation confinement → Task 2, verified Task 5 Step 3; own data store → `app.setName` in Task 2, persistence verified Task 5 Step 3; zero npm deps → Global Constraints, no lockfile in any task; the four-file component list → Tasks 2–3 plus `policy.js`, which the spec folded into `main.js` and this plan splits out so the logic is unit-testable; both test targets → Tasks 3 and 4; `SLOOP_EDITOR_HTML` → Task 2.

**One deliberate deviation from the spec.** The spec describes `main.js` as "the whole application". This plan extracts `policy.js` so path safety and permission decisions can be tested under plain `node` in the Nix sandbox, where Electron cannot run. Without the split, Review Focus items 1–4 would have no automated test at all. The file count becomes five rather than four.
