# Excalidraw Plus

Fork of [excalidraw/excalidraw-vscode](https://github.com/excalidraw/excalidraw-vscode) (MIT, originally based on pomdtr's `excalidraw-editor`), focused on three practical enhancements for daily engineering diagrams.

## What's enhanced

### 1. Bundled CJK & Monospace Fonts

- **Normal (`A` / `Nunito`)**: Overrides Excalidraw's default webfont with **Geist Mono** (Latin, digits, punctuation) + **Noto Sans SC** (sans-serif CJK).
- **Two extra switchable Chinese fonts in the Font Picker**: **LXGW WenKai** (楷书/手写体, `fontFamily: 10`) and **Noto Serif SC** (宋体, `fontFamily: 11`), subsetted to all 6,763 GB2312 Simplified Chinese characters + ASCII/punctuation.
- Works offline with no local font installation needed.

### 2. Diagrams, Code & Smart Paste

- **Editable Mermaid (Pele Engine)**: Insert flowcharts, class diagrams, ER diagrams, state diagrams, and sequence diagrams via the **Mermaid** toolbar button as native Excalidraw components wrapped in a frame. Double-click the frame to re-open the Mermaid editor; double-click any shape, text, or arrow inside to edit it directly.
- **Syntax-Highlighted Code Blocks**: Insert code via the **</> Code** button (rendered with Shiki); double-clicking the block re-opens the source editor.
- **Smart Table & Code Paste**: Paste TSV tables (Excel / Sheets / Lark) or Markdown tables directly onto the canvas as a grid of cells, or paste fenced/indented code as a monospace code box.
- **N-S Diagram Paste**: Paste text starting with an `nsd` line onto the canvas, or into the **Mermaid** dialog, to get a Nassi–Shneiderman structure diagram. Plain lines become stacked boxes; `if condition ?` followed by indented `yes:` / `no:` sections becomes a triangle decision box; `loop title` with indented children becomes an indented loop box.
  ```
  nsd Plan
  Step 0: compute max
  if max >= minimum ?
    yes:
      continue
    no:
      exclude account
  loop Step 4: each buy i
    pick amount
  ```
- **Stable Element Links**: `Copy link to object` generates `excalidraw-element://<id>` links that scroll to and select the target element or group inside the canvas.

### 3. Pure-Local Live Collaboration (Port 3002)

- Click **Collaborate** in the editor toolbar to start a room and copy `http://localhost:3002/#room=...`.
- The extension starts a single embedded local server on `localhost:3002` that serves **both** the `excalidraw-room` Socket.IO relay and the bundled Excalidraw web app—no separate frontend server or external domain required.
- Collaborators can join directly from a browser at `http://localhost:3002/#room=...`, from another VS Code window (**Excalidraw: Join Live Collaboration**), or via an AI agent using [`excalidraw-room-mcp`](https://github.com/bjcoombs/excalidraw-room-mcp):
  ```
  join_room  link=<room link>  serverUrl=http://localhost:3002  origin=http://localhost:3002
  ```
- End-to-end AES-GCM encrypted: the room key stays in the URL fragment after `#`, and the relay only forwards ciphertext. Remote edits flow into your open `.excalidraw` file.

| Collab Setting | Default | Meaning |
|---|---|---|
| `excalidraw.collab.serverUrl` | `http://localhost:3002` | Relay (Socket.IO) URL |
| `excalidraw.collab.webUrl` | `http://localhost:3002` | Origin used to build room links (embedded web app) |
| `excalidraw.collab.username` | `VS Code` | Cursor display name |
| `excalidraw.collab.autoStartRelay` | `true` | Auto-start embedded server on localhost (desktop only) |

## Install

One-line install from the [latest release](https://github.com/aquarius-wing/excalidraw-vscode-plus/releases/latest) (macOS / Linux):

```bash
d=$(mktemp -d); curl -fsSL -o "$d/excalidraw-vscode-plus.vsix" https://github.com/aquarius-wing/excalidraw-vscode-plus/releases/latest/download/excalidraw-vscode-plus.vsix && code --install-extension "$d/excalidraw-vscode-plus.vsix" --force; rm -rf "$d"
```

If you previously installed `aquarius-wing.excalidraw-live` or `aquarius-wing.excalidraw-editor-fonts`, uninstall it first so only one extension handles `.excalidraw` files.

## License

MIT, see [LICENSE](./LICENSE). Bundled fonts are under the SIL OFL, see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
