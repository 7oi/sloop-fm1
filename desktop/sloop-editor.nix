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
    node --test desktop/*.test.js
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
