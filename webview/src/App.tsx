import { useEffect, useState, useRef } from "react";
import {
  Excalidraw,
  loadLibraryFromBlob,
  serializeLibraryAsJSON,
  THEME,
} from "@excalidraw/excalidraw";

import "@excalidraw/excalidraw/index.css";

import "./styles.css";
import {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  LibraryItems,
} from "@excalidraw/excalidraw/types";
import { isVSCode, vscode } from "./vscode.ts";
import { insertTable, parseClipboardTable } from "./pasteTable.ts";
import { insertCode, parseClipboardCode } from "./pasteCode.ts";
import CodeDialog from "./CodeDialog.tsx";
import MermaidDialog from "./MermaidDialog.tsx";
import { Collab, CollabStatus } from "./collab.ts";

// Stable, webview-independent link format for "Copy link to object".
// The default (window.location.href) yields a vscode-webview:// URL that
// contains a per-session id and cannot be opened by the OS.
const ELEMENT_LINK_PREFIX = "excalidraw-element://";

function detectTheme() {
  switch (document.body.className) {
    case "vscode-dark":
      return THEME.DARK;
    case "vscode-light":
      return THEME.LIGHT;
    default:
      return THEME.LIGHT;
  }
}

function useTheme(initialThemeConfig: string) {
  const [themeConfig, setThemeConfig] = useState(initialThemeConfig);
  const getExcalidrawTheme = () => {
    switch (themeConfig) {
      case "light":
        return THEME.LIGHT;
      case "dark":
        return THEME.DARK;
      case "auto":
        return detectTheme();
    }
  };
  const [theme, setTheme] = useState(getExcalidrawTheme());
  const updateTheme = () => {
    setTheme(getExcalidrawTheme());
  };

  useEffect(updateTheme, [themeConfig]);

  useEffect(() => {
    if (themeConfig !== "auto") return;
    const observer = new MutationObserver(() => {
      updateTheme();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      observer.disconnect();
    };
  }, [themeConfig]);

  return { theme, setThemeConfig };
}

export default function App(props: {
  initialData?: ExcalidrawInitialDataState;
  name: string;
  theme: string;
  langCode: string;
  viewModeEnabled: boolean;
  libraryItems?: LibraryItems;
  imageParams: {
    exportBackground: boolean;
    exportWithDarkMode: boolean;
    exportScale: 1 | 2 | 3;
  };
  dirty: boolean;
  onChange: (
    elements: readonly any[],
    appState: Partial<AppState>,
    files?: BinaryFiles
  ) => void;
}) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI>();
  const libraryItemsRef = useRef(props.libraryItems);
  const { theme, setThemeConfig } = useTheme(props.theme);
  const [imageParams, setImageParams] = useState(props.imageParams);
  const [langCode, setLangCode] = useState(props.langCode);
  const [codeDialogOpen, setCodeDialogOpen] = useState(false);
  const [codeEditing, setCodeEditing] = useState<
    { elementId: string; code: string; lang: string } | undefined
  >();
  const [collabStatus, setCollabStatus] = useState<CollabStatus>({
    active: false,
    peers: 0,
    state: "idle",
  });
  const [copied, setCopied] = useState(false);
  const apiRef = useRef<ExcalidrawImperativeAPI>();
  apiRef.current = excalidrawAPI;
  const collabRef = useRef<Collab>();
  if (!collabRef.current) {
    collabRef.current = new Collab(
      () => apiRef.current,
      (st) => {
        setCollabStatus(st);
        if (isVSCode) {
          vscode.postMessage({ type: "collab-status", status: st });
        }
      }
    );
  }
  const collab = collabRef.current;
  useEffect(() => () => collab.stop(), []);

  useEffect(() => {
    if (isVSCode || !excalidrawAPI) return;
    const joinFromHash = () => {
      if (!window.location.hash.includes("room=")) return;
      collab.start({
        serverUrl: window.location.origin,
        webUrl: window.location.origin,
        username: "Browser",
        link: window.location.href,
      });
    };
    joinFromHash();
    window.addEventListener("hashchange", joinFromHash);
    return () => window.removeEventListener("hashchange", joinFromHash);
  }, [excalidrawAPI]);
  const [mermaidOpen, setMermaidOpen] = useState(false);
  const [mermaidEditing, setMermaidEditing] = useState<
    { mermaidId: string; source: string; frameName?: string } | undefined
  >();

  useEffect(() => {
    if (!props.dirty) {
      return;
    }
    if (props.initialData) {
      const { elements, appState, files } = props.initialData;
      props.onChange(elements || [], appState || {}, files);
    } else {
      props.onChange([], { viewBackgroundColor: "#ffffff" }, {});
    }
  }, []);

  // Paste a table (Excel / Sheets / Lark TSV, or a Markdown table) as a grid
  // of cells instead of a single text blob.
  useEffect(() => {
    if (!excalidrawAPI || props.viewModeEnabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) {
        return; // typing into a text element or a field: paste normally
      }
      const text = e.clipboardData?.getData("text/plain");
      if (!text) return;
      // code first: tab-indented code would otherwise look like a TSV table
      const code = parseClipboardCode(text);
      const table = code ? null : parseClipboardTable(text);
      if (!code && !table) return;
      e.preventDefault();
      e.stopPropagation(); // keep Excalidraw's own paste handler from running
      if (code) insertCode(excalidrawAPI, code);
      else if (table) insertTable(excalidrawAPI, table);
    };
    document.addEventListener("paste", onPaste, true);
    return () => document.removeEventListener("paste", onPaste, true);
  }, [excalidrawAPI, props.viewModeEnabled]);

  // Double-click a code image to edit its source in the same dialog.
  useEffect(() => {
    if (!excalidrawAPI || props.viewModeEnabled) return;
    const onDbl = (e: MouseEvent) => {
      const selected = excalidrawAPI.getAppState().selectedElementIds;
      const ids = Object.keys(selected);
      // Mermaid diagram: any selected element tagged by MermaidDialog.
      // Alt + double-click falls through to Excalidraw (edit a single text).
      if (!e.altKey) {
        const m: any = excalidrawAPI
          .getSceneElements()
          .find(
            (x: any) =>
              !x.isDeleted &&
              selected[x.id] &&
              typeof x.customData?.mermaidSource === "string"
          );
        if (m) {
          setMermaidEditing({
            mermaidId: m.customData.mermaidId,
            source: m.customData.mermaidSource,
            frameName: m.type === "frame" ? m.name : undefined,
          });
          setMermaidOpen(true);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      if (ids.length !== 1) return;
      const el: any = excalidrawAPI
        .getSceneElements()
        .find((x) => x.id === ids[0] && !x.isDeleted);
      if (el?.type !== "image" || typeof el.customData?.code !== "string") {
        return;
      }
      setCodeEditing({
        elementId: el.id,
        code: el.customData.code,
        lang: el.customData.lang ?? "typescript",
      });
      setCodeDialogOpen(true);
      e.stopPropagation(); // skip Excalidraw's own double-click handling
    };
    document.addEventListener("dblclick", onDbl, true);
    return () => document.removeEventListener("dblclick", onDbl, true);
  }, [excalidrawAPI, props.viewModeEnabled]);

  useEffect(() => {
    const listener = async (e: any) => {
      try {
        const message = e.data;
        switch (message.type) {
          case "library-change": {
            const blob = new Blob([message.library], {
              type: "application/json",
            });
            const libraryItems = await loadLibraryFromBlob(blob);
            if (
              JSON.stringify(libraryItems) ==
              JSON.stringify(libraryItemsRef.current)
            ) {
              return;
            }
            libraryItemsRef.current = libraryItems;
            excalidrawAPI?.updateLibrary({
              libraryItems,
              merge: message.merge,
              openLibraryMenu: !message.merge,
            });
            break;
          }
          case "theme-change": {
            setThemeConfig(message.theme);
            break;
          }
          case "language-change": {
            setLangCode(message.langCode);
            break;
          }
          case "collab-start":
            collab.start({
              serverUrl: message.serverUrl,
              webUrl: message.webUrl,
              username: message.username,
              link: message.link,
            });
            break;
          case "collab-stop":
            collab.stop();
            break;
          case "image-params-change": {
            setImageParams(message.imageParams);
          }
        }
      } catch (e) {
        vscode.postMessage({
          type: "error",
          content: (e as Error).message,
        });
      }
    };
    window.addEventListener("message", listener);

    return () => {
      window.removeEventListener("message", listener);
    };
  }, [excalidrawAPI]);

  return (
    <div className="excalidraw-wrapper">
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        UIOptions={{
          canvasActions: {
            loadScene: !isVSCode,
            saveToActiveFile: false,
          },
        }}
        generateLinkForSelection={(id) => `${ELEMENT_LINK_PREFIX}${id}`}
        renderTopRightUI={() =>
          props.viewModeEnabled ? null : (
            <>
              {collabStatus.active ? (
                <>
                  <button
                    className="code-dialog-trigger"
                    title={collabStatus.error ?? "Copy the room link"}
                    onClick={() => {
                      if (isVSCode) {
                        vscode.postMessage({ type: "collab-copy", link: collabStatus.link });
                      } else if (collabStatus.link) {
                        navigator.clipboard?.writeText(collabStatus.link).catch(() => {});
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }
                    }}
                  >
                    {collabStatus.state === "error" ? "⚠ " : "● "}
                    {collabStatus.peers} · {copied ? "Copied" : "Copy link"}
                  </button>
                  <button
                    className="code-dialog-trigger"
                    title="Stop collaborating"
                    onClick={() => {
                      collab.stop();
                      if (!isVSCode && window.location.hash.includes("room=")) {
                        window.history.replaceState(
                          null,
                          "",
                          window.location.pathname + window.location.search
                        );
                      }
                    }}
                  >
                    Stop
                  </button>
                </>
              ) : (
                <button
                  className="code-dialog-trigger"
                  title="Start a live collaboration room"
                  onClick={async () => {
                    if (isVSCode) {
                      vscode.postMessage({ type: "collab-request-start" });
                      return;
                    }
                    await collab.start({
                      serverUrl: window.location.origin,
                      webUrl: window.location.origin,
                      username: "Browser",
                    });
                    const link = collab.getLink();
                    if (link) {
                      window.history.replaceState(null, "", link);
                      navigator.clipboard?.writeText(link).catch(() => {});
                    }
                  }}
                >
                  Collaborate
                </button>
              )}
              <button
                className="code-dialog-trigger"
                title="Mermaid to Excalidraw (editable)"
                onClick={() => {
                  setMermaidEditing(undefined);
                  setMermaidOpen(true);
                }}
              >
                Mermaid
              </button>
              <button
                className="code-dialog-trigger"
                title="Code to Excalidraw"
                onClick={() => {
                  setCodeEditing(undefined);
                  setCodeDialogOpen(true);
                }}
              >
                {"</>"} Code
              </button>
            </>
          )
        }
        isCollaborating={collabStatus.active}
        onPointerUpdate={(p) => collab.onPointer(p)}
        langCode={langCode}
        name={props.name}
        theme={theme}
        viewModeEnabled={props.viewModeEnabled}
        initialData={{
          ...props.initialData,
          libraryItems: props.libraryItems,
          scrollToContent: true,
        }}
        libraryReturnUrl={"vscode://aquarius-wing.excalidraw-vscode-plus/importLib"}
        onChange={(elements, appState, files) => {
          collab.onLocalChange(elements);
          props.onChange(
            elements,
            { ...appState, ...imageParams, exportEmbedScene: true },
            files
          );
        }}
        onLinkOpen={(element, event) => {
          const link = element.link ?? "";
          if (link.startsWith(ELEMENT_LINK_PREFIX)) {
            event.preventDefault();
            const id = link.slice(ELEMENT_LINK_PREFIX.length);
            // the id may refer to a single element or to a group
            const targets = (excalidrawAPI?.getSceneElements() ?? []).filter(
              (el) =>
                !el.isDeleted && (el.id === id || el.groupIds.includes(id))
            );
            if (targets.length === 0) {
              vscode.postMessage({
                type: "error",
                content: "Linked element no longer exists in this drawing.",
              });
              return;
            }
            excalidrawAPI?.scrollToContent(targets, {
              fitToViewport: true,
              viewportZoomFactor: 0.6,
              animate: true,
            });
            excalidrawAPI?.updateScene({
              appState: {
                selectedElementIds: Object.fromEntries(
                  targets.map((el) => [el.id, true as const])
                ),
              },
            });
            return;
          }
          if (isVSCode) {
            vscode.postMessage({
              type: "link-open",
              url: element.link,
            });
          } else if (element.link) {
            window.open(element.link, "_blank", "noopener,noreferrer");
          }
          event.preventDefault();
        }}
        onLibraryChange={(libraryItems) => {
          if (
            JSON.stringify(libraryItems) ==
            JSON.stringify(libraryItemsRef.current)
          ) {
            return;
          }
          libraryItemsRef.current = libraryItems;
          vscode.postMessage({
            type: "library-change",
            library: serializeLibraryAsJSON(libraryItems),
          });
        }}
      />
      {mermaidOpen && excalidrawAPI && (
        <MermaidDialog
          api={excalidrawAPI}
          editing={mermaidEditing}
          onClose={() => {
            setMermaidOpen(false);
            setMermaidEditing(undefined);
          }}
        />
      )}
      {codeDialogOpen && excalidrawAPI && (
        <CodeDialog
          api={excalidrawAPI}
          editing={codeEditing}
          onClose={() => {
            setCodeDialogOpen(false);
            setCodeEditing(undefined);
          }}
        />
      )}
    </div>
  );
}
