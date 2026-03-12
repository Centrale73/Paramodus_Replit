import os
import sqlite3
from typing import List, Dict, Optional

app_data = os.path.join(os.path.expanduser("~"), ".myapp")
os.makedirs(app_data, exist_ok=True)

DB_PATH = os.path.join(app_data, "chat_history.db")


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS messages
               (id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                role TEXT,
                content TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)"""
        )
        try:
            conn.execute("ALTER TABLE messages ADD COLUMN session_id TEXT")
        except sqlite3.OperationalError:
            pass

        conn.execute(
            """CREATE TABLE IF NOT EXISTS groups
               (id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                system_prompt TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"""
        )

        conn.execute(
            """CREATE TABLE IF NOT EXISTS scheduled_tasks
               (id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                prompt TEXT NOT NULL,
                interval_seconds INTEGER NOT NULL DEFAULT 3600,
                enabled INTEGER NOT NULL DEFAULT 1,
                last_run DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"""
        )

        conn.execute(
            """INSERT OR IGNORE INTO groups (name, system_prompt)
               VALUES ('Default', 'You are a professional workspace assistant.')"""
        )


def save_msg(role: str, content: str, session_id: Optional[str] = None):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
            (session_id, role, content),
        )


def get_history(session_id: Optional[str] = None) -> List[Dict]:
    with sqlite3.connect(DB_PATH) as conn:
        if session_id:
            rows = conn.execute(
                "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC",
                (session_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT role, content FROM messages ORDER BY id ASC"
            ).fetchall()
    return [{"role": r[0], "content": r[1]} for r in rows]


def clear_session(session_id: str):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))


def get_all_sessions() -> List[Dict]:
    with sqlite3.connect(DB_PATH) as conn:
        try:
            query = '''
                SELECT
                    m.session_id,
                    MAX(m.timestamp) as last_active,
                    (SELECT content FROM messages m2 WHERE m2.session_id = m.session_id AND m2.role = 'user' ORDER BY m2.id ASC LIMIT 1) as title
                FROM messages m
                WHERE m.session_id IS NOT NULL
                GROUP BY m.session_id
                ORDER BY last_active DESC
            '''
            rows = conn.execute(query).fetchall()
            sessions = []
            for r in rows:
                sid, last_active, title = r
                if not title:
                    title = "New Chat"
                elif len(title) > 30:
                    title = title[:27] + "..."
                sessions.append({"id": sid, "title": title, "timestamp": last_active})
            return sessions
        except Exception as e:
            print(f"Error getting sessions: {e}")
            return []


# ── Groups ────────────────────────────────────────────────────────────────────

def get_groups() -> List[Dict]:
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, name, system_prompt FROM groups ORDER BY id ASC"
        ).fetchall()
    return [{"id": r[0], "name": r[1], "system_prompt": r[2]} for r in rows]


def create_group(name: str, system_prompt: str = "") -> Dict:
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            "INSERT INTO groups (name, system_prompt) VALUES (?, ?)",
            (name, system_prompt)
        )
        return {"id": cur.lastrowid, "name": name, "system_prompt": system_prompt}


def update_group(group_id: int, name: str, system_prompt: str) -> bool:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "UPDATE groups SET name = ?, system_prompt = ? WHERE id = ?",
            (name, system_prompt, group_id)
        )
    return True


def delete_group(group_id: int) -> bool:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM groups WHERE id = ? AND name != 'Default'", (group_id,))
    return True


def get_group(group_id: int) -> Optional[Dict]:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT id, name, system_prompt FROM groups WHERE id = ?", (group_id,)
        ).fetchone()
    if row:
        return {"id": row[0], "name": row[1], "system_prompt": row[2]}
    return None


# ── Scheduled Tasks ───────────────────────────────────────────────────────────

def get_tasks() -> List[Dict]:
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, name, prompt, interval_seconds, enabled, last_run FROM scheduled_tasks ORDER BY id ASC"
        ).fetchall()
    return [
        {"id": r[0], "name": r[1], "prompt": r[2],
         "interval_seconds": r[3], "enabled": bool(r[4]), "last_run": r[5]}
        for r in rows
    ]


def create_task(name: str, prompt: str, interval_seconds: int) -> Dict:
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            "INSERT INTO scheduled_tasks (name, prompt, interval_seconds) VALUES (?, ?, ?)",
            (name, prompt, interval_seconds)
        )
        return {"id": cur.lastrowid, "name": name, "prompt": prompt,
                "interval_seconds": interval_seconds, "enabled": True}


def update_task_last_run(task_id: int):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "UPDATE scheduled_tasks SET last_run = CURRENT_TIMESTAMP WHERE id = ?",
            (task_id,)
        )


def delete_task(task_id: int):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM scheduled_tasks WHERE id = ?", (task_id,))


def toggle_task(task_id: int, enabled: bool):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "UPDATE scheduled_tasks SET enabled = ? WHERE id = ?",
            (1 if enabled else 0, task_id)
        )
