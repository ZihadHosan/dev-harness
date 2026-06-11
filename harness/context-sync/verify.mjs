#!/usr/bin/env node
/**
 * verify.mjs — doc-vs-reality checker (zero deps).
 *
 * hash-check.mjs catches when a tracked file CHANGES. verify.mjs catches the other
 * failure mode: a doc claim that is FALSE even though the file never changed
 * (born-stale text — e.g. "the backend has no tests" while three test files exist).
 * It evaluates the assertions in `assertions.json` against the actual repo and
 * reports any that no longer hold, naming the doc claim each one backs.
 *
 * Usage:
 *   node harness/context-sync/verify.mjs           # full report
 *   node harness/context-sync/verify.mjs --quiet    # one-line summary for the SessionStart hook
 *   node harness/context-sync/verify.mjs --strict    # exit 1 on any failure (CI gate)
 *
 * Exit code is 0 unless --strict is passed AND something failed — advisory by
 * default so it never blocks a session; opt into a hard gate for CI.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAssertions } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '../..')
const ASSERTIONS_FILE = join(HERE, 'assertions.json')

const args = process.argv.slice(2)
const QUIET = args.includes('--quiet')
const STRICT = args.includes('--strict')

function loadAssertions() {
  try {
    const parsed = JSON.parse(readFileSync(ASSERTIONS_FILE, 'utf8'))
    return Array.isArray(parsed.assertions) ? parsed.assertions : []
  } catch (e) {
    if (!QUIET) console.error(`harness verify: could not read assertions.json (${e.message})`)
    return []
  }
}

function main() {
  const assertions = loadAssertions()
  const { pass, fail } = runAssertions(assertions, PROJECT_ROOT)

  if (fail.length === 0) {
    if (!QUIET) console.log(`✅ Doc-vs-reality: all ${pass.length} assertions hold.`)
    return 0
  }

  if (QUIET) {
    const ids = fail.map((f) => f.assertion.id || f.assertion.type).join(', ')
    console.log(
      `⚠️ HARNESS: ${fail.length} doc claim(s) no longer match the code — FIX THE DOCS before status answers (${ids}).`
    )
    return STRICT ? 1 : 0
  }

  console.log(`\n⚠️  DOC-VS-REALITY: ${fail.length} of ${assertions.length} assertions FAILED — a doc says something the code contradicts:\n`)
  for (const { assertion, detail } of fail) {
    console.log(`  ❌ ${assertion.id || assertion.type}: ${assertion.desc}`)
    console.log(`       claim:  ${assertion.claim || '(unspecified)'}`)
    console.log(`       reality: ${detail}\n`)
  }
  console.log('Fix the doc (or the code) so the claim is true again, then re-run `npm run harness:verify`.')
  return STRICT ? 1 : 0
}

let code = 0
try {
  code = main()
} catch (e) {
  if (!QUIET) console.error(`harness verify error: ${e.message}`)
}
process.exit(code)
