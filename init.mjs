#!/usr/bin/env node
/**
 * init.mjs — zero-config harness installer for any project.
 *
 * Run from the TARGET project root, pointing at this file:
 *
 *   node path/to/dev-harness/init.mjs
 *   node path/to/dev-harness/init.mjs --dry-run
 *
 * Or via npx (once published):
 *   npx dev-harness
 *
 * What it does (all idempotent):
 *   1. Copy harness/ folder into the target project
 *   2. Add harness scripts to package.json (creates one if absent)
 *   3. Analyze the project — detect state + scan for structure and health
 *   4. Generate AGENTS.md  — project brain (auto + manual blocks)
 *   5. Generate harness/architecture.json — component graph
 *   6. Generate harness/context-sync/tracked-files.json
 *   7. Wire Claude Code hooks (.claude/settings.json)
 *   8. Write CLAUDE.md with auto-detected project constraints
 *   9. Patch .gitignore with harness-generated entries
 *  10. Create Claude memory folder (~/.claude/projects/<slug>/memory/)
 *  11. Install git post-commit hook → npm run harness:sync
 *  12. Generate docs/ONBOARDING.md (last — reads from AGENTS.md)
 */

import { cpSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const toFileUrl = (p) => pathToFileURL(p).href

const HERE   = dirname(fileURLToPath(import.meta.url))  // dev-harness root
const TARGET = process.cwd()                             // user's project root

const args  = process.argv.slice(2)
const DRY   = args.includes('--dry-run')
const FORCE = args.includes('--force') // regenerate even if files exist

// Detect if the tool was cloned inside the target project (e.g. TARGET/dev-harness/)
const _relRaw  = relative(TARGET, HERE)
const _rel     = _relRaw.replace(/\\/g, '/')
const IS_NESTED = _rel !== '' && !_rel.startsWith('..')

// Guard: never install dev-harness into itself
if (resolve(TARGET) === resolve(HERE)) {
  console.error('\n⚠  Run this from your PROJECT root, not from inside dev-harness.\n')
  console.error(`   cd /path/to/your-project`)
  console.error(`   node ${relative(TARGET, join(HERE, 'init.mjs'))}\n`)
  process.exit(1)
}

const HARNESS_SRC  = join(HERE, 'harness')
const HARNESS_DEST = join(TARGET, 'harness')

// ---------------------------------------------------------------------------
// Step 1 — Copy harness/
// ---------------------------------------------------------------------------

function copyHarness() {
  if (existsSync(HARNESS_DEST)) {
    console.log('  ↩  harness/ already exists.')
    return false
  }
  if (DRY) {
    console.log(`  [dry-run] would copy harness/ → ${relative(TARGET, HARNESS_DEST)}/`)
    return false
  }
  cpSync(HARNESS_SRC, HARNESS_DEST, { recursive: true })
  console.log('  ✅ Copied harness/')
  return true
}

// ---------------------------------------------------------------------------
// Step 2 — Add scripts to package.json
// ---------------------------------------------------------------------------

const SCRIPTS = {
  'harness:map':       'node harness/arch-map.mjs',
  'harness:watch':     'node harness/arch-serve.mjs',
  'harness:sync':      'node harness/sync.mjs',
  'harness:install':   'node harness/install.mjs',
  'harness:check':     'node harness/context-sync/hash-check.mjs',
  'harness:baseline':  'node harness/context-sync/hash-check.mjs --update',
  'harness:verify':    'node harness/context-sync/verify.mjs',
  'harness:lockstep':  'node harness/context-sync/lockstep.mjs',
  'harness:doctor':    'node harness/doctor.mjs',
}

function addScripts() {
  const pkgPath = join(TARGET, 'package.json')

  if (!existsSync(pkgPath)) {
    if (DRY) { console.log('  [dry-run] would create package.json'); return }
    const minimal = { name: require_name(), version: '0.1.0', type: 'module', scripts: SCRIPTS }
    writeFileSync(pkgPath, JSON.stringify(minimal, null, 2) + '\n')
    console.log('  ✅ Created package.json with harness scripts')
    return
  }

  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (e) {
    console.error(`  ⚠  package.json is not valid JSON — scripts not added.`)
    return
  }

  pkg.scripts = pkg.scripts || {}
  const added = []
  for (const [name, cmd] of Object.entries(SCRIPTS)) {
    if (!(name in pkg.scripts)) {
      pkg.scripts[name] = cmd
      added.push(name)
    }
  }

  if (!added.length) { console.log('  ↩  All scripts already present.'); return }
  if (DRY) { console.log(`  [dry-run] would add: ${added.join(', ')}`); return }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`  ✅ Added scripts: ${added.join(', ')}`)
}

function require_name() {
  try { return require_basename(TARGET) } catch { return 'my-project' }
}
function require_basename(p) {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'my-project'
}

// ---------------------------------------------------------------------------
// Steps 3-6 — Analyze + Generate
// ---------------------------------------------------------------------------

async function runGeneration() {
  // Run analyze + generate from the TARGET's installed harness
  const analyzeScript = join(HARNESS_DEST, 'analyze.mjs')
  if (!existsSync(analyzeScript)) {
    console.warn('  ⚠  harness/analyze.mjs not found — skipping generation.')
    return null
  }

  const { projectModel } = await import(toFileUrl(analyzeScript))
  const model = projectModel(TARGET)

  console.log(`  Detected: ${model.state} · ${model.lang} · ${model.framework}`)
  if (model.zones?.length) console.log(`  Zones:    ${model.zones.map((z) => z.path).join(', ')}`)

  if (DRY) {
    console.log('  [dry-run] would generate AGENTS.md, architecture.json, tracked-files.json')
    return model
  }

  // AGENTS.md
  const { generateAgents } = await import(toFileUrl(join(HARNESS_DEST, 'generate-agents.mjs')))
  const agentsResult = generateAgents(TARGET, model)
  if (agentsResult.created)       console.log('  ✅ Generated AGENTS.md')
  else if (agentsResult.updated)  console.log('  ✅ Synced AGENTS.md')
  else                            console.log('  ↩  AGENTS.md exists — auto blocks synced')

  // architecture.json
  const { generateArch } = await import(toFileUrl(join(HARNESS_DEST, 'generate-arch.mjs')))
  const archResult = generateArch(TARGET, model)
  if (archResult.created)  console.log(`  ✅ Generated architecture.json (${archResult.zones} zones, ${archResult.nodes} nodes)`)
  else if (archResult.updated) console.log('  ✅ Synced architecture.json')
  else                     console.log('  ↩  architecture.json exists — new entries merged')

  // tracked-files.json
  const { generateTracked } = await import(toFileUrl(join(HARNESS_DEST, 'generate-tracked.mjs')))
  const trackedResult = generateTracked(TARGET, model)
  if (trackedResult.created)       console.log(`  ✅ Generated tracked-files.json (${trackedResult.count} entries)`)
  else if (trackedResult.updated)  console.log('  ✅ Synced tracked-files.json')
  else                             console.log('  ↩  tracked-files.json up to date')

  return model
}

// ---------------------------------------------------------------------------
// Steps 7-11 — delegate to harness/install.mjs
// ---------------------------------------------------------------------------

function runInstall() {
  const installScript = join(HARNESS_DEST, 'install.mjs')
  if (!existsSync(installScript)) {
    console.warn('  ⚠  harness/install.mjs not found — skipping hooks/CLAUDE.md/gitignore/memory.')
    return
  }

  const installArgs = ['harness/install.mjs', ...(DRY ? ['--dry-run'] : [])]
  const result = spawnSync('node', installArgs, {
    cwd:    TARGET,
    stdio:  'inherit',
    shell:  false,
  })

  if (result.error) {
    console.error(`  ✗  install.mjs failed: ${result.error.message}`)
  }
}

// ---------------------------------------------------------------------------
// Step 12 — ONBOARDING.md (last, after AGENTS.md is ready)
// ---------------------------------------------------------------------------

async function runOnboarding(model) {
  if (!model) return

  const onboardingScript = join(HARNESS_DEST, 'generate-onboarding.mjs')
  if (!existsSync(onboardingScript)) return

  if (DRY) {
    console.log('  [dry-run] would generate docs/ONBOARDING.md')
    return
  }

  const { generateOnboarding } = await import(toFileUrl(onboardingScript))
  const result = generateOnboarding(TARGET, model)

  if (result.created) console.log('  ✅ Generated docs/ONBOARDING.md')
  else                console.log('  ↩  docs/ONBOARDING.md already exists — left unchanged')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`\ndev-harness init${DRY ? ' [dry-run]' : ''} → ${TARGET}\n`)

console.log('[ 1 ] Harness folder →')
copyHarness()

console.log('\n[ 2 ] Package scripts →')
addScripts()

console.log('\n[ 3-6 ] Project analysis + generation →')
const model = await runGeneration()

console.log('\n[ 7-11 ] Claude hooks + CLAUDE.md + .gitignore + memory →')
runInstall()

console.log('\n[ 12 ] Onboarding →')
await runOnboarding(model)

if (IS_NESTED) {
  console.log(`\n[ 13 ] Cleanup — remove tool folder →`)
  const toolDirName = _rel.split('/')[0]  // top-level folder name, e.g. 'dev-harness'

  // Ensure gitignore has the tool folder entry (in case it was already there before)
  const gitignorePath = join(TARGET, '.gitignore')
  const giContent = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : ''
  const entry = toolDirName + '/'
  if (!giContent.includes(entry)) {
    const sep = giContent.endsWith('\n') || giContent === '' ? '' : '\n'
    if (!DRY) writeFileSync(gitignorePath, giContent + sep + entry + '\n')
  }

  if (DRY) {
    console.log(`  [dry-run] would remove ${toolDirName}/ (harness/ is self-contained)`)
  } else {
    try {
      rmSync(HERE, { recursive: true, force: true })
      console.log(`  ✅ Removed ${toolDirName}/ — harness/ is self-contained, tool no longer needed`)
    } catch (e) {
      console.log(`  ⚠  Could not auto-remove ${toolDirName}/ (${e.message})`)
      console.log(`     Safe to delete manually — harness/ is fully self-contained.`)
    }
  }
}

console.log(`\n${'─'.repeat(50)}`)
console.log(`\n  All done.\n`)
console.log(`  Start the dashboard:\n`)
console.log(`    npm run harness:watch\n`)
console.log(`  Sync after changes:\n`)
console.log(`    npm run harness:sync\n`)
