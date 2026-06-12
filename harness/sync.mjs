#!/usr/bin/env node
/**
 * sync.mjs — one-shot sync orchestrator.
 *
 * Runs all generation phases in order:
 *   1. analyze   — detect project state + deep scan
 *   2. AGENTS.md — sync auto blocks, preserve manual sections
 *   3. architecture.json — merge new zones/nodes, preserve customisations
 *   4. tracked-files.json — merge new key files
 *   5. ONBOARDING.md — generate once (skip if exists)
 *
 * Usage:
 *   node harness/sync.mjs              # sync everything
 *   node harness/sync.mjs --quiet      # minimal output (for git hooks)
 *   node harness/sync.mjs --verbose    # show full analysis output
 *
 * Triggered by:
 *   npm run harness:sync
 *   git post-commit hook (automatic)
 *   npm run harness:watch (on file save, via arch-serve.mjs)
 */

import { writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const args = process.argv.slice(2)
const QUIET   = args.includes('--quiet')
const VERBOSE = args.includes('--verbose')

function log(msg) {
  if (!QUIET) console.log(msg)
}

function logVerbose(msg) {
  if (VERBOSE) console.log(msg)
}

async function run() {
  const start = Date.now()

  // Phase 1 — Analyze
  const { projectModel } = await import('./analyze.mjs')
  const model = projectModel(ROOT)

  logVerbose(`\n  State:   ${model.state}`)
  logVerbose(`  Stack:   ${model.lang} · ${model.framework} · test: ${model.test}`)
  if (model.zones?.length) logVerbose(`  Zones:   ${model.zones.map((z) => z.path).join(', ')}`)

  const b = model.health?.blocking?.length ?? 0
  const d = model.health?.debt?.length ?? 0
  const g = model.gitStatus?.length ?? 0

  writeFileSync(
    join(HERE, 'health.json'),
    JSON.stringify({ blocking: b, debt: d, inProgress: g, scannedAt: new Date().toISOString() }, null, 2) + '\n'
  )

  // Phase 2 — AGENTS.md
  const { syncAgents } = await import('./generate-agents.mjs')
  const agentsResult = syncAgents(ROOT, model)

  // Phase 3 — architecture.json
  const { syncArch } = await import('./generate-arch.mjs')
  const archResult = syncArch(ROOT, model)

  // Phase 4 — tracked-files.json
  const { syncTracked } = await import('./generate-tracked.mjs')
  const trackedResult = syncTracked(ROOT, model)

  // Phase 5 — ONBOARDING.md (skip if exists)
  const { generateOnboarding } = await import('./generate-onboarding.mjs')
  const onboardingResult = generateOnboarding(ROOT, model)

  const elapsed = Date.now() - start

  if (QUIET) {
    const changes = [
      agentsResult.updated   ? 'AGENTS.md'          : null,
      agentsResult.created   ? 'AGENTS.md (new)'    : null,
      archResult.updated     ? 'architecture.json'  : null,
      archResult.created     ? 'architecture.json (new)' : null,
      trackedResult.updated  ? 'tracked-files.json' : null,
      onboardingResult.created ? 'ONBOARDING.md (new)' : null,
    ].filter(Boolean)

    if (changes.length) {
      console.log(`harness:sync — updated: ${changes.join(', ')} · ${b} blocking · ${d} debt · ${g} in progress`)
    } else {
      console.log(`harness:sync — up to date · ${b} blocking · ${d} debt · ${g} in progress`)
    }
    return
  }

  log(`\n  harness:sync`)
  log(`  ─────────────────────────────────`)

  const status = (r) => r.created ? '✅ created' : r.updated ? '✅ updated' : '↩  up to date'

  log(`  AGENTS.md            ${status(agentsResult)}`)
  log(`  architecture.json    ${status(archResult)}`)
  log(`  tracked-files.json   ${status(trackedResult)}`)
  log(`  ONBOARDING.md        ${onboardingResult.skipped ? '↩  exists (preserved)' : '✅ created'}`)
  log('')
  log(`  Health: ${b} blocking · ${d} debt · ${g} in progress`)
  log(`  Done in ${elapsed}ms`)
  log('')
}

try {
  await run()
} catch (e) {
  console.error(`harness:sync error: ${e.message}`)
  if (process.argv.includes('--verbose')) console.error(e.stack)
  process.exit(1)
}
