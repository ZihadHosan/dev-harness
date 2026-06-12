#!/usr/bin/env node
/**
 * generate-arch.mjs — write and sync harness/architecture.json from the project model.
 *
 * generateArch(root, model)
 *   Creates architecture.json from scratch. Calls syncArch if file already exists.
 *
 * syncArch(root, model)
 *   Merges new zones and nodes into an existing architecture.json.
 *   Never removes or modifies existing entries — only adds new ones.
 *   Developer customisations (descriptions, assertions, todoMatch) are preserved.
 *
 * Statuses:
 *   EXISTING  → real zones/nodes derived from detected structure
 *   DEFINED   → suggested nodes based on framework convention (wip: true)
 *   EMPTY     → minimal skeleton, one placeholder node
 *
 * Zero npm dependencies — Node built-ins only.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Suggested node templates per framework (DEFINED state)
// ---------------------------------------------------------------------------

const FRAMEWORK_SUGGESTIONS = {
  'Nuxt': [
    { zone: 'frontend', id: 'pages',       label: 'Pages',       path: 'pages',        desc: 'Nuxt file-based routing. Each .vue file becomes a route.' },
    { zone: 'frontend', id: 'components',  label: 'Components',  path: 'components',   desc: 'Auto-imported Vue components.' },
    { zone: 'frontend', id: 'composables', label: 'Composables', path: 'composables',  desc: 'Reusable Composition API logic.' },
    { zone: 'backend',  id: 'server-api',  label: 'API routes',  path: 'server/api',   desc: 'Nitro server routes — auto-registered from the file tree.' },
    { zone: 'backend',  id: 'server-utils',label: 'Server utils',path: 'server/utils', desc: 'Shared server-side utilities.' },
  ],
  'Next.js': [
    { zone: 'frontend', id: 'app-router',  label: 'App Router',  path: 'app',          desc: 'Next.js 13+ app directory — layouts, pages, loading states.' },
    { zone: 'frontend', id: 'components',  label: 'Components',  path: 'components',   desc: 'Shared React components.' },
    { zone: 'backend',  id: 'api-routes',  label: 'API routes',  path: 'app/api',      desc: 'Route handlers — GET/POST/etc. per directory.' },
  ],
  'SvelteKit': [
    { zone: 'frontend', id: 'routes',      label: 'Routes',      path: 'src/routes',   desc: 'SvelteKit file-based routing.' },
    { zone: 'lib',      id: 'lib',         label: 'Library',     path: 'src/lib',      desc: 'Shared utilities imported as $lib.' },
  ],
  'Vue 3': [
    { zone: 'frontend', id: 'app-root',    label: 'App root',    path: 'src/App.vue',  desc: 'Root component — houses router-view and global layout.' },
    { zone: 'frontend', id: 'components',  label: 'Components',  path: 'src/components',desc: 'Shared Vue components.' },
    { zone: 'frontend', id: 'views',       label: 'Views',       path: 'src/views',    desc: 'Page-level components mapped to routes.' },
    { zone: 'frontend', id: 'composables', label: 'Composables', path: 'src/composables',desc: 'Reusable Composition API logic.' },
    { zone: 'backend',  id: 'router',      label: 'Router',      path: 'src/router',   desc: 'Vue Router config — route definitions and guards.' },
  ],
  'React': [
    { zone: 'frontend', id: 'app-root',    label: 'App root',    path: 'src/App.tsx',  desc: 'Root component — top-level layout and routing.' },
    { zone: 'frontend', id: 'components',  label: 'Components',  path: 'src/components',desc: 'Shared React components.' },
    { zone: 'frontend', id: 'hooks',       label: 'Hooks',       path: 'src/hooks',    desc: 'Custom React hooks.' },
  ],
  'Express': [
    { zone: 'backend',  id: 'app',         label: 'App setup',   path: 'src/app.ts',   desc: 'Express app — middleware, plugin registration.' },
    { zone: 'backend',  id: 'routes',      label: 'Routes',      path: 'src/routes',   desc: 'Express route handlers.' },
    { zone: 'lib',      id: 'middleware',  label: 'Middleware',  path: 'src/middleware',desc: 'Custom Express middleware.' },
  ],
  'Fastify': [
    { zone: 'backend',  id: 'app',         label: 'App setup',   path: 'src/app.ts',   desc: 'Fastify app — plugin registration, hooks.' },
    { zone: 'backend',  id: 'routes',      label: 'Routes',      path: 'src/routes',   desc: 'Fastify route plugins.' },
  ],
  'Hono': [
    { zone: 'backend',  id: 'app',         label: 'App',         path: 'src/index.ts', desc: 'Hono app entry — route definitions.' },
  ],
  'NestJS': [
    { zone: 'backend',  id: 'app-module',  label: 'App module',  path: 'src/app.module.ts', desc: 'Root NestJS module.' },
    { zone: 'backend',  id: 'modules',     label: 'Feature modules', path: 'src',       desc: 'Feature modules — each encapsulates controllers + services.' },
  ],
  'CLI': [
    { zone: 'lib',      id: 'entry',       label: 'CLI entry',   path: 'src/index.ts', desc: 'CLI entry point — command registration.' },
    { zone: 'lib',      id: 'commands',    label: 'Commands',    path: 'src/commands', desc: 'Individual command implementations.' },
  ],
  'none': [
    { zone: 'lib',      id: 'entry',       label: 'Entry point', path: 'src/index.ts', desc: 'Main entry point.' },
  ],
}

const DEFAULT_ZONES = [
  { id: 'frontend', label: 'Frontend', sub: 'src/' },
  { id: 'backend',  label: 'Backend',  sub: 'server/' },
  { id: 'lib',      label: 'Shared',   sub: 'lib/' },
  { id: 'data',     label: 'Data',     sub: 'db/' },
]

// ---------------------------------------------------------------------------
// Build from model
// ---------------------------------------------------------------------------

function zonesFromModel(model) {
  if (model.zones && model.zones.length) {
    return model.zones.map((z) => ({
      id:    z.id,
      label: z.label,
      sub:   z.path + '/',
    }))
  }
  return DEFAULT_ZONES
}

function nodesForExisting(model) {
  const nodes = []
  const seenIds = new Set()

  // Key files → nodes
  for (const kf of model.keyFiles || []) {
    const id = kf.path
      .replace(/[\\/]/g, '-')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9-]/gi, '-')
      .toLowerCase()
      .slice(0, 40)

    if (seenIds.has(id)) continue
    seenIds.add(id)

    // Determine which zone this file belongs to
    const zone = (model.zones || []).find((z) => kf.path.startsWith(z.path + '/') || kf.path === z.path)
    const zoneId = zone?.id || 'lib'

    nodes.push({
      id,
      zone:       zoneId,
      label:      kf.role,
      path:       kf.path,
      desc:       `${kf.role} — ${kf.path}`,
      assertions: [],
      todoMatch:  '',
    })
  }

  return nodes
}

function nodesForDefined(model) {
  const framework = model.framework || 'none'
  const suggestions = FRAMEWORK_SUGGESTIONS[framework] || FRAMEWORK_SUGGESTIONS['none']
  return suggestions.map((s) => ({
    id:         s.id,
    zone:       s.zone,
    label:      s.label,
    path:       s.path,
    desc:       s.desc,
    wip:        true,
    assertions: [],
    todoMatch:  '',
  }))
}

function buildFreshArch(model) {
  const name  = model.name || 'my-project'
  const zones = zonesFromModel(model)
  let nodes

  if (model.state === 'EXISTING') {
    nodes = nodesForExisting(model)
    if (!nodes.length) nodes = [makePlaceholder()]
  } else if (model.state === 'DEFINED') {
    nodes = nodesForDefined(model)
  } else {
    nodes = [makePlaceholder()]
  }

  return { name, zones, nodes }
}

function makePlaceholder() {
  return {
    id:         'app-entry',
    zone:       'frontend',
    label:      'App entry',
    path:       'src/index.js',
    desc:       'Replace with your real entry file.',
    wip:        true,
    assertions: [],
    todoMatch:  '',
  }
}

// ---------------------------------------------------------------------------
// Merge — only add, never remove or overwrite
// ---------------------------------------------------------------------------

function mergeArch(existing, model) {
  const fresh   = buildFreshArch(model)
  let changed   = false

  // Merge zones
  const existingZoneIds = new Set((existing.zones || []).map((z) => z.id))
  const addedZones = fresh.zones.filter((z) => !existingZoneIds.has(z.id))
  if (addedZones.length) {
    existing.zones = [...(existing.zones || []), ...addedZones]
    changed = true
  }

  // Merge nodes
  const existingNodeIds = new Set((existing.nodes || []).map((n) => n.id))
  const addedNodes = fresh.nodes.filter((n) => !existingNodeIds.has(n.id))
  if (addedNodes.length) {
    existing.nodes = [...(existing.nodes || []), ...addedNodes]
    changed = true
  }

  // Always sync project name from the detected model
  if (!existing.name || existing.name !== model.name) {
    existing.name = model.name
    changed = true
  }

  return { arch: existing, changed }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * generateArch(root, model)
 * Creates harness/architecture.json from scratch.
 * Falls through to syncArch if the file already exists.
 */
export function generateArch(root, model) {
  const harnessDir = join(root, 'harness')
  const dest       = join(harnessDir, 'architecture.json')

  if (existsSync(dest)) {
    return syncArch(root, model)
  }

  const arch = buildFreshArch(model)
  writeFileSync(dest, JSON.stringify(arch, null, 2) + '\n')
  return { created: true, nodes: arch.nodes.length, zones: arch.zones.length }
}

/**
 * syncArch(root, model)
 * Merges new zones/nodes into existing architecture.json. Non-destructive.
 */
export function syncArch(root, model) {
  const dest = join(root, 'harness', 'architecture.json')

  if (!existsSync(dest)) {
    return generateArch(root, model)
  }

  let existing
  try {
    existing = JSON.parse(readFileSync(dest, 'utf8'))
  } catch {
    // Corrupted file — regenerate
    const arch = buildFreshArch(model)
    writeFileSync(dest, JSON.stringify(arch, null, 2) + '\n')
    return { created: true }
  }

  const { arch, changed } = mergeArch(existing, model)
  if (!changed) return { updated: false }

  writeFileSync(dest, JSON.stringify(arch, null, 2) + '\n')
  return { updated: true }
}

// ---------------------------------------------------------------------------
// CLI: node harness/generate-arch.mjs
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const { projectModel } = await import('./analyze.mjs')
  const root   = resolve(HERE, '..')
  const model  = projectModel(root)
  const result = generateArch(root, model)

  if (result.created)       console.log(`  ✅ Created harness/architecture.json (${result.zones} zones, ${result.nodes} nodes)`)
  else if (result.updated)  console.log(`  ✅ Synced harness/architecture.json (new entries added)`)
  else                      console.log(`  ↩  harness/architecture.json up to date`)
}
