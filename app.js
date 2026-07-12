// Ko2ak Genealogy -- app.js
// Real family data (data/family.json), built generation-by-generation from
// Grant John Kozak. Schema documented in FRESH_AGENT_PROMPT.md:
// persons/sources/businesses/parts, ahnentafel sourceTree+sourceKey trees
// cross-linked via _extraEdges.

var CLR = {
  kozak:   { fill: '#dcfce7', stroke: '#15803d', text: '#14532d' },
  relihan: { fill: '#f3e8ff', stroke: '#7e22ce', text: '#3b0764' },
  shomsky: { fill: '#e0f2fe', stroke: '#0369a1', text: '#0c4a6e' },
  other:   { fill: '#f1f5f9', stroke: '#94a3b8', text: '#475569' },
  prob:    { fill: '#fef9c3', stroke: '#d97706', text: '#92400e' }
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

// Row grouping is by birth-YEAR ERA, not lineage-depth generation number.
// A prior version (and every attempt in the previous kozak-genealogy
// project) grouped rows by topological hop-count from the earliest known
// ancestor -- mathematically well-defined, but NOT the same thing as age.
// Two lineages with different average generation lengths, once linked by a
// marriage or a cross-branch parent/child record, can land in the "same
// generation" by hop-count while being decades or a century apart in real
// birth year -- confirmed concretely in this dummy data (a parent/child
// link between two invented people born ~1837 and ~1947) and previously in
// the real family data too (the Peter George McGivney / Helen R. Relihan
// case that started this whole project). Bucketing by real birth-year era
// instead means "same row" always means "same age," full stop -- and any
// unusual generational gap between linked people becomes visible as a
// long connector line spanning several rows (see renderTreeCanvas's edge
// drawing), which is honest, not a same-row grouping that quietly implies
// two people are peers when their real ages say otherwise.
var ERA_SPAN = 20; // years per row
// Real genealogical sources (obituaries especially) very often name a
// relative without giving their birth year -- "survived by his son Mark"
// carries no date. Bucketing strictly by known birth year, as a first
// version of this did, left most of a real 29-person tree with recorded
// relationships dumped into one undifferentiated "unknown era" pile: a
// different failure mode than the original hop-count bug, but the same
// practical result (the shape of the family isn't visible). Fix: estimate
// a position-only year for anyone connected to at least one dated relative
// by propagating outward (spouse = same year; parent/child = +/-28 years),
// repeating until stable so it flows through undated chains too. This
// value is NEVER shown as a fact -- cardHtml still calls datesOf(), which
// only ever displays a real recorded date or "Dates not recorded" -- it
// only decides which row an undated card lands in, so the family's real
// shape is visible even where the underlying sources are thin.
function estimateYears(connected){
  var yearOf = {};
  connected.forEach(function(n){ var y = birthYearOf(BY_ID[n.id]); if (y) yearOf[n.id] = y; });
  var changed = true, guard = 0;
  while (changed && guard < 20) {
    changed = false; guard++;
    EDGES.forEach(function(e){
      var hasS = yearOf[e.source] !== undefined, hasT = yearOf[e.target] !== undefined;
      if (hasS && !hasT) {
        yearOf[e.target] = e.type === 'spouse' ? yearOf[e.source] : yearOf[e.source] + 28;
        changed = true;
      } else if (hasT && !hasS) {
        yearOf[e.source] = e.type === 'spouse' ? yearOf[e.target] : yearOf[e.target] - 28;
        changed = true;
      }
    });
  }
  return yearOf;
}

function computeLayout(){
  var hasEdge = {};
  EDGES.forEach(function(e){ hasEdge[e.source] = true; hasEdge[e.target] = true; });
  var connected = NODES.filter(function(n){ return hasEdge[n.id]; });
  var yearOf = estimateYears(connected);
  var dated = connected.map(function(n){ return yearOf[n.id]; }).filter(function(y){ return !!y; });
  var minEra = dated.length ? Math.floor(Math.min.apply(null, dated) / ERA_SPAN) * ERA_SPAN : 0;
  var maxEra = dated.length ? Math.floor(Math.max.apply(null, dated) / ERA_SPAN) * ERA_SPAN : 0;

  var rows = {}; // era start year (or 'unknown') -> [ids]
  connected.forEach(function(n){
    var y = yearOf[n.id];
    var era = y ? Math.floor(y / ERA_SPAN) * ERA_SPAN : 'unknown';
    (rows[era] = rows[era] || []).push(n.id);
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
  function unitMinYear(u){ var ys = u.map(function(id){ return yearOf[id] || 9999; }); return Math.min.apply(null, ys); }

  // Target a roughly-square canvas overall so zoom-to-fit's width- and
  // height-constrained scales land close together (see prior commit for
  // why: a canvas far wider than it is tall forces "fit" to the width
  // constraint and leaves the bottom of the viewport empty).
  var TARGET_ROW_W = 1500;
  positions = {};
  var maxRowWidth = 0;
  var y = 0;
  var eraRowY = {}; // era key -> pixel y
  var eraKeys = [];
  for (var e = minEra; e <= maxEra; e += ERA_SPAN) eraKeys.push(e);
  if (rows['unknown']) eraKeys.push('unknown');

  eraKeys.forEach(function(eraKey){
    var ids = rows[eraKey];
    if (!ids || !ids.length) { if (eraKey !== 'unknown') { eraRowY[eraKey] = null; } return; }
    eraRowY[eraKey] = y;
    var units = unitsForRow(ids).sort(function(u1, u2){ return unitMinYear(u1) - unitMinYear(u2); });
    var x = 0, subline = 0;
    units.forEach(function(u){
      var unitW = u.length * (CARD_W + 8);
      if (x > 0 && x + unitW > TARGET_ROW_W) { x = 0; subline++; }
      u.forEach(function(id){
        positions[id] = { x: x, y: y + subline * (CARD_H + 10), era: eraKey };
        x += CARD_W + 8;
      });
      x += COL_GAP - 8;
      maxRowWidth = Math.max(maxRowWidth, x);
    });
    y += (subline + 1) * (CARD_H + 10) + (ROW_H - CARD_H - 10);
  });
  canvasW = maxRowWidth + 40;
  canvasH = y + 40;

  // Unconnected people (zero edges at all): a grid below the era rows.
  var orphans = NODES.filter(function(n){ return !hasEdge[n.id]; });
  var orphanY = canvasH + 50;
  var perRow = Math.max(1, Math.floor((maxRowWidth || 900) / (CARD_W + 12)));
  orphans.forEach(function(n, i){
    positions[n.id] = { x: (i % perRow) * (CARD_W + 12), y: orphanY + Math.floor(i / perRow) * (CARD_H + 14), era: null };
  });
  if (orphans.length) canvasH = orphanY + Math.ceil(orphans.length / perRow) * (CARD_H + 14) + 30;

  return { eraKeys: eraKeys, eraRowY: eraRowY, orphanCount: orphans.length, orphanY: orphanY };
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

var EDGE_STYLE = {
  'parent-child':   { stroke: '#94a3b8', dash: 'none', width: 1.6 },
  'spouse':         { stroke: '#7e22ce', dash: '4,3',  width: 1.6 },
  'disproven-link': { stroke: '#dc2626', dash: '2,3',  width: 1.6 }
};
function eraLabel(key){
  if (key === 'unknown') return 'Era unknown';
  return key + 's';
}
function renderTreeCanvas(){
  var layoutInfo = computeLayout();
  var labelHtml = '';
  layoutInfo.eraKeys.forEach(function(key){
    if (layoutInfo.eraRowY[key] === null || layoutInfo.eraRowY[key] === undefined) return;
    labelHtml += '<div class="gen-label" style="left:-' + (ROW_LABEL_W) + 'px;top:' + (layoutInfo.eraRowY[key] + 14) + 'px;width:' + (ROW_LABEL_W - 10) + 'px;text-align:right">' + esc(eraLabel(key)) + '</div>';
  });
  if (layoutInfo.orphanCount) {
    labelHtml += '<div class="gen-label" style="left:0;top:' + (layoutInfo.orphanY - 22) + 'px">Not yet connected (' + layoutInfo.orphanCount + ')</div>';
  }

  // Connector lines, drawn between each edge's two real card centers -- so
  // an unusual gap (a parent/child link that spans several era rows) is
  // visibly a long line, not hidden by forcing both people into one row.
  var lineSvg = '<svg style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none" width="' + canvasW + '" height="' + canvasH + '">';
  EDGES.forEach(function(e){
    var a = positions[e.source], b = positions[e.target];
    if (!a || !b) return;
    var style = EDGE_STYLE[e.type];
    if (!style) return;
    var x1 = a.x + CARD_W / 2, y1 = a.y + CARD_H / 2, x2 = b.x + CARD_W / 2, y2 = b.y + CARD_H / 2;
    lineSvg += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + style.stroke + '" stroke-width="' + style.width + '"' + (style.dash !== 'none' ? ' stroke-dasharray="' + style.dash + '"' : '') + ' opacity="' + (e.prob ? 0.55 : 0.85) + '" />';
  });
  lineSvg += '</svg>';

  var cardsHtml = '';
  NODES.forEach(function(n){ cardsHtml += cardHtml(n.id); });

  var content = document.getElementById('zoom-content');
  content.style.width = canvasW + 'px';
  content.style.height = canvasH + 'px';
  content.innerHTML = labelHtml + lineSvg + cardsHtml;
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
