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

// ---------------------------------------------------------------------------
// Shared stack detection (mirrors install.mjs — kept here to avoid import
// chain issues when init.mjs runs before harness/ exists in the target)
// ---------------------------------------------------------------------------

function readPkg(root) {
  const p = join(root, 'package.json')
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

function detectStack(root) {
  const pkg = readPkg(root)
  if (!pkg) return null
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }
  const has = (n) => n in deps

  let framework = 'none'
  if (has('nuxt') || has('@nuxt/core')) framework = 'Nuxt'
  else if (has('next')) framework = 'Next.js'
  else if (has('@sveltejs/kit')) framework = 'SvelteKit'
  else if (has('astro')) framework = 'Astro'
  else if (has('remix') || has('@remix-run/node')) framework = 'Remix'
  else if (has('vue')) framework = 'Vue 3'
  else if (has('react')) framework = 'React'
  else if (has('svelte')) framework = 'Svelte'
  else if (has('@nestjs/core')) framework = 'NestJS'
  else if (has('fastify')) framework = 'Fastify'
  else if (has('express')) framework = 'Express'
  else if (has('hono')) framework = 'Hono'

  let test = 'none'
  if (has('vitest')) test = 'Vitest'
  else if (has('jest') || has('@jest/core')) test = 'Jest'
  else if (has('mocha')) test = 'Mocha'
  else if (has('@playwright/test')) test = 'Playwright'

  const lang = has('typescript') ? 'TypeScript' : 'JavaScript'

  return {
    name: pkg.name || 'my-project',
    lang,
    framework,
    test,
    version: pkg.version || '0.1.0',
  }
}

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
// Step 3 — patch architecture.json with real project name
// ---------------------------------------------------------------------------

function patchArchName() {
  const archPath = join(HARNESS_DEST, 'architecture.json')
  const stack = detectStack(TARGET)
  const name = stack?.name || 'my-project'

  // Create from template if missing (harness/ existed before architecture.json was added)
  if (!existsSync(archPath)) {
    const tmpl = join(HARNESS_SRC, 'architecture.json')
    if (!existsSync(tmpl)) {
      console.log('  ⚠  architecture.json template not found — skipping.')
      return
    }
    if (DRY) {
      console.log(`  [dry-run] would create harness/architecture.json with name "${name}"`)
      return
    }
    let arch
    try { arch = JSON.parse(readFileSync(tmpl, 'utf8')) } catch { return }
    arch.name = name
    writeFileSync(archPath, JSON.stringify(arch, null, 2) + '\n')
    console.log(`  ✅ Created harness/architecture.json (name: "${name}")`)
    return
  }

  let arch
  try { arch = JSON.parse(readFileSync(archPath, 'utf8')) } catch { return }

  if (arch.name && arch.name !== 'My Project') {
    console.log(`  ↩  architecture.json name already set ("${arch.name}").`)
    return
  }

  if (DRY) {
    console.log(`  [dry-run] would set architecture.json name → "${name}"`)
    return
  }

  arch.name = name
  writeFileSync(archPath, JSON.stringify(arch, null, 2) + '\n')
  console.log(`  ✅ Set architecture.json name → "${name}"`)
}

// ---------------------------------------------------------------------------
// Step 4 — generate docs/ONBOARDING.md from detected stack
// ---------------------------------------------------------------------------

function generateOnboarding() {
  const dest = join(TARGET, 'docs', 'ONBOARDING.md')
  if (existsSync(dest)) {
    console.log('  ↩  docs/ONBOARDING.md already exists — left unchanged.')
    return
  }

  const stack = detectStack(TARGET)
  const pkg = readPkg(TARGET)
  const name = stack?.name || 'my-project'
  const displayName = name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  const runCmd = pkg?.scripts?.dev
    ? 'npm run dev'
    : pkg?.scripts?.start
      ? 'npm start'
      : 'npm run dev'

  const buildCmd = pkg?.scripts?.build ? 'npm run build' : null
  const testSection = stack?.test && stack.test !== 'none'
    ? `## Running tests\n\n\`\`\`bash\nnpm test\n\`\`\`\n\n`
    : ''
  const buildSection = buildCmd
    ? `## Building for production\n\n\`\`\`bash\n${buildCmd}\n\`\`\`\n\n`
    : ''

  const content = `# ${displayName} — Onboarding

## What is this?

${displayName} is a ${stack?.framework && stack.framework !== 'none' ? stack.framework + ' ' : ''}${stack?.lang || 'JavaScript'} project.
Update this section to describe what the project does and who it's for.

## Prerequisites

- Node 18+
- Git

## Getting started

\`\`\`bash
git clone <repo-url>
cd ${name}
npm install
${runCmd}
\`\`\`

${testSection}${buildSection}## Project structure

\`\`\`
# Fill this in — top-level folders and what they contain
\`\`\`

## Key files

| File | Purpose |
| --- | --- |
| \`package.json\` | Dependencies and scripts |
| \`harness/architecture.json\` | Component graph for the dashboard |

## Common tasks

- **Add a feature:** describe the pattern here
- **Fix a bug:** describe the pattern here
- **Deploy:** describe the process here
`

  if (DRY) {
    console.log(`  [dry-run] would create docs/ONBOARDING.md for "${displayName}"`)
    return
  }

  mkdirSync(join(TARGET, 'docs'), { recursive: true })
  writeFileSync(dest, content)
  console.log(`  ✅ Generated docs/ONBOARDING.md`)
}

// ---------------------------------------------------------------------------
// Step 5-8 — delegate to install.mjs in the target project
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

console.log('Project name →')
patchArchName()

console.log('Onboarding →')
generateOnboarding()

runInstall()

console.log(`\nAll done. Open the dashboard:\n\n  npm run arch:watch\n`)
