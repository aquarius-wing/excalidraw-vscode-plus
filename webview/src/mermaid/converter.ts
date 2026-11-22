import {
  convertToExcalidrawElements,
  restoreElements,
} from "@excalidraw/excalidraw";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { mermaidToLayoutIR } from "./svg-to-ir.mjs";
import { compileLayoutToExcalidraw } from "./ir-to-excalidraw.mjs";

export type MermaidConvertResult = {
  elements: any[];
  files: BinaryFiles;
  frameId: string;
  frameName: string;
  engine: "pele" | "mermaid-to-excalidraw";
};

function defaultFrameTitle(source: string, explicitTitle?: string): string {
  if (explicitTitle?.trim()) return explicitTitle.trim();
  const titleMatch = /^\s*(?:accTitle\s*:\s*|title\s+)(.+)$/m.exec(source);
  if (titleMatch?.[1]?.trim()) return titleMatch[1].trim();
  const firstLine = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("%%"));
  if (!firstLine) return "Mermaid";
  const head = firstLine.split(/[\s{(]/)[0];
  return head ? `Mermaid · ${head}` : "Mermaid";
}

function wrapInFrame(elements: any[], prefix: string, frameName: string): { frameId: string; elements: any[] } {
  const pad = 32;
  const minX = Math.min(...elements.map((e) => e.x));
  const minY = Math.min(...elements.map((e) => e.y));
  const maxX = Math.max(...elements.map((e) => e.x + (e.width ?? 0)));
  const maxY = Math.max(...elements.map((e) => e.y + (e.height ?? 0)));
  const frameId = `${prefix}_frame`;
  const seed = Math.floor(Math.random() * 2 ** 31);
  const frameEl = {
    id: frameId,
    type: "frame",
    x: Math.round(minX - pad),
    y: Math.round(minY - pad),
    width: Math.round(maxX - minX + pad * 2),
    height: Math.round(maxY - minY + pad * 2),
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed,
    version: 1,
    versionNonce: seed,
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    name: frameName,
  };
  const children = elements.map((el) => ({ ...el, frameId }));
  return { frameId, elements: [frameEl, ...children] };
}

export async function convertMermaid(
  source: string,
  opts: { frameTitle?: string; prefix?: string } = {}
): Promise<MermaidConvertResult> {
  const prefix =
    opts.prefix ??
    `mmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const frameName = defaultFrameTitle(source, opts.frameTitle);

  let peleErr: unknown;
  try {
    const ir = mermaidToLayoutIR(source);
    if (ir.nodes.length > 0 || ir.clusters.length > 0 || ir.edges.length > 0) {
      const compiled = compileLayoutToExcalidraw(ir, {
        frame: frameName,
        prefix,
        scale: 1.25,
      });
      const restored = restoreElements(compiled, null) as any[];
      return {
        elements: restored,
        files: {},
        frameId: `${prefix}_frame`,
        frameName,
        engine: "pele",
      };
    }
  } catch (e) {
    peleErr = e;
  }

  // Fallback for diagram types Pele does not extract IR for (e.g. gitGraph/pie/gantt)
  try {
    const { parseMermaidToExcalidraw } = await import(
      "@excalidraw/mermaid-to-excalidraw"
    );
    let ret;
    try {
      ret = await parseMermaidToExcalidraw(source);
    } catch {
      ret = await parseMermaidToExcalidraw(source.replace(/"/g, "'"));
    }
    const converted = convertToExcalidrawElements(ret.elements, {
      regenerateIds: true,
    }) as any[];
    if (converted.length === 0) {
      throw peleErr ?? new Error("No elements generated from Mermaid source");
    }
    const wrapped = wrapInFrame(converted, prefix, frameName);
    const restored = restoreElements(wrapped.elements, null) as any[];
    return {
      elements: restored,
      files: (ret.files ?? {}) as BinaryFiles,
      frameId: wrapped.frameId,
      frameName,
      engine: "mermaid-to-excalidraw",
    };
  } catch (fallbackErr) {
    throw peleErr instanceof Error ? peleErr : fallbackErr;
  }
}
