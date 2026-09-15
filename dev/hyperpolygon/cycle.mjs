// Cycle-chamber reindexing battery: interior cycle chambers (the three short
// size-2 subsets share no common index; distinguished index j = the missing
// one) are solved by an internal leg permutation onto the cycle ansatz
// x = [[1,1,1,0],[0, r e^{i theta}, 1-r, 1]] (slot 3 = j, slots 0..2 = the
// other legs ascending), so the (r, theta) snap points (0,0), (1/2,0), (1,0)
// are exactly where the three short pairs become straight. Exits 1 on
// failure.
//
//   [A]   grid over the 4 cycle chambers x r in {0,.25,.5,.75,1} x
//         theta in {0,pi/2,pi,-pi/2} x t in {0,.5,.99}: no NaN, su2/muU1/
//         closure < 1e-9, muC < 1e-6, mu_U1 vs the USER beta
//   [B]   straight pairs at the snap points: at (0,0)/(1/2,0)/(1,0) the
//         columns {s0,s1}/{s1,s2}/{s0,s2} (s_k = sig[k], user indexing) are
//         parallel (< 1e-8 |sin|; 1e-4 at r = 1 for the documented reff
//         offset) and the other two pairs among the three short legs are
//         not (> 1e-3)
//   [C]   equivalence: makeHyperpolygon(beta) == hand-unpermuted
//         solveCore(beta o sig, CYCLE_ANSATZ) — bitwise
//   [C2]  solveYCycle(buildXCycle(reff, theta), reff, t) equals the notes'
//         closed form (scaled by (1-reff)*T) to 1e-12
//   [D]   classification: cycleIndex == j and starIndex == -1 for the four
//         cycle tuples; cycleIndex == -1 for the star tuples, the widget
//         default and the notebook beta; cycleSlots == the chamber's own
//         three short-pair slots, south/equator/north
//   [E]   (1/2,0) locus: exact points clean for all chambers/t; seeded
//         sweep of the |D| <= 1e-4 gate disk clean; a few points in the
//         1e-4 < |D| < 1e-2 band clean
//   [F]   seeded fuzz: 100 (r,theta,t) draws across the 4 chambers, bars
//         as [A]
//   [S]   scaled betas (x0.8, x0.64): chambers are scale-invariant, the
//         grid subset solves clean
//   [P]   widget load path: probeExteriorMap(beta, shortSubsets(beta)) —
//         the exact call widget.js makes at load — returns the analytic
//         cycleSlots map (no nulls, a {5,6,7} permutation) for all 4
//         cycle chambers
import {
  makeHyperpolygon,
  muSU2Coords,
  starIndex,
  cycleIndex,
  cycleSlots,
  starSlots,
  cycleSig,
  starSig,
  dominantLeg,
  solveCore,
  CYCLE_ANSATZ,
  STAR_ANSATZ,
  buildXCycle,
  solveYCycle,
} from "./solver.js";
import { shortSubsets } from "./chambers.js";
import { probeExteriorMap } from "./sideview.js";

function cAbs2(a) {
  return a[0] * a[0] + a[1] * a[1];
}

const CYCLES = [
  { j: 0, beta: [0.4, 0.2, 0.2, 0.2] },
  { j: 1, beta: [0.2, 0.4, 0.2, 0.2] },
  { j: 2, beta: [0.2, 0.2, 0.4, 0.2] },
  { j: 3, beta: [0.2, 0.2, 0.2, 0.4] },
];
const STARS = [
  { j: 0, beta: [0.2, 0.28, 0.27, 0.25] },
  { j: 1, beta: [0.28, 0.2, 0.27, 0.25] },
  { j: 2, beta: [0.28, 0.27, 0.2, 0.25] },
  { j: 3, beta: [0.28, 0.27, 0.25, 0.2] },
];
const WIDGET_DEFAULT = [0.5, 0.5, 0.5, 0.25];
const NOTEBOOK = [1 / 6, 1 / 7, 1 / 7, 1 / 10];

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

// the solver's coherent reindexing sig (coherent attachment assignment:
// the split->attachment-point map is the constant [7,5,6]; see solver.js)
function sigOf(j) {
  return cycleSig(j);
}

function makeRand(seed) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

// |sin(angle)| between two columns of x (2-vectors of complex)
function sinAngle(u, v) {
  const cr = u[0][0] * v[1][0] + u[0][1] * v[1][1] - (u[1][0] * v[0][0] + u[1][1] * v[0][1]);
  const ci = u[0][0] * v[1][1] - u[0][1] * v[1][0] - (u[1][0] * v[0][1] - u[1][1] * v[0][0]);
  const nu = Math.hypot(cAbs2(u[0]), cAbs2(u[1]));
  const nv = Math.hypot(cAbs2(v[0]), cAbs2(v[1]));
  return Math.hypot(cr, ci) / (nu * nv);
}

function col(x, k) {
  return [x[0][k], x[1][k]];
}

// residual battery shared by [A]/[E]/[F]/[S]; returns true if clean
function checkResiduals(label, res) {
  const flat = JSON.stringify([res.x, res.y, res.vertices]);
  ok(!/null/.test(flat) && !flat.includes("NaN"), label + " NaN");
  if (flat.includes("NaN") || /null/.test(flat)) return false;
  const s = muSU2Coords(res.x, res.y);
  const su2 = Math.hypot(s[0], s[1], s[2]);
  const clo = Math.hypot(...res.vertices[8]);
  ok(su2 < 1e-9, label + " su2 " + su2);
  ok(res.accuracy.muU1Error < 1e-9, label + " muU1 " + res.accuracy.muU1Error);
  ok(clo < 1e-9, label + " closure " + clo);
  ok(res.accuracy.muCNorm < 1e-6, label + " muC " + res.accuracy.muCNorm);
  return true;
}

// [A] grid
{
  const rs = [0, 0.25, 0.5, 0.75, 1];
  const ths = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const ts = [0, 0.5, 0.99];
  for (const { j, beta } of CYCLES) {
    for (const r of rs) {
      for (const th of ths) {
        for (const t of ts) {
          const label = `[A] j=${j} r=${r} th=${th.toFixed(2)} t=${t}`;
          try {
            checkResiduals(label, makeHyperpolygon(r, th, t, beta, false));
          } catch (e) {
            ok(false, label + " threw " + e);
          }
        }
      }
    }
  }
}

// [B] straight pairs at the snap points
{
  const snaps = [
    { r: 0, th: 0, pair: [0, 1] },
    { r: 0.5, th: 0, pair: [1, 2] },
    { r: 1, th: 0, pair: [0, 2] },
  ];
  for (const { j, beta } of CYCLES) {
    const sig = sigOf(j);
    // straight pairs in USER indexing: slots {s0,s1}/{s1,s2}/{s0,s2} hold
    // user legs sig[0..2] (slot 3 = the distinguished leg j, never parallel)
    for (const sn of snaps) {
      for (const t of [0, 0.5]) {
        // at r = 1 the y-solve's documented reff = 1 - 1e-5 offset leaves
        // the "straight" pair straight only to O(1-reff) ~ 1.7e-5 (the
        // clean solve keeps the historical offset), so the bar there is 1e-4
        const bar = sn.r === 1 ? 1e-4 : 1e-8;
        const straight = [sig[sn.pair[0]], sig[sn.pair[1]]].sort((a, b) => a - b);
        const others = [
          [0, 1],
          [1, 2],
          [0, 2],
        ]
          .filter((p) => !(p[0] === sn.pair[0] && p[1] === sn.pair[1]))
          .map((p) => [sig[p[0]], sig[p[1]]].sort((a, b) => a - b));
        const label = `[B] j=${j} r=${sn.r} t=${t} straight=[${straight}]`;
        const res = makeHyperpolygon(sn.r, sn.th, t, beta, false);
        for (const pr of [straight, ...others]) {
          const sa = sinAngle(col(res.x, pr[0]), col(res.x, pr[1]));
          const isStraight = pr[0] === straight[0] && pr[1] === straight[1];
          if (isStraight) {
            ok(sa < bar, label + " sin " + sa);
          } else {
            ok(sa > 1e-3, label + " other pair " + pr + " sin " + sa);
          }
        }
      }
    }
  }
}

// [C] equivalence with the manual permuted call (bitwise)
{
  const pts = [
    [0.3, 0.7, 0.4],
    [0, 0, 0.5],
    [0.5, 0, 0],
    [1, 0, 0.99],
    [0.7, -2.2, 0.13],
  ];
  for (const { j, beta } of CYCLES) {
    const sig = sigOf(j);
    const betaP = sig.map((i) => beta[i]);
    for (const [r, th, t] of pts) {
      const label = `[C] j=${j} r=${r} th=${th} t=${t}`;
      const res1 = makeHyperpolygon(r, th, t, beta, false);
      const res2 = solveCore(r, th, t, betaP, false, CYCLE_ANSATZ);
      const inv = [0, 0, 0, 0];
      sig.forEach((c, i) => {
        inv[c] = i;
      });
      const x2 = [0, 1].map((row) => inv.map((c) => res2.x[row][c]));
      const y2 = inv.map((c) => res2.y[c]);
      ok(
        JSON.stringify(res1.x) === JSON.stringify(x2) && JSON.stringify(res1.y) === JSON.stringify(y2),
        label + " pair mismatch vs manual permuted solveCore"
      );
      ok(
        res1.accuracy.muU1Error === res2.accuracy.muU1Error &&
          res1.accuracy.usedStable === res2.accuracy.usedStable,
        label + " accuracy mismatch"
      );
    }
  }
}

// [C2] closed-form cross-check of the cycle y-solve
{
  // closed form, scaled by (1-reff)*T exactly like solveYCycle
  const closedY = (reff, th, t) => {
    const T = t / (1 - t);
    const s = 1 - reff;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const re = [reff * c, reff * sn];
    const D = [re[0] - s, re[1]];
    const w = 1 / s; // 1/(1-r)
    const k = s * T;
    return [
      [[0, 0], [k * (re[0] * w - 1), k * re[1] * w]],
      [[-k * re[0], -k * re[1]], [k, 0]],
      [[k * re[0], k * re[1]], [-k * re[0] * w, -k * re[1] * w]],
      [[k * (re[0] * D[0] - re[1] * D[1]), k * (re[0] * D[1] + re[1] * D[0])], [0, 0]],
    ];
  };
  const pts = [
    [0, 0],
    [0.3, 0.7],
    [0.5, 0],
    [0.5, 1.2],
    [0.999, 0.4],
    [1 - 1e-5, 0],
    [1 - 1e-5, -1.3],
  ];
  for (const [r, th] of pts) {
    for (const t of [0.3, 0.9]) {
      const label = `[C2] r=${r} th=${th.toFixed(2)} t=${t}`;
      const y1 = solveYCycle(buildXCycle(r, th), r, t);
      const y2 = closedY(r, th, t);
      ok(y1 !== null, label + " LU returned null");
      if (!y1) continue;
      for (let i = 0; i < 4; i++) {
        for (let jj = 0; jj < 2; jj++) {
          const d = Math.hypot(y1[i][jj][0] - y2[i][jj][0], y1[i][jj][1] - y2[i][jj][1]);
          ok(d < 1e-12, label + ` y[${i}][${jj}] diff ${d}`);
        }
      }
    }
  }
}

// [D] classification
{
  for (const { j, beta } of CYCLES) {
    ok(cycleIndex(beta) === j, "[D] cycle j=" + j + " tuple classified " + cycleIndex(beta));
    ok(starIndex(beta) === -1, "[D] cycle j=" + j + " tuple starIndex " + starIndex(beta));
  }
  for (const { j, beta } of STARS) {
    ok(cycleIndex(beta) === -1, "[D] star j=" + j + " tuple classified " + cycleIndex(beta));
  }
  ok(cycleIndex(WIDGET_DEFAULT) === -1, "[D] widget default classified " + cycleIndex(WIDGET_DEFAULT));
  ok(cycleIndex(NOTEBOOK) === -1, "[D] notebook beta classified " + cycleIndex(NOTEBOOK));
  // cycleSlots: the three slots are exactly the chamber's short-pair slots,
  // south {s0,s1}, equator {s1,s2}, north {s0,s2}
  for (const { j, beta } of CYCLES) {
    const sig = sigOf(j);
    const shortSlots = new Set();
    for (const [a, b] of [[sig[0], sig[1]], [sig[1], sig[2]], [sig[0], sig[2]]]) {
      const key = Math.min(a, b) * 4 + Math.max(a, b);
      shortSlots.add(key === 1 || key === 11 ? 5 : key === 2 || key === 7 ? 6 : 7);
    }
    const slots = cycleSlots(beta);
    ok(
      slots !== null && slots.every((s) => shortSlots.has(s)) && new Set(slots).size === 3,
      "[D] cycleSlots j=" + j + " -> " + slots + " shorts " + [...shortSlots]
    );
    // coherent attachment assignment: the map is the CONSTANT [7,5,6] in
    // every chamber (south {0,3}|{1,2}, equator {0,1}|{2,3}, north
    // {0,2}|{1,3}), so crossing a wall transfers only the crossed point's
    // pair to the complement
    ok(slots + "" === "7,5,6", "[D] coherent cycleSlots j=" + j + " -> " + slots);
  }
  // exterior chambers share the cycle pair structure (pairs avoiding the
  // dominant leg), so cycleSlots classifies them too with the same map
  const EXTS = [
    [0.55, 0.15, 0.15, 0.15],
    [0.15, 0.55, 0.15, 0.15],
    [0.15, 0.15, 0.55, 0.15],
    [0.15, 0.15, 0.15, 0.55],
  ];
  for (let m = 0; m < 4; m++) {
    ok(dominantLeg(EXTS[m]) === m && cycleIndex(EXTS[m]) === m, "[D] exterior m=" + m + " classified dom=" + dominantLeg(EXTS[m]) + " cyc=" + cycleIndex(EXTS[m]));
    const slots = cycleSlots(EXTS[m]);
    ok(slots + "" === "7,5,6", "[D] coherent cycleSlots exterior m=" + m + " -> " + slots);
  }
  ok(cycleSlots(WIDGET_DEFAULT) === null, "[D] cycleSlots widget default not null");
}

// [D2] cross-wall coherence of the attachment map (the user's requirement):
// nudging beta across any pair wall must transfer ONLY the crossed
// attachment's short pair to its complement — the other two attachments
// keep their pairs — and the slot map must stay the constant [7,5,6] on
// both sides, with the crossed chamber's displayed straight pair at the
// snap matching its own new short side.
{
  const all = [...STARS, ...CYCLES];
  const sum = (I, b) => I.reduce((s, i) => s + b[i], 0);
  const setEq = (I, J) => I.length === J.length && J.every((i) => I.includes(i));
  for (const { beta } of all) {
    const shorts = shortSubsets(beta);
    const wasStar = starIndex(beta) >= 0;
    for (let s = 5; s <= 7; s++) {
      const I = shorts[s];
      ok(I.length === 2, "[D2] slot " + s + " not a pair " + I);
      const Ic = [0, 1, 2, 3].filter((i) => !I.includes(i));
      const deficit = sum(Ic, beta) - sum(I, beta);
      ok(deficit > 1e-9, "[D2] slot " + s + " not short, deficit " + deficit);
      const eps = deficit / 2 + 0.02;
      const beta2 = beta.slice();
      for (const i of I) beta2[i] += eps / 2;
      for (const i of Ic) beta2[i] -= eps / 2;
      const label = "[D2] beta=" + beta + " cross slot " + s + " " + I + "->" + Ic;
      const shorts2 = shortSubsets(beta2);
      ok(setEq(shorts2[s], Ic), label + " crossed slot pair " + shorts2[s]);
      for (let s2 = 5; s2 <= 7; s2++) {
        if (s2 !== s) ok(setEq(shorts2[s2], shorts[s2]), label + " slot " + s2 + " moved to " + shorts2[s2]);
      }
      // the wall separates star from cycle chambers
      const isStar2 = starIndex(beta2) >= 0;
      const isCyc2 = cycleIndex(beta2) >= 0;
      ok(isStar2 !== isCyc2 && isStar2 !== wasStar, label + " family flip star=" + isStar2 + " cyc=" + isCyc2);
      const map1 = starSlots(beta) || cycleSlots(beta);
      const map2 = isStar2 ? starSlots(beta2) : cycleSlots(beta2);
      ok(map1 + "" === "7,5,6", label + " source map " + map1);
      ok(map2 + "" === "7,5,6", label + " crossed map " + map2);
      // end-to-end: the crossed chamber's displayed straight pair at the
      // south attachment is its own new T3 short side
      const res = makeHyperpolygon(0, 0, 0.5, beta2, false);
      const pair2 = shorts2[7];
      const sa = sinAngle(col(res.x, pair2[0]), col(res.x, pair2[1]));
      ok(sa < 1e-8, label + " south straight sin " + sa + " pair " + pair2);
      // and the crossed sphere's size formula stays positive on both sides
      // (sphere shrinks to zero exactly ON the wall and regrows), while the
      // FIXED side I's imbalance flips sign
      const d1 = sum(Ic, beta) - sum(I, beta);
      const d2 = sum([0, 1, 2, 3].filter((i) => !shorts2[s].includes(i)), beta2) - sum(shorts2[s], beta2);
      ok(d1 > 0 && d2 > 0, label + " deficits " + d1 + " " + d2);
      const fixed2 = sum(Ic, beta2) - sum(I, beta2);
      ok(fixed2 < 0, label + " fixed-side imbalance did not flip: " + fixed2);
      for (let s2 = 5; s2 <= 7; s2++) {
        if (s2 !== s) {
          const a1 = sum([0, 1, 2, 3].filter((i) => !shorts[s2].includes(i)), beta) - sum(shorts[s2], beta);
          const a2 = sum([0, 1, 2, 3].filter((i) => !shorts2[s2].includes(i)), beta2) - sum(shorts2[s2], beta2);
          ok(Math.abs(a1 - a2) < 2 * eps + 1e-9, label + " slot " + s2 + " deficit jump " + (a1 - a2));
        }
      }
    }
  }
}

// [P] widget load-path smoke: probeExteriorMap (sideview.js, the exact call
// widget.js makes at load) must return the analytic cycleSlots rule with no
// nulls and no throw — what the extMap null-fill relies on for cycle chambers
{
  for (const { j, beta } of CYCLES) {
    const label = "[P] j=" + j;
    let map = null;
    try {
      map = probeExteriorMap(beta, shortSubsets(beta)).map;
    } catch (e) {
      ok(false, label + " probe threw " + e);
      continue;
    }
    const expected = cycleSlots(beta);
    ok(
      map.every((s) => s !== null) && new Set(map).size === 3 && map.every((s) => s >= 5 && s <= 7),
      label + " map " + map + " not a null-free {5,6,7} permutation"
    );
    ok(
      expected !== null && map[0] === expected[0] && map[1] === expected[1] && map[2] === expected[2],
      label + " map " + map + " != cycleSlots " + expected
    );
  }
}

// [E] (1/2,0) degenerate locus
{
  for (const { j, beta } of CYCLES) {
    for (const t of [0, 0.5, 0.99]) {
      const label = `[E] locus j=${j} t=${t}`;
      try {
        checkResiduals(label, makeHyperpolygon(0.5, 0, t, beta, false));
      } catch (e) {
        ok(false, label + " threw " + e);
      }
    }
  }
  // seeded sweep of the |D| <= 1e-4 gate disk (D = r e^{i theta} - (1-r))
  const rand = makeRand(90210);
  let tested = 0;
  let guard = 0;
  while (tested < 40 && guard++ < 400) {
    const r = 0.5 + (rand() - 0.5) * 2e-4;
    const th = (rand() - 0.5) * 4e-4;
    const D = Math.hypot(r * Math.cos(th) - (1 - r), r * Math.sin(th));
    if (D > 1e-4) continue;
    const { j, beta } = CYCLES[tested % 4];
    const t = [0, 0.5, 0.99][tested % 3];
    const label = `[E] disk j=${j} r=${r.toExponential(2)} th=${th.toExponential(2)} D=${D.toExponential(2)} t=${t}`;
    try {
      checkResiduals(label, makeHyperpolygon(r, th, t, beta, false));
    } catch (e) {
      ok(false, label + " threw " + e);
    }
    tested++;
  }
  ok(tested === 40, "[E] gate-disk sweep only tested " + tested);
  // a few points in the 1e-4 < |D| < 1e-2 band
  for (const [r, th] of [[0.5005, 0], [0.5, 0.01], [0.4995, -0.01], [0.503, 0.004]]) {
    for (const { j, beta } of CYCLES) {
      const D = Math.hypot(r * Math.cos(th) - (1 - r), r * Math.sin(th));
      const label = `[E] band j=${j} r=${r} th=${th} D=${D.toExponential(2)}`;
      try {
        checkResiduals(label, makeHyperpolygon(r, th, 0.5, beta, false));
      } catch (e) {
        ok(false, label + " threw " + e);
      }
    }
  }
}

// [F] seeded fuzz
{
  const rand = makeRand(4242);
  for (let i = 0; i < 100; i++) {
    const { j, beta } = CYCLES[i % 4];
    const r = rand();
    const th = (rand() * 2 - 1) * Math.PI;
    const t = rand() * 0.99;
    const label = `[F] j=${j} #${i} r=${r.toFixed(3)} th=${th.toFixed(3)} t=${t.toFixed(3)}`;
    try {
      checkResiduals(label, makeHyperpolygon(r, th, t, beta, false));
    } catch (e) {
      ok(false, label + " threw " + e);
    }
  }
}

// [S] scaled betas (chambers are scale-invariant)
{
  const rs = [0, 0.5, 1];
  const ths = [0, Math.PI / 2];
  const ts = [0, 0.5, 0.99];
  for (const { j, beta } of CYCLES) {
    for (const f of [0.8, 0.64]) {
      const betaS = beta.map((b) => b * f);
      ok(cycleIndex(betaS) === j, "[S] scaled j=" + j + " f=" + f + " classified " + cycleIndex(betaS));
      for (const r of rs) {
        for (const th of ths) {
          for (const t of ts) {
            const label = `[S] j=${j} f=${f} r=${r} th=${th.toFixed(2)} t=${t}`;
            try {
              checkResiduals(label, makeHyperpolygon(r, th, t, betaS, false));
            } catch (e) {
              ok(false, label + " threw " + e);
            }
          }
        }
      }
    }
  }
}

// [G] star<->cycle wall glue measurement (INFO heavy, asserts only on
// clean solves + classification). The 12 star<->cycle walls: each star
// chamber j* has 3 walls, one per short pair {j*,a}; the wall is
// {j*,a} | {b,e} (b,e = the other two legs), and the cycle chamber across
// it has distinguished j = a (the star pair's other leg). On-wall tuples
// are constructed GENERICALLY (the other two pair splits strictly
// unequal); eps = 1e-3 relative nudges put one tuple in the star chamber
// and one in the cycle chamber. At each grid point BOTH sides must solve
// clean (assert); the shape jump between the two reps at the same sliders
// is MEASURED (gauge-invariant: vertex norms + edge lengths, per-leg
// |y_i|^2), and the straight-pair schedules at the snaps are printed to
// make the chart mismatch visible.
{
  const eps = 1e-3;
  const grid = [
    [0, 0],
    [0.5, 0],
    [1, 0],
    [0.25, 0.3],
  ];
  const ts = [0, 0.5];
  const snaps = new Set(["0,0", "0.5,0", "1,0"]);
  const pairName = (shorts, slot) => "{" + shorts[slot].join(",") + "}";

  // gauge-invariant shape quantities of a solved rep
  const vertexQuants = (res) => {
    const V = res.vertices;
    const q = V.map((p) => Math.hypot(p[0], p[1], p[2]));
    for (let i = 0; i < 8; i++) {
      q.push(Math.hypot(V[i + 1][0] - V[i][0], V[i + 1][1] - V[i][1], V[i + 1][2] - V[i][2]));
    }
    return q;
  };
  const yN = (res) =>
    res.y.map((row) => row[0][0] * row[0][0] + row[0][1] * row[0][1] + row[1][0] * row[1][0] + row[1][1] * row[1][1]);
  const relDelta = (qa, qb) => {
    const scale = Math.max(...qa, ...qb);
    if (!(scale > 0)) return 0;
    let m = 0;
    for (let i = 0; i < qa.length; i++) m = Math.max(m, Math.abs(qa[i] - qb[i]));
    return m / scale;
  };

  let aggAll = 0;
  let aggSnap = 0;
  let aggY = 0;
  let aggWall = "";
  const wallRows = [];
  for (const { j: js } of STARS) {
    for (const a of [0, 1, 2, 3]) {
      if (a === js) continue;
      const [b, e] = [0, 1, 2, 3].filter((i) => i !== js && i !== a);
      // generic on-wall tuple: sum({js,a}) = sum({b,e}) EXACTLY, the other
      // two pair splits strictly on the star-js side and strictly unequal.
      // Role values: b_js = 0.10, b_a = 0.40 (S = 0.50), b_b = 0.30,
      // b_e = 0.20 -> split2 {js,b}|{a,e} = 0.40|0.60, split3
      // {js,e}|{a,b} = 0.30|0.70: both strictly star-side and unequal.
      const wall = new Array(4);
      wall[js] = 0.1;
      wall[a] = 0.4;
      wall[b] = 0.3;
      wall[e] = 0.2;
      ok(Math.abs(wall[js] + wall[a] - (wall[b] + wall[e])) < 1e-15, "[G] wall sum not exact");
      ok(wall[js] + wall[b] !== wall[a] + wall[e] && wall[js] + wall[e] !== wall[a] + wall[b], "[G] wall tuple not generic");
      const mx = Math.max(...wall);
      const wallBeta = wall.map((v) => v / mx);
      const T = wallBeta.reduce((s, v) => s + v, 0);
      const nudge = eps * T;
      // star side: {js,a} strictly short (decrease a leg of it)
      const betaStar = wallBeta.slice();
      betaStar[js] -= nudge;
      // cycle side: {b,e} strictly short (decrease a leg of it)
      const betaCyc = wallBeta.slice();
      betaCyc[b] -= nudge;
      ok(
        starIndex(betaStar) === js && cycleIndex(betaStar) === -1 && dominantLeg(betaStar) < 0,
        `[G] star side of wall {${js},${a}}|{${b},${e}} classified star=${starIndex(betaStar)} cyc=${cycleIndex(betaStar)} dom=${dominantLeg(betaStar)}`
      );
      ok(
        cycleIndex(betaCyc) === a && starIndex(betaCyc) === -1 && dominantLeg(betaCyc) < 0,
        `[G] cycle side of wall {${js},${a}}|{${b},${e}} classified cyc=${cycleIndex(betaCyc)} star=${starIndex(betaCyc)} dom=${dominantLeg(betaCyc)}`
      );
      const shortsS = shortSubsets(betaStar);
      const shortsC = shortSubsets(betaCyc);
      const schedS = starSlots(betaStar);
      const schedC = cycleSlots(betaCyc);
      let worstAll = 0;
      let worstY = 0;
      const snapWorst = [0, 0, 0];
      for (const [r, th] of grid) {
        for (const t of ts) {
          const resS = makeHyperpolygon(r, th, t, betaStar, false);
          const resC = makeHyperpolygon(r, th, t, betaCyc, false);
          ok(checkResiduals(`[G] star side wall {${js},${a}}|{${b},${e}} r=${r} th=${th} t=${t}`, resS), "[G] star side clean");
          ok(checkResiduals(`[G] cycle side wall {${js},${a}}|{${b},${e}} r=${r} th=${th} t=${t}`, resC), "[G] cycle side clean");
          const dv = relDelta(vertexQuants(resS), vertexQuants(resC));
          const dy = relDelta(yN(resS), yN(resC));
          worstAll = Math.max(worstAll, dv);
          worstY = Math.max(worstY, dy);
          const si = snaps.has(r + "," + th) ? [0, 0.5, 1].indexOf(r) : -1;
          if (si >= 0) snapWorst[si] = Math.max(snapWorst[si], dv);
        }
      }
      for (const w of snapWorst) aggSnap = Math.max(aggSnap, w);
      if (worstAll > aggAll) {
        aggAll = worstAll;
        aggY = worstY;
        aggWall = `{${js},${a}}|{${b},${e}}`;
      }
      wallRows.push({
        wall: `{${js},${a}}|{${b},${e}}`,
        starJ: js,
        cycJ: a,
        schedS,
        schedC,
        shortsS,
        shortsC,
        worstAll,
        worstY,
        snapWorst,
      });
    }
  }
  console.log("[G] star<->cycle wall glue (12 walls, eps=1e-3 relative, 8 slider pts x 2 sides each)");
  for (const w of wallRows) {
    const sched =
      "south S" + pairName(w.shortsS, w.schedS[0]) + "/C" + pairName(w.shortsC, w.schedC[0]) +
      "  equator S" + pairName(w.shortsS, w.schedS[1]) + "/C" + pairName(w.shortsC, w.schedC[1]) +
      "  north S" + pairName(w.shortsS, w.schedS[2]) + "/C" + pairName(w.shortsC, w.schedC[2]);
    console.log(
      `[G] wall ${w.wall} (star j=${w.starJ} <-> cycle j=${w.cycJ}): sched ${sched}`
    );
    console.log(
      `      jump: overall ${w.worstAll.toExponential(2)}  snaps s/e/n [${w.snapWorst
        .map((x) => x.toExponential(2))
        .join(", ")}]  per-leg |y|^2 ${w.worstY.toExponential(2)}`
    );
  }
  console.log(
    `[G] SUMMARY worst vertex-shape jump overall ${aggAll.toExponential(2)} (wall ${aggWall}), at snaps ${aggSnap.toExponential(2)}`
  );
  // INFO: the jump is a genuine branch difference, not a nudge artifact.
  // At the exact on-wall tuple BOTH ansaetze solve clean (all moment maps)
  // but produce DIFFERENT shapes (different straight pair at the same
  // snap), and the nudged-side jump is CONSTANT as eps -> 0 (no 1/sqrt
  // conditioning blowup, no O(eps) vanishing): the star and cycle charts
  // select different branches of the on-wall solution variety, so the
  // fixed-slider flop jump is intrinsic, exactly as predicted in
  // notes-cycle.md #5.
  {
    const js = 0, a = 1;
    const b = 2, e = 3;
    const wall = new Array(4);
    wall[js] = 0.1;
    wall[a] = 0.4;
    wall[b] = 0.3;
    wall[e] = 0.2;
    const wallBeta = wall.map((v) => v / Math.max(...wall));
    const T = wallBeta.reduce((s, v) => s + v, 0);
    for (const [r, th, t] of [[0, 0, 0.5], [0.3, 0.7, 0.5]]) {
      const onS = solveCore(r, th, t, wallBeta, false, STAR_ANSATZ);
      const onC = solveCore(r, th, t, wallBeta, false, CYCLE_ANSATZ);
      const line = `      on-wall charts wall r=${r} th=${th} t=${t}: star su2=${Math.hypot(
        ...muSU2Coords(onS.x, onS.y)
      ).toExponential(2)} cycle su2=${Math.hypot(...muSU2Coords(onC.x, onC.y)).toExponential(2)} vertexRel=${relDelta(
        vertexQuants(onS),
        vertexQuants(onC)
      ).toExponential(2)}`;
      const scales = [];
      for (const eps2 of [1e-3, 1e-5]) {
        const nudge = eps2 * T;
        const bS = wallBeta.slice();
        bS[js] -= nudge;
        const bC = wallBeta.slice();
        bC[b] -= nudge;
        scales.push(
          `eps=${eps2}: ${relDelta(vertexQuants(solveCore(r, th, t, bS, false, STAR_ANSATZ)), vertexQuants(solveCore(r, th, t, bC, false, CYCLE_ANSATZ))).toExponential(2)}`
        );
      }
      console.log(line + "  |  nudge-scaling " + scales.join(", "));
    }
  }
}

console.log(`cycle.mjs: ${checks} checks, ${failures} failures`);
process.exit(failures > 0 ? 1 : 0);
