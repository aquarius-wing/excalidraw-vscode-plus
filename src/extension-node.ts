import * as path from "path";
import * as vscode from "vscode";
import { activate as activateCommon } from "./extension";
import { setRelayStarter } from "./relay-hook";
import { ensureLocalRelay, stopRelay } from "./relay";

// Desktop entry: same extension plus an embedded collaboration relay and web app.
export async function activate(context: vscode.ExtensionContext) {
  const webRoot = path.join(context.extensionPath, "webview", "dist");
  setRelayStarter(async (serverUrl) => {
    const enabled = vscode.workspace
      .getConfiguration("excalidraw")
      .get<boolean>("collab.autoStartRelay", true);
    return enabled ? ensureLocalRelay(serverUrl, webRoot) : undefined;
  });
  context.subscriptions.push({ dispose: stopRelay });
  await activateCommon(context);
}
