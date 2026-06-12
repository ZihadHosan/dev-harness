# CLAUDE.md

**Read [`AGENTS.md`](./AGENTS.md)** — single source of truth for what this project is, how it's built, and what's next.

## Agent harness (mandatory)

This project runs an enforced read-before-answer harness — see
[`harness/AGENTS.protocol.md`](./harness/AGENTS.protocol.md).

**Hooks fire automatically** via `.claude/settings.json`:
- **SessionStart** → `hash-check.mjs` (staleness) + `verify.mjs` (doc vs code)
- **UserPromptSubmit** → `prompt-guard.mjs` (detects "I pushed / I updated X")
- **PreToolUse** → `edit-guard.mjs` (lockstep partners + high-risk cautions)
- **Stop** → `hash-check.mjs --update` (advance baseline) + `arch-map.mjs` (regen map)

Before answering any **status / priority / "what's broken"** question, read every file
in [`harness/context-sync/tracked-files.json`](./harness/context-sync/tracked-files.json).
If the harness flags a file as changed, re-read it — never answer from cached context.

## Commands

```bash
npm run arch              # regenerate harness/arch-map.html
npm run arch:watch        # live watch dashboard on http://localhost:4319
npm run harness:sync      # re-analyze project, update AGENTS.md + architecture.json
npm run harness:check     # list tracked files changed since baseline
npm run harness:baseline  # reset baseline after re-reading changes
npm run harness:verify    # check doc claims still match the code
npm run harness:doctor    # confirm hooks wired, files tracked, docs honest
npm run harness:lockstep  # check lockstep file pairs are in sync
```

## Guardrails

- **Trust code over docs.** Code wins — fix the doc (`npm run harness:verify`).
- **Lockstep:** define duplicated-logic file pairs in `guard-config.json → lockstepGroups`. Edit all copies in one change.
- **High-risk paths:** define in `guard-config.json → highRisk`. Agent gets a just-in-time caution before editing.
- **Before committing:** `npm test` green + `npm run harness:verify` + `npm run harness:lockstep`.
- **When unsure, stop and ask** — never guess a file path or API.

## After every task — NON-NEGOTIABLE

After completing ANY task that touches code, you MUST:
1. Run `npm test` — all tests must pass
2. Run `npm run build` — build must succeed with no errors
3. Report results with explicit checkmarks:
   - ✅ Tests: N passed
   - ✅ Build: success

Never report a task as done without these two checks. No exceptions.

## Thinking Protocol v3.0

```
Think before you act. Never guess. Never shorten code.

If the user message starts with a <context> block, treat it as ground truth.
If critical info is missing and not inferable from the code, ask ONE question, then stop.

For every code task, respond using exactly these tags, in order, no prose outside them:

<read>
What the target actually does: purpose, inputs, outputs, side effects. Max 3 sentences.
</read>

<scope>
Everything that touches it: callers, importers, shared state, API contracts.
"isolated" if nothing.
</scope>

<plan>
The exact change and why it solves the task. One approach. No alternatives unless asked.
</plan>

<risk>
Each specific thing that could break — function, contract, data shape, consumer.
After planning, mark each: RESOLVED (how) or OPEN (why). Never hide an OPEN risk.
"none" if nothing.
</risk>

<answer>
Final code, command, or decision only.
Code complete — no "...", no "rest unchanged", no placeholder.
If uncertain an API/import exists, flag it in <risk>, never guess it in <answer>.
Required follow-up (tests, restart): one line after the code.
</answer>

Scale to the task:
- Question, no code change → <read> + <answer> only.
- Meta/setup tasks (reading config, .md ops) → no tags at all.
- One-line fix → one <answer> block, no padding.

Formatting: code block for every path, command, and identifier. Headings, bullets,
and bold only when structure genuinely aids scanning — default to plain prose.
No filler, no affirmations, no restating the user's request.
```

## Claude Code addendum

```
Once per session, before the first edit: ask whether `git pull` has been run.
If not, ask permission to run it. Never ask again mid-session. Never edit a stale tree.
```

## Project Constraints

{{PROJECT_CONSTRAINTS}}
