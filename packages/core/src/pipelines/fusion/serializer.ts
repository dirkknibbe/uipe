import type { SceneGraph, SceneNode } from '../../types/index.js';

export function toJSON(graph: SceneGraph): string {
  return JSON.stringify(graph, null, 2);
}

// SVG shape primitives carry no user-facing semantics on their own. When they
// appear as children of an <svg> we already stop recursing; when they appear
// as orphans at the top level (a known fusion-pipeline quirk — see
// CLAUDE.md "toCompact silently omits visual-only orphan nodes") we skip them
// here so they don't pollute the output.
const SVG_INTERNAL_TAGS = new Set([
  'path', 'rect', 'circle', 'g', 'polygon', 'line', 'ellipse', 'defs', 'use', 'symbol',
]);

// Elements that carry no visual/interactive meaning for a perception layer.
const NON_VISUAL_TAGS = new Set(['head', 'script', 'style', 'template', 'noscript']);

// A generic wrapper we can skip when it has exactly one child and no
// semantics of its own. Saves enormous space on Tailwind/Next.js markup
// where 4-8 nested `div`s typically wrap a single semantic element.
function isCollapsibleWrapper(node: SceneNode): boolean {
  return (
    node.role === 'element' &&
    node.interactionType === 'static' &&
    !node.isDisabled &&
    !node.text &&
    node.children.length === 1
  );
}

export function toCompact(graph: SceneGraph): string {
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const lines: string[] = [];

  function shouldSkip(n: SceneNode): boolean {
    // Check both tag and label — the fusion pipeline sometimes sets tag to
    // a generic value ('element') while preserving the real element name in
    // label, so orphaned <path> nodes would slip past a tag-only check.
    if (SVG_INTERNAL_TAGS.has(n.tag) || SVG_INTERNAL_TAGS.has(n.label)) return true;
    // Skip <head>, <script>, <template>, <style>, <noscript>. Irrelevant to a
    // perception layer — on content-light pages Next.js hydration payloads
    // leaking through __next_f scripts dominated the output.
    if (NON_VISUAL_TAGS.has(n.tag) || NON_VISUAL_TAGS.has(n.label)) return true;
    return false;
  }

  function renderNode(node: SceneNode, depth: number): void {
    if (shouldSkip(node)) return;

    // Collapse single-child wrapper chains: <div><div><div><button/></div></div></div> → <button/>
    let current = node;
    while (isCollapsibleWrapper(current)) {
      const child = nodeMap.get(current.children[0]);
      if (!child) break;
      current = child;
    }

    // Re-check after collapse: a wrapper <div> might have collapsed down to
    // an orphan <path> or a <script>, which we still want to skip.
    if (shouldSkip(current)) return;

    const indent = '  '.repeat(depth);
    const parts: string[] = [`${current.label}[${current.role}`];
    if (current.interactionType !== 'static') parts[0] += `,${current.interactionType}`;
    if (current.isDisabled) parts[0] += ',disabled';
    parts[0] += ']';
    // Only emit text on leaf nodes. Non-leaves inherit concatenated descendant
    // text from the DOM scraper, which caused massive duplication (~8x) on any
    // real page — every ancestor repeated the same text preview.
    const isLeaf = current.children.length === 0;
    if (current.text && isLeaf) parts.push(`:"${current.text.slice(0, 40)}"`);
    lines.push(`${indent}${parts.join('')}`);

    // Don't recurse into SVG internals. An icon's path/rect/circle children
    // carry no user-facing semantics and balloon the output.
    if (current.tag === 'svg') return;

    for (const childId of current.children) {
      const child = nodeMap.get(childId);
      if (child) renderNode(child, depth + 1);
    }
  }

  for (const rootId of graph.rootNodeIds) {
    const root = nodeMap.get(rootId);
    if (root) renderNode(root, 0);
  }

  return lines.join('\n');
}
