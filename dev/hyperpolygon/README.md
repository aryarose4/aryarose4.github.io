# Hyperpolygon validation harness

Node battery for the browser Hyperpolygon widget (`assets/js/hyperpolygon/`).
`dev/` is excluded from the Jekyll build; nothing here is deployed. Node is
v12: `.mjs` scripts, ESM, no top-level await, no new dependencies.

## Module map (the six asset modules)

- **`solver.js`** — the moment-map pipeline. `makeHyperpolygon(r, theta, t,
  beta, permute)` builds the star/cycle/exterior/stratum ansatz, solves the
  complex linear y-system, balances the `(C*)^4` in closed form, then runs
  the SL(2,C) Newton (with stable fallback and rescues) to return the
  balanced pair `(x, y)` plus its gauge-invariant readouts (`vertices`,
  `sl2`, `accuracy`). Also exports the chamber reindexing helpers
  (`starIndex`, `cycleIndex`, sig/slot tables), the I-stratum closed form
  `stratumPair`, and the exterior-branch builders.
- **`chambers.js`** — stability-chamber geometry shared by widget and
  harness: the chamber's `shortSubsets` (8-entry list fully determining
  it), closed per-leg allowed intervals (`chamberInterval`), the
  `breakingSubsets` at equality, and the chamber-LOCKED `applyBetaDrag`
  (a wall may be touched, never crossed).
- **`orientation.js`** — the display-orientation servo. `makeOrientor()`
  returns `{ update(vertices, dt, flags) }` -> unit quaternion; it pins the
  chord v0->v4 to +y by exponential-lag transport, parks the displayed
  twist with an idle servo, freezes with hysteresis at degenerate scales,
  and absorbs rigid residual-gauge jumps (Horn best-fit gate).
- **`sideview.js`** — the moduli-space side view, in two layers: a pure,
  Node-safe geometry/probe layer (`centralRadius`, `flowState`,
  `probeExteriorMap`, …) imported by the harness, and a browser-only
  `makeSideView(host, opts)` three.js factory (null without global THREE)
  that renders spheres, flow dot, guide arc, paraboloids and highlights.
- **`widget.js`** — the display layer: DOM construction, sliders, beta
  panel + chamber-slice plots, matrix readout, polygon/SL(2,C) three.js
  views, stratum mode with gauge-aligned morphs, palettes. ORDER-SENSITIVE
  `activate()` (TDZ hazards: setup code referencing later `const` takes the
  whole widget down silently); solver math lives in solver.js, not here.
- **`tutorial.js`** — the lesson state machine: lesson list with task
  predicates (live Next gating), a control-gating enable-set, the anchored
  lesson card (`reposition`), and enter/exit that restores the free-play
  state. No solver coupling; subscribes to existing widget events only.

## Invariants (do not break)

- **Gauge freedom:** the solver output is defined only up to a residual
  `U(2) x U(1)^4` gauge. NEVER compare raw `(x, y)` matrices between
  versions or datasets; compare gauge-invariant quantities — per-leg
  `|y_i|^2`, per-vertex norms/edge lengths of the su(2) polygon, and the
  moment-map residuals of both representations.
- **Bit-exact historical paths:** star-3 / cycle-0 chambers and the default
  STAR ansatz must stay bit-exact across any solver change (`star.mjs` /
  `cycle.mjs` / `validate.mjs` assert this).
- **`beta_U1` = user beta** under either `PERMUTE_23` setting: the widget's
  beta pre-swap pairs with the solver's `permute = true` output swap and
  the two cancel in the display; displayed leg j IS user leg j either way.

## Running the gates

- `bash dev/hyperpolygon/run-validation.sh` — copies the live modules into
  the dev folder and runs every battery (sweep, walls, sideview, edge,
  locus, exterior, stratum, star, cycle, orient, validate). **Exit 1 on
  failure**, ~22 s. This is the gate to run after ANY change.
- `node dev/hyperpolygon/fingerprint.mjs check` — bit-exact behavioral
  fingerprint vs `fingerprint-golden.json` (fixed input grid, full
  precision, machine-local golden). On ANY diff it exits 1 and prints the
  offending line. Regenerate with `node fingerprint.mjs golden` ONLY on an
  intentional, enumerated behavior change (regeneration on an accidental
  change silently blesses the regression). Machine-local golden: not
  portable across V8 versions, and NOT part of run-validation.sh.
- `node dev/hyperpolygon/bench.mjs` — hot-path micro-benchmarks (per-op
  ms for the solve, orientor, chamber and side-view probes). Run before
  and after a change to compare; no pass/fail.

## /tmp harnesses (uncommitted, re-creatable)

The DOM/THREE stub harness (`/tmp/kilo/hx` + `/tmp/kilo/widget-stub.mjs`)
runs `widget.js activate()` end-to-end headlessly — it is the only check
that catches the TDZ/setup-order hazards Node `--check` cannot see — and
covers stratum enter/leave, morphs and button gates
(`failures = 0` expected). The tutorial smoke
(`/tmp/kilo/tut-test.mjs` against `/tmp/kilo/tut.mjs`) walks all lessons
including ordering/gating/Back/exit. Both live in /tmp on purpose; see
`AGENTS.md` for the stub-harness gotchas. One tutorial check pair is
known-stale ("2 FAILURES" is the expected green).

## Accepted duplication (harness-only)

`cAbs2` is re-declared in 8 battery files and `fmtBeta` in 2
(sideview.mjs, walls.mjs). Accepted: each battery is a self-contained
checker; sharing helpers across batteries would couple their failure
modes and the duplication is trivial. Do not "fix" without a reason.
