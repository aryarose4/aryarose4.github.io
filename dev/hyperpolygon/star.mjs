// Star-chamber reindexing battery: interior star chambers (the three short
// size-2 subsets share a common index j) are solved by an internal leg
// permutation that lands j in solver slot 3, so the notebook ansatz's
// (r, theta) always parameterizes the distinguished column. Exits 1 on
// failure.
//
//   [A]  grid over the 4 star chambers x r in {0,.25,.5,.75,1} x
//        theta in {0,pi/2,pi,-pi/2} x t in {0,.5,.99}: no NaN, su2/muU1/
//        closure < 1e-9, muC < 1e-6, mu_U1 vs the USER beta
//   [B]  straight pairs at the snap points: at (0,0)/(1/2,0)/(1,0) the
//        columns {sig0,j}/{sig2,j}/{sig1,j} are parallel (< 1e-8 |sin|) and
//        the other two pairs containing j are not (> 1e-3)
//   [C]  equivalence: makeHyperpolygon(beta) == manual permuted call
//        (beta' = beta o sig, unpermuted by hand) — bitwise
//   [D]  starIndex classification: 3 for the widget default / notebook beta,
//        -1 for the four cycle tuples
//   [E]  cycle tuples now solve via the cycle reindexing (solver.js):
//        full residual bars as [A] (su2/muU1/closure < 1e-9, muC < 1e-6)
import { makeHyperpolygon, muSU2Coords, starIndex, starSlots, starSig, cycleSig } from "./solver.js";

function cAbs2(a) {
  return a[0] * a[0] + a[1] * a[1];
}

const STARS = [
  { j: 0, beta: [0.2, 0.28, 0.27, 0.25] },
  { j: 1, beta: [0.28, 0.2, 0.27, 0.25] },
  { j: 2, beta: [0.28, 0.27, 0.2, 0.25] },
  { j: 3, beta: [0.28, 0.27, 0.25, 0.2] },
];
const WIDGET_DEFAULT = [0.4, 0.5, 0.5, 0.25];
const NOTEBOOK = [1 / 6, 1 / 7, 1 / 7, 1 / 10];
const CYCLES = [
  { j: 0, beta: [0.4, 0.2, 0.2, 0.2] },
  { j: 1, beta: [0.2, 0.4, 0.2, 0.2] },
  { j: 2, beta: [0.2, 0.2, 0.4, 0.2] },
  { j: 3, beta: [0.2, 0.2, 0.2, 0.4] },
];

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
  return starSig(j);
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

// [A] grid
{
  const rs = [0, 0.25, 0.5, 0.75, 1];
  const ths = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const ts = [0, 0.5, 0.99];
  for (const { j, beta } of STARS) {
    for (const r of rs) {
      for (const th of ths) {
        for (const t of ts) {
          const label = `[A] j=${j} beta=${beta} r=${r} th=${th.toFixed(2)} t=${t}`;
          let res = null;
          try {
            res = makeHyperpolygon(r, th, t, beta, false);
          } catch (e) {
            ok(false, label + " threw " + e);
            continue;
          }
          const flat = JSON.stringify([res.x, res.y, res.vertices]);
          ok(!/null/.test(flat) && !flat.includes("NaN"), label + " NaN");
          if (flat.includes("NaN")) continue;
          const s = muSU2Coords(res.x, res.y);
          const su2 = Math.hypot(s[0], s[1], s[2]);
          const clo = Math.hypot(...res.vertices[8]);
          ok(su2 < 1e-9, label + " su2 " + su2);
          ok(res.accuracy.muU1Error < 1e-9, label + " muU1 " + res.accuracy.muU1Error);
          ok(clo < 1e-9, label + " closure " + clo);
          ok(res.accuracy.muCNorm < 1e-6, label + " muC " + res.accuracy.muCNorm);
        }
      }
    }
  }
}

// [B] straight pairs at the snap points
{
  const snaps = [
    { r: 0, th: 0, slot: 0 },
    { r: 0.5, th: 0, slot: 2 },
    { r: 1, th: 0, slot: 1 },
  ];
  for (const { j, beta } of STARS) {
    const sig = sigOf(j);
      for (const sn of snaps) {
        for (const t of [0, 0.5]) {
          const straight = [sig[sn.slot], j].sort((a, b) => a - b);
          const others = [0, 1, 2, 3]
            .filter((i) => i !== j && i !== sig[sn.slot])
            .map((i) => [Math.min(i, j), Math.max(i, j)]);
          const label = `[B] j=${j} r=${sn.r} t=${t} straight=${straight}`;
          const res = makeHyperpolygon(sn.r, sn.th, t, beta, false);
          // at r = 1 the y-solve's documented reff = 1 - 1e-5 offset leaves
          // the "straight" pair straight only to O(1-reff) ~ 1.7e-5 (the
          // clean solve keeps the historical offset; the display-at-the-limit
          // retries only fire on a broken solve), so the bar there is 1e-4.
          const bar = sn.r === 1 ? 1e-4 : 1e-8;
          for (const pr of [straight, ...others]) {
            const sa = sinAngle(col(res.x, pr[0]), col(res.x, pr[1]));
            if (pr === straight || (pr[0] === straight[0] && pr[1] === straight[1])) {
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
  ];
  for (const { j, beta } of STARS) {
    if (j === 3) continue;
    const sig = sigOf(j);
    const betaP = sig.map((i) => beta[i]);
    for (const [r, th, t] of pts) {
      const label = `[C] j=${j} r=${r} th=${th} t=${t}`;
      const res1 = makeHyperpolygon(r, th, t, beta, false);
      const res2 = makeHyperpolygon(r, th, t, betaP, false);
      const inv = [0, 0, 0, 0];
      sig.forEach((c, i) => {
        inv[c] = i;
      });
      let same = true;
      for (const row of [0, 1]) {
        for (let c = 0; c < 4; c++) {
          const a = res1.x[row][c];
          const b = res2.x[row][inv[c]];
          if (a[0] !== b[0] || a[1] !== b[1]) same = false;
        }
      }
      for (let c = 0; c < 4; c++) {
        const a = res1.y[c];
        const b = res2.y[inv[c]];
        for (const d of [0, 1]) {
          if (a[d][0] !== b[d][0] || a[d][1] !== b[d][1]) same = false;
        }
      }
      ok(same, label + " pair mismatch vs manual permuted call");
      ok(
        res1.accuracy.muU1Error === res2.accuracy.muU1Error &&
          res1.accuracy.usedStable === res2.accuracy.usedStable,
        label + " accuracy mismatch"
      );
    }
  }
}

// [D] classification
{
  ok(starIndex(WIDGET_DEFAULT) === 3, "[D] widget default should be star-j3");
  ok(starIndex(NOTEBOOK) === 3, "[D] notebook beta should be star-j3");
  for (const { j, beta } of STARS) {
    ok(starIndex(beta) === j, "[D] star j=" + j + " tuple classified " + starIndex(beta));
    // coherent attachment assignment: the map is the CONSTANT [7,5,6] in
    // every star chamber (south {0,3}|{1,2}, equator {0,1}|{2,3}, north
    // {0,2}|{1,3})
    const slots = starSlots(beta);
    ok(slots + "" === "7,5,6", "[D] coherent starSlots j=" + j + " -> " + slots);
  }
  for (const { j, beta } of CYCLES) {
    ok(starIndex(beta) === -1, "[D] cycle j=" + j + " tuple classified " + starIndex(beta));
  }
  ok(starSlots(WIDGET_DEFAULT) + "" === "7,5,6", "[D] coherent starSlots widget default");
}

// [E] cycle tuples: now cycle chambers — full residual bars as [A]
{
  for (const { j, beta } of CYCLES) {
    for (const [r, th, t] of [[0.5, 0, 0.5], [0, 0, 0], [1, 0, 0.99], [0.3, 1.1, 0.2]]) {
      const label = `[E] cycle j=${j} r=${r} th=${th} t=${t}`;
      let res = null;
      try {
        res = makeHyperpolygon(r, th, t, beta, false);
      } catch (e) {
        ok(false, label + " threw " + e);
        continue;
      }
      const flat = JSON.stringify([res.x, res.y, res.vertices]);
      ok(!flat.includes("NaN") && !/null/.test(flat), label + " NaN");
      if (flat.includes("NaN") || /null/.test(flat)) continue;
      const s = muSU2Coords(res.x, res.y);
      const su2 = Math.hypot(s[0], s[1], s[2]);
      const clo = Math.hypot(...res.vertices[8]);
      ok(su2 < 1e-9, label + " su2 " + su2);
      ok(res.accuracy.muU1Error < 1e-9, label + " muU1 " + res.accuracy.muU1Error);
      ok(clo < 1e-9, label + " closure " + clo);
      ok(res.accuracy.muCNorm < 1e-6, label + " muC " + res.accuracy.muCNorm);
    }
  }
}

console.log(`star.mjs: ${checks} checks, ${failures} failures`);
process.exit(failures > 0 ? 1 : 0);
