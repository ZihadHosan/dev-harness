#!/usr/bin/env node
/**
 * generate-onboarding.mjs — write docs/ONBOARDING.md from the project model.
 *
 * Runs LAST in the pipeline — after AGENTS.md and architecture.json are ready.
 * If AGENTS.md exists, the onboarding intro links back to it as the source of truth.
 *
 * generateOnboarding(root, model)
 *   Creates docs/ONBOARDING.md. Skips if the file already exists
 *   (onboarding is meant to be personalised by the team; we only write once).
 *
 * forceOnboarding(root, model)
 *   Always writes, even if the file exists. Used by --force / re-init flows.
 *
 * Zero npm dependencies — Node built-ins only.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Content builders
// ---------------------------------------------------------------------------

function displayName(name) {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function buildOnboarding(model) {
  const name = displayName(model.name || 'my-project')
  const raw  = model.name || 'my-project'
  const { lang, framework, test, db } = model

  const stackDesc = [
    framework && framework !== 'none' ? framework : null,
    lang,
  ].filter(Boolean).join(' / ')

  const pkg = model.keyFiles?.find((f) => f.path === 'package.json')
  const runCmd = detectRunCmd(model)
  const buildCmd = detectBuildCmd(model)

  const lines = [
    `# ${name} — Onboarding`,
    '',
    '## What is this?',
    '',
    `${name} is a **${stackDesc}** project.`,
    `Update this description to explain what the project does and who it's for.`,
    '',
    `> For the full architecture breakdown and current priorities, see [\`AGENTS.md\`](../AGENTS.md).`,
    '',
    '## Prerequisites',
    '',
  ]

  // Prerequisites based on detected language
  if (model.langSignals?.includes('node') || !model.langSignals?.length) {
    lines.push('- Node 18+', '- npm 9+ (or pnpm / yarn)')
  }
  if (model.langSignals?.includes('rust'))   lines.push('- Rust stable (rustup)')
  if (model.langSignals?.includes('go'))     lines.push('- Go 1.21+')
  if (model.langSignals?.includes('python')) lines.push('- Python 3.11+')
  if (model.langSignals?.includes('php'))    lines.push('- PHP 8.2+', '- Composer')
  if (model.langSignals?.includes('ruby'))   lines.push('- Ruby 3.2+', '- Bundler')
  if (model.langSignals?.includes('java'))   lines.push('- JDK 21+', '- Maven or Gradle')
  if (model.langSignals?.includes('dotnet')) lines.push('- .NET 8 SDK')

  lines.push('- Git', '')

  // Getting started
  lines.push('## Getting started', '', '```bash')
  lines.push('git clone <repo-url>')
  lines.push(`cd ${raw}`)

  if (model.langSignals?.includes('node') || !model.langSignals?.length) {
    lines.push('npm install')
    lines.push(runCmd)
  } else if (model.langSignals?.includes('rust')) {
    lines.push('cargo build')
    lines.push('cargo run')
  } else if (model.langSignals?.includes('go')) {
    lines.push('go mod download')
    lines.push('go run .')
  } else if (model.langSignals?.includes('python')) {
    lines.push('pip install -r requirements.txt')
    lines.push('python main.py')
  } else if (model.langSignals?.includes('php')) {
    lines.push('composer install')
    lines.push('php -S localhost:8000')
  } else if (model.langSignals?.includes('ruby')) {
    lines.push('bundle install')
    lines.push('rails server')
  }
  lines.push('```', '')

  // Testing
  if (test && test !== 'none') {
    lines.push('## Running tests', '', '```bash', 'npm test', '```', '')
  }

  // Building
  if (buildCmd) {
    lines.push('## Building for production', '', '```bash', buildCmd, '```', '')
  }

  // Architecture map
  lines.push(
    '## Architecture map',
    '',
    'Run the live dashboard to see component health, open todos, and planning notes:',
    '',
    '```bash',
    'npm run arch:watch',
    '```',
    '',
    'Opens at `http://localhost:4319`. Stays live as you work — no manual refresh needed.',
    '',
  )

  // Project structure
  lines.push('## Project structure', '')
  if (model.zones?.length) {
    for (const z of model.zones) {
      lines.push(`- **\`${z.path}/\`** — ${z.label} (${z.fileCount ?? '?'} source files)`)
    }
  } else {
    lines.push('```')
    lines.push('# Fill in — top-level folders and what they contain')
    lines.push('```')
  }
  lines.push('')

  // Key files
  if (model.keyFiles?.length) {
    lines.push('## Key files', '')
    lines.push('| File | Purpose |', '|------|---------|')
    for (const f of model.keyFiles.slice(0, 8)) {
      lines.push(`| \`${f.path}\` | ${f.role} |`)
    }
    lines.push('')
  }

  // Common tasks placeholder
  const taskRows = [
    '## Common tasks',
    '',
    '| Task | Command |',
    '|------|---------|',
    '| Start dev server | `' + runCmd + '` |',
    test && test !== 'none' ? '| Run tests | `npm test` |' : null,
    buildCmd ? '| Build for production | `' + buildCmd + '` |' : null,
    '| Open architecture map | `npm run arch:watch` |',
    '| Sync project analysis | `npm run harness:sync` |',
    '',
  ].filter(Boolean)
  lines.push(...taskRows)

  // Environment
  const hasEnvExample = model.keyFiles?.find((f) => f.path === '.env.example')
  if (hasEnvExample) {
    lines.push(
      '## Environment',
      '',
      'Copy the example env file and fill in your values:',
      '',
      '```bash',
      'cp .env.example .env',
      '```',
      '',
    )
  }

  // Health signals summary
  const blocking = model.health?.blocking?.length ?? 0
  const debt = model.health?.debt?.length ?? 0
  if (blocking || debt) {
    lines.push(
      '## Current health',
      '',
      `> At time of generation: **${blocking} blocking** issue${blocking !== 1 ? 's' : ''}, **${debt} tech debt** signal${debt !== 1 ? 's' : ''}.`,
      `> Run \`npm run arch:watch\` for live status.`,
      '',
    )
  }

  return lines.filter((l) => l !== null).join('\n')
}

function detectRunCmd(model) {
  const framework = model.framework
  if (framework === 'Nuxt') return 'npm run dev'
  if (framework === 'Next.js') return 'npm run dev'
  if (framework === 'SvelteKit') return 'npm run dev'
  if (framework === 'Vue 3' || framework === 'React' || framework === 'Astro') return 'npm run dev'
  if (['Express', 'Fastify', 'Hono', 'Koa', 'NestJS'].includes(framework)) return 'npm run dev'
  return 'npm run dev'
}

function detectBuildCmd(model) {
  const framework = model.framework
  if (framework === 'none' || !framework) return null
  if (model.langSignals?.includes('node') || !model.langSignals?.length) return 'npm run build'
  return null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateOnboarding(root, model) {
  const dest = join(root, 'docs', 'ONBOARDING.md')

  if (existsSync(dest)) {
    return { skipped: true, reason: 'already exists' }
  }

  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(dest, buildOnboarding(model))
  return { created: true }
}

export function forceOnboarding(root, model) {
  const dest = join(root, 'docs', 'ONBOARDING.md')
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(dest, buildOnboarding(model))
  return { created: true }
}

// ---------------------------------------------------------------------------
// CLI: node harness/generate-onboarding.mjs [--force]
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const { projectModel } = await import('./analyze.mjs')
  const root   = resolve(HERE, '..')
  const model  = projectModel(root)
  const force  = process.argv.includes('--force')
  const result = force ? forceOnboarding(root, model) : generateOnboarding(root, model)

  if (result.created) console.log(`  ✅ Generated docs/ONBOARDING.md`)
  else                console.log(`  ↩  docs/ONBOARDING.md already exists — skipped (use --force to overwrite)`)
}
