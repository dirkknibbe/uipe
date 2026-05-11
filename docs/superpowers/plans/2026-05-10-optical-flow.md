# Optical Flow Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Rust optical-flow sidecar that emits motion events (`optical-flow-raw`, `optical-flow-region`, `optical-flow-motion`) onto the existing `TemporalEventStream`, queryable via the `get_timeline` MCP tool.

**Architecture:** New Cargo workspace member at `crates/uipe-vision/` runs RAFT-small INT8 ONNX via the `ort` crate, talks to TypeScript over stdin-length-prefixed PNGs and stdout newline-delimited JSON. New TS `FlowProducer` manages the subprocess and pHash-gates frames from the existing `FrameCapture`. New TS `FlowCollector` normalizes timestamps and pushes into the stream. No code changes to existing collectors or the stream's public API.

**Tech Stack:** Rust (`ort` v2.x, `image`, `ndarray`, `linfa-clustering`, `serde_json`), TypeScript ESM with NodeNext, vitest, Playwright (existing). ONNX Runtime native lib bundled via the `ort` crate's distribution helpers.

**Spec:** [`docs/superpowers/specs/2026-05-10-optical-flow-design.md`](../specs/2026-05-10-optical-flow-design.md)

---

## Prerequisites

Before starting Task 1, verify these external assumptions hold at implementation time. If any has drifted, adjust the corresponding task code; the *shape* of the plan stays the same.

1. **Rust toolchain** — `rustc --version` returns 1.70+ (workspace edition 2021)
2. **`ort` crate v2.x API** — `ort::Session::builder()`, `inputs!` macro, `tensor_value.try_extract_tensor::<f32>()`. Cross-check against https://docs.rs/ort
3. **RAFT-small ONNX export** — the planned source is PINTO model zoo (https://github.com/PINTO0309/PINTO_model_zoo). If unavailable, fall back to self-export from the original RAFT repo (https://github.com/princeton-vl/RAFT). The expected input is two RGB tensors of shape `[1, 3, H, W]` (typically 384×512 padded), output is a flow tensor of shape `[1, 2, H, W]`.
4. **INT8 quantization quality** — validate on the synthetic translation test (Task 5) before assuming INT8 is acceptable. If accuracy is unworkable, swap to fp16 or fp32 with the inference budget raised; document in the spec's open-question section.

---

## Plan Adjustments From Spec

The spec specified Git LFS for the ONNX model file. The plan instead uses a **download-on-build script** because the repo currently has no LFS setup and the install-time complexity isn't worth it for one ~20MB blob. The model file is `.gitignore`'d and fetched by `pnpm run setup:flow-model`. If LFS becomes desirable later, swapping is a small refactor.

The spec used dot-separated kind strings (`optical-flow.raw`). The plan uses **hyphen-separated** (`optical-flow-raw`) to match the existing `network-request` / `phash-change` convention in `src/pipelines/temporal/collectors/types.ts`.

---

## File Structure

### New files
- `Cargo.toml` (workspace root)
- `crates/uipe-vision/Cargo.toml`
- `crates/uipe-vision/src/main.rs` (entry point + stdin/stdout loop)
- `crates/uipe-vision/src/inference.rs` (ort session wrapper + RAFT inference)
- `crates/uipe-vision/src/image_io.rs` (PNG decode + preprocessing)
- `crates/uipe-vision/src/clustering.rs` (DBSCAN over flow vectors)
- `crates/uipe-vision/src/primitives.rs` (divergence/curl/mean velocity/variance)
- `crates/uipe-vision/src/classifier.rs` (pattern detection: translation/scale/rotation/stillness)
- `crates/uipe-vision/src/protocol.rs` (stdin frame reader + stdout ndjson writer + event types)
- `crates/uipe-vision/tests/integration_smoke.rs` (Rust integration test)
- `crates/uipe-vision/models/.gitkeep` (the ONNX file lands here, gitignored)
- `scripts/download-flow-model.ts` (model downloader)
- `src/pipelines/temporal/producers/optical-flow.ts` (TS FlowProducer)
- `src/pipelines/temporal/collectors/optical-flow.ts` (TS FlowCollector)
- `tests/unit/temporal/producers/optical-flow.test.ts`
- `tests/unit/temporal/collectors/optical-flow.test.ts`
- `tests/integration/optical-flow-pipeline.test.ts`
- `bench/optical-flow-eval.ts`

### Modified files
- `package.json` — new scripts: `build:rust`, `setup:flow-model`, `build` updated to include rust build
- `.gitignore` — add `target/`, `crates/uipe-vision/models/*.onnx`
- `src/pipelines/temporal/collectors/types.ts` — extend `EventType` union + add 3 payload types
- `src/mcp/server.ts` — register `FlowCollector` in `ensureStreamAttached`
- `DEVELOPMENT.md` — document Rust build and model setup commands
- `docs/architecture.md` — flip the "Optical flow" row in the Current implementation table

---

## Task 1: Cargo workspace + uipe-vision skeleton

**Files:**
- Create: `Cargo.toml`
- Create: `crates/uipe-vision/Cargo.toml`
- Create: `crates/uipe-vision/src/main.rs`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Create the workspace root `Cargo.toml`**

```toml
[workspace]
resolver = "2"
members = ["crates/uipe-vision"]

[workspace.package]
edition = "2021"
license = "MIT"
```

- [ ] **Step 2: Create `crates/uipe-vision/Cargo.toml`**

```toml
[package]
name = "uipe-vision"
version = "0.1.0"
edition.workspace = true
license.workspace = true

[[bin]]
name = "uipe-vision"
path = "src/main.rs"

[dependencies]
```

- [ ] **Step 3: Create `crates/uipe-vision/src/main.rs`**

```rust
fn main() {
    eprintln!("uipe-vision v{}", env!("CARGO_PKG_VERSION"));
}
```

- [ ] **Step 4: Append to `.gitignore`**

Add these lines at the end of the existing `.gitignore`:

```
target/
crates/uipe-vision/models/*.onnx
```

- [ ] **Step 5: Add `build:rust` script to `package.json`**

In the `"scripts"` block, add:

```json
"build:rust": "cargo build --release --bin uipe-vision",
```

- [ ] **Step 6: Build the workspace**

Run: `cargo build --release --bin uipe-vision`
Expected: compiles cleanly. Verify the binary exists: `ls target/release/uipe-vision`

- [ ] **Step 7: Run the binary**

Run: `./target/release/uipe-vision`
Expected: prints `uipe-vision v0.1.0` to stderr and exits 0.

- [ ] **Step 8: Commit**

```bash
git add Cargo.toml crates/uipe-vision .gitignore package.json
git commit -m "feat(vision): scaffold uipe-vision Rust workspace crate"
```

---

## Task 2: ONNX model download script

**Files:**
- Create: `scripts/download-flow-model.ts`
- Modify: `package.json`
- Create: `crates/uipe-vision/models/.gitkeep`

- [ ] **Step 1: Create `crates/uipe-vision/models/.gitkeep`**

Empty file so the models directory exists in git even when the ONNX is gitignored.

- [ ] **Step 2: Create `scripts/download-flow-model.ts`**

The exact model URL is TBD by the implementer based on Prerequisite #3 — search PINTO model zoo for `raft_small` and pick the INT8 quantized variant with input shape `[1, 3, 384, 512]` (or closest available). Replace `MODEL_URL` and `EXPECTED_SHA256` below before running.

```typescript
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
```

- [ ] **Step 3: Add `setup:flow-model` script to `package.json`**

```json
"setup:flow-model": "pnpm exec tsx scripts/download-flow-model.ts",
```

- [ ] **Step 4: Add `tsx` to devDependencies if not already present**

Run: `pnpm add -D tsx`
Expected: tsx added to package.json devDependencies.

- [ ] **Step 5: Verify the script runs (with placeholders, expect failure)**

Run: `pnpm run setup:flow-model`
Expected: errors with "REPLACE_WITH_VERIFIED_URL" or fetch failure. This proves the script is wired; it will succeed once the implementer fills in the real URL.

- [ ] **Step 6: Commit**

```bash
git add scripts/download-flow-model.ts package.json crates/uipe-vision/models/.gitkeep
git commit -m "feat(vision): add ONNX model download script (model URL TBD)"
```

---

## Task 3: ort dependency + load_model

**Files:**
- Modify: `crates/uipe-vision/Cargo.toml`
- Create: `crates/uipe-vision/src/inference.rs`
- Modify: `crates/uipe-vision/src/main.rs`

- [ ] **Step 1: Add `ort`, `anyhow`, and `thiserror` to `crates/uipe-vision/Cargo.toml`**

```toml
[dependencies]
ort = { version = "2.0.0-rc.4", default-features = false, features = ["ndarray", "download-binaries"] }
ndarray = "0.16"
anyhow = "1.0"
thiserror = "1.0"
```

Note: `ort` v2 is in release-candidate phase as of late 2025. Pin to the latest 2.0.0-rc.x available at implementation time. The `download-binaries` feature auto-fetches the ONNX Runtime shared library.

- [ ] **Step 2: Write the failing test for `load_model`**

Create `crates/uipe-vision/src/inference.rs`:

```rust
use anyhow::Result;
use ort::session::Session;
use std::path::Path;

pub fn load_model(path: impl AsRef<Path>) -> Result<Session> {
    let session = Session::builder()?
        .commit_from_file(path)?;
    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_model_fails_on_missing_file() {
        let result = load_model("/tmp/this-does-not-exist.onnx");
        assert!(result.is_err(), "expected error for missing model file");
    }
}
```

- [ ] **Step 3: Declare the module in `main.rs`**

Replace `crates/uipe-vision/src/main.rs` with:

```rust
mod inference;

fn main() {
    eprintln!("uipe-vision v{}", env!("CARGO_PKG_VERSION"));
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cargo test -p uipe-vision --lib load_model_fails_on_missing_file -- --nocapture`
Expected: PASS. (The test asserts on the *error* path — no actual ONNX file required.)

- [ ] **Step 5: Commit**

```bash
git add crates/uipe-vision/Cargo.toml crates/uipe-vision/src/inference.rs crates/uipe-vision/src/main.rs
git commit -m "feat(vision): add ort dependency + load_model function"
```

---

## Task 4: PNG decode + preprocessing

**Files:**
- Modify: `crates/uipe-vision/Cargo.toml`
- Create: `crates/uipe-vision/src/image_io.rs`
- Modify: `crates/uipe-vision/src/main.rs`

- [ ] **Step 1: Add `image` to Cargo.toml dependencies**

```toml
image = { version = "0.25", default-features = false, features = ["png"] }
```

- [ ] **Step 2: Write the failing test**

Create `crates/uipe-vision/src/image_io.rs`:

```rust
use anyhow::Result;
use image::{ImageBuffer, Rgb};
use ndarray::Array4;

pub struct DecodedFrame {
    pub width: u32,
    pub height: u32,
    pub rgb: ImageBuffer<Rgb<u8>, Vec<u8>>,
}

pub fn decode_png(bytes: &[u8]) -> Result<DecodedFrame> {
    let img = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)?;
    let rgb = img.to_rgb8();
    Ok(DecodedFrame {
        width: rgb.width(),
        height: rgb.height(),
        rgb,
    })
}

/// Convert an RGB frame to a normalized [1, 3, H, W] float tensor in (0, 1).
/// Resize via nearest-neighbor to (target_w, target_h) so timing stays predictable.
pub fn to_tensor(frame: &DecodedFrame, target_w: u32, target_h: u32) -> Array4<f32> {
    let resized = image::imageops::resize(
        &frame.rgb,
        target_w,
        target_h,
        image::imageops::FilterType::Triangle,
    );
    let mut arr = Array4::<f32>::zeros((1, 3, target_h as usize, target_w as usize));
    for (x, y, pixel) in resized.enumerate_pixels() {
        let [r, g, b] = pixel.0;
        arr[[0, 0, y as usize, x as usize]] = r as f32 / 255.0;
        arr[[0, 1, y as usize, x as usize]] = g as f32 / 255.0;
        arr[[0, 2, y as usize, x as usize]] = b as f32 / 255.0;
    }
    arr
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};
    use std::io::Cursor;

    fn make_test_png() -> Vec<u8> {
        let mut img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::new(4, 4);
        for (x, y, pixel) in img.enumerate_pixels_mut() {
            *pixel = Rgb([(x * 60) as u8, (y * 60) as u8, 0]);
        }
        let mut bytes = Vec::new();
        img.write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
            .unwrap();
        bytes
    }

    #[test]
    fn decode_png_round_trips_dimensions() {
        let bytes = make_test_png();
        let decoded = decode_png(&bytes).unwrap();
        assert_eq!(decoded.width, 4);
        assert_eq!(decoded.height, 4);
    }

    #[test]
    fn to_tensor_produces_normalized_values() {
        let bytes = make_test_png();
        let decoded = decode_png(&bytes).unwrap();
        let tensor = to_tensor(&decoded, 8, 8);
        assert_eq!(tensor.shape(), &[1, 3, 8, 8]);
        let max = tensor.iter().cloned().fold(0.0f32, f32::max);
        let min = tensor.iter().cloned().fold(1.0f32, f32::min);
        assert!(min >= 0.0 && max <= 1.0, "values must be in [0, 1] — got [{min}, {max}]");
    }
}
```

- [ ] **Step 3: Declare the module in `main.rs`**

```rust
mod image_io;
mod inference;

fn main() {
    eprintln!("uipe-vision v{}", env!("CARGO_PKG_VERSION"));
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `cargo test -p uipe-vision --lib image_io`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/uipe-vision/Cargo.toml crates/uipe-vision/src/image_io.rs crates/uipe-vision/src/main.rs
git commit -m "feat(vision): PNG decode + tensor preprocessing"
```

---

## Task 5: Run RAFT inference on a frame pair

**Files:**
- Modify: `crates/uipe-vision/src/inference.rs`

This task wires the loaded ONNX session to actual flow inference. **Prerequisite:** a working `raft-small-int8.onnx` file at `crates/uipe-vision/models/`. If `setup:flow-model` hasn't been finalized (Task 2 placeholder), use any small ONNX model that accepts two `[1, 3, H, W]` tensors to validate the wiring, and revisit once the real model is available.

- [ ] **Step 1: Extend `inference.rs` with `run_inference`**

Replace the file content with:

```rust
use anyhow::{Context, Result};
use ndarray::{Array4, Axis};
use ort::inputs;
use ort::session::Session;
use ort::value::Tensor;
use std::path::Path;

pub struct FlowField {
    pub width: usize,
    pub height: usize,
    pub vectors: Vec<f32>, // length = 2 * width * height, layout (vx0, vy0, vx1, vy1, ...)
}

impl FlowField {
    pub fn at(&self, x: usize, y: usize) -> (f32, f32) {
        let idx = (y * self.width + x) * 2;
        (self.vectors[idx], self.vectors[idx + 1])
    }
}

pub fn load_model(path: impl AsRef<Path>) -> Result<Session> {
    let session = Session::builder()?.commit_from_file(path)?;
    Ok(session)
}

/// Run RAFT inference on a pair of [1, 3, H, W] tensors.
/// Returns a FlowField with the model's native output resolution.
pub fn run_inference(
    session: &mut Session,
    frame_a: &Array4<f32>,
    frame_b: &Array4<f32>,
) -> Result<FlowField> {
    let input_a = Tensor::from_array(frame_a.view())?;
    let input_b = Tensor::from_array(frame_b.view())?;

    // RAFT ONNX exports vary in input naming. Verify against the model with
    // a quick `Session::inputs()` introspection if this fails.
    let outputs = session
        .run(inputs!["frame_a" => input_a, "frame_b" => input_b]?)
        .context("RAFT inference failed; verify input tensor names")?;

    let flow = outputs
        .iter()
        .next()
        .context("model returned no outputs")?
        .1
        .try_extract_tensor::<f32>()?;
    let view = flow.view();
    let shape = view.shape();
    // Expected shape: [1, 2, H, W]
    let (n, c, h, w) = (shape[0], shape[1], shape[2], shape[3]);
    anyhow::ensure!(n == 1 && c == 2, "unexpected flow output shape: {shape:?}");

    let mut vectors = Vec::with_capacity(2 * h * w);
    for y in 0..h {
        for x in 0..w {
            let vx = view[[0, 0, y, x]];
            let vy = view[[0, 1, y, x]];
            vectors.push(vx);
            vectors.push(vy);
        }
    }

    let _ = Axis(0); // suppress unused-import lint when shape access is the only ndarray use

    Ok(FlowField { width: w, height: h, vectors })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_model_fails_on_missing_file() {
        let result = load_model("/tmp/this-does-not-exist.onnx");
        assert!(result.is_err());
    }

    #[test]
    #[ignore = "requires raft-small-int8.onnx — run with --ignored after setup:flow-model"]
    fn inference_returns_flow_field_with_expected_shape() {
        let model_path = "crates/uipe-vision/models/raft-small-int8.onnx";
        let mut session = load_model(model_path).expect("model load");
        let a = Array4::<f32>::zeros((1, 3, 384, 512));
        let b = Array4::<f32>::zeros((1, 3, 384, 512));
        let flow = run_inference(&mut session, &a, &b).expect("inference");
        // Identical frames → near-zero flow
        let max_mag = flow
            .vectors
            .chunks(2)
            .map(|c| (c[0] * c[0] + c[1] * c[1]).sqrt())
            .fold(0.0f32, f32::max);
        assert!(max_mag < 1.0, "expected near-zero flow for identical frames, got max magnitude {max_mag}");
    }
}
```

- [ ] **Step 2: Run the cheap test, confirm it still passes**

Run: `cargo test -p uipe-vision --lib load_model_fails_on_missing_file`
Expected: PASS.

- [ ] **Step 3: Run the ignored test if the model file exists**

Run: `cargo test -p uipe-vision --lib inference_returns_flow_field_with_expected_shape -- --ignored`
Expected: if the ONNX model is present, PASS with near-zero flow on identical frames. If the model is missing, the test will be skipped — that's fine, defer until Task 2 is finalized.

- [ ] **Step 4: Commit**

```bash
git add crates/uipe-vision/src/inference.rs
git commit -m "feat(vision): run RAFT inference on frame pair, return FlowField"
```

---

## Task 6: DBSCAN clustering over flow vectors

**Files:**
- Modify: `crates/uipe-vision/Cargo.toml`
- Create: `crates/uipe-vision/src/clustering.rs`
- Modify: `crates/uipe-vision/src/main.rs`

The classifier needs coherent moving *regions*, not raw per-pixel vectors. DBSCAN over `(x, y, vx, vy)` (with appropriate scaling so spatial and velocity components are comparable) groups vectors into clusters and isolates noise points.

- [ ] **Step 1: Add `linfa-clustering` to Cargo.toml**

```toml
linfa = "0.7"
linfa-clustering = { version = "0.7", features = ["serde"] }
```

- [ ] **Step 2: Write the failing test**

Create `crates/uipe-vision/src/clustering.rs`:

```rust
use crate::inference::FlowField;
use linfa::DatasetBase;
use linfa::traits::Transformer;
use linfa_clustering::Dbscan;
use ndarray::{Array2, Axis};

#[derive(Debug, Clone)]
pub struct Region {
    pub id: usize,
    pub bbox: BBox,
    pub vectors: Vec<RegionVector>,
}

#[derive(Debug, Clone, Copy)]
pub struct BBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct RegionVector {
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
}

const MIN_MAGNITUDE: f32 = 0.5;        // ignore pixels with sub-half-pixel motion
const SPATIAL_SCALE: f32 = 1.0;        // px units
const VELOCITY_SCALE: f32 = 20.0;      // 1 px/frame ≈ 20 px in feature space
const DBSCAN_EPS: f32 = 30.0;          // feature-space radius
const DBSCAN_MIN_POINTS: usize = 8;

pub fn cluster_flow(field: &FlowField) -> Vec<Region> {
    let mut features: Vec<f32> = Vec::new();
    let mut sources: Vec<RegionVector> = Vec::new();
    for y in 0..field.height {
        for x in 0..field.width {
            let (vx, vy) = field.at(x, y);
            let mag = (vx * vx + vy * vy).sqrt();
            if mag < MIN_MAGNITUDE {
                continue;
            }
            features.push(x as f32 * SPATIAL_SCALE);
            features.push(y as f32 * SPATIAL_SCALE);
            features.push(vx * VELOCITY_SCALE);
            features.push(vy * VELOCITY_SCALE);
            sources.push(RegionVector {
                x: x as f32,
                y: y as f32,
                vx,
                vy,
            });
        }
    }
    if sources.is_empty() {
        return Vec::new();
    }

    let n = sources.len();
    let array = Array2::from_shape_vec((n, 4), features).expect("feature shape");
    let dataset = DatasetBase::from(array);
    let labels = Dbscan::params(DBSCAN_MIN_POINTS)
        .tolerance(DBSCAN_EPS as f64)
        .transform(&dataset)
        .expect("dbscan");

    let mut by_cluster: std::collections::BTreeMap<usize, Vec<RegionVector>> =
        std::collections::BTreeMap::new();
    for (idx, label) in labels.targets().iter().enumerate() {
        if let Some(cluster_id) = label {
            by_cluster.entry(*cluster_id).or_default().push(sources[idx]);
        }
    }

    by_cluster
        .into_iter()
        .map(|(cluster_id, vectors)| {
            let xs = vectors.iter().map(|v| v.x);
            let ys = vectors.iter().map(|v| v.y);
            let min_x = xs.clone().fold(f32::INFINITY, f32::min);
            let max_x = xs.fold(f32::NEG_INFINITY, f32::max);
            let min_y = ys.clone().fold(f32::INFINITY, f32::min);
            let max_y = ys.fold(f32::NEG_INFINITY, f32::max);
            Region {
                id: cluster_id,
                bbox: BBox {
                    x: min_x,
                    y: min_y,
                    w: max_x - min_x + 1.0,
                    h: max_y - min_y + 1.0,
                },
                vectors,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_field(width: usize, height: usize, moving_box: BBox, vx: f32, vy: f32) -> FlowField {
        let mut vectors = vec![0.0; width * height * 2];
        for y in 0..height {
            for x in 0..width {
                let in_box = (x as f32) >= moving_box.x
                    && (x as f32) < moving_box.x + moving_box.w
                    && (y as f32) >= moving_box.y
                    && (y as f32) < moving_box.y + moving_box.h;
                let idx = (y * width + x) * 2;
                if in_box {
                    vectors[idx] = vx;
                    vectors[idx + 1] = vy;
                }
            }
        }
        FlowField { width, height, vectors }
    }

    #[test]
    fn cluster_flow_isolates_single_moving_region() {
        let field = synthetic_field(64, 64, BBox { x: 20.0, y: 20.0, w: 16.0, h: 16.0 }, 3.0, 0.0);
        let regions = cluster_flow(&field);
        assert_eq!(regions.len(), 1, "expected exactly one region");
        let r = &regions[0];
        assert!(r.bbox.x >= 19.0 && r.bbox.x <= 21.0);
        assert!(r.bbox.w >= 14.0 && r.bbox.w <= 18.0);
    }

    #[test]
    fn cluster_flow_returns_empty_for_stationary_field() {
        let field = synthetic_field(64, 64, BBox { x: 0.0, y: 0.0, w: 0.0, h: 0.0 }, 0.0, 0.0);
        assert!(cluster_flow(&field).is_empty());
    }

    #[test]
    fn cluster_flow_separates_distant_regions() {
        let mut field = synthetic_field(128, 128, BBox { x: 10.0, y: 10.0, w: 16.0, h: 16.0 }, 3.0, 0.0);
        // Add a second moving region far away with a different velocity direction
        for y in 90..106 {
            for x in 90..106 {
                let idx = (y * field.width + x) * 2;
                field.vectors[idx] = 0.0;
                field.vectors[idx + 1] = 3.0;
            }
        }
        let regions = cluster_flow(&field);
        assert_eq!(regions.len(), 2, "expected two distinct regions");
    }

    fn _suppress_axis_unused() {
        let _ = Axis(0);
    }
}
```

- [ ] **Step 3: Declare the module in `main.rs`**

```rust
mod clustering;
mod image_io;
mod inference;

fn main() {
    eprintln!("uipe-vision v{}", env!("CARGO_PKG_VERSION"));
}
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p uipe-vision --lib clustering`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/uipe-vision/Cargo.toml crates/uipe-vision/src/clustering.rs crates/uipe-vision/src/main.rs
git commit -m "feat(vision): DBSCAN clustering of flow vectors into regions"
```

---

## Task 7: Kinematic primitives extraction

**Files:**
- Create: `crates/uipe-vision/src/primitives.rs`
- Modify: `crates/uipe-vision/src/main.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/uipe-vision/src/primitives.rs`:

```rust
use crate::clustering::{Region, RegionVector};

#[derive(Debug, Clone, Copy)]
pub struct Primitives {
    pub mean_vx: f32,
    pub mean_vy: f32,
    pub divergence: f32,
    pub curl: f32,
    pub speed_variance: f32,
    pub point_count: usize,
}

pub fn extract_primitives(region: &Region) -> Primitives {
    let n = region.vectors.len() as f32;
    if n == 0.0 {
        return Primitives {
            mean_vx: 0.0,
            mean_vy: 0.0,
            divergence: 0.0,
            curl: 0.0,
            speed_variance: 0.0,
            point_count: 0,
        };
    }

    let (sum_vx, sum_vy) = region
        .vectors
        .iter()
        .fold((0.0f32, 0.0f32), |(sx, sy), v| (sx + v.vx, sy + v.vy));
    let mean_vx = sum_vx / n;
    let mean_vy = sum_vy / n;

    // Centroid of the region
    let (sum_x, sum_y) = region
        .vectors
        .iter()
        .fold((0.0f32, 0.0f32), |(sx, sy), v| (sx + v.x, sy + v.y));
    let cx = sum_x / n;
    let cy = sum_y / n;

    // Divergence proxy: mean of (radial velocity) — positive when vectors point outward from centroid
    // Curl proxy: mean of (tangential velocity) — positive CCW (screen-space conventions: +y down → flip sign at use site)
    let (sum_div, sum_curl) = region.vectors.iter().fold((0.0f32, 0.0f32), |(d, c), v| {
        let dx = v.x - cx;
        let dy = v.y - cy;
        let r = (dx * dx + dy * dy).sqrt().max(1e-6);
        let radial = (v.vx * dx + v.vy * dy) / r;
        let tangential = (-v.vx * dy + v.vy * dx) / r;
        (d + radial, c + tangential)
    });
    let divergence = sum_div / n;
    let curl = sum_curl / n;

    let speeds: Vec<f32> = region
        .vectors
        .iter()
        .map(|v| (v.vx * v.vx + v.vy * v.vy).sqrt())
        .collect();
    let mean_speed = speeds.iter().sum::<f32>() / n;
    let speed_variance =
        speeds.iter().map(|s| (s - mean_speed).powi(2)).sum::<f32>() / n;

    Primitives {
        mean_vx,
        mean_vy,
        divergence,
        curl,
        speed_variance,
        point_count: region.vectors.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clustering::BBox;

    fn region_from(vectors: Vec<RegionVector>) -> Region {
        let xs: Vec<f32> = vectors.iter().map(|v| v.x).collect();
        let ys: Vec<f32> = vectors.iter().map(|v| v.y).collect();
        let min_x = xs.iter().cloned().fold(f32::INFINITY, f32::min);
        let max_x = xs.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let min_y = ys.iter().cloned().fold(f32::INFINITY, f32::min);
        let max_y = ys.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        Region {
            id: 0,
            bbox: BBox { x: min_x, y: min_y, w: max_x - min_x + 1.0, h: max_y - min_y + 1.0 },
            vectors,
        }
    }

    #[test]
    fn pure_translation_has_zero_divergence_and_curl() {
        let vectors: Vec<RegionVector> = (0..10)
            .flat_map(|y| (0..10).map(move |x| RegionVector { x: x as f32, y: y as f32, vx: 2.0, vy: 0.0 }))
            .collect();
        let p = extract_primitives(&region_from(vectors));
        assert!((p.mean_vx - 2.0).abs() < 1e-4);
        assert!(p.mean_vy.abs() < 1e-4);
        assert!(p.divergence.abs() < 1e-3);
        assert!(p.curl.abs() < 1e-3);
    }

    #[test]
    fn pure_expansion_has_positive_divergence() {
        // Vectors point radially outward from (5,5)
        let mut vectors = Vec::new();
        for y in 0..10 {
            for x in 0..10 {
                if x == 5 && y == 5 { continue; }
                let dx = x as f32 - 5.0;
                let dy = y as f32 - 5.0;
                let r = (dx * dx + dy * dy).sqrt();
                vectors.push(RegionVector { x: x as f32, y: y as f32, vx: dx / r, vy: dy / r });
            }
        }
        let p = extract_primitives(&region_from(vectors));
        assert!(p.divergence > 0.5, "expected strongly positive divergence, got {}", p.divergence);
        assert!(p.curl.abs() < 0.2);
    }

    #[test]
    fn pure_rotation_has_nonzero_curl() {
        let mut vectors = Vec::new();
        for y in 0..10 {
            for x in 0..10 {
                if x == 5 && y == 5 { continue; }
                let dx = x as f32 - 5.0;
                let dy = y as f32 - 5.0;
                let r = (dx * dx + dy * dy).sqrt();
                // Tangential vectors (rotation about centroid): (-dy, dx) / r
                vectors.push(RegionVector { x: x as f32, y: y as f32, vx: -dy / r, vy: dx / r });
            }
        }
        let p = extract_primitives(&region_from(vectors));
        assert!(p.curl.abs() > 0.5, "expected strongly nonzero curl, got {}", p.curl);
        assert!(p.divergence.abs() < 0.2);
    }
}
```

- [ ] **Step 2: Declare module in `main.rs`**

```rust
mod clustering;
mod image_io;
mod inference;
mod primitives;

fn main() {
    eprintln!("uipe-vision v{}", env!("CARGO_PKG_VERSION"));
}
```

- [ ] **Step 3: Run the tests**

Run: `cargo test -p uipe-vision --lib primitives`
Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add crates/uipe-vision/src/primitives.rs crates/uipe-vision/src/main.rs
git commit -m "feat(vision): kinematic primitives — mean velocity, divergence, curl, variance"
```

---

## Task 8: Pattern classifier (translation/scale/rotation/stillness)

**Files:**
- Create: `crates/uipe-vision/src/classifier.rs`
- Modify: `crates/uipe-vision/src/main.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/uipe-vision/src/classifier.rs`:

```rust
use crate::clustering::BBox;
use crate::primitives::Primitives;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Pattern {
    Translation,
    Scale,    // expand or contract
    Rotation, // cw or ccw
    Stillness,
}

#[derive(Debug, Clone, Copy)]
pub struct Centroid {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone)]
pub enum PatternParams {
    Translation { direction_vx: f32, direction_vy: f32, speed_px_per_sec: f32 },
    Scale { expanding: bool, centroid: Centroid, rate: f32 },
    Rotation { cw: bool, centroid: Centroid, angular_speed_rad_per_sec: f32 },
    Stillness { duration_ms: f32 },
}

#[derive(Debug, Clone)]
pub struct Classification {
    pub pattern: Pattern,
    pub params: PatternParams,
    pub confidence: f32,
}

const TRANSLATION_SPEED_MIN: f32 = 0.5;     // px/frame
const STILLNESS_SPEED_MAX: f32 = 0.2;       // px/frame
const SCALE_DIVERGENCE_MIN: f32 = 0.05;     // unitless from primitives
const ROTATION_CURL_MIN: f32 = 0.05;
const TRANSLATION_RATIO_OVER_NOISE: f32 = 2.0;

/// Classify a single-frame primitive observation. Frame-rate is needed to scale
/// per-frame velocities into per-second rates.
pub fn classify(
    primitives: &Primitives,
    bbox: &BBox,
    frame_rate_hz: f32,
) -> Classification {
    let speed = (primitives.mean_vx.powi(2) + primitives.mean_vy.powi(2)).sqrt();
    let divergence = primitives.divergence.abs();
    let curl = primitives.curl.abs();

    if speed < STILLNESS_SPEED_MAX && divergence < SCALE_DIVERGENCE_MIN && curl < ROTATION_CURL_MIN {
        return Classification {
            pattern: Pattern::Stillness,
            params: PatternParams::Stillness { duration_ms: 1000.0 / frame_rate_hz },
            confidence: 0.9,
        };
    }

    // Pick the dominant signal — whichever is strongest beats the others
    let trans_strength = speed;
    let scale_strength = divergence * 10.0;
    let rot_strength = curl * 10.0;

    let centroid = Centroid {
        x: bbox.x + bbox.w / 2.0,
        y: bbox.y + bbox.h / 2.0,
    };

    if trans_strength >= scale_strength
        && trans_strength >= rot_strength
        && trans_strength > TRANSLATION_SPEED_MIN
    {
        let speed_px_per_sec = speed * frame_rate_hz;
        let conf = (trans_strength
            / (scale_strength + rot_strength + 1e-6))
            .min(1.0)
            .max(0.5);
        return Classification {
            pattern: Pattern::Translation,
            params: PatternParams::Translation {
                direction_vx: primitives.mean_vx / speed.max(1e-6),
                direction_vy: primitives.mean_vy / speed.max(1e-6),
                speed_px_per_sec,
            },
            confidence: conf,
        };
    }
    if scale_strength >= rot_strength {
        return Classification {
            pattern: Pattern::Scale,
            params: PatternParams::Scale {
                expanding: primitives.divergence > 0.0,
                centroid,
                rate: primitives.divergence,
            },
            confidence: (scale_strength / (rot_strength + 1e-6)).min(1.0).max(0.5),
        };
    }
    Classification {
        pattern: Pattern::Rotation,
        params: PatternParams::Rotation {
            cw: primitives.curl < 0.0, // screen-space: positive curl by our convention = CCW
            centroid,
            angular_speed_rad_per_sec: primitives.curl * frame_rate_hz,
        },
        confidence: 0.7,
    }
}

/// Track pattern persistence across frames per region. Emits Phenomenon events
/// when a pattern starts and when it ends (gaining an `endTs`).
pub struct PatternTracker {
    last_seen: HashMap<String, (Pattern, f64)>,
}

#[derive(Debug, Clone)]
pub enum Phenomenon {
    Start { region_id: String, classification: Classification, ts_ms: f64 },
    End { region_id: String, pattern: Pattern, started_ms: f64, ended_ms: f64 },
}

impl PatternTracker {
    pub fn new() -> Self {
        Self { last_seen: HashMap::new() }
    }

    pub fn observe(
        &mut self,
        region_id: &str,
        classification: Classification,
        ts_ms: f64,
    ) -> Vec<Phenomenon> {
        let mut out = Vec::new();
        match self.last_seen.get(region_id).copied() {
            None => {
                self.last_seen.insert(region_id.to_string(), (classification.pattern, ts_ms));
                out.push(Phenomenon::Start {
                    region_id: region_id.to_string(),
                    classification,
                    ts_ms,
                });
            }
            Some((prev_pattern, started_ms)) if prev_pattern != classification.pattern => {
                out.push(Phenomenon::End {
                    region_id: region_id.to_string(),
                    pattern: prev_pattern,
                    started_ms,
                    ended_ms: ts_ms,
                });
                out.push(Phenomenon::Start {
                    region_id: region_id.to_string(),
                    classification: classification.clone(),
                    ts_ms,
                });
                self.last_seen.insert(region_id.to_string(), (classification.pattern, ts_ms));
            }
            Some(_) => {}
        }
        out
    }

    /// Emit End phenomena for regions whose `last_seen` is older than `stale_ms`.
    pub fn flush_stale(&mut self, now_ms: f64, stale_ms: f64) -> Vec<Phenomenon> {
        let stale: Vec<(String, Pattern, f64)> = self
            .last_seen
            .iter()
            .filter(|(_, (_, started))| now_ms - started > stale_ms)
            .map(|(k, (p, s))| (k.clone(), *p, *s))
            .collect();
        let mut out = Vec::new();
        for (region_id, pattern, started_ms) in stale {
            self.last_seen.remove(&region_id);
            out.push(Phenomenon::End { region_id, pattern, started_ms, ended_ms: now_ms });
        }
        out
    }
}

impl Default for PatternTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bbox() -> BBox {
        BBox { x: 0.0, y: 0.0, w: 10.0, h: 10.0 }
    }

    #[test]
    fn stillness_classified_when_all_signals_low() {
        let p = Primitives {
            mean_vx: 0.05, mean_vy: 0.05,
            divergence: 0.01, curl: 0.01,
            speed_variance: 0.0, point_count: 100,
        };
        assert_eq!(classify(&p, &bbox(), 60.0).pattern, Pattern::Stillness);
    }

    #[test]
    fn translation_classified_for_clean_horizontal_motion() {
        let p = Primitives {
            mean_vx: 3.0, mean_vy: 0.0,
            divergence: 0.0, curl: 0.0,
            speed_variance: 0.0, point_count: 100,
        };
        let result = classify(&p, &bbox(), 60.0);
        assert_eq!(result.pattern, Pattern::Translation);
        if let PatternParams::Translation { direction_vx, speed_px_per_sec, .. } = result.params {
            assert!((direction_vx - 1.0).abs() < 0.01);
            assert!((speed_px_per_sec - 180.0).abs() < 1.0); // 3 px/frame * 60 fps
        } else {
            panic!("expected Translation params");
        }
    }

    #[test]
    fn scale_classified_for_strong_divergence() {
        let p = Primitives {
            mean_vx: 0.1, mean_vy: 0.1,
            divergence: 0.5, curl: 0.0,
            speed_variance: 0.0, point_count: 100,
        };
        assert_eq!(classify(&p, &bbox(), 60.0).pattern, Pattern::Scale);
    }

    #[test]
    fn rotation_classified_for_strong_curl() {
        let p = Primitives {
            mean_vx: 0.0, mean_vy: 0.0,
            divergence: 0.0, curl: 0.5,
            speed_variance: 0.0, point_count: 100,
        };
        assert_eq!(classify(&p, &bbox(), 60.0).pattern, Pattern::Rotation);
    }

    #[test]
    fn tracker_emits_start_on_first_observation() {
        let mut t = PatternTracker::new();
        let p = Primitives { mean_vx: 3.0, mean_vy: 0.0, divergence: 0.0, curl: 0.0, speed_variance: 0.0, point_count: 100 };
        let events = t.observe("r1", classify(&p, &bbox(), 60.0), 100.0);
        assert!(matches!(events[0], Phenomenon::Start { .. }));
    }

    #[test]
    fn tracker_emits_end_then_start_on_pattern_change() {
        let mut t = PatternTracker::new();
        let translation = Primitives { mean_vx: 3.0, mean_vy: 0.0, divergence: 0.0, curl: 0.0, speed_variance: 0.0, point_count: 100 };
        let rotation = Primitives { mean_vx: 0.0, mean_vy: 0.0, divergence: 0.0, curl: 0.5, speed_variance: 0.0, point_count: 100 };
        t.observe("r1", classify(&translation, &bbox(), 60.0), 100.0);
        let events = t.observe("r1", classify(&rotation, &bbox(), 60.0), 200.0);
        assert!(matches!(events[0], Phenomenon::End { ended_ms, .. } if ended_ms == 200.0));
        assert!(matches!(events[1], Phenomenon::Start { ts_ms, .. } if ts_ms == 200.0));
    }
}
```

- [ ] **Step 2: Declare module in `main.rs`**

```rust
mod classifier;
mod clustering;
mod image_io;
mod inference;
mod primitives;

fn main() {
    eprintln!("uipe-vision v{}", env!("CARGO_PKG_VERSION"));
}
```

- [ ] **Step 3: Run the tests**

Run: `cargo test -p uipe-vision --lib classifier`
Expected: 6 tests pass.

- [ ] **Step 4: Commit**

```bash
git add crates/uipe-vision/src/classifier.rs crates/uipe-vision/src/main.rs
git commit -m "feat(vision): pattern classifier + tracker for start/end emission"
```

---

## Task 9: stdin/stdout protocol — length-prefixed PNG in, ndjson out

**Files:**
- Modify: `crates/uipe-vision/Cargo.toml`
- Create: `crates/uipe-vision/src/protocol.rs`
- Modify: `crates/uipe-vision/src/main.rs`

- [ ] **Step 1: Add `serde`, `serde_json`, `byteorder` to Cargo.toml**

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
byteorder = "1.5"
```

- [ ] **Step 2: Write the failing test for the protocol reader**

Create `crates/uipe-vision/src/protocol.rs`:

```rust
use anyhow::{bail, Result};
use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

const MAX_FRAME_BYTES: u32 = 16 * 1024 * 1024; // 16 MB hard cap

pub fn read_frame<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let len = u32::from_be_bytes(len_buf);
    if len > MAX_FRAME_BYTES {
        bail!("frame length {len} exceeds MAX_FRAME_BYTES {MAX_FRAME_BYTES}");
    }
    let mut buf = vec![0u8; len as usize];
    reader.read_exact(&mut buf)?;
    Ok(Some(buf))
}

#[allow(dead_code)]
pub fn write_frame<W: Write>(writer: &mut W, bytes: &[u8]) -> Result<()> {
    writer.write_u32::<BigEndian>(bytes.len() as u32)?;
    writer.write_all(bytes)?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum OutboundEvent {
    #[serde(rename = "optical-flow-raw")]
    Raw {
        ts: f64,
        #[serde(rename = "frameTimestamp")]
        frame_timestamp: f64,
        keypoints: Vec<RawKeypoint>,
        #[serde(rename = "gridSummary")]
        grid_summary: GridSummary,
    },
    #[serde(rename = "optical-flow-region")]
    Region {
        ts: f64,
        #[serde(rename = "frameTimestamp")]
        frame_timestamp: f64,
        #[serde(rename = "regionId")]
        region_id: String,
        bbox: SerBBox,
        primitives: SerPrimitives,
    },
    #[serde(rename = "optical-flow-motion")]
    Motion {
        ts: f64,
        #[serde(rename = "endTs", skip_serializing_if = "Option::is_none")]
        end_ts: Option<f64>,
        #[serde(rename = "regionId")]
        region_id: String,
        pattern: String,
        params: serde_json::Value,
        confidence: f32,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RawKeypoint {
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
    pub magnitude: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GridSummary {
    pub cols: u32,
    pub rows: u32,
    pub vectors: Vec<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SerBBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SerPrimitives {
    #[serde(rename = "meanVelocity")]
    pub mean_velocity: Velocity,
    pub divergence: f32,
    pub curl: f32,
    #[serde(rename = "speedVariance")]
    pub speed_variance: f32,
    #[serde(rename = "pointCount")]
    pub point_count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Velocity {
    pub vx: f32,
    pub vy: f32,
}

pub fn write_event<W: Write>(writer: &mut W, event: &OutboundEvent) -> Result<()> {
    serde_json::to_writer(&mut *writer, event)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn read_frame_returns_none_on_empty_stream() {
        let bytes: Vec<u8> = Vec::new();
        let mut cursor = Cursor::new(bytes);
        assert!(read_frame(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn write_then_read_round_trips_a_frame() {
        let payload = vec![1u8, 2, 3, 4, 5];
        let mut buf: Vec<u8> = Vec::new();
        write_frame(&mut buf, &payload).unwrap();
        let mut cursor = Cursor::new(buf);
        let read = read_frame(&mut cursor).unwrap().expect("frame");
        assert_eq!(read, payload);
    }

    #[test]
    fn read_frame_rejects_oversize_length() {
        let mut buf: Vec<u8> = Vec::new();
        buf.extend_from_slice(&(MAX_FRAME_BYTES + 1).to_be_bytes());
        let mut cursor = Cursor::new(buf);
        assert!(read_frame(&mut cursor).is_err());
    }

    #[test]
    fn outbound_event_motion_serializes_with_kebab_case_type() {
        let evt = OutboundEvent::Motion {
            ts: 100.0,
            end_ts: None,
            region_id: "r1".into(),
            pattern: "translation".into(),
            params: serde_json::json!({"directionVx": 1.0, "directionVy": 0.0, "speedPxPerSec": 180.0}),
            confidence: 0.9,
        };
        let json = serde_json::to_string(&evt).unwrap();
        assert!(json.contains(r#""type":"optical-flow-motion""#));
        assert!(json.contains(r#""regionId":"r1""#));
        assert!(json.contains(r#""ts":100"#));
    }
}
```

- [ ] **Step 3: Declare module in `main.rs`**

```rust
mod classifier;
mod clustering;
mod image_io;
mod inference;
mod primitives;
mod protocol;

fn main() {
    eprintln!("uipe-vision v{}", env!("CARGO_PKG_VERSION"));
}
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p uipe-vision --lib protocol`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/uipe-vision/Cargo.toml crates/uipe-vision/src/protocol.rs crates/uipe-vision/src/main.rs
git commit -m "feat(vision): stdin length-prefix protocol + stdout ndjson event types"
```

---

## Task 10: Wire the main loop end-to-end

**Files:**
- Modify: `crates/uipe-vision/src/main.rs`
- Create: `crates/uipe-vision/tests/integration_smoke.rs`

This task connects the modules into a working binary. On startup, load the model. Then loop: read a frame, decode, run inference (skipping the first frame since there's nothing to pair with), cluster, extract primitives, classify, emit events.

- [ ] **Step 1: Replace `main.rs` with the wired-up entry point**

```rust
mod classifier;
mod clustering;
mod image_io;
mod inference;
mod primitives;
mod protocol;

use anyhow::{Context, Result};
use classifier::{classify, Pattern, PatternParams, PatternTracker, Phenomenon};
use clustering::cluster_flow;
use image_io::{decode_png, to_tensor, DecodedFrame};
use inference::{load_model, run_inference};
use primitives::extract_primitives;
use protocol::{read_frame, write_event, GridSummary, OutboundEvent, RawKeypoint, SerBBox, SerPrimitives, Velocity};
use std::env;
use std::io::{stdin, stdout, BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::time::Instant;

const MODEL_INPUT_W: u32 = 512;
const MODEL_INPUT_H: u32 = 384;
const ASSUMED_FRAME_RATE_HZ: f32 = 30.0;
const MAX_RAW_KEYPOINTS: usize = 64;
const RAW_EMIT_INTERVAL_MS: f64 = 100.0; // 10 Hz
const GRID_COLS: u32 = 16;
const GRID_ROWS: u32 = 12;
const STALE_REGION_MS: f64 = 500.0;

fn main() -> Result<()> {
    let model_path: PathBuf = env::var("UIPE_FLOW_MODEL")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from("crates/uipe-vision/models/raft-small-int8.onnx")
        });

    eprintln!("uipe-vision v{} starting; model={}", env!("CARGO_PKG_VERSION"), model_path.display());

    let mut session = load_model(&model_path).with_context(|| format!("failed to load model at {}", model_path.display()))?;
    eprintln!("model loaded");

    let mut reader = BufReader::new(stdin().lock());
    let mut writer = BufWriter::new(stdout().lock());

    let mut prev_frame: Option<DecodedFrame> = None;
    let mut tracker = PatternTracker::new();
    let mut last_raw_emit_ms: f64 = f64::NEG_INFINITY;
    let session_start = Instant::now();

    loop {
        let frame_bytes = match read_frame(&mut reader)? {
            Some(b) => b,
            None => {
                eprintln!("stdin closed; exiting");
                break;
            }
        };
        let now_ms = session_start.elapsed().as_secs_f64() * 1000.0;

        let frame = match decode_png(&frame_bytes) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("decode error: {e}");
                continue;
            }
        };

        let prev = match prev_frame.take() {
            Some(p) => p,
            None => {
                prev_frame = Some(frame);
                continue;
            }
        };

        let tensor_prev = to_tensor(&prev, MODEL_INPUT_W, MODEL_INPUT_H);
        let tensor_curr = to_tensor(&frame, MODEL_INPUT_W, MODEL_INPUT_H);

        let inference_start = Instant::now();
        let flow = match run_inference(&mut session, &tensor_prev, &tensor_curr) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("inference error: {e}");
                prev_frame = Some(frame);
                continue;
            }
        };
        let inference_ms = inference_start.elapsed().as_secs_f64() * 1000.0;
        eprintln!("inference {inference_ms:.1}ms");

        // Raw event (rate-limited)
        if now_ms - last_raw_emit_ms >= RAW_EMIT_INTERVAL_MS {
            let raw = build_raw_event(&flow, now_ms);
            write_event(&mut writer, &raw)?;
            last_raw_emit_ms = now_ms;
        }

        // Region events + classifier
        let regions = cluster_flow(&flow);
        for region in &regions {
            let region_id = format!("r{}-{:.0}-{:.0}", region.id, region.bbox.x, region.bbox.y);
            let p = extract_primitives(region);
            let region_event = OutboundEvent::Region {
                ts: now_ms,
                frame_timestamp: now_ms,
                region_id: region_id.clone(),
                bbox: SerBBox { x: region.bbox.x, y: region.bbox.y, w: region.bbox.w, h: region.bbox.h },
                primitives: SerPrimitives {
                    mean_velocity: Velocity { vx: p.mean_vx, vy: p.mean_vy },
                    divergence: p.divergence,
                    curl: p.curl,
                    speed_variance: p.speed_variance,
                    point_count: p.point_count as u32,
                },
            };
            write_event(&mut writer, &region_event)?;

            let classification = classify(&p, &region.bbox, ASSUMED_FRAME_RATE_HZ);
            for phenom in tracker.observe(&region_id, classification, now_ms) {
                let event = build_motion_event(phenom);
                write_event(&mut writer, &event)?;
            }
        }

        for phenom in tracker.flush_stale(now_ms, STALE_REGION_MS) {
            let event = build_motion_event(phenom);
            write_event(&mut writer, &event)?;
        }

        writer.flush()?;
        prev_frame = Some(frame);
    }

    Ok(())
}

fn build_raw_event(flow: &inference::FlowField, ts: f64) -> OutboundEvent {
    let mut keypoints: Vec<RawKeypoint> = Vec::new();
    for y in 0..flow.height {
        for x in 0..flow.width {
            let (vx, vy) = flow.at(x, y);
            let mag = (vx * vx + vy * vy).sqrt();
            if mag < 0.5 {
                continue;
            }
            keypoints.push(RawKeypoint {
                x: x as f32,
                y: y as f32,
                vx,
                vy,
                magnitude: mag,
            });
        }
    }
    keypoints.sort_by(|a, b| b.magnitude.partial_cmp(&a.magnitude).unwrap_or(std::cmp::Ordering::Equal));
    keypoints.truncate(MAX_RAW_KEYPOINTS);

    // Coarse grid summary
    let cell_w = flow.width as f32 / GRID_COLS as f32;
    let cell_h = flow.height as f32 / GRID_ROWS as f32;
    let mut grid = vec![0.0f32; (GRID_COLS * GRID_ROWS * 2) as usize];
    let mut counts = vec![0u32; (GRID_COLS * GRID_ROWS) as usize];
    for y in 0..flow.height {
        for x in 0..flow.width {
            let (vx, vy) = flow.at(x, y);
            let gx = ((x as f32 / cell_w) as u32).min(GRID_COLS - 1);
            let gy = ((y as f32 / cell_h) as u32).min(GRID_ROWS - 1);
            let cell_idx = (gy * GRID_COLS + gx) as usize;
            grid[cell_idx * 2] += vx;
            grid[cell_idx * 2 + 1] += vy;
            counts[cell_idx] += 1;
        }
    }
    for cell_idx in 0..counts.len() {
        if counts[cell_idx] > 0 {
            grid[cell_idx * 2] /= counts[cell_idx] as f32;
            grid[cell_idx * 2 + 1] /= counts[cell_idx] as f32;
        }
    }

    OutboundEvent::Raw {
        ts,
        frame_timestamp: ts,
        keypoints,
        grid_summary: GridSummary { cols: GRID_COLS, rows: GRID_ROWS, vectors: grid },
    }
}

fn build_motion_event(phenom: Phenomenon) -> OutboundEvent {
    match phenom {
        Phenomenon::Start { region_id, classification, ts_ms } => OutboundEvent::Motion {
            ts: ts_ms,
            end_ts: None,
            region_id,
            pattern: pattern_str(classification.pattern).to_string(),
            params: pattern_params_json(classification.params),
            confidence: classification.confidence,
        },
        Phenomenon::End { region_id, pattern, started_ms, ended_ms } => OutboundEvent::Motion {
            ts: started_ms,
            end_ts: Some(ended_ms),
            region_id,
            pattern: pattern_str(pattern).to_string(),
            params: serde_json::json!({}),
            confidence: 1.0,
        },
    }
}

fn pattern_str(p: Pattern) -> &'static str {
    match p {
        Pattern::Translation => "translation",
        Pattern::Scale => "scale",
        Pattern::Rotation => "rotation",
        Pattern::Stillness => "stillness",
    }
}

fn pattern_params_json(p: PatternParams) -> serde_json::Value {
    match p {
        PatternParams::Translation { direction_vx, direction_vy, speed_px_per_sec } => serde_json::json!({
            "direction": { "vx": direction_vx, "vy": direction_vy },
            "speedPxPerSec": speed_px_per_sec,
        }),
        PatternParams::Scale { expanding, centroid, rate } => serde_json::json!({
            "sign": if expanding { "expand" } else { "contract" },
            "centroid": { "x": centroid.x, "y": centroid.y },
            "rate": rate,
        }),
        PatternParams::Rotation { cw, centroid, angular_speed_rad_per_sec } => serde_json::json!({
            "sign": if cw { "cw" } else { "ccw" },
            "centroid": { "x": centroid.x, "y": centroid.y },
            "angularSpeedRadPerSec": angular_speed_rad_per_sec,
        }),
        PatternParams::Stillness { duration_ms } => serde_json::json!({ "durationMs": duration_ms }),
    }
}
```

- [ ] **Step 2: Create integration smoke test (Rust)**

Create `crates/uipe-vision/tests/integration_smoke.rs`:

```rust
//! End-to-end smoke test that spawns the built binary and writes synthetic
//! frame pairs to its stdin, asserting that motion events come back on stdout.
//!
//! This test is `#[ignore]` because it requires a working ONNX model file.
//! Run with `cargo test --test integration_smoke -- --ignored` after the model
//! is set up via `pnpm run setup:flow-model`.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

fn png_for_color(r: u8, g: u8, b: u8, w: u32, h: u32) -> Vec<u8> {
    use image::{ImageBuffer, Rgb};
    let mut img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::new(w, h);
    for p in img.pixels_mut() {
        *p = Rgb([r, g, b]);
    }
    let mut bytes = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png).unwrap();
    bytes
}

#[test]
#[ignore = "requires ONNX model present at crates/uipe-vision/models/raft-small-int8.onnx"]
fn binary_emits_events_for_two_frames() {
    let bin = env!("CARGO_BIN_EXE_uipe-vision");
    let mut child = Command::new(bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn");

    let stdin = child.stdin.as_mut().expect("stdin");
    let frame_a = png_for_color(50, 50, 50, 128, 128);
    let frame_b = png_for_color(60, 60, 60, 128, 128);
    for frame in [&frame_a, &frame_b] {
        let len = frame.len() as u32;
        stdin.write_all(&len.to_be_bytes()).unwrap();
        stdin.write_all(frame).unwrap();
    }
    stdin.flush().unwrap();
    drop(child.stdin.take());

    let stdout = child.stdout.take().expect("stdout");
    let reader = BufReader::new(stdout);
    let mut got_event = false;
    for line in reader.lines() {
        let line = line.unwrap();
        if line.contains(r#""type":"optical-flow-"#) {
            got_event = true;
            break;
        }
    }
    assert!(got_event, "expected at least one optical-flow event on stdout");
    let _ = child.wait();
}
```

- [ ] **Step 3: Build the binary**

Run: `cargo build --release --bin uipe-vision`
Expected: compiles. If `ort`'s download-binaries feature is slow first run, that's expected.

- [ ] **Step 4: Run all Rust unit tests**

Run: `cargo test -p uipe-vision --lib`
Expected: all unit tests pass (load_model error path, image_io, clustering, primitives, classifier, protocol — ~18 tests).

- [ ] **Step 5: Run the ignored integration test if the model is present**

Run: `cargo test -p uipe-vision --test integration_smoke -- --ignored --nocapture`
Expected: if model is present, PASS. If model is missing, skip.

- [ ] **Step 6: Commit**

```bash
git add crates/uipe-vision/src/main.rs crates/uipe-vision/tests/integration_smoke.rs
git commit -m "feat(vision): wire main loop — read frames, run flow, emit events"
```

---

## Task 11: Extend EventType union + payload types (TypeScript)

**Files:**
- Modify: `src/pipelines/temporal/collectors/types.ts`

- [ ] **Step 1: Open `src/pipelines/temporal/collectors/types.ts` and append the new types**

Add these three event-type strings to the existing `EventType` union and the new payload interfaces. The existing union is:

```typescript
export type EventType =
  | 'input'
  | 'mutation'
  | 'network-request'
  | 'network-response'
  | 'animation-start'
  | 'animation-end'
  | 'phash-change';
```

Replace with:

```typescript
export type EventType =
  | 'input'
  | 'mutation'
  | 'network-request'
  | 'network-response'
  | 'animation-start'
  | 'animation-end'
  | 'phash-change'
  | 'optical-flow-raw'
  | 'optical-flow-region'
  | 'optical-flow-motion';
```

Then append (above the `Collector` interface declaration):

```typescript
export interface OpticalFlowRawPayload {
  frameTimestamp: number;
  keypoints: Array<{ x: number; y: number; vx: number; vy: number; magnitude: number }>;
  gridSummary: { cols: number; rows: number; vectors: number[] };
}

export interface OpticalFlowRegionPayload {
  frameTimestamp: number;
  regionId: string;
  bbox: { x: number; y: number; w: number; h: number };
  primitives: {
    meanVelocity: { vx: number; vy: number };
    divergence: number;
    curl: number;
    speedVariance: number;
    pointCount: number;
  };
}

export type MotionPattern = 'translation' | 'scale' | 'rotation' | 'stillness';

export type MotionPatternParams =
  | { direction: { vx: number; vy: number }; speedPxPerSec: number }
  | { sign: 'expand' | 'contract'; centroid: { x: number; y: number }; rate: number }
  | { sign: 'cw' | 'ccw'; centroid: { x: number; y: number }; angularSpeedRadPerSec: number }
  | { durationMs: number }
  | Record<string, never>;

export interface OpticalFlowMotionPayload {
  endTs?: number;
  regionId: string;
  pattern: MotionPattern;
  params: MotionPatternParams;
  confidence: number;
}
```

Then extend the existing `PayloadFor<T>` conditional type (find its current form and add the three new cases). For example, if it currently reads:

```typescript
export type PayloadFor<T extends EventType> =
  T extends 'input' ? InputPayload
  : T extends 'mutation' ? MutationPayload
  // ...etc
  : never;
```

Add the new branches:

```typescript
  : T extends 'optical-flow-raw' ? OpticalFlowRawPayload
  : T extends 'optical-flow-region' ? OpticalFlowRegionPayload
  : T extends 'optical-flow-motion' ? OpticalFlowMotionPayload
```

- [ ] **Step 2: Verify tsc clean**

Run: `pnpm exec tsc --noEmit`
Expected: zero errors. If any existing test or code path uses an exhaustive switch on `EventType` and doesn't have new cases yet, that's expected — fix in Task 13 when wiring the collector.

- [ ] **Step 3: Commit**

```bash
git add src/pipelines/temporal/collectors/types.ts
git commit -m "feat(temporal): add optical-flow event types and payloads"
```

---

## Task 12: `FlowProducer` skeleton + sidecar lifecycle

**Files:**
- Create: `src/pipelines/temporal/producers/optical-flow.ts`
- Create: `tests/unit/temporal/producers/optical-flow.test.ts`

This task creates the producer with **stub sidecar spawning** (mockable). pHash gating and event parsing land in subsequent tasks.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/temporal/producers/optical-flow.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { FlowProducer, type SidecarSpawner } from '../../../../src/pipelines/temporal/producers/optical-flow.js';

class StubChild extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  killed = false;
  constructor() {
    super();
    this.stdin = new Writable({ write: (_chunk, _enc, cb) => cb() });
    this.stdout = new Readable({ read: () => {} });
    this.stderr = new Readable({ read: () => {} });
  }
  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', 0, null));
    return true;
  }
}

describe('FlowProducer lifecycle', () => {
  let spawned: StubChild[];
  let spawner: SidecarSpawner;

  beforeEach(() => {
    spawned = [];
    spawner = vi.fn(() => {
      const child = new StubChild();
      spawned.push(child);
      return child as never;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not spawn until start() is called', () => {
    new FlowProducer({ binaryPath: '/fake', spawner });
    expect(spawned.length).toBe(0);
  });

  it('spawns the sidecar on start()', async () => {
    const producer = new FlowProducer({ binaryPath: '/fake', spawner });
    await producer.start();
    expect(spawned.length).toBe(1);
    await producer.stop();
  });

  it('restarts after sidecar crash with exponential backoff', async () => {
    vi.useFakeTimers();
    const producer = new FlowProducer({
      binaryPath: '/fake',
      spawner,
      initialBackoffMs: 10,
      maxBackoffMs: 100,
      maxConsecutiveFailures: 3,
    });
    await producer.start();
    expect(spawned.length).toBe(1);

    spawned[0]!.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(15);
    expect(spawned.length).toBe(2);

    spawned[1]!.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(25);
    expect(spawned.length).toBe(3);

    await producer.stop();
    vi.useRealTimers();
  });

  it('disables itself after maxConsecutiveFailures', async () => {
    vi.useFakeTimers();
    const producer = new FlowProducer({
      binaryPath: '/fake',
      spawner,
      initialBackoffMs: 1,
      maxBackoffMs: 10,
      maxConsecutiveFailures: 2,
    });
    await producer.start();
    spawned[0]!.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(2);
    spawned[1]!.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(5);
    expect(producer.disabled).toBe(true);
    await producer.stop();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Write the minimal implementation**

Create `src/pipelines/temporal/producers/optical-flow.ts`:

```typescript
import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createLogger } from '../../../utils/logger.js';

export type SidecarSpawner = (binaryPath: string, args: string[]) => ChildProcess;

export interface FlowProducerOptions {
  binaryPath: string;
  spawner?: SidecarSpawner;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  maxConsecutiveFailures?: number;
}

const log = createLogger('flow-producer');

export class FlowProducer extends EventEmitter {
  private child: ChildProcess | null = null;
  private readonly binaryPath: string;
  private readonly spawner: SidecarSpawner;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxFailures: number;

  private currentBackoffMs: number;
  private consecutiveFailures = 0;
  private stopping = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private _disabled = false;

  constructor(opts: FlowProducerOptions) {
    super();
    this.binaryPath = opts.binaryPath;
    this.spawner = opts.spawner ?? ((bin, args) => nodeSpawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] }));
    this.initialBackoffMs = opts.initialBackoffMs ?? 1000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.maxFailures = opts.maxConsecutiveFailures ?? 3;
    this.currentBackoffMs = this.initialBackoffMs;
  }

  get disabled(): boolean {
    return this._disabled;
  }

  async start(): Promise<void> {
    if (this._disabled || this.stopping) return;
    this.spawnChild();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }

  private spawnChild(): void {
    log.info({ binaryPath: this.binaryPath }, 'spawning sidecar');
    const child = this.spawner(this.binaryPath, []);
    this.child = child;
    child.once('exit', (code, signal) => this.onExit(code, signal));
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim()) log.debug({ sidecar: line }, 'sidecar stderr');
      }
    });
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null;
    if (this.stopping) return;
    this.consecutiveFailures += 1;
    log.warn({ code, signal, failures: this.consecutiveFailures }, 'sidecar exited');
    if (this.consecutiveFailures >= this.maxFailures) {
      this._disabled = true;
      log.error('sidecar permanently disabled after consecutive failures');
      this.emit('disabled');
      return;
    }
    const delay = this.currentBackoffMs;
    this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, this.maxBackoffMs);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnChild();
    }, delay);
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run tests/unit/temporal/producers/optical-flow.test.ts --reporter=verbose`
Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/pipelines/temporal/producers/optical-flow.ts tests/unit/temporal/producers/optical-flow.test.ts
git commit -m "feat(temporal): FlowProducer with sidecar lifecycle + restart backoff"
```

---

## Task 13: pHash gating + frame forwarding in FlowProducer

**Files:**
- Modify: `src/pipelines/temporal/producers/optical-flow.ts`
- Modify: `tests/unit/temporal/producers/optical-flow.test.ts`

- [ ] **Step 1: Extend the test file with pHash gating tests**

Append to `tests/unit/temporal/producers/optical-flow.test.ts`:

```typescript
import { EventEmitter as EE2 } from 'node:events';

class StubFrameCapture extends EE2 {
  publish(keyframe: { pngBytes: Buffer; phash: bigint; timestamp: number }): void {
    this.emit('keyframe', keyframe);
  }
}

function pngStub(value: number): Buffer {
  return Buffer.from([value, 0xff, 0xee]);
}

describe('FlowProducer pHash gating', () => {
  let spawner: SidecarSpawner;
  let spawned: StubChild[];

  beforeEach(() => {
    spawned = [];
    spawner = vi.fn(() => {
      const child = new StubChild();
      spawned.push(child);
      return child as never;
    });
  });

  it('drops a frame when pHash Hamming distance is below threshold', async () => {
    const capture = new StubFrameCapture();
    const writes: Buffer[] = [];
    const producer = new FlowProducer({
      binaryPath: '/fake',
      spawner,
      phashThreshold: 5,
    });
    producer.attachFrameSource(capture as never);
    await producer.start();
    const child = spawned[0]!;
    (child.stdin as { write: (b: Buffer) => boolean }).write = (b: Buffer) => {
      writes.push(b);
      return true;
    };

    // First frame is always accepted (no prior to compare against)
    capture.publish({ pngBytes: pngStub(1), phash: 0b0000n, timestamp: 100 });
    // Second frame: identical pHash → Hamming distance 0 → drop
    capture.publish({ pngBytes: pngStub(2), phash: 0b0000n, timestamp: 116 });
    // Third frame: 6 differing bits → Hamming distance 6 → accept
    capture.publish({ pngBytes: pngStub(3), phash: 0b111111n, timestamp: 132 });

    await new Promise((r) => setImmediate(r));

    // First and third forwarded; second dropped. Each forwarded frame is
    // length-prefix + bytes, so we expect 2 writes (or 4 if length and body are separate).
    const total = Buffer.concat(writes).length;
    expect(total).toBeGreaterThan(0);
    expect(producer.framesAccepted).toBe(2);
    expect(producer.framesDropped).toBe(1);
    await producer.stop();
  });
});
```

- [ ] **Step 2: Extend the producer implementation**

Modify `src/pipelines/temporal/producers/optical-flow.ts` — add the frame-source attachment, pHash gating, and length-prefix write helper.

Add to the imports:

```typescript
import type { Buffer as NodeBuffer } from 'node:buffer';
```

Add to `FlowProducerOptions`:

```typescript
  phashThreshold?: number;
```

Add a `KeyframeLike` type just above the class:

```typescript
interface KeyframeLike {
  pngBytes: Buffer;
  phash: bigint;
  timestamp: number;
}

interface FrameSource {
  on(event: 'keyframe', listener: (kf: KeyframeLike) => void): unknown;
  off(event: 'keyframe', listener: (kf: KeyframeLike) => void): unknown;
}
```

Add fields to the class:

```typescript
  private readonly phashThreshold: number;
  private lastAcceptedHash: bigint | null = null;
  private frameSource: FrameSource | null = null;
  private readonly keyframeListener: (kf: KeyframeLike) => void;
  public framesAccepted = 0;
  public framesDropped = 0;
```

Initialize `this.phashThreshold = opts.phashThreshold ?? 5;` in the constructor and bind the listener:

```typescript
  this.keyframeListener = (kf) => this.onKeyframe(kf);
```

Add methods:

```typescript
  attachFrameSource(source: FrameSource): void {
    if (this.frameSource) this.detachFrameSource();
    this.frameSource = source;
    source.on('keyframe', this.keyframeListener);
  }

  detachFrameSource(): void {
    if (!this.frameSource) return;
    this.frameSource.off('keyframe', this.keyframeListener);
    this.frameSource = null;
  }

  private onKeyframe(kf: KeyframeLike): void {
    if (this._disabled || !this.child) return;
    if (this.lastAcceptedHash !== null) {
      const distance = hammingDistance(this.lastAcceptedHash, kf.phash);
      if (distance < this.phashThreshold) {
        this.framesDropped += 1;
        return;
      }
    }
    this.lastAcceptedHash = kf.phash;
    this.framesAccepted += 1;
    this.writeLengthPrefixed(kf.pngBytes);
  }

  private writeLengthPrefixed(bytes: Buffer): void {
    if (!this.child?.stdin) return;
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32BE(bytes.length, 0);
    this.child.stdin.write(len);
    this.child.stdin.write(bytes);
  }
```

Add the helper at the bottom of the file (outside the class):

```typescript
function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x !== 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
```

Also update `stop()` to call `detachFrameSource()` first:

```typescript
  async stop(): Promise<void> {
    this.detachFrameSource();
    this.stopping = true;
    // ... existing code
  }
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run tests/unit/temporal/producers/optical-flow.test.ts --reporter=verbose`
Expected: previous 4 tests still pass + 1 new pHash gating test passes (5 total).

- [ ] **Step 4: Commit**

```bash
git add src/pipelines/temporal/producers/optical-flow.ts tests/unit/temporal/producers/optical-flow.test.ts
git commit -m "feat(temporal): FlowProducer pHash gating + length-prefixed frame writes"
```

---

## Task 14: ndjson parsing → typed events emission

**Files:**
- Modify: `src/pipelines/temporal/producers/optical-flow.ts`
- Modify: `tests/unit/temporal/producers/optical-flow.test.ts`

- [ ] **Step 1: Extend the test file with ndjson parsing tests**

Append to the test file:

```typescript
import { Readable as Readable2 } from 'node:stream';

describe('FlowProducer ndjson parsing', () => {
  let spawner: SidecarSpawner;
  let spawned: StubChild[];

  beforeEach(() => {
    spawned = [];
    spawner = vi.fn(() => {
      const child = new StubChild();
      spawned.push(child);
      return child as never;
    });
  });

  it('emits parsed events to listeners', async () => {
    const events: unknown[] = [];
    const producer = new FlowProducer({ binaryPath: '/fake', spawner });
    producer.on('event', (evt) => events.push(evt));
    await producer.start();
    const child = spawned[0]!;
    child.stdout.push(Buffer.from(
      JSON.stringify({
        type: 'optical-flow-region',
        ts: 200,
        frameTimestamp: 200,
        regionId: 'r1',
        bbox: { x: 0, y: 0, w: 10, h: 10 },
        primitives: {
          meanVelocity: { vx: 2, vy: 0 },
          divergence: 0,
          curl: 0,
          speedVariance: 0,
          pointCount: 50,
        },
      }) + '\n',
    ));
    child.stdout.push(null);
    await new Promise((r) => setTimeout(r, 10));
    expect(events.length).toBe(1);
    expect((events[0] as { type: string }).type).toBe('optical-flow-region');
    await producer.stop();
  });

  it('handles ndjson lines split across multiple chunks', async () => {
    const events: unknown[] = [];
    const producer = new FlowProducer({ binaryPath: '/fake', spawner });
    producer.on('event', (evt) => events.push(evt));
    await producer.start();
    const child = spawned[0]!;
    const json = JSON.stringify({
      type: 'optical-flow-motion',
      ts: 100,
      regionId: 'r1',
      pattern: 'translation',
      params: { direction: { vx: 1, vy: 0 }, speedPxPerSec: 180 },
      confidence: 0.9,
    });
    child.stdout.push(Buffer.from(json.slice(0, 20)));
    child.stdout.push(Buffer.from(json.slice(20) + '\n'));
    await new Promise((r) => setTimeout(r, 10));
    expect(events.length).toBe(1);
    await producer.stop();
  });

  it('drops malformed ndjson lines without crashing', async () => {
    const events: unknown[] = [];
    const producer = new FlowProducer({ binaryPath: '/fake', spawner });
    producer.on('event', (evt) => events.push(evt));
    await producer.start();
    const child = spawned[0]!;
    child.stdout.push(Buffer.from('not json at all\n'));
    child.stdout.push(Buffer.from(JSON.stringify({ type: 'optical-flow-region', ts: 1, frameTimestamp: 1, regionId: 'r', bbox: { x: 0, y: 0, w: 1, h: 1 }, primitives: { meanVelocity: { vx: 0, vy: 0 }, divergence: 0, curl: 0, speedVariance: 0, pointCount: 1 } }) + '\n'));
    await new Promise((r) => setTimeout(r, 10));
    expect(events.length).toBe(1);
    await producer.stop();
  });
});
```

- [ ] **Step 2: Add ndjson parsing to the producer**

Modify `src/pipelines/temporal/producers/optical-flow.ts`. Inside `spawnChild`, attach a stdout reader:

```typescript
  private stdoutBuffer = '';

  private spawnChild(): void {
    log.info({ binaryPath: this.binaryPath }, 'spawning sidecar');
    const child = this.spawner(this.binaryPath, []);
    this.child = child;
    this.stdoutBuffer = '';
    child.once('exit', (code, signal) => this.onExit(code, signal));
    child.stdout?.on('data', (chunk: Buffer) => this.onStdoutData(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim()) log.debug({ sidecar: line }, 'sidecar stderr');
      }
    });
  }

  private onStdoutData(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, nl);
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        this.emit('event', parsed);
      } catch (err) {
        log.warn({ line, err: String(err) }, 'malformed ndjson from sidecar');
      }
    }
  }
```

(Replace the existing `spawnChild` body with the above.)

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run tests/unit/temporal/producers/optical-flow.test.ts --reporter=verbose`
Expected: all 8 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/pipelines/temporal/producers/optical-flow.ts tests/unit/temporal/producers/optical-flow.test.ts
git commit -m "feat(temporal): FlowProducer parses ndjson into typed event stream"
```

---

## Task 15: `FlowCollector` — Collector interface implementation

**Files:**
- Create: `src/pipelines/temporal/collectors/optical-flow.ts`
- Create: `tests/unit/temporal/collectors/optical-flow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/temporal/collectors/optical-flow.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Page } from 'playwright';
import { FlowCollector } from '../../../../src/pipelines/temporal/collectors/optical-flow.js';
import { TemporalEventStream } from '../../../../src/pipelines/temporal/event-stream.js';

class FakeProducer extends EventEmitter {}

function fakePage(): Page {
  return {
    on: vi.fn(),
    off: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(0),
    exposeFunction: vi.fn().mockResolvedValue(undefined),
  } as unknown as Page;
}

describe('FlowCollector', () => {
  it('has the expected name', () => {
    const producer = new FakeProducer();
    const collector = new FlowCollector(producer as never);
    expect(collector.name).toBe('optical-flow');
  });

  it('pushes events to the stream on producer emissions', async () => {
    const producer = new FakeProducer();
    const collector = new FlowCollector(producer as never);
    const stream = new TemporalEventStream({ capacity: 100 });
    await stream.attach(fakePage(), [collector]);

    producer.emit('event', {
      type: 'optical-flow-region',
      ts: 200,
      frameTimestamp: 200,
      regionId: 'r1',
      bbox: { x: 0, y: 0, w: 10, h: 10 },
      primitives: {
        meanVelocity: { vx: 2, vy: 0 },
        divergence: 0,
        curl: 0,
        speedVariance: 0,
        pointCount: 50,
      },
    });

    const events = stream.getEvents({ types: ['optical-flow-region'] });
    expect(events.length).toBe(1);
    expect(events[0]!.payload.regionId).toBe('r1');
    await collector.detach();
  });

  it('ignores events with unknown types', async () => {
    const producer = new FakeProducer();
    const collector = new FlowCollector(producer as never);
    const stream = new TemporalEventStream({ capacity: 100 });
    await stream.attach(fakePage(), [collector]);
    producer.emit('event', { type: 'nope', ts: 0 });
    expect(stream.getEvents({}).length).toBe(0);
    await collector.detach();
  });
});
```

- [ ] **Step 2: Write the minimal implementation**

Create `src/pipelines/temporal/collectors/optical-flow.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import { createLogger } from '../../../utils/logger.js';
import { TemporalEventStream } from '../event-stream.js';
import type {
  Collector,
  EventType,
  OpticalFlowMotionPayload,
  OpticalFlowRawPayload,
  OpticalFlowRegionPayload,
  TimelineEvent,
} from './types.js';

interface ProducerLike {
  on(event: 'event', listener: (raw: unknown) => void): unknown;
  off(event: 'event', listener: (raw: unknown) => void): unknown;
}

const log = createLogger('flow-collector');
const OPTICAL_FLOW_TYPES: ReadonlySet<EventType> = new Set([
  'optical-flow-raw',
  'optical-flow-region',
  'optical-flow-motion',
]);

export class FlowCollector implements Collector {
  readonly name = 'optical-flow';
  private stream: TemporalEventStream | null = null;
  private readonly listener: (raw: unknown) => void;

  constructor(private readonly producer: ProducerLike) {
    this.listener = (raw) => this.handle(raw);
  }

  async attach(_page: Page, stream: TemporalEventStream): Promise<void> {
    this.stream = stream;
    this.producer.on('event', this.listener);
  }

  async detach(): Promise<void> {
    this.producer.off('event', this.listener);
    this.stream = null;
  }

  private handle(raw: unknown): void {
    if (!this.stream || !raw || typeof raw !== 'object') return;
    const evt = raw as Record<string, unknown>;
    const type = evt.type;
    if (typeof type !== 'string' || !OPTICAL_FLOW_TYPES.has(type as EventType)) return;

    const ts = typeof evt.ts === 'number' ? evt.ts : Date.now();
    const normalizer = this.stream.getNormalizer();
    const timestamp = normalizer ? normalizer.fromPerformanceNow(ts) : ts;

    if (type === 'optical-flow-raw') {
      const event: TimelineEvent<'optical-flow-raw'> = {
        id: randomUUID(),
        type: 'optical-flow-raw',
        timestamp,
        payload: extractRawPayload(evt),
      };
      this.stream.push(event);
    } else if (type === 'optical-flow-region') {
      const event: TimelineEvent<'optical-flow-region'> = {
        id: randomUUID(),
        type: 'optical-flow-region',
        timestamp,
        payload: extractRegionPayload(evt),
      };
      this.stream.push(event);
    } else if (type === 'optical-flow-motion') {
      const event: TimelineEvent<'optical-flow-motion'> = {
        id: randomUUID(),
        type: 'optical-flow-motion',
        timestamp,
        payload: extractMotionPayload(evt),
      };
      this.stream.push(event);
    } else {
      log.warn({ type }, 'unrecognized optical-flow event type after set check');
    }
  }
}

function extractRawPayload(evt: Record<string, unknown>): OpticalFlowRawPayload {
  return {
    frameTimestamp: Number(evt.frameTimestamp),
    keypoints: (evt.keypoints as OpticalFlowRawPayload['keypoints']) ?? [],
    gridSummary: (evt.gridSummary as OpticalFlowRawPayload['gridSummary']) ?? {
      cols: 0,
      rows: 0,
      vectors: [],
    },
  };
}

function extractRegionPayload(evt: Record<string, unknown>): OpticalFlowRegionPayload {
  return {
    frameTimestamp: Number(evt.frameTimestamp),
    regionId: String(evt.regionId),
    bbox: evt.bbox as OpticalFlowRegionPayload['bbox'],
    primitives: evt.primitives as OpticalFlowRegionPayload['primitives'],
  };
}

function extractMotionPayload(evt: Record<string, unknown>): OpticalFlowMotionPayload {
  return {
    endTs: typeof evt.endTs === 'number' ? evt.endTs : undefined,
    regionId: String(evt.regionId),
    pattern: evt.pattern as OpticalFlowMotionPayload['pattern'],
    params: evt.params as OpticalFlowMotionPayload['params'],
    confidence: Number(evt.confidence),
  };
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run tests/unit/temporal/collectors/optical-flow.test.ts --reporter=verbose`
Expected: 3 tests pass.

- [ ] **Step 4: Verify tsc clean**

Run: `pnpm exec tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/pipelines/temporal/collectors/optical-flow.ts tests/unit/temporal/collectors/optical-flow.test.ts
git commit -m "feat(temporal): FlowCollector pushes optical-flow events into stream"
```

---

## Task 16: Register FlowProducer + FlowCollector in server.ts

**Files:**
- Modify: `src/mcp/server.ts`

This task wires the pipeline into the MCP server. Read `server.ts` first to see exactly how the existing collectors are constructed and where `ensureStreamAttached` lives. The structure below mirrors the explore-agent report; verify against the actual file before editing.

- [ ] **Step 1: Read the existing `ensureStreamAttached` and surrounding scope**

Run: `pnpm exec grep -n "ensureStreamAttached\|eventStream\|streamAttachedTo" src/mcp/server.ts`

Note the imports and module-level variables. The flow pipeline needs:
- A module-level `FlowProducer` instance
- A `FrameCapture` instance the producer can subscribe to (likely already exists for the visual pipeline — find and reuse)
- The producer started + attached when the stream attaches; stopped on detach

- [ ] **Step 2: Add the imports at the top of `src/mcp/server.ts`**

```typescript
import { resolve } from 'node:path';
import { FlowProducer } from '../pipelines/temporal/producers/optical-flow.js';
import { FlowCollector } from '../pipelines/temporal/collectors/optical-flow.js';
```

- [ ] **Step 3: Add module-level state**

Near the existing `streamAttachedTo` variable, add:

```typescript
const FLOW_BINARY_PATH = process.env.UIPE_FLOW_BINARY ??
  resolve(process.cwd(), 'target/release/uipe-vision');

let flowProducer: FlowProducer | null = null;
let flowCollector: FlowCollector | null = null;
```

- [ ] **Step 4: Modify `ensureStreamAttached` to include the flow pipeline**

Replace the existing implementation with:

```typescript
async function ensureStreamAttached(): Promise<void> {
  const page = runtime.getPage();
  if (streamAttachedTo === page) return;

  // Construct the flow producer if not already disabled
  if (!flowProducer || flowProducer.disabled) {
    flowProducer = new FlowProducer({ binaryPath: FLOW_BINARY_PATH });
    flowProducer.on('disabled', () => {
      log.warn({ binaryPath: FLOW_BINARY_PATH }, 'optical-flow disabled after consecutive sidecar failures');
    });
  }

  // The FrameCapture instance must be obtained from the visual pipeline.
  // If your existing code references it differently, use that path.
  const frameCapture = runtime.getFrameCapture();
  if (frameCapture) {
    flowProducer.attachFrameSource(frameCapture);
  }
  await flowProducer.start();

  flowCollector = new FlowCollector(flowProducer);

  await eventStream.attach(page, [
    new InputCollector(),
    new NetworkCollector(),
    new AnimationCollector(),
    new MutationCollector(),
    flowCollector,
  ]);
  streamAttachedTo = page;
}
```

- [ ] **Step 5: Add cleanup on detach**

Find the function that handles detach (likely paired with `ensureStreamAttached`). If none exists, add:

```typescript
async function detachStream(): Promise<void> {
  await eventStream.detach();
  if (flowProducer) {
    await flowProducer.stop();
    flowProducer = null;
  }
  flowCollector = null;
  streamAttachedTo = null;
}
```

Call `detachStream` from the existing shutdown / page-close handler.

- [ ] **Step 6: Verify tsc clean**

Run: `pnpm exec tsc --noEmit`
Expected: zero errors. If `runtime.getFrameCapture()` doesn't exist, add it to the `runtime` module surface as a minimal getter that returns the existing frame-capture instance.

- [ ] **Step 7: Run all unit tests**

Run: `pnpm exec vitest run --reporter=verbose`
Expected: all previously passing tests still pass. Some server.ts tests may need updating to provide a mock `getFrameCapture` — adjust as needed.

- [ ] **Step 8: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat(mcp): wire FlowProducer + FlowCollector into ensureStreamAttached"
```

---

## Task 17: Integration test — real sidecar binary + synthetic frames

**Files:**
- Create: `tests/integration/optical-flow-pipeline.test.ts`

This test spawns the actual `uipe-vision` binary and verifies events flow end-to-end through the TypeScript pipeline. It is `describe.skipIf` gated on the model file being present so CI doesn't fail when the model isn't set up.

- [ ] **Step 1: Write the integration test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { FlowProducer } from '../../src/pipelines/temporal/producers/optical-flow.js';
import { FlowCollector } from '../../src/pipelines/temporal/collectors/optical-flow.js';
import { TemporalEventStream } from '../../src/pipelines/temporal/event-stream.js';
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import type { Page } from 'playwright';

const BIN = resolve(process.cwd(), 'target/release/uipe-vision');
const MODEL = resolve(process.cwd(), 'crates/uipe-vision/models/raft-small-int8.onnx');

class StubFrameCapture extends EventEmitter {
  publish(keyframe: { pngBytes: Buffer; phash: bigint; timestamp: number }): void {
    this.emit('keyframe', keyframe);
  }
}

function fakePage(): Page {
  return {
    on: () => {},
    off: () => {},
    evaluate: async () => 0,
    exposeFunction: async () => {},
  } as unknown as Page;
}

async function generateFrame(translateX: number): Promise<Buffer> {
  // Solid-grey background with a single bright rectangle at offset
  const w = 128;
  const h = 128;
  const channels = 3;
  const data = Buffer.alloc(w * h * channels, 50);
  for (let y = 32; y < 64; y += 1) {
    for (let x = 32 + translateX; x < 64 + translateX; x += 1) {
      if (x < 0 || x >= w) continue;
      const idx = (y * w + x) * channels;
      data[idx] = 230;
      data[idx + 1] = 230;
      data[idx + 2] = 230;
    }
  }
  return await sharp(data, { raw: { width: w, height: h, channels } }).png().toBuffer();
}

const modelAvailable = existsSync(BIN) && existsSync(MODEL);

describe.skipIf(!modelAvailable)('optical-flow pipeline integration', () => {
  it('produces region and motion events for a translated rectangle pair', async () => {
    const stream = new TemporalEventStream({ capacity: 1000 });
    const capture = new StubFrameCapture();
    const producer = new FlowProducer({
      binaryPath: BIN,
      spawner: (bin, args) => spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] }),
      phashThreshold: 0, // accept every frame in this test
    });
    const collector = new FlowCollector(producer);
    producer.attachFrameSource(capture);
    await producer.start();
    await stream.attach(fakePage(), [collector]);

    const frame_a = await generateFrame(0);
    const frame_b = await generateFrame(8);

    capture.publish({ pngBytes: frame_a, phash: 0n, timestamp: 100 });
    capture.publish({ pngBytes: frame_b, phash: 0xfffn, timestamp: 116 });

    // Wait for the sidecar to produce events
    await new Promise((r) => setTimeout(r, 3000));

    const regionEvents = stream.getEvents({ types: ['optical-flow-region'] });
    expect(regionEvents.length).toBeGreaterThan(0);

    const motionEvents = stream.getEvents({ types: ['optical-flow-motion'] });
    expect(motionEvents.length).toBeGreaterThan(0);
    expect(motionEvents.some((e) => e.payload.pattern === 'translation')).toBe(true);

    await producer.stop();
    await collector.detach();
  }, 30_000);
});
```

- [ ] **Step 2: Build the Rust binary if needed**

Run: `pnpm run build:rust`
Expected: binary at `target/release/uipe-vision`.

- [ ] **Step 3: Set up the ONNX model (if not done already)**

Run: `pnpm run setup:flow-model`
Expected: model downloaded to `crates/uipe-vision/models/raft-small-int8.onnx`. If the URL is still the placeholder from Task 2, do the prerequisite #3 work now — pick a real RAFT-small ONNX export, set the URL + SHA, and re-run.

- [ ] **Step 4: Run the integration test**

Run: `pnpm exec vitest run tests/integration/optical-flow-pipeline.test.ts --reporter=verbose`
Expected: if binary + model are present, PASS. If either missing, test is `skipIf`'d.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/optical-flow-pipeline.test.ts
git commit -m "test(optical-flow): end-to-end integration with real sidecar binary"
```

---

## Task 18: Evaluation script + fixture corpus

**Files:**
- Create: `bench/optical-flow-eval.ts`
- Create: `bench/fixtures/.gitkeep`
- Modify: `package.json`

- [ ] **Step 1: Create `bench/fixtures/.gitkeep`**

Empty file. Recorded animation fixtures (`.png` pairs or short PNG sequences) will live here. For v1, generate them programmatically inside the bench script; later sub-projects add real recorded clips.

- [ ] **Step 2: Create `bench/optical-flow-eval.ts`**

```typescript
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { FlowProducer } from '../src/pipelines/temporal/producers/optical-flow.js';
import { FlowCollector } from '../src/pipelines/temporal/collectors/optical-flow.js';
import { TemporalEventStream } from '../src/pipelines/temporal/event-stream.js';
import type { Page } from 'playwright';
import sharp from 'sharp';

interface SyntheticFixture {
  name: string;
  generate: (frame: number) => Promise<Buffer>;
  frameCount: number;
  expectedPattern: string;
}

const FIXTURES: SyntheticFixture[] = [
  {
    name: 'translation-right',
    frameCount: 8,
    expectedPattern: 'translation',
    generate: async (frame) => paintRectangle(8 * frame, 0),
  },
  {
    name: 'translation-down',
    frameCount: 8,
    expectedPattern: 'translation',
    generate: async (frame) => paintRectangle(0, 8 * frame),
  },
  {
    name: 'expand',
    frameCount: 8,
    expectedPattern: 'scale',
    generate: async (frame) => paintRectangle(0, 0, 32 + 4 * frame),
  },
];

async function paintRectangle(dx: number, dy: number, size = 32): Promise<Buffer> {
  const w = 128;
  const h = 128;
  const channels = 3;
  const data = Buffer.alloc(w * h * channels, 50);
  const left = 32 + dx;
  const top = 32 + dy;
  for (let y = top; y < top + size; y += 1) {
    for (let x = left; x < left + size; x += 1) {
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const idx = (y * w + x) * channels;
      data[idx] = 230;
      data[idx + 1] = 230;
      data[idx + 2] = 230;
    }
  }
  return await sharp(data, { raw: { width: w, height: h, channels } }).png().toBuffer();
}

function fakePage(): Page {
  return { on: () => {}, off: () => {}, evaluate: async () => 0, exposeFunction: async () => {} } as unknown as Page;
}

class StubFrameCapture extends EventEmitter {
  publish(kf: { pngBytes: Buffer; phash: bigint; timestamp: number }): void {
    this.emit('keyframe', kf);
  }
}

async function runFixture(bin: string, fixture: SyntheticFixture): Promise<{ regionCount: number; motionCount: number; classifications: string[]; latencies: number[] }> {
  const stream = new TemporalEventStream({ capacity: 10_000 });
  const capture = new StubFrameCapture();
  const latencies: number[] = [];

  const producer = new FlowProducer({
    binaryPath: bin,
    spawner: (b, args) => spawn(b, args, { stdio: ['pipe', 'pipe', 'pipe'] }),
    phashThreshold: 0,
  });
  const collector = new FlowCollector(producer);
  producer.attachFrameSource(capture);
  await producer.start();
  await stream.attach(fakePage(), [collector]);

  for (let i = 0; i < fixture.frameCount; i += 1) {
    const png = await fixture.generate(i);
    const start = performance.now();
    capture.publish({ pngBytes: png, phash: BigInt(i), timestamp: i * 16 });
    // Wait until at least one event arrives or 1s elapses
    await new Promise((r) => setTimeout(r, 200));
    latencies.push(performance.now() - start);
  }

  await new Promise((r) => setTimeout(r, 500));
  const regions = stream.getEvents({ types: ['optical-flow-region'] });
  const motions = stream.getEvents({ types: ['optical-flow-motion'] });

  await producer.stop();
  await collector.detach();

  return {
    regionCount: regions.length,
    motionCount: motions.length,
    classifications: motions.map((m) => m.payload.pattern),
    latencies,
  };
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx]!;
}

async function main(): Promise<void> {
  const bin = resolve(process.cwd(), 'target/release/uipe-vision');
  if (!existsSync(bin)) {
    console.error(`Binary missing: ${bin}. Run 'pnpm run build:rust' first.`);
    process.exit(1);
  }

  const lines: string[] = [];
  lines.push('fixture\texpected\tobserved\tregions\tmotions\tp50_ms\tp95_ms');
  for (const fixture of FIXTURES) {
    const result = await runFixture(bin, fixture);
    const observed = result.classifications[0] ?? '<none>';
    const p50 = percentile(result.latencies, 50);
    const p95 = percentile(result.latencies, 95);
    lines.push([
      fixture.name,
      fixture.expectedPattern,
      observed,
      result.regionCount,
      result.motionCount,
      p50.toFixed(1),
      p95.toFixed(1),
    ].join('\t'));
  }
  console.log(lines.join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Add `bench:flow` script to `package.json`**

```json
"bench:flow": "pnpm exec tsx bench/optical-flow-eval.ts",
```

- [ ] **Step 4: Run the script (smoke-only — requires binary + model)**

Run: `pnpm run bench:flow`
Expected: a tab-separated table of fixture results. If the binary or model is missing, the script errors clearly.

- [ ] **Step 5: Commit**

```bash
git add bench/optical-flow-eval.ts bench/fixtures/.gitkeep package.json
git commit -m "feat(bench): synthetic-fixture evaluation script for optical-flow"
```

---

## Task 19: Documentation updates

**Files:**
- Modify: `DEVELOPMENT.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Update `DEVELOPMENT.md`**

Add a new section near the build commands:

```markdown
## Optical flow sidecar (Rust)

UIPE includes a Rust sidecar `uipe-vision` that runs RAFT-small INT8 ONNX
optical flow on captured frames. Build and model setup:

```bash
# Install Rust toolchain if needed (https://rustup.rs)
rustup default stable

# Download the ONNX model (requires UIPE_FLOW_MODEL_URL + UIPE_FLOW_MODEL_SHA256 env
# vars, or finalize the placeholders in scripts/download-flow-model.ts)
pnpm run setup:flow-model

# Build the sidecar binary
pnpm run build:rust

# Binary lives at target/release/uipe-vision
# The TS layer auto-spawns it via the MCP server's ensureStreamAttached path.
# Override with UIPE_FLOW_BINARY env var if hosting it elsewhere.
```

To run the optical-flow evaluation against synthetic fixtures:

```bash
pnpm run bench:flow
```
```

- [ ] **Step 2: Update `docs/architecture.md` "Current implementation" table**

Find the row:

```
| Optical flow for animations | **Not yet built.** pHash diff in place; flow integration is part of v4 work. |
```

Replace with:

```
| Optical flow for animations | **Shipped** (PR TBD, merged 2026-MM-DD). Rust sidecar `uipe-vision` runs RAFT-small INT8 ONNX via the `ort` crate. Emits `optical-flow-raw`, `optical-flow-region`, `optical-flow-motion` events into `TemporalEventStream`. Follow-up: validate INT8 quantization accuracy on real UI fixtures; SEA-RAFT swap; GPU EP when MCPaaSTA lands. |
```

(Fill in the PR number and merge date when committing the final PR.)

- [ ] **Step 3: Commit**

```bash
git add DEVELOPMENT.md docs/architecture.md
git commit -m "docs: optical-flow build instructions + architecture status flip"
```

---

## Final verification

- [ ] **Step 1: Full unit-test suite**

Run: `pnpm exec vitest run --reporter=verbose`
Expected: all tests pass (existing 259 + new ~16 = ~275).

- [ ] **Step 2: Type check**

Run: `pnpm exec tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Rust unit tests**

Run: `cargo test -p uipe-vision --lib`
Expected: all unit tests pass (~18).

- [ ] **Step 4: Integration tests (if model available)**

Run: `pnpm exec vitest run tests/integration/optical-flow-pipeline.test.ts`
Expected: PASS if model file present, otherwise skipped.

- [ ] **Step 5: Smoke-test the MCP path**

In a separate terminal run the MCP server (existing command — likely `pnpm run dev` or similar — verify in `package.json`). Trigger a navigation and an animation; call `get_timeline` with `{ types: ['optical-flow-motion'] }`. Expected: at least one motion event appears for an actually-animated page.

If steps 1–4 all pass and step 5 produces a real motion event, the v1 pipeline is shipped.

---

## Spec Coverage Check

| Spec section | Implemented in task(s) |
|---|---|
| Goal: motion measurable, queryable via `get_timeline` | 11, 15, 16 |
| Primary consumer: introspectable timeline | 14 (ndjson), 15 (collector) |
| Three event kinds | 11 (types), 14 (parsing), 15 (push) |
| Rust sidecar — `uipe-vision` crate | 1, 3, 4, 9, 10 |
| RAFT-small INT8 ONNX via `ort` | 2, 3, 5 |
| DBSCAN clustering | 6 |
| Kinematic primitives | 7 |
| Pattern classifier (translation/scale/rotation/stillness) | 8 |
| stdin length-prefix protocol | 9 |
| stdout ndjson | 9, 10 |
| pHash gating | 13 |
| Graceful degradation on sidecar failure | 12 |
| FlowProducer + FlowCollector + server registration | 12, 15, 16 |
| Tests (Rust unit, TS unit, integration) | 3–10, 12–15, 17 |
| Evaluation script | 18 |
| Documentation updates | 19 |
