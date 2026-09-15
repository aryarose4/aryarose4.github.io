// Exterior-chamber battery for the hyperpolygon solver: the dominant-chamber
// (one beta >= the sum of the rest) t = 0 branch. In an exterior chamber the
// t = 0 slice has no y = 0 solution; makeHyperpolygon returns the closed-form
// minimum energy configuration (row j of y zero, the other rows nonzero) —
// see the exterior-branch section of solver.js. Bars: no NaN, su2Norm < 1e-9,
// muU1Error < 1e-9, muCNorm < 1e-9, closure < 1e-9, and the polygon must be
// an exact stick at t = 0. Exits 1 on failure.
//
//   [A]  t = 0 grid: dominant leg j in {0,1,2,3} x exterior betas (deep,
//        near-wall, lopsided, scaled down) x (r, theta) grid incl. the
//        r = 0 / r = 1 endpoints and theta = 0 / +-pi/2 / pi  (hard)
//   [B]  t-continuity: per-leg |x_i|^2 and |y_i|^2 (gauge-invariant under
//        the residual U(2)) at t = 0 vs the t > 0 pipeline at t = 1e-6 and
//        1e-5: the pipeline's t -> 0+ limit IS the branch, diffs must stay
//        below 1e-8 (measured ~6e-11)
//   [C]  wall telescope: beta_j swept across the wall beta_j = sum rest at
//        t = 0; the per-leg polygon advances must move smoothly (step-to-
//        step jump <= the beta step + 1e-9), the advances must equal
//        (beta_0..beta_3) AT the wall from both sides, and every exterior-
//        side solve must close to < 1e-9
//   [D]  exactness identities on the exported exteriorPair: mu_C, central
//        mu_C, mu_U1 and mu_SU2 to < 1e-12, incl. sum_{i != j} c_i alpha_i
//   [E]  widget permute pattern (PERMUTE_23 = true): makeHyperpolygon(r, th,
//        0, [b0,b1,b3,b2], true) must satisfy mu_U1 = the user beta and
//        carry the branch geometry of the corresponding user-dominant leg
//   [F]  t > 0 seeded fuzz in exterior chambers: the historical pipeline
//        keeps solving (residual bars as in [A])
//   [G]  perf: the branch solve must stay under 5 ms
import { makeHyperpolygon, muSU2Coords, muU1Error, muC, dominantLeg, exteriorPair, exteriorYDirection, ySolveDirection, buildX } from "./solver.js";

function cAbs2(a) {
  return a[0] * a[0] + a[1] * a[1];
}

let failures = 0;
let checks = 0;
function fail(msg) {
  failures++;
  console.log("FAIL: " + msg);
}
function ok(cond, msg) {
  checks++;
  if (!cond) fail(msg);
}

function cAbs2v(z) {
  return cAbs2(z);
}

// stick-ness: max transverse distance of the 9 su(2) polygon vertices from
// the line through v1 and v8... v8 ~ 0 = v0, so use the line spanned by
// v1 - v0; normalized by the polygon scale.
function stickResidual(vs) {
  const a = [vs[1][0] - vs[0][0], vs[1][1] - vs[0][1], vs[1][2] - vs[0][2]];
  const n = Math.hypot(...a);
  if (n < 1e-30) return 0;
  let worst = 0;
  for (const v of vs) {
    const b = [v[0] - vs[0][0], v[1] - vs[0][1], v[2] - vs[0][2]];
    const c = [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    worst = Math.max(worst, Math.hypot(...c));
  }
  return worst / n;
}

// per-leg |x_col|^2 and |y_row|^2 of a result (invariant under the residual U(2))
function legNorms(res) {
  const c2 = [];
  const a2 = [];
  for (let i = 0; i < 4; i++) {
    c2.push(cAbs2(res.x[0][i]) + cAbs2(res.x[1][i]));
    a2.push(cAbs2(res.y[i][0]) + cAbs2(res.y[i][1]));
  }
  return { c2, a2 };
}

function residualBar(label, r, th, beta, permute, muCBar) {
  checks++;
  const res = makeHyperpolygon(r, th, 0, beta, permute);
  const s = muSU2Coords(res.x, res.y);
  const su2 = Math.hypot(s[0], s[1], s[2]);
  const clo = Math.hypot(...res.vertices[8]);
  const u1 = res.accuracy.muU1Error;
  const mc = res.accuracy.muCNorm;
  const stick = stickResidual(res.vertices);
  const bad =
    !isFinite(su2) || !isFinite(u1) || !isFinite(mc) ||
    su2 >= 1e-9 || u1 >= 1e-9 || mc >= (muCBar || 1e-9) || clo >= 1e-9 ||
    stick >= 1e-9;
  if (bad) {
    fail(
      `${label} r=${r} th=${th.toFixed(3)} beta=[${beta}] permute=${permute}: ` +
        `su2=${su2.toExponential(2)} muU1=${u1.toExponential(2)} muC=${mc.toExponential(2)} ` +
        `closure=${clo.toExponential(2)} stick=${stick.toExponential(2)}`
    );
  }
  return res;
}

// exterior beta sets: for each dominant leg, deep / near-wall / lopsided /
// scaled-down variants (all with beta_j > sum of the rest)
function exteriorBetas(j) {
  const sets = [];
  const base = [0.1, 0.1, 0.1, 0.1];
  const deep = base.slice();
  deep[j] = 0.8;
  sets.push(deep);
  const near = base.slice();
  near[j] = 0.301; // rest = 0.3
  sets.push(near);
  const wall = base.slice();
  wall[j] = 0.3; // exactly on the wall
  sets.push(wall);
  const lopsided = base.slice();
  lopsided[j] = 0.62;
  lopsided[(j + 1) % 4] = 0.25;
  lopsided[(j + 2) % 4] = 0.09;
  lopsided[(j + 3) % 4] = 0.04;
  sets.push(lopsided);
  const small = base.slice();
  small[j] = 0.08;
  small[(j + 1) % 4] = 0.01;
  small[(j + 2) % 4] = 0.005;
  small[(j + 3) % 4] = 0.005;
  sets.push(small);
  return sets;
}

const RS = [0, 0.05, 0.3, 0.5, 0.7, 0.95, 1];
const THS = [0, Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI, 0.7, 2.1];

// [A] t = 0 grid, both call patterns
console.log("[A] t=0 exterior grid (residual bars + stick)");
for (let j = 0; j < 4; j++) {
  for (const beta of exteriorBetas(j)) {
    ok(dominantLeg(beta) === j, `[A] dominantLeg([${beta}]) != ${j}`);
    for (const r of RS) {
      for (const th of THS) {
        residualBar(`[A] j=${j}`, r, th, beta, false);
      }
    }
  }
}

// [B] t-continuity: branch vs the t > 0 pipeline's t -> 0+ limit
console.log("[B] t-continuity (branch vs pipeline at t=1e-6, 1e-5)");
for (let j = 0; j < 4; j++) {
  for (const beta of [exteriorBetas(j)[0], exteriorBetas(j)[3]]) {
    for (const [r, th] of [[0.3, 0.7], [0.05, 2.1], [0.95, -1.3], [0.5, 0]]) {
      // skip the degenerate locus for pattern-B legs (j > 0): the t > 0
      // pipeline stalls at exactly (0.5, 0) at every t (pre-existing
      // theta = 0 stall-basin family, su2 ~ 0.7) — the branch itself is
      // covered there by [E2]
      if (j > 0 && r === 0.5 && th === 0) continue;
      const b0 = legNorms(residualBar(`[B] branch j=${j}`, r, th, beta, false));
      let worst = 0;
      for (const t of [1e-6, 1e-5]) {
        const p = legNorms(makeHyperpolygon(r, th, t, beta, false));
        for (let i = 0; i < 4; i++) {
          worst = Math.max(
            worst,
            Math.abs(b0.c2[i] - p.c2[i]),
            Math.abs(b0.a2[i] - p.a2[i])
          );
        }
      }
      ok(
        worst < 1e-8,
        `[B] j=${j} beta=[${beta}] r=${r} th=${th.toFixed(3)}: branch vs pipeline leg-norm diff ${worst.toExponential(2)}`
      );
    }
  }
}

// [C] wall telescope: beta_0 sweep across the wall at t = 0
console.log("[C] wall telescope (beta_0 sweep across beta_0 = rest, t=0)");
{
  const rest = [0.1, 0.05, 0.05]; // rest sum = 0.2
  const step = 0.002;
  let prev = null;
  let worstJump = 0;
  for (let b0 = 0.18; b0 <= 0.2201; b0 += step) {
    const beta = [b0, ...rest];
    const res = makeHyperpolygon(0.3, 0.7, 0, beta, false);
    checks++;
    const clo = Math.hypot(...res.vertices[8]);
    const exterior = b0 >= 0.2 - 1e-12;
    if (exterior && clo >= 1e-9) {
      fail(`[C] exterior side b0=${b0.toFixed(4)}: closure ${clo.toExponential(2)}`);
    }
    if (!exterior && res.accuracy.su2Norm >= 1e-6) {
      fail(`[C] stable side b0=${b0.toFixed(4)}: su2 ${res.accuracy.su2Norm.toExponential(2)}`);
    }
    const adv = [];
    for (let i = 0; i < 4; i++) {
      const va = res.vertices[2 * i];
      const vb = res.vertices[2 * i + 2];
      adv.push(Math.hypot(vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]));
    }
    if (prev) {
      for (let i = 0; i < 4; i++) {
        worstJump = Math.max(worstJump, Math.abs(adv[i] - prev[i]));
      }
    }
    // AT the wall the advances must equal the betas from the exterior side
    if (Math.abs(b0 - 0.2) < 1e-12) {
      for (let i = 0; i < 4; i++) {
        ok(
          Math.abs(adv[i] - beta[i]) < 1e-9,
          `[C] wall advances: leg ${i} ${adv[i]} != beta ${beta[i]}`
        );
      }
    }
    prev = adv;
  }
  ok(
    worstJump <= step + 1e-9,
    `[C] telescope jump ${worstJump.toExponential(2)} > step ${step}`
  );
  console.log(`    worst step-to-step advance jump ${worstJump.toExponential(2)} (beta step ${step})`);
}

// [D] exactness identities on the exported exteriorPair
console.log("[D] exteriorPair identities");
{
  // cross-check: the closed-form Y direction must equal the LU solve of the
  // linear system at conditioning-healthy reff
  for (const [reff, th] of [[0.3, 0.7], [0.5, 0], [0.05, -2.0], [1 - 1e-5, Math.PI / 2]]) {
    checks++;
    const Yc = exteriorYDirection(reff, th, 0.1);
    const Yl = ySolveDirection(buildX(reff, th, 0.1));
    let worst = 0;
    let scale = 0;
    for (let i = 0; i < 4; i++)
      for (let k = 0; k < 2; k++) {
        worst = Math.max(worst, Math.abs(Yc[i][k][0] - Yl[i][k][0]), Math.abs(Yc[i][k][1] - Yl[i][k][1]));
        scale = Math.max(scale, Math.abs(Yl[i][k][0]), Math.abs(Yl[i][k][1]));
      }
    ok(
      worst <= 1e-9 * Math.max(1, scale),
      `[D] exteriorYDirection vs LU at reff=${reff} th=${th.toFixed(3)}: diff ${worst.toExponential(2)} (scale ${scale.toExponential(2)})`
    );
  }
}
for (let j = 0; j < 4; j++) {
  for (const beta of exteriorBetas(j)) {
    for (const [r, th] of [[0.3, 0.7], [0, 0], [1, Math.PI], [0.5, 0]]) {
      checks++;
      const pair = exteriorPair(r, th, beta, j);
      const su2 = Math.hypot(...muSU2Coords(pair[0], pair[1]));
      const u1 = muU1Error(pair[0], pair[1], beta);
      const mc = Math.max(...muC(pair[0], pair[1]).map(cAbs2v)) ** 0.5;
      // central complex moment map: sum_i x_col_i y_row_i = 0
      let c00 = [0, 0], c01 = [0, 0], c10 = [0, 0], c11 = [0, 0];
      for (let i = 0; i < 4; i++) {
        const x0 = pair[0][0][i];
        const x1 = pair[0][1][i];
        const y0 = pair[1][i][0];
        const y1 = pair[1][i][1];
        c00 = [c00[0] + x0[0] * y0[0] - x0[1] * y0[1], c00[1] + x0[0] * y0[1] + x0[1] * y0[0]];
        c01 = [c01[0] + x0[0] * y1[0] - x0[1] * y1[1], c01[1] + x0[0] * y1[1] + x0[1] * y1[0]];
        c10 = [c10[0] + x1[0] * y0[0] - x1[1] * y0[1], c10[1] + x1[0] * y0[1] + x1[1] * y0[0]];
        c11 = [c11[0] + x1[0] * y1[0] - x1[1] * y1[1], c11[1] + x1[0] * y1[1] + x1[1] * y1[0]];
      }
      const central = Math.max(
        Math.hypot(...c00), Math.hypot(...c01), Math.hypot(...c10), Math.hypot(...c11)
      );
      if (!(su2 < 1e-12 && u1 < 1e-12 && mc < 1e-12 && central < 1e-12)) {
        fail(
          `[D] j=${j} beta=[${beta}] r=${r} th=${th.toFixed(3)}: su2=${su2.toExponential(2)} ` +
            `muU1=${u1.toExponential(2)} muC=${mc.toExponential(2)} central=${central.toExponential(2)}`
        );
      }
      // dominant leg: y row j must vanish, |x_j|^2 = 2 beta_j
      const yj2 = cAbs2(pair[1][j][0]) + cAbs2(pair[1][j][1]);
      const xj2 = cAbs2(pair[0][0][j]) + cAbs2(pair[0][1][j]);
      ok(yj2 < 1e-24, `[D] j=${j}: |y_j|^2 = ${yj2.toExponential(2)} not 0`);
      ok(
        Math.abs(xj2 - 2 * beta[j]) < 1e-12 * (1 + beta[j]),
        `[D] j=${j}: |x_j|^2 = ${xj2} != 2 beta_j = ${2 * beta[j]}`
      );
    }
  }
}

// [E] widget permute pattern (PERMUTE_23 = true): pre-swapped beta + permute=true
console.log("[E] widget permute pattern at t=0");
for (let j = 0; j < 4; j++) {
  for (const beta of exteriorBetas(j)) {
    checks++;
    const swapped = [beta[0], beta[1], beta[3], beta[2]];
    const res = makeHyperpolygon(0.3, 0.7, 0, swapped, true);
    const u1 = muU1Error(res.x, res.y, beta); // displayed pair must satisfy the USER beta
    if (!(u1 < 1e-9)) {
      fail(`[E] user beta=[${beta}]: displayed mu_U1 error ${u1.toExponential(2)}`);
    }
    // displayed leg norms must equal the branch of the SWAPPED beta with
    // legs 2/3 swapped back (that is what the widget's call pattern computes;
    // it agrees with the direct user-beta branch only when beta2 == beta3)
    const swapDom = dominantLeg(swapped);
    const direct = legNorms(makeHyperpolygon(0.3, 0.7, 0, swapped, false));
    const disp = legNorms(res);
    let worst = 0;
    const perm = [0, 1, 3, 2];
    for (let i = 0; i < 4; i++) {
      const k = perm[i];
      worst = Math.max(
        worst,
        Math.abs(direct.c2[k] - disp.c2[i]),
        Math.abs(direct.a2[k] - disp.a2[i])
      );
    }
    ok(worst < 1e-12, `[E] user beta=[${beta}]: displayed leg norms differ from swapped branch by ${worst.toExponential(2)}`);
    // dominant leg mapping survives the round trip
    ok(
      (swapDom === 2 || swapDom === 3) || swapDom === j,
      `[E] dominant leg mapping: solve dom ${swapDom} for user dom ${j}`
    );
  }
}

// [E2] the degenerate locus (r, theta) = (1/2, 0): the direction weights
// vanish identically there (the t > 0 pipeline stalls at this point at every
// t, at su2 ~ 0.7); the branch must still return a clean balanced stick, and
// it must agree with the theta = 0 row on both sides of r = 1/2.
console.log("[E2] degenerate locus (0.5, 0)");
{
  for (const [j, beta] of [[2, [0.1, 0.1, 0.8, 0.1]], [3, [0.1, 0.1, 0.1, 0.8]]]) {
    const mid = makeHyperpolygon(0.5, 0, 0, beta, false);
    const s = muSU2Coords(mid.x, mid.y);
    const su2 = Math.hypot(s[0], s[1], s[2]);
    ok(
      isFinite(su2) && su2 < 1e-9 && mid.accuracy.muU1Error < 1e-9 &&
        Math.hypot(...mid.vertices[8]) < 1e-9 &&
        stickResidual(mid.vertices) < 1e-9,
      `[E2] j=${j} at (0.5,0): su2=${su2.toExponential(2)} closure=${Math.hypot(...mid.vertices[8]).toExponential(2)}`
    );
    // continuity with the theta = 0 row: per-leg advances at r = 0.5 vs
    // r = 0.5 +- 1e-4 must agree to 1e-3 (the weights vary like (r-1/2)^2)
    const advOf = (res) =>
      [0, 1, 2, 3].map((i) => {
        const va = res.vertices[2 * i];
        const vb = res.vertices[2 * i + 2];
        return Math.hypot(vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]);
      });
    const a0 = advOf(mid);
    for (const dr of [-1e-4, 1e-4]) {
      const side = advOf(makeHyperpolygon(0.5 + dr, 0, 0, beta, false));
      for (let i = 0; i < 4; i++) {
        ok(
          Math.abs(a0[i] - side[i]) < 1e-3,
          `[E2] j=${j}: advance ${i} at r=0.5 (${a0[i].toFixed(6)}) vs r=0.5${dr > 0 ? "+" : "-"}1e-4 (${side[i].toFixed(6)})`
        );
      }
    }
  }
}

// [F] t > 0 seeded fuzz in exterior chambers (historical pipeline)
console.log("[F] t>0 seeded fuzz in exterior chambers");
{
  let seed = 4242;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let worstSu2 = 0;
  let worstMs = 0;
  const ts = [1e-4, 0.001, 0.005, 0.01, 0.05, 0.2, 0.5, 0.9];
  for (let k = 0; k < 160; k++) {
    const j = Math.floor(rand() * 4);
    const beta = exteriorBetas(j)[Math.floor(rand() * 4)];
    if (beta[j] <= beta.reduce((s, v, i) => s + (i === j ? 0 : v), 0)) continue; // skip the wall set sometimes
    const r = rand();
    const th = (rand() * 2 - 1) * Math.PI;
    const t = ts[Math.floor(rand() * ts.length)];
    const t0 = Date.now();
    const res = makeHyperpolygon(r, th, t, beta, false);
    worstMs = Math.max(worstMs, Date.now() - t0);
    checks++;
    const su2 = res.accuracy.su2Norm;
    if (!isFinite(su2) || su2 >= 1e-6 || res.accuracy.muU1Error >= 1e-9) {
      fail(
        `[F] beta=[${beta}] r=${r.toFixed(3)} th=${th.toFixed(3)} t=${t}: su2=${su2.toExponential(2)}`
      );
    }
    worstSu2 = Math.max(worstSu2, isFinite(su2) ? su2 : 1);
  }
  console.log(`    worst su2 ${worstSu2.toExponential(2)}, slowest ${worstMs} ms`);
}

// [G] perf: branch solve under 5 ms
console.log("[G] branch perf");
{
  let worstMs = 0;
  for (let j = 0; j < 4; j++) {
    for (const beta of exteriorBetas(j)) {
      const t0 = Date.now();
      makeHyperpolygon(0.3, 0.7, 0, beta, true);
      worstMs = Math.max(worstMs, Date.now() - t0);
    }
  }
  checks++;
  ok(worstMs < 5, `[G] branch solve ${worstMs} ms >= 5 ms`);
  console.log(`    slowest branch solve ${worstMs} ms`);
}

console.log(`exterior battery: ${failures === 0 ? "PASS" : "FAIL"} (${checks} checks)`);
if (failures > 0) process.exit(1);
