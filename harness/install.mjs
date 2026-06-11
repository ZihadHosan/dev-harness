#!/usr/bin/env node
/**
 * install.mjs — wire the harness's Claude Code hooks into a project (zero deps).
 *
 * Merges the hook config from `harness/templates/settings.json` into the project's
 * `.claude/settings.json`:
 *   - file absent  → create `.claude/` and write the template
 *   - file present → merge per hook-event, appending only hook groups whose `command`
 *                    isn't already wired (dedupe by command). All other keys
 *                    (permissions, unrelated hooks, …) are preserved.
 *
 * Usage:
 *   node harness/install.mjs              # merge into .claude/settings.json
 *   node harness/install.mjs --dry-run    # show what would change, write nothing
 *   node harness/install.mjs --target <path>   # target a different settings.json (testing)
 *
 * Always exits 0 — advisory tooling must never block. On malformed existing JSON it
 * warns and leaves the file untouched.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeHooks } from './context-sync/lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '..')
const TEMPLATE = join(HERE, 'templates', 'settings.json')

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const tIdx = args.indexOf('--target')
const TARGET = tIdx !== -1 && args[tIdx + 1]
  ? resolve(args[tIdx + 1])
  : join(PROJECT_ROOT, '.claude', 'settings.json')

function main() {
  let template
  try {
    template = JSON.parse(readFileSync(TEMPLATE, 'utf8'))
  } catch (e) {
    console.error(`harness install: cannot read template (${e.message})`)
    return
  }
  const templateHooks = template.hooks || {}

  // Fresh install: no existing settings file.
  if (!existsSync(TARGET)) {
    if (DRY) {
      console.log(`[dry-run] would create ${TARGET} with hooks: ${Object.keys(templateHooks).join(', ')}`)
      return
    }
    mkdirSync(dirname(TARGET), { recursive: true })
    writeFileSync(TARGET, JSON.stringify(template, null, 2) + '\n')
    console.log(`✅ Created ${TARGET} with harness hooks (${Object.keys(templateHooks).join(', ')}).`)
    return
  }

  // Merge into an existing settings file.
  let existing
  try {
    existing = JSON.parse(readFileSync(TARGET, 'utf8'))
  } catch (e) {
    console.error(`⚠️  ${TARGET} is not valid JSON (${e.message}). Left unchanged — merge the hooks from harness/templates/settings.json by hand.`)
    return
  }

  const { added, present } = mergeHooks(existing, templateHooks)

  if (added.length === 0) {
    console.log(`✅ ${TARGET}: all harness hooks already present (${present.length} hook(s)). No changes.`)
    return
  }

  if (DRY) {
    console.log(`[dry-run] would add ${added.length} hook(s) to ${TARGET}:`)
    for (const c of added) console.log(`  + ${c}`)
    return
  }

  writeFileSync(TARGET, JSON.stringify(existing, null, 2) + '\n')
  console.log(`✅ Merged ${added.length} harness hook(s) into ${TARGET} (preserved existing keys):`)
  for (const c of added) console.log(`  + ${c}`)
}

try {
  main()
} catch (e) {
  console.error(`harness install error: ${e.message}`)
}
process.exit(0)
