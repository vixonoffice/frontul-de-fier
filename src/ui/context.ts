// Starea comună a UI-ului, împărtășită de toate modulele (hud, minihartă, input, ecrane).
// Nu e un contract de integrare (ca sim/types.ts sau render/api.ts) — e intern lui src/ui.
import type { World, SimAPI, Command, Team, EntityId, BuildingType, Vec, SimEvent } from '../sim/types';
import type { RenderAPI } from '../render/api';

export interface GameStats {
  startTick: number;
  unitsBuilt: number;
  unitsLost: number;
  buildingsDestroyed: number;
  creditsEarned: number;
}

export type ToastKind = 'info' | 'bad';

export interface UiContext {
  readonly root: HTMLElement;
  /** Zona de joc (deasupra barei de sus, sub ea nu sunt sidebar-ul/sertarul) — folosită ca ancoră
   * de poziționare pentru elementele flotante peste canvas (toasturi, panou de selecție, toolbar mobil). */
  readonly stageEl: HTMLElement;
  readonly sim: SimAPI;
  readonly renderer: RenderAPI;
  readonly localTeam: Team;
  readonly isTouch: boolean;

  world: World;
  readonly stats: GameStats;
  paused: boolean;
  gameOver: boolean;
  speed: 1 | 2;
  attackMoveArmed: boolean;
  placing: BuildingType | null;
  pickingRally: boolean;
  selection: EntityId[];
  groups: Map<number, EntityId[]>;
  lastEventPos: Vec | null;

  /** Adaugă o comandă în bufferul care se trimite la sim.step() la următorul tick. */
  queueCommand(cmd: Command): void;
  /** Schimbă selecția curentă și o sincronizează cu randarea. */
  setSelection(ids: EntityId[]): void;
  armAttackMove(v: boolean): void;
  startPlacing(type: BuildingType): void;
  cancelPlacing(): void;
  /** Încearcă plasarea clădirii curente la tile-ul dat; anulează modul de plasare dacă reușește. */
  tryPlaceAt(tx: number, ty: number): void;
  startRallyPick(): void;
  cancelRallyPick(): void;
  setRallyAt(x: number, y: number): void;
  toast(msg: string, kind?: ToastKind): void;
  togglePause(): void;
  setSpeed(speed: 1 | 2): void;
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
