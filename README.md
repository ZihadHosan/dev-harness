# dev-harness

**AI-native project harness** — architecture map, planning board, and health checks for any codebase.

Built for developers using Claude Code. Drop it into any project (new or existing) and get a live, interactive map of your codebase with built-in planning, health tracking, and Claude-ready context export.

---

## What it does

- **Architecture map** — visual component graph colored by live health (blocking / debt / in progress / healthy)
- **Planning board** — kanban-style notes, ideas, and todos attached to components or global
- **Health checks** — assertions that fail CI when docs drift from code
- **Overview tab** — project health stats, P0/P1 priorities, onboarding guide
- **Copy as prompt** — one click exports any component's full context for Claude

---

## Installation

### Step 1 — Clone dev-harness

```bash
git clone https://github.com/ZihadHosan/dev-harness.git
```

Clone it anywhere — next to your project, in a tools folder, wherever is convenient.

### Step 2 — Run init from your project root

```bash
cd /path/to/your-project
node /path/to/dev-harness/init.mjs
```

That's it. No prompts. No config. It auto-detects your stack and sets up everything:

| What | Result |
| --- | --- |
| Copies `harness/` into your project | `your-project/harness/` |
| Adds scripts to your `package.json` | `npm run arch:watch`, `npm run harness:*` |
| Wires Claude Code hooks | `.claude/settings.json` |
| Writes `CLAUDE.md` | Auto-detected lang, framework, test runner, db, branch |
| Patches `.gitignore` | Excludes generated files |
| Creates Claude memory folder | `~/.claude/projects/<slug>/memory/` |

### Step 3 — Open the dashboard

```bash
npm run arch:watch
# → http://localhost:4319
```

---

## Example

```bash
# clone dev-harness once
git clone https://github.com/ZihadHosan/dev-harness.git ~/tools/dev-harness

# install into your project
cd ~/projects/my-app
node ~/tools/dev-harness/init.mjs

# open the dashboard
npm run arch:watch
```

---

## After install — describe your architecture

Edit `harness/architecture.json` to define your project's component graph:

```json
{
  "name": "My Project",
  "zones": [
    { "id": "frontend", "label": "Frontend", "sub": "src/" }
  ],
  "nodes": [
    {
      "id": "app-entry",
      "zone": "frontend",
      "label": "App entry",
      "path": "src/main.js",
      "desc": "Application entry point.",
      "assertions": [],
      "todoMatch": ""
    }
  ]
}
```

Node health is **derived automatically** from:
- Failing assertions in `harness/context-sync/assertions.json`
- Open P0/P1 items in `TODO.md` that match the node's `todoMatch` pattern

---

## Planning board

Under `arch:watch`, click any component → add notes, ideas, todos. They save to `harness/notes.json` (git-committed) and show as badges on the map.

**Copy as prompt** — click the button on any component to copy a structured context block ready to paste into Claude.

---

## Available commands

```bash
npm run arch:watch        # live dashboard — http://localhost:4319
npm run arch              # regenerate harness/arch-map.html once
npm run harness:install   # re-run setup (idempotent — safe to run again)
npm run harness:check     # list tracked files changed since last session
npm run harness:verify    # check doc claims still match the code
npm run harness:doctor    # confirm hooks, tracked files, and docs are all healthy
```

---

## Requirements

- Node 18+
- Claude Code (for the hooks to fire)
- No other dependencies

---

## License

MIT © [Zihad Hosan](https://github.com/ZihadHosan)
