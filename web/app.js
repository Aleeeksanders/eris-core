// ============================================================
// Eris — Frontend App v4.0 (Thinking Modes)
// ⚡ Flash | 🧠 Deep | 🔮 Auto
// ============================================================

const TOOL_ICONS = {
  bash: '💻', web_search: '🌐', system_info: '⚙️',
  file_read: '📖', file_write: '✏️', open: '🚀',
  knowledge_search: '🧠', log_management: '📝', 
  vault_audit: '🔍', vault_healer: '🩹',
  executive_report: '📊', crystallize: '💎'
};

const MODE_COLORS = {
  flash: '#facc15',  // Dorado eléctrico
  deep: '#8b5cf6',   // Violeta profundo
  auto: '#22d3ee',   // Cyan (accent default)
};

class ErisApp {
  constructor() {
    this.ws = null;
    this.currentSessionId = null;
    this.isProcessing = false;
    this.streamingEl = null;
    this.streamingText = '';
    this.thinkingBlockEl = null;
    this.currentMode = 'auto';
    this.projects = [];

    // ─── Detección de modo: Hestia (localhost) vs Eris público
    this.IS_LOCAL = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    this.HESTIA_ID = 'hestia'; // ID reservado — bloqueado en remoto

    // Auth State
    this.profileId = localStorage.getItem('eris-profile') || null;
    this.pin = sessionStorage.getItem('eris-pin') || null;

    // Elements
    this.messagesEl = document.getElementById('messages');
    this.welcomeEl = document.getElementById('welcome-screen');
    this.chatHeader = document.getElementById('chat-header');
    this.chatTitle = document.getElementById('chat-title');
    this.inputEl = document.getElementById('message-input');
    this.sendBtn = document.getElementById('btn-send');
    this.thinkingEl = document.getElementById('thinking');
    this.convList = document.getElementById('conversations-list');
    this.toolsList = document.getElementById('tools-list');
    this.statusBtn = document.getElementById('btn-status-axs');
    this.newChatBtn = document.getElementById('btn-new-chat');
    this.inputWrapper = document.querySelector('.input-wrapper'); 
    this.ollamaDot = document.getElementById('ollama-dot');
    this.ollamaLabel = document.getElementById('ollama-status');
    this.modeIndicator = document.getElementById('mode-indicator');
    
    // Login Elements
    this.loginModal = document.getElementById('login-modal');
    this.loginProfileInput = document.getElementById('login-profile');
    this.loginPinInput = document.getElementById('login-pin');
    this.btnLogin = document.getElementById('btn-login');
    this.loginError = document.getElementById('login-error');
    this.btnLogout = document.getElementById('btn-logout');

    this.initLogin();
  }

  initLogin() {
    // ─── MODO HESTIA (localhost) ─────────────────────────────────
    // Solo desde localhost. Requiere profileId='hestia' + PIN.
    if (this.IS_LOCAL) {
      // Hestia siempre pide credenciales (no persistir en localStorage por seguridad)
      // Solo el profileId persiste, el PIN nunca toca localStorage
      const storedProfile = localStorage.getItem('eris-profile');
      if (storedProfile && storedProfile === this.HESTIA_ID && this.pin) {
        this.profileId = storedProfile;
        this.hideLogin();
        this.init();
        this.loadTheme();
        this.initModeSelector();
        this.connectWebSocket();
      } else {
        this.profileId = this.HESTIA_ID; // Forzar siempre el ID soberano
        localStorage.setItem('eris-profile', this.HESTIA_ID);
        this.showLoginHestia();
      }

      if (this.btnLogin) {
        this.btnLogin.addEventListener('click', () => {
          const pin = this.loginPinInput?.value?.trim();
          if (!pin) {
            this.loginError.textContent = 'El PIN soberano es requerido.';
            this.loginError.classList.remove('hidden');
            return;
          }
          this.pin = pin;
          sessionStorage.setItem('eris-pin', pin);
          this.loginError.classList.add('hidden');
          this.hideLogin();
          this.init();
          this.loadTheme();
          this.initModeSelector();
          this.connectWebSocket();
        });
      }

    // ─── MODO ERIS PÚBLICO (remoto) ───────────────────────────
    // Auto-genera credenciales únicas en el dispositivo.
    // El usuario nunca ve el profileId ni el PIN.
    } else {
      if (!this.profileId || this.profileId === this.HESTIA_ID) {
        // Generar identidad única persistente
        const uid = crypto.randomUUID().replace(/-/g,'').slice(0, 14);
        this.profileId = `user-${uid}`;
        const autoPin = crypto.randomUUID().replace(/-/g,'').slice(0, 12);
        this.pin = autoPin;
        localStorage.setItem('eris-profile', this.profileId);
        localStorage.setItem('eris-pin-enc', autoPin); // guardado local para persistencia
      } else {
        // Recuperar PIN guardado
        this.pin = localStorage.getItem('eris-pin-enc') || this.pin || '';
      }
      // Conectar directo, sin mostrar login
      this.hideLogin();
      this.init();
      this.loadTheme();
      this.initModeSelector();
      this.connectWebSocket();
    }

    if (this.btnLogout) {
      this.btnLogout.addEventListener('click', () => {
        localStorage.removeItem('eris-profile');
        sessionStorage.removeItem('eris-pin');
        localStorage.removeItem('eris-pin-enc');
        location.reload();
      });
    }
  }

  showLoginHestia() {
    if (this.loginModal) {
      this.loginModal.classList.remove('hidden');
      // Actualizar título para modo Hestia
      const title = this.loginModal.querySelector('.w-title');
      const subtitle = this.loginModal.querySelector('.w-subtitle');
      const profileInput = document.getElementById('login-profile');
      if (title) title.textContent = 'HESTIA';
      if (subtitle) subtitle.textContent = '🛡️ Acceso Soberano — Solo Localhost';
      if (profileInput) profileInput.style.display = 'none'; // ocultar, siempre será 'hestia'
      const btn = document.getElementById('btn-login');
      if (btn) btn.textContent = 'DESBLOQUEAR BÓVEDA SOBERANA';
    }
    const appEl = document.getElementById('app');
    if (appEl) appEl.classList.add('hidden');
  }

  showLogin() {
    if (this.loginModal) this.loginModal.classList.remove('hidden');
    const appEl = document.getElementById('app');
    if (appEl) appEl.classList.add('hidden');
  }

  hideLogin() {
    if (this.loginModal) this.loginModal.classList.add('hidden');
    const appEl = document.getElementById('app');
    if (appEl) appEl.classList.remove('hidden');
  }

  init() {
    if (!this.sendBtn || !this.inputEl) return;

    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.newChatBtn.addEventListener('click', () => this.newChat());
    
    // Enter para enviar (Shift+Enter para nueva línea)
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.inputEl.addEventListener('input', () => {
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 150) + 'px';
    });
    
    if (this.statusBtn) {
      this.statusBtn.addEventListener('click', () => {
        this.inputEl.value = "Eris, genera un Reporte de Estatus AXS de 360 grados.";
        this.sendMessage();
      });
    }

    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this.inputEl.value = chip.getAttribute('data-msg');
        this.sendMessage();
      });
    });

    // Keyboard shortcuts: Ctrl+1/2/3 para cambiar modo
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && !e.shiftKey) {
        if (e.key === '1') { e.preventDefault(); this.setMode('auto'); }
        if (e.key === '2') { e.preventDefault(); this.setMode('flash'); }
        if (e.key === '3') { e.preventDefault(); this.setMode('deep'); }
      }
    });

    this.checkStatus();
    // La conexión WS ahora la gestiona initLogin
  }

  // ─── Mode Selector ─────────────────────────────────────────

  initModeSelector() {
    const modeButtons = document.querySelectorAll('.mode-btn');
    modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');
        this.setMode(mode);
      });
    });
    // Set default
    this.setMode(this.currentMode);
  }

  setMode(mode) {
    this.currentMode = mode;
    // Update UI
    document.querySelectorAll('.mode-btn').forEach(btn => {
      const btnMode = btn.getAttribute('data-mode');
      btn.classList.toggle('active', btnMode === mode);
    });
    // Update accent glow color based on mode
    const color = MODE_COLORS[mode] || MODE_COLORS.auto;
    document.documentElement.style.setProperty('--mode-color', color);
    
    // Save preference
    localStorage.setItem('eris-mode', mode);

    // Hide indicator when mode changes
    if (this.modeIndicator) {
      this.modeIndicator.classList.add('hidden');
    }
  }

  showModeResolved(mode, model) {
    if (!this.modeIndicator) return;
    const icon = mode === 'flash' ? '⚡' : '🧠';
    const label = mode === 'flash' ? 'Flash' : 'Deep';
    this.modeIndicator.innerHTML = `${icon} ${label}`;
    this.modeIndicator.className = 'mode-indicator mode-resolved-' + mode;
    // Auto-hide after 4 seconds
    setTimeout(() => {
      this.modeIndicator.classList.add('fade-out');
      setTimeout(() => {
        this.modeIndicator.classList.add('hidden');
        this.modeIndicator.classList.remove('fade-out');
      }, 500);
    }, 4000);
  }

  // ─── Status & Connection ───────────────────────────────────

  async checkStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (this.ollamaDot) this.ollamaDot.className = 'dot ' + (data.ollama ? 'online' : '');
      if (this.ollamaLabel) this.ollamaLabel.textContent = data.ollama ? 'Soberana Conectada' : 'Eris Offline';
      if (data.tools && this.toolsList) {
        this.toolsList.innerHTML = data.tools.map(name =>
          `<div class="tool-item" onclick="window.eris.runDefaultTool('` + name + `')" title="` + name + `">
            ` + (TOOL_ICONS[name] || '🔧') + `
          </div>`
        ).join('');
      }
      // Set default mode from server if not saved locally
      if (!localStorage.getItem('eris-mode') && data.defaultMode) {
        this.setMode(data.defaultMode);
      }
    } catch (e) { console.error("Status check failed", e); }
  }

  runDefaultTool(name) {
    const commands = {
      vault_audit: "Eris, ejecuta una auditoría de salud de la boveda ahora.",
      log_management: "Eris, inicializa mi log diario de hoy.",
      system_info: "Eris, dime cómo están mis recursos (CPU/RAM/VRAM).",
      executive_report: "Eris, genera un Reporte de Estatus AXS completo.",
      bash: "Eris, haz un recuento total de archivos y tamaño de la boveda AXS."
    };
    this.inputEl.value = commands[name] || ("Eris, usa la herramienta " + name);
    this.sendMessage();
  }

  connectWebSocket() {
    if (!this.profileId) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Siempre lowercase el profileId antes de enviarlo
    const safeProfileId = this.profileId.toLowerCase();
    // PIN ya NO va en la URL — se envía como primer mensaje al recibir auth_required
    let params = `?profile=${encodeURIComponent(safeProfileId)}`;
    if (this.currentSessionId) params += `&session=${this.currentSessionId}`;

    this.ws = new WebSocket(protocol + '//' + location.host + '/ws' + params);
    this.ws.onmessage = (e) => this.handleServerMessage(JSON.parse(e.data));
    this.ws.onclose = () => {
      if (this.profileId) setTimeout(() => this.connectWebSocket(), 2000);
    };
  }

  // ─── Message Handling ──────────────────────────────────────

  handleServerMessage(data) {
    switch (data.type) {
      case 'auth_required':
        // El servidor pide autenticación — enviamos el PIN como mensaje, nunca en la URL
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          // En modo remoto el PIN viene de localStorage, en Hestia de sessionStorage
          const pin = this.IS_LOCAL
            ? (sessionStorage.getItem('eris-pin') || this.pin || '')
            : (localStorage.getItem('eris-pin-enc') || this.pin || '');
          this.ws.send(JSON.stringify({ type: 'auth', pin }));
        }
        break;
      case 'connected':
        if (data.recoveryKey) {
          alert(`¡IMPORTANTE! Bóveda creada exitosamente.\n\nGuarda esta Llave de Recuperación en un lugar seguro (ej. tu bóveda de Obsidian). Si olvidas tu PIN, esta es la ÚNICA forma de recuperar tus datos:\n\n${data.recoveryKey}\n\nNo se volverá a mostrar.`);
        }

        // Si se usó una llave de rescate para entrar, forzar cambio de PIN
        if (this.pin && /^[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$/i.test(this.pin)) {
          setTimeout(() => {
            const newPin = prompt("Has iniciado sesión con una Llave de Rescate.\n\nPor favor, ingresa tu NUEVO PIN para restaurar tu acceso:");
            if (newPin && newPin.trim() !== '') {
              this.ws.send(JSON.stringify({ type: "change_pin", newPin: newPin.trim() }));
              this.pin = newPin.trim();
              sessionStorage.setItem('eris-pin', this.pin);
              alert("PIN restablecido con éxito. Usa este nuevo PIN en tu próximo inicio de sesión.");
            }
          }, 500);
        }

        this.currentSessionId = data.sessionId;
        if (data.projects) this.projects = data.projects;
        if (data.conversations) this.renderConversations(data.conversations);
        if (data.history) this.loadHistory(data.history);
        const savedMode = localStorage.getItem('eris-mode');
        if (savedMode) {
          this.setMode(savedMode);
        } else if (data.defaultMode) {
          this.setMode(data.defaultMode);
        }
        break;
      case 'chat_switched':
        this.currentSessionId = data.sessionId;
        this.resetChat();
        if (data.conversations) this.renderConversations(data.conversations);
        if (data.history && data.history.length > 0) {
          this.loadHistory(data.history);
          const titleEl = document.getElementById('chat-title');
          if (titleEl) {
            const conv = (data.conversations || []).find(c => c.id === data.sessionId);
            if (titleEl) titleEl.textContent = conv ? conv.title : 'Sesión activa';
          }
        }
        break;
      case 'token':
        this.setProcessing(true);
        this.appendToken(data.content);
        break;
      case 'thinking_token':
        this.setProcessing(true);
        this.appendThinkingToken(data.content);
        break;
      case 'mode_resolved':
        // Auto mode resolved — show indicator
        if (this.currentMode === 'auto') {
          this.showModeResolved(data.mode, data.model);
        }
        break;
      case 'tool_call':
        this.addMessage('assistant', `<div class="tool-exec">🔧 Ejecutando <strong>` + data.name + `</strong>...</div>`);
        break;
      case 'tool_result':
        if (data.output) this.addMessage('assistant', data.output);
        break;
      case 'stream_end':
        this.finishStreaming(data.content, data.modeUsed);
        this.setProcessing(false);
        break;
      case 'error':
        if (data.message && data.message.includes('PIN')) {
          localStorage.removeItem('eris-profile');
          sessionStorage.removeItem('eris-pin');
          this.profileId = null;
          this.pin = null;
          if (this.ws) this.ws.close();
          this.showLogin();
          if (this.loginError) {
            this.loginError.textContent = data.message;
            this.loginError.classList.remove('hidden');
          }
        } else {
          this.addMessage('assistant', `❌ Error: ${data.message}`);
        }
        this.setProcessing(false);
        break;
      case 'thinking':
        this.setProcessing(true);
        break;
      case 'conversations_updated':
        if (data.projects) this.projects = data.projects;
        this.renderConversations(data.conversations);
        break;
      case 'project_created':
        this.projects = data.projects;
        break;
    }
  }

  sendMessage() {
    const text = this.inputEl.value.trim();
    if (!text || this.isProcessing || !this.ws) return;
    this.hideWelcome();
    this.addMessage('user', text);
    // Enviar con modo actual
    this.ws.send(JSON.stringify({ 
      type: 'message', 
      content: text,
      mode: this.currentMode,
    }));
    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    this.setProcessing(true);
  }

  // ─── Rendering ─────────────────────────────────────────────

  addMessage(role, content) {
    const msgEl = document.createElement('div');
    msgEl.className = "message message-" + role;
    msgEl.innerHTML = `<div class="msg-content">` + this.formatContent(content) + `</div>`;
    this.messagesEl.appendChild(msgEl);
    this.scrollToBottom();
  }

  appendToken(token) {
    if (this.thinkingBlockEl) this.finishThinking();
    if (!this.streamingEl) {
      const msgEl = document.createElement('div');
      msgEl.className = 'message message-assistant';
      msgEl.innerHTML = `<div class="msg-content"></div>`;
      this.messagesEl.appendChild(msgEl);
      this.streamingEl = msgEl.querySelector('.msg-content');
      this.streamingText = '';
    }
    this.streamingText += token;
    this.streamingEl.innerHTML = this.formatContent(this.streamingText);
    this.scrollToBottom();
  }

  appendThinkingToken(token) {
    if (!this.thinkingBlockEl) {
      const msgEl = document.createElement('div');
      msgEl.className = 'message message-assistant thinking-block';
      msgEl.innerHTML = `<div class="think-content-wrapper">
        <div class="think-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span>🧠 Pensando...</span> <span class="collapse-icon">▼</span>
        </div>
        <div class="think-body"></div>
      </div>`;
      this.messagesEl.appendChild(msgEl);
      this.thinkingBlockEl = msgEl.querySelector('.think-body');
      this.thinkingStartTime = Date.now();
    }
    const txt = this.thinkingBlockEl.textContent + token;
    this.thinkingBlockEl.textContent = txt;
    this.scrollToBottom();
  }

  finishThinking() {
    if (!this.thinkingBlockEl) return;
    const elapsed = Math.max(1, Math.round((Date.now() - this.thinkingStartTime) / 1000));
    const wrapper = this.thinkingBlockEl.parentElement;
    wrapper.classList.add('collapsed');
    const header = wrapper.querySelector('.think-header');
    header.innerHTML = `<span>🧠 Pensó por ${elapsed} segundos</span> <span class="collapse-icon">▼</span>`;
    this.thinkingBlockEl = null;
  }

  finishStreaming(finalContent, modeUsed) {
    if (this.thinkingBlockEl) this.finishThinking();

    // Si terminó el stream pero no se creó el elemento (ej: respuesta muy rápida o solo un chunk final)
    if (!this.streamingEl && finalContent) {
      this.appendToken(''); 
    }

    if (this.streamingEl) {
      const clean = (finalContent || this.streamingText).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      let html = this.formatContent(clean);
      
      // Añadir medalla de modo si fue Auto
      if (this.currentMode === 'auto' && modeUsed) {
        const icon = modeUsed === 'flash' ? '⚡' : '🧠';
        const label = modeUsed === 'flash' ? 'Flash' : 'Deep';
        html += `<span class="msg-mode-badge mode-badge-${modeUsed}">${icon} ${label}</span>`;
      }
      
      this.streamingEl.innerHTML = html;
      this.streamingEl = null;
      this.streamingText = '';
    }
    this.setProcessing(false);
  }

  formatContent(text) {
    if (!text) return '';
    let h = text;

    // 1. Bloques de código (antes de cualquier otra cosa)
    h = h.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const l = lang ? `<span class="code-lang">${lang}</span>` : '';
      return `<div class="code-block">${l}<pre><code>${code.trim()}</code></pre></div>`;
    });

    // 2. Tablas Markdown
    h = h.replace(/((?:^\|.+\|\n?)+)/gm, (tableBlock) => {
      const rows = tableBlock.trim().split('\n').filter(r => r.trim());
      if (rows.length < 2) return tableBlock;
      
      const headerCells = rows[0].split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim());
      const isSeparator = rows[1] && /^[\|\s\-:]+$/.test(rows[1]);
      if (!isSeparator) return tableBlock;

      const bodyRows = rows.slice(2);
      const thead = `<thead><tr>${headerCells.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
      const tbody = bodyRows.length ? `<tbody>${bodyRows.map(r => {
        const cells = r.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim());
        return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
      }).join('')}</tbody>` : '';
      return `<div class="table-wrapper"><table>${thead}${tbody}</table></div>`;
    });

    // 3. Headings
    h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // 4. Listas
    h = h.replace(/^(\s*[-*]) (.+)/gm, '<li>$2</li>');
    h = h.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

    // 5. Bold, italic, inline code
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
    h = h.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // 6. Saltos de línea (solo fuera de bloques HTML)
    h = h.replace(/\n(?!<)/g, '<br>');

    return h;
  }

  // ─── Theme & UI ────────────────────────────────────────────

  toggleTheme() {
    const isLux = document.body.classList.toggle('mode-lux');
    document.getElementById('theme-cyber').classList.toggle('active', !isLux);
    document.getElementById('theme-lux').classList.toggle('active', isLux);
    localStorage.setItem('eris-theme', isLux ? 'lux' : 'cyber');
  }

  loadTheme() {
    if (localStorage.getItem('eris-theme') === 'lux') this.toggleTheme();
  }

  renderConversations(convs) {
    if (!this.convList) return;
    const projects = this.projects || [];
    let html = '';

    // ─── PROYECTOS ───
    for (const proj of projects) {
      const projConvs = convs.filter(c => c.projectId === proj.id);
      const isOpen = localStorage.getItem(`proj-open-${proj.id}`) !== 'false';
      html += `
        <div class="project-folder" id="proj-${proj.id}">
          <div class="project-header" onclick="window.eris.toggleProject('${proj.id}')">
            <span class="proj-chevron ${isOpen ? 'open' : ''}">❯</span>
            <span class="proj-icon">${proj.emoji}</span>
            <span class="proj-name">${proj.name}</span>
            <button class="btn-assign" onclick="window.eris.newChatInProject('${proj.id}', event)" title="Nuevo chat aquí" style="margin-right: 4px;">+</button>
            <button class="btn-del" onclick="window.eris.deleteProject('${proj.id}', event)" title="Eliminar proyecto">×</button>
          </div>
          <div class="project-chats" style="display:${isOpen ? 'block' : 'none'}">
            ${projConvs.length === 0 
              ? '<div class="proj-empty">Sin chats</div>' 
              : projConvs.map(c => this.renderConvItem(c, true)).join('')}
          </div>
        </div>`;
    }

    // ─── SIN PROYECTO ───
    const orphans = convs.filter(c => !c.projectId);
    if (orphans.length > 0) {
      html += orphans.map(c => this.renderConvItem(c, false)).join('');
    }

    // Botón + Nuevo Proyecto
    html += `<button class="btn-new-project" onclick="window.eris.createProject()">+ Nuevo Proyecto</button>`;

    this.convList.innerHTML = html;
  }

  renderConvItem(c, inProject) {
    const actions = (this.projects || []).length > 0
      ? `<button class="btn-assign" onclick="window.eris.showAssignMenu('${c.id}', event)" title="Mover a proyecto">⦿</button>`
      : '';
    return `<div class="conv-item ${c.id === this.currentSessionId ? 'active' : ''} ${inProject ? 'in-project' : ''}" onclick="window.eris.switchChat('${c.id}')">
      <span class="conv-label">💬 ${c.title}</span>
      <div class="conv-actions">
        ${actions}
        <button class="btn-del" onclick="window.eris.deleteChat('${c.id}', event)" title="Eliminar">×</button>
      </div>
    </div>`;
  }

  toggleProject(projectId) {
    const chats = document.querySelector(`#proj-${projectId} .project-chats`);
    const chevron = document.querySelector(`#proj-${projectId} .proj-chevron`);
    const isOpen = chats.style.display !== 'none';
    chats.style.display = isOpen ? 'none' : 'block';
    chevron.classList.toggle('open', !isOpen);
    localStorage.setItem(`proj-open-${projectId}`, String(!isOpen));
  }

  createProject() {
    const name = prompt('📁 Nombre del proyecto:');
    if (!name || !name.trim()) return;
    const emoji = prompt('🌟 Emoji (opcional, Enter para 📁):', '📁') || '📁';
    if (this.ws) this.ws.send(JSON.stringify({ type: 'create_project', name: name.trim(), emoji }));
  }

  deleteProject(projectId, event) {
    if (event) event.stopPropagation();
    if (confirm('¿Eliminar este proyecto? Los chats no se borrarán.')) {
      if (this.ws) this.ws.send(JSON.stringify({ type: 'delete_project', projectId }));
    }
  }

  showAssignMenu(convId, event) {
    event.stopPropagation();
    const existing = document.getElementById('assign-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'assign-menu';
    menu.className = 'assign-menu';
    const projects = this.projects || [];
    menu.innerHTML = [
      `<div class="assign-item" onclick="window.eris.assignToProject('${convId}', null)">Sin proyecto</div>`,
      ...projects.map(p => `<div class="assign-item" onclick="window.eris.assignToProject('${convId}', '${p.id}')">${p.emoji} ${p.name}</div>`)
    ].join('');

    const rect = event.target.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 50);
  }

  assignToProject(convId, projectId) {
    if (this.ws) this.ws.send(JSON.stringify({ type: 'assign_to_project', conversationId: convId, projectId }));
  }

  deleteChat(id, event) {
    if (event) event.stopPropagation();
    if (confirm('¿Confirmas la purga permanente de esta sesión?')) {
      if (this.ws) this.ws.send(JSON.stringify({ type: 'delete_chat', conversationId: id }));
    }
  }

  switchChat(id) { if (this.ws) this.ws.send(JSON.stringify({ type: 'switch_chat', conversationId: id })); }
  newChat() { if (this.ws) this.ws.send(JSON.stringify({ type: 'new_chat' })); }
  newChatInProject(projectId, event) {
    if (event) event.stopPropagation();
    if (this.ws) this.ws.send(JSON.stringify({ type: 'new_chat', projectId }));
  }
  setProcessing(p) { 
    this.isProcessing = p; 
    if (this.sendBtn) this.sendBtn.disabled = p; 
    if (this.thinkingEl) this.thinkingEl.classList.toggle('hidden', !p); 
    if (this.inputWrapper) this.inputWrapper.classList.toggle('processing', p);
  }
  hideWelcome() {
    if (this.welcomeEl) this.welcomeEl.classList.add('hidden');
    const h = document.getElementById('chat-header');
    if (h) h.classList.remove('hidden');
  }
  scrollToBottom() { requestAnimationFrame(() => { this.messagesEl.scrollTop = this.messagesEl.scrollHeight; }); }
  loadHistory(h) {
    this.hideWelcome();
    this.messagesEl.innerHTML = '';
    h.forEach(m => {
      const clean = (m.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (clean) this.addMessage(m.role, clean);
    });
  }
  resetChat() {
    this.messagesEl.innerHTML = '';
    if (this.welcomeEl) this.welcomeEl.classList.remove('hidden');
    const h = document.getElementById('chat-header');
    if (h) h.classList.add('hidden');
    this.setProcessing(false);
  }

  // ─── Sidebar Móvil ──────────────────────────────────────
  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar) return;
    const isOpen = sidebar.classList.contains('open');
    if (isOpen) {
      sidebar.classList.remove('open');
      overlay?.classList.remove('visible');
    } else {
      sidebar.classList.add('open');
      overlay?.classList.add('visible');
    }
  }

  closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar?.classList.remove('open');
    overlay?.classList.remove('visible');
  }
}

window.addEventListener('DOMContentLoaded', () => { window.eris = new ErisApp(); });
