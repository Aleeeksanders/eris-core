# ⚡ Eris Core — AXS Sovereign Intelligence OS

> *"Diseñada para traer orden al caos, generando su propio caos en el proceso."*

**Eris** es el núcleo operativo del ecosistema **AXS (Artificial eXperience System)**. Actúa como Jefa de Gabinete Soberana: toma órdenes, orquesta módulos especializados y presenta resultados. Todo el procesamiento ocurre en local, garantizando soberanía de datos absoluta y tolerancia nula a fallos de conectividad externa.

---

## 🏛️ Posición en el Panteón AXS

```
AXS (Ecosistema)
 └── Eris ← Tú estás aquí
      ├── Eris.Core   — Motor de decisiones, routing y permisos (brainstem)
      └── Eris.Memory — Memoria persistente, historial contextual, perfil longitudinal
```

El ecosistema se manifiesta a través de dos identidades según el perfil de acceso:

| Perfil     | Identidad   | Acceso                                                                              |
|------------|-------------|-------------------------------------------------------------------------------------|
| `ikaros`   | 🔱 **Hestia** | Admin Soberana. Acceso absoluto: bash, vault Obsidian, sistema de archivos, roles. Solo opera desde `localhost`. |
| `eris`     | ⚡ **Eris**   | Asistente pública. Chat, inferencia LLM y dashboard biométrico.                    |

---

## 🧠 Arquitectura Cognitiva (Dual-Mode Thinking)

El sistema adapta su capacidad cognitiva dinámicamente mediante **Thinking Modes**:

- **Flash Mode (⚡)** — `qwen3:4b`: Respuestas instantáneas, comandos simples, control de hardware. Prioridad: **Velocidad**.
- **Deep Mode (🧠)** — `qwen3:8b`: Razonamiento complejo, análisis de código, informes ejecutivos. Prioridad: **Precisión**.

Ambos modelos corren sobre **Ollama** y están optimizados para la **Nvidia RTX 3050** del sistema host. La UI distingue visualmente los "tokens de pensamiento" (`<think>`) de la respuesta final.

---

## ⚙️ Stack Técnico

| Capa               | Tecnología                                          |
|--------------------|-----------------------------------------------------|
| Runtime            | **Bun** (velocidad nativa, TypeScript puro)         |
| LLM                | **Ollama** → `OllamaProvider.ts` (abstraído vía `LLMProvider.ts`) |
| Servidor           | **WebSocket** (streaming token a token) + HTTP      |
| Seguridad          | **AES-256-GCM** (vault cifrada) + `AuthRateLimiter` |
| Memoria            | JSON + Markdown (`MEMORY.md`) → Transición a SQLite |
| Bóveda             | **Obsidian Vault** `C:\Proyectos\AXS\`              |

---

## 🛠️ Sistema de Herramientas (Agentic Tooling)

Eris posee un `ToolRegistry` que le otorga agencia sobre el sistema operativo, la red y su propia memoria:

**Sistema de Archivos & OS:**
- `BashTool` — Ejecución de comandos PowerShell/Bash.
- `FileReadTool` / `FileWriteTool` — Lectura y modificación granular de archivos.
- `SystemInfoTool` — Métricas de hardware y OS.
- `OpenTool` — Apertura de archivos o URLs en la aplicación nativa.

**Análisis y Conocimiento:**
- `WebSearchTool` — Búsqueda autónoma en internet.
- `CrystallizeTool` — Destilación y compresión de información extensa.
- `ExecutiveReportTool` — Generación de informes estructurados al Sovereign Dashboard.
- `LogManagementTool` — Inspección y análisis de logs del sistema.

**Integración Obsidian (AXS Vault):**
- `KnowledgeTool` — Consulta semántica/directa de la bóveda de conocimiento.
- `VaultAuditTool` — Auditoría de salud (enlaces rotos, metadatos).
- `VaultHealerTool` — Auto-reparación autónoma de la bóveda.

**Salud y Biometría:**
- `GlucoTool` — Integración GlucoTrack: glucosa en tiempo real, log de alimentos, predicciones metabólicas.
- `NutritionTool` — Búsqueda de alimentos por nombre o código de barras (FatSecret API).

---

## 🔒 Seguridad Zero-Knowledge

- **Vault cifrada en disco** con AES-256-GCM. El PIN nunca viaja por URL ni se almacena en el servidor.
- **Aislamiento por perfil**: Cada conexión instancia su propio `QueryEngine` aislado con su propio `system_prompt`.
- **AuthRateLimiter**: 10 intentos para PIN, 5 para llave de recuperación. Bloqueo de 15 min ante fuerza bruta.
- **Restricción de red**: Hestia opera *exclusivamente* desde `localhost`.

---

## 🗂️ Estructura del Proyecto

```
eris/
├── src/
│   ├── server.ts            # Servidor HTTP + WebSocket (punto de entrada GUI)
│   ├── QueryEngine.ts       # Motor de razonamiento e inferencia agéntica
│   ├── memory.ts            # Sistema de memoria y persistencia
│   ├── context.ts           # Gestión de contexto de conversaciones
│   ├── Tool.ts              # Interfaz base del ToolRegistry
│   ├── services/
│   │   ├── llm/             # LLMProvider + OllamaProvider
│   │   ├── security/        # CryptoService, RoleManager, AuthRateLimiter
│   │   ├── vault/           # VaultService (integración Obsidian)
│   │   ├── ContextCompressor.ts
│   │   └── EmailService.ts
│   ├── tools/               # BashTool, GlucoTool, KnowledgeTool, etc.
│   ├── ui-ink.ts            # CLI (interfaz Ink/React)
│   └── ui-readline.ts       # CLI (interfaz readline)
├── web/                     # Sovereign Dashboard (Vanilla JS + CSS)
├── data/                    # Prompts del sistema (hestia.md, system-prompt.md)
├── scripts/                 # Generación y exportación de datasets (fine-tuning)
└── ERIS.md                  # Directrices globales del ecosistema
```

---

## 🚀 Cómo Iniciar

### Sovereign Dashboard (GUI Web)
```bash
bun install
bun run gui
```
Abre el motor en `http://localhost:3000` sirviendo el Sovereign Dashboard y escuchando WebSocket desde la app móvil y el navegador.

### CLI (Terminal)
```bash
bun run dev   # Interfaz readline interactiva
```

### Generación de Dataset (Fine-Tuning)
```bash
bun run dataset:seed    # Genera diálogos semilla
bun run dataset:export  # Exporta a formato ChatML (Unsloth)
```

---

## 🔗 Ecosistema Relacionado

| Repositorio       | Descripción                                              |
|-------------------|----------------------------------------------------------|
| `eris-mobile`     | App React Native — Dashboard Ejecutivo móvil             |
| `AXS` (Vault)     | Bóveda Obsidian — Memoria de largo plazo y conocimiento  |
