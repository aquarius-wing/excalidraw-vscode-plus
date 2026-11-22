export function mermaidToLayoutIR(source: string, opts?: { includeSvg?: boolean }): {
  meta: { type: string; mermaidType: string; width: number; height: number };
  clusters: any[];
  nodes: any[];
  edges: any[];
  cardinalities?: any[];
  svg?: string;
};
