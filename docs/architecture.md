# UIPE Architecture

UIPE perceives UIs the way an autopilot perceives roads. Deterministic sensors (DOM, accessibility tree, MutationObserver, CDP perf APIs) form the substrate; VLMs provide semantic enrichment only when uncertainty triggers them.

For the full architectural thesis — autopilot mapping, techniques borrowed from AV stacks, build order, world-model long game — see [the workspace architecture doc](../../docs/architecture.md).

## What this repo ships

- **Three-tier vision pipeline:** deterministic (DOM + a11y + MutationObserver + CDP) → OmniParser sidecar → VLM (local Ollama or Anthropic Messages API).
- **12 MCP tools** exposed as a local MCP server. See `../../docs/mcp-tools.md`.
- **Unit + integration suites green**, tsc clean. See `DEVELOPMENT.md` for the commands.

## Stack

TypeScript + Playwright + OmniParser (Python sidecar, FastAPI + Florence-2) + Ollama (`llava:7b`) + MCP SDK.

## Development

See `../DEVELOPMENT.md` (this repo) for build/test commands, or the workspace-level `../../DEVELOPMENT.md` for the same plus services and hardware notes.
