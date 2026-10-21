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

Either way it then appears in the application grid as **SLOOP Editor**.

### From a local checkout

Add to `environment.systemPackages` or a home-manager profile:

    (builtins.getFlake "/home/joi/dev/7oi/sloop-fm1").packages.x86_64-linux.default

### From GitHub

The flake lives at the repo root, so the repo reference is the flake
reference. Nothing needs to be checked out.

These commands only work once the commits carrying `flake.nix` are pushed to
`origin`; until then every `github:` reference below 404s. They also read the
default branch, so push to `main` (or pin a branch explicitly, below).

Try it without installing:

    nix run github:7oi/sloop-fm1
    nix run github:7oi/sloop-fm1#test     # the Web MIDI probe

Install it into your user profile:

    nix profile install github:7oi/sloop-fm1
    nix profile list                      # find the element name
    nix profile upgrade sloop-editor      # later, to update

Or wire it into a system or home-manager flake:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    sloop-fm1.url = "github:7oi/sloop-fm1";
  };

  outputs = { nixpkgs, sloop-fm1, ... }: {
    # NixOS
    nixosConfigurations.<host> = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [{
        environment.systemPackages = [
          sloop-fm1.packages.x86_64-linux.default
        ];
      }];
    };
    # or home-manager:
    #   home.packages = [ sloop-fm1.packages.x86_64-linux.default ];
  };
}
```

Update it later with `nix flake update sloop-fm1`.

Pin a branch, tag or commit when you want to stay put:

    github:7oi/sloop-fm1/main           # a branch or tag
    github:7oi/sloop-fm1?rev=<sha>      # an exact commit

**On `inputs.nixpkgs.follows`.** You may be tempted to add
`sloop-fm1.inputs.nixpkgs.follows = "nixpkgs"` to avoid evaluating a second
nixpkgs. It works, but only if the nixpkgs you point it at still provides
`electron` and `xvfb-run` under those names — this flake is built and tested
against `nixos-unstable`, and following an older stable release is the likely
way to break it. Without `follows` the pinned `flake.lock` is used and the
build is the one that was tested; the cost is evaluating a second nixpkgs.

**x86_64-linux only.** There are no other `packages.<system>` outputs, so a
reference from an aarch64 or Darwin configuration fails to evaluate.

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
