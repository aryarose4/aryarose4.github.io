// Side-view geometry for the hyperpolygon moduli space (task-list item 5):
// the (r, theta, t) portrait as a central 2-sphere with three exterior
// 2-spheres attached at the theta = 0 meridian points r = 0, 0.5, 1, plus
// the flow picture — a black dot that climbs off the central
// sphere along the paraboloid normal direction as t grows (central
// branch), or rides an exterior sphere from its attachment point toward
// the antipode as t grows (exterior branch).
//
// All label/index math is in USER leg indexing: under EITHER widget call
// pattern — the PERMUTE_23 = true pattern (makeHyperpolygon(r, theta, t,
// [b0, b1, b3, b2], true), where the widget's beta pre-swap and the solver's
// output swap cancel) or the current PERMUTE_23 = false pattern (beta
// unchanged, permute = false) — a displayed polygon leg index j IS user
// beta leg j (see the PERM note below and the walls.mjs [E] regression).
//
// Dependency-free ES module. Node-safe: THREE is only touched inside
// makeSideView (browser-only), guarded like widget.js guards its setup —
// the pure geometry above it never references THREE.

import { makeHyperpolygon, PERMUTE_23 } from "./solver.js";

// Central 2-sphere size from the user's formula (2026-09-13; the absolute
// value added the same day per the user's correction — z_max - z_min can be
// NEGATIVE, exactly when a leg is dominant, and the area is its magnitude,
// so the central sphere never vanishes on that account). All in USER leg
// indexing (which is the displayed indexing under EITHER PERMUTE_23
// setting, so the formula is insensitive to that flag — no conversion is
// ever applied to beta in this module):
//   z_max = min(|b0 + b3|, |b1 + b2|)
//   z_min = max(|b3 - b0|, |b2 - b1|)
//   tau_central = (PI/2) * |z_max - z_min|,  radius = sqrt(tau / (4 PI)).
export function centralArea(beta) {
  const zMax = Math.min(Math.abs(beta[0] + beta[3]), Math.abs(beta[1] + beta[2]));
  const zMin = Math.max(Math.abs(beta[3] - beta[0]), Math.abs(beta[2] - beta[1]));
  return (Math.PI / 2) * Math.abs(zMax - zMin);
}

// Central-sphere radius from the area: area = 4 PI r^2. The 1e-9 floor
// guards degenerate corners where z_max = z_min exactly.
export function centralRadius(beta) {
  const r = Math.sqrt(centralArea(beta) / (4 * Math.PI));
  return r >= 1e-9 ? r : 1e-9;
}

// The three exterior-sphere attachment points, all on the theta = 0
// (+x) meridian: (r, theta, t) = (0, 0, 0) south pole, (0.5, 0, 0)
// equator, (1, 0, 0) north pole.
export const attachmentRs = [0, 0.5, 1];

// Paraboloid shape constants. phi(t) = atan(PHI_K * t / (1 - t)) opens
// gently (PHI_K = 0.5 puts phi ~ 0.46 rad at t = 0.5) and saturates at
// PHI_CAP = 80 deg near t ~ 0.92, so the dot stops climbing before the
// paraboloid gets cartoonishly steep. PARAB_FOCAL sets the scale:
// surface z_local = rho^2 / (2 * PARAB_FOCAL) above the apex. 0.6 -> 0.3
// on user request (2026-09-13), then 0.3 -> 0.1 ("even thinner") the same
// day: the drawn paraboloid radius is rhoMax = PARAB_FOCAL * tan(PHI_CAP).
export const PARAB_FOCAL = 0.1;
export const PHI_K = 0.5;
export const PHI_CAP = (80 * Math.PI) / 180;

// Exterior branch: t at or beyond this shows the "lim t -> infinity"
// regime (the widget owns the button/state; this is the data).
export const T_NEAR_INF = 0.9;

// I-stratum paraboloid (the "lim t -> infinity" target, kissed by the active
// exterior sphere at its tip/antipode). The surface is a paraboloid of
// revolution with apex at the tip, axis = the attachment's outward normal,
// focal length PARAB_FOCAL — the SAME focal length as the central-branch
// paraboloids (user request 2026-09-15), so the higher strata are longer
// paraboloids. User request 2026-09-15: the dot's climb phi(t1) =
// atan(PHI_K_STRAT * t1/(1-t1)) saturates at the SAME PHI_CAP as the
// central branch, so t1 -> 1 carries the dot all the way out to the drawn
// paraboloid's rim (mesh radius f*tan(PHI_CAP)) instead of stopping
// partway up.
// Visibility (the widget owns entering; this is the data): the ghost fades
// in over t in [T_PEEK_LO, T_PEEK_HI] (opacity at the unhighlighted state)
// while the dot nears the tip, and the mesh turns highlight-white once the
// stratum branch is active. Like the central paraboloids the meshes are
// grey/white (the sphere palette): grey while the dot has not started
// climbing, white once it has (makeSideView's loop).
export const PHI_K_STRAT = 0.5;
export const T_PEEK_LO = 0.9;
export const T_PEEK_HI = 0.97;
// The old stratum ghost opacity (STRAT_GHOST_OPACITY) is gone — the unified
// two-state styling in makeSideView uses EXT_UNHI_OPACITY (2026-09-15).

// Highlight-lag time constant (seconds): the exponential-lag glow factor
// 1 - exp(-dt/GLOW_TAU) shared by the exterior-sphere, central-sphere,
// stratum and central-paraboloid highlight weights (~80 ms lag).
const GLOW_TAU = 0.08;
function glowFactor(dt) {
  return 1 - Math.exp(-dt / GLOW_TAU);
}

// Task 5 (2026-09-15): the central -> exterior flow transition. The central
// branch captures toward a mapped attachment whenever (r, theta) sits
// within the capture band of it: poles measure |r - 0| / |r - 1| against
// CAP_BAND_R (theta is degenerate there), the equator measures
// max(|r - 0.5|/CAP_BAND_R, |theta|/CAP_BAND_TH). The bands are tuned to
// the widget's snaps (r snaps to 0.5 within +-0.02, theta to 0 within
// ~0.094 rad), so the pre-snap state is already mostly captured and the
// snap lands smoothly. The capture weight is a smoothstep from 0 (band
// edge) to just under 1 (the attachment itself, where the exact exterior
// branch takes over); the dot and guide arc blend continuously from the
// central paraboloid climb onto the exterior-sphere meridian — shifted to
// start at the CURRENT (r, theta) sphere point, so the t = 0 dot marker
// never moves — making entering an exterior sphere a smooth glide instead
// of a branch jump. CAP_NEAR_INF_W: capture weights above this count as
// "on the sphere" for the lim t -> infinity affordance.
export const CAP_BAND_R = 0.1;
export const CAP_BAND_TH = 0.3;
export const CAP_NEAR_INF_W = 0.5;

// Widget solve permutation, exported for the harness/spec. NOTE (measured,
// and the walls.mjs [E] regression): under the PERMUTE_23 = true pattern the
// widget's PRE-swap of beta legs 2/3 plus the solver's POST-swap of the
// returned pair cancel each other, so a displayed polygon leg index j
// corresponds to USER beta leg j — no conversion is applied anywhere in
// this module. PERM is its own inverse, which is why the double swap is the
// identity. With PERMUTE_23 = false (current setting) the widget passes beta
// unchanged and permute = false, so no swap happens at all and the same
// leg-j-is-user-leg-j statement holds; this module's probe follows the flag
// (see measureSlots).
export const PERM = [0, 1, 3, 2];

const Y_HAT = [0, 1, 0];

// Guide-arc sample count, SHARED by the pure flow layer (flowState's arc
// sampling below) and the browser factory (makeSideView's arcPos buffer
// and setArc's loop — one constant instead of three literals to keep in
// sync). setArc clamps a longer st.arc by repeating its last point.
const ARC_N = 33;

// Attachment-point parallel-pair probe thresholds: a slot qualifies when
// its pair sine is < PARALLEL_TOL and at least PARALLEL_RATIO times
// smaller than the runner-up slot's (both chamber-short slots; the
// measured margins are ~1e4 or better). PARALLEL_TOL is EXPORTED and
// shared with widget.js's polygon-view straight-pair highlight
// (PAIR_SINE_TOL) so the two views cannot disagree about which pair is
// straight.
export const PARALLEL_TOL = 1e-3;
const PARALLEL_RATIO = 10;
// Retry theta when the theta = 0 solve is unusable: the documented
// theta = 0 stall basin extends to at least 1e-8 but is clean by 1e-6,
// and the geometric parallel-pair residual grows only ~linearly in
// theta, so 1e-4 stays under PARALLEL_TOL while escaping the basin.
const PROBE_THETA_RETRY = 1e-4;

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale3(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function len3(a) {
  return Math.sqrt(dot3(a, a));
}

// Unit vector along a (or null when degenerate — callers substitute a
// fallback axis, e.g. +x when the yHat-perpendicular frame vanishes at
// the sphere poles).
function unit3(a) {
  const n = len3(a);
  if (n < 1e-12) return null;
  return [a[0] / n, a[1] / n, a[2] / n];
}

// Point on the central sphere of radius R, polar angle measured from the
// south pole: r = 0 is (0, -R, 0), r = 1 is (0, R, 0), theta = 0 the +x
// meridian. R is required (callers pass centralRadius(beta)).
export function spherePoint(r, theta, R) {
  const psi = Math.PI * r;
  return [R * Math.sin(psi) * Math.cos(theta), -R * Math.cos(psi), -R * Math.sin(psi) * Math.sin(theta)];
}

// (PI/2) * (sum of beta off I - sum over I). Chamber shorts guarantee a
// nonnegative value; clamp guards fp noise at wall-touch tuples.
export function pairArea(beta, I) {
  let inSum = 0;
  let outSum = 0;
  for (let n = 0; n < 4; n++) {
    if (I.indexOf(n) === -1) outSum += beta[n];
    else inSum += beta[n];
  }
  const d = outSum - inSum;
  return (Math.PI / 2) * (d > 0 ? d : 0);
}

// Exterior-sphere radius from the pair area: area = 4 PI r^2.
export function pairRadius(beta, I) {
  return Math.sqrt(pairArea(beta, I) / (4 * Math.PI));
}

// Unit outward frame at a central-sphere point p: u = the yHat direction
// made tangent (the +x meridian direction where theta = 0), v = n x u.
// u degenerates only at the poles, where the fallback [1, 0, 0] keeps
// the frame right-handed and continuous with the theta = 0 meridian.
function tangentFrame(p) {
  const n = unit3(p);
  let u = unit3(sub3(Y_HAT, scale3(n, dot3(Y_HAT, n))));
  if (!u) u = [1, 0, 0];
  return { n: n, u: u, v: cross3(n, u) };
}

// The core flow state. Branch selection: an attachment point k "owns"
// the flow when (r, theta) sits on it — poles accept any theta (theta is
// degenerate there), the equator needs theta ~ 0. t is the RAW slider
// value (1 allowed; the widget's T_SOLVE_MAX clamp is its own business).
// gamma (task 3, optional, default 0) is the U(1) phase on y: on the
// moduli portrait it rotates the dot along the LEVEL CIRCLES of the
// exterior sphere (around the attachment-point axis n) or of the
// paraboloid (around the apex normal n). The rotation leaves every t = 0
// point fixed (the attachment point / paraboloid apex lies ON the
// rotation axis), matching the fact that the U(1) action fixes t = 0.
// gamma = 0 is a bit-exact no-op (cos 0 = 1, sin 0 = 0, guarded).
// stratum (optional, default null) = { k, t1 }: the widget's stratum mode.
// When non-null and the attachment geometry validates, the STRATUM branch
// is returned: the dot rides the stratum paraboloid kissing the exterior
// sphere's tip (antipode), positioned by t1 along the meridian and gamma
// around it. The exterior branch ALSO carries the stratum frame (field
// `stratum`) so the side view can draw the ghost paraboloid near the tip.
// Off the attachments the CENTRAL branch runs; within the capture band
// (CAP_BAND_R / CAP_BAND_TH) of a mapped attachment it carries a
// `capture` = { k, S, w, attachment } (task 5): the dot/arc blend
// continuously onto that sphere's meridian with weight w, and the
// captured sphere's stratum frame rides along for the ghost.
// Returns null on any non-finite input; never throws for finite input.
export function flowState(r, theta, t, beta, chamberShorts, extMap, gamma, stratum) {
  if (!Number.isFinite(r) || !Number.isFinite(theta) || !Number.isFinite(t)) return null;
  if (!beta || beta.length !== 4) return null;
  for (let i = 0; i < 4; i++) if (!Number.isFinite(beta[i])) return null;
  const g = Number.isFinite(gamma) ? gamma : 0;

  // Central-sphere size follows beta (centralArea formula above); every
  // attachment point, exterior center and paraboloid apex sits on THIS R.
  const R = centralRadius(beta);

  // Shared exterior-sphere frame builder for attachment k (used by the
  // exact exterior branch below and by the central branch's capture
  // blend; identical formulas, so both paths keep the pre-refactor
  // bit-exact values the batteries assert).
  function attachFrame(k) {
    const S = extMap ? extMap[k] : null;
    if (S === null || S === undefined) return null;
    const I = chamberShorts ? chamberShorts[S] : null;
    if (!I || I.length !== 2) return null;
    let rk = pairRadius(beta, I);
    if (!(rk >= 1e-9)) rk = 1e-9;
    const p = spherePoint(attachmentRs[k], 0, R);
    const n = unit3(p);
    // Side direction: yHat made tangent to the central sphere at p; at
    // the poles that is zero, so fall back to +x (the theta = 0 tangent).
    // gamma rotates the side direction about the sphere axis n — the dot
    // and the guide arc ride the rotated meridian (a level circle of the
    // exterior sphere); the attachment (t = 0) and antipode stay fixed.
    let w = unit3(sub3(Y_HAT, scale3(n, dot3(Y_HAT, n))));
    if (!w) w = [1, 0, 0];
    if (g !== 0) {
      const cg = Math.cos(g);
      const sg = Math.sin(g);
      const ax = cross3(n, w);
      w = [cg * w[0] + sg * ax[0], cg * w[1] + sg * ax[1], cg * w[2] + sg * ax[2]];
    }
    const c = add3(p, scale3(n, rk));
    // The I-stratum paraboloid frame at this attachment: apex at the tip
    // (antipode), axis n, meridian u = -w (the climb's arrival direction,
    // so the stratum flow continues the sphere climb smoothly at t1 = 0).
    // The DRAWN geometry extends as far as the central paraboloids (mesh
    // radius f*tan(PHI_CAP)); the dot's climb saturates at that same
    // PHI_CAP (user request 2026-09-15), so t1 -> 1 reaches the drawn rim.
    const strat = {
      apex: add3(p, scale3(n, 2 * rk)),
      u: [-w[0], -w[1], -w[2]],
      v: cross3(n, [-w[0], -w[1], -w[2]]),
      n: n,
      f: PARAB_FOCAL,
      cap: PHI_CAP,
      rk: rk,
    };
    return { S: S, I: I, rk: rk, p: p, n: n, w: w, c: c, strat: strat };
  }

  for (let k = 0; k < 3; k++) {
    const onR = Math.abs(r - attachmentRs[k]) <= 1e-9;
    const onTheta = k === 1 ? Math.abs(theta) <= 1e-9 : true;
    if (!onR || !onTheta) continue;
    const fr = attachFrame(k);
    if (!fr) continue;
    // stratum mode (widget parks r/theta/t at the attachment, so the same
    // on-attachment gate applies): { k, t1 } selects this sphere's stratum
    const stratumHere =
      stratum && stratum.k === k && Number.isFinite(stratum.t1) ? stratum : null;

    if (stratumHere) {
      const t1 = Math.min(Math.max(stratumHere.t1, 0), 1);
      let phi = t1 <= 0 ? 0 : t1 >= 1 ? PHI_CAP : Math.atan((PHI_K_STRAT * t1) / (1 - t1));
      if (phi > PHI_CAP) phi = PHI_CAP;
      const rhoMax = fr.strat.f * Math.tan(PHI_CAP);
      const climbStrat = (ph) => {
        const rho = Math.min(fr.strat.f * Math.tan(ph), rhoMax);
        const z = (rho * rho) / (2 * fr.strat.f);
        return [
          fr.strat.apex[0] + rho * fr.strat.u[0] + z * fr.n[0],
          fr.strat.apex[1] + rho * fr.strat.u[1] + z * fr.n[1],
          fr.strat.apex[2] + rho * fr.strat.u[2] + z * fr.n[2],
        ];
      };
      const arc = [];
      for (let i = 0; i < ARC_N; i++) arc.push(climbStrat((phi * i) / (ARC_N - 1)));
      return {
        kind: "stratum",
        slot: fr.S,
        att: k,
        dot: climbStrat(phi),
        exterior: { center: fr.c, radius: fr.rk, normal: fr.n, side: fr.w, attachment: fr.p },
        paraboloid: null,
        stratum: fr.strat,
        capture: null,
        arc: arc,
        nearInfinity: true,
        t1: t1,
      };
    }

    const climb = (alpha) => {
      const ca = Math.cos(alpha);
      const sa = Math.sin(alpha);
      return [fr.c[0] + fr.rk * (-ca * fr.n[0] + sa * fr.w[0]), fr.c[1] + fr.rk * (-ca * fr.n[1] + sa * fr.w[1]), fr.c[2] + fr.rk * (-ca * fr.n[2] + sa * fr.w[2])];
    };
    const arc = [];
    for (let i = 0; i < ARC_N; i++) arc.push(climb((Math.PI * i) / (ARC_N - 1)));
    return {
      kind: "exterior",
      slot: fr.S,
      att: k,
      dot: climb(Math.PI * t),
      exterior: { center: fr.c, radius: fr.rk, normal: fr.n, side: fr.w, attachment: fr.p },
      paraboloid: null,
      stratum: fr.strat,
      capture: null,
      arc: arc,
      nearInfinity: t >= T_NEAR_INF,
    };
  }

  // Central branch: the dot climbs the paraboloid z = rho^2/(2f) tangent
  // at p, opening along +n. phi(t) rises from 0 and saturates at PHI_CAP.
  // gamma rotates the guide meridian u (and v with it) about the apex
  // normal n: the dot moves along level circles of the paraboloid; the
  // apex (t = 0) stays fixed. The drawn paraboloid is a surface of
  // revolution about its own axis, so its point set is gamma-invariant.
  const p = spherePoint(r, theta, R);
  const frame = tangentFrame(p);
  const n = frame.n;
  let u = frame.u;
  let v = frame.v;
  if (g !== 0) {
    const cg = Math.cos(g);
    const sg = Math.sin(g);
    const ax = cross3(n, u);
    u = [cg * u[0] + sg * ax[0], cg * u[1] + sg * ax[1], cg * u[2] + sg * ax[2]];
    v = cross3(n, u);
  }
  let phi = t <= 0 ? 0 : t >= 1 ? PHI_CAP : Math.atan((PHI_K * t) / (1 - t));
  if (phi > PHI_CAP) phi = PHI_CAP;
  const rhoMax = PARAB_FOCAL * Math.tan(PHI_CAP);
  const climb = (ph) => {
    const rho = Math.min(PARAB_FOCAL * Math.tan(ph), rhoMax);
    const z = (rho * rho) / (2 * PARAB_FOCAL);
    return [p[0] + rho * u[0] + z * n[0], p[1] + rho * u[1] + z * n[1], p[2] + rho * u[2] + z * n[2]];
  };
  const arc = [];
  for (let i = 0; i < ARC_N; i++) arc.push(climb((phi * i) / (ARC_N - 1)));

  // Task 5: capture toward a mapped attachment within the capture band —
  // the flow hands over to that exterior sphere continuously (a smoothstep
  // blend of the dot and the guide arc from the central paraboloid climb
  // onto the sphere's meridian), instead of switching branches at the
  // attachment. Poles measure |r - attachment| against CAP_BAND_R (theta
  // is degenerate there); the equator measures max(|r - 0.5|/CAP_BAND_R,
  // |theta|/CAP_BAND_TH). The exterior climb is SHIFTED to start at the
  // current sphere point p (not the attachment), so at t = 0 the captured
  // dot is exactly p — the capture never displaces the t = 0 marker — and
  // as (r, theta) -> the attachment the shift vanishes and the exact
  // exterior branch takes over.
  let cap = null;
  for (let k = 0; k < 3; k++) {
    const ar = attachmentRs[k];
    const d = k === 1 ? Math.max(Math.abs(r - ar) / CAP_BAND_R, Math.abs(theta) / CAP_BAND_TH) : Math.abs(r - ar) / CAP_BAND_R;
    if (!(d < 1)) continue;
    const fr = attachFrame(k);
    if (!fr) continue;
    const x = 1 - d;
    const wgt = x * x * (3 - 2 * x);
    if (cap !== null && wgt <= cap.w) continue;
    const shift = sub3(p, fr.p);
    const climbExt = (alpha) => {
      const ca = Math.cos(alpha);
      const sa = Math.sin(alpha);
      return [fr.c[0] + fr.rk * (-ca * fr.n[0] + sa * fr.w[0]), fr.c[1] + fr.rk * (-ca * fr.n[1] + sa * fr.w[1]), fr.c[2] + fr.rk * (-ca * fr.n[2] + sa * fr.w[2])];
    };
    const extArc = [];
    for (let i = 0; i < ARC_N; i++) extArc.push(add3(climbExt((Math.PI * i) / (ARC_N - 1)), shift));
    cap = { k: k, S: fr.S, w: wgt, attachment: fr.p, dot: add3(climbExt(Math.PI * t), shift), arc: extArc, strat: fr.strat };
  }
  if (cap) {
    const wt = cap.w;
    const lp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    return {
      kind: "central",
      slot: null,
      dot: lp(climb(phi), cap.dot, wt),
      exterior: null,
      paraboloid: { apex: p, u: u, v: v, n: n, f: PARAB_FOCAL, cap: PHI_CAP },
      stratum: cap.strat,
      capture: { k: cap.k, S: cap.S, w: wt, attachment: cap.attachment },
      arc: arc.map((q, i) => lp(q, cap.arc[i], wt)),
      nearInfinity: wt >= CAP_NEAR_INF_W && t >= T_NEAR_INF,
    };
  }
  return {
    kind: "central",
    slot: null,
    dot: climb(phi),
    exterior: null,
    paraboloid: { apex: p, u: u, v: v, n: n, f: PARAB_FOCAL, cap: PHI_CAP },
    stratum: null,
    capture: null,
    arc: arc,
    nearInfinity: false,
  };
}

// Which chamberShorts pair slot (5, 6 or 7) is the parallel pair at each
// attachment point. Measured, not assumed: at each attachment the
// widget-exact solve (gated on PERMUTE_23 — swapped beta + permute = true,
// or beta unchanged + permute = false) is taken at
// t = 0, the 8 polygon edges are grouped into legs (edges (2j, 2j+1),
// which for either pattern are the user legs directly — see the PERM
// note), and for each of the chamber's pair-shorts the residual is the
// min over the valid edge-cross combinations of the sine of the angle
// between the two edges (zero-length edges are skipped — at t = 0 each
// leg's second edge collapses; a slot with no valid combo reads
// Infinity). The winning slot needs residual < PARALLEL_TOL and a
// PARALLEL_RATIO margin over the runner-up; on failure the measurement
// retries at a small theta (the documented theta = 0 solver stall
// basin), else the attachment maps to null. By the solver's coherent
// attachment assignment (starSig / cycleSig, 2026-09-14) the result is the
// chamber-INDEPENDENT slot map [7, 5, 6] under the unpermuted call pattern
// in EVERY interior chamber — south carries the chamber's short side of
// split {0,3}|{1,2}, equator of {0,1}|{2,3}, north of {0,2}|{1,3} — so
// crossing a pair wall transfers only the crossed point's pair to its
// complement ([6, 5, 7] under the permuted pattern; see PERMUTE_23 in
// solver.js), with the parallel pair being that chamber's short side — see
// dev/hyperpolygon/sideview.mjs [P]. Runs 3-6 solves, so call it on
// beta changes, not per frame.
export function probeExteriorMap(beta, chamberShorts) {
  const map = [null, null, null];
  const detail = [];
  for (let k = 0; k < 3; k++) {
    const entry = { theta: 0, residuals: [Infinity, Infinity, Infinity], retried: false };
    detail.push(entry);
    let got = null;
    for (let attempt = 0; attempt < 2 && got === null; attempt++) {
      const theta = attempt === 0 ? 0 : PROBE_THETA_RETRY;
      entry.theta = theta;
      entry.retried = attempt === 1;
      const res = measureSlots(attachmentRs[k], theta, beta, chamberShorts);
      if (res === null) continue;
      entry.residuals = res;
      let best = -1;
      for (let s = 0; s < 3; s++) {
        if (best === -1 || res[s] < res[best]) best = s;
      }
      if (best === -1 || !(res[best] < PARALLEL_TOL)) continue;
      let runnerUp = Infinity;
      for (let s = 0; s < 3; s++) if (s !== best && res[s] < runnerUp) runnerUp = res[s];
      if (res[best] * PARALLEL_RATIO > runnerUp) continue;
      got = 5 + best;
    }
    map[k] = got;
  }
  return { map: map, detail: detail };
}

// Per-slot parallelism residuals at (r, theta, t = 0) with the
// widget-exact call pattern (gated on PERMUTE_23); null on solve failure
// or NaN vertices.
function measureSlots(r, theta, beta, chamberShorts) {
  const betaSolve = PERMUTE_23 ? [beta[0], beta[1], beta[3], beta[2]] : beta;
  let res;
  try {
    res = makeHyperpolygon(r, theta, 0, betaSolve, PERMUTE_23);
  } catch (e) {
    return null;
  }
  const V = res.vertices;
  for (let i = 0; i < V.length; i++) {
    if (!Number.isFinite(V[i][0]) || !Number.isFinite(V[i][1]) || !Number.isFinite(V[i][2])) return null;
  }
  const edges = [];
  for (let i = 0; i < 8; i++) edges.push(sub3(V[i + 1], V[i]));
  // displayed leg j owns edges (2j, 2j+1); under either PERMUTE_23 pattern
  // displayed j IS user leg j (see PERM note)
  const out = [];
  for (let s = 5; s <= 7; s++) {
    out.push(pairSine(edges, chamberShorts[s][0], chamberShorts[s][1]));
  }
  return out;
}

// Min sine of the angle between one edge from displayed leg a and one
// from displayed leg b, over combos where both edges are non-degenerate
// (at t = 0 each leg's second edge has zero length). Infinity when a leg
// has no measurable edge.
function pairSine(edges, a, b) {
  let m = Infinity;
  for (let ia = 0; ia < 2; ia++) {
    for (let ib = 0; ib < 2; ib++) {
      const u = edges[2 * a + ia];
      const v = edges[2 * b + ib];
      const nu = len3(u);
      const nv = len3(v);
      if (nu < 1e-12 || nv < 1e-12) continue;
      const s = len3(cross3(u, v)) / (nu * nv);
      if (s < m) m = s;
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Browser-only side-view factory. Call only when global THREE exists
// (returns null otherwise). Palette keys (getPalette() -> object):
//   sideBg     — clear color as number, or null/undefined for a
//                transparent canvas (default: transparent)
//   sphere     — central 2-sphere color (default 0xffffff)
//   sphereGrey — central 2-sphere color while the dot climbs an exterior
//                sphere (default 0xb0b0b0; palette-driven so light mode can
//                pick a shade that still reads on a white page)
//   ext        — exterior 2-sphere base color (default 0xffffff); the
//                active attachment lerps to extHi
//   extHi      — highlighted (active) exterior sphere / stratum color
//                (default 0xffffff)
//   dot        — black dot color (default 0x000000)
//   parab      — REMOVED 2026-09-15 (task 3); since 2026-09-17 the central
//                paraboloid uses the ext palette exactly like the stratum
//                paraboloid (user request: match the exterior treatment)
//                (the guide arc is dot-colored since 2026-09-16 — no arc key)
//   border     — CSS color for the host border (default "#cfd4da")
//   caption    — host-border color while the view is hovered (default
//                "#666666"; applyColors swaps `border` for it on setHover)
// Lambert-surface factory shared by the sphere / paraboloid materials; the
// full options object passes through unchanged (no injected defaults).
function lambert(opts) {
  return new THREE.MeshLambertMaterial(opts);
}

export function makeSideView(host, opts) {
  if (typeof THREE === "undefined" || typeof THREE.OrbitControls === "undefined") return null;
  opts = opts || {};
  const getPalette = opts.getPalette || function () { return {}; };

  const pal = function () {
    const p = getPalette() || {};
    return {
      sideBg: p.sideBg === undefined ? null : p.sideBg,
      sphere: p.sphere === undefined ? 0xffffff : p.sphere,
      sphereGrey: p.sphereGrey === undefined ? 0xb0b0b0 : p.sphereGrey,
      ext: p.ext === undefined ? 0xffffff : p.ext,
      extHi: p.extHi === undefined ? 0xffffff : p.extHi,
      dot: p.dot === undefined ? 0x000000 : p.dot,
      border: p.border === undefined ? "#cfd4da" : p.border,
      caption: p.caption === undefined ? "#666666" : p.caption,
    };
  };

  host.style.position = host.style.position || "relative";
  host.style.boxSizing = host.style.boxSizing || "border-box";

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
  // Framed for the formula-driven central radius (~0.25 at the widget's
  // default beta, vs the old placeholder 1): pulled in so the portrait
  // fills a comparable fraction of the view. 2026-09-19 user request:
  // noticeably MORE zoomed out for a better initial overview of the whole
  // structure (central + exterior spheres + strata).
  camera.position.set(1.7, 1.0, 2.0);
  camera.lookAt(0, 0, 0);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x777788, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(3, 5, 4);
  scene.add(sun);

  // Central sphere: two states (spec 1) — highlighted (bright, opacity
  // 0.92) while the dot is on the central branch, unhighlighted (0.32)
  // once an exterior sphere or its stratum owns the dot. depthWrite stays
  // off so the opaque dot drawn underneath always shows through the blend.
  const centralMat = lambert({ color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false });
  const central = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), centralMat);
  // initial guess until the widget's first update() supplies beta
  // (0.25 = the default beta's formula radius)
  central.scale.setScalar(0.25);
  scene.add(central);

  // Shared unit-sphere geometry for the three exterior bubbles. Two
  // states only (spec 1): unhighlighted opacity 0.32 (slightly more
  // opaque than the old 0.16 — spheres stay readable at all times), and
  // highlighted 0.92 (the slight transparency still lets the user tell
  // when the black dot is hidden on a sphere's backside).
  const extGeom = new THREE.SphereGeometry(1, 32, 24);
  const extHiCol = new THREE.Color(0xffffff); // palette-driven (applyColors)
  const sphereCol = new THREE.Color(0xffffff); // palette-driven (applyColors)
  const EXT_WHITE_OPACITY = 0.92;
  const EXT_UNHI_OPACITY = 0.32;
  const exts = [];
  for (let k = 0; k < 3; k++) {
    const mat = lambert({ color: 0xffffff, transparent: true, opacity: EXT_UNHI_OPACITY, depthWrite: false });
    const mesh = new THREE.Mesh(extGeom, mat);
    mesh.visible = false;
    scene.add(mesh);
    exts.push({ mesh: mesh, mat: mat, glow: 0 });
  }

  const dotMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.015, 16, 12), dotMat);
  scene.add(dot);

  // Paraboloids: fixed topology, positions recomputed from the flowState
  // frame whenever visible (28 angular x 14 radial grid). One mesh for the
  // central branch's hover/t paraboloid, one for the I-stratum paraboloid
  // at the active exterior sphere's tip.
  // Paraboloid materials: grey/white like the spheres (task 3, 2026-09-15)
  // — grey while the dot has not started climbing, the sphere "white" once
  // it has (both palette-driven so light mode adapts).
  const PARA_A = 28;
  const PARA_R = 14;
  // Fixed-topology paraboloid mesh: a PARA_A x PARA_R polar grid whose
  // vertices fillParaboloid rewrites from the flowState frame; invisible
  // until first filled. Returns {pos, geom, mesh}.
  function makeParaMesh(mat) {
    const pos = new Float32Array(PARA_A * PARA_R * 3);
    const idx = [];
    for (let i = 0; i < PARA_A; i++) {
      for (let j = 0; j < PARA_R - 1; j++) {
        const a0 = i * PARA_R + j;
        const a1 = ((i + 1) % PARA_A) * PARA_R + j;
        idx.push(a0, a1, a0 + 1, a1, a1 + 1, a0 + 1);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.setIndex(idx);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.visible = false;
    scene.add(mesh);
    return { pos: pos, geom: geom, mesh: mesh };
  }
  // Central-paraboloid material (user request 2026-09-17: match the
  // exterior/stratum paraboloids' appearance) — the SAME treatment as
  // stratMat: single-sided (FrontSide; the old DoubleSide shaded the
  // far side through the surface and produced odd shading artifacts)
  // Lambert surface in the ext palette, lerping to the highlight on
  // climb. Same two opacities as the spheres.
  const paraMat = lambert({ color: 0xffffff, transparent: true, opacity: EXT_UNHI_OPACITY, side: THREE.FrontSide, depthWrite: false });
  const para = makeParaMesh(paraMat);
  const paraMesh = para.mesh;
  // Stratum material (2026-09-16): styled EXACTLY like the exterior spheres —
  // single-sided translucent Lambert surface in the exterior-sphere palette
  // (ext base, lerping to the extHi highlight), so the stratum reads as one
  // of the sphere family rather than the old double-sided "half-shaded"
  // shaded dish. Both palette-driven, so light mode adapts.
  const stratMat = lambert({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.FrontSide, depthWrite: false });
  const strat = makeParaMesh(stratMat);
  const stratMesh = strat.mesh;
  let stratGlow = 0;

  // Guide arc (the flow boundary, 2026-09-16): a single clean black line
  // tracing up the surface the dot climbs, replacing the old half-shaded
  // semi-transparent grey arc. Opaque, dot-colored.
  const arcPos = new Float32Array(ARC_N * 3);
  const arcGeom = new THREE.BufferGeometry();
  arcGeom.setAttribute("position", new THREE.BufferAttribute(arcPos, 3));
  const arcMat = new THREE.LineBasicMaterial({ color: 0x000000 });
  const arcLine = new THREE.Line(arcGeom, arcMat);
  scene.add(arcLine);

  let lastState = null;
  let lastShowParab = false;
  let lastT = 0;
  let hovered = false;
  // Central-paraboloid grey/white ramp (task 3): 1 once the dot has
  // started climbing it (t > 0), 0 while it has not.
  let paraClimb = 0;
  // Camera-pan target helpers (task 6).
  const ORIGIN = [0, 0, 0];
  // lerp3 writes into a reused scratch vector (per-frame allocation churn):
  // its only two call sites sit in the camera-pan block of the render loop
  // and consume the result immediately (at most one call per frame), so a
  // single shared buffer is safe. Same values as the old fresh-array return.
  const panTgt = [0, 0, 0];
  function lerp3(a, b, f) {
    panTgt[0] = a[0] + (b[0] - a[0]) * f;
    panTgt[1] = a[1] + (b[1] - a[1]) * f;
    panTgt[2] = a[2] + (b[2] - a[2]) * f;
    return panTgt;
  }
  // Central-sphere highlight state (spec 1): 1 while the dot is on the
  // central branch (scaled down by the capture weight during the
  // handover), 0 once an exterior sphere or stratum owns the dot.
  let centralHi = 0;
  // Placement of every mapped exterior sphere, recomputed in update():
  // each attachment k with extMap[k] != null shows its sphere at
  // center p + rk * n with radius rk (pairRadius of the mapped slot's
  // pair) — the active branch's sphere is the one whose slot matches
  // lastState.slot (the flow state's TOP-level slot) and it glows.
  let extPlacement = [null, null, null];
  let lastExtMap = [null, null, null];
  let disposed = false;

  function applyColors() {
    const p = pal();
    centralMat.color.setHex(p.sphere);
    dotMat.color.setHex(p.dot);
    paraMat.color.setHex(p.ext);
    arcMat.color.setHex(p.dot);
    extHiCol.setHex(p.extHi);
    sphereCol.setHex(p.sphere);
    stratMat.color.setHex(p.ext);
    for (let k = 0; k < 3; k++) exts[k].mat.color.setHex(p.ext);
    if (p.sideBg === null) renderer.setClearColor(0x000000, 0);
    else renderer.setClearColor(p.sideBg, 1);
    host.style.border = "1px solid " + (hovered ? p.caption : p.border);
  }
  applyColors();

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // Guide arc: copy the flowState arc polyline (st.arc) into the shared
  // arcPos buffer — ARC_N samples (shared constant above); a longer st.arc
  // clamps to its last point, a shorter one would leave stale vertices.
  function setArc(st) {
    const a = st.arc;
    for (let i = 0; i < ARC_N; i++) {
      const p = a[Math.min(i, a.length - 1)];
      arcPos[3 * i] = p[0];
      arcPos[3 * i + 1] = p[1];
      arcPos[3 * i + 2] = p[2];
    }
    arcGeom.attributes.position.needsUpdate = true;
    arcGeom.computeBoundingSphere();
  }

  // Fill a makeParaMesh target from the flowState paraboloid frame P
  // ({apex, u, v, n, f, cap}): polar grid, radial extent rhoMax =
  // f*tan(cap) so the drawn mesh reaches the frame's cap radius, height
  // z = rho^2/(2f) above the apex along the normal.
  function fillParaboloid(target, P) {
    const pos = target.pos;
    const geom = target.geom;
    const rhoMax = P.f * Math.tan(P.cap);
    for (let i = 0; i < PARA_A; i++) {
      const ang = (2 * Math.PI * i) / PARA_A;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      for (let j = 0; j < PARA_R; j++) {
        const rho = (rhoMax * j) / (PARA_R - 1);
        const z = (rho * rho) / (2 * P.f);
        const ou = rho * ca;
        const ov = rho * sa;
        const o = 3 * (i * PARA_R + j);
        pos[o] = P.apex[0] + ou * P.u[0] + ov * P.v[0] + z * P.n[0];
        pos[o + 1] = P.apex[1] + ou * P.u[1] + ov * P.v[1] + z * P.n[1];
        pos[o + 2] = P.apex[2] + ou * P.u[2] + ov * P.v[2] + z * P.n[2];
      }
    }
    geom.attributes.position.needsUpdate = true;
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
  }

  // Total update: on any failure or NaN the previous frame's objects are
  // frozen (belt-and-suspenders, same style as widget.js). Returns the
  // flow state (or null) so the widget can drive UI off it (the
  // "lim t -> infinity" button reads nearInfinity without a re-solve).
  // gamma (optional, default 0) is the U(1) level-circle phase — see
  // flowState. stratum (optional, default null) = { k, t1 }: the widget's
  // stratum mode — see flowState's stratum branch.
  function update(r, theta, t, beta, chamberShorts, extMap, showParaboloid, gamma, stratum) {
    let st = null;
    try {
      st = flowState(r, theta, t, beta, chamberShorts, extMap, gamma, stratum);
    } catch (e) {
      st = null;
    }
    if (
      st === null ||
      !Number.isFinite(st.dot[0]) || !Number.isFinite(st.dot[1]) || !Number.isFinite(st.dot[2]) ||
      (st.exterior !== null && !Number.isFinite(st.exterior.radius)) ||
      (st.paraboloid !== null && !Number.isFinite(st.paraboloid.f)) ||
      (st.stratum !== null && st.stratum !== undefined && !Number.isFinite(st.stratum.f))
    ) {
      return null;
    }
    lastState = st;
    lastShowParab = !!showParaboloid;
    lastT = t;
    lastExtMap = extMap || [null, null, null];
    dot.position.set(st.dot[0], st.dot[1], st.dot[2]);
    setArc(st);
    if (lastShowParab && st.paraboloid) fillParaboloid(para, st.paraboloid);
    // stratum paraboloid positions (both the exterior branch's ghost frame
    // and the stratum branch's active frame land here)
    if (st.stratum) fillParaboloid(strat, st.stratum);

    // The central sphere's size follows beta (centralArea formula).
    central.scale.setScalar(centralRadius(beta));

    // Recompute every mapped exterior sphere's placement (the two
    // inactive attachments never appear in flowState's exterior branch).
    const R = centralRadius(beta);
    for (let k = 0; k < 3; k++) {
      const S = lastExtMap[k];
      if (S === null || S === undefined || !chamberShorts[S]) {
        extPlacement[k] = null;
        continue;
      }
      let rk = pairRadius(beta, chamberShorts[S]);
      if (!(rk >= 1e-9)) rk = 1e-9;
      const p = spherePoint(attachmentRs[k], 0, R);
      const n = unit3(p);
      extPlacement[k] = { center: add3(p, scale3(n, rk)), radius: rk };
    }
    return st;
  }

  function setHover(on) {
    // Visual affordance only (border emphasis); the widget decides what
    // hover means for interaction.
    hovered = !!on;
    host.classList.toggle("hp-side-hover", hovered);
    applyColors();
  }

  function refreshTheme() {
    applyColors();
  }

  let lastFrame = performance.now();
  function loop() {
    if (disposed) return;
    requestAnimationFrame(loop);
    const now = performance.now();
    let dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (dt > 0.05) dt = 0.05;
    // one palette read per frame (pal() builds a fresh object; the loop
    // reads it every frame so theme switches stay live)
    const p = pal();

    // Exterior bubbles from the placement recomputed in update(). Spec 1:
    // the highlight tracks the ATTACHMENT INDEX the dot is on (flowState's
    // `att`), not the short-pair slot — so entering one exterior sphere
    // lights exactly that sphere even in chambers where several spheres
    // share one slot. Task 5: a captured central branch (flowState's
    // capture) raises the captured sphere's glow to the capture weight, so
    // the sphere lights up smoothly while the dot blends onto it. Two
    // states only: unhighlighted 0.32, highlighted 0.92 (~80 ms lag).
    // User request 2026-09-16: in stratum mode the exterior sphere
    // co-highlights only AT the tip slice (t1 = 0); as soon as t > 0 the
    // sphere highlight is dropped so the stratum carries the highlight
    // alone.
    const activeAtt = lastState && Number.isInteger(lastState.att) ? lastState.att : -1;
    const capW = lastState && lastState.capture ? lastState.capture.w : 0;
    const capK = lastState && lastState.capture ? lastState.capture.k : -1;
    const stratumOnly =
      lastState && lastState.kind === "stratum" && lastState.t1 > 0;
    for (let k = 0; k < 3; k++) {
      const e = exts[k];
      const place = extPlacement[k];
      const branchTarget = place !== null && k === activeAtt && !stratumOnly ? 1 : 0;
      const capTarget = place !== null && k === capK ? capW : 0;
      const target = Math.max(branchTarget, capTarget);
      e.glow += (target - e.glow) * glowFactor(dt);
      if (place) {
        e.mesh.visible = true;
        e.mesh.position.set(place.center[0], place.center[1], place.center[2]);
        e.mesh.scale.setScalar(place.radius);
        e.mat.opacity = EXT_UNHI_OPACITY + (EXT_WHITE_OPACITY - EXT_UNHI_OPACITY) * e.glow;
        e.mat.color.setHex(p.ext).lerp(extHiCol, e.glow);
      } else {
        e.mesh.visible = false;
        e.glow = 0;
      }
    }

    // Central sphere: two states (spec 1). Highlighted while the dot is on
    // the central branch (the capture weight scales the state for the
    // handover onto an exterior sphere); unhighlighted — same 0.32 form as
    // everything else — once an exterior sphere or its stratum owns the
    // dot. Same ~80 ms lag as the bubbles.
    let centralTarget = lastState && lastState.kind === "central" ? 1 - capW : 0;
    // User request 2026-09-15: the attachment point is where the exterior
    // sphere INTERSECTS the central sphere, so when the dot sits there both
    // spheres highlight together. The exterior climb departs the central
    // surface quadratically in t, so the co-highlight uses a tolerance band
    // around the surface (smoothstep fade) instead of a bare t = 0 test.
    // Every sphere-owning branch (exterior, stratum, captured central)
    // carries stratum.rk — the exterior radius — to scale the band.
    if (lastState && lastState.stratum && lastState.stratum.rk > 0) {
      const tol = Math.max(0.02, 0.25 * lastState.stratum.rk);
      const dC =
        Math.hypot(dot.position.x, dot.position.y, dot.position.z) -
        central.scale.x;
      if (dC < tol) {
        const f = Math.max(0, 1 - dC / tol);
        centralTarget = Math.max(centralTarget, f * f * (3 - 2 * f));
      }
    }
    centralHi += (centralTarget - centralHi) * glowFactor(dt);
    centralMat.color.setHex(p.sphere);
    centralMat.opacity = EXT_UNHI_OPACITY + (EXT_WHITE_OPACITY - EXT_UNHI_OPACITY) * centralHi;

    // I-stratum paraboloid: invisible until the dot nears the exterior
    // sphere's tip (ghost fade-in over [T_PEEK_LO, T_PEEK_HI]), highlight-
    // white once the stratum branch is active (widget's lim t->infinity
    // click). Same ~80 ms lag for the highlight. Task 5: a captured
    // central branch scales the ghost by the capture weight, so the tip
    // paraboloid fades in with the sphere capture rather than at the
    // exact branch switch. The mesh lerps from the ext base to the
    // highlight (extHi) with stratGlow.
    const stratGlowTarget = lastState && lastState.kind === "stratum" ? 1 : 0;
    stratGlow += (stratGlowTarget - stratGlow) * glowFactor(dt);
    let stratGhost = 0;
    if (lastState && lastState.stratum && (lastState.kind === "exterior" || lastState.capture)) {
      const ramp =
        lastT <= T_PEEK_LO
          ? 0
          : lastT >= T_PEEK_HI
          ? 1
          : (lastT - T_PEEK_LO) / (T_PEEK_HI - T_PEEK_LO);
      stratGhost = ramp * (lastState.capture ? capW : 1);
    }
    const stratOp = EXT_UNHI_OPACITY * stratGhost * (1 - stratGlow) + EXT_WHITE_OPACITY * stratGlow;
    if (lastState && lastState.stratum && stratOp > 0.004) {
      stratMesh.visible = true;
      stratMat.opacity = stratOp;
      stratMat.color.setHex(p.ext).lerp(extHiCol, stratGlow);
    } else {
      stratMesh.visible = false;
    }

    // Central paraboloid: the same two states as the exterior/stratum
    // paraboloids — ext base unhighlighted, lerping to the highlight on
    // climb — handed over by (1 - capture weight) to the captured
    // exterior sphere continuously.
    const showPara = lastShowParab && lastState && lastState.paraboloid !== null;
    const paraClimbTarget = showPara && lastT > 1e-9 ? 1 : 0;
    paraClimb += (paraClimbTarget - paraClimb) * glowFactor(dt);
    paraMat.color.setHex(p.ext).lerp(extHiCol, paraClimb);
    paraMat.opacity =
      (EXT_UNHI_OPACITY + (EXT_WHITE_OPACITY - EXT_UNHI_OPACITY) * paraClimb) * (1 - capW);
    paraMesh.visible = !!showPara;
    arcLine.visible = !!lastState && (lastState.kind === "exterior" || lastState.kind === "stratum" || !!showPara);

    // Task 6: camera pan. The resting target is the origin (central
    // sphere center); while an exterior sphere is highlighted the target
    // glides to its intersection with the central sphere (the attachment
    // point), and while the stratum is highlighted it glides on to the
    // stratum paraboloid's tangency point at the sphere's tip (the
    // apex). Leaving reverses (stratum -> attachment -> origin) through
    // the same smoothed glow weights. Both controls.target and the
    // camera position move by the same delta, so the orbit orientation
    // is preserved (a pan, not a rotation).
    let tgt = null;
    if (lastState) {
      if (lastState.kind === "stratum" && lastState.stratum && lastState.exterior) {
        tgt = lerp3(lastState.exterior.attachment, lastState.stratum.apex, stratGlow);
      } else if (lastState.kind === "exterior" && lastState.exterior) {
        tgt = lastState.exterior.attachment;
      } else if (lastState.capture) {
        tgt = lerp3(ORIGIN, lastState.capture.attachment, capW);
      }
    }
    if (tgt) {
      const pf = 1 - Math.exp(-dt / 0.3);
      const dx = (tgt[0] - controls.target.x) * pf;
      const dy = (tgt[1] - controls.target.y) * pf;
      const dz = (tgt[2] - controls.target.z) * pf;
      controls.target.x += dx;
      controls.target.y += dy;
      controls.target.z += dz;
      camera.position.x += dx;
      camera.position.y += dy;
      camera.position.z += dz;
    }

    controls.update();
    renderer.render(scene, camera);
  }
  loop();

  // Teardown hook; the widget keeps the side view for the page lifetime and never calls it.
  function dispose() {
    disposed = true;
    ro.disconnect();
    controls.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    host.classList.remove("hp-side-hover");
  }

  return { update: update, setHover: setHover, refreshTheme: refreshTheme, dispose: dispose };
}
