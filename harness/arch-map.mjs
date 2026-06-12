#!/usr/bin/env node
/**
 * arch-map.mjs — generate the harness-fed architecture & health map (zero deps).
 *
 * Reads harness/architecture.json (the curated graph), runs the existing doc-vs-reality
 * assertions (context-sync/assertions.json via runAssertions) and parses TODO.md, then
 * DERIVES each node's health and writes a standalone harness/arch-map.html you can open
 * in a browser. Because health comes from the same signals the harness already enforces,
 * the diagram can't drift out of sync with the truth — a god file crossing its ceiling,
 * a deleted money-path test, or a checked-off TODO all change a node's colour on the next run.
 *
 * Usage:
 *   node harness/arch-map.mjs            # regenerate harness/arch-map.html + summary
 *   node harness/arch-map.mjs --quiet     # one-line summary (for the Stop hook / CI)
 *   node harness/arch-map.mjs --strict    # exit 1 on DRIFT (missing node file / unknown assertion id)
 *
 * Also exports generate() so the watch server (arch-serve.mjs) reuses one code path.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAssertions } from './context-sync/lib.mjs'
import { parseTodo, buildModel, renderArchHtml } from './context-sync/arch-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = resolve(HERE, '..')
export const ARCH_FILE = join(HERE, 'architecture.json')
export const ASSERTIONS_FILE = join(HERE, 'context-sync', 'assertions.json')
export const TODO_FILE = join(PROJECT_ROOT, 'TODO.md')
export const OUT_FILE = join(HERE, 'arch-map.html')
export const NOTES_FILE = join(HERE, 'notes.json')
export const ONBOARDING_FILE = join(PROJECT_ROOT, 'docs', 'ONBOARDING.md')
export const HEALTH_FILE = join(HERE, 'health.json')

function readJson(path, fallback, quiet) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    if (!quiet) console.error(`arch-map: could not read ${path} (${e.message})`)
    return fallback
  }
}

/**
 * Build the model from live signals and write the HTML. Returns { model, outFile }.
 * Pure-ish: only reads the repo + writes OUT_FILE; throws if the graph is unusable.
 */
export function generate({ quiet = false } = {}) {
  const arch = readJson(ARCH_FILE, null, quiet)
  if (!arch || !Array.isArray(arch.nodes)) {
    throw new Error('architecture.json missing or has no nodes')
  }

  const assertions = readJson(ASSERTIONS_FILE, { assertions: [] }, quiet).assertions || []
  const { fail } = runAssertions(assertions, PROJECT_ROOT)
  const failed = new Set(fail.map((f) => f.assertion.id || f.assertion.type))
  const failDetail = new Map(fail.map((f) => [f.assertion.id || f.assertion.type, f.detail]))
  const knownAssertions = new Set(assertions.map((a) => a.id).filter(Boolean))

  const todoText = existsSync(TODO_FILE) ? readFileSync(TODO_FILE, 'utf8') : ''
  const todoItems = parseTodo(todoText)

  const model = buildModel(arch, {
    failed,
    failDetail,
    todoItems,
    knownAssertions,
    fileExists: (p) => existsSync(join(PROJECT_ROOT, p))
  })

  model.todoItems = todoItems
  model.onboarding = existsSync(ONBOARDING_FILE) ? readFileSync(ONBOARDING_FILE, 'utf8') : ''
  model.projectName = arch.name || 'My Project'
  model.scanHealth = existsSync(HEALTH_FILE) ? readJson(HEALTH_FILE, null, quiet) : null
  writeFileSync(OUT_FILE, renderArchHtml(model))
  return { model, outFile: OUT_FILE }
}

/** The files whose changes should retrigger a regenerate (config + every node's own file). */
export function watchTargets() {
  const out = new Set([ARCH_FILE, ASSERTIONS_FILE, TODO_FILE])
  const arch = readJson(ARCH_FILE, { nodes: [] }, true)
  for (const n of arch.nodes || []) {
    if (!n.path) continue
    const abs = join(PROJECT_ROOT, n.path)
    if (existsSync(abs)) out.add(abs)
  }
  return [...out]
}

function cli() {
  const args = process.argv.slice(2)
  const quiet = args.includes('--quiet')
  const strict = args.includes('--strict')

  let model
  try {
    ;({ model } = generate({ quiet }))
  } catch (e) {
    console.error(`arch-map: ${e.message}`)
    return 1
  }

  const c  = model.counts
  const sh = model.scanHealth
  const blocking = sh != null ? sh.blocking : c.crit
  const debt     = sh != null ? sh.debt     : c.debt
  if (quiet) {
    const drift = model.drift.length ? ` · ${model.drift.length} DRIFT` : ''
    console.log(`🗺️  arch-map: ${blocking} blocking · ${debt} debt · ${c.ok} healthy${drift} → harness/arch-map.html`)
  } else {
    console.log(`\n🗺️  Architecture map written → harness/arch-map.html`)
    console.log(`   Blocking ${blocking} · Tech debt ${debt} · In progress ${c.wip} · Healthy ${c.ok}\n`)
    const reds = model.nodes.filter((n) => n.status === 'crit')
    if (reds.length) {
      console.log('   Blocking nodes:')
      for (const n of reds) {
        const why = n.reasons.map((r) => `${r.sev}: ${r.text}`).join('; ') || '(no reason captured)'
        console.log(`     ❌ ${n.label} — ${why}`)
      }
      console.log('')
    }
    if (model.drift.length) {
      console.log('   ⚠️  DRIFT (graph vs repo):')
      for (const d of model.drift) console.log(`     · ${d}`)
      console.log('   Fix architecture.json, then re-run.\n')
    }
  }

  if (strict && model.drift.length) return 1
  return 0
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  let code = 0
  try {
    code = cli()
  } catch (e) {
    console.error(`arch-map error: ${e.message}`)
    code = process.argv.includes('--strict') ? 1 : 0
  }
  process.exit(code)
}
