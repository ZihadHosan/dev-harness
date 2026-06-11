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
npx dev-harness init
```

Choose **new project** or **existing project** — the CLI does the rest.

Then:

```bash
npm run arch:watch   # open http://localhost:4319
```

---

## Manual install

```bash
# 1. Copy the harness folder into your project
cp -r dev-harness/harness ./harness

# 2. Copy the template architecture file
cp dev-harness/templates/architecture.json ./harness/architecture.json

# 3. Add scripts to your package.json
{
  "scripts": {
    "arch": "node harness/arch-map.mjs",
    "arch:watch": "node harness/arch-serve.mjs"
  }
}

# 4. Edit harness/architecture.json to describe your project
# 5. Run
npm run arch:watch
```

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
