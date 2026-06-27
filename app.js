/* ============================================================
   WEDDING SEATING SYSTEM — APP LOGIC
   ============================================================ */

'use strict';

// ---- State ----
let state = {
  guests: [],       // { id, name, group, count, color, note, tableId|null }
  tables: [],       // { id, name, capacity }
  nextGuestId: 1,
  nextTableId: 1,
};

// History for undo/redo
let history = [];
let historyIndex = -1;
const MAX_HISTORY = 30;

// Editing context
let editingGuestId = null;
let editingTableId = null;
let importRows = [];

// Drag state
let dragGuestId = null;
let selectedGuestId = null; // click-to-assign mode

// Preset colors
const PRESET_COLORS = [
  '#6366f1','#ec4899','#f59e0b','#22c55e','#3b82f6',
  '#ef4444','#8b5cf6','#14b8a6','#f97316','#06b6d4',
  '#84cc16','#a855f7','#64748b','#e11d48','#0ea5e9',
];

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  if (state.tables.length === 0) initDefaultTables();
  pushHistory();
  render();
  bindGlobalEvents();
});

function initDefaultTables() {
  for (let i = 1; i <= 25; i++) {
    state.tables.push({ id: state.nextTableId++, name: `第 ${i} 桌`, capacity: 10 });
  }
}

function bindGlobalEvents() {
  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  });
  // Drop zone drag events
  const dz = document.getElementById('drop-zone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); handleFileImport({ target: { files: e.dataTransfer.files } }); });
}

/* ============================================================
   RENDER ORCHESTRATOR
   ============================================================ */
function render() {
  renderStats();
  renderUnassigned();
  renderTablesGrid();
  renderGuestList();
  renderTableList();
  updateUndoRedo();
  updateGroupSuggestions();
}

/* ============================================================
   STATS
   ============================================================ */
function renderStats() {
  const total = state.guests.reduce((s, g) => s + g.count, 0);
  const seated = state.guests.filter(g => g.tableId).reduce((s, g) => s + g.count, 0);
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-seated').textContent = seated;
  document.getElementById('stat-unassigned').textContent = total - seated;
  document.getElementById('stat-tables').textContent = state.tables.length;
}

/* ============================================================
   UNASSIGNED PANEL
   ============================================================ */
function renderUnassigned() {
  const q = document.getElementById('unassigned-search')?.value.toLowerCase() || '';
  const list = state.guests.filter(g => !g.tableId && (
    !q || g.name.toLowerCase().includes(q) || (g.group||'').toLowerCase().includes(q)
  ));
  const el = document.getElementById('unassigned-list');
  document.getElementById('unassigned-badge').textContent = list.length;

  if (list.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎉</div><p>${q ? '無搜尋結果' : '所有賓客已安排座位'}</p></div>`;
    return;
  }

  el.innerHTML = list.map(g => `
    <div class="guest-chip ${selectedGuestId === g.id ? 'selected' : ''}"
         data-id="${g.id}"
         draggable="true"
         onclick="selectGuest(${g.id})"
         ondragstart="onDragStart(event, ${g.id})"
         ondragend="onDragEnd(event)">
      <div class="chip-dot" style="background:${g.color}"></div>
      <div class="chip-name" title="${escHtml(g.name)}">${escHtml(g.name)}</div>
      <div class="chip-count">×${g.count}</div>
    </div>
  `).join('');
}

/* ============================================================
   TABLES GRID (SEATING VIEW)
   ============================================================ */
function renderTablesGrid() {
  const grid = document.getElementById('tables-grid');
  if (!state.tables.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🍽</div><p>尚未建立任何桌次</p></div>`;
    return;
  }
  grid.innerHTML = state.tables.map(t => renderTableCard(t)).join('');
}

function renderTableCard(t) {
  const seated = getTableGuests(t.id);
  const takenCount = seated.reduce((s, g) => s + g.count, 0);
  const pct = Math.min(100, Math.round(takenCount / t.capacity * 100));
  const isFull = takenCount >= t.capacity;
  const isOver = takenCount > t.capacity;

  let cardClass = 'table-card';
  if (isOver) cardClass += ' over-limit';
  else if (isFull) cardClass += ' full';

  let badgeClass = 'table-cap-badge';
  if (isOver) badgeClass += ' over';
  else if (isFull) badgeClass += ' full';

  // Build seat circles (up to capacity, show extra if over)
  const totalSeats = Math.max(t.capacity, takenCount);
  let seatsHTML = '';
  let seatIdx = 0;
  for (const g of seated) {
    for (let i = 0; i < g.count; i++) {
      if (seatIdx < totalSeats) {
        const initials = g.name.slice(0,2);
        seatsHTML += `<div class="seat occupied" style="background:${g.color}" 
          title="${escHtml(g.name)}" onclick="removeFromTable(${g.id})">
          <div class="seat-label">${escHtml(initials)}</div>
        </div>`;
        seatIdx++;
      }
    }
  }
  // Empty seats
  for (let i = seatIdx; i < t.capacity; i++) {
    seatsHTML += `<div class="seat" title="空位"></div>`;
  }

  return `
    <div class="${cardClass}" id="tc-${t.id}"
         ondragover="onTableDragOver(event, ${t.id})"
         ondragleave="onTableDragLeave(event, ${t.id})"
         ondrop="onTableDrop(event, ${t.id})"
         onclick="onTableClick(${t.id})">
      <div class="table-header">
        <div class="table-name">${escHtml(t.name)}</div>
        <div class="${badgeClass}">${takenCount}/${t.capacity}</div>
      </div>
      <div class="table-seats">${seatsHTML}</div>
    </div>
  `;
}

function getTableGuests(tableId) {
  return state.guests.filter(g => g.tableId === tableId);
}

/* ============================================================
   GUESTS VIEW
   ============================================================ */
function renderGuestList() {
  const q = (document.getElementById('guest-search')?.value || '').toLowerCase();
  const list = state.guests.filter(g => !q ||
    g.name.toLowerCase().includes(q) || (g.group||'').toLowerCase().includes(q)
  );
  const el = document.getElementById('guest-list');

  if (list.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👥</div><p>${q ? '無搜尋結果' : '尚未新增任何賓客'}</p><p style="font-size:11px;margin-top:4px">點擊右上角「新增賓客」或匯入 Excel</p></div>`;
    return;
  }

  el.innerHTML = list.map(g => {
    const t = g.tableId ? state.tables.find(x => x.id === g.tableId) : null;
    return `
      <div class="guest-row">
        <input type="checkbox" class="guest-cb" data-id="${g.id}" onchange="updateBatchBtn()" />
        <div class="guest-color-dot" style="background:${g.color}"></div>
        <div class="guest-info">
          <div class="guest-name">${escHtml(g.name)}</div>
          <div class="guest-meta">${escHtml(g.group||'未分類')}${g.note ? ' · ' + escHtml(g.note) : ''}</div>
        </div>
        <div class="guest-count-tag">×${g.count}</div>
        <div class="${t ? 'guest-table-tag' : 'guest-table-tag unassigned'}">${t ? escHtml(t.name) : '未安排'}</div>
        <div class="guest-row-actions">
          <button class="btn-icon" onclick="openEditGuest(${g.id})" title="編輯">✏️</button>
          <button class="btn-icon danger" onclick="confirmDeleteGuest(${g.id})" title="刪除">🗑</button>
        </div>
      </div>
    `;
  }).join('');
}

function updateGroupSuggestions() {
  const groups = [...new Set(state.guests.map(g => g.group).filter(Boolean))];
  document.getElementById('group-suggestions').innerHTML = groups.map(g => `<option value="${escHtml(g)}">`).join('');
}

/* ============================================================
   TABLE MANAGEMENT VIEW
   ============================================================ */
function renderTableList() {
  const el = document.getElementById('table-list');
  if (!state.tables.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🍽</div><p>尚未建立任何桌次</p></div>`;
    return;
  }
  el.innerHTML = state.tables.map((t, i) => {
    const seated = getTableGuests(t.id);
    const takenCount = seated.reduce((s, g) => s + g.count, 0);
    const pct = Math.min(100, Math.round(takenCount / t.capacity * 100));
    const fillClass = takenCount > t.capacity ? 'over' : (pct >= 90 ? 'warn' : '');
    const guestNames = seated.map(g => g.name).join('、') || '無賓客';
    return `
      <div class="table-row">
        <div class="table-row-num">${i+1}</div>
        <div class="table-row-info" style="flex:1">
          <div class="table-row-name">${escHtml(t.name)}</div>
          <div class="table-row-stats" style="font-size:11px;color:var(--text3);margin-top:2px">${escHtml(guestNames)}</div>
        </div>
        <div class="table-row-bar">
          <div style="font-size:12px;color:var(--text2);margin-bottom:3px;text-align:right">${takenCount}/${t.capacity}</div>
          <div class="progress-bar"><div class="progress-fill ${fillClass}" style="width:${pct}%"></div></div>
        </div>
        <div class="guest-row-actions" style="opacity:1">
          <button class="btn-icon" onclick="openEditTable(${t.id})" title="編輯">✏️</button>
          <button class="btn-icon danger" onclick="confirmDeleteTable(${t.id})" title="刪除">🗑</button>
        </div>
      </div>
    `;
  }).join('');
}

/* ============================================================
   DRAG & DROP
   ============================================================ */
function onDragStart(e, guestId) {
  dragGuestId = guestId;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => {
    const el = document.querySelector(`.guest-chip[data-id="${guestId}"]`);
    if (el) el.classList.add('dragging');
  }, 0);
}
function onDragEnd(e) {
  document.querySelectorAll('.guest-chip.dragging').forEach(el => el.classList.remove('dragging'));
  dragGuestId = null;
}
function onTableDragOver(e, tableId) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.getElementById(`tc-${tableId}`)?.classList.add('drag-over');
}
function onTableDragLeave(e, tableId) {
  // Only remove if leaving the card itself, not a child
  const card = document.getElementById(`tc-${tableId}`);
  if (card && !card.contains(e.relatedTarget)) {
    card.classList.remove('drag-over');
  }
}
function onTableDrop(e, tableId) {
  e.preventDefault();
  document.querySelectorAll('.table-card.drag-over').forEach(el => el.classList.remove('drag-over'));
  if (dragGuestId !== null) {
    assignGuestToTable(dragGuestId, tableId);
    dragGuestId = null;
  } else if (selectedGuestId !== null) {
    assignGuestToTable(selectedGuestId, tableId);
    selectedGuestId = null;
  }
}

/* Click-to-assign: click guest then click table */
function selectGuest(guestId) {
  if (selectedGuestId === guestId) {
    selectedGuestId = null;
  } else {
    selectedGuestId = guestId;
  }
  renderUnassigned();
}
function onTableClick(tableId) {
  if (selectedGuestId !== null) {
    assignGuestToTable(selectedGuestId, tableId);
    selectedGuestId = null;
  }
}

/* ============================================================
   ASSIGN / REMOVE
   ============================================================ */
function assignGuestToTable(guestId, tableId) {
  const g = state.guests.find(x => x.id === guestId);
  const t = state.tables.find(x => x.id === tableId);
  if (!g || !t) return;

  const currentOccupancy = getTableGuests(tableId)
    .filter(x => x.id !== guestId)
    .reduce((s, x) => s + x.count, 0);

  if (currentOccupancy + g.count > t.capacity) {
    showToast(`⚠️ ${t.name} 剩餘座位不足（還剩 ${t.capacity - currentOccupancy} 席），${g.name} 共 ${g.count} 人`, 'warning');
    // Still allow over-assignment but warn
  }

  pushHistory();
  g.tableId = tableId;
  saveToStorage();
  render();
  showToast(`✓ ${g.name} 已安排至 ${t.name}`, 'success');
}

function removeFromTable(guestId) {
  const g = state.guests.find(x => x.id === guestId);
  if (!g) return;
  pushHistory();
  g.tableId = null;
  saveToStorage();
  render();
  showToast(`↩ ${g.name} 已移回未安排列表`);
}

/* ============================================================
   GUEST CRUD
   ============================================================ */
function openAddGuest() {
  editingGuestId = null;
  document.getElementById('guest-modal-title').textContent = '新增賓客';
  document.getElementById('g-name').value = '';
  document.getElementById('g-group').value = '';
  document.getElementById('g-count').value = 1;
  document.getElementById('g-color').value = PRESET_COLORS[state.guests.length % PRESET_COLORS.length];
  document.getElementById('g-note').value = '';
  renderColorSwatches();
  openModal('guest-modal');
  setTimeout(() => document.getElementById('g-name').focus(), 100);
}
function openEditGuest(id) {
  const g = state.guests.find(x => x.id === id);
  if (!g) return;
  editingGuestId = id;
  document.getElementById('guest-modal-title').textContent = '編輯賓客';
  document.getElementById('g-name').value = g.name;
  document.getElementById('g-group').value = g.group || '';
  document.getElementById('g-count').value = g.count;
  document.getElementById('g-color').value = g.color;
  document.getElementById('g-note').value = g.note || '';
  renderColorSwatches(g.color);
  openModal('guest-modal');
}
function saveGuest() {
  const name = document.getElementById('g-name').value.trim();
  if (!name) { showToast('請輸入姓名', 'error'); return; }
  const group = document.getElementById('g-group').value.trim();
  const count = Math.max(1, parseInt(document.getElementById('g-count').value) || 1);
  const color = document.getElementById('g-color').value;
  const note = document.getElementById('g-note').value.trim();

  pushHistory();
  if (editingGuestId !== null) {
    const g = state.guests.find(x => x.id === editingGuestId);
    if (g) { g.name = name; g.group = group; g.count = count; g.color = color; g.note = note; }
    showToast('✓ 已更新賓客資料', 'success');
  } else {
    // Check duplicate name
    if (state.guests.some(g => g.name === name)) {
      showToast(`⚠️ 已有同名賓客「${name}」，請確認`, 'warning');
    }
    state.guests.push({ id: state.nextGuestId++, name, group, count, color, note, tableId: null });
    showToast('✓ 已新增賓客', 'success');
  }
  closeModal('guest-modal');
  saveToStorage();
  render();
}
function confirmDeleteGuest(id) {
  const g = state.guests.find(x => x.id === id);
  if (!g) return;
  openConfirm(`確定刪除賓客「${g.name}」？此操作可復原。`, () => {
    pushHistory();
    state.guests = state.guests.filter(x => x.id !== id);
    saveToStorage(); render();
    showToast('🗑 已刪除賓客');
  });
}
function adjustNum(delta) {
  const el = document.getElementById('g-count');
  el.value = Math.max(1, (parseInt(el.value)||1) + delta);
}

/* ============================================================
   TABLE CRUD
   ============================================================ */
function addTable() {
  editingTableId = null;
  const num = state.tables.length + 1;
  document.getElementById('table-modal-title').textContent = '新增桌次';
  document.getElementById('t-name').value = `第 ${num} 桌`;
  document.getElementById('t-cap').value = 10;
  openModal('table-modal');
}
function openEditTable(id) {
  const t = state.tables.find(x => x.id === id);
  if (!t) return;
  editingTableId = id;
  document.getElementById('table-modal-title').textContent = '編輯桌次';
  document.getElementById('t-name').value = t.name;
  document.getElementById('t-cap').value = t.capacity;
  openModal('table-modal');
}
function saveTable() {
  const name = document.getElementById('t-name').value.trim() || '未命名桌';
  const capacity = Math.max(1, parseInt(document.getElementById('t-cap').value)||10);
  pushHistory();
  if (editingTableId !== null) {
    const t = state.tables.find(x => x.id === editingTableId);
    if (t) { t.name = name; t.capacity = capacity; }
    showToast('✓ 已更新桌次', 'success');
  } else {
    state.tables.push({ id: state.nextTableId++, name, capacity });
    showToast('✓ 已新增桌次', 'success');
  }
  closeModal('table-modal');
  saveToStorage(); render();
}
function adjustTableCap(delta) {
  const el = document.getElementById('t-cap');
  el.value = Math.max(1, (parseInt(el.value)||10) + delta);
}
function confirmDeleteTable(id) {
  const t = state.tables.find(x => x.id === id);
  if (!t) return;
  const guestsAt = getTableGuests(id);
  const msg = guestsAt.length
    ? `確定刪除「${t.name}」？該桌 ${guestsAt.length} 位賓客將移回未安排列表。`
    : `確定刪除「${t.name}」？`;
  openConfirm(msg, () => {
    pushHistory();
    state.guests.forEach(g => { if (g.tableId === id) g.tableId = null; });
    state.tables = state.tables.filter(x => x.id !== id);
    saveToStorage(); render();
    showToast('🗑 已刪除桌次');
  });
}

/* ============================================================
   BATCH OPERATIONS
   ============================================================ */
function toggleSelectAll() {
  const checked = document.getElementById('select-all-checkbox').checked;
  document.querySelectorAll('.guest-cb').forEach(cb => cb.checked = checked);
  updateBatchBtn();
}
function updateBatchBtn() {
  const count = document.querySelectorAll('.guest-cb:checked').length;
  const btn = document.getElementById('batch-delete-btn');
  btn.disabled = count === 0;
  btn.textContent = count ? `🗑 刪除選取 (${count})` : '🗑 刪除選取';
}
function batchDelete() {
  const ids = [...document.querySelectorAll('.guest-cb:checked')].map(cb => parseInt(cb.dataset.id));
  if (!ids.length) return;
  openConfirm(`確定刪除選取的 ${ids.length} 位賓客？`, () => {
    pushHistory();
    state.guests = state.guests.filter(g => !ids.includes(g.id));
    saveToStorage(); render();
    showToast(`🗑 已刪除 ${ids.length} 位賓客`);
  });
}
function clearAllAssignments() {
  openConfirm('確定清除所有座位安排？賓客資料保留，但所有桌次分配將清空。', () => {
    pushHistory();
    state.guests.forEach(g => g.tableId = null);
    saveToStorage(); render();
    showToast('↺ 已清除所有座位安排');
  });
}
function confirmClearAll() {
  openConfirm('確定清空所有資料（賓客＋桌次）？此操作可復原。', () => {
    pushHistory();
    state.guests = [];
    state.tables = [];
    state.nextGuestId = 1;
    state.nextTableId = 1;
    saveToStorage(); render();
    showToast('🗑 已清空所有資料');
  });
}

/* ============================================================
   AUTO ASSIGN
   ============================================================ */
function autoAssign() {
  const unassigned = state.guests.filter(g => !g.tableId);
  if (!unassigned.length) { showToast('所有賓客已安排座位 🎉', 'success'); return; }
  pushHistory();
  let assignedCount = 0;
  for (const g of unassigned) {
    // Find table with most space that can fit this guest
    const t = state.tables
      .map(t => ({
        t,
        avail: t.capacity - getTableGuests(t.id).reduce((s, x) => s + x.count, 0)
      }))
      .filter(x => x.avail >= g.count)
      .sort((a, b) => a.avail - b.avail)[0]; // least remaining (pack tables)
    if (t) { g.tableId = t.t.id; assignedCount++; }
  }
  saveToStorage(); render();
  const remaining = state.guests.filter(g => !g.tableId).length;
  if (remaining) showToast(`⚡ 已分配 ${assignedCount} 位，${remaining} 位因座位不足未能安排`, 'warning');
  else showToast(`⚡ 已自動分配所有賓客 🎉`, 'success');
}

/* ============================================================
   EXCEL IMPORT / EXPORT
   ============================================================ */
function openImportModal() { importRows = []; document.getElementById('import-preview').classList.add('hidden'); document.getElementById('confirm-import-btn').disabled = true; document.getElementById('file-input').value = ''; openModal('import-modal'); }

function handleFileImport(e) {
  const file = e.target?.files?.[0] || e;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const wb = XLSX.read(evt.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      processImportRows(rows);
    } catch(err) {
      showToast('無法讀取檔案，請確認格式', 'error');
    }
  };
  reader.readAsBinaryString(file);
}

function processImportRows(rows) {
  importRows = rows.map((r, i) => {
    // Flexible column matching
    const name = String(r['姓名'] || r['name'] || r['Name'] || '').trim();
    const group = String(r['屬性'] || r['group'] || r['類別'] || r['Group'] || '').trim();
    const count = parseInt(r['人數'] || r['count'] || r['Count'] || 1) || 1;
    const note = String(r['備註'] || r['note'] || r['Note'] || '').trim();
    const color = PRESET_COLORS[(state.guests.length + i) % PRESET_COLORS.length];
    const isDup = !!state.guests.find(g => g.name === name);
    return { name, group, count, note, color, isDup };
  }).filter(r => r.name);

  if (!importRows.length) { showToast('未找到有效資料，請確認欄位格式', 'error'); return; }

  const preview = document.getElementById('import-preview');
  preview.classList.remove('hidden');
  preview.innerHTML = `<table>
    <tr><th>姓名</th><th>屬性</th><th>人數</th><th>備註</th><th>狀態</th></tr>
    ${importRows.map(r => `
      <tr class="${r.isDup ? 'warn-row' : ''}">
        <td>${escHtml(r.name)}</td>
        <td>${escHtml(r.group)}</td>
        <td>${r.count}</td>
        <td>${escHtml(r.note)}</td>
        <td>${r.isDup ? '⚠️ 重複' : '✓'}</td>
      </tr>`).join('')}
  </table>`;
  document.getElementById('confirm-import-btn').disabled = false;
}

function confirmImport() {
  if (!importRows.length) return;
  pushHistory();
  const dups = importRows.filter(r => r.isDup).length;
  importRows.forEach(r => {
    state.guests.push({ id: state.nextGuestId++, name: r.name, group: r.group, count: r.count, color: r.color, note: r.note, tableId: null });
  });
  closeModal('import-modal');
  saveToStorage(); render();
  let msg = `✓ 已匯入 ${importRows.length} 位賓客`;
  if (dups) msg += `（${dups} 位姓名重複，請確認）`;
  showToast(msg, dups ? 'warning' : 'success');
  importRows = [];
}

function exportExcel() {
  if (!state.guests.length) { showToast('尚無賓客資料可匯出', 'warning'); return; }
  const rows = state.guests.map(g => {
    const t = g.tableId ? state.tables.find(x => x.id === g.tableId) : null;
    return { 姓名: g.name, 屬性: g.group||'', 人數: g.count, 備註: g.note||'', 桌次: t ? t.name : '未安排' };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '賓客名單');

  // Table summary sheet
  const tableRows = state.tables.map(t => {
    const guests = getTableGuests(t.id);
    const seated = guests.reduce((s, g) => s + g.count, 0);
    return { 桌名: t.name, 座位上限: t.capacity, 已安排人數: seated, 剩餘座位: t.capacity - seated, 賓客: guests.map(g=>g.name).join('、') };
  });
  const ws2 = XLSX.utils.json_to_sheet(tableRows);
  XLSX.utils.book_append_sheet(wb, ws2, '桌次統計');

  XLSX.writeFile(wb, `婚禮座位_${new Date().toLocaleDateString('zh-TW').replace(/\//g,'-')}.xlsx`);
  showToast('✓ Excel 已匯出', 'success');
}

/* ============================================================
   COLOR SWATCHES
   ============================================================ */
function renderColorSwatches(current) {
  const cur = current || document.getElementById('g-color').value;
  const el = document.getElementById('color-swatches');
  el.innerHTML = PRESET_COLORS.map(c => `
    <div class="color-swatch ${c === cur ? 'active' : ''}" 
         style="background:${c}" 
         onclick="selectColor('${c}')" title="${c}"></div>
  `).join('');
  document.getElementById('g-color').addEventListener('input', function() {
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  });
}
function selectColor(color) {
  document.getElementById('g-color').value = color;
  renderColorSwatches(color);
}

/* ============================================================
   UNDO / REDO
   ============================================================ */
function pushHistory() {
  // Trim future
  history = history.slice(0, historyIndex + 1);
  history.push(JSON.stringify(state));
  if (history.length > MAX_HISTORY) history.shift();
  historyIndex = history.length - 1;
  updateUndoRedo();
}
function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  state = JSON.parse(history[historyIndex]);
  saveToStorage(); render();
  showToast('↩ 已復原');
}
function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  state = JSON.parse(history[historyIndex]);
  saveToStorage(); render();
  showToast('↪ 已重做');
}
function updateUndoRedo() {
  document.getElementById('btn-undo').disabled = historyIndex <= 0;
  document.getElementById('btn-redo').disabled = historyIndex >= history.length - 1;
}

/* ============================================================
   STORAGE
   ============================================================ */
let saveTimer;
function saveToStorage() {
  clearTimeout(saveTimer);
  const indicator = document.getElementById('save-indicator');
  if (indicator) { indicator.textContent = '● 儲存中…'; indicator.className = 'saving'; }
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem('wedding_seating_v2', JSON.stringify(state));
      if (indicator) { indicator.textContent = '● 已自動儲存'; indicator.className = ''; }
    } catch(e) {
      showToast('⚠️ 儲存失敗，請檢查瀏覽器設定', 'error');
    }
  }, 400);
}
function loadFromStorage() {
  try {
    const raw = localStorage.getItem('wedding_seating_v2');
    if (raw) {
      const loaded = JSON.parse(raw);
      // Merge to keep defaults
      state.guests = loaded.guests || [];
      state.tables = loaded.tables || [];
      state.nextGuestId = loaded.nextGuestId || (Math.max(0, ...state.guests.map(g=>g.id)) + 1);
      state.nextTableId = loaded.nextTableId || (Math.max(0, ...state.tables.map(t=>t.id)) + 1);
    }
  } catch(e) { /* ignore */ }
}

/* ============================================================
   MODAL HELPERS
   ============================================================ */
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  // Close overlay if no modals open
  const anyOpen = document.querySelectorAll('.modal:not(.hidden)').length > 0;
  if (!anyOpen) document.getElementById('modal-overlay').classList.add('hidden');
}
document.getElementById('modal-overlay').addEventListener('click', () => {
  document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
  document.getElementById('modal-overlay').classList.add('hidden');
});

let confirmCallback = null;
function openConfirm(msg, cb) {
  document.getElementById('confirm-message').textContent = msg;
  confirmCallback = cb;
  document.getElementById('confirm-ok-btn').onclick = () => { closeModal('confirm-modal'); if (confirmCallback) confirmCallback(); confirmCallback = null; };
  openModal('confirm-modal');
}

/* ============================================================
   VIEW SWITCHING
   ============================================================ */
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`view-${name}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-view="${name}"]`)?.classList.add('active');
  render();
}

/* ============================================================
   TOAST
   ============================================================ */
function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast${type ? ' '+type : ''}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 320);
  }, 2800);
}

/* ============================================================
   UTILS
   ============================================================ */
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
