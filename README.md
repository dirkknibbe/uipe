# UI Perception Engine

A perception layer for AI agents — human-like understanding of web interfaces.

Fuses structural (DOM + a11y tree + CSS), visual (three-tier vision pipeline), and temporal data into a unified **UI Scene Graph** that an LLM can reason over fluently. Exposed as an MCP server so Claude can navigate and inspect any live URL.

## What It Does

- Navigates to any URL in a real Playwright browser
- Extracts a compact, LLM-readable scene graph from the live DOM
- Detects UI elements visually via OmniParser V2, understands layout via Qwen3-VL, and performs deep UX analysis via Claude Vision
- Tracks UI transitions and diffs between states
- Predicts affordances (what you can interact with, and what happens when you do)
- Exposes everything as MCP tools that Claude can call directly

## MCP Tools

| Tool | Description |
|------|-------------|
| `navigate` | Navigate to a URL and return the initial scene graph |
| `get_scene` | Re-capture the current scene (compact text or full JSON) |
| `get_affordances` | List interactive elements ranked by priority |
| `act` | Execute browser actions: click, type, scroll, hover, keypress, navigate, wait |
| `get_console_logs` | Return captured browser console messages |
| `get_network_errors` | Return failed network requests |
| `get_screenshot` | Capture a screenshot and return it as an image |
| `detect_elements` | Run element detection (OmniParser or Claude Vision fallback) |
| `analyze_visual` | Visual understanding via Qwen3-VL: hierarchy, contrast, spacing, UX |
| `compare_states` | Diff current vs previous scene graph — shows what changed |
| `watch` | Start real-time keyframe capture (CDP screencast + perceptual hashing) |
| `stop_watch` | Stop keyframe capture and return summary of changes |

### Three-tier vision pipeline (`visual=true`)

Both `navigate` and `get_scene` accept an optional `visual: true` parameter. When enabled, the engine runs a three-tier vision pipeline:

- **Tier A: OmniParser V2** — Fast element detection (~0.8s). A YOLOv8 + Florence-2 model running as a Python sidecar on port 8100. Detects buttons, inputs, images, icons, and other UI elements with bounding boxes and labels.
- **Tier B: Qwen3-VL via Ollama** — Visual understanding (~2-4s). Analyzes the screenshot with detected element context to assess visual hierarchy, contrast issues, spacing problems, affordance clarity, and state indicators.
- **Tier C: Claude Vision API** — Deep UX analysis (~3-5s, on-demand only). Provides detailed qualitative analysis when requested via `analyze_visual` or `depth: 'deep'`.

**Graceful degradation:** Each tier skips silently if its backing service is unavailable. The system works with any combination of services running — from all three tiers down to structural-only analysis with no vision services at all.

Use `detect_elements` for fast Tier A detection only, or `analyze_visual` for the full Tier A + B pipeline.

### `act` action types

| Type | Parameters |
|------|-----------|
| `click` | `x`, `y` |
| `clickSelector` | `selector` |
| `type` | `text`, `selector` (optional) |
| `scroll` | `direction` (`up`/`down`), `amount` (optional) |
| `hover` | `x`, `y` |
| `wait` | `ms` |
| `navigate` | `url` |
| `back` | — |
| `pressKey` | `key` |

## Installation

### From npm

```bash
npm install -g ui-perception-engine
```

Or use without installing:

```bash
npx ui-perception-engine
```

Install Playwright browsers (first time only):

```bash
npx playwright install chromium
```

### From source

```bash
git clone https://github.com/dirkknibbe/uipe.git
cd uipe
pnpm install
pnpm build
```

## Claude Code MCP Configuration

Add to your Claude Code MCP config (`~/.claude/mcp.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "ui-perception-engine": {
      "command": "npx",
      "args": ["ui-perception-engine"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "ui-perception-engine": {
      "command": "uipe"
    }
  }
}
```

Or from a local clone:

```json
{
  "mcpServers": {
    "ui-perception-engine": {
      "command": "node",
      "args": ["/path/to/uipe/ui-perception-engine/dist/src/mcp/index.js"],
      "env": {
        "OLLAMA_URL": "http://localhost:11434",
        "OLLAMA_MODEL": "qwen3-vl:8b",
        "OMNIPARSER_URL": "http://localhost:8100",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

### Environment variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude Vision API — detection fallback + deep analysis (Tier C) |
| `OLLAMA_URL` | Ollama server URL (default: `http://localhost:11434`) |
| `OLLAMA_MODEL` | Vision model name (default: `qwen3-vl:8b`) |
| `OMNIPARSER_URL` | OmniParser V2 sidecar URL (default: `http://localhost:8100`) |

See `.env.example` for the full list of configurable variables including frame capture, browser, and temporal settings.

### Local Vision Services

The three-tier vision pipeline uses two local services. Both are optional — the system degrades gracefully without them.

**Ollama (Tier B — visual understanding):**

```bash
# Install Ollama: https://ollama.com
ollama pull qwen3-vl:8b
ollama list                    # verify model is available
# Ollama serves on http://localhost:11434 by default
```

**OmniParser V2 (Tier A — element detection):**

OmniParser runs as a Python FastAPI sidecar on port 8100. See the [Local Vision Handoff doc](../UIPE-LOCAL-VISION-HANDOFF.md) section 5 for full setup instructions.

```bash
# Quick check if OmniParser is running:
curl -s http://localhost:8100/health
```

**Without local services:** If neither Ollama nor OmniParser is running, `visual=true` falls back to Claude Vision API (requires `ANTHROPIC_API_KEY`). If no vision service is available at all, the engine uses structural-only analysis (DOM + a11y tree).

## Using with the `live-deployment-check` Skill

The `live-deployment-check` skill pairs directly with this MCP server to visually verify a deployed site or app — catching broken images, empty routes, stuck spinners, and placeholder text that only surface in a real browser.

### Workflow

```
1. navigate(url)            → load the page, get initial scene
2. get_scene()              → re-capture after JS hydrates (critical for SPAs)
3. get_console_logs()       → check for JS errors (type="error")
4. get_network_errors()     → check for failed API/resource requests
5. Scan scene output        → look for broken signals (see below)
6. act() on nav links       → walk routes, verify each one loads
7. Report findings          → list what's working and what's broken
```

### Common Signals in Scene Output

```
# Broken image:
img[img]:"broken"

# Empty SPA route (component failed to load):
router-outlet[element]          ← no children = problem

# Stuck loading spinner:
progressbar[progressbar]        ← present after JS settles = API error

# Route loaded correctly:
router-outlet[element]
  app-order-list[element]:"Order Management..."   ← has content = good
```

### Example

```
// After deploying an Angular app
navigate("http://your-app.vercel.app")
get_scene()                     // wait for hydration
→ check router-outlet has content, no broken img nodes

// Walk routes
act({ type: "clickSelector", selector: "a[href='/orders']" })
get_scene()
→ verify orders page loaded

act({ type: "clickSelector", selector: "a[href='/customers']" })
get_scene()
→ verify customers page loaded
```

### What to Check

- **Broken images** — `img` nodes with `"broken"` content
- **Empty routes** — `router-outlet` with no child elements
- **Stuck spinners** — `progressbar` still present after `get_scene()`
- **Placeholder text** — `undefined`, `null`, `TODO`, `<repo-url>` in visible text
- **Error pages** — 404 or error component rendered instead of expected content

## Development

```bash
pnpm test          # run tests
pnpm test:watch    # watch mode
pnpm lint          # lint
pnpm build         # compile TypeScript
pnpm mcp           # start MCP server (after build)
pnpm start:dev     # check services + start MCP server
```

## Architecture

```
src/
├── config.ts           ← centralized config (dotenv)
├── types/              ← shared types (contracts between pipelines)
├── browser/            ← BrowserRuntime (Playwright)
├── pipelines/
│   ├── structural/     ← DOM + a11y tree extraction
│   ├── visual/
│   │   ├── index.ts        ← Three-tier orchestrator (detect/understand/deep)
│   │   ├── omniparser.ts   ← OmniParser V2 client (Tier A)
│   │   ├── claude-vision.ts ← Claude Vision API (Tier C)
│   │   ├── ollama-vision.ts ← Qwen3-VL via Ollama (Tier B)
│   │   └── frame-capture.ts ← CDP screencast + perceptual hashing
│   ├── fusion/         ← merge visual + structural → SceneGraph
│   ├── temporal/       ← change detection + state tracking
│   └── affordance/     ← predict interaction outcomes
├── mcp/                ← MCP server (12 tools)
└── utils/
```

**Viewport default:** 1280x720 (configurable via env)
**Screenshot format:** PNG (lossless, required for vision models)
