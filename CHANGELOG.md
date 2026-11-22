# Changelog

## 3.16.0

- Mermaid to Excalidraw now uses the local Pele layout engine (`svg-to-ir` + `ir-to-excalidraw`) to generate native Excalidraw components (flowcharts, class diagrams, ER diagrams, state diagrams, sequence diagrams) inside a frame instead of rasterized SVG images
- double-clicking the wrapping frame re-opens the Mermaid editor, while double-clicking any element inside the frame edits it natively

## 3.15.0

- add two switchable bundled Chinese fonts in Excalidraw's font picker: **LXGW WenKai** (楷体) and **Noto Serif SC** (宋体), subsetted to GB2312 (6,763 Simplified Chinese characters) + ASCII/punctuation

## 3.14.2

- match custom top-right action button height and typography (`var(--lg-button-size)`, `0.75rem`) to Excalidraw's `Library` button across all screen sizes

## 3.14.1

- fix the collaboration laser-pointer toolbar island stretching to 204px (scope left properties panel `min-width` to `.App-menu_top__left .Island`)
- keep top-right action buttons (`Copy link`, `Stop`, `Mermaid`, `Code`) on a single line

## 3.14.0

- rename extension to **Excalidraw Plus** (`aquarius-wing.excalidraw-vscode-plus`)

- serve the bundled Excalidraw web app directly from the embedded local server on `http://localhost:3002`, so browser room links work out of the box without running a separate frontend
- default `excalidraw.collab.webUrl` to `http://localhost:3002`
- standalone browser mode: auto-join rooms from `#room=...`, start/copy/stop collaboration from the browser toolbar, and fit loaded scenes to viewport

## 3.13.0

- rename to **Excalidraw Live** (extension id `aquarius-wing.excalidraw-live`; uninstall the old `excalidraw-editor-fonts`)
- new README, third-party notices for bundled fonts

## 3.12.0

- embedded local collaboration relay, started on demand when the relay URL is localhost (desktop only)
- new setting `excalidraw.collab.autoStartRelay`

## 3.11.0

- live collaboration compatible with the excalidraw-room protocol (E2E encrypted)
- Collaborate / Copy link / Stop buttons, status bar item, `Excalidraw: Start / Join / Copy / Stop Live Collaboration`
- settings `excalidraw.collab.serverUrl`, `webUrl`, `username`

## 3.10.0

- custom fonts, editable Mermaid import, code to Excalidraw, table paste, element links (fork additions)

## 3.9.0

- add support for linking to local files
- fix theme switching from dark mode to light mode when opening a context menu

## 3.8.3

- fix library import

## 3.8.2

- add a command to create a new diagram

## 3.8.1

- fix readme images in the marketplace

## 3.8.0

- upgrade excalidraw version to 0.18.0
- deactivate syncing of excalidraw libs between devices

## 3.5.0

- Fix font missing when using the extension offline

## 3.4.1

- Update excalidraw package to 0.14.2

## 3.4.0

- Update excalidraw package to 0.14.1

## 3.3.3

- Upgrade Dependencies

## 3.3.1

### Fixed

- Editor crashing in line editor

## 3.3.0

### Added

- Add Custom Language Support

## 3.2.0

### Added

- Upgrade excalidraw package to 1.2.0
- Add the ability to configure the export options for `excalidraw.png` and `excalidraw.svg` files using the `excalidraw.image` setting.

## 3.1.0

### Fixed

- Fix font rendering on first export of png files
- Fix library item not deleted when two diagrams are open
- Fix font in exported svg files

## 3.0.0

### Added

- allow to open and edit png with embedded scene
- deprecate `excalidraw.syncTheme` preference in favour of `excalidraw.theme`
- sync the user library between devices
- add the ability to store the library in an `excalidrawlib` file using the `excalidraw.workspaceLibraryPath` pref.
- allow to convert between json, svg and png representations by switching the file extension

### Fixed

- Sync library between opened editors
- Fix `cmd+c` and `cmd+v` shortcuts on macOS

## 2.0.16

- The extension is now part of the excalidraw organization !

## 2.0.10

- Allow `Excalidraw` to be used as a web extension !

## 2.0.9

- Fix `contentType` incorrectly detected ([#15](https://github.com/pomdtr/vscode-excalidraw-editor/issues/15))

## 2.0.8

- Webpack support

## 2.0.6

- Fix Assets Path

## 2.0.5

- Editor with a git URL Scheme are now read only
- Limit theme options to `excalidraw.syncTheme`

## 2.0.4

- Change Display Name to `Excalidraw Editor`

## 2.0.3

- Scroll to content in new editors

## 2.0.2

- Re-enable `excalidraw.theme`

## 2.0.0

- Upgrade `Excalidraw` to `0.11.0`
- Add Support for embedding PNG and SVG images the current file
- Add Support for directly editing SVG files (Use the extension `.excalidraw.svg`)
- Add support for links in drawings
- Deprecate `open in application` command. Please use [Open in External App](https://marketplace.visualstudio.com/items?itemName=YuTengjing.open-in-external-app) instead.
- Deprecate `excalidraw.export.globs`. Since the extension support editing SVGs directly, this is no longer necessary.
- Deprecate all SVG export using the command palette. Please use the UI button instead.
- Deprecate theme related options

## 1.3.0

- Upgrade `Excalidraw` to 0.9.0
- Add ability to embed scene during export to SVG

## 1.2.0

- Upgrade `Excalidraw` to 0.8.0
- Add `autoSave` feature (See `excalidraw.save` setting)
- Add support for workspace trust API
- Fix library restore of background tabs
- Disable broken import/export library buttons

## 1.1.0

- Upgrade `Excalidraw` to 0.7.0
  - Support tab-to-indent when editing text
- Support to save schema components into a library
- Add a setting to automatically set the output directory on export
