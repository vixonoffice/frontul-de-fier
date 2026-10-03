// Trigonometrie deterministă: aproximări polinomiale, doar +,-,*,/,abs,%.
// Math.sin/cos/atan2 NU sunt garantate identice bit-cu-bit între motoare JS; +,-,*,/,%,Math.sqrt sunt
// (IEEE 754 exact), deci sunt singurele primitive matematice folosite aici.

export const PI = Math.PI; // constantă, nu o funcție trigonometrică
const TWO_PI = PI * 2;
const HALF_PI = PI / 2;

/** Aduce un unghi în (-PI, PI]. */
export function wrapAngle(a: number): number {
  let x = a % TWO_PI;
  if (x > PI) x -= TWO_PI;
  else if (x <= -PI) x += TWO_PI;
  return x;
}

// Aproximare polinomială de grad înalt (Bhaskara-style refinement), eroare max ~0.0012 rad.
export function fsin(a: number): number {
  const x = wrapAngle(a);
  const B = 4 / PI;
  const C = -4 / (PI * PI);
  const y = B * x + C * x * Math.abs(x);
  const P = 0.225;
  return P * (y * Math.abs(y) - y) + y;
}

export function fcos(a: number): number {
  return fsin(a + HALF_PI);
}

// atan() aproximativ pentru |z| <= 1, eroare max ~0.0038 rad.
function atanApprox(z: number): number {
  const n1 = 0.97239411;
  const n2 = -0.19194795;
  return (n1 + n2 * z * z) * z;
}

export function fatan2(y: number, x: number): number {
  if (x !== 0) {
    if (Math.abs(x) > Math.abs(y)) {
      const z = y / x;
      if (x > 0) return atanApprox(z);
      return y >= 0 ? atanApprox(z) + PI : atanApprox(z) - PI;
    } else {
      const z = x / y;
      if (y > 0) return -atanApprox(z) + HALF_PI;
      if (y < 0) return -atanApprox(z) - HALF_PI;
      return 0;
    }
  }
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

export function fsqrt(x: number): number {
  return Math.sqrt(x); // IEEE 754 exact, identic pe orice motor conform
}

/** Diferența unghiulară semnată minimă de la `a` la `b`, în (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** Rotește `cur` spre `target` cu cel mult `maxDelta` radiani. */
export function turnToward(cur: number, target: number, maxDelta: number): number {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= maxDelta) return wrapAngle(target);
  return wrapAngle(cur + (d > 0 ? maxDelta : -maxDelta));
}

export function dist2(dx: number, dy: number): number {
  return dx * dx + dy * dy;
}

export function dist(dx: number, dy: number): number {
  return fsqrt(dx * dx + dy * dy);
}
