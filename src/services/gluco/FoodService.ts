// ============================================================
// Eris — FoodService
// Cliente FatSecret REST API v4 con OAuth 2.0 (Client Credentials)
// Docs: https://platform.fatsecret.com/docs/guides
// ============================================================

export interface FoodItem {
  id: string;
  name: string;
  brandName?: string;
  type: "Generic" | "Brand" | "Restaurant";
  servings: FoodServing[];
  /** Serving seleccionado actualmente (por defecto el primero) */
  defaultServing: FoodServing;
}

export interface FoodServing {
  id: string;
  description: string;     // "1 cup", "100g", "1 porción"
  calories: number;        // kcal
  carbs: number;           // g carbohidratos totales
  fiber: number;           // g fibra
  protein: number;         // g proteína
  fat: number;             // g grasa total
  sugar?: number;          // g azúcar
  sodium?: number;         // mg sodio
  /** Gramos equivalentes (si disponible) */
  metricServingAmount?: number;
}

export interface FoodSearchResult {
  items: Array<{
    id: string;
    name: string;
    brandName?: string;
    description: string;   // e.g., "Per 100g - Calories: 240kcal | Fat: 12g..."
  }>;
  totalResults: number;
  page: number;
}

interface FatSecretConfig {
  clientId: string;
  clientSecret: string;
}

interface OAuthToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  expiresAt: number;
}

export class FoodService {
  private config: FatSecretConfig;
  private token: OAuthToken | null = null;
  private readonly BASE_URL = "https://platform.fatsecret.com/rest/server.api";
  private readonly AUTH_URL = "https://oauth.fatsecret.com/connect/token";

  constructor(config: FatSecretConfig) {
    this.config = config;
  }

  // ─── OAuth 2.0 ───────────────────────────────────────────────────

  private async getToken(): Promise<string> {
    // Reutilizar token si sigue vigente (con 60s de margen)
    if (this.token && Date.now() < this.token.expiresAt - 60_000) {
      return this.token.access_token;
    }

    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");

    const res = await fetch(this.AUTH_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=basic",
    });

    if (!res.ok) {
      throw new Error(`FatSecret auth error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as any;
    this.token = {
      ...data,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return this.token!.access_token;
  }

  private async request<T>(params: Record<string, string>): Promise<T> {
    const token = await this.getToken();

    const searchParams = new URLSearchParams({
      ...params,
      format: "json",
    });

    const res = await fetch(`${this.BASE_URL}?${searchParams.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`FatSecret API error: ${res.status} → ${params.method}`);
    }

    return res.json() as Promise<T>;
  }

  // ─── Búsqueda ─────────────────────────────────────────────────────

  async searchFoods(query: string, page = 0, maxResults = 20): Promise<FoodSearchResult> {
    const res = await this.request<any>({
      method: "foods.search.v3",
      search_expression: query,
      page_number: String(page),
      max_results: String(maxResults),
    });

    const foods = res?.foods_search?.results?.food || [];
    const total = parseInt(res?.foods_search?.total_results || "0", 10);

    return {
      totalResults: total,
      page,
      items: Array.isArray(foods)
        ? foods.map((f: any) => ({
            id: f.food_id,
            name: f.food_name,
            brandName: f.brand_name,
            description: f.food_description || "",
          }))
        : [],
    };
  }

  // ─── Detalle de alimento ─────────────────────────────────────────

  async getFoodById(foodId: string): Promise<FoodItem> {
    const res = await this.request<any>({
      method: "food.get.v4",
      food_id: foodId,
    });

    const food = res?.food;
    if (!food) throw new Error(`Alimento ${foodId} no encontrado`);

    const servings = this.parseServings(food.servings?.serving);

    return {
      id: food.food_id,
      name: food.food_name,
      brandName: food.brand_name,
      type: food.food_type || "Generic",
      servings,
      defaultServing: servings[0] || this.emptyServing(),
    };
  }

  // ─── Búsqueda por código de barras ───────────────────────────────

  async findByBarcode(barcode: string): Promise<FoodItem | null> {
    try {
      const res = await this.request<any>({
        method: "food.find_id_for_barcode",
        barcode,
      });

      const foodId = res?.food_id?.value;
      if (!foodId) return null;

      return this.getFoodById(foodId);
    } catch {
      return null;
    }
  }

  // ─── Helpers de parseo ────────────────────────────────────────────

  private parseServings(raw: any): FoodServing[] {
    if (!raw) return [this.emptyServing()];

    const arr = Array.isArray(raw) ? raw : [raw];

    return arr.map((s: any) => ({
      id: s.serving_id || "0",
      description: s.serving_description || "1 porción",
      calories: parseFloat(s.calories || "0"),
      carbs: parseFloat(s.carbohydrate || "0"),
      fiber: parseFloat(s.fiber || "0"),
      protein: parseFloat(s.protein || "0"),
      fat: parseFloat(s.fat || "0"),
      sugar: s.sugar ? parseFloat(s.sugar) : undefined,
      sodium: s.sodium ? parseFloat(s.sodium) : undefined,
      metricServingAmount: s.metric_serving_amount
        ? parseFloat(s.metric_serving_amount)
        : undefined,
    }));
  }

  private emptyServing(): FoodServing {
    return {
      id: "0",
      description: "1 porción",
      calories: 0,
      carbs: 0,
      fiber: 0,
      protein: 0,
      fat: 0,
    };
  }
}
