import { useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, exportToCanvas } from "@excalidraw/excalidraw";
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

type Parsed = {
  elements: any[];
  files: BinaryFiles;
  frameId: string;
  engine: string;
};

const DEFAULT_SOURCE =
  "flowchart TD\n  A[Start] --> B{Ok?}\n  B -->|yes| C[Done]\n  B -->|no| A";

export default function MermaidDialog(props: {
  api: ExcalidrawImperativeAPI;
  onClose: () => void;
  editing?: { mermaidId: string; source: string; frameName?: string };
}) {
  const [source, setSource] = useState(props.editing?.source ?? DEFAULT_SOURCE);
  const [frameTitle, setFrameTitle] = useState(props.editing?.frameName ?? "");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const parsed = useRef<Parsed | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => taRef.current?.focus(), []);

  // debounced live preview
  useEffect(() => {
    if (!source.trim()) {
      parsed.current = null;
      setReady(false);
      previewRef.current?.replaceChildren();
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { convertMermaid } = await import("./mermaid/converter.ts");
        const prefix = `mmd_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        const res = await convertMermaid(source, { frameTitle, prefix });
        const canvas = await exportToCanvas({
          elements: res.elements,
          files: res.files,
          exportPadding: 12,
          maxWidthOrHeight: 900,
        });
        if (cancelled) return;
        parsed.current = {
          elements: res.elements,
          files: res.files,
          frameId: res.frameId,
          engine: res.engine,
        };
        previewRef.current?.replaceChildren(canvas);
        setReady(true);
        setError("");
      } catch (e) {
        if (cancelled) return;
        parsed.current = null;
        setReady(false);
        setError((e as Error).message ?? String(e));
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [source, frameTitle]);

  const insert = () => {
    const data = parsed.current;
    if (!data || data.elements.length === 0) return;
    const { api } = props;
    const mermaidId =
      props.editing?.mermaidId ??
      `mmd-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    // Store mermaidSource ONLY on the wrapping frame so child shapes/texts/arrows
    // remain natively editable on double-click, while double-clicking the frame
    // re-opens this Mermaid editor.
    const tagged = data.elements.map((el) =>
      el.id === data.frameId
        ? {
            ...el,
            customData: { ...el.customData, mermaidId, mermaidSource: source },
          }
        : el
    );
    const fileList = Object.values(data.files) as BinaryFileData[];
    if (fileList.length) api.addFiles(fileList);

    const frameEl = tagged.find((e) => e.id === data.frameId) ?? tagged[0];
    const minX = frameEl
      ? frameEl.x
      : Math.min(...tagged.map((e) => e.x));
    const minY = frameEl
      ? frameEl.y
      : Math.min(...tagged.map((e) => e.y));
    const maxX = frameEl
      ? frameEl.x + frameEl.width
      : Math.max(...tagged.map((e) => e.x + (e.width ?? 0)));
    const maxY = frameEl
      ? frameEl.y + frameEl.height
      : Math.max(...tagged.map((e) => e.y + (e.height ?? 0)));
    const w = maxX - minX;
    const h = maxY - minY;

    const scene = api.getSceneElements() as any[];
    let cx: number;
    let cy: number;
    let kept = scene;
    if (props.editing) {
      const oldFrame = scene.find(
        (e) =>
          !e.isDeleted &&
          e.type === "frame" &&
          e.customData?.mermaidId === mermaidId
      );
      const oldIds = new Set(
        scene
          .filter(
            (e) =>
              !e.isDeleted &&
              (e.id === oldFrame?.id ||
                e.frameId === oldFrame?.id ||
                e.customData?.mermaidId === mermaidId)
          )
          .map((e) => e.id)
      );
      const old = scene.filter((e) => oldIds.has(e.id));
      if (oldFrame) {
        cx = oldFrame.x + oldFrame.width / 2;
        cy = oldFrame.y + oldFrame.height / 2;
      } else if (old.length) {
        const ox1 = Math.min(...old.map((e) => e.x));
        const oy1 = Math.min(...old.map((e) => e.y));
        const ox2 = Math.max(...old.map((e) => e.x + (e.width ?? 0)));
        const oy2 = Math.max(...old.map((e) => e.y + (e.height ?? 0)));
        cx = (ox1 + ox2) / 2;
        cy = (oy1 + oy2) / 2;
      } else {
        const s = api.getAppState();
        cx = -s.scrollX + s.width / 2 / s.zoom.value;
        cy = -s.scrollY + s.height / 2 / s.zoom.value;
      }
      // soft-delete so undo restores the previous diagram cleanly
      kept = scene.map((e) =>
        oldIds.has(e.id)
          ? {
              ...e,
              isDeleted: true,
              version: e.version + 1,
              versionNonce: Math.floor(Math.random() * 2 ** 31),
              updated: Date.now(),
            }
          : e
      );
    } else {
      const s = api.getAppState();
      cx = -s.scrollX + s.width / 2 / s.zoom.value;
      cy = -s.scrollY + s.height / 2 / s.zoom.value;
    }
    const dx = Math.round(cx - w / 2 - minX);
    const dy = Math.round(cy - h / 2 - minY);
    const moved = tagged.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));

    api.updateScene({
      elements: [...kept, ...moved],
      appState: {
        selectedElementIds: { [data.frameId]: true },
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    props.onClose();
  };

  return (
    <div className="code-dialog-backdrop" onMouseDown={props.onClose}>
      <div
        className="code-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onClose();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) insert();
        }}
      >
        <h3>{props.editing ? "Edit Mermaid" : "Mermaid to Excalidraw"}</h3>
        <p className="code-dialog-hint">
          Inserted as native Excalidraw components inside a frame. Double-click
          the frame to edit Mermaid source; double-click any inner element to
          edit it directly.
        </p>
        <div className="code-dialog-meta">
          <label>
            Frame title
            <input
              type="text"
              value={frameTitle}
              placeholder="Auto (from diagram)"
              onChange={(e) => setFrameTitle(e.target.value)}
            />
          </label>
        </div>
        <div className="code-dialog-panels">
          <div className="code-dialog-panel">
            <label>Mermaid syntax</label>
            <textarea
              ref={taRef}
              value={source}
              spellCheck={false}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>
          <div className="code-dialog-panel">
            <label>Preview</label>
            <div className="code-dialog-preview">
              {error && <span className="code-dialog-error">{error}</span>}
              <div ref={previewRef} />
            </div>
          </div>
        </div>
        <div className="code-dialog-actions">
          <button
            className="code-dialog-insert"
            disabled={!ready}
            onClick={insert}
          >
            {props.editing ? "Update →" : "Insert →"}
          </button>
          <span className="code-dialog-hint">Cmd/Ctrl + Enter</span>
        </div>
      </div>
    </div>
  );
}
