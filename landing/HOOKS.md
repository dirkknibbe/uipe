# Safety Hooks — How This Works

Short explainer on the PreToolUse hook that enforces the overnight safety rules. Read this if you want to learn how Claude Code hooks work, or if you need to change the rules.

## The architecture, in one diagram

```
┌──────────────────┐   tool_input (JSON on stdin)    ┌────────────────────────┐
│  Claude Code     │ ──────────────────────────────▶ │  guardrails.py         │
│  (about to run   │                                 │  - applies deny rules  │
│   Bash/Edit/…)   │ ◀────────────────────────────── │  - exits 0 allow       │
└──────────────────┘   exit 0 / 2 + stderr reason    │  - exits 2 + stderr    │
                                                      └────────────────────────┘
          │
          ▼
  tool runs (if allowed)
  or deny reason shown to model (if blocked)
```

The hook is registered as a **PreToolUse** hook with matcher `Bash|Edit|Write|MultiEdit`. Every time Claude Code is about to invoke one of those four tools, it pipes the tool call JSON to the script first. Exit code 2 blocks the call; anything non-2 allows it.

## Where things live

- **Script:** `/Users/dirkknibbe/uipe/.claude/hooks/guardrails.py`
- **Registration:** `/Users/dirkknibbe/uipe/.claude/settings.json`
- **Scope:** project-level — applies when Claude Code's working dir is `/Users/dirkknibbe/uipe/` or any subdirectory
- **Pre-existing `settings.local.json`:** untouched. Settings merge, not replace.

## Rules encoded

**Bash:**
- no `git push` (including `--force`)
- no `git reset --hard`
- no `git add -A` / `.` / `--all` / `-p` / `--patch`
- no `--no-verify` / `--no-gpg-sign`
- no `rm -rf` / `rm -fr`
- no `kill <protected-pid>` for PIDs `47597` or `93092`
- no global pnpm/npm install (`-g` or `--global`)
- no `vercel deploy` / `vercel --prod` / `vercel --yes`

**Edit / Write / MultiEdit (by `file_path`):**
- must be inside `/Users/dirkknibbe/uipe/ui-perception-engine/landing/` OR outside `ui-perception-engine/` entirely
- never under `/Users/dirkknibbe/.claude/` (user Claude config)
- never any path ending in `.mcp.json`

**MCP tools** (destructive / external side-effect calls on an explicit blocklist):
- Vercel: `deploy_to_vercel`
- GitHub writes: create_*, delete_*, update_pull_request, merge_*, push_files, fork_*, *_write, assign_copilot*, request_copilot_review, add_*
- MongoDB writes: drop-*, delete-many, update-many, insert-many, create-collection, create-index, rename-collection
- Gmail writes: create_draft, label_*, unlabel_*
- Calendar writes: create_event, update_event, delete_event, respond_to_event
- Drive writes: create_file
- Memory writes: create_*, delete_*, add_observations
- Telegram: reply, edit_message, react

Read-only MCP calls (UIPE, Context7, ctx_search, list_*, get_*, find, etc.) pass through. See `MCP_BLOCKLIST` in `guardrails.py` for the exact set.

## Audit log

Every tool invocation — allow or deny — is appended to `/Users/dirkknibbe/uipe/.claude/hooks/audit.log`. One line per call:

```
2026-04-15T01:05:12Z ALLOW Bash "git status"
2026-04-15T01:05:15Z DENY  Bash "git push origin main" (no `git push` during this run.)
2026-04-15T01:05:19Z ALLOW Edit /Users/dirkknibbe/uipe/ui-perception-engine/landing/app/page.tsx
2026-04-15T01:05:22Z DENY  mcp__claude_ai_Vercel__deploy_to_vercel (MCP tool ... is on the overnight blocklist)
```

To tail live:

```bash
tail -f /Users/dirkknibbe/uipe/.claude/hooks/audit.log
```

The log is append-only, not rotated. Safe to delete or archive any time — the hook will recreate it on next invocation.

## Design choices

1. **Python over shell.** Regex on bash strings gets ugly fast. Python with `re` is readable, testable, and the runtime is already on the machine.
2. **Exit code + stderr, not JSON output.** The JSON output form (`hookSpecificOutput.permissionDecision`) is newer and cleaner, but exit codes work on every Claude Code version and are trivial to test by piping.
3. **Deny-by-pattern, not allow-list.** The tool surface Claude can call is huge. An allow-list would be too brittle. Known-bad patterns + a path-scope rule catch the rules we actually want to enforce.
4. **Fail open on malformed JSON.** If the hook can't parse the tool payload, it exits 0 (allow) rather than blocking. Reason: a broken hook blocking EVERY tool call would be worse than a missed enforcement. The real tool will then surface the real error.
5. **No stateful locking.** The hook is pure: same input, same output. No files, no timestamps. Easy to reason about.

## Testing the hook by hand

You can pipe mock payloads to the script:

```bash
# Should block:
echo '{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}' \
  | python3 /Users/dirkknibbe/uipe/.claude/hooks/guardrails.py
# prints reason to stderr, exits 2

# Should allow:
echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' \
  | python3 /Users/dirkknibbe/uipe/.claude/hooks/guardrails.py
# exits 0, no output
```

The `jq -e` validation:

```bash
jq -e '.hooks.PreToolUse[] | .hooks[] | .command' \
  /Users/dirkknibbe/uipe/.claude/settings.json
```

Exit 0 + prints the command = settings are shaped correctly.

## Reloading hooks

Claude Code's settings watcher only re-reads `.claude/settings.json` when the directory was watched at session start. If you edit the hook mid-session and it doesn't seem to take effect:

1. Run the `/hooks` slash command (reloads config)
2. Or restart Claude Code

## Changing the rules

Two kinds of change:

**Add a new Bash deny pattern:** append to `BASH_RULES` in `guardrails.py` as a `(regex, reason)` tuple. Test with a pipe, commit.

**Lift a rule during the run:** either edit `guardrails.py` and have Daisy reload via `/hooks`, or temporarily stash the rule by commenting out the tuple. Do NOT disable the hook entirely — losing all guardrails at once is never the right move.

**Add a new matched tool:** update the `matcher` in `settings.json` (e.g. add `NotebookEdit`) and add the corresponding `check_*` function in `guardrails.py`.

## Observability

Right now the hook doesn't log allows/denies. If that becomes useful, add a line like:

```python
import os, time
with open(os.path.expanduser("~/uipe/.claude/hooks/audit.log"), "a") as f:
    f.write(f"{time.time()}\t{tool}\t{reason or 'allow'}\n")
```

and `.gitignore` the log. Keep it simple — audit logs should be boring.
