# UIPE / MCPaaSTA — Positioning Brief

**Domain:** uipe.dev
**Aesthetic:** high-end visual (gradients, motion, premium feel — Framer/Runway/Linear territory)
**Tone:** aspirational

## One-sentence pitch

UIPE is the perception layer for autonomous web agents — so your agent sees, understands, and acts on web interfaces the way a human would.

## Audience

Primary: builders of autonomous agents that interact with web UIs (Claude Code users, Cursor users, LangChain/AutoGen/CrewAI devs, computer-use experimenters).

Secondary: QA/eval teams using LLMs to test web apps; researchers on agent benchmarks.

## Problem (what we're solving)

Agents can read HTML, but HTML isn't what users see. Modern web apps hide meaning in CSS, layout, animation, and canvas rendering. An agent with only DOM access is blind to what a human would instantly understand — which button is primary, what state a form is in, whether a spinner means "loading" or "frozen," whether the element it just clicked actually did anything.

This is why agents that work great in demos fall apart on real websites.

## Solution

UIPE fuses four signals into a unified scene graph:

1. **DOM** — structure and text
2. **Accessibility tree** — semantic role and state
3. **Visual (screenshot + vision model)** — what the page actually looks like
4. **Temporal (frame-by-frame change tracking)** — what just happened

The result is a single, compact representation your agent can reason about — the same way a human would describe a page.

Exposed as an MCP server with 12 tools. Drop it into Claude Code, Cursor, or any MCP-native agent in one line of config.

## Headline candidates (aspirational)

1. **See the web the way humans do.**
2. **Give your agent eyes.**
3. **Perception for autonomous agents.**
4. **Agents that actually understand the page.**
5. **The missing sense for web agents.**

Lead candidate: **#1 — "See the web the way humans do."** Pairs with subhead that clarifies it's for agents, not a human UX product.

## Subhead candidates

- "The perception layer for autonomous agents — DOM, accessibility, vision, and time, fused into one scene graph."
- "A perception layer that gives your agent human-level web understanding. Ships as an MCP server."
- "Fuse DOM, a11y, vision, and change-over-time into a single scene graph. Drop into any MCP-native agent."

Lead candidate: second — concise + delivery mechanism clear.

## Three core value props (for the page)

1. **Human-level understanding** — Not just HTML. The page the way a human sees it: visual hierarchy, state, motion, meaning.
2. **MCP-native** — One line in your agent's config. Works with Claude Code, Cursor, and anything else that speaks MCP.
3. **Temporal awareness** — Knows what *just happened*. Did the click work? Did the page load? Did that spinner stop?

## Before/After narrative

**Before UIPE:**
- Agent: "Click the login button."
- Target: The DOM has 7 elements containing the word "login." None are the actual button.
- Agent clicks the wrong thing. Retries. Clicks a different wrong thing. Gives up.

**With UIPE:**
- Agent: "Click the primary login button."
- UIPE: Scene graph identifies the visually primary CTA at viewport center, confirms it's interactive, confirms it has the semantic role `button`, confirms the label reads "Log in."
- Agent clicks once. It works. UIPE confirms the URL changed and the session state advanced.

## Pricing (for the page)

- **Free** — 10 Scan + 2 Deep per day with GitHub OAuth
- **Scan** — $0.03 per session, x402 (USDC on Base)
- **Deep** — $0.12 per session, x402

Position pricing as *"pay what a cup of coffee would cost, get a month of agent evals"* rather than selling the micro-transaction angle hard. Crypto-native framing is for the footer / docs, not the hero.

## MCP config snippet (copy-paste on page)

```json
{
  "mcpServers": {
    "uipe": {
      "url": "https://mcpaasta.uipe.dev/mcp",
      "transport": "sse"
    }
  }
}
```

Show this *aspirationally* — label it "Coming soon. Join the waitlist to get early access."

## Tone rules

- Confident, not hype-y. No "revolutionary," no "game-changing."
- Builder-to-builder. Assume the reader knows what an agent is and what MCP is.
- One idea per section. If a sentence is earning its place it's specific.
- Show, don't tell. Before/after example carries more weight than a feature list.
- No emoji in body copy. Monospace for code. Generous type.

## What's explicitly NOT on this page (yet)

- The three-layer MCPaaSTA architecture (too much for a landing — link to docs)
- x402 mechanics (footer-level mention only)
- Deep model choice (Qwen vs Claude) — implementation detail
- Benchmark numbers (don't have them yet; would invite scrutiny)
- Team / company info (solo project — lean into the focus)

## Success metrics for this page

- Waitlist signups (primary)
- Scroll depth to pricing / MCP snippet
- Clicks on the aspirational config snippet (shows intent to integrate)
- Referrer quality — HN/Reddit/Twitter vs organic

## Distribution plan (post-launch)

1. Post on HN as a Show HN once the page + demo are ready
2. Seed in MCP Discord, r/LocalLLaMA, r/ClaudeAI
3. Short thread on Twitter/X with the before/after demo video
4. Email 5-10 agent-builders directly for feedback conversations
