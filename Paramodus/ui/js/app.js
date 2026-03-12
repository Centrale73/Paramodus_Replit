/* ============================================
   AGENTIC WORKSPACE - APP.JS
   Main Application Logic with GenUI Features
   Web server version (Flask + SSE)
   ============================================ */

// ========================================
// STATE
// ========================================
let currentBotMsgId = null;
let botBuffers = {};

// GenUI: Typing speed tracking
let lastKeyTime = 0;
let keyIntervals = [];
const TYPING_SAMPLE_SIZE = 10;
const SLOW_THRESHOLD_MS = 400;
const FAST_THRESHOLD_MS = 150;

// SSE connection
let eventSource = null;

// ========================================
// API HELPER
// ========================================
async function apiCall(endpoint, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== null) opts.body = JSON.stringify(body);
    const res = await fetch('/api/' + endpoint, opts);
    return res.json();
}

// ========================================
// SSE SETUP
// ========================================
function setupSSE() {
    if (eventSource) {
        eventSource.close();
    }
    eventSource = new EventSource('/api/stream_events');
    eventSource.onmessage = (e) => {
        const event = JSON.parse(e.data);
        if (event.type === 'ping') return;
        if (event.type === 'chunk') {
            receiveChunk(event.content, event.target_id || null);
        } else if (event.type === 'clear_bubble') {
            clearBubble(event.target_id);
        } else if (event.type === 'stream_complete') {
            streamComplete(event.tone);
        } else if (event.type === 'error') {
            receiveError(event.message);
        } else if (event.type === 'scheduled_result') {
            appendMessage('bot', `**[Scheduled: ${event.task_name}]**\n\n${event.content}`, true);
        }
    };
    eventSource.onerror = () => {
        // Reconnect after a short delay
        setTimeout(setupSSE, 2000);
    };
}

// ========================================
// INITIALIZATION
// ========================================
async function init() {
    setupSSE();
    const history = await apiCall('load_history');
    history.forEach(msg => appendMessage(msg.role, msg.content, false));
    setupDragAndDrop();
    setupTypingSpeedDetection();
    animateHeader();
    loadSessionList();
    loadGroups();
    loadTasks();
}

document.addEventListener('DOMContentLoaded', init);

// ========================================
// NEW CHAT / SESSION MANAGEMENT
// ========================================
async function newChat() {
    const result = await apiCall('new_session', 'POST');
    if (result.status === 'success') {
        clearChatUI();
        setupSSE();
        console.log('New session started:', result.session_id);
        loadSessionList();
    }
}

function clearChatUI() {
    document.getElementById('chat-history').innerHTML = '';
    currentBotMsgId = null;
    botBuffers = {};
    checkpointedMessages.clear();
    document.getElementById('checkpoint-blocks').innerHTML = '';
}

async function loadSessionList() {
    const sessions = await apiCall('list_sessions');
    const list = document.getElementById('session-list');

    if (!sessions || sessions.length === 0) {
        list.innerHTML = '<div class="no-sessions">No previous chats</div>';
        return;
    }

    const currentIdResp = await apiCall('get_current_session_id');
    const currentId = currentIdResp.session_id || currentIdResp;

    let html = '';
    sessions.forEach(session => {
        const date = new Date(session.timestamp).toLocaleDateString();
        const activeClass = session.id === currentId ? 'active' : '';
        const safeTitle = session.title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        html += `
            <div class="session-item ${activeClass}" onclick="switchSession('${session.id}')">
                <div class="session-title">${safeTitle}</div>
                <div class="session-date">${date}</div>
            </div>
        `;
    });

    list.innerHTML = html;
}

async function switchSession(sessionId) {
    const result = await apiCall('switch_session', 'POST', { session_id: sessionId });
    if (result.status === 'success') {
        clearChatUI();
        setupSSE();
        const history = await apiCall('load_history');
        history.forEach(msg => appendMessage(msg.role, msg.content, false));
        loadSessionList();
    }
}


// ========================================
// GENUI: TYPING SPEED DETECTION
// ========================================
function setupTypingSpeedDetection() {
    const input = document.getElementById('user-input');

    input.addEventListener('keydown', (e) => {
        if (e.key.length !== 1 && e.key !== 'Backspace') return;

        const now = Date.now();
        if (lastKeyTime > 0) {
            const interval = now - lastKeyTime;
            keyIntervals.push(interval);

            if (keyIntervals.length > TYPING_SAMPLE_SIZE) {
                keyIntervals.shift();
            }

            if (keyIntervals.length >= 5) {
                const avgInterval = keyIntervals.reduce((a, b) => a + b, 0) / keyIntervals.length;
                applyTypingTheme(avgInterval);
            }
        }
        lastKeyTime = now;
    });

    input.addEventListener('blur', () => {
        keyIntervals = [];
        lastKeyTime = 0;
    });
}

function applyTypingTheme(avgInterval) {
    const body = document.body;
    body.classList.remove('typing-slow', 'typing-fast');

    if (avgInterval > SLOW_THRESHOLD_MS) {
        body.classList.add('typing-slow');
    } else if (avgInterval < FAST_THRESHOLD_MS) {
        body.classList.add('typing-fast');
    }
}

// ========================================
// GENUI: TONE-BASED MESSAGE STYLING
// ========================================
function applyToneToMessage(messageId, tone) {
    const msgElement = document.getElementById(messageId);
    if (msgElement && tone) {
        msgElement.classList.remove('tone-calm', 'tone-excited', 'tone-serious', 'tone-playful');
        const toneClass = `tone-${tone.toLowerCase()}`;
        if (['tone-calm', 'tone-excited', 'tone-serious', 'tone-playful'].includes(toneClass)) {
            msgElement.classList.add(toneClass);
        }
    }
}

// ========================================
// SIDEBAR
// ========================================
let currentSidebarView = 'chats';

function toggleSidebar(view = null) {
    const sidebar = document.getElementById('sidebar');
    const title = document.getElementById('sidebar-title');

    if (!view) {
        sidebar.classList.remove('visible');
        updateSidebarPosition();
        return;
    }

    if (!sidebar.classList.contains('visible') || currentSidebarView !== view) {
        document.getElementById('view-chats').style.display = view === 'chats' ? 'block' : 'none';
        document.getElementById('view-settings').style.display = view === 'settings' ? 'block' : 'none';

        title.textContent = view === 'chats' ? 'Chats' : 'Settings';

        document.getElementById('tab-chats').classList.toggle('active', view === 'chats');
        document.getElementById('tab-settings').classList.toggle('active', view === 'settings');

        currentSidebarView = view;
        sidebar.classList.add('visible');
    } else {
        sidebar.classList.remove('visible');
        document.getElementById('tab-chats').classList.remove('active');
        document.getElementById('tab-settings').classList.remove('active');
    }

    updateSidebarPosition();
}

function updateSidebarPosition() {
    const sidebar = document.getElementById('sidebar');
    anime({
        targets: sidebar,
        translateX: sidebar.classList.contains('visible') ? ['-100%', '0%'] : ['0%', '-100%'],
        duration: 350,
        easing: 'easeOutQuad'
    });
}

// ========================================
// HEADER ANIMATION
// ========================================
function animateHeader() {
    anime({
        targets: '.logo',
        translateY: [-8, 0],
        opacity: [0, 1],
        duration: 600,
        easing: 'easeOutQuad'
    });
}

// ========================================
// SETTINGS & CONFIGURATION
// ========================================
async function toggleAgents() {
    const enabled = document.getElementById('agent-toggle').checked;
    await apiCall('toggle_multi_agent', 'POST', { enabled });
}

async function updateProvider() {
    const p = document.getElementById('provider-select').value;
    await apiCall('set_provider', 'POST', { provider: p });
}

async function updateModel() {
    const m = document.getElementById('model-input').value;
    await apiCall('set_model', 'POST', { model_id: m });
}

// ========================================
// CUSTOM PROVIDER DROPDOWN
// ========================================
function toggleProviderDropdown() {
    const dropdown = document.getElementById('provider-dropdown');
    dropdown.classList.toggle('open');
}

const LOCAL_PROVIDERS = new Set(['ollama', 'local']);
const LOCAL_URL_DEFAULTS = { ollama: 'http://localhost:11434', local: 'http://localhost:1234/v1' };
const LOCAL_URL_LABELS = { ollama: 'Ollama Host URL', local: 'OpenAI-Compatible Server URL' };

function selectProvider(value, label) {
    const dropdown = document.getElementById('provider-dropdown');
    const selected = dropdown.querySelector('.dropdown-selected');
    const selectedText = selected.querySelector('.selected-text');
    const hiddenInput = document.getElementById('provider-select');

    selected.setAttribute('data-value', value);
    selectedText.textContent = label;
    hiddenInput.value = value;

    dropdown.querySelectorAll('.dropdown-option').forEach(opt => {
        opt.classList.toggle('selected', opt.getAttribute('data-value') === value);
    });

    dropdown.classList.remove('open');

    // Show/hide URL field and update labels for local providers
    const isLocal = LOCAL_PROVIDERS.has(value);
    document.getElementById('local-url-section').style.display = isLocal ? 'block' : 'none';
    document.getElementById('api-key-label').style.display = isLocal ? 'none' : 'block';
    document.getElementById('api-key').style.display = isLocal ? 'none' : 'block';
    if (isLocal) {
        document.getElementById('base-url-label').textContent = LOCAL_URL_LABELS[value] || 'Server URL';
        document.getElementById('base-url-input').placeholder = LOCAL_URL_DEFAULTS[value] || 'http://localhost:11434';
        const modelInput = document.getElementById('model-input');
        if (!modelInput.value) modelInput.placeholder = value === 'ollama' ? 'e.g. llama3.2' : 'e.g. local-model';
    } else {
        const modelInput = document.getElementById('model-input');
        modelInput.placeholder = 'e.g. gpt-4o';
    }

    updateProvider();
}

document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('provider-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
    }
});

async function saveKey() {
    const p = document.getElementById('provider-select').value;
    const isLocal = LOCAL_PROVIDERS.has(p);

    if (isLocal) {
        const url = document.getElementById('base-url-input').value.trim();
        const res = await apiCall('set_base_url', 'POST', { url });
        alert(res);
    } else {
        const k = document.getElementById('api-key').value;
        if (!k) { alert("Please enter a key"); return; }
        const res = await apiCall('set_api_key', 'POST', { key: k, provider: p });
        alert(res);
    }
}

// ========================================
// RAG / FILE HANDLING
// ========================================
async function clearRag() {
    const res = await apiCall('clear_rag_context', 'POST');
    document.getElementById('file-list').innerHTML = '';
    document.getElementById('sidebar-file-list').innerHTML = '';
    alert(res);
}

function setupDragAndDrop() {
    const dz = document.getElementById('drop-zone');
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
        dz.addEventListener(evt, e => {
            e.preventDefault();
            e.stopPropagation();
        });
    });
    dz.addEventListener('dragover', () => dz.classList.add('active'));
    dz.addEventListener('dragleave', () => dz.classList.remove('active'));
    dz.addEventListener('drop', e => processFiles(e.dataTransfer.files));
}

function handleFileSelect(e) {
    processFiles(e.target.files);
}

async function processFiles(filesList) {
    const dz = document.getElementById('drop-zone');
    dz.classList.remove('active');
    const files = Array.from(filesList);
    const uploadData = [];

    for (const file of files) {
        const reader = new FileReader();
        const promise = new Promise(resolve => {
            reader.onload = e => resolve({ name: file.name, content: e.target.result });
            reader.readAsDataURL(file);
        });
        uploadData.push(await promise);
    }

    if (uploadData.length > 0) {
        dz.innerText = "Ingesting...";
        const res = await apiCall('upload_files', 'POST', uploadData);
        if (res.status === 'success') {
            updateFileList(res.files);
            dz.innerText = "Files ready!";
            setTimeout(() => {
                dz.innerText = "Drag PDF/CSV here\nor Click to upload";
            }, 3000);
        } else {
            alert("Error: " + res.message);
            dz.innerText = "Drag PDF/CSV here\nor Click to upload";
        }
    }
}

function updateFileList(files) {
    const list = document.getElementById('file-list');
    const sidebarList = document.getElementById('sidebar-file-list');
    const html = files.map(f => `<div class="file-tag">${f}</div>`).join('');
    list.innerHTML = html;
    sidebarList.innerHTML = html;

    anime({
        targets: '.file-tag',
        opacity: [0, 1],
        translateY: [6, 0],
        delay: anime.stagger(40),
        duration: 300,
        easing: 'easeOutQuad'
    });
}

// ========================================
// CHAT FUNCTIONALITY
// ========================================
function handleEnter(e) {
    if (e.key === 'Enter') sendPrompt();
}

function sendPrompt() {
    const input = document.getElementById('user-input');
    const val = input.value.trim();
    if (!val) return;

    input.value = '';
    appendMessage('user', val);

    const botId = 'bot-' + Date.now();
    currentBotMsgId = botId;
    botBuffers[botId] = "";
    createBotBubble(botId);

    keyIntervals = [];
    lastKeyTime = 0;

    apiCall('start_chat_stream', 'POST', { user_text: val }).then(res => {
        if (res.status === 'error') {
            receiveError(res.message);
        }
    });
}

function receiveChunk(chunk, targetId) {
    const id = targetId || currentBotMsgId;
    const div = document.getElementById(id);
    if (div) {
        botBuffers[id] = (botBuffers[id] || "") + chunk;
        div.innerHTML = marked.parse(botBuffers[id]);
        scrollToBottom();
    }
}

function createBotBubble(id) {
    const container = document.getElementById('chat-history');
    const wrapper = document.createElement('div');
    wrapper.className = "message-wrapper bot-wrapper";
    wrapper.setAttribute('data-msg-id', id);
    wrapper.innerHTML = `
        <div class="message bot" id="${id}"><span class="loading-dots">Thinking</span></div>
        <button class="checkpoint-btn" onclick="toggleCheckpoint('${id}')" title="Checkpoint this answer">✓</button>
    `;
    container.appendChild(wrapper);
    animateMessage(wrapper);
    scrollToBottom();

    createCheckpointBlock(id);
}

function clearBubble(id) {
    const div = document.getElementById(id);
    if (div) {
        div.innerHTML = "";
        botBuffers[id] = "";
    }
}

function appendMessage(role, text, animate = true) {
    if (role === 'bot') {
        const id = 'bot-' + Math.random().toString(36).substr(2, 9);
        botBuffers[id] = text;
        createBotBubble(id);
        document.getElementById(id).innerHTML = marked.parse(text);
    } else {
        const container = document.getElementById('chat-history');
        const wrapper = document.createElement('div');
        wrapper.className = "message-wrapper user-wrapper";
        wrapper.innerHTML = `<div class="message user">${text.replace(/</g, "&lt;")}</div>`;
        container.appendChild(wrapper);
        if (animate) {
            animateMessage(wrapper);
        }
    }
    scrollToBottom();
}

function animateMessage(wrapper) {
    anime({
        targets: wrapper,
        opacity: [0, 1],
        translateY: [10, 0],
        duration: 300,
        easing: 'easeOutQuad'
    });
}

function scrollToBottom() {
    document.getElementById('chat-history').scrollTop = document.getElementById('chat-history').scrollHeight;
}

function receiveError(e) {
    alert("Error: " + e);
}

function streamComplete(tone) {
    if (currentBotMsgId && tone) {
        applyToneToMessage(currentBotMsgId, tone);
    }

    updateCheckpointTooltip(currentBotMsgId);
    currentBotMsgId = null;
}

// ========================================
// CHECKPOINT SIDEBAR FUNCTIONALITY
// ========================================
let checkpointedMessages = new Set();

function createCheckpointBlock(msgId) {
    const container = document.getElementById('checkpoint-blocks');
    const block = document.createElement('div');
    block.className = 'checkpoint-block';
    block.id = `checkpoint-${msgId}`;
    block.setAttribute('data-msg-id', msgId);
    block.setAttribute('data-tooltip', 'Loading...');
    block.onclick = () => navigateToMessage(msgId);
    container.appendChild(block);

    anime({
        targets: block,
        opacity: [0, 1],
        translateX: [10, 0],
        duration: 300,
        easing: 'easeOutQuad'
    });
}

function updateCheckpointTooltip(msgId) {
    const block = document.getElementById(`checkpoint-${msgId}`);
    const msgDiv = document.getElementById(msgId);
    if (block && msgDiv) {
        const text = msgDiv.textContent.trim();
        const preview = text.length > 30 ? text.substring(0, 30) + '...' : text;
        block.setAttribute('data-tooltip', preview || 'Answer');
    }
}

function toggleCheckpoint(msgId) {
    const btn = document.querySelector(`.message-wrapper[data-msg-id="${msgId}"] .checkpoint-btn`);
    const block = document.getElementById(`checkpoint-${msgId}`);

    if (checkpointedMessages.has(msgId)) {
        checkpointedMessages.delete(msgId);
        btn?.classList.remove('checked');
        block?.classList.remove('checked');
    } else {
        checkpointedMessages.add(msgId);
        btn?.classList.add('checked');
        block?.classList.add('checked');

        if (block) {
            anime({
                targets: block,
                scale: [1.3, 1],
                duration: 300,
                easing: 'easeOutBack'
            });
        }
    }
}

function navigateToMessage(msgId) {
    const msgElement = document.getElementById(msgId);
    if (msgElement) {
        msgElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

        anime({
            targets: msgElement,
            boxShadow: ['0 0 0 2px var(--accent)', '0 0 0 0px transparent'],
            duration: 1000,
            easing: 'easeOutQuad'
        });
    }
}

// Setup scroll sync between chat and checkpoint sidebar
function setupScrollSync() {
    const chatHistory = document.getElementById('chat-history');
    const checkpointBlocks = document.getElementById('checkpoint-blocks');

    if (!chatHistory || !checkpointBlocks) return;

    chatHistory.addEventListener('scroll', () => {
        const wrappers = chatHistory.querySelectorAll('.message-wrapper.bot-wrapper');
        const chatRect = chatHistory.getBoundingClientRect();
        const chatCenter = chatRect.top + chatRect.height / 2;

        let closestWrapper = null;
        let closestDistance = Infinity;

        wrappers.forEach(wrapper => {
            const rect = wrapper.getBoundingClientRect();
            const distance = Math.abs(rect.top + rect.height / 2 - chatCenter);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestWrapper = wrapper;
            }
        });

        document.querySelectorAll('.checkpoint-block').forEach(block => {
            block.classList.remove('active');
        });

        if (closestWrapper) {
            const msgId = closestWrapper.getAttribute('data-msg-id');
            const activeBlock = document.getElementById(`checkpoint-${msgId}`);
            if (activeBlock) {
                activeBlock.classList.add('active');
            }
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupScrollSync);
} else {
    setupScrollSync();
}

// ========================================
// GROUP CONTEXT
// ========================================
let groups = [];
let currentGroupId = 1;

async function loadGroups() {
    groups = await apiCall('groups');
    const sel = document.getElementById('group-select');
    sel.innerHTML = groups.map(g =>
        `<option value="${g.id}" ${g.id === currentGroupId ? 'selected' : ''}>${g.name}</option>`
    ).join('');
    updateGroupUI(currentGroupId);
}

async function selectGroup(groupId) {
    currentGroupId = parseInt(groupId);
    await apiCall('groups/select', 'POST', { group_id: currentGroupId });
    updateGroupUI(currentGroupId);
}

function updateGroupUI(groupId) {
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    document.getElementById('group-prompt').value = g.system_prompt || '';
    const badge = document.getElementById('group-badge');
    if (badge) badge.textContent = g.name;
}

async function saveGroup() {
    const name = document.getElementById('group-select').options[document.getElementById('group-select').selectedIndex]?.text || 'Group';
    const system_prompt = document.getElementById('group-prompt').value;
    await apiCall(`groups/${currentGroupId}`, 'PUT', { name, system_prompt });
    groups = groups.map(g => g.id === currentGroupId ? { ...g, system_prompt } : g);
    alert('Group saved.');
}

async function newGroup() {
    const name = prompt('Group name:', 'New Group');
    if (!name) return;
    const prompt_text = document.getElementById('group-prompt').value;
    const g = await apiCall('groups', 'POST', { name, system_prompt: prompt_text });
    groups.push(g);
    const sel = document.getElementById('group-select');
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    sel.appendChild(opt);
    sel.value = g.id;
    currentGroupId = g.id;
    await apiCall('groups/select', 'POST', { group_id: currentGroupId });
    const badge = document.getElementById('group-badge');
    if (badge) badge.textContent = g.name;
}

// ========================================
// SCHEDULED TASKS
// ========================================
async function loadTasks() {
    const tasks = await apiCall('tasks');
    renderTaskList(tasks);
}

function renderTaskList(tasks) {
    const list = document.getElementById('task-list');
    if (!tasks.length) { list.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem">No tasks yet.</div>'; return; }
    list.innerHTML = tasks.map(t => `
        <div class="task-item">
            <div class="task-info">
                <span class="task-name">${t.name}</span>
                <span class="task-interval">${t.interval_seconds}s</span>
            </div>
            <div class="task-actions">
                <label class="task-toggle">
                    <input type="checkbox" ${t.enabled ? 'checked' : ''} onchange="toggleTaskEnabled(${t.id}, this.checked)">
                    <span class="task-toggle-label">On</span>
                </label>
                <button class="task-delete" onclick="removeTask(${t.id})">✕</button>
            </div>
        </div>
    `).join('');
}

async function addTask() {
    const name = document.getElementById('task-name').value.trim();
    const prompt = document.getElementById('task-prompt').value.trim();
    const interval = parseInt(document.getElementById('task-interval').value) || 3600;
    if (!name || !prompt) { alert('Please fill in task name and prompt.'); return; }
    await apiCall('tasks', 'POST', { name, prompt, interval_seconds: interval });
    document.getElementById('task-name').value = '';
    document.getElementById('task-prompt').value = '';
    loadTasks();
}

async function removeTask(taskId) {
    await apiCall(`tasks/${taskId}`, 'DELETE');
    loadTasks();
}

async function toggleTaskEnabled(taskId, enabled) {
    await apiCall(`tasks/${taskId}/toggle`, 'POST', { enabled });
}
