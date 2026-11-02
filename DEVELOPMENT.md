# Development

## Monorepo layout

pnpm workspace — engine in `packages/core` (`@uipe/core`), shared types in `packages/contracts` (`@uipe/contracts`).

## Commands

| What | Command |
|------|---------|
| Type-check all packages | `pnpm -r exec -- tsc --noEmit` |
| Type-check one package | `pnpm -F @uipe/core exec tsc --noEmit` |
| Run unit gate (core) | `pnpm -F @uipe/core exec vitest run tests/unit/` |
| Run tests verbose (core) | `pnpm -F @uipe/core exec vitest run --reporter=verbose` |
| Run contracts tests | `pnpm -F @uipe/contracts exec vitest run --reporter=verbose` |
| Run single test | `pnpm -F @uipe/core exec vitest run tests/unit/path/file.test.ts --reporter=verbose` |
| Build | `pnpm run build` |
| Start (checks services) | `pnpm start:dev` |

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

## Animation-taste dataset

An AI explorer drives a site through the in-process MCP tools while a recorder segments every
trigger into an animation episode, measures it, junk-filters it and dedups it. Kept clips, rejects
(with reasons), `trace.jsonl`, `sitemap.json` and `report.{json,md}` land under the dataset root.

```bash
# Explore and record one or more sites (default caps: 60 steps, $2.00, 20 min per site)
pnpm -F @uipe/core dataset:run --site https://example.org --site https://example.net \
  --contact https://your.site/crawler-contact [--max-usd 1.50]

# Browse kept/rejected clips and hand-check a seeded 40-clip sample (J = junk, K = keep)
pnpm -F @uipe/core dataset:browse          # http://127.0.0.1:4173 (PORT overrides)
```

- **`--contact` is required.** The crawler refuses to run without it and identifies itself as
  `UIPE-research-crawler/0.1 (+<contact>)`. It honors robots.txt (a 5xx on robots.txt means
  disallow), rate-limits to one navigation per 2 s per origin, stays logged out, never submits
  forms, and stops on a bot challenge rather than evading it.
- Ctrl-C stops after the current step and still writes a partial report; a second Ctrl-C forces exit.

| Env var | Default | Purpose |
|---|---|---|
| `UIPE_DATASET_DIR` | `~/.uipe/dataset` | Dataset root (`runs/<runId>/...`). Never commit it. |
| `ANTHROPIC_API_KEY` | (none) | Key for the explorer model (`CLAUDE_API_KEY` also accepted). |
| `UIPE_EXPLORER_MODEL` | `claude-sonnet-5` | Explorer model id. |
| `UIPE_EXPLORER_PRICE_IN` / `UIPE_EXPLORER_PRICE_OUT` | `3` / `15` | USD per million input/output tokens, for the `$` budget cap. |

Milestone-1 pass bar per site: duplicate rate ≤ 10% and ≥ 15 unique episodes (both in the
report), junk among kept ≤ 20% on the 40-clip hand-check. The end-to-end test
(`tests/integration/dataset/run-site-e2e.test.ts`) runs the whole pipeline against an animated
fixture site with a scripted explorer.

## Services

UIPE depends on two external services that must be running for full integration tests:

### OmniParser sidecar

- Python venv at `sidecar/omniparser/.venv/`
- FastAPI server, default port 8001
- Florence-2 + transformers 4.44 (pinned — newer versions don't support PyTorch 2.2.2)

See `sidecar/omniparser/README.md` for startup.

### Ollama

- Default model: `llava:7b` (configurable via env)
- **Do not use `qwen3-vl:8b`** — crashes on Intel Mac

Start: `ollama serve` then `ollama pull llava:7b`.

## Tests

External services are mocked in unit tests — they don't need to be running. Integration tests under `tests/integration/` and `tests/e2e/` require the services up.

## VS Code

After `tsconfig.json` changes, run **Cmd+Shift+P → "TypeScript: Restart TS Server"**. `pnpm -r exec -- tsc --noEmit` is the ground truth for the full workspace; `pnpm -F @uipe/core exec tsc --noEmit` for the engine alone.

## API key

`.mcp.json` contains the Anthropic API key for tier-C VLM. **Never commit it.**
