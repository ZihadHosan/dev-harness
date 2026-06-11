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

## Quick start

```bash
# 1. Copy the harness folder into your project
cp -r dev-harness/harness ./harness

# 2. Run zero-config setup
node harness/install.mjs

# 3. Open the dashboard
npm run arch:watch   # http://localhost:4319
```

`install.mjs` auto-detects your stack from `package.json` and sets up everything — no prompts, no placeholders:
- Wires all Claude Code hooks into `.claude/settings.json`
- Writes `CLAUDE.md` with your detected Project Constraints (lang, framework, test runner, db, branch)
- Patches `.gitignore`
- Creates the Claude memory folder

---

## architecture.json

The component graph. Define zones (layers) and nodes (components):

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

**Copy as prompt** — click the button on any component to copy a formatted markdown context block for Claude.

---

## Requirements

- Node 18+
- No other dependencies

---

## License

MIT © [Zihad Hosan](https://github.com/ZihadHosan)
