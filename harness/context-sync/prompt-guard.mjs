#!/usr/bin/env node
/**
 * prompt-guard.mjs — UserPromptSubmit hook (Claude Code).
 *
 * Reads the hook payload (JSON) on stdin. If the user's prompt contains a
 * "something changed" signal ("I pushed", "I updated X", "recheck", …), it runs
 * the staleness check and injects a reminder + the list of tracked files that
 * differ — mechanically automating Protocol Rule 2 instead of trusting the model
 * to remember it.
 *
 * Contract: print injected context to stdout, exit 0. On no match (or any error),
 * print nothing and exit 0 — never block the user's prompt.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { matchesChangeSignal, extractPrompt, hashFile } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '../..')
const BASELINE_FILE = join(PROJECT_ROOT, '.harness-baseline.json')
const TRACKED_FILE = join(HERE, 'tracked-files.json')

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function trackedPaths() {
  try {
    const parsed = JSON.parse(readFileSync(TRACKED_FILE, 'utf8'))
    return (parsed.files || []).map((f) => f.path)
  } catch {
    return []
  }
}

function changedFiles() {
  if (!existsSync(BASELINE_FILE)) return []
  let baseline
  try {
    baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  } catch {
    return []
  }
  const out = []
  for (const p of trackedPaths()) {
    const cur = hashFile(join(PROJECT_ROOT, p))
    if (baseline.hashes?.[p] !== cur) out.push(p)
  }
  return out
}

function main() {
  const prompt = extractPrompt(readStdin())
  if (!matchesChangeSignal(prompt)) return // silent: no signal

  const changed = changedFiles()
  const list = changed.length ? changed.join(', ') : trackedPaths().join(', ')
  // Injected as additional context for this turn.
  console.log(
    `⚠️ HARNESS (Rule 2): the user signaled a change. Do NOT answer from cached context — ` +
    `re-read these now before responding: ${list}.`
  )
}

try {
  main()
} catch {
  /* advisory only — never block the prompt */
}
process.exit(0)
