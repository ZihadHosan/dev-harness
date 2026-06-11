#!/usr/bin/env node
/**
 * install.mjs — zero-config harness setup for any project (zero npm deps).
 *
 * Runs fully automatically — no prompts, no placeholders.
 *
 * What it does (all idempotent):
 *   1. Merges harness hooks into .claude/settings.json
 *   2. Writes CLAUDE.md with auto-detected Project Constraints (skips if file exists)
 *   3. Patches .gitignore with harness-generated file entries
 *   4. Creates the Claude memory folder for this project (~/.claude/projects/<slug>/memory/)
 *
 * Usage:
 *   node harness/install.mjs              # full install
 *   node harness/install.mjs --dry-run    # show what would change, write nothing
 *   node harness/install.mjs --target <path>   # target a different settings.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { mergeHooks } from './context-sync/lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '..')
const TEMPLATE_DIR = join(HERE, 'templates')

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const tIdx = args.indexOf('--target')
const TARGET = tIdx !== -1 && args[tIdx + 1]
  ? resolve(args[tIdx + 1])
  : join(PROJECT_ROOT, '.claude', 'settings.json')

// ---------------------------------------------------------------------------
// Stack detection from package.json
// ---------------------------------------------------------------------------

function detectStack(pkgPath) {
  if (!existsSync(pkgPath)) return null
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return null
  }

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
    ...pkg.optionalDependencies,
  }
  const has = (name) => name in allDeps

  // Language
  const lang = has('typescript') ? 'TypeScript' : 'JavaScript'

  // Framework — most specific first
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

  // Test runner
  let test = 'none'
  if (has('vitest')) test = 'Vitest'
  else if (has('jest') || has('@jest/core')) test = 'Jest'
  else if (has('mocha')) test = 'Mocha'
  else if (has('@playwright/test')) test = 'Playwright'
  else if (has('cypress')) test = 'Cypress'
  else if (has('ava')) test = 'Ava'
  else if (has('tap') || has('@tap/core')) test = 'Tap'

  // Database
  let db = 'none'
  if (has('@supabase/supabase-js') || has('@supabase/ssr')) db = 'Supabase'
  else if (has('@prisma/client')) db = 'Prisma'
  else if (has('drizzle-orm')) db = 'Drizzle'
  else if (has('mongoose')) db = 'MongoDB'
  else if (has('@planetscale/database')) db = 'PlanetScale'
  else if (has('@neondatabase/serverless') || has('@neon-tech/serverless-driver')) db = 'Neon'
  else if (has('pg') || has('postgres')) db = 'PostgreSQL'
  else if (has('mysql2') || has('mysql')) db = 'MySQL'
  else if (has('better-sqlite3') || has('sqlite3')) db = 'SQLite'

  // Runtime
  const hasBundler = has('vite') || has('webpack') || has('parcel') || has('rollup') || has('esbuild')
  const isSSR = ['Nuxt', 'Next.js', 'SvelteKit', 'Remix', 'Astro', 'NestJS', 'Express', 'Fastify', 'Hono', 'Koa'].includes(framework)
  let runtime = 'Node'
  if (hasBundler && isSSR) runtime = 'Node · browser'
  else if (hasBundler && !isSSR) runtime = 'browser'

  // Pattern
  let pattern = 'ESM'
  if (framework === 'Vue 3' || framework === 'Nuxt') pattern = 'Composition API · ESM'
  else if (['React', 'Next.js', 'Remix', 'Gatsby'].includes(framework)) pattern = 'hooks · functional · ESM'
  else if (['Svelte', 'SvelteKit'].includes(framework)) pattern = 'reactive stores · ESM'
  else if (['Express', 'Fastify', 'Hono', 'Koa', 'NestJS'].includes(framework)) pattern = 'ESM · Node'

  // Current git branch
  let branch = 'main'
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim() || 'main'
  } catch { /* no git — keep default */ }

  return { lang, framework, runtime, pattern, db, test, branch, name: pkg.name || '' }
}

function buildConstraintsBlock(stack) {
  const lines = [
    `lang:       ${stack.lang}`,
    `framework:  ${stack.framework}`,
    `runtime:    ${stack.runtime}`,
    `pattern:    ${stack.pattern}`,
    `db:         ${stack.db}`,
    `test:       ${stack.test}`,
    `notes:`,
    `  - Never commit/push unless explicitly asked`,
    `  - Working branch: ${stack.branch}`,
  ]
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// CLAUDE.md — write from template (skip if already exists)
// ---------------------------------------------------------------------------

function installClaudeMd(dry) {
  const dest = join(PROJECT_ROOT, 'CLAUDE.md')
  const tmpl = join(TEMPLATE_DIR, 'CLAUDE.md')

  if (existsSync(dest)) {
    console.log(`  ↩  CLAUDE.md already exists — left unchanged.`)
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

  if (dry) {
    console.log(`  [dry-run] would create CLAUDE.md`)
    if (stack) console.log(`    detected: ${stack.lang} · ${stack.framework} · ${stack.test}`)
    return
  }

  writeFileSync(dest, content)
  if (stack) {
    console.log(`  ✅ Created CLAUDE.md`)
    console.log(`     lang: ${stack.lang}  framework: ${stack.framework}  test: ${stack.test}  db: ${stack.db}`)
  } else {
    console.log(`  ✅ Created CLAUDE.md (no package.json detected — constraints left as defaults)`)
  }
}

// ---------------------------------------------------------------------------
// .gitignore — add harness-generated entries
// ---------------------------------------------------------------------------

const GITIGNORE_ENTRIES = [
  '# dev-harness — generated output',
  'harness/arch-map.html',
]

function patchGitignore(dry) {
  const dest = join(PROJECT_ROOT, '.gitignore')
  const existing = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
  const toAdd = GITIGNORE_ENTRIES.filter((line) => line.startsWith('#') || !existing.includes(line))

  if (toAdd.filter((l) => !l.startsWith('#')).length === 0) {
    console.log(`  ↩  .gitignore already has harness entries.`)
    return
  }

  if (dry) {
    console.log(`  [dry-run] would add to .gitignore: ${toAdd.filter((l) => !l.startsWith('#')).join(', ')}`)
    return
  }

  const separator = existing.endsWith('\n') || existing === '' ? '' : '\n'
  writeFileSync(dest, existing + separator + toAdd.join('\n') + '\n')
  console.log(`  ✅ Patched .gitignore (+${toAdd.filter((l) => !l.startsWith('#')).length} entries)`)
}

// ---------------------------------------------------------------------------
// Memory folder — ~/.claude/projects/<slug>/memory/
// ---------------------------------------------------------------------------

function projectSlug(root) {
  return root
    .split(/[\\/:]/)
    .filter(Boolean)
    .join('--')
}

function ensureMemory(dry) {
  const slug = projectSlug(PROJECT_ROOT)
  const memDir = join(homedir(), '.claude', 'projects', slug, 'memory')
  const memIndex = join(memDir, 'MEMORY.md')

  if (existsSync(memIndex)) {
    console.log(`  ↩  Memory folder already exists (${slug}).`)
    return
  }

  if (dry) {
    console.log(`  [dry-run] would create ~/.claude/projects/${slug}/memory/MEMORY.md`)
    return
  }

  mkdirSync(memDir, { recursive: true })
  writeFileSync(memIndex, '# Memory Index\n')
  console.log(`  ✅ Created memory folder (~/.claude/projects/${slug}/memory/)`)
}

// ---------------------------------------------------------------------------
// Hooks — existing logic, unchanged
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
    console.log(`  ✅ Created ${TARGET} with hooks: ${Object.keys(templateHooks).join(', ')}`)
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

  if (added.length === 0) {
    console.log(`  ↩  Hooks already present (${present.length} wired). No changes.`)
    return
  }

  if (DRY) {
    console.log(`  [dry-run] would add ${added.length} hook(s):`)
    for (const c of added) console.log(`    + ${c}`)
    return
  }

  writeFileSync(TARGET, JSON.stringify(existing, null, 2) + '\n')
  console.log(`  ✅ Wired ${added.length} hook(s) into ${TARGET}:`)
  for (const c of added) console.log(`    + ${c}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log(`\ndev-harness install${DRY ? ' [dry-run]' : ''}\n`)

  console.log('Hooks →')
  installHooks()

  console.log('CLAUDE.md →')
  installClaudeMd(DRY)

  console.log('.gitignore →')
  patchGitignore(DRY)

  console.log('Memory →')
  ensureMemory(DRY)

  console.log('\nDone. Run `npm run arch:watch` to open the dashboard.\n')
}

try {
  main()
} catch (e) {
  console.error(`harness install error: ${e.message}`)
}
process.exit(0)
