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
    node --test desktop/*.test.js                             # policy tests
    SLOOP_EDITOR_HTML=$PWD/web/editor.html electron desktop/  # live working tree

`SLOOP_EDITOR_HTML` points the app at any `editor.html`, so an installed
build can be aimed at the working tree without rebuilding.

Note that `node --check` validates syntax only, not references — a typo in an
import is caught by running the app, which is what `nix run .#test` does.

## Your data is not shared with the browser

The editor keeps projects, presets, samples and themes in `localStorage` and
an IndexedDB database. The app has its own store under
`~/.config/sloop-editor/`, separate from any browser profile. Moving work
across means exporting JSON from one and importing it into the other.

## If the FM-1 does not appear

Run `nix run .#test`. It prints every MIDI port the app can see; a working
FM-1 shows up as `Felucca MIDI 1`.

- Ports listed but not the FM-1 → a device or firmware problem, not the app.
- No ports and `requestMIDIAccess rejected` → check you are in the `audio`
  group (`groups`) and that `/dev/snd/seq` exists.

## Known rough edges

The editor HTML is served unmodified, so two web-only controls remain and do
nothing useful here: the "install firmware" link and the "offline editor"
download. Requests for the PWA manifest and icon return a clean 404.

On a Wayland session Electron prints a `'--ozone-platform=wayland' is not
compatible with Vulkan` warning to stderr. It comes from Chromium's GPU
setup, not from this app, and is harmless.

## Not included

The firmware installer. Use the web installer or `M-UPGRADE` for that.
