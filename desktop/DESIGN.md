<!-- SPDX-License-Identifier: GPL-3.0-only -->

# SLOOP Editor desktop app — design

**Date:** 2026-10-21
**Status:** approved design, not yet implemented
**Scope:** a NixOS desktop application wrapping the existing SLOOP web editor

## Intent

Run the SLOOP editor (`web/editor.html`) as a native desktop application on
NixOS, launched from the application grid rather than a browser tab.

This is a personal tool for this machine. It is deliberately **not** a project
deliverable: no CI, no release artefacts, no non-Nix Linux packaging, no macOS
or Windows. If that changes later it is a new piece of work with its own design.

Success is: `nix run .#sloop-editor` opens a window, the FM-1 appears in the
editor's MIDI port list, and the editor behaves exactly as it does in Chromium.

## Constraints that drive the design

Established by reading `web/`:

- **Web MIDI with SysEx is the entire device link.** `editor.html` has five
  `navigator.requestMIDIAccess` call sites; everything the editor does to the
  FM-1 goes through them. Any shell without Web MIDI is unusable, which rules
  out WebKitGTK and therefore Tauri.
- **`editor.html` is already self-contained.** The icon font is inlined as a
  base64 `@font-face`; there are no sibling `<script src>` or `<link rel=
  stylesheet>` references. It needs no build step to run standalone.
- **Its only outward references are web-only affordances:**
  `../sloop.webmanifest`, `../icon-192.png`, `../installer/`,
  `sloop-editor.html` (the offline-copy download), `FUKIAI-LICENSE.txt`, and an
  external link to hugelton.com.
- **It also uses** Web Audio with an AudioWorklet, WebAssembly, `localStorage`,
  and an IndexedDB database named `felucca-editor`.
- **File I/O is plain web:** `<input type="file">` elements and `download=`
  anchors. These get native GTK dialogs under Electron with no extra work.

Host facts verified on this machine: the user is in the `audio` group,
`/dev/snd/seq` is `crw-rw----+ root audio` with an ACL, nixpkgs is `26.11pre-git`
and provides `electron` 41.9.1.

## Decisions

### Electron, not Tauri or a Chromium wrapper

Electron ships Chromium, so Web MIDI and AudioWorklet work as they do in the
browser. Tauri uses WebKitGTK on Linux, which does not implement Web MIDI at
all — making it work would mean a Rust/ALSA bridge plus a shim for
`navigator.requestMIDIAccess`, a large amount of risk for an 11.5k-line editor
that leans heavily on SysEx. A `chromium --app=` wrapper was also considered and
rejected: it depends on the user's Chromium and presents as a browser window.

Cost accepted: a ~150 MB Electron closure, already cached in nixpkgs.

### The editor HTML is loaded verbatim

The wrapper does not patch, strip or regenerate `editor.html`. The app always
shows exactly the editor the repo ships, and there is no transform to break when
the file changes.

Consequences accepted: the dead "install firmware" and "download offline editor"
links remain visible in the UI, and the manifest and icon references produce two
harmless 404s in the console.

Generating the app around `make_site.py`'s single-file `sloop-editor.html` was
rejected: it would pull Python and a firmware `.fwsc` package into the app build
to solve a self-containment problem that does not exist.

### A custom `sloop://` scheme, not `file://`

The editor is served from `sloop://editor/editor.html` via a scheme registered
as `standard`, `secure` and `supportFetchAPI` before app ready, handled by
`protocol.handle` after it.

`file://` would mostly work, but Chromium treats `file://` origins as opaque.
That makes two things unreliable: the Web MIDI permission grant, and the
partitioning of `localStorage` and IndexedDB across restarts — the editor would
risk losing saved projects. A real origin fixes both, and gives the permission
handler a specific origin to match on.

The scheme handler resolves requests against the app's HTML root and must reject
any path that escapes it.

### Permissions are granted narrowly and silently

Both `setPermissionRequestHandler` and `setPermissionCheckHandler` are installed
on the default session. They return true for exactly `midi` and `midiSysex`, and
only when the requesting origin is `sloop://editor`. Every other permission —
camera, microphone, geolocation, notifications — is denied.

SysEx is granted without a prompt because it is the app's entire purpose;
prompting on every launch would be pure friction.

### Navigation is confined to the app

`setWindowOpenHandler` and a `will-navigate` guard send external URLs to the
system browser via `shell.openExternal` and block in-app navigation anywhere
else. Without this, the dead installer link strands the user on a 404 inside a
window with no back button.

### Data lives in the app's own store

`app.setName('sloop-editor')` before ready puts `localStorage` and the
`felucca-editor` IndexedDB under `~/.config/sloop-editor/`.

**This store is not shared with the user's browser.** The app starts empty;
projects, presets, samples and themes held in the web editor must be exported as
JSON and re-imported once. This is inherent to the browser/app split and cannot
be bridged by the wrapper.

### Zero npm dependencies

`main.js` uses only Electron built-ins (`app`, `BrowserWindow`, `protocol`,
`session`, `shell`, `Menu`). There is no `package-lock.json`, no `node_modules`
and no `buildNpmPackage` — the Nix derivation copies files and wraps the
`electron` binary.

## Components

Four files.

**`desktop/main.js`** — the whole application. Registers the scheme, creates a
1280×860 `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`
and `sandbox: true`, installs the permission and navigation handlers, and builds
a minimal menu: reload, toggle devtools, zoom in/out/reset, quit.

**`desktop/package.json`** — `{"name": "sloop-editor", "main": "main.js"}`, the
marker Electron needs to treat the directory as an app.

**`desktop/sloop-editor.nix`** — a `stdenv.mkDerivation` that copies `main.js`,
`package.json` and `web/editor.html` into `$out/share/sloop-editor`, installs
`web/icon-512.png` as the hicolor icon, emits a `makeDesktopItem` entry
(categories `AudioVideo`, `Audio`), and uses `makeWrapper` to produce
`$out/bin/sloop-editor` running `${electron}/bin/electron $out/share/sloop-editor`
with `--ozone-platform-hint=auto` so it uses Wayland natively where available.

**`flake.nix`** — at the repo root. A single `nixpkgs` input, no `flake-utils`,
`x86_64-linux` only. Exposes `packages.default`, `apps.default`, `apps.test`,
and `checks.default`.

### Environment overrides

`SLOOP_EDITOR_HTML` points the app at a different `editor.html`, so the
installed app can be aimed at the working tree while editing the editor, without
a rebuild. `SLOOP_SELFTEST=1` runs the MIDI self-test described below.

## Testing

TDD does not fit a window wrapper, but the one genuine risk is testable.

**`nix run .#test` — the MIDI self-test.** Launches the app under `xvfb-run`
with `SLOOP_SELFTEST=1`. Once the page loads, the main process calls
`webContents.executeJavaScript` to run `navigator.requestMIDIAccess({sysex:
true})`, prints the enumerated input and output port names, and exits non-zero
if the promise rejects or the handler denied the grant.

This catches a broken permission handler, a scheme that Chromium refuses to
treat as secure, or a missing ALSA path — and doubles as a "why isn't my FM-1
showing up" diagnostic.

**It must be a `nix run` target, not a derivation check.** The Nix build sandbox
has no ALSA sequencer and no display, so this cannot pass under `nix build`.

**`nix build .#checks.default`** does what the sandbox *can* do: a
`node --check main.js` syntax check plus an assertion that the derivation
contains `editor.html`, `main.js` and `package.json`.

Beyond that, verification is manual and brief: launch, confirm the FM-1 enumerates,
load and save a project, confirm it survives a restart.

## Risks

**Chromium may refuse Web MIDI on a non-http(s) origin even with
`secure: true`.** This is the main unknown and the self-test exists to surface
it immediately. If it fails, the fallback is to serve the editor over
`http://127.0.0.1:<random port>` from an in-process server bound to the loopback
interface, which gives an unambiguously trusted origin. That is a contained
change to the scheme-registration and window-loading code; nothing else in the
design moves.

**Electron major upgrades in nixpkgs may change permission string names or the
`protocol.handle` signature.** The self-test catches this on the next run after
an upgrade.

## Out of scope

The firmware installer (`fm1ota.js`, `index_pkg.html`) — the user needs only the
editor, and OTA would add a device that re-enumerates as a separate bootloader
port mid-session. Also out of scope: non-Nix Linux packaging, other platforms,
CI, release artefacts, auto-update, and any modification to `editor.html` itself.
