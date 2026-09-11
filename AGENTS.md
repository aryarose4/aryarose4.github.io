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
  module. API: `makeHyperpolygon(r, theta, t, beta)` returns
  `{x, y, vertices, sl2, accuracy}`; `vertices` = 9 su(2) polygon
  points (index 8 is the closure error), `sl2` = real/imag SL(2,C)
  polygons (5 points each), `accuracy` = `{su2Norm, muU1Error, muCNorm,
  usedStable}`.
- `mathematica/` — reference notebooks and legacy data. Excluded from
  the Jekyll build; `mathematica/hyperpolygonData*` is gitignored
  (137 MB file, over GitHub's limit). `generateHyperpolygonData.wls`
  is an abandoned draft — do not debug it unless asked.
- `dev/hyperpolygon/` — Node validation harness:
  - `run-validation.sh` — copies the live solver in and runs everything
  - `sweep.mjs` — randomized robustness (200 pts x 3 beta sets)
  - `edge.mjs` — r=1 edge cases
  - `validate.mjs` — spot-checks vs `mathematica/hyperpolygonDataPolar`
    (only works where that 137 MB file exists)

## Validation expectations

- `sweep.mjs`: worst su(2) residual ~1e-11, worst mu_U1 <= 1e-9,
  mu_C ~1e-15, slowest solve a few ms, stable path never needed.
- `validate.mjs`: gauge-invariant diffs ~1e-9 where the legacy data was
  accurate; ~1e-4 differences are expected where the legacy data sat at
  its own solver tolerance (notably `r=1, t~0.5`, where the legacy file
  itself has su2 residual 7.3e-4).
- Browser perf budget: one solve must stay well under 10 ms so sliders
  can re-solve on every input event.

## Status / next milestone

- DONE: solver port + validation against legacy data (milestones 1-2).
- NEXT (milestone 3): interactive three.js widget on
  `_projects/hyperpolygon_moduli_spaces.md`:
  - vendor three.js under `assets/js/hyperpolygon/lib/` (site vendors
    libs locally, no CDN)
  - sliders for `r`, `theta`, `t` and numeric inputs for the 4 betas;
    re-solve + redraw on input (solver is fast enough live)
  - draw the su(2) hyperpolygon (9-point polyline, alternating colors
    for x-edges and y-edges as in the notebooks) and optionally the
    SL(2,C) real/imaginary pair
  - theme-consistent: deferred scripts, dark-mode-aware colors,
    purgecss-safe CSS, responsive container
  - fill in the stub project page with a short math explanation