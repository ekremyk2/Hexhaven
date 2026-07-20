// Shared vocabulary for the store (T-301 §2): the wire-derived payload shapes each slice reduces,
// the per-slice state shapes, and the combined `RootState` every slice's `StateCreator` is typed
// against — the zustand "slices pattern" (see store/index.ts for how the slices are combined).
import type { Action, EdgeId, HexPieceKindId, Seat, ServerMessage, VertexId } from '@hexhaven/shared';
import type { PlayerView, ViewerEvent } from '@hexhaven/shared';
import type { LobbyOutboundMessage } from './transport';

// ---- Wire-derived payload shapes ---------------------------------------------------------------
// Derived from `ServerMessage` (T-202's `z.infer` output) instead of re-declared, so these can
// never drift from the zod schemas that actually validate the wire.
export type LobbyStatePayload = Extract<ServerMessage, { type: 'lobby.state' }>['payload'];
export type GameEventsPayload = Extract<ServerMessage, { type: 'game.events' }>['payload'];
export type ChatMessagePayload = Extract<ServerMessage, { type: 'chat.message' }>['payload'];
export type PresencePayload = Extract<ServerMessage, { type: 'presence' }>['payload'];
export type TimerPayload = Extract<ServerMessage, { type: 'timer' }>['payload'];

// ---- Connection slice ---------------------------------------------------------------------------
export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ConnectionSlice {
  connection: { status: ConnectionStatus };
  setConnectionStatus(status: ConnectionStatus): void;
}

// ---- Lobby slice -----------------------------------------------------------------------------
// T-411 §1: a seat's occupant. `nickname` is `null` ONLY for a bot seat — the server/engine never
// produce a literal display string (cross-cutting i18n rule), so the client derives the localized
// "Bot" label from the seat's index (see routes/Lobby.tsx / ui/BotSeatBadge).
export interface LobbySeatView {
  occupant: 'human' | 'bot';
  nickname: string | null;
  ready: boolean;
}

/** A `game.error` whose code belongs to the create/join flow (T-401 requirement 1) — routed to
 * the lobby slice instead of a toast so Home can render it as an inline field error. See
 * `LOBBY_FLOW_ERROR_CODES` in store/index.ts for exactly which codes land here. */
export interface LobbyErrorInfo {
  code: string;
  message: string;
}

export interface LobbyStateShape {
  gameId: string | null;
  code: string | null;
  hostSeat: Seat | null;
  seats: (LobbySeatView | null)[];
  mySeat: Seat | null;
  started: boolean;
  /** Per-seat connectivity, from `presence` messages. Absent seat = unknown, not "disconnected". */
  presence: Partial<Record<Seat, boolean>>;
  /** Latest create/join-flow error, cleared on the next successful `lobby.state` or explicitly by
   * the UI (e.g. once the user edits a field). `null` = no pending inline error. */
  lastError: LobbyErrorInfo | null;
}

export interface LobbySlice {
  lobby: LobbyStateShape;
  applyLobbyState(payload: LobbyStatePayload): void;
  applyPresence(payload: PresencePayload): void;
  setLobbyStarted(started: boolean): void;
  setLobbyError(error: LobbyErrorInfo | null): void;
}

// ---- Game slice ------------------------------------------------------------------------------
// docs/02 §8: UI modes gate which board targets highlight; legalActions(view, mySeat) supplies the
// actual targets. This union started with exactly the modes docs/02 §8 names explicitly; T-304
// (interaction layer) adds `placingCity` — the union's own doc comment invites later tasks to
// extend it as they add interactions, and the city-build highlight (`legalCityVertices`) is one
// of T-304's own listed requirements, so it can't be deferred to T-403 without a placeholder mode.
// T-705 adds the Seafarers board-pick modes: `placingShip` (build a ship on a legal sea edge),
// `movingShip` (two-step relocate — pick an open ship, then a destination; the source edge lives in
// `game.shipMoveFrom`), `movingPirate` (relocate the pirate to a sea hex on a 7/Knight), and
// `placingFreeShip` (a Road-Building free piece placed as a ship, S11.1).
// T-806 adds the Cities & Knights knight/wall board-pick modes: `buildingKnight` (a legal vertex,
// C7.1), `activatingKnight`/`promotingKnight` (pick one of the seat's own eligible knights — vertex
// mode over `activatableKnightVertices`/`promotableKnightVertices`), `movingKnight`/
// `displacingKnight` (two-step vertex->vertex — pick an own knight, then a destination/target; the
// source vertex lives in `game.knightPickFrom`, mirroring `shipMoveFrom`), `chasingRobber` (two-step
// vertex->hex — pick an adjacent active knight, then the robber's destination hex; also uses
// `knightPickFrom`), and `buildingCityWall` (a legal city vertex, C9.1).
// T-902 adds `movingHexPiece` (multi-piece hex framework, docs/07 D-034): move-any's hex-piece
// alternative to `movingRobber`, mirroring `movingPirate`'s shape exactly. T-903 widens the
// framework to 5 possible kinds that may coexist, so WHICH kind is armed now lives in its own
// store field (`hexPieceTarget` below), mirroring `shipMoveFrom`/`knightPickFrom`'s "extra step
// state" pattern — `uiMode.ts`'s `computeUiTargets`/`pickAction` fall back to the sole active kind
// when there's only one (no chooser needed), and otherwise require `hexPieceTarget` to be set by
// the `RobberOverlay` chooser before any hex lights up.
// Board-click targeting follow-up (Phase-9): board-target C&K progress cards get their own modes,
// one per card, since each needs a different engine/ckHelpers enumerator (unlike the knight modes,
// which all read off the same "own knight" shape). `engineer`/`medicine`/`merchant`/`bishop`/
// `diplomat`/`intrigue` are single-step vertex/hex/edge picks; `inventor` (two DISTINCT hexes) and
// `deserter` (an opponent's knight vertex, then the seat's own placement vertex) are two-step,
// mirroring `movingKnight`'s shape via the shared `progressCardStep1` field below (never both
// active at once, so one field covers both — exactly how `knightPickFrom` already serves three
// distinct modes). `masterMerchant`/`spy`/the four no-board-param cards keep their list dialogs.
export type UiMode =
  | 'idle'
  | 'placingRoad'
  | 'placingSettlement'
  | 'placingCity'
  | 'placingFreeRoad'
  | 'movingRobber'
  | 'discarding'
  | 'placingShip'
  | 'movingShip'
  | 'movingPirate'
  | 'placingFreeShip'
  | 'buildingKnight'
  | 'activatingKnight'
  | 'promotingKnight'
  | 'movingKnight'
  | 'displacingKnight'
  | 'chasingRobber'
  | 'buildingCityWall'
  | 'movingHexPiece'
  | 'ckPlayEngineer'
  | 'ckPlayMedicine'
  | 'ckPlayMerchant'
  | 'ckPlayBishop'
  | 'ckPlayInventor'
  | 'ckPlayDiplomat'
  | 'ckPlayIntrigue'
  | 'ckPlayDeserter'
  // cardMods (Priority 2 of the same board-click targeting follow-up): Trailblazer (edge, no
  // connectivity rule), Highwayman (hex, robber relocate with no steal), Super-Settle (vertex, the
  // combo's own settlement-to-city upgrade). Ride By Night is two-step (hex then edge) via the same
  // `progressCardStep1` field the C&K two-step modes use. Merchant's Boon/Road Toll/Night of Plenty/
  // Monorail/Mega Knight keep their dialogs (no board target, or a shape the shared mechanism
  // doesn't fit yet — see `cardModLogic.ts`'s header for which and why).
  | 'cardModTrailblazer'
  | 'cardModHighwayman'
  | 'cardModSuperSettle'
  | 'cardModRideByNight'
  // Helpers of Hexhaven (Priority 3 of the same board-click targeting follow-up): Explorer is two-step
  // (pick one of the seat's own roads, then its new spot — edge->edge, mirrors `movingShip` exactly,
  // reusing `progressCardStep1`); Priest's build choice is split into two single-step vertex modes
  // (one per build kind) instead of a build-kind-then-vertex dialog. Mendicant/Merchant/Captain/
  // Robber Bride/Noblewoman/Architect/Mayor keep their dialogs — see `helpersLogic.ts`'s header for
  // which and why.
  | 'helperExplorer'
  | 'helperPriestSettlement'
  | 'helperPriestCity'
  // Traders & Barbarians (T-1008): the board-pick modes for the 5 scenarios' edge-targeted actions.
  // `tbMovingKnight` is two-step (source edge, then destination) exactly like `movingShip`/
  // `movingKnight` — it reuses `shipMoveFrom` for the step-1 source (see that field's doc comment),
  // since T&B never combines with Seafarers (TB8.1) so the two modes are never simultaneously live.
  // Every other T&B action either has no board target (`exchangeFish`'s removeRobber/steal/
  // bankResource/devCard, `passOldBoot`, `tradeCoins`, `caravanVote`) or resolves its target from a
  // small in-panel list instead of a board click (`moveWagon`'s destination, computed from
  // `legalWagonDestinations` — a wagon may have several pieces, so picking "which wagon" first reads
  // better as a panel list than a two-step board flow).
  | 'tbBuildingBridge'
  | 'tbExchangeFishRoad'
  | 'tbRecruitingKnight'
  | 'tbMovingKnight'
  | 'tbPlacingCamel'
  // Explorers & Pirates — Land Ho! (T-1108, §EP3/§EP4): `epBuildingShip` is a single-step sea-edge
  // pick (EP3.1). `epMovingShip` is two-step exactly like `movingShip`/`tbMovingKnight` — it reuses
  // `shipMoveFrom` for the step-1 source edge (see that field's doc comment), safe because E&P never
  // combines with Seafarers or T&B (EP1.2, standalone only) so the three two-step edge modes are
  // never simultaneously live. `epFoundingSettlement` (EP4.1) and `epUpgradingHarbor` (EP4.2) are
  // single-step vertex picks. Load/unload cargo has no board target (Land Ho! only ever moves the
  // 'settler' piece, picked from the action panel's own ship list, like `moveWagon`'s destination).
  | 'epBuildingShip'
  | 'epMovingShip'
  | 'epFoundingSettlement'
  | 'epUpgradingHarbor';

export interface GameStateShape {
  view: PlayerView | null;
  uiMode: UiMode;
  /** T-705 Seafarers move-ship (S7): the open ship edge picked in step 1 of the two-step
   * `movingShip` flow, or `null` while awaiting the source pick (or in any other mode). Set when the
   * mover clicks one of their movable ships; cleared whenever `uiMode` leaves `movingShip`. T-1008
   * reuses this same field for `tbMovingKnight`'s step-1 source edge (Traders & Barbarians' own
   * edge-based knights, §TB5.2) — safe because T&B never combines with Seafarers (TB8.1), so the two
   * modes are never live at once. */
  shipMoveFrom: EdgeId | null;
  /** T-806 Cities & Knights: the own-knight vertex picked in step 1 of the two-step `movingKnight`/
   * `displacingKnight`/`chasingRobber` flows, or `null` while awaiting that pick (or in any other
   * mode). Cleared whenever `uiMode` leaves one of those three modes. */
  knightPickFrom: VertexId | null;
  /** T-903: which hex-piece KIND is armed while `uiMode === 'movingHexPiece'` (the `RobberOverlay`
   *  chooser's pick among possibly-several coexisting pieces), or `null` while awaiting that pick
   *  (or in any other mode). Cleared whenever `uiMode` changes (mirrors `shipMoveFrom`/
   *  `knightPickFrom`). */
  hexPieceTarget: HexPieceKindId | null;
  /** Board-click targeting follow-up: the first pick of any two-step modifier-card/ability flow
   *  (`ckPlayInventor`'s first hex, `ckPlayDeserter`'s opponent-knight vertex, `cardModRideByNight`'s
   *  hex), or `null` while awaiting that pick (or in any other mode). One field serves every such
   *  mode since only one is ever active at a time — mirrors `knightPickFrom` already serving three
   *  distinct C&K modes. Cleared whenever `uiMode` changes. */
  progressCardStep1: number | null;
  /** Rolling log of every `ViewerEvent` received via `game.events`, oldest first (feeds T-407). */
  events: ViewerEvent[];
  /** Currently-active turn/decision deadlines (absolute epoch-ms), from the server's `timer`
   * message (T-206). Empty when timers are off or nothing is pending; the countdown UI (T-403)
   * renders `deadline - Date.now()`. */
  deadlines: TimerPayload['deadlines'];
}

export interface GameSlice {
  game: GameStateShape;
  applyGameStarted(view: PlayerView): void;
  applyGameEvents(payload: GameEventsPayload): void;
  applyGameSync(view: PlayerView): void;
  setUiMode(mode: UiMode): void;
  /** T-705: record the move-ship source edge (step 1 of `movingShip`), or `null` to clear it. */
  setShipMoveFrom(edge: EdgeId | null): void;
  /** T-806: record the knight-pick source vertex (step 1 of `movingKnight`/`displacingKnight`/
   * `chasingRobber`), or `null` to clear it. */
  setKnightPickFrom(vertex: VertexId | null): void;
  /** T-903: record which hex-piece kind the mover has armed via the `RobberOverlay` chooser, or
   *  `null` to clear it. */
  setHexPieceTarget(kind: HexPieceKindId | null): void;
  /** Record the two-step progress-card flow's first pick (`ckPlayInventor`/`ckPlayDeserter`), or
   *  `null` to clear it. */
  setProgressCardStep1(id: number | null): void;
  applyTimers(payload: TimerPayload): void;
}

// ---- Chat slice ------------------------------------------------------------------------------
export interface ChatMessageItem {
  id: number;
  seat: Seat;
  nickname: string;
  text: string;
}

export interface ChatSlice {
  chat: { messages: ChatMessageItem[] };
  addChatMessage(payload: ChatMessagePayload): void;
}

// ---- Toast slice (backs the T-301 §6 toast component; game.error -> toast per §5) --------------
export type ToastKind = 'info' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  code?: string;
}

export interface ToastSlice {
  toasts: ToastItem[];
  pushToast(input: { kind: ToastKind; message: string; code?: string }): void;
  dismissToast(id: number): void;
}

// ---- Root ------------------------------------------------------------------------------------
export interface RootState extends ConnectionSlice, LobbySlice, GameSlice, ChatSlice, ToastSlice {
  /** Single entry point for inbound server messages (T-301 §5); wired to GameTransport#onUpdate. */
  applyServerMessage(msg: ServerMessage): void;
  /** Outbound intents — the only path components use; each forwards to the active GameTransport. */
  sendAction(action: Action): void;
  sendLobbyMessage(msg: LobbyOutboundMessage): void;
  sendChatMessage(text: string): void;
  /** Full client-side reset when leaving a game / starting a fresh one: clears the game view,
   * events, lobby, chat, toasts, and the persisted `hexhaven.session` (so the ws client won't
   * auto-rejoin the finished game). Call on "back home" and before create/join. */
  leaveGame(): void;
}
