import { createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// VERIFY at implementation time: pick a working RAFT-small INT8 ONNX export.
// PINTO model zoo is the planned source. If unavailable, self-export and host.
const MODEL_URL = process.env.UIPE_FLOW_MODEL_URL ?? 'REPLACE_WITH_VERIFIED_URL';
const EXPECTED_SHA256 = process.env.UIPE_FLOW_MODEL_SHA256 ?? 'REPLACE_WITH_VERIFIED_SHA';
const TARGET = resolve(REPO_ROOT, 'crates/uipe-vision/models/raft-small-int8.onnx');

async function sha256(path: string): Promise<string> {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function main(): Promise<void> {
  if (existsSync(TARGET)) {
    const actual = await sha256(TARGET);
    if (actual === EXPECTED_SHA256) {
      console.log(`Model already present and checksum matches: ${TARGET}`);
      return;
    }
    console.log(`Checksum mismatch (${actual} != ${EXPECTED_SHA256}); re-downloading.`);
  }

  await mkdir(dirname(TARGET), { recursive: true });
  console.log(`Downloading ${MODEL_URL}`);
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(TARGET));

  const actual = await sha256(TARGET);
  if (actual !== EXPECTED_SHA256) {
    throw new Error(`Checksum mismatch after download: ${actual} != ${EXPECTED_SHA256}`);
  }

  const size = statSync(TARGET).size;
  console.log(`Downloaded ${size} bytes to ${TARGET}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
