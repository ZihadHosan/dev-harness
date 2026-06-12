#!/usr/bin/env node
/**
 * generate-tracked.mjs — write and sync harness/context-sync/tracked-files.json.
 *
 * Derives the list of files the AI agent must read before answering status
 * questions from the project model (key files + standard harness files).
 *
 * generateTracked(root, model) — creates file from scratch (or syncs if exists)
 * syncTracked(root, model)     — merges new entries, keeps existing ones
 *
 * Zero npm dependencies — Node built-ins only.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// Files always tracked regardless of project type
const HARNESS_ALWAYS = [
  { path: 'AGENTS.md',                              reason: 'Project brain — single source of truth for what this project is and what\'s next' },
  { path: 'TODO.md',                                reason: 'Structured open items — current priorities'  },
  { path: 'package.json',                           reason: 'Version, dependencies, scripts'              },
  { path: 'CHANGELOG.md',                           reason: 'What shipped — tells you what changed'       },
  { path: 'harness/notes.json',                     reason: 'Planning board — open todos, ideas, remarks' },
]

// Role → reason mapping for auto-detected key files
const ROLE_REASONS = {
  'Config':                'Project configuration — affects build, runtime, and tooling',
  'App root':              'Root component — entry to the application tree',
  'Entry':                 'Application entry point',
  'Dependencies & scripts':'Dependencies and npm scripts',
  'TypeScript config':     'TypeScript compiler settings — affects type checking',
  'Env template':          'Expected environment variables — required for dev setup',
  'Documentation':         'Project README — high-level orientation',
  'AI onboarding':         'AI agent onboarding — read before answering questions',
  'Pages':                 'Page/route definitions',
  'API routes':            'API route definitions',
  'Composables':           'Shared composition logic',
  'Components':            'UI component library',
  'Router':                'Routing configuration and guards',
}

function reasonForKey(keyFile) {
  return ROLE_REASONS[keyFile.role] || `${keyFile.role} — key project file`
}

function buildTrackedList(model) {
  const out = [...HARNESS_ALWAYS]
  const seen = new Set(out.map((f) => f.path))

  for (const kf of model.keyFiles || []) {
    if (seen.has(kf.path)) continue
    // Only track individual files, not directories
    if (!kf.path.includes('.') && !kf.path.match(/\.\w+$/)) continue
    seen.add(kf.path)
    out.push({ path: kf.path, reason: reasonForKey(kf) })
  }

  return out
}

function buildSchema(model) {
  return {
    description: 'Files the AI agent MUST read before answering any question about project status, priorities, or what needs to be fixed. Read ALL of them. No exceptions.',
    files: buildTrackedList(model),
    notes: 'Add new entries here when new critical files are added to the project. Keep this list minimal — only files that affect status/priority answers.',
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateTracked(root, model) {
  const dest = join(root, 'harness', 'context-sync', 'tracked-files.json')

  if (existsSync(dest)) {
    return syncTracked(root, model)
  }

  const schema = buildSchema(model)
  writeFileSync(dest, JSON.stringify(schema, null, 2) + '\n')
  return { created: true, count: schema.files.length }
}

export function syncTracked(root, model) {
  const dest = join(root, 'harness', 'context-sync', 'tracked-files.json')

  if (!existsSync(dest)) {
    return generateTracked(root, model)
  }

  let existing
  try {
    existing = JSON.parse(readFileSync(dest, 'utf8'))
  } catch {
    const schema = buildSchema(model)
    writeFileSync(dest, JSON.stringify(schema, null, 2) + '\n')
    return { created: true }
  }

  const existingPaths = new Set((existing.files || []).map((f) => f.path))
  const newEntries = buildTrackedList(model).filter((f) => !existingPaths.has(f.path))

  if (!newEntries.length) return { updated: false }

  existing.files = [...(existing.files || []), ...newEntries]
  writeFileSync(dest, JSON.stringify(existing, null, 2) + '\n')
  return { updated: true, added: newEntries.length }
}

// ---------------------------------------------------------------------------
// CLI: node harness/generate-tracked.mjs
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const { projectModel } = await import('./analyze.mjs')
  const root   = resolve(HERE, '..')
  const model  = projectModel(root)
  const result = generateTracked(root, model)

  if (result.created)      console.log(`  ✅ Created tracked-files.json (${result.count} entries)`)
  else if (result.updated) console.log(`  ✅ Synced tracked-files.json (+${result.added} entries)`)
  else                     console.log(`  ↩  tracked-files.json up to date`)
}
