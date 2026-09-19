# Tutorial (task #24) — design checkpoint

## User decisions (2026-09-17)
- Card: ANCHORED near the control being taught when feasible, corner-dock fallback.
- Gauge mini-game (7 sliders): MOVED OUT of the tutorial (user, 2026-09-17) —
  a FUTURE separate "How it works" explainer with its own button next to
  Tutorial (task #25 in AGENTS.md). See the AGENTS.md plan section; the notes
  below are kept for that future task.
- Progress: session-only, NO localStorage. Exit restores free-play default state
  (r = 0.25, default beta, ALL controls enabled, stratum left) and discards progress.
- Narrow layouts: bottom dock under ~700px (container width, same threshold style
  as the beta grid).

## Gauge mini-game (now task #25, "How it works" explainer)
User words: "I want to start with a stable polygon (like a simple one in the
ansatz we used for the solve) and have the user try to find a *complex* gauge
transformation to solve the equations using sliders. An edge should become
highlighted when it's the correct length, but changing another slider could
ruin it. They should be able to 'give up' and the site uses the solver to find
the correct slider positions. Caveat: the gauge group is too high dimensional
to do this for real — special case with 7 sliders."

Interpretation (TO CONFIRM WITH USER at milestone 2): the 7 sliders drive the
7 free complex entries of y (the 7x7 linear system of the star ansatz), the
user tweaks them by hand trying to zero the moment-map residuals; the matching
polygon edge highlights when its length/moment condition is met; "give up"
animates the sliders to the solver's values and morphs the polygon to the
balanced representative. Design details (real vs complex slider pairs, exact
residual split per edge) settle at build time.

## Widget hook points (from explore session, widget.js line refs)
- activate() :456-2114; entry :2116-2123; page loads three.js + widget.js from
  _projects/hyperpolygon_moduli_spaces.md :26-30. All CSS runtime-injected via
  ensureSliderStyles() :271 (style id hyperpolygon-slider-styles).
- Controls: rInput :1459, thetaInput :1464, tInput :1480 (+tCol :1497),
  phiInput :1515, betaInputs :1867 (display order swap :1937), limBtn :1559,
  slDetails :734, per-chamber Cross Wall buttons chamberBoxes[k].btn :1966.
- All solver-driving inputs call scheduleSolve() :1402; loop() :2067 runs
  solveAndDraw + refreshSide each frame.
- Stratum: enterStratum :1584 / leaveStratum :1614 (state `stratum` :1547);
  crossWall(k) :2023; lastSideState :1569 (side flowState incl. `att`).
- TDZ order: phiInput is the historical trap (declared :1515); registry +
  tutorial setup must be inserted AFTER :2041 (initial syncBetaSliders) and
  BEFORE loop() start :2113.
- No event bus exists — add a `hooks` object (onCrossWall / onStratum /
  onFrame / onSide) fired at the tails of crossWall / enterStratum /
  leaveStratum / loop / refreshSide. Declare `hooks` early (right after
  `beta` :461) so all fire sites see it.
- Reusable display machinery for the gauge game: kabschRotation :127,
  liftSU2 :225, rotatePair :236 (module scope); inside activate(): displayedState()
  :1234, writePolygonGeometry :1169, morph state :1040 + morphBlend :1209.

## Milestones
1. DONE (2026-09-17): Tutorial button + control-gating registry + tutorial.js
   state machine + card (anchored / dock fallback / bottom dock <700px) +
   lessons 0-2. Stub harness rebuilt in /tmp/kilo/hx; full suite green.
2. DONE (2026-09-17): gauge lesson (old #3) DROPPED per user — phi stays
   gated until the recap, lessons renumbered 0-6 — and lesson 3
   (beta/chamber) implemented: drag a beta slider to a red-zone end until
   an inequality box turns amber; unlocks Cross Wall + lim; CARD DOCKING
   FIX: the card docks below the anchor's OWNING panel (Moduli
   Coordinates / Parameters) with the container's bottom padding reserved
   to the card height, so it never covers a control. Stub harness extended
   (panel-dock placement, padding reserve/release, beta-wall task) + green;
   full suite exit 0.
3. Lessons 4-6 (wall-crossing, strata, free play) — placeholders.
4. "How it works" explainer = the gauge mini-game (task #25, separate).

Full suite must stay green after every milestone; the stub harness (DOM/THREE,
/tmp, uncommitted) must run activate() end to end incl. tutorial enter/exit
mid-lesson and exit mid-morph/mid-stratum.
