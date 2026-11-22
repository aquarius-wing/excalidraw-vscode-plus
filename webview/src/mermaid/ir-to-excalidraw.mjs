/**
 * LayoutIR -> Excalidraw JSON compiler.
 * Supports palettes, domain stereotypes (datastore, component, process, boundary),
 * node-arrow bindings, optional wrapping frame/legend, and .excalidraw v2 envelope.
 */

const PALETTES = {
  blue:   { stroke: "#1971c2", bg: "#e7f5ff", hdr: "#d0ebff", text: "#1864ab" },
  teal:   { stroke: "#0c8599", bg: "#e3fafc", hdr: "#c5f6fa", text: "#0b7285" },
  green:  { stroke: "#2f9e44", bg: "#ebfbee", hdr: "#d3f9d8", text: "#2b8a3e" },
  amber:  { stroke: "#e67700", bg: "#fff9db", hdr: "#fff3bf", text: "#d9480f" },
  orange: { stroke: "#e8590c", bg: "#fff4e6", hdr: "#ffe8cc", text: "#d9480f" },
  pink:   { stroke: "#c2255c", bg: "#fff0f6", hdr: "#ffdeeb", text: "#a61e4d" },
  violet: { stroke: "#6741d9", bg: "#f3f0ff", hdr: "#e5dbff", text: "#5f3dc4" },
  purple: { stroke: "#9c36b5", bg: "#f8f0fc", hdr: "#f3d9fa", text: "#862e9c" },
  indigo: { stroke: "#3b5bdb", bg: "#edf2ff", hdr: "#dbe4ff", text: "#364fc7" },
  gray:   { stroke: "#495057", bg: "#f1f3f5", hdr: "#e9ecef", text: "#212529" },
  red:    { stroke: "#e03131", bg: "#fff5f5", hdr: "#ffe3e3", text: "#c92a2a" },
  white:  { stroke: "#495057", bg: "#ffffff", hdr: "#f8f9fa", text: "#212529" },
  neutral:{ stroke: "#6c757d", bg: "#f8f9fa", hdr: "#e9ecef", text: "#212529" }
};

function sanitizeId(s) {
  return String(s || "item").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function resolvePalette(nameOrObj, fallback = "blue") {
  if (!nameOrObj) return PALETTES[fallback] || PALETTES.blue;
  if (typeof nameOrObj === "string") return PALETTES[nameOrObj] || PALETTES[fallback] || PALETTES.blue;
  return { ...PALETTES[fallback], ...nameOrObj };
}

function baseProps(id, type, x, y, width, height, frameId, seedRef, extra = {}) {
  const seed = seedRef.val++;
  return {
    id,
    type,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: frameId || null,
    roundness: null,
    seed,
    version: 1,
    versionNonce: seed * 7919,
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    ...extra
  };
}

function makeLine(id, x, y, points, frameId, seedRef, extra = {}) {
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  return baseProps(
    id,
    "line",
    x,
    y,
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    frameId,
    seedRef,
    {
      points,
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: null,
      ...extra
    }
  );
}

function makeText(id, x, y, width, height, text, frameId, seedRef, extra = {}) {
  return baseProps(id, "text", x, y, width, height, frameId, seedRef, {
    strokeWidth: 1,
    strokeColor: "#212529",
    text,
    originalText: text,
    fontSize: 14,
    fontFamily: 6,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.3,
    ...extra
  });
}

function attachComponentBadge(elems, idPrefix, x, y, w, strokeColor, frameId, groupIds, seedRef) {
  const bx = x + w - 26;
  const by = y + 10;
  elems.push(baseProps(idPrefix + "_ico", "rectangle", bx, by, 16, 18, frameId, seedRef, {
    strokeColor, backgroundColor: "#ffffff", strokeWidth: 1.5, groupIds
  }));
  elems.push(baseProps(idPrefix + "_t1", "rectangle", bx - 4, by + 3, 8, 4, frameId, seedRef, {
    strokeColor, backgroundColor: "#ffffff", strokeWidth: 1.5, groupIds
  }));
  elems.push(baseProps(idPrefix + "_t2", "rectangle", bx - 4, by + 11, 8, 4, frameId, seedRef, {
    strokeColor, backgroundColor: "#ffffff", strokeWidth: 1.5, groupIds
  }));
}

function compileDatastoreNode(elems, node, x, y, w, h, pal, skin, frameId, seedRef) {
  const idBase = skin._idPrefix;
  const gid = idBase + "_grp";
  const code = skin.code || node.id;
  const slotW = Math.min(46, Math.max(36, Math.round(w * 0.18)));

  const bg = baseProps(idBase, "rectangle", x, y, w, h, frameId, seedRef, {
    strokeColor: "transparent",
    backgroundColor: pal.bg,
    strokeWidth: 0,
    groupIds: [gid]
  });
  elems.push(bg);
  elems.push(makeLine(idBase + "_top", x, y, [[0, 0], [w, 0]], frameId, seedRef, { strokeColor: pal.stroke, groupIds: [gid] }));
  elems.push(makeLine(idBase + "_bot", x, y + h, [[0, 0], [w, 0]], frameId, seedRef, { strokeColor: pal.stroke, groupIds: [gid] }));
  elems.push(makeLine(idBase + "_left", x, y, [[0, 0], [0, h]], frameId, seedRef, { strokeColor: pal.stroke, groupIds: [gid] }));
  elems.push(makeLine(idBase + "_div", x + slotW, y, [[0, 0], [0, h]], frameId, seedRef, { strokeColor: pal.stroke, groupIds: [gid] }));

  elems.push(makeText(idBase + "_code", x + 4, y + Math.round(h / 2) - 10, slotW - 8, 20, code, frameId, seedRef, {
    strokeColor: pal.stroke, fontSize: 13.5, textAlign: "center", groupIds: [gid]
  }));

  const bodyText = skin.body || node.label;
  elems.push(makeText(idBase + "_txt", x + slotW + 10, y + 10, w - slotW - 18, h - 20, bodyText, frameId, seedRef, {
    strokeColor: "#212529", fontSize: 13, groupIds: [gid]
  }));
  return bg;
}

function compileClassOrEntityNode(elems, node, x, y, w, h, pal, skin, frameId, seedRef, scale) {
  const idBase = skin._idPrefix;
  const gid = idBase + "_grp";
  const hasDividers = Array.isArray(node.dividers) && node.dividers.length > 0;
  const firstDivY = hasDividers ? (node.dividers[0] - node.y) * scale : Math.min(46, Math.round(h * 0.34));

  const strokeWidth = node.style?.strokeWidth || 2;
  const card = baseProps(idBase, "rectangle", x, y, w, h, frameId, seedRef, {
    strokeColor: pal.stroke,
    strokeWidth,
    backgroundColor: node.style?.fill ? pal.bg : "#ffffff",
    roundness: null,
    groupIds: [gid]
  });
  elems.push(card);

  elems.push(baseProps(idBase + "_hdr", "rectangle", x, y, w, firstDivY, frameId, seedRef, {
    strokeColor: pal.stroke,
    strokeWidth,
    backgroundColor: pal.hdr,
    roundness: null,
    groupIds: [gid]
  }));

  const titleLines = [node.annotation, node.label].filter(Boolean).join("\n");
  elems.push(makeText(idBase + "_ttl", x + 8, y + 6, w - 16, Math.max(22, firstDivY - 10), titleLines, frameId, seedRef, {
    strokeColor: pal.text,
    fontSize: 13.5,
    textAlign: "center",
    groupIds: [gid]
  }));

  const bodyTextColor = node.style?.textColor || "#212529";
  if (node.shape === "class") {
    const secondDivY = node.dividers.length > 1 ? (node.dividers[1] - node.y) * scale : firstDivY + Math.round((h - firstDivY) * 0.48);
    if (node.attributes.length > 0) {
      elems.push(makeText(idBase + "_attr", x + 10, y + firstDivY + 7, w - 20, Math.max(20, secondDivY - firstDivY - 12), node.attributes.join("\n"), frameId, seedRef, {
        strokeColor: bodyTextColor, fontSize: 12.5, groupIds: [gid]
      }));
    }
    if (node.dividers.length > 1) {
      elems.push(makeLine(idBase + "_sep2", x, y + secondDivY, [[0, 0], [w, 0]], frameId, seedRef, {
        strokeColor: pal.stroke, strokeWidth: 1.5, groupIds: [gid]
      }));
    }
    if (node.methods.length > 0) {
      elems.push(makeText(idBase + "_meth", x + 10, y + secondDivY + 7, w - 20, Math.max(20, h - secondDivY - 12), node.methods.join("\n"), frameId, seedRef, {
        strokeColor: pal.text, fontSize: 12.5, groupIds: [gid]
      }));
    }
  } else {
    const rowsText = node.erRows.length > 0 ? node.erRows.join("\n") : "";
    if (rowsText) {
      elems.push(makeText(idBase + "_rows", x + 10, y + firstDivY + 7, w - 20, Math.max(20, h - firstDivY - 12), rowsText, frameId, seedRef, {
        strokeColor: bodyTextColor, fontSize: 12.5, groupIds: [gid]
      }));
    }
  }
  return card;
}

function compileStandardNode(elems, node, x, y, w, h, pal, skin, frameId, seedRef) {
  const idBase = skin._idPrefix;
  const gid = idBase + "_grp";
  const stereo = skin.stereotype || null;

  let exType = "rectangle";
  let roundness = node.shape === "round" || stereo === "process" || stereo === "component" ? { type: 3 } : null;
  if (node.shape === "diamond") {
    exType = "diamond";
    roundness = null;
  } else if (node.shape === "ellipse") {
    exType = "ellipse";
    roundness = null;
  }

  const strokeStyle = skin.borderStyle || (node.style?.dashed ? "dashed" : node.shape === "note" ? "dashed" : "solid");
  const shapeEl = baseProps(idBase, exType, x, y, w, h, frameId, seedRef, {
    strokeColor: pal.stroke,
    strokeWidth: node.style?.strokeWidth || (node.shape === "note" ? 1.5 : 2),
    backgroundColor: pal.bg,
    strokeStyle,
    roundness: node.shape === "note" ? { type: 3 } : roundness,
    groupIds: [gid]
  });
  elems.push(shapeEl);

  if (stereo === "component") {
    attachComponentBadge(elems, idBase, x, y, w, pal.stroke, frameId, [gid], seedRef);
  }

  if (stereo === "process") {
    const divY = Math.min(Math.max(36, Math.round(h * 0.28)), h - 24);
    elems.push(makeLine(idBase + "_pdiv", x + 1, y + divY, [[0, 0], [w - 2, 0]], frameId, seedRef, {
      strokeColor: pal.stroke, strokeWidth: 1.5, groupIds: [gid]
    }));
    const rawLines = (skin.body || node.label).split("\n");
    const headerTxt = skin.title || rawLines[0] || "";
    const bodyTxt = skin.title ? (skin.body || node.label) : rawLines.slice(1).join("\n");
    elems.push(makeText(idBase + "_pttl", x + 10, y + 7, w - 20, divY - 10, headerTxt, frameId, seedRef, {
      strokeColor: pal.text, fontSize: 13.5, textAlign: "center", groupIds: [gid]
    }));
    if (bodyTxt) {
      elems.push(makeText(idBase + "_pbody", x + 10, y + divY + 6, w - 20, h - divY - 12, bodyTxt, frameId, seedRef, {
        strokeColor: "#343a40", fontSize: 12.5, textAlign: "center", groupIds: [gid]
      }));
    }
    return shapeEl;
  }

  const displayLabel = [skin.badge, skin.body || node.label].filter(Boolean).join("\n");
  const linesCount = displayLabel.split("\n").length;
  const textH = Math.max(20, linesCount * 19);
  const ty = y + Math.max(6, Math.round((h - textH) / 2));
  const padX = stereo === "component" ? 12 : 8;
  const badgeReserve = stereo === "component" ? 18 : 0;
  elems.push(makeText(idBase + "_lbl", x + padX, ty, Math.max(30, w - padX * 2 - badgeReserve), textH, displayLabel, frameId, seedRef, {
    strokeColor: node.style?.textColor || pal.text || "#212529",
    fontSize: 13.5,
    textAlign: stereo === "component" ? "left" : "center",
    groupIds: [gid]
  }));

  return shapeEl;
}

/**
 * Compile a LayoutIR into Excalidraw elements (plus optional frame, legend, and v2 envelope).
 */
export function compileLayoutToExcalidraw(ir, opts = {}) {
  const skinRoot = opts.skin || {};
  const nodeSkins = skinRoot.nodes || {};
  const clusterSkins = skinRoot.clusters || {};
  const edgeSkins = skinRoot.edges || {};

  const scale = opts.scale ?? 1.25;
  const [ox, oy] = opts.origin ?? [0, 0];
  const prefix = opts.prefix || ("diag_" + Date.now().toString(36));
  const seedRef = { val: opts.seedStart ?? 100001 };

  const padX = opts.paddingX ?? 36;
  const headerH = (opts.subtitle ? 36 : 0) + (opts.frame ? 24 : 0);
  const legendLines = opts.legend ? String(opts.legend).split("\n").length : 0;
  const legendH = opts.legend ? Math.max(48, legendLines * 20 + 28) : 0;

  const contentW = Math.round(ir.meta.width * scale);
  const contentH = Math.round(ir.meta.height * scale);
  const frameW = contentW + padX * 2;
  const frameH = headerH + contentH + (legendH ? legendH + 26 : 0) + 28;

  const contentOx = ox + padX;
  const contentOy = oy + headerH;

  const elems = [];
  let frameId = null;

  if (opts.frame) {
    frameId = prefix + "_frame";
    elems.push(baseProps(frameId, "frame", ox, oy, frameW, frameH, null, seedRef, {
      name: opts.frame,
      strokeColor: "#1e1e1e"
    }));
  }

  if (opts.subtitle) {
    elems.push(makeText(prefix + "_subtitle", ox + padX, oy + 18, frameW - padX * 2, 24, opts.subtitle, frameId, seedRef, {
      strokeColor: "#495057", fontSize: 14.5
    }));
  }

  // 1) Clusters / subgraphs
  for (const c of ir.clusters) {
    const cSkin = clusterSkins[c.id] || {};
    const basePal = resolvePalette(cSkin.palette, cSkin.stereotype === "boundary" ? "red" : "gray");
    const pal = c.style && !cSkin.palette
      ? {
          stroke: c.style.stroke || basePal.stroke,
          bg: c.style.fill || basePal.bg,
          hdr: c.style.fill || basePal.hdr,
          text: c.style.textColor || basePal.text
        }
      : basePal;
    const cx = contentOx + c.x * scale;
    const cy = contentOy + c.y * scale;
    const cw = c.w * scale;
    const ch = c.h * scale;
    const cid = prefix + "_cl_" + sanitizeId(c.id);

    elems.push(baseProps(cid, "rectangle", cx, cy, cw, ch, frameId, seedRef, {
      strokeColor: pal.stroke,
      backgroundColor: pal.bg,
      strokeWidth: c.style?.strokeWidth || 1.5,
      strokeStyle: "dashed",
      opacity: cSkin.opacity ?? 65,
      roundness: { type: 3 }
    }));

    if (c.label || cSkin.label) {
      elems.push(makeText(cid + "_lbl", cx + 12, cy + 8, Math.max(80, cw - 24), 22, cSkin.label || c.label, frameId, seedRef, {
        strokeColor: pal.text, fontSize: 13.5
      }));
    }
  }

  // 2) Nodes
  const nodeShapeById = new Map();
  for (const node of ir.nodes) {
    const nSkin = nodeSkins[node.id] || {};
    const defaultPal = node.shape === "note" ? "amber" : (skinRoot.defaultPalette || "neutral");
    const basePal = resolvePalette(nSkin.palette, defaultPal);
    const pal = node.style && !nSkin.palette
      ? {
          stroke: node.style.stroke || basePal.stroke,
          bg: node.style.fill || basePal.bg,
          hdr: node.style.fill || basePal.hdr,
          text: node.style.textColor || basePal.text
        }
      : basePal;
    const nx = contentOx + node.x * scale;
    const ny = contentOy + node.y * scale;
    const nw = Math.max(nSkin.minWidth || 0, node.w * scale);
    const nh = Math.max(nSkin.minHeight || 0, node.h * scale);

    const skinCfg = { ...nSkin, _idPrefix: prefix + "_nd_" + sanitizeId(node.id) };
    let shapeEl;
    if (nSkin.stereotype === "datastore" || node.shape === "cylinder") {
      shapeEl = compileDatastoreNode(elems, node, nx, ny, nw, nh, resolvePalette(nSkin.palette, "amber"), skinCfg, frameId, seedRef);
    } else if (node.shape === "class" || node.shape === "entity") {
      shapeEl = compileClassOrEntityNode(elems, node, nx, ny, nw, nh, pal, skinCfg, frameId, seedRef, scale);
    } else {
      shapeEl = compileStandardNode(elems, node, nx, ny, nw, nh, pal, skinCfg, frameId, seedRef);
    }
    nodeShapeById.set(node.id, shapeEl);
  }

  // 3) Edges & labels
  for (const edge of ir.edges) {
    const eSkin = edgeSkins[edge.id] || edgeSkins[edge.from + "->" + edge.to] || {};
    const pal = resolvePalette(eSkin.palette, "gray");
    const strokeColor = eSkin.color || edge.style?.stroke || (eSkin.palette ? pal.stroke : "#495057");

    const absPts = edge.points.map(([px, py]) => [
      Math.round(contentOx + px * scale),
      Math.round(contentOy + py * scale)
    ]);
    const [sx, sy] = absPts[0];
    const relPts = absPts.map(([px, py]) => [px - sx, py - sy]);
    const xs = relPts.map(p => p[0]);
    const ys = relPts.map(p => p[1]);

    const eid = prefix + "_ed_" + sanitizeId(edge.id);
    const fromEl = edge.from ? nodeShapeById.get(edge.from) : null;
    const toEl = edge.to ? nodeShapeById.get(edge.to) : null;

    const arrowEl = baseProps(
      eid,
      "arrow",
      sx,
      sy,
      Math.max(1, Math.max(...xs) - Math.min(...xs)),
      Math.max(1, Math.max(...ys) - Math.min(...ys)),
      frameId,
      seedRef,
      {
        strokeColor,
        strokeStyle: edge.dashed ? "dashed" : "solid",
        roundness: edge.hasCurve && relPts.length >= 3 ? { type: 2 } : null,
        points: relPts,
        lastCommittedPoint: null,
        startBinding: fromEl ? { elementId: fromEl.id, focus: 0, gap: 4 } : null,
        endBinding: toEl ? { elementId: toEl.id, focus: 0, gap: 4 } : null,
        startArrowhead: edge.arrowStart || null,
        endArrowhead: edge.arrowEnd === undefined ? "arrow" : edge.arrowEnd
      }
    );
    elems.push(arrowEl);

    if (fromEl) fromEl.boundElements.push({ id: eid, type: "arrow" });
    if (toEl) toEl.boundElements.push({ id: eid, type: "arrow" });

    if (edge.label?.text) {
      const hasBox = typeof edge.label.x === "number" && typeof edge.label.y === "number";
      const mid = absPts[Math.floor(absPts.length / 2)];
      const lw = hasBox ? Math.max(44, Math.round(edge.label.w * scale) + 10) : Math.max(44, edge.label.text.length * 14);
      const lh = hasBox ? Math.max(20, Math.round(edge.label.h * scale)) : 22;
      const lx = hasBox ? Math.round(contentOx + edge.label.x * scale - 4) : mid[0] - Math.round(lw / 2);
      const ly = hasBox ? Math.round(contentOy + edge.label.y * scale - 2) : mid[1] - 14;

      elems.push(baseProps(eid + "_lbg", "rectangle", lx, ly, lw, lh, frameId, seedRef, {
        strokeColor: "#ffffff",
        backgroundColor: "#ffffff",
        opacity: 94,
        strokeWidth: 1,
        roundness: { type: 3 }
      }));
      elems.push(makeText(eid + "_lbl", lx + 2, ly + 1, lw - 4, lh - 2, edge.label.text, frameId, seedRef, {
        strokeColor,
        fontSize: 12.5,
        textAlign: "center"
      }));
    }
  }

  // 3b) Edge cardinalities (class/ER multiplicity labels)
  for (let i = 0; i < (ir.cardinalities || []).length; i++) {
    const c = ir.cardinalities[i];
    const cw = Math.max(20, Math.round(c.w * scale));
    const ch = Math.max(16, Math.round(c.h * scale));
    const cx = Math.round(contentOx + c.x * scale);
    const cy = Math.round(contentOy + c.y * scale);
    elems.push(makeText(prefix + "_card_" + i, cx, cy, cw, ch, c.text, frameId, seedRef, {
      strokeColor: "#495057",
      fontSize: 11.5,
      textAlign: "center"
    }));
  }

  // 4) Optional legend footer
  if (opts.legend) {
    const ly = contentOy + contentH + 18;
    elems.push(baseProps(prefix + "_legend_box", "rectangle", ox + padX, ly, frameW - padX * 2, legendH, frameId, seedRef, {
      strokeColor: "#adb5bd",
      backgroundColor: "#f8f9fa",
      strokeWidth: 1,
      strokeStyle: "dashed",
      roundness: { type: 3 }
    }));
    elems.push(makeText(prefix + "_legend_txt", ox + padX + 18, ly + 14, frameW - padX * 2 - 36, legendH - 24, opts.legend, frameId, seedRef, {
      strokeColor: "#495057",
      fontSize: 13
    }));
  }

  if (opts.envelope) {
    return {
      type: "excalidraw",
      version: 2,
      source: "pele-excalidraw-cli",
      elements: elems,
      appState: { viewBackgroundColor: "#ffffff" },
      files: {}
    };
  }
  return elems;
}
