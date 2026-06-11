#!/usr/bin/env node
/**
 * doctor.mjs — "is the harness actually installed and healthy?" self-check (zero deps).
 *
 * The harness degrades silently: if someone clones the repo and forgets
 * `npm run harness:install`, the hooks never fire and nothing complains. This
 * command makes that failure loud. It checks, in one place:
 *   1. the three hooks are wired in .claude/settings.json
 *   2. every tracked file in tracked-files.json exists
 *   3. a staleness baseline exists (so hash-check has something to compare against)
 *   4. all doc-vs-reality assertions hold (delegates to verify's runAssertions)
 *
 * Usage:
 *   node harness/doctor.mjs            # report
 *   node harness/doctor.mjs --strict    # exit 1 if anything is unhealthy (CI)
 *
 * Exit 0 by default; with --strict, exit 1 on any failure.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { commandsIn, runAssertions } from './context-sync/lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '..')
const SETTINGS = join(PROJECT_ROOT, '.claude', 'settings.json')
const BASELINE = join(PROJECT_ROOT, '.harness-baseline.json')
const TRACKED = join(HERE, 'context-sync', 'tracked-files.json')
const TEMPLATE = join(HERE, 'templates', 'settings.json')
const ASSERTIONS = join(HERE, 'context-sync', 'assertions.json')

const argv = process.argv.slice(2)
const STRICT = argv.includes('--strict')
// In CI the staleness baseline (.harness-baseline.json) is per-machine + gitignored, so
// it legitimately doesn't exist. --ci skips that one check; everything committed (hooks,
// tracked files, doc-vs-reality) is still enforced.
const CI = argv.includes('--ci')

const results = []
function check(label, ok, detail) {
  results.push({ label, ok, detail })
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

// 1. Hooks wired? Every command in the template must be present in settings.json.
try {
  const template = readJson(TEMPLATE)
  if (!existsSync(SETTINGS)) {
    check('hooks wired in .claude/settings.json', false, 'settings.json missing — run `npm run harness:install`')
  } else {
    const settings = readJson(SETTINGS)
    for (const [event, groups] of Object.entries(template.hooks || {})) {
      const have = commandsIn(settings.hooks?.[event])
      const want = (groups || []).flatMap((g) => (g.hooks || []).map((h) => h.command))
      const missing = want.filter((c) => !have.has(c))
      check(`hook wired: ${event}`, missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '')
    }
  }
} catch (e) {
  check('hooks wired in .claude/settings.json', false, e.message)
}

// 2. Tracked files all exist.
try {
  const tracked = (readJson(TRACKED).files || []).map((f) => f.path)
  const missing = tracked.filter((p) => !existsSync(join(PROJECT_ROOT, p)))
  check(`tracked files exist (${tracked.length})`, missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '')
} catch (e) {
  check('tracked files exist', false, e.message)
}

// 3. Baseline present (skipped in CI — it's per-machine + gitignored).
if (!CI) {
  check('staleness baseline initialized', existsSync(BASELINE), existsSync(BASELINE) ? '' : 'run `npm run harness:baseline` (or start a session — SessionStart seeds it)')
}

// 4. Doc-vs-reality assertions hold.
try {
  const assertions = readJson(ASSERTIONS).assertions || []
  const { pass, fail } = runAssertions(assertions, PROJECT_ROOT)
  check(`doc-vs-reality assertions (${pass.length}/${assertions.length})`, fail.length === 0,
    fail.length ? `failing: ${fail.map((f) => f.assertion.id).join(', ')} — run \`npm run harness:verify\`` : '')
} catch (e) {
  check('doc-vs-reality assertions', false, e.message)
}

// Report.
const failed = results.filter((r) => !r.ok)
console.log('\n🩺 Harness doctor\n')
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.label}${r.detail ? `\n       ${r.detail}` : ''}`)
}
console.log(
  failed.length === 0
    ? '\n✅ Harness is healthy — hooks wired, files tracked, docs honest.\n'
    : `\n⚠️  ${failed.length} issue(s) above. The harness still degrades gracefully, but fix these for full enforcement.\n`
)

process.exit(STRICT && failed.length ? 1 : 0)
