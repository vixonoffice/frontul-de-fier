// Iconițe SVG desenate manual, stil consistent: contur gros, fără umplere (sau umplere simplă),
// viewBox 0 0 32 32, currentColor — se colorează din CSS.
import type { BuildingType, UnitType } from '../sim/types';

const WRAP = (inner: string): string =>
  `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;

const S = 'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';

const ICONS: Record<string, string> = {
  tank: WRAP(`
    <rect x="5" y="17" width="22" height="7" rx="1.5" ${S} fill="none"/>
    <path d="M7 17 L7 13 Q7 11 9 11 L21 11 Q23 11 24 13 L25 17" ${S} fill="none"/>
    <circle cx="10" cy="24" r="2.4" ${S}/>
    <circle cx="16" cy="24" r="2.4" ${S}/>
    <circle cx="22" cy="24" r="2.4" ${S}/>
    <path d="M18 12 L27 9" ${S}/>
  `),
  rocket: WRAP(`
    <rect x="6" y="18" width="20" height="6" rx="2" ${S} fill="none"/>
    <path d="M9 18 L9 14 Q9 12 11 12 L19 12 Q21 12 21 14 L21 18" ${S} fill="none"/>
    <rect x="13" y="6" width="4" height="8" rx="1.3" ${S} fill="none"/>
    <rect x="19" y="7.5" width="4" height="7" rx="1.3" ${S} fill="none" transform="rotate(18 21 11)"/>
    <circle cx="10.5" cy="24" r="2.1" ${S}/>
    <circle cx="21.5" cy="24" r="2.1" ${S}/>
  `),
  harvester: WRAP(`
    <rect x="4" y="15" width="24" height="9" rx="1.6" ${S} fill="none"/>
    <path d="M6 15 L6 11.5 Q6 10 7.6 10 L19 10 Q21 10 22 11.6 L24 15" ${S} fill="none"/>
    <rect x="9" y="17.3" width="9" height="4.4" ${S} fill="none"/>
    <circle cx="9.5" cy="25" r="2.3" ${S}/>
    <circle cx="22.5" cy="25" r="2.3" ${S}/>
    <path d="M21 17 L26 13.5" ${S}/>
  `),
  hq: WRAP(`
    <rect x="5" y="12" width="22" height="15" rx="1.4" ${S} fill="none"/>
    <path d="M5 12 L16 5 L27 12" ${S} fill="none"/>
    <rect x="14" y="17" width="4" height="10" ${S} fill="none"/>
    <path d="M22 17 L22 9" ${S}/>
    <circle cx="22" cy="8" r="1.4" fill="currentColor"/>
  `),
  refinery: WRAP(`
    <rect x="4" y="16" width="24" height="9" rx="1.4" ${S} fill="none"/>
    <circle cx="11" cy="16" r="4.6" ${S} fill="none"/>
    <circle cx="20" cy="16" r="4.6" ${S} fill="none"/>
    <path d="M25 16 L25 9 L29 9" ${S} fill="none"/>
    <path d="M6 25 L6 28 M26 25 L26 28" ${S}/>
  `),
  factory: WRAP(`
    <rect x="4" y="15" width="24" height="11" rx="1.2" ${S} fill="none"/>
    <path d="M4 15 L9 10 L9 15 M12 15 L17 10 L17 15 M20 15 L25 10 L25 15" ${S} fill="none"/>
    <rect x="8" y="19" width="5" height="7" ${S} fill="none"/>
  `),
  turret: WRAP(`
    <circle cx="16" cy="20" r="7" ${S} fill="none"/>
    <path d="M16 13 L26 9" ${S}/>
    <circle cx="16" cy="20" r="2.2" fill="currentColor"/>
    <path d="M9 27 L23 27" ${S}/>
  `),
  pause: WRAP(`<rect x="9" y="7" width="5" height="18" rx="1.4" fill="currentColor"/><rect x="18" y="7" width="5" height="18" rx="1.4" fill="currentColor"/>`),
  play: WRAP(`<path d="M10 6 L25 16 L10 26 Z" fill="currentColor"/>`),
  target: WRAP(`<circle cx="16" cy="16" r="10" ${S} fill="none"/><circle cx="16" cy="16" r="3.4" ${S} fill="none"/><path d="M16 2 L16 7 M16 25 L16 30 M2 16 L7 16 M25 16 L30 16" ${S}/>`),
  stop: WRAP(`<rect x="8" y="8" width="16" height="16" rx="2" fill="currentColor"/>`),
  home: WRAP(`<path d="M6 16 L16 7 L26 16" ${S} fill="none"/><path d="M9 14 L9 26 L23 26 L23 14" ${S} fill="none"/><rect x="13.5" y="19" width="5" height="7" ${S} fill="none"/>`),
  army: WRAP(`<circle cx="11" cy="12" r="3.4" ${S} fill="none"/><circle cx="21" cy="12" r="3.4" ${S} fill="none"/><path d="M5 25 Q5 18 11 18 Q17 18 17 25" ${S} fill="none"/><path d="M15 25 Q15 18 21 18 Q27 18 27 25" ${S} fill="none"/>`),
  ore: WRAP(`<path d="M16 4 L26 11 L22 26 L10 26 L6 11 Z" ${S} fill="none"/><path d="M16 4 L16 26 M6 11 L26 11" ${S}/>`),
};

export function iconSvg(name: string): string {
  return ICONS[name] ?? ICONS.target;
}

export function buildingIconName(type: BuildingType): string {
  return type; // 'hq' | 'refinery' | 'factory' | 'turret' map 1:1
}

export function unitIconName(type: UnitType): string {
  return type; // 'tank' | 'rocket' | 'harvester' map 1:1
}
