#!/usr/bin/env node
/**
 * analyze.mjs — project state detection and deep scan engine.
 *
 * PHASE 1: detect(root) → state: EMPTY | DEFINED | EXISTING
 *   EMPTY    — no meaningful files, just initialised a folder
 *   DEFINED  — has config files (package.json, Cargo.toml…) but no real source yet
 *   EXISTING — has real source code (> 3 source files)
 *
 * PHASE 2: scan(root, info) → full project model
 *   zones       — top-level source directories
 *   keyFiles    — entry points, configs
 *   health      — { blocking[], debt[] }
 *   gitStatus   — unstaged/staged changes (in-progress signal)
 *
 * export projectModel(root) — runs both phases and returns the combined model.
 *
 * Zero npm dependencies — Node built-ins only.
 */

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join, extname, relative, basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.nuxt', '.next', '.svelte-kit',
  '.output', '.cache', '__pycache__', 'vendor', 'target', '.idea', '.vscode',
  'coverage', '.nyc_output', 'tmp', 'temp', '.turbo', '.vercel', '.netlify',
  'public', 'static', 'assets', '.expo', '.angular', 'harness', 'dev-harness',
])

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.vue', '.svelte', '.astro',
  '.py', '.rs', '.go', '.php', '.rb', '.cs', '.java', '.kt', '.swift',
  '.c', '.cpp', '.h', '.hpp',
])

const TODO_PATTERN = /\/\/\s*(TODO|FIXME|HACK|BUG|XXX)[: !]?\s*(.*)/i
const CONSOLE_LOG_PATTERN = /\bconsole\.(log|debug|info)\s*\(/

const LARGE_FILE_LINES = 300

// ---------------------------------------------------------------------------
// Full-scan constants
// ---------------------------------------------------------------------------

const SKIP_EXTENSIONS_FULL = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif', '.bmp', '.tiff',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.mp3', '.wav', '.ogg', '.webm', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
  '.map', '.log', '.lock',
  '.bin', '.exe', '.dll', '.so', '.dylib', '.a', '.o',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.sqlite', '.db',
])

const SKIP_FILES_FULL = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  '.DS_Store', 'Thumbs.db', 'desktop.ini',
])

const PEEK_NAME_PATTERNS = [
  /^(main|index|app)\.(ts|js|mjs|tsx|jsx)$/i,
  /^App\.(vue|tsx|jsx|svelte)$/,
  /^use[A-Z].+\.(ts|js)$/,
  /\.store\.(ts|js)$/,
  /\.service\.(ts|js)$/,
  /\.slice\.(ts|js|tsx)$/,
  /^(router|routes?)\.(ts|js)$/,
]

const PEEK_PATH_PATTERNS = [
  /\/router\//,
  /\/stores?\//,
  /\/composables\//,
  /\/hooks\//,
  /\/server\/api\//,
  /\/server\/utils?\//,
  /\/services?\//,
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tryRead(p) {
  try { return readdirSync(p) } catch { return [] }
}

function tryStat(p) {
  try { return statSync(p) } catch { return null }
}

function tryParse(p) {
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

function countSourceFiles(dir, maxDepth, depth = 0) {
  if (depth > maxDepth) return 0
  let n = 0
  for (const f of tryRead(dir)) {
    if (SKIP_DIRS.has(f) || f.startsWith('.')) continue
    const full = join(dir, f)
    const st = tryStat(full)
    if (!st) continue
    if (st.isDirectory()) n += countSourceFiles(full, maxDepth, depth + 1)
    else if (st.isFile() && CODE_EXTENSIONS.has(extname(f).toLowerCase())) n++
    if (n > 5) return n // early exit — we only need "more than a few"
  }
  return n
}

// ---------------------------------------------------------------------------
// Language detection (beyond package.json)
// ---------------------------------------------------------------------------

function detectLanguageSignals(root) {
  const s = []
  if (existsSync(join(root, 'package.json'))) s.push('node')
  if (existsSync(join(root, 'tsconfig.json'))) s.push('typescript')
  if (existsSync(join(root, 'Cargo.toml'))) s.push('rust')
  if (existsSync(join(root, 'go.mod'))) s.push('go')
  if (
    existsSync(join(root, 'requirements.txt')) ||
    existsSync(join(root, 'pyproject.toml')) ||
    existsSync(join(root, 'setup.py'))
  ) s.push('python')
  if (existsSync(join(root, 'composer.json'))) s.push('php')
  if (existsSync(join(root, 'Gemfile'))) s.push('ruby')
  if (
    existsSync(join(root, 'pom.xml')) ||
    existsSync(join(root, 'build.gradle')) ||
    existsSync(join(root, 'build.gradle.kts'))
  ) s.push('java')
  const rootFiles = tryRead(root)
  if (rootFiles.some((f) => f.endsWith('.csproj') || f.endsWith('.sln'))) s.push('dotnet')
  if (s.length === 0 && rootFiles.some((f) => f.endsWith('.html'))) s.push('html')
  return s
}

// ---------------------------------------------------------------------------
// Node.js stack detection
// ---------------------------------------------------------------------------

function detectNodeStack(root) {
  const pkg = tryParse(join(root, 'package.json'))
  if (!pkg) return null

  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
    ...pkg.optionalDependencies,
  }
  const has = (n) => n in deps

  const lang =
    has('typescript') || existsSync(join(root, 'tsconfig.json'))
      ? 'TypeScript'
      : 'JavaScript'

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

  const hasBundler =
    has('vite') || has('webpack') || has('parcel') || has('rollup') || has('esbuild')
  const isSSR = [
    'Nuxt', 'Next.js', 'SvelteKit', 'Remix', 'Astro',
    'NestJS', 'Express', 'Fastify', 'Hono', 'Koa',
  ].includes(framework)

  let runtime = 'Node'
  if (hasBundler && isSSR) runtime = 'Node · browser'
  else if (hasBundler) runtime = 'browser'

  let pattern = 'ESM'
  if (framework === 'Vue 3' || framework === 'Nuxt') pattern = 'Composition API · ESM'
  else if (['React', 'Next.js', 'Remix', 'Gatsby'].includes(framework)) pattern = 'hooks · functional · ESM'
  else if (['Svelte', 'SvelteKit'].includes(framework)) pattern = 'reactive stores · ESM'
  else if (['Express', 'Fastify', 'Hono', 'Koa', 'NestJS'].includes(framework)) pattern = 'ESM · Node'

  return {
    name: pkg.name || basename(root),
    version: pkg.version || '0.1.0',
    lang,
    framework,
    test,
    db,
    runtime,
    pattern,
  }
}

// ---------------------------------------------------------------------------
// PHASE 1 — detect
// ---------------------------------------------------------------------------

/**
 * detect(root) — returns project info + state (EMPTY / DEFINED / EXISTING).
 */
export function detect(root) {
  const langSignals = detectLanguageSignals(root)
  const nodeStack = detectNodeStack(root)

  // Count source files across common source dirs to determine state
  let srcCount = 0
  for (const d of ['src', 'app', 'pages', 'components', 'lib', 'server', 'api']) {
    const full = join(root, d)
    if (existsSync(full)) {
      srcCount += countSourceFiles(full, 3)
      if (srcCount > 5) break
    }
  }
  // Count root-level source files too
  for (const f of tryRead(root)) {
    if (!f.startsWith('.') && !SKIP_DIRS.has(f)) {
      const st = tryStat(join(root, f))
      if (st && st.isFile() && CODE_EXTENSIONS.has(extname(f).toLowerCase())) srcCount++
    }
  }

  const state =
    langSignals.length === 0 && srcCount === 0
      ? 'EMPTY'
      : srcCount <= 3
        ? 'DEFINED'
        : 'EXISTING'

  // Derive language from non-node signals if no package.json
  let lang = nodeStack?.lang || 'JavaScript'
  let framework = nodeStack?.framework || 'none'
  let test = nodeStack?.test || 'none'
  let db = nodeStack?.db || 'none'
  let runtime = nodeStack?.runtime || 'Node'
  let pattern = nodeStack?.pattern || 'ESM'

  if (!nodeStack) {
    if (langSignals.includes('rust'))   { lang = 'Rust';   runtime = 'native';  pattern = 'ownership · zero-cost' }
    else if (langSignals.includes('go'))    { lang = 'Go';    runtime = 'native';  pattern = 'goroutines · interfaces' }
    else if (langSignals.includes('python')){ lang = 'Python';runtime = 'Python';  pattern = 'modules' }
    else if (langSignals.includes('php'))   { lang = 'PHP';   runtime = 'PHP';     pattern = 'MVC' }
    else if (langSignals.includes('ruby'))  { lang = 'Ruby';  runtime = 'Ruby';    pattern = 'MVC' }
    else if (langSignals.includes('java'))  { lang = 'Java';  runtime = 'JVM';     pattern = 'OOP' }
    else if (langSignals.includes('dotnet')){ lang = 'C#';    runtime = '.NET';    pattern = 'OOP' }
    else if (langSignals.includes('html'))  { lang = 'HTML';  framework = 'static';runtime = 'browser'; pattern = 'vanilla' }
  }

  // Git branch
  let branch = 'main'
  try {
    branch =
      execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: root,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || 'main'
  } catch { /* not a git repo */ }

  return {
    state,
    name: nodeStack?.name || basename(root),
    version: nodeStack?.version || '0.1.0',
    lang,
    framework,
    test,
    db,
    runtime,
    pattern,
    branch,
    langSignals,
  }
}

// ---------------------------------------------------------------------------
// PHASE 2 — scan (EXISTING projects only)
// ---------------------------------------------------------------------------

const ZONE_MAP = [
  { id: 'frontend', dirs: ['src', 'app', 'pages', 'components', 'views', 'ui'],           label: 'Frontend' },
  { id: 'backend',  dirs: ['server', 'api', 'backend', 'services', 'handlers', 'routes'], label: 'Backend'  },
  { id: 'data',     dirs: ['db', 'database', 'models', 'migrations', 'schema', 'prisma'], label: 'Data'     },
  { id: 'lib',      dirs: ['lib', 'utils', 'helpers', 'shared', 'common', 'packages'],    label: 'Shared'   },
  { id: 'tests',    dirs: ['tests', 'test', '__tests__', 'spec', 'e2e'],                  label: 'Tests'    },
  { id: 'config',   dirs: ['config', 'configs', '.config', 'env', 'scripts'],             label: 'Config'   },
  { id: 'docs',     dirs: ['docs', 'documentation', 'doc'],                               label: 'Docs'     },
]

function detectZones(root) {
  const out = []
  for (const { id, dirs, label } of ZONE_MAP) {
    for (const d of dirs) {
      const full = join(root, d)
      const st = tryStat(full)
      if (st && st.isDirectory()) {
        const fileCount = countSourceFiles(full, 5)
        out.push({ id, label, path: d, fileCount })
        break
      }
    }
  }
  return out
}

const ENTRY_CANDIDATES = {
  'Nuxt': [
    { path: 'app.vue',         role: 'App root'      },
    { path: 'nuxt.config.ts',  role: 'Config'        },
    { path: 'nuxt.config.js',  role: 'Config'        },
    { path: 'server/api',      role: 'API routes', isDir: true },
    { path: 'pages',           role: 'Pages',      isDir: true },
    { path: 'composables',     role: 'Composables',isDir: true },
    { path: 'components',      role: 'Components', isDir: true },
  ],
  'Next.js': [
    { path: 'app',             role: 'App router', isDir: true },
    { path: 'pages',           role: 'Pages',      isDir: true },
    { path: 'next.config.js',  role: 'Config'      },
    { path: 'next.config.ts',  role: 'Config'      },
  ],
  'SvelteKit': [
    { path: 'src/routes',      role: 'Routes',     isDir: true },
    { path: 'src/lib',         role: 'Library',    isDir: true },
    { path: 'svelte.config.js',role: 'Config'      },
  ],
  'Vue 3': [
    { path: 'src/App.vue',     role: 'App root'    },
    { path: 'src/main.ts',     role: 'Entry'       },
    { path: 'src/main.js',     role: 'Entry'       },
    { path: 'src/router',      role: 'Router',     isDir: true },
    { path: 'src/components',  role: 'Components', isDir: true },
    { path: 'vite.config.ts',  role: 'Build config'},
  ],
  'React': [
    { path: 'src/index.tsx',   role: 'Entry'       },
    { path: 'src/index.jsx',   role: 'Entry'       },
    { path: 'src/App.tsx',     role: 'App root'    },
    { path: 'src/App.jsx',     role: 'App root'    },
    { path: 'vite.config.ts',  role: 'Build config'},
  ],
  'Astro': [
    { path: 'src/pages',       role: 'Pages',      isDir: true },
    { path: 'src/components',  role: 'Components', isDir: true },
    { path: 'astro.config.mjs',role: 'Config'      },
  ],
  'Express':  [{ path: 'src/index.ts', role: 'Entry' }, { path: 'index.js', role: 'Entry' }],
  'Fastify':  [{ path: 'src/index.ts', role: 'Entry' }, { path: 'src/app.ts', role: 'App' }],
  'Hono':     [{ path: 'src/index.ts', role: 'Entry' }],
  'NestJS':   [{ path: 'src/main.ts',  role: 'Entry' }, { path: 'src/app.module.ts', role: 'App module' }],
}

const UNIVERSAL_CANDIDATES = [
  { path: 'package.json',   role: 'Dependencies & scripts' },
  { path: 'tsconfig.json',  role: 'TypeScript config'      },
  { path: '.env.example',   role: 'Env template'           },
  { path: 'README.md',      role: 'Documentation'          },
  { path: 'AGENTS.md',      role: 'AI onboarding'          },
]

function detectKeyFiles(root, info) {
  const out = []
  const seen = new Set()

  const candidates = [
    ...(ENTRY_CANDIDATES[info.framework] || []),
    ...UNIVERSAL_CANDIDATES,
  ]

  for (const { path, role, isDir } of candidates) {
    if (seen.has(path)) continue
    const full = join(root, path)
    const st = tryStat(full)
    if (!st) continue
    const ok = isDir ? st.isDirectory() : st.isFile()
    if (ok) {
      out.push({ path, role })
      seen.add(path)
    }
  }

  return out
}

function collectHealthSignals(root) {
  const blocking = []
  const debt = []

  const sourceDirs = [
    'src', 'app', 'server', 'api', 'lib', 'pages',
    'components', 'composables', 'routes', 'services',
  ]

  for (const d of sourceDirs) {
    const full = join(root, d)
    if (existsSync(full)) walkForSignals(root, full, { blocking, debt })
  }

  // Root-level source files
  for (const f of tryRead(root)) {
    if (f.startsWith('.') || SKIP_DIRS.has(f)) continue
    const full = join(root, f)
    const st = tryStat(full)
    if (st && st.isFile() && CODE_EXTENSIONS.has(extname(f).toLowerCase())) {
      scanFileSignals(root, f, full, { blocking, debt })
    }
  }

  return { blocking, debt }
}

function walkForSignals(root, dir, out, depth = 0) {
  if (depth > 7) return
  for (const f of tryRead(dir)) {
    if (SKIP_DIRS.has(f) || f.startsWith('.')) continue
    const full = join(dir, f)
    const st = tryStat(full)
    if (!st) continue
    if (st.isDirectory()) {
      walkForSignals(root, full, out, depth + 1)
    } else if (st.isFile()) {
      const ext = extname(f).toLowerCase()
      if (CODE_EXTENSIONS.has(ext)) {
        const rel = relative(root, full)
        scanFileSignals(root, rel, full, out)
      }
    }
  }
}

function scanFileSignals(root, relPath, fullPath, out) {
  let lines
  try {
    lines = readFileSync(fullPath, 'utf8').split('\n')
  } catch { return }

  // Large file
  if (lines.length > LARGE_FILE_LINES) {
    out.debt.push({ type: 'large-file', file: relPath, lines: lines.length })
  }

  const isTestFile =
    relPath.includes('/test') ||
    relPath.includes('/spec') ||
    relPath.includes('.test.') ||
    relPath.includes('.spec.')

  const limit = Math.min(lines.length, 600)
  for (let i = 0; i < limit; i++) {
    const line = lines[i]

    // TODO / FIXME
    const m = line.match(TODO_PATTERN)
    if (m) {
      out.blocking.push({
        type: 'todo',
        file: relPath,
        line: i + 1,
        keyword: m[1].toUpperCase(),
        text: m[2].trim().slice(0, 120),
      })
    }

    // console.log in non-test production code
    if (!isTestFile && CONSOLE_LOG_PATTERN.test(line)) {
      out.debt.push({ type: 'console-log', file: relPath, line: i + 1 })
    }
  }
}

function getGitStatus(root) {
  try {
    const raw = execSync('git status --porcelain', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (!raw) return []
    return raw
      .split('\n')
      .map((line) => ({ status: line.slice(0, 2).trim(), file: line.slice(3).trim() }))
      .filter(({ file }) => file && !file.startsWith('harness/') && !file.startsWith('.claude/'))
  } catch { return [] }
}

// ---------------------------------------------------------------------------
// Full-scan helpers
// ---------------------------------------------------------------------------

function fileRole(relPath, name, ext) {
  const p = relPath.replace(/\\/g, '/')
  const lower = name.toLowerCase()

  // Tests — check early to avoid mis-labelling
  if (/\.(test|spec)\.(ts|js|tsx|jsx|mjs)$/.test(name)) return 'Test'
  if (p.includes('/__tests__/') || p.includes('/test/') || p.includes('/tests/') || p.includes('/spec/') || p.includes('/e2e/')) return 'Test'

  // Type definitions
  if (name.endsWith('.d.ts')) return 'Type definition'

  // Config files
  if (/^(vite|nuxt|next|svelte|astro|tailwind|postcss|babel|jest|vitest|eslint|prettier|rollup|webpack|esbuild)\.config/i.test(lower)) return 'Config'
  if (/^(tsconfig|jsconfig)/.test(lower) && ext === '.json') return 'Config'
  if (/^\.(eslintrc|prettierrc|babelrc|stylelintrc|browserslistrc)/.test(name)) return 'Config'
  if (lower === '.env.example' || lower === '.env.local.example') return 'Env template'
  if (/^\.env/.test(name)) return 'Environment'
  if (/\.(config|rc)\.(ts|js|mjs|cjs)$/.test(name)) return 'Config'

  // Entry points
  if (/^(main|index)\.(ts|js|mjs|cjs|tsx|jsx)$/.test(name)) return 'Entry point'
  if (/^App\.(vue|tsx|jsx|svelte)$/.test(name)) return 'Root component'

  // Styles
  if (['.css', '.scss', '.sass', '.less', '.styl', '.pcss'].includes(ext)) return 'Styles'

  // Vue components
  if (ext === '.vue') {
    if (p.includes('/pages/') || p.includes('/views/')) return 'Page'
    if (p.includes('/layouts/') || lower.includes('layout')) return 'Layout'
    return 'Component'
  }

  // Svelte / Astro
  if (ext === '.svelte') return p.includes('/routes/') ? 'Route' : 'Component'
  if (ext === '.astro') return p.includes('/pages/') ? 'Page' : 'Component'

  // TSX / JSX
  if (ext === '.tsx' || ext === '.jsx') {
    if (p.includes('/pages/') || p.includes('/app/')) return 'Page'
    if (p.includes('/components/') || /^[A-Z]/.test(name)) return 'Component'
  }

  // Composables / hooks
  if (/^use[A-Z]/.test(name)) return p.includes('/hooks/') ? 'Hook' : 'Composable'

  // Stores
  if (p.includes('/stores/') || p.includes('/store/')) return 'Store'
  if (/\.store\.(ts|js)$/.test(name)) return 'Store'
  if (/[Ss]lice\.(ts|js|tsx)$/.test(name)) return 'Redux slice'

  // Router
  if (p.includes('/router/')) return lower === 'index.ts' || lower === 'index.js' ? 'Router config' : 'Route'
  if (lower === 'router.ts' || lower === 'router.js') return 'Router config'

  // API routes
  if (p.includes('/server/api/') || p.includes('/pages/api/') || p.includes('/app/api/')) return 'API route'

  // Server
  if (p.includes('/server/utils/') || p.includes('/server/helpers/')) return 'Server utility'
  if (p.includes('/server/middleware/') || p.includes('/middleware/')) return 'Middleware'
  if (p.includes('/server/plugins/') || p.includes('/plugins/')) return 'Plugin'

  // Models / schemas / DB
  if (p.includes('/models/') || p.includes('/entities/')) return 'Model'
  if (p.includes('/migrations/')) return 'Migration'
  if (lower.includes('schema') && ['.ts', '.js', '.prisma', '.graphql'].includes(ext)) return 'Schema'
  if (p.includes('/db') && (lower === 'seed.ts' || lower === 'seed.js')) return 'DB seed'

  // Services
  if (p.includes('/services/') || /\.service\.(ts|js)$/.test(name)) return 'Service'

  // Utils / helpers / lib
  if (p.includes('/utils/') || p.includes('/helpers/') || p.includes('/util/')) return 'Utility'
  if (p.includes('/lib/')) return 'Library'
  if (p.includes('/constants/') || lower.includes('constants')) return 'Constants'

  // Docs
  if (ext === '.md' || ext === '.mdx') return 'Documentation'

  // Data / config files
  if (ext === '.json') return 'Data'
  if (ext === '.yaml' || ext === '.yml') return 'Config'
  if (ext === '.graphql' || ext === '.gql') return 'GraphQL'
  if (ext === '.prisma') return 'Prisma schema'
  if (ext === '.sql') return 'SQL'
  if (ext === '.sh' || ext === '.bash') return 'Script'

  return null
}

function shouldPeek(relPath, name) {
  return PEEK_NAME_PATTERNS.some((p) => p.test(name)) ||
    PEEK_PATH_PATTERNS.some((p) => p.test(relPath))
}

function peekContent(fullPath) {
  let text
  try {
    text = readFileSync(fullPath, 'utf8').slice(0, 3000)
  } catch { return null }

  const notes = []

  // Component name
  const cName = text.match(/\bname\s*:\s*['"]([A-Za-z][A-Za-z0-9-]+)['"]/)?.[1]
  if (cName) notes.push(`name: ${cName}`)

  // defineProps — extract prop names
  const propsMatch = text.match(/defineProps[<(][^;]{0,400}?\{([^}]{0,300})\}/s)
  if (propsMatch) {
    const props = [...propsMatch[1].matchAll(/\b([a-z][a-zA-Z0-9]*)\s*[?:]/g)]
      .map((m) => m[1]).filter((p) => p !== 'type').slice(0, 5)
    if (props.length) notes.push(`props: ${props.join(', ')}`)
  }

  // defineEmits
  const emitsMatch = text.match(/defineEmits[^;]{0,100}?\[([^\]]{0,200})\]/s)
  if (emitsMatch) {
    const emits = [...emitsMatch[1].matchAll(/['"]([a-z][a-zA-Z0-9:'-]*)['"]/g)]
      .map((m) => m[1]).slice(0, 4)
    if (emits.length) notes.push(`emits: ${emits.join(', ')}`)
  }

  // Pinia defineStore
  const storeName = text.match(/defineStore\s*\(\s*['"]([^'"]+)['"]/)?.[1]
  if (storeName) notes.push(`store: ${storeName}`)

  // Named exports (functions / consts / classes)
  const namedExports = [...text.matchAll(/^export (?:async )?(?:function|const|class) ([A-Za-z][A-Za-z0-9_]*)/gm)]
    .map((m) => m[1]).slice(0, 4)
  if (namedExports.length) notes.push(`exports: ${namedExports.join(', ')}`)

  // HTTP method from filename (Nuxt/Next conventions: user.get.ts)
  const httpMethod = fullPath.replace(/\\/g, '/').match(/\.(get|post|put|patch|delete)\.(ts|js)$/i)?.[1]?.toUpperCase()
  if (httpMethod) notes.push(httpMethod)

  // defineEventHandler without explicit method in filename
  if (!httpMethod && /defineEventHandler|eventHandler/.test(text)) notes.push('handler')

  // Vue Router: count route definitions
  const routeCount = (text.match(/\bpath\s*:/g) || []).length
  if (routeCount > 1) notes.push(`${routeCount} routes`)

  return notes.length ? notes.join(' · ') : null
}

function walkFull(root, dir, result, depth) {
  if (dir === undefined) dir = root
  if (result === undefined) result = []
  if (depth === undefined) depth = 0
  if (depth > 8) return result

  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch { return result }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue

    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue
      walkFull(root, fullPath, result, depth + 1)
    } else if (entry.isFile()) {
      if (SKIP_FILES_FULL.has(entry.name)) continue
      const ext = extname(entry.name).toLowerCase()
      if (SKIP_EXTENSIONS_FULL.has(ext)) continue
      if (entry.name.startsWith('.') && !entry.name.startsWith('.env')) continue

      const relPath = relative(root, fullPath).replace(/\\/g, '/')
      result.push({ path: relPath, name: entry.name, ext, fullPath })
    }
  }

  return result
}

const TOP_DIR_ORDER = [
  'src', 'app', 'pages', 'components', 'composables', 'hooks', 'stores',
  'server', 'api', 'lib', 'utils', 'helpers', 'services',
  'db', 'docs', 'tests', 'test', '__tests__', 'scripts', 'config',
]

function buildFullStructure(root, files) {
  const dirs = new Map()

  for (const file of files) {
    const parts = file.path.split('/')
    const topDir = parts.length > 1 ? parts[0] : '.'
    if (!dirs.has(topDir)) dirs.set(topDir, [])

    const role = fileRole(file.path, file.name, file.ext)
    const notes = shouldPeek(file.path, file.name) ? peekContent(file.fullPath) : null
    dirs.get(topDir).push({ path: file.path, name: file.name, role: role || '—', notes: notes || '' })
  }

  return [...dirs.entries()]
    .sort(([a], [b]) => {
      const ai = TOP_DIR_ORDER.indexOf(a)
      const bi = TOP_DIR_ORDER.indexOf(b)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return a.localeCompare(b)
    })
    .map(([dir, dirFiles]) => ({ dir, files: dirFiles }))
}

/**
 * scan(root, info) — deep analysis pass. Returns model with zones, keyFiles, health, gitStatus, structure.
 */
export function scan(root, info) {
  const allFiles = walkFull(root)
  const structure = buildFullStructure(root, allFiles)

  return {
    ...info,
    zones:     detectZones(root),
    keyFiles:  detectKeyFiles(root, info),
    health:    collectHealthSignals(root),
    gitStatus: getGitStatus(root),
    structure,
    scannedAt: new Date().toISOString(),
  }
}

/**
 * projectModel(root) — runs both phases and returns the full model.
 * The safe entry point for every caller that wants "the current state of this project".
 */
export function projectModel(root) {
  const info = detect(root)
  if (info.state === 'EMPTY') return { ...info, zones: [], keyFiles: [], health: { blocking: [], debt: [] }, gitStatus: [] }
  return scan(root, info)
}

// ---------------------------------------------------------------------------
// CLI: node harness/analyze.mjs
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const root = resolve(HERE, '..')
  const model = projectModel(root)
  const { state, name, lang, framework, test, db } = model
  const b = model.health?.blocking?.length ?? 0
  const d = model.health?.debt?.length ?? 0
  const g = model.gitStatus?.length ?? 0
  console.log(`\n${name} — ${state}`)
  console.log(`  Stack: ${lang} · ${framework} · test: ${test} · db: ${db}`)
  if (model.zones?.length) console.log(`  Zones: ${model.zones.map((z) => z.path).join(', ')}`)
  console.log(`  Health: ${b} blocking · ${d} debt · ${g} in progress\n`)
}
