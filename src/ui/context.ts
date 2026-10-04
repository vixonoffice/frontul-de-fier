// Starea comună a UI-ului, împărtășită de toate modulele (hud, minihartă, input, ecrane).
// Nu e un contract de integrare (ca sim/types.ts sau render/api.ts) — e intern lui src/ui.
import type { World, SimAPI, Command, Team, EntityId, BuildingType, Vec, SimEvent, Difficulty, ProducerType } from '../sim/types';
import type { RenderAPI } from '../render/api';

export interface GameStats {
  startTick: number;
  unitsBuilt: number;
  unitsLost: number;
  buildingsDestroyed: number;
  creditsEarned: number;
}

export type ToastKind = 'info' | 'bad';
/** Unealta armată: următoarea atingere pe hartă execută ordinul, apoi unealta se stinge. */
export type Tool = 'attackMove' | 'harvest' | 'bomb' | 'rally' | null;
export type BuildTab = 'buildings' | ProducerType | 'assist' | 'army';
export type SfxName = 'click' | 'error' | 'ok' | 'cancel';

export interface UiContext {
  readonly root: HTMLElement;
  /** Zona de joc (sub bara de sus) — ancoră pentru elementele flotante peste canvas. */
  readonly stageEl: HTMLElement;
  /** Coloana de jos a scenei: mesaje, indicații, confirmare și bara de comenzi. */
  readonly bottomEl: HTMLElement;
  readonly sim: SimAPI;
  readonly renderer: RenderAPI;
  readonly localTeam: Team;
  readonly isTouch: boolean;

  world: World;
  readonly stats: GameStats;
  paused: boolean;
  gameOver: boolean;
  started: boolean;
  helpOpen: boolean;
  difficulty: Difficulty;
  speed: 1 | 2;
  tool: Tool;
  placing: BuildingType | null;
  /** Tabul deschis în tavă (null = tava e închisă). */
  trayTab: BuildTab | null;
  /** Multiplicatorul de antrenare (x1, x5, x25), ținut minte cât ține sesiunea. */
  trainCount: 1 | 5 | 25;
  /** Mini-harta mărită? (se ține minte între sesiuni) */
  minimapBig: boolean;
  /** Spot respins, arătat roșu o clipă. */
  ghostFlash: { tx: number; ty: number; until: number } | null;
  selection: EntityId[];
  groups: Map<number, EntityId[]>;
  lastEventPos: Vec | null;

  /** Adaugă o comandă în bufferul care se trimite la sim.step() la următorul tick. */
  queueCommand(cmd: Command): void;
  /** Ascultă comenzile date de jucător (folosit de sfaturi). */
  onCommand(cb: (c: Command) => void): void;
  setSelection(ids: EntityId[]): void;
  setTool(t: Tool): void;
  startPlacing(type: BuildingType): void;
  /** Iese din modul de plasare; clădirea rămâne gata (banii NU se întorc). */
  cancelPlacing(): void;
  /** Încearcă plasarea clădirii la tile-ul dat; la spot nepotrivit arată fantoma roșie și rămâne în plasare. */
  tryPlaceAt(tx: number, ty: number): boolean;
  openTray(t: BuildTab): void;
  closeTray(): void;
  setMinimapBig(b: boolean): void;
  /** Vinde o clădire proprie (comanda `sell`). */
  sell(id: EntityId): void;
  /** Cât primești dacă vinzi clădirea acum. */
  sellValue(id: EntityId): number;
  selectArmy(): void;
  selectIdleHarvesters(): void;
  idleHarvesters(): EntityId[];
  centerBase(): void;
  toast(msg: string, kind?: ToastKind): void;
  sfx(name: SfxName): void;
  togglePause(): void;
  setSpeed(speed: 1 | 2): void;
  setDifficulty(d: Difficulty): void;
  /** Pornește un meci nou fără reîncărcarea paginii. */
  restart(): void;
}

/** Funcție de teardown înregistrată de un submodul (listeners, intervale etc.). */
export type Disposer = () => void;

/** Un submodul de UI: se actualizează o dată pe cadru și se poate opri la destroy(). */
export interface UiModule {
  update(): void;
  dispose(): void;
  /** Opțional: primește evenimentele simulării, o dată per tick, în ordine. */
  handleEvent?(e: SimEvent): void;
}
