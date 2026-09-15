# AGENTS.md — master instructions for AI agents

Read this file before doing anything. Do not re-derive context from the
big notebooks or data files unless explicitly asked.

## Project

Browser-based "Hyperpolygon" visualization for `aryarose4.github.io`
(al-folio Jekyll academic site). We are porting Mathematica quiver /
moment-map calculations (source: `mathematica/Torelli Parameters and
Hitchin Section.nb`, Section 9 "Full Moduli Space"; display code in
`mathematica/Hyperpolygon Simulation.nb`) to a **live JavaScript solver**
plus a three.js viewer, embedded in `_projects/hyperpolygon_moduli_spaces.md`.

## Ground rules

- Pause at verifiable milestones and show the user before continuing.
- Keep the main thread lean: delegate self-contained implementation
  chunks to subagents (task tool) with precise specs; have them return
  short summaries, not full file dumps.
- Node is v12, no npm/npx on PATH: use `.mjs`, no top-level await,
  no new dependencies in the harness.
- The site builds with Jekyll via the existing devcontainer. Anything
  not meant to deploy goes in `_config.yml`'s `exclude` list
  (`mathematica/` and `dev/` are already there — keep that true for
  new folders).

## Reasoning/output cap — how to avoid losing turns

The model provider used to hard-cap every assistant turn at **32,000
tokens of total generated output (reasoning + visible text combined)**
— verified from the `kilo.db` message records (all `finish="length"`
turns stopped at exactly 32000), and it WAS actually Kilo's own
hardcoded `OUTPUT_TOKEN_MAX = 32000` clamp, not a provider limit
(traced in the installed binary, 2026-09-14). A turn that hits the cap
mid-reasoning returns `finish: "length"` and, if no visible text was
emitted yet, the ENTIRE turn is discarded and surfaces as a
"reasoning limit" error — hours of derivation can vanish. RAISED
2026-09-14: the clamp is configurable via the env var
`KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX` (effective cap =
min(model.limit.output, env value) ?? 32000), set to 128000 in
`.devcontainer/devcontainer.json` remoteEnv, with per-model
`limit.output` overrides in `~/.config/kilo/kilo.jsonc` (glm-5.3-flash
131072, deepseek-v4-flash-0731 943718; deepseek is then capped at the
env 128000). Requires a window reload/container rebuild to reach the
extension. The small-turns discipline below is still good hygiene
(the deepseek cap is per-turn too, and long monolithic reasoning
blocks remain fragile); work around the cap when needed:

- Work in SMALL tool-call steps. Each tool call ends a reasoning
  block and commits it — short bursts (the historical safe pattern is
  ~1-2k reasoning per turn) can accumulate any amount of work; one
  monolithic block cannot exceed 32k, ever. (Pre-raise hygiene; with
  the raised cap a monolithic block can now run past 32k, but a cap
  hit still discards the whole turn.)
- NEVER attempt a full mathematical derivation in one unbroken
  reasoning block. State the plan in a sentence or two, derive ONE
  step, write the result down, then take the next step. If a chunk
  needs more than a paragraph or two of chain-of-thought, split it.
- CHECKPOINT partial conclusions to a scratch file (e.g.
  `/tmp/kilo/notes-<topic>.md`, or a `dev/hyperpolygon/` scratch file
  if it should survive) after each derived chunk — facts, formulas,
  decisions, not prose. A cap hit then costs only the current
  segment, and recovery = read the checkpoint, not re-derive.
- Prefer delegating self-contained derivation/implementation chunks
  to subagents (task tool, per Ground rules): each subagent turn has
  its own output budget, and they should return SHORT summaries (their
  reasoning doesn't consume the main thread's budget).
- If a turn dies with the reasoning-limit error, do NOT retry the
  same monolithic block: re-read the last checkpoint / the relevant
  files and resume from the smallest next step.
- Recovery sources for lost turns: `~/.local/share/kilo/log/*.log`
  (line `reasoning-only length stop`) and
  `~/.local/share/kilo/kilo.db` message table
  (`json_extract(data,'$.finish')='length'` shows the token counts).
  Checkpoints, not post-mortems, are the real fix.

## Math model (star-shaped quiver: central C^2, four C legs)

- `beta` = 4 positive parabolic weights. Must not lie on a chamber wall
  (no subset of legs sums to exactly half the total).
- Parameters `(r, theta, t)` in [0,1] x [-Pi,Pi] x [0,0.99].
- Pipeline:
  1. `x = [[sqrt(2 beta1), 0, 1, 1-r], [0, 1, 1, r e^{i theta}]]`
  2. `y`: solve `mu_C = 0` and `mu_SL = 0` — a 7x7 complex LINEAR system
     for the free entries of `y` with `y42 = t/(1-t)` prescribed; then
     scale the whole `y` by `(1-r)`.
  3. `(C*)^4` balancing (`fixMuU1`): closed form — per leg solve
     `c/u - d u = 2 beta_i` for `u = lam^4` (`c = |x_leg|^2`,
     `d = |y_leg|^2`), unique positive root; apply torus action
     `x -> x.diag(1/lam^2)`, `y -> diag(lam^2).y`.
  4. SL(2,C) balancing: Newton on `(a12, b12, a22)` with
     `A = [[1, a12+i b12],[0, a22^2]]` so the three su(2) projections of
     `mu_SU2` vanish; acceptance 1e-3; fallback is the notebook's stable
     cyclic 1-parameter minimization (other params reset to (0,0,1) each
     pass, a22 enters linearly there, 18 iterations).
- `r = 1`: the raw linear system is singular; the `(1-r)` prefactor
  cancels the pole, so evaluate at `reff = min(r, 1-1e-5)`. Known
  artifact: at exactly `r = 1`, `mu_C` carries O(1e-5) error (polygon
  closure is still ~1e-11). Do not "fix" without re-validating.
- Output `(x, y)` is defined only up to a residual `U(2) x U(1)^4`
  gauge freedom. NEVER compare raw matrices against the old data;
  compare gauge-invariant quantities: per-leg `|y_i|^2`, per-vertex
  norms and edge lengths of the su(2) polygon, and the moment-map
  residuals of both representations.

## Files

- `assets/js/hyperpolygon/solver.js` — the solver, dependency-free ES
  module. API: `makeHyperpolygon(r, theta, t, beta, permute = true)`
  returns `{x, y, vertices, sl2, accuracy}`; `vertices` = 9 su(2)
  polygon points (index 8 is the closure error), `sl2` = real/imag
  SL(2,C) polygons (5 points each), `accuracy` = `{su2Norm, muU1Error,
  muCNorm, usedStable}`. With `permute = true` (default) the returned
  `(x, y)` are swapped legs 2<->3 (columns 2/3 of x, rows 2/3 of y) and
  `vertices`/`sl2` are built from the swapped pair, so the invariant
  `vertices === hyperpolygonVertices(x, y)` always holds; `accuracy`
  always describes the solved (unpermuted) representative — the permuted
  pair only solves mu_U1 = beta when beta2 = beta3 (true for the widget's
  fixed beta). The swap reorders the polygon traversal AFTER v4 (v1-v4
  and the chord endpoint v4 are leg-sums and unchanged; v5-v7 move,
  closure v8 unchanged). PERMUTE_23 (2026-09-13, user request): the
  module exports `export const PERMUTE_23`, the single
  true/false switch for the widget-side beta legs 2/3 permutation — it
  gates BOTH the widget's beta pre-swap and the `permute` argument
  (widget.js and sideview.js's probe import it), so flipping it
  switches the widget's call pattern in one place. With
  PERMUTE_23 = false the widget displays the unpermuted solved
  representative (the notebook leg convention validate.mjs compares
  against); with PERMUTE_23 = true it uses the historical swapped
   pattern. The flag was set false per user request 2026-09-13, flipped
   back to TRUE by the user the same day (display user-verified "looks
   great"), then set FALSE again 2026-09-14 per the user ("disable the
   permute toggle for now") pending the crease-consistency traversal fix
   (task list #6, which will supersede the flag) — both settings are
   user-approved; check the source for the live value. Displayed leg j
  is user beta leg j under either setting, and
  mu_U1 = user beta under either setting. Harnesses pass
  `permute = false` where the
  notebook leg convention or solved-representative residuals matter
  (sweep.mjs/edge.mjs/validate.mjs — required since two of the sweep
  beta sets have beta2 != beta3). Standard path: damped Newton from
  [0,0,1] (usedStable = that start failed, i.e. the cyclic stable
  fallback produced the pair). RESCUE (2026-09-12): when the final
  su(2) residual exceeds 1e-6, makeHyperpolygon retries Newton from
  ([0,0,2], [0.7,0.7,1], [-0.7,-0.7,1]) and the stable fallback from
  ([0.7,-0.7,1], [0,0,0.25], via its `start` argument), keeping the
  best representative. Needed because ~11% of (r,theta) draws at t=0
  for lopsided in-chamber betas stalled at su2 ~1e-1 (basin issue, the
  stable fallback exits at a local minimum; su2 vs t is non-monotonic
  there). Gated on su2 > 1e-6 so every convergent solve takes the
  identical historical path (validate.mjs diffs vs legacy data are
  unchanged); stalled points cost ~30-90 ms (browser: one-frame hitch
  at previously-broken points only). Regression-tested by walls.mjs
  [B2].
  ENDPOINT FIX (2026-09-12, task 3): r=0 and r=1 used to JUMP — with the
  widget's swapped beta, r=0 stalled the su(2) balancing at su2 ~2.5e-1
  (closure marker visibly at 0.25) and r=1 stalled at ~1.5e-2, while
  r=0.005/0.995 solve to ~1e-12. Root causes: (1) `fixMuU1`'s u root
  `(-beta + sqrt(beta^2 + c*d))/d` suffers total cancellation when
  c*d <<~ beta^2 * 2^-52 — d = |y_leg|^2 ~ r^2 near r=0 (u rounds to 0 ->
  lam = 0 -> x scaled by 1/lam^2 = Infinity -> NaN at r=1e-12; garbage u,
  muU1 ~1e-4, at r=1e-8..1e-6), and d ~ 1e-10 at the r=1 reff plateau.
  Fixed with the algebraically identical cancellation-free form
  `u = c / (beta + sqrt(beta^2 + c*d))` (forward-stable; d->0 limit
  c/(2*beta) matches the d==0 branch); healthy solves change only in the
  last ulps and sweep's worst mu_U1 improved 6.7e-10 -> 5.2e-15.
  (2) At exactly r=0 the su(2) residual is a FLAT 0.25 plateau over the
  whole (a12, b12, a22) fast-slice box (an orbit degeneration: x cols 0
  and 3 coincide; NOT a Newton-basin issue — probed with a general
  GL(2,C) random+refine search) — any tiny positive r-offset restores a
  regular landscape. (3) At r=1 the historical reff = 1-1e-5 offset sits
  inside a band where the balancing stalls at ~1.5e-2, and the residual
  is a line-search pathology: with identical F and start, the max-norm
  line search stalls at ~2.3e-1 while a Euclidean-norm line search
  converges to ~1e-12. Fix: the balancing cascade is factored into
  `balancedPair(x0, y0, beta)` (historical Newton -> stable-if-stalled ->
  rescue, gate made NaN-safe; rescue gains start [-0.3,0.3,1] plus two
  Euclidean-line-search Newton retries via an optional `norm` argument on
  `newton`), and `makeHyperpolygon` adds gated endpoint retries: when
  r <= 1e-5 or r > 1-1e-5 AND the primary solve is not clean
  (su2 > 1e-6, NaN-safe; high end also on muC > 1e-9), the full cascade
  re-runs on the consistent pair evaluated AT the offset point (x0 AND
  y0 at reffAlt; offsets ~1e-9/1e-6 low end, 1e-6/1e-8 high end), keeping
  the best pair. This display-at-the-limit evaluation zeroes the
  documented mu_C ~1e-5 r=1 artifact (now <= 1.4e-17 across the endpoint
  grid) and rescues the t=0 corners (T=0 zeroes the y-solve RHS, so
  y-side retries alone are no-ops there). Healthy interior solves never
  enter the retries; endpoint points cost ~20-115 ms once (accepted
  one-frame-hitch class). The r=1 legacy spot in validate.mjs improved
  (our su2 1.2e-11 -> 1.1e-16, muC 1e-5 -> 8.7e-19) with gauge-invariant
  legacy diffs unchanged (3.84e-4 at the documented legacy-tolerance
  spot). Regression-tested by the new edge.mjs endpoint battery.
  LOCUS FIX (2026-09-13, user bug report "errors at (r,theta)=(0.5,0),
  e.g. beta=(0.5,0.5,0.8,0.25), jump to something incorrect, many other
  chambers too"): at the INTERIOR degenerate locus (r, theta) = (1/2, 0)
  — where the parallelism defect of x columns 2 and 3, D = r e^{i theta}
  - (1 - r), vanishes (columns (1,1) and (1-r, r e^{i theta}) become
  parallel exactly there) — the su(2) balancing stalls for betas whose
  balanced representative requires the two columns SEPARATED: the whole
  balancing family preserves the parallelism (the fast slice keeps
  col2' - col3' = a22^2 (col2 - col3) = 0 and the torus acts per leg), so
  every start (Newton, stable fallback, all rescues) stalls at the SAME
  beta-dependent value at EVERY t (measured 5.2e-2 for the user-example
  beta, 5.0e-1 for a dominant leg-2 chamber; the widget-default beta has
  a parallel-columns representative and never stalls — chamber-dependent,
  as reported). Just off the locus the tiny column angle is amplified
  through a near-cancellation inside the A-action, so neighbors solve,
  but the basin is chaotic for |D| <~ 1e-6 (stalls observed up to
  |D| ~ 6e-7, clean from ~1.5e-6). Fix (makeHyperpolygon, after the
  endpoint retries): when the solve inside the gate disk |D| <= 1e-4
  (100x beyond the observed band) is not fully converged — trigger 1e-9,
  NOT the 1e-6 rescue gate, since the true branch solves to ~1e-12
  throughout the disk and anything above is stall debris (triggering on
  it makes the whole disk uniformly clean instead of leaving a
  chaotically-varying 1e-10..1e-6 band) — the full cascade re-runs on
  the consistent pair evaluated at r = 0.5 +- 1e-4 (ladder to 1e-3; the
  nudge side follows r so the display continues the row the user is on;
  early-break once clean to keep the cost at one extra cascade).
  Display-at-the-limit evaluation again: the returned pair solves every
  moment map equation exactly at (rAlt, theta, t) and its invariants
  match the neighboring branch to ~2e-6 (r-slope of the invariants is
  ~0.01 there) — the visible 5e-2 jump is gone. The locus rep is
  BIT-EXACT the direct solve at the offset point (the retry builds the
  identical x0/y0 pair), asserted by the battery. Clean solves never
  enter the branch; the exact locus point costs ~30-115 ms once (stalled
  primary rescue + one converging offset cascade; accepted
  one-frame-hitch class, and the widget parks there via its snaps).
  Exterior chambers at t = 0 are untouched (the exterior branch's own
  degenerate-locus r-nudge returns earlier); exterior chambers at t > 0
  are fixed by the same block (5.0e-1 -> ~1e-13). Regression-tested by
  the new dev/hyperpolygon/locus.mjs battery (255 checks, in
  run-validation.sh): [A] locus grid x t across chambers and both call
  patterns, [B] the chaotic stall band inside/outside the gate disk,
  [C] bit-exact offset identity + neighbor-branch continuity, [D]
  widget-pattern mu_U1 = user beta at the locus, [E] seeded gate-disk
  fuzz.
  EXTERIOR BRANCH (2026-09-13, user request; user-verified same day
  "Looks great"): in an "exterior chamber"
  (one beta >= the sum of the rest; `dominantLeg(beta)` returns the
  dominant leg j, wall inclusive up to a 1e-12 slack) the t = 0 slice
  has NO y = 0 solution (mu_SU2 = 0 needs sum x_i x_i^dagger scalar,
  which forces the tight-frame inequality), and the historical pipeline
  stalls at a stick with a gap su2 = beta_j - rest. The t -> 0+ limit of
  the genuine t > 0 solutions is instead constructed in closed form by
  `exteriorPair(r, theta, beta, j)` and returned by makeHyperpolygon at
  t <= 0 in exterior chambers: x_j = sqrt(2 beta_j) on one axis, every
  other x-column parallel on the orthogonal axis, y_j = 0, every other
  y-row on the orthogonal direction — the "minimum energy" state the
  user specified (row j of y zero, the other rows tuned by (r,theta);
  the polygon is an EXACT stick for all (r,theta)). Magnitudes:
  |c_i|^2 = beta_i + S_i, |alpha_i|^2 = S_i - beta_i with
  S_i = sqrt(beta_i^2 + K w_i), K >= 0 the unique monotone root of
  sum_{i != j} S_i = beta_j (K = 0 exactly ON the wall, so enlarging
  beta_j past the wall telescopes the stick taller with no jump —
  battery [C]). The (r,theta) dependence lives in the direction weights
  w_i = |xdir_i|^2 |ydir_i|^2 and the phases, read off the t -> 0+
  asymptotics: pattern A (j = 0) xdir = x0 row 1 / ydir = Y col 0;
  pattern B (j > 0) xdir = x0 row 0 + a* x0 row 1, ydir = Y col 1 -
  a* Y col 0 with a* = Y[j][1]/Y[j][0] (0 for j = 1, -1 for j = 2,
  -(1-reff)e^{-i theta}/reff for j = 3) chosen so the dominant leg's
  ydir vanishes. The central complex moment map sum c_i alpha_i = 0 is
  an algebraic identity (all four sums sum_i x0[r][i] Y[i][c] vanish);
  Y = `exteriorYDirection(reff, theta, beta0)` is the CLOSED FORM of the
  T-derivative direction of solveY (y = (1-reff) T Y exactly — the
  y-system is linear in T; `ySolveDirection` is the LU equivalent, kept
  for cross-checks). Numerics gotchas, both battery-found: (1) compute
  aMag = sqrt(S - beta_i) as sqrt(K what/(beta_i + S_i)) — the direct
  form rounds to 0 when K what < ulp(beta_i^2) (r = 0 spans 18 orders
  of magnitude in w), dropping that leg's term of the central identity
  while the others keep their contamination (~1e-10 residual); (2)
  write Y[1][0] as reff e^{i theta} D/(1-reff) with D = reff e^{i theta}
  - (1 - reff) — the direct two-term form cancels to O(ulp(1/2)) near
  reff = 1/2 and the 1/sqrt(wMax) of the weight normalization amplifies
  it. At the DEGENERATE LOCUS (r, theta) = (1/2, 0) every pattern-B
  direction weight vanishes identically (Y degenerates to second order;
  the t > 0 pipeline stalls there too at every t — FIXED 2026-09-13 by
  the solver's locus retry, see the LOCUS FIX paragraph above) —
  exteriorPair re-evaluates at
  a tiny r offset (1e-7, growing), which continues the theta = 0 row
  continuously (w_0 ~ w_1 ~ (r-1/2)^2, w_3 ~ (r-1/2)^4) and matches the
  pipeline's own converged behavior next to the point. The t -> 0+
  limit match of the closed form against the pipeline was verified to
  ~1e-11 per-leg |x|^2, |y|^2 at t = 1e-6 for ALL FOUR dominant legs,
  so the t = 0 display is continuous with t > 0. For t > 0 the branch
  does NOT run (the historical pipeline already converges in exterior
  chambers — 0/160 seeded fuzz failures, worst su2 1e-11). Widget path:
  the branch runs on the PASSED (solve) beta before the PERMUTE_23
  output swap, so the widget's pre-swapped call pattern handles user-
  dominant legs 2/3 via the swapped solve-beta (battery [E]).
  Regression-tested by the new dev/hyperpolygon/exterior.mjs battery
  (1524 checks, in run-validation.sh).
  STAR REINDEXING (2026-09-14, user request "use an internal reindexing in
  the solver"; user asked to address the STAR case first — cycle chambers
  followed the same day, see the CYCLE REINDEXING paragraph below):
  interior chambers (no dominant leg) come in two flavors — the three short
  size-2 subsets (one per pair split) either share a common index j ("star",
  4 chambers; in star-j, beta_j < s/4 strictly, so star chambers border only
  cycle chambers across pair walls) or do not ("cycle", 4 chambers; j =
  complement of the union). The notebook ansatz was built for
  star-j3 (short pairs {0,3},{1,3},{2,3}; the (r,theta) = (0,0)/(1/2,0)/(1,0)
  snap points make those three pairs straight via col3-parallelism).
  makeHyperpolygon now dispatches: exterior branch first (unchanged), then
  if dominantLeg < 0 and starIndex(beta) = j >= 0 and j !== 3 it calls
   starReindexed — the historical pipeline runs UNCHANGED on the internally
   permuted beta (sig = starSig(j), see the COHERENT ATTACHMENT ASSIGNMENT
   paragraph below, so slot 3 = j; for
   j = 3 sig is the identity and the direct solveCore path keeps the
   historical bit-exact behavior, which is why validate.mjs's notebook beta
   and the widget default are unaffected) — and the output is unpermuted to
   user indexing: returned column/row k = user leg k, mu_U1 = USER beta,
   vertices/sl2 built from the user-indexed pair (chord v0->v4 = user legs
   {0,1} always; the permute argument still applies last). New exports:
   `starIndex(beta)` (common index of the three short pairs or -1; tie
   convention replicated from chambers.js pickShort: strict less, exact ties
   pick the lex-smaller side = the pair containing leg 0) and `starSlots`
   (beta) (the exterior-sphere attachment-slot rule [south, equator, north]:
   derived from starSig — by the coherent assignment this is the CONSTANT
   [7,5,6] in every star chamber). makeHyperpolygon was split into the
   dispatcher plus
   `solveCore` (the historical pipeline verbatim). Note the r = 1 straight
   pair is straight only to O(1 - reff) ~ 1.7e-5 (the clean solve keeps the
   documented reff = 1-1e-5 offset) — battery bar 1e-4 there, 1e-8 elsewhere.
    The side view's exterior-sphere slot map is the CONSTANT [7,5,6] in
    every chamber (the coherent assignment; sideview.mjs [P] measures and
    asserts it across all 8 interior chambers), and widget.js fills null
    probe entries from starSlots or
    cycleSlots (PERMUTE_23 = false only;
    the composed rule for the permuted pattern is not derived — the flag is
    slated for obsolescence by task #6 anyway). Regression-tested by the new
    dev/hyperpolygon/star.mjs battery (1391 checks, in run-validation.sh):
    [A] 4 star chambers x (r,theta,t) grid residuals vs the USER beta, [B]
    straight-pair parallelism at the snap points, [C] bitwise equivalence with
    the manual permuted call (using the exported starSig), [D] starIndex
    classification + the coherent starSlots == [7,5,6] assertions (incl. -1 on the
    four cycle tuples), [E] cycle tuples now at full [A] residual bars
    (raised 2026-09-14 when the cycle path landed).
  CYCLE REINDEXING (2026-09-14, user ansatz, same-day task #8): interior
  cycle chambers (starIndex < 0; `cycleIndex(beta)` returns the missing
  index of the three short pairs' union, -1 for star/others) now solve by
  the user-proposed ansatz, with the distinguished leg j permuted into slot
  3 and the other three ordered by cycleSig(j) (see the COHERENT ATTACHMENT
  ASSIGNMENT paragraph below; for j = 0 cycleSig is the ascending schedule
  the user proposed: straight pairs at
  (r,theta) = (0,0)/(1/2,0)/(1,0) are {s0,s1}/{s1,s2}/{s0,s2} in SLOT
  indexing):
  x = [[1,1,1,0],[0, r e^{i theta}, 1-r, 1]] (`buildXCycle`, no beta factor;
  col3 = (0,1) distinguished, never parallel to any other column; col0 =
  (1,0) fixed; the only degenerate points are exactly the three snaps).
  CRITICAL prescription change: the y-solve's t/(1-t) entry CANNOT stay y42 —
  for this x, mu_C leg 3 (x[0][3] = 0, x[1][3] = 1) forces y42 = 0. The
  prescription moved to y22 (`ySolveSystemCycle` + `solveYCycle`, unknown
  order y11,y12,y21,y31,y32,y41,y42; mu_C leg 1's row carries the T to the
  RHS). Closed-form direction: Y11=0, Y21=-re, Y31=re, Y32=-re/(1-r),
  Y42=0, Y12=re/(1-r)-1, Y41=re(re-(1-r)) with re = reff e^{i theta}; the
  (1-reff) scale makes y12 EXACTLY T*D (D = re - (1-reff), the same locus
  defect as the star ansatz) and cancels the single 1/(1-r) pole on Y32
  unless reff is capped at 1-1e-5. At r=0 y-rows 2,3 vanish (d=0 balancing
  branch), at r=1 row 1 does. solveCore gained an `ansatz` argument
  ({buildX(r,theta,beta0), solveY(x,reff,t)}; exported STAR_ANSATZ /
  CYCLE_ANSATZ; default STAR keeps every historical path bit-exact —
  validate.mjs diffs unchanged) and is now exported; the endpoint/locus
  retry machinery applies verbatim (the cycle degenerations are the same
  orbit-coincidence class: r=0 coincides cols 0,1, r=1 cols 0,2, locus the
  generic cols 1,2; NO new gated retries were needed). `cycleReindexed`
  mirrors starReindexed (permuted beta -> unpermuted output, mu_U1 = user
  beta, permute argument last; uniform for all j incl. j=3 — no historical
   path to preserve). `cycleSlots(beta)`: derived from cycleSig — by the
   coherent assignment the CONSTANT [7,5,6]; also classifies EXTERIOR
   chambers (cycleIndex >= 0 there: their pair short sides are the three
   pairs avoiding the dominant leg, union = the other three legs). GLUE (user
   question "how does this glue when crossing chambers from star to cycle"):
   measured (cycle.mjs [G], 12 walls x 8 slider points x 2 sides, eps-nudged
   1e-3 in-chamber): BOTH sides solve clean everywhere near every wall
   (asserted). Under the ORIGINAL ascending sigs the fixed-slider off-wall
   shape jump was 0.25-0.58 of polygon scale on 8 of 12 walls (constant in
   eps, read as intrinsic); under the COHERENT sigs (see the COHERENT
   ATTACHMENT ASSIGNMENT paragraph below) it dropped to ~2.5e-3-2.9e-3 on
   ALL 12 walls — the charts' parameterizations now align in a full wall
   neighborhood, so the flop jump is NOT intrinsic. At the exact on-wall
   tuple both charts still select different branches (INFO; not
   user-visible). The y-side per-leg |y_i|^2 relative deltas between the
   charts persist (up to 1.0 — SL(2,C) view can still change on a flop).
   Accepted known issue. Regression-tested by the new dev/hyperpolygon/cycle.mjs
   battery (4558 checks, in run-validation.sh): [A] grid over the 4 cycle
   chambers (star.mjs's CYCLES tuples), [B] snap straightness incl. the
   r=1 1e-4 bar, [C] bitwise equivalence vs hand-unpermuted
   solveCore(...,CYCLE_ANSATZ), [C2] closed-form y cross-check 1e-12, [D]
   cycleIndex/cycleSlots classification + coherent [7,5,6] assertions
   (incl. the 4 exterior tuples), [D2] cross-wall coherence battery (24
   crossings: pair transfer, family flip, constant map, south straight
   pair), [E] (1/2,0) locus disk + band, [F]
   seeded fuzz, [S] scaled betas, [G] the glue measurement above; plus
   widget-load-path smoke (probeExteriorMap == cycleSlots for all 4 cycle
   tuples). sideview.mjs [P]/[E] and locus.mjs [C] were updated by the fix:
   sideview's expected map now consults starSlots then cycleSlots (the probe
   MEASURES the cycle rule correctly); locus.mjs [C]'s beta turned out to be
   a cycle chamber that previously STALLED at the locus — it now solves
   cleanly, so [C] is regime-aware (stall -> old bit-exact-offset-identity
   check; clean -> second-difference scaling check D2(2d) ~ 4 D2(d) that
   survives the even-in-r V-shaped invariants at the locus; the closure
   vertex vN[8] is EXCLUDED from the clean-regime D2 comparison — it is the
   rep's su(2) residual, not a polygon invariant, and at the coherent
   cycle-2 sig the theta=0 offsets r = 0.5 +- 2e-4 sit in the documented
   rescue-tier band (su2 ~ 6.6e-12, under every bar) where D2 of that noise
   is meaningless; its size stays bounded by the [A]/[B]/[E] residual bars).
  COHERENT ATTACHMENT ASSIGNMENT (2026-09-14, user request: "crossing a
  chamber can replace one short pair with its complement, and the
  associated intersection point should transfer to the complement while the
  other two pairs stay with their intersection points... we need to
  intentionally pick the first three columns of x in the solver ansatz to
  make this all coherent. Previous agents have claimed this isn't possible
  but I'm rather certain it is." — the user was RIGHT): the three
  pair-SPLITS map to the three exterior-sphere attachment points ONCE AND
  FOR ALL, identically in every chamber — south (0,0) <-> {0,3}|{1,2}
  (shortSubsets slot 7), equator (1/2,0) <-> {0,1}|{2,3} (slot 5), north
  (1,0) <-> {0,2}|{1,3} (slot 6) — so the attachment-slot map is the
  CONSTANT [7,5,6] and crossing any pair wall transfers exactly the crossed
  point's pair to its complement. Feasibility (why it IS possible): in the
  star chart the straight pairs at south/equator/north are
  {sig[0],j}/{sig[2],j}/{sig[1],j} and in the cycle chart
  {sig[0],sig[1]}/{sig[1],sig[2]}/{sig[0],sig[2]} — each chart's 3! choice
  of which user legs occupy the ansatz's first three columns (slots 0..2;
  slot 3 = the distinguished leg) realizes ANY bijection of the chamber's
  three short pairs to the three points (cycle: slot0 = S&N, slot1 = S&E,
  slot2 = E&N for desired south/equator/north pairs S/E/N). The earlier
  "others ascending" sig realized a DIFFERENT split->point map per chamber
  — that was the incoherence, not a structural obstruction. Anchored on the
  two chambers already fixed in the code (historical star-3 map and the
  user's ascending cycle-0 schedule, which already agree), the assignment
  is implemented by the exported partner-table helpers `starSig(j)` =
  [T3p(j), T2p(j), T1p(j), j] (T1/T2/T3 partner of leg k in k's side of the
  split; sig = [P3,P2,P1] tables [3,2,1,0]/[2,3,0,1]/[1,0,3,2] indexed by j)
  and `cycleSig(m)` = [S&N, S&E, E&N, m] over the T3/T1/T2 sides avoiding m
  — sigs per chamber: star [3,2,1,0]/[2,3,0,1]/[1,0,3,2]/[0,1,2,3] for
  j = 0..3, cycle [1,2,3,0]/[0,3,2,1]/[3,0,1,2]/[2,1,0,3] for m = 0..3;
  star-3 and cycle-0 are UNCHANGED (their paths stay bit-exact; validate.mjs
  legacy diffs unchanged). starReindexed/cycleReindexed/starSlots/cycleSlots
  all consume the shared helpers (one source of truth); exterior chambers
  (whose pair short sides are the three pairs avoiding the dominant leg)
  get the same analytic map through cycleSlots. GLUE CONSEQUENCE (cycle.mjs
  [G] re-measured): the coherent charts align the two parameterizations in
  a full neighborhood of every star<->cycle wall, not just at the snaps —
  the fixed-slider off-wall shape jump dropped from 0.25-0.58 of polygon
  scale (8 of 12 walls, old sigs) to ~2.5e-3-2.9e-3 on ALL 12 walls (each
  wall's straight-pair schedules now coincide at 2 of 3 snaps, differing
  only at the crossed wall's point). At the EXACT on-wall tuple both charts
  still solve clean but select different branches (vertexRel 0.18-0.58 at
  the sampled generic tuples) — not user-visible: drags lock the chamber
  and Cross Wall nudges off-wall. The y-side per-leg |y_i|^2 relative
  deltas between the charts persist (up to 1.0 — y rows carry the residual
  gauge-slice/parameterization difference; the SL(2,C) view can still
  change on a flop). Regression-tested by cycle.mjs [D2] (24 wall crossings
  over all 8 interior chamber tuples x 3 pair walls: crossed slot's pair ->
  complement, other slots unchanged, family flips star<->cycle, both maps
  == [7,5,6], the crossed chamber's displayed south straight pair == its
  new T3 short side, sphere deficits positive on both sides with the fixed
  side's imbalance flipping) and the [7,5,6] constancy assertions in
   star.mjs [D] / cycle.mjs [D] (incl. the 4 exterior tuples); sideview.mjs
   [P] widened to all 8 interior chambers (measured map [7,5,6] everywhere,
   worst mapped residual 2e-16, runner-up margin >= 1:3e15).
  I-STRATUM (2026-09-14, user task "when clicked, we should 'enter the I
  stratum'"; solver part): the stratum of a pair split {I | comp} = the
  balanced pairs whose x-columns are parallel WITHIN BOTH I and comp (the
  su(2) polygon is a closed walk on one line — a stick). Entered from the
  tip (antipode) of the exterior sphere carrying the short pair I. New
  export `stratumPair(t1, beta, I, permute = false)` (same return shape as
  makeHyperpolygon; null when I is not short): closed form, NO pipeline.
  Normal form: the side CONTAINING LEG 0 sits on e1 (cols (m,0), rows
  (0,±n)), the other on e2 (cols (0,m), rows (±n,0)) — read off the
  pipeline's t -> 1^- approach shapes at every attachment. With
  M0 = sum_comp beta, T1 = t1/(1-t1), M = M0 (1 + T1), the per-side
  magnitudes for the side's legs (p, q) are
    |x|^2 = (M + b_p - b_q)(M + b_p + b_q)/(2M)   (factored: fp-safe),
    m_i n_i = sqrt(G) SHARED: G = (M-sideSum)(M+sideSum)(M-b_p+b_q)
    (M+b_p-b_q)/(4M^2) evaluated once per side, n_i = sqrt(G)/m_i — this
    makes the mu_SL products cancel at roundoff and the comp-side rows
    EXACTLY zero at t1 = 0 (A = M - sideSum is an exact fp zero there).
  Identities: mu_U1 exact per leg; mu_SU2 exact (both sides carry
  |x|^2+|y|^2 = 2M); mu_C structural; mu_SL via the shared-G cancellation
  (the two products in a side have equal magnitudes and opposite signs —
  lower-index leg +n, higher-index leg -n). The dominant leg plays NO role:
  the stratum exists in EVERY chamber for every short pair. t1 = 0: the two
  comp rows vanish exactly (two nonzero rows = the I side); t1 > 0 lifts
  all four (M grows; |y|^2 monotone in t1). On the pair wall (M0 = sum_I)
  all rows vanish -> the y = 0 stick, matching the radius-0 sphere.
  CONTINUITY (battery [B]): the pipeline climb at an attachment converges
  to the t1 = 0 slice — to ~1e-5 relative at t = 0.99 for r = 0 (all
  chambers), the equator when the locus pair {2,3} is the I side, and
  interior chambers generally; BUT the crossover (all leg energies
  equalizing) arrives at T = t/(1-t) ~ 1e2..1e4 and the climb then DEPARTS
  the slice: earliest/grossest at the equator when {2,3} is the comp side
  (exterior chambers with dominant leg 2 or 3, and an interior cycle
  chamber), and ~2e-3 rows by t = 0.99 at r = 1 (the reff offset) in ALL
  chambers. Consequence: entering the stratum at t >= 0.9 is
  display-continuous to ~1e-3 except in those classes, where a visible
  jump at t >~ 0.95 is INTRINSIC (the pipeline's t -> infinity limit
  genuinely leaves the stratum; the slice is still the stratum boundary).
  PERMUTE_23 gating: stratumPair takes the solve-indexed (beta, I) plus
  the permute argument (widget maps I through PERM); battery [D] asserts
  mu_U1 = user beta + bit-identical x / |y|^2 (y SIGNS may differ — the
  unshown relative SL phase — and vertices to 1 ulp via the closure sum
  order). Battery: dev/hyperpolygon/stratum.mjs (1877 checks, in
  run-validation.sh): [A] residual/straightness/row grid over 8 chambers x
  3 pair slots x 6 t1 values, [B] approach comparison (bars encode the
  measured crossover classes above), [C] per-side product cancellation +
  row monotonicity, [D] permute pattern, [E] on-wall degeneracy, [F] perf
  (< 5 ms; closed form costs ~0 ms).

- `assets/js/hyperpolygon/orientation.js` — display-orientation servo,
  dependency-free ES module (read this before touching widget
  orientation). `makeOrientor()` returns `{ update(vertices, dt,
  flags) }` -> unit quaternion in three.js `[x, y, z, w]` order. Owns
  ONE displayed quaternion; the widget sets `polyGroup.quaternion` from
  it every frame (axes stay world-fixed). Pins the chord v0->v4 to the
  +y world axis (three.js up) via exponential-lag transport
  (T_DISPLAY = 0.04 s), plus an idle twist servo (T_SERVO = 0.5 s,
  capped 2.5 rad/s, engages after 250 ms without slider input) that
  removes the residual spin about the chord axis by parking displayed
  v1 toward +x in the xz-plane. When chordLen/scale < 1e-3 (slab
  {r≈0, t>~0.9}, where the raw chord direction carries no information)
  the orientation FREEZES with hysteresis (unfreeze at 1e-2); the
  deferred correction plays as a smooth catch-up swoosh. Why
  transport + servo and not a stateless rule: the chord direction
  sweeps the whole sphere (within 0.13° of ±y) and any fixed
  spin-reference vertex becomes parallel to the chord somewhere in the
  box (measured), so stateless canonical rules provably flip/spin on
   visited loci; the servo makes the converged twist a canonical
   function of the polygon (path-independence verified to 5e-9).
   SERVO_TWIST (2026-09-14, user request): `export const SERVO_TWIST` is
   the single true/false switch for the idle twist servo (gates update()
   step 6 only; the one-time twist canonicalization at initialization
   still runs with it off, the twist then just drifts with the solver
   data). orient.mjs skips its servo-dependent path-independence test
   [E] when the flag is false (the test is meaningless without the
   servo); all other tests hold under either setting.
- `assets/js/hyperpolygon/chambers.js` — stability-chamber geometry for
  the 4 parabolic weights, dependency-free ES module shared by the
  widget and the harness (walls.mjs imports it). The widget tracks ONE
  stability chamber, fixed at load to the chamber of the initial beta
  and recorded through its "short subsets" — the subsets I of
  {0,1,2,3} with sum_I beta < sum_complement beta: one short side per
  unordered split (trivial, 4 leg-vs-rest, 3 pair-vs-pair) in fixed
  slot order; exact ties pick the lexicographically smaller side.
  Exports `shortSubsets(beta)` (the 8-entry short-side list, which
  fully determines the chamber), `chamberInterval(i, beta, shorts)`
  (the CLOSED allowed interval for b_i with the other three held
  fixed: a short subset containing i gives the upper bound b_i <= R -
  2A, one not containing i gives the lower bound b_i >= 2A - R, A =
  its sum off the dragged leg, R = the other three; the tightest
  bounds are exactly the closed chamber slice = the betaInterval
  bracket [prev, next]; the 0 positivity wall keeps a hard
  WALL_MARGIN floor capped so the interval never empties; never
  returns lo > hi for an in-chamber beta — no pinch fallback needed),
  `breakingSubsets(beta, shorts, tol = 1e-9)` (the tracked
  inequalities currently AT equality — the widget's amber highlight
  and the hook for the future per-inequality "flop" action), and
  `applyBetaDrag(i, beta, v, shorts)` (applies one slider drag with
  the chamber LOCKED: clamps beta_i into chamberInterval — a wall may
  be touched, never crossed, so dragging can never change the chamber
  — mutates ONLY beta_i, returns true if the raw value was clamped;
  repeated calls with the same raw value are exact no-ops; R must be
  accumulated over the other three legs, NOT as total - beta[i],
  else the bounds re-associate with beta[i] and idempotency breaks by
  ~1e-16). The 0 positivity wall stays hard (WALL_MARGIN floor — leg
  0's x-column vanishes at beta_0 = 0 and the (C*)^4 root hits u = 0);
  chamber walls may be touched, and on-wall solves are healthy at
  moderate t (measured su2 ~7e-12) but degrade near t=0 (the wall
  degeneration, covered by the widget's "⚠ degraded" caption).
  Geometry utilities kept for the harness (no longer the widget's
  drag path): `betaWalls(i, beta)` (COMPLETE wall set on the b_i axis
  in [0,1]: leg-i-dominant (a+b+c), the 3 pair walls, and the 3
  other-leg-dominant walls (a-b-c, b-a-c, c-a-b) — those are negative
  unless that leg outweighs the remaining two, and omitting them was a
  latent bug the [H](e) bracket-agreement check caught in lopsided
  non-dominant tuples), `betaInterval(i, beta)` (margin-cleared open
  interval; `lo > hi` only in degenerate pinches, fall back to the
  midpoint of [prev, next]), `clampToChamber(beta)` (iterating clamp,
  sub-1e-11 moves count as converged for exact idempotency).
  Widget wiring: the beta state is the source of truth (defaults
  0.5, 0.5, 0.5, 0.25, unclamped); on each input event it calls
  applyBetaDrag(i, beta, v, chamberShorts), re-syncs all four
  sliders/readouts/red-zones (the allowed span runs exactly TO the
  wall) and re-solves. The red blocked zones render as a
  linear-gradient on the custom-styled track (`.hp-slider` injected
  stylesheet, CSS custom properties --hp-lo/--hp-hi = allowed span in
  %; r/theta/t sliders share the styling with defaults 0%/100%). The
  widget displays the 7 nontrivial chamber inequalities as boxes below
  the beta sliders (label "chamber (fixed):", one `hp-chamber-box` per
  shortSubsets slot 1..7 in order — the trivial "{} < {0,1,2,3}" slot is
  omitted, then e.g. "{0,3} < {1,2}", 0-indexed to match the β₀..β₃
  labels; a
  tooltip shows the live subset sums), and a box gets the amber
  `hp-breaking` class while its inequality sits exactly on a wall —
  and now hosts a small "Cross Wall" button while amber (the flop
  action, see below). CRITICAL widget detail:
  solveAndDraw's call pattern is gated on PERMUTE_23 (solver.js, see the
  Files entry — currently TRUE in the working tree, user-verified): with
  PERMUTE_23 = false it calls makeHyperpolygon(r, theta, t, beta, false)
  (beta unchanged, unpermuted solved representative); with
  PERMUTE_23 = true it calls makeHyperpolygon(r, theta, t,
  [b0, b1, b3, b2], true) — legs 2/3 PRE-SWAPPED so the permuted returned
  pair satisfies mu_U1 = beta for the user's beta even when beta2 != beta3
  (the two swaps cancel in the display, so displayed leg j is user leg j
  either way). The flag flip changes the displayed polygon's leg 2/3
  traversal order (chord v0->v4 and closure unchanged); sideview.js's
  probe follows the same flag. A
  try/catch + NaN check around the solve shows a warning caption and
  freezes the last geometry instead of drawing garbage.
  Widget additions (2026-09-12, tasks 1/2/4): (1) the four beta sliders
  live in a dedicated grid row whose column count (4/2/1) is picked by a
  ResizeObserver from the measured width (thresholds 700px/340px — a
  flex-wrap row with a 170px basis produced the forbidden 3+1 layout; an
   explicit column count can never orphan a slider). (2) "Scale β⃗ Down"/
   "Scale β⃗ Up" buttons below the beta row (SCALE_DOWN_MIN = 0.02, see
   the task list; REVISED 2026-09-13 per user feedback — SUBTLE factors:
   down multiplies all four betas by 0.8, up by min(1.25, 1/max(beta))
   with the largest weight pinned EXACTLY to 1 only when the factor was
   clamped (1/max <= 1.25); the old x0.25/up-to-x4 steps maxed weights
   out in one click); the whole state is
   re-synced from the scaled tuple (no clamping — chambers are
   scale-invariant); buttons disabled via syncScaleButtons() called from
  syncBetaSliders() so drags update them too. (3) Each amber chamber box
  carries a "Cross Wall" button: crossWall(k) replaces chamberShorts[k]
  by its complement (adjacent chamber across that wall) and nudges beta
  across the wall via nudgeAcross — grow the OLD short subset's legs by
  eps = 5% of max(beta) in total (SEQUENTIAL fill: the first leg with
  room takes the eps; uniform growth would slide along a coincident pair
  wall and keep it breaking), falling back to shrinking the complement
  legs (first leg first, floored at 0), with eps halving while the
  candidate leaves the new chamber (validated by chamberInterval
  containment for all four legs) and no nudge only in fully pinched
  corners. After the flop every chamber box is rebuilt from
   back. Crossing into a dominant chamber degrades small-t solves —
   accepted known issue (see task list #4).
- `assets/js/hyperpolygon/sideview.js` — moduli-space side view (task
  list #5, first increment 2026-09-13), dependency-free ES module; Node
  battery `dev/hyperpolygon/sideview.mjs`. Two layers: pure geometry +
  probe (Node-safe, imported by the harness) and a browser-only
  `makeSideView(host, opts)` three.js factory (returns null without
   global THREE). The portrait: a WHITE central 2-sphere whose size is
   the user's FORMULA (2026-09-13, replaces the old CENTRAL_RADIUS = 1
   placeholder, which is removed): z_max = min(|b0+b3|, |b1+b2|), z_min =
   max(|b3-b0|, |b2-b1|), area tau_central = (pi/2)*|z_max - z_min| (the
   ABSOLUTE value per the user's same-day correction — z_max - z_min is
   negative exactly when a leg is dominant and the area is the magnitude,
   so the central sphere persists in dominant chambers),
   `centralRadius(beta)` = sqrt(tau/(4 pi)) = sqrt(|z_max - z_min|/8)
   (0.25 at the default beta; 1e-9 radius floor for the exact-tie
   corners where z_max = z_min; insensitive to PERMUTE_23 because
   displayed leg j IS user
   leg j under either setting, so beta is never converted). The black dot
   sits at `spherePoint(r, theta, R)` (R now REQUIRED = centralRadius):
   r = 0 is the south pole (0,-R,0), r = 1 the north pole, theta = 0 the
   +x meridian, y = -cos(pi*r) (axis = three.js
  +y, matching the polygon view's chord pin). THREE exterior 2-spheres
  attach at (r,theta,t) = (0,0,0), (0.5,0,0), (1,0,0) — the r slider's
  snap points with theta = 0 — externally tangent: center = attachment +
   radius * outward normal. Which chamberShorts PAIR slot attaches where
is MEASURED at load by `probeExteriorMap` (3-6 widget-exact solves;
   edge-parallelism sine residuals; retry at theta = 1e-4 escapes the
   documented theta=0 stall basin): by the solver's COHERENT ATTACHMENT
   ASSIGNMENT (2026-09-14, solver.js starSig/cycleSig — see the solver.js
   Files entry) the map is the split->point bijection FIXED ACROSS ALL
   CHAMBERS, [7, 5, 6] = south/equator/north under the current
   PERMUTE_23 = false (unpermuted representative: south carries the
   chamber's short side of split {0,3}|{1,2}, equator of {0,1}|{2,3},
   north of {0,2}|{1,3}), so crossing a pair wall transfers only the
   crossed point's pair to its complement ([6,5,7] under the permuted
   pattern), each attachment carrying THAT chamber's short side (measured
   over 12 betas / all 8 interior chambers, worst residual 2e-16,
   runner-up margin >= 1:3e15; the widget fills any
   null probe entry from the analytic starSlots/cycleSlots rule so all
   three spheres exist).
   NOTE (measured, matches walls.mjs [E]): under either PERMUTE_23
   setting the displayed polygon leg j IS user
   leg j — no PERM conversion anywhere (PERM = [0,1,3,2] is exported only
as documentation of the permuted pattern's canceling double swap).
   Exterior sphere size from the
   user's formula: surface area = (pi/2)(sum_comp - sum_I) for I = the
  mapped pair short => `pairRadius` = sqrt(D/8); sizes update live with
   beta (scale buttons shrink/grow the bubbles); D -> 0 on a pair wall
   shrinks a sphere away (radius floor 1e-9). Sphere appearance
   (2026-09-13 revision): unhighlighted = transparent (opacity 0.16, soft
   blue-gray palette tint); highlighted = WHITE with ~80 ms exponential
   lag when flowState's exterior branch owns that attachment (sitting
   exactly ON the attachment at t = 0 already highlights — branch
   selection only checks r/theta, not t) — white is now opacity 0.92, NOT
   1, so a black dot hidden on a sphere's backside stays faintly visible;
   and while the dot CLIMBS an exterior sphere (exterior branch with
   t > 0) the CENTRAL sphere turns grey/transparent (color -> 0xb0b0b0,
   opacity 0.92 -> 0.3, same ~80 ms lag; centralGrey animation) — at
   t = 0 the central sphere stays white (the dot merely touches the
   exterior sphere there). BUG FIXED 2026-09-13 (user report "spheres
   still not highlighted"): the glow compared against
   lastState.exterior.slot, which is ALWAYS undefined — the branch slot
   lives at the TOP level of the flow state (lastState.slot); the
   exterior frame object carries only center/radius/normal/side/
   attachment. The bubbles had never highlighted since the first
   increment. All sphere materials are transparent with
   depthWrite off, so the opaque dot always shows through the blend.
   Central-sphere size follows beta via centralRadius in update(); the
   side-view camera (0.85, 0.5, 1.0, near 0.05) and dot radius (0.015)
   were re-framed for the formula radius (~0.25 at default beta, 4x
   smaller than the old placeholder 1). Flow model (`flowState`, pure):
   exterior
  branch iff (r, theta) sits on an attachment (poles accept ANY theta —
  theta is degenerate on the sphere there; equator needs theta ~ 0; tol
  1e-9 on the post-snap slider values): dot = center + rk*(-cos(a)n +
  sin(a)w), climb angle a = pi*t, side w = yHat made tangent (fallback
  +x at the poles) — the dot rides the attachment-to-antipode arc
  (canonical meridian; the future level-circle slider will rotate it).
  Central branch: the dot climbs the paraboloid z_local = rho^2/(2f)
  KISSING the sphere at the dot's (r,theta) point, apex there, axis =
   outward normal, opening outward/upward; phi(t) = atan(0.5 t/(1-t))
   capped at 80 deg (constants PHI_K/PHI_CAP — the monotone t->arc map is
   a schematic choice, user-tunable; PARAB_FOCAL 0.6 -> 0.3 -> 0.1 on
   user request 2026-09-13 ("too wide", then "even thinner"), cutting the
   drawn paraboloid radius rhoMax = PARAB_FOCAL*tan(PHI_CAP) each time);
   guide arc =
  the +u meridian (u = yHat made tangent). Paraboloid visibility is the
  WIDGET's decision: hovering the t slider OR t > 0 (spec item 3); the
  exterior branch hides it (spec item 4). Branch CROSSING at the snap
  boundary is a visible jump (exterior meridian vs paraboloid arc
  differ) — accepted for this increment. Widget wiring: sideBox (320 px,
  own OrbitControls + render loop) below the main canvas;
  `refreshSide()` runs in the loop's pending block (same cadence as
  solveAndDraw) and on t hover/focus; the side view uses the RAW t (1
  allowed — the dot renders the t->infinity limit while the solve keeps
    T_SOLVE_MAX); the "lim t->infty" button (spec item 5) lives in the
   t-slider box and appears iff flowState.nearInfinity (exterior branch,
   t >= T_NEAR_INF = 0.9) — click is a PLACEHOLDER (caption note),
    behavior pending user spec. Battery: `sideview.mjs` [P] probe rule
    (the coherent CONSTANT [7,5,6] map measured in all 8 interior chambers
    over 12 betas — [6,5,7] under the permuted pattern —, strictly
    in-chamber tuples), [S] sizes
    (pair + the new central formula incl. the dominant clamp), [F]
    paraboloid constraint + t=0 continuity, [E] exterior-sphere
    constraints (|dot-center| = rk exactly, endpoints attachment/antipode),
    [N] NaN/degeneracy safety, [I] purity — 3448 checks, ~1.8 s; added to
   run-validation.sh (copies sideview.js like the other modules).
   GAMMA / LEVEL CIRCLES (2026-09-14, task 3 — the "future level-circle
   slider" is this): `flowState` and the factory's `update()` take an
   optional trailing `gamma` (default 0, non-finite treated as 0): the
   U(1) phase e^{i·gamma} on y rotates the dot along the LEVEL CIRCLES —
   on the exterior branch the side direction w is rotated about the
   sphere axis n (w -> cos·w + sin·(n×w)), on the central branch the
   guide meridian u (and v = n×u with it) about the apex normal; the
   attachment/antipode and the paraboloid apex stay fixed automatically
   (they lie ON the rotation axes), so t = 0 points are fixed, matching
   the moduli picture. gamma = 0 is a bit-exact no-op (guarded, so all
   pre-gamma battery assertions are unchanged). The drawn paraboloid is
   a surface of revolution about its own axis, so its point set is
   gamma-invariant — only the dot + guide arc rotate. Battery [G] added
   (level-circle invariants: |dot-center| = rk, polar height and
   paraboloid rho invariant under gamma, 2pi-periodicity, orthonormal
   rotated frames, gamma=0 bit-exactness); sideview.mjs now 4367 checks.
  STRATUM BRANCH + LIGHT MODE (2026-09-14, user tasks 1/3, user-verified
  2026-09-15: "Looks good"): flowState
  gained a trailing `stratum` argument (null | {k, t1}): when non-null and
  the (r, theta) sliders sit ON attachment k (the widget parks them there
  in stratum mode), the STRATUM branch is returned (kind "stratum"): the
  dot rides the stratum paraboloid kissing the sphere's tip
  (apex = attachment + 2 rk n, axis n; phi(t1) = atan(PHI_K_STRAT·t1/(1-t1))
  capped PHI_CAP_STRAT = 55 deg;
  meridian u = -w so the flow continues the climb's arrival direction).
  The exterior branch ALSO carries the frame (field `stratum`) for the
  ghost. Highlight semantics (the loop): the stratum mesh is INVISIBLE
  until t >= T_PEEK_LO = 0.9, fades to the ghost (STRAT_GHOST_OPACITY
  0.16) over [T_PEEK_LO, T_PEEK_HI = 0.97], and turns highlight-white
  (opacity 0.92, ~80 ms lag) once the stratum branch is active; the
  exterior sphere stays white and the central sphere stays grey in stratum
  mode. LIGHT MODE (task 3): the sphere colors are palette-driven —
  new palette keys `sphereGrey` (central sphere while climbing, default
  0xb0b0b0) and `extHi` (highlighted exterior sphere / stratum, default
  0xffffff); widget.js's light palette now sets sphere 0xcdd7e2,
  sphereGrey 0x93a5b8, extHi 0x8fa3ba (dark mode keeps white), so nothing
  renders invisible-on-white. Battery: sideview.mjs [STR] (frame
  orthonormality, apex/2rk identity, dot-on-paraboloid + z = rho^2/2f,
  t1=0 dot == apex exactly, gamma level-circle invariants + 2pi
  periodicity, central branch carries stratum = null).
  STRATUM FOCAL + GREY/WHITE PARABOLOIDS (2026-09-15, UI task 3): the
  stratum paraboloid's focal length is now PARAB_FOCAL — the SAME focal
  length as the central-sphere paraboloids (was STRATUM_FOCAL_REL·rk;
  the STRATUM_FOCAL_REL constant is REMOVED) — with the cap still
  PHI_CAP_STRAT = 55 deg, so each stratum is a LONGER but still clearly
  NARROWER paraboloid than the central ones (drawn radius
  f·tan(55 deg) = 0.143 vs f·tan(80 deg) = 0.567; ~16x the old length at
  the default beta). BOTH paraboloid meshes are now grey/white instead of
  blue (palette keys sphereGrey -> sphere, lerped with an ~80 ms lag):
  the central paraboloid turns white once the dot has started climbing it
  (t > 0; ramp `paraClimb`), the stratum mesh lerps grey->white with
  stratGlow; the `parab` palette key is gone (widget palettes updated).
  Battery [STR]'s focal assertion updated (f === PARAB_FOCAL).
  CAPTURE BLEND (2026-09-15, UI task 5 — "the transitions into the
  exterior spheres need the same treatment" as the interior chambers):
  flowState's central branch now CARRIES a capture — within the capture
  band of a mapped attachment k (poles measure |r - att| against
  CAP_BAND_R = 0.1, theta degenerate there; the equator measures
  max(|r - 0.5|/CAP_BAND_R, |theta|/CAP_BAND_TH) with CAP_BAND_TH = 0.3)
  it returns `capture` = { k, S, w, attachment } and blends the dot AND
  the guide arc pointwise from the central paraboloid climb onto that
  sphere's meridian with smoothstep weight w (0 at the band edge, -> 1 at
  the attachment, where the exact exterior branch takes over) — entering
  an exterior sphere is a smooth glide instead of a branch jump. The
  exterior climb is SHIFTED to start at the current (r, theta) sphere
  point (shift = p - p_attachment), so at t = 0 the captured dot is
  EXACTLY the slider marker (fp <= 2 ulp; battery-asserted) and the
  capture never displaces the t = 0 portrait. The bands are tuned to the
  widget's snaps (r snaps to 0.5 within +-0.02, theta to 0 within ~0.094
  rad), so the pre-snap state is already mostly captured. The captured
  state also carries the sphere's stratum frame (ghost scales by w) and
  nearInfinity = (w >= CAP_NEAR_INF_W = 0.5 && t >= T_NEAR_INF), which is
  what shows the lim t->infinity button slightly off the attachment;
  the widget's attachmentIndexOfDot prefers the measured capture. At most
  one attachment can be in band. All battery-exact branches (exterior,
  stratum, uncaptured central) are bit-identical to before (attachFrame
  is a pure refactor); sideview.mjs gained the [C] capture battery
  (continuity across the branch switch <= 1e-6, adjacent-slider-state dot
  delta <= 0.25, band-edge weight ~0, t=0 marker exactness, nearInfinity
  rule) — sideview.mjs is now 5810 checks.
  CAMERA PAN (2026-09-15, UI task 6): the side view's camera target
  glides (both controls.target and camera.position move by the same
  exponential delta, tau 0.3 s — a pan, orbit orientation preserved) to
  center what is highlighted: the resting target is the origin; an
  exterior sphere's glow (branch slot OR capture weight) centers its
  attachment point (its intersection with the central sphere); the
  stratum branch centers the tip (lerp attachment -> tip by the smoothed
  stratGlow); leaving reverses through the same smoothed weights
  (stratum -> attachment -> origin).
- `assets/js/hyperpolygon/widget.js` — display-layer additions
  (2026-09-14, tasks 1/2/3, user-approved same day: "Most of that looks
  good"). NO solver changes
  (the U(1) y-phase fixes the su(2) polygon exactly because
  hyperpolygonVertices only uses y†y — verified in Node to 2.5e-16):
  (1) EDGE LABELS + SHORT-PAIR LIST + YELLOW PARALLELISM: the four
  displayed legs' v-sides are labeled with canvas-texture sprites
  ("v₀" ... "v₃" — CORRECTED 2026-09-14 per the user: the labels name the
  four leg VECTORS v0..v3, NOT the vertices; the original v0..v4
  vertex naming was wrong; the odd bend points ("the w's") unlabeled;
  in the 9-point solver array leg j runs pts[2j] -> pts[2j+2], label
  placed at that midpoint pushed away
  from the polygon centroid, sprite scale ∝ polygon scale, textures
  redrawn on theme change). A top-right overlay list (`.hp-pair-list`,
  pointer-events none) shows the chamber's three short pairs, one row
  per exterior sphere: "r=0: v₀ ∥ v₃" (attachment tag from
  attachmentRs; pair = chamberShorts[extMap[k]], rebuilt at load and
  after every Cross Wall). Per solve, the widget computes the sine of
  the angle between every pair of v-side directions (threshold 1e-3 =
  sideview's PARALLEL_TOL; zero-length edges read Infinity): ENTERING
  parallelism fires ONE yellow blink (a sin(π·phase) pulse over 0.9 s,
  played per-frame by updateEdgeColors on the segment color buffer), and
  WHILE a pair is parallel both its v-side segments hold solid yellow
  (palette edgeYellow; only the v-sides color, never the w-sides) and
  the matching list row gets hp-straight. At the snaps exactly the
  extMap pair is parallel (Node-verified: straight sine <= 1e-5 — the
  r=1 documented 1-reff artifact stays far under threshold — runner-up
  >= 0.2, generic points min sine 0.59), so the list indexes the
   spheres. crossWall now re-runs fillExtMap() (probe + analytic + spare
   fill, factored from load) because the crossed chamber's short pairs
   change (the attachment POINTS do not — the map is the constant [7,5,6]
   per the coherent assignment), then rebuilds the list. (2) SL(2,C) VIEW (task 2):
  a collapsed `<details>` ("show SL(2,ℂ) polygons") between the side
  view and the controls row holding two 300px canvases ("Re μₛₗ" /
  "Im μₛₗ"), each with own renderer/camera/OrbitControls, rendered ONLY
  while open (piggybacks the widget's rAF loop). Data: the last solve's
  res.sl2 (5 points: 4 leg edges + the closing v4->v0 segment; mu_C = 0
  makes v4 the origin, so the quadrilateral closes). Edges colored by
  leg (edgeA/edgeB alternating, closing segment gray), 5 vertex markers,
  fixed axes hint. At t = 0 in interior chambers y = 0 so BOTH views
  degenerate to the origin — correct (the SL part vanishes on the
  central sphere), not a bug. (3) GAMMA SLIDER (task 3): under t, same
  normalized shape as theta (s ∈ [-1,1] step 0.005, γ = s·π, snap to 0
  tol 0.03, readout "-π"/"π"/radians). `makeSlider` gained a noSolve
  flag (gamma must NEVER trigger a solver run — rescue paths cost
  30-115 ms; gamma input instead calls updateSlViews() + refreshSide()
  directly). updateSlViews rotates the sl2 base data coordinatewise
  (real' = cos·real − sin·imag, imag' = sin·real + cos·imag — exact
  e^{iγ} action, gamma = 0 bit-exact via cos(0)=1/sin(0)=0; Node-verified
  against sl2Vertices on the phased y to 1.6e-16). The su(2) polygon,
  markers and caption are untouched by gamma.
  STRATUM MODE + PANEL + LIGHT PALETTE (2026-09-14, user tasks 1/2/3,
  user-verified 2026-09-15: "Looks good"): (1) the "lim t→∞" button is now LIVE
  (task list #5's last item): clicking it on an exterior sphere with
  t >= T_NEAR_INF enters the I-stratum of that sphere's short pair
  (stratum state {k, S, I, comp}; attachment found by re-scanning the
  parked sliders): the r/θ/t sliders are DISABLED and parked (t set to
  exactly 1 = "t→∞"; the pre-entry t is restored on exit), the hidden
  t1 slider appears (t₁ ∈ [0,1], readout t1/(1-t1), "t₁→∞" at 1, gentle
  snap to 0), the solve switches to stratumPair(t1c <= T1_SOLVE_MAX =
  0.99, betaSolve, ISolve, PERMUTE_23) with ISolve = I.map(PERM) under
  the flag (dormant while PERMUTE_23 = false), the button becomes
  "leave stratum" (click again = leave: t1 -> 0, t restored, sliders
  re-enabled), Cross Wall leaves the stratum first, and the caption
  gains " · I-stratum {a,b} ∥ {c,d} · t₁ = ...". The polygon in stratum
   mode is the doubly-straight stick; the yellow-edge + pair-list logic
   lights BOTH pairs automatically. (2) the beta controls (betaHeader,
   betaRow, scaleRow, chamberRow) moved into a bordered `.hp-panel` box
   ("the chamber stuff in a panel", task 2). (3) light-mode side-view
   palette (task 3): PALETTES gained sphere/sphereGrey/extHi keys (see
   the sideview.js entry).
  TWO-COLUMN LAYOUT + t-STRATUM + THICK EDGES (2026-09-15, user tasks
  1/2/4 of the six-task UI call; pending user visual check). (1) LAYOUT:
  the widget is a flex two-column row — LEFT: the polygon canvas (with
  the pair list overlay), the caption, a "Moduli Coordinates" panel
  holding the four moduli sliders in two rows ((r, theta) then (t, phi)),
  and the SL(2,C) details; RIGHT: the moduli-space side view (420 px)
  above a collapsible <details> tab labelled "Parameters" (open by
  default) containing the beta/chamber panel. The gamma slider is renamed
  phi ("φ", same shape/step/snaps/noSolve — only the label/title/var name
  changed; updateSlViews/refreshSide read phiInput). (2) t-STRATUM: the
  t₁ slider is REMOVED — the t slider parameterizes the stratum while
  stratum mode is active: entering (lim t→∞ click) jumps t to 0 (the tip
  slice) and parks/disables r/θ at the attachment (r parked to the exact
  attachment value and restored on exit; at the equator theta is also
  parked to 0 and restored, since the stratum branch gate needs the exact
  point; the button can now fire from inside the capture band via
  attachmentIndexOfDot's measured-capture preference, so the parking is
  not a no-op), leaving jumps t to 1 (= infinity; readout "∞" instead of
  the old "t→∞" text — the button says it). The solve clamp is the shared
  T_SOLVE_MAX = 0.99 (T1_SOLVE_MAX is gone). The lim button lives BELOW
  the t slider (the t slider row is wrapped in a flex column tCol with
  the button under it) instead of to the right. Caption's "· t₁ = ..."
  part dropped (the I-stratum tag remains). (3) THICK EDGES: the polygon
  edges are 8 unit-cylinder meshes (WebGL ignores LineBasicMaterial
  linewidth), scaled/oriented per solve by setSegment with radius
  EDGE_RADIUS_REL = 0.007 * polygon scale, colored per segment from
  segBase (applyColors) with the yellow straight/blink overrides applied
  per frame in updateEdgeColors (material colors, no color buffer); the
  SL(2,C) views keep thin lines. No solver changes — full suite green:
  sweep unchanged, walls/edge/locus/exterior/stratum/star/cycle/orient/
  validate PASS unchanged, sideview PASS 5810 checks (see the sideview.js
  entry for the [C] capture battery and the camera pan).
- `mathematica/` — reference notebooks and legacy data. Excluded from
  the Jekyll build; `mathematica/hyperpolygonData*` is gitignored
  (137 MB file, over GitHub's limit). `generateHyperpolygonData.wls`
  is an abandoned draft — do not debug it unless asked.
- `dev/hyperpolygon/` — Node validation harness:
  - `run-validation.sh` — copies the live solver + orientation.js +
    chambers.js in and runs everything
  - `sweep.mjs` — randomized robustness (200 pts x 3 beta sets)
  - `edge.mjs` — endpoint battery (222 checks, exit 1 on failure):
    [A] endpoint grid r in {0,1} x theta {0,±π/2,±π} x t {0.1,0.5,0.99}
    for BOTH call patterns (widget-exact swapped + unswapped): closure,
    su2, muU1 < 1e-9 and muC < 1e-6 (the r=1 muC ~1e-5 artifact is
    gone); [B] the formerly broken bands r ~ 1e-12..1e-6 and
    0.99999..0.999999; [C] t=0 corners (y-side retries are no-ops
    there); [D] gauge-invariant continuity of the endpoint polygon
    against the r→0+/1- trends (vertex norms and per-leg |y|^2;
    asserted at t <= 0.5 — near t~0.99 the r-slope of the invariants is
    unbounded so a linear-trend check is invalid there, those endpoints
    are covered by the residual bars); [E] the r=1 theta loop;
    [F] 120-solve seeded band fuzz.
  - `walls.mjs` — chamber-wall battery: near-wall conditioning profile
    (asserts healthy >= WALL_MARGIN from any wall), t=0 in-chamber
    checks, clampToChamber fuzz (incl. on-wall starts + idempotency),
    chamber-walk integration solves, widget permute-call-pattern check
    (swapped beta + permute=true must satisfy mu_U1 = user beta),
    defaults sanity incl. the expected short-subset list
    [[],[0],[1],[2],[3],[2,3],[1,3],[0,3]] + locked-interval checks,
    drag-event battery [G] (applyBetaDrag per event with the chamber
    LOCKED: only the dragged leg moves, bit-exact; the tracked chamber
    never changes; in-span raws pass through bit-exactly, out-of-span
    raws pin exactly at a bound; re-apply is an exact no-op;
    breakingSubsets nonempty iff the tuple is on-wall), the
    focused chamber-lock battery [H] (exact wall pins at both ends of
    slider 0, cross-drag slide-along along a wall, wall-contact
    release, 0-wall floor, chamberInterval vs the betaInterval
    bracket on 160 non-dominant (slider, beta) pairs, 60 fuzz walks x
    40 events with end-of-walk solves; pinned finals are relaxed to
    su2 <= 0.05 with best-of-3 draws — the theta=0 stall basin at
    isolated draws), the scale-button battery [S] (down-clicks bit-exact
    x0.25, chamber held, on-wall state unchanged, healthy allowed spans
    at the deepest reachable tuple — exactly 2 clicks from the defaults
    before the 0.02 floor; up-clamp lands max exactly 1 incl. a
    non-power-of-two tuple; grey-out rule spot checks; scaled-tuple
    solves clean to f=1e-6), and the cross-wall battery [W] (flop flips
    exactly one slot to its sorted complement; the coincident-wall pair
    at b0=0.25 releases both inequalities after the sequential-fill
    nudge; post-cross drags clamp into the NEW chamber with exact
    wall pins and no-ops; cross-back restores the chamber;
    dominant-chamber crossing keeps moderate-t solves clean with
    best-of-3 theta draws; the beta0-at-1 no-room case shrinks the
    complement instead). Exits 1 on failure.
  - `orient.mjs` — orientation battery (6 tests, 39 slider paths,
    ~9.5k solves, ~13 s): chord pinning, drag continuity vs a
    Kabsch-optimal shape baseline + exact-pinning reference, one-step
    jump smoothness, static stability, servo path-independence,
    quaternion sanity. Exits 1 on failure. Test [E] is skipped (reported
    pass with a note) when orientation.js's SERVO_TWIST is false — the
    converged twist is path-dependent by design without the servo.
  - `star.mjs` — star-reindexing battery (1391 checks, exit 1 on failure):
    [A] (r,theta,t) grid over the 4 star chambers, residuals vs the USER
    beta + closure (su2/muU1/closure < 1e-9, muC < 1e-6), [B] straight-pair
    parallelism at (0,0)/(1/2,0)/(1,0) — correct pair {sig[0],j}/{sig[2],j}/
    {sig[1],j} parallel (1e-8; 1e-4 at r=1 for the documented reff offset),
    the other two j-pairs not (1e-3), [C] bitwise equivalence with the
    manual permuted call (beta o starSig(j) + hand unpermute), [D] starIndex
    classification + coherent starSlots == [7,5,6] (incl. -1 on the four
    cycle tuples), [E] cycle tuples
    at full [A] bars (raised 2026-09-14 when the cycle path landed).
  - `cycle.mjs` — cycle-chamber battery (4558 checks, exit 1 on failure):
    [A] grid over the 4 cycle chambers, [B] snap straightness {s0,s1}/
    {s1,s2}/{s0,s2}, [C] bitwise equivalence vs hand-unpermuted
    solveCore(...,CYCLE_ANSATZ), [C2] closed-form y cross-check, [D]
    cycleIndex/cycleSlots classification + coherent [7,5,6] (incl. the 4
    exterior tuples), [D2] cross-wall coherence (24 crossings: crossed
    slot's pair -> complement, others unchanged, family flip, constant map,
    crossed chamber's south straight pair == its new T3 short side, sphere
    deficits positive on both sides), [E] (1/2,0) locus disk + band,
    [F] seeded fuzz, [S] scaled betas, [G] star<->cycle wall-crossing glue
    measurement (both sides clean asserted; jump sizes INFO; see the
    solver.js CYCLE REINDEXING entry), plus widget-load-path smoke
    (probeExteriorMap == cycleSlots for all 4 cycle tuples).
  - `stratum.mjs` — I-stratum battery (1877 checks, exit 1 on failure):
    [A] residual/straightness/row-structure grid over 8 chambers x the 3
    pair slots x 6 t1 values (su2/muU1/muC/closure/mu_SL < 1e-9, both
    pairs' columns parallel < 1e-12, comp rows ~0 at t1 = 0, all four
    rows nonzero at t1 = 0.5), [B] the t1 = 0 slice vs the pipeline
    approach shape at the three attachments (bars encode the measured
    crossover classes — see the solver.js I-STRATUM entry), [C] per-side
    product cancellation + comp-row monotonicity in t1, [D] the
    PERMUTE_23 call pattern, [E] on-wall degeneracy, [F] perf.
  - `validate.mjs` — spot-checks vs `mathematica/hyperpolygonDataPolar`
    (only works where that 137 MB file exists)

## Validation expectations

- `sweep.mjs`: worst su(2) residual ~1e-11, worst mu_U1 <= 1e-9,
  mu_C ~1e-15, slowest solve a few ms, stable path never needed.
- `edge.mjs`: PASS (222 checks); endpoint grid closures/su2/muU1 all
  < 1e-9 and muC < 1e-6 at r in {0,1}; the formerly broken bands
  (r ~ 1e-12..1e-6, 0.99999..0.999999) solve clean; continuity trend
  errors ~1e-4 of polygon scale at t <= 0.5.
- `walls.mjs`: ~0.4 s runtime; [A2]/[B]/[B2]/[C]/[D]/[E]/[F]/[G]/[H]/
  [S]/[W] all pass; near-wall profile shows no distance-dependence at
  moderate t (walls matter through chamber confinement, not local
  conditioning); [B2] worst t=0 residual ~1e-11 incl. the rescued repro
  point; [C] 3500/3500 idempotent, off-wall, in (0,1]; [G]/[H]
  chamber-locked drags hold every invariant (min chamber slack >=
  -1e-15, idempotent, chamber never changes) and on-wall finals solve
   to ~1e-11 at moderate t; [S] 14 down-clicks from the defaults (x0.8
   steps) with spans >= 2*WALL_MARGIN at the floor, up-walk of exactly 4
   clicks to max 1 (x1.25 steps, pin on the clamped factor); [W] post-cross solves clean
   with best-of-3 theta draws.
- `orient.mjs`: 6/6 PASS; typical worst values: pinning ~1e-8 (limit
  2e-3), continuity/jump-smoothness excess over the pinning-aware bound
  0 (raw solver motion dominates near t=0.99 — the battery reports the
  literal-ceiling excess separately), static drift 0, path-independence
  ~5e-9 (limit 5e-3).
- `validate.mjs`: gauge-invariant diffs ~1e-9 where the legacy data was
  accurate; ~1e-4 differences are expected where the legacy data sat at
  its own solver tolerance (notably `r=1, t~0.5`, where the legacy file
  itself has su2 residual 7.3e-4).
- Browser perf budget: one solve must stay well under 10 ms so sliders
  can re-solve on every input event (orientor.update is O(9) and
  negligible next to the solve).

## Task list (2026-09-12 planning call)

Tracked work items from the user's planning call; keep statuses updated.

1. DONE (2026-09-12, user-verified 2026-09-13): beta slider
   layout: the four beta sliders lay out 4-per-row, 2-per-row, or
   one-per-row depending on container width — NEVER 3+1 (the pre-fix
   flex-wrap with 170px basis produced 3+1 at some widths). Widget-side
   fix: a dedicated beta-slider grid row whose column count (4/2/1) is
   picked by a ResizeObserver on its measured width (thresholds
   700px/340px).
2. DONE (2026-09-12, user-verified 2026-09-13; REVISED 2026-09-13 per
   user feedback — "only subtle changes"): scale buttons
   "Scale β⃗ Down" / "Scale β⃗ Up" below the beta sliders. Down
   multiplies all four betas by 0.8; Up multiplies by
   min(1.25, 1/max(beta)) and pins the largest weight EXACTLY to 1.0
   only when the factor was clamped (1/max <= 1.25; x*(1/x) can land
   1 ulp off). The original x0.25 / up-to-x4 steps maxed weights out in
   one click — that was the bug report. Scale Up is greyed out once
   max(beta) >= 1-1e-12; Scale Down is greyed out when scaling would
   push max(beta) below 0.02 — the floor exists
   because chamberInterval's hard WALL_MARGIN = 0.003 0-wall floor
   collapses the displayed allowed spans once the tuple scale
   approaches ~2*WALL_MARGIN (at the floor the spans are still >=
   2*WALL_MARGIN; exactly 14 down-clicks from the defaults at x0.8,
   exactly 4 up-clicks to max 1). The button labels render vec-beta via
   a CSS overarrow (.hp-vec, a ::after "→" above a β span) — the
   combining codepoint U+03B2+U+20D7 displayed badly, the other bug
   report. Chambers
   are scale-invariant (the inequalities are homogeneous), so uniform
   scaling never leaves the tracked chamber — asserted by the walls.mjs
   [S] battery. Solver accuracy is NOT the limiter: measured su2 ~1e-12
   for uniformly scaled betas down to f = 1e-9.
3. DONE (2026-09-12, user-verified 2026-09-13): r=0 / r=1
   endpoint jumps: at exactly r=0 (with the widget's swapped-beta
   solve) the su(2) balancing stalled at su2 ~ 2.5e-1 and the closure
   marker jumped to ~0.25, and r=1 stalled at ~1.5e-2 — while
   r=0.005/0.995 solve to ~1e-12, so the slider endpoints jumped.
   Diagnosis + fix recorded in the solver.js entry: (a) total
   cancellation in fixMuU1's u root for tiny d = |y_leg|^2, fixed by the
   cancellation-free root u = c/(beta + sqrt(beta^2 + c*d)); (b) r=0 is
   an orbit degeneration (FLAT 0.25 residual plateau, not a basin), so
   the endpoint display is evaluated at a consistent offset point
   (x0 AND y0 at reffAlt ~1e-9/1e-6); (c) r=1's reff = 1-1e-5 sits in a
   stall band and the residual is a line-search pathology — fixed by
   Euclidean-norm Newton retries plus reff-adaptive retries
   (1e-6/1e-8), all gated on su2 > 1e-6 so healthy solves keep the
   identical historical path; the documented mu_C ~1e-5 r=1 artifact is
   gone (<= 1.4e-17 across the endpoint grid). Regression battery: the
   rewritten edge.mjs (222 checks).
4. DONE (2026-09-12, user-verified 2026-09-13): Cross Wall
   button: while a chamber box is amber (its inequality exactly on a
   wall), a clickable "Cross Wall" button appears in that box. Clicking
   flops that split — chamberShorts[k] is replaced by its complement —
   and nudges beta across the wall into the new chamber (eps = 5% of
   max(beta), SEQUENTIAL fill over the old short subset's legs —
   uniform growth would slide along a coincident pair wall and keep it
   breaking — clamped to the [0,1] slider bounds; falls back to
   shrinking the complement legs when the short side has no room, e.g.
   beta0 at 1; eps halves while the candidate leaves the new chamber;
   no nudge only in fully pinched corners). Subsequent drags clamp into
   the NEW chamber; dragging back to the wall re-highlights it and
   allows crossing back. KNOWN ISSUE, deliberately left per user
   instruction (2026-09-12): crossing an "odd" wall like {0} < {1,2,3}
   lands in a dominant chamber, where the balanced representative
   degenerates for small t (su2 up to ~0.4 at t <~ 0.01) — the t = 0
   part of this was ADDRESSED 2026-09-13 by the solver's exterior
   branch (see the solver.js Files entry; at t = 0 the exterior branch
   now returns the exact minimum-energy stick, wall inclusive, so the
   post-flop display is clean); at t > 0 the historical pipeline
   converges across exterior chambers (0/160 seeded fuzz failures) and
   only the (1/2, 0) locus stalls (su2 ~ 0.7 at every t) — the ⚠
   degraded caption covers that locus.
 5. IN PROGRESS (started 2026-09-13 without waiting, per the user's
    detailed spec message): moduli-space side view — a second display
    showing the global (r, θ, t) portrait of the hyperpolygon moduli:
    the "core" of hyperpolygon space, a central 2-sphere with three
    exterior 2-spheres attached, and a way to "flow" upward from the
    central sphere or up along an exterior sphere (the upward/Higgs-flow
    directions of the hyperkähler isometry torus). FIRST INCREMENT DONE
    (2026-09-13, user-verified same day: "It looks perfect!"): items
    (1)-(5) of the
    user's spec are implemented — central sphere + t=0 dot at (r,theta);
    three exterior spheres at (0,0), (0.5,0), (1,0) (t=0) with
    transparency/highlight and the beta-dependent area formula
    (pi/2)(sum_comp - sum_I); hover-t paraboloid + t-driven central-branch
    arc; exterior-branch climb toward the antipode as t -> infinity; the
    lim t→∞ button appears near t >= 0.9 on an exterior sphere (click
    PLACEHOLDER). SECOND INCREMENT DONE (2026-09-13, same-day user
    message): the user's central-area FORMULA is in (centralArea/
    centralRadius, 0.25 at the default beta; the CENTRAL_RADIUS
    placeholder is gone), the paraboloid width was cut twice on user
    feedback (PARAB_FOCAL 0.6 -> 0.3 -> 0.1), and the highlight rules
    are: exterior sphere
    white when the dot touches it, central sphere grey/transparent
    while the dot climbs an exterior sphere (t > 0), all white spheres
    slightly transparent (opacity 0.92) so a backside dot stays
    visible; camera + dot re-framed for the formula radius. THIRD
    round (2026-09-13, same day): central area now uses the ABS value
    (user correction — the sphere persists in dominant chambers), and
    the never-highlighting exterior glow was traced to reading
    lastState.exterior.slot (always undefined) instead of the flow
    state's top-level lastState.slot — fixed. All three rounds
    user-verified 2026-09-13 ("It looks perfect!", then "Looks great").
    Future
    level-circle slider and lim t→∞ behavior owed; see the sideview.js
    Files entry for all measured/canonical choices. (The level-circle
    slider LANDED 2026-09-14 as the gamma slider — task list #11; the
    lim t→∞ behavior LANDED the same day as the I-stratum entry — task
    list #15: the side view is COMPLETE.)
6. TODO (added 2026-09-14, LOWER PRIORITY per the user): crease-
   consistency traversal fix — the θ parameter "creases" the displayed
   polygon along the chord (pinned to the vertical axis by
   orientation.js), but whether the crease is VISIBLE depends on the leg
   traversal order, i.e. on PERMUTE_23, and the right choice is
   beta-dependent (the 2↔3 swap is a coin flip). PERMUTE_23 was set
   false 2026-09-14 pending this fix. Two candidate designs from the
   planning discussion (user likes (1)+(3); (5) "will take more
   thought"): (1)+(3) crease-score selection with hysteresis — define
   the crease as the dihedral angle between the two half-polygon planes
   split by the chord (v1-v4 side vs v5-v7 side), compute it for each
   candidate traversal ordering (any leg permutation is a pure
   relabeling: permute the solve beta and undo it on the output, so
   mu_U1 = user beta is preserved for ALL 24 orderings — traversal is a
   free display choice, same class as the orientor's twist), display the
   ordering maximizing crease salience, and LATCH the choice with
   hysteresis (re-flip only when the other ordering's score exceeds the
   current one by a margin ε, orientation.js-style) so slider sweeps
   flip at most once smoothly instead of flickering at ties; (5) the
   principled gauge-invariant version — compute a scalar "crease
   measure" (dihedral defect / coplanarity of the leg data, which lives
   in C^2 and is traversal-independent) directly from the gauge-
   invariant leg vectors and derive the canonical traversal from it
   (path-independent by construction, like the orientor's servo), so
   the crease shows whenever the polygon genuinely folds, for EVERY
   beta; (5) subsumes (1)+(3) but needs more design thought. Either
   way the traversal choice must stay a DISPLAY layer (never touch the
   solved (x, y) invariants), and the PERMUTE_23 flag becomes obsolete
   once the canonical rule lands.
7. DONE (2026-09-14, user-verified same day "Looks pretty good"):
   star-chamber
   internal reindexing (user request "use an internal reindexing in the
   solver... Just address the star case for now"): makeHyperpolygon
   dispatches interior star chambers through starReindexed so the notebook
    ansatz's (r,theta) always parameterizes the chamber's distinguished
    column; cycle chambers followed the same day (task #8, the user's
    own ansatz — see the CYCLE REINDEXING paragraph in the solver.js
    Files entry). Requirements from the user's planning message (all
    met by the landed ansatz): (0,0), (1/2,0), (1,0) are the three
    short-pair-straight points, distinguished column fixed in span(0,1),
    one other in span(1,0), cross-ratio parameterization of the remaining
    two, distinguished column never parallel to the others. See the
    solver.js Files entry (starIndex / starSlots / starReindexed /
    solveCore) and the star.mjs battery.
8. DONE (2026-09-14, same day as the user's ansatz message "We need to
   address cycle chambers... x = {{1,1,1,0},{0, r e^{I theta}, 1-r, 1}}"):
   cycle-chamber parameterization by internal reindexing (the 4 interior
   chambers whose three short size-2 subsets do NOT share a common index;
   they previously ran the un-reindexed historical path and stalled at
   some (r,theta)). Landed exactly as the user proposed: distinguished leg
   j permuted into slot 3, others ascending, x = [[1,1,1,0],
   [0, r e^{i theta}, 1-r, 1]]; the y-solve's t/(1-t) prescription MOVED
   from y42 to y22 (mu_C leg 3 forces y42 = 0 for this x — derived and
   documented in the solver.js CYCLE REINDEXING Files entry); solveCore
   gained an ansatz argument (default STAR keeps every historical path
   bit-exact); endpoint/locus retries applied verbatim (no new gated
   retries needed); cycleSlots gives the side view's attachment map and
   widget.js's null-fill consults it. GLUE answer (user's question "not
   sure how to make this glue well when crossing chambers"): the flop jump
   at fixed sliders is INTRINSIC — every star<->cycle wall pair contains
   the cycle side's distinguished leg, which is never straight in the
   cycle chart, and at the on-wall tuple the two charts select different
   branches of the solution variety (measured constant in eps): ~3e-3 of
   polygon scale on the 4 walls where the wall pair is the star side's
   south snap, 0.25-0.58 on the other 8; BOTH sides solve clean near
   every wall (cycle.mjs [G]). Accepted known issue; mitigation would be
    a UX decision. Full suite green: sweep unchanged, walls/sideview/
   edge/locus/exterior/orient PASS, star.mjs 1386 (with [E] raised to
   full bars), new cycle.mjs 4234 checks PASS, validate.mjs legacy diffs
   unchanged (max 3.84e-4 documented spot).
9. DONE (2026-09-14, user-approved: "Most of that looks good"): task 1 of the
   five-task call — side labels ("v₀" .. "v₃" naming the leg VECTORS
   after the user's same-day correction; the original v0..v4
   vertex naming was wrong; w's unlabeled), top-right short-pair list (one row
   per exterior sphere, chamber-dependent via extMap, rebuilt after
   Cross Wall), one yellow blink when a pair of v-sides ENTERS
   parallelism, solid yellow on the straight pair, list row highlighted.
   See the widget.js Files entry. Solver untouched.
10. DONE (2026-09-14, user-approved: "Most of that looks good"): task 2 — the SL(2,C)
   view: collapsed `<details>` "show SL(2,ℂ) polygons" with Re/Im canvases
   (leg-colored edges, closing segment gray, own OrbitControls, rendered
   only while open). At t = 0 (interior chambers) both degenerate to the
   origin — correct (mu_SL = 0 on the central sphere).
11. DONE (2026-09-14, user-approved: "Most of that looks good"): task 3 — the gamma
   slider under t (γ = s·π, [-π, π], snap to 0, noSolve so it never
   triggers solver rescues): rotates the SL(2,C) polygons coordinatewise
   (e^{iγ}) and the side-view dot along the level circles (sideview.js
   gamma param). t = 0 fixed everywhere; su(2) polygon untouched
   (verified 2.5e-16). This LANDS the side view's "future level-circle
   slider" (task list #5 remainder); the lim t→∞ button behavior is the
   only side-view item still owed.
12. DONE (2026-09-14): task 4 — SERVO_TWIST constant in orientation.js
   (true/false gate on the idle twist servo); orient.mjs [E] skips when
   false. Shipped value true.
13. TODO (2026-09-14, task 5 of the call; user asked to record the plan
    for future agents — no code yet): inter-chamber jumpiness. Three
    distinct jump sources, only some fixable; work them in this order:
    (1) MEASURE FIRST — add a "jump meter": per slider event, Kabsch-
    align and measure the displayed polygon's motion, log jumps above a
    threshold with (wall crossed, sliders, beta); extend the cycle.mjs
    [G] measurement to ALL wall classes (leg-dominant, pair, star<->cycle)
    so fixes are judged against a table, not anecdotes. (2) SPHERE-MAP
    SWAPS (fixable now) — crossing a wall can change which short pair
    hosts which exterior sphere; sphere SIZES go to zero exactly on pair
    walls (D -> 0) so the swap is continuous through zero, the artifact
    is the abrupt re-assignment: fillExtMap() already re-probes on Cross
    Wall (2026-09-14); next step is tweening sphere size/placement over
    ~200 ms so even a legitimate swap animates instead of snapping.
    (3) POLYGON SHAPE JUMP at star<->cycle walls is INTRINSIC (cycle.mjs
    [G]: the two charts select different branches of the on-wall
    solution variety, jump constant in eps; 0.25-0.58 of scale on 8 of
    12 walls, ~3e-3 on the 4 south-snap walls). Two candidate fixes:
    (a) ANIMATE THE FLOP (recommended now, display-only): drags can
    never cross walls (chamber lock), so the jump only happens on the
    deliberate Cross Wall click — play a ~0.5 s Kabsch-aligned blend
    between the two on-wall branch representatives (both exact
    solutions at the wall tuple; a straight-line morph of the 9
    vertices). (b) CONTINUATION SOLVING (the principled fix, later,
    battery-gated): the balancing equations are chamber-INDEPENDENT —
    only the x0 ansatz is chamber-tied; add a solveFrom(prevPair, beta)
    entry point that re-runs the (C*)^4 closed form + SL(2,C) Newton
    from the PREVIOUS solved pair instead of rebuilding x0 from the new
    chart, so beta deforms continuously through the wall and the
    displayed pair follows continuously by construction; needs batteries
    proving the continuation basin holds along real drag paths, with
    the chart solve as fallback when it stalls. (4) HONESTY CUE — while
    on a wall (breakingSubsets nonempty) the caption could note "on-
    wall: branch choice changes on crossing" so the flop's snap reads
    as intended. Recommendation: (2) + (3a) now, (3b) later.
14. DONE (2026-09-14, same day; pending user visual check): coherent
    attachment assignment (the user's request above): the split->point map
    is the constant [7,5,6] in every chamber via the exported starSig /
    cycleSig partner-table helpers; cycle.mjs [D2] regression battery.
    Bonus: the item-13 item-(3) "intrinsic" polygon jump measured out to
    be an artifact of the incoherent charts — all 12 star<->cycle walls
    now glue to ~2.5e-3 of polygon scale off-wall (was 0.25-0.58 on 8 of
    12). Item (3a) flop-animation and (3b) continuation solving are likely
    moot for the shape; the y-side (SL(2,C) view) still differs between
    charts on a flop (per-leg |y_i|^2 deltas up to 1.0).

15. DONE (2026-09-14, same-day three-task batch, user-verified
    2026-09-15: "Looks good"): (1) the lim t→∞ button enters the I-stratum (task list #5's
    last item — the side view is now COMPLETE): solver `stratumPair`
    (see the solver.js I-STRATUM entry), side-view tip paraboloid with
    the invisible -> ghost -> white highlight ramp (see the sideview.js
    STRATUM BRANCH entry), widget stratum mode with a t1 slider
    (see the widget.js STRATUM MODE entry). The stratum exists for every
    short pair in EVERY chamber (the dominant leg plays no role), and
    the t1 = 0 slice is the pipeline's approach shape (display-continuous
    entry at t ~ 0.9; the classes where the climb departs the slice
    before t = 1 are measured and documented in stratum.mjs [B]).
    (2) chamber UI panel (beta sliders + scale buttons + chamber
    inequality boxes grouped in a bordered .hp-panel). (3) light-mode
    side-view palette (white spheres -> palette-driven tints; see the
    sideview.js LIGHT MODE note). Full suite green: sweep unchanged,
    walls/sideview (4555 incl. new [STR])/edge/locus/exterior/orient/
    star/cycle PASS, validate legacy diffs unchanged, new stratum.mjs
    1877 checks PASS.

16. DONE (2026-09-15, six-task UI call, pending user visual check):
    layout + stratum t-slider + paraboloid colors + thick edges +
    exterior-sphere capture + camera pan — see the widget.js and
    sideview.js Files entries ("TWO-COLUMN LAYOUT + t-STRATUM + THICK
    EDGES", "STRATUM FOCAL + GREY/WHITE PARABOLOIDS", "CAPTURE BLEND",
    "CAMERA PAN"): (1) two-column layout, beta/chamber panel under a
    collapsible "Parameters" tab on the right, side view right of the
    polygon view, (r,theta)/(t,phi) rows under a "Moduli Coordinates"
    section; (2) the t slider dual-purposes as the stratum parameter
    (t1 slider gone; enter -> t=0, leave -> t=1, lim button below the
    slider); (3) strata share PARAB_FOCAL and are grey/white like the
    central paraboloids (STRATUM_FOCAL_REL removed); (4) polygon edges
    are cylinders (EDGE_RADIUS_REL 0.007); (5) the central -> exterior
    flow transition is a continuous capture blend (CAP_BAND_R 0.1 /
    CAP_BAND_TH 0.3, shifted climb, nearInfinity at w >= 0.5); (6) the
    side-view camera pans to the attachment / tip targets through the
    smoothed glows. Full suite green: sideview 5810 checks (new [C]),
    everything else unchanged.

## Status / next milestone

- DONE (2026-09-15, six-task UI call, pending user visual check):
  two-column layout + Parameters tab + Moduli Coordinates rows + gamma->phi
  rename (task 1), the t slider dual-purposed as the stratum parameter with
  the t1 slider removed and the lim button below the slider (task 2),
  stratum paraboloids on the shared focal length and grey/white colors for
  all paraboloids (task 3), thickened polygon edges via cylinder segments
  (task 4), the continuous capture blend into the exterior spheres (task
  5), and the side-view camera pan to the highlighted attachment/tip
  (task 6). Full suite green: sideview 5810 checks (new [C] capture
  battery), sweep/walls/edge/locus/exterior/stratum/star/cycle/orient
  PASS unchanged, validate legacy diffs unchanged (max 3.84e-4 documented
  spot). Details in task list #16 and the sideview.js/widget.js Files
  entries.
- DONE (2026-09-14, same-day three-task batch, user-verified
  2026-09-15: "Looks good"): the I-stratum ("lim t→∞" now enters the stratum: solver
  stratumPair + side-view tip paraboloid with ghost/highlight ramp +
  widget stratum mode with a t1 slider), the chamber UI panel, and the
  light-mode side-view palette. Full suite green: sweep unchanged,
  walls/sideview (4555 incl. new [STR])/edge/locus/exterior/orient/
  star/cycle PASS, validate legacy diffs unchanged (max 3.84e-4
  documented spot), new stratum.mjs battery 1877 checks PASS. Details in
  task list #15 and the solver.js/sideview.js/widget.js Files entries.
- DONE (2026-09-14, user-approved same day: "Most of that looks good.
  Write our suggestions down for future agents. We're done for now"):
  the five-task call's
  display batch (task list #9-12): (1) side labels + top-right
  short-pair list + yellow parallelism (blink on entering parallelism,
  solid while straight — at the snaps exactly the extMap pair, Node-
  verified; crossWall re-probes the attachment map); (2) SL(2,C) Re/Im
  polygon views in a collapsed `<details>`; (3) gamma slider (U(1)
  y-phase): rotates the SL(2,C) polygons coordinatewise and the side-
  view dot along the level circles, t = 0 fixed everywhere, su(2)
  polygon bit-untouched (this closes the side view's level-circle
  item); (4) SERVO_TWIST constant in orientation.js (orient.mjs [E]
  skips when false). NO solver changes — sweep/walls/star/cycle/locus/
  exterior/edge/validate all unchanged (validate max 3.84e-4 documented
  spot); sideview PASS 4331 checks (new [G] gamma battery); orient
  6/6. Inter-chamber jumpiness (task 5) remains TODO; the full plan is
  recorded in task list #13 for future agents.
- DONE (2026-09-14, user-verified same day "Looks pretty good"):
  star-chamber
  internal reindexing (task list #7): the solver now handles ALL FOUR star
  chambers with the notebook ansatz via an internal leg permutation
  (distinguished index j -> slot 3), unpermuted output, mu_U1 = user beta.
  j = 3 path bit-identical to before (validate.mjs legacy diffs unchanged,
  max 3.84e-4 at the documented spot). Side view attachment map now
  chamber-dependent per starSlots; widget null-fill uses it. Full suite
  green: sweep unchanged, walls/sideview/edge/locus/exterior/orient PASS,
  new star.mjs 1322 checks PASS.
- DONE (2026-09-14, same day as the user's ansatz message; pending user
  visual check): cycle-chamber parameterization (task list #8, the user's
  own ansatz): all 4 interior cycle chambers now solve via internal
  reindexing with x = [[1,1,1,0],[0, r e^{i theta}, 1-r, 1]] and the y
  prescription moved to y22 (see the CYCLE REINDEXING paragraph in the
  solver.js Files entry). No stalls left: full (r,theta,t) grids, snap
  points, (1/2,0) locus, seeded fuzz, scaled betas all clean (cycle.mjs
  4234 checks); star paths bit-exact (validate.mjs diffs unchanged, max
  3.84e-4 documented spot). Side view attachment map chamber-dependent per
  cycleSlots; widget null-fill consults starSlots then cycleSlots. GLUE
  measured (cycle.mjs [G]): both sides of every star<->cycle wall solve
   clean; the fixed-slider flop jump is intrinsic (constant in eps):
   ~3e-3 of polygon scale on the 4 south-pair walls, 0.25-0.58 on the
   other 8 — accepted known issue, mitigation is a UX decision.
   (SUPERSEDED 2026-09-14 by the coherent attachment assignment, task
   list #14: the 0.25-0.58 jumps are GONE — all 12 walls now ~2.5e-3.)
- DONE (2026-09-14, same day, pending user visual check): coherent
  attachment assignment across chambers (user request: "crossing a chamber
  can replace one short pair with its complement, and the associated
  intersection point should transfer to the complement while the other two
  pairs stay with their intersection points... intentionally pick the first
  three columns of x in the solver ansatz to make this all coherent.
  Previous agents have claimed this isn't possible but I'm rather certain
  it is" — the user was RIGHT; see the COHERENT ATTACHMENT ASSIGNMENT
  paragraph in the solver.js Files entry). The split->attachment-point map
  is now the CONSTANT [7,5,6] in every chamber (south {0,3}|{1,2},
  equator {0,1}|{2,3}, north {0,2}|{1,3}), implemented by the exported
  partner-table helpers starSig(j)/cycleSig(j) consumed by
  starReindexed/cycleReindexed/starSlots/cycleSlots; star-3 (the widget
  default chamber) and cycle-0 keep their exact previous sigs, so those
  paths are bit-identical (validate.mjs legacy diffs unchanged, max
  3.84e-4 documented spot). Major side benefit measured: the star<->cycle
  wall-crossing glue (task #13 item 3's "intrinsic" polygon shape jump) was
  an artifact of the incoherent charts — the fixed-slider off-wall shape
  jump dropped from 0.25-0.58 of polygon scale to ~2.5e-3-2.9e-3 on ALL 12
  star<->cycle walls. Exterior chambers covered analytically via
  cycleSlots (their pair short sides are the cycle chamber's). Full suite
  green: sweep unchanged, walls/sideview/edge/exterior/orient PASS
  (sideview 4367 checks, [P] now measures all 8 interior chambers with
  residual 2e-16), star.mjs 1391 / cycle.mjs 4558 (new [D2] cross-wall
  transfer battery) / locus.mjs 255 ([C] now excludes the closure-vertex
  noise from the D2 check — measured, see the locus.mjs Files entry).
- NEXT: milestone 3b remainder = optional SL(2,C) real/imaginary polygon
  views, short math explanation on the project page, purgecss/build
  polish. The moduli-space side view (Task list #5) is IN PROGRESS (first
  increment implemented AND user-verified 2026-09-13 "It looks perfect!",
  plus two user-verified feedback rounds the same day; remaining
  side-view work: the level-circle slider and the lim t→∞ behavior).
- DONE (2026-09-13): interior degenerate-locus fix (user bug report
  "errors at (r,theta)=(0.5,0), e.g. beta=(0.5,0.5,0.8,0.25), jump to
  something incorrect, many other chambers too"): the su(2) balancing
  stalled at the locus for chamber-dependent subsets of betas (5.2e-2
  for the user example, 5.0e-1 for a dominant leg-2 chamber) at every t
  while neighbors solved — the widget's r/theta snaps land exactly on
  the point. Fixed by the gated display-at-the-limit r-offset retry in
  makeHyperpolygon (see the LOCUS FIX paragraph in the solver.js Files
  entry). Full suite green: sweep/walls/sideview/edge/exterior/orient/
  validate unchanged; new locus.mjs battery PASS (255 checks).
- DONE (2026-09-13, user-verified same day "Looks great"): exterior-
  chamber t = 0 branch (user request, same day): in exterior chambers
  (beta_j >= sum of rest) the t = 0 slice is
  empty for y = 0 and the old pipeline returned a stick with a gap
  (su2 = beta_j - rest, usedStable); makeHyperpolygon now returns the
  closed-form minimum energy state (y_j = 0 row, other y-rows nonzero
  and tuned by (r,theta), exact stick) at t <= 0 — implemented as
  exteriorPair/exteriorYDirection/dominantLeg in solver.js (see the
  Files entry for the derivation and the two numerics gotchas). Wall
  behavior per the user's spec: K = 0 exactly at the wall so enlarging
  beta_j telescopes the stick taller with no jump (battery [C] sweeps
  beta_0 across the wall; advances = (beta_0..beta_3) exactly at the
  wall from both sides). t-continuity verified against the pipeline's
  t -> 0+ limit to ~1e-11 per-leg norms at t = 1e-6 for all four
  dominant legs. Two battery-found numerics fixes (aMag cancellation
  form; Y[1][0] D-form) and one degenerate-locus rule ((1/2, 0)
  re-evaluated at an r offset — the t > 0 pipeline stalls there at
  every t, pre-existing). Full suite green: sweep/walls/sideview/edge/
  orient/validate unchanged, new exterior.mjs PASS (1524 checks).
- DONE (2026-09-13): third side-view feedback round (3 items): (1)
  PARAB_FOCAL 0.3 -> 0.1 ("even thinner"); (2) the exterior-sphere
  white highlight was DEAD since the first increment — the render loop
  read lastState.exterior.slot (always undefined; the slot lives at the
  top level, lastState.slot) — fixed and verified by a Node trace of
  the widget-exact glow targets (south/equator/north touches now fire
  the right sphere); (3) central area now (pi/2)*|z_max - z_min| per
  the user's correction (the sphere persists in dominant chambers).
  Suite green (sideview 3448 checks incl. the abs-formula assertions,
  walls/sweep/edge/orient unchanged; solver untouched so validate is
  unaffected). User-verified same day ("Looks great"); the session
  wrapped there ("we're done for now").
- DONE (2026-09-13): user feedback round on the side view + scale
  buttons (4 items): (1) central-sphere area FORMULA implemented
  (centralArea/centralRadius in sideview.js, 0.25 at the default beta;
  CENTRAL_RADIUS placeholder removed; spherePoint's R now required);
  (2) highlight semantics — exterior spheres white (opacity 0.92, slight
  transparency) when the dot touches them, central sphere grey/
  transparent (0xb0b0b0, opacity 0.3) while the dot climbs an exterior
  sphere (t > 0); (3) PARAB_FOCAL halved 0.6 -> 0.3; (4) scale buttons
  made SUBTLE (x0.8 down / x1.25 up, pin only on the clamped factor)
  and their labels now render vec-beta via a CSS overarrow. Full suite
  green after the changes (sweep/walls/edge/orient/validate unchanged;
  sideview PASS 3448 checks; walls [S] rewritten for the new factors —
  14 down-clicks / 4 up-clicks from the defaults).
- DONE (2026-09-13): PERMUTE_23 toggle — the widget's beta legs 2/3
  permutation became a single true/false switch in solver.js after the
  user request ("disable the beta_2 beta_3 permute for now; should be a
  true/false option in the code"). The
  single switch is `export const PERMUTE_23` in solver.js (set false at
  the time, later flipped back to TRUE by the user — the working tree
  value, display user-verified 2026-09-13; see the solver.js Files
  entry);
  widget.js's solveAndDraw and sideview.js's probe both gate their call
  pattern on it (see the Files entries). With the flag false the widget
  displays the unpermuted solved representative (notebook leg
  convention): the polygon's leg 2/3 traversal order changes (v5-v7
  move, chord/closure unchanged) and the side view's exterior-sphere
  slot map is [7,5,6]. Full suite green after the change (sweep/walls/
  edge/orient/validate all pass with unchanged numbers; sideview PASS
  3439 checks with the battery's map expectation now following the
  flag).
- DONE: solver port + validation against legacy data (milestones 1-2).
- DONE: milestone 3a — minimal browser display, visually verified by the
  user (2026-09-11): `assets/js/hyperpolygon/widget.js` (fixed
  beta = (1/6,1/7,1/7,1/10), sliders r/theta/t, three.js r128 UMD +
  OrbitControls vendored under `assets/js/hyperpolygon/lib/`), wired into
  `_projects/hyperpolygon_moduli_spaces.md`. Theta is displayed in radians
  (label "θ"); the θ slider is normalized s ∈ [-1, 1] (step 0.005 — same
  shape and step as the r slider, so both endpoints ±1 are exactly
  on-grid like t's max=1) and the solve uses θ = s·π (≈0.016 rad per
  step); the readout shows "-π"/"π" at the ends and s·π elsewhere, with
  a gentle snap to exactly 0: {value: 0, tol: 0.01} (±2 grid steps ≈
  ±0.03 rad, the pre-redesign window). A 0.01 rad grid anchored at -π
  could not reach +π (raw max was -π + 628·0.01 ≈ 3.1384), which is why
  the slider is normalized instead of raw radians. Sliders still have
  gentle snap points (r -> 0.5 within ±0.015) implemented via an
  optional `snaps` argument
  to `makeSlider` (defaults to `[]` — a missing default breaks
  live updates for sliders without snaps, see git history). The t slider
  spans 0..1; its readout displays `t/(1-t)` (so it runs 0 toward ∞) and
  shows "t→∞" at t=1 as a limit indicator. At exactly t=1 the raw solve
  returns NaN (`y42 = t/(1-t)` is singular; the polygon diverges
  ~linearly in `t/(1-t)`, so the endpoint is genuinely not attained):
  user-requested behavior is to clamp the SOLVE to t=0.99 there
  (`T_SOLVE_MAX` in widget.js) so the view renders the largest finite
  polygon while the readout still says "t→∞".
- NEXT: milestone 3b remainder = optional SL(2,C) real/imaginary
  polygon views, short math explanation on the project page,
  purgecss/build polish. The moduli-space side view (Task list #5) is
  IN PROGRESS: first increment implemented AND user-verified 2026-09-13
  ("It looks perfect!", sideview.js + sideview.mjs, see the Files
  entry), second and third feedback rounds done and user-verified the
  same day (central-area formula, highlight semantics + slot fix,
  PARAB_FOCAL 0.1); remaining side-view work: the level-circle slider
  and the lim t→∞ behavior. The
  chamber-"flop" interaction (planning-call task 4)
  is DONE as of 2026-09-12. Accepted known issues (do not fix without
  the user asking): (a) dominant-chamber small-t degeneracy behind the
  Cross Wall flop (Task list #4); (b) the theta=0 stall basin at
  isolated near-wall tuples (e.g. the post-cross tuple in walls.mjs
  [W](b) stalls at su2 ~2.5e-2 at exactly theta=0 while other theta
  solve to ~1e-13) — the ⚠ degraded caption covers both.
- DONE (2026-09-12, user-verified 2026-09-13): chamber LOCK +
  short-subset tracking, replacing "snap and ride" the same day (user
  call: dragging along a wall caused accidental chamber flops;
  deliberate crossing returns later as the explicit flop). chambers.js
  now records the initial chamber as its short subsets (shortSubsets)
  and applyBetaDrag clamps every drag into the CLOSED chamber interval
  (chamberInterval): a wall may be touched (the inequality exactly at
  equality) but never crossed, so the chamber given by the initial beta
  never changes; riding is gone (no rescaling of other legs, no ride
  state). The widget displays the 8 inequalities as monospace boxes
  under the beta sliders and turns a box amber while its inequality
  sits exactly on a wall (breakingSubsets, tol 1e-9). Two bugs were
  found by the rewritten walls.mjs [G]/[H] and fixed: chamberInterval's
  R must be accumulated over the other three legs (total - beta[i]
  re-associates with beta[i] and broke bit-exact idempotency by ~1e-16),
  and betaWalls was missing the three other-leg-dominant wall positions
  (a-b-c, b-a-c, c-a-b — positive in lopsided NON-dominant tuples, so
  the old bracket could silently span the leg-j-dominant wall; now
  complete, which also fixed [B]'s dominant-chamber INFO bracket).
  Known coincidence: with beta1 = beta2 exactly (the defaults), the
  lower wall of slider 0 is TWO pair walls at once ({2,3}|{0,1} and
  {1,3}|{0,2} both at b0 = 0.25) — pinning there breaks both
  inequalities and both boxes highlight ([H](a2) asserts the pair).
  walls.mjs [G] rewritten (800 drag events: chamber invariant, leg
  isolation, exact pin/no-op, breaking⟺on-wall per event) and [H]
  replaced with chamber-lock checks (wall pins, cross-drag
  slide-along, contact release, 0-wall floor, 160-pair bracket
  agreement, 2400 fuzz events). Full suite green: sweep worst su2
  1.29e-11 / worst mu_U1 6.7e-10 / slowest 5 ms; walls PASS 357 ms
  (on-wall finals solve to ~1e-11 at moderate t); orientation 6/6;
  validate.mjs legacy diffs unchanged (max 3.83e-4 at the documented
  r=1, t~0.5 legacy-tolerance spot).
- DONE (2026-09-12, SUPERSEDED the same day by the chamber lock above,
  user-verified 2026-09-13): "snap and ride" beta-slider
  mechanic per the user's design (replaced the hard wall
  clamps of the first 3b cut — see the chambers.js entry): dragging
  into the red zone still pins the weight at the wall edge, but
  pulling BEYOND the wall rides it — the tuple stays exactly on the
  chamber wall (all four weights rescale together, beta_i follows the
  slider), pulling back ends the ride, other sliders' drags keep the
  tuple on the wall while riding, and the 0 wall stays hard-clamped.
  Ride paths and deep inward ride-ends can cross into neighboring
  chambers (that was the point: the old clamping could never leave the
  default chamber); on-wall solves are healthy at moderate t but
  degrade near t=0, covered by the existing "⚠ degraded" caption.
  walls.mjs [G] rewritten for applyBetaDrag and a focused ride battery
  [H] added (incl. the measured theta=0 stall basin on ride-end
  tuples, su2 ~3e-3 at t=0.5 — best-of-3 draws there). Full suite
  green after the change (walls [A2]/[B]/[B2]/[C]/[D]/[E]/[F]/[G]/[H]
  all pass; sweep/orient/validate unchanged).
- DONE (2026-09-12): milestone 3b
  beta input, shipped as sliders per the user's design (not the
  originally planned 4 numeric fields): `chambers.js` computes the
  chamber geometry (see Files) and the widget renders 4 beta sliders
  (labels β₀..β₃, step "any", readout toFixed(3)) whose red end zones
  are the weight-space regions beyond the nearest chamber wall; every
  input event applied the drag via clampToSlice + clampToChamber (so
  walls could not be crossed and the tuple never sat on a wall),
  re-syncing all four sliders' red zones/readouts and re-solving
  — superseded the same day by snap-and-ride (see above). Wall mechanics
  validated by the new walls.mjs battery (near-wall profile, clamp
  fuzz incl. idempotency and on-wall starts, chamber-walk integration
  solves at random (r,θ,t) incl. t=0, widget permute-call-pattern
  check). The caption shows "⚠ degraded" if residuals exceed 1e-6 and
  a "solver failed" caption (last geometry frozen) if the solve throws
  — belt-and-suspenders. Walls battery findings
  (2026-09-12, all addressed): (1) near a wall the conditioning shows
  NO distance-dependence at moderate t (on-wall su2 ~6.8e-12 at t=0.4)
  — WALL_MARGIN's real job is chamber confinement, which is what
  shields the widget from dominant-chamber degeneracy (2*b_i >= total
  degrades for ANY leg at t <~ 0.01, worst su2 ~0.4 measured); (2)
  clampToChamber had an idempotency crawl at on-wall pinch starts —
  fixed via the 1e-11 convergence tolerance; (3) solver t=0 basin
  stalls for lopsided in-chamber betas — fixed by the solver RESCUE
  (see solver.js entry; walls.mjs [B2] regression added, all 100
  seeded t=0 draws clean, worst su2 1.1e-11). Full suite green:
  sweep worst su2 1.29e-11 / worst mu_U1 6.7e-10 / slowest 3 ms;
  walls [A2]/[B]/[B2]/[C]/[D]/[E]/[F] all pass; orientation 6/6;
  validate.mjs legacy diffs unchanged (max 3.8e-4 at the documented
  r=1, t~0.5 legacy-tolerance spot).
- DONE (2026-09-11, after 3a): display-orientation revamp. The widget
  re-orients the polygon every frame via `orientation.js` (chord v0->v4
  pinned to +y, idle twist servo, freeze+catch-up when the chord is
  invisible; details in the Files section) — user-approved design
  ("transport + servo"), user-verified visually. The remaining motion
  near t≈0.99 is genuine moduli steepness (e.g. at θ=0 the polygon
  scale dips 30 -> 0.31 -> 7 over Δr≈0.01 around r≈0.5; residuals
  ~1e-15, θ=0 cancellation), NOT an orientation artifact. Also DONE:
  `permute` option in makeHyperpolygon (see Files section).
- DONE (2026-09-12, user-verified 2026-09-13): planning-call
  tasks 1-4 (see the Task list for per-task facts): beta slider row
  layout (grid + ResizeObserver, never 3+1), Scale β⃗ Down/Up buttons
  with grey-out rules, r=0/r=1 endpoint fixes in the solver
  (cancellation-free u root + balancedPair refactor + gated
  display-at-the-limit endpoint retries; the r=1 mu_C ~1e-5 artifact is
  gone), and the Cross Wall flop button (sequential-fill nudge,
  complement-shrink fallback). Full suite green after the changes:
  sweep worst su2 1.38e-11 / worst mu_U1 1.43e-14 / slowest 7 ms;
  walls PASS 355 ms incl. the new [S]/[W]; edge PASS (222 checks);
  orientation 6/6; validate.mjs gauge-invariant legacy diffs unchanged
  (max 3.84e-4 at the documented legacy-tolerance spot) with our r=1
  residuals improved to ~1e-16. Task 5 (moduli-space side view) is
  PLANNED only.

## Dev environment gotchas

- Start the preview via the `/serve` command (`.kilo/command/serve.md`):
  `bundle exec jekyll serve --host 0.0.0.0 --port 8080` (takes ~25 s to
  build; page then at http://localhost:8080/projects/hyperpolygon_moduli_spaces/).
  Use the background_process tool, ready on port 8080.
- The serve watcher does NOT pick up asset-only edits reliably: after
  editing anything under assets/, restart the jekyll server and wait for
  the rebuild (~25 s).
- The served JS is Terser-minified: identifiers are mangled (grep for
  string literals, not variable names) and non-ASCII is escaped as
  \uXXXX ("θ (rad)" appears as "\u03b8 (rad)"). `drop_console: true`
  strips console calls in the build.