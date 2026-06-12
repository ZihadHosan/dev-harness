# dev-harness

AI-native project harness — architecture map, planning board, and health checks for any codebase.

Works with or without Claude. Zero npm dependencies.

---

## What it gives you

| Feature | Command |
|---|---|
| Live architecture map + health dashboard | `npm run harness:watch` |
| Project analysis + AGENTS.md sync | `npm run harness:sync` |
| Claude Code session hooks | auto (via `.claude/settings.json`) |
| git post-commit sync | auto (git hook installed on init) |

The dashboard opens at `http://localhost:4319` and live-reloads as you work.

---

## Install

Clone dev-harness **inside** your project root, then run `init.mjs` from that same root:

```bash
cd your-project
git clone https://github.com/ZihadHosan/dev-harness
node dev-harness/init.mjs
```

No prompts. No config files to fill in. Fully automatic.

**What gets installed:**

```
harness/                          ← architecture map, sync engine, hooks
AGENTS.md                         ← generated project brain (auto + manual sections)
CLAUDE.md                         ← Claude Code rules (auto-detected stack)
docs/ONBOARDING.md                ← human onboarding doc
.claude/settings.json             ← Claude Code session hooks
.gitignore                        ← harness-generated files excluded
~/.claude/projects/<slug>/memory/ ← Claude memory folder
.git/hooks/post-commit            ← auto-sync after every commit
```

### Dry run (preview without writing)

```bash
node dev-harness/init.mjs --dry-run
```

---

## Daily workflow

```bash
# Start the live dashboard (leave running in a terminal)
npm run harness:watch

# Manually sync project analysis (AGENTS.md + architecture.json)
npm run harness:sync

# Verbose sync — see full analysis output
npm run harness:sync -- --verbose
```

The git post-commit hook runs `harness:sync --quiet` automatically after every commit, so AGENTS.md stays fresh without any manual steps.

---

## AGENTS.md — the project brain

AGENTS.md is generated on install and kept in sync by `harness:sync`. It has two section types:

```markdown
<!-- auto:header -->          ← managed by harness:sync — do not edit
...detected project info...
<!-- /auto:header -->

## Developer Notes            ← your section — NEVER overwritten by sync
> Add team context, conventions, past incidents here.

## Architecture Decisions     ← your section — NEVER overwritten by sync
> Why this framework? What did you decide NOT to do?
```

**Auto sections** (replaced on every sync):
- `header` — project state, stack, scan date
- `stack` — language, framework, runtime, test, DB, branch
- `structure` — detected zones and key files table
- `health` — blocking TODOs/FIXMEs, tech debt, in-progress git files

**Manual sections** (always preserved — write whatever you want):
- `Developer Notes`
- `Architecture Decisions`
- `What's Next`

---

## Architecture map

The dashboard reads `harness/architecture.json` (the curated component graph) and derives health from live signals automatically.

**Health statuses:**
- 🟢 **Healthy** — no open issues
- 🟡 **Tech debt** — large files, console.logs, P1/P2/P3 TODOs
- 🔴 **Blocking** — P0 TODOs, TODO/FIXME comments, failed assertions
- 🔵 **In progress** — `wip: true` set in architecture.json
- ⚪ **Suggested** — framework-conventional nodes not yet built (DEFINED state)

`harness:sync` adds new nodes it detects but never removes or overwrites your customisations.

---

## Project states

Detected automatically on install and every sync:

| State | Condition | What's generated |
|---|---|---|
| **EMPTY** | No config files, no source code | Skeleton architecture.json |
| **DEFINED** | Config files exist, no source yet | Suggested nodes (grey) based on framework |
| **EXISTING** | Real source code detected | Nodes from actual structure + health signals |

---

## Sync triggers

| Trigger | What runs |
|---|---|
| `npm run harness:sync` | One-shot — analyze + update AGENTS.md + architecture.json |
| `npm run harness:watch` | Continuous — re-generates map HTML on file save |
| git post-commit hook | Automatic `harness:sync --quiet` after every commit |

---

## Commands

```bash
npm run harness:map       # regenerate harness/arch-map.html
npm run harness:watch     # live dashboard at http://localhost:4319
npm run harness:sync      # re-analyze + sync AGENTS.md + architecture.json
npm run harness:install   # re-run hooks / CLAUDE.md / gitignore / memory setup
npm run harness:check     # list tracked files changed since baseline
npm run harness:baseline  # reset baseline after re-reading changes
npm run harness:verify    # check doc claims match the code (assertions.json)
npm run harness:lockstep  # check lockstep file pairs are in sync
npm run harness:doctor    # confirm hooks wired, files tracked, docs honest
```

---

## Language support

Detects project type from config files — not locked to Node.js:

| Config file | Detected as |
|---|---|
| `package.json` | Node · JavaScript / TypeScript |
| `tsconfig.json` | TypeScript |
| `Cargo.toml` | Rust |
| `go.mod` | Go |
| `requirements.txt` / `pyproject.toml` | Python |
| `composer.json` | PHP |
| `Gemfile` | Ruby |
| `pom.xml` / `build.gradle` | Java |
| `*.csproj` / `*.sln` | C# / .NET |
| `*.html` (root only) | Static HTML |

---

## Works without Claude

AGENTS.md, the architecture map, and all health signals work without Claude Code. The harness is pure Node.js — no AI, no API keys, no cloud connection.

Claude Code hooks (`.claude/settings.json`) are an optional layer. They make the Claude agent re-read AGENTS.md and changed files before answering. They do nothing if you're not using Claude.

---

## What to commit

```
harness/                   ✅ commit — shared with team
AGENTS.md                  ✅ commit
CLAUDE.md                  ✅ commit (if using Claude Code)
docs/ONBOARDING.md         ✅ commit
.claude/settings.json      ✅ commit (if using Claude Code)

harness/arch-map.html      🚫 gitignored (generated output)
harness/notes.json         🚫 gitignored (local planning notes)
dev-harness/               🚫 gitignored (the tool itself)
```

`init.mjs` adds `dev-harness/` to `.gitignore` automatically.

---

## License

MIT — [Zihad Hosan](https://github.com/ZihadHosan)
