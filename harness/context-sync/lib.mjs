/**
 * lib.mjs — pure, testable helpers shared by the harness scripts (zero deps).
 *
 * The CLI scripts (hash-check / prompt-guard / install / verify / doctor) are thin
 * wrappers around the functions here. Keeping the logic pure + exported is what lets
 * `tests/harness.test.js` cover the harness itself — the repo's own invariant
 * (entitlement/parsing logic needs tests) applied to the harness.
 *
 * Nothing here reads process state or exits; callers own I/O and exit codes.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, sep } from 'node:path'

// ---------------------------------------------------------------------------
// Change-signal detection (prompt-guard)
// ---------------------------------------------------------------------------

/**
 * Phrases that mean "my last action changed state you may not have seen."
 * Deliberately broad — a false positive costs one extra re-read; a false
 * negative lets the model answer from stale context (the failure we guard against).
 */
export const CHANGE_SIGNAL =
  /\b(i\s+(just\s+)?(pushed|pulled|updated|changed|modified|rebased|merged|deployed|bumped|committed|made\s+changes|added|edited|wrote|removed|deleted)|(just\s+)?pushed\s+to|new\s+commit|re-?check|re-?read|it'?s\s+different\s+now|check\s+the\s+(new|updated)|look\s+again)\b/i

/** True when the user's prompt carries a "something changed" signal. */
export function matchesChangeSignal(text) {
  return Boolean(text) && CHANGE_SIGNAL.test(text)
}

/** Extract the user's prompt from a hook stdin payload (JSON or raw text). */
export function extractPrompt(raw) {
  try {
    const obj = JSON.parse(raw)
    if (typeof obj.prompt === 'string') return obj.prompt
    if (typeof obj.user_prompt === 'string') return obj.user_prompt
  } catch {
    /* not JSON — treat as raw text */
  }
  return raw || ''
}

// ---------------------------------------------------------------------------
// Hashing + staleness diff (hash-check / prompt-guard)
// ---------------------------------------------------------------------------

export function hashBuffer(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** Hash a file by absolute path, or the sentinel 'MISSING' when absent. */
export function hashFile(absPath) {
  if (!existsSync(absPath)) return 'MISSING'
  return hashBuffer(readFileSync(absPath))
}

/** Compare two { path: hash } maps. Returns the changed / added / removed paths. */
export function diffHashes(baselineHashes = {}, currentHashes = {}) {
  const changed = []
  const added = []
  const removed = []
  for (const [p, h] of Object.entries(currentHashes)) {
    if (!(p in baselineHashes)) added.push(p)
    else if (baselineHashes[p] !== h) changed.push(p)
  }
  for (const p of Object.keys(baselineHashes)) {
    if (!(p in currentHashes)) removed.push(p)
  }
  return { changed, added, removed }
}

/**
 * Build the `lastAdvance` audit record for an end-of-session re-baseline: what the
 * new baseline ABSORBS relative to the prior one. Returns undefined when there's no
 * prior baseline and nothing to carry; carries the prior record forward when this
 * advance changed nothing (so the "last meaningful change" stays visible).
 */
export function buildAdvanceRecord(prior, currentHashes, now = new Date().toISOString()) {
  let lastAdvance = prior?.lastAdvance
  if (prior?.hashes) {
    const d = diffHashes(prior.hashes, currentHashes)
    if (d.changed.length || d.added.length || d.removed.length) {
      lastAdvance = { from: prior.timestamp, at: now, ...d }
    }
  }
  return lastAdvance
}

// ---------------------------------------------------------------------------
// Hook merge (install)
// ---------------------------------------------------------------------------

/** Every `command` string already wired under a hooks-event array. */
export function commandsIn(eventArr) {
  const set = new Set()
  for (const group of eventArr || []) {
    for (const h of group.hooks || []) {
      if (h && typeof h.command === 'string') set.add(h.command)
    }
  }
  return set
}

/**
 * Merge `templateHooks` into `settings.hooks`, appending only the individual hooks
 * whose `command` isn't already wired (dedupe at the hook level, not the group level —
 * so a template group that gains a new hook doesn't re-add the hooks already present).
 * Missing hooks from a group are appended as a fresh group, preserving the group's
 * non-hook keys (e.g. `matcher`). Mutates and returns `settings` plus the added /
 * already-present command lists. All non-hook keys on `settings` are untouched.
 */
export function mergeHooks(settings, templateHooks) {
  settings.hooks = settings.hooks || {}
  const added = []
  const present = []
  for (const [event, groups] of Object.entries(templateHooks || {})) {
    const dest = settings.hooks[event] || (settings.hooks[event] = [])
    const have = commandsIn(dest)
    for (const group of groups) {
      const missing = (group.hooks || []).filter((h) => !have.has(h.command))
      const here = (group.hooks || []).filter((h) => have.has(h.command))
      present.push(...here.map((h) => h.command))
      if (missing.length) {
        dest.push({ ...group, hooks: missing })
        for (const h of missing) {
          added.push(h.command)
          have.add(h.command)
        }
      }
    }
  }
  return { settings, added, present }
}

// ---------------------------------------------------------------------------
// Doc-vs-reality assertions (verify / doctor)
// ---------------------------------------------------------------------------

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', '.nuxt', '.output', '.vercel', 'coverage', '.vite'
])

/** Recursively list files under `dir` (absolute), skipping ignored directories. */
export function walkFiles(dir, ignoreDirs = DEFAULT_IGNORE_DIRS, root = dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ignoreDirs.has(ent.name)) continue
      walkFiles(full, ignoreDirs, root, out)
    } else if (ent.isFile()) {
      out.push(relative(root, full).split(sep).join('/'))
    }
  }
  return out
}

/** Count lines in a string the way `wc -l`-ish tools do (final newline ignored). */
export function countLines(content) {
  if (!content) return 0
  const n = content.split('\n').length
  return content.endsWith('\n') ? n - 1 : n
}

// ---------------------------------------------------------------------------
// Lockstep + risk reminders (anti-hallucination for low-tier models)
// ---------------------------------------------------------------------------

/** Normalize a path to repo-relative, forward-slashed, no leading "./". */
export function relForward(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * Given lockstep groups (each `{ id, files: [...], note }`) and the set of changed
 * repo-relative paths, return the violations: a group is violated when SOME of its
 * files changed but not ALL (the classic "edited one copy of duplicated logic, forgot
 * the other"). Returns `[{ id, note, changed: [...], missing: [...] }]`.
 */
export function checkLockstep(groups, changedPaths) {
  const changed = new Set([...(changedPaths || [])].map(relForward))
  const out = []
  for (const g of groups || []) {
    const files = (g.files || []).map(relForward)
    const hit = files.filter((f) => changed.has(f))
    const miss = files.filter((f) => !changed.has(f))
    if (hit.length > 0 && miss.length > 0) {
      out.push({ id: g.id, note: g.note || '', changed: hit, missing: miss })
    }
  }
  return out
}

/**
 * Reminders to inject just-in-time when a given file is about to be edited:
 *   - lockstep partners (the other copies you must edit in lockstep)
 *   - high-risk notes (path regex → caution string)
 * Returns an array of short strings (empty when the file isn't risky).
 */
export function riskRemindersFor(filePath, config = {}) {
  const rel = relForward(filePath)
  const out = []
  for (const g of config.lockstepGroups || []) {
    const files = (g.files || []).map(relForward)
    if (files.includes(rel)) {
      const others = files.filter((f) => f !== rel)
      out.push(`Lockstep (${g.id}): also edit ${others.join(' + ')} in the same change. ${g.note || ''}`.trim())
    }
  }
  for (const r of config.highRisk || []) {
    try {
      if (new RegExp(r.match).test(rel)) out.push(r.note)
    } catch {
      /* bad regex in config — skip */
    }
  }
  return out
}

function compareCount(actual, op, expected) {
  switch (op) {
    case '==': return actual === expected
    case '>=': return actual >= expected
    case '<=': return actual <= expected
    case '>': return actual > expected
    case '<': return actual < expected
    case '!=': return actual !== expected
    default: return false
  }
}

/**
 * Evaluate one assertion against the repo rooted at `root`.
 * Supported types:
 *   file-exists  {path}                          — file must exist
 *   file-absent  {path}                          — file must NOT exist
 *   npm-script   {script}                         — package.json scripts has it
 *   file-contains{path, pattern}                  — file matches regex
 *   file-lacks   {path, pattern}                  — file does NOT match regex
 *   file-count   {dir, match, op, value}          — # files under dir matching regex `op` value
 *   tree-lacks   {dir, include, pattern}          — no included file under dir matches regex
 * Returns { ok, detail }.
 */
export function evalAssertion(a, root, deps = {}) {
  const exists = deps.existsSync || existsSync
  const read = deps.readFileSync || ((p) => readFileSync(p, 'utf8'))
  const walk = deps.walkFiles || walkFiles
  const abs = (p) => join(root, p)

  try {
    switch (a.type) {
      case 'file-exists':
        return exists(abs(a.path))
          ? { ok: true }
          : { ok: false, detail: `missing file: ${a.path}` }

      case 'file-absent':
        return !exists(abs(a.path))
          ? { ok: true }
          : { ok: false, detail: `file should not exist: ${a.path}` }

      case 'npm-script': {
        if (!exists(abs('package.json'))) return { ok: false, detail: 'no package.json' }
        const pkg = JSON.parse(read(abs('package.json')))
        return pkg.scripts && a.script in pkg.scripts
          ? { ok: true }
          : { ok: false, detail: `package.json has no script "${a.script}"` }
      }

      case 'file-contains': {
        if (!exists(abs(a.path))) return { ok: false, detail: `missing file: ${a.path}` }
        const re = new RegExp(a.pattern, a.flags || '')
        return re.test(read(abs(a.path)))
          ? { ok: true }
          : { ok: false, detail: `${a.path} does not match /${a.pattern}/` }
      }

      case 'file-lacks': {
        if (!exists(abs(a.path))) return { ok: true } // absent file can't contain it
        const re = new RegExp(a.pattern, a.flags || '')
        return re.test(read(abs(a.path)))
          ? { ok: false, detail: `${a.path} unexpectedly matches /${a.pattern}/` }
          : { ok: true }
      }

      case 'file-lines': {
        if (!exists(abs(a.path))) return { ok: false, detail: `missing file: ${a.path}` }
        const n = countLines(read(abs(a.path)))
        if (a.max != null && n > a.max) {
          return { ok: false, detail: `${a.path} is ${n} lines (ceiling ${a.max}) — split it before it grows further` }
        }
        if (a.min != null && n < a.min) {
          return { ok: false, detail: `${a.path} is ${n} lines (floor ${a.min})` }
        }
        return { ok: true }
      }

      case 'file-count': {
        const dir = abs(a.dir)
        if (!exists(dir)) return { ok: false, detail: `missing dir: ${a.dir}` }
        const re = new RegExp(a.match)
        const n = walk(dir).filter((p) => re.test(p)).length
        return compareCount(n, a.op, a.value)
          ? { ok: true }
          : { ok: false, detail: `${a.dir}: found ${n} files matching /${a.match}/, need ${a.op} ${a.value}` }
      }

      case 'tree-lacks': {
        const dir = abs(a.dir)
        if (!exists(dir)) return { ok: true }
        const incl = new RegExp(a.include)
        const re = new RegExp(a.pattern)
        const offenders = walk(dir)
          .filter((p) => incl.test(p))
          .filter((p) => {
            try {
              return re.test(read(join(dir, p)))
            } catch {
              return false
            }
          })
        return offenders.length === 0
          ? { ok: true }
          : { ok: false, detail: `${a.dir}: /${a.pattern}/ found in ${offenders.slice(0, 5).join(', ')}` }
      }

      default:
        return { ok: false, detail: `unknown assertion type: ${a.type}` }
    }
  } catch (e) {
    return { ok: false, detail: `assertion error (${a.id || a.type}): ${e.message}` }
  }
}

/** Run every assertion; returns { pass: [...], fail: [{ assertion, detail }] }. */
export function runAssertions(assertions, root, deps = {}) {
  const pass = []
  const fail = []
  for (const a of assertions || []) {
    const res = evalAssertion(a, root, deps)
    if (res.ok) pass.push(a)
    else fail.push({ assertion: a, detail: res.detail })
  }
  return { pass, fail }
}
