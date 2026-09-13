// Degenerate-locus battery for the hyperpolygon solver: the interior point
// (r, theta) = (1/2, 0) where x columns 2 and 3 become parallel (parallelism
// defect D = r e^{i theta} - (1 - r) = 0). For betas whose balanced
// representative requires the columns separated, the balancing family cannot
// represent it there and every start stalled at the SAME beta-dependent
// value at every t (5.2e-2 for the user-example beta, 5.0e-1 for a dominant
// leg-2 chamber) — the widget lands exactly on the point through its
// r = 0.5 / theta = 0 snaps, so the display jumped. The solver now
// re-evaluates at r = 0.5 +- 1e-4 when the solve inside the gate disk
// |D| <= 1e-4 is not fully converged. Bars: no NaN, su2Norm < 1e-9,
// muU1Error < 1e-9, closure < 1e-9, muCNorm < 1e-6 where asserted.
// Exits 1 on failure.
//
//   [A]  locus grid (0.5, 0) x t in {0, 0.005, 0.1, 0.5, 0.9, 0.99} across
//        chambers (stable, lopsided, dominant j = 0..3; dominant t = 0 goes
//        through the exterior branch, t > 0 through the pipeline), both call
//        patterns for the stable betas (hard)
//   [B]  the chaotic stall band inside the gate disk: theta in
//        {1e-8..1e-4} at r = 0.5 and r offsets {1e-8..4e-5} at theta = 0
//        (pre-fix: su2 up to 1.6e-1 at isolated draws) plus points just
//        outside the gate (hard)
//   [C]  display continuity: the locus representative at (0.5, 0) is
//        BIT-EXACT the direct solve at the offset point r = 0.5 - 1e-4 (the
//        retry evaluates the identical consistent pair), and its invariants
//        sit on the neighboring branch (vertex norms match r = 0.5 + 1e-4
//        to < 1e-4 of the polygon scale)
//   [D]  widget-exact call pattern at the locus: displayed pair satisfies
//        mu_U1 = user beta for user betas with b2 != b3
//   [E]  seeded fuzz over the gate disk (r in 0.5 +- 1e-4, theta in
//        +-1e-4) across chambers and t (hard)
import { makeHyperpolygon, muSU2Coords, muU1Error } from "./solver.js";

function cAbs2(a) {
  return a[0] * a[0] + a[1] * a[1];
}

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
    fail(`${label} r=${r} th=${th} t=${t}: ${bad.join(" ")}`);
  }
  return { res, ms, su2, clo, u1, mc };
}

// [A] the exact locus across chambers and t
console.log("[A] locus grid (0.5, 0) x t, chambers x call patterns");
{
  const stable = [
    ["user-ex (0.5,0.5,0.8,0.25)", [0.5, 0.5, 0.8, 0.25]],
    ["lopsided (0.4,0.35,0.2,0.15)", [0.4, 0.35, 0.2, 0.15]],
  ];
  const dominant = [
    ["dom j0 (0.8,0.3,0.3,0.1)", [0.8, 0.3, 0.3, 0.1]],
    ["dom j1 (0.3,0.8,0.2,0.2)", [0.3, 0.8, 0.2, 0.2]],
    ["dom j2 (0.3,0.2,0.8,0.2)", [0.3, 0.2, 0.8, 0.2]],
    ["dom j3 (0.2,0.3,0.2,0.8)", [0.2, 0.3, 0.2, 0.8]],
  ];
  let worstMs = 0;
  let n = 0;
  for (const t of [0, 0.005, 0.1, 0.5, 0.9, 0.99]) {
    for (const [tag, beta] of stable) {
      // widget-exact pattern: legs 2/3 pre-swapped + permute (the swaps cancel)
      const sb = [beta[0], beta[1], beta[3], beta[2]];
      worstMs = Math.max(worstMs, check(`${tag} swap`, 0.5, 0, t, sb, true, true).ms);
      worstMs = Math.max(worstMs, check(`${tag} unsw`, 0.5, 0, t, beta, false, true).ms);
      n += 2;
    }
    for (const [tag, beta] of dominant) {
      worstMs = Math.max(worstMs, check(tag, 0.5, 0, t, beta, false, true).ms);
      n++;
    }
  }
  console.log(`    ${n} locus solves ok so far (failures=${failures}), slowest=${worstMs}ms`);
}

// [B] the chaotic stall band inside the gate disk + just outside
console.log("[B] stall band inside/outside the gate disk (t=0.5)");
{
  const beta = [0.5, 0.5, 0.8, 0.25];
  const sb = [0.5, 0.5, 0.25, 0.8];
  for (const th of [1e-8, 1e-7, 3e-7, 1e-6, 3e-6, 1e-5, 1e-4, 3e-4]) {
    check("unsw", 0.5, th, 0.5, beta, false, true);
    check("swap", 0.5, th, 0.5, sb, true, true);
  }
  for (const dr of [-4e-5, -1e-6, -3e-7, -1e-8, 1e-8, 3e-7, 1e-6, 4e-5]) {
    check("unsw", 0.5 + dr, 0, 0.5, beta, false, true);
    check("swap", 0.5 + dr, 0, 0.5, sb, true, true);
  }
  // just outside the gate: |D| ~ 2e-4 and 2.4e-3, historically clean
  check("unsw", 0.5 + 1e-4, 0, 0.5, beta, false, true);
  check("unsw", 0.5, 1e-3, 0.5, beta, false, true);
  console.log(`    done (failures=${failures})`);
}

// [C] display continuity: the locus rep is the direct offset solve
console.log("[C] continuity (bit-exact offset identity + neighbor branch)");
{
  function invariants(res) {
    const yN = res.y.map((row) => cAbs2(row[0]) + cAbs2(row[1]));
    const vN = res.vertices.map((p) => Math.hypot(p[0], p[1], p[2]));
    return { yN, vN };
  }
  const beta = [0.5, 0.5, 0.8, 0.25];
  for (const t of [0, 0.1, 0.5, 0.9]) {
    checks++;
    const atLocus = invariants(makeHyperpolygon(0.5, 0, t, beta, false));
    const atOffset = invariants(makeHyperpolygon(0.5 - 1e-4, 0, t, beta, false));
    const beyond = invariants(makeHyperpolygon(0.5 + 1e-4, 0, t, beta, false));
    // bit-exact: the retry evaluates the identical pair at r = 0.5 - 1e-4
    let exact = true;
    for (let i = 0; i < 4 && exact; i++) {
      if (atLocus.yN[i] !== atOffset.yN[i]) exact = false;
    }
    for (let i = 0; i < 9 && exact; i++) {
      if (atLocus.vN[i] !== atOffset.vN[i]) exact = false;
    }
    if (!exact) fail(`[C] locus rep != direct solve at r = 0.5 - 1e-4 (t=${t})`);
    // neighbor branch: vertex norms agree with the r = 0.5 + 1e-4 solve to
    // well below display precision (measured ~2e-6 absolute, scale ~1)
    const scale = Math.max(1e-6, ...beyond.vN);
    const wV = Math.max(...atLocus.vN.map((v, k) => Math.abs(v - beyond.vN[k])));
    if (!(wV <= 1e-4 * scale)) {
      fail(`[C] locus vs r=0.5+1e-4 branch: vertex-norm diff ${wV.toExponential(2)} of scale ${scale.toExponential(2)} (t=${t})`);
    }
  }
  console.log(`    offset identity + neighbor branch ok (failures=${failures})`);
}

// [D] widget-exact pattern: displayed pair satisfies mu_U1 = user beta
console.log("[D] widget pattern mu_U1 = user beta at the locus");
{
  const users = [
    [0.5, 0.5, 0.8, 0.25],
    [0.3, 0.2, 0.8, 0.2],
    [0.45, 0.5, 0.3, 0.3],
  ];
  let worst = 0;
  for (const ub of users) {
    const sb = [ub[0], ub[1], ub[3], ub[2]];
    for (const t of [0.1, 0.5, 0.9]) {
      checks++;
      const res = makeHyperpolygon(0.5, 0, t, sb, true);
      const u1user = muU1Error(res.x, res.y, ub);
      worst = Math.max(worst, u1user);
      if (!(u1user <= 1e-8)) {
        fail(`[D] displayed mu_U1 vs user beta = ${u1user.toExponential(2)} at beta=${JSON.stringify(ub)} t=${t}`);
      }
    }
  }
  console.log(`    displayed pair satisfies mu_U1 = user beta, worst=${worst.toExponential(2)}`);
}

// [E] seeded fuzz over the gate disk
console.log("[E] gate-disk fuzz (seeded LCG)");
{
  let seed = 4242;
  function rand() {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  }
  const betas = [
    { beta: [0.5, 0.5, 0.8, 0.25], permute: false, tag: "user-ex" },
    { beta: [0.5, 0.5, 0.25, 0.8], permute: true, tag: "user-swap" },
    { beta: [0.3, 0.2, 0.8, 0.2], permute: false, tag: "dom-j2" },
    { beta: [0.1, 0.15, 0.2, 0.3], permute: false, tag: "small" },
  ];
  let worstMs = 0;
  let n = 0;
  for (let k = 0; k < 40; k++) {
    const atLocus = k % 4 === 0;
    const r = atLocus ? 0.5 : 0.5 + (rand() - 0.5) * 2e-4;
    const th = atLocus ? 0 : (rand() - 0.5) * 2e-4;
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
    ? `locus battery: PASS (${checks} checks)`
    : `locus battery: FAIL (${failures} of ${checks} checks failed)`
);
if (failures > 0) process.exit(1);
