# AGENTS.md — master instructions for AI agents

Read this file before doing anything. Do not re-derive context from the
big notebooks or data files unless explicitly asked. Flag values cited
here (PERMUTE_23, SERVO_TWIST) may have been flipped by the user —
check the source for the live value.

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
  (`mathematica/`, `dev/`, and `assets/tex/` are already there — keep
  that true for new folders).

## Working discipline (avoid losing turns)

Long monolithic reasoning blocks are fragile: a turn that hits the
output cap mid-reasoning returns `finish: "length"` and, if no visible
text was emitted yet, the ENTIRE turn is discarded. (The cap is
configurable — `KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX`, set to 128000 in
`.devcontainer/devcontainer.json` remoteEnv — but per-turn caps and
fragility remain.)

- Work in SMALL tool-call steps; never attempt a full derivation in one
  unbroken reasoning block. State the plan, derive ONE step, write it
  down, take the next step.
- CHECKPOINT partial conclusions to a scratch file
  (`/tmp/kilo/notes-<topic>.md`, or `dev/hyperpolygon/` if it should
  survive) after each derived chunk — facts, formulas, decisions, not
  prose. Recovery = read the checkpoint, not re-derive.
- Delegate self-contained derivation/implementation chunks to
  subagents; their reasoning does not consume the main thread's budget.
- If a turn dies with the reasoning-limit error, do NOT retry the same
  block: re-read the last checkpoint / relevant files and resume from
  the smallest next step.

## Math model (star-shaped quiver: central C^2, four C legs)

- `beta` = 4 positive parabolic weights. Chamber walls = subsets of legs
  summing to exactly half the total (the solver's branches handle walls
  and exterior chambers; chambers.js tracks/confines them).
- Parameters `(r, theta, t)` in [0,1] x [-Pi,Pi] x [0,0.99].
- Pipeline (STAR ansatz):
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
     cyclic 1-parameter minimization.
- `r = 1`: evaluate at `reff = min(r, 1-1e-5)` (the `(1-r)` prefactor
  cancels the pole). The straight pair at r=1 is straight only to
  O(1-reff) ~ 1.7e-5 (battery bar 1e-4 there, 1e-8 elsewhere).
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
  muCNorm, usedStable}`. `permute` swaps legs 2<->3 in the RETURNED
  pair (vertices/sl2 built from the swapped pair, so
  `vertices === hyperpolygonVertices(x, y)` always holds); `accuracy`
  always describes the solved (unpermuted) representative. Harnesses
  pass `permute = false` where the notebook leg convention matters
  (sweep/edge/validate — two sweep beta sets have beta2 != beta3).
  - `PERMUTE_23` (export const): single switch for the widget-side beta
    legs 2/3 permutation — gates BOTH widget.js's beta pre-swap and the
    `permute` argument (and sideview.js's probe). Under either setting
    displayed leg j IS user beta leg j and mu_U1 = user beta; the flag
    only changes the polygon's leg 2/3 traversal order (v5-v7 move;
    chord v0->v4 and closure unchanged). Slated for obsolescence by
    task #6.
  - Dispatch: exterior branch (t <= 0 in exterior chambers) ->
    starReindexed / cycleReindexed (interior chambers) -> `solveCore`
    (exported; `ansatz` argument {buildX, solveY}, default STAR_ANSATZ
    keeps every historical path bit-exact). All reindexing paths return
    USER-indexed output (column/row k = user leg k, mu_U1 = user beta;
    permute argument applied last), and the endpoint/locus retry
    machinery applies verbatim to every ansatz.
  - Reindexing helpers (exported, one source of truth):
    `starIndex(beta)` (common index of the three short size-2 pairs, or
    -1), `cycleIndex(beta)` (missing index of their union, or -1; also
    classifies exterior chambers), `starSig(j)`/`cycleSig(m)` (partner
    tables implementing the COHERENT ATTACHMENT ASSIGNMENT — see
    below), `starSlots`/`cycleSlots` (the exterior-sphere attachment
    map; constant [7,5,6]), STAR_ANSATZ / CYCLE_ANSATZ. star-3 and
    cycle-0 keep their historical sigs bit-exactly (validate.mjs
    depends on it).
  - COHERENT ATTACHMENT ASSIGNMENT: the three pair-splits map to the
    three exterior-sphere attachment points ONCE AND FOR ALL, in every
    chamber — south (0,0) <-> {0,3}|{1,2} (shortSubsets slot 7),
    equator (1/2,0) <-> {0,1}|{2,3} (slot 5), north (1,0) <->
    {0,2}|{1,3} (slot 6) — so the attachment-slot map is the CONSTANT
    [7,5,6] and crossing a pair wall transfers exactly the crossed
    point's pair to its complement. Realized by choosing which user
    legs occupy the ansatz's first three columns (slot 3 = the
    distinguished leg).
  - Cycle ansatz: x = [[1,1,1,0],[0, r e^{i theta}, 1-r, 1]] (no beta
    factor; col3 distinguished, never parallel to the others; the only
    degeneracies are the three snaps). The y-solve's t/(1-t)
    prescription moves to y22 (mu_C leg 3 forces y42 = 0 for this x);
    closed-form y direction in solveYCycle; the (1-reff) scale makes
    y12 exactly T*D (D = re - (1-reff), the locus defect).
  - Retry machinery — do NOT simplify the gates, each covers a measured
    stall basin: `balancedPair(x0, y0, beta)` = damped Newton ->
    stable cyclic fallback -> RESCUE (extra starts, gate su2 > 1e-6;
    stalled points cost ~30-115 ms once — accepted one-frame-hitch
    class). makeHyperpolygon adds gated endpoint retries (r <= 1e-5 or
    r > 1-1e-5 AND the primary solve not clean) and the interior
    degenerate-locus retry (gate disk |D| <= 1e-4 around (r,theta) =
    (1/2,0), trigger 1e-9 — D = r e^{i theta} - (1-r) is the
    parallelism defect of x columns 2/3): the full cascade re-runs on
    the consistent pair evaluated at a tiny r offset ("display at the
    limit"); the locus rep is bit-exact the direct solve at the offset
    point. Healthy interior solves never enter these branches.
  - Exterior branch: `exteriorPair(r, theta, beta, j)` closed form at
    t <= 0 in exterior chambers (`dominantLeg`, wall inclusive to
    1e-12): exact minimum-energy stick, y_j = 0, K = 0 exactly on the
    wall (no jump when enlarging the dominant beta). Battery-found
    numerics gotchas, do not "simplify": aMag computed as
    sqrt(K w/(beta_i + S_i)) (cancellation-free), Y[1][0] written as
    reff e^{i theta} D/(1-reff); at the (1/2,0) locus re-evaluate at a
    tiny r offset.
  - `stratumPair(t1, beta, I, permute = false)` — I-stratum closed form
    (x-columns parallel within BOTH I and comp; same return shape; null
    when I is not short). Shared-G product cancellation makes mu_SL
    exact; comp rows exactly zero at t1 = 0; on a pair wall all rows
    vanish (the y = 0 stick). Exists in EVERY chamber (the dominant leg
    plays no role). The t1 = 0 slice is the pipeline's t -> 1 approach
    shape, but the climb DEPARTS the slice at T ~ 1e2..1e4 in measured
    classes (equator with {2,3} as comp side; r=1 reff offset) — a
    visible jump at t >~ 0.95 there is INTRINSIC.
- `assets/js/hyperpolygon/orientation.js` — display-orientation servo
  (read before touching widget orientation). `makeOrientor()` returns
  `{ update(vertices, dt, flags) }` -> unit quaternion in three.js
  [x,y,z,w] order; the widget sets polyGroup.quaternion from it every
  frame (axes stay world-fixed). Pins the chord v0->v4 to +y via
  exponential-lag transport (T_DISPLAY 0.04 s) + idle twist servo
  (T_SERVO 0.5 s, engages after 250 ms without slider input) parking
  displayed v1 toward +x in the xz-plane. Freezes with hysteresis when
  chordLen/scale < 1e-3 (unfreeze 1e-2; deferred correction plays as a
  catch-up swoosh). Transport+servo, not a stateless rule: the chord
  sweeps the whole sphere and every fixed spin reference becomes
  parallel to it somewhere (measured); the servo makes the converged
  twist path-independent (verified 5e-9). `SERVO_TWIST` (export const)
  gates only update()'s servo step; orient.mjs [E] skips when false.
  GAUGE-JUMP ROBUSTNESS (2026-09-16): the solver's residual gauge can
  step discontinuously between solves (chart-switch representatives,
  endpoint rescues) as a RIGID rotation of the whole walk; the old code
  translated it into a transport whip (the T_DISPLAY slerp takes ~34% of
  the re-pin arc per frame) plus an idle-servo spin — a visible
  discontinuous jump during chamber/stratum transitions (measured:
  0.5-1.1 rad one-frame steps). Fix in update(): step 4.5 runs a Horn
  best-fit rotation `bestFitRotation` (exported; consumed by the
  fingerprint harness's rigid-jump path; Jacobi
  sweeps + best-of-4 eigenvector scoring — the solver walks are
  near-planar with vertices through the origin, so the Horn matrix has
  tied eigenclusters and a single pick returns garbage, the same hazard
  as widget.js task 21) between consecutive raw walks and, when the fit
  is rigid (residual/scale < JUMP_RESID_FRAC 0.05) and sizable (angle >
  JUMP_ROT_MIN 0.2, and NOT the wrapped ~2π near-identity fit the
  degenerate class produces), absorbs the rotation into Q up front:
  displayed pose does not move at all and the new twist stays put.
  Continuous slider paths never fire (0 fires measured). The idle servo
  additionally re-anchors its parking reference whenever the DISPLAYED
  azimuth steps > TARGET_STEP_PSI 0.35 rad in one frame (non-rigid data
  steps such as the stratum entry residual), instead of spinning up to
  the old reference at SERVO_MAX_RATE. Verified: rigid gauge jumps now
  produce 0.0000 pose motion; battery 6/6 green.
- `assets/js/hyperpolygon/chambers.js` — stability-chamber geometry
  (shared by widget + harness). The widget tracks ONE chamber, fixed at
  load, recorded as its "short subsets" (subsets I with sum_I beta <
  sum_comp beta; one per unordered split in fixed slot order; exact
  ties pick the lex-smaller side). Exports: `shortSubsets(beta)` (8-entry
  list fully determining the chamber), `chamberInterval(i, beta,
  shorts)` (CLOSED allowed interval for b_i with the others fixed;
  never empty in chamber), `breakingSubsets(beta, shorts, tol = 1e-9)`
  (inequalities at equality — amber highlight + Cross Wall hook),
  `applyBetaDrag(i, beta, v, shorts)` (chamber-LOCKED drag: clamps into
  chamberInterval — a wall may be touched, never crossed — mutates only
  beta_i, exact no-op on repeat). Gotchas: chamberInterval's R must
  accumulate over the OTHER THREE legs (total - beta[i] re-associates
  and breaks idempotency by ~1e-16); the 0 wall is hard (WALL_MARGIN =
  0.003 floor — leg 0's x-column vanishes at beta_0 = 0); on-wall
  solves are healthy at moderate t but degrade near t=0 (⚠ degraded
  caption). Harness-only utilities: `betaWalls`, `betaInterval`,
  `clampToChamber`.
- `assets/js/hyperpolygon/sideview.js` — moduli-space side view. Two
  layers: pure geometry/probe (Node-safe, imported by the harness) and
  a browser-only `makeSideView(host, opts)` three.js factory (null
  without global THREE).
  - Central sphere: area (pi/2)*|z_max - z_min| with z_max =
    min(|b0+b3|, |b1+b2|), z_min = max(|b3-b0|, |b2-b1|);
    `centralRadius(beta)` = sqrt(|z_max - z_min|/8) (ABS value — the
    sphere persists in dominant chambers; 1e-9 radius floor).
  - Black dot at `spherePoint(r, theta, R)`: south (0,-R,0), north
    (0,R,0), theta = 0 the +x meridian, y = -cos(pi*r) (axis = three.js
    +y, matching the polygon view's chord pin).
  - Three exterior spheres at (r,theta,t) = (0,0,0), (0.5,0,0), (1,0,0)
    (the r snaps with theta = 0), externally tangent; `pairRadius` =
    sqrt(D/8), D = (pi/2)(sum_comp - sum_I) — D -> 0 on a pair wall
    shrinks a sphere away. The attachment map is MEASURED at load by
    `probeExteriorMap` (3-6 solves; theta = 1e-4 retry escapes the
    documented theta=0 stall basin); by the coherent assignment it is
    the CONSTANT [7,5,6]; the widget null-fills from
    starSlots/cycleSlots. Displayed leg j IS user leg j under either
    PERMUTE_23 setting — no PERM conversion anywhere.
  - Flow model (`flowState`, pure): exterior branch iff (r,theta) sits
    on an attachment (poles accept ANY theta; equator needs theta ~ 0;
    tol 1e-9): dot rides the attachment-to-antipode meridian, climb
    angle a = pi*t. Central branch: dot climbs a paraboloid
    z = rho^2/(2f) kissing the sphere at the dot's point (PARAB_FOCAL =
    0.1, phi(t) capped at 80 deg — user-tuned thin). gamma (level
    circles): rotates the side/guide directions about the sphere/apex
    axes; t = 0 points stay fixed; gamma = 0 is a bit-exact no-op.
    Stratum branch (flowState stratum = {k, t1}, sliders parked): dot
    on a paraboloid at the sphere tip (apex = attachment + 2 rk n,
    dot climb capped at PHI_CAP — user request 2026-09-15: t1 -> 1
    carries the dot to the DRAWN rim instead of stopping partway up;
    the old PHI_CAP_STRAT = 55 deg constant is gone — shares
    PARAB_FOCAL); the DRAWN mesh extends to the central paraboloids'
    radius (frame cap = PHI_CAP, spec 2); mesh invisible until
    t >= 0.9, ghost ramp (unhighlighted opacity) to highlight-white when active.
    STRATUM STYLING (2026-09-16): the stratum paraboloid uses the
    EXTERIOR-SPHERE material treatment — single-sided (FrontSide, the old
    DoubleSide "half-shaded" shaded dish look is gone) Lambert surface in
    the ext palette (ext base lerping to extHi on highlight, same two
    opacities 0.32/0.92). The guide arc — the flow boundary — is one
    solid clean BLACK line (dot color, opaque) tracing up the surface,
    replacing the old semi-transparent grey arc.
    Capture blend: within CAP_BAND_R = 0.1 of an attachment (equator
    also |theta| <= CAP_BAND_TH = 0.3) the central branch blends dot +
    guide arc onto that sphere's meridian (smoothstep w; the exterior
    climb is SHIFTED to start at the current sphere point so t = 0 is
    exactly the slider marker); bands are tuned to the widget's snaps.
    Camera pan: the target glides (tau 0.3 s) to origin / glowing
    attachment / stratum tip through the smoothed weights.
  - Highlight semantics (spec 1, 2026-09-15): TWO states only across
    spheres and paraboloids — unhighlighted opacity 0.32 (raised from
    0.16/0.18), highlighted 0.92 (~80 ms lag; NOT 1 — a backside dot
    stays faintly visible). The highlight tracks flowState's `att`
    (attachment index), NOT the short-pair slot: in dominant chambers
    probeExteriorMap returns duplicate slots (every pair is parallel on
    the t=0 stick, margin test vacuous) and the widget's fillExtMap
    discards non-distinct measurements in favor of the analytic [7,5,6]
    — so entering one sphere lights exactly that one. No more central
    grey state. STRATUM TRANSITION (user request 2026-09-16): at the
    stratum's t1 = 0 tip slice the exterior sphere AND the stratum stay
    co-highlighted (the attachment co-highlight), but as soon as t1 > 0
    the exterior sphere's highlight is dropped — the stratum carries the
    highlight alone (bubble branchTarget gated by `kind === "stratum" &&
    t1 > 0`). Task 19: the CENTRAL sphere CO-HIGHLIGHTS when the dot
    hugs its surface — an attachment is the two spheres' intersection,
    so at t = 0 on an exterior sphere both are lit; the loop's rule is
    geometric (|dot| within max(0.02, 0.25*rk) of centralRadius,
    smoothstep fade out), which also keeps the captured central branch
    lit at t = 0 and lets the stratum-branch dot (at the tip) stay
    unlit. All materials transparent, depthWrite off. Colors are
    palette-driven (sphere / sphereGrey / extHi keys; light mode sets
    tints so nothing renders invisible-on-white; ext == sphere in BOTH
    themes since task 19 — only the highlight lerp target differs). The side view uses
    the RAW t (1 allowed — the solve keeps T_SOLVE_MAX).
- `assets/js/hyperpolygon/widget.js` — display layer; NO solver changes
  without re-running the suite. Layout: live matrix readout
  (x 2x4, y 4x2 of the SOLVED pair, big flanking parentheses) on top, then a
  flex two-column row with
  EQUAL columns — LEFT: 1:1 polygon canvas (+ pair-list overlay), caption,
  "Moduli Coordinates" panel ((r, theta) then (t, phi) slider rows — the
  spec 11 swap REVERTED per user request 2026-09-15; the lim button stays
  under t), SL(2,C) details; RIGHT: 1:1 side view above a flat "Parameters"
  card (no collapse; spec 14) holding the beta/chamber panel + the two
  chamber-slice plots. The widget's boxed Introduction panel is GONE
  (2026-09-15): its content was merged into the project page's flowing
  text (_projects/hyperpolygon_moduli_spaces.md — "four-sided quiver"
  wording, no four-punctured sphere).
  - Moduli sliders: rows (r, theta) then (t, phi) — the spec 11 swap
    was REVERTED on user request 2026-09-15. theta normalized
    s ∈ [-1,1] step 0.005 (a raw
    0.01-rad grid anchored at -pi cannot reach +pi), solve theta = s*pi,
    readout "-pi"/"pi"/radians, snap to 0 (tol 0.03); r snaps to 0 and 1
    (tol 0.05, spec 8) and to 0.5 (+-0.02); t spans 0..1, readout
    t/(1-t), "∞" at t=1; the SOLVE clamps to T_SOLVE_MAX = 0.99 (t = 1
    is genuinely singular: y42 = t/(1-t)). phi slider (the old gamma)
    same shape, noSolve (NEVER triggers a solver run — rescue paths
    cost 30-115 ms); acts on y ITSELF: the displayed pair becomes
    y -> e^{i·phi} y (every entry scaled by the unit complex number,
    user request 2026-09-15) — the y matrix READOUT shows the rotated
    entries, the su(2) polygon/residuals are untouched (phase-invariant),
    and the SL(2,C) coordinatewise e^{i·phi} rotation is the BYPRODUCT
    (updatePhiViews; u_i = x_i·y_i is linear in y). The side view's phi
    feed (level circles) is unchanged.
  - Beta panel: defaults (0.4, 0.5, 0.5, 0.25, task 21); DISPLAY ORDER beta0,
    beta2, beta1, beta3 (the beta_1/beta_2 screen swap, user request
    2026-09-15 — labels stay with their values, the beta[] indexing is
    untouched); applyBetaDrag per input
    event + full re-sync of sliders/readouts/red-zones (allowed spans
    run exactly TO the wall; .hp-slider gradient via --hp-lo/--hp-hi);
    beta slider grid 4/2/1 columns by ResizeObserver (thresholds
    700px/340px — NEVER 3+1); the Scale β Down/Up buttons are GONE
    (2026-09-15, user request — the sliders alone drive the tuple; the
    walls.mjs [S] battery keeps only the solver scale-robustness check);
    the instructional
    header is REPLACED by two synchronized chamber-slice plots (spec
    10): (β1,β2) and (β3,β4) planes (display 1-based; internals
    (0,1)/(2,3)), the seven wall equalities as red
    lines (--hp-wall), the active pair as a black dot; 7
    chamber-inequality boxes (shortSubsets slots 1..7, amber while
    on-wall, tooltip with live sums); each amber box hosts "Cross Wall"
    (flop: chamberShorts[k] := complement — spec 9: NO nudge anymore,
    the tuple stays pinned exactly against the crossed wall and only
    the red thresholds re-sync; walls.mjs [W](g) mirrors it).
  - solveAndDraw's call pattern is gated on PERMUTE_23 (live false):
    makeHyperpolygon(r, theta, t, beta, false); with the flag true it
    pre-swaps beta legs 2/3 and passes permute = true (the two swaps
    cancel in the display). try/catch + NaN check: warning caption, last
    geometry frozen instead of garbage.
  - Polygon display: leg labels v1..v4 (canvas sprites; labels name the
    leg VECTORS, not vertices — leg j runs pts[2j] -> pts[2j+2], label
    at the midpoint pushed from the centroid; display indexing is
    1-BASED as of 2026-09-15 — sideName(j) = "v"+SUBS[j] with SUBS =
    ₁₂₃₄, solver indexing stays 0-based); top-right short-pair
    list (v-only labels since spec 7 — "v₁ ∥ v₄", pair =
    chamberShorts[extMap[k]], rebuilt after Cross Wall; subsets render
    1-based via fmtSet); yellow
    parallelism (v-side direction sine < 1e-3: solid yellow on the
    straight pair + list-row highlight; ONE blink on ENTERING
    parallelism); edges are 8 unit-cylinder meshes whose thickness is
    decoupled from polygon scale — EDGE_SCREEN_FRAC = 0.0035 of the
    viewport height at the CURRENT camera distance, recomputed every
    frame (spec 5; WebGL ignores LineBasicMaterial linewidth); edge
    palette black/green in light mode, white/green in dark mode; the
    v_j label sprites are zoom-coupled the same way —
    LABEL_SCREEN_FRAC = 0.03 of viewport height per frame
    (updateLabelScales; task 19 — they no longer scale with the polygon
    as t -> inf).
  - Matrix readout + caption: the readout panel ("Solved pair" sec-label)
    above the viewports shows the SOLVED x (2x4) and y (4x2) as complex
    entries (spec 13) flanked by large CSS parentheses (rounded
    left/right border brackets, currentColor-inheriting — user request
    2026-09-15); the y half is written by updatePhiViews (phi rotation,
    see the moduli-sliders bullet); the caption shows a single "moment
    map residual" scalar — the L2 norm of the real moment map residuals
    (3 su(2) + 4 U(1) components, widget-side momentResidual via
    muSU2Coords), spec 15; the old closure readout is gone. The
    chamber-inequality row's label reads "Chamber Inequalities:" (user
    request 2026-09-15).
  - Panel chrome (2026-09-15 cleanup, user request): one shared box style
    — .hp-panel (border --hp-box-bd, radius 10, tinted background
    --hp-panel-bg, padding 10/12, margin-top 12) for the matrices,
    Moduli Coordinates, Parameters and SL(2,C) containers, each headed
    by an .hp-sec-label (small caps); viewports (.hp-frame: same
    border/radius family, overflow hidden) for the polygon, side view
    and both SL canvases; palette border hexes UNIFIED with
    --hp-box-bd (#cfd4da light / #4a525e dark; sideview.js default
    updated to match).
  - SL(2,C) view: collapsed <details> ("Show sl(2,ℂ) polygons"), Re/Im
    300px canvases (leg-colored edges, gray closing segment, own
    OrbitControls, rendered only while open). At t = 0 in interior
    chambers both degenerate to the origin — correct (mu_SL = 0 on the
    central sphere), not a bug.
  - Stratum mode: the "lim t→∞" button (visible on an exterior sphere /
    capture weight w >= 0.5 at t >= T_NEAR_INF = 0.9; task 19 — in
    stratum mode the exit button shows only while t <= LIM_T0_BAND =
    0.1, mirroring the entry gate) enters the
    I-stratum of that sphere's short pair: r/θ parked + disabled at the
    attachment (theta also parked at the equator — the stratum gate
    needs the exact point), t jumps to 0 and dual-purposes as the
    stratum parameter (solve = stratumPair with the shared
    T_SOLVE_MAX), button becomes "lim t→0" (spec 3; restores parked
    values, jumps t to 1 = ∞), Cross Wall leaves the stratum first;
    the doubly-straight stick lights BOTH parallel pairs automatically
    (the caption's former "I-stratum … ∥ …" tag was removed 2026-09-16 —
    the mode is clear from the button and the side view).
  - Stratum branch switches (entry/leave, incl. via Cross Wall) are
    gauge-aligned + morphed in the display layer (task 21):
    kabschRotation -> liftSU2 -> rotatePair -> recompute
    vertices/sl2 -> 350 ms smoothstep morph (STRATUM_MORPH_MS; the
    helpers live at module scope in widget.js). Do not "simplify" the
    best-of-4 eigenvector scoring — stick data makes the Horn matrix's
    top eigenvalue 2-dim and a single pick can return garbage.
- `mathematica/` — reference notebooks and legacy data. Excluded from
  the Jekyll build; `mathematica/hyperpolygonData*` is gitignored
  (137 MB file, over GitHub's limit). `generateHyperpolygonData.wls`
  is an abandoned draft — do not debug it unless asked.
- `dev/hyperpolygon/` — Node validation harness; `run-validation.sh`
  copies the live modules in and runs everything (exit 1 on failure):
  - `sweep.mjs` — randomized robustness (200 pts x 3 beta sets).
  - `edge.mjs` — endpoint battery: r ∈ {0,1} grids for BOTH call
    patterns, formerly-broken bands, t=0 corners, gauge-invariant
    continuity at t <= 0.5, r=1 theta loop, seeded fuzz.
  - `walls.mjs` — chamber-wall battery: near-wall conditioning, clamp
    idempotency fuzz, drag-event + chamber-lock batteries [G]/[H],
    uniform-scaling battery [S] (solver scale-robustness; the retired
    scale-button mechanics are documented, not run), cross-wall battery
    [W], widget permute-call-pattern check, defaults sanity.
  - `orient.mjs` — orientation battery (6 tests, 39 slider paths,
    ~13 s): chord pinning, drag continuity vs a Kabsch baseline,
    jump smoothness, static stability, servo path-independence
    (skipped when SERVO_TWIST is false), quaternion sanity.
  - `locus.mjs` — the (1/2,0) degenerate-locus battery (gate disk,
    chaotic band, bit-exact offset identity / regime-aware D2 check).
  - `exterior.mjs` — exterior-chamber t=0 branch battery (all four
    dominant legs, wall sweep, t-continuity, widget path).
  - `star.mjs` — star reindexing battery (grid vs USER beta, snap
    straightness incl. the r=1 1e-4 bar, bitwise equivalence,
    classification + [7,5,6]).
  - `cycle.mjs` — cycle reindexing battery (grid, snaps, bitwise
    equivalence + closed-form y cross-check, classification,
    cross-wall coherence [D2], locus, fuzz, scaled betas, wall-glue
    measurement [G], widget-load-path smoke).
  - `stratum.mjs` — I-stratum battery (grid, approach comparison,
    product cancellation, permute pattern, on-wall degeneracy, perf).
  - `sideview.mjs` — side-view battery (probe rule [P] over all 8
    interior chambers, sizes, flow/paraboloid/exterior constraints,
    gamma level-circle invariants [G], stratum [STR], capture [C],
    purity).
  - `validate.mjs` — spot-checks vs `mathematica/hyperpolygonDataPolar`
    (only where that 137 MB file exists).
  - `fingerprint.mjs` — bit-exact behavioral fingerprint of the live
    modules (solver grid incl. walls/endpoints/locus/permute, closed
    forms, chambers, orientation incl. the rigid-jump path, side-view
    flow) vs `fingerprint-golden.json`; `check` must print
    "bit-identical" after any refactor; regenerate with `golden` only
    for ENUMERATED intentional changes. Machine-local golden (V8/FP
    dependent); NOT part of run-validation.sh. Added by task 27.
  - `bench.mjs` — hot-path micro-benchmarks (solve, vertices,
    residuals, orientor idle/active, chambers, flowState). Task 27.
  - `README.md` — harness guide: module map, invariants, gate
    commands. Task 27.

## Validation expectations

- `sweep.mjs`: worst su(2) ~1e-11, worst mu_U1 <= 1e-9, mu_C ~1e-15,
  slowest solve a few ms, stable path never needed.
- `edge.mjs`: PASS (222 checks); endpoint residuals < 1e-9
  (muC < 1e-6); the formerly broken bands (r ~ 1e-12..1e-6,
  0.99999..0.999999) solve clean.
- `walls.mjs`: ~0.4 s; all batteries pass; on-wall finals solve to
  ~1e-11 at moderate t; near-wall conditioning shows no
  distance-dependence (walls matter through chamber confinement, not
  local conditioning).
- `orient.mjs`: 6/6 (pinning ~1e-8 vs limit 2e-3; path-independence
  ~5e-9 vs limit 5e-3).
- `sideview.mjs`: 5810 checks PASS.
- `validate.mjs`: gauge-invariant diffs ~1e-9 where the legacy data was
  accurate; ~1e-4 expected where the legacy file sat at its own solver
  tolerance (max 3.84e-4 at `r=1, t~0.5`, where the legacy residual is
  7.3e-4).
- Browser perf budget: one solve well under 10 ms so sliders re-solve
  on every input event (orientor.update is O(9), negligible).
- After any solver change: re-run run-validation.sh. Historical paths
  (star-3, cycle-0, default STAR ansatz) must stay bit-exact.

## Tutorial plan (OUTLINE ONLY — not built; see task #24)

Game-like tutorial for the widget. Start state: everything greyed out
except the r and theta sliders; each lesson is a pop-up explainer plus
a small task whose completion unlocks the next control group.
Educational targets, in teaching order: (1) what a moduli space is
(points = gauge-inequivalent stable pairs; sliders are coordinates),
(2) Kempf–Ness — every stable representation is gauge-equivalent to
the unique moment-map-balanced representative the display shows,
(3) wall-crossing (stability chambers, the flop, strata). NOTHING
tutorial-related renders or binds until the user clicks a "Tutorial"
button (placement: near the widget header — decide at build time).

Entry / exit / mechanics (display-layer only):
- `assets/js/hyperpolygon/tutorial.js` — new dependency-free module,
  statically imported by widget.js, instantiated ONLY on button click.
  Owns a lesson state machine + per-lesson task predicates; drives the
  gating; subscribes to existing widget events (slider input events,
  Cross Wall handler, stratum enter/leave, flowState `att`) — no
  solver coupling whatsoever.
- Lesson card: small floating card anchored near the control being
  taught where feasible (fallback: fixed corner dock); Next/Back/Skip
  + Exit. Exit (offered at every step) restores the free-play default
  state (r = 0.25, default beta, ALL controls enabled, stratum mode
  left) and discards progress (session-only; no localStorage unless
  asked).
- widget.js gains a control-gating registry: every interactive control
  (r/theta/t/phi sliders, four beta sliders, Cross Wall, lim t→∞,
  SL(2,C) details) registers; the tutorial drives an enable-set.
  Disabled = opacity ~0.35 + pointer-events none; the active lesson's
  control gets a highlight ring. Views stay LIVE throughout (polygon,
  side view, matrix readout keep rendering — they ARE the teaching
  content). No default-state behavior changes; full suite must stay
  green.

Lesson sequence (explainer -> task -> unlock):
0. Welcome — what the widget shows: ONE point of the moduli space.
   Controls: r, theta only.
1. The moduli space is a space — task: sweep r 0.25 -> 0.5 (side-view
   dot rides the central sphere; polygon reshapes), then theta to 0.
   Teaches: each (r, theta) labels one gauge-inequivalent stable pair;
   sliding = walking the moduli space. Unlocks t.
2. The t direction — task: drag t 0 -> 0.99 (polygon inflates ~
   1/(1-t); the dot climbs its paraboloid). Teaches: t sets the
   relative scale of y (the t/(1-t) prescription), the "infinity"
   readout, why the solve clamps at T_SOLVE_MAX. Unlocks phi.
3. Gauge freedom & the moment map (target 2) — task: sweep phi and
   observe the su(2) polygon + residual caption DO NOT move (only the
   matrix readout rotates, y -> e^{i·phi} y). Teaches: the display
   always shows the UNIQUE balanced representative; every stable
   representation is gauge-equivalent to it. Unlocks the beta panel.
   (The hands-on gauge mini-game was MOVED OUT of the tutorial — see
   "How it works" explainer below.)
4. Stability data: beta & the chamber — task: drag one beta slider
   until an inequality box turns amber (the chamber-lock clamp keeps
   the tuple ON the wall; crossing NOT explained yet). Teaches: beta
   are stability data, the seven inequalities, a chamber is a
   connected component, why drags are clamped. Unlocks Cross Wall +
   stratum entry.
5. Wall-crossing (target 3) — task: press Cross Wall on the amber
   box; the short-pair list swaps (pair -> complement) and the
   polygon rearranges at FIXED beta. Teaches: at a wall two legs
   become parallel; adjacent chambers are different moduli spaces
   glued along a shared stratum; the flop changes the chamber at the
   same tuple.
6. Strata & the side view — task: snap to an attachment at t >= 0.9,
   press lim t→∞, watch the dot climb the stratum paraboloid, leave
   via t back to ~0. Teaches: the exterior spheres are the
   wall-crossing partners; the stratum stick is the doubly-parallel
   degenerate representation approached as t -> infinity.
7. Free play / recap — everything unlocked; recap card ties the three
   targets together; optional mini-challenges (find a wall from a
   random chamber; enter a stratum).

"How it works" explainer (FUTURE, SEPARATE — not part of the
tutorial; its own button next to Tutorial, e.g. a modal or dedicated
panel; see task #25): an interactive Kempf–Ness mini-game. Start from
a stable polygon (like a simple one in the solve ansatz) and have the
user try to find a *complex* gauge transformation to solve the moment
map equations using sliders. An edge becomes highlighted when it is
the correct length, but changing another slider can ruin a previously
satisfied one. A "give up" button lets the solver find the correct
slider positions. Caveat (user, 2026-09-17): the gauge group is too
high dimensional to do this for real — special case with exactly 7
sliders (likely the 7 free complex y-entries of the star ansatz;
exact mapping + per-edge residual split settle at build time).

Build-time gotchas & open decisions:
- Touching widget setup order = the TDZ hazard: re-create the DOM/THREE
  stub harness (/tmp, not committed) and run activate() end-to-end
  incl. tutorial enter/exit mid-lesson, exit mid-morph, exit while in
  stratum mode.
- Lesson text must not contradict the accepted known issues (⚠
  degraded captions, theta=0 stall basin, on-wall chart mismatch):
  lessons use generic points and moderate t; do not promise
  wall-adjacent smoothness.
- Open decisions SETTLED (2026-09-17, user): anchored card with corner
  dock fallback; session-only progress (no persistence); bottom dock
  under ~700px. The gauge mini-game is OUT of the tutorial (separate
  "How it works" explainer, task #25).
- Milestone status (2026-09-17): milestone 1 = button + gating registry +
  lessons 0-2. Milestone 2 = the gauge lesson (old #3) is DROPPED per
  user — phi stays gated until the recap and the lessons renumber 0-6 —
  and lesson 3 (beta/chamber) is IMPLEMENTED: task = drag any beta
  slider to a red-zone end until an inequality box turns amber (the
  chamber-lock clamp stops it exactly ON the wall); predicate reads the
  boxes' hp-breaking state; live "nearest wall: d" readout computed via
  chamberInterval (ctx gains chamberShorts/chamberInterval/moduliBox/
  paramsCard); completing unlocks Cross Wall + lim; entering lesson 3
  while already on a wall resets beta to the default tuple (clean
  interior start). CARD DOCKING FIX (user request 2026-09-17 — the old
  under-the-slider anchor covered the sliders a task needed, e.g. the
  beta rows below beta_1): the card docks BELOW the anchor's OWNING
  panel — Moduli Coordinates for r/θ/t/φ/lim, Parameters for the beta
  sliders and Cross Wall — and the container's bottom padding is
  reserved to the card's height while active (restored on exit), so the
  docked card always fits below the content and NEVER covers a control;
  < 700px it is the full-width bottom dock inside the same band;
  anchorless placeholder lessons keep the top-right corner dock.
  Lessons 4-6 (wall-crossing, strata, recap) remain placeholders.

## Task list

Tracked work items; keep statuses updated.

1. DONE: beta slider layout 4/2/1 columns (never 3+1) via grid +
   ResizeObserver (thresholds 700px/340px).
2. DONE, then REMOVED (2026-09-15 user request): Scale β⃗ Down/Up
   buttons (x0.8 / x1.25 clamped to max; 0.02 floor) — the four beta
   sliders alone drive the tuple; walls.mjs [S] keeps only the solver
   scale-robustness check.
3. DONE: r=0/r=1 endpoint jumps (cancellation-free u root, balancedPair
   cascade, gated display-at-the-limit endpoint retries; the mu_C ~1e-5
   r=1 artifact is gone).
4. DONE: Cross Wall flop button (amber chamber box -> complement
   chamber + sequential-fill nudge).
5. DONE: moduli-space side view, COMPLETE incl. the level-circle slider
   (= phi/gamma) and the lim t→∞ behavior (= I-stratum entry).
6. TODO (LOWER PRIORITY per user): crease-consistency traversal fix —
   whether the θ crease is visible depends on the leg traversal order
   (PERMUTE_23, set false pending this); the right choice is
   beta-dependent. Designs: (1)+(3) crease-score selection with
   hysteresis over the 24 leg orderings (any permutation is a pure
   relabeling — permute the solve beta, undo on the output, so
   mu_U1 = user beta is preserved; latch with a margin ε so slider
   sweeps flip at most once); (5) the principled gauge-invariant
   version — a traversal-independent crease measure (dihedral defect /
   coplanarity of the leg data) deriving the canonical traversal;
   subsumes (1)+(3), needs more design thought. Either way the
   traversal choice must stay a DISPLAY layer (never touch the solved
   invariants); PERMUTE_23 becomes obsolete once this lands.
7. DONE: star-chamber internal reindexing (distinguished j -> slot 3;
   notebook ansatz parameterizes every star chamber).
8. DONE: cycle-chamber reindexing (user ansatz
   x = [[1,1,1,0],[0, r e^{iθ}, 1-r, 1]]; y prescription moved to y22).
9. DONE: side labels v0..v3 + short-pair list + yellow parallelism
   (labels re-rendered 1-based v1..v4 in 2026-09-15's UI-indexing batch).
10. DONE: SL(2,C) Re/Im polygon views (collapsed details).
11. DONE: gamma slider (now "phi") — level circles + SL(2,C) rotation;
    since 2026-09-15 it acts on y itself (y -> e^{i·phi} y, visible in
    the matrix readout) with the SL(2,C) rotation as the byproduct.
12. DONE: SERVO_TWIST constant in orientation.js.
13. TODO: inter-chamber jumpiness — (1) MEASURE FIRST ("jump meter":
    Kabsch-aligned per-event motion, extend cycle.mjs [G] to ALL wall
    classes so fixes are judged against a table); (2) tween sphere
    size/placement ~200 ms on extMap swaps; (3) the on-wall polygon
    jump at star<->cycle walls shrank to ~2.5e-3 off-wall via the
    coherent charts — remaining candidates: (a) animate the flop
    (~0.5 s Kabsch-aligned blend of the two on-wall representatives on
    Cross Wall), (b) continuation solving (solveFrom(prevPair, beta)
    re-running balancing from the PREVIOUS solved pair instead of
    rebuilding x0 — principled, battery-gated, later); (4) honesty cue
    in the caption while on-wall. Recommendation: (2)+(3a) now,
    (3b) later.
14. DONE: coherent attachment assignment (constant [7,5,6] map via
    starSig/cycleSig; side effect: the star<->cycle off-wall jump
    dropped from 0.25-0.58 to ~2.5e-3 on all 12 walls).
15. DONE: I-stratum entry (solver stratumPair + side-view tip
    paraboloid + widget stratum mode), chamber UI panel, light-mode
    side-view palette.
16. DONE (2026-09-15, PENDING USER VISUAL CHECK): two-column layout +
    Parameters tab + Moduli Coordinates rows + phi rename; t slider
    dual-purposes as the stratum parameter (t1 slider removed; enter
    -> t=0, leave -> t=1, lim button below the slider); strata share
    PARAB_FOCAL and are grey/white; cylinder edges (EDGE_RADIUS_REL
    0.007); capture blend into the exterior spheres (CAP_BAND_R 0.1 /
    CAP_BAND_TH 0.3); side-view camera pan to the highlighted
    attachment/tip.
17. DONE (2026-09-15, USER CONFIRMED): the 15-spec UI batch —
    (1) two-state side-view styling + per-sphere highlight via
    flowState `att` + dominant-chamber extMap dedupe (the [5,5,5]
    all-highlight bug); (2) stratum meshes extended to PHI_CAP;
    (3) "lim t→0" leave label; (4) plain-β scale labels; (5)
    camera-zoom edge thickness (EDGE_SCREEN_FRAC) + black/green &
    white/green edge palette; (6) terminology purge (no Higgs/flat
    connections/parabolic weights) + Introduction panel (gauge group,
    moment maps, star parameterization); (7) v-only pair-list labels;
    (8) r=0/1 snap tol 0.05; (9) Cross Wall pins the tuple (no nudge;
    walls.mjs [W](g)); (10) chamber-slice plots; (11) (r,t)/(theta,phi)
    slider swap; (12) equal 1:1 viewports; (13) live x/y matrix
    readout; (14) flat Parameters card; (15) moment-map-residual
    caption (closure readout removed).
18. DONE (2026-09-15, PENDING USER VISUAL CHECK): the 7-item user display
    batch — (1) thinner polygon edges (EDGE_SCREEN_FRAC 0.009 -> 0.0045);
    (2) moduli rows back to (r, theta) / (t, phi) with the lim button
    still under t (the post-hoc swap block is deleted — tCol inserted
    before phi's box); (3) beta display order beta0, beta2, beta1, beta3
    (betaInputs[1]'s box inserted before betaInputs[3]'s);
    (4) stratum dot climbs to the drawn paraboloid rim at t1 = 1
    (sideview.js: cap PHI_CAP_STRAT -> PHI_CAP, the 55 deg export is
    gone; sideview.mjs [STR] unaffected — it asserts on-paraboloid
    placement, not the cap); (5) big CSS parentheses around the x/y
    matrix readout (stretch-aligned rounded border brackets);
    (6) the widget Introduction panel removed and its content merged
    into the project page's flowing text (four-sided quiver, no
    four-punctured sphere); (7) chamber label "chamber (fixed):" ->
    "Chamber Inequalities:".
19. DONE (2026-09-15, PENDING USER VISUAL CHECK): the 5-item user batch —
    (1) edges 0.0045 -> 0.0035 and the v_j labels made zoom-coupled
    (LABEL_SCREEN_FRAC = 0.03 via per-frame updateLabelScales; solve
    still sets label POSITIONS); (2) palettes ext == sphere in BOTH
    themes (unhighlighted spheres one color; extHi unchanged);
    (3) sideview.js loop co-highlights the central sphere when the dot
    hugs its surface (geometric band max(0.02, 0.25*rk), smoothstep;
    covers the attachment, keeps the captured t = 0 branch lit, stratum
    tip stays unlit); (4) stratum-mode lim button gated to
    t <= LIM_T0_BAND = 0.1 (entry gate unchanged; leave via drag back
    to t ~ 0); (5) project-page intro REWRITTEN — LaTeX via kramdown
    $$...$$ (built HTML emits \(..\)/\[..\], both MathJax v3 defaults,
    so typesetting works without config changes), brief setup: quiver,
    moment maps, quotient + Kempf-Ness, polygon reading, one widget
    paragraph; no ansatz details. Verified: DOM/THREE stub harness
    re-created (uncommitted, /tmp/kilo/hx) runs activate() end to end
    incl. stratum enter/leave, co-highlight opacities and button gates;
    run-validation.sh exit 0 (all suites); jekyll build OK.
20. DONE (2026-09-15, PENDING USER VISUAL CHECK): the 5-item user batch —
    (1) UI + intro switched to 1-based indexing (SUBS = ₁₂₃₄ shared by
    sideName/SUBSCRIPTS/SUB; fmtSet renders subsets 1-based and moved
    ABOVE rebuildPairList's call site — the old 0-based list/TDZ-order
    hazard is gone; solver indexing untouched, displayed leg j IS still
    user leg j); (2) panel chrome cleanup (.hp-panel/.hp-frame radius 10,
    unified borders --hp-box-bd, tinted panel backgrounds, small-caps
    .hp-sec-label headers incl. the new "Solved pair" matrix header,
    uniform 12px spacing, palette border hexes merged with the CSS vars,
    sideview.js border default #cfd4da); (3) phi acts on y ITSELF
    (y -> e^{i·phi} y in the matrix readout via solvedY + updatePhiViews;
    the SL(2,C) rotation kept as the byproduct — mathematically the
    same rotation, since u_i = x_i·y_i is linear in y); (4) Scale β
    Down/Up buttons removed (walls.mjs [S] slimmed to the solver
    scale-robustness loop); (5) project-page intro shortened ~7 rendered
    lines (two mu display blocks merged into one, |v|-|w| display
    inlined) and re-indexed 1-based.
21. DONE (2026-09-15, PENDING USER VISUAL CHECK): the 5-item batch —
    (1) default beta_1 = 0.4 (widget.js `beta = [0.4, 0.5, 0.5, 0.25]`;
    still the star-j3 chamber and the SAME displayed short pairs
    {2,3}/{1,3}/{0,3}; walls.mjs [F] tuple updated with EXPECT =
    [[],[0],[1],[2],[3],[2,3],[1,3],[0,3]] — hand-computing the slot-5
    short side is error-prone: {0,1} sums 0.9 vs {2,3} 0.75 so {2,3} is
    SHORT; star.mjs/cycle.mjs WIDGET_DEFAULT updated; the stub harness's
    phi-y threshold relaxed to 2 because the y matrix at the
    leave-stratum state now shows only 2 visibly-nonzero readout
    entries); (2) 12px margin between the solved-pair matrix panel and
    the two-column viewports (topFlex margin-top, matching .hp-panel);
    (3) the moment-map-residual caption moved BELOW the Moduli
    Coordinates panel and renamed "Moment map residuals"; (4) "Chamber
    inequalities:" (lowercase i); (5) stratum entry/exit jumpiness FIXED
    in the display layer (widget.js only, solver untouched): measured
    raw entry jumps 1e-3..1.3e-2 clean but 0.45..0.8 at the NORTH sphere
    of cycle chambers (stratumPair's e1/e2 normal form puts the stick on
    the other axis — pure gauge; the battery's per-leg-norm [B] checks
    cannot see an axis flip) and 1.0..1.6 at the equator I={0,1} locus
    class, plus an INTRINSIC exit pop 0.03..0.17 in every chamber (the
    stratum family M = M0(1 + t1/(1-t1)) vs the pipeline's t = 0.99
    approach hugging the t1 = 0 slice). Fix: on every
    stratum<->pipeline branch switch the widget Kabsch-aligns the new
    9-point walk onto the displayed one (Horn quaternion + Jacobi; ALL
    four candidate eigenvectors are scored and the best kept — a
    signed-max pick lands in the wrong tied eigenvalue cluster on
    stick data and returns garbage), applies the SU(2) lift
    (g = [[w+iz, -y+ix], [y+ix, w-iz]], Ad_g = the quaternion's
    rotation — verified against hyperpolygonVertices' exact U(2)
    covariance, 4.5e-16) to the PAIR itself (x -> g x, y -> y g^dagger;
    unitary so every moment map is bit-stable and the matrix readout
    shows the equally-solved rotated representative; the SL(2,C)
    polygons then match the reference to 5e-5..3.6e-4 in the clean
    classes), recomputes vertices + sl2 from the rotated pair, and
    plays the remaining intrinsic change as a 350 ms smoothstep morph
    (STRATUM_MORPH_MS — MUST stay in ms: the first draft divided
    performance.now()'s milliseconds by 0.35 seconds and expired in one
    frame; also clamp the raw s to [0,1] — morph.start is set mid-frame
    after the loop read `now`, so the creation frame's raw s is
    negative and the smoothstep explodes there). Geometry writes are
    centralized in writePolygonGeometry (used by solveAndDraw AND the
    per-frame morph step); a second branch switch mid-morph restarts
    the blend from displayedState() (the on-screen blend); a same-branch
    solve mid-morph cancels the morph and snaps (rare, bounded).
    Full suite green (exit 0); legacy validate diffs unchanged.
22. DONE (2026-09-16, PENDING USER VISUAL CHECK): the 2-item follow-up —
    (1) the chamber-slice plots are CENTERED OVER THEIR SLIDER PAIRS
    (user request): the plots ride the SAME grid as the beta sliders
    (pickBetaColumns sets sliceRow's template + placement). At 4
    columns the on-screen slider order is beta_1, beta_3, beta_2,
    beta_4, so (beta_1, beta_2) spans columns 1-3 centered = the
    midpoint of its two sliders (the column-2 center, exact by
    symmetry) and (beta_3, beta_4) spans columns 2-4 (the column-3
    center); both carry gridRow 1 (explicit overlap is allowed). At 2
    columns each pair shares a column, so the plots sit over columns
    1/2; 1 column falls back to the centered flex row. plotA/plotB
    wraps returned by makeSlicePlot. (2) the r slider DEFAULTS to 0.25
    (user request) — a generic interior point: off the attachment snaps
    and off the (1/2,0) locus; the default-state solve is clean
    (~1e-16). The stub harness was updated: at the r=0.25 default the
    dot rides the CENTRAL branch, so the central sphere stays
    highlighted (kind "central" -> centralTarget = 1 - capW — the
    co-highlight band only ADDS glow for exterior-owned dots) and all
    three exterior spheres stay dim; the attachment co-highlight and
    stratum-flow checks now drive r to 0.5 first (the lim entry gate
    needs an attachment — correctly hidden at a generic point). Full
    suite green (exit 0).
23. DONE (2026-09-16, PENDING USER VISUAL CHECK): the 4-item batch —
    (1) EXTERIOR-STRATUM STYLING (sideview.js): the stratum paraboloid
    now uses the exterior-sphere material treatment — single-sided
    (FrontSide; the old DoubleSide "half-shaded" shading along the dish
    edge is gone) Lambert surface in the ext palette (ext lerping to
    extHi on highlight, same two opacities 0.32/0.92 as the spheres) —
    and the guide arc is now a single clean opaque BLACK line (dot
    color) tracing up the surface, replacing the semi-transparent grey
    arc; (2) STRATUM HIGHLIGHT TRANSITION (sideview.js): at the stratum
    t1 = 0 tip slice the exterior sphere and the stratum stay
    co-highlighted; as soon as t1 > 0 the exterior sphere's highlight is
    dropped so the stratum carries it alone (bubble branchTarget gated
    by kind === "stratum" && t1 > 0); (3) UI CLEANUP (widget.js): the
    caption's "· I-stratum … ∥ …" tag is gone — the residual readout
    shows "Moment map residuals" only; (4) TWIST-SERVO STABILITY
    (orientation.js): diagnosed + resolved — see the orientation.js
    GAUGE-JUMP ROBUSTNESS paragraph above (step 4.5 bestFitRotation
    absorption + TARGET_STEP_PSI servo re-anchor; measured rigid gauge
    jumps: 0.0000 pose motion vs 0.5-1.1 rad before, 0 fires on
    continuous paths; orient battery 6/6 green; full suite exit 0).
 24. DONE (2026-09-17, USER CONFIRMED): game-like tutorial mode,
     COMPLETE (8 lessons 0-7). Milestones 1-2 as before; the 2026-09-17
     completion batch (user requests): (1) all lesson text brief (details
     deferred to the "How it works" explainer, task #25); (2) Next is
     task-gated on EVERY lesson — the Skip button is removed; (3) new
     lessons: tdir = generic position then t up; r1 = ordered sub-tasks
     (t -> 0, r -> 1, t up again; phase state on the lesson object,
     re-armed on every entry incl. Back); phi = gauge phase on y, task =
     sweep >= pi/2 (phi unlocks here); (4) Cross Wall is locked until the
     wall-crossing lesson and lim until the strata lesson (lesson control
     lists + grants; the beta lesson no longer grants them); (5) real
     wall-crossing lesson (task = chamber snapshot changes; beta sliders
     enabled so a wall can be reached if none is amber), real strata
     lesson (task phases: enter stratum via lim, climb t >= 0.8, leave),
     real recap (free play, all controls). enterLesson leaves the stratum
     first EXCEPT for the phi lesson (2026-09-18 user request: lesson 3
     ends IN the stratum — phi stays there, lim kept in its control list,
     and its card floats to the RIGHT of the Moduli Coordinates panel for
     the "sl" anchor (anchorPanel("sl") returns null; the SL(2,C) views
     the task needs stay visible beside it).
      Headless fake-ctx smoke test (/tmp/kilo/tut-test.mjs, uncommitted)
      walks all lessons incl. ordering/gating/Back/exit — 32 checks PASS
      (2026-09-18). widget.js untouched; full suite exit 0.
      2026-09-18 batch (user requests): (1) LIVE Next gating — Next is
      enabled only while the lesson predicate HOLDS (moving the sliders
      off the passing state disables it again); `done` stays latched
      solely for control unlocks; (2) lesson 4 (phi) extended with
      phases: sweep phi >= 90 deg, then leave the stratum via the
      lim t->0 button and return to the central sphere (t = 0,
      0 < r < 0.5, theta = 0) before Next enables; (3) lesson 5 (beta)
      gates lim + sl ON and its amber-wall predicate is live too;
      (4) lesson 7 (recap) anchors where lesson 6 was (anchor "cross"
      -> Parameters card, no more corner dock).
 25. TODO: "How it works" Kempf–Ness mini-game explainer (separate
     button next to Tutorial; see the plan section above). 7-slider
     special case; give-up button fills the solver's values. Will carry
      the detailed explanations removed from the tutorial text.
 26. DONE (2026-09-18, PENDING USER VISUAL CHECK): SL(2,C) boundary
      phi-invariance (user request) — display-layer only, widget.js.
      `phiBoundaryWeight()` (PHI_BW = 0.1 smoothstep ramps): the SL(2,C)
      canvases' effective rotation angle is g_eff = phi * (1 - w(t)) with
      w = max(w0, w1), w0 = 1 - smoothstep(0, PHI_BW, t) (the central
      sphere t = 0 — vacuous in interior chambers where the polygons sit
      at the origin, the correction that matters in edge-dominant
      EXTERIOR chambers) and w1 = smoothstep(1 - PHI_BW, 1, t) (the
      exterior-sphere tips / stratum rim t -> infinity). At the boundary
      slices w = 1 exactly (bit-exact static: cos 0 = 1); the weight uses
      the RAW display t (1 allowed, side-view convention). The y matrix
      READOUT keeps the FULL e^{i·phi} rotation. The tutorial phi lesson
      body mentions the boundary invariance. Also: the SL(2,C) <details>
      summary capitalized to "Show sl(2,ℂ) polygons" (user request).
      Solver untouched; full suite exit 0; tutorial smoke 32/32.
 27. DONE (2026-09-19): audit-driven cleanup batch (zero regressions;
     fingerprint bit-identical throughout). (1) DOCS: repaired the
     truncated PERMUTE_23 header + garbled makeHyperpolygon paragraph
     (solver), stale caption comment + misindent (sideview), stale
     "scale buttons" comment (widget), "wiht" typo (tutorial), named
     JUMP_WRAP_EXCL (2pi-0.6 jump gate), filled the worst docstring gaps
     (exteriorPairAt, solveAndDraw, makeSlider, makeSlicePlot,
     fillParaboloid/setArc/makeParaMesh, ARC_N cross-ref, tutorial
     reposition/enterLesson/snapOf), project-page typos, new
     dev/hyperpolygon/README.md. (2) DEAD CODE removed (all
     grep-verified): widget legSine, stratum.S/.comp, unused
     hooks.onCrossWall/onStratum/onSide channels, 3 unused tutorial ctx
     entries, SUBSCRIPTS/SUB aliases (SUBS kept), PALETTES.arc key;
     tutorial L.locked branch, taskText fallback, isActive(); harness
     unused imports (star cycleSig, sideview PERM, edge muC);
     stratum.mjs local PERM -> import; sideview.mjs phi 0.5 -> PHI_K.
     KEPT after audit self-correction: flowState .slot (battery-asserted
     at sideview.mjs [E]/[STR] — the audit's "unread" claim was wrong)
     and makeSideView dispose (documented teardown API). (3) BIT-EXACT
     DEDUP: solver finishPair() replaces 5 identical result-assembly
     blocks; pairSlotOf (starSlots/cycleSlots); widget smoothstep x3 ->
     1, viewHeight x2, complement4; sideview lambert factory +
     GLOW_TAU/glowFactor x4; tutorial breakingCount. kabschRotation /
     bestFitRotation Horn cores NOT merged (input/output shapes differ);
     lerp3 NOT merged (op order). (4) EFFICIENCY (bench.mjs): orientor
     idle update 7.9us -> 1.5us (scratch prevWalk/dP + exact-zero
     bestFit skip — identity absorption is a no-op), active path 6.9us;
     widget updateEdgeColors zero-alloc fSeg + applied-value skip with
     edgeColorsDirty invalidation (applyColors sets it; sole color
     writer verified); label CanvasTexture cache (4 canvas+texture
     alloc/dispose per slider event -> 0 steady-state); IDLE_YES/NO
     singletons; tutorial tick write-guards + reposition read/write
     batching (layout thrash gone); sideview pan lerp3 scratch. (5)
     TUTORIAL FIX (user-visible): lesson-1 progress line's r checkmark
     was unreachable (rDone = r >= 0.49 vs the predicate window
     0.2..0.48) — aligned to the predicate, label "(0.2 to 0.48)".
     (6) DISCOVERED, NOT FIXED: BLINK_PERIOD is 0.9 in a
     performance.now() MS domain (renamed BLINK_PERIOD_MS) — the
     yellow-parallelism blink plays < 1 frame; harmless but not the
     visible flash the old "seconds" comment promised. Gates: suite
     exit 0 after every phase; fingerprint bit-identical (regenerated
     once, only after P2's enumerated flowState-shape change which was
      then SKIPPED — golden byte-unchanged); widget stub 0 failures;
      tutorial smoke signature 2 FAILURES (stale L0-gate/L6-completes
      checks, predating the 2026-09-18 renumbering).
28. DONE (2026-09-19, PENDING USER VISUAL CHECK): tutorial UX batch
     (user request, display/tutorial layer only — solver untouched; full
     suite exit 0; stub 0 failures; tutorial smoke ALL PASS after fixing
     its 2 stale checks). (1) ENTER RESET: starting the tutorial resets
     every parameter slider to its default (r = 0.25, theta = t = phi =
     0, default beta) via restoreDefaults() from enter(); EXIT
     PRESERVES the current positions (restoreDefaults is gone from
     exit() — only leaveStratum runs if active, which restores the
     user's own parked r/theta). (2) LESSON 1 SWEEP GATE: Next needs an
     ADEQUATE sweep — per-frame accumulated slider travel
     (|Δr| + |Δθs|) >= SWEEP_MIN 0.5 (state on LESSONS[1], re-armed on
     entry) AND the target state; the task line shows the travel
     percentage first, then the r/theta target with checkmarks. (3)
     TASK TEXTS: simplified/staged — lesson 3 (r1) phase 0 reads
     "enter the higher energy Morse stratum" and phase 1 "move t > 0
     from there"; its gate now requires stratumRef() to HOLD (leaving
     the stratum disables Next again). (4) SIDE-VIEW CAMERA: default
     position (1.05, 0.62, 1.25) -> (1.7, 1.0, 2.0) — noticeably more
     zoomed out for the initial overview. Scratch tests updated:
     /tmp/kilo/tut-test.mjs (L0 gate "" lockAll, L1 sweep, L6 amber
     off-toggle) and /tmp/kilo/hx/stub.mjs (enter-reset block, lesson-1
     sweep, exit-preserve assertions; note theta readback is the number
     0, use String()).


## Status / next milestone

- Current state (2026-09-17): full suite green — sideview 5810 checks;
  sweep/walls/edge/locus/exterior/stratum/star/cycle/orient PASS;
  validate legacy diffs unchanged (max 3.84e-4 documented spot).
  2026-09-17 batch USER-CONFIRMED: tutorial COMPLETE
  (task #24; brief text, task-gated Next, Cross Wall/lim lesson-gated,
  real wall-crossing/strata/recap lessons) and the CENTRAL paraboloid
  restyled to the exterior/stratum treatment (FrontSide + ext palette,
  lerp to extHi on climb — user request: match the exterior paraboloids,
  shading artifacts gone). widget.js untouched. The
  2026-09-15 six-task UI batch (task #16) and the 15-spec batch
  (task #17) are user-confirmed. Task #17 initially shipped a TDZ bug
  (theta/t DOM swap before phiInput's declaration) that blanked the
  widget — fixed the same day; see the dev-environment gotcha. Task
  #18 (7-item display batch) is user-confirmed. The 5-item batches
  #19, #20 and #21 (zoom-coupled labels / co-highlight / intro; the
  1-based indexing / panel cleanup / phi-on-y / scale-button removal;
  the beta_1 = 0.4 default / panel spacing / caption move / stratum
  alignment+morph), the 2-item follow-up #22 (slice plots over
  their slider pairs; r default 0.25) and the 4-item batch #23
  (exterior-stratum styling / stratum highlight transition / caption
  cleanup / twist-servo stability) are pending user visual check.
- Accepted known issues (do NOT fix without the user asking):
  (a) dominant-chamber small-t degeneracy behind the Cross Wall flop
  (t = 0 is fixed by the exterior branch; the (1/2,0) locus by the
  solver's locus retry; the ⚠ degraded caption covers the rest);
  (b) theta=0 stall basin at isolated near-wall tuples (batteries use
  best-of-3 theta draws there; ⚠ degraded caption);
  (c) at the EXACT on-wall tuple the star and cycle charts select
  different branches (not user-visible: drags lock the chamber, and
  since spec 9 Cross Wall keeps the tuple ON the wall);
  (d) y-side per-leg |y_i|^2 deltas between the charts on a flop (up to
  1.0 — the SL(2,C) view can change on a flop);
  (e) stratum entry is display-continuous at t >= 0.9 EXCEPT the
   measured crossover classes (see stratumPair above), where a shape
   change at t >~ 0.95 is intrinsic — since task 21 the widget plays
   it as a 350 ms gauge-aligned morph (smoothed, not removed); the
   exit pop (stratum M(t1) vs the pipeline's t = 0.99 approach) is
   smoothed the same way;
  (f) side-view branch crossing at the snap boundary is a visible jump
  (mitigated by the capture blend);
  (g) task 19: leaving the stratum now requires dragging t back to
  <= LIM_T0_BAND = 0.1 (r/theta stay parked; the exit button only
  exists in that band — per user request).
- NEXT: milestone 3b remainder = purgecss/build polish. (The side view
  and its stratum entry are complete; SL(2,C) views landed; the
  short math explanation is on the project page as of task 19.)

## Dev environment gotchas

- `widget.js`'s `activate()` is ORDER-SENSITIVE (TDZ): setup code that
  references a later `const` (e.g. `phiInput`) throws a ReferenceError at
  load and takes down the ENTIRE widget silently (blank container, no
  console output unless devtools are open). Node `--check` cannot catch
  this. The 15-spec batch (2026-09-15) shipped exactly this bug (the
  theta/t DOM swap ran before `phiInput`'s declaration); it is now caught
  by a DOM/THREE stub harness (/tmp, not committed) that runs activate()
  end-to-end — re-create it when touching widget setup order.
- `performance.now()` is MILLISECONDS: widget-side durations must be in
  ms (task 21's first draft divided ms by a 0.35 s constant and the
  morph expired in one frame). Frame-relative state set mid-loop (e.g.
  `morph.start`) must be clamped — the loop's `now` was read earlier, so
  the creation frame's raw delta is negative.
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
