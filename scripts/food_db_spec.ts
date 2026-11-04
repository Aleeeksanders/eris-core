// ============================================================
// Especificación de la base de alimentos genéricos y platos chilenos (src/data/chilean-foods.json).
// La construye scripts/build_food_db.ts con datos de USDA FoodData Central (SR Legacy / FNDDS, dominio público).
//
//  - Alimentos simples: `usda` = descripción del alimento en FDC (o su fdcId), porciones típicas en Chile.
//  - Platos: `recipe` = ingredientes [descripción FDC | fdcId | "agua" | "sal", gramos]; `yield` = peso final si la
//    cocción pierde agua (horno, fritura). Recetas caseras promedio; la sal es la de cocina típica (~0,7-1 %).
//  - group / nova alimentan el motor de calidad del teléfono (NutritionQuality): grupo de alimento y procesamiento
//    NOVA 1 (natural) … 4 (ultraprocesado).
// ============================================================

export type Serving = [description: string, grams: number];
export type Ingredient = [usda: string | number, grams: number];

interface Base {
  id: string; name: string; aliases?: string[]; category: string; group: string; nova: number; liquid?: boolean;
  servings: Serving[];
}
export interface SimpleSpec extends Base { usda: string | number; src?: "sr" | "fndds" | "foundation" }
export interface RecipeSpec extends Base { recipe: Ingredient[]; yield?: number }
export type FoodSpec = SimpleSpec | RecipeSpec;

// Ingredientes que se repiten en las recetas
const MARRAQUETA = "Bread, french or vienna (includes sourdough)";
const PAN_COMPLETO = "Rolls, hamburger or hotdog, plain";
const VACUNO = "Beef, round, top round, separable lean and fat, trimmed to 1/8\" fat, select, cooked, braised";
const PALTA = "Avocados, raw, all commercial varieties";
const TOMATE = "Tomatoes, red, ripe, raw, year round average";
const MAYO = "Salad dressing, mayonnaise, regular";
const CEBOLLA = "Onions, raw";
const ACEITE = "Oil, vegetable, sunflower, linoleic, (approx. 65%)";
const PAPA = "Potatoes, boiled, cooked without skin, flesh, without salt";
const ZANAHORIA = "Carrots, raw";
const ZAPALLO = "Squash, winter, butternut, cooked, baked, without salt";
const HUEVO_FRITO = "Egg, whole, cooked, fried";
const GAUDA = "Cheese, gouda";
const POLLO = "Chicken, broilers or fryers, breast, meat only, cooked, roasted";
const ARROZ = "Rice, white, long-grain, regular, enriched, cooked";
const LECHE = "Milk, whole, 3.25% milkfat, with added vitamin D";
const AZUCAR = "Sugars, granulated";
const AZUCAR_RUBIA = "Sugars, brown";
const HARINA = "Wheat flour, white, all-purpose, enriched, bleached";
const MANTEQUILLA = "Butter, salted";
const VINO_BLANCO = "Alcoholic beverage, wine, table, white";
const PISCO = "Alcoholic beverage, distilled, all (gin, rum, vodka, whiskey) 80 proof";
const PAPAS_FRITAS = "Fast foods, potato, french fried in vegetable oil";
const JAMON = "Ham, sliced, regular (approximately 11% fat)";
const CUSK = "Fish, cusk, raw";

export const NEW_FOODS: FoodSpec[] = [
  // ─── Panes ────────────────────────────────────────────────
  { id: "cl:pan_amasado", name: "Pan amasado", aliases: ["amasado", "pan amasado casero"], category: "panes", group: "pan", nova: 3, usda: "Rolls, dinner, plain, commercially prepared (includes brown-and-serve)", servings: [["1 unidad", 100]] },
  { id: "cl:dobladita", name: "Dobladita", aliases: ["dobladitas", "pan doblado"], category: "panes", group: "pan", nova: 3, usda: "Rolls, dinner, plain, commercially prepared (includes brown-and-serve)", servings: [["1 unidad", 70]] },
  { id: "cl:pan_completo", name: "Pan de completo / hot dog", aliases: ["pan de hot dog", "pan para completo", "pan de completo"], category: "panes", group: "pan", nova: 4, usda: PAN_COMPLETO, servings: [["1 unidad", 70]] },
  { id: "cl:pan_hamburguesa", name: "Pan de hamburguesa", aliases: ["pan hamburguesa", "pan de hamburguesas"], category: "panes", group: "pan", nova: 4, usda: PAN_COMPLETO, servings: [["1 unidad", 75]] },
  { id: "cl:tortilla_trigo", name: "Tortilla de trigo (wrap)", aliases: ["wrap", "tortillas de trigo", "fajita"], category: "panes", group: "pan", nova: 4, usda: 167535, servings: [["1 unidad", 40]] },
  { id: "cl:pan_centeno", name: "Pan de centeno", aliases: ["pan centeno"], category: "panes", group: "pan", nova: 3, usda: "Bread, rye", servings: [["1 rebanada", 32]] },
  { id: "cl:galletas_agua", name: "Galletas de agua / soda", aliases: ["galletas de soda", "galletas de agua", "crackers", "galletas saladas"], category: "panes", group: "pan", nova: 4, usda: "Crackers, saltines (includes oyster, soda, soup)", servings: [["1 paquete individual", 30], ["4 galletas", 12]] },
  { id: "cl:tostadas", name: "Tostadas (pan tostado envasado)", aliases: ["tostadas", "pan tostado", "tostadas envasadas"], category: "panes", group: "pan", nova: 4, usda: "Bread, white, commercially prepared, toasted", servings: [["2 tostadas", 20]] },

  // ─── Cereales ─────────────────────────────────────────────
  { id: "cl:mote_trigo", name: "Mote de trigo cocido", aliases: ["mote", "mote de trigo"], category: "cereales", group: "cereal_integral", nova: 1, usda: "Bulgur, cooked", servings: [["1 taza", 180], ["½ taza", 90]] },
  { id: "cl:cuscus", name: "Cuscús cocido", aliases: ["cuscus", "couscous"], category: "cereales", group: "cereal_refinado", nova: 1, usda: "Couscous, cooked", servings: [["1 taza", 157]] },
  { id: "cl:polenta", name: "Polenta cocida", aliases: ["polenta", "sémola de maíz"], category: "cereales", group: "cereal_refinado", nova: 1, usda: "Cereals, corn grits, white, regular and quick, enriched, cooked with water, without salt", servings: [["1 taza", 240]] },
  { id: "cl:fideos_integrales", name: "Fideos integrales cocidos", aliases: ["pasta integral", "tallarines integrales"], category: "cereales", group: "cereal_integral", nova: 1, usda: "Pasta, whole-wheat, cooked", servings: [["1 plato", 180]] },
  { id: "cl:cereal_azucarado", name: "Cereal azucarado (tipo Zucaritas / Chocapic)", aliases: ["zucaritas", "chocapic", "cereal de chocolate", "cereal con azúcar", "froot loops", "cereal azucarado"], category: "cereales", group: "dulce", nova: 4, usda: "Cereals ready-to-eat, KELLOGG, KELLOGG'S FROSTED FLAKES", servings: [["1 taza", 30]] },
  { id: "cl:corn_flakes", name: "Corn flakes", aliases: ["copos de maíz", "cereal de maíz", "cornflakes"], category: "cereales", group: "cereal_refinado", nova: 4, usda: "Cereals ready-to-eat, KELLOGG, KELLOGG'S CORN FLAKES", servings: [["1 taza", 28]] },
  { id: "cl:harina_tostada", name: "Harina tostada", aliases: ["harina tostada"], category: "cereales", group: "cereal_integral", nova: 1, usda: "Wheat flour, whole-grain (Includes foods for USDA's Food Distribution Program)", servings: [["2 cucharadas", 20]] },
  { id: "cl:barra_cereal", name: "Barra de cereal", aliases: ["barrita de cereal", "barra de granola", "barrita"], category: "snacks", group: "dulce", nova: 4, usda: "Snacks, granola bars, soft, uncoated, plain", servings: [["1 barra", 25]] },
  { id: "cl:avena_leche", name: "Avena con leche", aliases: ["avena con leche", "avena cocida con leche"], category: "cereales", group: "cereal_integral", nova: 1, recipe: [["Cereals, oats, regular and quick, not fortified, dry", 40], [LECHE, 200]], servings: [["1 plato", 240]] },

  // ─── Legumbres ────────────────────────────────────────────
  { id: "cl:porotos_negros", name: "Porotos negros cocidos", aliases: ["porotos negros", "frijoles negros"], category: "legumbres", group: "legumbre", nova: 1, usda: "Beans, black, mature seeds, cooked, boiled, without salt", servings: [["1 taza", 172]] },
  { id: "cl:habas", name: "Habas cocidas", aliases: ["habas"], category: "legumbres", group: "legumbre", nova: 1, usda: "Broadbeans (fava beans), mature seeds, cooked, boiled, without salt", servings: [["1 taza", 170]] },
  { id: "cl:tofu", name: "Tofu", aliases: ["tofu firme"], category: "legumbres", group: "legumbre", nova: 3, usda: "Tofu, raw, firm, prepared with calcium sulfate", servings: [["1 porción", 100]] },
  { id: "cl:hummus", name: "Hummus", aliases: ["humus", "hummus de garbanzo"], category: "legumbres", group: "legumbre", nova: 3, usda: "Hummus, commercial", servings: [["2 cucharadas", 30]] },

  // ─── Verduras ─────────────────────────────────────────────
  { id: "cl:porotos_verdes", name: "Porotos verdes", aliases: ["vainitas", "porotos verdes", "judías verdes"], category: "verduras", group: "verdura", nova: 1, usda: "Beans, snap, green, cooked, boiled, drained, without salt", servings: [["1 taza", 125]] },
  { id: "cl:coliflor", name: "Coliflor cocida", aliases: ["coliflor"], category: "verduras", group: "verdura", nova: 1, usda: "Cauliflower, cooked, boiled, drained, without salt", servings: [["1 taza", 124]] },
  { id: "cl:repollo", name: "Repollo cocido", aliases: ["repollo", "col"], category: "verduras", group: "verdura", nova: 1, usda: "Cabbage, common, cooked, boiled, drained, without salt", servings: [["1 taza", 150]] },
  { id: "cl:betarraga", name: "Betarraga cocida", aliases: ["betarraga", "remolacha", "betarragas"], category: "verduras", group: "verdura", nova: 1, usda: "Beets, cooked, boiled, drained", servings: [["½ taza", 85], ["1 unidad", 100]] },
  { id: "cl:zapallo_italiano", name: "Zapallo italiano", aliases: ["zapallo italiano", "zucchini", "calabacín"], category: "verduras", group: "verdura", nova: 1, usda: "Squash, summer, zucchini, includes skin, raw", servings: [["1 unidad", 200], ["1 taza", 124]] },
  { id: "cl:champinones", name: "Champiñones", aliases: ["champiñón", "champinones", "hongos"], category: "verduras", group: "verdura", nova: 1, usda: "Mushrooms, white, raw", servings: [["1 taza", 70]] },
  { id: "cl:apio", name: "Apio", aliases: ["apio"], category: "verduras", group: "verdura", nova: 1, usda: "Celery, raw", servings: [["1 tallo", 40]] },
  { id: "cl:berenjena", name: "Berenjena cocida", aliases: ["berenjenas"], category: "verduras", group: "verdura", nova: 1, usda: "Eggplant, cooked, boiled, drained, without salt", servings: [["1 taza", 99]] },
  { id: "cl:esparragos", name: "Espárragos cocidos", aliases: ["espárragos", "esparragos"], category: "verduras", group: "verdura", nova: 1, usda: "Asparagus, cooked, boiled, drained", servings: [["6 unidades", 90]] },
  { id: "cl:alcachofa", name: "Alcachofa cocida", aliases: ["alcachofa", "alcachofas"], category: "verduras", group: "verdura", nova: 1, usda: "Artichokes, (globe or french), cooked, boiled, drained, without salt", servings: [["1 unidad", 120]] },
  { id: "cl:rabanitos", name: "Rabanitos", aliases: ["rabanito", "rábanos"], category: "verduras", group: "verdura", nova: 1, usda: "Radishes, raw", servings: [["5 unidades", 50]] },
  { id: "cl:ensalada_chilena", name: "Ensalada chilena", aliases: ["ensalada a la chilena", "tomate con cebolla"], category: "platos", group: "verdura", nova: 1, recipe: [[TOMATE, 150], [CEBOLLA, 40], [ACEITE, 5], ["sal", 1]], servings: [["1 porción", 196]] },
  { id: "cl:ensalada_surtida", name: "Ensalada surtida", aliases: ["ensalada mixta", "ensalada verde", "ensalada"], category: "platos", group: "verdura", nova: 1, recipe: [["Lettuce, cos or romaine, raw", 50], [TOMATE, 60], [ZANAHORIA, 40], ["Cucumber, with peel, raw", 40], [ACEITE, 5], ["sal", 0.8]], servings: [["1 porción", 196]] },
  { id: "cl:ensalada_lechuga", name: "Ensalada de lechuga", aliases: ["lechuga aliñada"], category: "platos", group: "verdura", nova: 1, recipe: [["Lettuce, cos or romaine, raw", 80], [ACEITE, 5], ["Lemon juice, raw", 5], ["sal", 0.5]], servings: [["1 porción", 90]] },
  { id: "cl:sopa_verduras", name: "Sopa de verduras casera", aliases: ["sopa de verduras", "sopa casera"], category: "platos", group: "plato_casero", nova: 1, recipe: [[ZANAHORIA, 40], [ZAPALLO, 60], [PAPA, 60], ["Celery, raw", 20], [CEBOLLA, 20], [ACEITE, 5], ["agua", 200], ["sal", 2.4]], servings: [["1 plato", 400]] },
  { id: "cl:crema_zapallo", name: "Crema de zapallo casera", aliases: ["crema de zapallo"], category: "platos", group: "plato_casero", nova: 1, recipe: [[ZAPALLO, 200], [CEBOLLA, 30], ["Cream, fluid, heavy whipping", 20], [MANTEQUILLA, 5], ["agua", 100], ["sal", 2]], servings: [["1 plato", 350]] },

  // ─── Frutas ───────────────────────────────────────────────
  { id: "cl:mandarina", name: "Mandarina", aliases: ["mandarinas", "clementina"], category: "frutas", group: "fruta", nova: 1, usda: "Tangerines, (mandarin oranges), raw", servings: [["1 unidad", 88]] },
  { id: "cl:melon", name: "Melón", aliases: ["melón calameño", "melon", "melón tuna"], category: "frutas", group: "fruta", nova: 1, usda: "Melons, honeydew, raw", servings: [["1 tajada", 170]] },
  { id: "cl:pina", name: "Piña", aliases: ["piña", "ananá"], category: "frutas", group: "fruta", nova: 1, usda: "Pineapple, raw, all varieties", servings: [["1 taza", 165]] },
  { id: "cl:mango", name: "Mango", aliases: ["mangos"], category: "frutas", group: "fruta", nova: 1, usda: "Mangos, raw", servings: [["1 taza", 165], ["1 unidad", 200]] },
  { id: "cl:cerezas", name: "Cerezas", aliases: ["cereza", "guindas"], category: "frutas", group: "fruta", nova: 1, usda: "Cherries, sweet, raw", servings: [["1 taza", 138]] },
  { id: "cl:arandanos", name: "Arándanos", aliases: ["arándano", "arandanos", "blueberries"], category: "frutas", group: "fruta", nova: 1, usda: "Blueberries, raw", servings: [["1 taza", 148]] },
  { id: "cl:frambuesas", name: "Frambuesas", aliases: ["frambuesa"], category: "frutas", group: "fruta", nova: 1, usda: "Raspberries, raw", servings: [["1 taza", 123]] },
  { id: "cl:ciruela", name: "Ciruela", aliases: ["ciruelas"], category: "frutas", group: "fruta", nova: 1, usda: "Plums, raw", servings: [["1 unidad", 66]] },
  { id: "cl:damasco", name: "Damasco", aliases: ["damascos", "albaricoque"], category: "frutas", group: "fruta", nova: 1, usda: "Apricots, raw", servings: [["2 unidades", 70]] },
  { id: "cl:higo", name: "Higo", aliases: ["higos", "breva"], category: "frutas", group: "fruta", nova: 1, usda: "Figs, raw", servings: [["1 unidad", 50]] },
  { id: "cl:membrillo", name: "Membrillo", aliases: ["membrillos"], category: "frutas", group: "fruta", nova: 1, usda: "Quinces, raw", servings: [["1 unidad", 92]] },
  { id: "cl:pomelo", name: "Pomelo", aliases: ["toronja"], category: "frutas", group: "fruta", nova: 1, usda: "Grapefruit, raw, pink and red, all areas", servings: [["½ unidad", 123]] },
  { id: "cl:maracuya", name: "Maracuyá", aliases: ["maracuya", "fruta de la pasión"], category: "frutas", group: "fruta", nova: 1, usda: "Passion-fruit, (granadilla), purple, raw", servings: [["2 unidades", 36]] },
  { id: "cl:pasas", name: "Pasas", aliases: ["pasas", "uvas pasas"], category: "frutas", group: "fruta", nova: 1, usda: "Raisins, dark, seedless (Includes foods for USDA's Food Distribution Program)", servings: [["1 puñado", 30]] },
  { id: "cl:ciruelas_secas", name: "Ciruelas secas", aliases: ["ciruela seca", "ciruelas pasas"], category: "frutas", group: "fruta", nova: 1, usda: "Plums, dried (prunes), uncooked", servings: [["5 unidades", 40]] },
  { id: "cl:duraznos_conserva", name: "Duraznos en conserva (almíbar)", aliases: ["duraznos en conserva", "duraznos en almíbar", "fruta en conserva"], category: "frutas", group: "fruta", nova: 3, usda: "Peaches, canned, heavy syrup pack, solids and liquids", servings: [["½ taza", 130]] },

  // ─── Carnes ───────────────────────────────────────────────
  { id: "cl:pollo_asado", name: "Pollo asado (con piel)", aliases: ["pollo asado", "pollo rostizado", "trutro asado", "pollo al horno"], category: "carnes", group: "proteina_magra", nova: 1, usda: "Chicken, broilers or fryers, meat and skin, cooked, roasted", servings: [["1 presa (trutro)", 150], ["¼ de pollo", 250]] },
  { id: "cl:alitas", name: "Alitas de pollo", aliases: ["alitas", "alas de pollo"], category: "carnes", group: "proteina_magra", nova: 1, usda: "Chicken, broilers or fryers, wing, meat and skin, cooked, roasted", servings: [["5 alitas", 150]] },
  { id: "cl:pavo", name: "Pavo asado (pechuga)", aliases: ["pavo", "pechuga de pavo asada"], category: "carnes", group: "proteina_magra", nova: 1, usda: "Turkey, retail parts, breast, meat only, cooked, roasted", servings: [["1 porción", 120]] },
  { id: "cl:pavo_laminado", name: "Pechuga de pavo laminada (fiambre)", aliases: ["jamón de pavo", "pavo laminado", "fiambre de pavo"], category: "carnes", group: "embutido", nova: 4, usda: "Turkey breast, sliced, prepackaged", servings: [["2 láminas", 30]] },
  { id: "cl:posta", name: "Posta / bistec magro", aliases: ["posta", "posta rosada", "posta negra", "escalopa", "bistec", "pollo ganso", "carne roja", "carne de vacuno", "carne de res", "vacuno"], category: "carnes", group: "carne_roja", nova: 1, usda: VACUNO, servings: [["1 bistec", 150]] },
  { id: "cl:lomo_vetado", name: "Lomo vetado / entrecot", aliases: ["lomo vetado", "entrecot", "ribeye", "lomo liso"], category: "carnes", group: "carne_roja", nova: 1, usda: "Beef, rib eye steak, boneless, lip off, separable lean and fat, trimmed to 0\" fat, choice, cooked, grilled", servings: [["1 porción", 200]] },
  { id: "cl:plateada", name: "Plateada (al jugo)", aliases: ["plateada"], category: "carnes", group: "carne_roja", nova: 1, usda: "Beef, chuck, blade roast, separable lean and fat, trimmed to 0\" fat, all grades, cooked, braised", servings: [["1 porción", 180]] },
  { id: "cl:asado_tira", name: "Asado de tira / costillar de vacuno", aliases: ["asado de tira", "costillar de vacuno", "asado", "tapapecho"], category: "carnes", group: "carne_roja", nova: 1, usda: "Beef, rib, shortribs, separable lean and fat, choice, cooked, braised", servings: [["1 porción", 200]] },
  { id: "cl:costillar_cerdo", name: "Costillar de cerdo", aliases: ["costillar", "costillitas de cerdo", "costilla de cerdo"], category: "carnes", group: "carne_roja", nova: 1, usda: "Pork, fresh, spareribs, separable lean and fat, cooked, braised", servings: [["1 porción", 200]] },
  // "1 porción de pulpa de cerdo" no estaba (2026-10-11): el mensaje entero se iba al modelo
  { id: "cl:pulpa_cerdo", name: "Pulpa de cerdo", aliases: ["pulpa de cerdo", "pierna de cerdo", "pulpa pierna de cerdo", "carne de cerdo", "cerdo"], category: "carnes", group: "carne_roja", nova: 1, usda: "Pork, fresh, leg (ham), whole, separable lean and fat, cooked, roasted", servings: [["1 presa", 120]] },
  { id: "cl:chuleta_cerdo", name: "Chuleta de cerdo", aliases: ["chuleta", "chuletas de cerdo"], category: "carnes", group: "carne_roja", nova: 1, usda: "Pork, fresh, loin, center rib (chops), bone-in, separable lean and fat, cooked, pan-fried", servings: [["1 chuleta", 150]] },
  { id: "cl:cordero", name: "Cordero asado", aliases: ["cordero", "cordero al palo"], category: "carnes", group: "carne_roja", nova: 1, usda: "Lamb, domestic, leg, whole (shank and sirloin), separable lean and fat, trimmed to 1/4\" fat, choice, cooked, roasted", servings: [["1 porción", 150]] },
  { id: "cl:higado", name: "Hígado de vacuno", aliases: ["hígado", "higado encebollado"], category: "carnes", group: "carne_roja", nova: 1, usda: "Beef, variety meats and by-products, liver, cooked, pan-fried", servings: [["1 bistec", 100]] },
  { id: "cl:hamburguesa_casera", name: "Hamburguesa de vacuno (solo la carne)", aliases: ["hamburguesa casera", "churrasco de hamburguesa", "carne de hamburguesa"], category: "carnes", group: "carne_roja", nova: 3, usda: "Beef, ground, 80% lean meat / 20% fat, patty, cooked, pan-broiled", servings: [["1 unidad", 100]] },
  { id: "cl:prieta", name: "Prieta", aliases: ["morcilla", "prietas"], category: "carnes", group: "embutido", nova: 4, usda: "Blood sausage", servings: [["1 unidad", 100]] },
  { id: "cl:chorizo", name: "Chorizo", aliases: ["chorizos", "chorizo parrillero"], category: "carnes", group: "embutido", nova: 4, usda: 173859, servings: [["1 unidad", 80]] },
  { id: "cl:salame", name: "Salame", aliases: ["salami"], category: "carnes", group: "embutido", nova: 4, usda: "Salami, Italian, pork", servings: [["4 láminas", 20]] },
  { id: "cl:mortadela", name: "Mortadela", aliases: ["mortadela"], category: "carnes", group: "embutido", nova: 4, usda: "Mortadella, beef, pork", servings: [["2 láminas", 30]] },
  { id: "cl:tocino", name: "Tocino", aliases: ["tocineta", "bacon", "panceta"], category: "carnes", group: "embutido", nova: 4, usda: "Pork, cured, bacon, cooked, pan-fried", servings: [["2 lonjas", 16]] },
  { id: "cl:charqui", name: "Charqui", aliases: ["charqui de vacuno", "carne seca"], category: "carnes", group: "carne_roja", nova: 3, usda: "Snacks, beef jerky, chopped and formed", servings: [["1 porción", 30]] },

  // ─── Pescados y mariscos ──────────────────────────────────
  { id: "cl:reineta", name: "Reineta (plancha/horno)", aliases: ["reineta", "pescado a la plancha"], category: "pescados", group: "pescado", nova: 1, usda: "Fish, cod, Atlantic, cooked, dry heat", servings: [["1 filete", 150]] },
  { id: "cl:congrio", name: "Congrio", aliases: ["congrio colorado", "congrio dorado"], category: "pescados", group: "pescado", nova: 1, usda: "Fish, cusk, cooked, dry heat", servings: [["1 trozo", 150]] },
  { id: "cl:jurel_tarro", name: "Jurel en conserva", aliases: ["jurel en lata", "jurel tarro", "jurel"], category: "pescados", group: "pescado", nova: 3, usda: "Fish, mackerel, jack, canned, drained solids", servings: [["½ tarro", 120]] },
  { id: "cl:sardinas", name: "Sardinas en aceite", aliases: ["sardinas", "sardinas en lata"], category: "pescados", group: "pescado", nova: 3, usda: "Fish, sardine, Atlantic, canned in oil, drained solids with bone", servings: [["1 lata", 90]] },
  { id: "cl:atun_aceite", name: "Atún en aceite (lata)", aliases: ["atún en aceite", "atun en aceite"], category: "pescados", group: "pescado", nova: 3, usda: "Fish, tuna, light, canned in oil, drained solids", servings: [["1 lata", 120]] },
  { id: "cl:camarones", name: "Camarones", aliases: ["camarón", "camarones cocidos", "langostinos"], category: "pescados", group: "pescado", nova: 1, usda: 175180, servings: [["1 porción", 100]] },
  { id: "cl:choritos", name: "Choritos / cholgas", aliases: ["choritos", "chorito", "mejillones", "cholgas"], category: "pescados", group: "pescado", nova: 1, usda: "Mollusks, mussel, blue, cooked, moist heat", servings: [["1 taza (sin concha)", 150]] },
  { id: "cl:almejas", name: "Almejas / machas", aliases: ["almejas", "machas", "almeja"], category: "pescados", group: "pescado", nova: 1, usda: "Mollusks, clam, mixed species, cooked, moist heat", servings: [["1 porción", 100]] },
  { id: "cl:jaiba", name: "Jaiba", aliases: ["carne de jaiba", "jaibas"], category: "pescados", group: "pescado", nova: 1, usda: "Crustaceans, crab, blue, cooked, moist heat", servings: [["1 porción", 100]] },
  { id: "cl:pulpo", name: "Pulpo", aliases: ["pulpo cocido"], category: "pescados", group: "pescado", nova: 1, usda: "Mollusks, octopus, common, cooked, moist heat", servings: [["1 porción", 100]] },
  { id: "cl:calamar", name: "Calamar", aliases: ["calamares", "rabas"], category: "pescados", group: "pescado", nova: 1, usda: "Mollusks, squid, mixed species, raw", servings: [["1 porción", 100]] },
  { id: "cl:surimi", name: "Kanikama (surimi)", aliases: ["kanikama", "palitos de cangrejo", "surimi"], category: "pescados", group: "pescado", nova: 4, usda: "Surimi", servings: [["3 palitos", 50]] },
  { id: "cl:pescado_frito", name: "Pescado frito (apanado)", aliases: ["merluza frita", "reineta frita", "pescado apanado", "pescado frito"], category: "pescados", group: "pescado", nova: 3, recipe: [["Fish, cod, Atlantic, raw", 150], [HARINA, 15], ["Egg, whole, raw, fresh", 10], [ACEITE, 15], ["sal", 1]], yield: 170, servings: [["1 filete", 170]] },

  // ─── Lácteos y huevos ─────────────────────────────────────
  { id: "cl:leche_semidescremada", name: "Leche semidescremada", aliases: ["leche semi", "leche semidescremada"], category: "lacteos", group: "lacteo", nova: 1, liquid: true, usda: "Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D", servings: [["1 vaso", 200], ["1 caja", 200]] },
  { id: "cl:leche_chocolate", name: "Leche con chocolate", aliases: ["leche chocolatada", "leche de chocolate", "leche saborizada"], category: "lacteos", group: "lacteo", nova: 4, liquid: true, usda: "Milk, chocolate, fluid, commercial, reduced fat, with added vitamin A and vitamin D", servings: [["1 caja", 200]] },
  { id: "cl:yogur_sabor", name: "Yogur de sabor (batido)", aliases: ["yogur batido", "yogur de frutilla", "yogur con sabor", "yoghurt"], category: "lacteos", group: "lacteo", nova: 4, usda: "Yogurt, fruit, low fat, 9 grams protein per 8 ounce", servings: [["1 pote", 125]] },
  { id: "cl:yogur_griego", name: "Yogur griego natural", aliases: ["yogur griego", "griego"], category: "lacteos", group: "lacteo", nova: 1, usda: "Yogurt, Greek, plain, nonfat", servings: [["1 pote", 110]] },
  { id: "cl:queso_fresco", name: "Queso fresco / de campo", aliases: ["queso fresco", "queso de campo"], category: "lacteos", group: "lacteo", nova: 3, usda: "Cheese, queso fresco", servings: [["1 trozo", 30]] },
  { id: "cl:queso_crema", name: "Queso crema", aliases: ["philadelphia", "queso untable"], category: "lacteos", group: "lacteo", nova: 3, usda: "Cheese, cream", servings: [["1 cucharada", 15]] },
  { id: "cl:queso_parmesano", name: "Queso parmesano rallado", aliases: ["parmesano", "queso rallado"], category: "lacteos", group: "lacteo", nova: 3, usda: "Cheese, parmesan, grated", servings: [["1 cucharada", 5]] },
  { id: "cl:queso_mantecoso", name: "Queso mantecoso", aliases: ["mantecoso", "queso chanco"], category: "lacteos", group: "lacteo", nova: 3, usda: "Cheese, muenster", servings: [["1 lámina", 20]] },
  { id: "cl:crema_leche", name: "Crema de leche", aliases: ["crema", "nata", "crema para batir"], category: "lacteos", group: "grasa", nova: 1, usda: "Cream, fluid, heavy whipping", servings: [["1 cucharada", 15]] },
  { id: "cl:leche_condensada", name: "Leche condensada", aliases: ["condensada"], category: "dulces", group: "dulce", nova: 3, usda: "Milk, canned, condensed, sweetened", servings: [["1 cucharada", 20]] },
  { id: "cl:manjar", name: "Manjar", aliases: ["dulce de leche", "manjar blanco"], category: "dulces", group: "dulce", nova: 4, usda: "Dulce de Leche", servings: [["1 cucharada", 20]] },
  { id: "cl:huevo_frito", name: "Huevo frito", aliases: ["huevo frito", "huevos fritos"], category: "lacteos", group: "huevo", nova: 1, usda: HUEVO_FRITO, servings: [["1 unidad", 46]] },
  { id: "cl:huevos_revueltos", name: "Huevos revueltos", aliases: ["huevos revueltos", "revuelto", "omelette"], category: "lacteos", group: "huevo", nova: 1, usda: "Egg, whole, cooked, scrambled", servings: [["2 huevos", 110]] },
  { id: "cl:huevo_duro", name: "Huevo duro", aliases: ["huevo cocido", "huevo duro"], category: "lacteos", group: "huevo", nova: 1, usda: "Egg, whole, cooked, hard-boiled", servings: [["1 unidad", 50]] },
  { id: "cl:tortilla_verduras", name: "Tortilla de verduras", aliases: ["tortilla de acelga", "tortilla de zapallo italiano", "tortilla de espinaca", "tortilla de porotos verdes"], category: "platos", group: "plato_casero", nova: 1, recipe: [["Egg, whole, raw, fresh", 100], ["Chard, swiss, cooked, boiled, drained, without salt", 80], [CEBOLLA, 20], [ACEITE, 10], ["sal", 1]], yield: 190, servings: [["1 porción", 190]] },

  // ─── Grasas, aderezos, frutos secos ───────────────────────
  { id: "cl:margarina", name: "Margarina", aliases: ["margarina"], category: "aderezos", group: "grasa", nova: 4, usda: "Margarine, regular, 80% fat, composite, stick, with salt", servings: [["1 cucharadita", 5]] },
  { id: "cl:salsa_tomates", name: "Salsa de tomates para pasta (pomarola)", aliases: ["pomarola", "salsa para pasta", "salsa de tomates"], category: "aderezos", group: "otro", nova: 4, usda: "Sauce, pasta, spaghetti/marinara, ready-to-serve", servings: [["½ taza", 125]] },
  { id: "cl:salsa_soya", name: "Salsa de soya", aliases: ["soya", "salsa soya", "shoyu"], category: "aderezos", group: "otro", nova: 3, usda: "Soy sauce made from soy and wheat (shoyu)", servings: [["1 cucharada", 16]] },
  { id: "cl:mantequilla_mani", name: "Mantequilla de maní", aliases: ["mantequilla de mani", "peanut butter", "crema de maní"], category: "snacks", group: "frutos_secos", nova: 3, usda: "Peanut butter, smooth style, with salt", servings: [["1 cucharada", 16]] },
  { id: "cl:mani_salado", name: "Maní salado", aliases: ["maní salado", "mani salado", "maní tostado salado"], category: "snacks", group: "frutos_secos", nova: 3, usda: "Peanuts, all types, oil-roasted, with salt", servings: [["1 puñado", 30]] },
  { id: "cl:pistachos", name: "Pistachos", aliases: ["pistacho"], category: "snacks", group: "frutos_secos", nova: 3, usda: "Nuts, pistachio nuts, dry roasted, with salt added", servings: [["1 puñado", 30]] },
  { id: "cl:chia", name: "Semillas de chía", aliases: ["chía", "chia"], category: "snacks", group: "frutos_secos", nova: 1, usda: "Seeds, chia seeds, dried", servings: [["1 cucharada", 12]] },
  { id: "cl:linaza", name: "Linaza", aliases: ["semillas de linaza", "linaza molida"], category: "snacks", group: "frutos_secos", nova: 1, usda: "Seeds, flaxseed", servings: [["1 cucharada", 10]] },
  { id: "cl:semillas_maravilla", name: "Semillas de maravilla", aliases: ["pepas de maravilla", "semillas de girasol"], category: "snacks", group: "frutos_secos", nova: 3, usda: "Seeds, sunflower seed kernels, dry roasted, with salt added", servings: [["1 puñado", 30]] },
  { id: "cl:frutos_secos_mix", name: "Mix de frutos secos", aliases: ["mix de frutos secos", "frutos secos", "mezcla de frutos secos"], category: "snacks", group: "frutos_secos", nova: 3, usda: "Nuts, mixed nuts, dry roasted, with peanuts, salt added", servings: [["1 puñado", 30]] },

  // ─── Snacks ───────────────────────────────────────────────
  { id: "cl:papas_chips", name: "Papas fritas de bolsa (chips)", aliases: ["papas de bolsa", "papas lays", "chips", "papas fritas de bolsa", "papitas"], category: "snacks", group: "snack_salado", nova: 4, usda: "Snacks, potato chips, plain, salted", servings: [["1 bolsa chica", 40], ["1 porción", 30]] },
  { id: "cl:ramitas", name: "Ramitas", aliases: ["ramitas saladas", "pretzels"], category: "snacks", group: "snack_salado", nova: 4, usda: "Snacks, pretzels, hard, plain, salted", servings: [["1 bolsa chica", 40]] },
  { id: "cl:sufles", name: "Suflés (maíz inflado)", aliases: ["suflés", "sufles", "chizitos", "cheetos"], category: "snacks", group: "snack_salado", nova: 4, usda: "Snacks, cheese puffs and twists, corn based, baked, low fat", servings: [["1 bolsa chica", 40]] },
  { id: "cl:nachos", name: "Nachos / Doritos", aliases: ["doritos", "nachos", "tortilla chips"], category: "snacks", group: "snack_salado", nova: 4, usda: "Snacks, tortilla chips, nacho cheese", servings: [["1 bolsa chica", 40]] },
  { id: "cl:cabritas", name: "Cabritas", aliases: ["palomitas", "popcorn", "cabritas saladas", "cabritas de microondas"], category: "snacks", group: "snack_salado", nova: 4, usda: "Snacks, popcorn, microwave, regular (butter) flavor, made with palm oil", servings: [["1 porción", 30], ["1 bolsa de microondas", 85]] },

  // ─── Dulces ───────────────────────────────────────────────
  { id: "cl:galletas_rellenas", name: "Galletas rellenas (tipo Tritón / Oreo)", aliases: ["galletas", "galleta", "tritón", "triton", "morocha", "oreo", "galletas rellenas", "galletas de chocolate"], category: "dulces", group: "dulce", nova: 4, usda: "Cookies, chocolate sandwich, with creme filling, regular", servings: [["3 galletas", 36], ["1 paquete individual", 42]] },
  { id: "cl:galletas_vino", name: "Galletas de vino / María", aliases: ["galletas de vino", "galletas maría", "galletas maria", "galletas de champaña", "galletas de mantequilla"], category: "dulces", group: "dulce", nova: 4, usda: "Cookies, butter, commercially prepared, enriched", servings: [["4 galletas", 30]] },
  { id: "cl:alfajor", name: "Alfajor", aliases: ["alfajores", "alfajor de chocolate"], category: "dulces", group: "dulce", nova: 4, usda: "Cookies, chocolate sandwich, with extra creme filling", servings: [["1 unidad", 50]] },
  { id: "cl:chocolate_leche", name: "Chocolate de leche", aliases: ["chocolate", "barra de chocolate", "chocolate con leche", "sahne-nuss", "trencito"], category: "dulces", group: "dulce", nova: 4, usda: "Candies, milk chocolate", servings: [["1 barra chica", 30], ["2 cuadros", 10]] },
  { id: "cl:gomitas", name: "Gomitas", aliases: ["dulces de goma", "ositos de goma", "gomas"], category: "dulces", group: "dulce", nova: 4, usda: "Candies, gumdrops, starch jelly pieces", servings: [["1 bolsita", 30]] },
  { id: "cl:caramelos", name: "Caramelos", aliases: ["calugas", "chupetes"], category: "dulces", group: "dulce", nova: 4, usda: "Candies, hard", servings: [["3 unidades", 15]] },
  { id: "cl:helado", name: "Helado de crema", aliases: ["helado", "helado de vainilla", "helado de chocolate", "barquillo"], category: "dulces", group: "dulce", nova: 4, usda: "Ice creams, vanilla", servings: [["1 bola", 70], ["1 pote individual", 120]] },
  { id: "cl:helado_agua", name: "Helado de agua", aliases: ["helado de palito", "helado de hielo"], category: "dulces", group: "dulce", nova: 4, usda: "Frozen novelties, ice type, pop", servings: [["1 unidad", 60]] },
  { id: "cl:flan", name: "Flan", aliases: ["flan de vainilla", "postre de caramelo"], category: "dulces", group: "dulce", nova: 4, usda: "Desserts, flan, caramel custard, prepared-from-recipe", servings: [["1 pote", 100]] },
  { id: "cl:jalea", name: "Jalea (gelatina)", aliases: ["gelatina", "jalea"], category: "dulces", group: "dulce", nova: 4, usda: "Gelatin desserts, dry mix, prepared with water", servings: [["1 pote", 120]] },
  { id: "cl:mermelada", name: "Mermelada", aliases: ["mermelada de frutilla", "mermelada de damasco", "dulce de membrillo"], category: "dulces", group: "dulce", nova: 4, usda: "Jams and preserves", servings: [["1 cucharada", 20]] },
  { id: "cl:kuchen", name: "Kuchen", aliases: ["kuchen de manzana", "kuchen de nuez", "kuchen de frambuesa", "tarta de fruta"], category: "dulces", group: "dulce", nova: 4, usda: "Pie, apple, commercially prepared, enriched flour", servings: [["1 trozo", 100]] },
  { id: "cl:torta", name: "Torta (bizcocho con crema o manjar)", aliases: ["torta", "torta de cumpleaños", "torta tres leches", "torta de manjar", "torta de chocolate", "pastel"], category: "dulces", group: "dulce", nova: 4, usda: "Cake, chocolate, commercially prepared with chocolate frosting, in-store bakery", servings: [["1 trozo", 100]] },
  { id: "cl:queque", name: "Queque", aliases: ["bizcocho", "queque marmolado", "budín"], category: "dulces", group: "dulce", nova: 4, usda: "Cake, pound, commercially prepared, butter (includes fresh and frozen)", servings: [["1 trozo", 60]] },
  { id: "cl:berlin", name: "Berlín", aliases: ["berlines", "berlín de crema", "berlín de manjar", "berlin"], category: "dulces", group: "dulce", nova: 4, usda: "Doughnuts, yeast-leavened, with creme filling", servings: [["1 unidad", 85]] },
  { id: "cl:donut", name: "Donut", aliases: ["dona", "donas", "donuts"], category: "dulces", group: "dulce", nova: 4, usda: "Doughnuts, yeast-leavened, glazed, enriched (includes honey buns)", servings: [["1 unidad", 60]] },
  { id: "cl:medialuna", name: "Medialuna / croissant", aliases: ["croissant", "medialunas", "cachito"], category: "dulces", group: "dulce", nova: 4, usda: "Croissants, butter", servings: [["1 unidad", 57]] },
  { id: "cl:pie_limon", name: "Pie de limón", aliases: ["pie de limon", "pie"], category: "dulces", group: "dulce", nova: 4, usda: "Pie, lemon meringue, commercially prepared", servings: [["1 trozo", 110]] },
  { id: "cl:pan_pascua", name: "Pan de pascua", aliases: ["pan de pascua"], category: "dulces", group: "dulce", nova: 4, usda: "Cake, fruitcake, commercially prepared", servings: [["1 trozo", 60]] },
  { id: "cl:churros", name: "Churros", aliases: ["churro", "churros rellenos"], category: "dulces", group: "dulce", nova: 3, recipe: [[HARINA, 35], ["agua", 35], [ACEITE, 12], [AZUCAR, 8]], yield: 65, servings: [["2 unidades", 60]] },
  { id: "cl:picarones", name: "Picarones (con chancaca)", aliases: ["picarones", "picarón"], category: "dulces", group: "dulce", nova: 3, recipe: [[HARINA, 40], [ZAPALLO, 40], [ACEITE, 15], [AZUCAR_RUBIA, 20]], yield: 100, servings: [["3 unidades con chancaca", 100]] },
  { id: "cl:sopaipillas_pasadas", name: "Sopaipillas pasadas", aliases: ["sopaipillas pasadas", "sopaipilla pasada", "sopaipillas con chancaca", "sopapillas pasadas"], category: "dulces", group: "dulce", nova: 3, recipe: [[HARINA, 50], [ZAPALLO, 25], [ACEITE, 18], [AZUCAR_RUBIA, 30], ["agua", 20]], yield: 130, servings: [["2 unidades con chancaca", 130]] },
  { id: "cl:calzones_rotos", name: "Calzones rotos", aliases: ["calzón roto"], category: "dulces", group: "dulce", nova: 3, recipe: [[HARINA, 45], ["Egg, whole, raw, fresh", 10], [MANTEQUILLA, 5], [AZUCAR, 15], [ACEITE, 12]], yield: 80, servings: [["3 unidades", 60]] },
  { id: "cl:leche_asada", name: "Leche asada", aliases: ["leche asada"], category: "dulces", group: "dulce", nova: 3, recipe: [[LECHE, 150], ["Egg, whole, raw, fresh", 50], [AZUCAR, 30]], yield: 200, servings: [["1 porción", 120]] },
  { id: "cl:semola_leche", name: "Sémola con leche", aliases: ["sémola", "semola con leche"], category: "dulces", group: "dulce", nova: 3, recipe: [[LECHE, 200], ["Semolina, enriched", 25], [AZUCAR, 20]], yield: 220, servings: [["1 pote", 200]] },
  { id: "cl:mote_huesillo", name: "Mote con huesillo", aliases: ["mote con huesillos", "huesillos"], category: "bebidas", group: "bebida_azucarada", nova: 3, liquid: true, recipe: [["Bulgur, cooked", 60], ["Peaches, dried, sulfured, uncooked", 40], [AZUCAR_RUBIA, 35], ["agua", 215]], servings: [["1 vaso", 350]] },

  // ─── Bebidas ──────────────────────────────────────────────
  { id: "cl:bebida_azucar", name: "Bebida gaseosa con azúcar", aliases: ["bebida", "gaseosa", "fanta", "sprite", "bilz", "pap", "kem", "bebida de naranja"], category: "bebidas", group: "bebida_azucarada", nova: 4, liquid: true, usda: "Beverages, carbonated, orange", servings: [["1 lata", 350], ["1 vaso", 250], ["1 botella chica", 500]] },
  { id: "cl:jugo_polvo", name: "Jugo en polvo con azúcar (preparado)", aliases: ["jugo en polvo", "zuko", "jugo de sobre"], category: "bebidas", group: "bebida_azucarada", nova: 4, liquid: true, usda: 175115, servings: [["1 vaso", 250]] },
  { id: "cl:nectar", name: "Néctar de fruta", aliases: ["néctar", "nectar", "jugo en caja", "jugo watts", "jugo de caja"], category: "bebidas", group: "bebida_azucarada", nova: 4, liquid: true, usda: 168185, servings: [["1 vaso", 200], ["1 cajita", 200]] },
  { id: "cl:energetica", name: "Bebida energética", aliases: ["energética", "red bull", "monster", "bebida energetica"], category: "bebidas", group: "bebida_azucarada", nova: 4, liquid: true, usda: "Beverages, Energy drink, RED BULL", servings: [["1 lata", 250], ["1 lata grande", 473]] },
  { id: "cl:isotonica", name: "Bebida isotónica", aliases: ["gatorade", "powerade", "isotónica"], category: "bebidas", group: "bebida_azucarada", nova: 4, liquid: true, usda: "Beverages, The COCA-COLA company, Powerade, lemon-lime flavored, ready-to-drink", servings: [["1 botella", 500]] },
  { id: "cl:limonada", name: "Limonada", aliases: ["limonada", "limonada con azúcar"], category: "bebidas", group: "bebida_azucarada", nova: 3, liquid: true, recipe: [["Lemon juice, raw", 30], [AZUCAR, 20], ["agua", 200]], servings: [["1 vaso", 250]] },
  { id: "cl:cafe_leche", name: "Café con leche", aliases: ["cortado", "latte", "café cortado", "cafe con leche"], category: "bebidas", group: "lacteo", nova: 1, liquid: true, recipe: [["Beverages, coffee, brewed, prepared with tap water", 150], [LECHE, 100]], servings: [["1 taza", 250]] },
  { id: "cl:chocolate_caliente", name: "Chocolate caliente", aliases: ["chocolate caliente", "leche con chocolate caliente", "cola cao", "milo"], category: "bebidas", group: "lacteo", nova: 4, liquid: true, recipe: [[LECHE, 220], ["Cocoa mix, powder", 25]], servings: [["1 taza", 245]] },
  { id: "cl:leche_almendras", name: "Bebida de almendras", aliases: ["leche de almendras", "bebida de almendra"], category: "bebidas", group: "bebida_sin_azucar", nova: 4, liquid: true, usda: "Beverages, almond milk, unsweetened, shelf stable", servings: [["1 vaso", 200]] },
  { id: "cl:cerveza", name: "Cerveza", aliases: ["chela", "schop", "cerveza rubia", "lager"], category: "bebidas", group: "alcohol", nova: 3, liquid: true, usda: "Alcoholic beverage, beer, regular, all", servings: [["1 lata", 350], ["1 lata grande", 470], ["1 schop", 500]] },
  { id: "cl:vino_tinto", name: "Vino tinto", aliases: ["vino", "copa de vino", "tinto"], category: "bebidas", group: "alcohol", nova: 3, liquid: true, usda: "Alcoholic beverage, wine, table, red", servings: [["1 copa", 150]] },
  { id: "cl:vino_blanco", name: "Vino blanco", aliases: ["copa de vino blanco"], category: "bebidas", group: "alcohol", nova: 3, liquid: true, usda: VINO_BLANCO, servings: [["1 copa", 150]] },
  { id: "cl:piscola", name: "Piscola", aliases: ["piscola", "pisco con coca", "pisco con bebida"], category: "bebidas", group: "alcohol", nova: 4, liquid: true, recipe: [[PISCO, 60], ["Beverages, carbonated, cola, regular", 190]], servings: [["1 vaso", 250]] },
  { id: "cl:pisco_sour", name: "Pisco sour", aliases: ["pisco sour", "sour"], category: "bebidas", group: "alcohol", nova: 4, liquid: true, recipe: [[PISCO, 60], ["Lemon juice, raw", 30], [AZUCAR, 20], ["Egg, white, raw, fresh", 10], ["agua", 30]], servings: [["1 copa", 150]] },
  { id: "cl:terremoto", name: "Terremoto", aliases: ["terremoto"], category: "bebidas", group: "alcohol", nova: 4, liquid: true, recipe: [[VINO_BLANCO, 250], ["Sherbet, orange", 80], [AZUCAR, 15]], servings: [["1 vaso", 345]] },

  // ─── Comida rápida ────────────────────────────────────────
  { id: "cl:pizza", name: "Pizza (trozo)", aliases: ["pizza", "pizza napolitana", "pizza de pepperoni", "pizza familiar", "trozo de pizza"], category: "comida_rapida", group: "comida_rapida", nova: 4, usda: "Fast foods, pizza chain, 14\" pizza, pepperoni topping, regular crust", servings: [["1 trozo", 110], ["2 trozos", 220]] },
  { id: "cl:hamburguesa_local", name: "Hamburguesa de local (con pan y salsas)", aliases: ["hamburguesa", "big mac", "whopper", "cuarto de libra", "hamburguesa doble"], category: "comida_rapida", group: "comida_rapida", nova: 4, usda: "McDONALD'S, BIG MAC", servings: [["1 unidad", 215]] },
  { id: "cl:pollo_frito", name: "Pollo frito (apanado)", aliases: ["pollo frito", "pollo kfc", "pollo broaster", "pollo apanado", "pollo crispy"], category: "comida_rapida", group: "comida_rapida", nova: 4, usda: "KFC, Fried Chicken, ORIGINAL RECIPE, Breast, meat and skin with breading", servings: [["1 presa", 160]] },
  { id: "cl:nuggets", name: "Nuggets de pollo", aliases: ["nuggets", "nugget", "tenders"], category: "comida_rapida", group: "comida_rapida", nova: 4, usda: "Fast foods, chicken tenders", servings: [["6 unidades", 100]] },
  { id: "cl:fideos_instantaneos", name: "Fideos instantáneos (ramen)", aliases: ["ramen", "maruchan", "fideos instantáneos", "cup noodles", "fideos de vaso"], category: "comida_rapida", group: "comida_rapida", nova: 4, usda: "Soup, ramen noodle, any flavor, dry", servings: [["1 paquete (seco)", 85]] },
  { id: "cl:churrasco_italiano", name: "Churrasco italiano", aliases: ["churrasco", "churrasco palta tomate mayo"], category: "comida_rapida", group: "comida_rapida", nova: 3, recipe: [[MARRAQUETA, 120], [VACUNO, 100], [PALTA, 60], [TOMATE, 50], [MAYO, 20], ["sal", 1]], servings: [["1 unidad", 350]] },
  { id: "cl:barros_luco", name: "Barros Luco", aliases: ["barros luco"], category: "comida_rapida", group: "comida_rapida", nova: 3, recipe: [[MARRAQUETA, 120], [VACUNO, 100], [GAUDA, 40], ["sal", 0.8]], servings: [["1 unidad", 260]] },
  { id: "cl:barros_jarpa", name: "Barros Jarpa", aliases: ["barros jarpa"], category: "comida_rapida", group: "comida_rapida", nova: 3, recipe: [[MARRAQUETA, 120], [JAMON, 40], [GAUDA, 40]], servings: [["1 unidad", 200]] },
  { id: "cl:chacarero", name: "Chacarero", aliases: ["chacarero"], category: "comida_rapida", group: "comida_rapida", nova: 3, recipe: [[MARRAQUETA, 120], [VACUNO, 100], ["Beans, snap, green, cooked, boiled, drained, without salt", 50], [TOMATE, 50], [MAYO, 15], ["sal", 1]], servings: [["1 unidad", 335]] },
  { id: "cl:as_italiano", name: "As italiano", aliases: ["as", "as italiano"], category: "comida_rapida", group: "comida_rapida", nova: 3, recipe: [[PAN_COMPLETO, 80], [VACUNO, 80], [PALTA, 60], [TOMATE, 50], [MAYO, 20], ["sal", 0.8]], servings: [["1 unidad", 290]] },
  { id: "cl:lomito_italiano", name: "Lomito italiano", aliases: ["lomito", "lomito palta"], category: "comida_rapida", group: "comida_rapida", nova: 3, recipe: [[PAN_COMPLETO, 90], ["Pork, fresh, loin, whole, separable lean and fat, cooked, roasted", 100], [PALTA, 60], [TOMATE, 50], [MAYO, 20], ["sal", 1]], servings: [["1 unidad", 320]] },
  { id: "cl:completo_tradicional", name: "Completo tradicional (chucrut y mayo)", aliases: ["completo tradicional", "completo chucrut"], category: "comida_rapida", group: "comida_rapida", nova: 4, recipe: [[PAN_COMPLETO, 70], ["Frankfurter, beef, unheated", 50], ["Sauerkraut, canned, solids and liquids", 30], [TOMATE, 40], [MAYO, 20]], servings: [["1 unidad", 210]] },
  { id: "cl:choripan", name: "Choripán", aliases: ["choripan", "choripán"], category: "comida_rapida", group: "comida_rapida", nova: 4, recipe: [[MARRAQUETA, 80], [173859, 80], [TOMATE, 20], [CEBOLLA, 10]], servings: [["1 unidad", 190]] },
  { id: "cl:salchipapas", name: "Salchipapas", aliases: ["salchipapa"], category: "comida_rapida", group: "comida_rapida", nova: 4, recipe: [[PAPAS_FRITAS, 150], ["Frankfurter, beef, unheated", 60], ["Catsup", 10], [MAYO, 10]], servings: [["1 porción", 230]] },
  { id: "cl:shawarma", name: "Shawarma", aliases: ["shawarma de pollo", "durum", "shawarma mixto"], category: "comida_rapida", group: "comida_rapida", nova: 3, recipe: [["Bread, pita, white, enriched", 80], ["Chicken, broilers or fryers, thigh, meat only, cooked, roasted", 100], [MAYO, 25], [TOMATE, 30], ["Lettuce, cos or romaine, raw", 20], ["sal", 1]], servings: [["1 unidad", 255]] },
  { id: "cl:sushi", name: "Sushi (roll)", aliases: ["sushi", "roll", "handroll", "california roll", "roll de salmón"], category: "comida_rapida", group: "comida_rapida", nova: 3, recipe: [["Rice, white, short-grain, enriched, cooked", 150], ["Fish, salmon, Atlantic, farmed, raw", 40], ["Cheese, cream", 25], [PALTA, 20], ["Seaweed, laver, raw", 3], [AZUCAR, 5], ["Vinegar, distilled", 5], ["Soy sauce made from soy and wheat (shoyu)", 10]], servings: [["1 roll (10 piezas)", 250], ["1 handroll", 200]] },

  // ─── Platos caseros ───────────────────────────────────────
  { id: "cl:porotos_granados", name: "Porotos granados", aliases: ["porotos granados", "granados"], category: "platos", group: "plato_casero", nova: 1, recipe: [["Beans, cranberry (roman), mature seeds, cooked, boiled, without salt", 150], ["Corn, sweet, yellow, cooked, boiled, drained, without salt", 60], [ZAPALLO, 80], [CEBOLLA, 30], [ACEITE, 8], ["agua", 100], ["sal", 3]], servings: [["1 plato", 400]] },
  { id: "cl:caldillo_congrio", name: "Caldillo de congrio", aliases: ["caldillo", "caldillo de pescado"], category: "platos", group: "plato_casero", nova: 1, recipe: [[CUSK, 150], [PAPA, 100], [ZANAHORIA, 30], [CEBOLLA, 30], [TOMATE, 40], [ACEITE, 8], ["agua", 200], ["sal", 3]], servings: [["1 plato", 500]] },
  { id: "cl:paila_marina", name: "Paila marina", aliases: ["paila", "paila marina"], category: "platos", group: "plato_casero", nova: 1, recipe: [["Mollusks, mussel, blue, cooked, moist heat", 80], ["Mollusks, clam, mixed species, cooked, moist heat", 60], [CUSK, 80], [CEBOLLA, 30], [ACEITE, 8], [VINO_BLANCO, 30], ["agua", 200], ["sal", 3]], servings: [["1 plato", 480]] },
  { id: "cl:pastel_jaiba", name: "Pastel de jaiba", aliases: ["pastel de jaibas", "chupe de jaiba", "chupe de jaibas"], category: "platos", group: "plato_casero", nova: 3, recipe: [["Crustaceans, crab, blue, cooked, moist heat", 100], [MARRAQUETA, 30], [LECHE, 60], ["Cheese, parmesan, grated", 15], [CEBOLLA, 30], [MANTEQUILLA, 10], ["Cream, fluid, heavy whipping", 30], ["sal", 1.5]], yield: 250, servings: [["1 porción", 250]] },
  { id: "cl:machas_parmesana", name: "Machas a la parmesana", aliases: ["machas a la parmesana", "machas parmesana"], category: "platos", group: "plato_casero", nova: 3, recipe: [["Mollusks, clam, mixed species, cooked, moist heat", 100], ["Cheese, parmesan, grated", 25], [MANTEQUILLA, 10], [VINO_BLANCO, 10]], servings: [["6 machas", 145]] },
  { id: "cl:pollo_arvejado", name: "Pollo arvejado", aliases: ["pollo arvejado", "pollo con arvejas"], category: "platos", group: "plato_casero", nova: 1, recipe: [["Chicken, broilers or fryers, thigh, meat only, cooked, stewed", 150], ["Peas, green, cooked, boiled, drained, without salt", 80], [ZANAHORIA, 50], [CEBOLLA, 30], [ACEITE, 8], ["agua", 80], ["sal", 3]], servings: [["1 plato", 400]] },
  { id: "cl:pollo_arroz", name: "Pollo con arroz", aliases: ["pollo con arroz", "arroz con pollo"], category: "platos", group: "plato_casero", nova: 1, recipe: [["Chicken, broilers or fryers, thigh, meat only, cooked, roasted", 120], [ARROZ, 180], ["sal", 1.5]], servings: [["1 plato", 300]] },
  { id: "cl:lomo_pobre", name: "Lomo a lo pobre", aliases: ["a lo pobre", "bistec a lo pobre", "lomo a lo pobre"], category: "platos", group: "plato_casero", nova: 3, recipe: [["Beef, tenderloin, steak, separable lean and fat, trimmed to 1/8\" fat, all grades, cooked, broiled", 200], [PAPAS_FRITAS, 200], [HUEVO_FRITO, 92], [CEBOLLA, 60], [ACEITE, 15], ["sal", 1.5]], yield: 550, servings: [["1 plato", 550]] },
  { id: "cl:pastel_papas", name: "Pastel de papas", aliases: ["pastel de papa"], category: "platos", group: "plato_casero", nova: 1, recipe: [["Beef, ground, 80% lean meat / 20% fat, crumbles, cooked, pan-browned", 100], [CEBOLLA, 60], [ACEITE, 8], ["Egg, whole, cooked, hard-boiled", 15], ["Potatoes, mashed, home-prepared, whole milk and butter added", 200], ["sal", 0.5]], yield: 370, servings: [["1 porción", 370]] },
  { id: "cl:pantrucas", name: "Pantrucas", aliases: ["pantrucas", "sopa de pantrucas"], category: "platos", group: "plato_casero", nova: 1, recipe: [[HARINA, 50], ["Egg, whole, raw, fresh", 15], [PAPA, 60], [CEBOLLA, 20], [VACUNO, 30], [ACEITE, 5], ["agua", 230], ["sal", 3]], servings: [["1 plato", 410]] },
  { id: "cl:arroz_chaufa", name: "Arroz chaufa", aliases: ["chaufa", "arroz frito", "arroz chaufa"], category: "platos", group: "plato_casero", nova: 3, recipe: [[ARROZ, 200], ["Egg, whole, raw, fresh", 40], [POLLO, 60], ["Soy sauce made from soy and wheat (shoyu)", 10], [ACEITE, 10], ["Onions, spring or scallions (includes tops and bulb), raw", 15]], servings: [["1 plato", 335]] },
  // 2026-10-21 (chats reales): «carne mongoliana» resolvía a un envasado (116 kcal y 8 g de proteína cada 100 g: «eso no es
  // carne mongoliana») y los arrollados primavera no estaban. Comida china-chilena de restaurante.
  { id: "cl:carne_mongoliana", name: "Carne mongoliana", aliases: ["carne mongoliana", "carne mongol", "res mongoliana", "mongolian beef", "carne a la mongoliana"], category: "platos", group: "plato_casero", nova: 3, recipe: [["Beef, flank, steak, separable lean and fat, trimmed to 0\" fat, choice, cooked, broiled", 150], ["Soy sauce made from soy and wheat (shoyu)", 15], [AZUCAR_RUBIA, 12], ["Cornstarch", 6], [ACEITE, 10], ["Onions, spring or scallions (includes tops and bulb), raw", 15], ["Garlic, raw", 3]], servings: [["1 porción (pote)", 250], ["1 plato", 300]] },
  { id: "cl:arrollado_primavera", name: "Arrollado primavera", aliases: ["arrollados primavera", "arrollado primavera", "rollito primavera", "rollitos primavera", "spring roll", "spring rolls", "egg roll", "arrollado chino"], category: "platos", group: "comida_rapida", nova: 3, usda: "Egg rolls, pork, refrigerated, heated", servings: [["1 unidad", 85]] },
  { id: "cl:lasana", name: "Lasaña", aliases: ["lasagna", "lasaña de carne", "canelones"], category: "platos", group: "plato_casero", nova: 3, usda: "Lasagna with meat & sauce, frozen entree", servings: [["1 porción", 250]] },
  { id: "cl:papas_mayo", name: "Papas mayo", aliases: ["papas con mayonesa", "ensalada de papas", "papas mayo"], category: "platos", group: "plato_casero", nova: 3, recipe: [[PAPA, 150], [MAYO, 25], ["sal", 1]], servings: [["1 porción", 176]] },
  { id: "cl:consome", name: "Consomé / caldo", aliases: ["caldo", "consomé de pollo", "consome"], category: "platos", group: "plato_casero", nova: 3, liquid: true, usda: "Soup, chicken broth, ready-to-serve", servings: [["1 taza", 240]] },
  { id: "cl:sopa_sobre", name: "Sopa / crema de sobre (preparada)", aliases: ["sopa de sobre", "sopa maggi", "crema de sobre", "sopa instantánea", "crema de espárragos"], category: "platos", group: "plato_casero", nova: 4, liquid: true, usda: "Soup, chicken noodle, dry, mix, prepared with water", servings: [["1 plato", 250]] },
  { id: "cl:pan_palta", name: "Pan con palta", aliases: ["sándwich de palta"], category: "platos", group: "pan", nova: 3, recipe: [[MARRAQUETA, 85], [PALTA, 60], ["sal", 0.5]], servings: [["1 unidad", 145]] },
  { id: "cl:pan_huevo", name: "Pan con huevo", aliases: [], category: "platos", group: "pan", nova: 3, recipe: [[MARRAQUETA, 85], [HUEVO_FRITO, 46]], servings: [["1 unidad", 131]] },
  { id: "cl:pan_queso", name: "Pan con queso", aliases: [], category: "platos", group: "pan", nova: 3, recipe: [[MARRAQUETA, 85], [GAUDA, 25]], servings: [["1 unidad", 110]] },
  { id: "cl:aliado", name: "Pan con jamón y queso (aliado)", aliases: ["aliado", "sándwich de jamón y queso", "pan con jamón y queso", "jamón queso"], category: "platos", group: "pan", nova: 3, recipe: [[MARRAQUETA, 85], [JAMON, 25], [GAUDA, 25]], servings: [["1 unidad", 135]] },
];

/**
 * Alimentos que ya estaban: se les agrega grupo, procesamiento, si es bebida, y sodio + grasa saturada (de USDA por
 * 100 g, o estimado en los platos chilenos). Sus calorías y macros NO se tocan (ya estaban curados).
 */
export const ENRICH: Record<string, { group: string; nova: number; liquid?: boolean; usda?: string | number; sodium100?: number; satFat100?: number }> = {
  "cl:marraqueta": { group: "pan", nova: 3, usda: MARRAQUETA },
  "cl:hallulla": { group: "pan", nova: 3, usda: "Rolls, dinner, plain, commercially prepared (includes brown-and-serve)" },
  "cl:pan_molde_blanco": { group: "pan", nova: 4, usda: "Bread, white, commercially prepared (includes soft bread crumbs)" },
  "cl:pan_integral": { group: "pan", nova: 4, usda: "Bread, whole-wheat, commercially prepared" },
  "cl:sopaipilla": { group: "pan", nova: 3, sodium100: 450, satFat100: 4 },
  "cl:pan_pita": { group: "pan", nova: 3, usda: "Bread, pita, white, enriched" },
  "cl:arroz_blanco": { group: "cereal_refinado", nova: 1, usda: ARROZ },
  "cl:arroz_integral": { group: "cereal_integral", nova: 1, usda: "Rice, brown, long-grain, cooked" },
  "cl:fideos_cocidos": { group: "cereal_refinado", nova: 1, usda: "Pasta, cooked, enriched, without added salt" },
  "cl:avena": { group: "cereal_integral", nova: 1, usda: "Cereals, oats, regular and quick, not fortified, dry" },
  "cl:quinoa": { group: "cereal_integral", nova: 1, usda: "Quinoa, cooked" },
  "cl:porotos": { group: "legumbre", nova: 1, usda: "Beans, cranberry (roman), mature seeds, cooked, boiled, without salt" },
  "cl:lentejas": { group: "legumbre", nova: 1, usda: "Lentils, mature seeds, cooked, boiled, without salt" },
  "cl:garbanzos": { group: "legumbre", nova: 1, usda: "Chickpeas (garbanzo beans, bengal gram), mature seeds, cooked, boiled, without salt" },
  "cl:arvejas": { group: "legumbre", nova: 1, usda: "Peas, green, cooked, boiled, drained, without salt" },
  "cl:papa": { group: "verdura", nova: 1, usda: PAPA },
  "cl:camote": { group: "verdura", nova: 1, usda: "Sweet potato, cooked, boiled, without skin" },
  "cl:tomate": { group: "verdura", nova: 1, usda: TOMATE },
  "cl:zanahoria": { group: "verdura", nova: 1, usda: ZANAHORIA },
  "cl:palta": { group: "verdura", nova: 1, usda: PALTA },
  "cl:pepino": { group: "verdura", nova: 1, usda: "Cucumber, with peel, raw" },
  "cl:cebolla": { group: "verdura", nova: 1, usda: CEBOLLA },
  "cl:pimenton": { group: "verdura", nova: 1, usda: "Peppers, sweet, red, raw" },
  "cl:brocoli": { group: "verdura", nova: 1, usda: "Broccoli, raw" },
  "cl:espinaca": { group: "verdura", nova: 1, usda: "Spinach, cooked, boiled, drained, without salt" },
  "cl:acelga": { group: "verdura", nova: 1, usda: "Chard, swiss, cooked, boiled, drained, without salt" },
  "cl:zapallo": { group: "verdura", nova: 1, usda: ZAPALLO },
  "cl:choclo": { group: "verdura", nova: 1, usda: "Corn, sweet, yellow, cooked, boiled, drained, without salt" },
  "cl:lechuga": { group: "verdura", nova: 1, usda: "Lettuce, cos or romaine, raw" },
  "cl:ajo": { group: "verdura", nova: 1, usda: "Garlic, raw" },
  "cl:manzana": { group: "fruta", nova: 1, usda: "Apples, raw, with skin (Includes foods for USDA's Food Distribution Program)" },
  "cl:platano": { group: "fruta", nova: 1, usda: "Bananas, raw" },
  "cl:naranja": { group: "fruta", nova: 1, usda: "Oranges, raw, all commercial varieties" },
  "cl:pera": { group: "fruta", nova: 1, usda: "Pears, raw" },
  "cl:uva": { group: "fruta", nova: 1, usda: "Grapes, red or green (European type, such as Thompson seedless), raw" },
  "cl:sandia": { group: "fruta", nova: 1, usda: "Watermelon, raw" },
  "cl:frutilla": { group: "fruta", nova: 1, usda: "Strawberries, raw" },
  "cl:kiwi": { group: "fruta", nova: 1, usda: "Kiwifruit, green, raw" },
  "cl:durazno": { group: "fruta", nova: 1, usda: "Peaches, yellow, raw" },
  "cl:chirimoya": { group: "fruta", nova: 1, usda: "Cherimoya, raw" },
  "cl:lucuma": { group: "fruta", nova: 1, sodium100: 10, satFat100: 0.1 },
  "cl:limon": { group: "fruta", nova: 1, usda: "Lemons, raw, without peel" },
  "cl:pechuga_plancha": { group: "proteina_magra", nova: 1, usda: POLLO },
  "cl:muslo_pollo": { group: "proteina_magra", nova: 1, usda: "Chicken, broilers or fryers, thigh, meat and skin, cooked, roasted" },
  "cl:carne_molida": { group: "carne_roja", nova: 1, usda: "Beef, ground, 80% lean meat / 20% fat, crumbles, cooked, pan-browned" },
  "cl:bife_vacuno": { group: "carne_roja", nova: 1, usda: "Beef, top sirloin, steak, separable lean and fat, trimmed to 1/8\" fat, all grades, cooked, broiled" },
  "cl:merluza": { group: "pescado", nova: 1, usda: "Fish, whiting, mixed species, cooked, dry heat" },
  "cl:salmon": { group: "pescado", nova: 1, usda: "Fish, salmon, Atlantic, farmed, cooked, dry heat" },
  "cl:atun_agua": { group: "pescado", nova: 3, usda: "Fish, tuna, light, canned in water, drained solids" },
  "cl:lomo_cerdo": { group: "carne_roja", nova: 1, usda: "Pork, fresh, loin, whole, separable lean and fat, cooked, roasted" },
  "cl:longaniza": { group: "embutido", nova: 4, usda: "Sausage, pork, fresh, cooked" },
  "cl:vienesa": { group: "embutido", nova: 4, usda: "Frankfurter, beef, unheated" },
  "cl:jamon_cocido": { group: "embutido", nova: 4, usda: JAMON },
  "cl:leche_entera": { group: "lacteo", nova: 1, liquid: true, usda: LECHE },
  "cl:leche_descremada": { group: "lacteo", nova: 1, liquid: true, usda: "Milk, nonfat, fluid, with added vitamin A and vitamin D (fat free or skim)" },
  "cl:yogur_natural": { group: "lacteo", nova: 1, usda: "Yogurt, plain, whole milk" },
  "cl:quesillo": { group: "lacteo", nova: 3, usda: "Cheese, ricotta, part skim milk" },
  "cl:queso_gauda": { group: "lacteo", nova: 3, usda: GAUDA },
  "cl:mantequilla": { group: "grasa", nova: 2, usda: MANTEQUILLA },
  "cl:huevo": { group: "huevo", nova: 1, usda: "Egg, whole, raw, fresh" },
  "cl:clara_huevo": { group: "huevo", nova: 1, usda: "Egg, white, raw, fresh" },
  // Platos chilenos existentes: sodio y grasa saturada por 100 g estimados de recetas caseras típicas
  "cl:cazuela_vacuno": { group: "plato_casero", nova: 1, sodium100: 260, satFat100: 0.8 },
  "cl:cazuela_pollo": { group: "plato_casero", nova: 1, sodium100: 250, satFat100: 0.5 },
  "cl:empanada_horno": { group: "plato_casero", nova: 3, sodium100: 420, satFat100: 4.2 },
  "cl:empanada_frita": { group: "comida_rapida", nova: 3, sodium100: 520, satFat100: 7 },
  "cl:pastel_choclo": { group: "plato_casero", nova: 1, sodium100: 300, satFat100: 1.8 },
  "cl:humitas": { group: "plato_casero", nova: 1, sodium100: 250, satFat100: 1.5 },
  "cl:porotos_riendas": { group: "plato_casero", nova: 1, sodium100: 260, satFat100: 0.4 },
  "cl:charquican": { group: "plato_casero", nova: 1, sodium100: 280, satFat100: 1.6 },
  "cl:carbonada": { group: "plato_casero", nova: 1, sodium100: 260, satFat100: 0.7 },
  "cl:chorrillana": { group: "comida_rapida", nova: 3, sodium100: 480, satFat100: 4.5 },
  "cl:completo_italiano": { group: "comida_rapida", nova: 4, sodium100: 560, satFat100: 4 },
  "cl:arroz_leche": { group: "dulce", nova: 3, sodium100: 50, satFat100: 1.8 },
  "cl:lentejas_guiso": { group: "plato_casero", nova: 1, sodium100: 260, satFat100: 0.6 },
  "cl:fideos_salsa": { group: "plato_casero", nova: 3, sodium100: 280, satFat100: 1 },
  "cl:pure_papas": { group: "plato_casero", nova: 1, usda: "Potatoes, mashed, home-prepared, whole milk and butter added" },
  "cl:aceite_oliva": { group: "grasa", nova: 2, usda: "Oil, olive, salad or cooking" },
  "cl:aceite_vegetal": { group: "grasa", nova: 2, usda: ACEITE },
  "cl:mayonesa": { group: "grasa", nova: 4, usda: MAYO },
  "cl:ketchup": { group: "otro", nova: 4, usda: "Catsup" },
  "cl:mostaza": { group: "otro", nova: 3, usda: "Mustard, prepared, yellow" },
  "cl:pebre": { group: "verdura", nova: 1, sodium100: 380, satFat100: 0.3 },
  "cl:azucar": { group: "dulce", nova: 2, usda: AZUCAR },
  "cl:miel": { group: "dulce", nova: 1, usda: "Honey" },
  "cl:jugo_naranja": { group: "fruta", nova: 1, liquid: true, usda: "Orange juice, raw" },
  "cl:coca_cola": { group: "bebida_azucarada", nova: 4, liquid: true, usda: "Beverages, carbonated, cola, regular" },
  "cl:bebida_light": { group: "bebida_sin_azucar", nova: 4, liquid: true, usda: 174826 },
  "cl:cafe": { group: "bebida_sin_azucar", nova: 1, liquid: true, usda: "Beverages, coffee, brewed, prepared with tap water" },
  "cl:te": { group: "bebida_sin_azucar", nova: 1, liquid: true, usda: "Beverages, tea, black, brewed, prepared with tap water" },
  "cl:leche_platano": { group: "lacteo", nova: 1, liquid: true, sodium100: 35, satFat100: 1.6 },
  "cl:papas_fritas": { group: "comida_rapida", nova: 4, usda: PAPAS_FRITAS },
  "cl:granola": { group: "cereal_integral", nova: 4, usda: "Cereals ready-to-eat, granola, homemade" },
  "cl:nueces": { group: "frutos_secos", nova: 1, usda: "Nuts, walnuts, english" },
  "cl:almendras": { group: "frutos_secos", nova: 1, usda: "Nuts, almonds" },
  "cl:maní": { group: "frutos_secos", nova: 1, usda: "Peanuts, all types, raw" },
  "cl:chocolate_negro": { group: "dulce", nova: 4, usda: "Chocolate, dark, 70-85% cacao solids" },
  "cl:proteina_whey": { group: "suplemento", nova: 4, sodium100: 250, satFat100: 1.5 },
};

/** Alias que ahora tienen su propio alimento (más exacto): se sacan del alimento viejo para que no le roben la búsqueda. */
export const ALIAS_MOVES: Record<string, string[]> = {
  "cl:naranja": ["clementina", "mandarina"],
  "cl:zapallo": ["zapallo italiano", "zucchini"],
  "cl:quesillo": ["queso fresco"],
  "cl:queso_gauda": ["queso mantecoso"],
  "cl:mantequilla": ["margarina"],
  "cl:coca_cola": ["Bilz"],
  "cl:porotos_riendas": ["porotos granados"],
  "cl:pechuga_plancha": ["pollo asado"],
  "cl:bife_vacuno": ["posta", "asado", "lomo liso"],
  "cl:lomo_cerdo": ["chuleta de cerdo", "costilla cerdo"],
  "cl:maní": ["maní salado"],
};
/** Alias nuevos para alimentos que ya estaban. */
export const ALIAS_ADDS: Record<string, string[]> = {
  "cl:empanada_frita": ["empanada de queso"],
  "cl:sopaipilla": ["sopapilla", "sopapillas", "sopaipillas"], // así lo escribe la gente (2026-10-03)
  // Lo que en Chile se entiende por defecto (sin esto, "pan con queso" o "tallarines" empataban entre varios y no se anotaba)
  "cl:queso_gauda": ["queso", "queso laminado"],
  "cl:fideos_cocidos": ["tallarines", "fideos", "espagueti", "spaghetti"],
  "cl:papas_fritas": ["papas fritas de local", "papas fritas caseras"],
};

/**
 * Alimentos nuevos que el catálogo del asesor metabólico (food_catalog.json) ya tenía: toman el MISMO id (cl:<id del
 * catálogo>) y el MISMO nombre, para que el buscador los vea como uno solo (si no, el registro por chat empata entre
 * "Camarones" y "Camarones cocidos" y no registra nada) y hereden los alérgenos verificados del catálogo.
 */
export const CATALOG_SAME: Record<string, string> = {
  "cl:pavo": "pavo_pechuga", "cl:posta": "vacuno_posta", "cl:higado": "vacuno_higado", "cl:cordero": "cordero_pierna",
  "cl:tocino": "tocino", "cl:jurel_tarro": "jurel_lata", "cl:congrio": "congrio", "cl:atun_aceite": "atun_aceite",
  "cl:sardinas": "sardina_lata", "cl:camarones": "camaron", "cl:choritos": "choritos", "cl:almejas": "machas",
  "cl:pulpo": "pulpo", "cl:jaiba": "jaiba", "cl:leche_almendras": "leche_almendras", "cl:tofu": "tofu", "cl:hummus": "humus",
  "cl:pan_hamburguesa": "pan_hamburguesa", "cl:corn_flakes": "cereal_hojuelas_maiz", "cl:repollo": "repollo",
  "cl:berenjena": "berenjena", "cl:porotos_verdes": "porotos_verdes", "cl:ciruela": "ciruela", "cl:higo": "higo",
  "cl:melon": "melon", "cl:damasco": "damasco", "cl:ciruelas_secas": "ciruela_pasa", "cl:semillas_maravilla": "semillas_maravilla",
  "cl:manjar": "manjar", "cl:cuscus": "couscous", "cl:habas": "habas", "cl:porotos_negros": "porotos_negros",
  "cl:coliflor": "coliflor", "cl:betarraga": "betarraga", "cl:apio": "apio", "cl:champinones": "champinon",
  "cl:alcachofa": "alcachofa", "cl:esparragos": "esparragos", "cl:cerezas": "cereza", "cl:arandanos": "arandano",
  "cl:pina": "pina", "cl:mango": "mango", "cl:pomelo": "pomelo", "cl:frambuesas": "frambuesa", "cl:pasas": "pasas",
  "cl:pistachos": "pistachos", "cl:chia": "semillas_chia", "cl:linaza": "linaza", "cl:mantequilla_mani": "mantequilla_mani",
  "cl:salsa_soya": "salsa_soya", "cl:chocolate_leche": "chocolate_leche", "cl:isotonica": "bebida_isotonica",
  "cl:cerveza": "cerveza", "cl:vino_tinto": "vino_tinto", "cl:yogur_griego": "yogur_griego",
  "cl:queso_parmesano": "queso_parmesano", "cl:queso_crema": "queso_crema", "cl:huevo_duro": "huevo_cocido",
  "cl:fideos_integrales": "fideos_integrales", "cl:mermelada": "mermelada",
};
/** El pan de completo y el de hamburguesa son uno solo en el catálogo: el de completo se funde en ese. */
export const MERGE_INTO: Record<string, string> = { "cl:pan_completo": "cl:pan_hamburguesa" };
/** Alias del catálogo que ahora tienen su propio alimento (mismo criterio que ALIAS_MOVES). */
export const CATALOG_ALIAS_MOVES: Record<string, string[]> = {
  zapallo: ["zapallo italiano", "zucchini"], naranja: ["clementina", "mandarina"], pechuga_plancha: ["pollo asado"],
  bife_vacuno: ["lomo liso", "posta", "asado"], lomo_cerdo: ["chuleta de cerdo", "costilla cerdo"], quesillo: ["queso fresco"],
  queso_gauda: ["queso mantecoso"], mantequilla: ["margarina"], porotos_riendas: ["porotos granados"], coca_cola: ["Bilz"],
  mani: ["maní salado"], mermelada: ["jalea"],
};

/**
 * Vitaminas y minerales (fase I5, 2026-10-23) de los alimentos de la base original que no vienen de USDA ni tienen una
 * consulta en ENRICH: un alimento parecido de USDA o una receta casera promedio, solo para los micronutrientes (las
 * calorías y los macros de esos alimentos no cambian). La lúcuma no está en USDA: queda sin vitaminas.
 */
export const MICRO_FROM: Record<string, SimpleSpecMicro | RecipeMicro> = {
  "cl:sopaipilla": { recipe: [[HARINA, 50], [ZAPALLO, 30], [ACEITE, 12], ["agua", 8], ["sal", 1]] },
  "cl:cazuela_vacuno": { recipe: [[VACUNO, 70], [PAPA, 100], [ZAPALLO, 60], ["Corn, sweet, yellow, cooked, boiled, drained, without salt", 40], [ZANAHORIA, 15], ["Beans, snap, green, cooked, boiled, drained, without salt", 15], [ARROZ, 15], ["agua", 250], ["sal", 2.5]] },
  "cl:cazuela_pollo": { recipe: [[POLLO, 80], [PAPA, 100], [ZAPALLO, 60], ["Corn, sweet, yellow, cooked, boiled, drained, without salt", 40], [ZANAHORIA, 15], ["Beans, snap, green, cooked, boiled, drained, without salt", 15], [ARROZ, 15], ["agua", 250], ["sal", 2.5]] },
  "cl:empanada_horno": { recipe: [[HARINA, 70], ["Lard", 12], ["Beef, ground, 80% lean meat / 20% fat, crumbles, cooked, pan-browned", 45], [CEBOLLA, 45], ["Egg, whole, cooked, hard-boiled", 10], ["Olives, ripe, canned (small-extra large)", 5], ["Raisins, seedless", 3], ["agua", 25], ["sal", 1.5]], yield: 200 },
  "cl:empanada_frita": { recipe: [[HARINA, 60], [GAUDA, 40], [ACEITE, 15], ["agua", 20], ["sal", 1]], yield: 125 },
  "cl:pastel_choclo": { recipe: [["Corn, sweet, yellow, cooked, boiled, drained, without salt", 150], ["Beef, ground, 80% lean meat / 20% fat, crumbles, cooked, pan-browned", 50], [CEBOLLA, 40], [POLLO, 30], ["Egg, whole, cooked, hard-boiled", 10], ["Olives, ripe, canned (small-extra large)", 5], [AZUCAR, 6], [LECHE, 20], [MANTEQUILLA, 5], ["sal", 1.5]] },
  "cl:humitas": { recipe: [["Corn, sweet, yellow, cooked, boiled, drained, without salt", 180], [CEBOLLA, 15], [MANTEQUILLA, 8], [LECHE, 10], ["sal", 1]] },
  "cl:porotos_riendas": { recipe: [["Beans, cranberry (roman), mature seeds, cooked, boiled, without salt", 100], ["Pasta, cooked, enriched, without added salt", 50], [ZAPALLO, 40], [CEBOLLA, 15], [ACEITE, 5], ["agua", 90], ["sal", 1.5]] },
  "cl:charquican": { recipe: [["Beef, ground, 80% lean meat / 20% fat, crumbles, cooked, pan-browned", 40], [PAPA, 100], [ZAPALLO, 80], ["Corn, sweet, yellow, cooked, boiled, drained, without salt", 30], ["Peas, green, cooked, boiled, drained, without salt", 20], [CEBOLLA, 20], [ACEITE, 5], ["sal", 1.2]] },
  "cl:carbonada": { recipe: [[VACUNO, 50], [PAPA, 80], [ZAPALLO, 50], [ZANAHORIA, 20], [ARROZ, 15], ["Peas, green, cooked, boiled, drained, without salt", 15], ["Beans, snap, green, cooked, boiled, drained, without salt", 15], ["Corn, sweet, yellow, cooked, boiled, drained, without salt", 15], ["agua", 200], ["sal", 2]] },
  "cl:chorrillana": { recipe: [[PAPAS_FRITAS, 200], [VACUNO, 100], [CEBOLLA, 60], [HUEVO_FRITO, 50], [ACEITE, 8]] },
  "cl:completo_italiano": { recipe: [[PAN_COMPLETO, 70], ["Frankfurter, beef, unheated", 50], [PALTA, 40], [TOMATE, 30], [MAYO, 20]] },
  "cl:arroz_leche": { recipe: [["Rice, white, long-grain, regular, raw, enriched", 30], [LECHE, 200], [AZUCAR, 20]], yield: 220 },
  "cl:lentejas_guiso": { recipe: [["Lentils, mature seeds, cooked, boiled, without salt", 120], [ARROZ, 30], [CEBOLLA, 20], [ZANAHORIA, 15], [ZAPALLO, 20], [ACEITE, 5], ["agua", 50], ["sal", 1]] },
  "cl:fideos_salsa": { recipe: [["Pasta, cooked, enriched, without added salt", 200], ["Sauce, pasta, spaghetti/marinara, ready-to-serve", 80]] },
  "cl:pebre": { recipe: [[TOMATE, 60], [CEBOLLA, 20], ["Coriander (cilantro) leaves, raw", 5], ["Peppers, hot chili, red, raw", 3], ["Oil, olive, salad or cooking", 5], ["sal", 1]] },
  "cl:leche_platano": { recipe: [[LECHE, 200], ["Bananas, raw", 100], [AZUCAR, 8]] },
  "cl:proteina_whey": { usda: "Beverages, Protein powder whey based" },
};
export interface SimpleSpecMicro { usda: string | number; src?: "sr" | "fndds" | "foundation" }
export interface RecipeMicro { recipe: Ingredient[]; yield?: number }

// ─── Fase I5 (2026-10-23): de 290 a ~560 alimentos, todos con vitaminas y minerales ───────────────────
// Pedido del usuario: «más alimentos». Frutas y verduras de Chile, legumbres, pescados y mariscos, cortes, lácteos, cereales,
// frutos secos, aderezos, bebidas y preparaciones caseras chilenas (recetas promedio con ingredientes USDA).
const POLLO_GUISADO = "Chicken, broilers or fryers, breast, meat only, cooked, stewed";
const CARNE_MOLIDA = "Beef, ground, 80% lean meat / 20% fat, crumbles, cooked, pan-browned";
const ESTOFADO = "Beef, chuck, blade roast, separable lean only, trimmed to 0\" fat, all grades, cooked, braised";
const CHOCLO = "Corn, sweet, yellow, cooked, boiled, drained, without salt";
const ARVEJAS = "Peas, green, cooked, boiled, drained, without salt";
const HUEVO_DURO = "Egg, whole, cooked, hard-boiled";
const HUEVO = "Egg, whole, raw, fresh";
const LECHUGA = "Lettuce, iceberg (includes crisphead types), raw";
const PARMESANO = "Cheese, parmesan, grated";
const MOZZARELLA = "Cheese, mozzarella, whole milk";
const FIDEOS = "Pasta, cooked, enriched, without added salt";
const SALSA_TOMATE = "Sauce, pasta, spaghetti/marinara, ready-to-serve";
const OLIVA = "Oil, olive, salad or cooking";
const LIMON = "Lemon juice, raw";
const CILANTRO = "Coriander (cilantro) leaves, raw";
const TORTILLA = 167535; // Tortillas, ready-to-bake or -fry, flour, shelf stable
const PAN_MOLDE = "Bread, white, commercially prepared (includes soft bread crumbs)";
const YOGUR = "Yogurt, plain, whole milk";
const PLATANO = "Bananas, raw";

NEW_FOODS.push(
  // ─── Frutas ───────────────────────────────────────────────
  { id: "cl:nectarin", name: "Nectarín", aliases: ["nectarines", "nectarina"], category: "frutas", group: "fruta", nova: 1, usda: "Nectarines, raw", servings: [["1 unidad", 140]] },
  { id: "cl:granada", name: "Granada", aliases: ["granadas", "pepas de granada"], category: "frutas", group: "fruta", nova: 1, usda: "Pomegranates, raw", servings: [["½ granada (pepas)", 90], ["1 taza de pepas", 175]] },
  { id: "cl:caqui", name: "Caqui", aliases: ["caquis", "kaki", "persimón"], category: "frutas", group: "fruta", nova: 1, usda: "Persimmons, japanese, raw", servings: [["1 unidad", 170]] },
  { id: "cl:tuna", name: "Tuna (fruta)", aliases: ["tunas", "higo chumbo", "fruta de la tuna"], category: "frutas", group: "fruta", nova: 1, usda: "Prickly pears, raw", servings: [["1 unidad", 105]] },
  { id: "cl:guinda", name: "Guindas", aliases: ["guinda", "guindas ácidas"], category: "frutas", group: "fruta", nova: 1, usda: "Cherries, sour, red, raw", servings: [["1 taza", 155]] },
  { id: "cl:lima", name: "Lima", aliases: ["limas", "limón de pica", "limon de pica"], category: "frutas", group: "fruta", nova: 1, usda: "Limes, raw", servings: [["1 unidad", 67]] },
  { id: "cl:coco", name: "Coco fresco", aliases: ["coco", "pulpa de coco"], category: "frutas", group: "fruta", nova: 1, usda: "Nuts, coconut meat, raw", servings: [["1 trozo", 45]] },
  { id: "cl:coco_rallado", name: "Coco rallado", aliases: ["coco rallado endulzado"], category: "frutas", group: "dulce", nova: 3, usda: "Nuts, coconut meat, dried (desiccated), sweetened, shredded", servings: [["1 cucharada", 7]] },
  { id: "cl:nispero", name: "Níspero", aliases: ["nísperos", "nisperos"], category: "frutas", group: "fruta", nova: 1, usda: "Loquats, raw", servings: [["4 unidades", 60]] },
  { id: "cl:grosella", name: "Grosellas", aliases: ["grosella", "zarzaparrilla"], category: "frutas", group: "fruta", nova: 1, usda: "Gooseberries, raw", servings: [["1 taza", 150]] },
  { id: "cl:guayaba", name: "Guayaba", aliases: ["guayabas"], category: "frutas", group: "fruta", nova: 1, usda: "Guavas, common, raw", servings: [["1 unidad", 55]] },
  { id: "cl:melon_tuna", name: "Melón tuna", aliases: ["melon tuna", "melón honeydew", "melón verde"], category: "frutas", group: "fruta", nova: 1, usda: "Melons, honeydew, raw", servings: [["1 tajada", 160]] },
  { id: "cl:pera_asiatica", name: "Pera asiática", aliases: ["nashi", "pera nashi"], category: "frutas", group: "fruta", nova: 1, usda: "Pears, asian, raw", servings: [["1 unidad", 120]] },
  { id: "cl:manzana_verde", name: "Manzana verde", aliases: ["manzana granny smith", "manzana verde granny"], category: "frutas", group: "fruta", nova: 1, usda: "Apples, raw, granny smith, with skin (Includes foods for USDA's Food Distribution Program)", servings: [["1 unidad mediana", 170]] },
  { id: "cl:manzana_cocida", name: "Manzana cocida", aliases: ["manzana asada", "manzanas cocidas"], category: "frutas", group: "fruta", nova: 1, usda: "Apples, raw, without skin, cooked, boiled", servings: [["1 unidad", 150]] },
  { id: "cl:compota_manzana", name: "Compota de manzana", aliases: ["compota", "puré de manzana"], category: "frutas", group: "fruta", nova: 3, usda: "Applesauce, canned, unsweetened, without added ascorbic acid (Includes foods for USDA's Food Distribution Program)", servings: [["1 pote", 113]] },
  { id: "cl:huesillos", name: "Huesillos (duraznos deshidratados)", aliases: ["durazno deshidratado", "duraznos secos", "huesillo"], category: "frutas", group: "fruta", nova: 1, usda: "Peaches, dried, sulfured, uncooked", servings: [["2 huesillos", 26]] },
  { id: "cl:damascos_secos", name: "Damascos secos", aliases: ["orejones", "damasco seco", "orejones de damasco"], category: "frutas", group: "fruta", nova: 1, usda: "Apricots, dried, sulfured, uncooked", servings: [["5 unidades", 35]] },
  { id: "cl:higos_secos", name: "Higos secos", aliases: ["higo seco"], category: "frutas", group: "fruta", nova: 1, usda: "Figs, dried, uncooked", servings: [["3 unidades", 25]] },
  { id: "cl:arandanos_secos", name: "Arándanos rojos deshidratados", aliases: ["cranberries", "arándanos secos", "arandanos deshidratados"], category: "frutas", group: "dulce", nova: 3, usda: "Cranberries, dried, sweetened (Includes foods for USDA's Food Distribution Program)", servings: [["1 puñado", 30]] },
  { id: "cl:pina_conserva", name: "Piña en conserva", aliases: ["piña en almíbar", "piña en lata"], category: "frutas", group: "dulce", nova: 3, usda: "Pineapple, canned, heavy syrup pack, solids and liquids", servings: [["2 rodajas", 100]] },
  { id: "cl:coctel_frutas", name: "Cóctel de frutas en conserva", aliases: ["coctel de frutas", "macedonia en conserva"], category: "frutas", group: "dulce", nova: 3, usda: "Fruit cocktail, (peach and pineapple and pear and grape and cherry), canned, heavy syrup, solids and liquids", servings: [["½ taza", 125]] },
  { id: "cl:frutos_rojos", name: "Frutos rojos congelados", aliases: ["berries congelados", "mix de berries", "frutas del bosque"], category: "frutas", group: "fruta", nova: 1, usda: "Strawberries, frozen, unsweetened (Includes foods for USDA's Food Distribution Program)", servings: [["1 taza", 150]] },
  { id: "cl:moras", name: "Moras", aliases: ["mora", "zarzamora"], category: "frutas", group: "fruta", nova: 1, usda: "Blackberries, raw", servings: [["1 taza", 145]] },
  { id: "cl:papaya", name: "Papaya", aliases: ["papayas"], category: "frutas", group: "fruta", nova: 1, usda: "Papayas, raw", servings: [["1 taza en cubos", 145]] },
  { id: "cl:datiles", name: "Dátiles", aliases: ["dátil", "datiles"], category: "frutas", group: "fruta", nova: 1, usda: "Dates, medjool", servings: [["2 unidades", 48]] },
  { id: "cl:ensalada_frutas", name: "Ensalada de frutas", aliases: ["macedonia", "bowl de frutas", "fruta picada"], category: "frutas", group: "fruta", nova: 1, recipe: [["Apples, raw, with skin (Includes foods for USDA's Food Distribution Program)", 60], [PLATANO, 60], ["Oranges, raw, all commercial varieties", 60], ["Strawberries, raw", 40], ["Grapes, red or green (European type, such as Thompson seedless), raw", 30]], servings: [["1 taza", 200]] },

  // ─── Verduras ─────────────────────────────────────────────
  { id: "cl:repollo_crudo", name: "Repollo crudo (ensalada)", aliases: ["ensalada de repollo", "repollo picado"], category: "verduras", group: "verdura", nova: 1, usda: "Cabbage, raw", servings: [["1 taza", 90]] },
  { id: "cl:repollo_morado", name: "Repollo morado", aliases: ["repollo rojo", "col lombarda"], category: "verduras", group: "verdura", nova: 1, usda: "Cabbage, red, raw", servings: [["1 taza", 90]] },
  { id: "cl:zanahoria_cocida", name: "Zanahoria cocida", aliases: ["zanahorias cocidas"], category: "verduras", group: "verdura", nova: 1, usda: "Carrots, cooked, boiled, drained, without salt", servings: [["½ taza", 80]] },
  { id: "cl:brocoli_cocido", name: "Brócoli cocido", aliases: ["brocoli cocido", "brócoli al vapor"], category: "verduras", group: "verdura", nova: 1, usda: "Broccoli, cooked, boiled, drained, without salt", servings: [["1 taza", 155]] },
  { id: "cl:espinaca_cruda", name: "Espinaca cruda", aliases: ["espinacas crudas", "hojas de espinaca", "baby espinaca"], category: "verduras", group: "verdura", nova: 1, usda: "Spinach, raw", servings: [["1 taza", 30]] },
  { id: "cl:kale", name: "Kale", aliases: ["col rizada", "kale crudo"], category: "verduras", group: "verdura", nova: 1, usda: "Kale, raw", servings: [["1 taza", 21]] },
  { id: "cl:rucula", name: "Rúcula", aliases: ["rucula", "arúgula"], category: "verduras", group: "verdura", nova: 1, usda: "Arugula, raw", servings: [["1 taza", 20]] },
  { id: "cl:cebollin", name: "Cebollín", aliases: ["cebolla verde", "cebolleta", "cebollín picado"], category: "verduras", group: "verdura", nova: 1, usda: "Onions, spring or scallions (includes tops and bulb), raw", servings: [["1 cucharada", 6], ["1 tallo", 15]] },
  { id: "cl:aji_verde", name: "Ají verde", aliases: ["aji verde", "ají cristal", "ají fresco"], category: "verduras", group: "verdura", nova: 1, usda: "Peppers, hot chili, green, raw", servings: [["1 unidad", 45]] },
  { id: "cl:aceitunas", name: "Aceitunas", aliases: ["aceituna", "aceitunas negras", "aceitunas de azapa"], category: "verduras", group: "grasa", nova: 3, usda: "Olives, ripe, canned (small-extra large)", servings: [["5 unidades", 20]] },
  { id: "cl:nabo", name: "Nabo cocido", aliases: ["nabos"], category: "verduras", group: "verdura", nova: 1, usda: "Turnips, cooked, boiled, drained, without salt", servings: [["½ taza", 78]] },
  { id: "cl:puerro", name: "Puerro", aliases: ["puerros", "ajo porro"], category: "verduras", group: "verdura", nova: 1, usda: "Leeks, (bulb and lower leaf-portion), raw", servings: [["½ taza", 45]] },
  { id: "cl:palmitos", name: "Palmitos", aliases: ["palmito", "palmitos en conserva"], category: "verduras", group: "verdura", nova: 3, usda: "Hearts of palm, canned", servings: [["3 palmitos", 100]] },
  { id: "cl:choclo_conserva", name: "Choclo en conserva", aliases: ["choclo en lata", "maíz en lata", "granos de choclo"], category: "verduras", group: "verdura", nova: 3, usda: "Corn, sweet, yellow, canned, whole kernel, drained solids", servings: [["½ taza", 82]] },
  { id: "cl:jengibre", name: "Jengibre", aliases: ["kión", "jengibre fresco"], category: "verduras", group: "verdura", nova: 1, usda: "Ginger root, raw", servings: [["1 cucharadita", 2]] },
  { id: "cl:perejil", name: "Perejil", aliases: ["perejil picado"], category: "verduras", group: "verdura", nova: 1, usda: "Parsley, fresh", servings: [["1 cucharada", 4]] },
  { id: "cl:cilantro", name: "Cilantro", aliases: ["cilantro picado", "culantro"], category: "verduras", group: "verdura", nova: 1, usda: CILANTRO, servings: [["1 cucharada", 1]] },
  { id: "cl:albahaca", name: "Albahaca", aliases: ["albahaca fresca"], category: "verduras", group: "verdura", nova: 1, usda: "Basil, fresh", servings: [["5 hojas", 3]] },
  { id: "cl:oregano", name: "Orégano seco", aliases: ["orégano", "oregano"], category: "aderezos", group: "otro", nova: 1, usda: "Spices, oregano, dried", servings: [["1 cucharadita", 1]] },
  { id: "cl:brotes_soya", name: "Brotes de soya", aliases: ["brotes de soja", "germinados"], category: "verduras", group: "verdura", nova: 1, usda: "Mung beans, mature seeds, sprouted, raw", servings: [["1 taza", 105]] },
  { id: "cl:alfalfa", name: "Brotes de alfalfa", aliases: ["alfalfa"], category: "verduras", group: "verdura", nova: 1, usda: "Alfalfa seeds, sprouted, raw", servings: [["1 taza", 33]] },
  { id: "cl:repollitos", name: "Repollitos de Bruselas", aliases: ["coles de bruselas", "repollitos"], category: "verduras", group: "verdura", nova: 1, usda: "Brussels sprouts, cooked, boiled, drained, without salt", servings: [["½ taza", 78]] },
  { id: "cl:papa_horno", name: "Papa al horno", aliases: ["papas al horno", "papa asada", "papas asadas"], category: "verduras", group: "verdura", nova: 1, usda: "Potatoes, baked, flesh and skin, without salt", servings: [["1 papa mediana", 170]] },
  { id: "cl:camote_horno", name: "Camote al horno", aliases: ["camote asado", "batata al horno"], category: "verduras", group: "verdura", nova: 1, usda: "Sweet potato, cooked, baked in skin, flesh, without salt", servings: [["1 unidad mediana", 115]] },
  { id: "cl:yuca", name: "Yuca cocida", aliases: ["yuca", "mandioca"], category: "verduras", group: "verdura", nova: 1, usda: "Cassava, raw", servings: [["1 trozo", 100]] },
  { id: "cl:tomate_conserva", name: "Tomate en conserva", aliases: ["tomates pelados", "tomate en lata", "tomate triturado"], category: "verduras", group: "verdura", nova: 3, usda: "Tomatoes, red, ripe, canned, packed in tomato juice", servings: [["½ taza", 120]] },
  { id: "cl:pasta_tomate", name: "Pasta de tomate", aliases: ["concentrado de tomate", "salsa de tomate concentrada"], category: "aderezos", group: "verdura", nova: 3, usda: "Tomato products, canned, paste, without salt added", servings: [["1 cucharada", 16]] },
  { id: "cl:pepinillos", name: "Pepinillos", aliases: ["pepinillo", "pickles"], category: "verduras", group: "verdura", nova: 3, usda: "Pickles, cucumber, dill or kosher dill", servings: [["2 unidades", 35]] },
  { id: "cl:chucrut", name: "Chucrut", aliases: ["chucrut en conserva", "sauerkraut"], category: "verduras", group: "verdura", nova: 3, usda: "Sauerkraut, canned, solids and liquids", servings: [["2 cucharadas", 30]] },
  { id: "cl:berros", name: "Berros", aliases: ["berro"], category: "verduras", group: "verdura", nova: 1, usda: "Watercress, raw", servings: [["1 taza", 34]] },
  { id: "cl:hinojo", name: "Hinojo", aliases: ["hinojos"], category: "verduras", group: "verdura", nova: 1, usda: "Fennel, bulb, raw", servings: [["1 taza", 87]] },
  { id: "cl:cochayuyo", name: "Cochayuyo", aliases: ["cochayuyo cocido", "algas"], category: "verduras", group: "verdura", nova: 1, usda: "Seaweed, kelp, raw", servings: [["½ taza", 50]] },
  { id: "cl:endibia", name: "Endibia", aliases: ["endivia", "escarola"], category: "verduras", group: "verdura", nova: 1, usda: "Endive, raw", servings: [["1 taza", 50]] },
  { id: "cl:lechuga_costina", name: "Lechuga costina", aliases: ["lechuga romana", "lechuga escarola"], category: "verduras", group: "verdura", nova: 1, usda: "Lettuce, cos or romaine, raw", servings: [["1 taza", 47]] },
  { id: "cl:pimenton_rojo", name: "Pimentón rojo", aliases: ["pimiento rojo", "morrón rojo"], category: "verduras", group: "verdura", nova: 1, usda: "Peppers, sweet, red, raw", servings: [["½ unidad", 60]] },
  { id: "cl:zapallo_italiano_cocido", name: "Zapallo italiano salteado", aliases: ["zucchini salteado", "zapallitos salteados"], category: "verduras", group: "verdura", nova: 1, usda: "Squash, summer, zucchini, includes skin, cooked, boiled, drained, without salt", servings: [["1 taza", 180]] },

  // ─── Legumbres ────────────────────────────────────────────
  { id: "cl:porotos_blancos", name: "Porotos blancos cocidos", aliases: ["porotos blancos", "porotos tórtola"], category: "legumbres", group: "legumbre", nova: 1, usda: "Beans, white, mature seeds, cooked, boiled, without salt", servings: [["1 taza", 180]] },
  { id: "cl:porotos_rojos", name: "Porotos rojos cocidos", aliases: ["porotos rojos", "frejoles rojos", "porotos coscorrón"], category: "legumbres", group: "legumbre", nova: 1, usda: "Beans, kidney, red, mature seeds, cooked, boiled, without salt", servings: [["1 taza", 177]] },
  { id: "cl:garbanzos_conserva", name: "Garbanzos en conserva", aliases: ["garbanzos en lata"], category: "legumbres", group: "legumbre", nova: 3, usda: "Chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained, rinsed in tap water", servings: [["½ taza", 120]] },
  { id: "cl:edamame", name: "Edamame", aliases: ["porotos de soya verdes"], category: "legumbres", group: "legumbre", nova: 1, usda: "Edamame, frozen, prepared", servings: [["1 taza", 155]] },
  { id: "cl:tempeh", name: "Tempeh", aliases: ["tempe"], category: "legumbres", group: "legumbre", nova: 3, usda: "Tempeh", servings: [["1 porción", 100]] },
  { id: "cl:lupino", name: "Lupino cocido", aliases: ["lupinos", "chochos", "altramuces"], category: "legumbres", group: "legumbre", nova: 1, usda: "Lupins, mature seeds, cooked, boiled, without salt", servings: [["½ taza", 83]] },
  { id: "cl:falafel", name: "Falafel", aliases: ["faláfel", "croquetas de garbanzo"], category: "legumbres", group: "legumbre", nova: 3, usda: "Falafel, home-prepared", servings: [["3 unidades", 51]] },
  { id: "cl:arvejas_partidas", name: "Arvejas partidas cocidas", aliases: ["arvejas secas", "puré de arvejas"], category: "legumbres", group: "legumbre", nova: 1, usda: "Peas, split, mature seeds, cooked, boiled, without salt", servings: [["1 taza", 196]] },
  { id: "cl:soya_cocida", name: "Soya cocida", aliases: ["porotos de soya", "soja cocida"], category: "legumbres", group: "legumbre", nova: 1, usda: "Soybeans, mature cooked, boiled, without salt", servings: [["½ taza", 86]] },

  // ─── Pescados y mariscos ──────────────────────────────────
  { id: "cl:atun_fresco", name: "Atún fresco a la plancha", aliases: ["atún fresco", "atun fresco", "atún a la plancha"], category: "pescados", group: "pescado", nova: 1, usda: "Fish, tuna, fresh, yellowfin, raw", servings: [["1 filete", 150]] },
  { id: "cl:trucha", name: "Trucha al horno", aliases: ["trucha", "trucha arcoíris"], category: "pescados", group: "pescado", nova: 1, usda: "Fish, trout, rainbow, farmed, cooked, dry heat", servings: [["1 filete", 140]] },
  { id: "cl:salmon_ahumado", name: "Salmón ahumado", aliases: ["salmon ahumado"], category: "pescados", group: "pescado", nova: 3, usda: "Fish, salmon, chinook, smoked", servings: [["3 láminas", 50]] },
  { id: "cl:bacalao", name: "Bacalao cocido", aliases: ["bacalao"], category: "pescados", group: "pescado", nova: 1, usda: "Fish, cod, Atlantic, cooked, dry heat", servings: [["1 filete", 150]] },
  { id: "cl:lenguado", name: "Lenguado a la plancha", aliases: ["lenguado"], category: "pescados", group: "pescado", nova: 1, usda: "Fish, flatfish (flounder and sole species), cooked, dry heat", servings: [["1 filete", 130]] },
  { id: "cl:tilapia", name: "Tilapia al horno", aliases: ["tilapia"], category: "pescados", group: "pescado", nova: 1, usda: "Fish, tilapia, cooked, dry heat", servings: [["1 filete", 130]] },
  { id: "cl:ostiones", name: "Ostiones cocidos", aliases: ["ostiones", "callos de ostión", "vieiras"], category: "pescados", group: "pescado", nova: 1, usda: "Mollusks, scallop, (bay and sea), cooked, steamed", servings: [["1 porción", 100]] },
  { id: "cl:corvina", name: "Corvina a la plancha", aliases: ["corvina"], category: "pescados", group: "pescado", nova: 1, usda: "Fish, croaker, Atlantic, raw", servings: [["1 filete", 150]] },
  { id: "cl:albacora", name: "Albacora (pez espada)", aliases: ["albacora", "pez espada"], category: "pescados", group: "pescado", nova: 1, usda: "Fish, swordfish, cooked, dry heat", servings: [["1 filete", 150]] },
  { id: "cl:pejerrey", name: "Pejerrey frito", aliases: ["pejerreyes"], category: "pescados", group: "pescado", nova: 3, usda: "Fish, smelt, rainbow, cooked, dry heat", servings: [["1 porción", 120]] },
  { id: "cl:anchoas", name: "Anchoas en aceite", aliases: ["anchoa", "anchoas en lata"], category: "pescados", group: "pescado", nova: 3, usda: "Fish, anchovy, european, canned in oil, drained solids", servings: [["5 filetes", 20]] },
  { id: "cl:salmon_conserva", name: "Salmón en conserva", aliases: ["salmón en lata", "salmon en lata"], category: "pescados", group: "pescado", nova: 3, usda: "Fish, salmon, pink, canned, drained solids", servings: [["½ lata", 85]] },
  { id: "cl:loco", name: "Locos", aliases: ["loco", "locos cocidos"], category: "pescados", group: "pescado", nova: 1, usda: "Mollusks, abalone, mixed species, raw", servings: [["1 loco", 100]] },
  { id: "cl:ostras", name: "Ostras", aliases: ["ostra"], category: "pescados", group: "pescado", nova: 1, usda: "Mollusks, oyster, Pacific, cooked, moist heat", servings: [["6 ostras", 90]] },
  { id: "cl:centolla", name: "Centolla", aliases: ["centollón", "king crab"], category: "pescados", group: "pescado", nova: 1, usda: "Crustaceans, crab, alaska king, cooked, moist heat", servings: [["1 porción", 100]] },

  // ─── Carnes ───────────────────────────────────────────────
  { id: "cl:pollo_muslo_sin_piel", name: "Muslo de pollo sin piel", aliases: ["trutro sin piel", "muslo sin piel"], category: "carnes", group: "proteina_magra", nova: 1, usda: "Chicken, broilers or fryers, thigh, meat only, cooked, roasted", servings: [["1 muslo", 100]] },
  { id: "cl:vacuno_filete", name: "Filete de vacuno a la plancha", aliases: ["filete", "filete de vacuno"], category: "carnes", group: "carne_roja", nova: 1, usda: "Beef, tenderloin, steak, separable lean only, trimmed to 1/8\" fat, all grades, cooked, broiled", servings: [["1 bistec", 150]] },
  { id: "cl:vacuno_molida_magra", name: "Carne molida magra (90/10)", aliases: ["carne molida magra", "molida 10% grasa", "molida especial"], category: "carnes", group: "carne_roja", nova: 1, usda: "Beef, ground, 90% lean meat / 10% fat, crumbles, cooked, pan-browned", servings: [["1 porción", 100]] },
  { id: "cl:trutro_entero", name: "Trutro entero de pollo asado", aliases: ["trutro entero", "pierna de pollo", "trutro de pollo"], category: "carnes", group: "proteina_magra", nova: 1, usda: "Chicken, broilers or fryers, leg, meat and skin, cooked, roasted", servings: [["1 trutro", 160]] },
  { id: "cl:pollo_desmenuzado", name: "Pollo desmenuzado", aliases: ["pollo cocido", "pollo hervido", "pechuga cocida"], category: "carnes", group: "proteina_magra", nova: 1, usda: POLLO_GUISADO, servings: [["½ taza", 70], ["1 porción", 120]] },
  { id: "cl:lomo_liso", name: "Lomo liso", aliases: ["lomo liso a la plancha", "bife de lomo liso"], category: "carnes", group: "carne_roja", nova: 1, usda: "Beef, top sirloin, steak, separable lean only, trimmed to 1/8\" fat, choice, cooked, broiled", servings: [["1 bistec", 150]] },
  { id: "cl:carne_mechada", name: "Carne mechada / estofado", aliases: ["mechada", "huachalomo", "carne al jugo", "estofado de vacuno"], category: "carnes", group: "carne_roja", nova: 1, usda: ESTOFADO, servings: [["1 porción", 150]] },
  { id: "cl:osobuco", name: "Osobuco", aliases: ["osobuco de vacuno", "carne de cazuela"], category: "carnes", group: "carne_roja", nova: 1, usda: "Beef, shank crosscuts, separable lean only, trimmed to 1/4\" fat, choice, cooked, simmered", servings: [["1 trozo", 150]] },
  { id: "cl:tapapecho", name: "Tapapecho", aliases: ["tapa pecho", "punta de pecho"], category: "carnes", group: "carne_roja", nova: 1, usda: "Beef, brisket, flat half, separable lean and fat, trimmed to 0\" fat, all grades, cooked, braised", servings: [["1 porción", 150]] },
  { id: "cl:lengua", name: "Lengua de vacuno", aliases: ["lengua", "lengua nogada"], category: "carnes", group: "carne_roja", nova: 1, usda: "Beef, variety meats and by-products, tongue, cooked, simmered", servings: [["1 porción", 100]] },
  { id: "cl:guatitas", name: "Guatitas (callos)", aliases: ["guatitas", "callos", "mondongo"], category: "carnes", group: "carne_roja", nova: 1, usda: "Beef, variety meats and by-products, tripe, cooked, simmered", servings: [["1 porción", 150]] },
  { id: "cl:rinones", name: "Riñones de vacuno", aliases: ["riñones", "rinones"], category: "carnes", group: "carne_roja", nova: 1, usda: "Beef, variety meats and by-products, kidneys, cooked, simmered", servings: [["1 porción", 100]] },
  { id: "cl:pernil", name: "Pernil de cerdo", aliases: ["pernil", "pernil asado"], category: "carnes", group: "carne_roja", nova: 1, usda: "Pork, fresh, leg (ham), whole, separable lean and fat, cooked, roasted", servings: [["1 porción", 150]] },
  { id: "cl:molida_cerdo", name: "Carne molida de cerdo", aliases: ["molida de cerdo", "cerdo molido"], category: "carnes", group: "carne_roja", nova: 1, usda: "Pork, ground, 84% lean / 16% fat, cooked", servings: [["1 porción", 100]] },
  { id: "cl:chuleta_cordero", name: "Chuleta de cordero", aliases: ["chuletas de cordero", "costillar de cordero"], category: "carnes", group: "carne_roja", nova: 1, usda: "Lamb, domestic, loin, separable lean and fat, trimmed to 1/4\" fat, choice, cooked, broiled", servings: [["2 chuletas", 120]] },
  { id: "cl:pavo_trutro", name: "Trutro de pavo", aliases: ["pierna de pavo", "trutro pavo"], category: "carnes", group: "proteina_magra", nova: 1, usda: "Turkey, dark meat, meat only, cooked, roasted", servings: [["1 porción", 140]] },
  { id: "cl:pavo_molido", name: "Pavo molido", aliases: ["carne molida de pavo", "molida de pavo"], category: "carnes", group: "proteina_magra", nova: 1, usda: "Turkey, ground, cooked", servings: [["1 porción", 100]] },
  { id: "cl:conejo", name: "Conejo", aliases: ["conejo guisado", "conejo al horno"], category: "carnes", group: "proteina_magra", nova: 1, usda: "Game meat, rabbit, domesticated, composite of cuts, cooked, stewed", servings: [["1 porción", 140]] },
  { id: "cl:hamburguesa_pollo", name: "Hamburguesa de pollo", aliases: ["hamburguesas de pollo", "medallón de pollo"], category: "carnes", group: "embutido", nova: 4, usda: "Chicken patty, frozen, cooked", servings: [["1 unidad", 75]] },
  { id: "cl:hamburguesa_vegetal", name: "Hamburguesa vegetal / de soya", aliases: ["hamburguesa de soya", "hamburguesa vegana", "medallón vegetal"], category: "legumbres", group: "legumbre", nova: 4, usda: "Veggie burgers or soyburgers, unprepared", servings: [["1 unidad", 70]] },
  { id: "cl:salchicha_pollo", name: "Vienesa de pollo", aliases: ["salchicha de pollo", "vienesas de pollo", "vienesa de ave"], category: "carnes", group: "embutido", nova: 4, usda: "Frankfurter, chicken", servings: [["1 unidad", 45]] },
  { id: "cl:pate", name: "Paté", aliases: ["pate", "paté de hígado"], category: "carnes", group: "embutido", nova: 4, usda: "Pate, liver, not specified, canned", servings: [["1 cucharada", 13]] },

  // ─── Lácteos y huevos ─────────────────────────────────────
  { id: "cl:yogur_descremado", name: "Yogur natural descremado", aliases: ["yogur descremado", "yogurt descremado", "yogur light"], category: "lacteos", group: "lacteo", nova: 1, usda: 170887, servings: [["1 pote", 125]] },
  { id: "cl:queso_cottage", name: "Queso cottage", aliases: ["cottage"], category: "lacteos", group: "lacteo", nova: 3, usda: "Cheese, cottage, lowfat, 2% milkfat", servings: [["½ taza", 113]] },
  { id: "cl:queso_ricotta", name: "Queso ricotta", aliases: ["ricotta"], category: "lacteos", group: "lacteo", nova: 3, usda: "Cheese, ricotta, part skim milk", servings: [["¼ taza", 62]] },
  { id: "cl:queso_mozzarella", name: "Queso mozzarella", aliases: ["mozzarella", "muzzarella"], category: "lacteos", group: "lacteo", nova: 3, usda: MOZZARELLA, servings: [["1 lámina", 20], ["1 porción", 30]] },
  { id: "cl:leche_soya", name: "Leche de soya", aliases: ["bebida de soya", "leche de soja"], category: "lacteos", group: "lacteo", nova: 3, liquid: true, usda: "Soymilk, original and vanilla, with added calcium, vitamins A and D", servings: [["1 vaso", 200]] },
  { id: "cl:leche_sin_lactosa", name: "Leche sin lactosa", aliases: ["leche deslactosada", "leche sin lactosa semidescremada"], category: "lacteos", group: "lacteo", nova: 3, liquid: true, usda: "Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D", servings: [["1 vaso", 200]] },
  { id: "cl:leche_polvo", name: "Leche en polvo entera", aliases: ["leche en polvo", "nido"], category: "lacteos", group: "lacteo", nova: 3, usda: "Milk, dry, whole, with added vitamin D", servings: [["3 cucharadas (1 vaso)", 26]] },
  { id: "cl:leche_polvo_descremada", name: "Leche en polvo descremada", aliases: ["leche en polvo descremada", "svelty en polvo"], category: "lacteos", group: "lacteo", nova: 3, usda: "Milk, dry, nonfat, regular, without added vitamin A and vitamin D", servings: [["3 cucharadas (1 vaso)", 24]] },
  { id: "cl:leche_evaporada", name: "Leche evaporada", aliases: ["leche evaporada ideal"], category: "lacteos", group: "lacteo", nova: 3, liquid: true, usda: "Milk, canned, evaporated, without added vitamin A", servings: [["¼ taza", 63]] },
  { id: "cl:kefir", name: "Kefir", aliases: ["kéfir", "leche cultivada"], category: "lacteos", group: "lacteo", nova: 3, liquid: true, usda: "Kefir, lowfat, plain, LIFEWAY", servings: [["1 vaso", 200]] },
  { id: "cl:queso_cabra", name: "Queso de cabra", aliases: ["queso cabra", "queso de cabra fresco"], category: "lacteos", group: "lacteo", nova: 3, usda: "Cheese, goat, soft type", servings: [["1 porción", 30]] },
  { id: "cl:queso_azul", name: "Queso azul", aliases: ["roquefort", "queso roquefort"], category: "lacteos", group: "lacteo", nova: 3, usda: "Cheese, blue", servings: [["1 porción", 30]] },
  { id: "cl:queso_cheddar", name: "Queso cheddar", aliases: ["cheddar"], category: "lacteos", group: "lacteo", nova: 3, usda: "Cheese, cheddar", servings: [["1 lámina", 20]] },
  { id: "cl:queso_laminado", name: "Queso laminado (americano)", aliases: ["queso americano", "queso en láminas", "queso fundido"], category: "lacteos", group: "lacteo", nova: 4, usda: "Cheese, pasteurized process, American, fortified with vitamin D", servings: [["1 lámina", 18]] },
  { id: "cl:queso_edam", name: "Queso edam", aliases: ["edam", "queso de bola"], category: "lacteos", group: "lacteo", nova: 3, usda: "Cheese, edam", servings: [["1 lámina", 20]] },
  { id: "cl:mantequilla_sin_sal", name: "Mantequilla sin sal", aliases: ["mantequilla sin sal"], category: "aderezos", group: "grasa", nova: 2, usda: "Butter, without salt", servings: [["1 cucharadita", 5]] },
  { id: "cl:crema_acida", name: "Crema ácida", aliases: ["crema agria", "sour cream"], category: "lacteos", group: "grasa", nova: 3, usda: "Cream, sour, cultured", servings: [["1 cucharada", 15]] },
  { id: "cl:huevo_codorniz", name: "Huevos de codorniz", aliases: ["huevo de codorniz"], category: "lacteos", group: "huevo", nova: 1, usda: "Egg, quail, whole, fresh, raw", servings: [["4 huevos", 36]] },
  { id: "cl:omelette", name: "Omelette", aliases: ["omelet", "tortilla de huevo"], category: "lacteos", group: "huevo", nova: 1, usda: "Egg, whole, cooked, omelet", servings: [["2 huevos", 120]] },
  { id: "cl:huevo_pochado", name: "Huevo pochado", aliases: ["huevo escalfado", "huevo poché"], category: "lacteos", group: "huevo", nova: 1, usda: "Egg, whole, cooked, poached", servings: [["1 huevo", 50]] },
  { id: "cl:yema", name: "Yema de huevo", aliases: ["yema", "yemas"], category: "lacteos", group: "huevo", nova: 1, usda: "Egg, yolk, raw, fresh", servings: [["1 yema", 17]] },
  { id: "cl:leche_coco", name: "Leche de coco", aliases: ["leche de coco para cocinar"], category: "aderezos", group: "grasa", nova: 3, liquid: true, usda: "Nuts, coconut milk, canned (liquid expressed from grated meat and water)", servings: [["¼ taza", 60]] },
  { id: "cl:leche_avena", name: "Leche de avena", aliases: ["bebida de avena"], category: "lacteos", group: "lacteo", nova: 3, liquid: true, usda: "Oat milk", src: "fndds", servings: [["1 vaso", 200]] },

  // ─── Cereales, panes y harinas ────────────────────────────
  { id: "cl:fideos_arroz", name: "Fideos de arroz cocidos", aliases: ["fideos de arroz", "tallarines de arroz"], category: "cereales", group: "cereal_refinado", nova: 2, usda: "Rice noodles, cooked", servings: [["1 taza", 176]] },
  { id: "cl:avena_cocida", name: "Avena cocida (con agua)", aliases: ["avena cocida", "porridge", "avena con agua"], category: "cereales", group: "cereal_integral", nova: 1, usda: "Cereals, oats, regular and quick, not fortified, cooked with water, without salt", servings: [["1 taza", 234]] },
  { id: "cl:tortilla_maiz", name: "Tortilla de maíz", aliases: ["tortillas de maíz", "tortilla mexicana"], category: "panes", group: "pan", nova: 3, usda: 175036, servings: [["1 unidad", 26]] },
  { id: "cl:arroz_salvaje", name: "Arroz salvaje cocido", aliases: ["arroz salvaje", "wild rice"], category: "cereales", group: "cereal_integral", nova: 1, usda: "Wild rice, cooked", servings: [["1 taza", 164]] },
  { id: "cl:mijo", name: "Mijo cocido", aliases: ["mijo"], category: "cereales", group: "cereal_integral", nova: 1, usda: "Millet, cooked", servings: [["1 taza", 174]] },
  { id: "cl:amaranto", name: "Amaranto cocido", aliases: ["amaranto"], category: "cereales", group: "cereal_integral", nova: 1, usda: "Amaranth grain, cooked", servings: [["1 taza", 246]] },
  { id: "cl:burgol", name: "Trigo burgol cocido", aliases: ["burgol", "bulgur", "trigo partido"], category: "cereales", group: "cereal_integral", nova: 1, usda: "Bulgur, cooked", servings: [["1 taza", 182]] },
  { id: "cl:cebada", name: "Cebada perlada cocida", aliases: ["cebada"], category: "cereales", group: "cereal_refinado", nova: 1, usda: "Barley, pearled, cooked", servings: [["1 taza", 157]] },
  { id: "cl:harina_trigo", name: "Harina de trigo", aliases: ["harina", "harina blanca", "harina sin polvos"], category: "cereales", group: "cereal_refinado", nova: 2, usda: HARINA, servings: [["1 taza", 125], ["1 cucharada", 8]] },
  { id: "cl:harina_integral", name: "Harina integral", aliases: ["harina de trigo integral"], category: "cereales", group: "cereal_integral", nova: 2, usda: "Wheat flour, whole-grain (Includes foods for USDA's Food Distribution Program)", servings: [["1 taza", 120]] },
  { id: "cl:maicena", name: "Maicena", aliases: ["fécula de maíz", "almidón de maíz"], category: "cereales", group: "cereal_refinado", nova: 2, usda: "Cornstarch", servings: [["1 cucharada", 8]] },
  { id: "cl:pan_multigrano", name: "Pan de molde multigrano", aliases: ["pan multigrano", "pan de semillas"], category: "panes", group: "pan", nova: 4, usda: "Bread, multi-grain (includes whole-grain)", servings: [["1 rebanada", 26], ["2 rebanadas", 52]] },
  { id: "cl:bagel", name: "Bagel", aliases: ["bagels"], category: "panes", group: "pan", nova: 4, usda: "Bagels, plain, enriched, with calcium propionate (includes onion, poppy, sesame)", servings: [["1 unidad", 100]] },
  { id: "cl:galletas_integrales", name: "Galletas integrales / de salvado", aliases: ["galletas de salvado", "galletas integrales"], category: "panes", group: "pan", nova: 4, usda: "Crackers, whole-wheat", servings: [["4 galletas", 16]] },
  { id: "cl:galletas_arroz", name: "Galletas de arroz", aliases: ["tortitas de arroz", "galletas de arroz inflado"], category: "snacks", group: "cereal_integral", nova: 3, usda: "Snacks, rice cakes, brown rice, plain", servings: [["2 galletas", 18]] },
  { id: "cl:pan_rallado", name: "Pan rallado", aliases: ["pan molido"], category: "panes", group: "pan", nova: 3, usda: "Bread, crumbs, dry, grated, plain", servings: [["2 cucharadas", 14]] },
  { id: "cl:cheerios", name: "Cereal de avena en aritos (tipo Cheerios)", aliases: ["cheerios", "aritos de avena"], category: "cereales", group: "cereal_integral", nova: 4, usda: "Cereals ready-to-eat, GENERAL MILLS, CHEERIOS", servings: [["1 taza", 28]] },
  { id: "cl:muesli", name: "Muesli", aliases: ["musli"], category: "cereales", group: "cereal_integral", nova: 3, usda: 169076, servings: [["½ taza", 50]] },
  { id: "cl:arroz_inflado", name: "Arroz inflado", aliases: ["cereal de arroz inflado"], category: "cereales", group: "cereal_refinado", nova: 4, usda: "Cereals ready-to-eat, rice, puffed, fortified", servings: [["1 taza", 14]] },
  { id: "cl:all_bran", name: "Cereal de salvado (bran flakes)", aliases: ["all bran", "all-bran", "bran flakes", "salvado de trigo"], category: "cereales", group: "cereal_integral", nova: 4, usda: 173888, servings: [["¾ taza", 30]] },
  { id: "cl:fideos_huevo", name: "Fideos al huevo cocidos", aliases: ["tallarines al huevo", "fideos de huevo"], category: "cereales", group: "cereal_refinado", nova: 3, usda: "Noodles, egg, cooked, enriched", servings: [["1 taza", 160]] },
  { id: "cl:pasta_fresca", name: "Pasta fresca cocida", aliases: ["pasta fresca", "tallarines frescos"], category: "cereales", group: "cereal_refinado", nova: 3, usda: "Pasta, fresh-refrigerated, plain, cooked", servings: [["1 plato", 200]] },
  { id: "cl:semola", name: "Sémola", aliases: ["sémola de trigo", "semolina"], category: "cereales", group: "cereal_refinado", nova: 2, usda: "Semolina, enriched", servings: [["2 cucharadas", 20]] },
  { id: "cl:panqueques", name: "Panqueques", aliases: ["panqueque", "crepes", "panqueques solos"], category: "panes", group: "pan", nova: 3, usda: "Pancakes, plain, prepared from recipe", servings: [["1 unidad", 50]] },
  { id: "cl:waffles", name: "Waffles", aliases: ["waffle", "gofres"], category: "panes", group: "pan", nova: 3, usda: "Waffles, plain, prepared from recipe", servings: [["1 unidad", 75]] },

  // ─── Frutos secos y semillas ──────────────────────────────
  { id: "cl:castana_caju", name: "Castañas de cajú", aliases: ["castañas de caju", "cajú", "anacardos", "maranones"], category: "snacks", group: "frutos_secos", nova: 1, usda: "Nuts, cashew nuts, raw", servings: [["1 puñado", 28]] },
  { id: "cl:avellanas", name: "Avellanas", aliases: ["avellana"], category: "snacks", group: "frutos_secos", nova: 1, usda: "Nuts, hazelnuts or filberts", servings: [["1 puñado", 28]] },
  { id: "cl:semillas_zapallo", name: "Semillas de zapallo (pepitas)", aliases: ["pepitas de zapallo", "semillas de calabaza"], category: "snacks", group: "frutos_secos", nova: 1, usda: "Seeds, pumpkin and squash seed kernels, dried", servings: [["1 cucharada", 10]] },
  { id: "cl:sesamo", name: "Semillas de sésamo", aliases: ["sésamo", "ajonjolí"], category: "snacks", group: "frutos_secos", nova: 1, usda: "Seeds, sesame seeds, whole, dried", servings: [["1 cucharada", 9]] },
  { id: "cl:tahini", name: "Tahini (pasta de sésamo)", aliases: ["tahini", "tahina"], category: "aderezos", group: "frutos_secos", nova: 3, usda: "Seeds, sesame butter, tahini, from roasted and toasted kernels (most common type)", servings: [["1 cucharada", 15]] },
  { id: "cl:nueces_brasil", name: "Nueces de Brasil", aliases: ["castañas de brasil", "nuez de brasil"], category: "snacks", group: "frutos_secos", nova: 1, usda: "Nuts, brazilnuts, dried, unblanched", servings: [["2 unidades", 10]] },
  { id: "cl:pecanas", name: "Nueces pecanas", aliases: ["pecanas", "nuez pecana"], category: "snacks", group: "frutos_secos", nova: 1, usda: "Nuts, pecans", servings: [["1 puñado", 28]] },
  { id: "cl:macadamia", name: "Nueces de macadamia", aliases: ["macadamia", "macadamias"], category: "snacks", group: "frutos_secos", nova: 1, usda: "Nuts, macadamia nuts, raw", servings: [["1 puñado", 28]] },
  { id: "cl:castanas", name: "Castañas cocidas", aliases: ["castañas", "castañas asadas"], category: "snacks", group: "frutos_secos", nova: 1, usda: "Nuts, chestnuts, european, boiled and steamed", servings: [["5 unidades", 50]] },
  { id: "cl:mantequilla_almendras", name: "Mantequilla de almendras", aliases: ["crema de almendras", "pasta de almendras"], category: "aderezos", group: "frutos_secos", nova: 3, usda: "Nuts, almond butter, plain, without salt added", servings: [["1 cucharada", 16]] },

  // ─── Aceites, aderezos y endulzantes ──────────────────────
  { id: "cl:aceite_coco", name: "Aceite de coco", aliases: ["aceite coco"], category: "aderezos", group: "grasa", nova: 2, usda: "Oil, coconut", servings: [["1 cucharada", 14]] },
  { id: "cl:vinagre", name: "Vinagre", aliases: ["vinagre de vino", "vinagre blanco", "vinagre de manzana"], category: "aderezos", group: "otro", nova: 2, usda: "Vinegar, distilled", servings: [["1 cucharada", 15]] },
  { id: "cl:aceite_canola", name: "Aceite de canola", aliases: ["aceite canola", "aceite de raps"], category: "aderezos", group: "grasa", nova: 2, usda: "Oil, canola", servings: [["1 cucharada", 14]] },
  { id: "cl:manteca", name: "Manteca de cerdo", aliases: ["manteca", "grasa de cerdo"], category: "aderezos", group: "grasa", nova: 2, usda: "Lard", servings: [["1 cucharada", 13]] },
  { id: "cl:ghee", name: "Ghee (mantequilla clarificada)", aliases: ["ghee", "mantequilla clarificada"], category: "aderezos", group: "grasa", nova: 2, usda: "Butter oil, anhydrous", servings: [["1 cucharadita", 5]] },
  { id: "cl:salsa_golf", name: "Salsa golf", aliases: ["salsa rosada", "salsa americana"], category: "aderezos", group: "grasa", nova: 4, recipe: [[MAYO, 70], ["Catsup", 30]], servings: [["1 cucharada", 15]] },
  { id: "cl:salsa_bbq", name: "Salsa barbacoa", aliases: ["salsa bbq", "barbecue"], category: "aderezos", group: "dulce", nova: 4, usda: "Sauce, barbecue", servings: [["1 cucharada", 17]] },
  { id: "cl:salsa_picante", name: "Salsa picante / ají", aliases: ["salsa de ají", "tabasco", "ají en pasta", "sriracha"], category: "aderezos", group: "otro", nova: 3, usda: "Sauce, ready-to-serve, pepper, TABASCO", servings: [["1 cucharadita", 5]] },
  { id: "cl:aderezo_cesar", name: "Aderezo César", aliases: ["salsa césar", "aderezo cesar"], category: "aderezos", group: "grasa", nova: 4, usda: "Salad dressing, caesar dressing, regular", servings: [["1 cucharada", 15]] },
  { id: "cl:vinagreta", name: "Vinagreta", aliases: ["aliño", "aceite y vinagre", "vinagreta casera"], category: "aderezos", group: "grasa", nova: 3, recipe: [[OLIVA, 60], ["Vinegar, distilled", 35], ["sal", 1.5]], servings: [["1 cucharada", 15]] },
  { id: "cl:salsa_blanca", name: "Salsa blanca (bechamel)", aliases: ["bechamel", "salsa bechamel"], category: "aderezos", group: "lacteo", nova: 3, recipe: [[LECHE, 250], [MANTEQUILLA, 20], [HARINA, 20], ["sal", 1.5]], yield: 270, servings: [["¼ taza", 60]] },
  { id: "cl:crema_chantilly", name: "Crema chantilly", aliases: ["crema batida", "chantilly"], category: "dulces", group: "dulce", nova: 4, usda: "Cream, whipped, cream topping, pressurized", servings: [["2 cucharadas", 8]] },
  { id: "cl:azucar_rubia", name: "Azúcar rubia", aliases: ["azúcar morena", "azucar rubia", "azúcar flor"], category: "aderezos", group: "dulce", nova: 2, usda: AZUCAR_RUBIA, servings: [["1 cucharadita", 4]] },
  { id: "cl:endulzante", name: "Endulzante (sucralosa / stevia)", aliases: ["endulzante", "sucralosa", "stevia", "sacarina", "edulcorante"], category: "aderezos", group: "otro", nova: 4, usda: "Sweeteners, tabletop, sucralose, SPLENDA packets", servings: [["1 sobre", 1]] },
  { id: "cl:sal", name: "Sal", aliases: ["sal de mesa", "sal fina"], category: "aderezos", group: "otro", nova: 2, usda: "Salt, table", servings: [["1 pizca", 0.5], ["1 cucharadita", 6]] },
  { id: "cl:caldo_cubo", name: "Caldo en cubo", aliases: ["cubito", "caldo maggi", "caldo de pollo en cubo"], category: "aderezos", group: "otro", nova: 4, usda: "Soup, bouillon cubes and granules, low sodium, dry", servings: [["1 cubo", 4]] },
  { id: "cl:nutella", name: "Crema de avellanas y cacao (tipo Nutella)", aliases: ["nutella", "crema de avellanas"], category: "dulces", group: "dulce", nova: 4, usda: "Chocolate-flavored hazelnut spread", servings: [["1 cucharada", 19]] },
  { id: "cl:chancaca", name: "Chancaca", aliases: ["panela", "piloncillo"], category: "aderezos", group: "dulce", nova: 2, usda: AZUCAR_RUBIA, servings: [["1 trozo", 20]] },

  // ─── Bebidas ──────────────────────────────────────────────
  { id: "cl:jugo_manzana", name: "Jugo de manzana (sin azúcar)", aliases: ["jugo de manzana", "jugo manzana"], category: "bebidas", group: "bebida_azucarada", nova: 3, liquid: true, usda: "Apple juice, canned or bottled, unsweetened, without added ascorbic acid", servings: [["1 vaso", 200]] },
  { id: "cl:agua", name: "Agua", aliases: ["agua de la llave", "agua mineral", "agua con gas", "agua purificada"], category: "bebidas", group: "agua", nova: 1, liquid: true, usda: "Beverages, water, tap, drinking", servings: [["1 vaso", 250], ["1 botella", 500]] },
  { id: "cl:jugo_pina", name: "Jugo de piña", aliases: ["jugo piña"], category: "bebidas", group: "bebida_azucarada", nova: 3, liquid: true, usda: "Pineapple juice, canned or bottled, unsweetened, without added ascorbic acid", servings: [["1 vaso", 200]] },
  { id: "cl:jugo_uva", name: "Jugo de uva", aliases: ["jugo uva"], category: "bebidas", group: "bebida_azucarada", nova: 3, liquid: true, usda: "Grape juice, canned or bottled, unsweetened, with added ascorbic acid", servings: [["1 vaso", 200]] },
  { id: "cl:jugo_tomate", name: "Jugo de tomate", aliases: ["jugo tomate"], category: "bebidas", group: "bebida_sin_azucar", nova: 3, liquid: true, usda: "Tomato juice, canned, with salt added", servings: [["1 vaso", 200]] },
  { id: "cl:agua_coco", name: "Agua de coco", aliases: ["agua coco"], category: "bebidas", group: "bebida_azucarada", nova: 1, liquid: true, usda: "Nuts, coconut water (liquid from coconuts)", servings: [["1 vaso", 240]] },
  { id: "cl:te_verde", name: "Té verde", aliases: ["te verde", "té verde sin azúcar"], category: "bebidas", group: "bebida_sin_azucar", nova: 1, liquid: true, usda: "Beverages, tea, green, brewed, regular", servings: [["1 taza", 240]] },
  { id: "cl:agua_hierbas", name: "Agüita de hierbas", aliases: ["agüita", "infusión", "manzanilla", "agua de hierbas", "té de hierbas", "boldo", "cedrón", "menta"], category: "bebidas", group: "bebida_sin_azucar", nova: 1, liquid: true, usda: "Beverages, tea, herb, other than chamomile, brewed", servings: [["1 taza", 240]] },
  { id: "cl:espresso", name: "Café espresso", aliases: ["espresso", "expreso"], category: "bebidas", group: "bebida_sin_azucar", nova: 1, liquid: true, usda: "Beverages, coffee, brewed, espresso, restaurant-prepared", servings: [["1 taza", 30]] },
  { id: "cl:cafe_latte", name: "Café latte / capuchino", aliases: ["latte", "capuchino", "cappuccino", "café con leche espumada"], category: "bebidas", group: "lacteo", nova: 3, liquid: true, recipe: [["Beverages, coffee, brewed, espresso, restaurant-prepared", 60], ["Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D", 240]], servings: [["1 vaso mediano", 300]] },
  { id: "cl:milo", name: "Leche con cacao en polvo (tipo Milo)", aliases: ["milo", "leche con milo", "cola cao", "leche con cocoa"], category: "bebidas", group: "lacteo", nova: 4, liquid: true, usda: "Beverages, chocolate malt powder, prepared with 1% milk, fortified", servings: [["1 taza", 250]] },
  { id: "cl:batido_proteina", name: "Batido de proteína con leche", aliases: ["shake de proteína", "batido de whey", "proteína con leche"], category: "bebidas", group: "suplemento", nova: 4, liquid: true, recipe: [["Beverages, Protein powder whey based", 30], ["Milk, lowfat, fluid, 1% milkfat, with added vitamin A and vitamin D", 250]], servings: [["1 vaso", 280]] },
  { id: "cl:smoothie", name: "Smoothie de frutas", aliases: ["batido de frutas", "licuado de frutas", "smoothie"], category: "bebidas", group: "fruta", nova: 1, liquid: true, recipe: [[PLATANO, 100], ["Strawberries, raw", 80], [YOGUR, 100], ["agua", 60]], servings: [["1 vaso", 340]] },
  { id: "cl:destilado", name: "Whisky / ron / vodka", aliases: ["whisky", "ron", "vodka", "gin", "pisco solo", "tequila"], category: "bebidas", group: "alcohol", nova: 4, liquid: true, usda: PISCO, servings: [["1 corto", 45]] },

  // ─── Dulces y snacks ──────────────────────────────────────
  { id: "cl:galletas_chips", name: "Galletas con chips de chocolate", aliases: ["galletas chips", "cookies", "galletas con chispas"], category: "dulces", group: "dulce", nova: 4, usda: "Cookies, chocolate chip, commercially prepared, regular, higher fat", servings: [["2 galletas", 30]] },
  { id: "cl:galletas_avena", name: "Galletas de avena", aliases: ["galleta de avena"], category: "dulces", group: "dulce", nova: 4, usda: "Cookies, oatmeal, commercially prepared, regular", servings: [["2 galletas", 30]] },
  { id: "cl:brownie", name: "Brownie", aliases: ["brownies"], category: "dulces", group: "dulce", nova: 4, usda: "Brownies, commercially prepared", servings: [["1 trozo", 56]] },
  { id: "cl:muffin", name: "Muffin", aliases: ["muffins", "magdalena", "cupcake"], category: "dulces", group: "dulce", nova: 4, usda: "Muffins, blueberry, commercially prepared (Includes mini-muffins)", servings: [["1 unidad", 110]] },
  { id: "cl:chocolate_blanco", name: "Chocolate blanco", aliases: ["chocolate blanco"], category: "dulces", group: "dulce", nova: 4, usda: "Candies, white chocolate", servings: [["1 barra chica", 30]] },
  { id: "cl:marshmallow", name: "Marshmallows", aliases: ["malvaviscos", "masmelos", "marshmallow"], category: "dulces", group: "dulce", nova: 4, usda: "Candies, marshmallows", servings: [["5 unidades", 35]] },
  { id: "cl:pretzels", name: "Pretzels", aliases: ["pretzel"], category: "snacks", group: "snack_salado", nova: 4, usda: "Snacks, pretzels, hard, plain, salted", servings: [["1 puñado", 30]] },
  { id: "cl:gelatina_light", name: "Jalea sin azúcar", aliases: ["jalea light", "gelatina sin azúcar", "jalea diet"], category: "dulces", group: "dulce", nova: 4, usda: "Gelatin desserts, dry mix, reduced calorie, with aspartame, prepared with water", servings: [["1 pote", 120]] },
  { id: "cl:helado_yogur", name: "Helado de yogur", aliases: ["yogur helado", "frozen yogurt"], category: "dulces", group: "dulce", nova: 4, usda: "Frozen yogurts, vanilla, soft-serve", servings: [["1 porción", 100]] },
  { id: "cl:barra_proteina", name: "Barra de proteína", aliases: ["barra proteica", "protein bar"], category: "snacks", group: "suplemento", nova: 4, usda: "Snacks, granola bars, soft, uncoated, chocolate chip", servings: [["1 barra", 45]] },

  // ─── Comida rápida ────────────────────────────────────────
  { id: "cl:cheeseburger", name: "Hamburguesa con queso (comida rápida)", aliases: ["cheeseburger", "hamburguesa con queso"], category: "comida_rapida", group: "comida_rapida", nova: 4, usda: "Fast foods, cheeseburger; single, regular patty; plain", servings: [["1 unidad", 120]] },
  { id: "cl:pizza_pepperoni", name: "Pizza de pepperoni (trozo)", aliases: ["pizza pepperoni", "pizza de peperoni"], category: "comida_rapida", group: "comida_rapida", nova: 4, usda: "Pizza, pepperoni topping, regular crust, frozen, cooked", servings: [["1 trozo", 110]] },
  { id: "cl:burrito", name: "Burrito", aliases: ["burritos", "burrito de porotos"], category: "comida_rapida", group: "comida_rapida", nova: 4, usda: "Fast foods, burrito, with beans and cheese", servings: [["1 unidad", 185]] },
  { id: "cl:taco", name: "Taco", aliases: ["tacos", "taco de carne"], category: "comida_rapida", group: "comida_rapida", nova: 4, usda: "Fast foods, taco with beef, cheese and lettuce, hard shell", servings: [["1 unidad", 100]] },
  { id: "cl:sandwich_pollo_apanado", name: "Sándwich de pollo apanado", aliases: ["sandwich de pollo frito", "crispy chicken sandwich"], category: "comida_rapida", group: "comida_rapida", nova: 4, usda: "Fast foods, chicken fillet sandwich, plain", servings: [["1 unidad", 180]] },
  { id: "cl:aros_cebolla", name: "Aros de cebolla", aliases: ["onion rings", "aros de cebolla fritos"], category: "comida_rapida", group: "comida_rapida", nova: 4, usda: "Fast foods, onion rings, breaded and fried", servings: [["1 porción", 100]] },
  { id: "cl:helado_cono", name: "Helado soft (cono)", aliases: ["cono de helado", "helado de máquina", "helado soft"], category: "dulces", group: "dulce", nova: 4, usda: "Fast foods, ice milk, vanilla, soft-serve, with cone", servings: [["1 cono", 103]] },

  // ─── Platos caseros ───────────────────────────────────────
  { id: "cl:arroz_verduras", name: "Arroz con verduras", aliases: ["arroz primavera", "arroz graneado con verduras"], category: "platos", group: "plato_casero", nova: 1, recipe: [[ARROZ, 150], [ARVEJAS, 25], [ZANAHORIA, 20], [CHOCLO, 25], [ACEITE, 5], ["sal", 1]], servings: [["1 taza", 200]] },
  { id: "cl:tallarines_bolognesa", name: "Tallarines con salsa bolognesa", aliases: ["tallarines con salsa", "espaguetis a la bolognesa", "fideos con carne"], category: "platos", group: "plato_casero", nova: 3, recipe: [[FIDEOS, 200], [CARNE_MOLIDA, 60], [SALSA_TOMATE, 90], [CEBOLLA, 20], [ACEITE, 5], [PARMESANO, 5]], servings: [["1 plato", 380]] },
  { id: "cl:lomo_saltado", name: "Lomo saltado", aliases: ["lomo saltado peruano"], category: "platos", group: "plato_casero", nova: 3, recipe: [["Beef, top sirloin, steak, separable lean only, trimmed to 1/8\" fat, choice, cooked, broiled", 130], [CEBOLLA, 60], [TOMATE, 60], [PAPAS_FRITAS, 100], [ARROZ, 150], ["Soy sauce made from soy and wheat (shoyu)", 10], [ACEITE, 10]], servings: [["1 plato", 520]] },
  { id: "cl:aji_gallina", name: "Ají de gallina", aliases: ["aji de gallina"], category: "platos", group: "plato_casero", nova: 3, recipe: [[POLLO_GUISADO, 120], [PAN_MOLDE, 25], ["Milk, canned, evaporated, without added vitamin A", 60], [PARMESANO, 10], ["Nuts, walnuts, english", 10], [CEBOLLA, 30], [ACEITE, 8], [ARROZ, 150], [HUEVO_DURO, 15], ["sal", 1.5]], servings: [["1 plato", 430]] },
  { id: "cl:ceviche", name: "Ceviche", aliases: ["cebiche", "ceviche de pescado"], category: "platos", group: "pescado", nova: 1, recipe: [["Fish, cod, Atlantic, raw", 150], [LIMON, 50], [CEBOLLA, 40], [CILANTRO, 4], ["Peppers, hot chili, green, raw", 5], ["sal", 1.5]], servings: [["1 porción", 250]] },
  { id: "cl:guatitas_jardinera", name: "Guatitas a la jardinera", aliases: ["guatitas con papas", "guatitas guisadas"], category: "platos", group: "plato_casero", nova: 1, recipe: [["Beef, variety meats and by-products, tripe, cooked, simmered", 150], [PAPA, 120], [ZANAHORIA, 30], [ARVEJAS, 30], [CEBOLLA, 30], [ACEITE, 8], ["agua", 80], ["sal", 2]], servings: [["1 plato", 450]] },
  { id: "cl:estofado", name: "Estofado de vacuno con verduras", aliases: ["estofado", "carne a la cacerola", "carne con papas"], category: "platos", group: "plato_casero", nova: 1, recipe: [[ESTOFADO, 130], [PAPA, 120], [ZANAHORIA, 40], [CEBOLLA, 40], [ACEITE, 8], ["agua", 60], ["sal", 2]], servings: [["1 plato", 400]] },
  { id: "cl:albondigas", name: "Albóndigas con arroz", aliases: ["albóndigas", "albondigas"], category: "platos", group: "plato_casero", nova: 3, recipe: [[CARNE_MOLIDA, 120], [PAN_MOLDE, 15], [HUEVO, 15], [SALSA_TOMATE, 80], [ARROZ, 150], ["sal", 1.5]], servings: [["1 plato", 380]] },
  { id: "cl:salpicon", name: "Salpicón", aliases: ["salpicón de carne", "salpicon"], category: "platos", group: "plato_casero", nova: 3, recipe: [[ESTOFADO, 100], [PAPA, 100], [TOMATE, 60], [CEBOLLA, 30], [HUEVO_DURO, 25], [MAYO, 15], [OLIVA, 5], ["sal", 1.5]], servings: [["1 plato", 335]] },
  { id: "cl:ensalada_atun", name: "Ensalada de atún", aliases: ["ensalada con atún"], category: "platos", group: "plato_casero", nova: 3, recipe: [["Fish, tuna, light, canned in water, drained solids", 80], [LECHUGA, 60], [TOMATE, 60], [CHOCLO, 40], [OLIVA, 8], ["sal", 1]], servings: [["1 plato", 250]] },
  { id: "cl:ensalada_cesar", name: "Ensalada César con pollo", aliases: ["ensalada cesar", "césar con pollo"], category: "platos", group: "plato_casero", nova: 3, recipe: [["Lettuce, cos or romaine, raw", 100], [POLLO, 90], ["Croutons, seasoned", 15], [PARMESANO, 10], ["Salad dressing, caesar dressing, regular", 30]], servings: [["1 plato", 245]] },
  { id: "cl:ensalada_rusa", name: "Ensalada rusa", aliases: ["rusa", "ensalada de papas y arvejas"], category: "platos", group: "plato_casero", nova: 3, recipe: [[PAPA, 120], [ZANAHORIA, 40], [ARVEJAS, 40], [MAYO, 25], ["sal", 1]], servings: [["1 porción", 225]] },
  { id: "cl:ensalada_garbanzos", name: "Ensalada de garbanzos", aliases: ["garbanzos en ensalada"], category: "platos", group: "plato_casero", nova: 1, recipe: [["Chickpeas (garbanzo beans, bengal gram), mature seeds, cooked, boiled, without salt", 120], [TOMATE, 60], [CEBOLLA, 20], ["Cucumber, with peel, raw", 40], [OLIVA, 8], [LIMON, 10], ["sal", 1]], servings: [["1 plato", 260]] },
  { id: "cl:ensalada_quinoa", name: "Ensalada de quinoa", aliases: ["quinoa en ensalada", "bowl de quinoa"], category: "platos", group: "plato_casero", nova: 1, recipe: [["Quinoa, cooked", 120], [TOMATE, 50], ["Cucumber, with peel, raw", 40], [PALTA, 40], [OLIVA, 8], [LIMON, 10], ["sal", 1]], servings: [["1 plato", 270]] },
  { id: "cl:crema_esparragos", name: "Crema de espárragos", aliases: ["crema de esparragos"], category: "platos", group: "plato_casero", nova: 3, recipe: [["Asparagus, cooked, boiled, drained", 120], [PAPA, 60], [LECHE, 60], [MANTEQUILLA, 5], ["agua", 100], ["sal", 2]], servings: [["1 plato", 345]] },
  { id: "cl:crema_champinones", name: "Crema de champiñones", aliases: ["crema de champiñón", "sopa de champiñones"], category: "platos", group: "plato_casero", nova: 3, recipe: [["Mushrooms, white, cooked, boiled, drained, without salt", 120], [CEBOLLA, 30], [LECHE, 100], [MANTEQUILLA, 8], [HARINA, 8], ["agua", 80], ["sal", 2]], servings: [["1 plato", 350]] },
  { id: "cl:crema_brocoli", name: "Crema de brócoli", aliases: ["crema de brocoli", "sopa de brócoli"], category: "platos", group: "plato_casero", nova: 3, recipe: [["Broccoli, cooked, boiled, drained, without salt", 130], [PAPA, 60], [LECHE, 60], [MANTEQUILLA, 5], ["agua", 100], ["sal", 2]], servings: [["1 plato", 355]] },
  { id: "cl:sopa_pollo_fideos", name: "Sopa de pollo con fideos", aliases: ["sopa de pollo", "caldo de pollo con fideos", "sopa de fideos"], category: "platos", group: "plato_casero", nova: 1, recipe: [[POLLO_GUISADO, 60], [FIDEOS, 60], [ZANAHORIA, 25], [CEBOLLA, 20], ["agua", 250], ["sal", 2.5]], servings: [["1 plato", 415]] },
  { id: "cl:tortilla_papas", name: "Tortilla de papas (española)", aliases: ["tortilla española", "tortilla de papa"], category: "platos", group: "plato_casero", nova: 1, recipe: [[PAPA, 120], [HUEVO, 100], [CEBOLLA, 40], [OLIVA, 15], ["sal", 1.5]], yield: 250, servings: [["1 trozo", 150]] },
  { id: "cl:zapallitos_rellenos", name: "Zapallitos italianos rellenos", aliases: ["zapallitos rellenos", "zucchini relleno"], category: "platos", group: "plato_casero", nova: 3, recipe: [["Squash, summer, zucchini, includes skin, cooked, boiled, drained, without salt", 200], [CARNE_MOLIDA, 70], [CEBOLLA, 30], [ARROZ, 30], [MOZZARELLA, 20], [ACEITE, 5], ["sal", 1.5]], servings: [["2 mitades", 350]] },
  { id: "cl:canelones", name: "Canelones de ricotta y espinaca", aliases: ["canelones", "canelones de verdura"], category: "platos", group: "plato_casero", nova: 3, recipe: [[FIDEOS, 120], ["Cheese, ricotta, part skim milk", 70], ["Spinach, cooked, boiled, drained, without salt", 60], [SALSA_TOMATE, 80], [MOZZARELLA, 25], [PARMESANO, 5]], servings: [["1 porción (3)", 360]] },
  { id: "cl:quesadilla", name: "Quesadilla", aliases: ["quesadillas"], category: "platos", group: "comida_rapida", nova: 3, recipe: [[TORTILLA, 60], ["Cheese, cheddar", 40], [ACEITE, 3]], servings: [["1 unidad", 103]] },
  { id: "cl:fajitas_pollo", name: "Fajitas de pollo", aliases: ["fajita de pollo", "fajitas"], category: "platos", group: "plato_casero", nova: 3, recipe: [[TORTILLA, 80], [POLLO, 100], ["Peppers, sweet, red, raw", 50], [CEBOLLA, 40], [ACEITE, 8], ["sal", 1]], servings: [["2 fajitas", 280]] },
  { id: "cl:wrap_pollo", name: "Wrap de pollo", aliases: ["wrap con pollo", "wrap de pollo con lechuga"], category: "platos", group: "plato_casero", nova: 3, recipe: [[TORTILLA, 60], [POLLO, 80], [LECHUGA, 30], [TOMATE, 30], [MAYO, 12]], servings: [["1 unidad", 212]] },
  { id: "cl:sandwich_pollo", name: "Sándwich de pollo (ave mayo)", aliases: ["ave mayo", "sándwich ave mayo", "sandwich de pollo", "ave palta"], category: "platos", group: "plato_casero", nova: 3, recipe: [[PAN_MOLDE, 60], [POLLO_GUISADO, 70], [MAYO, 15], [LECHUGA, 15]], servings: [["1 sándwich", 160]] },
  { id: "cl:sandwich_atun", name: "Sándwich de atún", aliases: ["sandwich de atun", "pan con atún"], category: "platos", group: "plato_casero", nova: 3, recipe: [[PAN_MOLDE, 60], ["Fish, tuna, light, canned in water, drained solids", 60], [MAYO, 12], [LECHUGA, 15]], servings: [["1 sándwich", 147]] },
  { id: "cl:empanada_queso_horno", name: "Empanada de queso al horno", aliases: ["empanada de queso horneada"], category: "platos", group: "plato_casero", nova: 3, recipe: [[HARINA, 60], [GAUDA, 45], ["Lard", 10], ["agua", 25], ["sal", 1]], yield: 130, servings: [["1 unidad", 130]] },
  { id: "cl:pan_mantequilla", name: "Pan con mantequilla", aliases: ["marraqueta con mantequilla", "pan con mantequilla"], category: "platos", group: "pan", nova: 3, recipe: [[MARRAQUETA, 100], [MANTEQUILLA, 10]], servings: [["1 marraqueta", 110]] },
  { id: "cl:pan_mermelada", name: "Pan con mermelada", aliases: ["pan con mermelada", "tostada con mermelada"], category: "platos", group: "pan", nova: 3, recipe: [[MARRAQUETA, 100], ["Jams and preserves", 20]], servings: [["1 marraqueta", 120]] },
  { id: "cl:yogur_granola", name: "Yogur con granola", aliases: ["yogur con cereal", "yogurt con granola", "bowl de yogur"], category: "platos", group: "lacteo", nova: 3, recipe: [[YOGUR, 150], ["Cereals ready-to-eat, granola, homemade", 40]], servings: [["1 pote", 190]] },
  { id: "cl:leche_cereal", name: "Leche con cereal", aliases: ["cereal con leche", "corn flakes con leche"], category: "platos", group: "cereal_refinado", nova: 4, recipe: [["Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D", 200], ["Cereals ready-to-eat, KELLOGG, KELLOGG'S Corn Flakes", 30]], servings: [["1 plato", 230]] },
  { id: "cl:panqueques_manjar", name: "Panqueques con manjar", aliases: ["panqueque con manjar", "panqueques con dulce de leche"], category: "dulces", group: "dulce", nova: 4, recipe: [["Pancakes, plain, prepared from recipe", 100], ["Dulce de Leche", 40]], servings: [["2 panqueques", 140]] },
  { id: "cl:chupe_mariscos", name: "Chupe de mariscos", aliases: ["chupe", "chupe de locos"], category: "platos", group: "plato_casero", nova: 3, recipe: [["Mollusks, clam, mixed species, cooked, moist heat", 100], [MARRAQUETA, 40], [LECHE, 100], [PARMESANO, 15], [CEBOLLA, 30], [MANTEQUILLA, 10], ["sal", 1.5]], yield: 260, servings: [["1 porción", 260]] },
  { id: "cl:ajiaco", name: "Ajiaco", aliases: ["ajiaco chileno", "sopa de carne con papas"], category: "platos", group: "plato_casero", nova: 1, recipe: [[ESTOFADO, 80], [PAPA, 120], [CEBOLLA, 40], [HUEVO, 20], [ACEITE, 6], ["agua", 200], ["sal", 2.5]], servings: [["1 plato", 470]] },
  { id: "cl:tomatican", name: "Tomaticán", aliases: ["tomatican"], category: "platos", group: "plato_casero", nova: 1, recipe: [[TOMATE, 150], [CHOCLO, 80], [CEBOLLA, 40], [CARNE_MOLIDA, 40], [ACEITE, 6], ["sal", 1.5]], servings: [["1 plato", 315]] },
  { id: "cl:pollo_horno_papas", name: "Pollo al horno con papas", aliases: ["pollo con papas al horno", "pollo asado con papas"], category: "platos", group: "plato_casero", nova: 1, recipe: [["Chicken, broilers or fryers, leg, meat and skin, cooked, roasted", 160], ["Potatoes, baked, flesh and skin, without salt", 150], [OLIVA, 8], ["sal", 1.5]], servings: [["1 plato", 320]] },
  { id: "cl:merluza_pure", name: "Merluza con puré", aliases: ["pescado con puré", "merluza con puré de papas"], category: "platos", group: "plato_casero", nova: 3, recipe: [["Fish, cod, Atlantic, cooked, dry heat", 150], ["Potatoes, mashed, home-prepared, whole milk and butter added", 200]], servings: [["1 plato", 350]] },
  { id: "cl:porotos_pilco", name: "Porotos con mazamorra (pilco)", aliases: ["pilco", "porotos con mazamorra"], category: "platos", group: "plato_casero", nova: 1, recipe: [["Beans, cranberry (roman), mature seeds, cooked, boiled, without salt", 140], [CHOCLO, 100], [ZAPALLO, 60], [CEBOLLA, 25], [ACEITE, 6], ["agua", 80], ["sal", 2]], servings: [["1 plato", 410]] },
  { id: "cl:revuelto_zapallito", name: "Revuelto de zapallo italiano", aliases: ["revuelto de zapallitos", "zapallitos con huevo"], category: "platos", group: "plato_casero", nova: 1, recipe: [["Squash, summer, zucchini, includes skin, cooked, boiled, drained, without salt", 150], [HUEVO, 50], [CEBOLLA, 30], [ACEITE, 6], ["sal", 1]], servings: [["1 plato", 235]] },
  { id: "cl:avena_fruta", name: "Avena con fruta", aliases: ["avena con plátano", "porridge con fruta", "overnight oats"], category: "platos", group: "cereal_integral", nova: 1, recipe: [["Cereals, oats, regular and quick, not fortified, dry", 40], ["Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D", 200], [PLATANO, 60]], servings: [["1 plato", 300]] },
);

Object.assign(CATALOG_SAME, {
  "cl:pollo_muslo_sin_piel": "pollo_muslo_sin_piel", "cl:vacuno_filete": "vacuno_filete", "cl:vacuno_molida_magra": "vacuno_molida_magra",
  "cl:atun_fresco": "atun_fresco", "cl:trucha": "trucha", "cl:salmon_ahumado": "salmon_ahumado", "cl:bacalao": "bacalao",
  "cl:lenguado": "lenguado", "cl:tilapia": "tilapia", "cl:ostiones": "ostiones", "cl:yogur_descremado": "yogur_descremado",
  "cl:queso_cottage": "queso_cottage", "cl:queso_ricotta": "queso_ricotta", "cl:queso_mozzarella": "queso_mozzarella",
  "cl:leche_soya": "leche_soya", "cl:porotos_blancos": "porotos_blancos", "cl:edamame": "edamame", "cl:tempeh": "tempeh",
  "cl:fideos_arroz": "fideos_arroz", "cl:avena_cocida": "avena_cocida", "cl:tortilla_maiz": "tortilla_maiz", "cl:yuca": "yuca",
  "cl:cebollin": "cebollin", "cl:rucula": "rucula", "cl:aji_verde": "aji_verde", "cl:aceitunas": "aceitunas", "cl:papaya": "papaya",
  "cl:moras": "mora", "cl:datiles": "datiles", "cl:castana_caju": "castana_caju", "cl:avellanas": "avellanas",
  "cl:semillas_zapallo": "semillas_zapallo", "cl:sesamo": "sesamo", "cl:tahini": "tahini", "cl:aceite_coco": "aceite_coco",
  "cl:vinagre": "vinagre", "cl:jugo_manzana": "jugo_manzana", "cl:agua": "agua",
});

// Alias de la base que ahora son su propio alimento (fase I5)
for (const [id, als] of Object.entries({
  "cl:durazno": ["nectarín"], "cl:cereza": ["guindas"], "cl:melon": ["melón tuna"], "cl:papas_fritas": ["papas al horno"],
  "cl:jaiba": ["centolla"], "cl:lomo_vetado": ["lomo liso"], "cl:asado_tira": ["tapapecho"], "cl:huevos_revueltos": ["omelette"],
  "cl:granola": ["muesli"], "cl:semola_leche": ["sémola"], "cl:aceite_vegetal": ["aceite de canola"], "cl:te": ["té verde", "infusión"],
  "cl:cafe": ["espresso"], "cl:cafe_leche": ["latte"], "cl:chocolate_caliente": ["milo", "cola cao"], "cl:ramitas": ["pretzels"],
  "cl:sopa_sobre": ["crema de espárragos"], "cl:lasana": ["canelones"],
})) ALIAS_MOVES[id] = [...(ALIAS_MOVES[id] ?? []), ...als];
for (const [id, als] of Object.entries({
  durazno: ["nectarín"], cereza: ["guindas"], papas_fritas: ["papas al horno"], jaiba: ["centolla"], granola: ["muesli"],
  aceite_vegetal: ["aceite de canola"], te: ["té verde", "infusión"], cafe: ["espresso"],
})) CATALOG_ALIAS_MOVES[id] = [...(CATALOG_ALIAS_MOVES[id] ?? []), ...als];
// Con la base ampliada, lo de siempre tiene que seguir ganando sin empate: «carne molida» es la de vacuno (no la magra 90/10
// ni la de cerdo) y «yogur» es el natural (no el de sabor)
for (const [id, als] of Object.entries({ "cl:carne_molida": ["carne molida"], "cl:yogur_natural": ["yogur"] })) ALIAS_ADDS[id] = [...(ALIAS_ADDS[id] ?? []), ...als];
