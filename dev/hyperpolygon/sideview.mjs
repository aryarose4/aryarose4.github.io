// Side-view battery: validates the pure geometry of sideview.js
// (spherePoint, pairArea, pairRadius, flowState, probeExteriorMap)
// against the live solver. Mirrors walls.mjs conventions (fail(),
// worst-value reporting, exit code 1). The browser-only makeSideView
// factory is NOT exercised here (no THREE in Node).
//
//   [P]  probe validity: for in-chamber betas spanning several chambers,
//        probeExteriorMap returns a permutation of slots {5,6,7} whose
//        mapped pair is parallel at its attachment (residual < 1e-3),
//        plus the mapping table and the concluded chamber-independent
//        rule — [6, 5, 7] under the permuted call pattern, [7, 5, 6]
//        under the unpermuted one (follows PERMUTE_23, south/equator/north)
//   [S]  sizes: pairRadius = sqrt(D/8) on hand-computed cases, monotone
//        in D, and pairArea clamps nonpositive D to 0; centralArea/
//        centralRadius from the user's formula (pi/2)*|z_max - z_min|
//        incl. the dominant-chamber magnitude case
//   [F]  central flow: t = 0 lands exactly on spherePoint; t > 0 sits on
//        the paraboloid z = rho^2/(2f) of the returned frame; |dot|
//        escapes the sphere monotonically in t; arc starts at the sphere
//        point, ends at the dot, monotone in phi
//   [E]  exterior flow: |dot - center| = radius on the whole climb,
//        attachment at t = 0, antipode at t = 1, polar angle strictly
//        monotone in t, nearInfinity flips at T_NEAR_INF, radius =
//        pairRadius of the mapped slot's pair
//   [N]  NaN-safety: non-finite inputs return null; near-wall betas
//        (D ~ 1e-12 and D = 0 on the wall) stay finite; the full slider
//        endpoint grid of (r, theta, t) returns finite output
//   [G]  gamma (U(1) level circles): exterior |dot-center| = rk and the
//        polar height off.n invariant under gamma, t = 0/1 endpoints
//        fixed, gamma = 0 bit-exact vs the omitted argument, 2pi-
//        periodic, paraboloid constraint z = rho^2/(2f) and rho
//        preserved, apex fixed, rotated frames orthonormal
//   [I]  purity: repeated flowState calls are bit-identical
import { shortSubsets, chamberInterval } from "./chambers.js";
import { PERMUTE_23, starSlots, cycleSlots } from "./solver.js";
import {
  attachmentRs,
  PARAB_FOCAL,
  PHI_CAP,
  T_NEAR_INF,
  PERM,
  spherePoint,
  pairArea,
  pairRadius,
  centralArea,
  centralRadius,
  flowState,
  probeExteriorMap,
} from "./sideview.js";

const T0 = Date.now();
let failures = 0;
let checks = 0;
function fail(msg) {
  failures++;
  console.log("FAIL: " + msg);
}
function ok(cond, msg) {
  checks++;
  if (!cond) fail(msg);
  return cond;
}
function fmtBeta(beta) {
  return "[" + beta.map((v) => v.toPrecision(4)).join(", ") + "]";
}
function maxDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}
function finite3(v) {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}
function phiOf(t) {
  if (t <= 0) return 0;
  if (t >= 1) return PHI_CAP;
  return Math.min(Math.atan((0.5 * t) / (1 - t)), PHI_CAP);
}

// In-chamber check via chamberInterval (the widget's lock criterion).
function inChamber(beta, shorts) {
  for (let i = 0; i < 4; i++) {
    const iv = chamberInterval(i, beta, shorts);
    if (beta[i] < iv.lo - 1e-12 || beta[i] > iv.hi + 1e-12) return false;
  }
  return true;
}

// min over the 7 nontrivial wall conditions |sum_S - sum_complement|
function wallDist(beta) {
  const total = beta[0] + beta[1] + beta[2] + beta[3];
  let m = Infinity;
  for (let i = 0; i < 4; i++) {
    const d = Math.abs(2 * beta[i] - total);
    if (d < m) m = d;
  }
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const d = Math.abs(2 * (beta[i] + beta[j]) - total);
      if (d < m) m = d;
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// [P] probe validity
console.log("[P] probe validity (widget-exact solves at the three attachment points)");
const P_BETAS = [
  [0.5, 0.5, 0.5, 0.25],
  [0.35, 0.45, 0.25, 0.2],
  [0.45, 0.2, 0.5, 0.3],
  [0.3, 0.55, 0.4, 0.6],
  [0.25, 0.35, 0.6, 0.45],
  [0.55, 0.15, 0.45, 0.35],
  [0.2, 0.45, 0.3, 0.54],
  [0.6, 0.5, 0.4, 0.31],
  // the four chambers the original eight missed (star.mjs/cycle.mjs tuples),
  // so [P] measures all 8 interior chambers
  [0.2, 0.28, 0.27, 0.25],
  [0.28, 0.27, 0.2, 0.25],
  [0.2, 0.2, 0.4, 0.2],
  [0.2, 0.2, 0.2, 0.4],
];
const chambersSeen = {};
let worstRatio = Infinity;
let worstMappedResidual = 0;
const ATT_NAMES = ["south r=0", "equator r=0.5", "north r=1"];
console.log("  attachment      parallel user legs   slot   residuals S5/S6/S7");
for (const beta of P_BETAS) {
  const shorts = shortSubsets(beta);
  // strictly interior tuples: an on-wall beta is symmetric across its
  // wall (both sides of the split are parallel candidates there), so
  // the chamber's short side would not be the unambiguous answer
  if (!ok(inChamber(beta, shorts) && wallDist(beta) > 1e-9, `[P] ${fmtBeta(beta)} not strictly in its chamber`)) continue;
    chambersSeen[JSON.stringify([shorts[5], shorts[6], shorts[7]])] = true;
    const probe = probeExteriorMap(beta, shorts);
    const perm = probe.map.slice().sort().join(",");
    ok(perm === "5,6,7", `[P] ${fmtBeta(beta)} map not a permutation of 5..7: ${JSON.stringify(probe.map)}`);
    for (let k = 0; k < 3; k++) {
      const S = probe.map[k];
      if (!ok(S !== null && S >= 5 && S <= 7, `[P] ${fmtBeta(beta)} attachment ${k}: slot ${S} invalid`)) continue;
      const I = shorts[S];
      const res = probe.detail[k].residuals[S - 5];
      ok(Number.isFinite(res) && res < 1e-3, `[P] ${fmtBeta(beta)} attachment ${k}: mapped residual ${res} >= 1e-3`);
      let runnerUp = Infinity;
      for (let s = 5; s <= 7; s++) if (s !== S && probe.detail[k].residuals[s - 5] < runnerUp) runnerUp = probe.detail[k].residuals[s - 5];
      if (Number.isFinite(runnerUp) && runnerUp > 0) worstRatio = Math.min(worstRatio, runnerUp / res);
      if (res > worstMappedResidual) worstMappedResidual = res;
      if (k === 0) console.log(`  beta ${fmtBeta(beta)}  shorts S5..S7 = [${shorts[5]}] [${shorts[6]}] [${shorts[7]}]`);
      const legStr = `[${I[0]},${I[1]}]`;
      console.log(`    ${ATT_NAMES[k].padEnd(16)} legs ${legStr.padEnd(6)}     S${S}     ${probe.detail[k].residuals.map((v) => v.toExponential(2)).join(" / ")}`);
    }
  }
// The concluded rule (coherent attachment assignment, 2026-09-14): the
// three pair-SPLITS map to the three attachment points identically in EVERY
// chamber — south {0,3}|{1,2} (slot 7), equator {0,1}|{2,3} (slot 5), north
// {0,2}|{1,3} (slot 6) — so the map is the constant [7,5,6] and crossing a
// pair wall transfers only the crossed point's pair to its complement. The
// solver realizes this per chamber by the coherent reindexing (starSig /
// cycleSig; solver.js starSlots / cycleSlots derive it analytically, and
// cycleSlots also covers exterior chambers, whose pair short sides are the
// cycle chamber's). Under the permuted PERMUTE_23 pattern the composed rule
// is not derived (the flag is false and slated for obsolescence by the
// crease-consistency traversal task). If a chamber violates the rule the
// battery should surface it, not silently absorb it.
function expectedMapFor(beta) {
  if (!PERMUTE_23) {
    const s = starSlots(beta);
    if (s !== null) return s;
    const c = cycleSlots(beta);
    if (c !== null) return c;
  }
  return PERMUTE_23 ? [6, 5, 7] : [7, 5, 6];
}
for (const beta of P_BETAS) {
  const shorts = shortSubsets(beta);
  if (!inChamber(beta, shorts)) continue;
  const probe = probeExteriorMap(beta, shorts);
  const EXPECTED_MAP = expectedMapFor(beta);
  ok(
    probe.map[0] === EXPECTED_MAP[0] && probe.map[1] === EXPECTED_MAP[1] && probe.map[2] === EXPECTED_MAP[2],
    `[P] ${fmtBeta(beta)} violates the concluded rule map=[${EXPECTED_MAP}]: ${JSON.stringify(probe.map)}`
  );
}
console.log(
  `  chambers covered: ${Object.keys(chambersSeen).length} distinct pair-short signatures; ` +
    `worst mapped residual ${worstMappedResidual.toExponential(2)}; worst runner-up ratio 1:${(1 / worstRatio).toExponential(2)}`
);

// ---------------------------------------------------------------------------
// [S] sizes
console.log("[S] pairArea/pairRadius sizes + centralArea/centralRadius (user formula)");
{
  const beta = [0.5, 0.5, 0.5, 0.25];
  const area = pairArea(beta, [2, 3]);
  ok(Math.abs(area - (Math.PI / 2) * 0.25) <= 1e-15, `[S] pairArea(default, [2,3]) = ${area}`);
  const rad = pairRadius(beta, [2, 3]);
  ok(Math.abs(rad - Math.sqrt(0.25 / 8)) <= 1e-15, `[S] pairRadius(default, [2,3]) = ${rad} != sqrt(0.03125)`);
  // monotone in D: shrink the short pair's sum against a fixed complement
  // (D = sum_comp - sum_I = 1 - (0.5 + b3) grows as b3 drops)
  let prev = -1;
  for (const b3 of [0.4, 0.35, 0.3, 0.25]) {
    const b = [0.5, 0.5, 0.5, b3];
    const r = pairRadius(b, [2, 3]);
    ok(r > prev, `[S] pairRadius not increasing in D: ${r} after ${prev}`);
    prev = r;
  }
  // nonpositive D clamps to 0: I the long side, and I exactly on the wall
  const longBeta = [0.6, 0.5, 0.2, 0.2];
  ok(pairArea(longBeta, [0, 1]) === 0, "[S] pairArea did not clamp the long-side D to 0");
  ok(pairRadius(longBeta, [0, 1]) === 0, "[S] pairRadius on clamped area not 0");
  const wallBeta = [0.5, 0.25, 0.25, 0.5];
  ok(pairArea(wallBeta, [0, 1]) === 0, "[S] pairArea on-wall D not exactly 0");
  // near-wall positive D ~ 1e-12 stays finite and small
  const near = [0.5, 0.25, 0.25, 0.5 - 1e-12];
  const dn = pairArea(near, [2, 3]) / (Math.PI / 2);
  ok(dn > 0 && dn < 1e-11 && Number.isFinite(pairRadius(near, [2, 3])), `[S] near-wall D = ${dn}`);

  // central sphere: z_max = min(|b0+b3|, |b1+b2|), z_min = max(|b3-b0|,
  // |b2-b1|), tau = (PI/2)*|z_max - z_min| (the ABSOLUTE value — user
  // correction 2026-09-13), radius = sqrt(tau/(4 PI)).
  // Default beta: z_max = 0.75, z_min = 0.25, tau = PI/4, radius 0.25.
  const ca = centralArea(beta);
  ok(Math.abs(ca - Math.PI / 4) <= 1e-15, `[S] centralArea(default) = ${ca} != PI/4`);
  const cr = centralRadius(beta);
  ok(Math.abs(cr - 0.25) <= 1e-15, `[S] centralRadius(default) = ${cr} != 0.25`);
  // hand case: beta = (0.2, 0.3, 0.4, 0.5): z_max = min(0.7, 0.7) = 0.7,
  // z_min = max(0.3, 0.1) = 0.3, radius = sqrt(0.4/8) = sqrt(0.05)
  const cb = [0.2, 0.3, 0.4, 0.5];
  ok(Math.abs(centralArea(cb) - (Math.PI / 2) * 0.4) <= 1e-15, `[S] centralArea([0.2,0.3,0.4,0.5]) = ${centralArea(cb)}`);
  ok(Math.abs(centralRadius(cb) - Math.sqrt(0.05)) <= 1e-15, `[S] centralRadius([0.2,0.3,0.4,0.5]) = ${centralRadius(cb)}`);
  // a dominant leg makes z_max - z_min NEGATIVE (z_max = 0.3 < z_min = 0.9
  // here); the area is the magnitude, so the sphere persists
  const dom = [0.95, 0.2, 0.1, 0.05];
  ok(Math.abs(centralArea(dom) - (Math.PI / 2) * 0.6) <= 1e-15, `[S] centralArea(dominant) = ${centralArea(dom)} != (PI/2)*0.6`);
  ok(Math.abs(centralRadius(dom) - Math.sqrt(0.6 / 8)) <= 1e-15, `[S] centralRadius(dominant) = ${centralRadius(dom)} != sqrt(0.075)`);
  // monotone in the spread: growing the {0,3} pair against fixed b1, b2
  // widens |z_max - z_min|
  let prevC = -1;
  for (const b0 of [0.2, 0.3, 0.4]) {
    const b = [b0, 0.3, 0.4, 0.5];
    const rr = centralRadius(b);
    ok(rr > prevC, `[S] centralRadius not increasing: ${rr} after ${prevC}`);
    prevC = rr;
  }
}

// ---------------------------------------------------------------------------
// [F] central flow
console.log("[F] central flow (grid over r, theta, t; solver-free)");
{
  const beta = [0.5, 0.5, 0.5, 0.25];
  const shorts = shortSubsets(beta);
  const R = centralRadius(beta); // 0.25 for this beta (asserted in [S])
  // no exterior spheres: the grid intentionally includes the three
  // attachment points, and only a null extMap leaves them to the
  // central branch
  const extMap = [null, null, null];
  const RS = [0, 0.25, 0.5, 0.75, 1];
  const THS = [0, Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI];
  const TS = [0, 0.25, 0.5, 0.75, 0.9, 0.999];
  let worstT0Diff = 0;
  let worstParabResid = 0;
  let bitExactT0 = 0;
  let countT0 = 0;
  for (const r of RS) {
    for (const th of THS) {
      for (const t of TS) {
        const st = flowState(r, th, t, beta, shorts, extMap);
        if (!ok(st !== null && st.kind === "central", `[F] flowState(${r},${th},${t}) not central: ${st && st.kind}`)) continue;
        const P = st.paraboloid;
        if (!ok(P && finite3(P.apex) && finite3(P.u) && finite3(P.v) && finite3(P.n), `[F] (${r},${th},${t}) paraboloid frame broken`)) continue;
        const p0 = spherePoint(r, th, R);
        if (t === 0) {
          countT0++;
          const d = maxDiff(st.dot, p0);
          if (d === 0) bitExactT0++;
          if (d > worstT0Diff) worstT0Diff = d;
        }
        ok(maxDiff(P.apex, p0) <= 1e-12, `[F] (${r},${th},${t}) apex off spherePoint`);
        // frame orthonormality: n unit, u unit and perpendicular to n,
        // v = n x u
        const nu = Math.hypot(...P.n);
        const uu = Math.hypot(...P.u);
        const vu = Math.hypot(...P.v);
        ok(Math.abs(nu - 1) <= 1e-12 && Math.abs(uu - 1) <= 1e-12 && Math.abs(vu - 1) <= 1e-12, `[F] (${r},${th},${t}) frame not unit: ${nu} ${uu} ${vu}`);
        const un = P.u[0] * P.n[0] + P.u[1] * P.n[1] + P.u[2] * P.n[2];
        ok(Math.abs(un) <= 1e-12, `[F] (${r},${th},${t}) u not tangent (u.n = ${un})`);
        const cr = [P.n[1] * P.u[2] - P.n[2] * P.u[1], P.n[2] * P.u[0] - P.n[0] * P.u[2], P.n[0] * P.u[1] - P.n[1] * P.u[0]];
        ok(maxDiff(cr, P.v) <= 1e-12, `[F] (${r},${th},${t}) v != n x u`);
        // paraboloid constraint: z_local = rho^2 / (2f), rho = tangential norm
        const rel = [st.dot[0] - P.apex[0], st.dot[1] - P.apex[1], st.dot[2] - P.apex[2]];
        const zl = rel[0] * P.n[0] + rel[1] * P.n[1] + rel[2] * P.n[2];
        const tang = [rel[0] - zl * P.n[0], rel[1] - zl * P.n[1], rel[2] - zl * P.n[2]];
        const rho = Math.hypot(...tang);
        const resid = Math.abs(zl - (rho * rho) / (2 * P.f));
        if (t > 0) ok(resid <= 1e-12, `[F] (${r},${th},${t}) paraboloid residual ${resid.toExponential(2)}`);
        if (resid > worstParabResid) worstParabResid = resid;
        ok(Math.hypot(...st.dot) >= R - 1e-12, `[F] (${r},${th},${t}) dot inside the sphere`);
        ok(finite3(st.dot) && st.arc.length === 33 && st.arc.every(finite3), `[F] (${r},${th},${t}) arc not 33 finite points`);
        ok(maxDiff(st.arc[0], p0) <= 1e-12, `[F] (${r},${th},${t}) arc does not start at the sphere point`);
        ok(maxDiff(st.arc[32], st.dot) <= 1e-12, `[F] (${r},${th},${t}) arc does not end at the dot`);
      }
      // monotone |dot| in t (strict while phi is below the cap)
      let prevAbs = -1;
      let prevPhi = -1;
      for (const t of TS) {
        const st = flowState(r, th, t, beta, shorts, extMap);
        const abs = Math.hypot(...st.dot);
        const ph = phiOf(t);
        ok(abs >= prevAbs - 1e-12, `[F] (${r},${th}) |dot| decreased at t=${t}`);
        if (ph > prevPhi + 1e-12 && prevPhi >= 0) ok(abs > prevAbs + 1e-9, `[F] (${r},${th}) |dot| not strictly increasing at t=${t} (phi moved)`);
        prevAbs = abs;
        prevPhi = ph;
      }
      // arc monotone in phi (|arc| nondecreasing, strictly after phi > 0)
      const st = flowState(r, th, 0.5, beta, shorts, extMap);
      let prevA = -1;
      for (let i = 0; i < st.arc.length; i++) {
        const abs = Math.hypot(...st.arc[i]);
        ok(abs >= prevA - 1e-12, `[F] (${r},${th}) arc |dot| not monotone at sample ${i}`);
        prevA = abs;
      }
    }
  }
  console.log(
    `  ${RS.length * THS.length * TS.length} flow states; t=0 bit-exact ${bitExactT0}/${countT0} (worst diff ${worstT0Diff.toExponential(2)}); worst paraboloid residual ${worstParabResid.toExponential(2)}`
  );
}

// ---------------------------------------------------------------------------
// [E] exterior flow
console.log("[E] exterior flow (attachment climbs for several chambers)");
{
  const E_BETAS = [
    [0.5, 0.5, 0.5, 0.25],
    [0.35, 0.45, 0.25, 0.2],
    [0.45, 0.2, 0.5, 0.3],
    [0.3, 0.55, 0.4, 0.6],
  ];
  const TSW = [0, 0.1, 0.25, 0.5, 0.75, 0.89, 0.9, 1];
  let worstSphere = 0;
  let worstEnd = 0;
  let worstRadius = 0;
  let worstAngleDrop = 0;
  for (const beta of E_BETAS) {
    const shorts = shortSubsets(beta);
    const probe = probeExteriorMap(beta, shorts);
    const expectedMap = expectedMapFor(beta).join(",");
    if (!ok(probe.map.join(",") === expectedMap, `[E] unexpected map ${JSON.stringify(probe.map)} for ${fmtBeta(beta)} (expected [${expectedMap}])`)) continue;
    for (let k = 0; k < 3; k++) {
      const S = probe.map[k];
      const prev = { ang: Infinity, near: false };
      for (const t of TSW) {
        const st = flowState(attachmentRs[k], 0, t, beta, shorts, probe.map);
        if (!ok(st !== null && st.kind === "exterior" && st.slot === S, `[E] beta ${fmtBeta(beta)} att ${k} t=${t}: kind ${st && st.kind}`)) continue;
        const ex = st.exterior;
        if (!ok(ex && finite3(ex.center) && finite3(ex.normal) && finite3(ex.side) && finite3(ex.attachment) && Number.isFinite(ex.radius), `[E] att ${k} t=${t}: exterior frame broken`)) continue;
        const off = [st.dot[0] - ex.center[0], st.dot[1] - ex.center[1], st.dot[2] - ex.center[2]];
        const dist = Math.abs(Math.hypot(...off) - ex.radius);
        if (dist > worstSphere) worstSphere = dist;
        ok(dist <= 1e-12, `[E] beta ${fmtBeta(beta)} att ${k} t=${t}: |dot-center| off radius by ${dist.toExponential(2)}`);
        if (t === 0) {
          const d0 = maxDiff(st.dot, ex.attachment);
          if (d0 > worstEnd) worstEnd = d0;
          ok(d0 <= 1e-12, `[E] beta ${fmtBeta(beta)} att ${k} t=0: dot off attachment by ${d0.toExponential(2)}`);
        }
        if (t === 1) {
          const anti = [ex.center[0] + ex.radius * ex.normal[0], ex.center[1] + ex.radius * ex.normal[1], ex.center[2] + ex.radius * ex.normal[2]];
          const d1 = maxDiff(st.dot, anti);
          if (d1 > worstEnd) worstEnd = d1;
          ok(d1 <= 1e-12, `[E] beta ${fmtBeta(beta)} att ${k} t=1: dot off antipode by ${d1.toExponential(2)}`);
        }
        // climb angle measured from the attachment: atan2(sideComp,
        // -normalComp) runs 0 -> pi monotonically (atan2(sideComp,
        // normalComp) would wrap at ±pi where fp noise flips the sign
        // of the ~1e-17 side component at t = 0)
        const ang = Math.atan2(
          off[0] * ex.side[0] + off[1] * ex.side[1] + off[2] * ex.side[2],
          -(off[0] * ex.normal[0] + off[1] * ex.normal[1] + off[2] * ex.normal[2])
        );
        ok(prev.ang === Infinity || ang > prev.ang, `[E] beta ${fmtBeta(beta)} att ${k}: polar angle not strictly increasing at t=${t}`);
        prev.ang = ang;
        const expectNear = t >= T_NEAR_INF;
        ok(st.nearInfinity === expectNear, `[E] beta ${fmtBeta(beta)} att ${k} t=${t}: nearInfinity ${st.nearInfinity}`);
      }
      const rr = Math.abs(pairRadius(beta, shorts[S]) - flowState(attachmentRs[k], 0, 0.5, beta, shorts, probe.map).exterior.radius);
      if (rr > worstRadius) worstRadius = rr;
      ok(rr <= 1e-15, `[E] beta ${fmtBeta(beta)} att ${k}: radius != pairRadius (${rr.toExponential(2)})`);
      // arc endpoints: starts at the attachment, ends at the antipode
      const st = flowState(attachmentRs[k], 0, 0.5, beta, shorts, probe.map);
      ok(maxDiff(st.arc[0], st.exterior.attachment) <= 1e-12 && maxDiff(st.arc[32], [st.exterior.center[0] + st.exterior.radius * st.exterior.normal[0], st.exterior.center[1] + st.exterior.radius * st.exterior.normal[1], st.exterior.center[2] + st.exterior.radius * st.exterior.normal[2]]) <= 1e-12, `[E] beta ${fmtBeta(beta)} att ${k}: arc endpoints off`);
      ok(st.arc.length === 33 && st.arc.every(finite3), `[E] beta ${fmtBeta(beta)} att ${k}: arc not 33 finite points`);
    }
  }
  console.log(`  worst |dot-center| error ${worstSphere.toExponential(2)}; worst endpoint diff ${worstEnd.toExponential(2)}; worst radius diff ${worstRadius.toExponential(2)}`);
}

// ---------------------------------------------------------------------------
// [G] gamma: the U(1) phase rotates the dot along level circles
console.log("[G] gamma level circles (exterior spheres + paraboloids)");
{
  const G_BETAS = [
    [0.5, 0.5, 0.5, 0.25],
    [0.45, 0.2, 0.5, 0.3],
  ];
  const GAMMAS = [1e-3, 0.7, -2.1, Math.PI];
  const TS = [0, 0.25, 0.5, 0.9, 1];
  let worstSphere = 0;
  let worstHeight = 0;
  let worstRho = 0;
  let worstPara = 0;
  let worstFrame = 0;
  let moved = 0;
  for (const beta of G_BETAS) {
    const shorts = shortSubsets(beta);
    const probe = probeExteriorMap(beta, shorts);
    // exterior branch: level circles on the sphere
    for (let k = 0; k < 3; k++) {
      const S = probe.map[k];
      if (S === null) continue;
      for (const t of TS) {
        const st0 = flowState(attachmentRs[k], 0, t, beta, shorts, probe.map, 0);
        const base = flowState(attachmentRs[k], 0, t, beta, shorts, probe.map);
        ok(JSON.stringify(st0) === JSON.stringify(base), `[G] att ${k} t=${t}: gamma=0 not bit-exact vs omitted arg`);
        const ex0 = st0.exterior;
        const h0 = (st0.dot[0] - ex0.center[0]) * ex0.normal[0] + (st0.dot[1] - ex0.center[1]) * ex0.normal[1] + (st0.dot[2] - ex0.center[2]) * ex0.normal[2];
        for (const g of GAMMAS) {
          const st = flowState(attachmentRs[k], 0, t, beta, shorts, probe.map, g);
          if (!ok(st !== null && st.kind === "exterior", `[G] att ${k} t=${t} g=${g}: exterior branch lost`)) continue;
          const ex = st.exterior;
          const off = [st.dot[0] - ex.center[0], st.dot[1] - ex.center[1], st.dot[2] - ex.center[2]];
          const dist = Math.abs(Math.hypot(...off) - ex.radius);
          if (dist > worstSphere) worstSphere = dist;
          ok(dist <= 1e-12, `[G] att ${k} t=${t} g=${g}: |dot-center| off radius by ${dist.toExponential(2)}`);
          const h = off[0] * ex.normal[0] + off[1] * ex.normal[1] + off[2] * ex.normal[2];
          const dh = Math.abs(h - h0);
          if (dh > worstHeight) worstHeight = dh;
          ok(dh <= 1e-12, `[G] att ${k} t=${t} g=${g}: polar height changed by ${dh.toExponential(2)}`);
          if (t === 0) {
            const d0 = maxDiff(st.dot, ex.attachment);
            ok(d0 <= 1e-12, `[G] att ${k} g=${g}: t=0 dot off attachment by ${d0.toExponential(2)}`);
          }
          if (t === 1) {
            const anti = [ex.center[0] + ex.radius * ex.normal[0], ex.center[1] + ex.radius * ex.normal[1], ex.center[2] + ex.radius * ex.normal[2]];
            const d1 = maxDiff(st.dot, anti);
            ok(d1 <= 1e-12, `[G] att ${k} g=${g}: t=1 dot off antipode by ${d1.toExponential(2)}`);
          }
          if (t === 0.5) {
            const dm = maxDiff(st.dot, base.dot);
            if (dm > 1e-9) moved++;
            // 2pi periodicity (fp: cos/sin of shifted args agree to ~1e-16)
            const st2 = flowState(attachmentRs[k], 0, t, beta, shorts, probe.map, g + 2 * Math.PI);
            ok(maxDiff(st.dot, st2.dot) <= 1e-12, `[G] att ${k} g=${g}: not 2pi-periodic`);
          }
        }
      }
    }
    // central branch: level circles on the paraboloid
    for (const [r, th] of [[0.25, 0.3], [0.75, -0.8]]) {
      for (const t of TS) {
        const st0 = flowState(r, th, t, beta, shorts, probe.map, 0);
        if (!ok(st0 !== null && st0.kind === "central", "[G] central baseline lost")) continue;
        const P0 = st0.paraboloid;
        const off0 = [st0.dot[0] - P0.apex[0], st0.dot[1] - P0.apex[1], st0.dot[2] - P0.apex[2]];
        const z0 = off0[0] * P0.n[0] + off0[1] * P0.n[1] + off0[2] * P0.n[2];
        const rho0 = Math.hypot(off0[0] - z0 * P0.n[0], off0[1] - z0 * P0.n[1], off0[2] - z0 * P0.n[2]);
        for (const g of GAMMAS) {
          const st = flowState(r, th, t, beta, shorts, probe.map, g);
          if (!ok(st !== null && st.kind === "central", `[G] (${r},${th}) t=${t} g=${g}: central branch lost`)) continue;
          const P = st.paraboloid;
          ok(maxDiff(P.apex, P0.apex) === 0, `[G] (${r},${th}) t=${t} g=${g}: apex moved`);
          const off = [st.dot[0] - P.apex[0], st.dot[1] - P.apex[1], st.dot[2] - P.apex[2]];
          const z = off[0] * P.n[0] + off[1] * P.n[1] + off[2] * P.n[2];
          const rho = Math.hypot(off[0] - z * P.n[0], off[1] - z * P.n[1], off[2] - z * P.n[2]);
          const dr = Math.abs(rho - rho0);
          if (dr > worstRho) worstRho = dr;
          ok(dr <= 1e-12, `[G] (${r},${th}) t=${t} g=${g}: level-circle radius changed by ${dr.toExponential(2)}`);
          const dz = Math.abs(z - rho * rho / (2 * P.f));
          if (dz > worstPara) worstPara = dz;
          ok(dz <= 1e-12, `[G] (${r},${th}) t=${t} g=${g}: paraboloid constraint off by ${dz.toExponential(2)}`);
          // rotated frame orthonormality
          const un = Math.hypot(...P.u) - 1;
          const ud = P.u[0] * P.n[0] + P.u[1] * P.n[1] + P.u[2] * P.n[2];
          worstFrame = Math.max(worstFrame, Math.abs(un), Math.abs(ud));
          ok(Math.abs(un) <= 1e-14 && Math.abs(ud) <= 1e-14, `[G] (${r},${th}) g=${g}: rotated u not orthonormal to n`);
        }
      }
    }
  }
  ok(moved >= 3, `[G] gamma never moved the exterior dot (moved=${moved})`);
  console.log(
    `  worst sphere err ${worstSphere.toExponential(2)}, height drift ${worstHeight.toExponential(2)}, ` +
    `rho drift ${worstRho.toExponential(2)}, paraboloid err ${worstPara.toExponential(2)}, frame ${worstFrame.toExponential(2)}`
  );
}

// ---------------------------------------------------------------------------
// [N] NaN-safety and endpoint grid
console.log("[N] NaN-safety, near-wall finiteness, endpoint grid");
{
  const beta = [0.5, 0.5, 0.5, 0.25];
  const shorts = shortSubsets(beta);
  const extMap = [6, 5, 7];
  ok(flowState(NaN, 0, 0, beta, shorts, extMap) === null, "[N] NaN r not rejected");
  ok(flowState(0.5, Infinity, 0, beta, shorts, extMap) === null, "[N] Infinity theta not rejected");
  ok(flowState(0.5, 0, NaN, beta, shorts, extMap) === null, "[N] NaN t not rejected");
  ok(flowState(0.5, 0, 0, [0.5, NaN, 0.5, 0.25], shorts, extMap) === null, "[N] NaN beta entry not rejected");
  ok(flowState(0.5, 0, 0, [0.5, 0.5, 0.5, Infinity], shorts, extMap) === null, "[N] Infinity beta entry not rejected");
  // near-wall: D = 1e-12 (I = [2,3] short) and exactly D = 0 (on the wall)
  for (const wb of [[0.5, 0.25, 0.25, 0.5 - 1e-12], [0.5, 0.25, 0.25, 0.5]]) {
    const wsh = shortSubsets(wb);
    for (const [r, th, t] of [[0.5, 0, 0.5], [0, 0, 0.9], [1, 0.3, 0]]) {
      const st = flowState(r, th, t, wb, wsh, extMap);
      if (!ok(st !== null, `[N] near-wall ${fmtBeta(wb)} at (${r},${th},${t}): null`)) continue;
      const fine =
        finite3(st.dot) &&
        (st.exterior === null || (Number.isFinite(st.exterior.radius) && st.exterior.radius >= 1e-9 && finite3(st.exterior.center))) &&
        st.arc.every(finite3);
      ok(fine, `[N] near-wall ${fmtBeta(wb)} at (${r},${th},${t}): non-finite output`);
      if (st.exterior) ok(st.exterior.radius >= 1e-9, `[N] near-wall radius below the 1e-9 clamp: ${st.exterior.radius}`);
    }
  }
  // full slider endpoint grid with the default beta
  const RS = [0, 0.5, 1];
  const THS = [0, Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI];
  let gridCount = 0;
  for (const r of RS) {
    for (const th of THS) {
      for (const t of [0, 1]) {
        const st = flowState(r, th, t, beta, shorts, extMap);
        gridCount++;
        if (!ok(st !== null, `[N] grid (${r},${th},${t}): null`)) continue;
        ok(finite3(st.dot) && st.arc.every(finite3) && (st.exterior === null ? true : Number.isFinite(st.exterior.radius)) && (st.paraboloid === null ? true : Number.isFinite(st.paraboloid.f)), `[N] grid (${r},${th},${t}): non-finite output`);
      }
    }
  }
  console.log(`  endpoint grid: ${gridCount} states all finite; near-wall tuples finite with the 1e-9 radius clamp`);
}

// ---------------------------------------------------------------------------
// [I] purity
console.log("[I] purity (repeat calls bit-identical)");
{
  const beta = [0.5, 0.5, 0.5, 0.25];
  const shorts = shortSubsets(beta);
  const extMap = [6, 5, 7];
  for (const args of [[0.3, 0.4, 0.5], [0, 0, 0.9], [1, -2.7, 0.999], [0.5, 0, 0.25]]) {
    const a = JSON.stringify(flowState(args[0], args[1], args[2], beta, shorts, extMap));
    const b = JSON.stringify(flowState(args[0], args[1], args[2], beta, shorts, extMap));
    ok(a === b, `[I] flowState(${args.join(",")}) not bit-identical across calls`);
  }
  const beta2 = [0.35, 0.45, 0.25, 0.2];
  const shorts2 = shortSubsets(beta2);
  const p1 = JSON.stringify(probeExteriorMap(beta2, shorts2));
  const p2 = JSON.stringify(probeExteriorMap(beta2, shorts2));
  ok(p1 === p2, "[I] probeExteriorMap not bit-identical across calls");
}

// solver cross-check used by [P]/[E] happens through probeExteriorMap's own
// widget-exact calls; count them for the report
console.log(`\nsideview battery: ${failures === 0 ? "PASS" : "FAIL (" + failures + ")"}`);
console.log(`  ${checks} checks, ${Date.now() - T0} ms`);
process.exitCode = failures === 0 ? 0 : 1;
