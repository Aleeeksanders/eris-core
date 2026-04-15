// ============================================================
// Eris — Frontend App
// Chat with projects, streaming + thinking
// ============================================================

const TOOL_ICONS = {
  bash: '💻', web_search: '🌐', system_info: '⚙️',
  file_read: '📖', file_write: '✏️', open: '🚀',
};
const TOOL_LABELS = {
  bash: 'Ejecutando comando', web_search: 'Buscando en internet',
  system_info: 'Leyendo info del sistema', file_read: 'Leyendo archivo',
  file_write: 'Escribiendo archivo', open: 'Abriendo',
};

class ErisApp {
  constructor() {
    this.ws = null;
    this.currentSessionId = null;
    this.isProcessing = false;
    this.streamingEl = null;
    this.streamingText = '';
    this.analysisPanel = null;
    this.analysisSteps = null;
    this.analysisStartTime = null;
    this.stepCount = 0;
    this.thinkDisplayEl = null;
    this.hadPanel = false;
    this.conversations = [];

    this.messagesEl = document.getElementById('messages');
    this.welcomeEl = document.getElementById('welcome-screen');
    this.inputEl = document.getElementById('message-input');
    this.sendBtn = document.getElementById('btn-send');
    this.newChatBtn = document.getElementById('btn-new-chat');
    this.thinkingEl = document.getElementById('thinking');
    this.thinkingText = document.getElementById('thinking-text');
    this.ollamaDot = document.getElementById('ollama-dot');
    this.ollamaStatus = document.getElementById('ollama-status');
    this.modelName = document.getElementById('model-name');
    this.toolsList = document.getElementById('tools-list');
    this.convList = document.getElementById('conversations-list');

    this.init();
  }

  init() {
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.newChatBtn.addEventListener('click', () => this.newChat());

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
    });
    this.inputEl.addEventListener('input', () => {
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + 'px';
    });
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const msg = chip.getAttribute('data-msg');
        if (msg) { this.inputEl.value = msg; this.sendMessage(); }
      });
    });
    this.checkStatus();
    this.connectWebSocket();
  }

  async checkStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      this.ollamaDot.className = data.ollama ? 'status-dot online' : 'status-dot offline';
      this.ollamaStatus.textContent = data.ollama ? 'Conectado' : 'Desconectado';
      this.modelName.textContent = data.model || '—';
      if (data.tools) {
        this.toolsList.innerHTML = data.tools.map(name =>
          `<div class="tool-item"><span class="tool-icon">${TOOL_ICONS[name] || '🔧'}</span><span>${name}</span></div>`
        ).join('');
      }
    } catch { this.ollamaDot.className = 'status-dot offline'; }
  }

  connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const sessionParam = this.currentSessionId ? `?session=${this.currentSessionId}` : `?session=${crypto.randomUUID()}`;
    this.ws = new WebSocket(`${protocol}//${location.host}/ws${sessionParam}`);
    this.ws.onopen = () => console.log('🔌 Conectado');
    this.ws.onmessage = (e) => this.handleServerMessage(JSON.parse(e.data));
    this.ws.onclose = () => setTimeout(() => this.connectWebSocket(), 2000);
    this.ws.onerror = () => {};
  }

  handleServerMessage(data) {
    switch (data.type) {
      case 'connected':
        this.currentSessionId = data.sessionId;
        if (data.conversations) this.renderConversations(data.conversations);
        if (data.history && data.history.length > 0) this.loadHistory(data.history);
        break;

      case 'chat_switched':
        this.currentSessionId = data.sessionId;
        this.resetChat();
        if (data.history && data.history.length > 0) {
          this.loadHistory(data.history);
        }
        if (data.conversations) this.renderConversations(data.conversations);
        break;

      case 'conversations_updated':
        if (data.conversations) this.renderConversations(data.conversations);
        break;

      case 'thinking':
        this.thinkingEl.classList.add('hidden');
        if (!this.hadPanel) this.ensureAnalysisPanel('Pensando...');
        break;

      case 'thinking_token':
        this.thinkingEl.classList.add('hidden');
        this.ensureAnalysisPanel('Pensando...');
        this.ensureThinkDisplay();
        this.thinkDisplayEl.textContent += data.content;
        this.scrollToBottom();
        break;

      case 'token':
        this.thinkingEl.classList.add('hidden');
        this.closeAnalysisPanelIfOpen();
        this.appendToken(data.content);
        break;

      case 'tool_call':
        this.finishStreaming();
        this.ensureAnalysisPanel('Analizando...');
        this.addAnalysisStep(data.name, 'running');
        break;

      case 'tool_result':
        this.updateAnalysisStep(data.name, data.error ? 'error' : 'success', data.duration);
        break;

      case 'stream_end':
        this.thinkingEl.classList.add('hidden');
        this.closeAnalysisPanelIfOpen();
        this.finishStreaming(data.content);
        this.setProcessing(false);
        break;

      case 'error':
        this.thinkingEl.classList.add('hidden');
        this.closeAnalysisPanelIfOpen();
        this.finishStreaming();
        this.addMessage('assistant', `❌ Error: ${data.message}`);
        this.setProcessing(false);
        break;

      case 'cleared':
        this.resetChat();
        break;
    }
  }

  // ─── Projects ───

  newChat() {
    if (this.ws) this.ws.send(JSON.stringify({ type: 'new_chat' }));
  }

  switchChat(convId) {
    if (convId === this.currentSessionId) return;
    if (this.ws) this.ws.send(JSON.stringify({ type: 'switch_chat', conversationId: convId }));
  }

  deleteChat(convId, e) {
    e.stopPropagation();
    if (this.ws) this.ws.send(JSON.stringify({ type: 'delete_chat', conversationId: convId }));
  }

  renderConversations(conversations) {
    this.conversations = conversations;
    if (!conversations.length) {
      this.convList.innerHTML = '<div class="conv-empty">Sin conversaciones aún</div>';
      return;
    }

    this.convList.innerHTML = conversations.map(conv => {
      const isActive = conv.id === this.currentSessionId;
      const time = this.timeAgo(conv.updatedAt);
      return `
        <div class="conv-item ${isActive ? 'active' : ''}" onclick="window.eris.switchChat('${conv.id}')">
          <span class="conv-icon">💬</span>
          <div class="conv-info">
            <div class="conv-title">${this.escapeHtml(conv.title)}</div>
            <div class="conv-time">${time} · ${conv.messageCount} msgs</div>
          </div>
          <button class="conv-delete" onclick="window.eris.deleteChat('${conv.id}', event)" title="Eliminar">🗑️</button>
        </div>
      `;
    }).join('');
  }

  timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Ahora';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  loadHistory(history) {
    this.welcomeEl.classList.add('hidden');
    this.messagesEl.classList.add('active');
    history.forEach(msg => {
      if (msg.role === 'user' || msg.role === 'assistant') {
        // Limpiar think tags del contenido guardado
        const clean = (msg.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (clean) this.addMessage(msg.role, clean);
      }
    });
  }

  resetChat() {
    this.messagesEl.innerHTML = '';
    this.messagesEl.classList.remove('active');
    this.welcomeEl.classList.remove('hidden');
    this.streamingEl = null;
    this.streamingText = '';
    this.analysisPanel = null;
    this.analysisSteps = null;
    this.thinkDisplayEl = null;
    this.hadPanel = false;
    this.setProcessing(false);
  }

  // ─── Streaming ───

  appendToken(token) {
    if (!this.streamingEl) {
      const msgEl = document.createElement('div');
      msgEl.className = 'message message-assistant';
      msgEl.innerHTML = `<div class="msg-label">⚡ Eris</div><div class="msg-content streaming-content"></div>`;
      this.messagesEl.appendChild(msgEl);
      this.streamingEl = msgEl.querySelector('.streaming-content');
      this.streamingText = '';
    }
    this.streamingText += token;
    this.streamingEl.innerHTML = this.formatContent(this.streamingText);
    this.scrollToBottom();
  }

  finishStreaming(finalContent) {
    if (this.streamingEl) {
      if (finalContent) {
        const clean = finalContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        this.streamingEl.innerHTML = this.formatContent(clean);
      }
      this.streamingEl.classList.remove('streaming-content');
      this.streamingEl = null;
      this.streamingText = '';
    } else if (finalContent) {
      const clean = finalContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (clean) this.addMessage('assistant', clean);
    }
  }

  // ─── Analysis Panel ───

  ensureAnalysisPanel(label) {
    if (this.analysisPanel) return;
    this.analysisStartTime = Date.now();
    this.stepCount = 0;
    const panel = document.createElement('div');
    panel.className = 'analysis-panel';
    panel.innerHTML = `
      <div class="analysis-header" onclick="window.eris.toggleAnalysis(this)">
        <span class="analysis-spinner"></span>
        <span class="analysis-label">${label}</span>
        <span class="analysis-toggle">▼</span>
      </div>
      <div class="analysis-steps expanded"></div>
    `;
    this.messagesEl.appendChild(panel);
    this.analysisPanel = panel;
    this.analysisSteps = panel.querySelector('.analysis-steps');
    this.scrollToBottom();
  }

  ensureThinkDisplay() {
    if (this.thinkDisplayEl) return;
    if (!this.analysisSteps) return;
    const el = document.createElement('div');
    el.className = 'think-content';
    this.analysisSteps.insertBefore(el, this.analysisSteps.firstChild);
    this.thinkDisplayEl = el;
  }

  addAnalysisStep(toolName, status) {
    if (!this.analysisSteps) return;
    this.stepCount++;
    const icon = status === 'running' ? '◉' : status === 'success' ? '✓' : '✗';
    const step = document.createElement('div');
    step.className = 'analysis-step';
    step.setAttribute('data-tool', toolName);
    step.innerHTML = `
      <span class="step-icon ${status}">${icon}</span>
      <span class="step-text">${TOOL_ICONS[toolName] || '🔧'} ${TOOL_LABELS[toolName] || toolName}</span>
      <span class="step-duration"></span>
    `;
    this.analysisSteps.appendChild(step);
    const lbl = this.analysisPanel.querySelector('.analysis-label');
    if (lbl) lbl.textContent = `Analizando... (${this.stepCount} ${this.stepCount === 1 ? 'paso' : 'pasos'})`;
    this.scrollToBottom();
  }

  updateAnalysisStep(toolName, status, duration) {
    if (!this.analysisSteps) return;
    const steps = this.analysisSteps.querySelectorAll('.analysis-step');
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].getAttribute('data-tool') === toolName) {
        const iconEl = steps[i].querySelector('.step-icon');
        const durEl = steps[i].querySelector('.step-duration');
        if (iconEl) { iconEl.textContent = status === 'success' ? '✓' : '✗'; iconEl.className = `step-icon ${status}`; }
        if (durEl && duration) durEl.textContent = `${duration}ms`;
        break;
      }
    }
  }

  closeAnalysisPanelIfOpen() {
    if (!this.analysisPanel) return;
    const spinner = this.analysisPanel.querySelector('.analysis-spinner');
    if (spinner) spinner.classList.add('done');
    const lbl = this.analysisPanel.querySelector('.analysis-label');
    if (lbl && this.analysisStartTime) {
      const t = ((Date.now() - this.analysisStartTime) / 1000).toFixed(1);
      const s = this.stepCount > 0 ? ` · ${this.stepCount} ${this.stepCount === 1 ? 'paso' : 'pasos'}` : '';
      lbl.textContent = `Pensamiento completado (${t}s${s})`;
    }
    const stepsEl = this.analysisPanel.querySelector('.analysis-steps');
    if (stepsEl) stepsEl.classList.remove('expanded');
    const toggleEl = this.analysisPanel.querySelector('.analysis-toggle');
    if (toggleEl) toggleEl.classList.remove('expanded');
    this.analysisPanel = null;
    this.analysisSteps = null;
    this.analysisStartTime = null;
    this.stepCount = 0;
    this.thinkDisplayEl = null;
    this.hadPanel = true;
  }

  toggleAnalysis(headerEl) {
    const steps = headerEl.nextElementSibling;
    const toggle = headerEl.querySelector('.analysis-toggle');
    if (steps) steps.classList.toggle('expanded');
    if (toggle) toggle.classList.toggle('expanded');
  }

  // ─── Messages ───

  sendMessage() {
    const text = this.inputEl.value.trim();
    if (!text || this.isProcessing || !this.ws) return;
    this.welcomeEl.classList.add('hidden');
    this.messagesEl.classList.add('active');
    this.hadPanel = false;
    this.addMessage('user', text);
    this.ws.send(JSON.stringify({ type: 'message', content: text }));
    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    this.setProcessing(true);
  }

  addMessage(role, content) {
    if (!content) return;
    const msgEl = document.createElement('div');
    msgEl.className = `message message-${role}`;
    const label = role === 'user' ? '👤 Alex' : '⚡ Eris';
    msgEl.innerHTML = `<div class="msg-label">${label}</div><div class="msg-content">${this.formatContent(content)}</div>`;
    this.messagesEl.appendChild(msgEl);
    this.scrollToBottom();
  }

  formatContent(text) {
    if (!text) return '';
    let h = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    h = h.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, l, c) => `<pre><code class="lang-${l}">${c.trim()}</code></pre>`);
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
    h = h.replace(/\n/g, '<br>');
    return h;
  }

  escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  setProcessing(p) {
    this.isProcessing = p;
    this.sendBtn.disabled = p;
    this.inputEl.disabled = p;
    if (!p) this.inputEl.focus();
  }

  scrollToBottom() {
    requestAnimationFrame(() => { this.messagesEl.scrollTop = this.messagesEl.scrollHeight; });
  }
}

window.addEventListener('DOMContentLoaded', () => { window.eris = new ErisApp(); });
