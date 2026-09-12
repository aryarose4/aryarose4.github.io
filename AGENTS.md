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
  closure v8 unchanged). Harnesses pass `permute = false` where the
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
  1/6, 1/7, 1/7, 1/10, unclamped); on each input event it calls
  applyBetaDrag(i, beta, v, chamberShorts), re-syncs all four
  sliders/readouts/red-zones (the allowed span runs exactly TO the
  wall) and re-solves. The red blocked zones render as a
  linear-gradient on the custom-styled track (`.hp-slider` injected
  stylesheet, CSS custom properties --hp-lo/--hp-hi = allowed span in
  %; r/theta/t sliders share the styling with defaults 0%/100%). The
  widget displays the 8 chamber inequalities as boxes below the beta
  sliders (label "chamber (fixed):", one `hp-chamber-box` per
  shortSubsets slot in order: the trivial "{} < {0,1,2,3}" dimmed,
  then e.g. "{0,3} < {1,2}", 0-indexed to match the β₀..β₃ labels; a
  tooltip shows the live subset sums), and a box gets the amber
  `hp-breaking` class while its inequality sits exactly on a wall —
  the future "flop" hook (flopping split k = replacing shorts[k] by
  its complement). CRITICAL widget detail:
  solveAndDraw calls makeHyperpolygon(r, theta, t, [b0, b1, b3, b2],
  true) — legs 2/3 PRE-SWAPPED so the permuted returned pair satisfies
  mu_U1 = beta for the user's beta even when beta2 != beta3; when
  beta2 = beta3 this is exactly the historical call, so no display jump
  when beta2 leaves 1/7 and the default look is unchanged. A
  try/catch + NaN check around the solve shows a warning caption and
  freezes the last geometry instead of drawing garbage.
- `mathematica/` — reference notebooks and legacy data. Excluded from
  the Jekyll build; `mathematica/hyperpolygonData*` is gitignored
  (137 MB file, over GitHub's limit). `generateHyperpolygonData.wls`
  is an abandoned draft — do not debug it unless asked.
- `dev/hyperpolygon/` — Node validation harness:
  - `run-validation.sh` — copies the live solver + orientation.js +
    chambers.js in and runs everything
  - `sweep.mjs` — randomized robustness (200 pts x 3 beta sets)
  - `edge.mjs` — r=1 edge cases
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
    breakingSubsets nonempty iff the tuple is on-wall), and the
    focused chamber-lock battery [H] (exact wall pins at both ends of
    slider 0, cross-drag slide-along along a wall, wall-contact
    release, 0-wall floor, chamberInterval vs the betaInterval
    bracket on 160 non-dominant (slider, beta) pairs, 60 fuzz walks x
    40 events with end-of-walk solves; pinned finals are relaxed to
    su2 <= 0.05 with best-of-3 draws — the theta=0 stall basin at
    isolated draws). Exits 1 on failure.
  - `orient.mjs` — orientation battery (6 tests, 39 slider paths,
    ~9.5k solves, ~13 s): chord pinning, drag continuity vs a
    Kabsch-optimal shape baseline + exact-pinning reference, one-step
    jump smoothness, static stability, servo path-independence,
    quaternion sanity. Exits 1 on failure.
  - `validate.mjs` — spot-checks vs `mathematica/hyperpolygonDataPolar`
    (only works where that 137 MB file exists)

## Validation expectations

- `sweep.mjs`: worst su(2) residual ~1e-11, worst mu_U1 <= 1e-9,
  mu_C ~1e-15, slowest solve a few ms, stable path never needed.
- `walls.mjs`: ~0.4 s runtime; [A2]/[B]/[B2]/[C]/[D]/[E]/[F]/[G]/[H]
  all pass; near-wall profile shows no distance-dependence at moderate t
  (walls matter through chamber confinement, not local conditioning);
  [B2] worst t=0 residual ~1e-11 incl. the rescued repro point; [C]
  3500/3500 idempotent, off-wall, in (0,1]; [G]/[H] chamber-locked drags
  hold every invariant (min chamber slack >= -1e-15, idempotent, chamber
  never changes) and on-wall finals solve to ~1e-11 at moderate t.
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

## Status / next milestone

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
  purgecss/build polish; then the planned chamber-"flop" interaction
  (deliberate wall-crossing by flipping a breaking inequality — the UI
  hooks are in place: breakingSubsets + the highlighted chamber boxes).
- DONE (2026-09-12, user visual verification PENDING): chamber LOCK +
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
  {1,3}|{0,2} both at b0 = 0.1) — pinning there breaks both
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
  user visual verification PENDING): "snap and ride" beta-slider
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

## Dev environment gotchas

- Start the preview with `bundle exec jekyll serve --host 0.0.0.0 --port
  4000` (takes ~25 s to build; page then at
  http://localhost:4000/projects/hyperpolygon_moduli_spaces/). Use the
  background_process tool, ready on port 4000.
- The serve watcher does NOT pick up asset-only edits reliably: after
  editing anything under assets/, restart the jekyll server and wait for
  the rebuild (~25 s).
- The served JS is Terser-minified: identifiers are mangled (grep for
  string literals, not variable names) and non-ASCII is escaped as
  \uXXXX ("θ (rad)" appears as "\u03b8 (rad)"). `drop_console: true`
  strips console calls in the build.