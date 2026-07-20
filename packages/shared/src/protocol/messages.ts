// Zod schemas for the ws message envelope and every client<->server message (docs/02 §5).
// Envelope: `{ v: 1, type: <literal>, payload: <per-type> }`. Client and server messages are each
// combined into their own discriminated union so `parseClientMessage` can validate a raw frame in
// one pass.

import { z } from 'zod';
import { isScenarioId } from '../scenario.js';
import type { CustomConstantsConfig, EngineErrorCode, GameConfig, HexPieceKindId } from '../types.js';
import { ActionSchema, HexPieceKindIdSchema, ResourceBundleSchema, SeatSchema } from './actions.js';
import type { Equal, Expect } from './actions.js';
import { ProtocolErrorCodeSchema } from './errors.js';

// ---- Envelope helper --------------------------------------------------------------------------

function envelope<Type extends string, Payload extends z.ZodTypeAny>(type: Type, payload: Payload) {
  return z
    .object({
      v: z.literal(1),
      type: z.literal(type),
      payload,
    })
    .strict();
}

// ---- WIRE: T-204 placeholders ------------------------------------------------------------------
// PlayerView and ViewerEvent are defined precisely by T-204 (docs/02 §6, docs/03 §5 tail note).
// Until then the protocol only needs a wire-shaped placeholder: the server constructs these
// objects and the task spec says deep zod-ing the state is not required, so parsing is a
// passthrough (`z.custom`). Replace `PlayerView`/`ViewerEvent` with real imports once T-204 lands.

// WIRE: T-204
export type PlayerView = unknown;
// WIRE: T-204
export type ViewerEvent = unknown;

const PlayerViewSchema = z.custom<PlayerView>();
const ViewerEventSchema = z.custom<ViewerEvent>();

// ---- Shared payload fragments ------------------------------------------------------------------

const NicknameSchema = z.string().trim().min(1).max(20);

// docs/02 §7: lobby codes are 5 chars from A-Z2-9 excluding the ambiguous O/0/1/I.
const LOBBY_CODE_REGEX = /^[A-HJ-NP-Z2-9]{5}$/;
const LobbyCodeSchema = z.string().regex(LOBBY_CODE_REGEX);

// docs/10 §2 — transcribed as-is; schema-valid even for unshipped expansion TOGGLES, the
// server/engine gate actual availability (EXPANSION_NOT_AVAILABLE). The Seafarers `scenario` id
// crossing the wire is validated to a known `ScenarioId` (T-701) via `refine` — this keeps the
// inferred type `{ scenario: string }` (so the client's placeholder id still type-checks) while
// rejecting a bogus id at parse time. Authoritative gating remains in the engine's `resolveModules`.
export const ExpansionsConfigSchema = z
  .object({
    fiveSix: z.boolean(),
    seafarers: z.union([
      z.literal(false),
      z
        .object({
          // Wrap the guard so `refine` does NOT narrow the output to `ScenarioId` — the inferred
          // type must stay `string` (GameConfig['expansions'] + the client placeholder id).
          scenario: z.string().refine((s): boolean => isScenarioId(s), { message: 'unknown scenario id' }),
        })
        .strict(),
    ]),
    citiesKnights: z.boolean(),
    // Traders & Barbarians (Phase 10). Optional so pre-T&B configs stay valid; the scenario id is a
    // loose string here (the engine narrows it to `TBScenarioId` and rejects unknown/unshipped
    // scenarios with EXPANSION_NOT_AVAILABLE, mirroring how `seafarers` is validated engine-side).
    tradersBarbarians: z
      .union([z.literal(false), z.object({ scenario: z.string() }).strict()])
      .optional(),
    // Explorers & Pirates (Phase 11). Same loose-scenario shape; the engine narrows + rejects
    // unknown/unshipped scenarios with EXPANSION_NOT_AVAILABLE.
    explorersPirates: z
      .union([z.literal(false), z.object({ scenario: z.string() }).strict()])
      .optional(),
  })
  .strict() satisfies z.ZodType<GameConfig['expansions']>;

// T-206 §1: `{ timers: boolean, turnSeconds: 120, decisionSeconds: 45 }` on the room config.
const RoomTimersConfigSchema = z
  .object({
    timers: z.boolean(),
    turnSeconds: z.number().int().positive(),
    decisionSeconds: z.number().int().positive(),
  })
  .strict();

// docs/10 §4 (T-602): rule variants selectable at lobby time. Optional and inert unless its
// governing expansion is active (engine `resolveModules` validates the combo; a base lobby omits
// it entirely). Mirrors `GameConfig['variants']`.
const VariantsConfigSchema = z
  .object({
    fiveSixTurnRule: z.enum(['sbp', 'pairedPlayers']).optional(),
  })
  .strict() satisfies z.ZodType<NonNullable<GameConfig['variants']>>;

// T-906 (docs/07 D-034 `customConstants`): the broad "custom game" tunable-constants modifier's
// wire shape — every field optional, mirroring `CustomConstantsConfig` (types.ts) exactly. Reuses
// `ResourceBundleSchema` (>=1 per present key) for `startingResources` and each `costs` item — a
// bundle with a 0 is equivalent to omitting the key, so the same "present means >=1" rule the rest
// of the protocol uses applies here too.
const CustomConstantsConfigSchema = z
  .object({
    productionMultiplier: z.number().int().positive().optional(),
    roadBuildingCount: z.number().int().positive().optional(),
    yearOfPlentyCount: z.number().int().positive().optional(),
    startingResources: ResourceBundleSchema.optional(),
    discardHandLimit: z.number().int().positive().optional(),
    costs: z
      .object({
        road: ResourceBundleSchema.optional(),
        settlement: ResourceBundleSchema.optional(),
        city: ResourceBundleSchema.optional(),
        devCard: ResourceBundleSchema.optional(),
      })
      .strict()
      .optional(),
    bankPerResource: z.number().int().positive().optional(),
    // Limits (docs/07 D-034 "limits + winnability"): each is a positive int OR the `null`
    // "limitless" sentinel (packages/engine/src/modules/modifiers/customConstants.ts), OR absent
    // entirely for "leave the base/expansion default alone" — `.nullable().optional()` accepts all
    // three wire shapes (`number`, `null`, or the key omitted).
    targetVp: z.number().int().positive().nullable().optional(),
    maxSettlements: z.number().int().positive().nullable().optional(),
    maxCities: z.number().int().positive().nullable().optional(),
    maxRoads: z.number().int().positive().nullable().optional(),
    maxCityWalls: z.number().int().positive().nullable().optional(),
    maxKnightsPerLevel: z.number().int().positive().nullable().optional(),
    maxProgressCards: z.number().int().positive().nullable().optional(),
  })
  .strict() satisfies z.ZodType<CustomConstantsConfig>;

// T-902 (multi-piece hex framework, docs/07 D-034, docs/tasks/phase-9/PICKS.md): which hex-piece
// kinds are active this game — each standalone-selectable, so `pieces` may name one kind or a
// subset. `.min(1)`: an enabled-but-empty selection is meaningless (mirrors the engine's own
// `validateHexPiecesConfig`, modules/modifiers/hexPieces/index.ts).
const HexPiecesConfigSchema = z
  .object({ pieces: z.array(HexPieceKindIdSchema).min(1) })
  .strict() satisfies z.ZodType<{ pieces: HexPieceKindId[] }>;

// T-901 (docs/07 D-034): the Modifiers menu's wire shape. Each key is optional; presence enables
// that modifier. `customTargetVp`'s value is the new win-VP threshold; the param-less proof
// modifier and the reserved `eventCards` id accept only the literal `true`. Mirrors
// `GameConfig['modifiers']` — the engine's `resolveModules` (packages/engine/src/modules/index.ts)
// is authoritative for whether a given combination is actually compatible (`MODIFIER_INCOMPATIBLE`).
const ModifiersConfigSchema = z
  .object({
    customTargetVp: z.number().int().positive().optional(),
    combine2sAnd12s: z.literal(true).optional(),
    eventCards: z.literal(true).optional(),
    // Wave A-1 (T-903a/906, docs/07 D-034): three more param-less modifiers.
    friendlyRobber: z.literal(true).optional(),
    playDevSameTurn: z.literal(true).optional(),
    harbormaster: z.literal(true).optional(),
    // T-904/T-905: two more param-less modifiers.
    cardMods: z.literal(true).optional(),
    helpers: z.literal(true).optional(),
    // T-906: the broad tunable-constants modifier — see `CustomConstantsConfigSchema` above.
    customConstants: CustomConstantsConfigSchema.optional(),
    // T-902: the multi-piece hex framework — see `HexPiecesConfigSchema` above.
    hexPieces: HexPiecesConfigSchema.optional(),
    // Board-setup house rules (param-less): randomize token positions (preserving counts), and
    // keep the numbers hidden until initial placement is complete.
    shuffleNumbers: z.literal(true).optional(),
    hiddenSetupNumbers: z.literal(true).optional(),
  })
  .strict() satisfies z.ZodType<NonNullable<GameConfig['modifiers']>>;

// T-203 §1: `Room.config = { playerCount, expansions, timers }` (from `lobby.create`'s payload) —
// plus the optional `variants` selector (T-602) and `modifiers` selector (T-901).
export const RoomConfigSchema = z
  .object({
    playerCount: z.union([z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
    expansions: ExpansionsConfigSchema,
    variants: VariantsConfigSchema.optional(),
    modifiers: ModifiersConfigSchema.optional(),
    // T-606/T-607: board-setup preset id (from the `BOARD_PRESETS` registry). Only the ids the
    // engine can BUILD today are accepted here — `'random'` (generator) and `'beginner'` (fixed,
    // base-19 only; the engine rejects it with fiveSix). Catalog-only "coming soon" presets (the
    // 5–6 fixed board, Seafarers scenarios) are picker-visible but not selectable, so they never
    // cross the wire. Optional for back-compat — an absent field means the historical `'random'`
    // default (keeps pre-T-606 rooms bit-identical). Keep this enum in sync with
    // `BuildableBoardPresetId` as T-705 makes more presets buildable.
    board: z.enum(['random', 'beginner']).optional(),
    timers: RoomTimersConfigSchema,
  })
  .strict();
export type RoomConfig = z.infer<typeof RoomConfigSchema>;

// Mirrors `EngineErrorCode` (../types.js, docs/03 §4) so `game.error` can carry either an engine
// or a protocol error code. `satisfies` rejects bogus entries; the `Equal` check below rejects
// missing ones — together the list cannot drift from the type without failing the build.
const ENGINE_ERROR_CODES = [
  'NOT_YOUR_TURN',
  'WRONG_PHASE',
  'ALREADY_ROLLED',
  'MUST_ROLL_FIRST',
  'CANT_AFFORD',
  'NO_PIECES_LEFT',
  'BAD_LOCATION',
  'DISTANCE_RULE',
  'NOT_CONNECTED',
  'OCCUPIED',
  'BANK_EMPTY',
  'DECK_EMPTY',
  'DEV_ALREADY_PLAYED',
  'DEV_BOUGHT_THIS_TURN',
  'CARD_NOT_HELD',
  'BAD_TRADE',
  'NO_OPEN_OFFER',
  'NOT_A_CANDIDATE',
  'BAD_DISCARD_COUNT',
  'BAD_GOLD_COUNT',
  'ROBBER_SAME_HEX',
  'CANNOT_PLAY',
  'EXPANSION_NOT_AVAILABLE',
  'MODIFIER_INCOMPATIBLE',
  'GAME_OVER',
  'NO_CITY_OWNED',
  'IMPROVEMENT_MAX_LEVEL',
  'KNIGHT_NOT_FOUND',
  'KNIGHT_INACTIVE',
  'KNIGHT_ALREADY_ACTIVE',
  'KNIGHT_CAP',
  'KNIGHT_MAX_LEVEL',
  'NOT_STRONGER',
  'FORTRESS_REQUIRED',
  'ROBBER_LOCKED',
  'DEV_CARDS_DISABLED',
  'NOT_ELIGIBLE',
  'BAD_CARD_TARGET',
  'WALL_CAP',
  'WALL_ALREADY_BUILT',
  'INVENTOR_RESTRICTED_NUMBER',
  'MODIFIER_INVALID_CONFIG',
  'BAD_YOP_COUNT',
  'HEX_PIECE_NOT_FOUND',
  'HEX_PIECE_SAME_HEX',
  'NOT_ENOUGH_FISH',
  'OLD_BOOT_NOT_HELD',
  'BAD_OLD_BOOT_TARGET',
  'NOT_A_RIVER_EDGE',
  'NOT_ENOUGH_COINS',
  'KNIGHT_MOVE_TOO_FAR',
  'KNIGHT_MOVE_EXTEND_UNAVAILABLE',
  'WAGON_NOT_FOUND',
  'WAGON_MOVE_INVALID',
  'WAGON_MP_EXCEEDED',
  'PATH_BARBARIAN_BLOCKED',
  'SHIP_NOT_FOUND',
  'NOT_A_SEA_EDGE',
  'SHIP_BUILT_THIS_TURN',
  'SHIP_ALREADY_MOVED',
  'SHIP_MOVE_TOO_FAR',
  'CARGO_FULL',
  'CARGO_NOT_FOUND',
  'NOT_DISCOVERED_LAND',
  'SETTLER_NOT_FOUND',
  'LAIR_NOT_FOUND',
  'CREW_NOT_FOUND',
  'NOT_ENOUGH_GOLD',
  'VILLAGE_NOT_FOUND',
  'FISH_NOT_FOUND',
  'SPICE_NOT_FOUND',
] as const satisfies readonly EngineErrorCode[];
const EngineErrorCodeSchema = z.enum(ENGINE_ERROR_CODES);

// Build fails if `EngineErrorCode` gains a member this list is missing (same drift guarantee as
// `ActionSchemaMatchesAction` in actions.ts).
export type EngineErrorCodesExhaustive = Expect<
  Equal<(typeof ENGINE_ERROR_CODES)[number], EngineErrorCode>
>;

// ---- Client -> server payloads ------------------------------------------------------------------

const LobbyCreatePayloadSchema = z
  .object({
    nickname: NicknameSchema,
    config: RoomConfigSchema,
    password: z.string().optional(),
  })
  .strict();

const LobbyJoinPayloadSchema = z
  .object({
    code: LobbyCodeSchema,
    nickname: NicknameSchema,
    password: z.string().optional(),
  })
  .strict();

const LobbyReadyPayloadSchema = z.object({ ready: z.boolean() }).strict();

const LobbyStartPayloadSchema = z.object({}).strict();

// T-411 §1: host-only seat management, pre-start only. There is NO difficulty field — every bot is
// the single strongest engine (T-410); adding a tier/selector here would contradict that.
const LobbyAddBotPayloadSchema = z.object({ seat: SeatSchema }).strict();
const LobbyRemoveBotPayloadSchema = z.object({ seat: SeatSchema }).strict();

const GameActionPayloadSchema = z.object({ action: ActionSchema }).strict();

const GameRejoinPayloadSchema = z
  .object({
    gameId: z.string().min(1),
    playerToken: z.string().min(1),
  })
  .strict();

// T-301 §4 cross-task addition: not part of the original T-202 spec. The ws client (T-301) sends
// this when it detects a `stateVersion` gap — a `game.events` whose `stateVersion` isn't exactly
// one past the last value it saw (e.g. after a brief disconnect that swallowed messages). Minimal
// payload: just enough to identify which game to resync; the server answers with `game.sync`.
const GameSyncRequestPayloadSchema = z.object({ gameId: z.string().min(1) }).strict();

const ChatSendPayloadSchema = z.object({ text: z.string().min(1).max(300) }).strict();

// ---- Server -> client payloads ------------------------------------------------------------------

// T-411 §1: a seat's occupant. `null` (in the `seats` array below) means empty; a present entry is
// either a human (real nickname) or a bot. Bots never carry a literal display string — the server/
// engine must never produce user-facing text (cross-cutting i18n rule) — so `nickname` is `null`
// for a bot seat and the client derives a localized "Bot" label from `seat`'s index instead.
const SeatOccupantSchema = z.enum(['human', 'bot']);
export type SeatOccupant = z.infer<typeof SeatOccupantSchema>;
const LobbySeatSchema = z
  .object({ occupant: SeatOccupantSchema, nickname: z.string().nullable(), ready: z.boolean() })
  .strict();

const LobbyStatePayloadSchema = z
  .object({
    gameId: z.string(),
    code: z.string(),
    hostSeat: SeatSchema,
    seats: z.array(LobbySeatSchema.nullable()),
    // Present only in the message routed back to the seat that just claimed it (create/join) —
    // T-203 §4 delivers the seat/token assignment "inside lobby.state"; never present for other
    // recipients (T-203 §5 leak check: no foreign tokens).
    you: z.object({ seat: SeatSchema, playerToken: z.string() }).strict().optional(),
  })
  .strict();

const GameStartedPayloadSchema = PlayerViewSchema;

// T-301 §5 cross-task note: the server's `game.events` includes a fresh `PlayerView` alongside
// the events themselves — the client applies it wholesale rather than reconstructing a view from
// event deltas (kept simple by design). `view` is wire-shaped as `PlayerViewSchema` (see the
// WIRE: T-204 note above) until T-204 lands the real `PlayerView` schema; T-204 should treat this
// field as already decided, not open.
const GameEventsPayloadSchema = z
  .object({
    events: z.array(ViewerEventSchema),
    stateVersion: z.number().int().min(0),
    view: PlayerViewSchema,
  })
  .strict();

const GameSyncPayloadSchema = PlayerViewSchema;

const GameErrorPayloadSchema = z
  .object({
    code: z.union([EngineErrorCodeSchema, ProtocolErrorCodeSchema]),
    message: z.string(),
  })
  .strict();

const ChatMessagePayloadSchema = z
  .object({
    seat: SeatSchema,
    nickname: z.string(),
    text: z.string(),
  })
  .strict();

const PresencePayloadSchema = z
  .object({
    seat: SeatSchema,
    connected: z.boolean(),
  })
  .strict();

// T-206 §5: "presence-style timer message... with deadline timestamps so the UI can render
// countdowns." One message carries every CURRENTLY active deadline for the room (0..N entries —
// e.g. several seats can simultaneously owe a discard), not one message per seat: `deadline` is an
// absolute epoch-ms timestamp (`Date.now() + msRemaining` at schedule time) so the client only
// needs `deadline - Date.now()` to render a countdown, no clock-sync math. Broadcast to every
// connected seat whenever `apps/server/src/timers.ts` reconciles a room's timers (flag off ⇒ this
// message is never sent at all, per D-020's true-no-op requirement).
const TimerPayloadSchema = z
  .object({
    deadlines: z.array(z.object({ seat: SeatSchema, deadline: z.number().int().nonnegative() }).strict()),
  })
  .strict();

// ---- Messages (envelope + payload) ---------------------------------------------------------

export const LobbyCreateMessageSchema = envelope('lobby.create', LobbyCreatePayloadSchema);
export const LobbyJoinMessageSchema = envelope('lobby.join', LobbyJoinPayloadSchema);
export const LobbyReadyMessageSchema = envelope('lobby.ready', LobbyReadyPayloadSchema);
export const LobbyStartMessageSchema = envelope('lobby.start', LobbyStartPayloadSchema);
// "Play again" from the end screen: host restarts a FINISHED game in the same room (same seats +
// bots). Empty payload, same shape as lobby.start.
export const LobbyRematchMessageSchema = envelope('lobby.rematch', LobbyStartPayloadSchema);
export const LobbyAddBotMessageSchema = envelope('lobby.addBot', LobbyAddBotPayloadSchema);
export const LobbyRemoveBotMessageSchema = envelope('lobby.removeBot', LobbyRemoveBotPayloadSchema);
export const GameActionMessageSchema = envelope('game.action', GameActionPayloadSchema);
export const GameRejoinMessageSchema = envelope('game.rejoin', GameRejoinPayloadSchema);
// T-301 §4 cross-task addition (see GameSyncRequestPayloadSchema above).
export const GameSyncRequestMessageSchema = envelope('game.syncRequest', GameSyncRequestPayloadSchema);
export const ChatSendMessageSchema = envelope('chat.send', ChatSendPayloadSchema);

export const ClientMessageSchema = z.discriminatedUnion('type', [
  LobbyCreateMessageSchema,
  LobbyJoinMessageSchema,
  LobbyReadyMessageSchema,
  LobbyStartMessageSchema,
  LobbyRematchMessageSchema,
  LobbyAddBotMessageSchema,
  LobbyRemoveBotMessageSchema,
  GameActionMessageSchema,
  GameRejoinMessageSchema,
  GameSyncRequestMessageSchema,
  ChatSendMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const LobbyStateMessageSchema = envelope('lobby.state', LobbyStatePayloadSchema);
export const GameStartedMessageSchema = envelope('game.started', GameStartedPayloadSchema);
export const GameEventsMessageSchema = envelope('game.events', GameEventsPayloadSchema);
export const GameSyncMessageSchema = envelope('game.sync', GameSyncPayloadSchema);
export const GameErrorMessageSchema = envelope('game.error', GameErrorPayloadSchema);
// Wire type is `chat.message`; named `...Relay...` here to avoid stuttering next to
// `ChatSendMessageSchema` (the client->server `chat.send`).
export const ChatRelayMessageSchema = envelope('chat.message', ChatMessagePayloadSchema);
export const PresenceMessageSchema = envelope('presence', PresencePayloadSchema);
// T-206 §5 addition to the T-202 protocol (see TimerPayloadSchema above).
export const TimerMessageSchema = envelope('timer', TimerPayloadSchema);

export const ServerMessageSchema = z.discriminatedUnion('type', [
  LobbyStateMessageSchema,
  GameStartedMessageSchema,
  GameEventsMessageSchema,
  GameSyncMessageSchema,
  GameErrorMessageSchema,
  ChatRelayMessageSchema,
  PresenceMessageSchema,
  TimerMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ---- Parser -------------------------------------------------------------------------------

export type ParseClientMessageResult =
  | { ok: true; msg: ClientMessage }
  | { ok: false; code: 'BAD_MESSAGE' | 'BAD_ACTION'; detail: string };

/**
 * Validate a raw (untrusted, already-JSON-parsed) client frame against `ClientMessageSchema`.
 * A failure inside `payload.action` (i.e. the embedded engine `Action` didn't validate) is
 * reported as `BAD_ACTION`; every other failure (bad `v`, unknown `type`, malformed envelope or
 * non-action payload fields, ...) is `BAD_MESSAGE`.
 */
export function parseClientMessage(raw: unknown): ParseClientMessageResult {
  const result = ClientMessageSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, msg: result.data };
  }

  const isActionIssue = result.error.issues.some(
    (issue) => issue.path[0] === 'payload' && issue.path[1] === 'action',
  );
  const detail = result.error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');

  return { ok: false, code: isActionIssue ? 'BAD_ACTION' : 'BAD_MESSAGE', detail };
}
