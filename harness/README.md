# dev-harness — Agent Harness

> A read-before-answer protocol that keeps any AI agent (Claude Code or otherwise)
> honest, grounded in live repo state, and safe to run at any context level.

---

## What it does

The harness wires four Claude Code hooks:

| Hook | Script | What it does |
| --- | --- | --- |
| `SessionStart` | `hash-check.mjs` | Injects which tracked files changed since last session |
| `SessionStart` | `verify.mjs` | Flags doc claims that no longer match the code |
| `UserPromptSubmit` | `prompt-guard.mjs` | Detects "I pushed / I updated X" and re-surfaces changed files |
| `PreToolUse` | `edit-guard.mjs` | Just-in-time: injects lockstep partners + invariants when you open a risky file |
| `Stop` | `hash-check.mjs` | Re-baselines staleness at session end |

---

## File structure

```
harness/
  arch-map.mjs              # Generate harness/arch-map.html + summary
  arch-serve.mjs            # Watch server — live-reloads on file changes
  install.mjs               # Idempotently wire hooks into .claude/settings.json
  doctor.mjs                # Diagnose: hooks wired? files tracked? docs honest?
  AGENTS.protocol.md        # The read-before-answer rules
  architecture.json         # Component graph — define per project
  notes.json                # Planning notes store (auto-created, git-committed)
  context-sync/
    arch-lib.mjs            # Full dashboard renderer (HTML + browser JS)
    hash-check.mjs          # Staleness baseline tracker
    verify.mjs              # Doc-vs-code assertion checker
    prompt-guard.mjs        # UserPromptSubmit hook
    edit-guard.mjs          # PreToolUse hook (lockstep + high-risk)
    lockstep.mjs            # Duplicated-logic guard (CI + harness:lockstep)
    lib.mjs                 # Shared assertion runner
    assertions.json         # Doc claims to verify — define per project
    tracked-files.json      # Files surfaced at session start — define per project
    guard-config.json       # Lockstep groups + high-risk paths — define per project
```

---

## Quick install

```bash
node harness/install.mjs
```

Idempotently wires all hooks into `.claude/settings.json`.

---

## Commands

```bash
npm run arch              # Regenerate harness/arch-map.html
npm run arch:watch        # Live watch server on http://localhost:4319
npm run harness:check     # List tracked files changed since baseline
npm run harness:baseline  # Reset the baseline after re-reading changes
npm run harness:verify    # Check doc claims still match the code
npm run harness:doctor    # Confirm hooks wired, files tracked, docs honest
```

---

## guard-config.json

Define which files must be edited together (lockstep) and which paths get
just-in-time caution reminders:

```json
{
  "lockstepGroups": [
    {
      "id": "shared-util",
      "files": ["src/utils/shared.js", "server/utils/shared.js"],
      "note": "Keep both copies in sync."
    }
  ],
  "highRisk": [
    {
      "match": "server/utils/billing",
      "note": "Payment path. Run tests before committing."
    }
  ]
}
```
