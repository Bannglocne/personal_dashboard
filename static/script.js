// ─────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────
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

// Hex color → "r,g,b" string
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// ─────────────────────────────────────────────────────────────────
// CLOCK
// ─────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('datedisp').textContent = now.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
setInterval(updateClock, 1000);
updateClock();

// ─────────────────────────────────────────────────────────────────
// NAV
// ─────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  const d = await api('/api/dashboard');
  $('ds-habits').textContent  = `${d.habits.completed}/${d.habits.total}`;
  $('ds-todos').textContent   = d.todos.pending;
  $('ds-projects').textContent = d.projects.active;
  $('ds-income').textContent  = fmt(d.finance.income);
  $('ds-expense').textContent = `chi tiêu: ${fmt(d.finance.expense)}`;

  const todayStr = today();
  const renderList = (items, elId) => {
    const el = $(elId);
    if (!items.length) { el.innerHTML = '<div class="empty"><p>Không có việc nào</p></div>'; return; }
    el.innerHTML = items.map(t => {
      const due = t.due_date ? `<span class="badge badge-due${t.due_date < todayStr ? ' overdue' : ''}">${fmtDate(t.due_date)}</span>` : '';
      return `<div class="quick-item">
        <span class="badge ${priClass(t.priority)}">${t.priority}</span>
        <span style="flex:1;font-weight:500">${t.title}</span>${due}</div>`;
    }).join('');
  };
  renderList(d.recent_todos, 'dash-todos-list');
  renderList(d.upcoming, 'dash-upcoming-list');
}

// ─────────────────────────────────────────────────────────────────
// HABITS — STATE
// ─────────────────────────────────────────────────────────────────
const habitHistories  = {};   // id → 365-day history (lazy loaded)
const habitChartInst  = {};   // id → Chart.js instance
const habitExpandState = {}; // id → { open: bool, period: 'month' }

// ─────────────────────────────────────────────────────────────────
// HABITS — RENDER
// ─────────────────────────────────────────────────────────────────
async function loadHabits() {
  const habits = await api('/api/habits');
  const wrap = $('habit-list-wrap');
  if (!habits.length) {
    wrap.innerHTML = '<div class="empty"><span class="e-icon">🔥</span><p>Chưa có thói quen nào. Hãy thêm thói quen đầu tiên!</p></div>';
    return;
  }
  wrap.innerHTML = `<div class="habit-list">${habits.map(h => habitCardHTML(h)).join('')}</div>`;

  // Restore any open panels
  habits.forEach(h => {
    if (habitExpandState[h.id]?.open) {
      // Re-open and re-render the detail panel
      _openHabitDetail(h.id, h);
    }
  });
}

function habitCardHTML(h) {
  const isNum  = h.type === 'numeric';
  const rgb    = hexToRgb(h.color || '#6366f1');
  const goal   = h.daily_goal || 1;
  const val    = h.today_value || 0;
  const pct    = Math.min(100, Math.round(val / goal * 100));
  const done   = h.completed_today;

  // 28-day dots (4×7)
  const dots = h.history.map((d, i) => {
    let cls = 'habit-dot';
    if (isNum) {
      const p = d.value / goal;
      if (p >= 1) cls += ' done';
      else if (p > 0) cls += ' partial';
    } else {
      if (d.done) cls += ' done';
    }
    return `<div class="${cls}" title="${d.date}"></div>`;
  }).join('');

  // Left control: boolean checkbox OR numeric ring + input
  const leftCtrl = isNum
    ? `<div class="habit-ring-wrap">
        <svg class="habit-ring" width="36" height="36" viewBox="0 0 36 36">
          <circle class="habit-ring-bg" cx="18" cy="18" r="15"/>
          <circle class="habit-ring-fg"
            cx="18" cy="18" r="15"
            stroke="rgba(${rgb},0.85)"
            stroke-dasharray="${2 * Math.PI * 15}"
            stroke-dashoffset="${2 * Math.PI * 15 * (1 - pct / 100)}"/>
        </svg>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:rgba(${rgb},1)">${pct}%</div>
      </div>`
    : `<div class="habit-check${done ? ' done' : ''}" style="--h-color:${h.color}"
           onclick="logHabit(${h.id},'boolean')">${done ? '✓' : ''}</div>`;

  // Right control: boolean → streak only | numeric → input row
  const logArea = isNum
    ? `<div class="habit-log-area">
        <input class="habit-num-input" id="num-${h.id}"
               type="number" min="0" step="any"
               value="${val > 0 ? val : ''}"
               placeholder="0"
               onkeydown="if(event.key==='Enter')submitNumericHabit(${h.id})">
        <span style="font-size:12px;color:var(--muted2)">${h.unit || ''}</span>
        <button class="habit-log-btn${done ? ' logged' : ''}"
                onclick="submitNumericHabit(${h.id})">
          ${done ? '✓ Đã ghi' : 'Ghi'}
        </button>
      </div>`
    : '';

  const typeTag = `<span class="habit-type-tag ${isNum ? 'type-numeric' : 'type-boolean'}">${isNum ? '123' : '✓/✗'}</span>`;

  const progressMini = isNum
    ? `<div class="habit-progress-mini">
        <div class="habit-pbar"><div class="habit-pbar-fill" style="width:${pct}%;background:${h.color}"></div></div>
        <span class="habit-pval">${val}${h.unit ? ' ' + h.unit : ''} / ${goal}${h.unit ? ' ' + h.unit : ''}</span>
      </div>`
    : '';

  const isOpen = habitExpandState[h.id]?.open;

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
        ${progressMini}
        <div class="habit-dots" style="--h-color:${h.color}">${dots}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        ${logArea}
        <div class="habit-streak">🔥 ${h.streak}</div>
        <div class="habit-actions">
          <button class="icon-btn" onclick="confirmDel('Xóa thói quen này?',()=>deleteHabit(${h.id}))">🗑</button>
        </div>
      </div>
    </div>
    <button class="habit-expand-btn${isOpen ? ' open' : ''}" onclick="toggleHabitDetail(${h.id})" id="expand-btn-${h.id}">
      <span class="chevron">▾</span>
      <span>Xem lịch sử năm${h.type === 'numeric' ? ' & biểu đồ' : ''}</span>
    </button>
    <div class="habit-detail${isOpen ? ' open' : ''}" id="habit-detail-${h.id}">
      <div class="habit-detail-inner" id="habit-detail-inner-${h.id}">
        <div style="color:var(--muted2);font-size:13px;text-align:center;padding:20px">Đang tải...</div>
      </div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────
// HABITS — ACTIONS
// ─────────────────────────────────────────────────────────────────
async function logHabit(id, type) {
  await api(`/api/habits/${id}/log`, 'POST', {});
  loadHabits();
  loadDashboard();
}

async function submitNumericHabit(id) {
  const inp = $(`num-${id}`);
  const val = parseFloat(inp?.value);
  if (isNaN(val) || val < 0) return;
  await api(`/api/habits/${id}/log`, 'POST', { value: val });
  // If panel was open, keep it open
  const wasOpen = habitExpandState[id]?.open;
  const period  = habitExpandState[id]?.period || 'month';
  await loadHabits();
  if (wasOpen) {
    habitExpandState[id] = { open: true, period };
  }
  loadDashboard();
}

async function deleteHabit(id) {
  await api(`/api/habits/${id}`, 'DELETE');
  delete habitHistories[id];
  delete habitExpandState[id];
  if (habitChartInst[id]) { habitChartInst[id].destroy(); delete habitChartInst[id]; }
  loadHabits();
  loadDashboard();
}

// ─────────────────────────────────────────────────────────────────
// HABITS — EXPAND / DETAIL PANEL
// ─────────────────────────────────────────────────────────────────
async function toggleHabitDetail(id) {
  const panel  = $(`habit-detail-${id}`);
  const btn    = $(`expand-btn-${id}`);
  const state  = habitExpandState[id] || { open: false, period: 'month' };
  state.open   = !state.open;
  habitExpandState[id] = state;
  panel.classList.toggle('open', state.open);
  btn.classList.toggle('open', state.open);

  if (state.open) {
    await _openHabitDetail(id, null);
  }
}

async function _openHabitDetail(id, habitData) {
  const inner = $(`habit-detail-inner-${id}`);
  if (!inner) return;

  // Load history once
  if (!habitHistories[id]) {
    habitHistories[id] = await api(`/api/habits/${id}/history`);
  }

  // Fetch habit metadata from cached list (re-fetch if needed)
  let h = habitData;
  if (!h) {
    const list = await api('/api/habits');
    h = list.find(x => x.id === id);
  }
  if (!h) return;

  const period = habitExpandState[id]?.period || 'month';
  inner.innerHTML = buildDetailHTML(h, period);

  // Draw contribution graph
  const contribEl = $(`contrib-svg-${id}`);
  if (contribEl) contribEl.innerHTML = buildContributionSVG(habitHistories[id], h.color, h.type, h.daily_goal || 1);

  // Draw chart for numeric
  if (h.type === 'numeric') {
    await renderHabitChart(id, period, h.color, h.daily_goal || 1, h.unit || '');
  }
}

function buildDetailHTML(h, period) {
  const isNum   = h.type === 'numeric';
  const history = habitHistories[h.id] || [];
  const total   = history.filter(d => d.done).length;
  const streak  = h.streak || 0;

  const chartSection = isNum ? `
    <div class="habit-chart-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span class="contrib-title">📈 Biểu đồ tiến độ</span>
        <div class="habit-chart-tabs">
          <button class="chart-tab${period==='week'?' active':''}"   onclick="changeHabitPeriod(${h.id},'week')">Tuần</button>
          <button class="chart-tab${period==='month'?' active':''}"  onclick="changeHabitPeriod(${h.id},'month')">Tháng</button>
          <button class="chart-tab${period==='year'?' active':''}"   onclick="changeHabitPeriod(${h.id},'year')">Năm</button>
        </div>
      </div>
      <div class="habit-chart-canvas-wrap">
        <canvas id="habit-chart-${h.id}"></canvas>
      </div>
    </div>` : '';

  return `
    <div class="contrib-header">
      <span class="contrib-title">📅 Lịch sử 365 ngày</span>
      <div class="contrib-stats">
        <span class="contrib-stat">Hoàn thành <strong>${total}</strong> ngày</span>
        <span class="contrib-stat">Streak hiện tại <strong>${streak} 🔥</strong></span>
      </div>
    </div>
    <div class="contrib-scroll">
      <div id="contrib-svg-${h.id}"></div>
    </div>
    <div class="contrib-legend">
      <span>Ít hơn</span>
      ${[0,1,2,3,4].map(l => `<div class="contrib-swatch" style="background:${contribLevelColor(h.color,l)}"></div>`).join('')}
      <span>Nhiều hơn</span>
    </div>
    ${chartSection}`;
}

async function changeHabitPeriod(id, period) {
  if (!habitExpandState[id]) habitExpandState[id] = { open: true, period };
  habitExpandState[id].period = period;

  // Update tab UI
  const list = await api('/api/habits');
  const h    = list.find(x => x.id === id);
  if (!h) return;

  // Re-render only the chart section
  const inner = $(`habit-detail-inner-${id}`);
  if (!inner) return;

  // Update tab active states
  inner.querySelectorAll('.chart-tab').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase() === periodLabel(period));
  });

  if (habitChartInst[id]) { habitChartInst[id].destroy(); delete habitChartInst[id]; }
  await renderHabitChart(id, period, h.color, h.daily_goal || 1, h.unit || '');
}

function periodLabel(p) { return p==='week'?'tuần':p==='month'?'tháng':'năm'; }

// ─────────────────────────────────────────────────────────────────
// CONTRIBUTION GRAPH (GitHub-style SVG)
// ─────────────────────────────────────────────────────────────────
const MONTHS_VI = ['Th1','Th2','Th3','Th4','Th5','Th6','Th7','Th8','Th9','Th10','Th11','Th12'];

function contribLevelColor(hex, level) {
  if (level === 0) return '#e8eaf0';
  const rgb = hexToRgb(hex);
  const opacities = [0, 0.2, 0.42, 0.68, 0.90];
  return `rgba(${rgb},${opacities[level]})`;
}

function valueToLevel(type, val, goal) {
  if (type === 'boolean') return val ? 4 : 0;
  if (val <= 0) return 0;
  const r = val / goal;
  if (r < 0.33) return 1;
  if (r < 0.66) return 2;
  if (r < 1.00) return 3;
  return 4;
}

function buildContributionSVG(history, color, type, goal) {
  const CELL = 11, GAP = 2, STEP = CELL + GAP;

  // Build date → entry map
  const map = {};
  history.forEach(h => { map[h.date] = h; });

  // Start date: 52 weeks ago, adjusted to Monday
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 364);
  const dow = startDate.getDay(); // 0=Sun,1=Mon,...
  const toMon = dow === 0 ? -6 : 1 - dow;
  startDate.setDate(startDate.getDate() + toMon);

  const totalWeeks = Math.ceil((endDate - startDate) / (7 * 864e5)) + 1;
  const LEFT_PAD   = 24; // for day labels
  const TOP_PAD    = 18; // for month labels
  const W = LEFT_PAD + totalWeeks * STEP;
  const H = TOP_PAD + 7 * STEP;

  let cells = '', monthLabels = '', lastMonth = -1;

  for (let w = 0; w < totalWeeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(startDate);
      cellDate.setDate(startDate.getDate() + w * 7 + d);
      if (cellDate > endDate) continue;

      const dateStr = cellDate.toISOString().slice(0, 10);
      const entry   = map[dateStr];
      const val     = entry ? entry.value : 0;
      const level   = valueToLevel(type, val, goal);
      const fill    = contribLevelColor(color, level);
      const x       = LEFT_PAD + w * STEP;
      const y       = TOP_PAD  + d * STEP;
      const tipTxt  = type === 'boolean'
        ? `${dateStr}: ${entry?.done ? 'Hoàn thành ✓' : 'Chưa'}`
        : `${dateStr}: ${val}`;

      cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2"
                  fill="${fill}" data-date="${dateStr}" data-val="${val}">
                  <title>${tipTxt}</title></rect>`;

      // Month label on first day of month
      if (d === 0 && cellDate.getDate() <= 7 && cellDate.getMonth() !== lastMonth) {
        monthLabels += `<text x="${x}" y="${TOP_PAD - 4}" font-size="9"
                          fill="#9ca3c0" font-family="Mona Sans,sans-serif">
                          ${MONTHS_VI[cellDate.getMonth()]}</text>`;
        lastMonth = cellDate.getMonth();
      }
    }
  }

  // Day labels: Mon, Wed, Fri
  const DAY_LABELS = [{ d: 0, l: 'T2' }, { d: 2, l: 'T4' }, { d: 4, l: 'T6' }];
  const dayLabels  = DAY_LABELS.map(({ d, l }) =>
    `<text x="${LEFT_PAD - 4}" y="${TOP_PAD + d * STEP + CELL}" font-size="8"
       fill="#9ca3c0" font-family="Mona Sans,sans-serif" text-anchor="end">${l}</text>`
  ).join('');

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${monthLabels}${dayLabels}${cells}
  </svg>`;
}

// ─────────────────────────────────────────────────────────────────
// HABIT CHART (Chart.js line/bar)
// ─────────────────────────────────────────────────────────────────
async function renderHabitChart(id, period, color, goal, unit) {
  const canvas = $(`habit-chart-${id}`);
  if (!canvas) return;

  if (habitChartInst[id]) { habitChartInst[id].destroy(); delete habitChartInst[id]; }

  const data = await api(`/api/habits/${id}/chart?period=${period}`);
  const labels = data.map(d => d.label);
  const values = data.map(d => d.value);
  const rgb    = hexToRgb(color);

  const ctx  = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 180);
  grad.addColorStop(0,   `rgba(${rgb},0.22)`);
  grad.addColorStop(1,   `rgba(${rgb},0)`);

  const goalValues = data.map(d => d.goal || goal);

  habitChartInst[id] = new Chart(ctx, {
    type: period === 'year' ? 'bar' : 'line',
    data: {
      labels,
      datasets: [
        {
          label: `${unit || 'Giá trị'}`,
          data: values,
          borderColor: color,
          backgroundColor: period === 'year' ? `rgba(${rgb},0.65)` : grad,
          fill: period !== 'year',
          tension: 0.4,
          pointRadius: period === 'year' ? 0 : 3,
          pointHoverRadius: 5,
          pointBackgroundColor: color,
          borderWidth: 2,
          borderRadius: period === 'year' ? 6 : 0,
        },
        {
          label: 'Mục tiêu',
          data: goalValues,
          borderColor: 'rgba(99,102,241,0.35)',
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
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: '#7b82a8',
            font: { family: 'Mona Sans', size: 11 },
            boxWidth: 12,
            padding: 12,
          }
        },
        tooltip: {
          backgroundColor: '#ffffff',
          titleColor: '#1e2140',
          bodyColor: '#4a5071',
          borderColor: 'rgba(99,102,241,0.15)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}${unit ? ' ' + unit : ''}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: { color: '#9ca3c0', font: { family: 'Mona Sans', size: 10 },
                   maxTicksLimit: period === 'week' ? 7 : period === 'month' ? 10 : 12 }
        },
        y: {
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: { color: '#9ca3c0', font: { family: 'Mona Sans', size: 10 } },
          beginAtZero: true,
        }
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// TODOS
// ─────────────────────────────────────────────────────────────────
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
  wrap.innerHTML = `<div class="todo-list">${todos.map(t => todoHTML(t)).join('')}</div>`;
}

function todoHTML(t) {
  const done    = t.status === 'done';
  const todayStr = today();
  const overdue  = t.due_date && t.due_date < todayStr && !done;
  const dueLabel = t.due_date ? `<span class="badge badge-due${overdue ? ' overdue' : ''}">${fmtDate(t.due_date)}</span>` : '';
  const inProg   = t.status === 'in_progress'
    ? `<span class="badge" style="background:rgba(99,102,241,.08);color:var(--primary);border:1px solid rgba(99,102,241,.2)">In Progress</span>` : '';
  return `<div class="todo-item${done ? ' done-item' : ''}">
    <div class="todo-check${done ? ' checked' : ''}" onclick="cycleStatus(${t.id},'${t.status}')">
      ${done ? '✓' : t.status === 'in_progress' ? '…' : ''}
    </div>
    <div class="todo-body">
      <div class="todo-title${done ? ' striked' : ''}">${t.title}</div>
      ${t.description ? `<div style="color:var(--muted2);font-size:12px;margin-top:3px">${t.description}</div>` : ''}
      <div class="todo-meta">
        <span class="badge ${priClass(t.priority)}">${t.priority}</span>
        ${t.category ? `<span class="badge badge-cat">${t.category}</span>` : ''}
        ${inProg}${dueLabel}
      </div>
    </div>
    <div class="todo-actions">
      <button class="icon-btn btn-sm" onclick="confirmDel('Xóa việc này?',()=>deleteTodo(${t.id}))">🗑</button>
    </div>
  </div>`;
}

async function cycleStatus(id, current) {
  const next = current === 'pending' ? 'in_progress' : current === 'in_progress' ? 'done' : 'pending';
  await api(`/api/todos/${id}`, 'PUT', { status: next });
  loadTodos(); loadDashboard();
}

async function deleteTodo(id) {
  await api(`/api/todos/${id}`, 'DELETE');
  loadTodos(); loadDashboard();
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    loadTodos();
  });
});

// ─────────────────────────────────────────────────────────────────
// PROJECTS
// ─────────────────────────────────────────────────────────────────
async function loadProjects() {
  const projects = await api('/api/projects');
  const wrap = $('project-list-wrap');
  if (!projects.length) {
    wrap.innerHTML = '<div class="empty"><span class="e-icon">🚀</span><p>Chưa có dự án nào.</p></div>';
    return;
  }
  wrap.innerHTML = projects.map(p => projectHTML(p)).join('');
}

function statusLabel(s) {
  return s === 'active'    ? `<span class="project-status status-active">Đang chạy</span>`
       : s === 'completed' ? `<span class="project-status status-completed">Hoàn thành</span>`
       :                     `<span class="project-status status-paused">Tạm dừng</span>`;
}

function projectHTML(p) {
  const doneCount = p.tasks.filter(t => t.completed).length;
  const tasks = p.tasks.map(t => `
    <div class="task-item">
      <div class="task-check${t.completed ? ' done' : ''}" onclick="toggleTask(${p.id},${t.id})">${t.completed ? '✓' : ''}</div>
      <span class="task-title${t.completed ? ' done-text' : ''}">${t.title}</span>
      <button class="icon-btn" style="width:22px;height:22px;font-size:10px" onclick="deleteTask(${p.id},${t.id})">✕</button>
    </div>`).join('');

  return `<div class="project-card">
    <div class="project-header">
      <div class="project-dot" style="background:${p.color};box-shadow:0 0 6px ${p.color}80"></div>
      <div class="project-name">${p.name}</div>
      ${statusLabel(p.status)}
      <button class="icon-btn" onclick="confirmDel('Xóa dự án?',()=>deleteProject(${p.id}))">🗑</button>
    </div>
    ${p.description ? `<div style="color:var(--muted2);font-size:13px;margin-bottom:10px">${p.description}</div>` : ''}
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

// ─────────────────────────────────────────────────────────────────
// FINANCE
// ─────────────────────────────────────────────────────────────────
const ACC_TYPES = { checking: 'Thanh toán', savings: 'Tiết kiệm', investment: 'Đầu tư' };
const TXN_CATS_EXP = ['ăn uống','đi lại','nhà cửa','mua sắm','giải trí','sức khỏe','giáo dục','tiết kiệm','đầu tư','khác'];
const TXN_CATS_INC = ['lương','thưởng','đầu tư','kinh doanh','khác'];
let chartFinance = null, chartCats = null;

async function loadFinance() {
  const [accounts, txns, summary] = await Promise.all([
    api('/api/accounts'),
    api('/api/transactions'),
    api('/api/finance/summary')
  ]);
  renderAccounts(accounts);
  renderTxns(txns);
  renderFinanceCharts(summary);
}

function renderAccounts(accounts) {
  const wrap = $('account-grid-wrap');
  if (!accounts.length) { wrap.innerHTML = '<div style="color:var(--muted2);font-size:13px;padding:10px 0">Chưa có tài khoản nào.</div>'; return; }
  wrap.innerHTML = accounts.map(a => `
    <div class="account-card" style="--accent:${a.color}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div class="account-type">${ACC_TYPES[a.type] || a.type}</div>
          <div class="account-name">${a.name}</div>
        </div>
        <button class="icon-btn" onclick="confirmDel('Xóa tài khoản này?',()=>deleteAccount(${a.id}))">🗑</button>
      </div>
      <div class="account-balance">${fmt(a.balance)}</div>
      <div class="account-currency">${a.currency}</div>
    </div>`).join('');
}

function renderTxns(txns) {
  const wrap = $('txn-list-wrap');
  if (!txns.length) { wrap.innerHTML = '<div class="empty"><p>Chưa có giao dịch nào.</p></div>'; return; }
  wrap.innerHTML = `<div class="txn-list">${txns.slice(0, 50).map(t => `
    <div class="txn-item txn-${t.type}">
      <div class="txn-icon">${t.type === 'income' ? '📥' : '📤'}</div>
      <div class="txn-info">
        <div class="txn-desc">${t.description || t.category}</div>
        <div class="txn-meta">${t.category} · ${fmtDate(t.date)}${t.account_name ? ' · ' + t.account_name : ''}</div>
      </div>
      <div class="txn-amount">${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}</div>
      <span class="txn-del" onclick="confirmDel('Xóa giao dịch?',()=>deleteTxn(${t.id}))">✕</span>
    </div>`).join('')}</div>`;
}

function renderFinanceCharts(summary) {
  const labels  = summary.monthly.map(m => m.label);
  const incomes = summary.monthly.map(m => m.income);
  const expenses = summary.monthly.map(m => m.expense);

  if (chartFinance) chartFinance.destroy();
  chartFinance = new Chart($('chart-finance'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Thu nhập', data: incomes,  backgroundColor: 'rgba(16,185,129,.65)', borderRadius: 6 },
        { label: 'Chi tiêu', data: expenses, backgroundColor: 'rgba(239,68,68,.55)',  borderRadius: 6 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#7b82a8', font: { family: 'Mona Sans', size: 11 } } } },
      scales: {
        x: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { color: '#9ca3c0', font: { family: 'Mona Sans', size: 10 } } },
        y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { color: '#9ca3c0', font: { family: 'Mona Sans', size: 10 }, callback: v => fmt(v) } }
      }
    }
  });

  if (chartCats) chartCats.destroy();
  const cats = summary.expense_by_cat;
  if (cats.length) {
    const COLORS = ['#6366f1','#ec4899','#8b5cf6','#10b981','#f59e0b','#f97316','#06b6d4'];
    chartCats = new Chart($('chart-cats'), {
      type: 'doughnut',
      data: {
        labels: cats.map(c => c.category),
        datasets: [{ data: cats.map(c => c.total), backgroundColor: COLORS.slice(0, cats.length), borderWidth: 2, borderColor: '#ffffff', hoverOffset: 8 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: { legend: { position: 'right', labels: { color: '#7b82a8', font: { family: 'Mona Sans', size: 11 }, padding: 10 } } }
      }
    });
  }
}

async function deleteAccount(id) { await api(`/api/accounts/${id}`, 'DELETE'); loadFinance(); }
async function deleteTxn(id) { await api(`/api/transactions/${id}`, 'DELETE'); loadFinance(); loadDashboard(); }

// ─────────────────────────────────────────────────────────────────
// MODALS
// ─────────────────────────────────────────────────────────────────
const COLORS = ['#6366f1','#ec4899','#8b5cf6','#10b981','#f59e0b','#f97316','#06b6d4'];
let selectedColor = '#6366f1';
let selectedHabitType = 'boolean';

function colorChips(current = '#6366f1') {
  return COLORS.map(c =>
    `<div class="color-chip${c === current ? ' sel' : ''}" style="background:${c}"
          onclick="selectColor('${c}')"></div>`
  ).join('');
}

function selectColor(c) {
  selectedColor = c;
  document.querySelectorAll('.color-chip').forEach(el => {
    const bg = el.style.backgroundColor;
    const match = COLORS.find(x => {
      const t = document.createElement('div'); t.style.color = x;
      document.body.appendChild(t);
      const comp = getComputedStyle(t).color; document.body.removeChild(t);
      return comp === bg;
    });
    el.classList.toggle('sel', el.style.background === c || el.getAttribute('onclick')?.includes(`'${c}'`));
  });
}

function selectHabitType(type) {
  selectedHabitType = type;
  document.querySelectorAll('.type-option').forEach(el => el.classList.toggle('active', el.dataset.type === type));
  const goalRow = $('habit-goal-row');
  if (goalRow) goalRow.style.display = type === 'numeric' ? '' : 'none';
}

const MODALS = {
  habit: () => `
    <h2>🔥 Thêm thói quen</h2>
    <div class="form-row">
      <label>Loại thói quen</label>
      <div class="type-toggle">
        <button class="type-option active" data-type="boolean" onclick="selectHabitType('boolean')">✓ / ✗ &nbsp; Có / Không</button>
        <button class="type-option" data-type="numeric" onclick="selectHabitType('numeric')">123 &nbsp; Nhập số liệu</button>
      </div>
    </div>
    <div class="form-row"><label>Tên thói quen *</label><input id="m-name" placeholder="VD: Dậy sớm, Đọc sách..."></div>
    <div class="form-row"><label>Mô tả</label><input id="m-desc" placeholder="Mô tả ngắn (tuỳ chọn)"></div>
    <div class="form-2col">
      <div class="form-row"><label>Icon</label><input id="m-icon" value="⭐" placeholder="emoji"></div>
      <div class="form-row" id="habit-goal-row" style="display:none">
        <label>Mục tiêu / ngày</label>
        <div style="display:flex;gap:6px;align-items:center">
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
    <div class="form-row"><label>Tên tài khoản *</label><input id="m-aname" placeholder="VD: Tài khoản chính, Tiết kiệm..."></div>
    <div class="form-2col">
      <div class="form-row"><label>Loại</label>
        <select id="m-atype"><option value="checking">Thanh toán</option><option value="savings">Tiết kiệm</option><option value="investment">Đầu tư</option></select>
      </div>
      <div class="form-row"><label>Số dư</label><input type="number" id="m-abal" value="0"></div>
    </div>
    <div class="form-2col">
      <div class="form-row"><label>Tiền tệ</label>
        <select id="m-acur"><option value="VND">VND</option><option value="USD">USD</option></select>
      </div>
      <div class="form-row"><label>Màu sắc</label><div class="color-chips">${colorChips()}</div></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="submitAccount()">Thêm</button>
    </div>`,

  txn: async () => {
    const accounts = await api('/api/accounts');
    const accOpts  = accounts.length
      ? accounts.map(a => `<option value="${a.id}">${a.name} (${fmt(a.balance)})</option>`).join('')
      : '<option value="">-- Không có tài khoản --</option>';
    return `
    <h2>💸 Thêm giao dịch</h2>
    <div class="form-2col">
      <div class="form-row"><label>Loại</label>
        <select id="m-ttype" onchange="updateCatList()">
          <option value="expense">Chi tiêu</option><option value="income">Thu nhập</option>
        </select>
      </div>
      <div class="form-row"><label>Số tiền *</label><input type="number" id="m-tamount" placeholder="0"></div>
    </div>
    <div class="form-2col">
      <div class="form-row"><label>Danh mục</label>
        <select id="m-tcat">${TXN_CATS_EXP.map(c => `<option>${c}</option>`).join('')}</select>
      </div>
      <div class="form-row"><label>Tài khoản</label>
        <select id="m-tacc"><option value="">-- Không chọn --</option>${accOpts}</select>
      </div>
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
  const cats  = type === 'income' ? TXN_CATS_INC : TXN_CATS_EXP;
  const sel   = $('m-tcat');
  if (sel) sel.innerHTML = cats.map(c => `<option>${c}</option>`).join('');
}

async function openModal(type) {
  selectedColor     = '#6366f1';
  selectedHabitType = 'boolean';
  const modal   = $('modal-content');
  const content = typeof MODALS[type] === 'function' ? await MODALS[type]() : MODALS[type];
  modal.innerHTML = content;
  $('overlay').classList.add('show');
}

function closeModal() { $('overlay').classList.remove('show'); }

// ─── Submit handlers ───────────────────────────────────────────
async function submitHabit() {
  const name = $('m-name')?.value.trim();
  if (!name) return alert('Vui lòng nhập tên thói quen');
  const isNum = selectedHabitType === 'numeric';
  await api('/api/habits', 'POST', {
    name,
    description: $('m-desc')?.value || '',
    color:       selectedColor,
    icon:        $('m-icon')?.value || '⭐',
    type:        selectedHabitType,
    unit:        isNum ? ($('m-unit')?.value || '') : '',
    daily_goal:  isNum ? (parseFloat($('m-goal')?.value) || 1) : 1,
  });
  closeModal(); loadHabits();
}

async function submitTodo() {
  const title = $('m-title')?.value.trim();
  if (!title) return alert('Vui lòng nhập tiêu đề');
  await api('/api/todos', 'POST', {
    title, description: $('m-tdesc')?.value,
    priority: $('m-priority')?.value,
    category: $('m-cat')?.value || 'general',
    due_date: $('m-due')?.value || null
  });
  closeModal(); loadTodos(); loadDashboard();
}

async function submitProject() {
  const name = $('m-pname')?.value.trim();
  if (!name) return alert('Vui lòng nhập tên dự án');
  await api('/api/projects', 'POST', {
    name, description: $('m-pdesc')?.value, color: selectedColor,
    start_date: $('m-pstart')?.value || null,
    end_date:   $('m-pend')?.value || null,
  });
  closeModal(); loadProjects(); loadDashboard();
}

async function submitAccount() {
  const name = $('m-aname')?.value.trim();
  if (!name) return alert('Vui lòng nhập tên tài khoản');
  await api('/api/accounts', 'POST', {
    name, type: $('m-atype')?.value,
    balance: parseFloat($('m-abal')?.value) || 0,
    currency: $('m-acur')?.value, color: selectedColor
  });
  closeModal(); loadFinance();
}

async function submitTxn() {
  const amount = parseFloat($('m-tamount')?.value);
  if (!amount || amount <= 0) return alert('Vui lòng nhập số tiền hợp lệ');
  const accId = $('m-tacc')?.value;
  await api('/api/transactions', 'POST', {
    amount, type: $('m-ttype')?.value,
    category: $('m-tcat')?.value,
    description: $('m-tdesc2')?.value,
    account_id: accId ? parseInt(accId) : null,
    date: $('m-tdate')?.value
  });
  closeModal(); loadFinance(); loadDashboard();
}

// Close modal
$('overlay').addEventListener('click', e => { if (e.target === $('overlay')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ─────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────
loadDashboard();
