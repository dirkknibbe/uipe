---
name: perception-session
description: Use when investigating what UIPE's perception layer captures during a workflow. Wraps start_perception → drive action → inspect events + summary → stop into a structured session, then reports a markdown summary of which loops fired, anomalies triggered, and intent-loop classifications. Also use when the user says "what did perception see," "test the perception loops," or "show me anomalies for this workflow."
---

# perception-session

You're using UIPE's perception layer to investigate what the system actually
captures while a workflow runs on a page. This skill orchestrates the
session: start perception, drive the workflow, inspect the timeline +
summary, stop perception, and report a structured markdown summary.

## When to use this

- The user wants to validate that a specific UI change (count-up animation,
  toast notification, modal mutation) is being captured by perception.
- The user wants to debug "why didn't perception fire an anomaly here?"
- The user wants a report of perception activity over a workflow they're
  about to drive.

## When NOT to use this

- The user just wants to navigate or analyze a single page (use
  `navigate` + `get_scene` directly).
- The user is asking about UIPE's source code (use Read + grep).
- The workflow has no expected perception activity to assert on.

## How to use this

1. **Confirm the workflow.** Ask the user (or restate from context) what
   workflow you'll drive and what they expect perception to capture. Be
   explicit about expected anomalies if any (e.g. "expect 1 anomaly of
   reason mutation-outside-animation when the counter ticks up").

2. **Start the session.** Call `start_perception`. This auto-starts watch
   (keyframe capture) if not already running. Record the `startedAt`
   timestamp.

3. **Drive the workflow.** Use existing MCP tools (`navigate`, `act` with
   click/scroll/type/wait, etc.) to execute the steps. Wait long enough
   between steps for perception to process — give 500ms-1s of buffer after
   each action.

4. **(Optional) Peek mid-flight.** For long workflows, call
   `get_perception_session` partway through to see running stats. Useful
   if a loop appears stuck.

5. **Stop the session.** Call `stop_perception`. This returns the final
   summary as JSON. Do NOT stop watch — leave keyframe capture running
   for other consumers.

6. **Pull the relevant timeline events.** Call `get_timeline` filtered to
   `perception-tick`, `perception-anomaly`, `perception-escalation`,
   `perception-intent-result` with `since: <startedAt>`. This gives the
   detailed event sequence to back up the summary.

7. **Produce a report.** Generate markdown with these sections:
   - **Session overview**: duration, tick counts per tier, achieved vs target cadence
   - **Anomalies**: timestamps, reasons, target nodes, count by reason
   - **Escalations**: from-tier → to-tier counts
   - **Intent results**: VLM classifications per region
   - **VLM cost**: best-effort dollar estimate from `vlmCalls`
   - **Assertions** (if user stated expectations): ✅ or ❌ per expectation,
     with the relevant timeline snippet if it failed

Make the report scannable. Use tables for repeated rows (anomalies,
intent results). Quote specific timeline events when explaining failures.

## What perception can detect today (v1)

- **Anomaly trigger**: `mutation-outside-animation`. Fires when DOM
  mutations happen while no CSS animation is active. Catches things like
  JS-driven count-up animations, IntersectionObserver-triggered state
  updates, React re-renders that change text content.
- **Escalation chain**: frame loop → semantic loop → intent loop. Frame
  spots the anomaly, semantic checks if the affected nodes are
  unclassified components, intent classifies new components via VLM.

## What perception does NOT yet detect (v1 limitations)

- CSS `transition` (not `Animation` API) — false negatives.
- Animation deviation, new component signatures, optical-flow motion
  triggers — deferred to v2.
- Mutations on subtree A while an animation runs on subtree B — global
  temporal gate suppresses these as false negatives.

Be honest about these limits in the report when relevant.
