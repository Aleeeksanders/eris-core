# Pruebas de Eris (servidor y lo que cruza app ↔ servidor)

Todas, con un comando (desde `eris/` o `eris-mobile/`):

    bun run pruebas            # las dos carpetas: eris/tests y eris-mobile/tests
    bun run pruebas finance    # solo los archivos cuyo nombre calce

- Cada archivo corre aparte, con un HOME aislado y nuevo (cuentas de prueba de `scripts/chat_eval/setup.ts`) y el reloj de Chile.
- `revision_*`: lo de la revisión exhaustiva (2026-10-30 → 11-04), un archivo por fase.
- `rutas.ts`: arnés de enrutamiento (todas las herramientas reales, memoria y modelo falsos).
- `fixtures/`: datos de ejemplo (boletas para el lector de boletas).

Aparte:
- `bun scripts/rutas/rutas_check.ts`: 32 frases → la herramienta que debe tomarlas (sin modelo, en segundos). Correrlo cada vez que se toque el enrutador o un atajo.
- `scripts/chat_eval`: el banco de chat con el modelo real (Ollama arriba).
- `scripts/*_parity_test.ts` y `scripts/sync_*`: los núcleos copiados de la app son idénticos y dan lo mismo.
