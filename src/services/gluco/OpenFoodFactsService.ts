// ============================================================
// Eris — OpenFoodFactsService
// Open Food Facts — crowdsourced, sin API key, bueno para
// productos envasados chilenos/latinoamericanos con barcode.
// Docs: https://openfoodfacts.github.io/openfoodfacts-server/api/
// ============================================================

import type { FoodItem, FoodServing } from "./USDAFoodService.js";

export class OpenFoodFactsService {
  private readonly BASE = "https://world.openfoodfacts.org/api/v2";

  async findByBarcode(barcode: string): Promise<FoodItem | null> {
    try {
      const res = await fetch(`${this.BASE}/product/${barcode}.json?fields=product_name,brands,nutriments,serving_size,serving_quantity`, {
        headers: { "User-Agent": "Eris-Health-App/1.0 (contact@axs-eris.app)" },
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      if (data.status === 0 || !data.product) return null;
      return this.normalize(data.product, barcode);
    } catch {
      return null;
    }
  }

  async searchFoods(query: string, countryCode = "cl", maxResults = 10): Promise<Array<{ id: string; name: string; brandName?: string; description: string }>> {
    try {
      const params = new URLSearchParams({
        search_terms: query,
        countries_tags_en: `en:${this.countryName(countryCode)}`,
        fields: "code,product_name,brands,nutriments",
        page_size: String(maxResults),
        json: "1",
      });
      const res = await fetch(`${this.BASE}/search?${params}`, {
        headers: { "User-Agent": "Eris-Health-App/1.0 (contact@axs-eris.app)" },
      });
      if (!res.ok) return [];
      const data = await res.json() as any;
      return (data.products ?? []).map((p: any) => ({
        id: `off:${p.code}`,
        name: p.product_name || p.code,
        brandName: p.brands,
        description: this.buildDescription(p.nutriments),
      }));
    } catch {
      return [];
    }
  }

  private normalize(p: any, barcode: string): FoodItem {
    const n = p.nutriments ?? {};

    const per100: FoodServing = {
      id: "off_100g",
      description: "100g",
      calories: parseFloat(n["energy-kcal_100g"] ?? n["energy_100g"] / 4.184),
      carbs:    parseFloat(n["carbohydrates_100g"] ?? 0),
      fiber:    parseFloat(n["fiber_100g"] ?? 0),
      protein:  parseFloat(n["proteins_100g"] ?? 0),
      fat:      parseFloat(n["fat_100g"] ?? 0),
      sugar:    n["sugars_100g"] != null ? parseFloat(n["sugars_100g"]) : undefined,
      sodium:   n["sodium_100g"] != null ? parseFloat(n["sodium_100g"]) * 1000 : undefined,
      metricServingAmount: 100,
    };

    const servings: FoodServing[] = [per100];

    // Agregar porción de la etiqueta si tiene cantidad
    const servingG = parseFloat(p.serving_quantity ?? 0);
    if (servingG > 0) {
      const factor = servingG / 100;
      servings.unshift({
        id: "off_serving",
        description: p.serving_size || `${servingG}g`,
        calories: Math.round(per100.calories * factor),
        carbs:    Math.round(per100.carbs    * factor * 10) / 10,
        fiber:    Math.round(per100.fiber    * factor * 10) / 10,
        protein:  Math.round(per100.protein  * factor * 10) / 10,
        fat:      Math.round(per100.fat      * factor * 10) / 10,
        sugar:    per100.sugar != null ? Math.round(per100.sugar * factor * 10) / 10 : undefined,
        metricServingAmount: servingG,
      });
    }

    return {
      id: `off:${barcode}`,
      name: p.product_name || `Producto ${barcode}`,
      brandName: p.brands,
      type: "Brand",
      servings,
      defaultServing: servings[0],
    };
  }

  private buildDescription(n: any): string {
    if (!n) return "";
    const kcal = parseFloat(n["energy-kcal_100g"] ?? 0).toFixed(0);
    const prot = parseFloat(n["proteins_100g"] ?? 0).toFixed(1);
    const fat  = parseFloat(n["fat_100g"] ?? 0).toFixed(1);
    const carb = parseFloat(n["carbohydrates_100g"] ?? 0).toFixed(1);
    return `Por 100g — ${kcal} kcal | Prot: ${prot}g | Grasa: ${fat}g | Carbs: ${carb}g`;
  }

  private countryName(code: string): string {
    const map: Record<string, string> = { cl: "chile", ar: "argentina", pe: "peru", mx: "mexico", co: "colombia", br: "brazil" };
    return map[code] ?? "chile";
  }
}
