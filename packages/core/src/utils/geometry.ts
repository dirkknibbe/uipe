import type { BoundingBox } from '../types/index.js';

export function boxArea(box: BoundingBox): number {
  return box.width * box.height;
}

export function boxIntersection(a: BoundingBox, b: BoundingBox): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

export function computeIoU(a: BoundingBox, b: BoundingBox): number {
  const intersection = boxIntersection(a, b);
  if (intersection === 0) return 0;
  const union = boxArea(a) + boxArea(b) - intersection;
  return intersection / union;
}

export function isPointInBox(point: { x: number; y: number }, box: BoundingBox): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

export function boxCenter(box: BoundingBox): { x: number; y: number } {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}
