"""
Personal Dashboard - Backend
Run: python main.py
Then open: http://localhost:8000
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import sqlite3
from datetime import date, timedelta
import uvicorn
import os

app = FastAPI(title="Personal Dashboard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = "dashboard.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        color TEXT DEFAULT '#00d4ff',
        icon TEXT DEFAULT '⭐',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS habit_completions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        habit_id INTEGER,
        completed_date TEXT,
        UNIQUE(habit_id, completed_date),
        FOREIGN KEY (habit_id) REFERENCES habits(id)
    );
    CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        priority TEXT DEFAULT 'medium',
        category TEXT DEFAULT 'general',
        status TEXT DEFAULT 'pending',
        due_date TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        color TEXT DEFAULT '#00d4ff',
        status TEXT DEFAULT 'active',
        start_date TEXT,
        end_date TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS project_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        title TEXT NOT NULL,
        completed INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'checking',
        balance REAL DEFAULT 0,
        currency TEXT DEFAULT 'VND',
        color TEXT DEFAULT '#00d4ff',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER,
        amount REAL NOT NULL,
        type TEXT NOT NULL,
        category TEXT DEFAULT 'other',
        description TEXT DEFAULT '',
        date TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id)
    );
    """)
    conn.commit()
    conn.close()

init_db()

# ─────────────────────────────────────────────
# SERVE FRONTEND
# ─────────────────────────────────────────────
@app.get("/")
def root():
    return FileResponse("index.html")

# ─────────────────────────────────────────────
# DASHBOARD SUMMARY
# ─────────────────────────────────────────────
@app.get("/api/dashboard")
def dashboard():
    conn = get_db()
    c = conn.cursor()
    today = date.today().isoformat()
    current_month = date.today().strftime("%Y-%m")

    total_habits   = c.execute("SELECT COUNT(*) FROM habits").fetchone()[0]
    done_habits    = c.execute("SELECT COUNT(*) FROM habit_completions WHERE completed_date=?", (today,)).fetchone()[0]
    pending_todos  = c.execute("SELECT COUNT(*) FROM todos WHERE status!='done'").fetchone()[0]
    done_todos     = c.execute("SELECT COUNT(*) FROM todos WHERE status='done'").fetchone()[0]
    active_proj    = c.execute("SELECT COUNT(*) FROM projects WHERE status='active'").fetchone()[0]
    month_income   = c.execute("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='income' AND date LIKE ?", (f"{current_month}%",)).fetchone()[0]
    month_expense  = c.execute("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='expense' AND date LIKE ?", (f"{current_month}%",)).fetchone()[0]
    total_balance  = c.execute("SELECT COALESCE(SUM(balance),0) FROM accounts").fetchone()[0]

    # Recent todos
    recent_todos = c.execute("SELECT * FROM todos WHERE status!='done' ORDER BY created_at DESC LIMIT 5").fetchall()
    # Upcoming due todos
    upcoming = c.execute("SELECT * FROM todos WHERE due_date IS NOT NULL AND due_date >= ? AND status!='done' ORDER BY due_date ASC LIMIT 5", (today,)).fetchall()

    conn.close()
    return {
        "habits":       {"total": total_habits, "completed": done_habits},
        "todos":        {"pending": pending_todos, "done": done_todos},
        "projects":     {"active": active_proj},
        "finance":      {"income": month_income, "expense": month_expense, "balance": total_balance},
        "recent_todos": [dict(t) for t in recent_todos],
        "upcoming":     [dict(t) for t in upcoming],
    }

# ─────────────────────────────────────────────
# HABITS
# ─────────────────────────────────────────────
class HabitCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    color: Optional[str] = "#00d4ff"
    icon: Optional[str] = "⭐"

@app.get("/api/habits")
def get_habits():
    conn = get_db()
    c = conn.cursor()
    today = date.today().isoformat()
    habits = c.execute("SELECT * FROM habits ORDER BY created_at DESC").fetchall()
    result = []
    for h in habits:
        d = dict(h)
        d["completed_today"] = bool(c.execute(
            "SELECT 1 FROM habit_completions WHERE habit_id=? AND completed_date=?", (h["id"], today)
        ).fetchone())
        # Calculate streak
        streak = 0
        check = date.today()
        while True:
            done = c.execute("SELECT 1 FROM habit_completions WHERE habit_id=? AND completed_date=?",
                             (h["id"], check.isoformat())).fetchone()
            if done:
                streak += 1
                check -= timedelta(days=1)
            else:
                break
        d["streak"] = streak
        # 30-day history
        history = []
        for i in range(29, -1, -1):
            day = (date.today() - timedelta(days=i)).isoformat()
            done = bool(c.execute("SELECT 1 FROM habit_completions WHERE habit_id=? AND completed_date=?",
                                  (h["id"], day)).fetchone())
            history.append({"date": day, "done": done})
        d["history"] = history
        result.append(d)
    conn.close()
    return result

@app.post("/api/habits")
def create_habit(h: HabitCreate):
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO habits (name, description, color, icon) VALUES (?,?,?,?)",
              (h.name, h.description, h.color, h.icon))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return {"id": new_id, **h.dict(), "completed_today": False, "streak": 0, "history": []}

@app.delete("/api/habits/{hid}")
def delete_habit(hid: int):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM habit_completions WHERE habit_id=?", (hid,))
    c.execute("DELETE FROM habits WHERE id=?", (hid,))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.post("/api/habits/{hid}/toggle")
def toggle_habit(hid: int):
    conn = get_db()
    c = conn.cursor()
    today = date.today().isoformat()
    existing = c.execute("SELECT id FROM habit_completions WHERE habit_id=? AND completed_date=?", (hid, today)).fetchone()
    if existing:
        c.execute("DELETE FROM habit_completions WHERE habit_id=? AND completed_date=?", (hid, today))
        completed = False
    else:
        c.execute("INSERT INTO habit_completions (habit_id, completed_date) VALUES (?,?)", (hid, today))
        completed = True
    conn.commit()
    conn.close()
    return {"completed": completed}

# ─────────────────────────────────────────────
# TODOS
# ─────────────────────────────────────────────
class TodoCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    priority: Optional[str] = "medium"
    category: Optional[str] = "general"
    due_date: Optional[str] = None

class TodoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    category: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[str] = None

@app.get("/api/todos")
def get_todos():
    conn = get_db()
    todos = conn.execute("SELECT * FROM todos ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(t) for t in todos]

@app.post("/api/todos")
def create_todo(t: TodoCreate):
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO todos (title, description, priority, category, due_date) VALUES (?,?,?,?,?)",
              (t.title, t.description, t.priority, t.category, t.due_date))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return {"id": new_id, **t.dict(), "status": "pending"}

@app.put("/api/todos/{tid}")
def update_todo(tid: int, t: TodoUpdate):
    conn = get_db()
    c = conn.cursor()
    fields = {k: v for k, v in t.dict().items() if v is not None}
    if fields:
        set_clause = ", ".join(f"{k}=?" for k in fields)
        c.execute(f"UPDATE todos SET {set_clause} WHERE id=?", (*fields.values(), tid))
        conn.commit()
    conn.close()
    return {"ok": True}

@app.delete("/api/todos/{tid}")
def delete_todo(tid: int):
    conn = get_db()
    conn.execute("DELETE FROM todos WHERE id=?", (tid,))
    conn.commit()
    conn.close()
    return {"ok": True}

# ─────────────────────────────────────────────
# PROJECTS
# ─────────────────────────────────────────────
class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    color: Optional[str] = "#00d4ff"
    status: Optional[str] = "active"
    start_date: Optional[str] = None
    end_date: Optional[str] = None

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    color: Optional[str] = None

class TaskCreate(BaseModel):
    title: str

@app.get("/api/projects")
def get_projects():
    conn = get_db()
    c = conn.cursor()
    projects = c.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
    result = []
    for p in projects:
        pd = dict(p)
        tasks = c.execute("SELECT * FROM project_tasks WHERE project_id=? ORDER BY id", (p["id"],)).fetchall()
        task_list = [dict(t) for t in tasks]
        total = len(task_list)
        done  = sum(1 for t in task_list if t["completed"])
        pd["tasks"]    = task_list
        pd["progress"] = round((done / total * 100) if total else 0)
        result.append(pd)
    conn.close()
    return result

@app.post("/api/projects")
def create_project(p: ProjectCreate):
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO projects (name, description, color, status, start_date, end_date) VALUES (?,?,?,?,?,?)",
              (p.name, p.description, p.color, p.status, p.start_date, p.end_date))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return {"id": new_id, **p.dict(), "tasks": [], "progress": 0}

@app.put("/api/projects/{pid}")
def update_project(pid: int, p: ProjectUpdate):
    conn = get_db()
    c = conn.cursor()
    fields = {k: v for k, v in p.dict().items() if v is not None}
    if fields:
        set_clause = ", ".join(f"{k}=?" for k in fields)
        c.execute(f"UPDATE projects SET {set_clause} WHERE id=?", (*fields.values(), pid))
        conn.commit()
    conn.close()
    return {"ok": True}

@app.delete("/api/projects/{pid}")
def delete_project(pid: int):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM project_tasks WHERE project_id=?", (pid,))
    c.execute("DELETE FROM projects WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.post("/api/projects/{pid}/tasks")
def add_task(pid: int, t: TaskCreate):
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO project_tasks (project_id, title) VALUES (?,?)", (pid, t.title))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return {"id": new_id, "project_id": pid, "title": t.title, "completed": 0}

@app.put("/api/projects/{pid}/tasks/{tid}")
def toggle_task(pid: int, tid: int):
    conn = get_db()
    c = conn.cursor()
    task = c.execute("SELECT completed FROM project_tasks WHERE id=?", (tid,)).fetchone()
    if not task:
        raise HTTPException(404, "Not found")
    new_val = 0 if task["completed"] else 1
    c.execute("UPDATE project_tasks SET completed=? WHERE id=?", (new_val, tid))
    conn.commit()
    conn.close()
    return {"completed": bool(new_val)}

@app.delete("/api/projects/{pid}/tasks/{tid}")
def delete_task(pid: int, tid: int):
    conn = get_db()
    conn.execute("DELETE FROM project_tasks WHERE id=?", (tid,))
    conn.commit()
    conn.close()
    return {"ok": True}

# ─────────────────────────────────────────────
# FINANCE
# ─────────────────────────────────────────────
class AccountCreate(BaseModel):
    name: str
    type: Optional[str] = "checking"
    balance: Optional[float] = 0
    currency: Optional[str] = "VND"
    color: Optional[str] = "#00d4ff"

class TxnCreate(BaseModel):
    account_id: Optional[int] = None
    amount: float
    type: str   # income | expense
    category: Optional[str] = "other"
    description: Optional[str] = ""
    date: Optional[str] = None

@app.get("/api/accounts")
def get_accounts():
    conn = get_db()
    accounts = conn.execute("SELECT * FROM accounts ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(a) for a in accounts]

@app.post("/api/accounts")
def create_account(a: AccountCreate):
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO accounts (name, type, balance, currency, color) VALUES (?,?,?,?,?)",
              (a.name, a.type, a.balance, a.currency, a.color))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return {"id": new_id, **a.dict()}

@app.delete("/api/accounts/{aid}")
def delete_account(aid: int):
    conn = get_db()
    conn.execute("DELETE FROM accounts WHERE id=?", (aid,))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.get("/api/transactions")
def get_transactions(limit: int = 100):
    conn = get_db()
    txns = conn.execute("""
        SELECT t.*, a.name as account_name
        FROM transactions t
        LEFT JOIN accounts a ON t.account_id = a.id
        ORDER BY t.date DESC, t.created_at DESC LIMIT ?
    """, (limit,)).fetchall()
    conn.close()
    return [dict(t) for t in txns]

@app.post("/api/transactions")
def create_transaction(t: TxnCreate):
    conn = get_db()
    c = conn.cursor()
    txn_date = t.date or date.today().isoformat()
    c.execute("INSERT INTO transactions (account_id, amount, type, category, description, date) VALUES (?,?,?,?,?,?)",
              (t.account_id, t.amount, t.type, t.category, t.description, txn_date))
    if t.account_id:
        delta = t.amount if t.type == "income" else -t.amount
        c.execute("UPDATE accounts SET balance = balance + ? WHERE id=?", (delta, t.account_id))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return {"id": new_id, **t.dict()}

@app.delete("/api/transactions/{tid}")
def delete_transaction(tid: int):
    conn = get_db()
    c = conn.cursor()
    txn = c.execute("SELECT * FROM transactions WHERE id=?", (tid,)).fetchone()
    if txn and txn["account_id"]:
        delta = -txn["amount"] if txn["type"] == "income" else txn["amount"]
        c.execute("UPDATE accounts SET balance = balance + ? WHERE id=?", (delta, txn["account_id"]))
    c.execute("DELETE FROM transactions WHERE id=?", (tid,))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.get("/api/finance/summary")
def finance_summary():
    conn = get_db()
    c = conn.cursor()
    today = date.today()

    # Last 6 months
    monthly = []
    for i in range(5, -1, -1):
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        ms = f"{y}-{m:02d}"
        inc = c.execute("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='income' AND date LIKE ?", (f"{ms}%",)).fetchone()[0]
        exp = c.execute("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='expense' AND date LIKE ?", (f"{ms}%",)).fetchone()[0]
        import calendar
        _, last_day = calendar.monthrange(y, m)
        monthly.append({"month": ms, "label": f"T{m}/{y}", "income": inc, "expense": exp})

    # Category breakdown this month
    cm = today.strftime("%Y-%m")
    cats_exp = c.execute("""SELECT category, COALESCE(SUM(amount),0) as total FROM transactions
                            WHERE type='expense' AND date LIKE ? GROUP BY category ORDER BY total DESC""",
                         (f"{cm}%",)).fetchall()
    cats_inc = c.execute("""SELECT category, COALESCE(SUM(amount),0) as total FROM transactions
                            WHERE type='income' AND date LIKE ? GROUP BY category ORDER BY total DESC""",
                         (f"{cm}%",)).fetchall()

    conn.close()
    return {
        "monthly": monthly,
        "expense_by_cat": [dict(r) for r in cats_exp],
        "income_by_cat":  [dict(r) for r in cats_inc],
    }

# ─────────────────────────────────────────────
if __name__ == "__main__":
    print("\n🚀 Personal Dashboard đang chạy!")
    print("📌 Mở trình duyệt tại: http://localhost:8000\n")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
