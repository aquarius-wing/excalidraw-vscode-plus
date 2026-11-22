/**
 * Pure-JS Pele SVG -> LayoutIR parser (zero external dependencies).
 * Calls vendored pele.mjs in Node with a CJK-aware TextMeasurer and extracts
 * clusters, nodes, dividers, edges, markers, and labels in absolute pixels.
 */

import { parse as peleParse, render as peleRender } from "./pele.mjs";

const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
const WIDE_PUNCT_RE = /[（）【】《》「」『』、。，；：？！—…·]/;

/**
 * CJK-aware TextMeasurer matching Pele's { width(text, size, style) } contract.
 * style bits: 1 = bold, 2 = italic, 4 = monospace.
 */
export const cjkMeasurer = {
  width(text, size, style) {
    const str = String(text ?? "");
    const isBold = (style & 1) !== 0;
    const isMono = (style & 4) !== 0;
    const boldScale = isBold ? 1.05 : 1.0;
    let total = 0;
    for (const ch of str) {
      if (CJK_RE.test(ch) || WIDE_PUNCT_RE.test(ch)) {
        total += size * 1.04;
      } else if (isMono) {
        total += size * 0.62;
      } else if ("ilI1.,:;|!'` ".includes(ch)) {
        total += size * 0.32;
      } else if ("mwMW@%#&".includes(ch)) {
        total += size * 0.84;
      } else if (ch >= "A" && ch <= "Z") {
        total += size * 0.68;
      } else {
        total += size * 0.56;
      }
    }
    return total * boldScale;
  }
};

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

function parseAttrs(attrText) {
  const attrs = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(attrText)) !== null) {
    attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? "");
  }
  return attrs;
}

/**
 * Lightweight recursive XML tokenizer tailored for Pele's clean SVG output.
 */
export function parseXml(xml) {
  const root = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const tokenRe = /<\/?([a-zA-Z_:][\w:.-]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = tokenRe.exec(xml)) !== null) {
    if (m[3] !== undefined) {
      stack[stack.length - 1].text += decodeEntities(m[3]);
      continue;
    }
    const raw = m[0];
    const tag = m[1];
    if (raw.startsWith("</")) {
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const selfClosing = raw.endsWith("/>");
    const attrRaw = m[2].replace(/\/$/, "");
    const node = { tag, attrs: parseAttrs(attrRaw), children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) {
      stack.push(node);
    }
  }
  return root.children.find(c => c.tag === "svg") || root.children[0];
}

function collectText(el) {
  if (!el) return "";
  if (el.tag === "tspan") {
    return (el.text || "") + el.children.map(collectText).join("");
  }
  if (el.children.some(c => c.tag === "tspan")) {
    const lines = [];
    for (const c of el.children) {
      if (c.tag === "tspan") {
        lines.push(collectText(c));
      }
    }
    return lines.join("\n");
  }
  return (el.text || "") + el.children.map(collectText).join("");
}

function hasClass(el, cls) {
  const c = el.attrs?.class || "";
  return c.split(/\s+/).includes(cls);
}

function parseTransform(t) {
  if (!t) return [0, 0];
  const m = /translate\(\s*([-+\d.eE]+)(?:[\s,]+([-+\d.eE]+))?\s*\)/.exec(t);
  if (!m) return [0, 0];
  return [parseFloat(m[1]) || 0, parseFloat(m[2] ?? "0") || 0];
}

function walk(el, tx, ty, fn) {
  const [dx, dy] = parseTransform(el.attrs?.transform);
  const nx = tx + dx;
  const ny = ty + dy;
  fn(el, nx, ny);
  for (const child of el.children || []) {
    walk(child, nx, ny, fn);
  }
}

function findAll(el, pred, tx = 0, ty = 0, out = []) {
  const [dx, dy] = parseTransform(el.attrs?.transform);
  const nx = tx + dx;
  const ny = ty + dy;
  if (pred(el)) out.push({ el, tx: nx, ty: ny });
  for (const c of el.children || []) {
    findAll(c, pred, nx, ny, out);
  }
  return out;
}

/**
 * Sample an SVG path into polyline points + detect whether it contains curves.
 */
export function parseSvgPath(d, ox = 0, oy = 0) {
  const tokens = (d || "").match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const points = [];
  let idx = 0;
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let hasCurve = false;

  const nextNum = () => parseFloat(tokens[idx++]);
  const isCmd = (t) => /^[a-zA-Z]$/.test(t);
  const pushPt = (x, y) => {
    const px = +(x + ox).toFixed(2);
    const py = +(y + oy).toFixed(2);
    const prev = points[points.length - 1];
    if (!prev || Math.hypot(px - prev[0], py - prev[1]) > 0.5) {
      points.push([px, py]);
    }
  };

  while (idx < tokens.length) {
    if (isCmd(tokens[idx])) {
      cmd = tokens[idx++];
    } else if (cmd === "M") {
      cmd = "L";
    } else if (cmd === "m") {
      cmd = "l";
    }

    switch (cmd) {
      case "M":
      case "m": {
        const x = nextNum();
        const y = nextNum();
        cx = cmd === "m" ? cx + x : x;
        cy = cmd === "m" ? cy + y : y;
        sx = cx;
        sy = cy;
        pushPt(cx, cy);
        break;
      }
      case "L":
      case "l": {
        const x = nextNum();
        const y = nextNum();
        cx = cmd === "l" ? cx + x : x;
        cy = cmd === "l" ? cy + y : y;
        pushPt(cx, cy);
        break;
      }
      case "H":
      case "h": {
        const x = nextNum();
        cx = cmd === "h" ? cx + x : x;
        pushPt(cx, cy);
        break;
      }
      case "V":
      case "v": {
        const y = nextNum();
        cy = cmd === "v" ? cy + y : y;
        pushPt(cx, cy);
        break;
      }
      case "C":
      case "c": {
        hasCurve = true;
        const x1 = nextNum(), y1 = nextNum();
        const x2 = nextNum(), y2 = nextNum();
        const x = nextNum(), y = nextNum();
        const ax1 = cmd === "c" ? cx + x1 : x1;
        const ay1 = cmd === "c" ? cy + y1 : y1;
        const ax2 = cmd === "c" ? cx + x2 : x2;
        const ay2 = cmd === "c" ? cy + y2 : y2;
        const ax = cmd === "c" ? cx + x : x;
        const ay = cmd === "c" ? cy + y : y;
        for (const t of [0.33, 0.67, 1.0]) {
          const u = 1 - t;
          const bx = u * u * u * cx + 3 * u * u * t * ax1 + 3 * u * t * t * ax2 + t * t * t * ax;
          const by = u * u * u * cy + 3 * u * u * t * ay1 + 3 * u * t * t * ay2 + t * t * t * ay;
          pushPt(bx, by);
        }
        cx = ax;
        cy = ay;
        break;
      }
      case "Q":
      case "q": {
        hasCurve = true;
        const x1 = nextNum(), y1 = nextNum();
        const x = nextNum(), y = nextNum();
        const ax1 = cmd === "q" ? cx + x1 : x1;
        const ay1 = cmd === "q" ? cy + y1 : y1;
        const ax = cmd === "q" ? cx + x : x;
        const ay = cmd === "q" ? cy + y : y;
        for (const t of [0.5, 1.0]) {
          const u = 1 - t;
          const bx = u * u * cx + 2 * u * t * ax1 + t * t * ax;
          const by = u * u * cy + 2 * u * t * ay1 + t * t * ay;
          pushPt(bx, by);
        }
        cx = ax;
        cy = ay;
        break;
      }
      case "A":
      case "a": {
        const rx = nextNum(), ry = nextNum(), rot = nextNum();
        const la = nextNum(), sw = nextNum();
        const x = nextNum(), y = nextNum();
        void rx; void ry; void rot; void la; void sw;
        cx = cmd === "a" ? cx + x : x;
        cy = cmd === "a" ? cy + y : y;
        pushPt(cx, cy);
        break;
      }
      case "Z":
      case "z":
        cx = sx;
        cy = sy;
        pushPt(cx, cy);
        break;
      default:
        idx++;
        break;
    }
  }
  return { points: hasCurve ? simplifyPoints(points, 4.5) : simplifyPoints(points, 1.0), hasCurve };
}


function simplifyPoints(pts, eps = 5) {
  if (pts.length <= 2) return pts;
  let maxDist = 0;
  let idx = 0;
  const [x1, y1] = pts[0];
  const [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    const dist = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    if (dist > maxDist) {
      maxDist = dist;
      idx = i;
    }
  }
  if (maxDist > eps) {
    const left = simplifyPoints(pts.slice(0, idx + 1), eps);
    const right = simplifyPoints(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[pts.length - 1]];
}

function bboxFromPoints(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function parseStyleDecl(styleStr) {
  const out = {};
  if (!styleStr) return out;
  for (const part of styleStr.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim().toLowerCase();
    const v = part.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function concreteColor(val) {
  if (!val) return null;
  const v = val.trim();
  if (!v || v.startsWith("var(") || v === "none" || v === "transparent" || v === "inherit" || v === "currentColor") {
    return null;
  }
  return v;
}

function extractElStyle(el) {
  if (!el) return {};
  const css = parseStyleDecl(el.attrs?.style);
  const fill = concreteColor(css.fill ?? el.attrs?.fill);
  const stroke = concreteColor(css.stroke ?? el.attrs?.stroke);
  const strokeWidthRaw = css["stroke-width"] ?? el.attrs?.["stroke-width"];
  const strokeWidth = strokeWidthRaw ? parseFloat(strokeWidthRaw) : null;
  const strokeDasharray = css["stroke-dasharray"] ?? el.attrs?.["stroke-dasharray"] ?? null;
  return {
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
    ...(Number.isFinite(strokeWidth) ? { strokeWidth } : {}),
    ...(strokeDasharray && strokeDasharray !== "none" ? { dashed: true } : {}),
  };
}

function extractNodeStyle(nodeEl) {
  const primary =
    nodeEl.children.find(c => c.tag === "rect" && c.attrs.width && c.attrs.height) ||
    nodeEl.children.find(c => c.tag === "circle") ||
    nodeEl.children.find(c => c.tag === "polygon") ||
    nodeEl.children.find(c => c.tag === "path" && !hasClass(c, "pele-divider") && !hasClass(c, "pele-er-divider"));
  const style = extractElStyle(primary);

  let textColor = null;
  walk(nodeEl, 0, 0, (el) => {
    if (textColor || el.tag !== "text") return;
    if (hasClass(el, "pele-label") || hasClass(el, "pele-member") || hasClass(el, "pele-attribute") || hasClass(el, "pele-method")) {
      const css = parseStyleDecl(el.attrs?.style);
      const c = concreteColor(css.fill ?? css.color ?? el.attrs?.fill);
      if (c) textColor = c;
    }
  });
  if (textColor) style.textColor = textColor;
  return Object.keys(style).length ? style : undefined;
}

function extractNodeGeometry(nodeEl, tx, ty) {
  const classes = (nodeEl.attrs?.class || "").split(/\s+/);
  let shape = "rect";
  if (classes.includes("pele-note")) shape = "note";
  else if (classes.includes("pele-shape-diam")) shape = "diamond";
  else if (classes.includes("pele-shape-cyl")) shape = "cylinder";
  else if (classes.includes("pele-shape-circle") || classes.includes("pele-shape-double-circle")) shape = "ellipse";
  else if (classes.includes("pele-shape-stadium") || classes.includes("pele-shape-round")) shape = "round";
  else if (classes.includes("pele-class")) shape = "class";
  else if (classes.includes("pele-entity")) shape = "entity";

  // Find primary shape element
  const rect = nodeEl.children.find(c => c.tag === "rect" && c.attrs.width && c.attrs.height);
  if (rect) {
    return {
      shape,
      x: +(tx + (parseFloat(rect.attrs.x) || 0)).toFixed(2),
      y: +(ty + (parseFloat(rect.attrs.y) || 0)).toFixed(2),
      w: +parseFloat(rect.attrs.width).toFixed(2),
      h: +parseFloat(rect.attrs.height).toFixed(2),
      rx: parseFloat(rect.attrs.rx || "0") || 0
    };
  }

  const circle = nodeEl.children.find(c => c.tag === "circle");
  if (circle) {
    const r = parseFloat(circle.attrs.r) || 20;
    const cx = tx + (parseFloat(circle.attrs.cx) || 0);
    const cy = ty + (parseFloat(circle.attrs.cy) || 0);
    return { shape: "ellipse", x: +(cx - r).toFixed(2), y: +(cy - r).toFixed(2), w: +(2 * r).toFixed(2), h: +(2 * r).toFixed(2), rx: r };
  }

  const poly = nodeEl.children.find(c => c.tag === "polygon");
  if (poly && poly.attrs.points) {
    const nums = poly.attrs.points.trim().split(/[\s,]+/).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([tx + nums[i], ty + nums[i + 1]]);
    const b = bboxFromPoints(pts);
    return { shape, x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.w.toFixed(2), h: +b.h.toFixed(2), rx: 0 };
  }

  const paths = nodeEl.children.filter(c => c.tag === "path" && !hasClass(c, "pele-divider") && !hasClass(c, "pele-er-divider"));
  if (paths.length) {
    const pts = paths.flatMap(p => parseSvgPath(p.attrs.d, tx, ty).points);
    if (pts.length) {
      const b = bboxFromPoints(pts);
      return { shape, x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.w.toFixed(2), h: +b.h.toFixed(2), rx: 0 };
    }
  }
  return { shape, x: tx - 40, y: ty - 20, w: 80, h: 40, rx: 0 };
}

function extractDividers(nodeEl, ty) {
  const ys = [];
  for (const c of nodeEl.children) {
    if (c.tag === "path" && (hasClass(c, "pele-divider") || hasClass(c, "pele-er-divider"))) {
      const { points } = parseSvgPath(c.attrs.d, 0, ty);
      for (const [, py] of points) {
        if (!ys.some(y => Math.abs(y - py) < 1)) ys.push(+py.toFixed(2));
      }
    }
  }
  return ys.sort((a, b) => a - b);
}

function extractNodeContent(nodeEl) {
  const annotations = [];
  const labels = [];
  const attributes = [];
  const methods = [];
  const erRows = [];

  walk(nodeEl, 0, 0, (el) => {
    if (el.tag !== "text") return;
    if (hasClass(el, "pele-annotation")) annotations.push(collectText(el).trim());
    else if (hasClass(el, "pele-label")) labels.push(collectText(el).trim());
    else if (hasClass(el, "pele-attribute")) attributes.push(collectText(el).trim());
    else if (hasClass(el, "pele-method")) methods.push(collectText(el).trim());
  });

  // ER attributes grouped by y coordinate
  const erAttrsGroup = nodeEl.children.find(c => hasClass(c, "pele-er-attributes"));
  if (erAttrsGroup) {
    const byY = new Map();
    for (const t of erAttrsGroup.children) {
      if (t.tag !== "text") continue;
      const yKey = Math.round(parseFloat(t.attrs.y || "0"));
      if (!byY.has(yKey)) byY.set(yKey, []);
      byY.get(yKey).push(collectText(t).trim());
    }
    for (const [, parts] of [...byY.entries()].sort((a, b) => a[0] - b[0])) {
      erRows.push(parts.filter(Boolean).join(" "));
    }
  }

  return {
    annotation: annotations.join("\n") || null,
    label: labels.join("\n") || nodeEl.attrs["data-id"] || "",
    attributes,
    methods,
    erRows
  };
}

function buildSemanticEdgeMap(parsedModel) {
  const map = new Map();
  if (!parsedModel) return map;

  if (Array.isArray(parsedModel.edges)) {
    for (const e of parsedModel.edges) {
      if (e.id) {
        map.set(e.id, {
          from: e.start,
          to: e.end,
          dashed: e.stroke === "dotted" || e.stroke === "dashed",
          edgeType: e.type || "arrow_point",
          text: e.text || null
        });
      }
    }
  }

  if (Array.isArray(parsedModel.relations)) {
    const relTypeMap = { 0: "diamond_outline", 1: "triangle_outline", 2: "diamond", 3: "arrow", 4: "dot" };
    parsedModel.relations.forEach((r, idx) => {
      const id = `id_${r.id1}_${r.id2}_${idx + 1}`;
      const altId = `id_${r.id1}_${r.id2}_${idx}`;
      const info = {
        from: r.id1,
        to: r.id2,
        dashed: r.relation?.lineType === 1,
        arrowStart: relTypeMap[r.relation?.type1] || null,
        arrowEnd: relTypeMap[r.relation?.type2] || null,
        text: r.title || null
      };
      map.set(id, info);
      map.set(altId, info);
    });
  }
  return map;
}

/**
 * Compile Mermaid source into a normalized LayoutIR using vendored Pele.
 */
export function mermaidToLayoutIR(source, options = {}) {
  const renderOpts = {
    responsive: false,
    autoDirection: false,
    fontSize: options.fontSize ?? 15,
    padding: options.padding ?? 16,
    monospace: ["members", "attributes"],
    measurer: cjkMeasurer,
    ...(options.config ? { config: options.config } : {})
  };

  const parsed = peleParse(source);
  const rendered = peleRender(parsed, renderOpts);
  const svg = parseXml(rendered.svg);
  const semanticEdges = buildSemanticEdgeMap(parsed);

  const clusters = [];
  for (const { el, tx, ty } of findAll(svg, e => hasClass(e, "pele-cluster"))) {
    const rect = el.children.find(c => c.tag === "rect");
    const lbl = el.children.find(c => hasClass(c, "pele-cluster-label"));
    if (!rect) continue;
    const cStyle = extractElStyle(rect);
    if (lbl) {
      const lc = concreteColor(parseStyleDecl(lbl.attrs?.style).fill ?? lbl.attrs?.fill);
      if (lc) cStyle.textColor = lc;
    }
    clusters.push({
      id: el.attrs["data-id"] || `cluster_${clusters.length}`,
      label: lbl ? collectText(lbl).trim() : "",
      x: +(tx + (parseFloat(rect.attrs.x) || 0)).toFixed(2),
      y: +(ty + (parseFloat(rect.attrs.y) || 0)).toFixed(2),
      w: +parseFloat(rect.attrs.width || "0").toFixed(2),
      h: +parseFloat(rect.attrs.height || "0").toFixed(2),
      ...(Object.keys(cStyle).length ? { style: cStyle } : {})
    });
  }

  const nodes = [];
  for (const { el, tx, ty } of findAll(svg, e => hasClass(e, "pele-node"))) {
    const id = el.attrs["data-id"] || `node_${nodes.length}`;
    const geom = extractNodeGeometry(el, tx, ty);
    const dividers = extractDividers(el, ty);
    const content = extractNodeContent(el);
    const style = extractNodeStyle(el);
    nodes.push({ id, ...geom, dividers, ...content, ...(style ? { style } : {}) });
  }

  // Edge labels indexed by data-id
  const edgeLabelMap = new Map();
  for (const { el, tx, ty } of findAll(svg, e => hasClass(e, "pele-edge-label"))) {
    const id = el.attrs["data-id"];
    if (!id) continue;
    const rect = el.children.find(c => c.tag === "rect");
    const txt = el.children.find(c => c.tag === "text");
    const text = txt ? collectText(txt).trim() : "";
    if (!text) continue;
    const x = rect ? +(tx + (parseFloat(rect.attrs.x) || 0)).toFixed(2) : +(tx + (parseFloat(txt.attrs.x) || 0) - 30).toFixed(2);
    const y = rect ? +(ty + (parseFloat(rect.attrs.y) || 0)).toFixed(2) : +(ty + (parseFloat(txt.attrs.y) || 0) - 14).toFixed(2);
    const w = rect ? +parseFloat(rect.attrs.width || "60").toFixed(2) : Math.ceil(cjkMeasurer.width(text, 14, 0) + 12);
    const h = rect ? +parseFloat(rect.attrs.height || "20").toFixed(2) : 20;
    edgeLabelMap.set(id, { text, x, y, w, h });
  }

  const nodeById = new Map(nodes.map(n => [n.id, n]));

  const nodeOutwardNormal = (pt, node) => {
    if (!node) return null;
    const dTop = Math.abs(pt[1] - node.y);
    const dBot = Math.abs(pt[1] - (node.y + node.h));
    const dLeft = Math.abs(pt[0] - node.x);
    const dRight = Math.abs(pt[0] - (node.x + node.w));
    const m = Math.min(dTop, dBot, dLeft, dRight);
    if (m > 28) return null;
    if (m === dBot) return [0, 1];
    if (m === dTop) return [0, -1];
    if (m === dRight) return [1, 0];
    return [-1, 0];
  };

  const snapWithNormal = (pt, node, gap = 3.5) => {
    if (!node) return { pt, normal: null };
    const cx = Math.max(node.x, Math.min(node.x + node.w, pt[0]));
    const cy = Math.max(node.y, Math.min(node.y + node.h, pt[1]));
    const dx = pt[0] - cx, dy = pt[1] - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > 28) return { pt, normal: null };
    const normal = dist > 0.5 ? [dx / dist, dy / dist] : nodeOutwardNormal(pt, node);
    if (!normal) return { pt, normal: null };
    return {
      pt: [+(cx + normal[0] * gap).toFixed(2), +(cy + normal[1] * gap).toFixed(2)],
      normal
    };
  };

  const snapEdgeEndpoints = (rawPts, fromNode, toNode) => {
    const pts = rawPts.map(p => [p[0], p[1]]);
    if (fromNode) pts[0] = snapWithNormal(pts[0], fromNode).pt;
    if (toNode) pts[pts.length - 1] = snapWithNormal(pts[pts.length - 1], toNode).pt;
    while (pts.length >= 3) {
      const v01x = pts[1][0] - pts[0][0], v01y = pts[1][1] - pts[0][1];
      const v12x = pts[2][0] - pts[1][0], v12y = pts[2][1] - pts[1][1];
      const len01 = Math.hypot(v01x, v01y);
      if (len01 < 6 || (v01x * v12x + v01y * v12y < 0 && len01 < 24)) {
        pts.splice(1, 1);
      } else break;
    }
    while (pts.length >= 3) {
      const n = pts.length;
      const vLastX = pts[n - 1][0] - pts[n - 2][0], vLastY = pts[n - 1][1] - pts[n - 2][1];
      const vPrevX = pts[n - 2][0] - pts[n - 3][0], vPrevY = pts[n - 2][1] - pts[n - 3][1];
      const lenLast = Math.hypot(vLastX, vLastY);
      if (lenLast < 6 || (vLastX * vPrevX + vLastY * vPrevY < 0 && lenLast < 24)) {
        pts.splice(n - 2, 1);
      } else break;
    }
    return pts;
  };

  const parseSvgSegments = (d, ox = 0, oy = 0) => {
    const tokens = (d || "").match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
    const segs = [];
    let idx = 0, cmd = "", cx = 0, cy = 0, sx = 0, sy = 0;
    const nextNum = () => parseFloat(tokens[idx++]);
    const isCmd = (t) => /^[a-zA-Z]$/.test(t);
    const pt = (x, y) => [x + ox, y + oy];
    while (idx < tokens.length) {
      if (isCmd(tokens[idx])) cmd = tokens[idx++];
      else if (cmd === "M") cmd = "L";
      else if (cmd === "m") cmd = "l";
      switch (cmd) {
        case "M": case "m": {
          const x = nextNum(), y = nextNum();
          cx = cmd === "m" ? cx + x : x; cy = cmd === "m" ? cy + y : y;
          sx = cx; sy = cy; break;
        }
        case "L": case "l": {
          const x = nextNum(), y = nextNum();
          const nx = cmd === "l" ? cx + x : x, ny = cmd === "l" ? cy + y : y;
          if (Math.hypot(nx - cx, ny - cy) > 0.01) segs.push({ type: "L", p0: pt(cx, cy), p1: pt(nx, ny) });
          cx = nx; cy = ny; break;
        }
        case "H": case "h": {
          const x = nextNum(), nx = cmd === "h" ? cx + x : x;
          if (Math.abs(nx - cx) > 0.01) segs.push({ type: "L", p0: pt(cx, cy), p1: pt(nx, cy) });
          cx = nx; break;
        }
        case "V": case "v": {
          const y = nextNum(), ny = cmd === "v" ? cy + y : y;
          if (Math.abs(ny - cy) > 0.01) segs.push({ type: "L", p0: pt(cx, cy), p1: pt(cx, ny) });
          cy = ny; break;
        }
        case "C": case "c": {
          const x1 = nextNum(), y1 = nextNum(), x2 = nextNum(), y2 = nextNum(), x = nextNum(), y = nextNum();
          const ax1 = cmd === "c" ? cx + x1 : x1, ay1 = cmd === "c" ? cy + y1 : y1;
          const ax2 = cmd === "c" ? cx + x2 : x2, ay2 = cmd === "c" ? cy + y2 : y2;
          const ax = cmd === "c" ? cx + x : x, ay = cmd === "c" ? cy + y : y;
          segs.push({ type: "C", p0: pt(cx, cy), c1: pt(ax1, ay1), c2: pt(ax2, ay2), p1: pt(ax, ay) });
          cx = ax; cy = ay; break;
        }
        case "Q": case "q": {
          const x1 = nextNum(), y1 = nextNum(), x = nextNum(), y = nextNum();
          const ax1 = cmd === "q" ? cx + x1 : x1, ay1 = cmd === "q" ? cy + y1 : y1;
          const ax = cmd === "q" ? cx + x : x, ay = cmd === "q" ? cy + y : y;
          segs.push({
            type: "C",
            p0: pt(cx, cy),
            c1: pt(cx + (2 / 3) * (ax1 - cx), cy + (2 / 3) * (ay1 - cy)),
            c2: pt(ax + (2 / 3) * (ax1 - ax), ay + (2 / 3) * (ay1 - ay)),
            p1: pt(ax, ay)
          });
          cx = ax; cy = ay; break;
        }
        case "Z": case "z": {
          if (Math.hypot(sx - cx, sy - cy) > 0.01) segs.push({ type: "L", p0: pt(cx, cy), p1: pt(sx, sy) });
          cx = sx; cy = sy; break;
        }
        default: idx++; break;
      }
    }
    return segs;
  };

  const evalExactSeg = (seg, t) => {
    if (seg.type === "L") return [seg.p0[0] + (seg.p1[0] - seg.p0[0]) * t, seg.p0[1] + (seg.p1[1] - seg.p0[1]) * t];
    const u = 1 - t;
    return [
      u * u * u * seg.p0[0] + 3 * u * u * t * seg.c1[0] + 3 * u * t * t * seg.c2[0] + t * t * t * seg.p1[0],
      u * u * u * seg.p0[1] + 3 * u * u * t * seg.c1[1] + 3 * u * t * t * seg.c2[1] + t * t * t * seg.p1[1]
    ];
  };

  // Exact cardinal Catmull-Rom basis matching RoughJS curve() used by Excalidraw roundness: { type: 2 }
  const crBasisWeights = (m, u) => {
    const w = new Array(m + 1).fill(0);
    const i = Math.min(m - 1, Math.max(0, Math.floor(u)));
    const t = u - i, omt = 1 - t;
    const b0 = omt * omt * omt, b1 = 3 * omt * omt * t, b2 = 3 * omt * t * t, b3 = t * t * t;
    w[i] += b0 + b1 + b2 / 6;
    w[i + 1] += b2 + b3 + b1 / 6;
    w[Math.max(0, i - 1)] -= b1 / 6;
    w[Math.min(m, i + 2)] -= b2 / 6;
    return w;
  };

  const solveLinearSystem = (A, b) => {
    const n = A.length;
    if (n === 0) return [];
    const M = A.map((row, r) => [...row, b[r]]);
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      [M[col], M[piv]] = [M[piv], M[col]];
      if (Math.abs(M[col][col]) < 1e-12) continue;
      for (let r = col + 1; r < n; r++) {
        const f = M[r][col] / M[col][col];
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let sum = M[r][n];
      for (let c = r + 1; c < n; c++) sum -= M[r][c] * x[c];
      x[r] = Math.abs(M[r][r]) < 1e-12 ? 0 : sum / M[r][r];
    }
    return x;
  };

  const fitCatmullRomToSvg = (d, ox, oy, fromNode, toNode, arrowStart, arrowEnd) => {
    const segs = parseSvgSegments(d, ox, oy);
    if (segs.length === 0 || !segs.some(s => s.type === "C")) return null;

    const sRes = snapWithNormal(segs[0].p0, fromNode);
    const eRes = snapWithNormal(segs[segs.length - 1].p1, toNode);
    const workSegs = [];
    if (Math.hypot(segs[0].p0[0] - sRes.pt[0], segs[0].p0[1] - sRes.pt[1]) > 0.5) {
      const s0 = segs[0];
      if (s0.type === "L") workSegs.push({ type: "L", p0: sRes.pt, p1: s0.p1 });
      else workSegs.push({ ...s0, p0: sRes.pt });
      for (let k = 1; k < segs.length; k++) workSegs.push(segs[k]);
    } else {
      for (const s of segs) workSegs.push(s);
    }
    const lastW = workSegs[workSegs.length - 1];
    if (Math.hypot(lastW.p1[0] - eRes.pt[0], lastW.p1[1] - eRes.pt[1]) > 0.5) {
      if (lastW.type === "L") lastW.p1 = eRes.pt;
      else workSegs.push({ type: "L", p0: lastW.p1, p1: eRes.pt });
    }

    const dense = [];
    let accLen = 0;
    for (const seg of workSegs) {
      const segLen = Math.hypot(seg.p1[0] - seg.p0[0], seg.p1[1] - seg.p0[1]);
      const steps = seg.type === "C" ? Math.max(24, Math.ceil(segLen / 4)) : Math.max(6, Math.ceil(segLen / 6));
      for (let k = (dense.length === 0 ? 0 : 1); k <= steps; k++) {
        const p = evalExactSeg(seg, k / steps);
        if (dense.length > 0) accLen += Math.hypot(p[0] - dense[dense.length - 1].x, p[1] - dense[dense.length - 1].y);
        dense.push({ x: p[0], y: p[1], s: accLen });
      }
    }
    const totalS = dense[dense.length - 1]?.s || 0;
    if (totalS < 20) return null;

    const sampleS = (s) => {
      let lo = 0, hi = dense.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (dense[mid].s <= s) lo = mid; else hi = mid;
      }
      const a = dense[lo], b = dense[hi], t = b.s === a.s ? 0 : (s - a.s) / (b.s - a.s);
      return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
    };

    const lockStart = Boolean(sRes.normal && arrowStart && arrowStart !== "dot");
    const lockEnd = Boolean(eRes.normal && arrowEnd && arrowEnd !== "dot");
    const m = Math.max(lockStart && lockEnd ? 5 : 4, Math.min(12, Math.round(totalS / 42)));
    const sStart = lockStart ? Math.min(14, totalS * 0.12) : 0;
    const sEnd = lockEnd ? totalS - Math.min(16, totalS * 0.12) : totalS;

    const sKnots = [];
    if (lockStart) sKnots.push(0, sStart); else sKnots.push(0);
    const midCount = m - (lockStart ? 1 : 0) - (lockEnd ? 1 : 0);
    for (let k = 1; k < midCount; k++) sKnots.push(sStart + ((sEnd - sStart) * k) / midCount);
    if (lockEnd) sKnots.push(sEnd, totalS); else sKnots.push(totalS);

    const sToU = (s) => {
      for (let k = 0; k < m; k++) if (s <= sKnots[k + 1] + 1e-6) return k + (s - sKnots[k]) / (sKnots[k + 1] - sKnots[k]);
      return m;
    };

    const p0 = [dense[0].x, dense[0].y], pm = [dense[dense.length - 1].x, dense[dense.length - 1].y];
    const fixedPts = new Map([[0, p0], [m, pm]]);
    if (lockStart) fixedPts.set(1, [p0[0] + sRes.normal[0] * sStart, p0[1] + sRes.normal[1] * sStart]);
    if (lockEnd) fixedPts.set(m - 1, [pm[0] + eRes.normal[0] * (totalS - sEnd), pm[1] + eRes.normal[1] * (totalS - sEnd)]);

    const freeIdx = [];
    for (let k = 0; k <= m; k++) if (!fixedPts.has(k)) freeIdx.push(k);
    const idxToFree = new Map(freeIdx.map((k, idx) => [k, idx]));
    const freeCount = freeIdx.length;
    if (freeCount === 0) {
      return Array.from({ length: m + 1 }, (_, k) => {
        const fp = fixedPts.get(k);
        return [+fp[0].toFixed(2), +fp[1].toFixed(2)];
      });
    }

    const ATA = Array.from({ length: freeCount }, () => new Array(freeCount).fill(0));
    const ATbx = new Array(freeCount).fill(0), ATby = new Array(freeCount).fill(0);
    const nSamples = Math.max(48, m * 8);
    for (let j = 0; j <= nSamples; j++) {
      const s = (totalS * j) / nSamples;
      const [qx, qy] = sampleS(s);
      const w = crBasisWeights(m, sToU(s));
      let rx = qx, ry = qy;
      for (const [fi, fp] of fixedPts) { rx -= w[fi] * fp[0]; ry -= w[fi] * fp[1]; }
      for (let a = 0; a < freeCount; a++) {
        const wa = w[freeIdx[a]];
        ATbx[a] += wa * rx; ATby[a] += wa * ry;
        for (let b = 0; b < freeCount; b++) ATA[a][b] += wa * w[freeIdx[b]];
      }
    }

    const lambda = 0.04;
    for (let k = 1; k <= m - 1; k++) {
      const stencil = [[k - 1, 1], [k, -2], [k + 1, 1]];
      let rFixedX = 0, rFixedY = 0;
      for (const [idx, coeff] of stencil) {
        if (fixedPts.has(idx)) {
          const fp = fixedPts.get(idx);
          rFixedX -= coeff * fp[0]; rFixedY -= coeff * fp[1];
        }
      }
      for (const [ia, ca] of stencil) {
        if (!idxToFree.has(ia)) continue;
        const fa = idxToFree.get(ia);
        ATbx[fa] += lambda * ca * rFixedX; ATby[fa] += lambda * ca * rFixedY;
        for (const [ib, cb] of stencil) {
          if (idxToFree.has(ib)) ATA[fa][idxToFree.get(ib)] += lambda * ca * cb;
        }
      }
    }

    const solX = solveLinearSystem(ATA, ATbx), solY = solveLinearSystem(ATA, ATby);
    return Array.from({ length: m + 1 }, (_, k) => {
      if (fixedPts.has(k)) {
        const fp = fixedPts.get(k);
        return [+fp[0].toFixed(2), +fp[1].toFixed(2)];
      }
      const fi = idxToFree.get(k);
      return [+solX[fi].toFixed(2), +solY[fi].toFixed(2)];
    });
  };

  const edges = [];
  for (const { el, tx, ty } of findAll(svg, e => hasClass(e, "pele-edge"))) {
    const id = el.attrs["data-id"] || `edge_${edges.length}`;
    const mainPath = el.children.find(c => c.tag === "path" && !hasClass(c, "pele-marker"));
    if (!mainPath) continue;

    const sem = semanticEdges.get(id) || {};
    const label = edgeLabelMap.get(id) || (sem.text ? { text: sem.text } : null);
    const edgeStyle = extractElStyle(mainPath);
    const dashed = Boolean(mainPath.attrs["stroke-dasharray"] || edgeStyle.dashed || sem.dashed);
    const markers = el.children.filter(c => hasClass(c, "pele-marker"));

    let arrowStart = sem.arrowStart ?? null;
    let arrowEnd = sem.arrowEnd ?? (markers.length > 0 ? "arrow" : null);
    if (sem.edgeType === "arrow_open") arrowEnd = null;
    if (sem.edgeType === "double_arrow_point") {
      arrowStart = "arrow";
      arrowEnd = "arrow";
    }

    const fromNode = nodeById.get(sem.from), toNode = nodeById.get(sem.to);
    const fitted = fitCatmullRomToSvg(mainPath.attrs.d, tx, ty, fromNode, toNode, arrowStart, arrowEnd);
    let points, hasCurve;
    if (fitted) {
      points = fitted;
      hasCurve = true;
    } else {
      const parsed = parseSvgPath(mainPath.attrs.d, tx, ty);
      if (parsed.points.length < 2) continue;
      points = snapEdgeEndpoints(parsed.points, fromNode, toNode);
      hasCurve = parsed.hasCurve;
    }

    edges.push({
      id,
      from: sem.from || null,
      to: sem.to || null,
      points,
      hasCurve,
      dashed,
      arrowStart,
      arrowEnd,
      label,
      ...(Object.keys(edgeStyle).length ? { style: edgeStyle } : {})
    });
  }

  const cardinalities = [];
  for (const { el, tx, ty } of findAll(svg, e => hasClass(e, "pele-cardinality"))) {
    if (el.tag !== "text") continue;
    const text = collectText(el).trim();
    if (!text) continue;
    const w = Math.ceil(cjkMeasurer.width(text, 12, 0) + 6);
    const h = 16;
    const cx = tx + (parseFloat(el.attrs.x) || 0);
    const by = ty + (parseFloat(el.attrs.y) || 0);
    cardinalities.push({
      text,
      x: +(cx - w / 2).toFixed(2),
      y: +(by - 12).toFixed(2),
      w,
      h
    });
  }

  return {
    meta: {
      type: rendered.type,
      mermaidType: rendered.mermaidType,
      width: rendered.width,
      height: rendered.height
    },
    clusters,
    nodes,
    edges,
    cardinalities,
    svg: options.includeSvg ? rendered.svg : undefined
  };
}
