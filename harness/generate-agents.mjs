#!/usr/bin/env node
/**
 * generate-agents.mjs — write and sync AGENTS.md from the project model.
 *
 * AGENTS.md has two types of sections:
 *   <!-- auto:name --> ... <!-- /auto:name -->   overwritten on every sync
 *   Anything outside those markers              preserved — never touched
 *
 * generateAgents(root, model)
 *   Creates AGENTS.md from scratch (first install). If the file already
 *   exists, falls through to syncAgents() instead.
 *
 * syncAgents(root, model)
 *   Updates the auto blocks in an existing AGENTS.md. Manual sections
 *   (developer notes, architecture decisions) are never modified.
 *
 * Zero npm dependencies — Node built-ins only.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Block builders — each returns the inner content of an auto block
// ---------------------------------------------------------------------------

function buildHeaderBlock(model) {
  const { state, name, lang, framework, scannedAt } = model
  const stack = [lang, framework !== 'none' ? framework : null].filter(Boolean).join(' · ')
  const date = (scannedAt || new Date().toISOString()).slice(0, 10)
  return [
    `# Project: ${name}`,
    '',
    `> **State:** ${state} | **Stack:** ${stack} | **Scanned:** ${date}`,
    '',
    `This file is the single source of truth for what this project is, how it's built, and what's next.`,
    `The \`<!-- auto:* -->\` sections are managed by \`npm run harness:sync\` — edit the unmarked sections below.`,
  ].join('\n')
}

function buildStackBlock(model) {
  const { lang, framework, runtime, pattern, test, db, branch } = model
  const rows = [
    ['Language',  lang],
    ['Framework', framework],
    ['Runtime',   runtime],
    ['Pattern',   pattern],
    ['Test',      test],
    ['DB',        db],
    ['Branch',    branch],
  ]
  return [
    '## Stack',
    '',
    '| | |',
    '|---|---|',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
  ].join('\n')
}

function buildStructureBlock(model) {
  const lines = ['## Project Structure', '']

  if (model.zones && model.zones.length) {
    lines.push('### Zones', '', '| Zone | Path | Source files |', '|------|------|-------------|')
    for (const z of model.zones) {
      lines.push(`| ${z.label} | \`${z.path}/\` | ${z.fileCount ?? '—'} |`)
    }
    lines.push('')
  }

  if (model.keyFiles && model.keyFiles.length) {
    lines.push('### Key Files', '', '| File | Role |', '|------|------|')
    for (const f of model.keyFiles) {
      lines.push(`| \`${f.path}\` | ${f.role} |`)
    }
  }

  return lines.join('\n')
}

function buildHealthBlock(model) {
  const lines = ['## Health', '']

  const blocking = model.health?.blocking ?? []
  const debt = model.health?.debt ?? []
  const git = model.gitStatus ?? []

  if (model.state === 'EMPTY') {
    lines.push('> Project is empty — no health signals yet.')
    return lines.join('\n')
  }

  if (model.state === 'DEFINED') {
    lines.push('> Stack defined, no source code yet — health signals will appear once you start building.')
    return lines.join('\n')
  }

  // Blocking
  const todoItems = blocking.filter((b) => b.type === 'todo')
  if (todoItems.length) {
    lines.push(`### Blocking — ${todoItems.length} issue${todoItems.length !== 1 ? 's' : ''}`, '')
    for (const b of todoItems.slice(0, 20)) {
      lines.push(`- \`${b.file}:${b.line}\` — **${b.keyword}**: ${b.text || '(no description)'}`)
    }
    if (todoItems.length > 20) lines.push(`- …and ${todoItems.length - 20} more`)
  } else {
    lines.push('### Blocking', '', '> No TODO/FIXME found. ✓')
  }
  lines.push('')

  // Tech debt
  const largeFiles = debt.filter((d) => d.type === 'large-file')
  const consoleLogs = debt.filter((d) => d.type === 'console-log')

  if (debt.length) {
    lines.push(`### Tech Debt — ${debt.length} issue${debt.length !== 1 ? 's' : ''}`, '')
    for (const d of largeFiles.slice(0, 10)) {
      lines.push(`- \`${d.file}\` — ${d.lines} lines (large file)`)
    }
    // Group console.logs by file (avoid one line per log)
    const consoleByFile = {}
    for (const d of consoleLogs) consoleByFile[d.file] = (consoleByFile[d.file] || 0) + 1
    for (const [file, count] of Object.entries(consoleByFile).slice(0, 10)) {
      lines.push(`- \`${file}\` — ${count} console.log call${count !== 1 ? 's' : ''}`)
    }
    if (debt.length > 20) lines.push(`- …and more`)
  } else {
    lines.push('### Tech Debt', '', '> No tech debt signals found. ✓')
  }
  lines.push('')

  // In progress
  if (git.length) {
    lines.push(`### In Progress (git) — ${git.length} file${git.length !== 1 ? 's' : ''}`, '')
    for (const g of git.slice(0, 15)) {
      const label = g.status === '??' ? 'new' : g.status === 'M' || g.status === 'MM' ? 'modified' : g.status
      lines.push(`- \`${g.file}\` — ${label}`)
    }
    if (git.length > 15) lines.push(`- …and ${git.length - 15} more`)
  } else {
    lines.push('### In Progress (git)', '', '> Working tree clean.')
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Auto-block helpers
// ---------------------------------------------------------------------------

const AUTO_OPEN  = (name) => `<!-- auto:${name} -->`
const AUTO_CLOSE = (name) => `<!-- /auto:${name} -->`

function wrapBlock(name, content) {
  return `${AUTO_OPEN(name)}\n${content}\n${AUTO_CLOSE(name)}`
}

function buildAllAutoBlocks(model) {
  return {
    header:    buildHeaderBlock(model),
    stack:     buildStackBlock(model),
    structure: buildStructureBlock(model),
    health:    buildHealthBlock(model),
  }
}

// ---------------------------------------------------------------------------
// Fresh file — generated on first install
// ---------------------------------------------------------------------------

function buildFreshAgents(model) {
  const blocks = buildAllAutoBlocks(model)

  return [
    wrapBlock('header', blocks.header),
    '',
    wrapBlock('stack', blocks.stack),
    '',
    wrapBlock('structure', blocks.structure),
    '',
    wrapBlock('health', blocks.health),
    '',
    '---',
    '',
    '## Developer Notes',
    '',
    '> Add your team\'s context here — this section is never overwritten by sync.',
    '> Describe non-obvious constraints, past incidents, naming conventions, etc.',
    '',
    '## Architecture Decisions',
    '',
    '> Document key architectural choices here — this section is never overwritten.',
    '> Why this framework? Why this DB? What did you decide NOT to do and why?',
    '',
    '## What\'s Next',
    '',
    '> Describe your current priorities here. This section is yours to maintain.',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Sync — replace auto blocks only, preserve everything else
// ---------------------------------------------------------------------------

function syncContent(existing, model) {
  const blocks = buildAllAutoBlocks(model)
  let content = existing

  for (const [name, innerContent] of Object.entries(blocks)) {
    const open  = AUTO_OPEN(name)
    const close = AUTO_CLOSE(name)
    const re    = new RegExp(`${escapeRe(open)}[\\s\\S]*?${escapeRe(close)}`, 'g')
    const replacement = wrapBlock(name, innerContent)

    if (re.test(content)) {
      // Reset lastIndex before using replace
      const re2 = new RegExp(`${escapeRe(open)}[\\s\\S]*?${escapeRe(close)}`, 'g')
      content = content.replace(re2, replacement)
    } else {
      // Block doesn't exist yet — append before the first ## heading that isn't auto-generated
      // or at the very beginning if nothing found
      content = replacement + '\n\n' + content
    }
  }

  return content
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * generateAgents(root, model)
 * Creates AGENTS.md. If it already exists, delegates to syncAgents.
 */
export function generateAgents(root, model) {
  const dest = join(root, 'AGENTS.md')

  if (existsSync(dest)) {
    return syncAgents(root, model)
  }

  writeFileSync(dest, buildFreshAgents(model))
  return { created: true }
}

/**
 * syncAgents(root, model)
 * Updates auto blocks in an existing AGENTS.md. Manual sections untouched.
 * Safe to call repeatedly — idempotent.
 */
export function syncAgents(root, model) {
  const dest = join(root, 'AGENTS.md')

  if (!existsSync(dest)) {
    return generateAgents(root, model)
  }

  const existing = readFileSync(dest, 'utf8')
  const updated  = syncContent(existing, model)

  if (updated === existing) return { updated: false }

  writeFileSync(dest, updated)
  return { updated: true }
}

// ---------------------------------------------------------------------------
// CLI: node harness/generate-agents.mjs
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const { projectModel } = await import('./analyze.mjs')
  const root  = resolve(HERE, '..')
  const model = projectModel(root)
  const result = generateAgents(root, model)
  const dest  = join(root, 'AGENTS.md')
  if (result.created)       console.log(`  ✅ Created AGENTS.md`)
  else if (result.updated)  console.log(`  ✅ Synced AGENTS.md (auto blocks updated)`)
  else                      console.log(`  ↩  AGENTS.md up to date`)
}
