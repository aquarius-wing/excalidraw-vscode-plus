import * as vscode from "vscode";
import { activate as activateCommon } from "./extension";
import { setRelayStarter } from "./relay-hook";
import { ensureLocalRelay, stopRelay } from "./relay";

// Desktop entry: same extension plus an embedded collaboration relay.
export async function activate(context: vscode.ExtensionContext) {
  setRelayStarter(async (serverUrl) => {
    const enabled = vscode.workspace
      .getConfiguration("excalidraw")
      .get<boolean>("collab.autoStartRelay", true);
    return enabled ? ensureLocalRelay(serverUrl) : undefined;
  });
  context.subscriptions.push({ dispose: stopRelay });
  await activateCommon(context);
}
