# UI Perception Engine

A perception layer for AI agents — human-like understanding of web interfaces.

Fuses structural (DOM + a11y tree + CSS), visual, and temporal data into a unified **UI Scene Graph** that an LLM can reason over fluently. Exposed as an MCP server so Claude can navigate and inspect any live URL.

## What It Does

- Navigates to any URL in a real Playwright browser
- Extracts a compact, LLM-readable scene graph from the live DOM
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
| `get_console_logs` | Return captured browser console messages (filter by type: error/warning/log/info/all) |
| `get_network_errors` | Return failed network requests (connection refused, 4xx, 5xx, blocked) |
| `get_screenshot` | Capture a screenshot and return it as an image — lets Claude visually inspect canvas, maps, charts, WebGL |

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

```bash
pnpm install
pnpm build
```

Install Playwright browsers (first time only):

```bash
npx playwright install chromium
```

## Claude Code MCP Configuration

Add to your Claude Code MCP config (`~/.claude/mcp.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "ui-perception-engine": {
      "command": "node",
      "args": ["/path/to/ui-perception-engine/dist/src/mcp/index.js"]
    }
  }
}
```

Replace `/path/to/ui-perception-engine` with the absolute path to this repo.

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
```

## Architecture

```
src/
├── types/          ← shared types (contracts between pipelines)
├── browser/        ← BrowserRuntime (Playwright)
├── pipelines/
│   ├── structural/ ← DOM + a11y tree extraction
│   ├── visual/     ← OmniParser + Claude Vision (Phase 2)
│   ├── fusion/     ← merge visual + structural → SceneGraph
│   ├── temporal/   ← change detection + state tracking
│   └── affordance/ ← predict interaction outcomes
├── mcp/            ← MCP server (navigate/get_scene/get_affordances/act)
└── utils/
```

**Viewport default:** 1280×720 (configurable via env)
**Screenshot format:** PNG (lossless, required for vision models)
