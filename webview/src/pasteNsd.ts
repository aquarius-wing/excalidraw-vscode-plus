import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  FONT_FAMILY,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/**
 * N-S 盒图（Nassi–Shneiderman 结构化流程图）。粘贴下面这种缩进文本即可生成：
 *
 *   nsd 标题（可省略）
 *   普通一行            → 顺序盒
 *   if 条件 ?           → 带三角形的条件盒
 *     yes:              →   左格（是）
 *       ……
 *     no:               →   右格（否）
 *       ……
 *   loop 循环标题       → 带缩进的循环盒，子行比它多缩进一级
 *     ……
 */
export type NsdBlock =
  | { t: "p"; text: string }
  | { t: "c"; cond: string; yes: NsdBlock[]; no: NsdBlock[] }
  | { t: "l"; head: string; body: NsdBlock[] };
export type ParsedNsd = { title: string; blocks: NsdBlock[] };

const HEADER = /^\s*nsd(?:\s+(.*))?$/i;

type Line = { indent: number; text: string };

function toLines(rows: string[]): Line[] {
  return rows
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const expanded = l.replace(/\t/g, "  ");
      return { indent: expanded.length - expanded.trimStart().length, text: expanded.trim() };
    });
}

// 解析 lines[from..) 中缩进等于 base 的块；遇到更小缩进就结束。
function parseBlocks(lines: Line[], from: number, base: number): [NsdBlock[], number] {
  const blocks: NsdBlock[] = [];
  let i = from;
  while (i < lines.length && lines[i].indent >= base) {
    const { text, indent } = lines[i];
    if (indent > base) {
      // 多余缩进：当作上一行的续行，不丢内容
      const prev = blocks[blocks.length - 1];
      if (prev?.t === "p") prev.text += " " + text;
      else blocks.push({ t: "p", text });
      i++;
      continue;
    }
    const cond = /^if\s+(.+?)\s*[?？]?\s*$/i.exec(text);
    const loop = /^loop\s+(.+)$/i.exec(text);
    if (cond) {
      let yes: NsdBlock[] = [], no: NsdBlock[] = [];
      i++;
      while (i < lines.length && lines[i].indent > base) {
        const label = /^(yes|no|是|否)\s*[:：]?\s*$/i.exec(lines[i].text);
        if (!label) { i++; continue; }
        const isYes = /^(yes|是)$/i.test(label[1]);
        const labelIndent = lines[i].indent, childIndent = lines[i + 1]?.indent ?? 0;
        const [sub, next] = childIndent > labelIndent ? parseBlocks(lines, i + 1, childIndent) : [[], i + 1];
        if (isYes) yes = sub; else no = sub;
        i = next;
      }
      blocks.push({ t: "c", cond: cond[1], yes, no });
    } else if (loop) {
      i++;
      const childIndent = lines[i]?.indent ?? 0;
      if (i < lines.length && childIndent > base) {
        const [body, next] = parseBlocks(lines, i, childIndent);
        blocks.push({ t: "l", head: loop[1], body });
        i = next;
      } else {
        blocks.push({ t: "l", head: loop[1], body: [] });
      }
    } else {
      blocks.push({ t: "p", text });
      i++;
    }
  }
  return [blocks, i];
}

export function parseClipboardNsd(text: string): ParsedNsd | null {
  const rows = text.replace(/\r\n?/g, "\n").replace(/^\n+/, "").split("\n");
  const head = HEADER.exec(rows[0] ?? "");
  if (!head) return null;
  const lines = toLines(rows.slice(1));
  if (!lines.length) return null;
  const [blocks] = parseBlocks(lines, 0, lines[0].indent);
  return blocks.length ? { title: (head[1] ?? "").trim(), blocks } : null;
}

const FS = 14;
const LH = 1.25;
const PAD = 8;
const INDENT = 26;
const COND_EXTRA = 40;
const FONT = FONT_FAMILY.Nunito;
const WIDTH = 720;

// CJK 约 1em，其余按保守的 0.62em；宁可多换行，也不让文字溢出盒子。
const cw = (ch: string) =>
  /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? FS * 1.04 : FS * 0.62;

function wrap(text: string, maxW: number): string[] {
  const out: string[] = [];
  let cur = "", w = 0;
  for (const ch of text) {
    const c = cw(ch);
    if (w + c > maxW && cur) { out.push(cur); cur = ""; w = 0; }
    cur += ch; w += c;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

export function layoutNsd(nsd: ParsedNsd, ox: number, oy: number, width = WIDTH): { els: any[]; height: number } {
  const groupId = `nsd-${Math.random().toString(36).slice(2, 10)}`;
  const els: any[] = [];
  const base = { roughness: 0, strokeWidth: 1, strokeColor: "#1e1e1e", groupIds: [groupId] };
  const rect = (x: number, y: number, w: number, h: number, bg = "transparent") =>
    ({ ...base, type: "rectangle", x, y, width: w, height: h, backgroundColor: bg, fillStyle: "solid" });
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    ({ ...base, type: "line", x: x1, y: y1, points: [[0, 0], [x2 - x1, y2 - y1]] });
  const text = (s: string, x: number, y: number, maxW: number, bold = false, centerIn = 0) => {
    const lines = wrap(s, maxW);
    const w = Math.max(...lines.map((l) => [...l].reduce((n, c) => n + cw(c), 0)));
    els.push({
      ...base, type: "text", text: lines.join("\n"), fontSize: FS, fontFamily: FONT,
      x: centerIn ? x + (centerIn - w) / 2 : x, y,
      strokeColor: bold ? "#1971c2" : "#1e1e1e",
    });
  };
  const textH = (s: string, maxW: number) => wrap(s, maxW).length * FS * LH;

  function layout(list: NsdBlock[], x: number, y: number, w: number): number {
    let cy = y;
    for (const b of list) cy += one(b, x, cy, w);
    return cy - y;
  }
  function one(b: NsdBlock, x: number, y: number, w: number): number {
    if (b.t === "p") {
      const h = textH(b.text, w - PAD * 2) + PAD * 2;
      els.push(rect(x, y, w, h));
      text(b.text, x + PAD, y + PAD, w - PAD * 2);
      return h;
    }
    if (b.t === "l") {
      const headH = textH(b.head, w - PAD * 2) + PAD * 2;
      els.push(rect(x, y, w, headH, "#e7f5ff"));
      text(b.head, x + PAD, y + PAD, w - PAD * 2, true);
      const bodyH = layout(b.body, x + INDENT, y + headH, w - INDENT);
      els.push(rect(x, y + headH, INDENT, bodyH));
      return headH + bodyH;
    }
    // 条件盒：底色先画，不能盖住子盒
    const half = w / 2, condW = w * 0.56, headH = textH(b.cond, condW) + COND_EXTRA;
    const slot = els.length;
    const yh = layout(b.yes, x, y + headH, half), nh = layout(b.no, x + half, y + headH, half);
    const bh = Math.max(yh, nh, FS * LH + PAD * 2);
    els.splice(slot, 0, rect(x, y, w, headH + bh, "#fff9db"));
    if (yh < bh) els.push(rect(x, y + headH + yh, half, bh - yh));
    if (nh < bh) els.push(rect(x + half, y + headH + nh, half, bh - nh));
    els.push(line(x, y, x + half, y + headH), line(x + w, y, x + half, y + headH), line(x + half, y + headH, x + half, y + headH + bh));
    text(b.cond, x + (w - condW) / 2, y + 6, condW, true, condW);
    text("是", x + 10, y + headH - 22, 30);
    text("否", x + w - 26, y + headH - 22, 30);
    return headH + bh;
  }

  let top = oy;
  if (nsd.title) { text(nsd.title, ox, oy, width, true); top = oy + FS * LH + 8; }
  const bodyH = layout(nsd.blocks, ox, top, width);
  return { els, height: top - oy + bodyH };
}

export function insertNsd(api: ExcalidrawImperativeAPI, nsd: ParsedNsd): void {
  const { height } = layoutNsd(nsd, 0, 0);
  const s = api.getAppState();
  const x = -s.scrollX + s.width / 2 / s.zoom.value - WIDTH / 2;
  const y = -s.scrollY + s.height / 2 / s.zoom.value - height / 2;
  const created = convertToExcalidrawElements(layoutNsd(nsd, x, y).els as any);
  api.updateScene({
    elements: [...api.getSceneElements(), ...created],
    appState: { selectedElementIds: Object.fromEntries(created.map((el: any) => [el.id, true as const])) },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}
