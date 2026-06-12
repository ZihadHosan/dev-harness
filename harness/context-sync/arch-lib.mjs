/**
 * arch-lib.mjs — pure helpers for the harness-fed architecture map (zero deps).
 *
 * The CLI (harness/arch-map.mjs) is a thin wrapper: it reads architecture.json,
 * runs the existing assertions (verify), parses TODO.md, then calls these functions
 * to DERIVE each node's health and render the standalone HTML. Keeping the logic
 * pure + exported is what lets tests/arch-map.test.js cover it — same rule the repo
 * applies to entitlement/parsing logic and to context-sync/lib.mjs.
 *
 * Status derivation (the whole point — the map can't lie):
 *   external            → 'ext'   (neutral, not health-scored)
 *   a backing assertion FAILED  → 'crit' (red — code contradicts a claimed invariant)
 *   highest open TODO = P0       → 'crit' (red — blocking work)
 *   highest open TODO = P1/P2/P3 → 'debt' (amber — known work, not broken)
 *   node flagged wip             → 'wip'  (blue — in progress)
 *   otherwise                    → 'ok'   (green)
 */

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 }
const rank = (p) => (p in PRIORITY_RANK ? PRIORITY_RANK[p] : 9)

/** Escape a string for safe inlining into HTML text/attributes. */
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Strip light Markdown (bold markers, backticks) so TODO text reads cleanly in the UI. */
export function stripMd(s) {
  return String(s || '').replace(/\*\*/g, '').replace(/`/g, '').trim()
}

// ---------------------------------------------------------------------------
// Planning notes (captured from the map UI, persisted to harness/notes.json)
// ---------------------------------------------------------------------------

const NOTE_KINDS = new Set(['idea', 'remark', 'todo'])
const NOTE_STATUSES = new Set(['open', 'in_progress', 'done'])

/** Build a validated note from raw UI input. Throws if there's no text. */
export function newNote(input = {}, { id, now } = {}) {
  const text = String(input.text == null ? '' : input.text).trim()
  if (!text) throw new Error('note text is required')
  const note = {
    id: id || 'n_' + Math.random().toString(36).slice(2, 9),
    node: input.node ? String(input.node) : null,
    kind: NOTE_KINDS.has(input.kind) ? input.kind : 'remark',
    text,
    status: 'open',
    createdAt: now || new Date().toISOString()
  }
  if (input.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(String(input.dueDate))) note.dueDate = String(input.dueDate)
  return note
}

/** Append a note, returning a new store (never mutates). */
export function applyNoteAdd(store, note) {
  const notes = Array.isArray(store && store.notes) ? store.notes : []
  return { ...store, notes: [...notes, note] }
}

/** Toggle status / edit text / remove a note by id, returning a new store. */
export function applyNoteUpdate(store, patch = {}) {
  const notes = Array.isArray(store && store.notes) ? store.notes : []
  if (patch.remove) return { ...store, notes: notes.filter((n) => n.id !== patch.id) }
  return {
    ...store,
    notes: notes.map((n) => {
      if (n.id !== patch.id) return n
      const next = { ...n }
      if (NOTE_STATUSES.has(patch.status)) next.status = patch.status
      if (typeof patch.text === 'string' && patch.text.trim()) next.text = patch.text.trim()
      if (typeof patch.dueDate === 'string') {
        if (patch.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(patch.dueDate)) next.dueDate = patch.dueDate
        else delete next.dueDate
      }
      return next
    })
  }
}

/** Group notes by node id; global (node=null) notes go under '__global'. */
export function notesByNode(notes) {
  const out = { __global: [] }
  for (const n of notes || []) {
    const key = n.node || '__global'
    ;(out[key] = out[key] || []).push(n)
  }
  return out
}

/** Count of active (not-done) notes per node id (and '__global') — drives the map badges. */
export function openNoteCounts(notes) {
  const out = {}
  for (const n of notes || []) {
    if (n.status === 'done') continue
    const key = n.node || '__global'
    out[key] = (out[key] || 0) + 1
  }
  return out
}

/** Group notes into the three board columns (unknown status falls back to 'open'). */
export function notesByStatus(notes) {
  const out = { open: [], in_progress: [], done: [] }
  for (const n of notes || []) {
    const key = out[n.status] ? n.status : 'open'
    out[key].push(n)
  }
  return out
}

/**
 * Parse TODO.md into flat items: { priority: 'P0'|'P1'|'P2'|'P3'|null, done, text }.
 * Priority is taken from the nearest preceding `## … Pn …` heading; a heading without
 * a Pn token (e.g. "## Done") resets priority to null so checked-off items don't inherit one.
 */
export function parseTodo(text) {
  const items = []
  let priority = null
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    if (/^#{1,6}\s/.test(line)) {
      const m = line.match(/\bP([0-3])\b/)
      priority = m ? `P${m[1]}` : null
      continue
    }
    const t = line.match(/^- \[( |x|X)\]\s+(.*)$/)
    if (t) items.push({ priority, done: t[1].toLowerCase() === 'x', text: t[2] })
  }
  return items
}

/** Highest (most severe) open priority among items whose text matches `matcher`, or null. */
export function highestOpenPriority(items, matcher) {
  if (!matcher) return null
  let re
  try {
    re = new RegExp(matcher, 'i')
  } catch {
    return null
  }
  let best = null
  for (const it of items || []) {
    if (it.done || !it.priority || !re.test(it.text)) continue
    if (best === null || rank(it.priority) < rank(best)) best = it.priority
  }
  return best
}

/** The open TODO items (with priority) that a node's `todoMatch` selects. */
export function matchedTodos(node, todoItems) {
  if (!node.todoMatch) return []
  let re
  try {
    re = new RegExp(node.todoMatch, 'i')
  } catch {
    return []
  }
  return (todoItems || []).filter((it) => !it.done && it.priority && re.test(it.text))
}

/**
 * Derive a node's status from failed assertions + open TODO priorities + flags.
 * ctx: { failed: Set<assertionId>, todoItems: [...] }
 */
export function computeNodeStatus(node, ctx) {
  if (node.external) return 'ext'
  const failed = (node.assertions || []).some((id) => ctx.failed.has(id))
  if (failed) return 'crit'
  const pr = highestOpenPriority(ctx.todoItems, node.todoMatch)
  if (pr === 'P0') return 'crit'
  if (pr) return 'debt'
  if (node.wip) return 'wip'
  return 'ok'
}

/** The human-readable reasons behind a node's status (shown in the detail panel). */
export function nodeReasons(node, ctx) {
  const out = []
  for (const id of node.assertions || []) {
    if (ctx.failed.has(id)) {
      out.push({ sev: 'broken', text: (ctx.failDetail && ctx.failDetail.get(id)) || `invariant failed: ${id}` })
    }
  }
  for (const it of matchedTodos(node, ctx.todoItems)) {
    out.push({ sev: it.priority, text: stripMd(it.text) })
  }
  if (!out.length && node.wip) out.push({ sev: 'wip', text: 'Active work in progress.' })
  return out
}

/**
 * Build the full render model from the architecture graph + the live signals.
 * ctx: { failed:Set, failDetail:Map, todoItems:[], fileExists:(relPath)=>bool,
 *        knownAssertions:Set, now?:string }
 * `drift` collects every place the graph no longer matches reality — a node pointing
 * at a missing file, or referencing an assertion id that isn't defined. Strict mode
 * fails on a non-empty drift list so the diagram can never silently rot.
 */
export function buildModel(arch, ctx) {
  const drift = []
  const counts = { ok: 0, debt: 0, crit: 0, wip: 0, ext: 0 }
  const nodes = (arch.nodes || []).map((n) => {
    const status = computeNodeStatus(n, ctx)
    const reasons = nodeReasons(n, ctx)
    if (status in counts) counts[status]++
    let missing = false
    if (!n.external && !n.wip && n.path) {
      missing = !ctx.fileExists(n.path)
      if (missing) drift.push(`${n.id} → path not found: ${n.path}`)
    }
    if (ctx.knownAssertions) {
      for (const id of n.assertions || []) {
        if (!ctx.knownAssertions.has(id)) drift.push(`${n.id} → unknown assertion id: ${id}`)
      }
    }
    return { ...n, status, reasons, missing }
  })
  const zones = (arch.zones || []).map((z) => ({ ...z, nodes: nodes.filter((n) => n.zone === z.id) }))
  return { generatedAt: ctx.now || new Date().toISOString(), zones, counts, drift, nodes, todoItems: ctx.todoItems || [] }
}

const STATUS_LABEL = { ok: 'Healthy', debt: 'Tech debt', crit: 'Blocking', wip: 'In progress', ext: 'External' }
const SEV_COLOR = { broken: '#ff6c6c', P0: '#ff6c6c', P1: '#f5a117', P2: '#6b6a64', P3: '#6b6a64', wip: '#2f6fd0' }

function nodeDisplayFile(n) {
  if (n.external) return n.host || 'external'
  return n.path || '— not built —'
}

const BROWSER_JS = `
(function () {
  var M = window.__ARCH__ || {};
  var SEV = M.sevColor || {};
  var det = document.getElementById('arch-detail');
  var NOTES = [];
  var NOTES_ON = false;
  var SEL = null;
  var ORDER = ['open', 'in_progress', 'done'];
  var STATUSL = { open: 'Backlog', in_progress: 'In progress', done: 'Done' };
  var SORT_BY = 'added';
  var FILTER_NODE = 'all';
  var FILTER_STATUS = null;

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function relDate(iso){
    if (!iso) return '';
    var d=new Date(iso); var diff=Date.now()-d.getTime(); var mins=Math.floor(diff/60000);
    if (mins<1) return 'just now';
    if (mins<60) return mins+'m ago';
    var hrs=Math.floor(mins/60);
    if (hrs<24) return hrs+'h ago';
    var days=Math.floor(hrs/24);
    if (days<7) return days+'d ago';
    return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  }
  function byDate(a,b){ return (b.createdAt||'')>(a.createdAt||'')?1:-1; }
  function byDueDate(a,b){
    if (!a.dueDate&&!b.dueDate) return byDate(a,b);
    if (!a.dueDate) return 1; if (!b.dueDate) return -1;
    return a.dueDate>b.dueDate?1:a.dueDate<b.dueDate?-1:0;
  }
  function sortFn(){ return SORT_BY==='due'?byDueDate:byDate; }
  function dueStatus(iso){
    if (!iso) return '';
    var d=new Date(iso+'T00:00:00'); var today=new Date(); today.setHours(0,0,0,0);
    var diff=Math.round((d-today)/86400000);
    if (diff<0) return 'overdue'; if (diff===0) return 'today'; if (diff<=2) return 'soon'; return 'ok';
  }
  function dueBadge(iso){
    if (!iso) return '';
    var s=dueStatus(iso);
    var label={overdue:'⚠ '+iso+' overdue',today:'● due today',soon:'◎ '+iso,ok:iso}[s]||iso;
    return '<span class="due-badge '+s+'">'+esc(label)+'</span>';
  }
  function buildCopyPrompt(){
    var BT=String.fromCharCode(96); // backtick — literal backtick would close the surrounding template literal
    var lines=[];
    lines.push('# '+(M.projectName||'Project')+' — Planning Context');
    lines.push('Generated: '+new Date().toISOString());
    lines.push('Branch: dev  |  Architecture: harness/architecture.json  |  Notes store: harness/notes.json');
    lines.push('');
    lines.push('## How to use this context');
    lines.push('- Reference notes by their ID (e.g. '+BT+'n_abc123'+BT+') — IDs are stable across sessions');
    lines.push('- File paths are relative to the repo root');
    lines.push('- After completing work on a note, mark it done in the Planning tab ('+BT+'npm run harness:watch'+BT+')');
    lines.push('- notes.json is a harness-tracked file — Claude re-reads it at session start if changed');
    lines.push('- The architecture map shows live component health derived from assertions + TODO.md');
    lines.push('');
    var active=NOTES.filter(function(n){return n.status!=='done';}).slice().sort(sortFn());
    lines.push('## Active notes ('+active.length+' open / in-progress)');
    lines.push('');
    if (!active.length) { lines.push('(none)'); lines.push(''); }
    for (var i=0;i<active.length;i++){
      var n=active[i]; var nd=n.node&&M.nodes?M.nodes[n.node]:null;
      lines.push('### '+n.id+' · '+n.kind.toUpperCase()+' · '+(n.node||'global')+' · '+(STATUSL[n.status]||n.status).toUpperCase());
      if (nd){
        lines.push('Component : '+nd.label);
        lines.push('File      : '+nd.file);
        lines.push('Health    : '+(M.statusLabel&&M.statusLabel[nd.status]||nd.status));
        if (nd.reasons&&nd.reasons.length) lines.push('Issues    : '+nd.reasons.map(function(r){return '['+r.sev+'] '+r.text;}).join(' | '));
      } else {
        lines.push('Scope     : global (not tied to a specific component)');
      }
      lines.push('Note      : '+n.text);
      if (n.dueDate) lines.push('Due       : '+n.dueDate+(dueStatus(n.dueDate)==='overdue'?' ⚠ OVERDUE':''));
      lines.push('Created   : '+new Date(n.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}));
      lines.push('');
    }
    var done=NOTES.filter(function(n){return n.status==='done';}).slice().sort(byDate).slice(0,5);
    if (done.length){
      lines.push('## Recently completed');
      lines.push('');
      for (var j=0;j<done.length;j++){
        var dn=done[j];
        lines.push('- ['+dn.id+'] '+dn.kind.toUpperCase()+': '+dn.text+(dn.node?' (component: '+dn.node+')':''));
      }
      lines.push('');
    }
    if (M.nodes){
      lines.push('## Component health snapshot (all '+Object.keys(M.nodes).length+' nodes)');
      lines.push('');
      lines.push('| Node ID | Label | File | Health | Issues |');
      lines.push('|---------|-------|------|--------|--------|');
      var nids=Object.keys(M.nodes);
      for (var k=0;k<nids.length;k++){
        var nid=nids[k]; var c=M.nodes[nid];
        var iss=c.reasons&&c.reasons.length?c.reasons.map(function(r){return r.sev+': '+r.text;}).join('; '):'—';
        lines.push('| '+BT+nid+BT+' | '+c.label+' | '+BT+c.file+BT+' | '+(M.statusLabel&&M.statusLabel[c.status]||c.status)+' | '+iss+' |');
      }
      lines.push('');
    }
    lines.push('---');
    lines.push('*Auto-generated from harness/notes.json + harness/architecture.json.*');
    lines.push('*Run '+BT+'npm run harness:watch'+BT+' for live health. Edit notes via the Planning tab.*');
    return lines.join(String.fromCharCode(10));
  }
  function buildNodeCopyPrompt(nodeId){
    var BT=String.fromCharCode(96);
    var node=M.nodes[nodeId];
    if (!node) return '';
    var lines=[];
    lines.push('# Component: '+node.label);
    lines.push('');
    lines.push('**File:** '+BT+node.file+BT);
    lines.push('**Status:** '+(M.statusLabel&&M.statusLabel[node.status]||node.status));
    lines.push('');
    lines.push('## Description');
    lines.push(node.desc||'(no description)');
    lines.push('');
    if (node.reasons&&node.reasons.length){
      lines.push('## Open issues');
      lines.push('');
      for (var i=0;i<node.reasons.length;i++){
        var r=node.reasons[i];
        lines.push('- **['+r.sev.toUpperCase()+']** '+r.text);
      }
      lines.push('');
    }
    var nodeNotes=notesFor(nodeId);
    if (nodeNotes.length){
      lines.push('## Planning notes');
      lines.push('');
      for (var j=0;j<nodeNotes.length;j++){
        var n=nodeNotes[j];
        lines.push('**'+n.kind.toUpperCase()+':** ['+n.id+']');
        lines.push(n.text);
        lines.push('**Status:** '+(STATUSL[n.status]||n.status));
        if (n.dueDate) lines.push('**Due:** '+n.dueDate+(dueStatus(n.dueDate)==='overdue'?' ⚠ OVERDUE':''));
        lines.push('');
      }
    }
    return lines.join(String.fromCharCode(10));
  }
  function renderToolbar(){
    var seen={}; var chips='';
    chips+='<button class="filter-btn'+(FILTER_NODE==='all'?' active':'')+'" data-act="filter" data-filter="all">All</button>';
    chips+='<button class="filter-btn'+(FILTER_NODE==='__global'?' active':'')+'" data-act="filter" data-filter="__global">Global</button>';
    for (var i=0;i<NOTES.length;i++){
      var nid=NOTES[i].node; if (!nid||seen[nid]) continue; seen[nid]=true;
      var label=M.nodes&&M.nodes[nid]?M.nodes[nid].label:nid;
      chips+='<button class="filter-btn'+(FILTER_NODE===nid?' active':'')+'" data-act="filter" data-filter="'+esc(nid)+'">'+esc(label)+'</button>';
    }
    var sorts='<button class="sort-btn'+(SORT_BY==='added'?' active':'')+'" data-act="sort" data-sort="added">Added ↓</button>'
      +'<button class="sort-btn'+(SORT_BY==='due'?' active':'')+'" data-act="sort" data-sort="due">Due ↑</button>';
    return '<div class="board-toolbar">'
      +'<div class="toolbar-left"><span class="toolbar-label">Filter</span>'+chips+'</div>'
      +'<div class="toolbar-right"><span class="toolbar-label">Sort</span>'+sorts
      +'<button class="copy-claude-btn" data-act="copyclaude">Copy for Claude</button></div>'
      +'</div>';
  }

  function notesFor(key){
    var out = [];
    for (var i=0;i<NOTES.length;i++){ var n=NOTES[i]; if ((n.node||'__global')===key) out.push(n); }
    return out.sort(sortFn());
  }
  function moveBtns(n){
    var idx = ORDER.indexOf(n.status); if (idx<0) idx=0;
    var h = '';
    if (idx>0) h += '<button data-act="move" data-id="'+esc(n.id)+'" data-status="'+ORDER[idx-1]+'">&#9664; '+esc(STATUSL[ORDER[idx-1]])+'</button>';
    if (idx<ORDER.length-1) h += '<button data-act="move" data-id="'+esc(n.id)+'" data-status="'+ORDER[idx+1]+'">'+esc(STATUSL[ORDER[idx+1]])+' &#9654;</button>';
    return h;
  }
  function noteRow(n){
    return '<div class="note '+esc(n.status)+'" data-id="'+esc(n.id)+'">'
      + '<div class="note-row1"><span class="note-tag '+esc(n.kind)+'">'+esc(n.kind)+'</span>'
      + '<span class="note-status-tag" data-act="goto-planning" data-id="'+esc(n.id)+'">'+esc(STATUSL[n.status]||n.status)+'</span>'
      + '<div class="note-menu"><button class="note-menu-btn" data-act="note-menu" data-id="'+esc(n.id)+'" aria-label="Options">⋯</button>'
      + '<div class="note-dropdown" id="menu-'+esc(n.id)+'" hidden>'
      + '<button data-act="note-edit" data-id="'+esc(n.id)+'">✎ Edit</button>'
      + '<button data-act="note-delete" data-id="'+esc(n.id)+'">🗑 Delete</button>'
      + '</div></div></div>'
      + '<div class="note-text">'+esc(n.text)+'</div>'
      + '<div class="note-meta">'+(n.dueDate?dueBadge(n.dueDate)+' ':'')+'<span class="note-date">'+esc(relDate(n.createdAt))+'</span></div>'
      + '<div class="note-actions">'+moveBtns(n)+'</div>'
      + '</div>';
  }
  function boardCard(n){
    var label = n.node ? (M.nodes[n.node] ? M.nodes[n.node].label : n.node) : 'global';
    var chip = n.node
      ? '<span class="card-node" data-act="goto" data-id="'+esc(n.node)+'" role="button" tabindex="0">'+esc(label)+'</span>'
      : '<span class="card-node">global</span>';
    return '<div class="card '+esc(n.status)+'" data-id="'+esc(n.id)+'">'
      + '<div class="card-top"><span class="card-kind '+esc(n.kind)+'">'+esc(n.kind)+'</span>'+chip
      + '<div class="card-menu"><button class="card-menu-btn" data-act="card-menu" data-id="'+esc(n.id)+'" aria-label="Options">⋯</button>'
      + '<div class="card-dropdown" id="card-menu-'+esc(n.id)+'" hidden>'
      + '<button data-act="card-edit" data-id="'+esc(n.id)+'">✎ Edit</button>'
      + '<button data-act="card-delete" data-id="'+esc(n.id)+'">🗑 Delete</button>'
      + '</div></div></div>'
      + '<div class="card-text">'+esc(n.text)+'</div>'
      + '<div class="card-meta">'+(n.dueDate?dueBadge(n.dueDate)+' ':'')+'<span class="card-date">'+esc(relDate(n.createdAt))+'</span></div>'
      + '<div class="card-ctrl">'+moveBtns(n)+'</div>'
      + '</div>';
  }
  function addForm(key){
    if (!NOTES_ON) return '<span class="notes-off">Run npm run harness:watch to capture notes.</span>';
    return '<div class="note-add">'
      + '<div class="note-add-row">'
      + '<select id="nk-'+esc(key)+'"><option value="remark">remark</option><option value="idea">idea</option><option value="todo">todo</option></select>'
      + '<div class="date-wrap"><span class="date-icon">&#128197;</span><input type="date" id="nd-'+esc(key)+'" title="Due date (optional)"></div>'
      + '</div>'
      + '<textarea id="nt-'+esc(key)+'" data-key="'+esc(key)+'" placeholder="add a note… (Ctrl+Enter to save)" rows="2"></textarea>'
      + '<div class="note-add-actions"><button data-act="add" data-key="'+esc(key)+'">Add</button></div>'
      + '</div>';
  }
  function notesSection(key){
    var list = notesFor(key);
    var h = '<div class="notes-sec"><div class="notes-h">Planning notes';
    if (!NOTES_ON) h += ' <span class="notes-off">(run npm run harness:watch to add)</span>';
    h += '</div>';
    for (var i=0;i<list.length;i++) h += noteRow(list[i]);
    if (!list.length && NOTES_ON) h += '<div class="notes-off">No notes on this component yet.</div>';
    return h + addForm(key) + '</div>';
  }

  function render(id){
    var d = M.nodes[id];
    if (!d) return;
    SEL = id;
    var h = '<div class="d-head"><span class="d-title">' + esc(d.label) + '</span>'
      + '<span class="d-badge ' + d.status + '">' + esc(M.statusLabel[d.status] || d.status) + '</span></div>';
    h += '<div class="d-file">' + esc(d.file) + '</div>';
    h += '<div class="d-desc">' + esc(d.desc) + '</div>';
    if (d.reasons && d.reasons.length) {
      h += '<ul class="d-iss">';
      for (var i=0;i<d.reasons.length;i++){
        var r=d.reasons[i]; var c=SEV[r.sev]||'#6b6a64';
        var lab=r.sev==='broken'?'invariant':r.sev;
        h += '<li><span class="d-tag" style="color:'+c+';border-color:'+c+'">'+esc(lab)+'</span><span>'+esc(r.text)+'</span></li>';
      }
      h += '</ul>';
    } else {
      h += '<div class="d-ok">No open issues - backing checks pass.</div>';
    }
    h += notesSection(id);
    var SVG='<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect x="5.5" y="2.5" width="8" height="10" rx="1"/><path d="M3.5 5.5L3.5 14.5C3.5 15.05 3.95 15.5 4.5 15.5L11.5 15.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    h += '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--bd)"><button data-act="copy-node" data-id="' + esc(id) + '" class="copy-prompt-btn" style="font:inherit;font-size:13px;padding:6px 12px;background:none;border:1px solid var(--bd);border-radius:7px;color:var(--tx2);cursor:pointer;width:100%">Copy as prompt</button>';
    h += '<div class="prompt-preview hidden" id="prompt-preview-' + esc(id) + '"><div class="prompt-header"><pre class="prompt-text" id="prompt-text-' + esc(id) + '"></pre><button data-act="copy-preview" data-id="' + esc(id) + '" class="copy-icon-btn" title="Copy">'+SVG+'</button></div><button data-act="hide-preview" data-id="' + esc(id) + '" class="hide-prompt-btn">Hide</button></div></div>';
    det.innerHTML = h;
    var textEl=document.getElementById('prompt-text-'+id);
    if (textEl) textEl.textContent=buildNodeCopyPrompt(id);
  }

  function renderBoard(){
    var addEl = document.getElementById('board-add');
    if (addEl) addEl.innerHTML = addForm('__global');
    var board = document.getElementById('board');
    if (board){
      var filtered=NOTES.filter(function(n){ if (FILTER_NODE==='all') return true; if (FILTER_NODE==='__global') return !n.node; return n.node===FILTER_NODE; });
      var groups = { open: [], in_progress: [], done: [] };
      for (var i=0;i<filtered.length;i++){ var n=filtered[i]; (groups[n.status]||groups.open).push(n); }
      var sf=sortFn(); for (var s in groups) groups[s].sort(sf);
      var h = renderToolbar() + '<div class="board-cols">';
      for (var c=0;c<ORDER.length;c++){
        var key=ORDER[c]; var list=groups[key]||[];
        h += '<div class="col '+key+'"><div class="col-h"><span class="col-dot"></span>'+esc(STATUSL[key])+' <span class="cnt">'+list.length+'</span></div>';
        for (var j=0;j<list.length;j++) h += boardCard(list[j]);
        if (!list.length) h += '<div class="notes-off">—</div>';
        h += '</div>';
      }
      h += '</div>';
      board.innerHTML = h;
    }
    var pc = document.getElementById('plan-count');
    if (pc){
      var active = 0;
      for (var k=0;k<NOTES.length;k++) if (NOTES[k].status!=='done') active++;
      pc.textContent = active ? ('· ' + active + ' active') : '';
    }
  }

  function renderBadges(){
    var counts = {};
    for (var i=0;i<NOTES.length;i++){ var n=NOTES[i]; if (n.status==='done') continue; var k=n.node||'__global'; counts[k]=(counts[k]||0)+1; }
    var nodes = document.querySelectorAll('.arch-node');
    for (var j=0;j<nodes.length;j++){
      var btn=nodes[j]; var id=btn.getAttribute('data-id'); var nm=btn.querySelector('.n-name');
      if (!nm) continue;
      var ex=nm.querySelector('.node-badge'); if (ex) nm.removeChild(ex);
      if (counts[id]){ var b=document.createElement('span'); b.className='node-badge'; b.textContent='note '+counts[id]; nm.appendChild(b); }
    }
  }

  function renderOverview(){
    var el=document.getElementById('ov-notes');
    if (!el) return;
    var open=0; var wip=0; var done=0; var overdue=0;
    for (var i=0;i<NOTES.length;i++){
      var n=NOTES[i];
      if (n.status==='done') done++;
      else if (n.status==='in_progress') wip++;
      else open++;
      if (n.dueDate && dueStatus(n.dueDate)==='overdue') overdue++;
    }
    var h='<div class="ov-card-h">Planning notes</div><div class="ov-health">';
    h+='<div class="ov-stat"><span>'+(open+wip)+'</span><span class="ov-stat-label">Active</span></div>';
    h+='<div class="ov-stat ok"><span>'+done+'</span><span class="ov-stat-label">Done</span></div>';
    if (overdue) h+='<div class="ov-stat crit"><span>'+overdue+'</span><span class="ov-stat-label">Overdue</span></div>';
    h+='</div>';
    var active=NOTES.filter(function(n){ return n.status!=='done'; }).slice(0,6);
    if (active.length){
      h+='<ul class="ov-note-list">';
      for (var j=0;j<active.length;j++){
        var an=active[j];
        h+='<li><span class="note-tag '+esc(an.kind)+'">'+esc(an.kind)+'</span><span>'+esc(an.text);
        if (an.dueDate&&dueStatus(an.dueDate)==='overdue') h+=' <span class="due-badge overdue">overdue</span>';
        h+='</span></li>';
      }
      h+='</ul>';
    } else {
      h+='<div class="notes-off" style="margin-top:8px">No active notes.</div>';
    }
    el.innerHTML=h;
  }
  function refreshAll(){ renderBadges(); renderBoard(); renderOverview(); if (SEL) render(SEL); }

  function loadNotes(cb){
    fetch('/__notes',{cache:'no-store'})
      .then(function(x){ if (!x.ok) throw 0; return x.json(); })
      .then(function(arr){ NOTES = arr || []; NOTES_ON = true; if (cb) cb(); })
      .catch(function(){ NOTES_ON = false; if (cb) cb(); });
  }
  function post(path, body, cb){
    fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
      .then(function(x){ if (!x.ok) throw 0; loadNotes(cb || refreshAll); })
      .catch(function(){});
  }
  function doAdd(key){
    var sel=document.getElementById('nk-'+key); var inp=document.getElementById('nt-'+key); var dateinp=document.getElementById('nd-'+key);
    if (!inp) return; var text=inp.value.trim(); if (!text) return;
    var due=dateinp?dateinp.value:'';
    inp.value=''; if (dateinp) dateinp.value='';
    post('/__notes', { node: key==='__global'?null:key, kind: sel?sel.value:'remark', text: text, dueDate: due||undefined }, refreshAll);
  }
  function activateTab(which){
    var tabs = document.querySelectorAll('.tab');
    for (var i=0;i<tabs.length;i++){ var on=tabs[i].getAttribute('data-tab')===which; tabs[i].classList.toggle('active', on); }
    var a=document.getElementById('tab-arch'); var p=document.getElementById('tab-plan'); var o=document.getElementById('tab-overview');
    if (a) a.hidden = which!=='arch';
    if (p) p.hidden = which!=='plan';
    if (o) o.hidden = which!=='overview';
  }

  var deleteModal=null;
  var editModal=null;
  function showDeleteModal(noteId){
    deleteModal=noteId;
    var modal=document.getElementById('delete-modal');
    if (modal) modal.classList.remove('hidden');
  }
  function hideDeleteModal(){
    deleteModal=null;
    var modal=document.getElementById('delete-modal');
    if (modal) modal.classList.add('hidden');
  }
  function showEditModal(noteId){
    editModal=noteId;
    var note=null;
    for (var i=0;i<NOTES.length;i++){
      if (NOTES[i].id===noteId){ note=NOTES[i]; break; }
    }
    if (!note) return;
    document.getElementById('edit-text').value=note.text||'';
    document.getElementById('edit-kind').value=note.kind||'remark';
    document.getElementById('edit-date').value=note.dueDate||'';
    var modal=document.getElementById('edit-modal');
    if (modal) modal.classList.remove('hidden');
  }
  function hideEditModal(){
    editModal=null;
    var modal=document.getElementById('edit-modal');
    if (modal) modal.classList.add('hidden');
  }

  document.addEventListener('click', function(e){
    var noteDropdown=e.target && e.target.closest ? e.target.closest('.note-dropdown') : null;
    var cardDropdown=e.target && e.target.closest ? e.target.closest('.card-dropdown') : null;
    if (!noteDropdown && !e.target.closest('.note-menu-btn')){
      var allMenus=document.querySelectorAll('.note-dropdown');
      for (var m=0;m<allMenus.length;m++) allMenus[m].hidden=true;
    }
    if (!cardDropdown && !e.target.closest('.card-menu-btn')){
      var allCardMenus=document.querySelectorAll('.card-dropdown');
      for (var m=0;m<allCardMenus.length;m++) allCardMenus[m].hidden=true;
    }
    var tab = e.target && e.target.closest ? e.target.closest('.tab') : null;
    if (tab){ activateTab(tab.getAttribute('data-tab')); return; }
    var menuBtn=e.target && e.target.closest ? e.target.closest('.note-menu-btn') : null;
    if (menuBtn){
      var nid=menuBtn.getAttribute('data-id');
      var dd=document.getElementById('menu-'+nid);
      var allMenus=document.querySelectorAll('.note-dropdown');
      for (var m=0;m<allMenus.length;m++) allMenus[m].hidden=true;
      if (dd) dd.hidden=false;
      e.stopPropagation();
      return;
    }
    var cardMenuBtn=e.target && e.target.closest ? e.target.closest('.card-menu-btn') : null;
    if (cardMenuBtn){
      var cid=cardMenuBtn.getAttribute('data-id');
      var cdd=document.getElementById('card-menu-'+cid);
      var allCardMenus=document.querySelectorAll('.card-dropdown');
      for (var m=0;m<allCardMenus.length;m++) allCardMenus[m].hidden=true;
      if (cdd) cdd.hidden=false;
      e.stopPropagation();
      return;
    }
    var t = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t) return;
    var act = t.getAttribute('data-act');
    if (act==='add') doAdd(t.getAttribute('data-key'));
    else if (act==='move') post('/__notes/update', { id: t.getAttribute('data-id'), status: t.getAttribute('data-status') });
    else if (act==='del') post('/__notes/update', { id: t.getAttribute('data-id'), remove: true });
    else if (act==='filter'){ FILTER_NODE=t.getAttribute('data-filter')||'all'; renderBoard(); }
    else if (act==='sort'){ SORT_BY=t.getAttribute('data-sort')||'added'; renderBoard(); }
    else if (act==='filter-status'){
      activateTab('arch');
      var status=t.getAttribute('data-status');
      FILTER_STATUS=status;
      var allNodes=document.querySelectorAll('.arch-node');
      for (var k=0;k<allNodes.length;k++){
        var shown=allNodes[k].classList.contains(status);
        allNodes[k].style.opacity=shown?'1':'0.25';
        allNodes[k].style.pointerEvents=shown?'auto':'none';
      }
      var allLegs=document.querySelectorAll('.leg');
      for (var m=0;m<allLegs.length;m++){
        var isActive=allLegs[m].getAttribute('data-status')===status;
        allLegs[m].classList.toggle('active', isActive);
      }
    }
    else if (act==='reset-filter'){
      FILTER_STATUS=null;
      var allNodes=document.querySelectorAll('.arch-node');
      for (var k=0;k<allNodes.length;k++){
        allNodes[k].style.opacity='1';
        allNodes[k].style.pointerEvents='auto';
      }
      var allLegs=document.querySelectorAll('.leg');
      for (var m=0;m<allLegs.length;m++) allLegs[m].classList.remove('active');
    }
    else if (act==='copyclaude'){
      var txt=buildCopyPrompt();
      navigator.clipboard.writeText(txt)
        .then(function(){ t.textContent='✓ Copied!'; setTimeout(function(){ t.textContent='Copy for Claude'; },2500); })
        .catch(function(){ t.textContent='Failed — check clipboard permissions'; });
    }
    else if (act==='copy-node'){
      var nid=t.getAttribute('data-id');
      var previewEl=document.getElementById('prompt-preview-'+nid);
      if (previewEl){
        if (previewEl.classList.contains('hidden')){
          previewEl.classList.remove('hidden');
          t.textContent='Hide prompt';
        } else {
          previewEl.classList.add('hidden');
          t.textContent='Copy as prompt';
        }
      }
    }
    else if (act==='copy-preview'){
      var nid=t.getAttribute('data-id');
      var txt=buildNodeCopyPrompt(nid);
      navigator.clipboard.writeText(txt)
        .then(function(){ t.innerHTML='<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M4 9L6 11L12 5" stroke-linecap="round" stroke-linejoin="round"/></svg>'; setTimeout(function(){ t.innerHTML='<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect x="5.5" y="2.5" width="8" height="10" rx="1"/><path d="M3.5 5.5L3.5 14.5C3.5 15.05 3.95 15.5 4.5 15.5L11.5 15.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'; },2500); })
        .catch(function(){ });
    }
    else if (act==='hide-preview'){
      var nid=t.getAttribute('data-id');
      var previewEl=document.getElementById('prompt-preview-'+nid);
      var btnEl=document.querySelector('.copy-prompt-btn[data-id="'+nid+'"]');
      if (previewEl){
        previewEl.classList.add('hidden');
        if (btnEl) btnEl.textContent='Copy as prompt';
      }
    }
    else if (act==='note-edit'){
      var nid=t.getAttribute('data-id');
      var allMenus=document.querySelectorAll('.note-dropdown');
      for (var m=0;m<allMenus.length;m++) allMenus[m].hidden=true;
      showEditModal(nid);
    }
    else if (act==='note-delete'){
      var nid=t.getAttribute('data-id');
      var allMenus=document.querySelectorAll('.note-dropdown');
      for (var m=0;m<allMenus.length;m++) allMenus[m].hidden=true;
      showDeleteModal(nid);
    }
    else if (act==='card-edit'){
      var cid=t.getAttribute('data-id');
      var allCardMenus=document.querySelectorAll('.card-dropdown');
      for (var m=0;m<allCardMenus.length;m++) allCardMenus[m].hidden=true;
      showEditModal(cid);
    }
    else if (act==='card-delete'){
      var cid=t.getAttribute('data-id');
      var allCardMenus=document.querySelectorAll('.card-dropdown');
      for (var m=0;m<allCardMenus.length;m++) allCardMenus[m].hidden=true;
      showDeleteModal(cid);
    }
    else if (act==='modal-cancel'){
      hideDeleteModal();
    }
    else if (act==='modal-confirm-delete'){
      if (deleteModal) post('/__notes/update', { id: deleteModal, remove: true });
      hideDeleteModal();
    }
    else if (act==='modal-cancel-edit'){
      hideEditModal();
    }
    else if (act==='modal-save-edit'){
      if (editModal){
        var text=document.getElementById('edit-text').value.trim();
        if (!text){ alert('Note text is required'); return; }
        var kind=document.getElementById('edit-kind').value;
        var due=document.getElementById('edit-date').value;
        var patch={ id: editModal, text: text, kind: kind };
        if (due) patch.dueDate=due;
        post('/__notes/update', patch);
      }
      hideEditModal();
    }
    else if (act==='goto-planning'){
      var nid=t.getAttribute('data-id');
      activateTab('plan');
      var noteEl=document.querySelector('.note[data-id="'+nid+'"]');
      if (noteEl){
        var allNotes=document.querySelectorAll('.note');
        for (var k=0;k<allNotes.length;k++) allNotes[k].classList.remove('highlight');
        noteEl.classList.add('highlight');
        noteEl.scrollIntoView({behavior:'smooth',block:'center'});
      }
    }
    else if (act==='goto'){
      var nid=t.getAttribute('data-id'); activateTab('arch');
      var b=document.querySelector('.arch-node[data-id="'+nid+'"]');
      if (b){ var all=document.querySelectorAll('.arch-node'); for (var k=0;k<all.length;k++) all[k].classList.remove('sel'); b.classList.add('sel'); render(nid); b.scrollIntoView({behavior:'smooth',block:'center'}); }
    }
  });
  document.addEventListener('keydown', function(e){
    if (e.key!=='Enter' || !e.ctrlKey) return;
    var inp=e.target;
    if (inp && inp.getAttribute && inp.getAttribute('data-key')!=null) doAdd(inp.getAttribute('data-key'));
  });

  var nodes = document.querySelectorAll('.arch-node');
  for (var i=0;i<nodes.length;i++){
    (function (btn) {
      btn.addEventListener('click', function () {
        for (var j=0;j<nodes.length;j++) nodes[j].classList.remove('sel');
        btn.classList.add('sel');
        render(btn.getAttribute('data-id'));
      });
    })(nodes[i]);
  }

  loadNotes(function(){ renderBadges(); renderBoard(); renderOverview(); });
})();
`

/**
 * Inject a tiny live-reload poller before </body>. Used only by the watch server's
 * served response — the on-disk file stays clean for opening via file://. The client
 * polls /__rev; when the server's revision changes (a regenerate happened), it reloads.
 */
export function injectLiveReload(html, rev) {
  const script =
    '<script>(function(){var r=' + JSON.stringify(String(rev)) +
    ';setInterval(function(){fetch("/__rev",{cache:"no-store"}).then(function(x){return x.text()})' +
    '.then(function(t){if(t!==r)location.reload()}).catch(function(){})},1500);})();</script>'
  return html.includes('</body>') ? html.replace('</body>', script + '</body>') : html + script
}

function mdToHtml(md) {
  const lines = String(md || '').split('\n')
  const out = []
  let inPre = false, inList = false, inTable = false
  const inline = (s) => escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  const flush = () => {
    if (inList) { out.push('</ul>'); inList = false }
    if (inTable) { out.push('</table>'); inTable = false }
  }
  for (const raw of lines) {
    if (raw.startsWith('```')) { flush(); if (inPre) { out.push('</code></pre>'); inPre = false } else { out.push('<pre><code>'); inPre = true }; continue }
    if (inPre) { out.push(escapeHtml(raw) + '\n'); continue }
    if (raw.startsWith('|') && raw.includes('|', 1)) {
      if (/^\|[-| :]+\|$/.test(raw.trim())) continue
      if (!inTable) { flush(); out.push('<table class="ov-table">'); inTable = true }
      out.push('<tr>' + raw.split('|').slice(1, -1).map((c) => '<td>' + inline(c.trim()) + '</td>').join('') + '</tr>')
      continue
    }
    if (raw.startsWith('# ')) { flush(); out.push('<h2 class="ov-h2">' + inline(raw.slice(2)) + '</h2>'); continue }
    if (raw.startsWith('## ')) { flush(); out.push('<h3 class="ov-h3">' + inline(raw.slice(3)) + '</h3>'); continue }
    if (raw.startsWith('### ')) { flush(); out.push('<h4 class="ov-h4">' + inline(raw.slice(4)) + '</h4>'); continue }
    if (raw.startsWith('- ') || raw.startsWith('* ')) { if (inTable) { out.push('</table>'); inTable = false } if (!inList) { out.push('<ul class="ov-ul">'); inList = true } out.push('<li>' + inline(raw.slice(2)) + '</li>'); continue }
    if (raw.startsWith('> ')) { flush(); out.push('<blockquote class="ov-bq">' + inline(raw.slice(2)) + '</blockquote>'); continue }
    if (/^-{3,}$/.test(raw.trim())) { flush(); out.push('<hr class="ov-hr">'); continue }
    if (!raw.trim()) { flush(); continue }
    out.push('<p class="ov-p">' + inline(raw) + '</p>')
  }
  flush(); if (inPre) out.push('</code></pre>')
  return out.join('')
}

/** Render the full standalone HTML dashboard (opens directly in a browser). */
export function renderArchHtml(model) {
  const detailMap = {}
  for (const n of model.nodes) {
    detailMap[n.id] = {
      label: n.label,
      file: nodeDisplayFile(n),
      status: n.status,
      desc: n.desc || '',
      reasons: n.reasons || []
    }
  }
  const embed = {
    nodes: detailMap,
    statusLabel: STATUS_LABEL,
    sevColor: SEV_COLOR,
    counts: model.counts,
    projectName: model.projectName || 'Project'
  }

  let zonesHtml = ''
  for (const z of model.zones) {
    let nodesHtml = ''
    for (const n of z.nodes) {
      nodesHtml +=
        '<button class="arch-node ' + n.status + '" data-id="' + escapeHtml(n.id) + '">' +
        '<span class="n-name"><span class="n-dot"></span>' + escapeHtml(n.label) + '</span>' +
        '<span class="n-file">' + escapeHtml(nodeDisplayFile(n)) + '</span>' +
        '</button>'
    }
    zonesHtml +=
      '<section class="arch-zone"><div class="z-head">' + escapeHtml(z.label) +
      '<span>' + escapeHtml(z.sub || '') + '</span></div>' +
      '<div class="z-nodes">' + nodesHtml + '</div></section>'
    if (z.flowAfter) zonesHtml += '<div class="arch-flow">↓  ' + escapeHtml(z.flowAfter) + '</div>'
  }

  const c = model.counts
  const sh = model.scanHealth ?? null
  const summaryBlocking = sh != null ? sh.blocking : c.crit
  const summaryDebt     = sh != null ? sh.debt     : c.debt

  const summary =
    '<button class="reset-filter" data-act="reset-filter" title="Show all nodes">Reset filter</button>' +
    '<span class="leg" data-act="filter-status" data-status="ok" title="Show healthy nodes"><span class="dot ok"></span>Healthy <b>' + c.ok + '</b></span>' +
    '<span class="leg" data-act="filter-status" data-status="debt" title="Show components with tech debt"><span class="dot debt"></span>Tech debt <b>' + summaryDebt + '</b></span>' +
    '<span class="leg" data-act="filter-status" data-status="crit" title="Show blocking components"><span class="dot crit"></span>Blocking <b>' + summaryBlocking + '</b></span>' +
    '<span class="leg" data-act="filter-status" data-status="wip" title="Show in progress"><span class="dot wip"></span>In progress <b>' + c.wip + '</b></span>'

  const driftBanner = model.drift.length
    ? '<div class="drift"><b>Drift detected — the graph no longer matches the repo:</b><ul>' +
      model.drift.map((d) => '<li>' + escapeHtml(d) + '</li>').join('') +
      '</ul>Fix architecture.json (or restore the file), then re-run <code>npm run harness:map</code>.</div>'
    : ''

  const css =
    ':root{--bg:#fff;--bg2:#f7f6f2;--bd:#e3e1d9;--tx:#1c1c1a;--tx2:#5f5e5a;--tx3:#8a8980;' +
    "--mono:ui-monospace,SFMono-Regular,Menlo,monospace;--sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}" +
    '@media(prefers-color-scheme:dark){:root{--bg:#1a1a18;--bg2:#222220;--bd:#33332f;--tx:#ececea;--tx2:#a9a8a2;--tx3:#75746f}}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font-family:var(--sans);font-size:16px;line-height:1.6;padding:30px}' +
    '.wrap{max-width:1280px;margin:0 auto}h1{font-size:28px;font-weight:600;margin:0 0 6px}' +
    '.meta{color:var(--tx3);font-size:14px;font-family:var(--mono);margin-bottom:22px}' +
    '.summary{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:22px;font-size:16px;align-items:center}' +
    '.reset-filter{font:inherit;font-size:13px;background:none;border:1px solid var(--bd);border-radius:6px;color:var(--tx2);cursor:pointer;padding:4px 10px;margin-right:8px}' +
    '.reset-filter:hover{border-color:var(--tx3);color:var(--tx)}' +
    '.leg{display:flex;align-items:center;gap:9px;color:var(--tx2);cursor:pointer;padding:6px 10px;border-radius:6px;border:1px solid transparent;transition:all 150ms ease}' +
    '.leg:hover{color:var(--tx)}' +
    '.leg.active{color:var(--tx);background:rgba(255,255,255,0.06)}' +
    '.leg.active[data-status="ok"]{border-color:#0cff2c}' +
    '.leg.active[data-status="debt"]{border-color:#f5a117}' +
    '.leg.active[data-status="crit"]{border-color:#ff6c6c}' +
    '.leg.active[data-status="wip"]{border-color:#2f6fd0}' +
    '.leg b{color:var(--tx)}' +
    '.dot{width:12px;height:12px;border-radius:50%}.ok .n-dot,.dot.ok{background:#0cff2c}.debt .n-dot,.dot.debt{background:#f5a117}' +
    '.crit .n-dot,.dot.crit{background:#ff6c6c}.wip .n-dot,.dot.wip{background:#2f6fd0}.ext .n-dot{background:#8a8a84}' +
    '.arch-zone{border:1px solid var(--bd);border-radius:14px;padding:18px;margin-bottom:10px;background:var(--bg2)}' +
    '.z-head{font-size:18px;font-weight:600;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}' +
    '.z-head span{color:var(--tx3);font-weight:400;font-family:var(--mono);font-size:14px}' +
    '.z-nodes{display:flex;flex-wrap:wrap;gap:12px}' +
    '.arch-node{flex:1 1 230px;min-width:230px;text-align:left;border:1px solid var(--bd);border-left:4px solid var(--c,#8a8a84);' +
    'border-radius:11px;background:var(--bg);padding:14px 16px;cursor:pointer;display:flex;flex-direction:column;gap:7px;color:inherit;font:inherit}' +
    '.arch-node.ok{--c:#0cff2c}.arch-node.debt{--c:#f5a117}.arch-node.crit{--c:#ff6c6c}.arch-node.wip{--c:#2f6fd0}.arch-node.ext{--c:#8a8a84}' +
    '.arch-node:hover{border-color:var(--tx3)}.arch-node.sel{box-shadow:0 0 0 2px var(--c)}' +
    '.n-name{font-size:17px;font-weight:500;display:flex;align-items:center;gap:11px}' +
    '.n-dot{width:11px;height:11px;border-radius:50%;flex:none}.n-file{font-size:14px;color:var(--tx3);font-family:var(--mono);padding-left:22px;word-break:break-all}' +
    '.arch-flow{text-align:center;font-size:15px;color:var(--tx2);font-family:var(--mono);margin:6px 0 12px}' +
    '.layout{display:flex;gap:20px;align-items:flex-start}.arch-main{flex:1;min-width:0}' +
    '.arch-side{width:380px;flex:none;position:sticky;top:24px}' +
    '@media(max-width:920px){.layout{flex-direction:column}.arch-side{width:auto;position:static}}' +
    '.arch-detail{border:1px solid var(--bd);border-radius:14px;padding:20px 24px;background:var(--bg2);min-height:120px;font-size:16px}' +
    '.copy-prompt-btn{font:inherit;font-size:13px;padding:6px 12px;background:none;border:1px solid var(--bd);border-radius:7px;color:var(--tx2);cursor:pointer;width:100%;transition:all 150ms ease}' +
    '.copy-prompt-btn:hover{border-color:var(--tx3);color:var(--tx)}' +
    '.prompt-preview{margin-top:28px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);padding:12px;display:flex;flex-direction:column;gap:12px}' +
    '.prompt-preview.hidden{display:none}' +
    '.prompt-header{position:relative;display:flex}' +
    '.prompt-text{margin:0;padding:10px;background:var(--bg);border:1px solid var(--bd);border-radius:6px;font-family:var(--mono);font-size:12px;line-height:1.5;color:var(--tx2);flex:1;word-wrap:break-word;white-space:pre-wrap}' +
    '.copy-icon-btn{position:absolute;top:6px;right:6px;background:none;border:none;cursor:pointer;padding:4px;border-radius:4px;transition:all 150ms ease;display:flex;align-items:center;justify-content:center;width:28px;height:28px}' +
    '.copy-icon-btn:hover{background:var(--bd)}' +
    '.copy-icon-btn svg{width:16px;height:16px;stroke:var(--tx2);stroke-width:1.5;fill:none;transition:stroke 150ms ease}' +
    '.copy-icon-btn:hover svg{stroke:var(--tx)}' +
    '.hide-prompt-btn{align-self:flex-end;font:inherit;font-size:12px;padding:4px 12px;background:none;border:1px solid var(--bd);border-radius:6px;color:var(--tx2);cursor:pointer;transition:all 150ms ease}' +
    '.hide-prompt-btn:hover{border-color:var(--tx3);color:var(--tx)}' +
    '.d-head{display:flex;align-items:center;gap:13px;flex-wrap:wrap}.d-title{font-size:21px;font-weight:600}' +
    '.d-badge{font-size:14px;font-weight:500;padding:3px 13px;border-radius:999px;border:1px solid currentColor}' +
    '.d-badge.ok{color:#0cff2c}.d-badge.debt{color:#f5a117}.d-badge.crit{color:#ff6c6c}.d-badge.wip{color:#2f6fd0}.d-badge.ext{color:#8a8a84}' +
    '.d-file{font-family:var(--mono);font-size:14px;color:var(--tx3);margin:8px 0 12px;word-break:break-all}' +
    '.d-desc{font-size:17px}.d-iss{list-style:none;margin:14px 0 0;padding:0}' +
    '.d-iss li{display:flex;gap:11px;align-items:flex-start;font-size:16px;color:var(--tx2);margin:9px 0;line-height:1.5}' +
    '.d-tag{font-size:13px;font-weight:500;padding:2px 9px;border-radius:6px;border:1px solid;flex:none;margin-top:2px;text-transform:uppercase;letter-spacing:.02em}' +
    '.d-ok{color:#0cff2c;font-size:15px;margin-top:11px}' +
    '.drift{border:1px solid #ff6c6c;border-radius:12px;background:rgba(255,108,108,.1);color:var(--tx);padding:16px 18px;margin-bottom:22px;font-size:16px}' +
    '.drift ul{margin:8px 0}.drift code{font-family:var(--mono)}' +
    '.tabs{display:flex;gap:6px;border-bottom:1px solid var(--bd);margin-bottom:22px}' +
    '.tab{font:inherit;font-size:16px;font-weight:500;background:none;border:0;border-bottom:2px solid transparent;color:var(--tx2);padding:11px 16px;cursor:pointer;margin-bottom:-1px}' +
    '.tab:hover{color:var(--tx)}.tab.active{color:var(--tx);border-bottom-color:#378add}.tab-count{font-size:13px;color:var(--tx3);font-weight:400;margin-left:4px}' +
    '.tabpane[hidden]{display:none}' +
    '.board-head{font-size:18px;font-weight:600;margin-bottom:14px}.board-add{margin-bottom:18px}' +
    '.board{display:flex;flex-direction:column;gap:0}' +
    '.board-cols{display:flex;gap:16px;align-items:flex-start}' +
    '@media(max-width:820px){.board-cols{flex-direction:column}.col{width:100%}}' +
    '.col{flex:1;min-width:0;border:1px solid var(--bd);border-radius:14px;background:var(--bg2);padding:14px 16px}' +
    '.col-h{font-size:16px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:9px}.col-h .cnt{font-size:13px;color:var(--tx3);font-weight:400}' +
    '.col-dot{width:10px;height:10px;border-radius:50%;flex:none}.col.open .col-dot{background:var(--tx3)}.col.in_progress .col-dot{background:#2f6fd0}.col.done .col-dot{background:#0cff2c}' +
    '.card{border:1px solid var(--bd);border-left:3px solid var(--cc,var(--tx3));border-radius:10px;background:var(--bg);padding:11px 13px;margin-bottom:10px}' +
    '.card.in_progress{--cc:#2f6fd0}.card.done{--cc:#0cff2c}' +
    '.card-top{display:flex;align-items:center;gap:8px;margin-bottom:7px}' +
    '.card-kind{font-size:11px;padding:1px 7px;border-radius:5px;border:1px solid var(--tx3);color:var(--tx2);text-transform:uppercase;letter-spacing:.02em}' +
    '.card-kind.idea,.note-tag.idea{border-color:#2f6fd0;color:#2f6fd0}' +
    '.card-kind.todo,.note-tag.todo{border-color:#ff6c6c;color:#ff6c6c}' +
    '.card-kind.remark,.note-tag.remark{border-color:#f5a117;color:#f5a117}' +
    '.card-node{font-size:12px;color:var(--tx3);font-family:var(--mono);margin-left:auto}.card-node[data-act]{cursor:pointer}.card-node[data-act]:hover{color:#378add;text-decoration:underline}' +
    '.card-text{font-size:15px;word-break:break-word}.card.done .card-text{color:var(--tx2)}' +
    '.card-meta,.note-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:5px}' +
    '.card-date,.note-date{font-size:11px;color:var(--tx3)}' +
    '.due-badge{font-size:11px;padding:1px 7px;border-radius:5px;border:1px solid;font-weight:500;letter-spacing:.01em;white-space:nowrap}' +
    '.due-badge.overdue{color:#ff6c6c;border-color:#ff6c6c}' +
    '.due-badge.today{color:#f5a117;border-color:#f5a117}' +
    '.due-badge.soon{color:#f5a117;border-color:#f5a117;opacity:.8}' +
    '.due-badge.ok{color:var(--tx3);border-color:var(--tx3)}' +
    '.card-top{display:flex;align-items:center;gap:8px;margin-bottom:7px;justify-content:space-between}' +
    '.card-menu{position:relative;flex:none}' +
    '.card-menu-btn{font:inherit;font-size:20px;background:none;border:none;color:var(--tx2);cursor:pointer;padding:0 6px;line-height:1}' +
    '.card-menu-btn:hover{color:var(--tx)}' +
    '.card-dropdown{position:absolute;top:100%;right:0;background:var(--bg2);border:1px solid var(--bd);border-radius:6px;min-width:120px;z-index:1000;box-shadow:0 2px 8px rgba(0,0,0,0.15)}' +
    '.card-dropdown button{display:flex;align-items:center;gap:6px;width:100%;padding:8px 12px;background:none;border:none;color:var(--tx2);cursor:pointer;font:inherit;font-size:13px;text-align:left}' +
    '.card-dropdown button:hover{background:var(--bd);color:var(--tx)}' +
    '.card-dropdown button:first-child{border-radius:6px 6px 0 0}' +
    '.card-dropdown button:last-child{border-radius:0 0 6px 6px}' +
    '.card-ctrl{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}' +
    '.card-ctrl button{font:inherit;font-size:12px;background:none;border:1px solid var(--bd);border-radius:6px;color:var(--tx2);cursor:pointer;padding:2px 8px}.card-ctrl button:hover{border-color:var(--tx3)}' +
    '.notes-sec{margin-top:16px;border-top:1px solid var(--bd);padding-top:14px}' +
    '.notes-h{font-size:16px;font-weight:600;margin-bottom:10px}.notes-off{font-size:13px;font-weight:400;color:var(--tx3)}' +
    '.note{border:1px solid var(--bd);border-left:3px solid var(--nc,var(--tx3));border-radius:9px;background:var(--bg);padding:10px 12px;margin:8px 0}' +
    '.note.in_progress{--nc:#2f6fd0}.note.done{--nc:#0cff2c}' +
    '.note.highlight{box-shadow:0 0 0 2px #378add;background:rgba(55,138,221,.08)}' +
    '.note-row1{display:flex;align-items:center;gap:6px;margin-bottom:6px}' +
    '.note-tag{font-size:11px;padding:1px 7px;border-radius:5px;border:1px solid var(--tx3);color:var(--tx2);text-transform:uppercase;letter-spacing:.02em;flex:none}' +
    '.note-tag.idea{border-color:#2f6fd0;color:#2f6fd0}' +
    '.note-tag.todo{border-color:#ff6c6c;color:#ff6c6c}' +
    '.note-tag.remark{border-color:#f5a117;color:#f5a117}' +
    '.note-status-tag{font-size:11px;padding:1px 7px;border-radius:5px;border:1px solid var(--tx3);color:var(--tx3);text-transform:uppercase;letter-spacing:.02em;flex:none;cursor:pointer;transition:all 150ms ease}' +
    '.note-status-tag:hover{border-color:var(--tx2);color:var(--tx2)}' +
    '.note-x{font:inherit;font-size:12px;background:none;border:1px solid var(--bd);border-radius:6px;color:var(--tx3);cursor:pointer;padding:0 7px;flex:none;line-height:1.6}' +
    '.note-x:hover{border-color:#ff6c6c;color:#ff6c6c}' +
    '.note-text{font-size:14px;word-break:break-word;line-height:1.45;color:var(--tx)}' +
    '.note.done .note-text{text-decoration:line-through;color:var(--tx3)}' +
    '.note-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}' +
    '.note-actions button{font:inherit;font-size:12px;background:none;border:1px solid var(--bd);border-radius:6px;color:var(--tx2);cursor:pointer;padding:2px 8px}.note-actions button:hover{border-color:var(--tx3)}' +
    '.note-menu{position:relative;margin-left:auto;flex:none}' +
    '.note-menu-btn{font:inherit;font-size:20px;background:none;border:none;color:var(--tx2);cursor:pointer;padding:0 6px;line-height:1}' +
    '.note-menu-btn:hover{color:var(--tx)}' +
    '.note-dropdown{position:absolute;top:100%;right:0;background:var(--bg2);border:1px solid var(--bd);border-radius:6px;min-width:120px;z-index:1000;box-shadow:0 2px 8px rgba(0,0,0,0.15)}' +
    '.note-dropdown button{display:flex;align-items:center;gap:6px;width:100%;padding:8px 12px;background:none;border:none;color:var(--tx2);cursor:pointer;font:inherit;font-size:13px;text-align:left}' +
    '.note-dropdown button:hover{background:var(--bd);color:var(--tx)}' +
    '.note-dropdown button:first-child{border-radius:6px 6px 0 0}' +
    '.note-dropdown button:last-child{border-radius:0 0 6px 6px}' +
    '.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000}' +
    '.modal-overlay.hidden{display:none}' +
    '.modal-dialog{background:var(--bg2);border:1px solid var(--bd);border-radius:12px;padding:24px;max-width:400px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3)}' +
    '.modal-title{font-size:18px;font-weight:600;margin-bottom:12px;color:var(--tx)}' +
    '.modal-text{font-size:14px;color:var(--tx2);margin-bottom:20px;line-height:1.6}' +
    '.modal-actions{display:flex;gap:10px;justify-content:flex-end}' +
    '.modal-actions button{font:inherit;font-size:13px;padding:8px 16px;border:1px solid var(--bd);border-radius:7px;cursor:pointer;transition:all 150ms ease}' +
    '.modal-actions .modal-cancel{background:none;color:var(--tx2)}' +
    '.modal-actions .modal-cancel:hover{border-color:var(--tx3);color:var(--tx)}' +
    '.modal-actions .modal-confirm{background:#ff6c6c;color:#fff;border-color:#ff6c6c}' +
    '.modal-actions .modal-confirm:hover{background:#ff8888;border-color:#ff8888}' +
    '.modal-form{display:flex;flex-direction:column;gap:14px}' +
    '.modal-field{display:flex;flex-direction:column;gap:6px}' +
    '.modal-field label{font-size:13px;font-weight:500;color:var(--tx);text-transform:uppercase;letter-spacing:.03em}' +
    '.modal-field input, .modal-field select, .modal-field textarea{font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--bd);border-radius:7px;background:var(--bg);color:var(--tx);resize:vertical;min-height:64px}' +
    '.modal-field input:focus, .modal-field select:focus, .modal-field textarea:focus{outline:none;border-color:#378add}' +
    '.board-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--bd)}' +
    '.toolbar-left{display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1}' +
    '.toolbar-right{display:flex;align-items:center;gap:6px;flex-wrap:wrap}' +
    '.toolbar-label{font-size:11px;color:var(--tx3);font-weight:600;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}' +
    '.filter-btn,.sort-btn{font:inherit;font-size:12px;background:none;border:1px solid var(--bd);border-radius:999px;color:var(--tx2);cursor:pointer;padding:3px 11px}' +
    '.filter-btn:hover,.sort-btn:hover{border-color:var(--tx3);color:var(--tx)}' +
    '.filter-btn.active{border-color:#378add;color:#378add;background:rgba(55,138,221,.1)}' +
    '.sort-btn.active{border-color:#378add;color:#378add}' +
    '.copy-claude-btn{font:inherit;font-size:12px;background:none;border:1px solid var(--bd);border-radius:7px;color:var(--tx2);cursor:pointer;padding:4px 12px}' +
    '.copy-claude-btn:hover{border-color:#378add;color:#378add}' +
    '.note-add{display:flex;flex-direction:column;gap:8px;padding-bottom:16px;margin-bottom:4px;border-bottom:1px solid var(--bd)}' +
    '.note-add-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
    '.note-add select{font:inherit;font-size:13px;padding:5px 8px;border:1px solid var(--bd);border-radius:7px;background:var(--bg);color:var(--tx)}' +
    '.date-wrap{position:relative;display:inline-flex;align-items:center}' +
    '.date-icon{position:absolute;left:8px;pointer-events:none;font-size:13px;line-height:1}' +
    '.date-wrap input[type=date]{font:inherit;font-size:13px;padding:5px 8px 5px 28px;border:1px solid var(--bd);border-radius:7px;background:var(--bg);color:var(--tx)}' +
    '.note-add textarea{font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);color:var(--tx);resize:vertical;min-height:56px;line-height:1.45;width:100%}' +
    '.note-add textarea:focus{outline:none;border-color:#378add}' +
    '.note-add-actions{display:flex;justify-content:flex-end}' +
    '.note-add-actions button{font:inherit;font-size:14px;padding:6px 16px;border:1px solid #378add;border-radius:8px;background:none;color:var(--tx);cursor:pointer}' +
    '.note-add-actions button:hover{background:rgba(55,138,221,.12)}' +
    '.node-badge{margin-left:auto;font-size:13px;background:var(--bd);color:var(--tx2);border-radius:999px;padding:1px 9px;font-family:var(--sans)}' +
    'footer{margin-top:24px;color:var(--tx3);font-size:14px;font-family:var(--mono)}' +
    '.ov-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px}' +
    '@media(max-width:960px){.ov-grid{grid-template-columns:1fr 1fr}}' +
    '@media(max-width:600px){.ov-grid{grid-template-columns:1fr}}' +
    '.ov-onboarding{grid-column:1/-1}' +
    '.ov-card{border:1px solid var(--bd);border-radius:14px;padding:20px 24px;background:var(--bg2)}' +
    '.ov-card-h{font-size:16px;font-weight:600;margin-bottom:14px;color:var(--tx)}' +
    '.ov-health{display:grid;grid-template-columns:1fr 1fr;gap:16px}' +
    '.ov-stat{display:flex;flex-direction:column;align-items:center;gap:12px;cursor:pointer}' +
    '.ov-stat-circle{width:100px;height:100px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:42px;font-weight:700;line-height:1;border:2px solid}' +
    '.ov-stat.crit .ov-stat-circle{color:#ff6c6c;border-color:#ff6c6c}' +
    '.ov-stat.debt .ov-stat-circle{color:#f5a117;border-color:#f5a117}' +
    '.ov-stat.wip .ov-stat-circle{color:#2f6fd0;border-color:#2f6fd0}' +
    '.ov-stat.ok .ov-stat-circle{color:#0cff2c;border-color:#0cff2c}' +
    '.ov-stat-label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;font-weight:600}' +
    '.ov-stat.crit .ov-stat-label{color:#ff6c6c}' +
    '.ov-stat.debt .ov-stat-label{color:#f5a117}' +
    '.ov-stat.wip .ov-stat-label{color:#2f6fd0}' +
    '.ov-stat.ok .ov-stat-label{color:#0cff2c}' +
    '.ov-priorities{list-style:none;padding:0;margin:0}' +
    '.ov-priorities li{display:flex;align-items:flex-start;gap:10px;font-size:14px;color:var(--tx2);margin:8px 0;line-height:1.45}' +
    '.ov-note-list{list-style:none;padding:0;margin:10px 0 0}' +
    '.ov-note-list li{display:flex;align-items:flex-start;gap:7px;font-size:14px;color:var(--tx2);margin:7px 0;line-height:1.4}' +
    '.ov-h2{font-size:22px;font-weight:700;margin:28px 0 14px;color:var(--tx);border-bottom:2px solid var(--bd);padding-bottom:10px}' +
    '.ov-h3{font-size:18px;font-weight:600;margin:20px 0 10px;color:var(--tx)}' +
    '.ov-h4{font-size:16px;font-weight:600;margin:14px 0 8px;color:var(--tx)}' +
    '.ov-p{font-size:16px;color:var(--tx2);margin:12px 0;line-height:1.8}' +
    '.ov-ul{padding-left:24px;margin:14px 0 16px}' +
    '.ov-ul li{font-size:16px;color:var(--tx2);margin:8px 0;line-height:1.7}' +
    '.ov-bq{border-left:4px solid #378add;margin:16px 0;padding:12px 16px;color:var(--tx2);font-style:italic;background:rgba(55,138,221,.08);border-radius:6px}' +
    '.ov-hr{border:none;border-top:2px solid var(--bd);margin:24px 0}' +
    '.ov-table{border-collapse:collapse;width:100%;font-size:14px;margin:16px 0}' +
    '.ov-table td{border:1px solid var(--bd);padding:10px 12px;color:var(--tx2)}' +
    '.ov-onboarding pre{background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:14px 16px;overflow:visible;margin:16px 0;font-family:var(--mono);font-size:15px;line-height:1.7;white-space:pre-wrap;word-break:break-word;word-wrap:break-word}' +
    '.ov-onboarding code{font-family:var(--mono);font-size:13px;background:var(--bd);padding:2px 6px;border-radius:4px;color:var(--tx)}' +
    '.ov-onboarding pre code{background:none;padding:0;color:inherit}' +
    '.ov-onboarding a{color:#378add;text-decoration:none}' +
    '.ov-onboarding a:hover{text-decoration:underline}' +
    '.ov-onboarding .ov-card-h{font-size:48px;text-align:center;margin-bottom:28px}' +
    '.ov-onboarding{width:100%}'

  const topItems = (model.todoItems || []).filter((i) => !i.done && (i.priority === 'P0' || i.priority === 'P1'))
  const prioHtml = topItems.length
    ? '<ul class="ov-priorities">' + topItems.map((i) =>
        '<li><span class="d-tag" style="color:' + (i.priority === 'P0' ? '#ff6c6c' : '#f5a117') +
        ';border-color:' + (i.priority === 'P0' ? '#ff6c6c' : '#f5a117') + '">' +
        escapeHtml(i.priority) + '</span>' + escapeHtml(stripMd(i.text)) + '</li>'
      ).join('') + '</ul>'
    : '<div class="notes-off">No P0/P1 items open.</div>'

  const overviewHtml =
    '<div class="ov-grid">' +
    '<div class="ov-card"><div class="ov-card-h">Project health</div><div class="ov-health">' +
    '<div class="ov-stat crit" data-act="filter-status" data-status="crit" title="Show blocking components"><div class="ov-stat-circle">' + (sh != null ? sh.blocking : c.crit) + '</div><span class="ov-stat-label">Blocking</span></div>' +
    '<div class="ov-stat debt" data-act="filter-status" data-status="debt" title="Show tech debt"><div class="ov-stat-circle">' + (sh != null ? sh.debt : c.debt) + '</div><span class="ov-stat-label">Tech debt</span></div>' +
    '<div class="ov-stat wip" data-act="filter-status" data-status="wip" title="Show in progress"><div class="ov-stat-circle">' + c.wip + '</div><span class="ov-stat-label">In progress</span></div>' +
    '<div class="ov-stat ok" data-act="filter-status" data-status="ok" title="Show healthy"><div class="ov-stat-circle">' + c.ok + '</div><span class="ov-stat-label">Healthy</span></div>' +
    '</div></div>' +
    '<div class="ov-card"><div class="ov-card-h">Top priorities (P0 / P1)</div>' + prioHtml + '</div>' +
    '<div class="ov-card" id="ov-notes"><div class="ov-card-h">Planning notes</div><div class="notes-off">Loading…</div></div>' +
    '<div class="ov-card ov-onboarding"><div class="ov-card-h">Onboarding guide</div>' + mdToHtml(model.onboarding || '') + '</div>' +
    '</div>'

  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(model.projectName || 'Project') + ' — architecture &amp; health map</title><style>' + css + '</style></head><body><div class="wrap">' +
    '<h1>' + escapeHtml(model.projectName || 'Project') + ' — architecture &amp; health map</h1>' +
    '<div class="meta">generated ' + escapeHtml(model.generatedAt) + (model.scanHealth ? ' · health from source scan' : '') + ' · architecture from assertions.json + TODO.md</div>' +
    '<div class="tabs"><button class="tab active" data-tab="overview">Overview</button>' +
    '<button class="tab" data-tab="arch">Architecture &amp; health</button>' +
    '<button class="tab" data-tab="plan">Planning<span class="tab-count" id="plan-count"></span></button></div>' +
    '<div class="tabpane" id="tab-overview">' + overviewHtml + '</div>' +
    '<div class="tabpane" id="tab-arch" hidden>' +
    driftBanner +
    '<div class="summary">' + summary + '</div>' +
    '<div class="layout"><div class="arch-main">' + zonesHtml + '</div>' +
    '<aside class="arch-side"><div class="arch-detail" id="arch-detail">Select any component to see what it does and the live reasons behind its status. Red = a backing invariant failed or an open P0; amber = open P1/P2/P3; blue = in progress.</div></aside></div>' +
    '</div>' +
    '<div class="tabpane" id="tab-plan" hidden>' +
    '<div class="board-head">Planning notes, ideas &amp; backlog</div>' +
    '<div class="board-add" id="board-add"></div>' +
    '<div class="board" id="board"></div>' +
    '</div>' +
    '<footer>npm run harness:map — regenerate after any code/TODO change · npm run harness:map -- --strict fails CI on drift</footer>' +
    '<div class="modal-overlay hidden" id="delete-modal">' +
    '<div class="modal-dialog">' +
    '<div class="modal-title">Delete note?</div>' +
    '<div class="modal-text">This note will be permanently deleted. This action cannot be undone.</div>' +
    '<div class="modal-actions">' +
    '<button data-act="modal-cancel" class="modal-cancel">Cancel</button>' +
    '<button data-act="modal-confirm-delete" class="modal-confirm">Delete</button>' +
    '</div></div></div>' +
    '<div class="modal-overlay hidden" id="edit-modal">' +
    '<div class="modal-dialog">' +
    '<div class="modal-title">Edit note</div>' +
    '<div class="modal-form">' +
    '<div class="modal-field"><label>Note</label><textarea id="edit-text" placeholder="What is this note about?"></textarea></div>' +
    '<div class="modal-field"><label>Type</label><select id="edit-kind"><option value="remark">Remark</option><option value="todo">Todo</option><option value="idea">Idea</option></select></div>' +
    '<div class="modal-field"><label>Due date (optional)</label><input type="date" id="edit-date"></div>' +
    '</div>' +
    '<div class="modal-actions">' +
    '<button data-act="modal-cancel-edit" class="modal-cancel">Cancel</button>' +
    '<button data-act="modal-save-edit" class="modal-confirm" style="background:#378add;border-color:#378add">Save</button>' +
    '</div></div></div>' +
    '</div><script>window.__ARCH__=' + JSON.stringify(embed) + ';</script><script>' + BROWSER_JS + '</script></body></html>'
  )
}
