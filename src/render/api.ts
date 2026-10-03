// CONTRACT între randare și UI. Îl modifică doar orchestratorul.
import type { World, EntityId, Team, BuildingType, Vec } from '../sim/types';

export interface PickResult {
  world: Vec | null;             // punctul de pe teren (în tile-uri), null dacă e în afara hărții
  entityId: EntityId | null;     // entitatea de sub cursor, dacă e vizibilă pentru echipa locală
}

export interface Ghost { type: BuildingType; tx: number; ty: number; valid: boolean }

export interface RenderAPI {
  /** Desenează un cadru. alpha = 0..1, cât din tick-ul următor a trecut (pentru interpolare). */
  render(world: World, alpha: number, dtSeconds: number): void;
  resize(width: number, height: number, dpr: number): void;
  pick(screenX: number, screenY: number): PickResult;
  /** Entitățile proprii din dreptunghiul de pe ecran (selecție cu chenar). */
  pickBox(x0: number, y0: number, x1: number, y1: number, team: Team): EntityId[];
  worldToScreen(p: Vec): Vec | null;

  // cameră
  panBy(dxPixels: number, dyPixels: number): void;
  zoomBy(factor: number, screenX: number, screenY: number): void;
  centerOn(p: Vec): void;
  /** Colțurile vizibile ale terenului (pentru dreptunghiul de pe minihartă). */
  viewQuad(): Vec[];

  // stare vizuală setată de UI
  setLocalTeam(team: Team): void;
  setSelection(ids: EntityId[]): void;
  setGhost(ghost: Ghost | null): void;
  /** Marcaj scurt la ordin: verde = mutare, roșu = atac. */
  pulse(p: Vec, kind: 'move' | 'attack'): void;
  dispose(): void;
}

export type CreateRenderer = (canvas: HTMLCanvasElement) => RenderAPI;
