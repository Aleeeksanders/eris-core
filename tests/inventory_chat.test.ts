// Inventario por chat (fase I2): el lector de frases, el enrutado y las respuestas armadas por código.
import { test, expect } from "bun:test";
import { parseInventoryMessage as P } from "C:/Proyectos/eris/src/services/InventoryParse.ts";
import { routeTools, intentOf, groupsFor } from "C:/Proyectos/eris/src/services/ToolRouter.ts";
import { formatInventoryReply } from "C:/Proyectos/eris/src/services/InventoryReply.ts";
import * as I from "C:/Proyectos/eris/src/services/InventoryCore.ts";

test("frases claras → operación", () => {
  expect(P("compré 2 L de leche")).toEqual({ action: "compra", producto: "leche", cantidad: 2, unidad: "L" });
  expect(P("Compré leche, pan y 6 huevos")).toEqual({ action: "compra", items: [{ producto: "leche" }, { producto: "pan" }, { producto: "huevos", cantidad: 6, unidad: "u" }] });
  expect(P("ayer compré 2 paquetes de fideos de 400 g en el líder")).toEqual({ action: "compra", producto: "fideos", cantidad: 2, unidad: "paquete", contenido: { cant: 400, unidad: "g" } });
  expect(P("se me acabó el shampoo")).toEqual({ action: "se_acabo", producto: "shampoo" });
  expect(P("ya no queda arroz")).toEqual({ action: "se_acabo", producto: "arroz" });
  expect(P("me quedan 3 huevos")).toEqual({ action: "quedan", producto: "huevos", cantidad: 3, unidad: "u" });
  expect(P("usé 500 g de arroz")).toEqual({ action: "consumo", producto: "arroz", cantidad: 500, unidad: "g" });
  expect(P("boté el yogur, estaba vencido")).toEqual({ action: "botar", producto: "yogur", motivo: "vencido" });
  expect(P("se me echó a perder la palta")).toEqual({ action: "botar", producto: "palta", motivo: "malo" });
  expect(P("¿tengo arroz?")).toEqual({ action: "consultar", producto: "arroz" });
  expect(P("¿cuánta leche me queda?")).toEqual({ action: "consultar", producto: "leche" });
  expect(P("¿qué tengo en la despensa?")).toEqual({ action: "en_area", area: "despensa" });
  expect(P("¿qué hay en el refri?")).toEqual({ action: "en_area", area: "alimentos" });
  expect(P("¿qué me falta comprar?")).toEqual({ action: "lista" });
  expect(P("lista de compras")).toEqual({ action: "lista" });
  expect(P("anota pilas AA en la lista de compras")).toEqual({ action: "agregar_lista", producto: "pilas aa" });
  expect(P("hay que comprar detergente y cloro")).toEqual({ action: "agregar_lista", items: [{ producto: "detergente" }, { producto: "cloro" }] });
  expect(P("¿qué se me vence esta semana?")).toEqual({ action: "por_vencer", dias: 7 });
  expect(P("deshaz lo último del inventario")).toEqual({ action: "deshacer" });
});

test("lo que NO es del inventario no se toma", () => {
  for (const f of ["compré leche en 2 lucas", "gasté 5 lucas en el super", "me comí 2 huevos", "tengo hambre", "¿tengo que entrenar hoy?", "no hay problema",
    "se acabó la reunión", "me quedan 2 horas", "¿qué como hoy?", "registra 2 huevos y pan", "hola eris"]) {
    expect([f, P(f)]).toEqual([f, null]);
  }
});

test("enrutado: solo el Inventario cuando es solo eso; no rompe las ideas de comida", () => {
  const avail = ["nutrition_tracker", "finance_tracker", "inventory_tracker", "metabolic_advisor", "carb_options", "web_search", "symptom_guide", "manage_user_profile"];
  expect(intentOf("¿qué tengo en el refri?", groupsFor("¿qué tengo en el refri?"))).toBe("inventario");
  expect([...routeTools("se me acabó el detergente y el cloro", [], avail).tools]).toEqual(["inventory_tracker"]);
  // «¿qué puedo cocinar con lo que hay en la despensa?» sigue siendo ideas de comida
  expect(intentOf("¿qué puedo comer con lo que hay en la despensa?", groupsFor("¿qué puedo comer con lo que hay en la despensa?"))).toBe("ideas_comida");
  expect(intentOf("me comí 2 huevos", groupsFor("me comí 2 huevos"))).toBe("registrar_comida");
  expect(routeTools("compré 2 L de leche", [], avail).tools.has("inventory_tracker")).toBe(true);
});

test("respuestas por código con lo que devolvió el teléfono", () => {
  let S = I.emptyState(); let id = 1;
  const ctx = { now: new Date(2026, 9, 22, 12), newId: () => id++ };
  const run = (op: any) => { const r = I.applyOp(S, op, ctx); S = r.state; return r.result; };
  const r1 = run({ action: "compra", producto: "leche", cantidad: 2, unidad: "L" });
  expect(formatInventoryReply({ action: "compra", producto: "leche" }, [r1])).toBe("📦 **Leche**: +2 L → tienes 2 L · nuevo en Alimentos.");
  const r2 = run({ action: "compra", producto: "shampoo" });
  expect(formatInventoryReply({ action: "compra", producto: "shampoo" }, [r2])).toBe("📦 **Shampoo**: +1 unidad (si fue otra cantidad, dímela) → tienes 1 unidad · nuevo en Baño e higiene.");
  const r3 = run({ action: "se_acabo", producto: "shampoo" });
  expect(formatInventoryReply({ action: "se_acabo", producto: "shampoo" }, [r3])).toBe("🛒 **Shampoo**: anotado que se acabó; quedó en tu lista de compras.");
  const r4 = run({ action: "lista" });
  expect(formatInventoryReply({ action: "lista" }, [r4])).toContain("· Shampoo (se acabó) — ~1 unidad");
  const r5 = run({ action: "consultar", producto: "leches" });
  expect(formatInventoryReply({ action: "consultar", producto: "leches" }, [r5], { respaldo: "22-10 a las 9:30" })).toBe("Sí: **Leche**, 2 L (Alimentos).\n_(según tu último respaldo, 22-10 a las 9:30: abre la app para ver lo de ahora)_");
  const r6 = run({ action: "compra", producto: "taladro" });
  expect(formatInventoryReply({ action: "compra", producto: "taladro" }, [r6])).toContain("¿En qué área guardo «taladro»?\n[Opción: Alimentos]");
});
