#!/usr/bin/env node
/**
 * uninstall.mjs — remove all dev-harness files and config from a project.
 *
 * Safe to run multiple times (idempotent).
 * Use before a fresh install for a clean slate:
 *
 *   npm run harness:uninstall
 *   git clone https://github.com/ZihadHosan/dev-harness
 *   node dev-harness/init.mjs
 *
 * Flags:
 *   --dry-run   preview what would be removed without touching anything
 *
 * Zero npm dependencies — Node built-ins only.
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const args = process.argv.slice(2)
const DRY  = args.includes('--dry-run')

// ---------------------------------------------------------------------------
// Files and dirs to remove
// ---------------------------------------------------------------------------

const REMOVE_PATHS = [
  'harness',            // runtime scripts (this file's own dir — removed last)
  'AGENTS.md',
  'CLAUDE.md',
  'docs/ONBOARDING.md',
  '.claude/settings.json',
]

// ---------------------------------------------------------------------------
// .gitignore — lines added by dev-harness (all historical formats)
// ---------------------------------------------------------------------------

const GITIGNORE_LINES = new Set([
  '# dev-harness — generated (each dev runs init.mjs locally)',
  '# dev-harness — generated output',
  '# dev-harness — generated',
  'harness/',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/ONBOARDING.md',
  '.claude/settings.json',
  'harness/arch-map.html',
  'harness/notes.json',
  'dev-harness/',
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) { console.log(`  ${msg}`) }

function removeItem(rel) {
  const full = join(ROOT, rel)
  if (!existsSync(full)) return
  if (!DRY) rmSync(full, { recursive: true, force: true })
  log(`${DRY ? '[dry-run] would remove' : '✅ Removed'} ${rel}`)
}

// ---------------------------------------------------------------------------
// Remove harness:* scripts from package.json
// ---------------------------------------------------------------------------

function removeScripts() {
  const pkgPath = join(ROOT, 'package.json')
  if (!existsSync(pkgPath)) { log('↩  package.json not found — skipped.'); return }

  let pkg
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) }
  catch { log('⚠  package.json is not valid JSON — scripts not removed.'); return }

  if (!pkg.scripts) { log('↩  No scripts in package.json.'); return }

  const removed = Object.keys(pkg.scripts).filter((k) => k.startsWith('harness:'))
  if (!removed.length) { log('↩  No harness:* scripts found.'); return }

  if (!DRY) {
    for (const k of removed) delete pkg.scripts[k]
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }
  log(`${DRY ? '[dry-run] would remove' : '✅ Removed'} scripts: ${removed.join(', ')}`)
}

// ---------------------------------------------------------------------------
// Clean .gitignore
// ---------------------------------------------------------------------------

function cleanGitignore() {
  const dest = join(ROOT, '.gitignore')
  if (!existsSync(dest)) { log('↩  .gitignore not found — skipped.'); return }

  const original = readFileSync(dest, 'utf8')
  const filtered = original.split('\n').filter((line) => !GITIGNORE_LINES.has(line.trim()))
  const removedCount = original.split('\n').length - filtered.length

  if (!removedCount) { log('↩  No harness entries in .gitignore.'); return }

  const result = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
  if (!DRY) writeFileSync(dest, result)
  log(`${DRY ? '[dry-run] would clean' : '✅ Cleaned'} .gitignore (${removedCount} lines removed)`)
}

// ---------------------------------------------------------------------------
// Remove git post-commit hook (or just our lines if hook was pre-existing)
// ---------------------------------------------------------------------------

function removeGitHook() {
  let gitDir = null
  let check  = ROOT
  for (let i = 0; i < 5; i++) {
    const candidate = join(check, '.git')
    if (existsSync(candidate)) { gitDir = candidate; break }
    const parent = resolve(check, '..')
    if (parent === check) break
    check = parent
  }

  if (!gitDir) { log('↩  No .git directory found — hook skipped.'); return }

  const hookFile = join(gitDir, 'hooks', 'post-commit')
  if (!existsSync(hookFile)) { log('↩  No post-commit hook found.'); return }

  const content = readFileSync(hookFile, 'utf8')
  if (!content.includes('harness:sync')) { log('↩  Post-commit hook has no harness entry.'); return }

  // Remove only the lines we added
  const HOOK_MARKERS = new Set([
    '# dev-harness',
    '# dev-harness — sync project analysis after every commit',
    'npm run harness:sync --quiet 2>/dev/null || true',
  ])
  const filtered = content.split('\n').filter((l) => !HOOK_MARKERS.has(l.trim()))
  const remaining = filtered.join('\n').trim().replace(/^#!\/bin\/sh\s*$/, '').trim()

  if (!remaining) {
    // Nothing left — delete the whole hook file
    if (!DRY) rmSync(hookFile, { force: true })
    log(`${DRY ? '[dry-run] would remove' : '✅ Removed'} .git/hooks/post-commit`)
  } else {
    // Pre-existing hook — remove only our lines
    if (!DRY) writeFileSync(hookFile, filtered.join('\n').trimEnd() + '\n')
    log(`${DRY ? '[dry-run] would clean' : '✅ Cleaned'} .git/hooks/post-commit`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`\ndev-harness uninstall${DRY ? ' [dry-run]' : ''} → ${ROOT}\n`)

console.log('Scripts →')
removeScripts()

console.log('\n.gitignore →')
cleanGitignore()

console.log('\nGit hook →')
removeGitHook()

console.log('\nFiles →')
for (const p of REMOVE_PATHS) removeItem(p)

console.log(`\n${DRY ? '[dry-run] Done — nothing was changed.' : 'Done. Run `git clone https://github.com/ZihadHosan/dev-harness && node dev-harness/init.mjs` for a fresh install.'}\n`)
