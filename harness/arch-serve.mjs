#!/usr/bin/env node
/**
 * arch-serve.mjs — background watch server for the architecture & health map (zero deps).
 *
 * Regenerates harness/arch-map.html, serves it on localhost, and live-reloads the browser
 * whenever a signal that drives the map changes (TODO.md, architecture.json, assertions.json,
 * or any node's own source file). Run it in the background and leave the tab open — it tracks
 * the project's health as you work, no manual `npm run harness:map` needed.
 *
 * Usage:
 *   node harness/arch-serve.mjs               # serve on :4319 + open the browser
 *   node harness/arch-serve.mjs --port 5000    # custom port
 *   node harness/arch-serve.mjs --no-open      # don't auto-open the browser
 */

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, watch } from 'node:fs'
import { spawn } from 'node:child_process'
import { relative } from 'node:path'
import { generate, watchTargets, OUT_FILE, PROJECT_ROOT, NOTES_FILE } from './arch-map.mjs'
import { injectLiveReload, newNote, applyNoteAdd, applyNoteUpdate } from './context-sync/arch-lib.mjs'

const args = process.argv.slice(2)
const portArg = args.indexOf('--port')
const PORT = portArg !== -1 && args[portArg + 1] ? Number(args[portArg + 1]) : 4319
const OPEN = !args.includes('--no-open')

let rev = 0
function log(msg) {
  console.log(`[arch-serve] ${msg}`)
}

function regen(reason) {
  try {
    const { model } = generate({ quiet: true })
    rev++
    const c = model.counts
    log(`#${rev} ${reason} → ${c.crit} blocking · ${c.debt} debt · ${c.ok} healthy${model.drift.length ? ` · ${model.drift.length} DRIFT` : ''}`)
  } catch (e) {
    log(`regenerate failed: ${e.message}`)
  }
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref()
    else if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
    else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
  } catch {
    /* opening the browser is best-effort */
  }
}

regen('startup')

let timer = null
for (const file of watchTargets()) {
  try {
    watch(file, () => {
      clearTimeout(timer)
      timer = setTimeout(() => regen(`change: ${relative(PROJECT_ROOT, file)}`), 200)
    })
  } catch {
    /* a file we can't watch (e.g. removed) — skip it */
  }
}

function readNotes() {
  try {
    const store = JSON.parse(readFileSync(NOTES_FILE, 'utf8'))
    return Array.isArray(store.notes) ? store : { notes: [] }
  } catch {
    return { notes: [] }
  }
}
function writeNotes(store) {
  writeFileSync(NOTES_FILE, JSON.stringify(store, null, 2) + '\n')
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 1e6) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}
function sendJson(res, obj, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(obj))
}

const server = createServer(async (req, res) => {
  try {
    const url = (req.url || '/').split('?')[0]
    const method = req.method || 'GET'

    if (url === '/__rev') {
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      res.end(String(rev))
      return
    }

    if (url === '/__notes') {
      if (method === 'GET') return sendJson(res, readNotes().notes)
      if (method === 'POST') {
        try {
          const note = newNote(JSON.parse((await readBody(req)) || '{}'))
          writeNotes(applyNoteAdd(readNotes(), note))
          log(`note added${note.node ? ' on ' + note.node : ' (idea)'}: ${note.text.slice(0, 60)}`)
          return sendJson(res, note, 201)
        } catch (e) {
          return sendJson(res, { error: e.message }, 400)
        }
      }
    }

    if (url === '/__notes/update' && method === 'POST') {
      try {
        const patch = JSON.parse((await readBody(req)) || '{}')
        writeNotes(applyNoteUpdate(readNotes(), patch))
        return sendJson(res, { ok: true })
      } catch (e) {
        return sendJson(res, { error: e.message }, 400)
      }
    }

    if (url === '/' || url === '/index.html') {
      let html
      try {
        html = readFileSync(OUT_FILE, 'utf8')
      } catch {
        html = '<!doctype html><h1>arch map not generated yet</h1>'
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(injectLiveReload(html, rev))
      return
    }

    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('server error: ' + e.message)
  }
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log(`port ${PORT} is in use — restart with --port <n> (e.g. npm run harness:watch -- --port 5000)`)
    process.exit(1)
  }
  log(`server error: ${e.message}`)
  process.exit(1)
})

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`
  log(`serving ${url} — live-reloads on change. Ctrl+C to stop.`)
  if (OPEN) openBrowser(url)
})
