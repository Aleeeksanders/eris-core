// Tu plato (2026-11-15). El usuario: «las divisiones suelen ser porciones que varían bastante: en las casas de bajos recursos la
// cantidad de carbohidratos suele ser mucho mayor… y la prote muy acotada, y viceversa». Se pregunta una vez cómo es su plato,
// se corrige con un toque («fue más carne») y se aprende; la proteína que falta, con lo que hay en su casa y lo que le costó.
import { test, expect } from "bun:test";
import { NutritionTool } from "C:/Proyectos/eris/src/tools/NutritionTool.ts";
import { UnifiedFoodService } from "C:/Proyectos/eris/src/services/gluco/UnifiedFoodService.ts";
import { leerRespuestaPlato, botonesCorreccion } from "C:/Proyectos/eris/src/services/PlatoChat.ts";
import { sugerenciaProteina, votar } from "C:/Proyectos/eris/src/services/PlatoPerfil.ts";
const fs = new UnifiedFoodService("");
const t = new NutritionTool();
const mem = () => {
  const m = new Map<string, any>();
  return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: any) => { m.set(k, v); }, getProfile: async () => ({}) };
};
/** un turno del chat: el atajo por código (como en el servidor) y la herramienta */
async function turno(memory: any, msg: string, last = "") {
  const ctx: any = { memory, wsClient: { send() {} }, foodService: fs, userMessage: msg, lastAssistantMessage: last };
  const pre: any = await t.preroute(msg, ctx);
  expect(pre).not.toBeNull();
  const r: any = await t.execute(pre, ctx);
  return { pre, out: String(r.metadata?.quickReply ?? r.output ?? r.error) };
}
const hoy = (memory: any) => {
  const k = [...memory.m.keys()].find((x: string) => x.startsWith("nutrition_log_"))!;
  const items = memory.m.get(k).flatMap((e: any) => e.items);
  return { items, c: items.reduce((a: number, i: any) => a + i.carbs, 0), p: items.reduce((a: number, i: any) => a + i.protein, 0) };
};

test("leer la respuesta: cómo es su plato o una corrección del recién anotado", () => {
  expect(leerRespuestaPlato("🍚🍚🍗 Más arroz, fideos o papas que carne")).toEqual({ tipo: "carbo", correccion: false });
  expect(leerRespuestaPlato("🍚🍗 Mitad y mitad")).toEqual({ tipo: "mitad", correccion: false });
  expect(leerRespuestaPlato("🍚🍗🍗 Más carne que arroz")).toEqual({ tipo: "proteina", correccion: false });
  expect(leerRespuestaPlato("Fue más carne")).toEqual({ tipo: "proteina", correccion: true });
  expect(leerRespuestaPlato("Fue más arroz o fideos que carne")).toEqual({ tipo: "carbo", correccion: true });
  expect(leerRespuestaPlato("en mi casa el plato es harto arroz y poca carne")).toEqual({ tipo: "carbo", correccion: false });
  // no es eso
  expect(leerRespuestaPlato("quiero comer más carne")).toBeNull();
  expect(leerRespuestaPlato("compré harto arroz")).toBeNull();
  expect(leerRespuestaPlato("almorcé arroz con pollo")).toBeNull();
  expect(botonesCorreccion("carbo")).toBe("[Opción: Fue mitad y mitad] [Opción: Fue más carne]");
});

test("el primer plato pregunta (una vez); la respuesta se guarda y rearma el almuerzo", async () => {
  const memory = mem();
  const a = await turno(memory, "Comí tallarines con salsa y carne molida para el almuerzo, tenía pimentón");
  expect(a.out).toMatch(/¿cómo suele ser tu plato\?/);
  expect(a.out).toContain("[Opción: 🍚🍚🍗 Más arroz, fideos o papas que carne]");
  const antes = hoy(memory);
  const b = await turno(memory, "🍚🍚🍗 Más arroz, fideos o papas que carne", a.out);
  expect(b.pre).toMatchObject({ action: "plato_perfil", platoTipo: "carbo", platoCorreccion: false });
  expect(b.out).toMatch(/desde ahora armo tus platos con más arroz, fideos o papas que carne/);
  const despues = hoy(memory);
  expect(despues.items.length).toBe(antes.items.length); // se rearmó (no quedó repetido)
  expect(despues.c).toBeGreaterThan(antes.c);
  expect(despues.p).toBeLessThan(antes.p);
  // el siguiente plato sale con su reparto, sin volver a preguntar, con los botones para corregir
  const c = await turno(memory, "almorcé arroz con pollo y ensalada");
  expect(c.out).not.toMatch(/¿cómo suele ser tu plato\?/);
  expect(c.out).toMatch(/tu plato de siempre/);
  expect(c.out).toContain("[Opción: Fue más carne]");
});

test("corregir con un toque: rearma ese plato; dos veces lo mismo y pasa a ser su plato", async () => {
  const memory = mem();
  memory.m.set("plato_perfil", { tipo: "carbo", preguntado: new Date().toISOString(), votos: [] });
  const a = await turno(memory, "almorcé lentejas con arroz y longaniza");
  const pA = hoy(memory).p;
  const b = await turno(memory, "Fue más carne", a.out);
  expect(b.pre).toMatchObject({ action: "plato_perfil", platoTipo: "proteina", platoCorreccion: true });
  expect(b.out).toMatch(/rearmé tu almuerzo con más carne/);
  expect(hoy(memory).p).toBeGreaterThan(pA);
  expect(b.out).not.toMatch(/desde ahora/);
  const c = await turno(memory, "cené pollo asado con papas fritas");
  const d = await turno(memory, "Fue más carne", c.out);
  expect(d.out).toMatch(/Como ya van dos veces, desde ahora armo tus platos así \(más carne o proteína que arroz\)/);
  expect(memory.m.get("plato_perfil").tipo).toBe("proteina");
  // votar: sola, una corrección no cambia el plato de siempre
  const datos: any = { tipo: "mitad", votos: [] };
  expect(votar(datos, "carbo")).toBe(false);
  expect(votar(datos, "carbo")).toBe(true);
  expect(datos.tipo).toBe("carbo");
});

test("un plato con poca proteína: la que hay en la casa, la más barata por gramo primero, con lo que costó", () => {
  const inv: any = { items: [
    { nombre: "Huevos", area: "alimentos", cantidad: 6, unidad: "u", precio: 190 },
    { nombre: "Jurel en lata", area: "despensa", cantidad: 1, unidad: "u", precio: 1890 },
    { nombre: "Pechuga de pollo", area: "alimentos", cantidad: 0, unidad: "kg", precio: 5990 }, // se acabó
    { nombre: "Shampoo", area: "bano", cantidad: 1, unidad: "u", precio: 3990 },
  ] };
  const s = sugerenciaProteina({ proteina: 12, inventario: inv, diabetes: true });
  expect(s.texto).toMatch(/Este plato trae 12 g de proteína/);
  expect(s.texto).toMatch(/Con tu diabetes/);
  const lineas = s.texto.split("\n").slice(1);
  // el huevo sale más barato por gramo de proteína ($190 por 7 g ≈ $27/g) que el jurel ($945 por 21 g ≈ $45/g): va primero
  expect(lineas[0]).toMatch(/🥚 1 huevo \(tienes 6\): \+7 g · ~\$190/);
  expect(lineas[1]).toMatch(/🐟 ½ lata de jurel \(tienes 1\): \+21 g · ~\$945/);
  expect(s.texto).not.toMatch(/pollo|Shampoo/i);
  expect(s.botones).toBe("");
  // nada en la casa: ideas que rinden y el botón para la lista de compras
  const n = sugerenciaProteina({ proteina: 10, inventario: { items: [] } as any, diabetes: false });
  expect(n.texto).toMatch(/huevo, el jurel en lata y las legumbres/);
  expect(n.botones).toContain("[Opción: Agrega huevos a la lista de compras]");
});

test("la sugerencia sale una vez al día, en un almuerzo con mucho carbohidrato y poca proteína", async () => {
  const memory = mem();
  const a = await turno(memory, "almorcé arroz con huevo frito");
  expect(a.out).toMatch(/💪 Este plato trae \d+ g de proteína/);
  const b = await turno(memory, "cené arroz con huevo frito");
  expect(b.out).not.toMatch(/💪/);
});
