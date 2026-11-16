// Hestia por voz (J1, 2026-11-16): lo que se dice (Hablar), los trozos (CortadorFrases) y una llamada (VozSesion), sin modelo ni Piper.
import { test, expect } from "bun:test";
import { paraHablar, numeroEnPalabras, horaEnPalabras } from "C:/Proyectos/eris/src/services/voz/Hablar.ts";
import { CortadorFrases } from "C:/Proyectos/eris/src/services/voz/CortadorFrases.ts";
import { VozSesion } from "C:/Proyectos/eris/src/services/voz/VozSesion.ts";

test("cifras, plata, horas y unidades dichas bien (el modelo las escribe en números)", () => {
  expect(numeroEnPalabras(45196)).toBe("cuarenta y cinco mil ciento noventa y seis");
  expect(numeroEnPalabras(21000)).toBe("veintiún mil");
  expect(numeroEnPalabras(1000000)).toBe("un millón");
  expect(numeroEnPalabras(21, true)).toBe("veintiún");
  expect(horaEnPalabras(21, 10)).toBe("las nueve y diez de la noche");
  expect(horaEnPalabras(13, 30)).toBe("la una y media de la tarde");
  expect(paraHablar("Te quedan **$45.196** para la quincena 💸.")).toBe("Te quedan cuarenta y cinco mil ciento noventa y seis pesos para la quincena.");
  expect(paraHablar("La presentación es a las 10:00.")).toBe("La presentación es a las diez de la mañana.");
  expect(paraHablar("Te faltan 2,8 L.")).toBe("Te faltan dos coma ocho litros.");
  expect(paraHablar("Almorzaste 606 kcal y 201 calorías más.")).toBe("Almorzaste seiscientas seis calorías y doscientas una calorías más.");
  expect(paraHablar("31 g de proteína, 1 h de entreno.")).toBe("treinta y un gramos de proteína, una hora de entreno.");
  expect(paraHablar("- Huevo: +7 g · ~$190\n- ½ lata de jurel")).toBe("Huevo: más siete gramos, unos ciento noventa pesos. media lata de jurel.");
  expect(paraHablar("AXS va al 75% [Opción: Ver más]")).toBe("a equis ese va al setenta y cinco por ciento.");
  expect(paraHablar("🍽️")).toBe("");
});

test("los trozos: el primero cuanto antes, sin cortar cifras ni después de una palabra de enlace", () => {
  const trozos = (txt: string) => { const c = new CortadorFrases(); const out: string[] = []; for (const tok of txt.match(/\S+\s*|\s+/g)!) out.push(...c.push(tok)); return [...out, ...c.flush()]; };
  expect(trozos("Mira, si dormiste mal, mejor una sesión ligera. Mañana vemos.")).toEqual(["Mira,", "si dormiste mal, mejor una sesión ligera.", "Mañana vemos."]);
  expect(trozos("Te faltan 2,8 L de agua. Vas bien.")).toEqual(["Te faltan 2,8 L de agua.", "Vas bien."]);
  expect(trozos("Mañana tienes la presentación con Brian a las 10:00 y después el plan.")[0]).toBe("Mañana tienes la presentación con Brian a las 10:00");
  expect(trozos("Tienes:\n- Reunión con Brian\n- Plan de compra")).toEqual(["Tienes:", "- Reunión con Brian", "- Plan de compra"]);
});

/** Una llamada de prueba: el motor y Piper falsos, con su propio ritmo */
function llamada(respuestas: Array<{ tokens?: string[]; content?: string; msPorToken?: number }>) {
  const enviados: any[] = [];
  let i = 0;
  const s = new VozSesion({
    generar: async (_t, onToken, signal) => {
      const r = respuestas[i++];
      let txt = "";
      for (const tok of r.tokens ?? []) {
        if (signal.aborted) return { content: txt, stopped: true };
        await new Promise((res) => setTimeout(res, r.msPorToken ?? 1));
        txt += tok; onToken(tok);
      }
      return { content: r.content ?? txt, quick: !r.tokens };
    },
    sintetizar: async (texto) => { await new Promise((res) => setTimeout(res, 5)); return Buffer.from(texto); },
    enviar: (m) => enviados.push(m),
  });
  return { s, enviados };
}

test("una llamada: los audios salen en orden, numerados y dichos con palabras", async () => {
  const { s, enviados } = llamada([{ tokens: ["Claro, ", "te ", "quedan ", "$45.196 ", "hasta ", "la ", "quincena. ", "Vas ", "bien."] }]);
  const r = await s.turno("¿me alcanza la plata?");
  expect(r?.respuesta).toBe("Claro, te quedan $45.196 hasta la quincena. Vas bien.");
  const audios = enviados.filter((m) => m.type === "voz_audio");
  expect(audios.map((a) => a.seq)).toEqual([1, 2, 3]);
  expect(Buffer.from(audios[1].wav, "base64").toString()).toBe("te quedan cuarenta y cinco mil ciento noventa y seis pesos hasta la quincena.");
  expect(enviados.at(-1)).toMatchObject({ type: "voz_fin", turno: 1 });
  expect(typeof r?.primerAudioMs).toBe("number");
});

test("cortar a mitad: no sale nada más de ese turno, y el siguiente turno sigue normal", async () => {
  const { s, enviados } = llamada([
    { tokens: Array.from({ length: 40 }, (_, k) => `palabra${k} `).concat(["fin."]), msPorToken: 5 },
    { tokens: ["Dale, ", "te ", "escucho."] },
  ]);
  const p = s.turno("cuéntame algo largo");
  await new Promise((res) => setTimeout(res, 60));
  s.cortar();
  expect(await p).toBeNull();
  const antes = enviados.length;
  await new Promise((res) => setTimeout(res, 80));
  expect(enviados.length).toBe(antes); // nada del turno cortado después de cortar
  const r = await s.turno("oye, para");
  expect(r?.respuesta).toBe("Dale, te escucho.");
  const t2 = enviados.filter((m) => m.turno === 2 || m.turno === 3);
  expect(t2.every((m) => m.turno === 3)).toBe(true);
  expect(enviados.at(-1)).toMatchObject({ type: "voz_fin", turno: 3 });
});

test("una respuesta que no vino por tokens (un atajo por código) se dice entera si es corta, y lo esencial si es larga", async () => {
  const largo = Array.from({ length: 12 }, (_, k) => `- Pendiente número ${k + 1} con algo de detalle para revisar.`).join("\n");
  const { s, enviados } = llamada([{ content: "Llevas 1,1 L de agua." }, { content: `Tu agenda:\n${largo}` }]);
  await s.turno("¿cuánta agua llevo?");
  expect(enviados.filter((m) => m.type === "voz_audio").map((a) => Buffer.from(a.wav, "base64").toString())).toEqual(["Llevas uno coma uno litros de agua."]);
  await s.turno("¿qué tengo hoy?");
  const dichos = enviados.filter((m) => m.type === "voz_audio" && m.turno === 2).map((a) => Buffer.from(a.wav, "base64").toString());
  expect(dichos.at(-1)).toBe("Te dejé el detalle en la pantalla.");
  expect(enviados.some((m) => m.type === "voz_detalle" && m.turno === 2)).toBe(true);
  expect(dichos.join(" ").split(/\s+/).length).toBeLessThan(90);
});

test("mientras corre una herramienta suena una muletilla (una vez, si en un rato no hay nada que decir)", async () => {
  const enviados: any[] = [];
  let s!: VozSesion;
  s = new VozSesion({
    generar: async (_t, onToken) => {
      s.herramienta(); s.herramienta(); // el motor llama una herramienta (dos veces)
      await new Promise((r) => setTimeout(r, 30));
      onToken("Listo, "); onToken("ya está anotado.");
      return { content: "Listo, ya está anotado." };
    },
    sintetizar: async (t) => Buffer.from(t),
    muletilla: async () => ({ wav: Buffer.from("Dame un segundo."), texto: "Dame un segundo." }),
    esperaMuletillaMs: 10,
    enviar: (m) => enviados.push(m),
  });
  await s.turno("anota un huevo");
  const audios = enviados.filter((m) => m.type === "voz_audio");
  expect(audios.map((a) => a.texto)).toEqual(["Dame un segundo.", "Listo,", "ya está anotado."]);
  expect(audios.map((a) => a.seq)).toEqual([1, 2, 3]);
  expect(audios[0].muletilla).toBe(true);
});

test("la muletilla no suena si la respuesta llega antes (un atajo por código)", async () => {
  const enviados: any[] = [];
  let s!: VozSesion;
  s = new VozSesion({
    generar: async () => { s.herramienta(); return { content: "Llevas 1,1 L de agua." }; },
    sintetizar: async (t) => Buffer.from(t),
    muletilla: async () => ({ wav: Buffer.from("Dame un segundo."), texto: "Dame un segundo." }),
    esperaMuletillaMs: 50,
    enviar: (m) => enviados.push(m),
  });
  await s.turno("¿cuánta agua llevo?");
  await new Promise((r) => setTimeout(r, 80));
  expect(enviados.filter((m) => m.type === "voz_audio").map((a) => a.texto)).toEqual(["Llevas 1,1 L de agua."]);
});

// ─── J2 (2026-11-16): las manos de Hestia por voz ───
import { claseAprobacion, soloMira, respuestaSiNo, preguntaHablada, comandoDe } from "C:/Proyectos/eris/src/services/voz/AprobacionVoz.ts";
import { esencial } from "C:/Proyectos/eris/src/services/voz/VozSesion.ts";
import { respuestaDirecta } from "C:/Proyectos/eris/src/services/voz/Directas.ts";

const pedido = (p: Partial<{ tool: string; title: string; detail: string; risk: "normal" | "high"; flags: string[] }>) =>
  ({ tool: "bash", title: "Ejecutar un comando en tu PC", detail: "", risk: "normal" as const, flags: [] as string[], ...p });

test("qué se aprueba por voz: lo seguro sí; lo riesgoso tocando; borrar o lo que no se deshace, nunca por voz", () => {
  expect(claseAprobacion(pedido({ detail: "Get-Process | Sort-Object WS -Descending | Select-Object -First 5" }))).toBe("voz");
  expect(claseAprobacion(pedido({ tool: "open", title: "Abrir un enlace en el navegador", detail: "https://www.youtube.com" }))).toBe("voz");
  expect(claseAprobacion(pedido({ tool: "vault_note", title: "Crear una nota en la bóveda AXS", flags: ["modifica otra nota"] }))).toBe("voz");
  expect(claseAprobacion(pedido({ tool: "crystallize", title: "Guardar una decisión en la bóveda AXS", flags: ["modifica el Índice del Feed"] }))).toBe("voz");
  expect(claseAprobacion(pedido({ detail: "Remove-Item C:\\x.txt", risk: "high", flags: ["borra archivos"] }))).toBe("nunca_voz");
  expect(claseAprobacion(pedido({ tool: "file_write", title: "Sobrescribir un archivo", risk: "high", flags: ["sobrescribe un archivo existente"] }))).toBe("nunca_voz");
  expect(claseAprobacion(pedido({ tool: "vault_healer", title: "Reparar la bóveda AXS", flags: ["modifica muchos archivos"] }))).toBe("nunca_voz");
  expect(claseAprobacion(pedido({ detail: "Stop-Process -Name chrome", risk: "high", flags: ["detiene procesos o servicios"] }))).toBe("nunca_voz");
  expect(claseAprobacion(pedido({ detail: "iwr https://x.y", risk: "high", flags: ["usa la red (descarga o envía datos)"] }))).toBe("tarjeta");
  expect(claseAprobacion(pedido({ tool: "open", title: "Ejecutar un programa o script", risk: "high", flags: ["es un ejecutable o script: abrirlo corre código"] }))).toBe("tarjeta");
  // sin señales de riesgo pero corre algo que no solo mira
  expect(claseAprobacion(pedido({ detail: "python script.py" }))).toBe("tarjeta");
  expect(claseAprobacion(pedido({ detail: "Get-ChildItem | ForEach-Object { $_.Delete() }" }))).toBe("tarjeta");
  expect(claseAprobacion(pedido({ tool: "otra", title: "Ejecutar otra", risk: "normal" }))).toBe("tarjeta");
});

test("comandos que solo miran (conservador)", () => {
  expect(soloMira("Get-Date")).toBe(true);
  expect(soloMira("Get-ChildItem C:\\Users\\x\\Desktop | Select-Object Name")).toBe(true);
  expect(soloMira("Get-Process | Where-Object { $_.WS -gt 100MB }")).toBe(true);
  expect(soloMira("Get-Process; Remove-Item x")).toBe(false);
  expect(soloMira("Get-Content x.txt > y.txt")).toBe(false);
  expect(soloMira("[System.IO.File]::Delete('x')")).toBe(false);
  expect(soloMira("Get-Process | Stop-Process")).toBe(false);
  expect(soloMira("$a = 1")).toBe(false);
  expect(comandoDe("Get-Date\n\n(en la carpeta C:\\x)")).toBe("Get-Date");
});

test("sí y no dichos: un sí es corto y sin «pero»; cualquier negación gana", () => {
  for (const s of ["Sí", "sí, hazlo", "Dale", "ya po", "Ok", "sí, por favor", "Ábrelo", "Confirmo", "de una"]) expect(respuestaSiNo(s)).toBe("si");
  for (const s of ["No", "no, mejor no", "Cancela", "déjalo", "espera", "para", "nunca", "todavía no"]) expect(respuestaSiNo(s)).toBe("no");
  for (const s of ["sí, pero en Firefox", "¿qué hora es?", "Oye y qué tengo mañana en la agenda de la tarde", "sí sí sí sí sí sí sí"]) expect(respuestaSiNo(s)).toBeNull();
  expect(respuestaSiNo("sí, dale para adelante")).toBe("si");
});

test("la pregunta dicha: corta, sin enlaces ni extensiones", () => {
  expect(preguntaHablada(pedido({ tool: "open", title: "Abrir un enlace en el navegador", detail: "https://www.youtube.com/watch?v=x" }), "voz")).toBe("¿Abro youtube en el navegador? Dime sí o no.");
  expect(preguntaHablada(pedido({ tool: "vault_note", title: "Crear una nota en la bóveda AXS", detail: "Nueva nota: 20-29 R&D (The Forge)/22 Módulos de la App/Plan de Voz.md\n\n..." }), "voz")).toBe("¿Creo la nota «Plan de Voz» en la bóveda? Dime sí o no.");
  expect(preguntaHablada(pedido({ risk: "high", flags: ["borra archivos"] }), "nunca_voz")).toBe("Eso borra archivos, así que no lo apruebo por voz. Si quieres hacerlo, toca Aprobar en la pantalla.");
  expect(preguntaHablada(pedido({ risk: "high", flags: ["usa la red (descarga o envía datos)"] }), "tarjeta")).toBe("Eso usa la red, así que lo apruebas tocando la pantalla.");
  expect(paraHablar(preguntaHablada(pedido({ detail: "Get-Date" }), "voz"))).not.toMatch(/\d/);
});

test("lo que se dice de los textos de pantalla: tablas, agenda, series, fechas", () => {
  expect(paraHablar("| Día | kcal |\n|---|---|\n| Lun | 2.100 |")).toBe("Lun, dos mil cien.");
  expect(paraHablar("- 13:00 Almuerzo\n- 19:30 Entreno: Empuje")).toBe("a la una de la tarde, Almuerzo. a las siete y media de la tarde, Entreno: Empuje.");
  expect(paraHablar("Press de banca 4x6-8 con 70 kg, RIR 2")).toBe("Press de banca cuatro series de seis a ocho repeticiones con setenta kilos, erre i erre dos.");
  expect(paraHablar("Vence el 18-11; la boleta es del 16/11.")).toBe("Vence el dieciocho de noviembre; la boleta es del dieciséis de noviembre.");
  expect(paraHablar("Toma 2-3 vasos.")).toBe("Toma dos a tres vasos.");
  expect(paraHablar("5 tarea(s) inmediata(s) en MEMORY.md")).toBe("cinco tareas inmediatas en MEMORY.");
  expect(paraHablar("Fondos / Dips 3x8-10")).toBe("Fondos o Dips tres series de ocho a diez repeticiones.");
});

test("la hora y la fecha por código (sin el modelo)", () => {
  const d = new Date(2026, 10, 16, 7, 52);
  expect(respuestaDirecta("¿Qué hora es?", d)).toBe("Son las 7:52.");
  expect(respuestaDirecta("Oye Hestia, ¿qué hora es?", d)).toBe("Son las 7:52.");
  expect(respuestaDirecta("¿qué hora es?", new Date(2026, 10, 16, 13, 5))).toBe("Es la 13:05.");
  expect(paraHablar(respuestaDirecta("qué hora es", new Date(2026, 10, 16, 13, 5))!)).toBe("Es la una y cinco de la tarde.");
  expect(respuestaDirecta("¿Qué día es hoy?", d)).toBe("Hoy es lunes 16 de noviembre.");
  expect(respuestaDirecta("¿Qué hora es en Japón?", d)).toBeNull();
  expect(respuestaDirecta("¿A qué hora entreno?", d)).toBeNull();
});

test("si la herramienta se alarga, una segunda muletilla (una vez); si ya hubo respuesta, no", async () => {
  const enviados: any[] = [];
  let s!: VozSesion;
  s = new VozSesion({
    generar: async (_t, onToken) => {
      s.herramienta();
      await new Promise((r) => setTimeout(r, 120));
      onToken("Listo.");
      return { content: "Listo." };
    },
    sintetizar: async (t) => Buffer.from(t),
    muletilla: async () => ({ wav: Buffer.from("Dame un segundo."), texto: "Dame un segundo." }),
    muletillaLarga: async () => ({ wav: Buffer.from("Sigo en eso, ya casi."), texto: "Sigo en eso, ya casi." }),
    esperaMuletillaMs: 10, esperaLargaMs: 40,
    enviar: (m) => enviados.push(m),
  });
  await s.turno("crea una nota larga");
  await new Promise((r) => setTimeout(r, 80));
  expect(enviados.filter((m) => m.type === "voz_audio").map((a) => a.texto)).toEqual(["Dame un segundo.", "Sigo en eso, ya casi.", "Listo."]);
});

test("vault_note acepta etiquetas y valores dichos de otra forma, y el modelo ve las listas", async () => {
  const { VaultNoteTool } = await import("C:/Proyectos/eris/src/tools/VaultNoteTool.ts");
  const { FileWriteTool } = await import("C:/Proyectos/eris/src/tools/FileWriteTool.ts");
  const t: any = new VaultNoteTool();
  expect(t.inputSchema.parse({ title: "X", area: "Técnica", tag: "#AXS/infraestructura", status: "activo" })).toMatchObject({ area: "tecnica", tag: "Infraestructura", status: "Activo" });
  expect(t.inputSchema.parse({ title: "X", area: "tecnica", tag: "Gobernanza" }).tag).toBeUndefined(); // no existe: se descarta, la nota sigue
  expect(t.inputSchema.safeParse({ title: "X", area: "cualquiera" }).success).toBe(false);
  const def = t.toDefinition().inputSchema as any;
  expect(def.properties.area.enum).toContain("tecnica");
  expect(def.properties.tag.enum).toContain("Infraestructura");
  expect(def.required).toEqual(["title", "area"]);
  const fw = (new FileWriteTool() as any).toDefinition().inputSchema;
  expect(fw.properties.createDirs.type).toBe("boolean");
  expect(fw.required).not.toContain("createDirs");
});

test("abrir una página con un comando (Start-Process https://…) se aprueba por voz como abrirla", () => {
  const p = pedido({ detail: "Start-Process 'https://www.youtube.com'", risk: "high", flags: ["abre o lanza programas"] });
  expect(claseAprobacion(p)).toBe("voz");
  expect(preguntaHablada(p, "voz")).toBe("¿Abro youtube en el navegador? Dime sí o no.");
  expect(claseAprobacion(pedido({ detail: "Start-Process notepad.exe", risk: "high", flags: ["abre o lanza programas"] }))).toBe("tarjeta");
  expect(claseAprobacion(pedido({ detail: "Start-Process https://x.y; Remove-Item C:\\a", risk: "high", flags: ["borra archivos"] }))).toBe("nunca_voz");
});

test("una guardia corrigió la respuesta ya dicha: se dice solo lo nuevo, sin repetir", async () => {
  const { s, enviados } = llamada([{
    tokens: ["Sí, ", "te ", "alcanza. ", "Te ", "sobran ", "$797.000. ", "El ", "mes ", "está ", "seguro."],
    content: "Sí, te alcanza.\n\nEl mes está seguro.\n\n💰 No tengo cifras de Finanzas para eso y no las voy a inventar.",
  }]);
  await s.turno("¿y eso alcanza para el mes?");
  const dichos = enviados.filter((m) => m.type === "voz_audio").map((a) => a.texto);
  expect(dichos.filter((t) => /mes está seguro/.test(t)).length).toBe(1);
  expect(dichos.at(-1)).toBe("💰 No tengo cifras de Finanzas para eso y no las voy a inventar.");
});

test("un atajo por código que llega entero en un solo token: largo, va lo esencial y el detalle a la pantalla", async () => {
  const agenda = "Te quedan 6 cosas hoy.\n\nTu día:\n" + Array.from({ length: 8 }, (_, k) => `- Cosa ${k + 1}: algo que hacer a una hora del día con detalle`).join("\n");
  const { s, enviados } = llamada([{ tokens: [agenda] }]);
  await s.turno("¿qué tengo hoy?");
  const dichos = enviados.filter((m) => m.type === "voz_audio").map((a) => Buffer.from(a.wav, "base64").toString());
  expect(dichos[0]).toBe("Te quedan seis cosas hoy.");
  expect(dichos.at(-1)).toBe("Te dejé el detalle en la pantalla.");
  expect(dichos.join(" ").split(/\s+/).length).toBeLessThan(50);
});

test("lo esencial de un texto largo: sin títulos ni tablas", () => {
  const t = "# 🧭 Briefing AXS\nTienes 3 pendientes urgentes y 2 notas sin revisar.\n| a | b |\n|---|---|\n| 1 | 2 |\nLo demás puede esperar.";
  expect(esencial(t)).toBe("Tienes 3 pendientes urgentes y 2 notas sin revisar.\nLo demás puede esperar.");
});

test("la pregunta de una aprobación se dice dentro del turno, en orden, y el turno sigue después", async () => {
  const enviados: any[] = [];
  let s!: VozSesion;
  let aprobar!: () => void;
  s = new VozSesion({
    generar: async (_t, onToken) => {
      onToken("Voy a revisar. ");
      s.anunciar("¿Lo reviso en tu PC? Dime sí o no.");
      await new Promise<void>((r) => { aprobar = r; });
      return { content: "Tienes 3 programas usando harta memoria." };
    },
    sintetizar: async (t) => Buffer.from(t),
    enviar: (m) => enviados.push(m),
  });
  const p = s.turno("¿qué usa más memoria?");
  await new Promise((r) => setTimeout(r, 20));
  expect(enviados.filter((m) => m.type === "voz_audio").map((a) => a.texto)).toEqual(["Voy a revisar.", "¿Lo reviso en tu PC? Dime sí o no."]);
  aprobar();
  await p;
  // la respuesta después de la herramienta es otro mensaje: se dice entera
  expect(enviados.filter((m) => m.type === "voz_audio").map((a) => a.texto).at(-1)).toBe("Tienes 3 programas usando harta memoria.");
  expect(s.anunciar("nada")).toBe(false); // sin turno en curso no se dice
});

test("un bloque anexado después de lo dicho (briefing, lista) va a la pantalla, no se lee", async () => {
  const bloque = "# 🧭 Briefing AXS\n" + Array.from({ length: 8 }, (_, k) => `- Pendiente ${k + 1}`).join("\n");
  const { s, enviados } = llamada([{ tokens: ["Aquí ", "va ", "tu ", "briefing."], content: `Aquí va tu briefing.\n\n${bloque}` }]);
  await s.turno("dame el briefing");
  const dichos = enviados.filter((m) => m.type === "voz_audio").map((a) => Buffer.from(a.wav, "base64").toString());
  expect(dichos.join(" ")).not.toMatch(/Pendiente/);
  expect(dichos.at(-1)).toBe("Te dejé el detalle en la pantalla.");
  expect(enviados.find((m) => m.type === "voz_detalle")?.texto).toContain("Pendiente 8");
  expect(enviados.find((m) => m.type === "voz_fin")?.detalle).toBe(true);
});

// ─── J3 (2026-11-16): sensación Jarvis ───
import { armarSaludo, detalleSaludo, saludoHora } from "C:/Proyectos/eris/src/services/voz/Saludo.ts";
import { resumenLlamada, guardarLlamada, llamadaReciente } from "C:/Proyectos/eris/src/services/voz/ResumenLlamada.ts";
import { afinarVoz, mencionaAntes } from "C:/Proyectos/eris/src/services/voz/RutaVoz.ts";
import { CacheVoz } from "C:/Proyectos/eris/src/services/voz/CacheVoz.ts";

/** Como la escribe DayAgendaTool */
const AGENDA = [
  "Tu día:",
  "🏋️ **Entreno:** toca **Empuje** — Press de banca 3x6-8 · 62,5 kg; Fondos / Dips 3x8-10.",
  "🍽️ **Comida:** llevas 0 de 2.850 kcal y 0 de 136 g de proteína.",
  "💧 **Agua:** llevas 0 de 4,2 L: vas al día.",
  "💸 **Plata:** pago cercano: Arriendo $350.000 (mañana); Mi sueldo llega en 14 días.",
  "😴 **Sueño:** anoche dormiste 5 h 40. Esta noche acuéstate entre las 23:00 y las 23:30.",
  "",
  "**Lo que sigue:**",
  "• Entreno: Empuje (cuando te acomode)",
  "• Almuerzo ~13:30",
  "• Acostarte ~23:00",
].join("\n");

test("el saludo del día: por código, lo importante primero y corto", () => {
  const t = armarSaludo({ nombre: "Alex Melita", ahora: new Date(2026, 10, 16, 8, 30), agenda: AGENDA, inmediatas: ["Probar la llamada de voz en el teléfono con audífonos y medir la latencia", "Otra cosa"] });
  expect(t.startsWith("Buenos días, Alex.")).toBe(true);
  expect(t).toContain("Hoy toca Empuje.");
  expect(t).toContain("Lo próximo: almuerzo a eso de las 13:30.");
  expect(t).toContain("Pago cercano: Arriendo $350.000 (mañana).");
  expect(t.split(/\s+/).length).toBeLessThanOrEqual(45);
  expect(paraHablar(t)).not.toMatch(/\d|\*/);
  expect(saludoHora(15)).toBe("Buenas tardes");
  expect(saludoHora(22)).toBe("Buenas noches");
  expect(saludoHora(3)).toBe("Buenas noches");
  // sin datos del día: solo el saludo
  expect(armarSaludo({ ahora: new Date(2026, 10, 16, 8, 30) })).toBe("Buenos días.");
  expect(detalleSaludo({ ahora: new Date(), agenda: AGENDA, inmediatas: ["A"] })).toContain("**AXS · lo inmediato:**\n- A");
  // descanso
  expect(armarSaludo({ ahora: new Date(2026, 10, 16, 8), agenda: "🏋️ **Entreno:** hoy descansas (lo dijiste tú)." })).toContain("Hoy descansas del gym.");
});

test("el resumen al colgar: lo que pasó de verdad, sin el modelo", () => {
  const h = (role: string, content: string) => ({ role, content });
  const r = resumenLlamada({
    inicio: new Date(2026, 10, 16, 8, 30), fin: new Date(2026, 10, 16, 8, 36),
    history: [h("assistant", "Buenos días, Alex."), h("user", "¿Cuánta plata tengo?"), h("assistant", "Te quedan $403.000 hasta el sueldo. Aguanta."), h("user", "Abre YouTube"), h("assistant", "No lo abrí.")],
    eventos: [{ tipo: "herramienta", nombre: "finance_tracker" }, { tipo: "herramienta", nombre: "open" }, { tipo: "aprobacion", nombre: "open", decision: "denied", que: "Abrir un enlace en el navegador (https://youtube.com)" }],
  })!;
  expect(r).toContain("de 08:30 a 08:36");
  expect(r).toContain("«¿Cuánta plata tengo?»; «Abre YouTube»");
  expect(r).toContain("Revisé o usé: Finanzas, abrir algo en tu PC.");
  expect(r).toContain("No se hizo (rechazado o sin respuesta): Abrir un enlace");
  expect(r).toContain("Lo último que le dije: «No lo abrí.»");
  expect(resumenLlamada({ inicio: new Date(), fin: new Date(), history: [h("assistant", "Hola.")], eventos: [] })).toBeNull();
  const lista = guardarLlamada(null, { at: "2026-11-16T11:30:00.000Z", fin: "2026-11-16T11:36:00.000Z", resumen: r });
  expect(lista.length).toBe(1);
  expect(llamadaReciente(lista, new Date("2026-11-17T10:00:00.000Z"))?.resumen).toBe(r);
  expect(llamadaReciente(lista, new Date("2026-11-20T10:00:00.000Z"))).toBeNull(); // vieja
  expect(guardarLlamada(Array.from({ length: 12 }, (_, i) => ({ at: "", fin: "", resumen: String(i) })), { at: "", fin: "", resumen: "n" }).length).toBe(10);
});

test("en la llamada, dentro de la bóveda y del PC solo las herramientas que pide el mensaje", () => {
  const BOV = new Set(["knowledge_search", "log_management", "vault_audit", "vault_healer", "executive_report", "crystallize", "axs_briefing", "vault_note"]);
  expect([...afinarVoz("Busca en la bóveda qué dice de Toji", BOV)]).toEqual(["knowledge_search"]);
  expect([...afinarVoz("Crea una nota en la bóveda sobre la voz", BOV)]).toEqual(["vault_note"]);
  expect([...afinarVoz("Dame el briefing de AXS", BOV)]).toEqual(["axs_briefing"]);
  expect(afinarVoz("¿Algo de la bóveda?", BOV).size).toBe(8); // no se reconoce: todas
  // El PC no se afina (con una sola herramienta a la vista el modelo dejaba de llamarla)
  const PC = new Set(["bash", "system_info", "file_read", "file_write", "open", "nutrition_tracker"]);
  expect(afinarVoz("Abre YouTube en el navegador", PC).size).toBe(6);
  expect(mencionaAntes("¿De qué hablamos ayer?")).toBe(true);
  expect(mencionaAntes("¿Cuánta agua llevo?")).toBe(false);
});

test("el caché de voz: lo corto se genera una vez, lo largo nunca se guarda", async () => {
  const c = new CacheVoz(2);
  let n = 0;
  const sint = async (t: string) => { n++; return Buffer.from(t); };
  await c.decir("Claro,", sint); await c.decir("Claro,", sint);
  expect(n).toBe(1);
  await c.decir("una frase bastante más larga que cuatro palabras", sint); await c.decir("una frase bastante más larga que cuatro palabras", sint);
  expect(n).toBe(3);
  await c.decir("Mira,", sint); await c.decir("Sí.", sint); // el más viejo sale
  expect(c.tiene("Claro,")).toBe(false);
  expect(c.tamano).toBe(2);
});

test("el mismo trozo dos veces en un turno se dice una vez (una guardia que pidió otra pasada)", async () => {
  const { s, enviados } = llamada([{ tokens: ["Te ", "lo ", "abro. ", "Te ", "lo ", "abro. ", "¿Abro youtube?"] }]);
  await s.turno("abre youtube");
  expect(enviados.filter((m) => m.type === "voz_audio").map((a) => a.texto)).toEqual(["Te lo abro.", "¿Abro youtube?"]);
});

test("un turno armado por código (el saludo): sin el motor, y el detalle propio a la pantalla", async () => {
  const enviados: any[] = [];
  let llamado = false;
  const s = new VozSesion({ generar: async () => { llamado = true; return { content: "" }; }, sintetizar: async (t) => Buffer.from(t), enviar: (m) => enviados.push(m) });
  await s.turno("", undefined, { respuesta: "Buenos días, Alex. Hoy toca Empuje.", detalle: "Tu día:\n- algo" });
  expect(llamado).toBe(false);
  expect(enviados.filter((m) => m.type === "voz_audio").map((a) => a.texto)).toEqual(["Buenos días, Alex.", "Hoy toca Empuje."]);
  expect(enviados.find((m) => m.type === "voz_detalle")?.texto).toBe("Tu día:\n- algo");
});
