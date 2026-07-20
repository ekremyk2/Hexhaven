// T-501 shared Playwright helpers: the `fourPlayers()` lobby bootstrap every UI suite needs, plus
// an adaptive "play one real turn-step" driver (`driveOneStep`) that `gameplay.spec.ts` and
// `reconnect.spec.ts` both reuse instead of duplicating the same board-click plumbing twice.
//
// Every wait in this file is on a DOM/state signal (an element appearing/becoming enabled, a URL
// changing) — never a fixed `page.waitForTimeout` — per requirement 6's flake policy.
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { NICKNAMES } from "./constants";

export type Seat = 0 | 1 | 2 | 3;
const RESOURCES = ["lumber", "brick", "wool", "grain", "ore"] as const;
type ResourceName = (typeof RESOURCES)[number];

// ---- Lobby bootstrap --------------------------------------------------------------------------

export interface FourPlayerGame {
  contexts: BrowserContext[];
  /** Seat-indexed pages — `pages[seat]` is always that seat's own browser context/page. */
  pages: Page[];
  code: string;
  gameId: string;
}

async function openFourContexts(browser: Browser): Promise<{ contexts: BrowserContext[]; pages: Page[] }> {
  const contexts = await Promise.all(NICKNAMES.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  return { contexts, pages };
}

/** Seat 0 creates a room (default 4-player base-game `RoomConfig` — no options touched, matching
 * `OptionsPanel.tsx`'s `DEFAULT_ROOM_CONFIG`), returns the 5-char room code + `gameId` (parsed off
 * the `/lobby/:gameId` URL Home.tsx navigates to). */
export async function createRoom(page: Page, nickname: string): Promise<{ code: string; gameId: string }> {
  await page.goto("/");
  await page.getByTestId("home-create-card").getByLabel("Nickname").fill(nickname);
  await page.getByTestId("home-create-card").getByRole("button", { name: "Create game" }).click();
  await page.waitForURL(/\/lobby\//);
  const gameId = new URL(page.url()).pathname.split("/").filter(Boolean).pop()!;
  const code = (await page.getByTestId("room-code").innerText()).trim();
  return { code, gameId };
}

/** Joins an existing room by code. Leaves the caller to assert on the resulting `/lobby/:id` (a
 * successful join) vs. an inline error (bad code / full lobby) — see `lobby.spec.ts`. */
export async function joinRoomExpectingSuccess(page: Page, nickname: string, code: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("home-join-card").getByLabel("Nickname").fill(nickname);
  await page.getByTestId("home-join-card").getByLabel("Room code").fill(code);
  await page.getByTestId("home-join-card").getByRole("button", { name: "Join game" }).click();
  await page.waitForURL(/\/lobby\//);
}

/** Attempts a join that the server is expected to REJECT (bad code / full lobby) — fills the join
 * card and clicks Join, then leaves the caller to assert the inline `role="alert"` error text
 * (Home.tsx renders the server's coded error via `errors:${code}`, apps/client/src/i18n/en/errors.json). */
export async function joinRoomExpectingError(page: Page, nickname: string, code: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("home-join-card").getByLabel("Nickname").fill(nickname);
  await page.getByTestId("home-join-card").getByLabel("Room code").fill(code);
  await page.getByTestId("home-join-card").getByRole("button", { name: "Join game" }).click();
}

/** Clicks the "I'm ready" toggle (always the FIRST label a fresh seat shows — `Lobby.tsx`'s
 * `readyToggleOn`/`readyToggleOff` pair). */
export async function readyUp(page: Page): Promise<void> {
  await page.getByRole("button", { name: "I'm ready" }).click();
}

/** Host-only: clicks Start (caller's responsibility to have readied every seat first — the button
 * stays disabled otherwise, matching `canStartGame`/D-025). */
export async function startGame(hostPage: Page): Promise<void> {
  await hostPage.getByRole("button", { name: "Start game" }).click();
}

export async function waitForGameScreen(page: Page): Promise<void> {
  await page.waitForURL(/\/game\//);
  await expect(page.getByTestId("action-bar")).toBeVisible();
}

/** The full lobby.spec/gameplay.spec/reconnect.spec bootstrap: 4 fresh contexts, seat 0 creates,
 * seats 1-3 join, everyone readies, seat 0 (host) starts, all 4 land on `/game/:id`. */
export async function fourPlayers(browser: Browser): Promise<FourPlayerGame> {
  const { contexts, pages } = await openFourContexts(browser);
  const { code, gameId } = await createRoom(pages[0]!, NICKNAMES[0]);

  for (let seat = 1; seat < 4; seat++) {
    await joinRoomExpectingSuccess(pages[seat]!, NICKNAMES[seat]!, code);
  }
  // Seat 0 must SEE every seat filled (a `lobby.state` round trip per join) before readying —
  // otherwise a race could ready seat 0 before seat 3's join has fanned out yet.
  await expect(pages[0]!.getByTestId("lobby-seat-3")).toContainText(NICKNAMES[3]!);

  for (const page of pages) await readyUp(page);
  await startGame(pages[0]!);
  await Promise.all(pages.map((p) => waitForGameScreen(p)));

  return { contexts, pages, code, gameId };
}

export async function closeAll(game: Pick<FourPlayerGame, "contexts">): Promise<void> {
  await Promise.all(game.contexts.map((c) => c.close()));
}

// ---- Board fingerprint (requirement 2) --------------------------------------------------------

export interface HexFingerprint {
  hexId: number;
  terrain: string;
  token: string;
}

/** The full public board layout as data, straight off `BoardView.tsx`'s per-hex `data-terrain`/
 * `data-token` attributes (T-501 addition — board layout is fully public, docs/02 §6, so this is a
 * data-only DOM addition, no hidden-info concern). Sorted by hex id so two pages' fingerprints can
 * be compared with a plain `toEqual`. */
export async function boardFingerprint(page: Page): Promise<HexFingerprint[]> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<SVGGElement>('[data-testid^="hex-tile-"]'));
    return nodes
      .map((el) => ({
        hexId: Number(el.getAttribute("data-hex-id")),
        terrain: el.getAttribute("data-terrain") ?? "",
        token: el.getAttribute("data-token") ?? "",
      }))
      .sort((a, b) => a.hexId - b.hexId);
  });
}

// ---- Setup phase (16 real-click placements, requirement 3) -------------------------------------

/** R3.1 snake draft order for a 4-player game (`packages/engine/src/phases/setup.ts`'s
 * `snakeSeat`): round 1 ascending 0..3, round 2 descending 3..0 — 8 turns * (settlement + road)
 * = 16 placements. Hardcoded rather than read off the DOM: it's a fixed rule for `playerCount: 4`,
 * not something that varies with the seed. */
const SETUP_SEAT_ORDER: readonly Seat[] = [0, 1, 2, 3, 3, 2, 1, 0];

/** Clicks whichever hit-area (vertex/edge/hex) is CURRENTLY legal-and-active on `page` — never a
 * hardcoded id. `InteractionLayer.tsx`'s `data-active` attribute (T-501 addition) is the only
 * thing that makes this possible without the test knowing real geometry ids; given the seeded
 * board (`HEXHAVEN_TEST_SEED`) the sequence of active-target sets is identical every run, so "click
 * whatever's first" is itself the deterministic script requirement 3 asks for. `waitFor` is the
 * synchronization point that replaces a timeout: it blocks until the server's next `game.events`
 * has actually flipped the target set, however long that round trip takes. */
async function clickFirstActiveTarget(page: Page, kind: "vertex" | "edge" | "hex"): Promise<void> {
  const prefix = kind === "vertex" ? "vertex-target-" : kind === "edge" ? "edge-target-" : "hex-target-";
  const locator = page.locator(`[data-testid^="${prefix}"][data-active="true"]`).first();
  await locator.waitFor({ state: "visible" });
  // `force: true`: these are transparent SVG hit-areas layered under/over pulsing ghost overlays
  // (pointer-events: none on the ghosts, so they never actually block the click) — forcing skips
  // Playwright's hit-test heuristic for a shape it can't always resolve reliably across engines,
  // with no real risk since we only ever target elements this script itself verified are active.
  await locator.click({ force: true });
}

/** Drives the entire 16-placement setup snake draft via real vertex/edge clicks, one seat's page
 * at a time in R3.1 order. Each `clickFirstActiveTarget` call's own `waitFor` is what makes this
 * safe to run seat-by-seat without separately polling whose turn it is: a page not yet in its
 * placement turn simply has zero active targets, so the wait blocks until the server's broadcast
 * actually hands it the turn. */
export async function playSetupPhase(pages: Page[]): Promise<void> {
  for (const seat of SETUP_SEAT_ORDER) {
    const page = pages[seat]!;
    await clickFirstActiveTarget(page, "vertex");
    await clickFirstActiveTarget(page, "edge");
  }
}

// ---- Turn-owner / phase-state reads -------------------------------------------------------------

/** `view.turn.player` is fully public — reads it off ANY page's DicePanel (`turnPlayerName`), by
 * matching which seat's nickname the panel currently displays. Nicknames are distinct
 * non-overlapping substrings (constants.ts) so this is unambiguous. */
export async function currentTurnOwnerSeat(pages: Page[]): Promise<Seat> {
  const text = await pages[0]!.getByTestId("dice-panel").innerText();
  const seat = NICKNAMES.findIndex((name) => text.includes(name));
  if (seat === -1) {
    throw new Error(`currentTurnOwnerSeat: couldn't match any nickname in dice-panel text: ${JSON.stringify(text)}`);
  }
  return seat as Seat;
}

async function isVisibleSafe(page: Page, testId: string): Promise<boolean> {
  return page.getByTestId(testId).isVisible().catch(() => false);
}

export async function isDiscardOpen(page: Page): Promise<boolean> {
  return isVisibleSafe(page, "discard-modal");
}

async function isMovingRobber(page: Page): Promise<boolean> {
  return isVisibleSafe(page, "move-robber-banner");
}

async function isStealOpen(page: Page): Promise<boolean> {
  return isVisibleSafe(page, "steal-picker");
}

async function isTradeOpenForOwner(page: Page): Promise<boolean> {
  return isVisibleSafe(page, "trade-tracker");
}

// ---- Individual action primitives ---------------------------------------------------------------

export async function autoDiscard(page: Page): Promise<void> {
  await page.getByTestId("discard-auto").click();
  await page.getByTestId("discard-confirm").click();
  await expect(page.getByTestId("discard-modal")).toBeHidden();
}

async function moveRobberFirstActive(page: Page): Promise<void> {
  await clickFirstActiveTarget(page, "hex");
}

/** Clicks the first steal candidate and returns their seat (parsed off `steal-candidate-<seat>`)
 * so the caller can assert the thief/victim-specific toast text afterward. */
async function stealFirstCandidate(page: Page): Promise<Seat> {
  const candidate = page.locator('[data-testid^="steal-candidate-"]').first();
  await candidate.waitFor({ state: "visible" });
  const testId = await candidate.getAttribute("data-testid");
  const victim = Number(testId?.replace("steal-candidate-", ""));
  await candidate.click();
  return victim as Seat;
}

async function rollIfPossible(page: Page): Promise<boolean> {
  const btn = page.getByTestId("action-roll");
  if (await btn.isEnabled().catch(() => false)) {
    await btn.click();
    return true;
  }
  return false;
}

/** Tries settlement, then road, then city (in that order — the cheapest/most-common builds first);
 * `ActionBar`'s `computeBuildState` only ever enables a build button when a legal target exists
 * (`actionBarLogic.ts`), so entering the mode always has somewhere legal to click next. */
async function buildAnyIfPossible(page: Page): Promise<boolean> {
  for (const kind of ["settlement", "road", "city"] as const) {
    const btn = page.getByTestId(`action-build-${kind}`);
    if (await btn.isEnabled().catch(() => false)) {
      await btn.click();
      await clickFirstActiveTarget(page, kind === "road" ? "edge" : "vertex");
      return true;
    }
  }
  return false;
}

async function buyDevCardIfPossible(page: Page): Promise<boolean> {
  const btn = page.getByTestId("action-buy-dev");
  if (await btn.isEnabled().catch(() => false)) {
    await btn.click();
    return true;
  }
  return false;
}

/** Plays the first playable dev card, preferring Knight — its aftermath (moveRobber -> steal) is
 * exactly what the caller's next `driveOneStep` iterations already know how to resolve, so it
 * doubles as robber/steal coverage instead of needing a second bespoke flow. Road Building is
 * deliberately excluded: its `roadBuilding` sub-phase collapses the ActionBar to a bare "pending"
 * note for everyone (matching every other non-preRoll/main phase) and needs its own free-road
 * board-click loop that `driveOneStep` doesn't otherwise implement — out of this adaptive driver's
 * scope (Knight/YoP/Monopoly alone already prove "a dev card play"). */
async function playDevCardIfPossible(page: Page): Promise<boolean> {
  for (const type of ["knight", "yearOfPlenty", "monopoly"] as const) {
    const btn = page.getByTestId(`devcard-play-${type}`);
    if (!(await btn.isVisible().catch(() => false))) continue;
    if (!(await btn.isEnabled().catch(() => false))) continue;
    await btn.click();
    if (type === "yearOfPlenty") {
      // Any bank-stocked resource for both picks — the dialog only enables a resource button while
      // the bank still has stock for it (YearOfPlentyDialog.tsx's live `disabledFor`), so the first
      // enabled button in each pick row is always legal.
      for (const resource of RESOURCES) {
        const pickA = page.getByTestId(`yop-pick-a-${resource}`);
        if (await pickA.isEnabled().catch(() => false)) {
          await pickA.click();
          break;
        }
      }
      for (const resource of RESOURCES) {
        const pickB = page.getByTestId(`yop-pick-b-${resource}`);
        if (await pickB.isEnabled().catch(() => false)) {
          await pickB.click();
          break;
        }
      }
      await page.getByTestId("yop-confirm").click();
    } else if (type === "monopoly") {
      await page.getByTestId(`monopoly-pick-${RESOURCES[0]}`).click();
      await page.getByTestId("monopoly-confirm").click();
    }
    return true;
  }
  return false;
}

async function readHandCount(page: Page, resource: ResourceName): Promise<number> {
  const text = await page.getByTestId(`hand-resource-${resource}`).innerText();
  return Number(text.trim());
}

async function bankTradeIfPossible(page: Page): Promise<boolean> {
  const trigger = page.getByTestId("trade-panel-trigger");
  if (!(await trigger.isVisible().catch(() => false))) return false;

  await trigger.click();
  let give: ResourceName | null = null;
  for (const r of RESOURCES) {
    if (await page.getByTestId(`bank-give-${r}`).isEnabled().catch(() => false)) {
      give = r;
      break;
    }
  }
  if (!give) {
    await page.keyboard.press("Escape");
    return false;
  }
  await page.getByTestId(`bank-give-${give}`).click();

  let receive: ResourceName | null = null;
  for (const r of RESOURCES) {
    if (r === give) continue;
    if (await page.getByTestId(`bank-receive-${r}`).isEnabled().catch(() => false)) {
      receive = r;
      break;
    }
  }
  if (!receive) {
    await page.keyboard.press("Escape");
    return false;
  }
  await page.getByTestId(`bank-receive-${receive}`).click();
  await page.getByTestId("bank-confirm").click();
  await page.keyboard.press("Escape");
  return true;
}

/** Opens a domestic offer from `owner`'s page (give 1 of whatever it actually holds, ask for a
 * different resource) — leaves the trade OPEN; a later `driveOneStep` iteration resolves it via
 * `resolveOpenTrade` once `isTradeOpenForOwner` sees it. Returns `false` (no-op) if the owner is
 * holding literally nothing to offer (shouldn't happen once production has run at least once). */
async function maybeOfferTrade(page: Page, owner: Seat): Promise<boolean> {
  const trigger = page.getByTestId("trade-panel-trigger");
  if (!(await trigger.isVisible().catch(() => false))) return false;

  let give: ResourceName | null = null;
  for (const r of RESOURCES) {
    if ((await readHandCount(page, r)) >= 1) {
      give = r;
      break;
    }
  }
  if (!give) return false;
  const receive = RESOURCES.find((r) => r !== give)!;

  await trigger.click();
  await page.getByRole("radio", { name: "Players" }).click();
  await page.getByTestId(`offer-give-${give}-plus`).click();
  await page.getByTestId(`offer-receive-${receive}-plus`).click();
  await page.getByTestId("offer-send").click();
  void owner;
  return true;
}

/** Resolves an open domestic offer (task requirement 3: "offer from A, decline B, accept C,
 * confirm"): the two non-owner seats adjacent in seat order decline/accept respectively, then the
 * owner completes with the accepter. `IncomingOffer.tsx` renders only on non-owner pages while
 * `view.trade != null` — Playwright's default click-waits block until each seat's own copy of the
 * offer actually arrives over the wire. */
async function resolveOpenTrade(pages: Page[], owner: Seat): Promise<void> {
  const others = ([0, 1, 2, 3] as Seat[]).filter((s) => s !== owner);
  const decliner = others[0]!;
  const accepter = others[1]!;

  await pages[decliner]!.getByTestId("incoming-offer-decline").click();
  await pages[accepter]!.getByTestId("incoming-offer-accept").click();
  await pages[owner]!.getByTestId(`trade-tracker-confirm-${accepter}`).click();
}

async function endTurn(page: Page): Promise<void> {
  await page.getByTestId("action-end-turn").click();
}

// ---- The adaptive main-phase driver (gameplay.spec + reconnect.spec) ---------------------------

export type StepKind =
  | "discard"
  | "robberMove"
  | "steal"
  | "tradeResolved"
  | "tradeOffered"
  | "roll"
  | "build"
  | "bankTrade"
  | "devBuy"
  | "devPlay"
  | "endTurn";

export interface StepResult {
  kind: StepKind;
  seat: Seat;
  /** Only set for `kind: 'steal'` — the victim seat, so a caller can assert the thief/victim/
   * bystander-specific toast text (task requirement 3: "toast variants asserted per viewer"). */
  victimSeat?: Seat;
}

/** Which scenario categories have been witnessed at least once — `gameplay.spec.ts` stops its loop
 * once every field it cares about is `true`; `driveOneStep` also reads this to stop re-attempting a
 * category that's already been proven, so the game keeps moving toward whatever's still missing
 * (docs/12: waits on state, never a timeout) instead of e.g. building forever every single turn. */
export interface ScenarioFlags {
  rolled: boolean;
  built: boolean;
  bankTraded: boolean;
  domesticTraded: boolean;
  devCardPlayed: boolean;
  discardHandled: boolean;
  robberMoved: boolean;
  stealHandled: boolean;
}

export function freshFlags(): ScenarioFlags {
  return {
    rolled: false,
    built: false,
    bankTraded: false,
    domesticTraded: false,
    devCardPlayed: false,
    discardHandled: false,
    robberMoved: false,
    stealHandled: false,
  };
}

export interface DriveOneStepOptions {
  /** `false` lets `reconnect.spec.ts` observe a pending discard WITHOUT resolving it (so it can
   * reload mid-decision first). Defaults to `true`. */
  resolveDiscards?: boolean;
}

/**
 * Advances the real game by exactly one meaningful step, via real UI interactions on whichever
 * seat's page currently owns the next decision — the single driver both `gameplay.spec.ts` (loop
 * until every `ScenarioFlags` field is true) and `reconnect.spec.ts` (loop until a discard is
 * merely PENDING) call. Priority, every step:
 *   1. any seat with an open discard modal (always resolved first — R6.1's discard is mandatory
 *      before anything else can proceed for that seat; `opts.resolveDiscards` can defer this).
 *   2. the turn owner's pending robber-move / steal / open-trade-response decisions.
 *   3. rolling, if it's the preRoll step.
 *   4. otherwise, a main-phase action: whichever `ScenarioFlags` category is still unmet gets
 *      first refusal (build -> bank trade -> dev-card play -> offer a domestic trade), then the
 *      same list again as a fallback once everything's been witnessed (so the game keeps making
 *      real progress turn after turn rather than idling), and finally `endTurn`.
 */
export async function driveOneStep(
  pages: Page[],
  flags: ScenarioFlags,
  opts: DriveOneStepOptions = {},
): Promise<StepResult> {
  const resolveDiscards = opts.resolveDiscards ?? true;

  for (let seat = 0; seat < 4; seat++) {
    if (await isDiscardOpen(pages[seat]!)) {
      if (!resolveDiscards) return { kind: "discard", seat: seat as Seat };
      await autoDiscard(pages[seat]!);
      flags.discardHandled = true;
      return { kind: "discard", seat: seat as Seat };
    }
  }

  const owner = await currentTurnOwnerSeat(pages);
  const ownerPage = pages[owner]!;

  if (await isMovingRobber(ownerPage)) {
    await moveRobberFirstActive(ownerPage);
    flags.robberMoved = true;
    return { kind: "robberMove", seat: owner };
  }
  if (await isStealOpen(ownerPage)) {
    const victimSeat = await stealFirstCandidate(ownerPage);
    flags.stealHandled = true;
    return { kind: "steal", seat: owner, victimSeat };
  }
  if (await isTradeOpenForOwner(ownerPage)) {
    await resolveOpenTrade(pages, owner);
    flags.domesticTraded = true;
    return { kind: "tradeResolved", seat: owner };
  }

  if (await rollIfPossible(ownerPage)) {
    flags.rolled = true;
    return { kind: "roll", seat: owner };
  }

  const attempts: Array<[StepKind, () => Promise<boolean>]> = [
    ["build", () => buildAnyIfPossible(ownerPage)],
    ["bankTrade", () => bankTradeIfPossible(ownerPage)],
    ["devPlay", () => playDevCardIfPossible(ownerPage)],
    ["tradeOffered", () => maybeOfferTrade(ownerPage, owner)],
    ["devBuy", () => buyDevCardIfPossible(ownerPage)],
  ];
  // Unmet categories first (so scarce affordable actions go toward proving new coverage), then the
  // same list again as a pure "keep the game moving" fallback.
  const unmet = attempts.filter(([kind]) => !isSatisfied(flags, kind));
  for (const [kind, attempt] of [...unmet, ...attempts]) {
    if (await attempt()) {
      applyFlag(flags, kind);
      return { kind, seat: owner };
    }
  }

  await endTurn(ownerPage);
  return { kind: "endTurn", seat: owner };
}

function isSatisfied(flags: ScenarioFlags, kind: StepKind): boolean {
  switch (kind) {
    case "build":
      return flags.built;
    case "bankTrade":
      return flags.bankTraded;
    case "devPlay":
      return flags.devCardPlayed;
    case "tradeOffered":
      return flags.domesticTraded;
    default:
      return false;
  }
}

function applyFlag(flags: ScenarioFlags, kind: StepKind): void {
  if (kind === "build") flags.built = true;
  else if (kind === "bankTrade") flags.bankTraded = true;
  else if (kind === "devPlay") flags.devCardPlayed = true;
  // "tradeOffered"/"devBuy" intentionally don't set a terminal flag here: `domesticTraded` only
  // flips once `tradeResolved` actually completes the offer (a later step), and buying a dev card
  // isn't itself one of gameplay.spec's required scenarios (playing one is).
}

/** Every `ScenarioFlags` field gameplay.spec's loop requires before it stops (discard/robber/steal
 * are asserted separately in reconnect.spec / left best-effort in gameplay.spec — see that file's
 * header for why a natural 7 isn't gated on). */
export function allCoreFlagsMet(flags: ScenarioFlags): boolean {
  return flags.rolled && flags.built && flags.bankTraded && flags.domesticTraded && flags.devCardPlayed;
}

// ---- Steal toast redaction (requirement 3: "toast variants asserted per viewer") ---------------

/** ER-10's per-viewer redaction, made visible in the toast copy itself (robber/toastFormat.ts):
 * the thief sees the resource name ("You stole Ore from…"), the victim sees it too ("… stole your
 * Ore"), and every bystander gets a card-identity-free variant ("… stole a card from …") — never
 * the resource. `Toasts.tsx` has no per-toast testid, so this reads the whole `toasts` panel's
 * text, which is unambiguous right after a steal (nothing else pushes a toast in the same step). */
export async function assertStealToastsPerViewer(pages: Page[], thief: Seat, victim: Seat): Promise<void> {
  await expect(pages[thief]!.getByTestId("toasts")).toContainText("You stole");
  await expect(pages[victim]!.getByTestId("toasts")).toContainText("stole your");
  for (let seat = 0; seat < 4; seat++) {
    if (seat === thief || seat === victim) continue;
    await expect(pages[seat]!.getByTestId("toasts")).toContainText("stole a card from");
  }
}
