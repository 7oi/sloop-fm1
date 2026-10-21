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
          echo "  test: node --test desktop/*.test.js"
        '';
      };
    };
}
