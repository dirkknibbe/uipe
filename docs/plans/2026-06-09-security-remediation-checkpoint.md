# Checkpoint: Security remediation — Track 1 shipped, Tracks 2–4 remain — 2026-06-09

## What we did
- **Ran a full multi-agent security audit** (Workflow, ~72 agents) → **50 findings** in `.review/security-2026-06-09/REPORT.md` (untracked). High-sev ones adversarially verified. Flagship class = no trust boundary on perceived web content → prompt-injection of the consuming agent.
- **Wrote the 5-track remediation plan:** `docs/superpowers/plans/2026-06-09-security-remediation.md` (the source of truth; each finding ID maps to a task).
- **Track 0 (credential):** Dirk **rotated** the leaked `sk-ant-…` key (rotation is the only real revocation — it was read into audit transcripts), moved it to macOS Keychain + a `${ANTHROPIC_API_KEY}` env ref in `/Users/dirkknibbe/uipe/.mcp.json`. gitleaks over all history is clean (the key was never committed). The `.mcp.json`/`​.env.*` add to the engine `.gitignore` (Track 0 Step 5) is **still pending**.
- **Track 1 (local input hardening) → PR #25 MERGED:** `mcp-1`/`web-1` url-guard on BOTH goto paths (`runtime.navigate` AND `actions.ts` act:navigate — the plan missed the 2nd), `mcp-2`/`web-6` capped excludePattern regex, `mcp-3` bounded act args (`act-schema.ts`), `mcp-4` `sanitizeToolError` on the act handler. Also **fixed the e2e harness** (the guard correctly broke its `file://` fixtures → now a localhost http fixture server) and added a **happy/sad/edge** url-guard e2e trio.
- Also merged **PR #24** (Fly substrate-pivot amendment docs) from the prior session.

## Current state
- `master` @ `8bdc06f` contains PR #25; PR #24 + #25 both **MERGED**. Branch `security/track1-input-hardening` is merged (safe to delete).
- **Tests:** unit **528**, e2e **10/10**, `tsc --noEmit` clean. Known **#15** animation-timing flake fails only under CPU contention in `test:all` (passes **4/4 isolated**) — not a real failure.
- Working tree: only `landing/.gitignore` (pre-existing, not ours) + untracked junk (`.review/`, etc.). Nothing of ours uncommitted.

## Key files & context
- **Plan (source of truth):** `docs/superpowers/plans/2026-06-09-security-remediation.md` — 5 tracks + the **Phase-4 gate checklist** (must-close-before-network-exposure).
- **Report:** `.review/security-2026-06-09/REPORT.md` (untracked, 50 findings, severities today vs Phase-4).
- **e2e convention (emerged):** tests under `tests/e2e/` serve fixtures over a localhost http server (`tests/e2e/fixture-server.ts`) — **never `file://`** (url-guard blocks it). Run via `pnpm -F @uipe/core run test:integration` / `test:all`.
- **Guardrails hook** (`/Users/dirkknibbe/uipe/.claude/hooks/guardrails.py`) hard-blocks agent Edit/Write to `.mcp.json` — Track 0 file edits are owner-run.
- **`mcp-4` scope:** applied to the `act` handler only (a generic wrapper across all 17 tools would erase each handler's typed input) — broaden when Track 2 next touches `server.ts`.
- **GateGuard** fact-force hook now fires before the first Bash command and before Write each session (present: user request + what the action produces, then retry).
- Commands: `pnpm -r exec -- tsc --noEmit` · `pnpm -F @uipe/core exec vitest run --reporter=verbose` · vision-svc: `cd packages/vision-svc && .venv/bin/python -m pytest -q`.

## Next steps (remaining tracks — each its own PR off `master`)
1. **Track 2 (FLAGSHIP) — untrusted-content trust boundary.** Highest leverage. Escape+cap fields in `toCompact` (`inj-2`, `serializer.ts`), wrap perception output in an `<untrusted_page_content>` envelope (`inj-1/3/4`, `web-2`, in `server.ts`), extraction size/node caps (`inj-5`, `dom-extractor.ts`), label allowlist + caps in vision-svc `mapping.py` (`vsv-4`). TDD per plan Track 2.
2. **Track 3 — sidecar + vision-svc hardening.** omniparser bind `127.0.0.1` (`omn-3`), image decompression-bomb + size caps (`omn-4`/`vsv-1`/`vsv-2`/`vsv-3`), pin+checksum weights & drop `trust_remote_code` (`omn-1`/`omn-2`/`sec-2`), optional vision-svc bearer auth (`vsv-6`, Phase-4 gate).
3. **Track 4 — supply chain / CI.** transitive bumps (`sup-4`), SHA-pin actions (`sup-2`), gate the `@claude` trigger (`sup-3`/`sec-3`), real model-download hash (`rst-1`), cargo-audit CI (`rst-2`), anchor gitleaks allowlist (`sec-1`).
4. **Track 0 loose end:** add `.mcp.json` + `.env.*` to `ui-perception-engine/.gitignore` (fold into one track's PR — `.gitignore` isn't blocked by the hook).
5. **Phase-4 gate checklist** — verify the network-exposure gates before any deploy.

## Resume prompt
```
Read ui-perception-engine/docs/plans/2026-06-09-security-remediation-checkpoint.md
in full. It's a checkpoint from my last session on "UIPE security remediation
(Track 1 shipped, Tracks 2–4 remain)". Catch up on what we did and the current
state, then continue from the "Next steps" section — start with Track 2 (the
flagship untrusted-content trust boundary) on a fresh branch off master. Start
by confirming your understanding of where we left off before making changes.
```
