const welcomeView = document.getElementById('welcomeView');
const chatView = document.getElementById('chatView');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const historyList = document.getElementById('historyList');
const sidebar = document.getElementById('sidebar');

let chats = JSON.parse(localStorage.getItem('classicchat_chats') || '[]');
let activeChatId = localStorage.getItem('classicchat_active') || null;
let busy = false;

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function saveState() {
  localStorage.setItem('classicchat_chats', JSON.stringify(chats));
  if (activeChatId) localStorage.setItem('classicchat_active', activeChatId);
  else localStorage.removeItem('classicchat_active');
}

function getActiveChat() {
  return chats.find(c => c.id === activeChatId) || null;
}

function createChat() {
  const chat = { id: makeId(), title: 'New chat', messages: [] };
  chats.unshift(chat);
  activeChatId = chat.id;
  saveState();
  render();
  return chat;
}

function resetToWelcome() {
  activeChatId = null;
  saveState();
  render();
  messageInput.focus();
}

function escapeHTML(value) {
  return value.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function formatMessage(text) {
  const safe = escapeHTML(text);
  const codeSplit = safe.split(/```/);
  return codeSplit.map((part, index) => index % 2 ? `<pre><code>${part}</code></pre>` : part.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g,'<br>')}</p>`).join('')).join('');
}

function renderHistory() {
  historyList.innerHTML = '';
  chats.slice(0, 30).forEach(chat => {
    const button = document.createElement('button');
    button.className = `history-item ${chat.id === activeChatId ? 'active' : ''}`;
    button.textContent = chat.title || 'New chat';
    button.addEventListener('click', () => {
      activeChatId = chat.id;
      saveState();
      render();
      sidebar.classList.remove('open');
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

async function sendMessage(text) {
  if (!text.trim() || busy) return;
  busy = true;
  sendBtn.disabled = true;

  let chat = getActiveChat() || createChat();
  const userText = text.trim();
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
      body: JSON.stringify({ messages: chat.messages })
    });

    const data = await response.json().catch(() => ({}));
    if (data.usage) paintUsage(data.usage);
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

    chat.messages.push({ role: 'assistant', content: data.message || 'No response returned.' });
  } catch (error) {
    chat.messages.push({
      role: 'assistant',
      content: error.message || 'Something went wrong. Please try again.'
    });
  } finally {
    busy = false;
    sendBtn.disabled = Boolean(usageState && usageState.remaining <= 0);
    saveState();
    render();
    messageInput.focus();
  }
}

chatForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = messageInput.value;
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
    saveState();
  }
  render();
});
document.getElementById('themeBtn').addEventListener('click', () => document.body.classList.toggle('light'));
document.getElementById('menuBtn').addEventListener('click', () => sidebar.classList.toggle('open'));

render();

// Daily usage display ---------------------------------------------------------
const usageStrip = document.getElementById('usageStrip');
const usageText = document.getElementById('usageText');
const usageReset = document.getElementById('usageReset');
const sidebarScrim = document.getElementById('sidebarScrim');
let usageState = null;
let usageTimer = null;

function formatResetCountdown(resetAt) {
  const ms = new Date(resetAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'resetting…';
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `resets in ${hours}h ${minutes}m`;
  return `resets in ${minutes}m`;
}

function paintUsage(usage) {
  if (!usage || typeof usage.remaining !== 'number') return;
  usageState = usage;
  usageText.textContent = `${usage.remaining} of ${usage.limit} messages left today`;
  usageReset.textContent = `• ${formatResetCountdown(usage.resetAt)}`;
  usageStrip.classList.toggle('low', usage.remaining > 0 && usage.remaining <= Math.max(3, Math.ceil(usage.limit * 0.2)));
  usageStrip.classList.toggle('empty', usage.remaining <= 0);
  if (usage.remaining <= 0) sendBtn.disabled = true;
}

async function refreshUsage() {
  try {
    const response = await fetch('/api/usage', { cache: 'no-store' });
    if (!response.ok) return;
    const usage = await response.json();
    paintUsage(usage);
  } catch (_) {
    // Keep chat usable if the counter cannot load.
  }
}

function startUsageTimer() {
  clearInterval(usageTimer);
  usageTimer = setInterval(() => {
    if (!usageState) return;
    usageReset.textContent = `• ${formatResetCountdown(usageState.resetAt)}`;
    if (new Date(usageState.resetAt).getTime() <= Date.now()) refreshUsage();
  }, 30000);
}

sidebarScrim?.addEventListener('click', () => sidebar.classList.remove('open'));
window.addEventListener('resize', () => {
  if (window.innerWidth > 760) sidebar.classList.remove('open');
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') sidebar.classList.remove('open');
});

refreshUsage();
startUsageTimer();
