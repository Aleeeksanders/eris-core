"""
Filtra el volcado oficial de Open Food Facts (en.openfoodfacts.org.products.csv.gz) a productos vendidos en Chile
y los escribe como JSON con la misma forma que la API v2 (para scripts/build_packaged.ts).

Uso:  python scripts/import_off_csv.py <off.csv.gz> <carpeta_salida> [pais_tag=en:chile]
Datos © contribuidores de Open Food Facts, licencia ODbL (https://openfoodfacts.org).
"""
import csv, gzip, json, os, sys

csv.field_size_limit(10 ** 9)
src, out = sys.argv[1], sys.argv[2]
country = sys.argv[3] if len(sys.argv) > 3 else "en:chile"
os.makedirs(out, exist_ok=True)

NUTR = ["energy-kcal_100g", "energy_100g", "proteins_100g", "carbohydrates_100g", "fat_100g", "fiber_100g",
        "sugars_100g", "sodium_100g", "saturated-fat_100g"]
split = lambda v: [x.strip() for x in v.split(",") if x.strip()] if v else []

def fnum(v):
    try:
        return float(v)
    except Exception:
        return None

with gzip.open(src, "rt", encoding="utf-8", newline="") as f:
    r = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
    h = next(r)
    idx = {c: i for i, c in enumerate(h)}
    g = lambda row, c: row[idx[c]] if c in idx and idx[c] < len(row) else ""
    batch, n_all, n_cl, page = [], 0, 0, 0
    for row in r:
        n_all += 1
        if country not in split(g(row, "countries_tags")):
            continue
        n_cl += 1
        nutr = {}
        for k in NUTR:
            v = fnum(g(row, k))
            if v is not None:
                nutr[k] = v
        batch.append({
            "code": g(row, "code"),
            "product_name": g(row, "product_name"),
            "brands": g(row, "brands"),
            "serving_size": g(row, "serving_size"),
            "serving_quantity": fnum(g(row, "serving_quantity")),
            "allergens_tags": split(g(row, "allergens")),
            "traces_tags": split(g(row, "traces_tags")),
            "ingredients_text": g(row, "ingredients_text"),
            "states_tags": split(g(row, "states_tags")),
            "ingredients_analysis_tags": split(g(row, "ingredients_analysis_tags")),
            "labels_tags": split(g(row, "labels_tags")),
            "nova_group": fnum(g(row, "nova_group")),
            "nutriments": nutr,
        })
        if len(batch) >= 2000:
            json.dump(batch, open(os.path.join(out, f"cl{page:03d}.json"), "w", encoding="utf-8"), ensure_ascii=False)
            page += 1
            batch = []
        if n_all % 500000 == 0:
            print(f"  leídos {n_all:,} · chilenos {n_cl:,}", flush=True)
    if batch:
        json.dump(batch, open(os.path.join(out, f"cl{page:03d}.json"), "w", encoding="utf-8"), ensure_ascii=False)
print(f"listo: {n_all:,} productos en el volcado · {n_cl:,} vendidos en Chile")
