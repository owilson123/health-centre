"""Nutrition tracker — food diary, macro goals, Open Food Facts search, smart suggestions."""
import logging
from datetime import date
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel

from database import db
from auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/nutrition", tags=["nutrition"])


# ─── Schema init ──────────────────────────────────────────────────────────────

def init_nutrition_db(user_id: str | None = None):
    with db(user_id) as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS nutrition_goals (
            id           INTEGER PRIMARY KEY DEFAULT 1,
            calories     INTEGER NOT NULL DEFAULT 2000,
            protein_g    REAL    NOT NULL DEFAULT 150,
            carbs_g      REAL    NOT NULL DEFAULT 200,
            fat_g        REAL    NOT NULL DEFAULT 65,
            goal_type    TEXT    DEFAULT 'maintain',
            activity_level TEXT  DEFAULT 'moderate',
            updated_at   TEXT    DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS food_logs (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            log_date     TEXT    NOT NULL DEFAULT (date('now')),
            meal         TEXT    NOT NULL DEFAULT 'snack',
            food_name    TEXT    NOT NULL,
            brand        TEXT,
            quantity_g   REAL    NOT NULL DEFAULT 100,
            calories     REAL    NOT NULL,
            protein_g    REAL    NOT NULL DEFAULT 0,
            carbs_g      REAL    NOT NULL DEFAULT 0,
            fat_g        REAL    NOT NULL DEFAULT 0,
            fiber_g      REAL    DEFAULT 0,
            logged_at    TEXT    DEFAULT (datetime('now'))
        );
        """)


# ─── Pydantic models ──────────────────────────────────────────────────────────

class GoalsUpdate(BaseModel):
    calories:       int   = 2000
    protein_g:      float = 150.0
    carbs_g:        float = 200.0
    fat_g:          float = 65.0
    goal_type:      str   = "maintain"
    activity_level: str   = "moderate"


class FoodLogCreate(BaseModel):
    meal:              str
    food_name:         str
    brand:             Optional[str]  = None
    quantity_g:        float          = 100.0
    calories_per_100g: float
    protein_per_100g:  float          = 0.0
    carbs_per_100g:    float          = 0.0
    fat_per_100g:      float          = 0.0
    fiber_per_100g:    float          = 0.0
    log_date:          Optional[str]  = None   # YYYY-MM-DD; defaults to today


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _default_goals() -> dict:
    return {
        "id":             1,
        "calories":       2000,
        "protein_g":      150.0,
        "carbs_g":        200.0,
        "fat_g":          65.0,
        "goal_type":      "maintain",
        "activity_level": "moderate",
        "updated_at":     None,
    }


def _get_goals(conn) -> dict:
    row = conn.execute("SELECT * FROM nutrition_goals WHERE id = 1").fetchone()
    return dict(row) if row else _default_goals()


def _diary_totals(logs: list[dict]) -> dict:
    return {
        "calories":  round(sum(e["calories"]  for e in logs), 1),
        "protein_g": round(sum(e["protein_g"] for e in logs), 1),
        "carbs_g":   round(sum(e["carbs_g"]   for e in logs), 1),
        "fat_g":     round(sum(e["fat_g"]      for e in logs), 1),
        "fiber_g":   round(sum(e["fiber_g"] or 0 for e in logs), 1),
    }


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.get("/goals")
def get_goals(user_id: str = Depends(get_current_user)):
    with db(user_id) as conn:
        return _get_goals(conn)


@router.put("/goals")
def update_goals(body: GoalsUpdate, user_id: str = Depends(get_current_user)):
    with db(user_id) as conn:
        conn.execute("""
            INSERT INTO nutrition_goals
              (id, calories, protein_g, carbs_g, fat_g, goal_type, activity_level, updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              calories       = excluded.calories,
              protein_g      = excluded.protein_g,
              carbs_g        = excluded.carbs_g,
              fat_g          = excluded.fat_g,
              goal_type      = excluded.goal_type,
              activity_level = excluded.activity_level,
              updated_at     = excluded.updated_at
        """, (body.calories, body.protein_g, body.carbs_g, body.fat_g,
              body.goal_type, body.activity_level))
    return {"status": "updated"}


@router.get("/diary")
def get_diary(
    date: str = Query(default=None, description="YYYY-MM-DD"),
    user_id: str = Depends(get_current_user),
):
    target_date = date or str(__import__("datetime").date.today())

    with db(user_id) as conn:
        goals = _get_goals(conn)

        rows = conn.execute(
            "SELECT * FROM food_logs WHERE log_date = ? ORDER BY logged_at ASC",
            (target_date,)
        ).fetchall()
        logs = [dict(r) for r in rows]

        # Group by meal
        meals: dict[str, list] = {}
        for entry in logs:
            meals.setdefault(entry["meal"], []).append(entry)

        totals = _diary_totals(logs)

        # Garmin calorie data from steps table
        garmin_burned = 0
        garmin_active_cals = 0
        try:
            steps_row = conn.execute(
                "SELECT total_calories, active_calories FROM steps WHERE date = ?",
                (target_date,)
            ).fetchone()
            if steps_row:
                # Prefer active_calories column if it exists and has data
                active = steps_row["active_calories"] if "active_calories" in steps_row.keys() else None
                total  = steps_row["total_calories"]  if "total_calories"  in steps_row.keys() else None
                if active:
                    garmin_active_cals = active or 0
                    garmin_burned      = total  or 0
                elif total:
                    # Estimate BMR ~1700 kcal/day; active = total - bmr_fraction
                    bmr_estimate       = 1700
                    garmin_active_cals = max(0, (total or 0) - bmr_estimate)
                    garmin_burned      = total or 0
        except Exception:
            pass

        calorie_balance = {
            "goal":      goals["calories"],
            "consumed":  totals["calories"],
            "burned":    garmin_burned,
            "remaining": round(goals["calories"] + garmin_active_cals - totals["calories"], 1),
        }

    return {
        "date":             target_date,
        "meals":            meals,
        "totals":           totals,
        "calorie_balance":  calorie_balance,
    }


@router.post("/diary", status_code=201)
def add_food_log(body: FoodLogCreate, user_id: str = Depends(get_current_user)):
    log_date = body.log_date or str(__import__("datetime").date.today())
    ratio = body.quantity_g / 100.0

    calories  = round(body.calories_per_100g * ratio, 2)
    protein_g = round(body.protein_per_100g  * ratio, 2)
    carbs_g   = round(body.carbs_per_100g    * ratio, 2)
    fat_g     = round(body.fat_per_100g      * ratio, 2)
    fiber_g   = round(body.fiber_per_100g    * ratio, 2)

    with db(user_id) as conn:
        cur = conn.execute("""
            INSERT INTO food_logs
              (log_date, meal, food_name, brand, quantity_g,
               calories, protein_g, carbs_g, fat_g, fiber_g)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (log_date, body.meal, body.food_name, body.brand, body.quantity_g,
              calories, protein_g, carbs_g, fat_g, fiber_g))

    return {"id": cur.lastrowid, "status": "logged", "calories": calories}


@router.delete("/diary/{entry_id}")
def delete_food_log(entry_id: int, user_id: str = Depends(get_current_user)):
    with db(user_id) as conn:
        row = conn.execute("SELECT id FROM food_logs WHERE id = ?", (entry_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Food log entry not found")
        conn.execute("DELETE FROM food_logs WHERE id = ?", (entry_id,))
    return {"status": "deleted"}


@router.get("/barcode/{code}")
def lookup_barcode(code: str, _uid: str = Depends(get_current_user)):
    """Look up a food product by barcode (EAN-13, UPC-A, etc.) via Open Food Facts."""
    url = f"https://world.openfoodfacts.org/api/v0/product/{code}.json"
    try:
        resp = httpx.get(url, timeout=6.0)
        data = resp.json()
    except Exception as exc:
        logger.warning("Barcode lookup failed for %s: %s", code, exc)
        raise HTTPException(404, "Product not found")

    if data.get("status") != 1:
        raise HTTPException(404, "Product not found")

    product    = data.get("product") or {}
    nutriments = product.get("nutriments") or {}

    # Calories per 100g — prefer kcal, fall back from kJ
    kcal = nutriments.get("energy-kcal_100g")
    if kcal is None:
        kj = nutriments.get("energy_100g")
        kcal = kj / 4.184 if kj else None
    if kcal is None:
        raise HTTPException(422, "Product found but has no calorie data")

    name  = (product.get("product_name") or "").strip()
    brand = (product.get("brands")       or "").strip() or None
    if not name:
        name = f"Product {code}"

    # Parse serving size in grams
    serving_raw = product.get("serving_size") or ""
    serving_g: float = 100.0
    try:
        import re as _re
        m = _re.search(r"(\d+(?:\.\d+)?)\s*g", serving_raw)
        if m:
            serving_g = float(m.group(1))
    except Exception:
        pass

    return {
        "name":           name,
        "brand":          brand,
        "serving_size_g": serving_g,
        "calories_100g":  round(float(kcal), 1),
        "protein_100g":   round(float(nutriments.get("proteins_100g")      or 0), 1),
        "carbs_100g":     round(float(nutriments.get("carbohydrates_100g") or 0), 1),
        "fat_100g":       round(float(nutriments.get("fat_100g")           or 0), 1),
        "fiber_100g":     round(float(nutriments.get("fiber_100g")
                                     or nutriments.get("fibers_100g") or 0), 1),
        "image_url":      product.get("image_small_url") or None,
    }


@router.get("/search")
def search_food(q: str = Query(..., min_length=2), _uid: str = Depends(get_current_user)):
    """Proxy search to Open Food Facts. Returns up to 20 results with per-100g macros."""
    url = (
        "https://world.openfoodfacts.org/cgi/search.pl"
        f"?search_terms={q}"
        "&search_simple=1&action=process&json=1&page_size=20"
        "&fields=product_name,brands,nutriments,serving_size,quantity,image_small_url"
    )
    try:
        resp = httpx.get(url, timeout=5.0)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("Open Food Facts search failed: %s", exc)
        return []

    results = []
    for product in data.get("products", []):
        nutriments = product.get("nutriments") or {}

        # Calories per 100g — prefer kcal, fall back to kJ / 4.184
        kcal = nutriments.get("energy-kcal_100g")
        if kcal is None:
            kj = nutriments.get("energy_100g")
            kcal = kj / 4.184 if kj else None
        if kcal is None:
            continue   # skip products with no calorie data

        name  = (product.get("product_name") or "").strip()
        brand = (product.get("brands") or "").strip()
        if not name:
            continue

        # Parse serving size as a float (grams) where possible
        serving_raw = product.get("serving_size") or ""
        serving_g: float = 100.0
        try:
            import re
            m = re.search(r"(\d+(?:\.\d+)?)\s*g", serving_raw)
            if m:
                serving_g = float(m.group(1))
        except Exception:
            pass

        results.append({
            "name":           name,
            "brand":          brand or None,
            "serving_size_g": serving_g,
            "calories_100g":  round(float(kcal), 1),
            "protein_100g":   round(float(nutriments.get("proteins_100g")       or 0), 1),
            "carbs_100g":     round(float(nutriments.get("carbohydrates_100g")  or 0), 1),
            "fat_100g":       round(float(nutriments.get("fat_100g")            or 0), 1),
            "fiber_100g":     round(float(nutriments.get("fiber_100g")
                                         or nutriments.get("fibers_100g") or 0), 1),
            "image_url":      product.get("image_small_url") or None,
        })

    return results


# ─── Suggestion engine ────────────────────────────────────────────────────────
#
# Hardcoded common foods with approximate per-100g macros.
# Scoring: we weight each nutrient gap proportionally and pick foods that
# fill the largest gaps first, so high-protein days push chicken/whey
# to the top while low-fat days push lean sources higher.

COMMON_FOODS = [
    # name,                  cal,   prot,  carbs, fat,   fiber  (all per 100g)
    ("Chicken Breast",        165,   31.0,   0.0,  3.6,   0.0),
    ("Greek Yogurt (0%)",      59,   10.2,   3.6,  0.4,   0.0),
    ("Porridge Oats",         379,   13.0,  67.0,  7.0,  10.6),
    ("White Rice (cooked)",   130,    2.7,  28.0,  0.3,   0.4),
    ("Whole Eggs",            155,   13.0,   1.1, 11.0,   0.0),
    ("Tuna (in water)",       109,   25.5,   0.0,  0.8,   0.0),
    ("Salmon (cooked)",       208,   20.0,   0.0, 13.0,   0.0),
    ("Sweet Potato (baked)",   86,    1.6,  20.1,  0.1,   3.0),
    ("Avocado",               160,    2.0,   9.0, 15.0,   7.0),
    ("Almonds",               579,   21.0,  22.0, 50.0,  12.5),
    ("Banana",                 89,    1.1,  23.0,  0.3,   2.6),
    ("Cottage Cheese (2%)",    90,   11.0,   3.4,  2.7,   0.0),
    ("Broccoli (steamed)",     35,    2.4,   7.0,  0.4,   2.6),
    ("Whole Wheat Bread",     247,    9.0,  47.0,  3.4,   6.0),
    ("Peanut Butter",         588,   25.0,  20.0, 50.0,   6.0),
    ("Protein Shake (mixed)",  96,   20.0,   3.0,  1.5,   0.5),
    ("Beef Mince (5% fat)",   137,   21.0,   0.0,  5.0,   0.0),
    ("Red Lentils (cooked)",  116,    9.0,  20.0,  0.4,   7.9),
    ("Olive Oil",             884,    0.0,   0.0, 100.0,  0.0),
    ("Whey Protein (powder)", 400,   80.0,   8.0,  5.0,   0.0),
]


def _score_food(
    food: tuple,
    rem_calories: float,
    rem_protein: float,
    rem_carbs: float,
    rem_fat: float,
) -> float:
    """
    Score a food by how well a ~standard serving fills the remaining gaps.
    Standard serving = 100g for most foods (scale factors applied below).
    Higher = better match.
    """
    _name, cal, prot, carbs, fat, _fiber = food

    # Normalise remainders to avoid negative weights dominating
    rc = max(rem_calories, 0)
    rp = max(rem_protein,  0)
    rk = max(rem_carbs,    0)
    rf = max(rem_fat,      0)

    total_rem = rc + rp * 4 + rk * 4 + rf * 9   # in kcal terms
    if total_rem == 0:
        return 0.0

    # Contribution weight for each macro as fraction of remaining total (kcal)
    w_cal  = rc              / total_rem
    w_prot = (rp * 4)        / total_rem
    w_carb = (rk * 4)        / total_rem
    w_fat  = (rf * 9)        / total_rem

    # Score = weighted dot product of macro supply vs remaining need
    # Divided by per-100g calorie density so calorie-dense foods don't
    # dominate unless calories are actually the main gap.
    density_norm = max(cal, 50) / 200.0
    score = (
        w_prot * prot +
        w_carb * carbs +
        w_fat  * fat +
        w_cal  * cal / 100.0
    ) / density_norm

    return score


def _reason_for_food(
    food_name: str,
    rem_protein: float,
    rem_carbs: float,
    rem_fat: float,
    rem_calories: float,
) -> str:
    """Generate a short human-readable reason string."""
    dominant = max(
        [("protein", rem_protein), ("carbs", rem_carbs),
         ("fat", rem_fat), ("calories", rem_calories / 40)],
        key=lambda x: max(x[1], 0),
    )
    label = dominant[0]
    if label == "protein":
        return f"High-protein option to close your {round(rem_protein, 0):.0f}g protein gap"
    elif label == "carbs":
        return f"Quality carb source — {round(rem_carbs, 0):.0f}g carbs still to go"
    elif label == "fat":
        return f"Healthy fats — {round(rem_fat, 0):.0f}g fat remaining in your goal"
    else:
        return f"Fills ~{round(rem_calories, 0):.0f} kcal remaining in today's budget"


@router.get("/suggest")
def suggest_foods(
    date: str = Query(default=None, description="YYYY-MM-DD"),
    user_id: str = Depends(get_current_user),
):
    """Return top 5 food suggestions based on remaining macros for the day."""
    target_date = date or str(__import__("datetime").date.today())

    with db(user_id) as conn:
        goals = _get_goals(conn)
        rows  = conn.execute(
            "SELECT calories, protein_g, carbs_g, fat_g FROM food_logs WHERE log_date = ?",
            (target_date,)
        ).fetchall()

    consumed_cal   = sum(r["calories"]  for r in rows)
    consumed_prot  = sum(r["protein_g"] for r in rows)
    consumed_carbs = sum(r["carbs_g"]   for r in rows)
    consumed_fat   = sum(r["fat_g"]     for r in rows)

    rem_calories = goals["calories"]  - consumed_cal
    rem_protein  = goals["protein_g"] - consumed_prot
    rem_carbs    = goals["carbs_g"]   - consumed_carbs
    rem_fat      = goals["fat_g"]     - consumed_fat

    scored = sorted(
        COMMON_FOODS,
        key=lambda f: _score_food(f, rem_calories, rem_protein, rem_carbs, rem_fat),
        reverse=True,
    )

    suggestions = []
    for food in scored[:5]:
        name, cal, prot, carbs, fat, fiber = food
        # Suggest a sensible serving size (roughly 200 kcal portion unless food is very dense)
        if cal > 0:
            serving_g = min(200, max(30, round(200 / cal * 100 / 10) * 10))
        else:
            serving_g = 100
        ratio = serving_g / 100.0
        suggestions.append({
            "name":       name,
            "serving_g":  serving_g,
            "calories":   round(cal * ratio, 1),
            "protein_g":  round(prot  * ratio, 1),
            "carbs_g":    round(carbs * ratio, 1),
            "fat_g":      round(fat   * ratio, 1),
            "fiber_g":    round(fiber * ratio, 1),
            "per_100g": {
                "calories": cal,
                "protein_g": prot,
                "carbs_g":   carbs,
                "fat_g":     fat,
                "fiber_g":   fiber,
            },
            "reason": _reason_for_food(name, rem_protein, rem_carbs, rem_fat, rem_calories),
        })

    return {
        "date":           target_date,
        "remaining": {
            "calories":  round(rem_calories, 1),
            "protein_g": round(rem_protein,  1),
            "carbs_g":   round(rem_carbs,    1),
            "fat_g":     round(rem_fat,      1),
        },
        "suggestions": suggestions,
    }
