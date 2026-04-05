const API = '';  // same origin
let currentFilter = 'all';
let editTodoId = null;
let chartFinance = null;
let chartCats = null;

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('vi-VN').format(Math.round(n));
const fmtDate = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('vi-VN') : '';
const today = () => new Date().toISOString().slice(0,10);

async function api(path, method='GET', body=null) {
  const opts = { method, headers: {'Content-Type':'application/json'} };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function confirmDel(msg, cb) {
  if (confirm(msg)) cb();
}

// Clock
function updateClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString('vi-VN', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  $('datedisp').textContent = now.toLocaleDateString('vi-VN', {weekday:'long',day:'numeric',month:'long',year:'numeric'});
}
setInterval(updateClock, 1000);
updateClock();

// Nav
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
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

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────
async function loadDashboard() {
  const d = await api('/api/dashboard');
  $('ds-habits').textContent    = `${d.habits.completed}/${d.habits.total}`;
  $('ds-todos').textContent     = d.todos.pending;
  $('ds-projects').textContent  = d.projects.active;
  $('ds-income').textContent    = fmt(d.finance.income);
  $('ds-expense').textContent   = `chi tiêu: ${fmt(d.finance.expense)}`;

  const todayStr = today();
  const renderList = (items, elId) => {
    const el = $(elId);
    if (!items.length) { el.innerHTML = '<div class="empty"><p>Không có việc nào</p></div>'; return; }
    el.innerHTML = items.map(t => {
      const due = t.due_date ? `<span class="badge badge-due${t.due_date < todayStr ? ' overdue' : ''}">${fmtDate(t.due_date)}</span>` : '';
      return `<div class="quick-item">
        <span class="badge ${priClass(t.priority)}">${t.priority}</span>
        <span style="flex:1">${t.title}</span>${due}</div>`;
    }).join('');
  };
  renderList(d.recent_todos, 'dash-todos-list');
  renderList(d.upcoming, 'dash-upcoming-list');
}

// ─────────────────────────────────────────────
// HABITS
// ─────────────────────────────────────────────
const COLORS = ['#00d4ff','#ff2d87','#8b5cf6','#00ffb3','#ffd60a','#ff6b35','#06d6a0'];

async function loadHabits() {
  const habits = await api('/api/habits');
  const wrap = $('habit-list-wrap');
  if (!habits.length) {
    wrap.innerHTML = '<div class="empty"><div class="e-icon">🔥</div><p>Chưa có thói quen nào. Hãy thêm thói quen đầu tiên!</p></div>';
    return;
  }
  wrap.innerHTML = `<div class="habit-list">${habits.map(h => habitHTML(h)).join('')}</div>`;
}

function habitHTML(h) {
  const dotGrid = h.history.map(d =>
    `<div class="habit-dot${d.done?' done':''}" title="${d.date}" style="${d.done?`--accent:${h.color};box-shadow:0 0 4px ${h.color}`:''}" ></div>`
  ).join('');
  return `<div class="habit-item" id="habit-${h.id}" style="--accent:${h.color}">
    <div class="habit-check${h.completed_today?' done':''}" onclick="toggleHabit(${h.id})">${h.completed_today?'✓':''}</div>
    <div class="habit-info">
      <div class="habit-name">${h.icon} ${h.name}</div>
      ${h.description?`<div class="habit-desc">${h.description}</div>`:''}
      <div class="habit-grid">${dotGrid}</div>
    </div>
    <div class="habit-streak">🔥 ${h.streak}</div>
    <div class="habit-actions">
      <button class="icon-btn" onclick="confirmDel('Xóa thói quen này?',()=>deleteHabit(${h.id}))">🗑</button>
    </div>
  </div>`;
}

async function toggleHabit(id) {
  await api(`/api/habits/${id}/toggle`, 'POST');
  loadHabits();
}
async function deleteHabit(id) {
  await api(`/api/habits/${id}`, 'DELETE');
  loadHabits();
}

// ─────────────────────────────────────────────
// TODOS
// ─────────────────────────────────────────────
const priClass = p => p==='high'?'pri-high':p==='medium'?'pri-medium':'pri-low';

async function loadTodos() {
  let todos = await api('/api/todos');
  if (currentFilter !== 'all') todos = todos.filter(t => t.status === currentFilter);
  const wrap = $('todo-list-wrap');
  if (!todos.length) { wrap.innerHTML = '<div class="empty"><div class="e-icon">✅</div><p>Không có việc nào.</p></div>'; return; }
  wrap.innerHTML = `<div class="todo-list">${todos.map(t => todoHTML(t)).join('')}</div>`;
}

function todoHTML(t) {
  const checked = t.status === 'done';
  const todayStr = today();
  const overdue = t.due_date && t.due_date < todayStr && !checked;
  const dueLabel = t.due_date ? `<span class="badge badge-due${overdue?' overdue':''}">${fmtDate(t.due_date)}</span>` : '';
  const statusBadge = t.status === 'in_progress' ? `<span class="badge" style="background:rgba(0,212,255,.1);color:var(--cyan);border:1px solid rgba(0,212,255,.3)">In Progress</span>` : '';
  return `<div class="todo-item${checked?' done-item':''}">
    <div class="todo-check${checked?' checked':''}" onclick="cycleStatus(${t.id},'${t.status}')">${checked?'✓':t.status==='in_progress'?'…':''}</div>
    <div class="todo-body">
      <div class="todo-title${checked?' striked':''}">${t.title}</div>
      ${t.description?`<div style="color:var(--muted2);font-size:12px;margin-top:3px">${t.description}</div>`:''}
      <div class="todo-meta">
        <span class="badge ${priClass(t.priority)}">${t.priority}</span>
        ${t.category?`<span class="badge badge-cat">${t.category}</span>`:''}
        ${statusBadge}${dueLabel}
      </div>
    </div>
    <div class="todo-actions">
      <button class="icon-btn" style="font-size:11px" onclick="confirmDel('Xóa việc này?',()=>deleteTodo(${t.id}))">🗑</button>
    </div>
  </div>`;
}

async function cycleStatus(id, current) {
  const next = current === 'pending' ? 'in_progress' : current === 'in_progress' ? 'done' : 'pending';
  await api(`/api/todos/${id}`, 'PUT', {status: next});
  loadTodos();
  loadDashboard();
}
async function deleteTodo(id) {
  await api(`/api/todos/${id}`, 'DELETE');
  loadTodos();
  loadDashboard();
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    loadTodos();
  });
});

// ─────────────────────────────────────────────
// PROJECTS
// ─────────────────────────────────────────────
const gradients = [['#00d4ff','#8b5cf6'],['#ff2d87','#ff6b35'],['#00ffb3','#00d4ff'],['#ffd60a','#ff6b35'],['#8b5cf6','#ff2d87']];
let gradIdx = 0;

async function loadProjects() {
  const projects = await api('/api/projects');
  const wrap = $('project-list-wrap');
  if (!projects.length) { wrap.innerHTML = '<div class="empty"><div class="e-icon">🚀</div><p>Chưa có dự án nào.</p></div>'; return; }
  wrap.innerHTML = projects.map(p => projectHTML(p)).join('');
}

function statusLabel(s) {
  return s==='active'?`<span class="project-status status-active">Đang chạy</span>`:
         s==='completed'?`<span class="project-status status-completed">Hoàn thành</span>`:
         `<span class="project-status status-paused">Tạm dừng</span>`;
}

function projectHTML(p) {
  const g = gradients[p.id % gradients.length];
  const tasks = p.tasks.map(t => `
    <div class="task-item">
      <div class="task-check${t.completed?' done':''}" onclick="toggleTask(${p.id},${t.id})">${t.completed?'✓':''}</div>
      <span class="task-title${t.completed?' done-text':''}">${t.title}</span>
      <button class="icon-btn" style="width:22px;height:22px;font-size:11px" onclick="deleteTask(${p.id},${t.id})">✕</button>
    </div>`).join('');
  const doneCount = p.tasks.filter(t=>t.completed).length;
  return `<div class="project-card">
    <div class="project-header">
      <div class="project-dot" style="background:${p.color};box-shadow:0 0 8px ${p.color}"></div>
      <div class="project-name">${p.name}</div>
      ${statusLabel(p.status)}
      <div style="display:flex;gap:4px">
        <button class="icon-btn" onclick="confirmDel('Xóa dự án?',()=>deleteProject(${p.id}))">🗑</button>
      </div>
    </div>
    ${p.description?`<div style="color:var(--muted2);font-size:13px;margin-bottom:10px">${p.description}</div>`:''}
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted2);margin-bottom:4px">
      <span>${doneCount}/${p.tasks.length} nhiệm vụ</span><span>${p.progress}%</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${p.progress}%;--accent:${g[0]};--accent-end:${g[1]}"></div></div>
    <button class="expand-btn" onclick="toggleTaskPanel(${p.id})">▾ Nhiệm vụ (${p.tasks.length})</button>
    <div class="project-tasks" id="tasks-${p.id}">
      ${tasks}
      <div class="add-task-row">
        <input id="new-task-${p.id}" class="form-row input" style="flex:1;background:var(--card2);border:1px solid var(--border);border-radius:7px;padding:7px 10px;color:var(--text);font-family:'Exo 2',sans-serif;font-size:13px;outline:none" placeholder="Thêm nhiệm vụ...">
        <button class="btn btn-primary btn-sm" onclick="addTask(${p.id})">Thêm</button>
      </div>
    </div>
  </div>`;
}

function toggleTaskPanel(pid) {
  const el = $(`tasks-${pid}`);
  el.classList.toggle('open');
}
async function toggleTask(pid, tid) {
  await api(`/api/projects/${pid}/tasks/${tid}`, 'PUT');
  loadProjects();
}
async function deleteTask(pid, tid) {
  await api(`/api/projects/${pid}/tasks/${tid}`, 'DELETE');
  loadProjects();
}
async function addTask(pid) {
  const inp = $(`new-task-${pid}`);
  if (!inp.value.trim()) return;
  await api(`/api/projects/${pid}/tasks`, 'POST', {title: inp.value.trim()});
  loadProjects();
}
async function deleteProject(id) {
  await api(`/api/projects/${id}`, 'DELETE');
  loadProjects();
  loadDashboard();
}

// ─────────────────────────────────────────────
// FINANCE
// ─────────────────────────────────────────────
const ACC_TYPES = {checking:'Tài khoản thanh toán', savings:'Tiết kiệm', investment:'Đầu tư'};
const TXN_CATS_EXP = ['ăn uống','đi lại','nhà cửa','mua sắm','giải trí','sức khỏe','giáo dục','tiết kiệm','đầu tư','khác'];
const TXN_CATS_INC = ['lương','thưởng','đầu tư','kinh doanh','khác'];

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
          <div class="account-type">${ACC_TYPES[a.type]||a.type}</div>
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
  wrap.innerHTML = `<div class="txn-list">${txns.slice(0,50).map(t => `
    <div class="txn-item txn-${t.type}">
      <div class="txn-icon">${t.type==='income'?'📥':'📤'}</div>
      <div class="txn-info">
        <div class="txn-desc">${t.description||t.category}</div>
        <div class="txn-meta">${t.category} · ${fmtDate(t.date)}${t.account_name?` · ${t.account_name}`:''}</div>
      </div>
      <div class="txn-amount">${t.type==='income'?'+':'-'}${fmt(t.amount)}</div>
      <span class="txn-del" onclick="confirmDel('Xóa giao dịch?',()=>deleteTxn(${t.id}))">✕</span>
    </div>`).join('')}</div>`;
}

function renderFinanceCharts(summary) {
  const labels = summary.monthly.map(m => m.label);
  const incomes = summary.monthly.map(m => m.income);
  const expenses = summary.monthly.map(m => m.expense);

  if (chartFinance) chartFinance.destroy();
  chartFinance = new Chart($('chart-finance'), {
    type:'bar',
    data: {
      labels,
      datasets:[
        {label:'Thu nhập', data:incomes, backgroundColor:'rgba(0,255,179,.6)', borderRadius:6},
        {label:'Chi tiêu', data:expenses, backgroundColor:'rgba(255,45,135,.6)', borderRadius:6}
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{labels:{color:'#718096',font:{family:'Exo 2',size:11}}}},
      scales:{
        x:{grid:{color:'rgba(255,255,255,.04)'},ticks:{color:'#718096',font:{family:'Exo 2',size:10}}},
        y:{grid:{color:'rgba(255,255,255,.04)'},ticks:{color:'#718096',font:{family:'Exo 2',size:10},callback:v=>fmt(v)}}
      }
    }
  });

  if (chartCats) chartCats.destroy();
  const cats = summary.expense_by_cat;
  if (cats.length) {
    chartCats = new Chart($('chart-cats'), {
      type:'doughnut',
      data:{
        labels: cats.map(c=>c.category),
        datasets:[{data:cats.map(c=>c.total), backgroundColor:COLORS.slice(0,cats.length), borderWidth:0, hoverOffset:8}]
      },
      options:{
        responsive:true, maintainAspectRatio:false, cutout:'65%',
        plugins:{legend:{position:'right',labels:{color:'#718096',font:{family:'Exo 2',size:11},padding:10}}}
      }
    });
  }
}

async function deleteAccount(id) { await api(`/api/accounts/${id}`, 'DELETE'); loadFinance(); }
async function deleteTxn(id) { await api(`/api/transactions/${id}`, 'DELETE'); loadFinance(); loadDashboard(); }

// ─────────────────────────────────────────────
// MODALS
// ─────────────────────────────────────────────
let selectedColor = '#00d4ff';

function colorChips(current='#00d4ff') {
  return COLORS.map(c => `<div class="color-chip${c===current?' sel':''}" style="background:${c}" onclick="selectColor('${c}')"></div>`).join('');
}
function selectColor(c) {
  selectedColor = c;
  document.querySelectorAll('.color-chip').forEach(el => el.classList.toggle('sel', el.style.background === c || el.style.backgroundColor === c));
}

const MODALS = {
  habit: () => `
    <h2>🔥 Thêm thói quen</h2>
    <div class="form-row"><label>Tên thói quen *</label><input id="m-name" placeholder="VD: Đọc sách 30 phút"></div>
    <div class="form-row"><label>Mô tả</label><input id="m-desc" placeholder="Mô tả ngắn"></div>
    <div class="form-2col">
      <div class="form-row"><label>Icon</label><input id="m-icon" value="⭐" placeholder="emoji"></div>
      <div class="form-row"><label>Màu sắc</label><div class="color-chips">${colorChips()}</div></div>
    </div>
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
      <div class="form-row"><label>Danh mục</label><input id="m-cat" value="general" placeholder="VD: công việc, cá nhân"></div>
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
        <select id="m-atype">
          <option value="checking">Thanh toán</option>
          <option value="savings">Tiết kiệm</option>
          <option value="investment">Đầu tư</option>
        </select>
      </div>
      <div class="form-row"><label>Số dư hiện tại</label><input type="number" id="m-abal" value="0" placeholder="0"></div>
    </div>
    <div class="form-2col">
      <div class="form-row"><label>Tiền tệ</label>
        <select id="m-acur"><option value="VND" selected>VND</option><option value="USD">USD</option></select>
      </div>
      <div class="form-row"><label>Màu sắc</label><div class="color-chips">${colorChips()}</div></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="submitAccount()">Thêm</button>
    </div>`,

  txn: async () => {
    const accounts = await api('/api/accounts');
    const accOpts = accounts.length
      ? accounts.map(a=>`<option value="${a.id}">${a.name} (${fmt(a.balance)} ${a.currency})</option>`).join('')
      : '<option value="">-- Không có tài khoản --</option>';
    return `
    <h2>💸 Thêm giao dịch</h2>
    <div class="form-2col">
      <div class="form-row"><label>Loại</label>
        <select id="m-ttype" onchange="updateCatList()">
          <option value="expense">Chi tiêu</option>
          <option value="income">Thu nhập</option>
        </select>
      </div>
      <div class="form-row"><label>Số tiền *</label><input type="number" id="m-tamount" placeholder="0"></div>
    </div>
    <div class="form-2col">
      <div class="form-row"><label>Danh mục</label>
        <select id="m-tcat">${TXN_CATS_EXP.map(c=>`<option>${c}</option>`).join('')}</select>
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
  const type = $('m-ttype').value;
  const cats = type === 'income' ? TXN_CATS_INC : TXN_CATS_EXP;
  $('m-tcat').innerHTML = cats.map(c=>`<option>${c}</option>`).join('');
}

async function openModal(type) {
  selectedColor = '#00d4ff';
  const modal = $('modal-content');
  const content = typeof MODALS[type] === 'function' ? await MODALS[type]() : MODALS[type];
  modal.innerHTML = content;
  $('overlay').classList.add('show');
}
function closeModal() { $('overlay').classList.remove('show'); }

async function submitHabit() {
  const name = $('m-name').value.trim();
  if (!name) return alert('Vui lòng nhập tên thói quen');
  await api('/api/habits', 'POST', {
    name, description: $('m-desc').value, color: selectedColor, icon: $('m-icon').value || '⭐'
  });
  closeModal(); loadHabits();
}

async function submitTodo() {
  const title = $('m-title').value.trim();
  if (!title) return alert('Vui lòng nhập tiêu đề');
  await api('/api/todos', 'POST', {
    title, description: $('m-tdesc').value,
    priority: $('m-priority').value,
    category: $('m-cat').value || 'general',
    due_date: $('m-due').value || null
  });
  closeModal(); loadTodos(); loadDashboard();
}

async function submitProject() {
  const name = $('m-pname').value.trim();
  if (!name) return alert('Vui lòng nhập tên dự án');
  await api('/api/projects', 'POST', {
    name, description: $('m-pdesc').value, color: selectedColor,
    start_date: $('m-pstart').value || null,
    end_date: $('m-pend').value || null
  });
  closeModal(); loadProjects(); loadDashboard();
}

async function submitAccount() {
  const name = $('m-aname').value.trim();
  if (!name) return alert('Vui lòng nhập tên tài khoản');
  await api('/api/accounts', 'POST', {
    name, type: $('m-atype').value,
    balance: parseFloat($('m-abal').value) || 0,
    currency: $('m-acur').value, color: selectedColor
  });
  closeModal(); loadFinance();
}

async function submitTxn() {
  const amount = parseFloat($('m-tamount').value);
  if (!amount || amount <= 0) return alert('Vui lòng nhập số tiền hợp lệ');
  const accId = $('m-tacc').value;
  await api('/api/transactions', 'POST', {
    amount, type: $('m-ttype').value,
    category: $('m-tcat').value,
    description: $('m-tdesc2').value,
    account_id: accId ? parseInt(accId) : null,
    date: $('m-tdate').value
  });
  closeModal(); loadFinance(); loadDashboard();
}

// Close modal on overlay click
$('overlay').addEventListener('click', e => { if (e.target === $('overlay')) closeModal(); });
// Close on Escape
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
loadDashboard();
