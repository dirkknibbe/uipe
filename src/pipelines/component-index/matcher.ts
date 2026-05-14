import { classifyByRules } from './classifier.js';
import type { ClassificationQueue } from './queue.js';
import type { ComponentIndexStore } from './store.js';
import type { ComponentField, ComponentIndex, IndexedComponent } from './types.js';
import type { StructuralNode } from '../../types/index.js';

export interface MatcherOptions {
  store: ComponentIndexStore;
  queue: ClassificationQueue;
}

export interface LookupArgs {
  node: StructuralNode;
  signature: string;
  origin: string;
}

interface RunState {
  origin: string;
  index: ComponentIndex;
  dirty: boolean;
  hits: number;
  misses: number;
}

/**
 * Read path for the component index.
 *
 * Lifecycle: caller invokes beginRun(origin) once per traversal, calls
 * lookup(...) for every qualifying node, then endRun(origin) to flush any
 * mutations to disk. Stats (hits/misses) are exposed via runStats() between
 * begin/end.
 */
export class Matcher {
  private store: ComponentIndexStore;
  private queue: ClassificationQueue;
  private run: RunState | null = null;

  constructor(opts: MatcherOptions) {
    this.store = opts.store;
    this.queue = opts.queue;
  }

  async beginRun(origin: string): Promise<void> {
    const index = await this.store.load(origin);
    this.run = { origin, index, dirty: false, hits: 0, misses: 0 };
  }

  lookup(args: LookupArgs): ComponentField {
    if (!this.run) throw new Error('Matcher.lookup called outside of beginRun/endRun');
    const { node, signature, origin } = args;
    if (this.run.origin !== origin) throw new Error(`Matcher origin mismatch: run=${this.run.origin}, lookup=${origin}`);

    const now = new Date().toISOString();
    const cached = this.run.index.entries[signature];

    if (cached) {
      cached.lastSeen = now;
      cached.occurrences += 1;
      this.run.dirty = true;
      this.run.hits += 1;
      return { name: cached.classification, source: classificationSourceToField(cached.classificationSource), signature };
    }

    this.run.misses += 1;

    const ruleHit = classifyByRules(node);
    if (ruleHit !== null) {
      const entry: IndexedComponent = {
        signature,
        classification: ruleHit,
        classificationSource: 'rules',
        firstSeen: now,
        lastSeen: now,
        occurrences: 1,
        domSample: '', // outerHTML not yet plumbed from the structural pipeline; left empty intentionally
        source: 'first-traversal',
      };
      this.run.index.entries[signature] = entry;
      this.run.dirty = true;
      return { name: ruleHit, source: 'rules', signature };
    }

    // VLM tier: enqueue for out-of-band classification. No store mutation now.
    this.queue.enqueue({
      origin,
      signature,
      html: '', // outerHTML not yet plumbed from the structural extractor; the VLM gets the screenshot crop
      bbox: { x: node.boundingBox.x, y: node.boundingBox.y, w: node.boundingBox.width, h: node.boundingBox.height },
    });
    return { name: null, status: 'pending', signature };
  }

  runStats(): { hits: number; misses: number } {
    if (!this.run) return { hits: 0, misses: 0 };
    return { hits: this.run.hits, misses: this.run.misses };
  }

  async endRun(origin: string): Promise<void> {
    if (!this.run) return;
    if (this.run.origin !== origin) throw new Error(`Matcher origin mismatch on endRun`);
    const { dirty, index } = this.run;
    this.run = null;
    if (dirty) await this.store.save(origin, index);
  }
}

function classificationSourceToField(s: IndexedComponent['classificationSource']): 'rules' | 'vlm' {
  return s;
}
