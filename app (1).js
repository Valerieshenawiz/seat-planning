// ═══════════════════════════════════════════════════════════
// STATE & CONSTANTS
// ═══════════════════════════════════════════════════════════
const STORE_KEY = 'wedding_v3';
const MAX_UNDO = 30;
const PALETTE = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6',
                 '#ef4444','#14b8a6','#f97316','#84cc16','#06b6d4','#a78bfa'];

let S = { guests:[], tables:[], gid:1, tid:1, checkins:[] };
// checkins: [{guestId, name, tableId, tableName, count, gift, cake, note, time, color}]

let undos=[], redos=[];
let editGid=null, editTid=null, cbConfirm=null;
let importRows=[];
let selIds=new Set();
let filterGroup='';
let dragGuestId=null;

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  load();
  if (!S.tables.length) resetTables(true);
  if (!S.checkins) S.checkins = [];
  bind();
  renderAll();
  setupQR();
  // Poll localStorage for checkin updates from checkin.html
  setInterval(syncCheckins, 1500);
});

function resetTables(silent) {
  S.guests.forEach(g => g.tid = null);
  S.tables = [];
  S.tid = 1;
  for (let i = 1; i <= 25; i++) S.tables.push({ id: S.tid++, name: `第 ${i} 桌`, cap: 10 });
  save();
  if (!silent) renderAll();
}

// ═══════════════════════════════════════════════════════════
// PERSIST & SYNC
// ═══════════════════════════════════════════════════════════
function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(S));
}
function load() {
  try {
    const r = localStorage.getItem(STORE_KEY);
    if (r) S = { ...S, ...JSON.parse(r) };
    if (!S.checkins) S.checkins = [];
  } catch(e) {}
}

// Sync checkins written by checkin.html
function syncCheckins() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const fresh = JSON.parse(raw);
    if (!fresh.checkins) return;
    const prevLen = S.checkins.length;
    S.checkins = fresh.checkins;
    // Also sync guest checkin states
    S.guests = fresh.guests || S.guests;
    if (S.checkins.length !== prevLen) {
      renderAll();
    }
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
// UNDO / REDO
// ═══════════════════════════════════════════════════════════
function snap() {
  undos.push(JSON.stringify(S));
  if (undos.length > MAX_UNDO) undos.shift();
  redos = [];
  updUR();
}
function undo() {
  if (!undos.length) return;
  redos.push(JSON.stringify(S));
  S = JSON.parse(undos.pop());
  save(); renderAll(); updUR();
  toast('已復原');
}
function redo() {
  if (!redos.length) return;
  undos.push(JSON.stringify(S));
  S = JSON.parse(redos.pop());
  save(); renderAll(); updUR();
  toast('已重做');
}
function updUR() {
  document.getElementById('btn-undo').disabled = !undos.length;
  document.getElementById('btn-redo').disabled = !redos.length;
}

// ═══════════════════════════════════════════════════════════
// RENDER ALL
// ═══════════════════════════════════════════════════════════
function renderAll() {
  renderDashboard();
  renderPool();
  renderCanvas();
  renderGuestTable();
  renderReception();
  updFilters();
  updDatalist();
  updFilterSel();
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════
function renderDashboard() {
  const total = S.guests.reduce((s, g) => s + g.cnt, 0);
  const checkedIn = S.guests.filter(g => g.checkedIn).reduce((s, g) => s + (g.checkinCount || g.cnt), 0);
  const pending = total - checkedIn;
  const rate = total ? Math.round(checkedIn / total * 100) : 0;
  const seated = S.guests.filter(g => g.tid).reduce((s, g) => s + g.cnt, 0);
  const unseated = total - seated;
  const giftTotal = S.guests.reduce((s, g) => s + (parseInt(g.gift) || 0), 0);
  const giftCount = S.guests.filter(g => g.gift && parseInt(g.gift) > 0).length;
  const cakeCount = S.guests.filter(g => g.cake).reduce((s, g) => s + g.cnt, 0);
  const noCake = total - cakeCount;

  set('d-total', total);
  set('d-checkin', checkedIn);
  set('d-pending', pending);
  set('d-rate', rate + '%');
  set('d-seated', seated);
  set('d-unseated', `未安排 ${unseated}`);
  set('d-gift', '$' + giftTotal.toLocaleString());
  set('d-gift-sub', `已登記 ${giftCount} 筆`);
  set('d-cake', cakeCount);
  set('d-cake-sub', `未發 ${noCake}`);

  // Table grid
  const tg = document.getElementById('d-tables');
  if (tg) tg.innerHTML = S.tables.map(t => {
    const used = S.guests.filter(g => g.tid === t.id).reduce((s, g) => s + g.cnt, 0);
    const full = used >= t.cap;
    return `<div class="dt-item${full ? ' full' : used === 0 ? ' empty' : ''}">
      <div class="dt-name">${esc(t.name)}</div>
      <div class="dt-num" style="color:${full ? 'var(--orange)' : used === 0 ? 'var(--text3)' : 'var(--text)'}">${used}</div>
      <div class="dt-cap">/ ${t.cap}</div>
    </div>`;
  }).join('');

  // Recent checkins
  const recent = document.getElementById('d-recent');
  if (recent) {
    const items = [...S.checkins].reverse().slice(0, 8);
    recent.innerHTML = items.length ? items.map(c => `
      <div class="recent-item">
        <div class="ri-dot" style="background:${c.color || '#6366f1'}"></div>
        <div style="flex:1">
          <div class="ri-name">${esc(c.name)}</div>
          <div class="ri-meta">${c.count} 人${c.gift ? ` · 禮金 $${parseInt(c.gift).toLocaleString()}` : ''}${c.cake ? ' · 已發餅' : ''}</div>
        </div>
        <div style="text-align:right">
          <div class="ri-table">${esc(c.tableName || '未排桌')}</div>
          <div class="ri-time">${c.time || ''}</div>
        </div>
      </div>`).join('') :
      `<div class="empty"><div class="empty-icon">⏳</div><p>尚未有賓客報到</p></div>`;
  }

  // Reception stats
  set('r-in', checkedIn);
  set('r-out', pending);
  set('r-rate', rate + '%');
}

// ═══════════════════════════════════════════════════════════
// SEATING — LEFT PANEL
// ═══════════════════════════════════════════════════════════
function renderPool() {
  const pool = document.getElementById('guest-pool');
  const q = (document.getElementById('search-unassigned')?.value || '').toLowerCase();
  const unassigned = S.guests.filter(g => !g.tid);
  const tot = unassigned.reduce((s, g) => s + g.cnt, 0);
  set('unassigned-badge', tot);

  const list = unassigned.filter(g => {
    const ms = !q || g.name.toLowerCase().includes(q) || (g.grp || '').toLowerCase().includes(q);
    const mg = !filterGroup || g.grp === filterGroup;
    return ms && mg;
  });

  if (!list.length) {
    pool.innerHTML = `<div class="empty"><div class="empty-icon">${filterGroup || q ? '🔍' : '🎉'}</div><p>${filterGroup || q ? '無符合結果' : '所有賓客已安排！'}</p></div>`;
    return;
  }
  pool.innerHTML = list.map(g => `
    <div class="g-card" draggable="true" data-gid="${g.id}">
      <div class="g-dot" style="background:${g.clr}"></div>
      <span class="g-name">${esc(g.name)}</span>
      ${g.cnt > 1 ? `<span class="g-cnt">×${g.cnt}</span>` : ''}
      ${g.grp ? `<span class="g-grp">${esc(g.grp)}</span>` : ''}
    </div>`).join('');

  pool.querySelectorAll('.g-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      dragGuestId = parseInt(card.dataset.gid);
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragGuestId));
    });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); dragGuestId = null; });
  });
}

function updFilters() {
  const groups = [...new Set(S.guests.map(g => g.grp).filter(Boolean))];
  const c = document.getElementById('group-filters');
  if (!c) return;
  c.innerHTML = groups.map(g => {
    const clr = S.guests.find(gg => gg.grp === g)?.clr || '#999';
    return `<span class="ftag${filterGroup === g ? ' on' : ''}" data-g="${esc(g)}" style="color:${clr}">${esc(g)}</span>`;
  }).join('');
  c.querySelectorAll('.ftag').forEach(t => t.addEventListener('click', () => {
    filterGroup = filterGroup === t.dataset.g ? '' : t.dataset.g;
    renderPool(); updFilters();
  }));
}

// ═══════════════════════════════════════════════════════════
// SEATING — CIRCULAR TABLES
// ═══════════════════════════════════════════════════════════
function renderCanvas() {
  const canvas = document.getElementById('tables-canvas');
  if (!S.tables.length) {
    canvas.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🪑</div><p>尚無桌次</p></div>`;
    return;
  }
  canvas.innerHTML = S.tables.map(t => buildTableHTML(t)).join('');

  canvas.querySelectorAll('.round-table-wrap').forEach(wrap => {
    const tid = parseInt(wrap.dataset.tid);
    wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drag-over'); });
    wrap.addEventListener('dragleave', e => { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('drag-over'); });
    wrap.addEventListener('drop', e => {
      e.preventDefault(); wrap.classList.remove('drag-over');
      const gid = parseInt(e.dataTransfer.getData('text/plain'));
      if (gid) dropOnTable(gid, tid);
    });
  });

  canvas.querySelectorAll('.seat-dot:not(.empty-slot)').forEach(dot => {
    const rm = dot.querySelector('.sd-remove');
    if (rm) rm.addEventListener('click', e => {
      e.stopPropagation();
      const gid = parseInt(dot.dataset.gid);
      const g = S.guests.find(g => g.id === gid);
      if (!g) return;
      snap(); g.tid = null; save(); renderAll();
      toast(`${g.name} 已移回未安排`);
    });
  });

  canvas.querySelectorAll('[data-act="edit-t"]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); openTableModal(parseInt(b.dataset.tid)); }));
  canvas.querySelectorAll('[data-act="del-t"]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); confirmDelTable(parseInt(b.dataset.tid)); }));
}

function buildTableHTML(t) {
  const seated = S.guests.filter(g => g.tid === t.id);
  const used = seated.reduce((s, g) => s + g.cnt, 0);
  const full = used >= t.cap, over = used > t.cap;

  const slots = [];
  seated.forEach(g => { for (let i = 0; i < g.cnt; i++) slots.push({ gid: g.id, name: g.name, clr: g.clr, cnt: g.cnt }); });
  for (let i = 0; i < Math.max(0, t.cap - used); i++) slots.push(null);

  const centerX = 105, centerY = 105, radius = 80, dotSize = 44;
  const totalDots = Math.max(t.cap, slots.length);

  const dotsHTML = slots.map((slot, i) => {
    const angle = (i / Math.max(totalDots, 1)) * 2 * Math.PI - Math.PI / 2;
    const x = centerX + radius * Math.cos(angle) - dotSize / 2;
    const y = centerY + radius * Math.sin(angle) - dotSize / 2;
    if (!slot) return `<div class="seat-dot empty-slot" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${dotSize}px;height:${dotSize}px"></div>`;
    const nl = slot.name.length;
    const fs = nl <= 2 ? 13 : nl === 3 ? 10 : nl === 4 ? 8.5 : 7.5;
    let nameHTML;
    if (nl <= 2) nameHTML = `<span style="white-space:nowrap">${esc(slot.name)}</span>`;
    else if (nl === 3) nameHTML = `<span style="display:block;white-space:nowrap">${esc(slot.name.slice(0,2))}</span><span style="display:block;white-space:nowrap">${esc(slot.name.slice(2))}</span>`;
    else nameHTML = `<span style="display:block;white-space:nowrap">${esc(slot.name.slice(0,2))}</span><span style="display:block;white-space:nowrap">${esc(slot.name.slice(2,4))}</span>`;
    const hex = (slot.clr || '#6366f1').replace('#', '');
    const r2 = parseInt(hex.slice(0,2),16)||0, g2 = parseInt(hex.slice(2,4),16)||0, b2 = parseInt(hex.slice(4,6),16)||0;
    const txtClr = (r2*299+g2*587+b2*114)/1000 < 140 ? '#fff' : '#1a1a18';
    return `<div class="seat-dot" data-gid="${slot.gid}"
      style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${dotSize}px;height:${dotSize}px;background:${slot.clr};color:${txtClr};font-size:${fs}px;line-height:1.2;flex-direction:column;gap:0;">
      ${nameHTML}
      <div class="sd-tip">${esc(slot.name)}${slot.cnt > 1 ? ` (共${slot.cnt}人)` : ''}</div>
      <div class="sd-remove">×</div>
    </div>`;
  }).join('');

  return `
    <div class="round-table-wrap ${over ? 'overflow' : full ? 'full' : ''}" data-tid="${t.id}">
      <div class="round-table-scene">
        <div class="drop-hint-ring"></div>
        <div class="table-circle">
          <span class="t-name">${esc(t.name)}</span>
          <span class="t-count">${used}/${t.cap}</span>
        </div>
        ${dotsHTML}
      </div>
      <div class="round-table-footer">
        <span class="rt-label">${esc(t.name)}</span>
        <div class="rt-actions">
          <button class="rt-btn" data-act="edit-t" data-tid="${t.id}" title="編輯">✎</button>
          <button class="rt-btn del" data-act="del-t" data-tid="${t.id}" title="刪除">✕</button>
        </div>
      </div>
    </div>`;
}

function dropOnTable(guestId, tableId) {
  const g = S.guests.find(g => g.id === guestId);
  const t = S.tables.find(t => t.id === tableId);
  if (!g || !t) return;
  if (g.tid === tableId) { toast('已在此桌'); return; }
  const used = S.guests.filter(gg => gg.tid === tableId).reduce((s, gg) => s + gg.cnt, 0);
  if (used + g.cnt > t.cap) {
    if (!confirm(`${t.name} 目前 ${used}/${t.cap}，加入 ${g.name}（${g.cnt}人）將超過上限，是否繼續？`)) return;
  }
  snap(); g.tid = tableId; save(); renderAll();
  toast(`${g.name} → ${t.name}`, 'ok');
}

// ═══════════════════════════════════════════════════════════
// GUEST TABLE
// ═══════════════════════════════════════════════════════════
function renderGuestTable() {
  const tbody = document.getElementById('guest-tbody');
  if (!tbody) return;
  const q = (document.getElementById('search-guests')?.value || '').toLowerCase();
  const fside = document.getElementById('filter-side')?.value || '';
  const fcheckin = document.getElementById('filter-checkin')?.value || '';
  const fcake = document.getElementById('filter-cake')?.value || '';
  const fgift = document.getElementById('filter-gift')?.value || '';

  const list = S.guests.filter(g => {
    if (q && !g.name.toLowerCase().includes(q) && !(g.grp||'').toLowerCase().includes(q)) return false;
    if (fside && g.side !== fside) return false;
    if (fcheckin === 'yes' && !g.checkedIn) return false;
    if (fcheckin === 'no' && g.checkedIn) return false;
    if (fcake === 'yes' && !g.cake) return false;
    if (fcake === 'no' && g.cake) return false;
    if (fgift === 'yes' && !(g.gift && parseInt(g.gift) > 0)) return false;
    if (fgift === 'no' && g.gift && parseInt(g.gift) > 0) return false;
    return true;
  });

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="11"><div class="empty"><div class="empty-icon">👥</div><p>沒有符合的賓客</p></div></td></tr>`;
    return;
  }

  const sideLabel = { groom: '新郎', bride: '新娘', '': '' };

  tbody.innerHTML = list.map(g => {
    const tbl = g.tid ? S.tables.find(t => t.id === g.tid) : null;
    const checked = selIds.has(g.id);
    return `<tr class="${checked ? 'sel-row' : ''} ${g.checkedIn ? 'checked-in' : ''}" data-gid="${g.id}">
      <td><input type="checkbox" class="gcb" data-id="${g.id}" ${checked ? 'checked' : ''}></td>
      <td><b>${esc(g.name)}</b></td>
      <td>${g.side ? `<span class="chip" style="background:${g.side==='groom'?'#dbeafe':'#fce7f3'};color:${g.side==='groom'?'#2563eb':'#db2777'}">${sideLabel[g.side]}</span>` : '—'}</td>
      <td>${g.cnt}</td>
      <td><span class="swatch" style="background:${g.clr}"></span></td>
      <td>${tbl ? `<span class="chip">${esc(tbl.name)}</span>` : '<span style="color:#ccc">未排桌</span>'}</td>
      <td>
        <span class="checkin-badge ${g.checkedIn ? 'yes' : 'no'}" style="cursor:pointer" data-gid="${g.id}" data-act="toggle-checkin">
          ${g.checkedIn ? '✅ 已報到' : '⬜ 未報到'}
        </span>
      </td>
      <td>
        <input type="number" class="inline-input" placeholder="0" value="${g.gift || ''}"
          data-gid="${g.id}" data-field="gift" style="width:90px">
      </td>
      <td>
        <input type="checkbox" data-gid="${g.id}" data-field="cake" ${g.cake ? 'checked' : ''}
          style="width:16px;height:16px;cursor:pointer;accent-color:var(--green)">
      </td>
      <td style="color:var(--text2);font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.note || '')}</td>
      <td><div class="row-btns">
        <button class="rb" data-act="edit" data-gid="${g.id}" title="編輯">✎</button>
        ${tbl ? `<button class="rb" data-act="unset" data-gid="${g.id}" title="取消座位">↩</button>` : ''}
        <button class="rb del" data-act="del" data-gid="${g.id}" title="刪除">✕</button>
      </div></td>
    </tr>`;
  }).join('');

  // Checkboxes
  tbody.querySelectorAll('.gcb').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = parseInt(cb.dataset.id);
      cb.checked ? selIds.add(id) : selIds.delete(id);
      updSelAll();
    });
  });

  // Inline gift input
  tbody.querySelectorAll('[data-field="gift"]').forEach(inp => {
    inp.addEventListener('change', () => {
      const g = S.guests.find(g => g.id === parseInt(inp.dataset.gid));
      if (g) { g.gift = inp.value; save(); renderDashboard(); }
    });
  });

  // Cake checkbox
  tbody.querySelectorAll('[data-field="cake"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const g = S.guests.find(g => g.id === parseInt(cb.dataset.gid));
      if (g) { g.cake = cb.checked; save(); renderDashboard(); }
    });
  });

  // Toggle checkin
  tbody.querySelectorAll('[data-act="toggle-checkin"]').forEach(el => {
    el.addEventListener('click', () => {
      const g = S.guests.find(g => g.id === parseInt(el.dataset.gid));
      if (!g) return;
      snap(); g.checkedIn = !g.checkedIn;
      if (g.checkedIn) {
        const t = g.tid ? S.tables.find(t => t.id === g.tid) : null;
        addCheckin(g, g.cnt);
      }
      save(); renderAll();
      toast(g.checkedIn ? `${g.name} 已報到` : `${g.name} 取消報到`, g.checkedIn ? 'ok' : 'warn');
    });
  });

  // Row actions
  tbody.querySelectorAll('[data-act="edit"]').forEach(b => b.addEventListener('click', () => openGuestModal(parseInt(b.dataset.gid))));
  tbody.querySelectorAll('[data-act="unset"]').forEach(b => b.addEventListener('click', () => {
    const g = S.guests.find(g => g.id === parseInt(b.dataset.gid));
    if (g) { snap(); g.tid = null; save(); renderAll(); toast(`${g.name} 取消座位`); }
  }));
  tbody.querySelectorAll('[data-act="del"]').forEach(b => b.addEventListener('click', () => confirmDelGuest(parseInt(b.dataset.gid))));
}

function updSelAll() {
  const all = document.querySelectorAll('.gcb');
  const sa = document.getElementById('sel-all');
  if (sa) sa.checked = all.length > 0 && [...all].every(c => c.checked);
}

// ═══════════════════════════════════════════════════════════
// CHECKIN HELPER
// ═══════════════════════════════════════════════════════════
function addCheckin(g, count, extra = {}) {
  if (!S.checkins) S.checkins = [];
  const t = g.tid ? S.tables.find(t => t.id === g.tid) : null;
  const now = new Date();
  const time = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  S.checkins.push({
    guestId: g.id,
    name: g.name,
    tableId: g.tid || null,
    tableName: t ? t.name : '未排桌',
    count: count,
    color: g.clr,
    gift: extra.gift || g.gift || '',
    cake: extra.cake !== undefined ? extra.cake : (g.cake || false),
    note: extra.note || g.note || '',
    time
  });
}

// ═══════════════════════════════════════════════════════════
// RECEPTION TAB
// ═══════════════════════════════════════════════════════════
let recSelectedGid = null;

function renderReception() {
  const feed = document.getElementById('rec-feed');
  if (!feed) return;
  const items = [...(S.checkins || [])].reverse().slice(0, 20);
  feed.innerHTML = items.length ? items.map(c => `
    <div class="feed-item">
      <div class="fi-dot" style="background:${c.color || '#6366f1'}"></div>
      <div style="flex:1">
        <div class="fi-name">${esc(c.name)}</div>
        <div class="fi-meta">${c.count} 人${c.gift ? ` · 禮金 $${parseInt(c.gift).toLocaleString()}` : ''}${c.cake ? ' · 已發餅' : ''}</div>
        <div class="fi-time">${c.time}</div>
      </div>
      <div class="fi-table">${esc(c.tableName || '未排桌')}</div>
    </div>`).join('') :
    `<div class="empty"><div class="empty-icon">👋</div><p>等待賓客報到...</p></div>`;
}

function bindReception() {
  const search = document.getElementById('rec-search');
  if (!search) return;
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    const res = document.getElementById('rec-results');
    if (!q) { res.innerHTML = ''; return; }
    const matches = S.guests.filter(g => g.name.toLowerCase().includes(q));
    if (!matches.length) {
      res.innerHTML = `<div style="padding:12px;color:var(--text3);font-size:13px;text-align:center">找不到賓客</div>`;
      return;
    }
    res.innerHTML = matches.map(g => {
      const tbl = g.tid ? S.tables.find(t => t.id === g.tid) : null;
      const already = g.checkedIn;
      return `<div class="rec-result-item ${already ? 'already' : ''}" data-gid="${g.id}">
        <div style="width:10px;height:10px;border-radius:50%;background:${g.clr};flex-shrink:0"></div>
        <div style="flex:1">
          <div style="font-size:13.5px;font-weight:600">${esc(g.name)}</div>
          <div style="font-size:12px;color:var(--text3)">${tbl ? tbl.name : '未排桌'} · ${g.cnt} 人${already ? ' · ✅ 已報到' : ''}</div>
        </div>
      </div>`;
    }).join('');
    res.querySelectorAll('.rec-result-item:not(.already)').forEach(el => {
      el.addEventListener('click', () => {
        recSelectedGid = parseInt(el.dataset.gid);
        const g = S.guests.find(g => g.id === recSelectedGid);
        if (!g) return;
        const tbl = g.tid ? S.tables.find(t => t.id === g.tid) : null;
        set('rec-sel-name', g.name);
        set('rec-sel-info', `${tbl ? tbl.name : '未排桌'} · 預計 ${g.cnt} 人`);
        document.getElementById('rec-gift').value = g.gift || '';
        document.getElementById('rec-note').value = '';
        document.getElementById('rec-cake').checked = false;
        document.getElementById('rec-selected').style.display = 'flex';
        document.getElementById('rec-selected').style.flexDirection = 'column';
        res.innerHTML = '';
        search.value = '';
      });
    });
  });

  document.getElementById('btn-do-checkin')?.addEventListener('click', () => {
    const g = S.guests.find(g => g.id === recSelectedGid);
    if (!g) return;
    snap();
    g.checkedIn = true;
    g.gift = document.getElementById('rec-gift').value;
    g.cake = document.getElementById('rec-cake').checked;
    g.note = document.getElementById('rec-note').value || g.note || '';
    addCheckin(g, g.cnt, { gift: g.gift, cake: g.cake, note: g.note });
    save();
    document.getElementById('rec-selected').style.display = 'none';
    recSelectedGid = null;
    renderAll();
    toast(`${g.name} 報到完成 🎉`, 'ok');
  });

  document.getElementById('btn-cancel-sel')?.addEventListener('click', () => {
    document.getElementById('rec-selected').style.display = 'none';
    recSelectedGid = null;
  });
}

// ═══════════════════════════════════════════════════════════
// QR CODE
// ═══════════════════════════════════════════════════════════
function setupQR() {
  const checkinURL = window.location.href.replace('index.html', '').replace(/\/$/, '') + '/checkin.html';
  const box = document.getElementById('qr-box');
  const urlLabel = document.getElementById('qr-url-display');
  const openBtn = document.getElementById('btn-open-checkin');
  if (urlLabel) urlLabel.textContent = checkinURL;
  if (openBtn) openBtn.href = checkinURL;

  if (box && typeof QRCode !== 'undefined') {
    box.innerHTML = '';
    new QRCode(box, {
      text: checkinURL,
      width: 200, height: 200,
      colorDark: '#1a1a18', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
  }

  document.getElementById('btn-copy-url')?.addEventListener('click', () => {
    navigator.clipboard.writeText(checkinURL).then(() => toast('已複製網址', 'ok'));
  });

  document.getElementById('btn-dl-png')?.addEventListener('click', () => {
    const canvas = document.querySelector('#qr-box canvas');
    if (!canvas) { toast('QR Code 未產生', 'err'); return; }
    const link = document.createElement('a');
    link.download = 'wedding-qrcode.png';
    link.href = canvas.toDataURL();
    link.click();
    toast('已下載 PNG', 'ok');
  });

  document.getElementById('btn-print-qr')?.addEventListener('click', () => {
    const canvas = document.querySelector('#qr-box canvas');
    if (!canvas) return;
    const w = window.open('');
    w.document.write(`<html><body style="text-align:center;font-family:-apple-system,sans-serif;padding:40px">
      <img src="${canvas.toDataURL()}" style="width:250px;height:250px"><br>
      <p style="margin-top:16px;font-size:14px;color:#555">請掃描 QR Code 完成婚禮報到</p>
      <p style="font-size:18px;font-weight:700;margin-top:8px">Joe & Valerie Wedding</p>
      <p style="font-size:15px;color:#6366f1;margin-top:4px">2026.07.04</p>
    </body></html>`);
    w.print();
  });
}

// ═══════════════════════════════════════════════════════════
// GUEST MODAL
// ═══════════════════════════════════════════════════════════
function openGuestModal(gid = null) {
  editGid = gid;
  set('mg-title', gid ? '編輯賓客' : '新增賓客');
  const g = gid ? S.guests.find(g => g.id === gid) : null;
  fv('g-name', g ? g.name : '');
  fv('g-side', g ? (g.side || '') : '');
  fv('g-group', g ? (g.grp || '') : '');
  fv('g-count', g ? g.cnt : 1);
  fv('g-color', g ? g.clr : PALETTE[S.guests.length % PALETTE.length]);
  fv('g-note', g ? (g.note || '') : '');
  buildSwatches('cp-swatches', 'g-color');
  showModal('guest');
  setTimeout(() => document.getElementById('g-name').focus(), 80);
}

function saveGuest() {
  const name = (document.getElementById('g-name').value || '').trim();
  if (!name) { toast('請輸入姓名', 'err'); return; }
  const grp = (document.getElementById('g-group').value || '').trim();
  const side = document.getElementById('g-side').value;
  const cnt = parseInt(document.getElementById('g-count').value) || 1;
  const clr = document.getElementById('g-color').value;
  const note = (document.getElementById('g-note').value || '').trim();
  snap();
  if (editGid) {
    const g = S.guests.find(g => g.id === editGid);
    Object.assign(g, { name, grp, side, cnt, clr, note });
    toast(`${name} 已更新`, 'ok');
  } else {
    S.guests.push({ id: S.gid++, name, grp, side, cnt, clr, note, tid: null, checkedIn: false, gift: '', cake: false });
    toast(`${name} 已新增`, 'ok');
  }
  save(); closeModal('guest'); renderAll();
}

// ═══════════════════════════════════════════════════════════
// TABLE MODAL
// ═══════════════════════════════════════════════════════════
function openTableModal(tid = null) {
  editTid = tid;
  set('mt-title', tid ? '編輯桌次' : '新增桌次');
  const t = tid ? S.tables.find(t => t.id === tid) : null;
  fv('t-name', t ? t.name : `第 ${S.tables.length + 1} 桌`);
  fv('t-cap', t ? t.cap : 10);
  showModal('table');
  setTimeout(() => document.getElementById('t-name').focus(), 80);
}

function saveTable() {
  const name = (document.getElementById('t-name').value || '').trim() || `桌 ${S.tables.length + 1}`;
  const cap = parseInt(document.getElementById('t-cap').value) || 10;
  snap();
  if (editTid) {
    const t = S.tables.find(t => t.id === editTid);
    Object.assign(t, { name, cap });
    toast(`${name} 已更新`, 'ok');
  } else {
    S.tables.push({ id: S.tid++, name, cap });
    toast(`${name} 已新增`, 'ok');
  }
  save(); closeModal('table'); renderAll();
}

// ═══════════════════════════════════════════════════════════
// DELETE
// ═══════════════════════════════════════════════════════════
function confirmDelGuest(gid) {
  const g = S.guests.find(g => g.id === gid);
  if (!g) return;
  set('conf-title', '刪除賓客');
  set('conf-msg', `確定刪除「${g.name}」？此操作可用 Ctrl+Z 復原。`);
  document.getElementById('conf-ok').textContent = '確認刪除';
  cbConfirm = () => { snap(); S.guests = S.guests.filter(g => g.id !== gid); save(); renderAll(); toast(`${g.name} 已刪除`); };
  showModal('confirm');
}

function confirmDelTable(tid) {
  const t = S.tables.find(t => t.id === tid);
  if (!t) return;
  const has = S.guests.some(g => g.tid === tid);
  set('conf-title', '刪除桌次');
  set('conf-msg', `確定刪除「${t.name}」？${has ? '此桌賓客將移回未安排。' : ''}可用 Ctrl+Z 復原。`);
  document.getElementById('conf-ok').textContent = '確認刪除';
  cbConfirm = () => {
    snap();
    S.guests.forEach(g => { if (g.tid === tid) g.tid = null; });
    S.tables = S.tables.filter(t => t.id !== tid);
    save(); renderAll(); toast(`${t.name} 已刪除`);
  };
  showModal('confirm');
}

// ═══════════════════════════════════════════════════════════
// BATCH
// ═══════════════════════════════════════════════════════════
function openBatch() {
  if (!selIds.size) { toast('請先勾選賓客', 'warn'); return; }
  set('batch-n', selIds.size);
  buildSwatches('bp-swatches', 'b-color');
  showModal('batch');
}
function saveBatch() {
  const grp = (document.getElementById('b-group').value || '').trim();
  const side = document.getElementById('b-side').value;
  const clr = document.getElementById('b-color').value;
  snap();
  S.guests.forEach(g => {
    if (selIds.has(g.id)) {
      if (grp) g.grp = grp;
      if (side) g.side = side;
      g.clr = clr;
    }
  });
  save(); closeModal('batch'); renderAll();
  toast(`已更新 ${selIds.size} 位賓客`, 'ok');
  selIds.clear();
}

// ═══════════════════════════════════════════════════════════
// IMPORT / EXPORT
// ═══════════════════════════════════════════════════════════
function openImport() {
  importRows = [];
  document.getElementById('import-preview').classList.add('hidden');
  document.getElementById('btn-do-import').disabled = true;
  document.getElementById('import-warns').innerHTML = '';
  showModal('import');
}

function handleFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellStyles: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      parseRows(rows, ws);
    } catch(err) { toast('讀取失敗: ' + err.message, 'err'); }
  };
  r.readAsArrayBuffer(file);
}

function colLetter(n) { let s=''; n++; while(n>0){ s=String.fromCharCode(65+(n-1)%26)+s; n=Math.floor((n-1)/26); } return s; }
function cellBgColor(ws, rowIdx, colIdx) {
  const addr = colLetter(colIdx) + (rowIdx + 1);
  const cell = ws[addr];
  if (!cell) return null;
  const fg = cell.s?.fgColor || cell.s?.bgColor;
  if (fg) {
    let hex = fg.rgb || fg.argb || '';
    if (hex.length === 8) hex = hex.slice(2);
    if (/^[0-9A-Fa-f]{6}$/.test(hex) && hex !== '000000' && hex.toUpperCase() !== 'FFFFFF') return '#' + hex.toUpperCase();
  }
  return null;
}

function parseRows(rows, ws) {
  importRows = [];
  const warns = [];
  const existing = S.guests.map(g => g.name);
  const start = (rows[0] && String(rows[0][0]).includes('姓名')) ? 1 : 0;
  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[0] || '').trim();
    if (!name) continue;
    const side = String(row[1] || '').trim();
    const sideVal = side.includes('郎') ? 'groom' : side.includes('娘') ? 'bride' : '';
    const grp = String(row[2] || '').trim();
    const cnt = parseInt(row[3]) || 1;
    let clr = String(row[4] || '').trim();
    if (!clr || clr === '—') clr = cellBgColor(ws, i, 4) || PALETTE[importRows.length % PALETTE.length];
    if (clr && !clr.startsWith('#') && /^[0-9A-Fa-f]{6}$/.test(clr)) clr = '#' + clr;
    if (!clr.startsWith('#')) clr = PALETTE[importRows.length % PALETTE.length];
    const dup = existing.includes(name);
    if (dup) warns.push(`「${name}」已存在`);
    importRows.push({ name, side: sideVal, grp, cnt, clr, dup });
  }
  set('import-n', importRows.length);
  document.getElementById('import-warns').innerHTML = warns.map(w => `<div class="iw">⚠ ${w}</div>`).join('');
  const pv = document.getElementById('import-preview');
  const pl = document.getElementById('preview-list');
  if (importRows.length) {
    pv.classList.remove('hidden');
    pl.innerHTML = `<table><thead><tr><th>姓名</th><th>方</th><th>群組</th><th>人數</th><th>顏色</th></tr></thead><tbody>
      ${importRows.map(r => `<tr class="${r.dup ? 'dup' : ''}">
        <td>${esc(r.name)}</td><td>${r.side === 'groom' ? '新郎' : r.side === 'bride' ? '新娘' : '—'}</td>
        <td>${esc(r.grp)}</td><td>${r.cnt}</td>
        <td><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${r.clr};vertical-align:middle;margin-right:4px"></span>${r.clr}</td>
      </tr>`).join('')}
    </tbody></table>`;
    document.getElementById('btn-do-import').disabled = false;
  }
}

function doImport() {
  if (!importRows.length) return;
  snap();
  importRows.forEach(r => S.guests.push({
    id: S.gid++, name: r.name, grp: r.grp, side: r.side, cnt: r.cnt, clr: r.clr,
    note: '', tid: null, checkedIn: false, gift: '', cake: false
  }));
  save(); renderAll(); closeModal('import');
  toast(`已匯入 ${importRows.length} 位賓客`, 'ok');
}

function doExport() {
  const sideLabel = { groom: '新郎方', bride: '新娘方', '': '' };
  const rows = [['姓名', '方', '群組', '人數', '代表色', '桌號', '報到', '禮金', '喜餅', '備註']];
  S.guests.forEach(g => {
    const tbl = g.tid ? S.tables.find(t => t.id === g.tid)?.name || '' : '';
    rows.push([g.name, sideLabel[g.side || ''] || '', g.grp || '', g.cnt, g.clr, tbl,
      g.checkedIn ? '已報到' : '未報到', g.gift || '', g.cake ? '已發' : '', g.note || '']);
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [12,8,14,6,10,10,8,10,8,20].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, '賓客名單');

  const t2 = [['桌次', '容量', '已坐', '賓客']];
  S.tables.forEach(t => {
    const s = S.guests.filter(g => g.tid === t.id);
    t2.push([t.name, t.cap, s.reduce((a, g) => a + g.cnt, 0), s.map(g => g.name).join('、')]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(t2);
  XLSX.utils.book_append_sheet(wb, ws2, '桌次總覽');

  // Checkin log
  if (S.checkins?.length) {
    const t3 = [['時間', '姓名', '桌號', '人數', '禮金', '喜餅']];
    S.checkins.forEach(c => t3.push([c.time, c.name, c.tableName, c.count, c.gift || '', c.cake ? '已發' : '']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t3), '報到記錄');
  }

  XLSX.writeFile(wb, '婚禮管理表.xlsx');
  toast('已匯出 Excel', 'ok');
}

function dlTemplate() {
  const rows = [
    ['姓名', '方（新郎方/新娘方）', '群組', '人數', '代表色（可留空）'],
    ['王小明', '新郎方', '高中同學', 2, '#6366f1'],
    ['李美玲', '新娘方', '大學同學', 1, '#ec4899'],
    ['張志遠', '新郎方', '親戚', 4, '#10b981'],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, '範本');
  XLSX.writeFile(wb, '賓客名單範本.xlsx');
}

// ═══════════════════════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════════════════════
function showModal(name) {
  document.getElementById('overlay').classList.remove('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  document.getElementById('modal-' + name).classList.remove('hidden');
}
function closeModal(name) {
  document.getElementById('modal-' + name).classList.add('hidden');
  const any = [...document.querySelectorAll('.modal')].some(m => !m.classList.contains('hidden'));
  if (!any) document.getElementById('overlay').classList.add('hidden');
}
function handleOverlayClick(e) {
  if (e.target === e.currentTarget)
    document.querySelectorAll('.modal:not(.hidden)').forEach(m => closeModal(m.id.replace('modal-', '')));
}

function buildSwatches(cid, inputId) {
  const c = document.getElementById(cid);
  const inp = document.getElementById(inputId);
  c.innerHTML = PALETTE.map(p => `<div class="sw${inp.value === p ? ' on' : ''}" style="background:${p}" data-c="${p}"></div>`).join('');
  c.querySelectorAll('.sw').forEach(sw => sw.addEventListener('click', () => {
    inp.value = sw.dataset.c;
    c.querySelectorAll('.sw').forEach(s => s.classList.remove('on'));
    sw.classList.add('on');
  }));
  inp.addEventListener('input', () => c.querySelectorAll('.sw').forEach(s => s.classList.remove('on')));
}

function updDatalist() {
  const groups = [...new Set(S.guests.map(g => g.grp).filter(Boolean))];
  document.querySelectorAll('#grp-dl').forEach(dl => { dl.innerHTML = groups.map(g => `<option value="${esc(g)}">`).join(''); });
}
function updFilterSel() {
  // group filter not on guests tab for now; side/checkin/cake/gift are static
}

// ═══════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════
function toast(msg, type = 'info') {
  const icons = { ok: '✓', warn: '⚠', err: '✗', info: '·' };
  const c = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = (icons[type] || '·') + ' ' + msg;
  c.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 2800);
}

// ═══════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function set(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function fv(id, v) { const el = document.getElementById(id); if (el) el.value = v; }

// ═══════════════════════════════════════════════════════════
// BIND ALL EVENTS
// ═══════════════════════════════════════════════════════════
function bind() {
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'qrcode') setupQR();
    });
  });

  // Undo/redo
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    if (e.key === 'Escape') document.querySelectorAll('.modal:not(.hidden)').forEach(m => closeModal(m.id.replace('modal-', '')));
  });

  // Import/export
  document.getElementById('btn-import').addEventListener('click', openImport);
  document.getElementById('btn-export').addEventListener('click', doExport);

  // Clear all
  document.getElementById('btn-clear-all').addEventListener('click', () => {
    set('conf-title', '清除全部資料');
    set('conf-msg', '確定清除所有賓客、座位與報到記錄？桌次重設為預設 25 桌。此操作無法復原。');
    document.getElementById('conf-ok').textContent = '確認清除';
    cbConfirm = () => {
      S = { guests: [], tables: [], gid: 1, tid: 1, checkins: [] };
      undos = []; redos = []; selIds = new Set(); filterGroup = '';
      localStorage.removeItem(STORE_KEY);
      resetTables(true);
      updUR(); renderAll(); toast('已清除全部資料', 'ok');
    };
    showModal('confirm');
  });

  // Clear guests only
  document.getElementById('btn-clear-guests').addEventListener('click', () => {
    set('conf-title', '清除賓客名單');
    set('conf-msg', '確定刪除所有賓客資料？桌次保留，可 Ctrl+Z 復原。');
    document.getElementById('conf-ok').textContent = '確認清除';
    cbConfirm = () => { snap(); S.guests = []; S.gid = 1; S.checkins = []; save(); renderAll(); toast('已清除名單', 'ok'); };
    showModal('confirm');
  });

  // Unassign all
  document.getElementById('btn-unassign-all').addEventListener('click', () => {
    set('conf-title', '全部重排');
    set('conf-msg', '取消所有賓客的座位安排？賓客資料保留，可 Ctrl+Z 復原。');
    document.getElementById('conf-ok').textContent = '確認重排';
    cbConfirm = () => { snap(); S.guests.forEach(g => g.tid = null); save(); renderAll(); toast('已取消所有座位', 'ok'); };
    showModal('confirm');
  });

  // Guest modal
  document.getElementById('btn-add-guest').addEventListener('click', () => openGuestModal());
  document.getElementById('btn-save-guest').addEventListener('click', saveGuest);
  document.getElementById('g-name').addEventListener('keydown', e => { if (e.key === 'Enter') saveGuest(); });
  document.getElementById('g-dec').addEventListener('click', () => { const i = document.getElementById('g-count'); if (+i.value > 1) i.value = +i.value - 1; });
  document.getElementById('g-inc').addEventListener('click', () => { const i = document.getElementById('g-count'); i.value = +i.value + 1; });

  // Table modal
  document.getElementById('btn-add-table').addEventListener('click', () => openTableModal());
  document.getElementById('btn-add-table-s').addEventListener('click', () => openTableModal());
  document.getElementById('btn-save-table').addEventListener('click', saveTable);
  document.getElementById('t-dec').addEventListener('click', () => { const i = document.getElementById('t-cap'); if (+i.value > 1) i.value = +i.value - 1; });
  document.getElementById('t-inc').addEventListener('click', () => { const i = document.getElementById('t-cap'); i.value = +i.value + 1; });

  // Confirm
  document.getElementById('conf-ok').addEventListener('click', () => { if (cbConfirm) { cbConfirm(); cbConfirm = null; } closeModal('confirm'); });
  document.getElementById('conf-cancel').addEventListener('click', () => { closeModal('confirm'); cbConfirm = null; });

  // Select all
  document.getElementById('sel-all').addEventListener('change', e => {
    document.querySelectorAll('.gcb').forEach(cb => {
      cb.checked = e.target.checked;
      const id = parseInt(cb.dataset.id);
      e.target.checked ? selIds.add(id) : selIds.delete(id);
    });
    renderGuestTable();
  });

  // Batch
  document.getElementById('btn-batch').addEventListener('click', openBatch);
  document.getElementById('btn-save-batch').addEventListener('click', saveBatch);

  // Search
  document.getElementById('search-unassigned').addEventListener('input', renderPool);
  document.getElementById('search-guests').addEventListener('input', renderGuestTable);
  document.getElementById('filter-side').addEventListener('change', renderGuestTable);
  document.getElementById('filter-checkin').addEventListener('change', renderGuestTable);
  document.getElementById('filter-cake').addEventListener('change', renderGuestTable);
  document.getElementById('filter-gift').addEventListener('change', renderGuestTable);

  // Import modal
  const dz = document.getElementById('drop-zone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('on'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('on'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('on'); handleFile(e.dataTransfer.files[0]); });
  dz.addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('btn-pick').addEventListener('click', e => { e.stopPropagation(); document.getElementById('file-input').click(); });
  document.getElementById('file-input').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  document.getElementById('btn-do-import').addEventListener('click', doImport);
  document.getElementById('btn-tmpl').addEventListener('click', dlTemplate);

  // Reception
  bindReception();
}
