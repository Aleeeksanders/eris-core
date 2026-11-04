// El proceso del modelo se cae antes de responder («HTTP 500: EOF»): se reintenta una vez, no más (banco 2026-11-04)
import { test, expect } from "bun:test";
import { OllamaProvider } from "C:/Proyectos/eris/src/services/llm/OllamaProvider.ts";

const ok = () => new Response(JSON.stringify({ message: { content: "Hola, ¿qué vas a cocinar?" }, done: true }), { status: 200, headers: { "Content-Type": "application/json" } });
const eof = () => new Response(JSON.stringify({ error: "EOF" }), { status: 500 });

test("un EOF y después responde: la persona recibe la respuesta", async () => {
  const orig = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async () => (++n === 1 ? eof() : ok())) as any;
  try {
    const r = await new OllamaProvider().generate([{ role: "user", content: "Voy a hacer la cena" }] as any, [], { contextLength: 4096 } as any);
    expect(r.content).toContain("cocinar");
    expect(n).toBe(2);
  } finally { globalThis.fetch = orig; }
});

test("dos EOF seguidos: error (no reintenta para siempre); un 400 no se reintenta", async () => {
  const orig = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async () => { n++; return eof(); }) as any;
  try {
    await expect(new OllamaProvider().generate([{ role: "user", content: "x" }] as any, [], { contextLength: 4096 } as any)).rejects.toThrow(/EOF/);
    expect(n).toBe(2);
    n = 0;
    globalThis.fetch = (async () => { n++; return new Response("bad", { status: 400 }); }) as any;
    await expect(new OllamaProvider().generate([{ role: "user", content: "x" }] as any, [], { contextLength: 4096 } as any)).rejects.toThrow(/400/);
    expect(n).toBe(1);
  } finally { globalThis.fetch = orig; }
});
