// ────────────────────────────────────────────────
// UTILS
// ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('vi-VN').format(Math.round(n));
const fmtDate = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('vi-VN') : '';
const today = () => new Date().toISOString().slice(0, 10);
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000); // 8s timeout
  try {
    const r = await fetch(path, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`Lỗi ${r.status}: ${await r.text()}`);
    return r.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Yêu cầu quá lâu, hãy thử lại.');
    throw e;
  }
}

// Disable a submit button and show loading text; returns restore function
function setSubmitting(btnEl, loading) {
  if (!btnEl) return;
  if (loading) {
    btnEl.disabled = true;
    btnEl._origText = btnEl.innerHTML;
    btnEl.innerHTML = '<span style="opacity:.7">⏳ Đang lưu...</span>';
  } else {
    btnEl.disabled = false;
    if (btnEl._origText) btnEl.innerHTML = btnEl._origText;
  }
}

// Find the primary submit button inside the modal
function modalBtn() {
  return $('modal-content')?.querySelector('.btn-primary');
}

// Show inline error inside modal (non-blocking, no alert())
function modalError(msg) {
  let el = $('modal-error-msg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'modal-error-msg';
    el.style.cssText = 'background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);color:#ef4444;border-radius:10px;padding:10px 14px;font-size:13px;font-weight:600;margin-bottom:4px;';
    $('modal-content')?.querySelector('.modal-footer')?.before(el);
  }
  el.textContent = '⚠️ ' + msg;
  el.style.display = 'block';
}

function confirmDel(msg, cb) {
  if (confirm(msg)) {
    Promise.resolve().then(cb).catch(e => alert('Lỗi khi xóa: ' + e.message));
  }
}

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
  const n = parseInt(hex, 16);
  return `${(n>>16)&255},${(n>>8)&255},${n&255}`;
}

// ────────────────────────────────────────────────
// CLOCK
// ────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  $('clock').textContent   = now.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  $('datedisp').textContent = now.toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
}
setInterval(updateClock, 1000); updateClock();

// ────────────────────────────────────────────────
// NAV
// ────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    $('page-' + item.dataset.page).classList.add('active');
    loadPage(item.dataset.page);
  });
});
function loadPage(p) {
  if (p==='dashboard') loadDashboard();
  if (p==='habits')    loadHabits();
  if (p==='todos')     loadTodos();
  if (p==='projects')  loadProjects();
  if (p==='finance')   loadFinance();
}

// ────────────────────────────────────────────────
// DASHBOARD
// ────────────────────────────────────────────────
async function loadDashboard() {
  const d = await api('/api/dashboard');
  $('ds-habits').textContent   = `${d.habits.completed}/${d.habits.total}`;
  $('ds-todos').textContent    = d.todos.pending;
  $('ds-projects').textContent = d.projects.active;
  $('ds-income').textContent   = fmt(d.finance.income);
  $('ds-expense').textContent  = `chi tiêu: ${fmt(d.finance.expense)}`;
  const td = today();
  const renderList = (items, elId) => {
    const el = $(elId);
    if (!items.length) { el.innerHTML = '<div class="empty"><p>Không có việc nào</p></div>'; return; }
    el.innerHTML = items.map(t => {
      const due = t.due_date ? `<span class="badge badge-due${t.due_date<td?' overdue':''}">${fmtDate(t.due_date)}</span>` : '';
      return `<div class="quick-item"><span class="badge ${priClass(t.priority)}">${t.priority}</span><span style="flex:1;font-weight:500">${esc(t.title)}</span>${due}</div>`;
    }).join('');
  };
  renderList(d.recent_todos, 'dash-todos-list');
  renderList(d.upcoming,     'dash-upcoming-list');
}

// ────────────────────────────────────────────────
// HABITS — state
// ────────────────────────────────────────────────
const habitHistoryCache = {};
const habitChartInst    = {};
const habitExpandState  = {};

function getHSt(id) {
  if (!habitExpandState[id]) habitExpandState[id] = { chartOpen:false, logOtherOpen:false, period:'month' };
  return habitExpandState[id];
}

// ────────────────────────────────────────────────
// HABITS — render list
// ────────────────────────────────────────────────
async function loadHabits() {
  const habits = await api('/api/habits');
  const wrap   = $('habit-list-wrap');
  if (!habits.length) {
    wrap.innerHTML = '<div class="empty"><span class="e-icon">🔥</span><p>Chưa có thói quen nào.</p></div>';
    return;
  }
  wrap.innerHTML = `<div class="habit-list">${habits.map(habitCardHTML).join('')}</div>`;
  for (const h of habits) {
    await renderContribGraph(h);
    const st = getHSt(h.id);
    if (st.chartOpen && h.type === 'numeric') _openChartPanel(h.id, h.color, h.daily_goal||1, h.unit||'', st.period);
  }
}

function habitCardHTML(h) {
  const isNum = h.type === 'numeric';
  const rgb   = hexToRgb(h.color || '#6366f1');
  const goal  = h.daily_goal || 1;
  const val   = h.today_value || 0;
  const pct   = Math.min(100, Math.round(val/goal*100));
  const done  = h.completed_today;
  const st    = getHSt(h.id);

  const leftCtrl = isNum
    ? `<div class="habit-ring-wrap">
        <svg class="habit-ring" width="38" height="38" viewBox="0 0 38 38">
          <circle class="habit-ring-bg" cx="19" cy="19" r="16"/>
          <circle class="habit-ring-fg" cx="19" cy="19" r="16"
            stroke="rgba(${rgb},.85)"
            stroke-dasharray="${(2*Math.PI*16).toFixed(2)}"
            stroke-dashoffset="${(2*Math.PI*16*(1-pct/100)).toFixed(2)}"/>
        </svg>
        <div class="habit-ring-pct" style="color:rgba(${rgb},1)">${pct}%</div>
      </div>`
    : `<div class="habit-check${done?' done':''}" style="--h-color:${h.color}"
           onclick="logHabit(${h.id})">${done?'✓':''}</div>`;

  const logToday = isNum ? `
    <div class="habit-log-today">
      <input class="habit-num-input" id="num-${h.id}" type="number" min="0" step="any"
             value="${val>0?val:''}" placeholder="0" style="--h-color:${h.color}"
             onkeydown="if(event.key==='Enter')logNumeric(${h.id},today())">
      <span class="log-unit-label">${esc(h.unit||'')}</span>
      <button class="habit-log-btn${done?' logged':''}" style="${done?'':'background:'+h.color}"
              onclick="logNumeric(${h.id},today())">${done?'✓ Đã ghi':'Ghi hôm nay'}</button>
    </div>` : '';

  const progressMini = isNum ? `
    <div class="habit-progress-mini">
      <div class="habit-pbar"><div class="habit-pbar-fill" style="width:${pct}%;background:${h.color}"></div></div>
      <span class="habit-pval">${val}${h.unit?' '+esc(h.unit):''} / ${goal}${h.unit?' '+esc(h.unit):''}</span>
    </div>` : '';

  const typeTag = `<span class="habit-type-tag ${isNum?'type-numeric':'type-boolean'}">${isNum?'123':'✓/✗'}</span>`;

  const logOtherPanel = `
    <div class="habit-log-other${st.logOtherOpen?' open':''}" id="log-other-${h.id}">
      <div class="habit-log-other-inner">
        <label>Ghi ngày:</label>
        <input type="date" class="log-date-input" id="log-date-${h.id}" value="${today()}" max="${today()}">
        ${isNum?`
          <input type="number" class="log-val-input" id="log-val-${h.id}" min="0" step="any" placeholder="0"
                 onkeydown="if(event.key==='Enter')logOtherDate(${h.id})">
          <span class="log-unit-label">${esc(h.unit||'')}</span>
        `:''}
        <button class="btn btn-primary btn-sm" onclick="logOtherDate(${h.id})">${isNum?'Ghi':'Bật / Tắt'}</button>
      </div>
    </div>`;

  const chartBtn = isNum ? `
    <button class="habit-expand-btn${st.chartOpen?' open':''}" id="expand-btn-${h.id}" onclick="toggleChartPanel(${h.id})">
      <span class="chevron">▾</span> Biểu đồ tiến độ
    </button>
    <div class="habit-detail${st.chartOpen?' open':''}" id="habit-detail-${h.id}">
      <div class="habit-detail-inner" id="habit-detail-inner-${h.id}"></div>
    </div>` : '';

  return `
  <div class="habit-card" id="habit-card-${h.id}" style="--h-color:${h.color}">
    <div class="habit-row">
      ${leftCtrl}
      <div class="habit-info">
        <div class="habit-header-row">
          <span class="habit-name">${esc(h.icon)} ${esc(h.name)}</span>${typeTag}
        </div>
        ${h.description?`<div class="habit-desc">${esc(h.description)}</div>`:''}
        ${logToday}${progressMini}
      </div>
      <div class="habit-right">
        <div class="habit-streak">🔥 ${h.streak} ngày</div>
        <div class="habit-actions">
          <button class="icon-btn edit-btn" onclick="openEditModal('habit',${h.id})">✏️</button>
          <button class="icon-btn" onclick="confirmDel('Xóa thói quen này?',()=>deleteHabit(${h.id}))">🗑</button>
        </div>
      </div>
    </div>
    <div class="habit-contrib-section">
      <div class="habit-contrib-topbar">
        <div class="habit-contrib-stats">
          <span class="contrib-stat-pill">📅 365 ngày qua</span>
          <span class="contrib-stat-pill" id="contrib-total-${h.id}">Hoàn thành <strong>–</strong> ngày</span>
        </div>
        <button class="log-other-btn${st.logOtherOpen?' active':''}" id="log-other-btn-${h.id}" onclick="toggleLogOther(${h.id})">
          📅 Ghi ngày khác
        </button>
      </div>
      <div class="contrib-scroll-wrap"><div id="contrib-svg-${h.id}" class="contrib-svg-inline"></div></div>
      <div class="contrib-legend-row">
        <span>Ít hơn</span>
        ${[0,1,2,3,4].map(l=>`<div class="contrib-swatch" style="background:${contribColor(h.color,l)}"></div>`).join('')}
        <span>Nhiều hơn</span>
      </div>
    </div>
    ${logOtherPanel}
    ${chartBtn}
  </div>`;
}

// ────────────────────────────────────────────────
// HABITS — contribution graph
// ────────────────────────────────────────────────
const MONTHS_VI = ['Th1','Th2','Th3','Th4','Th5','Th6','Th7','Th8','Th9','Th10','Th11','Th12'];

function contribColor(hex, level) {
  if (level === 0) return '#e8eaf0';
  return `rgba(${hexToRgb(hex)},${[0,.18,.40,.65,.88][level]})`;
}
function valueToLevel(htype, row, goal) {
  if (!row || row.value <= 0) return 0;
  if (htype === 'boolean') return row.done ? 4 : 0;
  const r = row.value/goal;
  return r < .33 ? 1 : r < .66 ? 2 : r < 1 ? 3 : 4;
}

async function renderContribGraph(h) {
  const svgEl = $(`contrib-svg-${h.id}`);
  if (!svgEl) return;
  if (!habitHistoryCache[h.id]) habitHistoryCache[h.id] = await api(`/api/habits/${h.id}/history`);
  const history = habitHistoryCache[h.id];
  const map = {}; history.forEach(d => { map[d.date] = d; });
  const goal = h.daily_goal||1; const htype = h.type||'boolean';
  const CELL=14, GAP=3, STEP=CELL+GAP, LEFT_PAD=26, TOP_PAD=22;
  const endDate = new Date(); endDate.setHours(0,0,0,0);
  const startDate = new Date(endDate); startDate.setDate(endDate.getDate()-364);
  const dow = startDate.getDay(); startDate.setDate(startDate.getDate()+(dow===0?-6:1-dow));
  const totalDays = Math.ceil((endDate-startDate)/864e5)+1;
  const totalWeeks = Math.ceil(totalDays/7);
  const W = LEFT_PAD+totalWeeks*STEP+4, H = TOP_PAD+7*STEP+2;
  const todayStr = today();
  let cells='', monthLabels='', lastMonth=-1, doneCount=0;
  for (let w=0; w<totalWeeks; w++) {
    for (let d=0; d<7; d++) {
      const cd = new Date(startDate); cd.setDate(startDate.getDate()+w*7+d);
      if (cd > endDate) continue;
      const ds = cd.toISOString().slice(0,10);
      const entry = map[ds]; const level = valueToLevel(htype, entry, goal);
      if (entry?.done) doneCount++;
      const fill = contribColor(h.color, level);
      const x = LEFT_PAD+w*STEP, y = TOP_PAD+d*STEP;
      const isToday = ds===todayStr;
      const tip = htype==='boolean'
        ? `${ds}: ${entry?.done?'✓ Hoàn thành':'Chưa'}`
        : `${ds}: ${entry?.value??0}${h.unit?' '+h.unit:''}`;
      const onclick = htype==='boolean'
        ? `logOtherDateCell(${h.id},'${ds}')`
        : `prefillLogOther(${h.id},'${ds}')`;
      cells += `<rect class="c-cell${isToday?' c-today':''}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" fill="${fill}" onclick="${onclick}"><title>${tip}</title></rect>`;
      if (d===0 && cd.getDate()<=7 && cd.getMonth()!==lastMonth) {
        monthLabels += `<text x="${x}" y="${TOP_PAD-6}" font-size="10" fill="#9ca3c0" font-family="Mona Sans,sans-serif">${MONTHS_VI[cd.getMonth()]}</text>`;
        lastMonth = cd.getMonth();
      }
    }
  }
  const dowLabels = [{d:0,l:'T2'},{d:2,l:'T4'},{d:4,l:'T6'}].map(({d,l})=>
    `<text x="${LEFT_PAD-4}" y="${TOP_PAD+d*STEP+CELL}" font-size="9" fill="#9ca3c0" font-family="Mona Sans,sans-serif" text-anchor="end">${l}</text>`
  ).join('');
  svgEl.innerHTML = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${monthLabels}${dowLabels}${cells}</svg>`;
  const el = $(`contrib-total-${h.id}`);
  if (el) el.innerHTML = `Hoàn thành <strong>${doneCount}</strong> ngày`;
}

// ────────────────────────────────────────────────
// HABITS — log actions
// ────────────────────────────────────────────────
async function logHabit(id) {
  await api(`/api/habits/${id}/log`, 'POST', { date: today() });
  invalidateCache(id); await loadHabits(); loadDashboard();
}
async function logNumeric(id, dateStr) {
  const val = parseFloat($(`num-${id}`)?.value);
  if (isNaN(val) || val < 0) return;
  await api(`/api/habits/${id}/log`, 'POST', { value: val, date: dateStr });
  invalidateCache(id); await loadHabits(); loadDashboard();
}
function toggleLogOther(id) {
  const st = getHSt(id); st.logOtherOpen = !st.logOtherOpen;
  $(`log-other-${id}`)?.classList.toggle('open', st.logOtherOpen);
  $(`log-other-btn-${id}`)?.classList.toggle('active', st.logOtherOpen);
  if (st.logOtherOpen) $(`log-date-${id}`)?.focus();
}
async function logOtherDate(id) {
  const dateStr = $(`log-date-${id}`)?.value; if (!dateStr) return;
  const isNum   = $(`habit-card-${id}`)?.querySelector('.type-numeric') !== null;
  if (isNum) {
    const val = parseFloat($(`log-val-${id}`)?.value);
    if (isNaN(val) || val < 0) return;
    await api(`/api/habits/${id}/log`, 'POST', { value: val, date: dateStr });
  } else {
    await api(`/api/habits/${id}/log`, 'POST', { date: dateStr });
  }
  invalidateCache(id); await loadHabits(); loadDashboard();
}
async function logOtherDateCell(id, dateStr) {
  await api(`/api/habits/${id}/log`, 'POST', { date: dateStr });
  invalidateCache(id); await loadHabits(); loadDashboard();
}
function prefillLogOther(id, dateStr) {
  const st = getHSt(id);
  if (!st.logOtherOpen) { st.logOtherOpen=true; $(`log-other-${id}`)?.classList.add('open'); $(`log-other-btn-${id}`)?.classList.add('active'); }
  const di = $(`log-date-${id}`); if (di) di.value = dateStr;
  $(`log-val-${id}`)?.focus();
}
async function deleteHabit(id) {
  await api(`/api/habits/${id}`, 'DELETE');
  invalidateCache(id); delete habitExpandState[id];
  if (habitChartInst[id]) { habitChartInst[id].destroy(); delete habitChartInst[id]; }
  loadHabits(); loadDashboard();
}
function invalidateCache(id) { delete habitHistoryCache[id]; }

// ────────────────────────────────────────────────
// HABITS — chart panel
// ────────────────────────────────────────────────
async function toggleChartPanel(id) {
  const st = getHSt(id); st.chartOpen = !st.chartOpen;
  $(`habit-detail-${id}`)?.classList.toggle('open', st.chartOpen);
  $(`expand-btn-${id}`)?.classList.toggle('open', st.chartOpen);
  if (st.chartOpen) {
    const list = await api('/api/habits');
    const h    = list.find(x=>x.id===id);
    if (h) _openChartPanel(id, h.color, h.daily_goal||1, h.unit||'', st.period);
  }
}
async function _openChartPanel(id, color, goal, unit, period) {
  const inner = $(`habit-detail-inner-${id}`); if (!inner) return;
  inner.innerHTML = `
    <div class="habit-chart-tabs" id="chart-tabs-${id}">
      <button class="chart-tab${period==='week'?' active':''}"  onclick="changeHabitPeriod(${id},'week')">Tuần</button>
      <button class="chart-tab${period==='month'?' active':''}" onclick="changeHabitPeriod(${id},'month')">Tháng</button>
      <button class="chart-tab${period==='year'?' active':''}"  onclick="changeHabitPeriod(${id},'year')">Năm</button>
    </div>
    <div class="habit-chart-canvas-wrap"><canvas id="habit-chart-${id}"></canvas></div>`;
  await renderHabitChart(id, period, color, goal, unit);
}
async function changeHabitPeriod(id, period) {
  getHSt(id).period = period;
  document.querySelectorAll(`#chart-tabs-${id} .chart-tab`).forEach(b =>
    b.classList.toggle('active', b.textContent.trim()==={week:'Tuần',month:'Tháng',year:'Năm'}[period])
  );
  if (habitChartInst[id]) { habitChartInst[id].destroy(); delete habitChartInst[id]; }
  const list = await api('/api/habits'); const h = list.find(x=>x.id===id);
  if (h) await renderHabitChart(id, period, h.color, h.daily_goal||1, h.unit||'');
}
async function renderHabitChart(id, period, color, goal, unit) {
  const canvas = $(`habit-chart-${id}`); if (!canvas) return;
  if (habitChartInst[id]) { habitChartInst[id].destroy(); delete habitChartInst[id]; }
  const data = await api(`/api/habits/${id}/chart?period=${period}`);
  const rgb  = hexToRgb(color);
  const ctx  = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0,0,0,200);
  grad.addColorStop(0,`rgba(${rgb},.20)`); grad.addColorStop(1,`rgba(${rgb},0)`);
  habitChartInst[id] = new Chart(ctx, {
    type: period==='year'?'bar':'line',
    data: { labels: data.map(d=>d.label), datasets:[
      { label: unit||'Giá trị', data:data.map(d=>d.value), borderColor:color,
        backgroundColor: period==='year'?`rgba(${rgb},.65)`:grad,
        fill:period!=='year', tension:.42, pointRadius:period==='year'?0:3,
        pointHoverRadius:6, pointBackgroundColor:color, borderWidth:2, borderRadius:period==='year'?6:0 },
      { label:'Mục tiêu', data:data.map(d=>d.goal||goal), borderColor:'rgba(99,102,241,.30)',
        backgroundColor:'transparent', borderDash:[5,4], borderWidth:1.5, pointRadius:0, type:'line', tension:0 }
    ]},
    options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      plugins:{ legend:{labels:{color:'#7b82a8',font:{family:'Mona Sans',size:11},boxWidth:12,padding:12}},
        tooltip:{backgroundColor:'#fff',titleColor:'#1e2140',bodyColor:'#4a5071',borderColor:'rgba(99,102,241,.15)',borderWidth:1,padding:10,
          callbacks:{label:ctx=>` ${ctx.dataset.label}: ${ctx.parsed.y}${unit?' '+unit:''}`}} },
      scales:{ x:{grid:{color:'rgba(0,0,0,.04)'},ticks:{color:'#9ca3c0',font:{family:'Mona Sans',size:10},maxTicksLimit:12}},
               y:{grid:{color:'rgba(0,0,0,.04)'},ticks:{color:'#9ca3c0',font:{family:'Mona Sans',size:10}},beginAtZero:true} } }
  });
}

// ────────────────────────────────────────────────
// TODOS
// ────────────────────────────────────────────────
const priClass = p => p==='high'?'pri-high':p==='medium'?'pri-medium':'pri-low';
let currentFilter = 'all';

async function loadTodos() {
  let todos = await api('/api/todos');
  if (currentFilter!=='all') todos = todos.filter(t=>t.status===currentFilter);
  const wrap = $('todo-list-wrap');
  if (!todos.length) { wrap.innerHTML='<div class="empty"><span class="e-icon">✅</span><p>Không có việc nào.</p></div>'; return; }
  wrap.innerHTML = `<div class="todo-list">${todos.map(todoHTML).join('')}</div>`;
}
function todoHTML(t) {
  const done = t.status==='done'; const td = today();
  const overdue  = t.due_date && t.due_date<td && !done;
  const dueLabel = t.due_date?`<span class="badge badge-due${overdue?' overdue':''}">${fmtDate(t.due_date)}</span>`:'';
  const inProg   = t.status==='in_progress'?`<span class="badge" style="background:rgba(99,102,241,.08);color:var(--primary);border:1px solid rgba(99,102,241,.2)">In Progress</span>`:'';
  return `<div class="todo-item${done?' done-item':''}">
    <div class="todo-check${done?' checked':''}" onclick="cycleStatus(${t.id},'${t.status}')">${done?'✓':t.status==='in_progress'?'…':''}</div>
    <div class="todo-body">
      <div class="todo-title${done?' striked':''}">${esc(t.title)}</div>
      ${t.description?`<div style="color:var(--muted2);font-size:12px;margin-top:3px">${esc(t.description)}</div>`:''}
      <div class="todo-meta"><span class="badge ${priClass(t.priority)}">${t.priority}</span>${t.category?`<span class="badge badge-cat">${esc(t.category)}</span>`:''}${inProg}${dueLabel}</div>
    </div>
    <div class="todo-actions">
      <button class="icon-btn edit-btn" onclick="openEditModal('todo',${t.id})">✏️</button>
      <button class="icon-btn" onclick="confirmDel('Xóa việc này?',()=>deleteTodo(${t.id}))">🗑</button>
    </div>
  </div>`;
}
async function cycleStatus(id, current) {
  const next = current==='pending'?'in_progress':current==='in_progress'?'done':'pending';
  await api(`/api/todos/${id}`,'PUT',{status:next}); loadTodos(); loadDashboard();
}
async function deleteTodo(id) { await api(`/api/todos/${id}`,'DELETE'); loadTodos(); loadDashboard(); }
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); currentFilter=btn.dataset.filter; loadTodos();
  });
});

// ────────────────────────────────────────────────
// PROJECTS
// ────────────────────────────────────────────────
const projectPanelOpen = {};

async function loadProjects() {
  const projects = await api('/api/projects');
  const wrap = $('project-list-wrap');
  if (!projects.length) { wrap.innerHTML='<div class="empty"><span class="e-icon">🚀</span><p>Chưa có dự án nào.</p></div>'; return; }
  wrap.innerHTML = projects.map(projectHTML).join('');
}
function statusLabel(s) {
  return s==='active'?`<span class="project-status status-active">Đang chạy</span>`
        :s==='completed'?`<span class="project-status status-completed">Hoàn thành</span>`
        :`<span class="project-status status-paused">Tạm dừng</span>`;
}
function projectHTML(p) {
  const doneCount = p.tasks.filter(t=>t.completed).length;
  const isOpen    = !!projectPanelOpen[p.id];
  const tasks = p.tasks.map(t=>`
    <div class="task-item">
      <div class="task-check${t.completed?' done':''}" onclick="toggleTask(${p.id},${t.id})">${t.completed?'✓':''}</div>
      <span class="task-title${t.completed?' done-text':''}" id="task-title-${t.id}">${esc(t.title)}</span>
      <button class="icon-btn edit-btn" style="width:22px;height:22px;font-size:11px" onclick="inlineEditTask(${t.id},${p.id})">✏️</button>
      <button class="icon-btn" style="width:22px;height:22px;font-size:10px" onclick="deleteTask(${p.id},${t.id})">✕</button>
    </div>`).join('');
  return `<div class="project-card">
    <div class="project-header">
      <div class="project-dot" style="background:${p.color};box-shadow:0 0 6px ${p.color}80"></div>
      <div class="project-name">${esc(p.name)}</div>
      ${statusLabel(p.status)}
      <button class="icon-btn edit-btn" onclick="openEditModal('project',${p.id})">✏️</button>
      <button class="icon-btn" onclick="confirmDel('Xóa dự án?',()=>deleteProject(${p.id}))">🗑</button>
    </div>
    ${p.description?`<div style="color:var(--muted2);font-size:13px;margin-bottom:10px">${esc(p.description)}</div>`:''}
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted2);margin-bottom:4px">
      <span>${doneCount}/${p.tasks.length} nhiệm vụ</span><span>${p.progress}%</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${p.progress}%"></div></div>
    <button class="expand-btn" id="task-panel-btn-${p.id}" onclick="toggleTaskPanel(${p.id})">
      ${isOpen?'▴':'▾'} Nhiệm vụ (${p.tasks.length})
    </button>
    <div class="project-tasks${isOpen?' open':''}" id="tasks-${p.id}">
      ${tasks}
      <div class="add-task-row">
        <input id="new-task-${p.id}"
          style="flex:1;background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:7px 11px;color:var(--text);font-family:'Mona Sans',sans-serif;font-size:13px;outline:none"
          placeholder="Thêm nhiệm vụ mới..."
          onkeydown="if(event.key==='Enter')addTask(${p.id})">
        <button class="btn btn-primary btn-sm" onclick="addTask(${p.id})">Thêm</button>
      </div>
    </div>
  </div>`;
}
function toggleTaskPanel(pid) {
  projectPanelOpen[pid] = !projectPanelOpen[pid];
  $(`tasks-${pid}`)?.classList.toggle('open', projectPanelOpen[pid]);
  const btn = $(`task-panel-btn-${pid}`);
  if (btn) btn.textContent = (projectPanelOpen[pid]?'▴':'▾') + ` Nhiệm vụ`;
}
async function toggleTask(pid,tid)  { await api(`/api/projects/${pid}/tasks/${tid}`,'PUT'); loadProjects(); }
async function deleteTask(pid,tid)  { await api(`/api/projects/${pid}/tasks/${tid}`,'DELETE'); loadProjects(); }
async function deleteProject(id)    { await api(`/api/projects/${id}`,'DELETE'); delete projectPanelOpen[id]; loadProjects(); loadDashboard(); }
async function addTask(pid) {
  const inp = $(`new-task-${pid}`);
  if (!inp?.value.trim()) return;
  projectPanelOpen[pid] = true;
  await api(`/api/projects/${pid}/tasks`,'POST',{title:inp.value.trim()});
  await loadProjects();
  $(`new-task-${pid}`)?.focus();
}
function inlineEditTask(tid, pid) {
  const span = $(`task-title-${tid}`); if (!span) return;
  const old  = span.textContent;
  span.contentEditable='true';
  span.style.cssText += ';outline:1.5px solid var(--primary);border-radius:4px;padding:1px 5px';
  span.focus();
  const range=document.createRange(); range.selectNodeContents(span);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  span.onblur = async () => {
    span.contentEditable='false'; span.style.outline=''; span.style.padding='';
    const newTitle = span.textContent.trim();
    if (newTitle && newTitle!==old) { await api(`/api/project-tasks/${tid}`,'PUT',{title:newTitle}); await loadProjects(); }
    else span.textContent = old;
  };
  span.onkeydown = e => { if(e.key==='Enter'){e.preventDefault();span.blur();} if(e.key==='Escape'){span.textContent=old;span.blur();} };
}

// ────────────────────────────────────────────────
// FINANCE
// ────────────────────────────────────────────────
const ACC_TYPES = {checking:'Thanh toán',savings:'Tiết kiệm',investment:'Đầu tư'};
const TXN_CATS_EXP = ['ăn uống','đi lại','nhà cửa','mua sắm','giải trí','sức khỏe','giáo dục','tiết kiệm','đầu tư','khác'];
const TXN_CATS_INC = ['lương','thưởng','đầu tư','kinh doanh','khác'];
let chartFinance=null, chartCats=null;

async function loadFinance() {
  const [accounts,txns,summary] = await Promise.all([api('/api/accounts'),api('/api/transactions'),api('/api/finance/summary')]);
  renderAccounts(accounts); renderTxns(txns); renderFinanceCharts(summary);
  loadGoals();
}
function renderAccounts(accounts) {
  const wrap = $('account-grid-wrap');
  if (!accounts.length) { wrap.innerHTML='<div style="color:var(--muted2);font-size:13px;padding:10px 0">Chưa có tài khoản nào.</div>'; return; }
  wrap.innerHTML = accounts.map(a=>`
    <div class="account-card" style="--accent:${a.color}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><div class="account-type">${ACC_TYPES[a.type]||a.type}</div><div class="account-name">${esc(a.name)}</div></div>
        <div style="display:flex;gap:4px">
          <button class="icon-btn edit-btn" onclick="openEditModal('account',${a.id})">✏️</button>
          <button class="icon-btn" onclick="confirmDel('Xóa tài khoản này?',()=>deleteAccount(${a.id}))">🗑</button>
        </div>
      </div>
      <div class="account-balance">${fmt(a.balance)}</div>
      <div class="account-currency">${a.currency}</div>
    </div>`).join('');
}
function renderTxns(txns) {
  const wrap = $('txn-list-wrap');
  if (!txns.length) { wrap.innerHTML='<div class="empty"><p>Chưa có giao dịch nào.</p></div>'; return; }
  wrap.innerHTML = `<div class="txn-list">${txns.slice(0,50).map(t=>`
    <div class="txn-item txn-${t.type}">
      <div class="txn-icon">${t.type==='income'?'📥':'📤'}</div>
      <div class="txn-info">
        <div class="txn-desc">${esc(t.description||t.category)}</div>
        <div class="txn-meta">${esc(t.category)} · ${fmtDate(t.date)}${t.account_name?' · '+esc(t.account_name):''}</div>
      </div>
      <div class="txn-amount">${t.type==='income'?'+':'-'}${fmt(t.amount)}</div>
      <span class="txn-edit" onclick="openEditModal('txn',${t.id})">✏️</span>
      <span class="txn-del"  onclick="confirmDel('Xóa giao dịch?',()=>deleteTxn(${t.id}))">✕</span>
    </div>`).join('')}</div>`;
}
function renderFinanceCharts(summary) {
  if (chartFinance) chartFinance.destroy();
  chartFinance = new Chart($('chart-finance'),{
    type:'bar', data:{labels:summary.monthly.map(m=>m.label),datasets:[
      {label:'Thu nhập',data:summary.monthly.map(m=>m.income), backgroundColor:'rgba(16,185,129,.65)',borderRadius:6},
      {label:'Chi tiêu',data:summary.monthly.map(m=>m.expense),backgroundColor:'rgba(239,68,68,.55)', borderRadius:6}
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{labels:{color:'#7b82a8',font:{family:'Mona Sans',size:11}}}},
      scales:{x:{grid:{color:'rgba(0,0,0,.04)'},ticks:{color:'#9ca3c0',font:{family:'Mona Sans',size:10}}},
              y:{grid:{color:'rgba(0,0,0,.04)'},ticks:{color:'#9ca3c0',font:{family:'Mona Sans',size:10},callback:v=>fmt(v)}}}}
  });
  if (chartCats) chartCats.destroy();
  const cats = summary.expense_by_cat;
  if (cats.length) {
    const CLRS=['#6366f1','#ec4899','#8b5cf6','#10b981','#f59e0b','#f97316','#06b6d4'];
    chartCats = new Chart($('chart-cats'),{
      type:'doughnut',
      data:{labels:cats.map(c=>c.category),datasets:[{data:cats.map(c=>c.total),backgroundColor:CLRS.slice(0,cats.length),borderWidth:2,borderColor:'#fff',hoverOffset:8}]},
      options:{responsive:true,maintainAspectRatio:false,cutout:'65%',
        plugins:{legend:{position:'right',labels:{color:'#7b82a8',font:{family:'Mona Sans',size:11},padding:10}}}}
    });
  }
}
async function deleteAccount(id) { await api(`/api/accounts/${id}`,'DELETE'); loadFinance(); }
async function deleteTxn(id)     { await api(`/api/transactions/${id}`,'DELETE'); loadFinance(); loadDashboard(); }

// ────────────────────────────────────────────────
// MODALS — color picker
// ────────────────────────────────────────────────
const PALETTE = ['#6366f1','#ec4899','#8b5cf6','#10b981','#f59e0b','#f97316','#06b6d4'];
let selectedColor = '#6366f1';
let selectedHabitType = 'boolean';

function colorChips(current='#6366f1') {
  return PALETTE.map(c=>`<div class="color-chip${c===current?' sel':''}" style="background:${c}" onclick="selectColor('${c}')"></div>`).join('');
}
function selectColor(c) {
  selectedColor = c;
  document.querySelectorAll('.color-chip').forEach(el=>el.classList.toggle('sel',el.getAttribute('onclick')?.includes(`'${c}'`)));
}
function selectHabitType(type) {
  selectedHabitType=type;
  document.querySelectorAll('.type-option').forEach(el=>el.classList.toggle('active',el.dataset.type===type));
  const gr=$('habit-goal-row'); if(gr) gr.style.display=type==='numeric'?'':'none';
}

// ────────────────────────────────────────────────
// CREATE MODALS
// ────────────────────────────────────────────────
// ────────────────────────────────────────────────
// SAVINGS GOALS
// ────────────────────────────────────────────────
const GOAL_CATS = {
  'xe':         { label:'Xe cộ',      icon:'🚗', cls:'cat-xe' },
  'nha':        { label:'Nhà ở',      icon:'🏠', cls:'cat-nha' },
  'dien-tu':    { label:'Điện tử',    icon:'📱', cls:'cat-dien-tu' },
  'trang-phuc': { label:'Thời trang', icon:'👗', cls:'cat-trang-phuc' },
  'du-lich':    { label:'Du lịch',    icon:'✈️', cls:'cat-du-lich' },
  'giao-duc':   { label:'Giáo dục',   icon:'📚', cls:'cat-giao-duc' },
  'suc-khoe':   { label:'Sức khoẻ',   icon:'💪', cls:'cat-suc-khoe' },
  'other':      { label:'Khác',       icon:'🎯', cls:'cat-other' },
};

const goalHistOpen = {}; // goal id → bool

async function loadGoals() {
  const goals = await api('/api/goals');
  const wrap  = $('goal-list-wrap');
  const bar   = $('goal-summary-bar');

  // Summary bar
  const totalTarget = goals.reduce((s,g) => s + g.target_amount, 0);
  const totalSaved  = goals.reduce((s,g) => s + g.saved_amount,  0);
  const completed   = goals.filter(g => g.saved_amount >= g.target_amount).length;
  bar.innerHTML = `
    <div class="goal-summary-card">
      <div class="goal-summary-icon" style="background:rgba(99,102,241,.1)">🎯</div>
      <div>
        <div class="goal-summary-label">Tổng mục tiêu</div>
        <div class="goal-summary-value">${goals.length}</div>
      </div>
    </div>
    <div class="goal-summary-card">
      <div class="goal-summary-icon" style="background:rgba(16,185,129,.1)">💰</div>
      <div>
        <div class="goal-summary-label">Đã tích lũy</div>
        <div class="goal-summary-value" style="color:var(--green)">${fmt(totalSaved)}</div>
      </div>
    </div>
    <div class="goal-summary-card">
      <div class="goal-summary-icon" style="background:rgba(245,158,11,.1)">🏆</div>
      <div>
        <div class="goal-summary-label">Còn cần</div>
        <div class="goal-summary-value" style="color:var(--yellow)">${fmt(Math.max(0, totalTarget - totalSaved))}</div>
      </div>
    </div>`;

  if (!goals.length) {
    wrap.innerHTML = '<div class="empty"><span class="e-icon">🎯</span><p>Chưa có mục tiêu nào. Hãy thêm thứ bạn muốn mua!</p></div>';
    return;
  }
  wrap.innerHTML = `<div class="goal-grid">${goals.map(goalCardHTML).join('')}</div>`;
}

function goalCardHTML(g) {
  const cat     = GOAL_CATS[g.category] || GOAL_CATS['other'];
  const pct     = g.pct || 0;
  const done    = g.saved_amount >= g.target_amount;
  const rgb     = hexToRgb(g.color || '#6366f1');
  const isOpen  = !!goalHistOpen[g.id];

  // Deadline text
  let deadlineHtml = '';
  if (g.deadline) {
    const dl = g.days_left;
    let cls = 'goal-deadline', txt = '';
    if (dl < 0)       { cls += ' overdue'; txt = `⚠️ Đã quá hạn ${Math.abs(dl)} ngày`; }
    else if (dl === 0) { cls += ' near';   txt = '⏰ Hết hạn hôm nay'; }
    else if (dl <= 30) { cls += ' near';   txt = `⏰ Còn ${dl} ngày`; }
    else               { txt = `📅 ${fmtDate(g.deadline)}`; }
    deadlineHtml = `<span class="${cls}">${txt}</span>`;
  }

  // Deposit history rows
  const depRows = (g.deposits || []).slice(0, 20).map(d => `
    <div class="deposit-item">
      <div>
        <div class="deposit-amount ${d.amount >= 0 ? 'pos' : 'neg'}">${d.amount >= 0 ? '+' : ''}${fmt(d.amount)}</div>
        <div class="deposit-meta">${d.note || '—'} · ${fmtDate(d.date)}</div>
      </div>
      <span class="deposit-del" onclick="deleteDeposit(${g.id},${d.id})">✕</span>
    </div>`).join('');

  // Pct badge color
  const pctColor = done ? 'background:rgba(16,185,129,.12);color:var(--green);border:1px solid rgba(16,185,129,.25)'
                        : pct >= 50 ? 'background:rgba(245,158,11,.1);color:var(--yellow);border:1px solid rgba(245,158,11,.25)'
                        : 'background:rgba(99,102,241,.09);color:var(--primary);border:1px solid rgba(99,102,241,.2)';

  return `
  <div class="goal-card${done?' done':''}" id="goal-card-${g.id}">
    <div class="goal-banner" style="background:linear-gradient(90deg,${g.color},rgba(${rgb},.45))"></div>
    <div class="goal-body">
      <div class="goal-title-row">
        <div class="goal-icon-wrap" style="background:rgba(${rgb},.12)">
          ${esc(g.icon || cat.icon)}
          ${done ? '<div class="goal-done-badge">✓</div>' : ''}
        </div>
        <div class="goal-meta">
          <div class="goal-name">${esc(g.name)}</div>
          ${g.description ? `<div class="goal-desc">${esc(g.description)}</div>` : ''}
          <div class="goal-cat-row">
            <span class="goal-cat-badge ${cat.cls}">${cat.icon} ${cat.label}</span>
            ${deadlineHtml}
          </div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button class="icon-btn edit-btn" onclick="openEditModal('goal',${g.id})">✏️</button>
          <button class="icon-btn" onclick="confirmDel('Xóa mục tiêu này?',()=>deleteGoal(${g.id}))">🗑</button>
        </div>
      </div>

      <div class="goal-amounts">
        <span class="goal-saved" style="color:${done?'var(--green)':g.color}">${fmt(g.saved_amount)}</span>
        <span class="goal-target">/ ${fmt(g.target_amount)} ${g.currency || 'VND'}</span>
        <span class="goal-pct-badge" style="${pctColor}">${pct}%</span>
      </div>

      <div class="goal-pbar-wrap">
        <div class="goal-pbar">
          <div class="goal-pbar-fill" style="width:${pct}%;background:${done?'linear-gradient(90deg,#10b981,#06b6d4)':`linear-gradient(90deg,${g.color},rgba(${rgb},.6))`}"></div>
        </div>
        ${!done ? `<div class="goal-remaining">Còn thiếu <strong>${fmt(g.remaining)} ${g.currency||'VND'}</strong></div>` : `<div class="goal-remaining" style="color:var(--green)">🎉 Đã đạt mục tiêu!</div>`}
      </div>
    </div>

    <!-- History toggle -->
    <button class="goal-history-toggle${isOpen?' open':''}" id="goal-hist-btn-${g.id}" onclick="toggleGoalHist(${g.id})">
      <span>📋 Lịch sử nạp tiền (${(g.deposits||[]).length})</span>
      <span class="chevron">▾</span>
    </button>
    <div class="goal-history${isOpen?' open':''}" id="goal-hist-${g.id}">
      <div class="goal-history-inner">
        ${depRows || '<div style="color:var(--muted2);font-size:12px;text-align:center;padding:8px 0">Chưa có lịch sử</div>'}
      </div>
    </div>

    <!-- Action buttons -->
    <div class="goal-actions">
      <button class="goal-deposit-btn add" style="background:${g.color}" onclick="openDepositModal(${g.id},'add')">
        ＋ Nạp tiền
      </button>
      <button class="goal-deposit-btn withdraw" onclick="openDepositModal(${g.id},'withdraw')">
        − Rút
      </button>
    </div>
  </div>`;
}

function toggleGoalHist(id) {
  goalHistOpen[id] = !goalHistOpen[id];
  $(`goal-hist-${id}`)?.classList.toggle('open', goalHistOpen[id]);
  $(`goal-hist-btn-${id}`)?.classList.toggle('open', goalHistOpen[id]);
}

async function deleteGoal(id) {
  await api(`/api/goals/${id}`, 'DELETE');
  loadFinance();
}

async function deleteDeposit(gid, did) {
  await api(`/api/goals/${gid}/deposits/${did}`, 'DELETE');
  goalHistOpen[gid] = true; // keep history open after deleting
  loadFinance();
}

function openDepositModal(gid, mode) {
  const modal = $('modal-content');
  const isAdd = mode === 'add';
  modal.innerHTML = `
    <h2>${isAdd ? '💰 Nạp tiền tiết kiệm' : '💸 Rút tiền'}</h2>
    <div class="form-row">
      <label>Số tiền *</label>
      <input type="number" id="dep-amount" min="0" step="1000" placeholder="0" autofocus>
      <div class="deposit-quick-btns" id="dep-quick-wrap"></div>
    </div>
    <div class="form-row"><label>Ghi chú</label><input id="dep-note" placeholder="VD: Lương tháng 4..."></div>
    <div class="form-row"><label>Ngày</label><input type="date" id="dep-date" value="${today()}"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="submitDeposit(${gid},${isAdd?1:-1})">${isAdd?'Nạp tiền':'Rút tiền'}</button>
    </div>`;
  // Quick amount buttons — fetch goal target to suggest amounts
  api('/api/goals').then(goals => {
    const g = goals.find(x => x.id === gid);
    if (!g) return;
    const remaining = g.remaining || g.target_amount;
    const suggestions = isAdd
      ? [100000, 500000, 1000000, Math.round(remaining/4/10000)*10000, Math.round(remaining/2/10000)*10000].filter(v=>v>0)
      : [100000, 500000, 1000000];
    const unique = [...new Set(suggestions)].sort((a,b)=>a-b).slice(0,4);
    const qb = $('dep-quick-wrap');
    if (qb) qb.innerHTML = unique.map(v=>
      `<button class="dep-quick" onclick="$('dep-amount').value=${v}">${fmt(v)}</button>`
    ).join('');
  });
  $('overlay').classList.add('show');
}

async function submitDeposit(gid, sign) {
  const amount = parseFloat($('dep-amount')?.value);
  if (!amount || amount <= 0) { modalError('Vui lòng nhập số tiền hợp lệ'); return; }
  const btn = modalBtn(); setSubmitting(btn, true);
  try {
    await api(`/api/goals/${gid}/deposit`, 'POST', {
      amount: amount * sign,
      note:   $('dep-note')?.value || '',
      date:   $('dep-date')?.value || today(),
    });
    goalHistOpen[gid] = true;
    closeModal(); loadFinance();
  } catch(e) { setSubmitting(btn, false); modalError(e.message); }
}

// ────────────────────────────────────────────────────
const MODALS = {
  habit: ()=>`
    <h2>🔥 Thêm thói quen</h2>
    <div class="form-row"><label>Loại thói quen</label>
      <div class="type-toggle">
        <button class="type-option active" data-type="boolean" onclick="selectHabitType('boolean')">✓ / ✗ &nbsp; Có / Không</button>
        <button class="type-option" data-type="numeric" onclick="selectHabitType('numeric')">123 &nbsp; Nhập số liệu</button>
      </div>
    </div>
    <div class="form-row"><label>Tên *</label><input id="m-name" placeholder="VD: Dậy sớm, Đọc sách..."></div>
    <div class="form-row"><label>Mô tả</label><input id="m-desc" placeholder="Tuỳ chọn"></div>
    <div class="form-2col">
      <div class="form-row"><label>Icon</label><input id="m-icon" value="⭐"></div>
      <div class="form-row" id="habit-goal-row" style="display:none">
        <label>Mục tiêu / ngày</label>
        <div style="display:flex;gap:6px">
          <input id="m-goal" type="number" min="1" value="1" style="flex:1">
          <input id="m-unit" placeholder="đơn vị (trang, km...)" style="flex:2">
        </div>
      </div>
    </div>
    <div class="form-row"><label>Màu sắc</label><div class="color-chips">${colorChips()}</div></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="submitCreateHabit()">Thêm</button>
    </div>`,

  todo: ()=>`
    <h2>✅ Thêm việc cần làm</h2>
    <div class="form-row"><label>Tiêu đề *</label><input id="m-title" placeholder="Cần làm gì?"></div>
    <div class="form-row"><label>Mô tả</label><textarea id="m-tdesc" placeholder="Chi tiết..."></textarea></div>
    <div class="form-2col">
      <div class="form-row"><label>Độ ưu tiên</label>
        <select id="m-priority"><option value="low">Thấp</option><option value="medium" selected>Trung bình</option><option value="high">Cao</option></select>
      </div>
      <div class="form-row"><label>Danh mục</label><input id="m-cat" value="general"></div>
    </div>
    <div class="form-row"><label>Hạn chót</label><input type="date" id="m-due"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="submitCreateTodo()">Thêm</button>
    </div>`,

  project: ()=>`
    <h2>🚀 Thêm dự án</h2>
    <div class="form-row"><label>Tên *</label><input id="m-pname" placeholder="Tên dự án"></div>
    <div class="form-row"><label>Mô tả</label><textarea id="m-pdesc" placeholder="Mục tiêu..."></textarea></div>
    <div class="form-2col">
      <div class="form-row"><label>Ngày bắt đầu</label><input type="date" id="m-pstart"></div>
      <div class="form-row"><label>Deadline</label><input type="date" id="m-pend"></div>
    </div>
    <div class="form-row"><label>Màu sắc</label><div class="color-chips">${colorChips()}</div></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="submitCreateProject()">Tạo</button>
    </div>`,

  account: ()=>`
    <h2>💳 Thêm tài khoản</h2>
    <div class="form-row"><label>Tên *</label><input id="m-aname" placeholder="VD: Tài khoản chính..."></div>
    <div class="form-2col">
      <div class="form-row"><label>Loại</label>
        <select id="m-atype"><option value="checking">Thanh toán</option><option value="savings">Tiết kiệm</option><option value="investment">Đầu tư</option></select>
      </div>
      <div class="form-row"><label>Số dư ban đầu</label><input type="number" id="m-abal" value="0"></div>
    </div>
    <div class="form-2col">
      <div class="form-row"><label>Tiền tệ</label><select id="m-acur"><option value="VND">VND</option><option value="USD">USD</option></select></div>
      <div class="form-row"><label>Màu sắc</label><div class="color-chips">${colorChips()}</div></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="submitCreateAccount()">Thêm</button>
    </div>`,

  txn: async ()=>{
    const accounts = await api('/api/accounts');
    const accOpts  = accounts.length?accounts.map(a=>`<option value="${a.id}">${esc(a.name)} (${fmt(a.balance)})</option>`).join(''):'<option value="">-- Không có --</option>';
    return `<h2>💸 Thêm giao dịch</h2>
    <div class="form-2col">
      <div class="form-row"><label>Loại</label>
        <select id="m-ttype" onchange="updateCatList()"><option value="expense">Chi tiêu</option><option value="income">Thu nhập</option></select>
      </div>
      <div class="form-row"><label>Số tiền *</label><input type="number" id="m-tamount" placeholder="0"></div>
    </div>
    <div class="form-2col">
      <div class="form-row"><label>Danh mục</label><select id="m-tcat">${TXN_CATS_EXP.map(c=>`<option>${c}</option>`).join('')}</select></div>
      <div class="form-row"><label>Tài khoản</label><select id="m-tacc"><option value="">-- Không chọn --</option>${accOpts}</select></div>
    </div>
    <div class="form-row"><label>Mô tả</label><input id="m-tdesc2" placeholder="Ghi chú..."></div>
    <div class="form-row"><label>Ngày</label><input type="date" id="m-tdate" value="${today()}"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="submitCreateTxn()">Thêm</button>
    </div>`;
  },

  goal: () => {
    const catOpts = Object.entries(GOAL_CATS).map(([k,v])=>
      `<option value="${k}">${v.icon} ${v.label}</option>`).join('');
    return `
    <h2>🎯 Thêm mục tiêu tiết kiệm</h2>
    <div class="form-row"><label>Tên mục tiêu *</label><input id="m-gname" placeholder="VD: iPhone 16 Pro, Laptop mới..."></div>
    <div class="form-row"><label>Mô tả</label><input id="m-gdesc" placeholder="Ghi chú thêm..."></div>
    <div class="form-2col">
      <div class="form-row"><label>Danh mục</label><select id="m-gcat">${catOpts}</select></div>
      <div class="form-row"><label>Icon</label><input id="m-gicon" value="🎯" placeholder="emoji"></div>
    </div>
    <div class="form-row"><label>Số tiền cần mua *</label>
      <input type="number" id="m-gtarget" min="1" step="1000" placeholder="VD: 25000000">
    </div>
    <div class="form-2col">
      <div class="form-row"><label>Số tiền đã có sẵn</label>
        <input type="number" id="m-gsaved" min="0" step="1000" value="0" placeholder="0">
      </div>
      <div class="form-row"><label>Hạn chót</label><input type="date" id="m-gdeadline"></div>
    </div>
    <div class="form-row"><label>Màu sắc</label><div class="color-chips">${colorChips()}</div></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="submitCreateGoal()">Tạo mục tiêu</button>
    </div>`;
  }
};

function updateCatList() {
  const type=$('m-ttype')?.value; const sel=$('m-tcat'); if(!sel) return;
  sel.innerHTML=(type==='income'?TXN_CATS_INC:TXN_CATS_EXP).map(c=>`<option>${c}</option>`).join('');
}

async function openModal(type) {
  selectedColor='#6366f1'; selectedHabitType='boolean';
  const content = typeof MODALS[type]==='function' ? await MODALS[type]() : MODALS[type];
  $('modal-content').innerHTML = content;
  $('overlay').classList.add('show');
}

// ────────────────────────────────────────────────
// EDIT MODALS
// ────────────────────────────────────────────────
async function openEditModal(type, id) {
  selectedColor='#6366f1';
  const modal=$('modal-content');

  if (type==='habit') {
    const list=await api('/api/habits'); const h=list.find(x=>x.id===id); if(!h) return;
    selectedColor=h.color||'#6366f1';
    const isNum=h.type==='numeric';
    modal.innerHTML=`
      <h2>✏️ Chỉnh sửa thói quen</h2>
      <div class="form-row"><label>Tên *</label><input id="m-name" value="${esc(h.name)}"></div>
      <div class="form-row"><label>Mô tả</label><input id="m-desc" value="${esc(h.description||'')}"></div>
      <div class="form-2col">
        <div class="form-row"><label>Icon</label><input id="m-icon" value="${esc(h.icon||'⭐')}"></div>
        <div class="form-row"><label>Màu sắc</label><div class="color-chips">${colorChips(h.color)}</div></div>
      </div>
      ${isNum?`<div class="form-2col">
        <div class="form-row"><label>Mục tiêu / ngày</label><input id="m-goal" type="number" min="1" value="${h.daily_goal||1}"></div>
        <div class="form-row"><label>Đơn vị</label><input id="m-unit" value="${esc(h.unit||'')}"></div>
      </div>`:''}
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="submitEditHabit(${id},${isNum})">Lưu</button>
      </div>`;

  } else if (type==='todo') {
    const list=await api('/api/todos'); const t=list.find(x=>x.id===id); if(!t) return;
    modal.innerHTML=`
      <h2>✏️ Chỉnh sửa việc cần làm</h2>
      <div class="form-row"><label>Tiêu đề *</label><input id="m-title" value="${esc(t.title)}"></div>
      <div class="form-row"><label>Mô tả</label><textarea id="m-tdesc">${esc(t.description||'')}</textarea></div>
      <div class="form-2col">
        <div class="form-row"><label>Độ ưu tiên</label>
          <select id="m-priority">
            <option value="low"${t.priority==='low'?' selected':''}>Thấp</option>
            <option value="medium"${t.priority==='medium'?' selected':''}>Trung bình</option>
            <option value="high"${t.priority==='high'?' selected':''}>Cao</option>
          </select>
        </div>
        <div class="form-row"><label>Danh mục</label><input id="m-cat" value="${esc(t.category||'')}"></div>
      </div>
      <div class="form-2col">
        <div class="form-row"><label>Hạn chót</label><input type="date" id="m-due" value="${t.due_date||''}"></div>
        <div class="form-row"><label>Trạng thái</label>
          <select id="m-status">
            <option value="pending"${t.status==='pending'?' selected':''}>Chờ xử lý</option>
            <option value="in_progress"${t.status==='in_progress'?' selected':''}>Đang làm</option>
            <option value="done"${t.status==='done'?' selected':''}>Xong</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="submitEditTodo(${id})">Lưu</button>
      </div>`;

  } else if (type==='project') {
    const list=await api('/api/projects'); const p=list.find(x=>x.id===id); if(!p) return;
    selectedColor=p.color||'#6366f1';
    modal.innerHTML=`
      <h2>✏️ Chỉnh sửa dự án</h2>
      <div class="form-row"><label>Tên *</label><input id="m-pname" value="${esc(p.name)}"></div>
      <div class="form-row"><label>Mô tả</label><textarea id="m-pdesc">${esc(p.description||'')}</textarea></div>
      <div class="form-2col">
        <div class="form-row"><label>Trạng thái</label>
          <select id="m-pstatus">
            <option value="active"${p.status==='active'?' selected':''}>Đang chạy</option>
            <option value="paused"${p.status==='paused'?' selected':''}>Tạm dừng</option>
            <option value="completed"${p.status==='completed'?' selected':''}>Hoàn thành</option>
          </select>
        </div>
        <div class="form-row"><label>Màu sắc</label><div class="color-chips">${colorChips(p.color)}</div></div>
      </div>
      <div class="form-2col">
        <div class="form-row"><label>Ngày bắt đầu</label><input type="date" id="m-pstart" value="${p.start_date||''}"></div>
        <div class="form-row"><label>Deadline</label><input type="date" id="m-pend" value="${p.end_date||''}"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="submitEditProject(${id})">Lưu</button>
      </div>`;

  } else if (type==='account') {
    const list=await api('/api/accounts'); const a=list.find(x=>x.id===id); if(!a) return;
    selectedColor=a.color||'#6366f1';
    modal.innerHTML=`
      <h2>✏️ Chỉnh sửa tài khoản</h2>
      <div class="form-row"><label>Tên *</label><input id="m-aname" value="${esc(a.name)}"></div>
      <div class="form-2col">
        <div class="form-row"><label>Loại</label>
          <select id="m-atype">
            <option value="checking"${a.type==='checking'?' selected':''}>Thanh toán</option>
            <option value="savings"${a.type==='savings'?' selected':''}>Tiết kiệm</option>
            <option value="investment"${a.type==='investment'?' selected':''}>Đầu tư</option>
          </select>
        </div>
        <div class="form-row"><label>Tiền tệ</label>
          <select id="m-acur">
            <option value="VND"${a.currency==='VND'?' selected':''}>VND</option>
            <option value="USD"${a.currency==='USD'?' selected':''}>USD</option>
          </select>
        </div>
      </div>
      <div class="form-row"><label>Màu sắc</label><div class="color-chips">${colorChips(a.color)}</div></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="submitEditAccount(${id})">Lưu</button>
      </div>`;

  } else if (type==='txn') {
    const list=await api('/api/transactions'); const t=list.find(x=>x.id===id); if(!t) return;
    const accounts=await api('/api/accounts');
    const accOpts=accounts.map(a=>`<option value="${a.id}"${t.account_id===a.id?' selected':''}>${esc(a.name)}</option>`).join('');
    const cats=t.type==='income'?TXN_CATS_INC:TXN_CATS_EXP;
    const catOpts=cats.map(c=>`<option${c===t.category?' selected':''}>${c}</option>`).join('');
    modal.innerHTML=`
      <h2>✏️ Chỉnh sửa giao dịch</h2>
      <div class="form-2col">
        <div class="form-row"><label>Loại</label>
          <select id="m-ttype"><option value="expense"${t.type==='expense'?' selected':''}>Chi tiêu</option><option value="income"${t.type==='income'?' selected':''}>Thu nhập</option></select>
        </div>
        <div class="form-row"><label>Số tiền</label><input type="number" id="m-tamount" value="${t.amount}"></div>
      </div>
      <div class="form-2col">
        <div class="form-row"><label>Danh mục</label><select id="m-tcat">${catOpts}</select></div>
        <div class="form-row"><label>Tài khoản</label><select id="m-tacc"><option value="">-- Không chọn --</option>${accOpts}</select></div>
      </div>
      <div class="form-row"><label>Mô tả</label><input id="m-tdesc2" value="${esc(t.description||'')}"></div>
      <div class="form-row"><label>Ngày</label><input type="date" id="m-tdate" value="${t.date||today()}"></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="submitEditTxn(${id})">Lưu</button>
      </div>`;

  } else if (type==='goal') {
    const list=await api('/api/goals'); const g=list.find(x=>x.id===id); if(!g) return;
    selectedColor=g.color||'#6366f1';
    const catOpts=Object.entries(GOAL_CATS).map(([k,v])=>
      `<option value="${k}"${g.category===k?' selected':''}>${v.icon} ${v.label}</option>`).join('');
    modal.innerHTML=`
      <h2>✏️ Chỉnh sửa mục tiêu</h2>
      <div class="form-row"><label>Tên *</label><input id="m-gname" value="${esc(g.name)}"></div>
      <div class="form-row"><label>Mô tả</label><input id="m-gdesc" value="${esc(g.description||'')}"></div>
      <div class="form-2col">
        <div class="form-row"><label>Danh mục</label><select id="m-gcat">${catOpts}</select></div>
        <div class="form-row"><label>Icon</label><input id="m-gicon" value="${esc(g.icon||'🎯')}"></div>
      </div>
      <div class="form-row"><label>Số tiền mục tiêu *</label>
        <input type="number" id="m-gtarget" min="1" step="1000" value="${g.target_amount}">
      </div>
      <div class="form-2col">
        <div class="form-row"><label>Hạn chót</label><input type="date" id="m-gdeadline" value="${g.deadline||''}"></div>
        <div class="form-row"><label>Màu sắc</label><div class="color-chips">${colorChips(g.color)}</div></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="submitEditGoal(${id})">Lưu</button>
      </div>`;
  }
  $('overlay').classList.add('show');
}

// ────────────────────────────────────────────────
// CREATE submit handlers
// ────────────────────────────────────────────────
async function submitCreateHabit() {
  const name=$('m-name')?.value.trim();
  if(!name) { modalError('Vui lòng nhập tên thói quen'); return; }
  const btn=modalBtn(); setSubmitting(btn,true);
  const isNum=selectedHabitType==='numeric';
  try {
    await api('/api/habits','POST',{name,description:$('m-desc')?.value||'',color:selectedColor,icon:$('m-icon')?.value||'⭐',type:selectedHabitType,unit:isNum?($('m-unit')?.value||''):'',daily_goal:isNum?(parseFloat($('m-goal')?.value)||1):1});
    closeModal(); loadHabits();
  } catch(e) { setSubmitting(btn,false); modalError(e.message); }
}

async function submitCreateTodo() {
  const title=$('m-title')?.value.trim();
  if(!title) { modalError('Vui lòng nhập tiêu đề'); return; }
  const btn=modalBtn(); setSubmitting(btn,true);
  try {
    await api('/api/todos','POST',{title,description:$('m-tdesc')?.value,priority:$('m-priority')?.value,category:$('m-cat')?.value||'general',due_date:$('m-due')?.value||null});
    closeModal(); loadTodos(); loadDashboard();
  } catch(e) { setSubmitting(btn,false); modalError(e.message); }
}

async function submitCreateProject() {
  const name=$('m-pname')?.value.trim();
  if(!name) { modalError('Vui lòng nhập tên dự án'); return; }
  const btn=modalBtn(); setSubmitting(btn,true);
  try {
    await api('/api/projects','POST',{name,description:$('m-pdesc')?.value,color:selectedColor,start_date:$('m-pstart')?.value||null,end_date:$('m-pend')?.value||null});
    closeModal(); loadProjects(); loadDashboard();
  } catch(e) { setSubmitting(btn,false); modalError(e.message); }
}

async function submitCreateAccount() {
  const name=$('m-aname')?.value.trim();
  if(!name) { modalError('Vui lòng nhập tên tài khoản'); return; }
  const btn=modalBtn(); setSubmitting(btn,true);
  try {
    await api('/api/accounts','POST',{name,type:$('m-atype')?.value,balance:parseFloat($('m-abal')?.value)||0,currency:$('m-acur')?.value,color:selectedColor});
    closeModal(); loadFinance();
  } catch(e) { setSubmitting(btn,false); modalError(e.message); }
}

async function submitCreateTxn() {
  const amount=parseFloat($('m-tamount')?.value);
  if(!amount||amount<=0) { modalError('Vui lòng nhập số tiền hợp lệ'); return; }
  const btn=modalBtn(); setSubmitting(btn,true);
  const accId=$('m-tacc')?.value;
  try {
    await api('/api/transactions','POST',{amount,type:$('m-ttype')?.value,category:$('m-tcat')?.value,description:$('m-tdesc2')?.value,account_id:accId?parseInt(accId):null,date:$('m-tdate')?.value});
    closeModal(); loadFinance(); loadDashboard();
  } catch(e) { setSubmitting(btn,false); modalError(e.message); }
}

async function submitCreateGoal() {
  const name=$('m-gname')?.value.trim();
  const target=parseFloat($('m-gtarget')?.value);
  if(!name)           { modalError('Vui lòng nhập tên mục tiêu'); return; }
  if(!target||target<=0) { modalError('Vui lòng nhập số tiền hợp lệ'); return; }
  const btn=modalBtn(); setSubmitting(btn,true);
  const saved=parseFloat($('m-gsaved')?.value)||0;
  try {
    const gid=await api('/api/goals','POST',{name,description:$('m-gdesc')?.value||'',icon:$('m-gicon')?.value||'🎯',color:selectedColor,category:$('m-gcat')?.value||'other',target_amount:target,currency:'VND',deadline:$('m-gdeadline')?.value||null});
    if(saved>0 && gid?.id) await api(`/api/goals/${gid.id}/deposit`,'POST',{amount:saved,note:'Số tiền ban đầu',date:today()});
    closeModal(); loadFinance();
  } catch(e) { setSubmitting(btn,false); modalError(e.message); }
}

// ────────────────────────────────────────────────
// EDIT submit handlers
// ────────────────────────────────────────────────
async function submitEditHabit(id, isNum) {
  const name=$('m-name')?.value.trim();
  if(!name) { modalError('Vui lòng nhập tên'); return; }
  const btn=modalBtn(); setSubmitting(btn,true);
  const body={name,description:$('m-desc')?.value||'',color:selectedColor,icon:$('m-icon')?.value||'⭐'};
  if(isNum){body.daily_goal=parseFloat($('m-goal')?.value)||1;body.unit=$('m-unit')?.value||'';}
  try {
    await api(`/api/habits/${id}`,'PUT',body);
    invalidateCache(id); closeModal(); loadHabits();
  } catch(e) { setSubmitting(btn,false); modalError(e.message); }
}

async function submitEditTodo(id) {
  const title=$('m-title')?.value.trim();
  if(!title) { modalError('Vui lòng nhập tiêu đề'); return; }
  const btn=modalBtn(); setSubmitting(btn,true);
  try {
    await api(`/api/todos/${id}`,'PUT',{title,description:$('m-tdesc')?.value,priority:$('m-priority')?.value,category:$('m-cat')?.value||'general',status:$('m-status')?.value,due_date:$('m-due')?.value||null});
    closeModal(); loadTodos(); loadDashboard();
  } catch(e) { setSubmitting(btn,false); modalError(e.message); }
}

async function submitEditProject(id) {
  const name=$('m-pname')?.value.trim();
  if(!name) { modalError('Vui lòng nhập tên dự án'); return; }
  const btn=modalBtn(); setSubmitting(btn,true);
  try {
    await api(`/api/projects/${id}`,'PUT',{name,description:$('m-pdesc')?.value,status:$('m-pstatus')?.value,color:selectedColor,start_date:$('m-pstart')?.value||null,end_date:$('m-pend')?.value||null});
    closeModal(); loadProjects();
  } catch(e) { setSubmitting(btn,false); modalError(e.message); }
}

async function submitEditAccount(id) {
  const name=$('m-aname')?.value.trim();
  if(!name) { modalError('Vui lòng nhập tên tài khoản'); return; }
  const btn=modalBtn(); setSubmitting(btn,true);
  try {
    await api(`/api/accounts/${id}`,'PUT',{name,type:$('m-atype')?.value,currency:$('m-acur')?.value,color:selectedColor});
    closeModal(); loadFinance();
  } catch(e) { setSubmitting(btn,false); modalError(e.message); }
}

async function submitEditTxn(id) {
  const amount=parseFloat($('m-tamount')?.value);
  if(!amount||amount<=0) { modalError('Vui lòng nhập số tiền hợp lệ'); return; }
  const btn=modalBtn(); setSubmitting(btn,true);
  const accId=$('m-tacc')?.value;
  try {
    await api(`/api/transactions/${id}`,'DELETE');
    await api('/api/transactions','POST',{amount,type:$('m-ttype')?.value,category:$('m-tcat')?.value,description:$('m-tdesc2')?.value,account_id:accId?parseInt(accId):null,date:$('m-tdate')?.value});
    closeModal(); loadFinance(); loadDashboard();
  } catch(e) { setSubmitting(btn,false); modalError(e.message); }
}

async function submitEditGoal(id) {
  const name=$('m-gname')?.value.trim();
  const target=parseFloat($('m-gtarget')?.value);
  if(!name)           { modalError('Vui lòng nhập tên mục tiêu'); return; }
  if(!target||target<=0) { modalError('Vui lòng nhập số tiền hợp lệ'); return; }
  const btn=modalBtn(); setSubmitting(btn,true);
  try {
    await api(`/api/goals/${id}`,'PUT',{name,description:$('m-gdesc')?.value||'',icon:$('m-gicon')?.value||'🎯',color:selectedColor,category:$('m-gcat')?.value||'other',target_amount:target,deadline:$('m-gdeadline')?.value||null});
    closeModal(); loadFinance();
  } catch(e) { setSubmitting(btn,false); modalError(e.message); }
}

function closeModal() { $('overlay').classList.remove('show'); }
$('overlay').addEventListener('click', e=>{if(e.target===$('overlay'))closeModal();});
document.addEventListener('keydown', e=>{if(e.key==='Escape')closeModal();});

// ────────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────────
loadDashboard();
