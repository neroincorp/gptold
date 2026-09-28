const welcomeView = document.getElementById('welcomeView');
const chatView = document.getElementById('chatView');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const historyList = document.getElementById('historyList');
const sidebar = document.getElementById('sidebar');
const menuBtn = document.getElementById('menuBtn');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');
const sidebarScrim = document.getElementById('sidebarScrim');
const modelSelect = document.getElementById('modelSelect');

const MODEL_LABELS = {
  'gpt-3.5-turbo': 'GPT-3.5 Turbo'
};

let chats = JSON.parse(localStorage.getItem('classicchat_chats') || '[]');
let activeChatId = localStorage.getItem('classicchat_active') || null;
let selectedModel = localStorage.getItem('classicchat_model') || 'gpt-3.5-turbo';
if (!MODEL_LABELS[selectedModel]) selectedModel = 'gpt-3.5-turbo';
let busy = false;

// Usage display state.
const usageStrip = document.getElementById('usageStrip');
const usageText = document.getElementById('usageText');
const usageReset = document.getElementById('usageReset');
let usageState = null;
let usageTimer = null;
let usageFetchController = null;
let usageRefreshSerial = 0;
let chatActivitySerial = 0;

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function saveState() {
  localStorage.setItem('classicchat_chats', JSON.stringify(chats));
  localStorage.setItem('classicchat_model', selectedModel);
  if (activeChatId) localStorage.setItem('classicchat_active', activeChatId);
  else localStorage.removeItem('classicchat_active');
}

function getActiveChat() {
  return chats.find(c => c.id === activeChatId) || null;
}

function syncModelUI() {
  modelSelect.value = selectedModel;
}

function createChat() {
  const chat = { id: makeId(), title: 'New chat', model: selectedModel, messages: [] };
  chats.unshift(chat);
  activeChatId = chat.id;
  saveState();
  render();
  return chat;
}

function setSidebarOpen(open) {
  sidebar.classList.toggle('open', open);
  document.body.classList.toggle('sidebar-open', open);
  menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  sidebar.setAttribute('aria-hidden', window.innerWidth <= 760 && !open ? 'true' : 'false');
}

function closeSidebar() {
  setSidebarOpen(false);
}

function resetToWelcome() {
  activeChatId = null;
  saveState();
  render();
  closeSidebar();
  messageInput.focus();
}

function escapeHTML(value) {
  return value.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function formatMessage(text) {
  const safe = escapeHTML(text);
  const codeSplit = safe.split(/```/);
  return codeSplit.map((part, index) => index % 2
    ? `<pre><code>${part}</code></pre>`
    : part.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g,'<br>')}</p>`).join('')
  ).join('');
}

function renderHistory() {
  historyList.innerHTML = '';
  chats.slice(0, 30).forEach(chat => {
    const button = document.createElement('button');
    button.className = `history-item ${chat.id === activeChatId ? 'active' : ''}`;
    button.textContent = chat.title || 'New chat';
    button.addEventListener('click', () => {
      activeChatId = chat.id;
      if (MODEL_LABELS[chat.model]) selectedModel = chat.model;
      syncModelUI();
      saveState();
      render();
      closeSidebar();
    });
    historyList.appendChild(button);
  });
}

function renderMessages(chat) {
  chatView.innerHTML = '';
  for (const message of chat.messages) {
    const row = document.createElement('article');
    row.className = `message-row ${message.role === 'assistant' ? 'assistant' : 'user'}`;
    row.innerHTML = `
      <div class="message-inner">
        <div class="avatar ${message.role === 'assistant' ? 'ai-avatar' : 'user-avatar'}">${message.role === 'assistant' ? 'AI' : 'U'}</div>
        <div class="message-content">${formatMessage(message.content)}</div>
      </div>`;
    chatView.appendChild(row);
  }
  requestAnimationFrame(() => { chatView.scrollTop = chatView.scrollHeight; });
}

function render() {
  renderHistory();
  syncModelUI();
  const chat = getActiveChat();
  if (!chat || chat.messages.length === 0) {
    welcomeView.classList.remove('hidden');
    chatView.classList.add('hidden');
    chatView.innerHTML = '';
  } else {
    welcomeView.classList.add('hidden');
    chatView.classList.remove('hidden');
    renderMessages(chat);
  }
}

function formatResetCountdown(resetAt) {
  const ms = new Date(resetAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'resetting…';
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `resets in ${hours}h ${minutes}m`;
  return `resets in ${minutes}m`;
}

function paintUsage(usage, source = 'server') {
  if (!usage || typeof usage.remaining !== 'number' || typeof usage.limit !== 'number') return;

  // The browser can have an older /api/usage request still in flight when a
  // message is sent. Never let a stale same-day response make the meter jump
  // Never let an older refresh for the same quota window make the counter
  // jump upward. A new windowId is allowed to reset the count normally.
  if (
    usageState &&
    usage.windowId && usageState.windowId === usage.windowId &&
    usage.remaining > usageState.remaining &&
    source === 'refresh'
  ) {
    return;
  }

  usageState = usage;
  usageText.textContent = `${usage.remaining} of ${usage.limit} messages left`;
  usageReset.textContent = `• ${formatResetCountdown(usage.resetAt)}`;
  usageStrip.classList.toggle('low', usage.remaining > 0 && usage.remaining <= Math.max(3, Math.ceil(usage.limit * 0.2)));
  usageStrip.classList.toggle('empty', usage.remaining <= 0);
  sendBtn.disabled = busy || usage.remaining <= 0;
}

async function refreshUsage() {
  const serial = ++usageRefreshSerial;
  const activityAtStart = chatActivitySerial;

  if (usageFetchController) usageFetchController.abort();
  usageFetchController = new AbortController();

  try {
    const response = await fetch(`/api/usage?t=${Date.now()}`, {
      cache: 'no-store',
      signal: usageFetchController.signal,
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) return;
    const usage = await response.json();

    // Ignore results that became stale while the user was sending a message.
    if (serial !== usageRefreshSerial || activityAtStart !== chatActivitySerial) return;
    paintUsage(usage, 'refresh');
  } catch (error) {
    if (error.name !== 'AbortError') {
      // Keep chat usable if the counter cannot load.
    }
  }
}

function startUsageTimer() {
  clearInterval(usageTimer);
  usageTimer = setInterval(() => {
    if (!usageState) return;
    usageReset.textContent = `• ${formatResetCountdown(usageState.resetAt)}`;
    if (new Date(usageState.resetAt).getTime() <= Date.now()) {
      usageState = null;
      refreshUsage();
    }
  }, 30000);
}

async function sendMessage(text) {
  if (!text.trim() || busy || (usageState && usageState.remaining <= 0)) return;

  busy = true;
  chatActivitySerial += 1;
  usageRefreshSerial += 1; // invalidates any older usage GET
  if (usageFetchController) usageFetchController.abort();
  sendBtn.disabled = true;

  let chat = getActiveChat() || createChat();
  const userText = text.trim();
  chat.model = selectedModel;
  chat.messages.push({ role: 'user', content: userText });
  if (chat.title === 'New chat') chat.title = userText.slice(0, 38) + (userText.length > 38 ? '…' : '');
  saveState();
  render();

  const thinkingRow = document.createElement('article');
  thinkingRow.className = 'message-row assistant';
  thinkingRow.innerHTML = `<div class="message-inner"><div class="avatar ai-avatar">AI</div><div class="message-content thinking">Thinking…</div></div>`;
  chatView.appendChild(thinkingRow);
  chatView.scrollTop = chatView.scrollHeight;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chat.messages, model: selectedModel })
    });

    const data = await response.json().catch(() => ({}));
    if (data.usage) paintUsage(data.usage, 'chat');
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

    chat.messages.push({ role: 'assistant', content: data.message || 'No response returned.' });
  } catch (error) {
    chat.messages.push({
      role: 'assistant',
      content: error.message || 'Something went wrong. Please try again.'
    });
  } finally {
    busy = false;
    chatActivitySerial += 1;
    sendBtn.disabled = Boolean(usageState && usageState.remaining <= 0);
    saveState();
    render();
    messageInput.focus();
  }
}

chatForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = messageInput.value;
  if (!text.trim() || busy || (usageState && usageState.remaining <= 0)) return;
  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendMessage(text);
});

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 190)}px`;
});

messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

document.querySelectorAll('[data-prompt]').forEach(button => {
  button.addEventListener('click', () => {
    messageInput.value = button.dataset.prompt;
    messageInput.focus();
  });
});

document.getElementById('newChatBtn').addEventListener('click', resetToWelcome);
document.getElementById('resetBtn').addEventListener('click', () => {
  const chat = getActiveChat();
  if (chat) {
    chat.messages = [];
    chat.title = 'New chat';
    chat.model = selectedModel;
    saveState();
  }
  render();
  closeSidebar();
});

document.getElementById('themeBtn').addEventListener('click', () => document.body.classList.toggle('light'));

modelSelect.addEventListener('change', () => {
  const next = modelSelect.value;
  if (!MODEL_LABELS[next]) return;
  selectedModel = next;
  const chat = getActiveChat();
  if (chat) chat.model = selectedModel;
  saveState();
  syncModelUI();
});

menuBtn.addEventListener('click', () => setSidebarOpen(!sidebar.classList.contains('open')));
closeSidebarBtn.addEventListener('click', closeSidebar);
sidebarScrim.addEventListener('click', closeSidebar);
sidebar.addEventListener('click', event => event.stopPropagation());

window.addEventListener('resize', () => {
  if (window.innerWidth > 760) closeSidebar();
  else sidebar.setAttribute('aria-hidden', sidebar.classList.contains('open') ? 'false' : 'true');
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeSidebar();
});

syncModelUI();
render();
setSidebarOpen(false);
refreshUsage();
startUsageTimer();
