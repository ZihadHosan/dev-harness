#!/usr/bin/env node
/**
 * hash-check.mjs — Staleness detector for tracked project files (zero deps).
 *
 * Compares current file hashes against a recorded baseline (`.harness-baseline.json`)
 * and reports which tracked files changed, were added, or were removed since the
 * agent last synced. Runs on plain Node — no ts-node / typescript needed.
 *
 * Usage:
 *   node harness/context-sync/hash-check.mjs            # compare against baseline (report)
 *   node harness/context-sync/hash-check.mjs --update   # reset baseline after re-reading
 *   node harness/context-sync/hash-check.mjs --quiet     # one-line summary for hook injection
 *
 * Exit code is ALWAYS 0 — this is an advisory signal, it must never block a session
 * or a commit. The SessionStart hook runs `--quiet`; `npm run harness:baseline`
 * runs `--update` after the agent has re-read the changed files.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashFile as hashAbs, diffHashes, buildAdvanceRecord } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '../..')
const BASELINE_FILE = join(PROJECT_ROOT, '.harness-baseline.json')
const TRACKED_FILE = join(HERE, 'tracked-files.json')

const args = process.argv.slice(2)
const QUIET = args.includes('--quiet')
const UPDATE = args.includes('--update')

function loadTracked() {
  try {
    const raw = readFileSync(TRACKED_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.files) ? parsed.files : []
  } catch (e) {
    log(`harness: could not read tracked-files.json (${e.message})`)
    return []
  }
}

function hashFile(relPath) {
  return hashAbs(join(PROJECT_ROOT, relPath))
}

function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) return null
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  } catch {
    return null
  }
}

function saveBaseline(hashes, extra = {}) {
  writeFileSync(BASELINE_FILE, JSON.stringify({ hashes, timestamp: new Date().toISOString(), ...extra }, null, 2))
}

/** In --quiet mode print nothing unless there's something the agent must act on. */
function log(msg) {
  if (!QUIET) console.log(msg)
}

function main() {
  const tracked = loadTracked()
  const current = {}
  for (const f of tracked) current[f.path] = hashFile(f.path)

  // --update: reset the baseline to "now" (agent has re-read everything).
  // Record what this advance ABSORBS so end-of-session re-baselining is auditable
  // instead of silent: the next session can see exactly what the previous one changed.
  if (UPDATE) {
    const lastAdvance = buildAdvanceRecord(loadBaseline(), current)
    saveBaseline(current, lastAdvance ? { lastAdvance } : {})
    log(`✅ Baseline saved (${tracked.length} files) → .harness-baseline.json`)
    return
  }

  const baseline = loadBaseline()

  // First run: nothing to compare against — initialize silently-ish.
  if (!baseline || !baseline.hashes) {
    saveBaseline(current)
    log('ℹ️  Harness baseline initialized. Future sessions will report changes since now.')
    return
  }

  const { changed, added, removed } = diffHashes(baseline.hashes, current)

  const all = [...changed, ...added, ...removed]
  if (all.length === 0) {
    if (QUIET) {
      // Positive signal: explicit permission to trust prior context, so a cautious
      // (low-tier/fast) model doesn't re-read all tracked files "just to be safe".
      console.log('✅ HARNESS: tracked files unchanged since last session — prior context valid, no re-read needed.')
      return
    }
    log(`✅ Tracked files unchanged since ${baseline.timestamp}.`)
    if (!QUIET && baseline.lastAdvance) {
      const { changed: c = [], added: a = [], removed: r = [] } = baseline.lastAdvance
      const absorbed = [...c, ...a, ...r]
      if (absorbed.length) log(`ℹ️  Previous session changed: ${absorbed.join(', ')} (re-baselined at ${baseline.lastAdvance.at}).`)
    }
    return
  }

  if (QUIET) {
    // One-line, high-signal summary the SessionStart hook injects as context.
    const parts = []
    if (changed.length) parts.push(`changed: ${changed.join(', ')}`)
    if (added.length) parts.push(`new: ${added.join(', ')}`)
    if (removed.length) parts.push(`removed: ${removed.join(', ')}`)
    console.log(`⚠️ HARNESS: tracked files differ since last session — RE-READ before status answers (${parts.join(' · ')}).`)
    return
  }

  console.log('\n⚠️  CHANGES DETECTED — re-read these before answering status/priority questions:\n')
  for (const f of changed) console.log(`  📝 CHANGED:  ${f}`)
  for (const f of added) console.log(`  🆕 NEW:      ${f}`)
  for (const f of removed) console.log(`  🗑️  REMOVED:  ${f}`)
  console.log('\nRun `npm run harness:baseline` after re-reading to reset the baseline.')
}

try {
  main()
} catch (e) {
  // Never fail a session/commit on advisory tooling.
  if (!QUIET) console.error(`harness hash-check error: ${e.message}`)
}
process.exit(0)
