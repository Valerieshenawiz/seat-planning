// ============================================================
// STATE
// ============================================================
const STORE_KEY = 'wedding_v2';
const MAX_UNDO = 30;
const PALETTE = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6',
                 '#ef4444','#14b8a6','#f97316','#84cc16','#06b6d4','#a78bfa'];

let S = { guests:[], tables:[], gid:1, tid:1 };
let undos=[], redos=[];
let editGid=null, editTid=null, cbConfirm=null;
let importRows=[];
let selIds=new Set();
let filterGroup='';
let dragGuestId=null;

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded',()=>{
  load();
  if(!S.tables.length) resetTables();
  bind();
  renderAll();
});

function resetTables(keep){
  if(!keep){
    S.guests.forEach(g=>g.tid=null);
    S.tables=[];
    S.tid=1;
  }
  for(let i=1;i<=25;i++) S.tables.push({id:S.tid++,name:`第 ${i} 桌`,cap:10});
  save(); renderAll();
}

// ============================================================
// PERSIST
// ============================================================
function save(){
  localStorage.setItem(STORE_KEY,JSON.stringify(S));
  const d=document.getElementById('save-dot');
  if(d){d.style.background='#16a34a';}
}
function load(){
  try{ const r=localStorage.getItem(STORE_KEY); if(r) S=JSON.parse(r); }catch(e){}
}

// ============================================================
// UNDO / REDO
// ============================================================
function snap(){ undos.push(JSON.stringify(S)); if(undos.length>MAX_UNDO)undos.shift(); redos=[]; updUR(); }
function undo(){ if(!undos.length)return; redos.push(JSON.stringify(S)); S=JSON.parse(undos.pop()); save(); renderAll(); updUR(); toast('已復原'); }
function redo(){ if(!redos.length)return; undos.push(JSON.stringify(S)); S=JSON.parse(redos.pop()); save(); renderAll(); updUR(); toast('已重做'); }
function updUR(){
  document.getElementById('btn-undo').disabled=!undos.length;
  document.getElementById('btn-redo').disabled=!redos.length;
}

// ============================================================
// RENDER ALL
// ============================================================
function renderAll(){
  renderPool();
  renderCanvas();
  renderGuestTable();
  renderMgmt();
  renderStats();
  updMini();
  updFilters();
  updDatalist();
  updFilterSel();
}

// ============================================================
// MINI STATS
// ============================================================
function updMini(){
  const tot=S.guests.reduce((s,g)=>s+g.cnt,0);
  const asgn=S.guests.filter(g=>g.tid).reduce((s,g)=>s+g.cnt,0);
  set('mini-total',tot); set('mini-assigned',asgn); set('mini-unassigned',tot-asgn);
}

// ============================================================
// LEFT PANEL — guest pool
// ============================================================
function renderPool(){
  const pool=document.getElementById('guest-pool');
  const q=(document.getElementById('search-unassigned').value||'').toLowerCase();
  const unassigned=S.guests.filter(g=>!g.tid);
  const tot=unassigned.reduce((s,g)=>s+g.cnt,0);
  set('unassigned-badge',tot);

  const list=unassigned.filter(g=>{
    const ms=!q||g.name.toLowerCase().includes(q)||(g.grp||'').toLowerCase().includes(q);
    const mg=!filterGroup||g.grp===filterGroup;
    return ms&&mg;
  });

  if(!list.length){
    pool.innerHTML=`<div class="empty"><div class="empty-icon">${filterGroup||q?'🔍':'🎉'}</div><p>${filterGroup||q?'無符合結果':'所有賓客已安排！'}</p></div>`;
    return;
  }
  pool.innerHTML=list.map(g=>`
    <div class="g-card" draggable="true" data-gid="${g.id}">
      <div class="g-dot" style="background:${g.clr}"></div>
      <span class="g-name">${esc(g.name)}</span>
      ${g.cnt>1?`<span class="g-cnt">×${g.cnt}</span>`:''}
      ${g.grp?`<span class="g-grp">${esc(g.grp)}</span>`:''}
    </div>`).join('');

  pool.querySelectorAll('.g-card').forEach(card=>{
    card.addEventListener('dragstart', e=>{
      dragGuestId=parseInt(card.dataset.gid);
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain', String(dragGuestId));
    });
    card.addEventListener('dragend',()=>{ card.classList.remove('dragging'); dragGuestId=null; });
  });
}

function updFilters(){
  const groups=[...new Set(S.guests.map(g=>g.grp).filter(Boolean))];
  const c=document.getElementById('group-filters');
  c.innerHTML=groups.map(g=>{
    const clr=S.guests.find(gg=>gg.grp===g)?.clr||'#999';
    return `<span class="ftag${filterGroup===g?' on':''}" data-g="${esc(g)}" style="color:${clr}">${esc(g)}</span>`;
  }).join('');
  c.querySelectorAll('.ftag').forEach(t=>t.addEventListener('click',()=>{
    filterGroup=filterGroup===t.dataset.g?'':t.dataset.g;
    renderPool(); updFilters();
  }));
}

// ============================================================
// CIRCULAR TABLE CANVAS
// ============================================================
function renderCanvas(){
  const canvas=document.getElementById('tables-canvas');
  if(!S.tables.length){
    canvas.innerHTML=`<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🪑</div><p>尚無桌次</p></div>`;
    return;
  }
  canvas.innerHTML=S.tables.map(t=>buildTableHTML(t)).join('');

  // Bind drag-over / drop
  canvas.querySelectorAll('.round-table-wrap').forEach(wrap=>{
    const tid=parseInt(wrap.dataset.tid);
    wrap.addEventListener('dragover',e=>{
      e.preventDefault();
      wrap.classList.add('drag-over');
    });
    wrap.addEventListener('dragleave',e=>{
      if(!wrap.contains(e.relatedTarget)) wrap.classList.remove('drag-over');
    });
    wrap.addEventListener('drop',e=>{
      e.preventDefault();
      wrap.classList.remove('drag-over');
      const gid=parseInt(e.dataTransfer.getData('text/plain'));
      if(gid) dropOnTable(gid,tid);
    });
  });

  // Seat remove
  canvas.querySelectorAll('.seat-dot:not(.empty-slot)').forEach(dot=>{
    const rm=dot.querySelector('.sd-remove');
    if(rm) rm.addEventListener('click',e=>{
      e.stopPropagation();
      const gid=parseInt(dot.dataset.gid);
      const g=S.guests.find(g=>g.id===gid);
      if(!g)return;
      snap(); g.tid=null; save(); renderAll();
      toast(`${g.name} 已移回未安排`,'info');
    });
  });

  // Table actions
  canvas.querySelectorAll('[data-act="edit-t"]').forEach(b=>{
    b.addEventListener('click',e=>{ e.stopPropagation(); openTableModal(parseInt(b.dataset.tid)); });
  });
  canvas.querySelectorAll('[data-act="del-t"]').forEach(b=>{
    b.addEventListener('click',e=>{ e.stopPropagation(); confirmDelTable(parseInt(b.dataset.tid)); });
  });
}

function buildTableHTML(t){
  const seated=S.guests.filter(g=>g.tid===t.id);
  const used=seated.reduce((s,g)=>s+g.cnt,0);
  const pct=Math.min(100,Math.round(used/t.cap*100));
  const full=used>=t.cap, over=used>t.cap;

  // Build individual seat list (one per person-slot)
  const slots=[];
  seated.forEach(g=>{
    for(let i=0;i<g.cnt;i++){
      slots.push({gid:g.id, name:g.name, clr:g.clr, cnt:g.cnt});
    }
  });
  // Fill empty slots
  const emptyCount=Math.max(0,t.cap-used);
  for(let i=0;i<Math.min(emptyCount,t.cap);i++) slots.push(null);

  // Limit visible to cap seats shown (max 12 around circle)
  const showSlots=slots.slice(0,Math.max(slots.length, t.cap));

  // Position seats around the circle
  const centerX=90, centerY=90, radius=72, dotSize=44;
  const totalDots=Math.max(t.cap, slots.length);
  const dotsHTML=showSlots.map((slot,i)=>{
    const angle=((i/Math.max(totalDots,1))*2*Math.PI)-(Math.PI/2);
    const x=centerX+radius*Math.cos(angle)-dotSize/2;
    const y=centerY+radius*Math.sin(angle)-dotSize/2;
    if(!slot) return `<div class="seat-dot empty-slot" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${dotSize}px;height:${dotSize}px"></div>`;
    // Font size based on name length
    const fs=slot.name.length<=2?12:slot.name.length<=3?10:slot.name.length<=4?9:8;
    // Determine text color (white or black) based on bg brightness
    const hex=slot.clr.replace('#','');
    const r2=parseInt(hex.slice(0,2),16), g2=parseInt(hex.slice(2,4),16), b2=parseInt(hex.slice(4,6),16);
    const bright=(r2*299+g2*587+b2*114)/1000;
    const txtClr=bright<140?'#fff':'#1a1a18';
    return `<div class="seat-dot" data-gid="${slot.gid}"
      style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${dotSize}px;height:${dotSize}px;background:${slot.clr};color:${txtClr};font-size:${fs}px;line-height:1.15;padding:2px;text-align:center;word-break:break-all;">
      ${esc(slot.name)}
      <div class="sd-tip">${esc(slot.name)}${slot.cnt>1?` (共${slot.cnt}人)`:''}</div>
      <div class="sd-remove">×</div>
    </div>`;
  }).join('');

  const statusClass=over?'overflow':full?'full':'';
  return `
    <div class="round-table-wrap ${statusClass}" data-tid="${t.id}">
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

function dropOnTable(guestId, tableId){
  const g=S.guests.find(g=>g.id===guestId);
  const t=S.tables.find(t=>t.id===tableId);
  if(!g||!t) return;
  if(g.tid===tableId){ toast('已在此桌','info'); return; }
  const used=S.guests.filter(gg=>gg.tid===tableId).reduce((s,gg)=>s+gg.cnt,0);
  if(used+g.cnt>t.cap){
    if(!confirm(`${t.name} 目前 ${used}/${t.cap}，加入 ${g.name}（${g.cnt}人）將超過上限，是否繼續？`)) return;
  }
  snap(); g.tid=tableId; save(); renderAll();
  toast(`${g.name} → ${t.name}`,'ok');
}

// ============================================================
// GUEST TABLE
// ============================================================
function renderGuestTable(){
  const tbody=document.getElementById('guest-tbody');
  const q=(document.getElementById('search-guests')?.value||'').toLowerCase();
  const fg=document.getElementById('filter-group')?.value||'';
  const list=S.guests.filter(g=>{
    const ms=!q||g.name.toLowerCase().includes(q)||(g.grp||'').toLowerCase().includes(q);
    const mg=!fg||g.grp===fg;
    return ms&&mg;
  });
  if(!list.length){
    tbody.innerHTML=`<tr><td colspan="7"><div class="empty"><div class="empty-icon">👥</div><p>尚無賓客</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML=list.map(g=>{
    const tbl=g.tid?S.tables.find(t=>t.id===g.tid):null;
    const checked=selIds.has(g.id);
    return `<tr class="${checked?'sel':''}" data-gid="${g.id}">
      <td><input type="checkbox" class="gcb" data-id="${g.id}" ${checked?'checked':''}></td>
      <td><b>${esc(g.name)}</b>${g.note?`<div style="font-size:11px;color:#aaa">${esc(g.note)}</div>`:''}</td>
      <td>${g.grp?`<span class="chip" style="background:${g.clr}22;color:${g.clr}">${esc(g.grp)}</span>`:'<span style="color:#ccc">—</span>'}</td>
      <td>${g.cnt}</td>
      <td><span class="swatch" style="background:${g.clr}"></span></td>
      <td>${tbl?`<span class="chip">${esc(tbl.name)}</span>`:'<span style="color:#ccc">未安排</span>'}</td>
      <td><div class="row-btns">
        <button class="rb" data-act="edit" data-gid="${g.id}" title="編輯">✎</button>
        ${tbl?`<button class="rb" data-act="unset" data-gid="${g.id}" title="取消座位">↩</button>`:''}
        <button class="rb del" data-act="del" data-gid="${g.id}" title="刪除">✕</button>
      </div></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('.gcb').forEach(cb=>{
    cb.addEventListener('change',()=>{
      const id=parseInt(cb.dataset.id);
      cb.checked?selIds.add(id):selIds.delete(id);
      updSelAll();
    });
  });
  tbody.querySelectorAll('[data-act="edit"]').forEach(b=>b.addEventListener('click',()=>openGuestModal(parseInt(b.dataset.gid))));
  tbody.querySelectorAll('[data-act="unset"]').forEach(b=>b.addEventListener('click',()=>{
    const g=S.guests.find(g=>g.id===parseInt(b.dataset.gid));
    if(g){snap();g.tid=null;save();renderAll();toast(`${g.name} 取消座位`,'info');}
  }));
  tbody.querySelectorAll('[data-act="del"]').forEach(b=>b.addEventListener('click',()=>confirmDelGuest(parseInt(b.dataset.gid))));
}
function updSelAll(){
  const all=document.querySelectorAll('.gcb');
  const sa=document.getElementById('sel-all');
  if(sa) sa.checked=all.length>0&&[...all].every(c=>c.checked);
}

// ============================================================
// MGMT GRID
// ============================================================
function renderMgmt(){
  const g=document.getElementById('tables-mgmt');
  if(!S.tables.length){ g.innerHTML='<p style="color:#aaa">尚無桌次</p>'; return; }
  g.innerHTML=S.tables.map(t=>{
    const used=S.guests.filter(g=>g.tid===t.id).reduce((s,g)=>s+g.cnt,0);
    const pct=Math.min(100,Math.round(used/t.cap*100));
    const cls=used>t.cap?'over':used>=t.cap?'full':'';
    return `<div class="mgmt-card">
      <div class="mgmt-card-hd">
        <span class="mgmt-name">${esc(t.name)}</span>
        <div class="mgmt-acts">
          <button class="rb" data-act="edit" data-tid="${t.id}" title="編輯">✎</button>
          <button class="rb del" data-act="del" data-tid="${t.id}" title="刪除">✕</button>
        </div>
      </div>
      <div class="mgmt-stat">${used}/${t.cap} 人${used>=t.cap?' · <span style="color:var(--orange)">已滿</span>':` · 剩 ${t.cap-used}`}</div>
      <div class="prog"><div class="prog-fill ${cls}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
  g.querySelectorAll('[data-act="edit"]').forEach(b=>b.addEventListener('click',()=>openTableModal(parseInt(b.dataset.tid))));
  g.querySelectorAll('[data-act="del"]').forEach(b=>b.addEventListener('click',()=>confirmDelTable(parseInt(b.dataset.tid))));
}

// ============================================================
// STATS
// ============================================================
function renderStats(){
  const tot=S.guests.reduce((s,g)=>s+g.cnt,0);
  const asgn=S.guests.filter(g=>g.tid).reduce((s,g)=>s+g.cnt,0);
  set('s-total',tot); set('s-assigned',asgn); set('s-unassigned',tot-asgn); set('s-tables',S.tables.length);
  const ts=document.getElementById('table-status');
  if(ts) ts.innerHTML=S.tables.map(t=>{
    const u=S.guests.filter(g=>g.tid===t.id).reduce((s,g)=>s+g.cnt,0);
    return `<div class="ts-item${u>=t.cap?' full':''}">
      <div class="ts-name">${esc(t.name)}</div>
      <div class="ts-n" style="color:${u>=t.cap?'var(--orange)':u===0?'#ccc':'var(--text)'}">${u}</div>
      <div class="ts-cap">/ ${t.cap}</div>
    </div>`;
  }).join('');
  const grps={};
  S.guests.forEach(g=>{ const k=g.grp||'未分組'; if(!grps[k])grps[k]={n:0,clr:g.clr}; grps[k].n+=g.cnt; });
  const gd=document.getElementById('group-dist');
  if(gd) gd.innerHTML=Object.entries(grps).map(([k,v])=>`
    <div class="gd-item">
      <div class="gd-dot" style="background:${v.clr}"></div>
      <span style="font-size:13px;font-weight:500">${esc(k)}</span>
      <span style="font-size:12px;color:#888">${v.n} 人</span>
    </div>`).join('');
}

// ============================================================
// GUEST MODAL
// ============================================================
function openGuestModal(gid=null){
  editGid=gid;
  set('mg-title', gid?'編輯賓客':'新增賓客');
  const g=gid?S.guests.find(g=>g.id===gid):null;
  fv('g-name', g?g.name:'');
  fv('g-group', g?g.grp||'':'');
  fv('g-count', g?g.cnt:1);
  fv('g-color', g?g.clr:PALETTE[S.guests.length%PALETTE.length]);
  fv('g-note', g?g.note||'':'');
  buildSwatches('cp-swatches','g-color');
  showModal('guest');
  setTimeout(()=>document.getElementById('g-name').focus(),80);
}
function saveGuest(){
  const name=(document.getElementById('g-name').value||'').trim();
  if(!name){ toast('請輸入姓名','err'); return; }
  const grp=(document.getElementById('g-group').value||'').trim();
  const cnt=parseInt(document.getElementById('g-count').value)||1;
  const clr=document.getElementById('g-color').value;
  const note=(document.getElementById('g-note').value||'').trim();
  snap();
  if(editGid){
    const g=S.guests.find(g=>g.id===editGid);
    Object.assign(g,{name,grp,cnt,clr,note});
    toast(`${name} 已更新`,'ok');
  } else {
    S.guests.push({id:S.gid++,name,grp,cnt,clr,note,tid:null});
    toast(`${name} 已新增`,'ok');
  }
  save(); closeModal('guest'); renderAll();
}

// ============================================================
// TABLE MODAL
// ============================================================
function openTableModal(tid=null){
  editTid=tid;
  set('mt-title', tid?'編輯桌次':'新增桌次');
  const t=tid?S.tables.find(t=>t.id===tid):null;
  fv('t-name', t?t.name:`第 ${S.tables.length+1} 桌`);
  fv('t-cap', t?t.cap:10);
  showModal('table');
  setTimeout(()=>document.getElementById('t-name').focus(),80);
}
function saveTable(){
  const name=(document.getElementById('t-name').value||'').trim()||`桌 ${S.tables.length+1}`;
  const cap=parseInt(document.getElementById('t-cap').value)||10;
  snap();
  if(editTid){
    const t=S.tables.find(t=>t.id===editTid);
    Object.assign(t,{name,cap});
    toast(`${name} 已更新`,'ok');
  } else {
    S.tables.push({id:S.tid++,name,cap});
    toast(`${name} 已新增`,'ok');
  }
  save(); closeModal('table'); renderAll();
}

// ============================================================
// DELETE CONFIRM
// ============================================================
function confirmDelGuest(gid){
  const g=S.guests.find(g=>g.id===gid);
  if(!g)return;
  set('conf-title','刪除賓客');
  set('conf-msg',`確定刪除「${g.name}」？可復原。`);
  document.getElementById('conf-ok').textContent='確認刪除';
  cbConfirm=()=>{ snap(); S.guests=S.guests.filter(g=>g.id!==gid); save(); renderAll(); toast(`${g.name} 已刪除`,'info'); };
  showModal('confirm');
}
function confirmDelTable(tid){
  const t=S.tables.find(t=>t.id===tid);
  if(!t)return;
  const has=S.guests.some(g=>g.tid===tid);
  set('conf-title','刪除桌次');
  set('conf-msg',`確定刪除「${t.name}」？${has?'此桌賓客將移回未安排。':''}可復原。`);
  document.getElementById('conf-ok').textContent='確認刪除';
  cbConfirm=()=>{ snap(); S.guests.forEach(g=>{ if(g.tid===tid)g.tid=null; }); S.tables=S.tables.filter(t=>t.id!==tid); save(); renderAll(); toast(`${t.name} 已刪除`,'info'); };
  showModal('confirm');
}

// ============================================================
// BATCH
// ============================================================
function openBatch(){
  if(!selIds.size){ toast('請先勾選賓客','warn'); return; }
  set('batch-n',selIds.size);
  buildSwatches('bp-swatches','b-color');
  showModal('batch');
}
function saveBatch(){
  const grp=(document.getElementById('b-group').value||'').trim();
  const clr=document.getElementById('b-color').value;
  snap();
  S.guests.forEach(g=>{ if(selIds.has(g.id)){ if(grp)g.grp=grp; g.clr=clr; } });
  save(); closeModal('batch'); renderAll();
  toast(`已更新 ${selIds.size} 位賓客`,'ok');
  selIds.clear();
}

// ============================================================
// IMPORT / EXPORT
// ============================================================
function openImport(){
  importRows=[];
  document.getElementById('import-preview').classList.add('hidden');
  document.getElementById('btn-do-import').disabled=true;
  document.getElementById('import-warns').innerHTML='';
  showModal('import');
}
function handleFile(file){
  if(!file)return;
  const r=new FileReader();
  r.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array',cellStyles:true});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      parseRows(rows,ws);
    }catch(err){ toast('讀取失敗: '+err.message,'err'); }
  };
  r.readAsArrayBuffer(file);
}

// Convert Excel column index to letter (0→A, 1→B …)
function colLetter(n){ let s=''; n++; while(n>0){ s=String.fromCharCode(65+(n-1)%26)+s; n=Math.floor((n-1)/26); } return s; }

// Try to extract background color from a cell's style
function cellBgColor(ws, rowIdx, colIdx){
  const addr=colLetter(colIdx)+(rowIdx+1);
  const cell=ws[addr];
  if(!cell) return null;
  // cellStyles mode puts fill info in cell.s
  const fgColor=cell.s?.fgColor||cell.s?.bgColor||cell.s?.patternFgColor;
  if(fgColor){
    // rgb or argb
    let hex=fgColor.rgb||fgColor.argb||'';
    if(hex.length===8) hex=hex.slice(2); // strip alpha from ARGB
    if(/^[0-9A-Fa-f]{6}$/.test(hex) && hex!=='000000' && hex!=='FFFFFF' && hex!=='ffffff'){
      return '#'+hex.toUpperCase();
    }
  }
  return null;
}

function parseRows(rows,ws){
  importRows=[];
  const warns=[];
  const existing=S.guests.map(g=>g.name);
  const start=(rows[0]&&String(rows[0][0]).includes('姓名'))?1:0;
  for(let i=start;i<rows.length;i++){
    const row=rows[i];
    const name=String(row[0]||'').trim();
    if(!name)continue;
    const grp=String(row[1]||'').trim();
    const cnt=parseInt(row[2])||1;
    // Priority: 1) text in col D  2) cell background of col D  3) palette
    let clr=String(row[3]||'').trim();
    if(!clr || clr==='—' || clr==='代表色（可留空）'){
      clr=cellBgColor(ws,i,3)||PALETTE[importRows.length%PALETTE.length];
    }
    // Normalize: ensure starts with #
    if(clr && !clr.startsWith('#') && /^[0-9A-Fa-f]{6}$/.test(clr)) clr='#'+clr;
    if(!clr.startsWith('#')) clr=PALETTE[importRows.length%PALETTE.length];
    const dup=existing.includes(name);
    if(dup) warns.push(`「${name}」已存在`);
    importRows.push({name,grp,cnt,clr,dup});
  }
  set('import-n',importRows.length);
  const wEl=document.getElementById('import-warns');
  wEl.innerHTML=warns.map(w=>`<div class="iw">⚠ ${w}，將新增為重複</div>`).join('');
  const pv=document.getElementById('import-preview');
  const pl=document.getElementById('preview-list');
  if(importRows.length){
    pv.classList.remove('hidden');
    pl.innerHTML=`<table><thead><tr><th>姓名</th><th>群組</th><th>人數</th><th>顏色</th></tr></thead><tbody>
      ${importRows.map(r=>`<tr class="${r.dup?'dup':''}"><td>${esc(r.name)}</td><td>${esc(r.grp)}</td><td>${r.cnt}</td><td><span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${r.clr};border:1px solid rgba(0,0,0,.1)"></span> ${r.clr}</td></tr>`).join('')}
    </tbody></table>`;
    document.getElementById('btn-do-import').disabled=false;
  }
}
function doImport(){
  if(!importRows.length)return;
  snap();
  importRows.forEach(r=>S.guests.push({id:S.gid++,name:r.name,grp:r.grp,cnt:r.cnt,clr:r.clr,note:'',tid:null}));
  save(); renderAll(); closeModal('import');
  toast(`已匯入 ${importRows.length} 位賓客`,'ok');
}
function doExport(){
  const rows=[['姓名','群組','人數','代表色','座位','備註']];
  S.guests.forEach(g=>{
    const tn=g.tid?S.tables.find(t=>t.id===g.tid)?.name||'':'';
    rows.push([g.name,g.grp||'',g.cnt,g.clr,tn,g.note||'']);
  });
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[{wch:12},{wch:14},{wch:6},{wch:10},{wch:14},{wch:20}];
  XLSX.utils.book_append_sheet(wb,ws,'賓客名單');
  const t2=[['桌次','容量','已坐','賓客']];
  S.tables.forEach(t=>{
    const s=S.guests.filter(g=>g.tid===t.id);
    t2.push([t.name,t.cap,s.reduce((a,g)=>a+g.cnt,0),s.map(g=>g.name).join('、')]);
  });
  const ws2=XLSX.utils.aoa_to_sheet(t2);
  XLSX.utils.book_append_sheet(wb,ws2,'桌次總覽');
  XLSX.writeFile(wb,'婚禮座位表.xlsx');
  toast('已匯出 Excel','ok');
}
function dlTemplate(){
  const rows=[['姓名','群組','人數','代表色（可留空）'],['王小明','高中同學',2,'#6366f1'],['李美玲','新娘親戚',1,'#ec4899']];
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb,ws,'範本');
  XLSX.writeFile(wb,'賓客名單範本.xlsx');
}

// ============================================================
// MODAL HELPERS
// ============================================================
function showModal(name){
  document.getElementById('overlay').classList.remove('hidden');
  document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'));
  document.getElementById('modal-'+name).classList.remove('hidden');
}
function closeModal(name){
  document.getElementById('modal-'+name).classList.add('hidden');
  const any=[...document.querySelectorAll('.modal')].some(m=>!m.classList.contains('hidden'));
  if(!any) document.getElementById('overlay').classList.add('hidden');
}
function handleOverlayClick(e){
  if(e.target===e.currentTarget){
    document.querySelectorAll('.modal:not(.hidden)').forEach(m=>closeModal(m.id.replace('modal-','')));
  }
}

function buildSwatches(cid,inputId){
  const c=document.getElementById(cid);
  const inp=document.getElementById(inputId);
  c.innerHTML=PALETTE.map(p=>`<div class="sw${inp.value===p?' on':''}" style="background:${p}" data-c="${p}"></div>`).join('');
  c.querySelectorAll('.sw').forEach(sw=>sw.addEventListener('click',()=>{
    inp.value=sw.dataset.c;
    c.querySelectorAll('.sw').forEach(s=>s.classList.remove('on'));
    sw.classList.add('on');
  }));
  inp.addEventListener('input',()=>c.querySelectorAll('.sw').forEach(s=>s.classList.remove('on')));
}

function updDatalist(){
  const groups=[...new Set(S.guests.map(g=>g.grp).filter(Boolean))];
  document.querySelectorAll('#grp-dl').forEach(dl=>{ dl.innerHTML=groups.map(g=>`<option value="${esc(g)}">`).join(''); });
}
function updFilterSel(){
  const sel=document.getElementById('filter-group');
  if(!sel)return;
  const groups=[...new Set(S.guests.map(g=>g.grp).filter(Boolean))];
  const cur=sel.value;
  sel.innerHTML='<option value="">所有群組</option>'+groups.map(g=>`<option value="${esc(g)}"${cur===g?' selected':''}>${esc(g)}</option>`).join('');
}

// ============================================================
// TOAST
// ============================================================
function toast(msg, type='info'){
  const icons={ok:'✓',warn:'⚠',err:'✗',info:'·'};
  const c=document.getElementById('toasts');
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  el.textContent=(icons[type]||'·')+' '+msg;
  c.appendChild(el);
  setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(),260); },2600);
}

// ============================================================
// UTILS
// ============================================================
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function set(id,v){ const el=document.getElementById(id); if(el) el.textContent=v; }
function fv(id,v){ const el=document.getElementById(id); if(el) el.value=v; }

// ============================================================
// BIND ALL EVENTS
// ============================================================
function bind(){
  // Tabs
  document.querySelectorAll('.tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
    });
  });

  // Undo/redo
  document.getElementById('btn-undo').addEventListener('click',undo);
  document.getElementById('btn-redo').addEventListener('click',redo);
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey){ e.preventDefault(); undo(); }
    if((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.key==='z'&&e.shiftKey))){ e.preventDefault(); redo(); }
    if(e.key==='Escape') document.querySelectorAll('.modal:not(.hidden)').forEach(m=>closeModal(m.id.replace('modal-','')));
  });

  // Import/export
  document.getElementById('btn-import').addEventListener('click',openImport);
  document.getElementById('btn-export').addEventListener('click',doExport);

  // Clear all
  document.getElementById('btn-clear-all').addEventListener('click',()=>{
    set('conf-title','清除全部資料');
    set('conf-msg','確定要清除所有賓客與座位資料嗎？桌次將重設為預設 25 桌。此操作無法復原。');
    document.getElementById('conf-ok').textContent='確認清除';
    cbConfirm=()=>{
      S={ guests:[], tables:[], gid:1, tid:1 };
      undos=[]; redos=[]; selIds=new Set(); filterGroup='';
      localStorage.removeItem(STORE_KEY);
      resetTables();
      updUR();
      toast('已清除全部資料','ok');
    };
    showModal('confirm');
  });

  // Guest
  document.getElementById('btn-add-guest').addEventListener('click',()=>openGuestModal());
  document.getElementById('btn-save-guest').addEventListener('click',saveGuest);
  document.getElementById('g-name').addEventListener('keydown',e=>{ if(e.key==='Enter') saveGuest(); });
  document.getElementById('g-dec').addEventListener('click',()=>{ const i=document.getElementById('g-count'); if(+i.value>1)i.value=+i.value-1; });
  document.getElementById('g-inc').addEventListener('click',()=>{ const i=document.getElementById('g-count'); i.value=+i.value+1; });

  // Table
  document.getElementById('btn-add-table').addEventListener('click',()=>openTableModal());
  document.getElementById('btn-add-table-s').addEventListener('click',()=>openTableModal());
  document.getElementById('btn-save-table').addEventListener('click',saveTable);
  document.getElementById('t-dec').addEventListener('click',()=>{ const i=document.getElementById('t-cap'); if(+i.value>1)i.value=+i.value-1; });
  document.getElementById('t-inc').addEventListener('click',()=>{ const i=document.getElementById('t-cap'); i.value=+i.value+1; });
  document.getElementById('btn-reset-tables').addEventListener('click',()=>{
    set('conf-title','重設桌次');
    set('conf-msg','重設為預設 25 桌（10人/桌）？現有座位安排將清除。');
    document.getElementById('conf-ok').textContent='確認重設';
    cbConfirm=()=>{ snap(); resetTables(); toast('已重設為25桌','ok'); };
    showModal('confirm');
  });

  // Confirm
  document.getElementById('conf-ok').addEventListener('click',()=>{ if(cbConfirm){cbConfirm();cbConfirm=null;} closeModal('confirm'); });
  document.getElementById('conf-cancel').addEventListener('click',()=>{ closeModal('confirm'); cbConfirm=null; });

  // Select all
  document.getElementById('sel-all').addEventListener('change',e=>{
    document.querySelectorAll('.gcb').forEach(cb=>{ cb.checked=e.target.checked; const id=parseInt(cb.dataset.id); e.target.checked?selIds.add(id):selIds.delete(id); });
    renderGuestTable();
  });

  // Batch
  document.getElementById('btn-batch').addEventListener('click',openBatch);
  document.getElementById('btn-save-batch').addEventListener('click',saveBatch);

  // Search
  document.getElementById('search-unassigned').addEventListener('input',renderPool);
  document.getElementById('search-guests').addEventListener('input',renderGuestTable);
  document.getElementById('filter-group').addEventListener('change',renderGuestTable);

  // Import modal
  const dz=document.getElementById('drop-zone');
  dz.addEventListener('dragover',e=>{ e.preventDefault(); dz.classList.add('on'); });
  dz.addEventListener('dragleave',()=>dz.classList.remove('on'));
  dz.addEventListener('drop',e=>{ e.preventDefault(); dz.classList.remove('on'); handleFile(e.dataTransfer.files[0]); });
  dz.addEventListener('click',()=>document.getElementById('file-input').click());
  document.getElementById('btn-pick').addEventListener('click',e=>{ e.stopPropagation(); document.getElementById('file-input').click(); });
  document.getElementById('file-input').addEventListener('change',e=>{ if(e.target.files[0]) handleFile(e.target.files[0]); });
  document.getElementById('btn-do-import').addEventListener('click',doImport);
  document.getElementById('btn-tmpl').addEventListener('click',dlTemplate);
}
