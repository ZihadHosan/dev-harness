#!/usr/bin/env node
/**
 * lockstep.mjs — check that all members of a lockstep group were edited together.
 *
 * A lockstep group is a set of files that must always be modified in the same
 * commit (e.g. duplicated logic kept in sync across two packages). This script
 * checks whether any recent change touched some files in a group but not all.
 *
 * Configuration: harness/context-sync/guard-config.json → lockstepGroups array.
 *
 * Usage:
 *   node harness/context-sync/lockstep.mjs            # check HEAD commit
 *   node harness/context-sync/lockstep.mjs --staged   # check only staged files
 *   node harness/context-sync/lockstep.mjs --strict   # exit 1 on violations (CI)
 *
 * Zero npm dependencies — Node built-ins only.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { checkLockstep } from './lib.mjs'

const HERE         = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '../..')
const CONFIG_FILE  = join(HERE, 'guard-config.json')

const args   = process.argv.slice(2)
const STRICT = args.includes('--strict')
const STAGED = args.includes('--staged')

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return {}
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) }
  catch { return {} }
}

function getChangedFiles() {
  if (STAGED) {
    try {
      const out = execSync('git diff --cached --name-only', { cwd: PROJECT_ROOT, encoding: 'utf8' })
      return out.trim().split('\n').filter(Boolean)
    } catch { return [] }
  }

  // HEAD commit vs its parent
  try {
    const out = execSync('git diff --name-only HEAD~1 HEAD', { cwd: PROJECT_ROOT, encoding: 'utf8' })
    return out.trim().split('\n').filter(Boolean)
  } catch {
    // Single-commit repo or detached HEAD — fall back to uncommitted changes
    try {
      const out = execSync('git status --porcelain', { cwd: PROJECT_ROOT, encoding: 'utf8' })
      return out.trim().split('\n').filter(Boolean).map((l) => l.slice(3).trim())
    } catch { return [] }
  }
}

const config  = loadConfig()
const groups  = config.lockstepGroups || []

console.log('\n🔗 Lockstep check\n')

if (!groups.length) {
  console.log('   No lockstep groups configured in harness/context-sync/guard-config.json')
  console.log('   Add lockstepGroups entries to start enforcing paired edits.\n')
  process.exit(0)
}

const changedFiles = getChangedFiles()
const violations   = checkLockstep(groups, changedFiles)

console.log(`   Groups: ${groups.length} · Changed files: ${changedFiles.length}`)

if (!violations.length) {
  console.log('\n✅ All lockstep groups are in sync.\n')
  process.exit(0)
}

console.log(`\n⚠️  ${violations.length} lockstep violation(s):\n`)
for (const v of violations) {
  console.log(`   ❌ ${v.id}${v.note ? ` — ${v.note}` : ''}`)
  console.log(`      Changed: ${v.changed.join(', ')}`)
  console.log(`      Missing: ${v.missing.join(', ')}`)
}
console.log('')

process.exit(STRICT ? 1 : 0)
