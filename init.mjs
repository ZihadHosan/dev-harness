#!/usr/bin/env node
/**
 * init.mjs — install dev-harness into any project from the cloned repo or via npx.
 *
 * Run from the TARGET project root, pointing at this file:
 *
 *   node path/to/dev-harness/init.mjs        # install into cwd
 *   node path/to/dev-harness/init.mjs --dry-run
 *
 * Or via npx (once published):
 *   npx dev-harness
 *
 * What it does (all idempotent):
 *   1. Copies harness/ folder into the target project
 *   2. Adds harness scripts to the project's package.json
 *   3. Wires Claude Code hooks into .claude/settings.json
 *   4. Writes CLAUDE.md with auto-detected Project Constraints
 *   5. Patches .gitignore
 *   6. Creates the Claude memory folder
 */

import { cpSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))   // dev-harness root
const TARGET = process.cwd()                            // user's project root

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')

// Guard: don't install dev-harness into itself
if (resolve(TARGET) === resolve(HERE)) {
  console.error('\n⚠  Run this from your PROJECT root, not from inside dev-harness.\n')
  console.error(`   cd /path/to/your-project`)
  console.error(`   node ${relative(TARGET, join(HERE, 'init.mjs'))}\n`)
  process.exit(1)
}

const HARNESS_SRC = join(HERE, 'harness')
const HARNESS_DEST = join(TARGET, 'harness')

// ---------------------------------------------------------------------------
// Step 1 — copy harness/ folder
// ---------------------------------------------------------------------------

function copyHarness() {
  if (existsSync(HARNESS_DEST)) {
    console.log('  ↩  harness/ already exists — skipping copy.')
    return false
  }
  if (DRY) {
    console.log(`  [dry-run] would copy harness/ → ${relative(process.cwd(), HARNESS_DEST)}/`)
    return false
  }
  cpSync(HARNESS_SRC, HARNESS_DEST, { recursive: true })
  console.log('  ✅ Copied harness/')
  return true
}

// ---------------------------------------------------------------------------
// Step 2 — add scripts to package.json
// ---------------------------------------------------------------------------

const SCRIPTS = {
  'arch':              'node harness/arch-map.mjs',
  'arch:watch':        'node harness/arch-serve.mjs',
  'harness:install':   'node harness/install.mjs',
  'harness:check':     'node harness/context-sync/hash-check.mjs',
  'harness:baseline':  'node harness/context-sync/hash-check.mjs --update',
  'harness:verify':    'node harness/context-sync/verify.mjs',
  'harness:lockstep':  'node harness/context-sync/lockstep.mjs',
  'harness:doctor':    'node harness/doctor.mjs',
}

function addScripts() {
  const pkgPath = join(TARGET, 'package.json')

  // Create a minimal package.json if none exists
  if (!existsSync(pkgPath)) {
    if (DRY) {
      console.log(`  [dry-run] would create package.json with harness scripts`)
      return
    }
    const minimal = { name: 'my-project', version: '0.1.0', type: 'module', scripts: SCRIPTS }
    writeFileSync(pkgPath, JSON.stringify(minimal, null, 2) + '\n')
    console.log('  ✅ Created package.json with harness scripts')
    return
  }

  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (e) {
    console.error(`  ⚠  package.json is not valid JSON (${e.message}) — scripts not added.`)
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

  if (added.length === 0) {
    console.log('  ↩  All harness scripts already in package.json.')
    return
  }

  if (DRY) {
    console.log(`  [dry-run] would add scripts: ${added.join(', ')}`)
    return
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`  ✅ Added scripts to package.json: ${added.join(', ')}`)
}

// ---------------------------------------------------------------------------
// Step 3-6 — delegate to install.mjs in the target project
// ---------------------------------------------------------------------------

function runInstall() {
  const installScript = join(HARNESS_DEST, 'install.mjs')
  if (!existsSync(installScript)) {
    console.warn('  ⚠  harness/install.mjs not found — skipping hooks/CLAUDE.md/gitignore/memory.')
    return
  }

  const installArgs = ['harness/install.mjs', ...(DRY ? ['--dry-run'] : [])]
  const result = spawnSync('node', installArgs, {
    cwd: TARGET,
    stdio: 'inherit',
    shell: false,
  })

  if (result.error) {
    console.error(`  ✗  install.mjs failed: ${result.error.message}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`\ndev-harness init${DRY ? ' [dry-run]' : ''} → ${TARGET}\n`)

console.log('Harness folder →')
copyHarness()

console.log('Scripts →')
addScripts()

runInstall()

console.log(`\nAll done. Open the dashboard:\n\n  npm run arch:watch\n`)
