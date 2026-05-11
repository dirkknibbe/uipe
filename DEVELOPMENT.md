# Development

## Commands

| What | Command |
|------|---------|
| Type-check (ground truth) | `pnpm exec tsc --noEmit` |
| Run all tests | `pnpm exec vitest run --reporter=verbose` |
| Run single test | `pnpm exec vitest run tests/unit/path/file.test.ts --reporter=verbose` |
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

After `tsconfig.json` changes, run **Cmd+Shift+P → "TypeScript: Restart TS Server"**. `pnpm exec tsc --noEmit` is the ground truth.

## API key

`.mcp.json` contains the Anthropic API key for tier-C VLM. **Never commit it.**
