#!/usr/bin/env node
/**
 * reinstall.mjs — clean reinstall of the harness from the latest dev-harness source.
 *
 * Checks git is available, uninstalls, clones the latest dev-harness, and re-runs init.
 *
 * Usage:
 *   npm run harness:reinstall
 *   node harness/reinstall.mjs [--dry-run]
 *
 * Zero npm dependencies — Node built-ins only.
 */

import { existsSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const args  = process.argv.slice(2)
const DRY   = args.includes('--dry-run')

function log(msg) { console.log(`  ${msg}`) }

// 1. Check git is available
try {
  execSync('git --version', { stdio: 'ignore' })
} catch {
  console.error('\n  ✗  git is not available on PATH.')
  console.error('     Install git (https://git-scm.com) or perform a manual reinstall:')
  console.error('     1. Delete the harness/ folder')
  console.error('     2. Download dev-harness and run: node dev-harness/init.mjs\n')
  process.exit(1)
}

// 2. Remove any leftover dev-harness clone from a previous interrupted reinstall
const cloneDir = resolve(ROOT, 'dev-harness')
if (existsSync(cloneDir)) {
  log('Removing leftover dev-harness/ clone…')
  if (!DRY) rmSync(cloneDir, { recursive: true, force: true })
}

// 3. Uninstall current harness
log('Uninstalling current harness…')
const uninstallResult = spawnSync('node', ['harness/uninstall.mjs', ...(DRY ? ['--dry-run'] : [])], {
  cwd: ROOT, stdio: 'inherit', shell: false,
})
if (uninstallResult.status !== 0) {
  console.error('  ✗  Uninstall failed — aborting reinstall.')
  process.exit(1)
}

// 4. Clone latest dev-harness
log('Cloning latest dev-harness…')
if (!DRY) {
  const cloneResult = spawnSync('git', ['clone', 'https://github.com/ZihadHosan/dev-harness'], {
    cwd: ROOT, stdio: 'inherit', shell: false,
  })
  if (cloneResult.status !== 0) {
    console.error('  ✗  git clone failed. Check your network connection and try again.')
    process.exit(1)
  }
}

// 5. Run init
log('Running init…')
if (!DRY) {
  const initResult = spawnSync('node', ['dev-harness/init.mjs'], {
    cwd: ROOT, stdio: 'inherit', shell: false,
  })
  process.exit(initResult.status ?? 0)
} else {
  log('[dry-run] would run: node dev-harness/init.mjs')
  log('[dry-run] dev-harness/ would be auto-removed by init (IS_NESTED cleanup)')
}
