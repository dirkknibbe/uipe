# vision-svc

Qwen2.5-VL `analyze` service for the personal GPU deploy (Phase 2). Serves
`POST /v1/analyze` + `GET /v1/health` over the `@uipe/contracts` `/v1` wire contract.

## Local (CPU) tests

The model never runs locally. Unit tests cover the contract/schema/mapping/handler/
entrypoint/scoring — no GPU, no model. The macOS default `python3` is 3.9, which
cannot run this code (`float | None` etc.), so use the 3.11 venv:

```bash
# one-time
/usr/local/bin/python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
# run
.venv/bin/python -m pytest
```

## Ephemeral A10 benchmark (Unit-0-lite)

The model runs only on an A10 spun up for the bench/eval and torn down after.

1. `fly deploy --config fly.toml` (builds the CUDA image, boots an A10).
2. `curl https://uipe-vision-svc-bench.fly.dev/v1/health` — `ready:false` while the
   model loads (~30–60s), then `ready:true`.
3. `.venv/bin/python -m bench.run_bench --base-url https://uipe-vision-svc-bench.fly.dev`
   (run as a module so `from bench.scoring` resolves; first calls return
   `status=warming` and the runner retries through warm-up).
4. Read the scorecard; PASS = mean interactable recall ≥ 0.80 and p95 latency ≤ 8000ms.
5. `fly apps destroy uipe-vision-svc-bench --yes` to stop billing.

If Qwen FAILS the bar, add InternVL2.5 / Florence-2 (swap `VISION_MODEL_ID` via
`fly secrets set`), re-run, pick the best — or ship vision-degraded (structural-only)
per the spec escape hatch. Record the outcome in `bench/SCORECARD.md`.

`bench/golden/` holds the hand-labeled golden set: `*.png` screenshots +
`expected/<name>.json` (the elements a correct detector should find, focused on
interactable ones since that's what the bar scores).
