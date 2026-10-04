// Siluete SVG desenate manual: umplere plină (currentColor) + decupaje întunecate (clasa .cut / .cutf din CSS).
// viewBox 0 0 48 48. Fără emoji, fără imagini externe.
const W = (inner: string): string =>
  `<svg class="ic" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${inner}</svg>`;

// șenile + roți, refolosite la vehicule
const TRACKS = `<rect x="5" y="31" width="38" height="10" rx="5" fill="currentColor"/><circle cx="12" cy="36" r="2.2" class="cutf"/><circle cx="24" cy="36" r="2.2" class="cutf"/><circle cx="36" cy="36" r="2.2" class="cutf"/>`;

const ICONS: Record<string, string> = {
  // ---------- unități ----------
  tank: W(`${TRACKS}<path d="M9 31 L12 22 H36 L40 31 Z" fill="currentColor"/><rect x="16" y="14" width="16" height="9" rx="2.5" fill="currentColor"/><rect x="30" y="16.5" width="16" height="3.6" rx="1" fill="currentColor"/><path d="M19 18.5 H27" class="cut"/>`),
  rocket: W(`${TRACKS}<path d="M9 31 L12 24 H34 L38 31 Z" fill="currentColor"/><path d="M15 23 L30 7 L36 11 L22 25 Z" fill="currentColor"/><path d="M20 19 L29 10 M24 22 L33 13" class="cut"/><circle cx="14" cy="26" r="1.6" class="cutf"/>`),
  harvester: W(`<rect x="5" y="33" width="38" height="8" rx="4" fill="currentColor"/><path d="M4 33 V23 H16 V33 Z" fill="currentColor"/><rect x="6.5" y="25" width="7" height="4.5" rx="1" class="cutf"/><path d="M16 33 V19 H44 V33 Z" fill="currentColor"/><path d="M19 19 L21 13 H41 L43 19" fill="currentColor"/><circle cx="24" cy="15.8" r="1.6" class="cutf"/><circle cx="31" cy="15.2" r="1.9" class="cutf"/><circle cx="37.5" cy="16" r="1.5" class="cutf"/><path d="M20 26 H40" class="cut"/><path d="M1 38 L5 33 V41 Z" fill="currentColor"/>`),
  soldier: W(`<circle cx="22" cy="9" r="5" fill="currentColor"/><path d="M14 22 Q14 15 22 15 Q30 15 30 22 V32 H14 Z" fill="currentColor"/><rect x="14" y="32" width="6" height="12" rx="2" fill="currentColor"/><rect x="24" y="32" width="6" height="12" rx="2" fill="currentColor"/><rect x="25" y="20" width="20" height="3.6" rx="1.2" fill="currentColor"/><path d="M17 15 L28 15" class="cut"/>`),
  bazooka: W(`<circle cx="20" cy="10" r="5" fill="currentColor"/><path d="M12 23 Q12 16 20 16 Q28 16 28 23 V33 H12 Z" fill="currentColor"/><rect x="12" y="33" width="6" height="11" rx="2" fill="currentColor"/><rect x="22" y="33" width="6" height="11" rx="2" fill="currentColor"/><path d="M5 22 L38 11 L40 16 L7 27 Z" fill="currentColor"/><path d="M38 9 L46 7 L47 17 L40 17 Z" fill="currentColor"/><path d="M15 16 L26 16" class="cut"/>`),
  bomber: W(`<path d="M3 24 L13 21 H34 L45 24 L34 27 H13 Z" fill="currentColor"/><path d="M19 22 L11 6 H18 L33 21 Z" fill="currentColor"/><path d="M19 26 L11 42 H18 L33 27 Z" fill="currentColor"/><path d="M6 23 L2 15 H7 L12 21 Z" fill="currentColor"/><path d="M6 25 L2 33 H7 L12 27 Z" fill="currentColor"/><circle cx="39" cy="24" r="1.7" class="cutf"/><path d="M16 24 H30" class="cut"/>`),
  // ---------- clădiri ----------
  hq: W(`<rect x="5" y="22" width="38" height="20" fill="currentColor"/><rect x="11" y="14" width="26" height="9" fill="currentColor"/><rect x="18" y="31" width="12" height="11" class="cutf"/><path d="M24 14 V3" stroke="currentColor" stroke-width="2.4"/><path d="M24 3 H33 L30 6.5 L33 10 H24 Z" fill="currentColor"/><path d="M9 27 H15 M33 27 H39 M15 18 H33" class="cut"/>`),
  refinery: W(`<rect x="3" y="33" width="42" height="9" fill="currentColor"/><rect x="5" y="17" width="15" height="17" rx="3" fill="currentColor"/><rect x="23" y="17" width="15" height="17" rx="3" fill="currentColor"/><path d="M8 24 H17 M26 24 H35" class="cut"/><path d="M38 28 H44 V8 H40 V24 H38 Z" fill="currentColor"/><path d="M20 26 H23" stroke="currentColor" stroke-width="3"/><rect x="38" y="5" width="9" height="5" fill="currentColor"/>`),
  factory: W(`<rect x="4" y="22" width="40" height="20" fill="currentColor"/><path d="M4 22 L14 13 V22 M14 22 L24 13 V22 M24 22 L34 13 V22" fill="currentColor"/><rect x="35" y="5" width="6" height="18" fill="currentColor"/><rect x="9" y="30" width="13" height="12" class="cutf"/><path d="M12 30 V42 M15.5 30 V42 M19 30 V42" stroke="currentColor" stroke-width="1.2"/><rect x="28" y="28" width="11" height="6" class="cutf"/>`),
  barracks: W(`<path d="M3 24 L24 11 L45 24 V42 H3 Z" fill="currentColor"/><rect x="19" y="29" width="10" height="13" class="cutf"/><path d="M10 29 H15 M33 29 H38" class="cut"/><path d="M24 11 V2" stroke="currentColor" stroke-width="2.4"/><path d="M24 2 H33 V8 H24 Z" fill="currentColor"/>`),
  turret: W(`<path d="M5 42 L9 30 H39 L43 42 Z" fill="currentColor"/><path d="M13 30 Q13 17 24 17 Q35 17 35 30 Z" fill="currentColor"/><rect x="30" y="20" width="17" height="5" rx="1.4" fill="currentColor"/><circle cx="23" cy="26" r="2.2" class="cutf"/>`),
  rocketTurret: W(`<path d="M5 42 L9 32 H39 L43 42 Z" fill="currentColor"/><rect x="14" y="26" width="20" height="8" rx="2" fill="currentColor"/><path d="M15 27 L28 8 L34 12 L22 29 Z" fill="currentColor"/><path d="M26 6 L33 2 L37 9 L31 12 Z" fill="currentColor"/><path d="M20 22 L28 13" class="cut"/><circle cx="24" cy="30" r="1.8" class="cutf"/>`),
  airfield: W(`<rect x="2" y="28" width="44" height="14" fill="currentColor"/><path d="M6 35 H12 M17 35 H23 M28 35 H34 M39 35 H44" class="cut"/><rect x="4" y="16" width="9" height="12" fill="currentColor"/><rect x="2" y="12" width="13" height="5" fill="currentColor"/><path d="M20 22 L46 22 L40 16 H33 L29 9 H25 L27 16 H20 Z" fill="currentColor"/>`),
  // ---------- interfață ----------
  coin: W(`<circle cx="24" cy="24" r="19" fill="currentColor"/><circle cx="24" cy="24" r="13" class="cut"/><path d="M24 14 V34 M19 19 Q19 16 24 16 Q29 16 29 20 Q29 24 24 24 Q19 24 19 28 Q19 32 24 32 Q29 32 29 29" class="cut"/>`),
  ore: W(`<path d="M24 3 L40 14 L35 40 L13 40 L8 14 Z" fill="currentColor"/><path d="M24 3 L24 40 M8 14 L40 14 M13 40 L24 24 L35 40" class="cut"/>`),
  army: W(`<circle cx="15" cy="13" r="6" fill="currentColor"/><circle cx="33" cy="13" r="6" fill="currentColor"/><path d="M3 38 Q3 22 15 22 Q27 22 27 38 Z" fill="currentColor"/><path d="M21 38 Q21 22 33 22 Q45 22 45 38 Z" fill="currentColor" opacity=".8"/>`),
  pause: W(`<rect x="12" y="8" width="8" height="32" rx="2" fill="currentColor"/><rect x="28" y="8" width="8" height="32" rx="2" fill="currentColor"/>`),
  play: W(`<path d="M13 7 L40 24 L13 41 Z" fill="currentColor"/>`),
  stop: W(`<rect x="10" y="10" width="28" height="28" rx="3" fill="currentColor"/>`),
  home: W(`<path d="M3 24 L24 5 L45 24 H38 V42 H10 V24 Z" fill="currentColor"/><rect x="19" y="29" width="10" height="13" class="cutf"/>`),
  help: W(`<circle cx="24" cy="24" r="20" fill="currentColor"/><path d="M17 19 Q17 12 24 12 Q31 12 31 19 Q31 23 27 25 Q24 27 24 30" class="cut" style="stroke-width:3.6"/><circle cx="24" cy="37" r="2.6" class="cutf"/>`),
  target: W(`<circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="24" cy="24" r="6" fill="currentColor"/><path d="M24 1 V12 M24 36 V47 M1 24 H12 M36 24 H47" stroke="currentColor" stroke-width="4"/>`),
  move: W(`<path d="M24 3 L33 13 H27 V21 H35 V15 L45 24 L35 33 V27 H27 V35 H33 L24 45 L15 35 H21 V27 H13 V33 L3 24 L13 15 V21 H21 V13 H15 Z" fill="currentColor"/>`),
  flag: W(`<rect x="9" y="4" width="4" height="40" rx="1.5" fill="currentColor"/><path d="M13 6 H40 L33 15 L40 24 H13 Z" fill="currentColor"/>`),
  bomb: W(`<circle cx="21" cy="29" r="14" fill="currentColor"/><rect x="29" y="8" width="9" height="7" rx="1.5" transform="rotate(40 33 11)" fill="currentColor"/><path d="M36 6 L40 2 M39 10 L45 9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M13 27 Q14 21 20 20" class="cut"/>`),
  harvest: W(`<path d="M24 3 L36 12 L32 30 L16 30 L12 12 Z" fill="currentColor"/><path d="M24 3 V30 M12 12 H36" class="cut"/><path d="M4 41 H44 M36 34 L44 41 L36 47" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`),
  cancel: W(`<path d="M10 10 L38 38 M38 10 L10 38" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>`),
  lock: W(`<rect x="9" y="21" width="30" height="22" rx="3" fill="currentColor"/><path d="M15 21 V15 Q15 6 24 6 Q33 6 33 15 V21" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="24" cy="31" r="3" class="cutf"/>`),
  check: W(`<path d="M8 25 L19 36 L40 11" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`),
  alert: W(`<path d="M24 3 L46 43 H2 Z" fill="currentColor"/><path d="M24 17 V29" class="cut" style="stroke-width:4"/><circle cx="24" cy="36" r="2.6" class="cutf"/>`),
  radar: W(`<circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="24" r="11" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 24 L40 10" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="24" r="3" fill="currentColor"/>`),
};

export function iconSvg(name: string): string {
  return ICONS[name] ?? ICONS.target;
}
