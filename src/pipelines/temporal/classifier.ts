import type { SceneGraph, SceneGraphDiff, TransitionType } from '../../types/index.js';

export function classifyTransition(
  diff: SceneGraphDiff,
  prev: SceneGraph,
  next: SceneGraph,
): TransitionType {
  // 1. Navigation: URL changed
  if (prev.url !== next.url) return 'navigation';

  // 2. Scroll reveal: position off-screen → visible, no structural changes
  const hasScrollReveal = diff.modified.some(m =>
    m.changes.some(c =>
      c.field === 'viewportPosition' &&
      (c.from === 'above' || c.from === 'below') &&
      c.to === 'visible',
    ),
  );
  if (hasScrollReveal && diff.added.length === 0 && diff.removed.length === 0) return 'scroll_reveal';

  // 3. Form feedback: visual error state change
  const hasErrorChange = diff.modified.some(m =>
    m.changes.some(c => c.field === 'visualState' && (c.to === 'error' || c.from === 'error')),
  );
  if (hasErrorChange) return 'form_feedback';

  // 4. Modal open: new root-level node with children
  const newRootWithChildren = diff.added.find(n => !n.parent && n.children.length > 0);
  if (newRootWithChildren) return 'modal_open';

  // 5. Modal close: root-level node disappears
  const nextRootIds = new Set(next.rootNodeIds);
  const removedRoot = diff.removed.find(n => !n.parent && !nextRootIds.has(n.id));
  if (removedRoot) return 'modal_close';

  // 6. Expand/collapse: adds OR removes all under a single parent
  const changedNodes = diff.added.length > 0 ? diff.added : diff.removed;
  if (changedNodes.length > 0 && (diff.added.length === 0 || diff.removed.length === 0)) {
    const parentIds = new Set(changedNodes.map(n => n.parent).filter(Boolean));
    if (parentIds.size === 1) return 'expand_collapse';
  }

  // 7. List updated: multiple items added/removed under different parents
  if (diff.added.length > 1 || diff.removed.length > 1) return 'list_updated';

  // Default
  return 'content_loaded';
}
