// ─────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('vi-VN').format(Math.round(n));
const fmtDate = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('vi-VN') : '';
const today = () => new Date().toISOString().slice(0, 10);

async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function confirmDel(msg, cb) { if (confirm(msg)) cb(); }

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// ─────────────────────────────────────────────────────
// CLOCK
// ─────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('datedisp').textContent = now.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
setInterval(updateClock, 1000);
updateClock();

// ─────────────────────────────────────────────────────
// NAV
// ─────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    $('page-' + item.dataset.page).classList.add('active');
    loadPage(item.dataset.page);
  });
});

function loadPage(page) {
  if (page === 'dashboard') loadDashboard();
  if (page === 'habits')    loadHabits();
  if (page === 'todos')     loadTodos();
  if (page === 'projects')  loadProjects();
  if (page === 'finance')   loadFinance();
}

// ─────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────
async function loadDashboard() {
  const d = await api('/api/dashboard');
  $('ds-habits').textContent   = `${d.habits.completed}/${d.habits.total}`;
  $('ds-todos').textContent    = d.todos.pending;
  $('ds-projects').textContent = d.projects.active;
  $('ds-income').textContent   = fmt(d.finance.income);
  $('ds-expense').textContent  = `chi tiêu: ${fmt(d.finance.expense)}`;
  const todayStr = today();
  const renderList = (items, elId) => {
    const el = $(elId);
    if (!items.length) { el.innerHTML = '<div class="empty"><p>Không có việc nào</p></div>'; return; }
    el.innerHTML = items.map(t => {
      const due = t.due_date ? `<span class="badge badge-due${t.due_date < todayStr ? ' overdue' : ''}">${fmtDate(t.due_date)}</span>` : '';
      return `<div class="quick-item"><span class="badge ${priClass(t.priority)}">${t.priority}</span><span style="flex:1;font-weight:500">${t.title}</span>${due}</div>`;
    }).join('');
  };
  renderList(d.recent_todos, 'dash-todos-list');
  renderList(d.upcoming, 'dash-upcoming-list');
}

// ─────────────────────────────────────────────────────
// HABITS — state
// ─────────────────────────────────────────────────────
// Cache 365-day history per habit, reload when we log
const habitHistoryCache = {};   // id → array
const habitChartInst    = {};   // id → Chart.js instance
const habitExpandState  = {};   // id → { chartOpen: bool, logOtherOpen: bool, period: string }

function getHabitState(id) {
  if (!habitExpandState[id]) habitExpandState[id] = { chartOpen: false, logOtherOpen: false, period: 'month' };
  return habitExpandState[id];
}

// ─────────────────────────────────────────────────────
// HABITS — main load
// ─────────────────────────────────────────────────────
async function loadHabits() {
  const habits = await api('/api/habits');
  const wrap   = $('habit-list-wrap');
  if (!habits.length) {
    wrap.innerHTML = '<div class="empty"><span class="e-icon">🔥</span><p>Chưa có thói quen nào. Hãy thêm thói quen đầu tiên!</p></div>';
    return;
  }

  // Invalidate history cache for all (data may have changed)
  // BUT keep it for habits whose expand is open so we don't flash
  wrap.innerHTML = `<div class="habit-list">${habits.map(h => habitCardHTML(h)).join('')}</div>`;

  // Render contribution graphs + restore open chart panels
  for (const h of habits) {
    await renderContribGraph(h);
    const state = getHabitState(h.id);
    if (state.chartOpen && h.type === 'numeric') {
      _openChartPanel(h.id, h.color, h.daily_goal || 1, h.unit || '', state.period);
    }
  }
}

// ─────────────────────────────────────────────────────
// HABITS — card HTML
// ─────────────────────────────────────────────────────
function habitCardHTML(h) {
  const isNum = h.type === 'numeric';
  const rgb   = hexToRgb(h.color || '#6366f1');
  const goal  = h.daily_goal || 1;
  const val   = h.today_value || 0;
  const pct   = Math.min(100, Math.round(val / goal * 100));
  const done  = h.completed_today;
  const state = getHabitState(h.id);

  // ── Left control ──
  const leftCtrl = isNum
    ? `<div class="habit-ring-wrap">
        <svg class="habit-ring" width="38" height="38" viewBox="0 0 38 38">
          <circle class="habit-ring-bg" cx="19" cy="19" r="16"/>
          <circle class="habit-ring-fg"
            cx="19" cy="19" r="16"
            stroke="rgba(${rgb},0.85)"
            stroke-dasharray="${(2 * Math.PI * 16).toFixed(2)}"
            stroke-dashoffset="${(2 * Math.PI * 16 * (1 - pct / 100)).toFixed(2)}"/>
        </svg>
        <div class="habit-ring-pct" style="color:rgba(${rgb},1)">${pct}%</div>
      </div>`
    : `<div class="habit-check${done ? ' done' : ''}" style="--h-color:${h.color}"
           onclick="logHabit(${h.id})">${done ? '✓' : ''}</div>`;

  // ── Today numeric log ──
  const logToday = isNum ? `
    <div class="habit-log-today">
      <input class="habit-num-input" id="num-${h.id}"
             type="number" min="0" step="any"
             value="${val > 0 ? val : ''}" placeholder="0"
             style="--h-color:${h.color}"
             onkeydown="if(event.key==='Enter')logNumeric(${h.id},today())">
      <span class="log-unit-label">${h.unit || ''}</span>
      <button class="habit-log-btn${done ? ' logged' : ''}" style="${done ? '' : `background:${h.color}`}"
              onclick="logNumeric(${h.id},today())">
        ${done ? '✓ Đã ghi' : 'Ghi hôm nay'}
      </button>
    </div>` : '';

  // ── Progress mini (numeric) ──
  const progressMini = isNum ? `
    <div class="habit-progress-mini">
      <div class="habit-pbar"><div class="habit-pbar-fill" style="width:${pct}%;background:${h.color}"></div></div>
      <span class="habit-pval">${val}${h.unit ? ' ' + h.unit : ''} / ${goal}${h.unit ? ' ' + h.unit : ''}</span>
    </div>` : '';

  const typeTag = `<span class="habit-type-tag ${isNum ? 'type-numeric' : 'type-boolean'}">${isNum ? '123' : '✓/✗'}</span>`;

  // ── Log other date panel ──
  const logOtherPanel = `
    <div class="habit-log-other${state.logOtherOpen ? ' open' : ''}" id="log-other-${h.id}">
      <div class="habit-log-other-inner">
        <label>Ghi ngày:</label>
        <input type="date" class="log-date-input" id="log-date-${h.id}" value="${today()}" max="${today()}">
        ${isNum ? `
          <input type="number" class="log-val-input" id="log-val-${h.id}"
                 min="0" step="any" placeholder="0"
                 onkeydown="if(event.key==='Enter')logOtherDate(${h.id})">
          <span class="log-unit-label">${h.unit || ''}</span>
        ` : ''}
        <button class="btn btn-primary btn-sm" onclick="logOtherDate(${h.id})">
          ${isNum ? 'Ghi' : 'Bật / Tắt'}
        </button>
      </div>
    </div>`;

  // ── Chart expand (numeric only) ──
  const chartBtn = isNum ? `
    <button class="habit-expand-btn${state.chartOpen ? ' open' : ''}" id="expand-btn-${h.id}"
            onclick="toggleChartPanel(${h.id})">
      <span class="chevron">▾</span> Biểu đồ tiến độ
    </button>
    <div class="habit-detail${state.chartOpen ? ' open' : ''}" id="habit-detail-${h.id}">
      <div class="habit-detail-inner" id="habit-detail-inner-${h.id}"></div>
    </div>` : '';

  return `
  <div class="habit-card" id="habit-card-${h.id}" style="--h-color:${h.color}">
    <div class="habit-row">
      ${leftCtrl}
      <div class="habit-info">
        <div class="habit-header-row">
          <span class="habit-name">${h.icon} ${h.name}</span>
          ${typeTag}
        </div>
        ${h.description ? `<div class="habit-desc">${h.description}</div>` : ''}
        ${logToday}
        ${progressMini}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
        <div class="habit-streak">🔥 ${h.streak} ngày</div>
        <div class="habit-actions">
          <button class="icon-btn" onclick="confirmDel('Xóa thói quen này?',()=>deleteHabit(${h.id}))">🗑</button>
        </div>
      </div>
    </div>

    <!-- Contribution graph — always visible -->
    <div class="habit-contrib-section">
      <div class="habit-contrib-topbar">
        <div class="habit-contrib-stats">
          <span class="contrib-stat-pill">📅 365 ngày qua</span>
          <span class="contrib-stat-pill" id="contrib-total-${h.id}">
            Hoàn thành <strong>–</strong> ngày
          </span>
        </div>
        <button class="log-other-btn${state.logOtherOpen ? ' active' : ''}"
                id="log-other-btn-${h.id}"
                onclick="toggleLogOther(${h.id})">
          📅 Ghi ngày khác
        </button>
      </div>
      <div class="contrib-scroll-wrap">
        <div id="contrib-svg-${h.id}" class="contrib-svg-inline"></div>
      </div>
      <div class="contrib-legend-row">
        <span>Ít hơn</span>
        ${[0,1,2,3,4].map(l => `<div class="contrib-swatch" style="background:${contribColor(h.color, l)}"></div>`).join('')}
        <span>Nhiều hơn</span>
      </div>
    </div>

    ${logOtherPanel}
    ${chartBtn}
  </div>`;
}

// ─────────────────────────────────────────────────────
// CONTRIBUTION GRAPH — color helpers
// ─────────────────────────────────────────────────────
const MONTHS_VI = ['Th1','Th2','Th3','Th4','Th5','Th6','Th7','Th8','Th9','Th10','Th11','Th12'];

function contribColor(hex, level) {
  if (level === 0) return '#e8eaf0';
  const opacities = [0, 0.18, 0.40, 0.65, 0.88];
  const rgb = hexToRgb(hex);
  return `rgba(${rgb},${opacities[level]})`;
}

function valueToLevel(type, row, goal) {
  if (!row || row.value <= 0) return 0;
  if (type === 'boolean') return row.done ? 4 : 0;
  const r = row.value / goal;
  if (r < 0.33) return 1;
  if (r < 0.66) return 2;
  if (r <  1.0) return 3;
  return 4;
}

// ─────────────────────────────────────────────────────
// CONTRIBUTION GRAPH — build & inject SVG
// ─────────────────────────────────────────────────────
async function renderContribGraph(h) {
  const svgEl = $(`contrib-svg-${h.id}`);
  if (!svgEl) return;

  if (!habitHistoryCache[h.id]) {
    habitHistoryCache[h.id] = await api(`/api/habits/${h.id}/history`);
  }
  const history = habitHistoryCache[h.id];
  const map     = {};
  history.forEach(d => { map[d.date] = d; });

  const goal  = h.daily_goal || 1;
  const htype = h.type || 'boolean';

  // Dimensions — big cells
  const CELL = 14, GAP = 3, STEP = CELL + GAP;
  const LEFT_PAD = 26, TOP_PAD = 22;

  // Align start to Monday, covering exactly 52 full weeks + partial leading week
  const endDate   = new Date();
  endDate.setHours(0, 0, 0, 0);
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 364);
  // Snap back to Monday
  const dow   = startDate.getDay();  // 0=Sun
  const toMon = dow === 0 ? -6 : 1 - dow;
  startDate.setDate(startDate.getDate() + toMon);

  // Count columns
  const totalDays  = Math.ceil((endDate - startDate) / 864e5) + 1;
  const totalWeeks = Math.ceil(totalDays / 7);

  const W = LEFT_PAD + totalWeeks * STEP + 4;
  const H = TOP_PAD  + 7 * STEP + 2;

  const todayStr = today();
  let cells       = '';
  let monthLabels = '';
  let lastMonth   = -1;
  let doneCount   = 0;

  for (let w = 0; w < totalWeeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cd = new Date(startDate);
      cd.setDate(startDate.getDate() + w * 7 + d);
      if (cd > endDate) continue;

      const ds    = cd.toISOString().slice(0, 10);
      const entry = map[ds];
      const level = valueToLevel(htype, entry, goal);
      if (entry?.done) doneCount++;

      const fill   = contribColor(h.color, level);
      const x      = LEFT_PAD + w * STEP;
      const y      = TOP_PAD  + d * STEP;
      const isToday = ds === todayStr;

      const valTip = htype === 'boolean'
        ? (entry?.done ? 'Hoàn thành ✓' : 'Chưa')
        : `${entry?.value ?? 0}${h.unit ? ' ' + h.unit : ''}`;
      const tipStr = `${ds}: ${valTip}`;

      // Click handler — cell click logs that date
      const onclick = htype === 'boolean'
        ? `logOtherDateCell(${h.id},'${ds}',null)`
        : `prefillLogOther(${h.id},'${ds}')`;

      cells += `<rect class="c-cell${isToday ? ' c-today' : ''}"
        x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5"
        fill="${fill}"
        onclick="${onclick}">
        <title>${tipStr}</title>
      </rect>`;

      // Month label on first day of each month appearing in row 0 (Monday)
      if (d === 0 && cd.getDate() <= 7 && cd.getMonth() !== lastMonth) {
        monthLabels += `<text x="${x}" y="${TOP_PAD - 6}"
          font-size="10" fill="#9ca3c0" font-family="Mona Sans,sans-serif">
          ${MONTHS_VI[cd.getMonth()]}
        </text>`;
        lastMonth = cd.getMonth();
      }
    }
  }

  // Day-of-week labels on left
  const DOW_LABELS = [{ d: 0, l: 'T2' }, { d: 2, l: 'T4' }, { d: 4, l: 'T6' }];
  const dowLabels  = DOW_LABELS.map(({ d, l }) =>
    `<text x="${LEFT_PAD - 4}" y="${TOP_PAD + d * STEP + CELL}"
      font-size="9" fill="#9ca3c0" font-family="Mona Sans,sans-serif" text-anchor="end">${l}</text>`
  ).join('');

  svgEl.innerHTML = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${monthLabels}${dowLabels}${cells}
  </svg>`;

  // Update stat label
  const totalEl = $(`contrib-total-${h.id}`);
  if (totalEl) totalEl.innerHTML = `Hoàn thành <strong>${doneCount}</strong> ngày`;
}

// ─────────────────────────────────────────────────────
// HABITS — log today (boolean toggle)
// ─────────────────────────────────────────────────────
async function logHabit(id) {
  await api(`/api/habits/${id}/log`, 'POST', { date: today() });
  invalidateCache(id);
  await loadHabits();
  loadDashboard();
}

// ─────────────────────────────────────────────────────
// HABITS — log today (numeric)
// ─────────────────────────────────────────────────────
async function logNumeric(id, dateStr) {
  const val = parseFloat($(`num-${id}`)?.value);
  if (isNaN(val) || val < 0) return;
  await api(`/api/habits/${id}/log`, 'POST', { value: val, date: dateStr });
  invalidateCache(id);
  await loadHabits();
  loadDashboard();
}

// ─────────────────────────────────────────────────────
// HABITS — log other date panel
// ─────────────────────────────────────────────────────
function toggleLogOther(id) {
  const state = getHabitState(id);
  state.logOtherOpen = !state.logOtherOpen;
  const panel = $(`log-other-${id}`);
  const btn   = $(`log-other-btn-${id}`);
  panel?.classList.toggle('open', state.logOtherOpen);
  btn?.classList.toggle('active', state.logOtherOpen);
  if (state.logOtherOpen) $(`log-date-${id}`)?.focus();
}

// Called when user clicks "Ghi" in the log-other panel
async function logOtherDate(id) {
  const dateStr = $(`log-date-${id}`)?.value;
  if (!dateStr) return;

  // Fetch habit type from current DOM
  const card = $(`habit-card-${id}`);
  const isNum = card?.querySelector('.type-numeric') !== null;

  if (isNum) {
    const val = parseFloat($(`log-val-${id}`)?.value);
    if (isNaN(val) || val < 0) return;
    await api(`/api/habits/${id}/log`, 'POST', { value: val, date: dateStr });
  } else {
    await api(`/api/habits/${id}/log`, 'POST', { date: dateStr });
  }
  invalidateCache(id);
  await loadHabits();
  loadDashboard();
}

// Called when user clicks directly on a boolean cell in the contribution graph
async function logOtherDateCell(id, dateStr, _unused) {
  await api(`/api/habits/${id}/log`, 'POST', { date: dateStr });
  invalidateCache(id);
  await loadHabits();
  loadDashboard();
}

// Called when user clicks a numeric cell — prefills the log panel and opens it
function prefillLogOther(id, dateStr) {
  const state = getHabitState(id);
  if (!state.logOtherOpen) {
    state.logOtherOpen = true;
    $(`log-other-${id}`)?.classList.add('open');
    $(`log-other-btn-${id}`)?.classList.add('active');
  }
  const dateInp = $(`log-date-${id}`);
  if (dateInp) dateInp.value = dateStr;
  $(`log-val-${id}`)?.focus();
}

// ─────────────────────────────────────────────────────
// HABITS — chart panel (numeric)
// ─────────────────────────────────────────────────────
async function toggleChartPanel(id) {
  const state = getHabitState(id);
  state.chartOpen = !state.chartOpen;
  const detail = $(`habit-detail-${id}`);
  const btn    = $(`expand-btn-${id}`);
  detail?.classList.toggle('open', state.chartOpen);
  btn?.classList.toggle('open', state.chartOpen);

  if (state.chartOpen) {
    const list = await api('/api/habits');
    const h    = list.find(x => x.id === id);
    if (h) _openChartPanel(id, h.color, h.daily_goal || 1, h.unit || '', state.period);
  }
}

async function _openChartPanel(id, color, goal, unit, period) {
  const inner = $(`habit-detail-inner-${id}`);
  if (!inner) return;
  const state = getHabitState(id);

  inner.innerHTML = `
    <div class="habit-chart-tabs" id="chart-tabs-${id}">
      <button class="chart-tab${period==='week'?' active':''}"   onclick="changeHabitPeriod(${id},'week')">Tuần</button>
      <button class="chart-tab${period==='month'?' active':''}"  onclick="changeHabitPeriod(${id},'month')">Tháng</button>
      <button class="chart-tab${period==='year'?' active':''}"   onclick="changeHabitPeriod(${id},'year')">Năm</button>
    </div>
    <div class="habit-chart-canvas-wrap"><canvas id="habit-chart-${id}"></canvas></div>`;

  await renderHabitChart(id, period, color, goal, unit);
}

async function changeHabitPeriod(id, period) {
  const state  = getHabitState(id);
  state.period = period;
  document.querySelectorAll(`#chart-tabs-${id} .chart-tab`).forEach(b =>
    b.classList.toggle('active', b.textContent.trim() === { week:'Tuần', month:'Tháng', year:'Năm' }[period])
  );
  if (habitChartInst[id]) { habitChartInst[id].destroy(); delete habitChartInst[id]; }
  const list = await api('/api/habits');
  const h    = list.find(x => x.id === id);
  if (h) await renderHabitChart(id, period, h.color, h.daily_goal || 1, h.unit || '');
}

async function renderHabitChart(id, period, color, goal, unit) {
  const canvas = $(`habit-chart-${id}`);
  if (!canvas) return;
  if (habitChartInst[id]) { habitChartInst[id].destroy(); delete habitChartInst[id]; }

  const data   = await api(`/api/habits/${id}/chart?period=${period}`);
  const labels = data.map(d => d.label);
  const values = data.map(d => d.value);
  const rgb    = hexToRgb(color);

  const ctx  = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 200);
  grad.addColorStop(0, `rgba(${rgb},0.20)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);

  habitChartInst[id] = new Chart(ctx, {
    type: period === 'year' ? 'bar' : 'line',
    data: {
      labels,
      datasets: [
        {
          label: unit || 'Giá trị',
          data: values,
          borderColor: color,
          backgroundColor: period === 'year' ? `rgba(${rgb},0.65)` : grad,
          fill: period !== 'year',
          tension: 0.42,
          pointRadius: period === 'year' ? 0 : 3,
          pointHoverRadius: 6,
          pointBackgroundColor: color,
          borderWidth: 2,
          borderRadius: period === 'year' ? 6 : 0,
        },
        {
          label: 'Mục tiêu',
          data: data.map(d => d.goal || goal),
          borderColor: 'rgba(99,102,241,0.30)',
          backgroundColor: 'transparent',
          borderDash: [5, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          type: 'line',
          tension: 0,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#7b82a8', font: { family: 'Mona Sans', size: 11 }, boxWidth: 12, padding: 12 } },
        tooltip: {
          backgroundColor: '#fff', titleColor: '#1e2140', bodyColor: '#4a5071',
          borderColor: 'rgba(99,102,241,.15)', borderWidth: 1, padding: 10,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}${unit ? ' ' + unit : ''}` }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { color: '#9ca3c0', font: { family: 'Mona Sans', size: 10 }, maxTicksLimit: 12 } },
        y: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { color: '#9ca3c0', font: { family: 'Mona Sans', size: 10 } }, beginAtZero: true }
      }
    }
  });
}

// ─────────────────────────────────────────────────────
// HABITS — delete
// ─────────────────────────────────────────────────────
async function deleteHabit(id) {
  await api(`/api/habits/${id}`, 'DELETE');
  invalidateCache(id);
  delete habitExpandState[id];
  if (habitChartInst[id]) { habitChartInst[id].destroy(); delete habitChartInst[id]; }
  loadHabits(); loadDashboard();
}

function invalidateCache(id) { delete habitHistoryCache[id]; }

// ─────────────────────────────────────────────────────
// TODOS
// ─────────────────────────────────────────────────────
const priClass = p => p === 'high' ? 'pri-high' : p === 'medium' ? 'pri-medium' : 'pri-low';
let currentFilter = 'all';

async function loadTodos() {
  let todos = await api('/api/todos');
  if (currentFilter !== 'all') todos = todos.filter(t => t.status === currentFilter);
  const wrap = $('todo-list-wrap');
  if (!todos.length) {
    wrap.innerHTML = '<div class="empty"><span class="e-icon">✅</span><p>Không có việc nào.</p></div>';
    return;
  }
  wrap.innerHTML = `<div class="todo-list">${todos.map(todoHTML).join('')}</div>`;
}

function todoHTML(t) {
  const done    = t.status === 'done';
  const todayStr = today();
  const overdue  = t.due_date && t.due_date < todayStr && !done;
  const dueLabel = t.due_date ? `<span class="badge badge-due${overdue ? ' overdue' : ''}">${fmtDate(t.due_date)}</span>` : '';
  const inProg   = t.status === 'in_progress' ? `<span class="badge" style="background:rgba(99,102,241,.08);color:var(--primary);border:1px solid rgba(99,102,241,.2)">In Progress</span>` : '';
  return `<div class="todo-item${done ? ' done-item' : ''}">
    <div class="todo-check${done ? ' checked' : ''}" onclick="cycleStatus(${t.id},'${t.status}')">${done ? '✓' : t.status === 'in_progress' ? '…' : ''}</div>
    <div class="todo-body">
      <div class="todo-title${done ? ' striked' : ''}">${t.title}</div>
      ${t.description ? `<div style="color:var(--muted2);font-size:12px;margin-top:3px">${t.description}</div>` : ''}
      <div class="todo-meta"><span class="badge ${priClass(t.priority)}">${t.priority}</span>${t.category ? `<span class="badge badge-cat">${t.category}</span>` : ''}${inProg}${dueLabel}</div>
    </div>
    <div class="todo-actions"><button class="icon-btn" onclick="confirmDel('Xóa việc này?',()=>deleteTodo(${t.id}))">🗑</button></div>
  </div>`;
}

async function cycleStatus(id, current) {
  const next = current === 'pending' ? 'in_progress' : current === 'in_progress' ? 'done' : 'pending';
  await api(`/api/todos/${id}`, 'PUT', { status: next });
  loadTodos(); loadDashboard();
}
async function deleteTodo(id) { await api(`/api/todos/${id}`, 'DELETE'); loadTodos(); loadDashboard(); }

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); currentFilter = btn.dataset.filter; loadTodos();
  });
});

// ─────────────────────────────────────────────────────
// PROJECTS
// ─────────────────────────────────────────────────────
async function loadProjects() {
  const projects = await api('/api/projects');
  const wrap = $('project-list-wrap');
  if (!projects.length) {
    wrap.innerHTML = '<div class="empty"><span class="e-icon">🚀</span><p>Chưa có dự án nào.</p></div>';
    return;
  }
  wrap.innerHTML = projects.map(projectHTML).join('');
}

function statusLabel(s) {
  return s==='active'    ? `<span class="project-status status-active">Đang chạy</span>`
       : s==='completed' ? `<span class="project-status status-completed">Hoàn thành</span>`
       :                   `<span class="project-status status-paused">Tạm dừng</span>`;
}

function projectHTML(p) {
  const doneCount = p.tasks.filter(t => t.completed).length;
  const tasks = p.tasks.map(t => `
    <div class="task-item">
      <div class="task-check${t.completed?' done':''}" onclick="toggleTask(${p.id},${t.id})">${t.completed?'✓':''}</div>
      <span class="task-title${t.completed?' done-text':''}">${t.title}</span>
      <button class="icon-btn" style="width:22px;height:22px;font-size:10px" onclick="deleteTask(${p.id},${t.id})">✕</button>
    </div>`).join('');
  return `<div class="project-card">
    <div class="project-header">
      <div class="project-dot" style="background:${p.color};box-shadow:0 0 6px ${p.color}80"></div>
      <div class="project-name">${p.name}</div>
      ${statusLabel(p.status)}
      <button class="icon-btn" onclick="confirmDel('Xóa dự án?',()=>deleteProject(${p.id}))">🗑</button>
    </div>
    ${p.description?`<div style="color:var(--muted2);font-size:13px;margin-bottom:10px">${p.description}</div>`:''}
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted2);margin-bottom:4px">
      <span>${doneCount}/${p.tasks.length} nhiệm vụ</span><span>${p.progress}%</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${p.progress}%"></div></div>
    <button class="expand-btn" onclick="toggleTaskPanel(${p.id})">▾ Nhiệm vụ (${p.tasks.length})</button>
    <div class="project-tasks" id="tasks-${p.id}">
      ${tasks}
      <div class="add-task-row">
        <input id="new-task-${p.id}" style="flex:1;background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:7px 11px;color:var(--text);font-family:'Mona Sans',sans-serif;font-size:13px;outline:none" placeholder="Thêm nhiệm vụ...">
        <button class="btn btn-primary btn-sm" onclick="addTask(${p.id})">Thêm</button>
      </div>
    </div>
  </div>`;
}

function toggleTaskPanel(pid) { $(`tasks-${pid}`)?.classList.toggle('open'); }
async function toggleTask(pid, tid) { await api(`/api/projects/${pid}/tasks/${tid}`, 'PUT'); loadProjects(); }
async function deleteTask(pid, tid) { await api(`/api/projects/${pid}/tasks/${tid}`, 'DELETE'); loadProjects(); }
async function deleteProject(id) { await api(`/api/projects/${id}`, 'DELETE'); loadProjects(); loadDashboard(); }
async function addTask(pid) {
  const inp = $(`new-task-${pid}`);
  if (!inp?.value.trim()) return;
  await api(`/api/projects/${pid}/tasks`, 'POST', { title: inp.value.trim() });
  loadProjects();
}

// ─────────────────────────────────────────────────────
// FINANCE
// ─────────────────────────────────────────────────────
const ACC_TYPES = { checking: 'Thanh toán', savings: 'Tiết kiệm', investment: 'Đầu tư' };
const TXN_CATS_EXP = ['ăn uống','đi lại','nhà cửa','mua sắm','giải trí','sức khỏe','giáo dục','tiết kiệm','đầu tư','khác'];
const TXN_CATS_INC = ['lương','thưởng','đầu tư','kinh doanh','khác'];
let chartFinance = null, chartCats = null;

async function loadFinance() {
  const [accounts, txns, summary] = await Promise.all([api('/api/accounts'), api('/api/transactions'), api('/api/finance/summary')]);
  renderAccounts(accounts); renderTxns(txns); renderFinanceCharts(summary);
}

function renderAccounts(accounts) {
  const wrap = $('account-grid-wrap');
  if (!accounts.length) { wrap.innerHTML = '<div style="color:var(--muted2);font-size:13px;padding:10px 0">Chưa có tài khoản nào.</div>'; return; }
  wrap.innerHTML = accounts.map(a => `
    <div class="account-card" style="--accent:${a.color}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><div class="account-type">${ACC_TYPES[a.type]||a.type}</div><div class="account-name">${a.name}</div></div>
        <button class="icon-btn" onclick="confirmDel('Xóa tài khoản này?',()=>deleteAccount(${a.id}))">🗑</button>
      </div>
      <div class="account-balance">${fmt(a.balance)}</div>
      <div class="account-currency">${a.currency}</div>
    </div>`).join('');
}

function renderTxns(txns) {
  const wrap = $('txn-list-wrap');
  if (!txns.length) { wrap.innerHTML = '<div class="empty"><p>Chưa có giao dịch nào.</p></div>'; return; }
  wrap.innerHTML = `<div class="txn-list">${txns.slice(0,50).map(t=>`
    <div class="txn-item txn-${t.type}">
      <div class="txn-icon">${t.type==='income'?'📥':'📤'}</div>
      <div class="txn-info"><div class="txn-desc">${t.description||t.category}</div><div class="txn-meta">${t.category} · ${fmtDate(t.date)}${t.account_name?' · '+t.account_name:''}</div></div>
      <div class="txn-amount">${t.type==='income'?'+':'-'}${fmt(t.amount)}</div>
      <span class="txn-del" onclick="confirmDel('Xóa giao dịch?',()=>deleteTxn(${t.id}))">✕</span>
    </div>`).join('')}</div>`;
}

function renderFinanceCharts(summary) {
  const labels = summary.monthly.map(m => m.label);
  if (chartFinance) chartFinance.destroy();
  chartFinance = new Chart($('chart-finance'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Thu nhập', data: summary.monthly.map(m=>m.income),  backgroundColor: 'rgba(16,185,129,.65)', borderRadius: 6 },
      { label: 'Chi tiêu', data: summary.monthly.map(m=>m.expense), backgroundColor: 'rgba(239,68,68,.55)',  borderRadius: 6 }
    ]},
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ color:'#7b82a8', font:{ family:'Mona Sans', size:11 } } } },
      scales:{
        x:{ grid:{ color:'rgba(0,0,0,.04)' }, ticks:{ color:'#9ca3c0', font:{ family:'Mona Sans', size:10 } } },
        y:{ grid:{ color:'rgba(0,0,0,.04)' }, ticks:{ color:'#9ca3c0', font:{ family:'Mona Sans', size:10 }, callback: v=>fmt(v) } }
      }
    }
  });
  if (chartCats) chartCats.destroy();
  const cats = summary.expense_by_cat;
  if (cats.length) {
    const COLORS = ['#6366f1','#ec4899','#8b5cf6','#10b981','#f59e0b','#f97316','#06b6d4'];
    chartCats = new Chart($('chart-cats'), {
      type: 'doughnut',
      data: { labels: cats.map(c=>c.category), datasets:[{ data: cats.map(c=>c.total), backgroundColor: COLORS.slice(0,cats.length), borderWidth:2, borderColor:'#fff', hoverOffset:8 }] },
      options: { responsive:true, maintainAspectRatio:false, cutout:'65%',
        plugins:{ legend:{ position:'right', labels:{ color:'#7b82a8', font:{ family:'Mona Sans', size:11 }, padding:10 } } }
      }
    });
  }
}

async function deleteAccount(id) { await api(`/api/accounts/${id}`, 'DELETE'); loadFinance(); }
async function deleteTxn(id) { await api(`/api/transactions/${id}`, 'DELETE'); loadFinance(); loadDashboard(); }

// ─────────────────────────────────────────────────────
// MODALS
// ─────────────────────────────────────────────────────
const COLORS = ['#6366f1','#ec4899','#8b5cf6','#10b981','#f59e0b','#f97316','#06b6d4'];
let selectedColor = '#6366f1';
let selectedHabitType = 'boolean';

function colorChips(current = '#6366f1') {
  return COLORS.map(c => `<div class="color-chip${c===current?' sel':''}" style="background:${c}" onclick="selectColor('${c}')"></div>`).join('');
}
function selectColor(c) {
  selectedColor = c;
  document.querySelectorAll('.color-chip').forEach(el =>
    el.classList.toggle('sel', el.getAttribute('onclick')?.includes(`'${c}'`))
  );
}
function selectHabitType(type) {
  selectedHabitType = type;
  document.querySelectorAll('.type-option').forEach(el => el.classList.toggle('active', el.dataset.type === type));
  const gr = $('habit-goal-row');
  if (gr) gr.style.display = type === 'numeric' ? '' : 'none';
}

const MODALS = {
  habit: () => `
    <h2>🔥 Thêm thói quen</h2>
    <div class="form-row"><label>Loại thói quen</label>
      <div class="type-toggle">
        <button class="type-option active" data-type="boolean" onclick="selectHabitType('boolean')">✓ / ✗ &nbsp; Có / Không</button>
        <button class="type-option" data-type="numeric" onclick="selectHabitType('numeric')">123 &nbsp; Nhập số liệu</button>
      </div>
    </div>
    <div class="form-row"><label>Tên thói quen *</label><input id="m-name" placeholder="VD: Dậy sớm, Đọc sách..."></div>
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
      <button class="btn btn-primary" onclick="submitHabit()">Thêm</button>
    </div>`,

  todo: () => `
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
      <button class="btn btn-primary" onclick="submitTodo()">Thêm</button>
    </div>`,

  project: () => `
    <h2>🚀 Thêm dự án</h2>
    <div class="form-row"><label>Tên dự án *</label><input id="m-pname" placeholder="Tên dự án"></div>
    <div class="form-row"><label>Mô tả</label><textarea id="m-pdesc" placeholder="Mục tiêu dự án..."></textarea></div>
    <div class="form-2col">
      <div class="form-row"><label>Ngày bắt đầu</label><input type="date" id="m-pstart"></div>
      <div class="form-row"><label>Deadline</label><input type="date" id="m-pend"></div>
    </div>
    <div class="form-row"><label>Màu sắc</label><div class="color-chips">${colorChips()}</div></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="submitProject()">Tạo dự án</button>
    </div>`,

  account: () => `
    <h2>💳 Thêm tài khoản</h2>
    <div class="form-row"><label>Tên tài khoản *</label><input id="m-aname" placeholder="VD: Tài khoản chính..."></div>
    <div class="form-2col">
      <div class="form-row"><label>Loại</label>
        <select id="m-atype"><option value="checking">Thanh toán</option><option value="savings">Tiết kiệm</option><option value="investment">Đầu tư</option></select>
      </div>
      <div class="form-row"><label>Số dư</label><input type="number" id="m-abal" value="0"></div>
    </div>
    <div class="form-2col">
      <div class="form-row"><label>Tiền tệ</label><select id="m-acur"><option value="VND">VND</option><option value="USD">USD</option></select></div>
      <div class="form-row"><label>Màu sắc</label><div class="color-chips">${colorChips()}</div></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="submitAccount()">Thêm</button>
    </div>`,

  txn: async () => {
    const accounts = await api('/api/accounts');
    const accOpts  = accounts.length ? accounts.map(a=>`<option value="${a.id}">${a.name} (${fmt(a.balance)})</option>`).join('') : '<option value="">-- Không có tài khoản --</option>';
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
      <button class="btn btn-primary" onclick="submitTxn()">Thêm</button>
    </div>`;
  }
};

function updateCatList() {
  const type = $('m-ttype')?.value;
  const cats = type==='income' ? TXN_CATS_INC : TXN_CATS_EXP;
  const sel  = $('m-tcat');
  if (sel) sel.innerHTML = cats.map(c=>`<option>${c}</option>`).join('');
}

async function openModal(type) {
  selectedColor = '#6366f1'; selectedHabitType = 'boolean';
  const modal   = $('modal-content');
  modal.innerHTML = typeof MODALS[type]==='function' ? await MODALS[type]() : MODALS[type];
  $('overlay').classList.add('show');
}
function closeModal() { $('overlay').classList.remove('show'); }

async function submitHabit() {
  const name = $('m-name')?.value.trim();
  if (!name) return alert('Vui lòng nhập tên thói quen');
  const isNum = selectedHabitType === 'numeric';
  await api('/api/habits', 'POST', {
    name, description: $('m-desc')?.value||'', color: selectedColor,
    icon: $('m-icon')?.value||'⭐', type: selectedHabitType,
    unit: isNum ? ($('m-unit')?.value||'') : '',
    daily_goal: isNum ? (parseFloat($('m-goal')?.value)||1) : 1,
  });
  closeModal(); loadHabits();
}
async function submitTodo() {
  const title = $('m-title')?.value.trim();
  if (!title) return alert('Vui lòng nhập tiêu đề');
  await api('/api/todos', 'POST', { title, description: $('m-tdesc')?.value, priority: $('m-priority')?.value, category: $('m-cat')?.value||'general', due_date: $('m-due')?.value||null });
  closeModal(); loadTodos(); loadDashboard();
}
async function submitProject() {
  const name = $('m-pname')?.value.trim();
  if (!name) return alert('Vui lòng nhập tên dự án');
  await api('/api/projects', 'POST', { name, description: $('m-pdesc')?.value, color: selectedColor, start_date: $('m-pstart')?.value||null, end_date: $('m-pend')?.value||null });
  closeModal(); loadProjects(); loadDashboard();
}
async function submitAccount() {
  const name = $('m-aname')?.value.trim();
  if (!name) return alert('Vui lòng nhập tên tài khoản');
  await api('/api/accounts', 'POST', { name, type: $('m-atype')?.value, balance: parseFloat($('m-abal')?.value)||0, currency: $('m-acur')?.value, color: selectedColor });
  closeModal(); loadFinance();
}
async function submitTxn() {
  const amount = parseFloat($('m-tamount')?.value);
  if (!amount||amount<=0) return alert('Vui lòng nhập số tiền hợp lệ');
  const accId = $('m-tacc')?.value;
  await api('/api/transactions', 'POST', { amount, type: $('m-ttype')?.value, category: $('m-tcat')?.value, description: $('m-tdesc2')?.value, account_id: accId?parseInt(accId):null, date: $('m-tdate')?.value });
  closeModal(); loadFinance(); loadDashboard();
}

$('overlay').addEventListener('click', e => { if (e.target===$('overlay')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key==='Escape') closeModal(); });

// ─────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────
loadDashboard();
