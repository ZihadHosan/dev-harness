# Dev Harness — Onboarding

## What is this?

Dev Harness is a **CLI / JavaScript** project.
Update this description to explain what the project does and who it's for.

> For the full architecture breakdown and current priorities, see [`AGENTS.md`](../AGENTS.md).

## Prerequisites

- Node 18+
- npm 9+ (or pnpm / yarn)
- Git

## Getting started

```bash
git clone <repo-url>
cd dev-harness
npm install
npm run dev
```

## Building for production

```bash
npm run build
```

## Architecture map

Run the live dashboard to see component health, open todos, and planning notes:

```bash
npm run arch:watch
```

Opens at `http://localhost:4319`. Stays live as you work — no manual refresh needed.

## Project structure

- **`docs/`** — Docs (0 source files)

## Key files

| File | Purpose |
|------|---------|
| `package.json` | Dependencies & scripts |
| `README.md` | Documentation |
| `AGENTS.md` | AI onboarding |

## Common tasks
| Task | Command |
|------|---------|
| Start dev server | `npm run dev` |
| Build for production | `npm run build` |
| Open architecture map | `npm run arch:watch` |
| Sync project analysis | `npm run harness:sync` |
## Current health

> At time of generation: **0 blocking** issues, **35 tech debt** signals.
> Run `npm run arch:watch` for live status.
