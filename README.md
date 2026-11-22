# Excalidraw Live

Open any `.excalidraw` file in VS Code and draw on it together with other people or an AI agent. One click starts a room, a local relay starts by itself, and everything is end-to-end encrypted.

> A fork of [excalidraw/excalidraw-vscode](https://github.com/excalidraw/excalidraw-vscode) (MIT), which itself builds on pomdtr's `excalidraw-editor`. Not affiliated with the Excalidraw project.

![demo](./medias/screenshot.png)

## Live collaboration

1. Open an `.excalidraw` file and click **Collaborate** (top right).
2. A room is created, the link is copied to your clipboard, and a local relay is started if nothing is listening on `localhost:3002`.
3. Share the link. Others join from a browser (any Excalidraw app pointed at the same relay), from another VS Code with **Excalidraw: Join Live Collaboration**, or with an AI agent.

Remote changes flow through the normal editor change path, so they are saved to the file you have open.

The protocol is the same as excalidraw.com's (excalidraw-room relay, AES-GCM), so existing clients work. The room key lives only in the link after `#`; the relay only ever sees ciphertext. Treat the link like a password.

### Let an AI agent join

Use an MCP server that speaks the same protocol, for example [`excalidraw-room-mcp`](https://github.com/bjcoombs/excalidraw-room-mcp):

```bash
npx -y excalidraw-room-mcp
```

Then ask the agent to join the room link, passing the relay URL and the web origin (names are those of version 0.8.x):

```
join_room  link=<room link>  serverUrl=http://localhost:3002  origin=http://localhost:3001
```

Set `EXCALIDRAW_FIREBASE_PROJECT` and `EXCALIDRAW_FIREBASE_API_KEY` to dummy values if you do not want the MCP server to save scenes to excalidraw.com's public storage.

### Settings

| Setting | Default | Meaning |
|---|---|---|
| `excalidraw.collab.serverUrl` | `http://localhost:3002` | Relay (Socket.IO) to connect to |
| `excalidraw.collab.webUrl` | `http://localhost:3001` | Origin used when building room links |
| `excalidraw.collab.username` | `VS Code` | Name shown on your cursor |
| `excalidraw.collab.autoStartRelay` | `true` | Start an embedded relay when the URL is localhost (desktop only) |

### Limits

- The embedded relay runs inside the VS Code window that started it. Closing that window stops it; clicking Collaborate in another window starts it again.
- Only elements are synced, not image files.
- The relay keeps no state: the scene lives in the connected clients and in your file.

## Also in this fork

- **Custom fonts**: Geist Mono (Latin) and Noto Sans SC (CJK) replace the hand-drawn font.
- **Mermaid to Excalidraw**, editable after insertion.
- **Code to Excalidraw** with syntax highlighting.
- **Paste tables** from Excel / Sheets or Markdown as a grid.
- **Copy link to object** with stable `excalidraw-element://` links.

## Inherited from upstream

### Edit Images

The source of the drawing can be embedded directly in a PNG or SVG image. Just create a new `.excalidraw.png` or `.excalidraw.svg` file.
You can also switch between text and image format by updating the file extension (ex: rename a `.excalidraw` file to `.excalidraw.png`).

![Image can be edited directly](./medias/edit_image.gif)

You can control the default export options using the `excalidraw.image` setting:

```json
{
  "excalidraw.image": {
    "exportScale": 1,
    "exportWithBackground": true,
    "exportWithDarkMode": false
  }
}
```

### Draw from your browser

You can install this extension in [`github.dev`](https://github.dev) or [`vscode.dev`](https://vscode.dev).
Editing an Excalidraw schema stored in a GitHub repository has never been easier !

### Switch Editor Theme

The extension support three theme options:

- light (default)
- dark
- auto (sync with VS Code Theme)

![theme switching](./medias/change-theme.gif)

### Import Public Library

Check out the available libraries at [libraries.excalidraw.com](https://libraries.excalidraw.com), and don't hesitate to contribute your own !

![Public libraries can be imported from the browser](./medias/import-library.gif)

### View Drawing Source

You can switch between the Excalidraw editor and the source (text or image) using the editor toolbar.

![Use the dedicated toolbar button to view the diagram source](./medias/view_source.gif)

### Associate Additional Extensions with the Excalidraw Editor

By default, this extension only handles `*.excalidraw`, `*.excalidraw.svg` and `*.excalidraw.png` files.

Add this to your VS Code `settings.json` file if you want to associate it with additional file extensions (ex: SVG):

```json
{
  "workbench.editorAssociations": {
    "*.svg": "editor.excalidraw"
  }
}
```

You won't be able to edit arbitrary SVG files though - only those that have been created with Excalidraw or this extension!

### Sharing your Library

If you want to use a workspace specific library (and share it with other contributors), set the `excalidraw.workspaceLibraryPath` in your Visual Studio Code workspace settings file (`.vscode/settings.json`):

```json
{
  "excalidraw.workspaceLibraryPath": "path/to/library.excalidrawlib"
}
```

The `workspaceLibraryPath` path is relative to your workspace root. Absolute path are also supported, but it will be specific to your device.

### Configure Language

By default, the extension will use the [Visual Studio Code Display Language](https://code.visualstudio.com/docs/getstarted/locales) to determine the language to use. You can overwrite it using the `excalidraw.language` setting:

```json
{
  "excalidraw.language": "fr-FR"
}
```

## Install

Download `excalidraw-live.vsix` from the [latest release](https://github.com/aquarius-wing/excalidraw-live/releases/latest), then:

```bash
code --install-extension excalidraw-live.vsix --force
```

If you had the old `aquarius-wing.excalidraw-editor-fonts` installed, uninstall it first so only one editor handles `.excalidraw` files.

## License

MIT, see [LICENSE](./LICENSE). Bundled fonts are under the SIL OFL, see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
