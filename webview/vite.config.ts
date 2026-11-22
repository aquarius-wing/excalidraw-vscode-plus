import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const CJK_UNICODE_RANGE =
  "U+0020-007E, U+00A0-00FF, U+2000-206F, U+2E80-9FFF, U+F900-FAFF, U+FE30-FE4F, U+FF00-FFEF, U+3000-303F";

const EXTRA_FONT_FACES = {
  wenkai: `{uri:"./fonts/LXGWWenKaiLite-Subset.woff2",descriptors:{unicodeRange:"${CJK_UNICODE_RANGE}",weight:"400"}}`,
  serif: `{uri:"./fonts/NotoSerifSC-Subset.woff2",descriptors:{unicodeRange:"${CJK_UNICODE_RANGE}",weight:"100 900"}}`,
};

function replaceOnce(code: string, target: string, replacement: string, label: string): string {
  if (!code.includes(target)) {
    throw new Error(`[excalidraw-extra-fonts] anchor not found: ${label}`);
  }
  return code.replace(target, replacement);
}

/**
 * Registers two additional bundled Chinese fonts (LXGW WenKai & Noto Serif SC)
 * into @excalidraw/excalidraw's FONT_FAMILY, FONT_METADATA, and Fonts.init()
 * so they appear in Excalidraw's font picker and export cleanly.
 */
function excalidrawExtraFontsPlugin(): Plugin {
  return {
    name: "excalidraw-extra-fonts",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/");
      if (normalized.endsWith("/@excalidraw/excalidraw/dist/prod/chunk-K2UTITRG.js")) {
        let out = replaceOnce(
          code,
          '"Liberation Sans":9}',
          '"Liberation Sans":9,"LXGW WenKai":10,"Noto Serif SC":11}',
          "prod FONT_FAMILY"
        );
        out = replaceOnce(
          out,
          '[Ie["Liberation Sans"]]:{metrics:{unitsPerEm:2048,ascender:1854,descender:-434,lineHeight:1.15},serverSide:!0}',
          '[Ie["Liberation Sans"]]:{metrics:{unitsPerEm:2048,ascender:1854,descender:-434,lineHeight:1.15},serverSide:!0},' +
            '[Ie["LXGW WenKai"]]:{metrics:{unitsPerEm:1e3,ascender:928,descender:-256,lineHeight:1.3},icon:Nr},' +
            '[Ie["Noto Serif SC"]]:{metrics:{unitsPerEm:1e3,ascender:1151,descender:-286,lineHeight:1.3},icon:Cd}',
          "prod FONT_METADATA"
        );
        out = replaceOnce(
          out,
          'n("Virgil",...yc)',
          `n("Virgil",...yc),n("LXGW WenKai",${EXTRA_FONT_FACES.wenkai}),n("Noto Serif SC",${EXTRA_FONT_FACES.serif})`,
          "prod Fonts.init"
        );
        return { code: out, map: null };
      }

      if (normalized.endsWith("/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js")) {
        let out = replaceOnce(
          code,
          '  "Liberation Sans": 9\n};',
          '  "Liberation Sans": 9,\n  "LXGW WenKai": 10,\n  "Noto Serif SC": 11\n};',
          "dev FONT_FAMILY"
        );
        out = replaceOnce(
          out,
          '  [FONT_FAMILY["Liberation Sans"]]: {\n    metrics: {\n      unitsPerEm: 2048,\n      ascender: 1854,\n      descender: -434,\n      lineHeight: 1.15\n    },\n    serverSide: true\n  },',
          '  [FONT_FAMILY["Liberation Sans"]]: {\n    metrics: {\n      unitsPerEm: 2048,\n      ascender: 1854,\n      descender: -434,\n      lineHeight: 1.15\n    },\n    serverSide: true\n  },\n' +
            '  [FONT_FAMILY["LXGW WenKai"]]: {\n    metrics: {\n      unitsPerEm: 1e3,\n      ascender: 928,\n      descender: -256,\n      lineHeight: 1.3\n    },\n    icon: FreedrawIcon\n  },\n' +
            '  [FONT_FAMILY["Noto Serif SC"]]: {\n    metrics: {\n      unitsPerEm: 1e3,\n      ascender: 1151,\n      descender: -286,\n      lineHeight: 1.3\n    },\n    icon: FontFamilyHeadingIcon\n  },',
          "dev FONT_METADATA"
        );
        out = replaceOnce(
          out,
          'init("Virgil", ...VirgilFontFaces);',
          `init("Virgil", ...VirgilFontFaces);\n    init("LXGW WenKai", ${EXTRA_FONT_FACES.wenkai});\n    init("Noto Serif SC", ${EXTRA_FONT_FACES.serif});`,
          "dev Fonts.init"
        );
        return { code: out, map: null };
      }
      return null;
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  optimizeDeps: {
    exclude: ["@excalidraw/excalidraw"],
  },
  plugins: [react(), excalidrawExtraFontsPlugin()],
});
