// ============================================================
// Eris — USDAFoodService
// USDA FoodData Central API (gratuito, 1M+ alimentos)
// Docs: https://fdc.nal.usda.gov/api-guide
// ============================================================

export interface FoodServing {
  id: string;
  description: string;
  calories: number;
  carbs: number;
  fiber: number;
  protein: number;
  fat: number;
  sugar?: number;
  sodium?: number;
  metricServingAmount?: number;
}

export interface FoodItem {
  id: string;
  name: string;
  brandName?: string;
  type: string;
  servings: FoodServing[];
  defaultServing: FoodServing;
}

export interface FoodSearchResult {
  items: Array<{ id: string; name: string; brandName?: string; description: string }>;
  totalResults: number;
  page: number;
}

// Nutrient IDs relevantes de FDC
const NID = {
  energy:  1008,
  protein: 1003,
  fat:     1004,
  carbs:   1005,
  fiber:   1079,
  sugar:   2000,
  sodium:  1093,
} as const;

function nutrientVal(nutrients: any[], id: number): number {
  const n = nutrients?.find((n: any) => n.nutrientId === id || n.nutrient?.id === id);
  return n ? parseFloat(n.value ?? n.amount ?? 0) : 0;
}

export class USDAFoodService {
  private readonly BASE = "https://api.nal.usda.gov/fdc/v1";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async searchFoods(query: string, page = 0, maxResults = 15): Promise<FoodSearchResult> {
    const params = new URLSearchParams({
      query,
      dataType: "Foundation,SR Legacy,Survey (FNDDS)",
      pageSize: String(maxResults),
      pageNumber: String(page + 1),
      api_key: this.apiKey,
    });

    const res = await fetch(`${this.BASE}/foods/search?${params}`);
    if (!res.ok) throw new Error(`USDA search error: ${res.status}`);

    const data = await res.json() as any;
    const foods: any[] = data.foods ?? [];

    return {
      totalResults: data.totalHits ?? foods.length,
      page,
      items: foods.map((f: any) => ({
        id: `usda:${f.fdcId}`,
        name: f.description,
        brandName: f.brandOwner || f.brandName,
        description: this.buildDescription(f.foodNutrients),
      })),
    };
  }

  async getFoodById(fdcId: string | number): Promise<FoodItem> {
    const res = await fetch(`${this.BASE}/food/${fdcId}?api_key=${this.apiKey}`);
    if (!res.ok) throw new Error(`USDA food error: ${res.status}`);

    const f = await res.json() as any;
    const nutrients: any[] = f.foodNutrients ?? [];

    const per100: FoodServing = {
      id: "usda_100g",
      description: "100g",
      calories: nutrientVal(nutrients, NID.energy),
      carbs:    nutrientVal(nutrients, NID.carbs),
      fiber:    nutrientVal(nutrients, NID.fiber),
      protein:  nutrientVal(nutrients, NID.protein),
      fat:      nutrientVal(nutrients, NID.fat),
      sugar:    nutrientVal(nutrients, NID.sugar) || undefined,
      sodium:   nutrientVal(nutrients, NID.sodium) || undefined,
      metricServingAmount: 100,
    };

    // Si tiene porciones definidas las añadimos
    const servings: FoodServing[] = [per100];
    if (Array.isArray(f.foodPortions)) {
      for (const p of f.foodPortions) {
        const g = parseFloat(p.gramWeight ?? 0);
        if (g <= 0) continue;
        const factor = g / 100;
        servings.push({
          id: String(p.id ?? `usda_${g}g`),
          description: p.modifier || p.portionDescription || `${g}g`,
          calories: Math.round(per100.calories * factor),
          carbs:    Math.round(per100.carbs    * factor * 10) / 10,
          fiber:    Math.round(per100.fiber    * factor * 10) / 10,
          protein:  Math.round(per100.protein  * factor * 10) / 10,
          fat:      Math.round(per100.fat      * factor * 10) / 10,
          sugar:    per100.sugar != null ? Math.round(per100.sugar * factor * 10) / 10 : undefined,
          metricServingAmount: g,
        });
      }
    }

    return {
      id: `usda:${f.fdcId}`,
      name: f.description,
      brandName: f.brandOwner || f.brandName,
      type: f.dataType ?? "Generic",
      servings,
      defaultServing: servings[0],
    };
  }

  async findByBarcode(barcode: string): Promise<FoodItem | null> {
    try {
      const params = new URLSearchParams({
        query: "",
        gtinUpc: barcode,
        dataType: "Branded",
        pageSize: "1",
        api_key: this.apiKey,
      });
      const res = await fetch(`${this.BASE}/foods/search?${params}`);
      if (!res.ok) return null;
      const data = await res.json() as any;
      const first = data.foods?.[0];
      if (!first) return null;
      return this.getFoodById(first.fdcId);
    } catch {
      return null;
    }
  }

  private buildDescription(nutrients: any[]): string {
    if (!nutrients?.length) return "";
    const kcal = nutrientVal(nutrients, NID.energy);
    const prot = nutrientVal(nutrients, NID.protein);
    const fat  = nutrientVal(nutrients, NID.fat);
    const carb = nutrientVal(nutrients, NID.carbs);
    return `Por 100g — ${kcal} kcal | Prot: ${prot}g | Grasa: ${fat}g | Carbs: ${carb}g`;
  }
}
