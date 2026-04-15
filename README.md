# Eris Core — Artificial eXperience System (AXS)

Eris es la operadora central (Sistema Nervioso) del ecosistema AXS. Construida como un motor agéntico 100% autónomo y local, Eris actúa como el enrutador físico y lógico entre el entorno del host (hardware de biotelemetría, laptop, web) y la capa analítica superior de conciencia narrativa.

## ¿Qué busca cumplir Eris?
1. **Delegación Total del Cómputo Cansado:** Ejecuta análisis de terminal, llamadas a herramientas complejas, recuperación de datos web y manipulación del sistema de archivos local.
2. **Razonamiento Transparente:** Utiliza modelos LLM locales (Qwen) estructurados mediante `<think>` tags para segregar el razonamiento analítico pesado de la respuesta conversacional liviana.
3. **Gestor Biométrico y Perceptual:** Sirve como la interfaz puente para la red `Ghost` (GhostWatch / GhostRing). Es capaz de recibir inputs físicos de sensores periféricos y comunicarlos al entorno computacional.

## Dicotomía Arquitectónica: Eris vs Lander
Dentro del macro-proyecto AXS, la carga computacional está separada por diseño bajo la arquitectura **Teoría de Tensión Estructural Narrativa (TSN)**:
- **Eris (Este Repositorio):** Es el manager de operaciones. Trabaja en la "capa sucia" (puertos lógicos, WebSockets, Bash, Parseo de JSON, y comunicaciones). Garantiza tiempo real y cero latencia.
- **Lander (Conciencia Artificial - Desacoplado):** Recibe los estados latentes procesados matemáticamente por Eris. Eris le suministra a Lander el mundo; Lander decide el significado narrativo del mismo.

## Stack Técnico Base
- **Runtime:** `Bun` (para velocidad nativa en Backend y WebSockets).
- **Lenguaje:** `TypeScript` puro.
- **Pila Móvil:** (En el repo `eris-mobile`) App Nativo React Native que actúa como I/O Dashboard remoto interconectado directo a este Cerebro Local.

## Cómo Iniciar el Servicio (Eris Core)
Para levantar el servidor WebSocket de Eris y la inferencia (Olla + Qwen) en tu máquina local:

```bash
bun install
bun run gui
```
Esto abrirá el motor en `http://localhost:3000` y quedará escuchando peticiones de la Web, de tu Terminal y de la futura App Móvil.

### Generación de Fine-Tuning
Para poblar el cerebro de aprendizaje (Lander):
```bash
bun run dataset:seed       # Genera diálogos semilla
bun run dataset:export     # Exporta a formato ChatML (Unsloth)
```

---
*"La IA personal de Alex. Diseñada para traer orden al caos, generando su propio caos en el proceso."*
