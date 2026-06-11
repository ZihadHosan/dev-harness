# dev-harness — Agent Harness

> A read-before-answer protocol that keeps any AI agent (Claude Code or otherwise)
> honest, grounded in live repo state, and safe to run at any context level.

---

## What it does

The harness wires five Claude Code hooks and generates everything your project needs to work with AI agents out of the box:

| Hook | Script | What it does |
| --- | --- | --- |
| `SessionStart` | `hash-check.mjs` | Injects which tracked files changed since last session |
| `SessionStart` | `verify.mjs` | Flags doc claims that no longer match the code |
| `UserPromptSubmit` | `prompt-guard.mjs` | Detects "I pushed / I updated X" and re-surfaces changed files |
| `PreToolUse` | `edit-guard.mjs` | Just-in-time: injects lockstep partners + invariants when you open a risky file |
| `Stop` | `hash-check.mjs` | Re-baselines staleness at session end |

---

## Quick install

```bash
node harness/install.mjs
```

One command. No prompts. No placeholders. It auto-detects your stack from `package.json` and:

1. **Wires all hooks** into `.claude/settings.json`
2. **Writes `CLAUDE.md`** with detected Project Constraints (lang, framework, test runner, db, runtime, branch) — Claude Code reads this automatically at every session start
3. **Patches `.gitignore`** with harness-generated file entries
4. **Creates the memory folder** (`~/.claude/projects/<slug>/memory/`) so Claude Code can persist notes across sessions

If `CLAUDE.md` already exists it is left untouched.

---

## File structure

```
harness/
  arch-map.mjs              # Generate harness/arch-map.html + summary
  arch-serve.mjs            # Watch server — live-reloads on file changes
  install.mjs               # Zero-config setup: hooks + CLAUDE.md + .gitignore + memory
  doctor.mjs                # Diagnose: hooks wired? files tracked? docs honest?
  AGENTS.protocol.md        # The read-before-answer rules
  architecture.json         # Component graph — define per project
  notes.json                # Planning notes store (auto-created, git-committed)
  templates/
    CLAUDE.md               # Template used by install.mjs to generate project CLAUDE.md
    settings.json           # Hook config merged into .claude/settings.json
    thinking_protocol.md    # Thinking Protocol v2.2 — use with Claude.ai or the API
    TODO.md                 # Starter TODO template
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

## Commands

```bash
npm run harness:install   # Zero-config setup (hooks + CLAUDE.md + .gitignore + memory)
npm run arch              # Regenerate harness/arch-map.html
npm run arch:watch        # Live watch server on http://localhost:4319
npm run harness:check     # List tracked files changed since baseline
npm run harness:baseline  # Reset the baseline after re-reading changes
npm run harness:verify    # Check doc claims still match the code
npm run harness:lockstep  # Check lockstep file pairs are in sync
npm run harness:doctor    # Confirm hooks wired, files tracked, docs honest
```

---

## Customise for your project

### tracked-files.json

Files the agent re-reads at session start before answering any status question:

```json
{
  "files": [
    { "path": "README.md", "reason": "Project entry point" },
    { "path": "TODO.md",   "reason": "Current priorities" }
  ]
}
```

### guard-config.json

Files that must be edited together (lockstep) and paths that get a just-in-time caution:

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

### assertions.json

Doc-vs-code claims that `harness:verify` checks on every session start:

```json
{
  "assertions": [
    { "id": "has-tests", "type": "file-exists", "path": "src/__tests__" }
  ]
}
```
