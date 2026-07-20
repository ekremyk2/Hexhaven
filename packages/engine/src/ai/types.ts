// T-410: shared tiny types for the ai/** module — kept in their own file so bot.ts, search.ts,
// determinize.ts, and greedyBaseline.ts can all import `Rng` without a circular import.

/**
 * The engine's rng "handle" (rng.ts's `nextRand`/`pickIndex`/`shuffle` all thread a plain 32-bit
 * unsigned integer state — see docs/03 §6). Aliased here only so ai/**'s public signatures read
 * naturally (`chooseAction(view, rng, opts)`); it is NOT a new representation.
 */
export type Rng = number;
