// RNG determinist (mulberry32). Starea trăiește în `.rng` (world.rng, sau orice obiect compatibil
// — folosit și de map.ts înainte ca World-ul complet să existe). Nu folosiți niciodată Math.random.

export interface RngHolder { rng: number }

/** Avansează starea și întoarce un întreg neted pe 32 biți fără semn. */
export function nextU32(holder: RngHolder): number {
  let t = (holder.rng + 0x6d2b79f5) | 0;
  holder.rng = t;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

/** Flotant uniform în [0, 1). */
export function nextFloat(holder: RngHolder): number {
  return nextU32(holder) / 4294967296;
}

/** Întreg uniform în [0, n). */
export function nextInt(holder: RngHolder, n: number): number {
  return Math.floor(nextFloat(holder) * n);
}

/** Flotant uniform în [lo, hi). */
export function nextRange(holder: RngHolder, lo: number, hi: number): number {
  return lo + nextFloat(holder) * (hi - lo);
}

/** Alege un element uniform dintr-un array nevid. */
export function pick<T>(holder: RngHolder, arr: readonly T[]): T {
  return arr[nextInt(holder, arr.length)];
}

/** true cu probabilitatea p. */
export function chance(holder: RngHolder, p: number): boolean {
  return nextFloat(holder) < p;
}
