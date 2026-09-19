// Endpoint battery for the hyperpolygon solver: the r = 0 and r = 1 slider
// endpoints, the formerly broken bands next to them, and the t = 0 corners.
// Both solver call patterns are exercised:
//   (i)  widget-exact:  makeHyperpolygon(r, th, t, [0.5,0.5,0.25,0.5], true)
//        (the widget pre-swaps legs 2/3 and permutes the output),
//   (ii) unswapped:     makeHyperpolygon(r, th, t, [0.5,0.5,0.5,0.25], false).
// Bars: no NaN, su2Norm < 1e-9, muU1Error < 1e-9, closure < 1e-9, and
// muCNorm < 1e-6 where asserted. Exits 1 on failure.
//
//   [A]  endpoint grid r in {0,1} x theta in {0,+-pi/2,+-pi} x t in
//        {0.1,0.5,0.99}, both call patterns (hard)
//   [B]  broken bands r in {1e-12,1e-9,1e-8,1e-7,1e-6} and {0.99999,
//        0.999999}, theta=0, t=0.5, both call patterns (hard; these r were
//        NaN / su2~2.5e-1 / su2~1.5e-2 before the endpoint fixes)
//   [C]  t = 0 corners r in {0,1} x theta (hard; y vanishes identically at
//        t = 0 so the endpoint degeneration cannot be unlocked by a y-side
//        offset alone)
//   [D]  continuity: gauge-invariant invariants (per-vertex norms of the
//        su(2) polygon, per-leg |y_i|^2 of the returned pair) at r = 0 must
//        lie on the linear trend of r in {1e-4, 2e-4}, and at r = 1 on the
//        trend of r in {0.9999, 0.99995}; the extrapolation error must stay
//        below 1% of the invariant scale (measured ~0.07%; the pre-fix
//        endpoints violated this wildly: closure 0.25 vs trend 0). The
//        trend is only asserted at t <= 0.5: near t = 0.99 at theta = 0 the
//        invariants are genuinely steep in r (|y_1|^2 runs 9e-4 -> 0.59 ->
//        2.7 over r in [0, 1e-3], an unbounded slope at the endpoint), so a
//        LINEAR trend from 1e-4-spaced points cannot describe the true
//        limit there; those endpoint solves are verified by their residuals
//        in [A] instead.
//   [E]  r = 1 theta loop with the notebook beta (the original edge.mjs
//        check), now also asserting closure
//   [F]  seeded fuzz over the endpoint bands (r in [0,3e-5] and
//        [1-3e-5,1] incl. exact endpoints) across betas and t (hard)
import { makeHyperpolygon, muSU2Coords, muU1Error } from "./solver.js";

function cAbs2(a) {
  return a[0] * a[0] + a[1] * a[1];
}

const BS = [0.5, 0.5, 0.25, 0.5]; // widget-exact swapped beta
const BU = [0.5, 0.5, 0.5, 0.25]; // unswapped
const BETA = [1 / 6, 1 / 7, 1 / 7, 1 / 10]; // notebook beta (legacy check)

let failures = 0;
let checks = 0;
function fail(msg) {
  failures++;
  console.log("FAIL: " + msg);
}

// full residual fingerprint of one solve against the bars
function check(label, r, th, t, beta, permute, withMuCBar) {
  checks++;
  const t0 = Date.now();
  const res = makeHyperpolygon(r, th, t, beta, permute);
  const ms = Date.now() - t0;
  const s = muSU2Coords(res.x, res.y);
  const su2 = Math.hypot(s[0], s[1], s[2]);
  const clo = Math.hypot(...res.vertices[8]);
  const u1 = res.accuracy.muU1Error;
  const mc = res.accuracy.muCNorm;
  const bad = [];
  if (!isFinite(su2) || !isFinite(clo) || !isFinite(u1) || !isFinite(mc)) {
    bad.push("NaN");
  } else {
    if (!(su2 < 1e-9)) bad.push(`su2=${su2.toExponential(1)}`);
    if (!(clo < 1e-9)) bad.push(`closure=${clo.toExponential(1)}`);
    if (!(u1 < 1e-9)) bad.push(`muU1=${u1.toExponential(1)}`);
    if (withMuCBar && !(mc < 1e-6)) bad.push(`muC=${mc.toExponential(1)}`);
  }
  if (bad.length) {
    fail(`${label} r=${r} th=${th.toFixed(3)} t=${t}: ${bad.join(" ")}`);
  }
  return { ms, su2, clo, u1, mc };
}

// [A] endpoint grid, both call patterns
console.log("[A] endpoint grid (r in {0,1} x theta x t in {0.1,0.5,0.99}, both patterns)");
{
  let worstMs = 0;
  for (const r of [0, 1]) {
    for (const th of [0, Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI]) {
      for (const t of [0.1, 0.5, 0.99]) {
        worstMs = Math.max(worstMs, check("swap", r, th, t, BS, true, true).ms);
        worstMs = Math.max(worstMs, check("unsw", r, th, t, BU, false, true).ms);
      }
    }
  }
  console.log(`    60 solves ok so far (failures=${failures}), slowest=${worstMs}ms`);
}

// [B] the formerly broken bands
console.log("[B] broken bands (theta=0, t=0.5, both patterns)");
for (const r of [1e-12, 1e-9, 1e-8, 1e-7, 1e-6, 0.99999, 0.999999]) {
  check("swap", r, 0, 0.5, BS, true, true);
  check("unsw", r, 0, 0.5, BU, false, true);
}
console.log(`    done (failures=${failures})`);

// [C] t = 0 corners (y = 0 identically there)
console.log("[C] t=0 corners");
for (const th of [0, Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI]) {
  check("swap", 0, th, 0, BS, true, true);
  check("swap", 1, th, 0, BS, true, true);
}
check("unsw", 0, 0, 0, BU, false, true);
check("unsw", 1, 0, 0, BU, false, true);
console.log(`    done (failures=${failures})`);

// [D] continuity of gauge-invariant invariants across the endpoints
console.log("[D] continuity (linear trend from the two interior r onto the endpoint)");
{
  function invariants(res) {
    const yN = res.y.map((row) => cAbs2(row[0]) + cAbs2(row[1]));
    const vN = res.vertices.map((p) => p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
    return { yN, vN };
  }
  // trend = 2*interior2 - interior1 evaluated at the endpoint; the true
  // polygon varies smoothly in r, so the endpoint invariants must sit on it.
  // 1% of the global invariant scale leaves ~150x headroom over the measured
  // worst (~0.07% relative); small invariants are covered by the same global
  // scale (they are all fractions of one polygon).
  function continuity(label, rs, beta, permute, th, t) {
    checks++;
    const invs = rs.map((r) => {
      const res = makeHyperpolygon(r, th, t, beta, permute);
      return invariants(res);
    });
    const [a, b, c] = invs;
    const errV = c.vN.map((v, k) => Math.abs(v - (2 * b.vN[k] - a.vN[k])));
    const errY = c.yN.map((v, k) => Math.abs(v - (2 * b.yN[k] - a.yN[k])));
    const scale = Math.max(1e-6, ...a.vN, ...b.vN);
    const scaleY = Math.max(1e-12, ...a.yN, ...b.yN);
    const wV = Math.max(...errV);
    const wY = Math.max(...errY);
    if (!(wV <= 1e-2 * scale) || !(wY <= 1e-2 * scaleY)) {
      fail(
        `${label}: continuity broken — vErr=${wV.toExponential(2)} (scale ${scale.toExponential(2)}), yErr=${wY.toExponential(2)} (scale ${scaleY.toExponential(2)})`
      );
    } else {
      console.log(
        `    ${label}: worst vertex-norm trend err ${wV.toExponential(2)} of scale ${scale.toExponential(2)}, worst |y|^2 trend err ${wY.toExponential(2)} of ${scaleY.toExponential(2)} — OK`
      );
    }
  }
  for (const [beta, permute, tag] of [[BS, true, "swap"], [BU, false, "unsw"]]) {
    for (const th of [0, Math.PI]) {
      continuity(`${tag} r=0 (th=${th.toFixed(2)}, t=0.5)`, [1e-4, 2e-4, 0], beta, permute, th, 0.5);
      continuity(`${tag} r=1 (th=${th.toFixed(2)}, t=0.5)`, [0.9999, 0.99995, 1], beta, permute, th, 0.5);
    }
    continuity(`${tag} r=0 (th=0, t=0.1)`, [1e-4, 2e-4, 0], beta, permute, 0, 0.1);
    continuity(`${tag} r=1 (th=0, t=0.1)`, [0.9999, 0.99995, 1], beta, permute, 0, 0.1);
  }
}

// [E] the original r=1 theta loop (notebook beta, permute=false), now with
// closure asserted
console.log("[E] r=1 theta loop (notebook beta, t=0.5)");
for (const th of [-Math.PI, -1.0, 0.0, Math.PI]) {
  check("notebook", 1.0, th, 0.5, BETA, false, false);
}
console.log(`    done (failures=${failures})`);

// [F] seeded fuzz across the endpoint bands
console.log("[F] endpoint-band fuzz (seeded LCG)");
{
  let seed = 777;
  function rand() {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  }
  const betas = [
    { beta: BS, permute: true, tag: "swap" },
    { beta: BU, permute: false, tag: "unsw" },
    { beta: [1 / 6, 1 / 7, 1 / 7, 1 / 10], permute: false, tag: "nb" },
    { beta: [0.1, 0.15, 0.2, 0.3], permute: false, tag: "(0.1,0.15,0.2,0.3)" },
  ];
  let worstMs = 0;
  let n = 0;
  for (let k = 0; k < 30; k++) {
    // exact endpoints and nearby band draws, both ends
    const atEnd = k % 3 === 0;
    const low = k % 2 === 0;
    const r = atEnd ? (low ? 0 : 1) : low ? 3e-5 * rand() : 1 - 3e-5 * rand();
    const th = -Math.PI + 2 * Math.PI * rand();
    const t = 0.99 * rand();
    for (const { beta, permute, tag } of betas) {
      worstMs = Math.max(worstMs, check(tag, r, th, t, beta, permute, false).ms);
      n++;
    }
  }
  console.log(`    ${n} solves ok so far (failures=${failures}), slowest=${worstMs}ms`);
}

console.log(
  failures === 0
    ? `edge battery: PASS (${checks} checks)`
    : `edge battery: FAIL (${failures} of ${checks} checks failed)`
);
if (failures > 0) process.exit(1);
