import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SceneGraph } from '../../types/scene-graph.js';
import type { SiteMapJSON } from '../sitemap/sitemap.js';
import type { Clip, RejectReason } from '../types.js';

export interface ClipAssets {
  frames: Buffer[];
  keyframes: Buffer[];
  beforePng: Buffer;
  afterPng: Buffer;
  beforeScene: SceneGraph;
  afterScene: SceneGraph;
}

export interface ClipStore {
  runDir(runId: string): string;
  saveClip(clip: Clip, assets: ClipAssets): Promise<Clip>;
  saveRejected(runId: string, episodeId: string, reason: RejectReason, keyframe: Buffer | null): Promise<void>;
  addOccurrence(runId: string, clipId: string, occ: Clip['occurrences'][number]): Promise<void>;
  saveSiteMap(runId: string, map: SiteMapJSON): Promise<void>;
  listClips(runId: string): Promise<Clip[]>;
}

export function datasetRoot(): string {
  return process.env.UIPE_DATASET_DIR || join(homedir(), '.uipe', 'dataset');
}

// Ids become path segments; refuse anything that could climb out of the run dir.
const SAFE_ID = /^[\w.-]+$/;
function safe(id: string): string {
  if (!SAFE_ID.test(id) || id === '.' || id === '..') throw new Error(`unsafe dataset id: ${JSON.stringify(id)}`);
  return id;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

export class LocalClipStore implements ClipStore {
  constructor(private readonly root: string = datasetRoot()) {}

  runDir(runId: string): string {
    return join(this.root, 'runs', safe(runId));
  }

  private clipDir(runId: string, clipId: string): string {
    return join(this.runDir(runId), 'clips', safe(clipId));
  }

  async saveClip(clip: Clip, a: ClipAssets): Promise<Clip> {
    const dir = this.clipDir(clip.runId, clip.id);
    await mkdir(join(dir, 'frames'), { recursive: true });
    await mkdir(join(dir, 'keyframes'), { recursive: true });
    const frames = a.frames.map((_, i) => `frames/${String(i).padStart(4, '0')}.jpg`);
    const keyframes = a.keyframes.map((_, i) => `keyframes/${String(i).padStart(2, '0')}.png`);
    const files: Clip['files'] = {
      frames, keyframes, beforePng: 'before.png', afterPng: 'after.png', beforeScene: 'before-scene.json', afterScene: 'after-scene.json',
    };
    await Promise.all([
      ...a.frames.map((b, i) => writeFile(join(dir, frames[i]), b)),
      ...a.keyframes.map((b, i) => writeFile(join(dir, keyframes[i]), b)),
      writeFile(join(dir, files.beforePng), a.beforePng),
      writeFile(join(dir, files.afterPng), a.afterPng),
      writeFile(join(dir, files.beforeScene), json(a.beforeScene)),
      writeFile(join(dir, files.afterScene), json(a.afterScene)),
    ]);
    const saved = { ...clip, files };
    // clip.json last: its presence marks a complete clip.
    await writeFile(join(dir, 'clip.json'), json(saved));
    return saved;
  }

  async saveRejected(runId: string, episodeId: string, reason: RejectReason, keyframe: Buffer | null): Promise<void> {
    const dir = join(this.runDir(runId), 'rejected');
    const base = join(dir, safe(episodeId));
    await mkdir(dir, { recursive: true });
    await writeFile(`${base}.json`, json({ episodeId, reason }));
    if (keyframe) await writeFile(`${base}.png`, keyframe);
  }

  async addOccurrence(runId: string, clipId: string, occ: Clip['occurrences'][number]): Promise<void> {
    // ponytail: read-modify-write, safe only because one recorder owns a run dir
    const path = join(this.clipDir(runId, clipId), 'clip.json');
    const clip = JSON.parse(await readFile(path, 'utf8')) as Clip;
    await writeFile(path, json({ ...clip, occurrences: [...clip.occurrences, occ] }));
  }

  async saveSiteMap(runId: string, map: SiteMapJSON): Promise<void> {
    await mkdir(this.runDir(runId), { recursive: true });
    await writeFile(join(this.runDir(runId), 'sitemap.json'), json(map));
  }

  async listClips(runId: string): Promise<Clip[]> {
    const dir = join(this.runDir(runId), 'clips');
    const ids = await readdir(dir).catch(() => [] as string[]);
    const clips = await Promise.all(ids.sort().map(async (id) => {
      try {
        return JSON.parse(await readFile(join(dir, id, 'clip.json'), 'utf8')) as Clip;
      } catch {
        return null; // missing or truncated clip.json: an interrupted save
      }
    }));
    return clips.filter((c): c is Clip => c !== null);
  }
}
