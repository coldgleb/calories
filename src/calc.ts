export interface Nutrition {
  kcal: number
  protein: number
  fat: number
  carbs: number
}

export const ZERO: Nutrition = { kcal: 0, protein: 0, fat: 0, carbs: 0 }

export function add(a: Nutrition, b: Nutrition): Nutrition {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    fat: a.fat + b.fat,
    carbs: a.carbs + b.carbs,
  }
}

export function scale(n: Nutrition, factor: number): Nutrition {
  return {
    kcal: n.kcal * factor,
    protein: n.protein * factor,
    fat: n.fat * factor,
    carbs: n.carbs * factor,
  }
}

/** Nutrition of `grams` of a food given its values per 100 g. */
export function forGrams(per100g: Nutrition, grams: number): Nutrition {
  return scale(per100g, grams / 100)
}

export function sum(items: Nutrition[]): Nutrition {
  return items.reduce(add, ZERO)
}

export interface Ingredient {
  per100g: Nutrition
  grams: number
}

/**
 * Per-100 g values of a cooked dish. Water evaporates (or is absorbed) while
 * cooking, so the total is divided by the weight of the finished dish; without
 * it we fall back to the raw ingredient weight.
 */
export function recipePer100(ingredients: Ingredient[], cookedWeight?: number): Nutrition {
  const total = sum(ingredients.map((i) => forGrams(i.per100g, i.grams)))
  const rawWeight = ingredients.reduce((w, i) => w + i.grams, 0)
  const weight = cookedWeight && cookedWeight > 0 ? cookedWeight : rawWeight
  if (weight <= 0) return ZERO
  return scale(total, 100 / weight)
}

/** Converts label values "per portion" into per-100 g values. */
export function portionToPer100(perPortion: Nutrition, portionGrams: number): Nutrition {
  if (portionGrams <= 0) return ZERO
  return scale(perPortion, 100 / portionGrams)
}

export type Sex = 'male' | 'female'

export interface Profile {
  sex: Sex
  age: number
  heightCm: number
  weightKg: number
  /** Physical activity multiplier, 1.2 (sedentary) … 1.9 (very active). */
  activity: number
  /** Calorie deficit as a fraction of TDEE, e.g. 0.2 for 20 %. */
  deficit: number
}

export const ACTIVITY_LEVELS = [
  { value: 1.2, label: 'Сидячий образ жизни' },
  { value: 1.375, label: 'Лёгкая активность (1–3 тренировки)' },
  { value: 1.55, label: 'Средняя (3–5 тренировок)' },
  { value: 1.725, label: 'Высокая (6–7 тренировок)' },
  { value: 1.9, label: 'Очень высокая (физический труд)' },
]

/** Basal metabolic rate, Mifflin–St Jeor. */
export function bmr(p: Profile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age
  return p.sex === 'male' ? base + 5 : base - 161
}

export function tdee(p: Profile): number {
  return bmr(p) * p.activity
}

export const MIN_KCAL: Record<Sex, number> = { male: 1500, female: 1200 }

export interface Targets extends Nutrition {
  /** True when the deficit was capped by the safe minimum. */
  clamped: boolean
}

export function targets(p: Profile): Targets {
  const raw = tdee(p) * (1 - p.deficit)
  const min = MIN_KCAL[p.sex]
  const kcal = Math.round(Math.max(raw, min))
  const protein = Math.round(1.6 * p.weightKg)
  const fat = Math.round(0.8 * p.weightKg)
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4))
  return { kcal, protein, fat, carbs, clamped: raw < min }
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}
