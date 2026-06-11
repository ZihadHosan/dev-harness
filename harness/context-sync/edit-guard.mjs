#!/usr/bin/env node
/**
 * edit-guard.mjs — PreToolUse hook: just-in-time anti-hallucination reminders.
 *
 * The strongest guardrail isn't a rule the model has to remember — it's context delivered
 * at the exact moment of risk. Before an Edit/Write/MultiEdit, this hook looks at the file
 * being touched and, if it's a lockstep copy or a high-risk path (guard-config.json),
 * injects a short reminder naming the partner file(s) to keep in sync and the invariant to
 * respect. Ordinary files → silent (no noise).
 *
 * Contract (PreToolUse): read JSON on stdin ({ tool_name, tool_input:{ file_path }, cwd }).
 * Emit additionalContext via hookSpecificOutput and exit 0. NEVER block an edit — advisory
 * only; on any error, stay silent and exit 0.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { riskRemindersFor, relForward } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '../..')
const CONFIG = join(HERE, 'guard-config.json')

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8'))
  } catch {
    return {}
  }
}

/** Resolve the edited file to a repo-relative, forward-slashed path. */
function repoRelative(filePath, cwd) {
  if (!filePath) return ''
  const absolutePath = isAbsolute(filePath) ? filePath : join(cwd || PROJECT_ROOT, filePath)
  return relForward(relative(PROJECT_ROOT, absolutePath))
}

function main() {
  let payload
  try {
    payload = JSON.parse(readStdin())
  } catch {
    return
  }
  const tool = payload.tool_name || ''
  if (!/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return

  const input = payload.tool_input || {}
  const filePath = input.file_path || input.notebook_path || ''
  const rel = repoRelative(filePath, payload.cwd)
  if (!rel) return

  const reminders = riskRemindersFor(rel, loadConfig())
  if (reminders.length === 0) return // not a risky file — stay silent

  const context =
    `⚠️ HARNESS edit-guard for ${rel}:\n` +
    reminders.map((r) => `  • ${r}`).join('\n')

  // PreToolUse additionalContext is the documented way to inject without blocking.
  // Falls back to plain visible text on runtimes that don't parse it — still harmless.
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context }
    })
  )
}

try {
  main()
} catch {
  /* advisory only — never block an edit */
}
process.exit(0)
