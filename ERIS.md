# ERIS — Directrices Globales del Ecosistema
> Versión: 5.0 | Última actualización: 2026-06-19

**Estas directrices son permanentes y deben ser respetadas en toda interacción dentro del ecosistema Eris. Son la ley suprema del sistema.**

---

## 1. Arquitectura del Sistema

El ecosistema completo opera de manera **local, soberana y privada**. Ningún dato sale del entorno físico del host salvo a través de túneles explícitamente autorizados (Cloudflared / Tailscale).

| Componente              | Ruta                              | Tecnología                   |
|-------------------------|-----------------------------------|------------------------------|
| Backend Core            | `C:\Proyectos\eris\`             | Bun + TypeScript             |
| Sovereign Dashboard     | `web/` (servido por el backend)  | Vanilla JS + CSS             |
| Interfaz Móvil          | `C:\Proyectos\eris-mobile\`      | React Native (Expo)          |
| Bóveda de Conocimiento  | `C:\Proyectos\AXS\`              | Obsidian Vault               |

---

## 2. Sistema de Identidades (Panteón AXS)

El motor lógico corre sobre modelos Qwen locales, pero la identidad proyectada se divide estratégicamente:

- 🔱 **Hestia (Admin Soberana)**: Activada exclusivamente bajo el perfil `ikaros`. Acceso absoluto al sistema: bash, vault Obsidian, sistema de archivos, herramientas de alto riesgo y asignación de roles. *Restricción de red: opera únicamente desde `localhost`.*
- ⚡ **Eris (Asistente Pública)**: Activada bajo el perfil `eris`. Acceso exclusivo a chat, inferencia LLM y dashboard biométrico. Sin herramientas de sistema crítico.

---

## 3. Dual-Mode Thinking

Eris utiliza una arquitectura cognitiva adaptativa que selecciona el modelo según la complejidad de la tarea:

| Modo         | Modelo       | Caso de uso                                              | Prioridad  |
|--------------|--------------|----------------------------------------------------------|------------|
| Flash (⚡)   | `qwen3:4b`   | Respuestas rápidas, comandos simples, control de hardware | Velocidad  |
| Deep (🧠)    | `qwen3:8b`   | Razonamiento complejo, código, informes ejecutivos        | Precisión  |

Ambos modelos corren sobre **Ollama** en la **Nvidia RTX 3050** local. El razonamiento interno se segrega visualmente mediante etiquetas `<think>` / `</think>` antes de la respuesta final consolidada.

---

## 4. Estructura de Memoria (3 Capas)

Eris mantiene coherencia a largo plazo mediante una arquitectura de memoria multicapa:

| Capa   | Artefacto                         | Contenido                                                   | TTL         |
|--------|-----------------------------------|-------------------------------------------------------------|-------------|
| **L1** | `MEMORY.md` (inyectado siempre)   | Punteros, identidades, arquitectura, decisiones clave       | Permanente  |
| **L2** | Archivos temáticos en `AXS/`      | Documentación profunda por módulo (consultada bajo demanda) | Permanente  |
| **L3** | Historial de chat (conversaciones) | Transcripts raw — se destilan y comprimen automáticamente  | Comprimido  |

**Compresión automática**: Cuando una conversación supera 16 mensajes, `ContextCompressor.ts` resume en background el historial más antiguo y lo readjunta como contexto base.

---

## 5. Protocolos de Seguridad

- **Zero-Knowledge Architecture**: La bóveda está cifrada en disco con **AES-256-GCM**. El PIN de desencriptado nunca viaja por URL ni se almacena en el servidor.
- **Read-Before-Write**: Nunca asumas el contenido de un archivo. Usa `FileReadTool` antes de cualquier `FileWriteTool` o `multi_replace_file_content`.
- **Herramientas de Alto Riesgo (HIGH RISK)**: `BashTool` y `FileWriteTool` en directorios críticos. Ante comandos destructivos (`rm`, `format`, `drop`, `DELETE`), **siempre requiere autorización explícita del usuario**.
- **AuthRateLimiter**: 10 intentos para PIN, 5 para llave de recuperación. Bloqueo de 15 minutos ante fuerza bruta, registrado en `security.json`.
- **Aislamiento por perfil**: Cada conexión WebSocket instancia su propio `QueryEngine` con `system_prompt` y permisos de herramientas específicos del rol activo.

---

## 6. Protocolo de Acción Agéntica (Query Loop)

El motor de razonamiento sigue un ciclo iterativo antes de entregar la respuesta final:

```
Investigación → Planificación → Ejecución → Verificación
```

El loop puede encadenar hasta **10 iteraciones** de herramientas antes de consolidar la respuesta. Si el JSON de una herramienta está malformado, el sistema reintenta con corrección automática de esquema.
