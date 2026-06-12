#!/usr/bin/env node
/**
 * install.mjs — wire Claude Code hooks, CLAUDE.md, .gitignore, memory folder,
 *               and git post-commit hook into the target project.
 *
 * Run from the target project root (after harness/ is copied):
 *   node harness/install.mjs
 *   node harness/install.mjs --dry-run
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { mergeHooks } from './context-sync/lib.mjs'

const HERE        = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '..')
const TEMPLATE_DIR = join(HERE, 'templates')

const args  = process.argv.slice(2)
const DRY   = args.includes('--dry-run')
const tIdx  = args.indexOf('--target')
const TARGET = tIdx !== -1 && args[tIdx + 1]
  ? resolve(args[tIdx + 1])
  : join(PROJECT_ROOT, '.claude', 'settings.json')

// ---------------------------------------------------------------------------
// Stack detection (needed for CLAUDE.md generation)
// ---------------------------------------------------------------------------

function detectStack(pkgPath) {
  if (!existsSync(pkgPath)) return null
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch { return null }

  const allDeps = {
    ...pkg.dependencies, ...pkg.devDependencies,
    ...pkg.peerDependencies, ...pkg.optionalDependencies,
  }
  const has = (n) => n in allDeps

  const lang = has('typescript') ? 'TypeScript' : 'JavaScript'

  let framework = 'none'
  if (has('nuxt') || has('@nuxt/core')) framework = 'Nuxt'
  else if (has('next')) framework = 'Next.js'
  else if (has('@sveltejs/kit')) framework = 'SvelteKit'
  else if (has('gatsby')) framework = 'Gatsby'
  else if (has('astro')) framework = 'Astro'
  else if (has('remix') || has('@remix-run/node')) framework = 'Remix'
  else if (has('vue')) framework = 'Vue 3'
  else if (has('react')) framework = 'React'
  else if (has('svelte')) framework = 'Svelte'
  else if (has('@nestjs/core')) framework = 'NestJS'
  else if (has('fastify')) framework = 'Fastify'
  else if (has('express')) framework = 'Express'
  else if (has('hono')) framework = 'Hono'
  else if (has('koa')) framework = 'Koa'
  else if (pkg.bin) framework = 'CLI'

  let test = 'none'
  if (has('vitest')) test = 'Vitest'
  else if (has('jest') || has('@jest/core')) test = 'Jest'
  else if (has('mocha')) test = 'Mocha'
  else if (has('@playwright/test')) test = 'Playwright'
  else if (has('cypress')) test = 'Cypress'
  else if (has('ava')) test = 'Ava'

  let db = 'none'
  if (has('@supabase/supabase-js') || has('@supabase/ssr')) db = 'Supabase'
  else if (has('@prisma/client')) db = 'Prisma'
  else if (has('drizzle-orm')) db = 'Drizzle'
  else if (has('mongoose')) db = 'MongoDB'
  else if (has('@planetscale/database')) db = 'PlanetScale'
  else if (has('pg') || has('postgres')) db = 'PostgreSQL'
  else if (has('mysql2') || has('mysql')) db = 'MySQL'
  else if (has('better-sqlite3') || has('sqlite3')) db = 'SQLite'

  const hasBundler = has('vite') || has('webpack') || has('parcel') || has('rollup') || has('esbuild')
  const isSSR = ['Nuxt', 'Next.js', 'SvelteKit', 'Remix', 'Astro', 'NestJS', 'Express', 'Fastify', 'Hono', 'Koa'].includes(framework)
  let runtime = 'Node'
  if (hasBundler && isSSR) runtime = 'Node · browser'
  else if (hasBundler) runtime = 'browser'

  let pattern = 'ESM'
  if (framework === 'Vue 3' || framework === 'Nuxt') pattern = 'Composition API · ESM'
  else if (['React', 'Next.js', 'Remix', 'Gatsby'].includes(framework)) pattern = 'hooks · functional · ESM'
  else if (['Svelte', 'SvelteKit'].includes(framework)) pattern = 'reactive stores · ESM'
  else if (['Express', 'Fastify', 'Hono', 'Koa', 'NestJS'].includes(framework)) pattern = 'ESM · Node'

  let branch = 'main'
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim() || 'main'
  } catch { /* not a git repo */ }

  return { lang, framework, runtime, pattern, db, test, branch, name: pkg.name || '' }
}

function buildConstraintsBlock(stack) {
  return [
    `lang:       ${stack.lang}`,
    `framework:  ${stack.framework}`,
    `runtime:    ${stack.runtime}`,
    `pattern:    ${stack.pattern}`,
    `db:         ${stack.db}`,
    `test:       ${stack.test}`,
    `notes:`,
    `  - Never commit/push unless explicitly asked`,
    `  - Working branch: ${stack.branch}`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// CLAUDE.md
// ---------------------------------------------------------------------------

function installClaudeMd() {
  const dest = join(PROJECT_ROOT, 'CLAUDE.md')
  const tmpl = join(TEMPLATE_DIR, 'CLAUDE.md')

  if (existsSync(dest)) {
    console.log('  ↩  CLAUDE.md already exists — left unchanged.')
    return
  }

  if (!existsSync(tmpl)) {
    console.warn(`  ⚠  Template not found: ${tmpl} — skipping CLAUDE.md.`)
    return
  }

  const stack = detectStack(join(PROJECT_ROOT, 'package.json'))
  const constraints = stack
    ? buildConstraintsBlock(stack)
    : `lang:       unknown\nframework:  unknown\nruntime:    Node\npattern:    ESM\ndb:         none\ntest:       none\nnotes:\n  - Never commit/push unless explicitly asked`

  const content = readFileSync(tmpl, 'utf8').replace('{{PROJECT_CONSTRAINTS}}', constraints)

  if (DRY) {
    console.log('  [dry-run] would create CLAUDE.md')
    if (stack) console.log(`    detected: ${stack.lang} · ${stack.framework} · ${stack.test}`)
    return
  }

  writeFileSync(dest, content)
  console.log(`  ✅ Created CLAUDE.md${stack ? ` (${stack.lang} · ${stack.framework})` : ''}`)
}

// ---------------------------------------------------------------------------
// .gitignore
// ---------------------------------------------------------------------------

const GITIGNORE_ENTRIES = [
  '# dev-harness — generated (each dev runs init.mjs locally)',
  'harness/',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/ONBOARDING.md',
  '.claude/settings.json',
]

function patchGitignore() {
  const dest     = join(PROJECT_ROOT, '.gitignore')
  const existing = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
  const toAdd    = GITIGNORE_ENTRIES.filter(
    (line) => line.startsWith('#') || !existing.includes(line)
  )
  const realEntries = toAdd.filter((l) => !l.startsWith('#'))

  if (!realEntries.length) {
    console.log('  ↩  .gitignore already has harness entries.')
    return
  }

  if (DRY) {
    console.log(`  [dry-run] would add to .gitignore: ${realEntries.join(', ')}`)
    return
  }

  const sep = existing.endsWith('\n') || existing === '' ? '' : '\n'
  writeFileSync(dest, existing + sep + toAdd.join('\n') + '\n')
  console.log(`  ✅ Patched .gitignore (+${realEntries.length} entries)`)
}

// ---------------------------------------------------------------------------
// Claude memory folder
// ---------------------------------------------------------------------------

function projectSlug(root) {
  return root.split(/[\\/:]/).filter(Boolean).join('--')
}

function ensureMemory() {
  const slug    = projectSlug(PROJECT_ROOT)
  const memDir  = join(homedir(), '.claude', 'projects', slug, 'memory')
  const memFile = join(memDir, 'MEMORY.md')

  if (existsSync(memFile)) {
    console.log(`  ↩  Memory folder already exists.`)
    return
  }

  if (DRY) {
    console.log(`  [dry-run] would create ~/.claude/projects/${slug}/memory/MEMORY.md`)
    return
  }

  mkdirSync(memDir, { recursive: true })
  writeFileSync(memFile, '# Memory Index\n')
  console.log(`  ✅ Created memory folder (~/.claude/projects/${slug}/memory/)`)
}

// ---------------------------------------------------------------------------
// Claude Code hooks
// ---------------------------------------------------------------------------

function installHooks() {
  const TEMPLATE = join(HERE, 'templates', 'settings.json')
  let template
  try {
    template = JSON.parse(readFileSync(TEMPLATE, 'utf8'))
  } catch (e) {
    console.error(`  ✗  Cannot read hooks template (${e.message})`)
    return
  }
  const templateHooks = template.hooks || {}

  if (!existsSync(TARGET)) {
    if (DRY) {
      console.log(`  [dry-run] would create ${TARGET} with hooks: ${Object.keys(templateHooks).join(', ')}`)
      return
    }
    mkdirSync(dirname(TARGET), { recursive: true })
    writeFileSync(TARGET, JSON.stringify(template, null, 2) + '\n')
    console.log(`  ✅ Created ${TARGET} with hooks`)
    return
  }

  let existing
  try {
    existing = JSON.parse(readFileSync(TARGET, 'utf8'))
  } catch (e) {
    console.error(`  ⚠  ${TARGET} is not valid JSON (${e.message}). Left unchanged.`)
    return
  }

  const { added, present } = mergeHooks(existing, templateHooks)

  if (!added.length) {
    console.log(`  ↩  Claude hooks already wired (${present.length} hooks).`)
    return
  }

  if (DRY) {
    console.log(`  [dry-run] would add ${added.length} hook(s)`)
    return
  }

  writeFileSync(TARGET, JSON.stringify(existing, null, 2) + '\n')
  console.log(`  ✅ Wired ${added.length} hook(s) into .claude/settings.json`)
}

// ---------------------------------------------------------------------------
// Git post-commit hook → npm run harness:sync --quiet
// ---------------------------------------------------------------------------

function installGitHook() {
  // Find .git directory — walk up from project root
  let gitDir = null
  let check  = PROJECT_ROOT
  for (let i = 0; i < 5; i++) {
    const candidate = join(check, '.git')
    if (existsSync(candidate)) { gitDir = candidate; break }
    const parent = join(check, '..')
    if (parent === check) break
    check = parent
  }

  if (!gitDir) {
    console.log('  ↩  No .git directory found — post-commit hook skipped.')
    return
  }

  const hooksDir  = join(gitDir, 'hooks')
  const hookFile  = join(hooksDir, 'post-commit')
  const hookLine  = 'npm run harness:sync --quiet 2>/dev/null || true'
  const hookBang  = '#!/bin/sh'

  if (existsSync(hookFile)) {
    const content = readFileSync(hookFile, 'utf8')
    if (content.includes('harness:sync')) {
      console.log('  ↩  Git post-commit hook already installed.')
      return
    }
    if (DRY) {
      console.log('  [dry-run] would append harness:sync to existing post-commit hook')
      return
    }
    // Append to existing hook
    const sep = content.endsWith('\n') ? '' : '\n'
    writeFileSync(hookFile, content + sep + '\n# dev-harness\n' + hookLine + '\n')
    console.log('  ✅ Appended harness:sync to existing post-commit hook')
    return
  }

  if (DRY) {
    console.log('  [dry-run] would create .git/hooks/post-commit → harness:sync')
    return
  }

  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(hookFile, `${hookBang}\n\n# dev-harness — sync project analysis after every commit\n${hookLine}\n`)

  try {
    chmodSync(hookFile, 0o755)
  } catch { /* Windows — chmod not critical */ }

  console.log('  ✅ Installed git post-commit hook → harness:sync')
}

// ---------------------------------------------------------------------------
// Guard config (lockstep + high-risk) — create once, never overwrite
// ---------------------------------------------------------------------------

function seedGuardConfig() {
  const dest = join(HERE, 'context-sync', 'guard-config.json')
  if (existsSync(dest)) { console.log('  ↩  guard-config.json already exists — preserved.'); return }

  const template = {
    lockstepGroups: [
      // { "id": "my-pair", "files": ["src/foo.ts", "apps/bar/src/foo.ts"], "note": "Keep these two copies in sync" }
    ],
    highRisk: [
      // { "match": "server/utils/usage\\.ts", "note": "Money path: reserve→spend→refund order is sacred." }
    ],
  }

  if (DRY) { console.log('  [dry-run] would create guard-config.json'); return }
  writeFileSync(dest, JSON.stringify(template, null, 2) + '\n')
  console.log('  ✅ Created guard-config.json — add lockstepGroups and highRisk entries to configure.')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log(`\ndev-harness install${DRY ? ' [dry-run]' : ''}\n`)

  console.log('Claude hooks →')
  installHooks()

  console.log('CLAUDE.md →')
  installClaudeMd()

  console.log('.gitignore →')
  patchGitignore()

  console.log('Memory →')
  ensureMemory()

  console.log('Git hook →')
  installGitHook()

  console.log('Guard config →')
  seedGuardConfig()

  console.log('\nDone.\n')
}

let _exitCode = 0
try {
  main()
} catch (e) {
  console.error(`harness install error: ${e.message}`)
  _exitCode = 1
}
process.exit(_exitCode)
