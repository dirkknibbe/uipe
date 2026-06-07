# Phase 2 — vision-svc (Qwen analyze track) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and validate the Qwen2.5-VL "analyze" vertical slice — a Python `vision-svc` serving `/v1/analyze`, the pinned `@uipe/contracts` `/v1` schema it speaks, and a real-GPU benchmark/eval on an ephemeral Fly A10 that confirms Qwen on real UIPE screenshots.

**Architecture:** A new Python FastAPI service (`packages/vision-svc/`) loads Qwen2.5-VL-7B and exposes `POST /v1/analyze` + `GET /v1/health`. The wire contract lives in `@uipe/contracts` and is enforced cross-language by shared JSON fixtures (TS+zod consumer side, Pydantic producer side). Failures are classified by control-flow position and exception type into a small `status`/`reason` enum — never by parsing error strings. The model runs only on an ephemeral A10 spun up for the bench/eval and torn down after.

**Tech Stack:** TypeScript + zod + vitest (contracts); Python 3.11 + FastAPI + Pydantic v2 + pytest (vision-svc); transformers + torch (CUDA) for Qwen2.5-VL; Fly.io A10 GPU; Docker (CUDA base).

**Spec:** [`docs/superpowers/specs/2026-06-07-personal-gpu-deploy-phase2-vision-svc-design.md`](../specs/2026-06-07-personal-gpu-deploy-phase2-vision-svc-design.md)

**Conventions:** TS imports use `.js` extensions. Type-check ground truth: `pnpm -r exec -- tsc --noEmit`. TS tests: `pnpm -F @uipe/contracts exec vitest run`. Python tests: `pytest` from `packages/vision-svc/`. No `Co-Authored-By` trailers on commits.

---

## File structure

**`packages/contracts/` (TS, extended):**
- Modify `src/index.ts` — add `VisionElement`, `VisionStatus`, `VisionReason`, `VisionAnalyzeResponse`, `VisionError`; extend `VisionAnalyzeRequest` with optional `request_id`.
- Create `src/schema.ts` — zod schemas mirroring the types (runtime validation).
- Create `fixtures/v1/*.json` — canonical request/response payloads (valid + invalid).
- Modify `tests/contracts.test.ts` — validate every fixture against the zod schemas.
- Modify `package.json` — add `zod` dependency.

**`packages/vision-svc/` (Python, new):**
- `pyproject.toml`, `requirements.txt`, `requirements-dev.txt`, `README.md`
- `app/__init__.py`, `app/config.py`, `app/schema.py`, `app/mapping.py`, `app/qwen.py`, `app/main.py`
- `bench/scoring.py`, `bench/run_bench.py`, `bench/golden/` (screenshots + `expected/*.json`)
- `tests/test_schema_fixtures.py`, `tests/test_mapping.py`, `tests/test_analyze_handler.py`, `tests/test_scoring.py`, `tests/fixtures/qwen_raw/*.txt`
- `Dockerfile`, `fly.toml`

Each file has one responsibility: `schema.py` = wire DTOs; `mapping.py` = Qwen-text → DTO (the only model-format-aware code); `qwen.py` = model load+infer; `main.py` = transport + the classification ladder; `bench/scoring.py` = pure metrics; `bench/run_bench.py` = the eval runner.

---

## Task 1: Fly A10 capacity/region gate (ops — verify early)

This is the spec's gating prerequisite. Not TDD — an ops check that must pass before sinking effort into the model code. Do this first; if it fails, stop and escalate.

**Files:** none (records findings in the commit message / `packages/vision-svc/README.md` later).

- [ ] **Step 1: Confirm Fly CLI auth**

Run: `fly auth whoami`
Expected: prints your Fly account email. If not, `fly auth login`.

- [ ] **Step 2: List GPU sizes and regions**

Run: `fly platform vm-sizes | grep -i a10` and `fly platform regions`
Expected: an `a10` GPU size is listed. Note 1-2 regions you want (e.g. `ord`, `iad`).

- [ ] **Step 3: Smoke-allocate a throwaway A10 machine**

```bash
fly apps create uipe-a10-capacity-check --machines
fly machine run nvidia/cuda:12.4.1-runtime-ubuntu22.04 \
  --app uipe-a10-capacity-check --vm-gpu-kind a10 --region ord \
  --command "nvidia-smi" --rm
```
Expected: the machine boots and `nvidia-smi` prints an A10 GPU table. A capacity/region error here is the signal to escalate (try another region, or revisit the substrate assumption) **before** proceeding.

- [ ] **Step 4: Tear down the check app**

```bash
fly apps destroy uipe-a10-capacity-check --yes
```
Expected: app destroyed. Record the working region for Task 12.

- [ ] **Step 5: Commit a note** (no code yet — record the gate result)

```bash
git commit --allow-empty -m "chore(phase2): confirm Fly A10 capacity in <region>"
```

---

## Task 2: Contracts `/v1` types + zod schema

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/schema.ts`
- Modify: `packages/contracts/package.json`
- Test: `packages/contracts/tests/contracts.test.ts` (extended in Task 3)

- [ ] **Step 1: Add `zod` to the contracts package**

Edit `packages/contracts/package.json` — add to `dependencies`:
```json
"zod": "^4.3.6"
```
Run: `pnpm install`
Expected: `zod` linked under `packages/contracts/node_modules`.

- [ ] **Step 2: Write the failing schema test** (extend the existing test file)

Add to `packages/contracts/tests/contracts.test.ts`:
```ts
import {
  visionAnalyzeResponseSchema,
  visionAnalyzeRequestSchema,
} from '../src/schema.js';

describe('vision /v1 zod schemas', () => {
  it('accepts a well-formed ok response', () => {
    const ok = {
      api_version: 'v1',
      request_id: 'r1',
      status: 'ok',
      elements: [{ label: 'button', confidence: 0.9, bbox: { x: 1, y: 2, w: 3, h: 4 } }],
      model_id: 'qwen2.5-vl-7b',
      latency_ms: 1200,
    };
    expect(() => visionAnalyzeResponseSchema.parse(ok)).not.toThrow();
  });

  it('rejects a non-ok response with no reason (discriminator invariant)', () => {
    const bad = {
      api_version: 'v1', request_id: 'r1', status: 'degraded',
      elements: [], model_id: 'qwen2.5-vl-7b', latency_ms: 5,
    };
    expect(() => visionAnalyzeResponseSchema.parse(bad)).toThrow();
  });

  it('rejects a request with a bad api_version', () => {
    expect(() => visionAnalyzeRequestSchema.parse({
      api_version: 'v2', png_base64: 'AAAA', regions: [],
    })).toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm -F @uipe/contracts exec vitest run`
Expected: FAIL — `Cannot find module '../src/schema.js'`.

- [ ] **Step 4: Add the types to `src/index.ts`** (finalize the wire as **snake_case** — the Phase-1 seed was camelCase placeholder)

Replace the existing `VisionAnalyzeRequest` block and append the new types:
```ts
export interface VisionElement {
  label: string;
  confidence: number;       // 0–1
  bbox: BBox;
  text?: string;
  is_interactable?: boolean;
  description?: string;
}

export type VisionStatus = 'ok' | 'warming' | 'degraded';
export type VisionReason =
  | 'model_loading'
  | 'inference_timeout'
  | 'inference_error'
  | 'unreachable';

export interface VisionAnalyzeRequest {
  api_version: typeof VISION_API_VERSION;
  png_base64: string;
  regions: BBox[];
  request_id?: string;
}

export interface VisionAnalyzeResponse {
  api_version: typeof VISION_API_VERSION;
  request_id: string;
  status: VisionStatus;
  elements: VisionElement[];
  model_id: string;
  latency_ms: number;
  reason?: VisionReason;
  retry_after_ms?: number;
  message?: string;
}

export interface VisionError {
  api_version: typeof VISION_API_VERSION;
  request_id: string;
  error: { code: string; message: string };
}
```
The Phase-1 seed used camelCase (`apiVersion`/`pngBase64`) as a placeholder; Phase 2 finalizes the wire as snake_case throughout. **This requires updating the existing seed boundary test** in `packages/contracts/tests/contracts.test.ts` — change its request-construction literal to the snake_case form:
```ts
const req: VisionAnalyzeRequest = { api_version: 'v1', png_base64: 'AAAA', regions: [] };
```
(The `VISION_API_VERSION === 'v1'` assertion is unchanged.)

- [ ] **Step 5: Create `src/schema.ts`**

```ts
import { z } from 'zod';

export const bboxSchema = z.object({
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
});

export const visionElementSchema = z.object({
  label: z.string(),
  confidence: z.number().min(0).max(1),
  bbox: bboxSchema,
  text: z.string().optional(),
  is_interactable: z.boolean().optional(),
  description: z.string().optional(),
});

export const visionStatusSchema = z.enum(['ok', 'warming', 'degraded']);
export const visionReasonSchema = z.enum([
  'model_loading', 'inference_timeout', 'inference_error', 'unreachable',
]);

export const visionAnalyzeRequestSchema = z.object({
  api_version: z.literal('v1'),
  png_base64: z.string(),
  regions: z.array(bboxSchema),
  request_id: z.string().optional(),
});

export const visionAnalyzeResponseSchema = z
  .object({
    api_version: z.literal('v1'),
    request_id: z.string(),
    status: visionStatusSchema,
    elements: z.array(visionElementSchema),
    model_id: z.string(),
    latency_ms: z.number(),
    reason: visionReasonSchema.optional(),
    retry_after_ms: z.number().optional(),
    message: z.string().optional(),
  })
  .refine((r) => r.status === 'ok' || r.reason !== undefined, {
    message: 'reason is required when status is not ok',
    path: ['reason'],
  });

export const visionErrorSchema = z.object({
  api_version: z.literal('v1'),
  request_id: z.string(),
  error: z.object({ code: z.string(), message: z.string() }),
});
```
> The request schema and the `VisionAnalyzeRequest` interface are both snake_case, matching the canonical fixtures (the wire form). One casing across types, zod, Pydantic, and fixtures — no interface↔wire mapping needed for the request.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm -F @uipe/contracts exec vitest run`
Expected: PASS (3 new + the 2 existing boundary tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm -F @uipe/contracts exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src packages/contracts/package.json packages/contracts/tests pnpm-lock.yaml
git commit -m "feat(contracts): add /v1 analyze response schema + zod validation"
```

---

## Task 3: Canonical JSON fixtures + TS fixture validation

**Files:**
- Create: `packages/contracts/fixtures/v1/analyze.request.json`
- Create: `packages/contracts/fixtures/v1/analyze.response.ok.json`
- Create: `packages/contracts/fixtures/v1/analyze.response.warming.json`
- Create: `packages/contracts/fixtures/v1/analyze.response.degraded.json`
- Create: `packages/contracts/fixtures/v1/analyze.response.invalid-missing-reason.json`
- Create: `packages/contracts/fixtures/v1/analyze.request.invalid-bad-version.json`
- Test: `packages/contracts/tests/fixtures.test.ts`

- [ ] **Step 1: Write the valid fixtures**

`analyze.request.json`:
```json
{ "api_version": "v1", "png_base64": "iVBORw0KGgo=", "regions": [], "request_id": "req-123" }
```
`analyze.response.ok.json`:
```json
{
  "api_version": "v1", "request_id": "req-123", "status": "ok",
  "elements": [
    { "label": "button", "confidence": 0.94, "bbox": { "x": 12, "y": 40, "w": 88, "h": 32 }, "text": "Submit", "is_interactable": true }
  ],
  "model_id": "Qwen/Qwen2.5-VL-7B-Instruct", "latency_ms": 3120
}
```
`analyze.response.warming.json`:
```json
{
  "api_version": "v1", "request_id": "req-123", "status": "warming",
  "elements": [], "model_id": "Qwen/Qwen2.5-VL-7B-Instruct", "latency_ms": 2,
  "reason": "model_loading", "retry_after_ms": 45000
}
```
`analyze.response.degraded.json`:
```json
{
  "api_version": "v1", "request_id": "req-123", "status": "degraded",
  "elements": [], "model_id": "Qwen/Qwen2.5-VL-7B-Instruct", "latency_ms": 8000,
  "reason": "inference_timeout", "retry_after_ms": 1000, "message": "TimeoutError: inference exceeded 8s"
}
```

- [ ] **Step 2: Write the invalid fixtures**

`analyze.response.invalid-missing-reason.json` (degraded without reason — must be rejected):
```json
{ "api_version": "v1", "request_id": "req-1", "status": "degraded", "elements": [], "model_id": "m", "latency_ms": 5 }
```
`analyze.request.invalid-bad-version.json`:
```json
{ "api_version": "v2", "png_base64": "AAAA", "regions": [] }
```

- [ ] **Step 3: Write the failing fixture test**

`packages/contracts/tests/fixtures.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  visionAnalyzeRequestSchema,
  visionAnalyzeResponseSchema,
} from '../src/schema.js';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/v1');
const load = (f: string) => JSON.parse(readFileSync(resolve(dir, f), 'utf-8'));

describe('canonical /v1 fixtures (cross-language source of truth)', () => {
  it('valid request fixture parses', () => {
    expect(() => visionAnalyzeRequestSchema.parse(load('analyze.request.json'))).not.toThrow();
  });
  it.each(['analyze.response.ok.json', 'analyze.response.warming.json', 'analyze.response.degraded.json'])(
    'valid response fixture parses: %s',
    (f) => expect(() => visionAnalyzeResponseSchema.parse(load(f))).not.toThrow(),
  );
  it('invalid response fixture is rejected', () => {
    expect(() => visionAnalyzeResponseSchema.parse(load('analyze.response.invalid-missing-reason.json'))).toThrow();
  });
  it('invalid request fixture is rejected', () => {
    expect(() => visionAnalyzeRequestSchema.parse(load('analyze.request.invalid-bad-version.json'))).toThrow();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm -F @uipe/contracts exec vitest run tests/fixtures.test.ts`
Expected: PASS (fixtures written in Steps 1-2 satisfy the schemas). If a valid fixture fails, fix the fixture; if an invalid one passes, the schema is too loose — fix `schema.ts`.

- [ ] **Step 5: Ensure fixtures ship with the package**

Edit `packages/contracts/package.json` `files` array to include `"fixtures"` so the JSON is packaged:
```json
"files": ["dist", "fixtures"]
```

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/fixtures packages/contracts/tests/fixtures.test.ts packages/contracts/package.json
git commit -m "test(contracts): canonical /v1 JSON fixtures validated against zod"
```

---

## Task 4: vision-svc Python scaffold

**Files:**
- Create: `packages/vision-svc/pyproject.toml`
- Create: `packages/vision-svc/requirements.txt`
- Create: `packages/vision-svc/requirements-dev.txt`
- Create: `packages/vision-svc/app/__init__.py` (empty)
- Create: `packages/vision-svc/app/config.py`
- Create: `packages/vision-svc/tests/__init__.py` (empty)
- Create: `packages/vision-svc/tests/test_config.py`

- [ ] **Step 1: Create `pyproject.toml`** (pytest config + package metadata; no torch pin here — Linux/CUDA target)

```toml
[project]
name = "uipe-vision-svc"
version = "0.1.0"
requires-python = ">=3.11"

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-v"

[tool.setuptools.packages.find]
include = ["app*"]
```

- [ ] **Step 2: Create dependency files**

`requirements.txt` (runtime — versions are CUDA/Linux, NOT the Mac torch 2.2.2 pin):
```
fastapi>=0.115,<1
uvicorn[standard]>=0.30,<1
pydantic>=2.7,<3
pillow>=10.3
# model deps (installed in the CUDA image; see Dockerfile):
# torch (CUDA build), transformers>=4.49 (Qwen2.5-VL support), accelerate, qwen-vl-utils
```
`requirements-dev.txt`:
```
-r requirements.txt
pytest>=8
httpx>=0.27        # FastAPI TestClient dependency
```

- [ ] **Step 3: Write the failing config test**

`tests/test_config.py`:
```python
from app.config import Config

def test_defaults():
    cfg = Config.from_env({})
    assert cfg.model_id == "Qwen/Qwen2.5-VL-7B-Instruct"
    assert cfg.inference_timeout_s == 8.0
    assert cfg.warming_retry_after_ms == 45000

def test_env_override():
    cfg = Config.from_env({"VISION_MODEL_ID": "custom/model", "VISION_TIMEOUT_S": "12"})
    assert cfg.model_id == "custom/model"
    assert cfg.inference_timeout_s == 12.0
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd packages/vision-svc && python -m pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.config'`.

- [ ] **Step 5: Create `app/config.py`**

```python
from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class Config:
    model_id: str = "Qwen/Qwen2.5-VL-7B-Instruct"
    inference_timeout_s: float = 8.0
    warming_retry_after_ms: int = 45000
    retryable_backoff_ms: int = 1000

    @staticmethod
    def from_env(env: Mapping[str, str]) -> "Config":
        return Config(
            model_id=env.get("VISION_MODEL_ID", Config.model_id),
            inference_timeout_s=float(env.get("VISION_TIMEOUT_S", Config.inference_timeout_s)),
            warming_retry_after_ms=int(env.get("VISION_WARMING_RETRY_MS", Config.warming_retry_after_ms)),
            retryable_backoff_ms=int(env.get("VISION_RETRY_BACKOFF_MS", Config.retryable_backoff_ms)),
        )
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/vision-svc && python -m pytest tests/test_config.py -v`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/vision-svc/pyproject.toml packages/vision-svc/requirements*.txt packages/vision-svc/app/__init__.py packages/vision-svc/app/config.py packages/vision-svc/tests
git commit -m "feat(vision-svc): python scaffold + config"
```

---

## Task 5: Pydantic `/v1` schema + shared-fixture validation

**Files:**
- Create: `packages/vision-svc/app/schema.py`
- Test: `packages/vision-svc/tests/test_schema_fixtures.py`

- [ ] **Step 1: Write the failing shared-fixture test**

`tests/test_schema_fixtures.py` — validates the SAME canonical fixtures the TS side uses:
```python
import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from app.schema import VisionAnalyzeRequest, VisionAnalyzeResponse

FIX = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "v1"

def _load(name): return json.loads((FIX / name).read_text())

def test_valid_request_fixture():
    VisionAnalyzeRequest.model_validate(_load("analyze.request.json"))

@pytest.mark.parametrize("name", [
    "analyze.response.ok.json",
    "analyze.response.warming.json",
    "analyze.response.degraded.json",
])
def test_valid_response_fixtures(name):
    VisionAnalyzeResponse.model_validate(_load(name))

def test_invalid_response_missing_reason_rejected():
    with pytest.raises(ValidationError):
        VisionAnalyzeResponse.model_validate(_load("analyze.response.invalid-missing-reason.json"))

def test_invalid_request_bad_version_rejected():
    with pytest.raises(ValidationError):
        VisionAnalyzeRequest.model_validate(_load("analyze.request.invalid-bad-version.json"))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/vision-svc && python -m pytest tests/test_schema_fixtures.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.schema'`.

- [ ] **Step 3: Create `app/schema.py`** (mirrors the TS types; same wire field names)

```python
from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator

VisionStatus = Literal["ok", "warming", "degraded"]
VisionReason = Literal["model_loading", "inference_timeout", "inference_error", "unreachable"]


class BBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class VisionElement(BaseModel):
    label: str
    confidence: float = Field(ge=0.0, le=1.0)
    bbox: BBox
    text: Optional[str] = None
    is_interactable: Optional[bool] = None
    description: Optional[str] = None


class VisionAnalyzeRequest(BaseModel):
    api_version: Literal["v1"]
    png_base64: str
    regions: list[BBox]
    request_id: Optional[str] = None


class VisionAnalyzeResponse(BaseModel):
    api_version: Literal["v1"] = "v1"
    request_id: str
    status: VisionStatus
    elements: list[VisionElement]
    model_id: str
    latency_ms: float
    reason: Optional[VisionReason] = None
    retry_after_ms: Optional[int] = None
    message: Optional[str] = None

    @model_validator(mode="after")
    def _reason_required_when_not_ok(self):
        if self.status != "ok" and self.reason is None:
            raise ValueError("reason is required when status is not ok")
        return self


class VisionError(BaseModel):
    api_version: Literal["v1"] = "v1"
    request_id: str
    error: dict  # {"code": str, "message": str}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/vision-svc && python -m pytest tests/test_schema_fixtures.py -v`
Expected: PASS (5 tests). This proves both languages agree on the same fixtures.

- [ ] **Step 5: Commit**

```bash
git add packages/vision-svc/app/schema.py packages/vision-svc/tests/test_schema_fixtures.py
git commit -m "feat(vision-svc): pydantic /v1 schema validated against shared contract fixtures"
```

---

## Task 6: `mapping.py` — Qwen text → contract elements

**Files:**
- Create: `packages/vision-svc/app/mapping.py`
- Create: `packages/vision-svc/tests/fixtures/qwen_raw/good.txt`
- Create: `packages/vision-svc/tests/fixtures/qwen_raw/fenced.txt`
- Create: `packages/vision-svc/tests/fixtures/qwen_raw/malformed.txt`
- Test: `packages/vision-svc/tests/test_mapping.py`

The model is prompted to emit a JSON array of detections (see Task 8). `mapping.py` is the ONLY model-format-aware code; it extracts and validates that JSON into `VisionElement`s, insulating `core` from Qwen specifics.

- [ ] **Step 1: Write the recorded raw-output fixtures**

`good.txt` (bare JSON array — what we ask Qwen for):
```
[{"label": "button", "confidence": 0.94, "bbox": {"x": 12, "y": 40, "w": 88, "h": 32}, "text": "Submit", "is_interactable": true}, {"label": "input", "confidence": 0.8, "bbox": {"x": 0, "y": 0, "w": 200, "h": 30}}]
```
`fenced.txt` (Qwen often wraps in a markdown fence + prose — mapping must tolerate it):
```
Here are the detected elements:
```json
[{"label": "link", "confidence": 0.71, "bbox": {"x": 5, "y": 5, "w": 50, "h": 18}}]
```
```
`malformed.txt`:
```
I could not find any clearly interactable elements in this region.
```

- [ ] **Step 2: Write the failing mapping test**

`tests/test_mapping.py`:
```python
from pathlib import Path
import pytest
from app.mapping import parse_qwen_output, QwenParseError

RAW = Path(__file__).resolve().parent / "fixtures" / "qwen_raw"

def test_parses_bare_json_array():
    els = parse_qwen_output((RAW / "good.txt").read_text())
    assert len(els) == 2
    assert els[0].label == "button"
    assert els[0].is_interactable is True
    assert els[1].bbox.w == 200

def test_parses_fenced_json_with_prose():
    els = parse_qwen_output((RAW / "fenced.txt").read_text())
    assert len(els) == 1
    assert els[0].label == "link"

def test_malformed_output_raises():
    with pytest.raises(QwenParseError):
        parse_qwen_output((RAW / "malformed.txt").read_text())

def test_confidence_clamped_to_unit_range():
    els = parse_qwen_output('[{"label":"x","confidence":1.5,"bbox":{"x":0,"y":0,"w":1,"h":1}}]')
    assert els[0].confidence == 1.0
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/vision-svc && python -m pytest tests/test_mapping.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.mapping'`.

- [ ] **Step 4: Create `app/mapping.py`**

```python
import json
import re
from app.schema import VisionElement, BBox


class QwenParseError(ValueError):
    """Raised when the model output cannot be parsed into a detection array.
    Surfaced upstream as status=degraded reason=inference_error."""


_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def _extract_json_array(text: str) -> str:
    m = _FENCE.search(text)
    if m:
        text = m.group(1)
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1 or end < start:
        raise QwenParseError("no JSON array found in model output")
    return text[start : end + 1]


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def parse_qwen_output(text: str) -> list[VisionElement]:
    raw = _extract_json_array(text)
    try:
        items = json.loads(raw)
    except json.JSONDecodeError as e:
        raise QwenParseError(f"invalid JSON: {e}") from e
    if not isinstance(items, list):
        raise QwenParseError("model output is not a JSON array")

    elements: list[VisionElement] = []
    for it in items:
        b = it["bbox"]
        elements.append(
            VisionElement(
                label=str(it["label"]),
                confidence=_clamp(float(it.get("confidence", 0.5)), 0.0, 1.0),
                bbox=BBox(x=float(b["x"]), y=float(b["y"]), w=float(b["w"]), h=float(b["h"])),
                text=it.get("text"),
                is_interactable=it.get("is_interactable"),
                description=it.get("description"),
            )
        )
    return elements
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/vision-svc && python -m pytest tests/test_mapping.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/vision-svc/app/mapping.py packages/vision-svc/tests/test_mapping.py packages/vision-svc/tests/fixtures/qwen_raw
git commit -m "feat(vision-svc): qwen-output -> contract mapping with tolerant JSON extraction"
```

---

## Task 7: FastAPI app + classification ladder

**Files:**
- Create: `packages/vision-svc/app/main.py`
- Test: `packages/vision-svc/tests/test_analyze_handler.py`

The handler is the classification ladder from the spec. The model is behind an `Analyzer` protocol so tests inject a fake — no GPU needed.

- [ ] **Step 1: Write the failing handler tests**

`tests/test_analyze_handler.py`:
```python
import asyncio
import pytest
from fastapi.testclient import TestClient
from app.main import create_app, Analyzer

class FakeAnalyzer(Analyzer):
    def __init__(self, ready=True, model_id="fake-model", behavior="ok"):
        self._ready = ready
        self.model_id = model_id
        self.behavior = behavior  # "ok" | "timeout" | "error"
    @property
    def ready(self): return self._ready
    async def infer(self, png_base64, regions):
        if self.behavior == "timeout":
            await asyncio.sleep(10)  # exceeds the test timeout
        if self.behavior == "error":
            raise RuntimeError("boom")
        return '[{"label":"button","confidence":0.9,"bbox":{"x":1,"y":2,"w":3,"h":4}}]'

def _client(analyzer, timeout_s=0.05):
    return TestClient(create_app(analyzer, timeout_s=timeout_s))

REQ = {"api_version": "v1", "png_base64": "AAAA", "regions": []}

def test_ok_path():
    r = _client(FakeAnalyzer()).post("/v1/analyze", json=REQ)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["elements"][0]["label"] == "button"
    assert body["request_id"]  # generated when absent

def test_warming_when_model_not_ready():
    r = _client(FakeAnalyzer(ready=False)).post("/v1/analyze", json=REQ)
    body = r.json()
    assert body["status"] == "warming"
    assert body["reason"] == "model_loading"
    assert body["elements"] == []
    assert body["retry_after_ms"] > 0

def test_degraded_on_timeout():
    r = _client(FakeAnalyzer(behavior="timeout"), timeout_s=0.05).post("/v1/analyze", json=REQ)
    body = r.json()
    assert body["status"] == "degraded"
    assert body["reason"] == "inference_timeout"

def test_degraded_on_inference_error_carries_opaque_message():
    r = _client(FakeAnalyzer(behavior="error")).post("/v1/analyze", json=REQ)
    body = r.json()
    assert body["status"] == "degraded"
    assert body["reason"] == "inference_error"
    assert "RuntimeError" in body["message"]

def test_echoes_caller_request_id():
    r = _client(FakeAnalyzer()).post("/v1/analyze", json={**REQ, "request_id": "caller-xyz"})
    assert r.json()["request_id"] == "caller-xyz"

def test_health_reports_readiness():
    assert _client(FakeAnalyzer(ready=True)).get("/v1/health").json()["ready"] is True
    assert _client(FakeAnalyzer(ready=False)).get("/v1/health").json()["ready"] is False

def test_malformed_request_returns_4xx_vision_error():
    r = _client(FakeAnalyzer()).post("/v1/analyze", json={"api_version": "v2", "png_base64": "x", "regions": []})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_request"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/vision-svc && python -m pytest tests/test_analyze_handler.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.main'`.

- [ ] **Step 3: Create `app/main.py`**

```python
import asyncio
import logging
import time
import uuid
from typing import Protocol

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import Config
from app.mapping import parse_qwen_output
from app.schema import VisionAnalyzeRequest, VisionAnalyzeResponse

log = logging.getLogger("vision-svc")


class Analyzer(Protocol):
    model_id: str
    @property
    def ready(self) -> bool: ...
    async def infer(self, png_base64: str, regions: list) -> str: ...


def create_app(analyzer: Analyzer, timeout_s: float | None = None) -> FastAPI:
    cfg = Config.from_env({})
    timeout = timeout_s if timeout_s is not None else cfg.inference_timeout_s
    app = FastAPI(title="uipe-vision-svc")

    @app.exception_handler(RequestValidationError)
    async def _on_validation_error(request: Request, exc: RequestValidationError):
        rid = (request.headers.get("x-request-id") or str(uuid.uuid4()))
        return JSONResponse(
            status_code=422,
            content={"api_version": "v1", "request_id": rid,
                     "error": {"code": "invalid_request", "message": str(exc.errors())}},
        )

    @app.get("/v1/health")
    async def health():
        return {"ready": analyzer.ready, "model_id": analyzer.model_id}

    @app.post("/v1/analyze")
    async def analyze(req: VisionAnalyzeRequest) -> VisionAnalyzeResponse:
        rid = req.request_id or str(uuid.uuid4())

        if not analyzer.ready:
            return VisionAnalyzeResponse(
                request_id=rid, status="warming", elements=[], model_id=analyzer.model_id,
                latency_ms=0.0, reason="model_loading", retry_after_ms=cfg.warming_retry_after_ms,
            )

        t0 = time.perf_counter()
        elapsed = lambda: (time.perf_counter() - t0) * 1000.0
        try:
            raw = await asyncio.wait_for(
                analyzer.infer(req.png_base64, req.regions), timeout=timeout
            )
            elements = parse_qwen_output(raw)
            return VisionAnalyzeResponse(
                request_id=rid, status="ok", elements=elements,
                model_id=analyzer.model_id, latency_ms=elapsed(),
            )
        except asyncio.TimeoutError:
            return VisionAnalyzeResponse(
                request_id=rid, status="degraded", elements=[], model_id=analyzer.model_id,
                latency_ms=elapsed(), reason="inference_timeout", retry_after_ms=cfg.retryable_backoff_ms,
                message=f"inference exceeded {timeout}s",
            )
        except Exception as e:  # honest catch-all; raw detail to logs, opaque message on the wire
            log.exception("inference failed", extra={"request_id": rid})
            return VisionAnalyzeResponse(
                request_id=rid, status="degraded", elements=[], model_id=analyzer.model_id,
                latency_ms=elapsed(), reason="inference_error", message=f"{type(e).__name__}: {e}",
            )

    return app
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/vision-svc && python -m pytest tests/test_analyze_handler.py -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the whole vision-svc suite**

Run: `cd packages/vision-svc && python -m pytest -v`
Expected: PASS (config + schema-fixtures + mapping + handler).

- [ ] **Step 6: Commit**

```bash
git add packages/vision-svc/app/main.py packages/vision-svc/tests/test_analyze_handler.py
git commit -m "feat(vision-svc): /v1/analyze handler with status/reason classification ladder"
```

---

## Task 8: `qwen.py` — model load + inference (GPU-validated, not unit-tested)

**Files:**
- Create: `packages/vision-svc/app/qwen.py`

> This code runs ONLY on the A10 — it cannot be unit-tested on the Mac. It is validated by the golden eval (Task 12). Before relying on the exact transformers API below, verify it against the current Qwen2.5-VL model card (transformers ≥4.49 introduced `Qwen2_5_VLForConditionalGeneration`); the processor/`generate` surface shifts between releases. (Offer: a context7 lookup of "Qwen2.5-VL transformers usage" at implementation time.)

- [ ] **Step 1: Write `app/qwen.py`**

```python
import asyncio
import base64
import io
import threading
from PIL import Image
from app.config import Config

DETECTION_PROMPT = (
    "Detect the UI elements in this screenshot. Return ONLY a JSON array; each item: "
    '{"label": one of [button,input,link,image,text,icon,dropdown,checkbox,radio,tab,other], '
    '"confidence": 0..1, "bbox": {"x","y","w","h"} in pixels, '
    '"text": visible text or null, "is_interactable": bool}. No prose.'
)


class QwenAnalyzer:
    """Lazy-loads Qwen2.5-VL on first construction in a background thread so the
    server can answer /v1/health and return status=warming until ready."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.model_id = cfg.model_id
        self._ready = False
        self._model = None
        self._processor = None
        threading.Thread(target=self._load, daemon=True).start()

    @property
    def ready(self) -> bool:
        return self._ready

    def _load(self) -> None:
        import torch
        from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration

        self._model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            self.model_id, torch_dtype=torch.bfloat16, device_map="cuda",
        )  # safetensors by default; if any .bin weights, transformers must use weights_only
        self._processor = AutoProcessor.from_pretrained(self.model_id)
        self._ready = True

    async def infer(self, png_base64: str, regions: list) -> str:
        # Offload the blocking generate() to a thread so the event loop (and the
        # asyncio.wait_for timeout in the handler) stays responsive.
        return await asyncio.to_thread(self._infer_sync, png_base64)

    def _infer_sync(self, png_base64: str) -> str:
        from qwen_vl_utils import process_vision_info

        image = Image.open(io.BytesIO(base64.b64decode(png_base64))).convert("RGB")
        messages = [{"role": "user", "content": [
            {"type": "image", "image": image},
            {"type": "text", "text": DETECTION_PROMPT},
        ]}]
        text = self._processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        image_inputs, video_inputs = process_vision_info(messages)
        inputs = self._processor(text=[text], images=image_inputs, videos=video_inputs,
                                 padding=True, return_tensors="pt").to("cuda")
        out = self._model.generate(**inputs, max_new_tokens=1024)
        trimmed = [o[len(i):] for i, o in zip(inputs.input_ids, out)]
        return self._processor.batch_decode(trimmed, skip_special_tokens=True)[0]
```

- [ ] **Step 2: Wire the real analyzer into an app entrypoint**

Append to `app/main.py`:
```python
def build_default_app() -> FastAPI:
    from app.qwen import QwenAnalyzer
    cfg = Config.from_env(__import__("os").environ)
    return create_app(QwenAnalyzer(cfg))


# uvicorn entrypoint: `uvicorn app.main:app`
app = None  # set lazily to avoid importing torch during unit tests
def __getattr__(name):  # module-level lazy attribute (PEP 562)
    if name == "app":
        return build_default_app()
    raise AttributeError(name)
```

- [ ] **Step 3: Confirm unit tests still pass (no torch import triggered)**

Run: `cd packages/vision-svc && python -m pytest -v`
Expected: PASS — importing `app.main` for tests must NOT import torch (the lazy `__getattr__` ensures `build_default_app` only runs when uvicorn accesses `app`).

- [ ] **Step 4: Commit**

```bash
git add packages/vision-svc/app/qwen.py packages/vision-svc/app/main.py
git commit -m "feat(vision-svc): Qwen2.5-VL analyzer (lazy GPU load, threaded inference)"
```

---

## Task 9: Dockerfile (CUDA) + Fly config

**Files:**
- Create: `packages/vision-svc/Dockerfile`
- Create: `packages/vision-svc/fly.toml`

> Validated by the ephemeral deploy in Task 12, not by a unit test. Verify the CUDA base tag and the Fly GPU stanza against current Fly docs at deploy time.

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3-pip git && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
# CUDA torch wheel + model libs (pinned at build; these are Linux/CUDA, free of the Mac 2.2.2 pin)
RUN pip3 install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu124 \
 && pip3 install --no-cache-dir "transformers>=4.49,<5" accelerate qwen-vl-utils \
 && pip3 install --no-cache-dir -r requirements.txt

COPY app ./app
ENV VISION_MODEL_ID=Qwen/Qwen2.5-VL-7B-Instruct
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Write the ephemeral `fly.toml`** (GPU, auto-stop, scale-to-zero)

```toml
app = "uipe-vision-svc-bench"
primary_region = "ord"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8000
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = "a10"
  memory = "16gb"
```

- [ ] **Step 3: Local Docker build sanity check** (no GPU needed to validate the build graph; skip the run)

Run: `cd packages/vision-svc && docker build -t uipe-vision-svc:local . 2>&1 | tail -5` (optional — skip if Docker/disk is constrained on the Mac; the real build happens on Fly)
Expected: build completes, or is deferred to the Fly build in Task 12.

- [ ] **Step 4: Commit**

```bash
git add packages/vision-svc/Dockerfile packages/vision-svc/fly.toml
git commit -m "feat(vision-svc): CUDA Dockerfile + ephemeral Fly A10 config"
```

---

## Task 10: Bench scoring functions

**Files:**
- Create: `packages/vision-svc/bench/__init__.py` (empty)
- Create: `packages/vision-svc/bench/scoring.py`
- Test: `packages/vision-svc/tests/test_scoring.py`

Pure functions — fully TDD-able. These define the acceptance bar from the spec (interactable recall, IoU ≥ 0.5).

- [ ] **Step 1: Write the failing scoring test**

`tests/test_scoring.py`:
```python
from bench.scoring import iou, interactable_recall

def test_iou_identical_boxes_is_one():
    b = {"x": 0, "y": 0, "w": 10, "h": 10}
    assert iou(b, b) == 1.0

def test_iou_disjoint_boxes_is_zero():
    assert iou({"x": 0, "y": 0, "w": 10, "h": 10}, {"x": 100, "y": 100, "w": 10, "h": 10}) == 0.0

def test_iou_half_overlap():
    a = {"x": 0, "y": 0, "w": 10, "h": 10}
    b = {"x": 5, "y": 0, "w": 10, "h": 10}
    assert abs(iou(a, b) - (50 / 150)) < 1e-6  # inter=50, union=150

def test_interactable_recall_matches_by_label_and_iou():
    expected = [
        {"label": "button", "is_interactable": True, "bbox": {"x": 0, "y": 0, "w": 10, "h": 10}},
        {"label": "input", "is_interactable": True, "bbox": {"x": 50, "y": 0, "w": 20, "h": 10}},
    ]
    detected = [
        {"label": "button", "bbox": {"x": 1, "y": 1, "w": 10, "h": 10}},   # matches button (IoU>0.5)
        {"label": "link", "bbox": {"x": 50, "y": 0, "w": 20, "h": 10}},    # wrong label for the input
    ]
    assert interactable_recall(detected, expected, iou_threshold=0.5) == 0.5

def test_interactable_recall_no_expected_is_one():
    assert interactable_recall([], [], iou_threshold=0.5) == 1.0
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/vision-svc && python -m pytest tests/test_scoring.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'bench.scoring'`.

- [ ] **Step 3: Create `bench/scoring.py`**

```python
def iou(a: dict, b: dict) -> float:
    ax2, ay2 = a["x"] + a["w"], a["y"] + a["h"]
    bx2, by2 = b["x"] + b["w"], b["y"] + b["h"]
    ix1, iy1 = max(a["x"], b["x"]), max(a["y"], b["y"])
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter == 0.0:
        return 0.0
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union


def interactable_recall(detected: list, expected: list, iou_threshold: float) -> float:
    """Fraction of expected interactable elements matched by a detection with the
    same label and IoU >= threshold. Returns 1.0 when nothing is expected."""
    wanted = [e for e in expected if e.get("is_interactable")]
    if not wanted:
        return 1.0
    matched = 0
    used = set()
    for exp in wanted:
        for i, det in enumerate(detected):
            if i in used:
                continue
            if det["label"] == exp["label"] and iou(det["bbox"], exp["bbox"]) >= iou_threshold:
                matched += 1
                used.add(i)
                break
    return matched / len(wanted)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/vision-svc && python -m pytest tests/test_scoring.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/vision-svc/bench/__init__.py packages/vision-svc/bench/scoring.py packages/vision-svc/tests/test_scoring.py
git commit -m "feat(vision-svc): bench scoring (IoU + interactable recall)"
```

---

## Task 11: Golden set + `run_bench.py` runner

**Files:**
- Create: `packages/vision-svc/bench/golden/<name>.png` (10–20 real UIPE screenshots)
- Create: `packages/vision-svc/bench/golden/expected/<name>.json` (hand-labeled elements)
- Create: `packages/vision-svc/bench/run_bench.py`
- Create: `packages/vision-svc/README.md`

- [ ] **Step 1: Assemble the golden set**

Capture/collect 10–20 real screenshots. Reuse engine fixtures where they exist:
```bash
find packages/core/tests -name '*.png' | head
# copy a representative spread (forms, nav, canvas/WebGL, data tables) into:
mkdir -p packages/vision-svc/bench/golden/expected
cp <chosen>.png packages/vision-svc/bench/golden/
```
For each screenshot, hand-write `expected/<name>.json` — the elements you'd expect a correct detector to find (focus on interactable ones, since that's what the bar scores):
```json
{ "elements": [
  { "label": "button", "is_interactable": true, "bbox": { "x": 12, "y": 40, "w": 88, "h": 32 }, "text": "Submit" }
]}
```

- [ ] **Step 2: Write `run_bench.py`**

```python
"""Unit-0-lite: POST each golden screenshot to a running /v1/analyze, score the
result against the hand-labeled expectations, print a scorecard. Run against an
ephemeral Fly A10 deploy (Task 12) — dogfoods the real contract + serve path.

Usage: python bench/run_bench.py --base-url https://<app>.fly.dev
"""
import argparse
import base64
import json
import sys
import time
from pathlib import Path
import urllib.request

from bench.scoring import interactable_recall

GOLDEN = Path(__file__).resolve().parent / "golden"
IOU_THRESHOLD = 0.5
RECALL_BAR = 0.80
P95_LATENCY_MS_BAR = 8000


def _post(base_url: str, png_b64: str) -> dict:
    body = json.dumps({"api_version": "v1", "png_base64": png_b64, "regions": []}).encode()
    req = urllib.request.Request(f"{base_url}/v1/analyze", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    args = ap.parse_args()

    recalls, latencies, rows = [], [], []
    for png in sorted(GOLDEN.glob("*.png")):
        expected = json.loads((GOLDEN / "expected" / f"{png.stem}.json").read_text())["elements"]
        png_b64 = base64.b64encode(png.read_bytes()).decode()
        # retry through warming
        for _ in range(10):
            resp = _post(args.base_url, png_b64)
            if resp["status"] != "warming":
                break
            time.sleep(resp.get("retry_after_ms", 5000) / 1000)
        recall = interactable_recall(resp.get("elements", []), expected, IOU_THRESHOLD)
        recalls.append(recall)
        latencies.append(resp.get("latency_ms", 0))
        rows.append((png.name, resp["status"], round(recall, 2), round(resp.get("latency_ms", 0))))

    latencies.sort()
    p95 = latencies[int(0.95 * (len(latencies) - 1))] if latencies else 0
    mean_recall = sum(recalls) / len(recalls) if recalls else 0.0

    print("screenshot\tstatus\trecall\tlatency_ms")
    for r in rows:
        print("\t".join(map(str, r)))
    print(f"\nmean interactable recall: {mean_recall:.2f} (bar {RECALL_BAR})")
    print(f"p95 latency_ms: {p95} (bar {P95_LATENCY_MS_BAR})")

    passed = mean_recall >= RECALL_BAR and p95 <= P95_LATENCY_MS_BAR
    print("RESULT:", "PASS" if passed else "FAIL")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Write the runbook `README.md`**

```markdown
# vision-svc

Qwen2.5-VL analyze service for the personal GPU deploy (Phase 2).

## Local (CPU) tests
`python -m pytest`  — contract/schema/mapping/handler/scoring. No GPU, no model.

## Ephemeral A10 benchmark (Unit-0-lite)
1. `fly deploy --config fly.toml` (builds the CUDA image, boots an A10).
2. `python bench/run_bench.py --base-url https://uipe-vision-svc-bench.fly.dev`
   (first calls return status=warming while the model loads; the runner retries).
3. Read the scorecard; PASS = mean interactable recall >= 0.80 and p95 latency <= 8000ms.
4. `fly apps destroy uipe-vision-svc-bench --yes` to stop billing.

If Qwen FAILS the bar, add InternVL2.5 / Florence-2 (swap VISION_MODEL_ID), re-run,
pick the best — or ship vision-degraded (structural-only) per the spec escape hatch.
```

- [ ] **Step 4: Sanity-run the runner offline (arg parsing only)**

Run: `cd packages/vision-svc && python bench/run_bench.py --help`
Expected: prints usage (no network call).

- [ ] **Step 5: Commit**

```bash
git add packages/vision-svc/bench packages/vision-svc/README.md
git commit -m "feat(vision-svc): golden set + run_bench.py eval runner + runbook"
```

---

## Task 12: Ephemeral deploy → Unit-0-lite bench → golden eval → teardown (ops)

Not TDD — the real-GPU validation. This is where Qwen is confirmed (or challenged) on actual screenshots.

**Files:** updates `packages/vision-svc/bench/SCORECARD.md` with the recorded result.

- [ ] **Step 1: Deploy to the ephemeral A10**

```bash
cd packages/vision-svc
fly launch --no-deploy --copy-config --name uipe-vision-svc-bench   # if app not yet created
fly deploy --config fly.toml
```
Expected: image builds, an A10 machine boots, `fly status` shows it running. Model load happens on first request (warming).

- [ ] **Step 2: Health check**

Run: `curl https://uipe-vision-svc-bench.fly.dev/v1/health`
Expected: `{"ready": false, ...}` initially, then `{"ready": true, ...}` after the model finishes loading (~30–60s).

- [ ] **Step 3: Run the benchmark**

Run: `python bench/run_bench.py --base-url https://uipe-vision-svc-bench.fly.dev`
Expected: a scorecard table + `RESULT: PASS` or `FAIL`.

- [ ] **Step 4: Record the decision**

Write `bench/SCORECARD.md` with the date, model_id, the table, mean recall, p95 latency, and the decision (Qwen confirmed / challenger needed / vision-degraded). This is the Unit-0-lite output the spec calls for.

- [ ] **Step 5: If FAIL — challenge** (only if needed)

```bash
fly secrets set VISION_MODEL_ID=OpenGVLab/InternVL2_5-8B --app uipe-vision-svc-bench
fly deploy --config fly.toml
python bench/run_bench.py --base-url https://uipe-vision-svc-bench.fly.dev
```
Repeat with Florence-2 if needed; pick the best, or invoke the vision-degraded escape hatch and document it. Update `SCORECARD.md`.

- [ ] **Step 6: Tear down (stop billing)**

```bash
fly apps destroy uipe-vision-svc-bench --yes
```
Expected: app destroyed.

- [ ] **Step 7: Commit the scorecard**

```bash
git add packages/vision-svc/bench/SCORECARD.md
git commit -m "docs(vision-svc): Unit-0-lite scorecard + model decision"
```

---

## Definition of done

- `pnpm -F @uipe/contracts exec vitest run` green; `pnpm -r exec -- tsc --noEmit` clean.
- `cd packages/vision-svc && python -m pytest` green (config, schema-fixtures, mapping, handler, scoring) — all CPU, no model.
- The same canonical fixtures validate on both the TS (zod) and Python (Pydantic) sides.
- An ephemeral A10 deploy serves `/v1/analyze`; `run_bench.py` produces a scorecard; the model decision is recorded in `SCORECARD.md`; the ephemeral app is destroyed.
- No persistent Fly deploy, no session-host wiring, no `/v1/flow`, no OmniParser removal (those are Phases 3–4 and the optical-flow phase).
