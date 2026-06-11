# AGENTS Protocol — Mandatory Rules for AI Agents

> **This file is non-negotiable.** Before answering ANY question about this
> project's status, priorities, architecture, or what needs to be fixed, you
> MUST follow these steps. No exceptions. No shortcuts.
>
> **Enforcement is automated** via `.claude/settings.json` hooks (SessionStart /
> UserPromptSubmit / Stop — see `harness/README.md`). The rules below are the
> contract those hooks back; on tools without hook support, follow them manually.

---

## 🔒 THE RULES

### Rule 1: Read Tracked Files First

Before answering any status/priority/fix question, read ALL files listed in
`harness/context-sync/tracked-files.json`. Use `read_file` for each one.
Do not skip any.

**Rationale:** You (the model) will think you "already know" these files from
a previous session. You're wrong. Files change. Your context is stale. Re-read.

### Rule 2: Honor "I Updated" / "I Pushed" Signals

If the user says ANY of the following:
- "I updated X"
- "I pushed changes"
- "I made changes"
- "Check the new agents.md"
- "It's different now"
- "recheck"

→ **Stop. Re-read the relevant files immediately.** Do not answer from cached
context. Do not say "I already know this." You don't.

### Rule 3: Structured Output for Status Queries

When the user asks "what's wrong?", "what needs to be fixed?", "what's the
status?", or "compare old vs new":

**Output format:**
1. **What Changed** — bulleted list of specific differences (old → new)
2. **What's Still Broken** — flat list with priority labels (P0/P1/P2/P3)
3. **What's Fixed** — items that are resolved and no longer need action
4. **Verdict** — one-line overall assessment

**Do NOT output** long prose essays when a structured list answers the question.

### Rule 4: Flag Stale Context Proactively

If you realize mid-answer that your context might be outdated, STOP and say:

> ⚠️ **Context may be stale.** I need to re-read [filename] before continuing.

Then re-read, then continue. Do not guess.

### Rule 5: No Hallucinated File Contents

Never assume a file exists, is missing, or contains specific content without
calling `read_file` or `list_files` first. If you haven't read it, you don't
know what's in it.

### Rule 6: Smallest Viable Answer

Before writing a long analysis, ask: **can the user act on this answer?**
If the answer is a 50-item brainstorm but the user asked "what's broken?",
you're giving them noise. Give them the 5 items that matter.

### Rule 7: Distinguish "User Said" vs "I Infer"

When comparing states, be explicit:
- "You told me X changed"
- "I observed Y is different from my last read"
- "I'm inferring Z based on [evidence]"

Never present an inference as a confirmed fact.

### Rule 8: Trust the Code Over the Docs

A doc can be wrong the moment it's written and stay wrong forever — the staleness check
only flags files that *changed*, not files that were *born stale*. When a tracked doc makes
a checkable factual claim ("X is tested", "no Y exists", "Z is wired"), and you're about to
rely on it for a status answer, **verify it against the code** (or run `npm run harness:verify`,
which evaluates `context-sync/assertions.json`). If reality contradicts the doc, fix the doc
and say so — do not repeat a false claim just because a doc asserts it.

---

## 📋 TRACKED FILES CHECKLIST

Before answering, confirm you've read each file in `tracked-files.json`.
Mentally check off each one:

```
[ ] AGENTS.md                  — single source of truth
[ ] TODO.md                    — structured open items
[ ] package.json               — version, deps, scripts
[ ] CHANGELOG.md               — what shipped
[ ] CLAUDE.md                  — entry point + harness pointers
[ ] harness/AGENTS.protocol.md — these rules
```

The authoritative list is `context-sync/tracked-files.json` — read every entry there.
If TODO.md doesn't exist yet, create it from `harness/templates/TODO.md`.

---

## 🔄 SESSION STARTUP SEQUENCE

When beginning a new conversation about this project:

1. Read `harness/AGENTS.protocol.md` (this file)
2. Read `harness/context-sync/tracked-files.json`
3. Read each file listed in tracked-files.json
4. **Then** answer the user's question

If the user interrupts with "just answer the question," politely explain:
> I need to re-read the tracked files first (protocol Rule 1). This takes 5
> seconds and ensures my answer is based on current state, not stale context.

---

## 🚫 FORBIDDEN PHRASES

These phrases are banned because they signal lazy context usage:

- ❌ "I already know this"
- ❌ "As I mentioned before" (in a new session)
- ❌ "Based on my understanding of the project" (without reading)
- ❌ "The file probably contains" (read it first)
- ❌ "I believe the status is" (read it, then say what it IS)

---

## ✅ COMPLIANCE SELF-CHECK

Before submitting your answer, verify:

- [ ] Did I read all tracked files this session?
- [ ] If the user said something changed, did I re-read before answering?
- [ ] Is my output structured (not just prose)?
- [ ] Did I distinguish observed facts from inferences?
- [ ] Would a new team member understand my answer without context?

If any answer is "no," go back and fix it.

---

_This protocol exists because AI agents are unreliable at self-managing context
freshness. These rules compensate for that limitation. Follow them strictly._

_Last updated: 2026-06-07_
