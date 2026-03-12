import os
import json
import uuid
import threading
import queue
import time

import schedule
from flask import Flask, send_from_directory, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

from database import (
    init_db, save_msg, get_history, clear_session, get_all_sessions,
    get_groups, create_group, update_group, delete_group, get_group,
    get_tasks, create_task, update_task_last_run, delete_task, toggle_task,
)
from agents.workspace_agent import get_agent, get_team, ingest_files, clear_knowledge_base

app = Flask(__name__, static_folder='ui', static_url_path='')
CORS(app)

init_db()

# ── Shared state ──────────────────────────────────────────────────────────────
state = {
    "keys": {
        "openai": os.environ.get("OPENAI_API_KEY"),
        "anthropic": os.environ.get("ANTHROPIC_API_KEY"),
        "gemini": os.environ.get("GEMINI_API_KEY"),
        "groq": os.environ.get("GROQ_API_KEY"),
        "grok": os.environ.get("XAI_API_KEY"),
        "openrouter": os.environ.get("OPENROUTER_API_KEY"),
        "perplexity": os.environ.get("PERPLEXITY_API_KEY"),
        # Local providers — no API key required
        "ollama": None,
        "local": None,
    },
    "current_provider": os.environ.get("DEFAULT_PROVIDER", "openai"),
    "current_model": os.environ.get("DEFAULT_MODEL", None),
    "multi_agent_mode": False,
    "uploaded_filenames": [],
    "current_session_id": str(uuid.uuid4()),
    "current_group_id": 1,
    # Custom base URL for ollama/local providers
    "base_url": None,
}

# Per-session SSE queues and message queues
sse_queues: dict[str, queue.Queue] = {}
msg_queues: dict[str, queue.Queue] = {}
sse_lock = threading.Lock()
msg_lock = threading.Lock()


def _get_sse_queue(session_id: str) -> queue.Queue:
    with sse_lock:
        if session_id not in sse_queues:
            sse_queues[session_id] = queue.Queue()
        return sse_queues[session_id]


def _push_event(session_id: str, event: dict):
    with sse_lock:
        q = sse_queues.get(session_id)
    if q:
        q.put(event)


def _get_msg_queue(session_id: str) -> queue.Queue:
    with msg_lock:
        if session_id not in msg_queues:
            q: queue.Queue = queue.Queue()
            msg_queues[session_id] = q
            t = threading.Thread(target=_session_worker, args=(session_id, q), daemon=True)
            t.start()
        return msg_queues[session_id]


def _session_worker(session_id: str, q: queue.Queue):
    """Sequential worker that processes one message at a time per session."""
    while True:
        try:
            item = q.get(timeout=120)
            if item is None:
                break
            user_text, target_id, provider, api_key, model_id, multi_agent, system_prompt, base_url = item
            _run_agent(session_id, user_text, target_id, provider, api_key, model_id, multi_agent, system_prompt, base_url)
            q.task_done()
        except queue.Empty:
            continue


# ── Static routes ─────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('ui', 'index.html')


@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('ui', path)


# ── SSE ───────────────────────────────────────────────────────────────────────
@app.route('/api/stream_events', methods=['GET'])
def stream_events():
    session_id = state["current_session_id"]
    with sse_lock:
        sse_queues[session_id] = queue.Queue()
    q = sse_queues[session_id]

    def generate():
        while True:
            try:
                event = q.get(timeout=30)
                if event is None:
                    break
                yield f"data: {json.dumps(event)}\n\n"
            except queue.Empty:
                yield f"data: {json.dumps({'type': 'ping'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


# ── Session management ────────────────────────────────────────────────────────
@app.route('/api/new_session', methods=['POST'])
def new_session():
    state["current_session_id"] = str(uuid.uuid4())
    return jsonify({"status": "success", "session_id": state["current_session_id"]})


@app.route('/api/list_sessions', methods=['GET'])
def list_sessions():
    return jsonify(get_all_sessions())


@app.route('/api/switch_session', methods=['POST'])
def switch_session():
    data = request.get_json()
    state["current_session_id"] = data["session_id"]
    return jsonify({"status": "success", "session_id": state["current_session_id"]})


@app.route('/api/get_current_session_id', methods=['GET'])
def get_current_session_id():
    return jsonify({"session_id": state["current_session_id"]})


@app.route('/api/load_history', methods=['GET'])
def load_history():
    return jsonify(get_history(state["current_session_id"]))


# ── Provider / model / keys ───────────────────────────────────────────────────
@app.route('/api/set_api_key', methods=['POST'])
def set_api_key():
    data = request.get_json()
    key = data.get("key", "")
    provider = data.get("provider", "openai")
    state["keys"][provider] = key
    env_var = f"{provider.upper()}_API_KEY"
    if provider == "grok":
        env_var = "XAI_API_KEY"
    os.environ[env_var] = key
    return jsonify(f"{provider.title()} key saved")


@app.route('/api/set_provider', methods=['POST'])
def set_provider():
    data = request.get_json()
    provider = data.get("provider", "openai")
    if provider in state["keys"]:
        state["current_provider"] = provider
        return jsonify(f"Provider switched to {provider}")
    return jsonify("Invalid provider"), 400


@app.route('/api/set_model', methods=['POST'])
def set_model():
    data = request.get_json()
    model_id = data.get("model_id", None)
    state["current_model"] = model_id if model_id else None
    return jsonify(f"Model set to {model_id if model_id else 'default'}")


@app.route('/api/set_base_url', methods=['POST'])
def set_base_url():
    data = request.get_json()
    url = data.get("url", "").strip() or None
    state["base_url"] = url
    return jsonify(f"Base URL set to {url or 'default'}")


@app.route('/api/toggle_multi_agent', methods=['POST'])
def toggle_multi_agent():
    data = request.get_json()
    enabled = data.get("enabled", False)
    state["multi_agent_mode"] = enabled
    return jsonify(f"Multi-Agent mode: {'Enabled' if enabled else 'Disabled'}")


# ── Groups ────────────────────────────────────────────────────────────────────
@app.route('/api/groups', methods=['GET'])
def api_get_groups():
    return jsonify(get_groups())


@app.route('/api/groups', methods=['POST'])
def api_create_group():
    data = request.get_json()
    g = create_group(data.get("name", "New Group"), data.get("system_prompt", ""))
    return jsonify(g)


@app.route('/api/groups/<int:group_id>', methods=['PUT'])
def api_update_group(group_id: int):
    data = request.get_json()
    update_group(group_id, data["name"], data["system_prompt"])
    return jsonify({"status": "ok"})


@app.route('/api/groups/<int:group_id>', methods=['DELETE'])
def api_delete_group(group_id: int):
    delete_group(group_id)
    return jsonify({"status": "ok"})


@app.route('/api/groups/select', methods=['POST'])
def api_select_group():
    data = request.get_json()
    state["current_group_id"] = data.get("group_id", 1)
    return jsonify({"status": "ok", "group_id": state["current_group_id"]})


@app.route('/api/groups/current', methods=['GET'])
def api_current_group():
    g = get_group(state["current_group_id"])
    return jsonify(g or {"id": 1, "name": "Default", "system_prompt": ""})


# ── Scheduled tasks ───────────────────────────────────────────────────────────
@app.route('/api/tasks', methods=['GET'])
def api_get_tasks():
    return jsonify(get_tasks())


@app.route('/api/tasks', methods=['POST'])
def api_create_task():
    data = request.get_json()
    t = create_task(data["name"], data["prompt"], int(data.get("interval_seconds", 3600)))
    return jsonify(t)


@app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
def api_delete_task(task_id: int):
    delete_task(task_id)
    return jsonify({"status": "ok"})


@app.route('/api/tasks/<int:task_id>/toggle', methods=['POST'])
def api_toggle_task(task_id: int):
    data = request.get_json()
    toggle_task(task_id, data.get("enabled", True))
    return jsonify({"status": "ok"})


# ── RAG / files ───────────────────────────────────────────────────────────────
@app.route('/api/clear_rag_context', methods=['POST'])
def clear_rag_context():
    clear_knowledge_base()
    state["uploaded_filenames"] = []
    return jsonify("RAG context cleared")


@app.route('/api/upload_files', methods=['POST'])
def upload_files():
    import base64
    try:
        files_data = request.get_json()
        processed_files = []
        for f in files_data:
            name = f["name"]
            content_b64 = f["content"]
            if "," in content_b64:
                content_b64 = content_b64.split(",")[1]
            data = base64.b64decode(content_b64)
            processed_files.append({"name": name, "data": data})
            state["uploaded_filenames"].append(name)
        success = ingest_files(processed_files)
        if success:
            return jsonify({"status": "success", "files": list(set(state["uploaded_filenames"]))})
        return jsonify({"status": "error", "message": "Failed to ingest files"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})


# ── Chat streaming ────────────────────────────────────────────────────────────
LOCAL_PROVIDERS = {"ollama", "local"}


@app.route('/api/start_chat_stream', methods=['POST'])
def start_chat_stream():
    data = request.get_json()
    user_text = data.get("user_text", "")
    target_id = data.get("target_id", None)

    provider = state["current_provider"]
    api_key = state["keys"].get(provider)

    # Local providers don't require an API key
    if not api_key and provider not in LOCAL_PROVIDERS:
        return jsonify({"status": "error", "message": f"Please set your {provider.title()} API Key first."})

    if not target_id:
        save_msg("user", user_text, state["current_session_id"])

    group = get_group(state["current_group_id"])
    system_prompt = group["system_prompt"] if group else None

    session_id = state["current_session_id"]
    q = _get_msg_queue(session_id)
    q.put((
        user_text, target_id,
        provider, api_key, state["current_model"],
        state["multi_agent_mode"], system_prompt, state["base_url"],
    ))

    return jsonify({"status": "queued"})


# ── Agent logic ───────────────────────────────────────────────────────────────
def _detect_tone(text: str) -> str:
    text_lower = text.lower()
    scores = {'excited': 0, 'playful': 0, 'serious': 0, 'calm': 0}
    for w in ['!', 'amazing', 'awesome', 'fantastic', 'great', 'excellent', 'wonderful', 'incredible', 'brilliant']:
        scores['excited'] += text_lower.count(w)
    for w in ['😊', '😄', '🎉', 'haha', 'fun', 'enjoy', 'play', 'funny', 'silly', 'cool', '👍', '✨']:
        scores['playful'] += text_lower.count(w)
    for w in ['important', 'critical', 'warning', 'caution', 'error', 'must', 'necessary', 'security', 'risk', 'problem']:
        scores['serious'] += text_lower.count(w)
    for w in ['here', 'let me', 'simply', 'just', 'easy', 'step', 'guide', 'help', 'explain', 'note']:
        scores['calm'] += text_lower.count(w)
    if max(scores.values()) == 0:
        return 'calm'
    return max(scores, key=scores.get)


def _run_agent(session_id: str, user_text: str, target_id, provider: str,
               api_key, model_id, multi_agent: bool, system_prompt, base_url):
    try:
        if target_id:
            _push_event(session_id, {"type": "clear_bubble", "target_id": target_id})

        full_response = ""

        if multi_agent:
            team = get_team(provider=provider, api_key=api_key,
                            session_id=session_id, system_prompt=system_prompt,
                            base_url=base_url)
            run_response = team.run(user_text, stream=True)
        else:
            agent = get_agent(
                provider=provider, api_key=api_key, model_id=model_id,
                session_id=session_id, system_prompt=system_prompt,
                base_url=base_url,
            )
            run_response = agent.run(user_text, stream=True)

        for chunk in run_response:
            content = chunk.content if hasattr(chunk, 'content') else str(chunk)
            if content:
                full_response += content
                _push_event(session_id, {"type": "chunk", "content": content, "target_id": target_id or ""})

        save_msg("bot", full_response, session_id)
        tone = _detect_tone(full_response)
        _push_event(session_id, {"type": "stream_complete", "tone": tone})

    except Exception as e:
        _push_event(session_id, {"type": "error", "message": str(e)})


# ── Scheduler ─────────────────────────────────────────────────────────────────
def _run_scheduled_task(task: dict):
    """Run a scheduled task and push the result to all active SSE queues."""
    provider = state["current_provider"]
    api_key = state["keys"].get(provider)
    if not api_key:
        print(f"[scheduler] No API key for provider '{provider}', skipping task: {task['name']}")
        return
    try:
        agent = get_agent(provider=provider, api_key=api_key, load_skills=False)
        full_response = ""
        for chunk in agent.run(task["prompt"], stream=True):
            content = chunk.content if hasattr(chunk, 'content') else str(chunk)
            if content:
                full_response += content
        update_task_last_run(task["id"])
        with sse_lock:
            for q in sse_queues.values():
                q.put({"type": "scheduled_result", "task_name": task["name"], "content": full_response})
        print(f"[scheduler] Task '{task['name']}' completed.")
    except Exception as e:
        print(f"[scheduler] Task '{task['name']}' failed: {e}")


def _scheduler_loop():
    """Background thread that polls tasks from DB and schedules them."""
    last_task_check: dict[int, float] = {}
    while True:
        try:
            for task in get_tasks():
                if not task["enabled"]:
                    continue
                tid = task["id"]
                interval = task["interval_seconds"]
                last = last_task_check.get(tid, 0)
                if time.time() - last >= interval:
                    last_task_check[tid] = time.time()
                    t = threading.Thread(target=_run_scheduled_task, args=(task,), daemon=True)
                    t.start()
        except Exception as e:
            print(f"[scheduler] Error: {e}")
        time.sleep(60)


threading.Thread(target=_scheduler_loop, daemon=True).start()


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
