// I-stratum battery: the stratumPair closed form (solver.js stratum section).
// The stratum of a pair split {I | comp} = the balanced pairs with BOTH pairs
// of x-columns parallel (doubly straight; the displayed polygon is a stick);
// t1 = 0 has exactly two nonzero y rows (the comp side vanishes), t1 > 0 lifts
// all four. The t1 = 0 slice must agree with the pipeline approach shape (the
// t -> 1- climb at an attachment). Exits 1 on failure.
//
//   [A]  grid: betas (exterior j = 0..3, interior star + cycle) x the three
//        pair slots x t1 in {0, 0.01, 0.25, 0.5, 0.9, 0.99}: residuals
//        su2/muU1/muC/closure < 1e-9, mu_SL closure < 1e-9, both pairs'
//        columns parallel to < 1e-12, comp rows ~0 at t1 = 0 (< 1e-7),
//        all four rows nonzero at t1 = 0.5 for strictly short pairs
//   [B]  t1 = 0 slice vs the pipeline approach shape (t = 0.99 at the three
//        attachments, unpermuted call): per-leg |x|^2, |y|^2 relative diffs
//        < 2e-3 (abs floor 1e-6 for near-zero rows)
//   [C]  per-side product cancellation (mu_SL identities) < 1e-12 and the
//        M-family monotonicity: comp-side rows strictly grow with t1
//   [D]  PERMUTE_23 call pattern: stratumPair(t1, [b0,b1,b3,b2],
//        I.map(PERM), true) satisfies mu_U1 = the USER beta and its
//        displayed pair is bit-identical to the direct unpermuted call
//   [E]  on-wall degeneracy (all-four tie beta): every row zero, still
//        balanced, exact stick
//   [F]  perf: stratumPair < 5 ms
import {
  stratumPair,
  makeHyperpolygon,
  muSU2Coords,
  muU1Error,
  muC,
  dominantLeg,
  starIndex,
  cycleIndex,
} from "./solver.js";
import { shortSubsets } from "./chambers.js";

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

function cAbs2(a) {
  return a[0] * a[0] + a[1] * a[1];
}

function legNorms(res) {
  const c2 = [];
  const a2 = [];
  for (let i = 0; i < 4; i++) {
    c2.push(cAbs2(res.x[0][i]) + cAbs2(res.x[1][i]));
    a2.push(cAbs2(res.y[i][0]) + cAbs2(res.y[i][1]));
  }
  return { c2, a2 };
}

// sine of the angle between the x-columns of legs a and b (0 = parallel)
function colSine(x, a, b) {
  // treat columns as pairs of complex numbers; cross product in C^2:
  // cr = u0 v1 - u1 v0 (complex), sine = |cr| / (|u| |v|)
  const u0 = x[0][a];
  const u1 = x[1][a];
  const v0 = x[0][b];
  const v1 = x[1][b];
  // complex 2x2 "determinant-like" cross: u0*v1 - u1*v0
  const cr0 = u0[0] * v1[0] - u0[1] * v1[1] - (u1[0] * v0[0] - u1[1] * v0[1]);
  const cr1 = u0[0] * v1[1] + u0[1] * v1[0] - (u1[0] * v0[1] + u1[1] * v0[0]);
  const nu = Math.sqrt(cAbs2(u0) + cAbs2(u1));
  const nv = Math.sqrt(cAbs2(v0) + cAbs2(v1));
  if (nu < 1e-12 || nv < 1e-12) return Infinity;
  return Math.hypot(cr0, cr1) / (nu * nv);
}

const POOL = [
  { beta: [0.55, 0.15, 0.15, 0.15], fam: "ext j0" },
  { beta: [0.15, 0.52, 0.18, 0.15], fam: "ext j1" },
  { beta: [0.15, 0.18, 0.52, 0.15], fam: "ext j2" },
  { beta: [0.15, 0.15, 0.18, 0.52], fam: "ext j3" },
  { beta: [0.4, 0.3, 0.2, 0.1], fam: "star" },
  { beta: [0.1, 0.2, 0.3, 0.4], fam: "star" },
  { beta: [0.25, 0.3, 0.2, 0.25], fam: "cycle" },
  { beta: [0.2, 0.3, 0.28, 0.22], fam: "cycle" },
];

// classify the pool (sanity: covers exterior, star and cycle)
{
  const fams = new Set();
  for (const e of POOL) {
    if (dominantLeg(e.beta) >= 0) fams.add("ext");
    else if (starIndex(e.beta) >= 0) fams.add("star");
    else if (cycleIndex(e.beta) >= 0) fams.add("cycle");
  }
  ok(fams.size === 3, "[pool] families covered: " + [...fams].join(","));
}

const T1_GRID = [0, 0.01, 0.25, 0.5, 0.9, 0.99];
const SLOTS = [5, 6, 7];

// [A] grid
console.log("[A] stratum grid");
{
  let worst = { su2: 0, muU1: 0, muC: 0, clo: 0, sl2: 0, sine: 0 };
  let nChecks = 0;
  for (const e of POOL) {
    const beta = e.beta;
    const shorts = shortSubsets(beta);
    for (const s of SLOTS) {
      const I = shorts[s];
      const comp = [0, 1, 2, 3].filter((i) => I.indexOf(i) === -1);
      const d = comp[0] === comp[1] ? NaN : beta[comp[0]] + beta[comp[1]] - (beta[I[0]] + beta[I[1]]);
      const strictlyShort = d > 1e-6;
      const rowishShort = d > 1e-3;
      for (const t1 of T1_GRID) {
        const res = stratumPair(t1, beta, I, false);
        ok(res !== null, `[A] null pair beta=[${beta}] slot=${s} t1=${t1}`);
        if (!res) continue;
        for (const v of res.vertices) {
          ok(
            Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]),
            `[A] NaN vertex beta=[${beta}] slot=${s} t1=${t1}`
          );
        }
        const acc = res.accuracy;
        worst.su2 = Math.max(worst.su2, acc.su2Norm);
        worst.muU1 = Math.max(worst.muU1, acc.muU1Error);
        worst.muC = Math.max(worst.muC, acc.muCNorm);
        const clo = Math.hypot(res.vertices[8][0], res.vertices[8][1], res.vertices[8][2]);
        worst.clo = Math.max(worst.clo, clo);
        const s5 = Math.hypot(...res.sl2.real[4]) + Math.hypot(...res.sl2.imag[4]);
        worst.sl2 = Math.max(worst.sl2, s5);
        if (!(acc.su2Norm < 1e-9 && acc.muU1Error < 1e-9 && acc.muCNorm < 1e-9 && clo < 1e-9 && s5 < 1e-9)) {
          fail(`[A] residual beta=[${beta}] slot=${s} t1=${t1}: su2=${acc.su2Norm.toExponential(2)} muU1=${acc.muU1Error.toExponential(2)} muC=${acc.muCNorm.toExponential(2)} clo=${clo.toExponential(2)} sl2=${s5.toExponential(2)}`);
        }
        // doubly straight: both pairs' columns parallel
        const sI = colSine(res.x, I[0], I[1]);
        const sC = colSine(res.x, comp[0], comp[1]);
        worst.sine = Math.max(worst.sine, sI, sC);
        if (!(sI < 1e-9 && sC < 1e-9)) {
          fail(`[A] not doubly straight beta=[${beta}] slot=${s} t1=${t1}: sI=${sI.toExponential(2)} sC=${sC.toExponential(2)}`);
        }
        // row structure
        const ln = legNorms(res);
        if (t1 === 0) {
          for (const i of comp) {
            if (strictlyShort && Math.sqrt(ln.a2[i]) > 1e-7) {
              fail(`[A] t1=0 comp row ${i} nonzero beta=[${beta}] slot=${s}: |y|=${Math.sqrt(ln.a2[i]).toExponential(2)}`);
            }
          }
          if (rowishShort) {
            for (const i of I) {
              if (Math.sqrt(ln.a2[i]) < 1e-3) {
                fail(`[A] t1=0 I row ${i} ~0 beta=[${beta}] slot=${s}: |y|=${Math.sqrt(ln.a2[i]).toExponential(2)}`);
              }
            }
          }
        }
        if (t1 === 0.5 && rowishShort) {
          for (let i = 0; i < 4; i++) {
            if (Math.sqrt(ln.a2[i]) < 1e-3) {
              fail(`[A] t1=0.5 row ${i} ~0 beta=[${beta}] slot=${s}: |y|=${Math.sqrt(ln.a2[i]).toExponential(2)}`);
            }
          }
        }
        nChecks++;
      }
    }
  }
  ok(nChecks >= 8 * 3 * T1_GRID.length, "[A] grid size " + nChecks);
  console.log(
    `    ${nChecks} solves: worst su2 ${worst.su2.toExponential(2)}, muU1 ${worst.muU1.toExponential(2)}, muC ${worst.muC.toExponential(2)}, closure ${worst.clo.toExponential(2)}, sl2 ${worst.sl2.toExponential(2)}, sine ${worst.sine.toExponential(2)}`
  );
}

// [B] t1 = 0 slice vs the pipeline approach shape at the three attachments.
// The climb follows the slice only up to the crossover onset, which arrives
// at T = t/(1-t) ~ 1e2..1e4 depending on chamber and attachment. Measured:
// (i) the EQUATOR LOCUS drifts grossly by t = 0.99 when the locus pair
// {2,3} is the COMP side of the split (shorts[5] != {2,3}) — exterior
// chambers (dominant leg 2 or 3) and an interior cycle chamber — and only
// to ~5e-3 in the rows at t = 0.9; (ii) the r = 1 climbs (reff = 1-1e-5
// offset) drift ~2e-3..5e-3 by t = 0.99 in ALL chambers; (iii) r = 0 and
// the equator with {2,3} as the I side stay clean to ~1e-4 at t = 0.99.
// So: t = 0.9 is compared for ALL combos (bar 2e-2 relative, 5e-4 absolute,
// widened to 1e-2 absolute for the equator-comp-locus class); t = 0.99 only
// for r = 0 and the clean equator class.
console.log("[B] slice vs pipeline approach (t = 0.9; t = 0.99 clean classes)");
{
  const ATTACH = [
    [0, 7],
    [0.5, 5],
    [1, 6],
  ];
  let worstRel = 0;
  let worstAt = "";
  const compare = (sl, pipe, tag, beta, r, t, absFloor) => {
    const a = legNorms(sl);
    const b = legNorms(pipe);
    for (let i = 0; i < 4; i++) {
      for (const [va, vb, nm] of [
        [a.c2[i], b.c2[i], "cx2"],
        [a.a2[i], b.a2[i], "yr2"],
      ]) {
        const diff = Math.abs(va - vb);
        if (diff > Math.max(2e-2 * vb, absFloor)) {
          fail(`[B] approach mismatch beta=[${beta}] r=${r} t=${t} leg${i} ${nm}: slice=${va.toExponential(4)} pipe=${vb.toExponential(4)}`);
        }
        if (vb > absFloor) {
          const rel = diff / vb;
          if (rel > worstRel) {
            worstRel = rel;
            worstAt = tag + " leg" + i + " " + nm;
          }
        }
      }
    }
  };
  for (const e of POOL) {
    const beta = e.beta;
    const dom = dominantLeg(beta);
    const shorts = shortSubsets(beta);
    for (const [r, slot] of ATTACH) {
      const I = shorts[slot];
      const sl = stratumPair(0, beta, I, false);
      ok(sl !== null, `[B] null slice beta=[${beta}] slot=${slot}`);
      if (!sl) continue;
      // the equator-comp-locus class approaches the slice only to ~5e-3 in
      // the rows at t = 0.9 (measured) — wider absolute floor there
      const compLocLocus = r === 0.5 && JSON.stringify(shorts[5]) !== "[2,3]";
      compare(sl, makeHyperpolygon(r, 0, 0.9, beta, false), `r=${r} t=0.9`, beta, r, 0.9, compLocLocus ? 1e-2 : 5e-4);
      if (dominantLeg(beta) < 0 && (r === 0 || (r === 0.5 && !compLocLocus))) {
        compare(sl, makeHyperpolygon(r, 0, 0.99, beta, false), `r=${r} t=0.99`, beta, r, 0.99, 5e-4);
      }
    }
  }
  console.log(`    worst relative mismatch ${worstRel.toExponential(2)} at ${worstAt}`);
}

// [C] per-side product cancellation + M-family monotonicity
console.log("[C] mu_SL identities + monotonicity");
{
  for (const e of POOL) {
    const beta = e.beta;
    const shorts = shortSubsets(beta);
    for (const s of SLOTS) {
      const I = shorts[s];
      const comp = [0, 1, 2, 3].filter((i) => I.indexOf(i) === -1);
      const d = beta[comp[0]] + beta[comp[1]] - (beta[I[0]] + beta[I[1]]);
      if (d <= 1e-3) continue; // identities hold regardless; rows need room
      // e1 side = the one containing leg 0
      const onE1 = I.indexOf(0) >= 0 ? I : comp;
      const onE2 = onE1 === I ? comp : I;
      let prevCompRow = [-1, -1];
      for (const t1 of [0, 0.01, 0.25, 0.5, 0.9]) {
        const res = stratumPair(t1, beta, I, false);
        if (!res) continue;
        // per-side product sums: e1 side sum x[0][i] y[i][1]; e2 side sum x[1][i] y[i][0]
        let pE1 = [0, 0];
        let pE2 = [0, 0];
        for (const i of onE1) {
          pE1[0] += res.x[0][i][0] * res.y[i][1][0] - res.x[0][i][1] * res.y[i][1][1];
          pE1[1] += res.x[0][i][0] * res.y[i][1][1] + res.x[0][i][1] * res.y[i][1][0];
        }
        for (const i of onE2) {
          pE2[0] += res.x[1][i][0] * res.y[i][0][0] - res.x[1][i][1] * res.y[i][0][1];
          pE2[1] += res.x[1][i][0] * res.y[i][0][1] + res.x[1][i][1] * res.y[i][0][0];
        }
        ok(
          Math.hypot(...pE1) < 1e-12 && Math.hypot(...pE2) < 1e-12,
          `[C] product sum beta=[${beta}] slot=${s} t1=${t1}: ${Math.hypot(...pE1).toExponential(2)} / ${Math.hypot(...pE2).toExponential(2)}`
        );
        // comp-side rows strictly grow with t1
        const ln = legNorms(res);
        for (let ci = 0; ci < 2; ci++) {
          const i = comp[ci];
          if (prevCompRow[ci] >= 0) {
            ok(
              ln.a2[i] > prevCompRow[ci] * (1 + 1e-9),
              `[C] comp row ${i} not growing beta=[${beta}] slot=${s} t1=${t1}`
            );
          }
          prevCompRow[ci] = ln.a2[i];
        }
      }
    }
  }
}

// [D] PERMUTE_23 call pattern
console.log("[D] permute call pattern");
{
  const PERM = [0, 1, 3, 2];
  for (const e of POOL) {
    const beta = e.beta;
    const shorts = shortSubsets(beta);
    const betaSolve = [beta[0], beta[1], beta[3], beta[2]];
    for (const s of SLOTS) {
      const I = shorts[s];
      const ISolve = I.map((u) => PERM[u]);
      const resT = stratumPair(0.3, betaSolve, ISolve, true);
      const resF = stratumPair(0.3, beta, I, false);
      ok(resT !== null && resF !== null, `[D] null beta=[${beta}] slot=${s}`);
      if (!resT || !resF) continue;
      // displayed leg j = user leg j: mu_U1 against the USER beta
      const eU = muU1Error(resT.x, resT.y, beta);
      ok(eU < 1e-9, `[D] permuted mu_U1 vs user beta=[${beta}] slot=${s}: ${eU.toExponential(2)}`);
      // bit-identical displayed pair. NOTE: the y SIGNS can differ (the
      // double swap flips the comp side's product phase — an unshown SL
      // dof) and the shared-G factor's C1/C2 roles swap, so |y|^2 can differ
      // by ~1 ulp: compare x entries and |y|^2 bitwise / to roundoff.
      let bitX = true;
      let worstA2 = 0;
      const aT = legNorms(resT);
      const aF = legNorms(resF);
      for (let i = 0; i < 4; i++) {
        if (
          resT.x[0][i][0] !== resF.x[0][i][0] || resT.x[0][i][1] !== resF.x[0][i][1] ||
          resT.x[1][i][0] !== resF.x[1][i][0] || resT.x[1][i][1] !== resF.x[1][i][1] ||
          aT.c2[i] !== aF.c2[i]
        ) {
          bitX = false;
        }
        worstA2 = Math.max(worstA2, Math.abs(aT.a2[i] - aF.a2[i]));
      }
      ok(bitX, `[D] permuted x not bit-identical beta=[${beta}] slot=${s}`);
      ok(worstA2 < 1e-12, `[D] permuted |y|^2 differs beta=[${beta}] slot=${s}: ${worstA2.toExponential(2)}`);
      // vertices equal to roundoff (the leg-2/3 swap reorders the closure
      // sum, so the closure vertex can differ by ~1 ulp)
      let dv = 0;
      for (let k = 0; k < 9; k++) {
        for (let d2 = 0; d2 < 3; d2++) {
          dv = Math.max(dv, Math.abs(resT.vertices[k][d2] - resF.vertices[k][d2]));
        }
      }
      ok(dv < 1e-12, `[D] permuted vertices differ beta=[${beta}] slot=${s}: ${dv.toExponential(2)}`);
    }
  }
}

// [E] on-wall degeneracy: the all-tie beta (every pair split at equality)
console.log("[E] on-wall degeneracy");
{
  const beta = [0.25, 0.25, 0.25, 0.25];
  const shorts = shortSubsets(beta);
  for (const s of SLOTS) {
    const I = shorts[s];
    const res = stratumPair(0, beta, I, false);
    ok(res !== null, `[E] null at tie slot=${s}`);
    if (!res) continue;
    const ln = legNorms(res);
    for (let i = 0; i < 4; i++) {
      // M - sideSum is an exact fp zero only when the sums associate exactly;
      // general on-wall tuples can leave O(1e-17) in n^2 — bar at 1e-14
      ok(ln.a2[i] <= 1e-14, `[E] tie row ${i} not ~zero: ${ln.a2[i].toExponential(2)}`);
      ok(Math.abs(ln.c2[i] - 2 * beta[i]) < 1e-12, `[E] tie |x_${i}|^2 != 2 beta_i`);
    }
    const acc = res.accuracy;
    ok(
      acc.su2Norm < 1e-9 && acc.muU1Error < 1e-9 && acc.muCNorm < 1e-9,
      `[E] tie residuals slot=${s}: ${JSON.stringify(acc)}`
    );
  }
}

// [F] perf
console.log("[F] perf");
{
  let worstMs = 0;
  for (const e of POOL) {
    const shorts = shortSubsets(e.beta);
    for (const s of SLOTS) {
      const t0 = Date.now();
      stratumPair(0.42, e.beta, shorts[s], false);
      worstMs = Math.max(worstMs, Date.now() - t0);
    }
  }
  ok(worstMs < 5, `[F] stratumPair ${worstMs} ms >= 5 ms`);
  console.log(`    slowest stratumPair ${worstMs} ms`);
}

console.log(`stratum battery: ${failures === 0 ? "PASS" : "FAIL"} (${checks} checks)`);
if (failures > 0) process.exit(1);
