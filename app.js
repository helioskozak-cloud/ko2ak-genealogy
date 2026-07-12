// Ko2ak Genealogy -- app.js
// Dummy data for now (data/family.json), schema documented in
// FRESH_AGENT_PROMPT.md: persons/sources/businesses/parts, ahnentafel
// sourceTree+sourceKey trees cross-linked via EXTRA_EDGES.

var CLR = {
  vance:     { fill: '#dcfce7', stroke: '#15803d', text: '#14532d' },
  ashgrove:  { fill: '#f3e8ff', stroke: '#7e22ce', text: '#3b0764' },
  delacroix: { fill: '#e0f2fe', stroke: '#0369a1', text: '#0c4a6e' },
  harrow:    { fill: '#fce7f3', stroke: '#be185d', text: '#831843' },
  other:     { fill: '#f1f5f9', stroke: '#94a3b8', text: '#475569' },
  prob:      { fill: '#fef9c3', stroke: '#d97706', text: '#92400e' }
};
function nodeClr(p){ return p.prob ? CLR.prob : (CLR[p.branch] || CLR.other); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function trunc(s, n){ return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// EXTRA_EDGES: manually curated cross-links between the 4 otherwise-separate
// ahnentafel trees (mirrors the real site's pattern). Loaded from data.
var EXTRA_EDGES = [];

var PERSONS = {}, SOURCES = {}, BUSINESSES = {}, PARTS = {};
var NODES = [], EDGES = [], BY_ID = {};

function switchTab(id, btn){
  document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
  document.getElementById('tab-' + id).classList.add('active');
  btn.classList.add('active');
}

function datesOf(p){
  var note = p.note || '';
  var b = note.match(/(?:^|·)\s*b\.~?\s*([^·(—]+?)(?:\s*[·(—]|$)/i);
  var d = note.match(/(?:^|·)\s*d\.~?\s*([^·(—]+?)(?:\s*[·(—]|$)/i);
  var parts = [];
  if (b) parts.push('b.' + b[1].trim());
  if (d) parts.push('d.' + d[1].trim());
  if (parts.length) return parts.join(' · ');
  var born = null;
  (p.facts || []).forEach(function(f){ if (/^born$/i.test(f[0]) && !born) born = f[1]; });
  return born ? 'b.' + born : 'Dates not recorded';
}
function birthYearOf(p){
  var note = p.note || '';
  var m = note.match(/\bb\.?~?\s*([12]\d{3})/i);
  if (m) return +m[1];
  var y = null;
  (p.facts || []).forEach(function(f){ if (/^born$/i.test(f[0]) && !y) { var mm = String(f[1]).match(/[12]\d{3}/); if (mm) y = +mm[0]; } });
  return y;
}

function showDetailPanel(p){
  document.getElementById('panel-name').textContent = p.name;
  var srcs = Object.values(SOURCES).filter(function(s){ return (s.personRefs || []).indexOf(p.id) !== -1; });
  var biz = Object.values(BUSINESSES).filter(function(b){ return (b.personRefs || []).indexOf(p.id) !== -1; });
  var oq = p.openQuestions || [];
  var html = '<div class="panel-row"><span class="panel-lbl">Dates</span><br>' + esc(datesOf(p)) + '</div>'
    + '<div class="panel-row"><span class="panel-lbl">Note</span><br>' + esc(p.note || '—') + '</div>';
  if (srcs.length) html += '<div class="panel-row"><span class="panel-lbl">Sources (' + srcs.length + ')</span><br>' + srcs.map(function(s){ return esc(s.num + ': ' + s.clue); }).join('<br>') + '</div>';
  if (biz.length) html += '<div class="panel-row"><span class="panel-lbl">Business &amp; Property</span><br>' + biz.map(function(b){ return esc(b.name); }).join('<br>') + '</div>';
  if (oq.length) html += '<div class="panel-row"><span class="panel-lbl">Open Questions</span><br>' + oq.map(function(q){ return esc(q.text); }).join('<br>') + '</div>';
  document.getElementById('panel-body').innerHTML = html;
  document.getElementById('panel').style.display = 'block';
}

// ── computeGenerations: union-find over spouse edges, condense parent-child
// edges onto groups, cycle-break safety net, Kahn's-algorithm longest-path
// layering. Verbatim port of the version independently verified correct
// against real data in the prior kozak-genealogy project -- this math was
// never the problem there, only its rendering was.
function computeGenerations(nodes, edges){
  var spouseEdges = edges.filter(function(e){ return e.type === 'spouse'; });
  var parentChildEdges = edges.filter(function(e){ return e.type === 'parent-child'; });
  function runUnionFind(skipSet){
    var parent = {}, rank = {};
    nodes.forEach(function(n){ parent[n.id] = n.id; rank[n.id] = 0; });
    function find(x){ while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b){
      var ra = find(a), rb = find(b);
      if (ra === rb) return false;
      if (rank[ra] < rank[rb]) { var t = ra; ra = rb; rb = t; }
      parent[rb] = ra;
      if (rank[ra] === rank[rb]) rank[ra]++;
      return true;
    }
    var merges = [];
    spouseEdges.forEach(function(e, i){
      if (skipSet[i]) return;
      if (union(e.source, e.target)) merges.push({ idx: i, a: e.source, b: e.target });
    });
    return { find: find, merges: merges };
  }
  function buildCondensed(find){
    var seen = {}, condensed = [];
    parentChildEdges.forEach(function(e){
      var from = find(e.source), to = find(e.target);
      if (from === to) return;
      var key = from + '|' + to;
      if (seen[key]) return;
      seen[key] = true;
      condensed.push({ from: from, to: to });
    });
    return condensed;
  }
  function layerCondensed(condensed, allGroupIds){
    var outAdj = {}, inDegree = {}, touched = {};
    allGroupIds.forEach(function(g){ outAdj[g] = []; inDegree[g] = 0; });
    condensed.forEach(function(e){ outAdj[e.from].push(e.to); inDegree[e.to]++; touched[e.from] = true; touched[e.to] = true; });
    var remaining = {};
    Object.keys(touched).forEach(function(g){ remaining[g] = inDegree[g]; });
    var queue = Object.keys(touched).filter(function(g){ return remaining[g] === 0; });
    var gen = {};
    queue.forEach(function(g){ gen[g] = 0; });
    var processed = 0;
    for (var qi = 0; qi < queue.length; qi++) {
      var u = queue[qi]; processed++;
      outAdj[u].forEach(function(v){
        gen[v] = Math.max(gen[v] === undefined ? 0 : gen[v], gen[u] + 1);
        remaining[v]--;
        if (remaining[v] === 0) queue.push(v);
      });
    }
    var touchedIds = Object.keys(touched);
    var hasCycle = processed < touchedIds.length;
    var cycleGroups = hasCycle ? touchedIds.filter(function(g){ return remaining[g] > 0; }) : [];
    return { gen: gen, touched: touched, hasCycle: hasCycle, cycleGroups: cycleGroups };
  }
  function distinctGroupIds(find){
    var seen = {}, ids = [];
    nodes.forEach(function(n){ var g = find(n.id); if (!seen[g]) { seen[g] = true; ids.push(g); } });
    return ids;
  }
  var skipSet = {};
  var uf = runUnionFind(skipSet);
  var groupIds = distinctGroupIds(uf.find);
  var condensed = buildCondensed(uf.find);
  var result = layerCondensed(condensed, groupIds);
  var attempts = 0, maxAttempts = spouseEdges.length + 1;
  while (result.hasCycle && attempts < maxAttempts) {
    attempts++;
    var candidates = uf.merges.filter(function(m){
      var ga = uf.find(m.a), gb = uf.find(m.b);
      return result.cycleGroups.indexOf(ga) !== -1 || result.cycleGroups.indexOf(gb) !== -1;
    });
    var fixed = false;
    for (var i = 0; i < candidates.length; i++) {
      var trialSkip = {};
      Object.keys(skipSet).forEach(function(k){ trialSkip[k] = true; });
      trialSkip[candidates[i].idx] = true;
      var trialUf = runUnionFind(trialSkip);
      var trialGroupIds = distinctGroupIds(trialUf.find);
      var trialCondensed = buildCondensed(trialUf.find);
      var trialResult = layerCondensed(trialCondensed, trialGroupIds);
      if (!trialResult.hasCycle) {
        skipSet[candidates[i].idx] = true;
        uf = trialUf; groupIds = trialGroupIds; condensed = trialCondensed; result = trialResult;
        fixed = true; break;
      }
    }
    if (!fixed) break;
  }
  var generations = {};
  nodes.forEach(function(n){
    var g = uf.find(n.id);
    generations[n.id] = result.touched[g] ? result.gen[g] : null;
  });
  return { generations: generations };
}

// ── Layout: one row per generation, spouse pairs grouped adjacent within a
// row (small per-row union-find), fixed real pixel positions -- no
// scale-to-fit step of any kind. The canvas is exactly as large as the
// content needs; zoom/pan (below) is how the user controls what they see,
// not an automatic shrink.
var CARD_W = 170, CARD_H = 46, COL_GAP = 24, ROW_H = 110, ROW_LABEL_W = 90;
var positions = {}, canvasW = 0, canvasH = 0;

function computeLayout(){
  var genResult = computeGenerations(NODES, EDGES);
  var rows = {}, maxGen = -1;
  NODES.forEach(function(n){
    var g = genResult.generations[n.id];
    if (g === null || g === undefined) return;
    maxGen = Math.max(maxGen, g);
    (rows[g] = rows[g] || []).push(n.id);
  });
  function unitsForRow(ids){
    var idSet = {}; ids.forEach(function(id){ idSet[id] = true; });
    var parent = {}; ids.forEach(function(id){ parent[id] = id; });
    function find(x){ while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b){ var ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; }
    EDGES.forEach(function(e){ if (e.type === 'spouse' && idSet[e.source] && idSet[e.target]) union(e.source, e.target); });
    var groups = {};
    ids.forEach(function(id){ var r = find(id); (groups[r] = groups[r] || []).push(id); });
    return Object.keys(groups).map(function(r){ return groups[r]; });
  }
  function unitMinYear(u){ var ys = u.map(function(id){ var y = birthYearOf(BY_ID[id]); return y || 9999; }); return Math.min.apply(null, ys); }

  // Target a roughly-square canvas overall (not one very long horizontal
  // strip per generation) so zoom-to-fit's width- and height-constrained
  // scales land close together -- if one row can be 5000px wide while the
  // canvas is only 500px tall, "fit" is forced to shrink to the width
  // constraint and leaves the whole bottom of the viewport empty, which
  // *looks* exactly like the old bug even though the math is different.
  // Wrapping each generation onto multiple sub-lines once it exceeds a
  // target width keeps the aspect ratio sane.
  var TARGET_ROW_W = 1500;
  positions = {};
  var maxRowWidth = 0;
  var y = 0;
  var genRowY = {};
  for (var g = 0; g <= maxGen; g++) {
    var ids = rows[g];
    if (!ids || !ids.length) continue;
    genRowY[g] = y;
    var units = unitsForRow(ids).sort(function(u1, u2){ return unitMinYear(u1) - unitMinYear(u2); });
    var x = 0, subline = 0;
    units.forEach(function(u){
      var unitW = u.length * (CARD_W + 8);
      if (x > 0 && x + unitW > TARGET_ROW_W) { x = 0; subline++; }
      u.forEach(function(id){
        positions[id] = { x: x, y: y + subline * (CARD_H + 10), gen: g };
        x += CARD_W + 8;
      });
      x += COL_GAP - 8;
      maxRowWidth = Math.max(maxRowWidth, x);
    });
    y += (subline + 1) * (CARD_H + 10) + (ROW_H - CARD_H - 10);
  }
  canvasW = maxRowWidth + 40;
  canvasH = y + 40;

  // Unconnected people: a grid below the generation rows, same canvas.
  var orphans = NODES.filter(function(n){ return genResult.generations[n.id] === null || genResult.generations[n.id] === undefined; });
  var orphanY = canvasH + 50;
  var perRow = Math.max(1, Math.floor((maxRowWidth || 900) / (CARD_W + 12)));
  orphans.forEach(function(n, i){
    positions[n.id] = { x: (i % perRow) * (CARD_W + 12), y: orphanY + Math.floor(i / perRow) * (CARD_H + 14), gen: null };
  });
  if (orphans.length) canvasH = orphanY + Math.ceil(orphans.length / perRow) * (CARD_H + 14) + 30;

  return { maxGen: maxGen, orphanCount: orphans.length, orphanY: orphanY, genRowY: genRowY };
}

function cardHtml(id){
  var p = BY_ID[id];
  var pos = positions[id];
  if (!p || !pos) return '';
  var clr = nodeClr(p);
  var style = p.prob ? 'dashed' : 'solid';
  return '<div class="card" style="left:' + pos.x + 'px;top:' + pos.y + 'px;background:' + clr.fill + ';border:1.6px ' + style + ' ' + clr.stroke + '" onclick="showDetailPanel(BY_ID[\'' + id.replace(/'/g, "\\'") + '\'])">'
    + '<div class="card-name" style="color:' + clr.text + '">' + esc(trunc(p.name, 26)) + '</div>'
    + '<div class="card-dates" style="color:' + clr.text + '">' + esc(datesOf(p)) + '</div>'
    + '</div>';
}

function renderTreeCanvas(){
  var layoutInfo = computeLayout();
  var html = '';
  for (var g = 0; g <= layoutInfo.maxGen; g++) {
    if (layoutInfo.genRowY[g] === undefined) continue;
    html += '<div class="gen-label" style="left:-' + (ROW_LABEL_W) + 'px;top:' + (layoutInfo.genRowY[g] + 14) + 'px;width:' + (ROW_LABEL_W - 10) + 'px;text-align:right">Gen ' + g + '</div>';
  }
  if (layoutInfo.orphanCount) {
    html += '<div class="gen-label" style="left:0;top:' + (layoutInfo.orphanY - 22) + 'px">Not yet connected (' + layoutInfo.orphanCount + ')</div>';
  }
  NODES.forEach(function(n){ html += cardHtml(n.id); });
  var content = document.getElementById('zoom-content');
  content.style.width = canvasW + 'px';
  content.style.height = canvasH + 'px';
  content.innerHTML = html;
  zoomToFit();
}

// ── Pan/zoom: real interactive control, not an automatic one-time
// scale-to-fit. zoomToFit computes an initial transform from the ACTUAL
// content size and ACTUAL viewport size (never a hardcoded pixel target --
// that hardcoded-200px-height bug is what broke every visualization
// attempt in the prior project). From there the user can zoom/pan freely;
// nothing re-shrinks content automatically after that.
var zoomState = { x: 40 + ROW_LABEL_W, y: 30, scale: 1 };
function applyZoom(){
  document.getElementById('zoom-content').style.transform =
    'translate(' + zoomState.x + 'px,' + zoomState.y + 'px) scale(' + zoomState.scale + ')';
}
function zoomToFit(){
  var vp = document.getElementById('zoom-viewport');
  var vw = vp.clientWidth - 2 * (40 + ROW_LABEL_W), vh = vp.clientHeight - 60;
  var s = Math.min(vw / Math.max(canvasW, 1), vh / Math.max(canvasH, 1), 1.3);
  s = Math.max(s, 0.05);
  zoomState.scale = s;
  zoomState.x = (vp.clientWidth - canvasW * s) / 2 + ROW_LABEL_W * s;
  zoomState.y = 20;
  applyZoom();
}
function zoomBy(factor, cx, cy){
  var vp = document.getElementById('zoom-viewport');
  if (cx === undefined) { cx = vp.clientWidth / 2; cy = vp.clientHeight / 2; }
  var newScale = Math.min(Math.max(zoomState.scale * factor, 0.05), 6);
  var ratio = newScale / zoomState.scale;
  zoomState.x = cx - (cx - zoomState.x) * ratio;
  zoomState.y = cy - (cy - zoomState.y) * ratio;
  zoomState.scale = newScale;
  applyZoom();
}
function initPanZoom(){
  var vp = document.getElementById('zoom-viewport');
  vp.addEventListener('wheel', function(e){
    e.preventDefault();
    var rect = vp.getBoundingClientRect();
    var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomBy(factor, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
  var dragging = false, lastX, lastY;
  vp.addEventListener('mousedown', function(e){ dragging = true; lastX = e.clientX; lastY = e.clientY; vp.classList.add('dragging'); });
  window.addEventListener('mousemove', function(e){
    if (!dragging) return;
    zoomState.x += e.clientX - lastX; zoomState.y += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    applyZoom();
  });
  window.addEventListener('mouseup', function(){ dragging = false; vp.classList.remove('dragging'); });
  // touch: one-finger pan, two-finger pinch zoom
  var touchState = null;
  vp.addEventListener('touchstart', function(e){
    if (e.touches.length === 1) touchState = { mode: 'pan', x: e.touches[0].clientX, y: e.touches[0].clientY };
    else if (e.touches.length === 2) touchState = { mode: 'pinch', d: touchDist(e.touches) };
  }, { passive: true });
  vp.addEventListener('touchmove', function(e){
    if (!touchState) return;
    var rect = vp.getBoundingClientRect();
    if (touchState.mode === 'pan' && e.touches.length === 1) {
      zoomState.x += e.touches[0].clientX - touchState.x; zoomState.y += e.touches[0].clientY - touchState.y;
      touchState.x = e.touches[0].clientX; touchState.y = e.touches[0].clientY;
      applyZoom();
    } else if (touchState.mode === 'pinch' && e.touches.length === 2) {
      var d = touchDist(e.touches);
      var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      zoomBy(d / touchState.d, cx, cy);
      touchState.d = d;
    }
    e.preventDefault();
  }, { passive: false });
  vp.addEventListener('touchend', function(){ touchState = null; });
  function touchDist(t){ return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
}

function treeSearch(){
  var q = (document.getElementById('tree-search').value || '').trim().toLowerCase();
  var msg = document.getElementById('tree-search-msg');
  if (!q) { msg.textContent = ''; return; }
  var match = NODES.find(function(n){ return n.name.toLowerCase().indexOf(q) !== -1; });
  if (!match) { msg.textContent = 'No match for "' + q + '".'; return; }
  var pos = positions[match.id];
  if (!pos) { msg.textContent = match.name + ' has no position (unexpected).'; return; }
  var vp = document.getElementById('zoom-viewport');
  zoomState.scale = 1;
  zoomState.x = vp.clientWidth / 2 - (pos.x + CARD_W / 2);
  zoomState.y = vp.clientHeight / 2 - (pos.y + CARD_H / 2);
  applyZoom();
  msg.textContent = 'Jumped to ' + match.name + '.';
}

// ── People table ──
var peopleSortKey = 'name', peopleSortDir = 1;
var PEOPLE_COLS = [
  { key: 'name', label: 'Name', get: function(p){ return p.name; } },
  { key: 'branch', label: 'Branch', get: function(p){ return p.branch; } },
  { key: 'year', label: 'Dates', get: function(p){ return birthYearOf(p) || 9999; }, display: function(p){ return datesOf(p); } },
  { key: 'status', label: 'Status', get: function(p){ return p.prob ? 1 : 0; } }
];
function peopleSortBy(key){
  if (peopleSortKey === key) peopleSortDir *= -1; else { peopleSortKey = key; peopleSortDir = 1; }
  renderPeopleTable();
}
function renderPeopleTable(){
  var filter = (document.getElementById('people-filter').value || '').toLowerCase();
  var rows = NODES.filter(function(n){ return n.name.toLowerCase().indexOf(filter) !== -1; });
  var col = PEOPLE_COLS.filter(function(c){ return c.key === peopleSortKey; })[0];
  rows.sort(function(a, b){
    var va = col.get(BY_ID[a.id]), vb = col.get(BY_ID[b.id]);
    var cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return cmp * peopleSortDir;
  });
  var thead = document.querySelector('#people-table thead');
  var tbody = document.querySelector('#people-table tbody');
  thead.innerHTML = '<tr>' + PEOPLE_COLS.map(function(c){
    var arrow = peopleSortKey === c.key ? (peopleSortDir === 1 ? ' ▲' : ' ▼') : '';
    return '<th onclick="peopleSortBy(\'' + c.key + '\')">' + esc(c.label) + arrow + '</th>';
  }).join('') + '</tr>';
  tbody.innerHTML = rows.map(function(n){
    var p = BY_ID[n.id];
    return '<tr onclick="showDetailPanel(BY_ID[\'' + n.id.replace(/'/g, "\\'") + '\'])" style="cursor:pointer">'
      + '<td>' + esc(p.name) + '</td><td>' + esc(p.branch) + '</td><td>' + esc(datesOf(p)) + '</td>'
      + '<td>' + (p.prob ? '<span class="badge" style="background:#fef9c3;color:#92400e">Probable</span>' : '<span class="badge" style="background:#dcfce7;color:#15803d">Confirmed</span>') + '</td></tr>';
  }).join('');
}

// ── Research Log / Sources / Open Questions / Business ──
function renderResearchLog(){
  var items = Object.values(PARTS).sort(function(a, b){ return b.number - a.number; });
  document.getElementById('research-list').innerHTML = items.map(function(p){
    return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:8px">'
      + '<div style="font-weight:700;font-size:.85rem">Part ' + p.number + ': ' + esc(p.title) + '</div>'
      + '<div style="color:#94a3b8;font-size:.7rem;margin:3px 0">' + esc(p.date) + '</div>'
      + '<div style="font-size:.78rem;color:#334155">' + esc(p.summary) + '</div></div>';
  }).join('');
}
function renderSourcesTable(){
  var rows = Object.values(SOURCES);
  document.querySelector('#sources-table thead').innerHTML = '<tr><th>#</th><th>Person</th><th>Clue</th><th>Confidence</th><th>Date</th></tr>';
  document.querySelector('#sources-table tbody').innerHTML = rows.map(function(s){
    return '<tr><td>' + esc(s.num) + '</td><td>' + esc(s.person) + '</td><td>' + esc(s.clue) + '</td><td>' + esc(s.confidence) + '</td><td>' + esc(s.date) + '</td></tr>';
  }).join('');
}
function renderOpenQuestions(){
  var items = [];
  NODES.forEach(function(n){ (BY_ID[n.id].openQuestions || []).forEach(function(q){ items.push({ person: n.name, text: q.text }); }); });
  document.getElementById('openq-list').innerHTML = items.map(function(q){
    return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:6px;font-size:.8rem"><strong>' + esc(q.person) + ':</strong> ' + esc(q.text) + '</div>';
  }).join('') || '<div style="color:#94a3b8">No open questions.</div>';
}
function renderBusiness(){
  document.getElementById('business-list').innerHTML = Object.values(BUSINESSES).map(function(b){
    return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:8px">'
      + '<div style="font-weight:700">' + esc(b.name) + '</div>'
      + '<div style="font-size:.75rem;color:#94a3b8;margin:3px 0">' + esc(b.status) + '</div>'
      + '<div style="font-size:.78rem">' + esc(b.leadText) + '</div></div>';
  }).join('');
}

// ── Load data, build edges (ahnentafel + EXTRA_EDGES), boot ──
fetch('data/family.json').then(function(r){ return r.json(); }).then(function(data){
  PERSONS = data.persons; SOURCES = data.sources || {}; BUSINESSES = data.businesses || {}; PARTS = data.parts || {};
  EXTRA_EDGES = data._extraEdges || [];
  NODES = Object.keys(PERSONS).map(function(id){ var p = PERSONS[id]; return { id: id, name: p.name }; });
  BY_ID = PERSONS;

  EDGES = [];
  function addEdge(s, t, type, prob){ if (!BY_ID[s] || !BY_ID[t]) return; EDGES.push({ source: s, target: t, type: type, prob: !!prob }); }
  var byTree = {};
  Object.keys(PERSONS).forEach(function(id){
    var p = PERSONS[id];
    if (p.kind !== 'persons' || typeof p.sourceKey !== 'number') return;
    byTree[p.sourceTree] = byTree[p.sourceTree] || {};
    byTree[p.sourceTree][p.sourceKey] = id;
  });
  Object.keys(byTree).forEach(function(tree){
    var slots = byTree[tree];
    Object.keys(slots).forEach(function(ks){
      var k = +ks, childId = slots[k], fatherK = 2 * k, motherK = 2 * k + 1;
      if (slots[fatherK]) addEdge(slots[fatherK], childId, 'parent-child');
      if (slots[motherK]) addEdge(slots[motherK], childId, 'parent-child');
      if (slots[fatherK] && slots[motherK]) addEdge(slots[fatherK], slots[motherK], 'spouse');
    });
  });
  Object.keys(PERSONS).forEach(function(id){
    var p = PERSONS[id];
    if (p.kind !== 'childGroup' || !p.childGroupInfo) return;
    var parentId = byTree[p.sourceTree] && byTree[p.sourceTree][p.childGroupInfo.parentKey];
    if (parentId) addEdge(parentId, id, 'parent-child');
  });
  EXTRA_EDGES.forEach(function(e){ addEdge(e[0], e[1], e[2], e[3]); });

  document.getElementById('tree-status').textContent = NODES.length + ' people · ' + EDGES.length + ' relationships. Scroll to zoom, drag to pan.';

  renderTreeCanvas();
  renderPeopleTable();
  renderResearchLog();
  renderSourcesTable();
  renderOpenQuestions();
  renderBusiness();
  initPanZoom();
  window.addEventListener('resize', zoomToFit);
}).catch(function(err){
  document.getElementById('tree-status').textContent = 'Failed to load data/family.json: ' + err;
});
