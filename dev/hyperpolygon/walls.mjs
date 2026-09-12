// Stability-chamber battery: validates chambers.js (betaWalls, betaInterval,
// clampToChamber, shortSubsets, chamberInterval, breakingSubsets,
// applyBetaDrag) against the live solver and maps how the solve degrades
// near the chamber walls. Mirrors sweep.mjs conventions (seeded LCG rand,
// worst-value reporting). Exits 1 if any hard assert fails.
//
//   [A]  near-wall conditioning profile (INFO table) + [A2] hard asserts
//        on candidates >= WALL_MARGIN clear of every wall of their slider
//   [B]  t=0 solves in non-dominant chambers (hard; best of 3 draws) +
//        the dominant-chamber no-solution signature at t=0 (INFO)
//   [B2] t=0 stall-rescue regression: lopsided in-chamber betas must solve
//        clean at t=0 now that the solver retries from varied starts (hard)
//   [C]  clampToChamber fuzz incl. on-wall starts (hard)
//   [D]  random chamber walks, solved with the widget call pattern (hard)
//   [E]  widget swap-beta + permute=true equivalence (hard)
//   [F]  default beta intervals + short-subset sanity (hard)
//   [G]  drag events via applyBetaDrag (chamber locked): raw sweep targets
//        clamp into the tracked chamber's closure, only the dragged leg
//        moves, clamped values are fixed points, and breakingSubsets
//        matches the on-wall state (hard)
//   [H]  chamber-lock focused checks: exact wall pins, wall slide-along via
//        cross-drags, inward drag leaves the wall, 0-wall hard floor,
//        chamberInterval vs the betaInterval bracket, fuzz walks with
//        end-of-walk solves (hard)
import { makeHyperpolygon, muSU2Coords, muU1Error } from "./solver.js";
import {
  WALL_MARGIN,
  betaWalls,
  betaInterval,
  clampToChamber,
  shortSubsets,
  chamberInterval,
  breakingSubsets,
  applyBetaDrag,
} from "./chambers.js";

let seed = 24601;
function rand() {
  // LCG for reproducibility (same shape as sweep.mjs, different seed).
  // Math.imul keeps the modular product exact: a plain * loses integer
  // precision above 2^53 and the sequence collapses into a short cycle.
  seed = (Math.imul(seed, 1103515245) + 12345) % 2147483648;
  if (seed < 0) seed += 2147483648;
  return seed / 2147483648;
}

const T0 = Date.now();
let failures = 0;
let solveCount = 0;
function fail(msg) {
  failures++;
  console.log("FAIL: " + msg);
}

// min over the 7 wall conditions |sum_S - sum_complement| (4 single-leg
// subsets + 3 distinct pair partitions; the 6 pair loops cover the same min)
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

function su2NormOf(x, y) {
  const s = muSU2Coords(x, y);
  return Math.hypot(s[0], s[1], s[2]);
}
function closureOf(res) {
  const v = res.vertices[8];
  return Math.hypot(v[0], v[1], v[2]);
}
function fmtBeta(beta) {
  return "[" + beta.map((v) => v.toPrecision(4)).join(", ") + "]";
}
function solveSafe(r, th, t, beta, permute) {
  solveCount++;
  try {
    return makeHyperpolygon(r, th, t, beta, permute);
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}
function sampleBetas(n, lo, hi, minWallDist, needGap) {
  const out = [];
  let guard = 0;
  while (out.length < n && guard < 5000) {
    guard++;
    const b = [
      lo + rand() * (hi - lo),
      lo + rand() * (hi - lo),
      lo + rand() * (hi - lo),
      lo + rand() * (hi - lo),
    ];
    if (wallDist(b) <= minWallDist) continue;
    if (needGap && Math.abs(b[2] - b[3]) <= 0.01) continue;
    out.push(b);
  }
  return out;
}

// ---------------------------------------------------------------------------
// [A] near-wall conditioning profile
console.log("[A] near-wall conditioning profile (INFO; fixed r=0.5, th=0.7, t=0.4, permute=false)");
const DISTS = [0, -1e-9, 1e-9, -1e-7, 1e-7, -1e-5, 1e-5, -1e-4, 1e-4, -3e-4, 3e-4, -1e-3, 1e-3, -3e-3, 3e-3];
const BUCKET_KEYS = [0, 1e-9, 1e-7, 1e-5, 1e-4, 3e-4, 1e-3, 3e-3];
const PROFILE_CAP = 600;

// base betas: entries uniform (0.02, 0.48), rejected on-wall starts
let bases = sampleBetas(12, 0.02, 0.48, 1e-6);
// one combo per (base beta, slider, wall in (0.01, 0.99)); prev/next are the
// base point's bracketing walls for that slider (same rule as betaInterval)
function makeCombos(baseList) {
  const combos = [];
  for (let k = 0; k < baseList.length; k++) {
    for (let i = 0; i < 4; i++) {
      const walls = betaWalls(i, baseList[k]);
      let prev = 0;
      let next = null;
      for (let q = 0; q < walls.length; q++) {
        if (walls[q] <= baseList[k][i]) {
          prev = walls[q];
        } else if (next === null) {
          next = walls[q];
        }
      }
      for (let q = 0; q < walls.length; q++) {
        const w = walls[q];
        if (w > 0.01 && w < 0.99) combos.push({ beta: baseList[k], i, w, prev, next });
      }
    }
  }
  return combos;
}
let combos = makeCombos(bases);
// budget: only walls adjacent to the base point yield candidates (<= 8
// solves each, d = 0 plus one inward sign per offset); far walls cost
// nothing because every candidate would land in another chamber. With 12
// bases that can exceed the cap, so fall back to the first 8 (the cap
// then cannot bind: <= 8 bases x 4 sliders x 2 adjacent walls x 8 = 512).
if (combos.length * 16 > PROFILE_CAP) {
  bases = bases.slice(0, 8);
  combos = makeCombos(bases);
}

const buckets = {};
for (const key of BUCKET_KEYS) buckets[key] = { n: 0, worstSU2: 0, worstU1: 0, bad: 0 };
let asserted = 0;
let a2Bad = 0;
let profileSolves = 0;
let adjacentCombos = 0;
for (const combo of combos) {
  if (combo.w === combo.prev || (combo.next !== null && combo.w === combo.next)) adjacentCombos++;
  if (profileSolves + 16 > PROFILE_CAP) break;
  for (const d of DISTS) {
    const cand = combo.w + d;
    if (!(cand > 1e-4 && cand < 0.999)) continue;
    // candidate must not cross any wall: it may sit on the target wall
    // (d = 0) but must stay inside the base chamber [prev, next]
    if (!(cand >= combo.prev)) continue;
    if (combo.next !== null && cand > combo.next) continue;
    const beta = combo.beta.slice();
    beta[combo.i] = cand;
    profileSolves++;
    const res = solveSafe(0.5, 0.7, 0.4, beta, false);
    const bk = buckets[Math.abs(d)];
    bk.n++;
    if (res.error) {
      bk.bad++;
      continue;
    }
    const su2 = su2NormOf(res.x, res.y);
    const u1 = res.accuracy.muU1Error;
    const fin = isFinite(su2) && isFinite(u1);
    if (fin) {
      if (su2 > bk.worstSU2) bk.worstSU2 = su2;
      if (u1 > bk.worstU1) bk.worstU1 = u1;
    }
    const cl = closureOf(res);
    if (!(fin && isFinite(cl))) {
      bk.bad++;
      continue;
    }
    // [A2] hard: |d| >= WALL_MARGIN AND >= WALL_MARGIN clear of every wall
    // of this slider (i.e. inside the closed margin interval), so this is
    // exactly the region clampToChamber keeps the widget in
    if (
      Math.abs(d) >= WALL_MARGIN - 1e-12 &&
      cand >= combo.prev + WALL_MARGIN - 1e-12 &&
      (combo.next === null || cand <= combo.next - WALL_MARGIN + 1e-12)
    ) {
      asserted++;
      if (!(su2 <= 1e-6 && u1 <= 1e-8 && cl <= 1e-6)) {
        a2Bad++;
        const walls = betaWalls(combo.i, beta);
        let dmin = Infinity;
        for (const w of walls) {
          const dd = Math.abs(cand - w);
          if (dd < dmin) dmin = dd;
        }
        fail(
          `[A2] unhealthy: beta=${fmtBeta(beta)} (slider ${combo.i}, wall ${combo.w.toPrecision(4)}, d=${d.toExponential(1)}) su2=${su2.toExponential(2)} muU1=${u1.toExponential(2)} closure=${cl.toExponential(2)} minWallDist=${dmin.toExponential(2)}`
        );
      }
    }
  }
}
console.log(`  ${bases.length} base betas, ${combos.length} wall targets (${adjacentCombos} base-adjacent), ${profileSolves} solves (cap ${PROFILE_CAP})`);
console.log("      dist  worst su2   worst muU1   bad    n");
for (const key of BUCKET_KEYS) {
  const bk = buckets[key];
  const kd = key === 0 ? "0" : key.toExponential(0);
  console.log(
    `  ${kd.padStart(8)}  ${bk.worstSU2.toExponential(2).padStart(10)}  ${bk.worstU1.toExponential(2).padStart(10)}  ${String(bk.bad).padStart(4)}  ${String(bk.n).padStart(4)}`
  );
}
if (asserted < 25) fail(`[A2] only ${asserted} margin-cleared candidates evaluated (sampler broken)`);
else if (a2Bad === 0)
  console.log(`  [A2] all ${asserted} candidates at >= WALL_MARGIN clearance healthy (su2<=1e-6, muU1<=1e-8, closure<=1e-6)`);

// ---------------------------------------------------------------------------
// [B] t=0 chamber check. Dominant chambers (some leg with 2*b_i >= total)
// are excluded from the sampled cases AND asserted absent: they admit no
// t=0 solution (notebook remark, measured 20/20 for any dominant leg —
// see the INFO line); the INFO section demonstrates that signature.
console.log("[B] t=0 chamber check (r, th random; permute=false; dominant chambers excluded)");
{
  const cases = [[1 / 6, 1 / 7, 1 / 7, 1 / 10]];
  let guard = 0;
  while (cases.length < 6 && guard < 5000) {
    guard++;
    const b = [0.02 + rand() * 0.43, 0.02 + rand() * 0.43, 0.02 + rand() * 0.43, 0.02 + rand() * 0.43];
    if (wallDist(b) <= WALL_MARGIN) continue;
    const tot = b[0] + b[1] + b[2] + b[3];
    let dominant = false;
    for (let i = 0; i < 4; i++) if (2 * b[i] >= tot) dominant = true;
    if (dominant) continue;
    cases.push(b);
  }
  if (cases.length < 6) fail(`[B] sampler produced only ${cases.length} of 6 betas`);
  let bWorstSU2 = 0;
  let bWorstU1 = 0;
  let bWorstCl = 0;
  let bOK = 0;
  let stalls = 0;
  let stallWorst = 0;
  for (const beta of cases) {
    if (!(wallDist(beta) > 1e-6)) fail(`[B] sampled beta on wall: ${fmtBeta(beta)}`);
    const tot = beta[0] + beta[1] + beta[2] + beta[3];
    for (let i = 0; i < 4; i++) {
      if (!(2 * beta[i] < tot)) fail(`[B] beta[${i}]=${beta[i]} sits in a dominant chamber (2*b_i >= total)`);
      const iv = betaInterval(i, beta);
      if (!(iv.prev < beta[i] && (iv.next === null || beta[i] < iv.next)))
        fail(`[B] beta[${i}]=${beta[i]} not inside chamber bracket (${iv.prev}, ${iv.next})`);
      if (!(iv.lo <= beta[i] && beta[i] <= iv.hi))
        fail(`[B] beta[${i}]=${beta[i]} outside its interval [lo, hi]=[${iv.lo}, ${iv.hi}]`);
    }
    // best of 3 (r, th) draws: measured ~11% of draws stall above 1e-6 at
    // t=0 for some lopsided in-chamber betas (solver basin, t=0-specific —
    // see the report); a single draw would make this assert flaky
    let best = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = rand();
      const th = -Math.PI + 2 * Math.PI * rand();
      const res = solveSafe(r, th, 0, beta, false);
      if (res.error) {
        fail(`[B] t=0 solve threw for beta=${fmtBeta(beta)} at r=${r.toFixed(3)}, th=${th.toFixed(3)}: ${res.error}`);
        continue;
      }
      const su2 = su2NormOf(res.x, res.y);
      const u1 = res.accuracy.muU1Error;
      const cl = closureOf(res);
      if (su2 > 1e-6) {
        stalls++;
        if (su2 > stallWorst) stallWorst = su2;
      }
      if (!best || su2 < best.su2) best = { su2, u1, cl, r, th };
      if (best.su2 <= 1e-6) break;
    }
    if (!best) continue;
    if (!(best.su2 <= 1e-6))
      fail(
        `[B] t=0: no clean solve in 3 draws for beta=${fmtBeta(beta)}: best su2=${best.su2.toExponential(2)} at r=${best.r.toFixed(3)}, th=${best.th.toFixed(3)}`
      );
    if (!(best.u1 <= 1e-8)) fail(`[B] t=0 muU1=${best.u1.toExponential(2)} > 1e-8 at beta=${fmtBeta(beta)}`);
    if (!(best.cl <= 1e-6)) fail(`[B] t=0 closure=${best.cl.toExponential(2)} > 1e-6 at beta=${fmtBeta(beta)}`);
    bWorstSU2 = Math.max(bWorstSU2, best.su2);
    bWorstU1 = Math.max(bWorstU1, best.u1);
    bWorstCl = Math.max(bWorstCl, best.cl);
    bOK++;
  }
  console.log(
    `  t=0: ${bOK}/${cases.length} in-chamber betas clean (best of 3 draws); ${stalls} drawn stall(s), worst stall su2=${stallWorst.toExponential(2)}; worst clean su2=${bWorstSU2.toExponential(2)}  muU1=${bWorstU1.toExponential(2)}  closure=${bWorstCl.toExponential(2)}`
  );
  // INFO: the notebook's remark — a dominant chamber has no t=0 solution
  // (measured for ANY leg: 20/20 random dominant betas degrade at t=0)
  const BAD = [0.6, 0.1, 0.1, 0.1];
  const iv = betaInterval(0, BAD);
  const resBad = solveSafe(0.5, 0.7, 0, BAD, false);
  if (resBad.error) {
    console.log(`  INFO bad chamber (0.6,0.1,0.1,0.1) t=0 (b0>b1+b2+b3): solve THREW: ${resBad.error}`);
  } else {
    console.log(
      `  INFO bad chamber (0.6,0.1,0.1,0.1) t=0 (b0>b1+b2+b3): su2=${su2NormOf(resBad.x, resBad.y).toExponential(2)}  muU1=${resBad.accuracy.muU1Error.toExponential(2)}  closure=${closureOf(resBad).toExponential(2)}${resBad.accuracy.usedStable ? "  [stable]" : ""}`
    );
  }
  console.log(
    `  INFO betaInterval(0, (0.6,0.1,0.1,0.1)) = [${iv.lo}, ${iv.hi}] (prev=${iv.prev}, next=${iv.next === null ? "none" : iv.next}) — the API treats dominant chambers as valid; their degeneracy is t=0-specific`
  );
}

// ---------------------------------------------------------------------------
// [B2] t=0 stall-rescue regression. The solver's standard path (Newton from
// [0,0,1] + stable fallback) used to stall at su(2) ~1e-1 for ~11% of (r,th)
// draws at t=0 for lopsided in-chamber betas (basin issue, 2026-09-12
// report); makeHyperpolygon now retries from varied starts when the result
// is inaccurate. Every seeded t=0 draw must solve clean.
console.log("[B2] t=0 stall-rescue regression (lopsided in-chamber betas, seeded (r,th) draws)");
{
  const REPRO = [0.2535, 0.05673, 0.02333, 0.2573];
  const resRepro = solveSafe(0.3238, -1.9477, 0, REPRO, false);
  if (resRepro.error) fail(`[B2] reported repro point threw: ${resRepro.error}`);
  else {
    const su2r = su2NormOf(resRepro.x, resRepro.y);
    if (!(su2r <= 1e-6)) fail(`[B2] reported repro stall survived rescue: su2=${su2r.toExponential(2)}`);
    else
      console.log(
        `  [B2] reported repro point (r=0.3238, th=-1.9477, t=0): su2=${su2r.toExponential(2)} (was 1.3e-1 pre-rescue)`
      );
  }
  const cases = [REPRO];
  let guard = 0;
  while (cases.length < 4 && guard < 5000) {
    guard++;
    const b = [0.02 + rand() * 0.43, 0.02 + rand() * 0.43, 0.02 + rand() * 0.43, 0.02 + rand() * 0.43];
    const tot = b[0] + b[1] + b[2] + b[3];
    let dominant = false;
    let small = false;
    for (let i = 0; i < 4; i++) {
      if (2 * b[i] >= tot) dominant = true;
      if (b[i] < 0.05 * tot) small = true;
    }
    if (dominant || !small) continue; // stay near the previously-stalling regime
    if (!(wallDist(b) > 1e-6)) continue;
    cases.push(b);
  }
  const DRAWS = 25;
  let worstSU2 = 0;
  let worstU1 = 0;
  let slowest = 0;
  let n = 0;
  for (const beta of cases) {
    for (let k = 0; k < DRAWS; k++) {
      const r = rand();
      const th = -Math.PI + 2 * Math.PI * rand();
      const t0 = Date.now();
      const res = solveSafe(r, th, 0, beta, false);
      slowest = Math.max(slowest, Date.now() - t0);
      n++;
      if (res.error) {
        fail(`[B2] t=0 solve threw for beta=${fmtBeta(beta)} at r=${r.toFixed(3)}, th=${th.toFixed(3)}: ${res.error}`);
        continue;
      }
      const su2 = su2NormOf(res.x, res.y);
      if (!(su2 <= 1e-6))
        fail(
          `[B2] t=0 stall survived rescue: beta=${fmtBeta(beta)} r=${r.toFixed(3)} th=${th.toFixed(3)} su2=${su2.toExponential(2)}`
        );
      if (!(res.accuracy.muU1Error <= 1e-8))
        fail(`[B2] t=0 muU1=${res.accuracy.muU1Error.toExponential(2)} > 1e-8 at beta=${fmtBeta(beta)}`);
      worstSU2 = Math.max(worstSU2, su2);
      worstU1 = Math.max(worstU1, res.accuracy.muU1Error);
    }
  }
  if (n < 50) fail(`[B2] sampler produced only ${n} t=0 solves`);
  console.log(
    `  [B2] ${n} t=0 draws across ${cases.length} lopsided in-chamber betas: worst su2=${worstSU2.toExponential(2)}  worst muU1=${worstU1.toExponential(2)}  slowest=${slowest}ms`
  );
}

// ---------------------------------------------------------------------------
// [C] clampToChamber fuzz
console.log("[C] clampToChamber fuzz (3000 random + 500 pinned-on-wall)");
{
  const before = failures;
  let minWD = Infinity;
  const check = (beta, tag) => {
    clampToChamber(beta);
    const after1 = beta.slice();
    for (let i = 0; i < 4; i++) {
      if (!(after1[i] > 0 && after1[i] <= 1)) {
        fail(`[C] ${tag}: beta[${i}]=${after1[i]} outside (0, 1] after clamp: ${JSON.stringify(after1)}`);
        return;
      }
    }
    const wd = wallDist(after1);
    if (wd < minWD) minWD = wd;
    if (!(wd > 1e-9)) {
      fail(`[C] ${tag}: on-wall after clamp: ${JSON.stringify(after1)} wallDist=${wd.toExponential(2)}`);
      return;
    }
    if (clampToChamber(beta)) {
      fail(
        `[C] ${tag}: not idempotent (2nd call moved): after1=${JSON.stringify(after1)} after2=${JSON.stringify(beta)}`
      );
    }
    const wd2 = wallDist(beta);
    if (!(wd2 > 1e-9)) {
      fail(`[C] ${tag}: on-wall after idempotency probe: ${JSON.stringify(beta)} wallDist=${wd2.toExponential(2)}`);
    }
  };
  for (let k = 0; k < 3000; k++) {
    check(
      [0.001 + rand() * 0.599, 0.001 + rand() * 0.599, 0.001 + rand() * 0.599, 0.001 + rand() * 0.599],
      "rand"
    );
  }
  for (let k = 0; k < 500; k++) {
    const base = sampleBetas(1, 0.02, 0.45, 1e-4)[0];
    const j = Math.floor(rand() * 4);
    const walls = betaWalls(j, base);
    const w = walls[Math.floor(rand() * walls.length)];
    base[j] = w;
    check(base, `onwall(slider ${j}, w=${w.toPrecision(3)})`);
  }
  const cBad = failures - before;
  console.log(
    `  3500 cases: bounds (0,1], off-wall > 1e-9, idempotent — ${cBad === 0 ? "all OK" : cBad + " failures"}; min post-clamp wallDist=${minWD.toExponential(2)}`
  );
}

// ---------------------------------------------------------------------------
// [D] chamber-walk integration
console.log("[D] chamber-walk integration (40 walks x 30 steps from the default beta)");
{
  let dWorstSU2 = 0;
  let dWorstU1 = 0;
  let dWorstCl = 0;
  let dMinWD = Infinity;
  let okSolves = 0;
  for (let walk = 0; walk < 40; walk++) {
    const beta = [1 / 6, 1 / 7, 1 / 7, 1 / 10];
    let walkFailed = false;
    for (let step = 0; step < 30; step++) {
      const i = Math.floor(rand() * 4);
      const iv = betaInterval(i, beta);
      if (iv.lo > iv.hi) {
        beta[i] = 0.5 * (iv.prev + (iv.next === null ? 1 : iv.next));
      } else {
        beta[i] = iv.lo + rand() * (iv.hi - iv.lo);
      }
      clampToChamber(beta);
      const wd = wallDist(beta);
      if (wd < dMinWD) dMinWD = wd;
      if (!(wd > 1e-9)) {
        fail(`[D] walk ${walk} step ${step}: on-wall after clamp: ${fmtBeta(beta)} wallDist=${wd.toExponential(2)}`);
        walkFailed = true;
      }
      for (let q = 0; q < 4; q++) {
        if (!(beta[q] > 0 && beta[q] <= 1))
          fail(`[D] walk ${walk} step ${step}: beta[${q}]=${beta[q]} outside (0, 1]`);
      }
    }
    if (walkFailed) continue;
    const r = rand();
    const th = -Math.PI + 2 * Math.PI * rand();
    const t = 0.99 * rand();
    // widget call pattern: legs 2/3 of beta pre-swapped + permute=true
    const res = solveSafe(r, th, t, [beta[0], beta[1], beta[3], beta[2]], true);
    if (res.error) {
      fail(`[D] walk ${walk}: solve threw at beta=${fmtBeta(beta)} (r=${r.toFixed(3)}, th=${th.toFixed(3)}, t=${t.toFixed(3)}): ${res.error}`);
      continue;
    }
    const su2 = su2NormOf(res.x, res.y);
    const u1 = res.accuracy.muU1Error;
    const cl = closureOf(res);
    if (!(isFinite(su2) && isFinite(u1) && isFinite(cl))) {
      fail(`[D] walk ${walk}: NaN at beta=${fmtBeta(beta)} (t=${t.toFixed(3)})`);
      continue;
    }
    if (!(su2 <= 1e-6)) fail(`[D] walk ${walk}: su2=${su2.toExponential(2)} at beta=${fmtBeta(beta)} t=${t.toFixed(3)}`);
    if (!(u1 <= 1e-8)) fail(`[D] walk ${walk}: muU1=${u1.toExponential(2)} at beta=${fmtBeta(beta)} t=${t.toFixed(3)}`);
    if (!(cl <= 1e-6)) fail(`[D] walk ${walk}: closure=${cl.toExponential(2)} at beta=${fmtBeta(beta)} t=${t.toFixed(3)}`);
    if (su2 <= 1e-6 && u1 <= 1e-8 && cl <= 1e-6) {
      dWorstSU2 = Math.max(dWorstSU2, su2);
      dWorstU1 = Math.max(dWorstU1, u1);
      dWorstCl = Math.max(dWorstCl, cl);
      okSolves++;
    }
  }
  console.log(
    `  1200 clamped steps stayed off-wall (min step wallDist=${dMinWD.toExponential(2)}); end-of-walk widget-pattern solves: ${okSolves}/40 clean; worst su2=${dWorstSU2.toExponential(2)}  muU1=${dWorstU1.toExponential(2)}  closure=${dWorstCl.toExponential(2)}`
  );
}

// ---------------------------------------------------------------------------
// [E] widget call-pattern equivalence. Dominant chambers are excluded from
// the sampler (not widget-reachable; their solves degrade at small t —
// see [B]'s INFO and the report), so the su2/closure thresholds are
// meaningful; the swap-equivalence itself is chamber-independent.
console.log("[E] widget call-pattern equivalence (solve beta=[b0,b1,b3,b2], permute=true)");
{
  const cases = [];
  let guard = 0;
  while (cases.length < 40 && guard < 5000) {
    guard++;
    const b = [0.02 + rand() * 0.43, 0.02 + rand() * 0.43, 0.02 + rand() * 0.43, 0.02 + rand() * 0.43];
    if (wallDist(b) <= WALL_MARGIN) continue;
    if (Math.abs(b[2] - b[3]) <= 0.01) continue;
    const tot = b[0] + b[1] + b[2] + b[3];
    let dominant = false;
    for (let i = 0; i < 4; i++) if (2 * b[i] >= tot) dominant = true;
    if (dominant) continue;
    cases.push(b);
  }
  if (cases.length < 40) fail(`[E] sampler produced only ${cases.length} of 40 betas`);
  let eWorstU1 = 0;
  let eWorstSU2 = 0;
  let eWorstCl = 0;
  let okSolves = 0;
  for (const beta of cases) {
    if (!(wallDist(beta) > 1e-6)) fail(`[E] precondition: on-wall beta=${fmtBeta(beta)}`);
    const r = rand();
    const th = -Math.PI + 2 * Math.PI * rand();
    const t = 0.99 * rand();
    const res = solveSafe(r, th, t, [beta[0], beta[1], beta[3], beta[2]], true);
    if (res.error) {
      fail(`[E] solve threw at beta=${fmtBeta(beta)} (r=${r.toFixed(3)}, th=${th.toFixed(3)}, t=${t.toFixed(3)}): ${res.error}`);
      continue;
    }
    const u1user = muU1Error(res.x, res.y, beta);
    const su2 = su2NormOf(res.x, res.y);
    const cl = closureOf(res);
    if (!(isFinite(u1user) && isFinite(su2) && isFinite(cl))) {
      fail(`[E] NaN at beta=${fmtBeta(beta)} (t=${t.toFixed(3)})`);
      continue;
    }
    if (!(u1user <= 1e-8))
      fail(
        `[E] displayed pair mu_U1 vs user beta = ${u1user.toExponential(2)} > 1e-8 at beta=${fmtBeta(beta)} (r=${r.toFixed(3)}, th=${th.toFixed(3)}, t=${t.toFixed(3)})`
      );
    if (!(su2 <= 1e-6))
      fail(`[E] su2=${su2.toExponential(2)} > 1e-6 at beta=${fmtBeta(beta)} (r=${r.toFixed(3)}, th=${th.toFixed(3)}, t=${t.toFixed(3)})`);
    if (!(cl <= 1e-6))
      fail(`[E] closure=${cl.toExponential(2)} > 1e-6 at beta=${fmtBeta(beta)} (r=${r.toFixed(3)}, th=${th.toFixed(3)}, t=${t.toFixed(3)})`);
    if (u1user <= 1e-8 && su2 <= 1e-6 && cl <= 1e-6) {
      eWorstU1 = Math.max(eWorstU1, u1user);
      eWorstSU2 = Math.max(eWorstSU2, su2);
      eWorstCl = Math.max(eWorstCl, cl);
      okSolves++;
    }
  }
  console.log(
    `  40 betas (|b2-b3|>0.01): displayed pair satisfies mu_U1 = user beta, worst=${eWorstU1.toExponential(2)}; worst su2=${eWorstSU2.toExponential(2)}  closure=${eWorstCl.toExponential(2)}; ${okSolves}/40 clean`
  );
}

// ---------------------------------------------------------------------------
// [F] defaults sanity (the chamber the widget locks at load)
console.log("[F] defaults sanity (beta = (1/6, 1/7, 1/7, 1/10))");
{
  const beta = [1 / 6, 1 / 7, 1 / 7, 1 / 10];
  for (let i = 0; i < 4; i++) {
    const iv = betaInterval(i, beta);
    if (!(iv.lo < beta[i] && beta[i] < iv.hi))
      fail(`[F] beta[${i}]=${beta[i]} not strictly inside [lo, hi]=[${iv.lo}, ${iv.hi}]`);
    console.log(
      `  beta[${i}]=${beta[i].toFixed(4)} strictly inside [lo=${iv.lo.toFixed(4)}, hi=${iv.hi.toFixed(4)}]  (prev=${iv.prev.toFixed(4)}, next=${iv.next === null ? "none" : iv.next.toFixed(4)})`
    );
  }
  const copy = beta.slice();
  if (clampToChamber(copy)) fail("[F] clampToChamber moved the default beta (initial snap)");
  else console.log("  clampToChamber(copy) moved nothing: OK");
  // short subsets of the default beta, in slot order (trivial, leg slots,
  // pair slots): the inequalities the widget displays as boxes
  const EXPECT = [[], [0], [1], [2], [3], [2, 3], [1, 3], [0, 3]];
  const sh = shortSubsets(beta);
  const eqS = (A, B) =>
    A.length === B.length &&
    A.every((I, k) => I.length === B[k].length && I.every((v, m) => v === B[k][m]));
  if (!eqS(sh, EXPECT))
    fail(`[F] shortSubsets(default) = ${JSON.stringify(sh)}, expected ${JSON.stringify(EXPECT)}`);
  else
    console.log(
      `  shortSubsets(default) = ${JSON.stringify(sh)} — the displayed chamber inequalities: OK`
    );
  // locked-chamber intervals must reproduce the closed betaInterval bracket
  for (let i = 0; i < 4; i++) {
    const ci = chamberInterval(i, beta, sh);
    const iv = betaInterval(i, beta);
    const expLo = Math.max(iv.prev, WALL_MARGIN);
    const expHi = iv.next === null ? 1 : iv.next;
    if (!(ci.lo <= beta[i] && beta[i] <= ci.hi))
      fail(`[F] beta[${i}]=${beta[i]} outside the locked-chamber interval [${ci.lo}, ${ci.hi}]`);
    if (!(Math.abs(ci.lo - expLo) <= 1e-9 && Math.abs(ci.hi - expHi) <= 1e-9))
      fail(
        `[F] chamberInterval [${ci.lo}, ${ci.hi}] != closed bracket [${expLo}, ${expHi}] on slider ${i}`
      );
    console.log(
      `  chamberInterval(${i}) = [${ci.lo.toFixed(4)}, ${ci.hi.toFixed(4)}] (closed bracket of prev=${iv.prev.toFixed(4)}, next=${iv.next === null ? "none" : iv.next.toFixed(4)}): OK`
    );
  }
  if (breakingSubsets(beta, sh).length !== 0)
    fail(`[F] default beta flagged on-wall: ${JSON.stringify(breakingSubsets(beta, sh))}`);
  else console.log("  default beta off-wall (no breaking inequalities): OK");
}

// ---------------------------------------------------------------------------
// [G] drag-event regression (2026-09-12: the chamber is LOCKED to the
// initial one — applyBetaDrag clamps the dragged value into the tracked
// chamber's closure (chamberInterval), so a wall may be touched but never
// crossed; this replaced snap-and-ride after accidental chamber flips).
// Simulates the widget's per-event sequence: applyBetaDrag(i, beta, raw,
// shorts) with raw (uncurated) targets sweeping the whole slider.
// Invariants per event: only the dragged leg moves (bit-exact); every
// weight stays in (0, 1]; every tracked-chamber inequality holds (so the
// chamber can never change); no leg strictly dominant; in-span raw values
// pass through bit-exactly and out-of-span ones pin exactly at a bound;
// re-applying the same event is an exact no-op; and breakingSubsets is
// nonempty exactly when the tuple sits on a wall.
console.log("[G] drag events via applyBetaDrag (chamber locked to the default chamber)");
{
  const START = [1 / 6, 1 / 7, 1 / 7, 1 / 10];
  const shorts = shortSubsets(START);
  const minSlack = (beta) => {
    let m = Infinity;
    for (let s = 1; s < shorts.length; s++) {
      const I = shorts[s];
      let sI = 0;
      let sC = 0;
      for (let n = 0; n < 4; n++) {
        if (I.indexOf(n) === -1) sC += beta[n];
        else sI += beta[n];
      }
      if (sC - sI < m) m = sC - sI;
    }
    return m;
  };
  let events = 0;
  let solves = 0;
  let cleanSolves = 0;
  let pinnedFinals = 0;
  let worstSU2 = 0;
  let worstU1 = 0;
  let pinnedWorstSU2 = 0;
  let worstSlack = Infinity;
  let slowest = 0;
  for (let drag = 0; drag < 40; drag++) {
    const beta = START.slice();
    const i = drag % 4;
    for (let k = 0; k < 20; k++) {
      // raw drag targets sweep the whole slider, repeatedly hitting walls
      const raw = k % 3 === 0 ? rand() : k % 3 === 1 ? 1 - rand() * 1e-9 : rand() * 1e-9;
      const before = beta.slice();
      const iv0 = chamberInterval(i, before, shorts);
      const clamped = applyBetaDrag(i, beta, raw, shorts);
      events++;
      for (let n = 0; n < 4; n++) {
        if (n !== i && beta[n] !== before[n])
          fail(`[G] leg ${n} moved on slider ${i}, event ${k}: ${fmtBeta(beta)}`);
        if (!(beta[n] > 0 && isFinite(beta[n]) && beta[n] <= 1))
          fail(`[G] beta[${n}]=${beta[n]} outside (0,1] on slider ${i}, event ${k}`);
      }
      const slack = minSlack(beta);
      if (slack < worstSlack) worstSlack = slack;
      if (!(slack >= -1e-9))
        fail(
          `[G] chamber inequality violated on slider ${i}, event ${k} (slack ${slack.toExponential(2)}): beta=${fmtBeta(beta)}`
        );
      let total = 0;
      for (let n = 0; n < 4; n++) total += beta[n];
      for (let n = 0; n < 4; n++) {
        if (!(2 * beta[n] <= total + 1e-9))
          fail(`[G] leg ${n} strictly dominant on slider ${i}, event ${k}: beta=${fmtBeta(beta)}`);
      }
      if (raw >= iv0.lo && raw <= iv0.hi) {
        if (clamped || beta[i] !== raw)
          fail(`[G] in-span raw not passed through bit-exactly on slider ${i}, event ${k}`);
      } else if (!clamped || (beta[i] !== iv0.lo && beta[i] !== iv0.hi)) {
        fail(
          `[G] out-of-span raw not pinned at a bound on slider ${i}, event ${k}: beta[i]=${beta[i]} span=[${iv0.lo}, ${iv0.hi}]`
        );
      }
      const snap = beta.slice();
      const clamped2 = applyBetaDrag(i, beta, raw, shorts);
      for (let n = 0; n < 4; n++) {
        if (beta[n] !== snap[n])
          fail(`[G] re-apply moved weights on slider ${i}, event ${k}`);
      }
      if (clamped2 !== clamped)
        fail(`[G] re-apply changed the clamped flag on slider ${i}, event ${k}`);
      const wd = wallDist(beta);
      const brk = breakingSubsets(beta, shorts).length;
      if (wd <= 1e-12 && brk === 0)
        fail(`[G] on-wall but no breaking inequality on slider ${i}, event ${k}: wallDist=${wd.toExponential(2)}`);
      if (wd > 1e-8 && brk > 0)
        fail(`[G] breaking inequality off-wall on slider ${i}, event ${k}: wallDist=${wd.toExponential(2)}`);
    }
    // end-of-drag solve with the widget call pattern; pinned finals sit ON
    // a wall (allowed to degrade a bit — the wall is a degenerate locus);
    // best of 3 draws (near-wall tuples can hit the solver's theta=0 stall
    // basin at isolated draws — same mitigation as [B])
    const t = 0.99 * rand();
    const t0 = Date.now();
    let best = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = rand();
      const th = -Math.PI + 2 * Math.PI * rand();
      const res = solveSafe(r, th, t, [beta[0], beta[1], beta[3], beta[2]], true);
      slowest = Math.max(slowest, Date.now() - t0);
      if (res.error) {
        fail(`[G] end-of-drag solve threw: ${res.error}`);
        continue;
      }
      const su2 = su2NormOf(res.x, res.y);
      if (!isFinite(su2)) {
        fail(`[G] end-of-drag NaN: beta=${fmtBeta(beta)}`);
        continue;
      }
      if (!best || su2 < best.su2) best = { su2, u1: res.accuracy.muU1Error };
      if (best.su2 <= 1e-6) break;
    }
    solves++;
    if (best) {
      if (wallDist(beta) <= 1e-9) {
        pinnedFinals++;
        if (!(best.su2 <= 0.05))
          fail(`[G] pinned end-of-drag solve badly degraded: su2=${best.su2.toExponential(2)} beta=${fmtBeta(beta)} t=${t.toFixed(3)}`);
        if (!(best.u1 <= 1e-8))
          fail(`[G] pinned end-of-drag muU1=${best.u1.toExponential(2)} beta=${fmtBeta(beta)}`);
        pinnedWorstSU2 = Math.max(pinnedWorstSU2, best.su2);
      } else {
        if (!(best.su2 <= 1e-6))
          fail(`[G] end-of-drag solve degraded: su2=${best.su2.toExponential(2)} beta=${fmtBeta(beta)} t=${t.toFixed(3)}`);
        if (!(best.u1 <= 1e-8))
          fail(`[G] end-of-drag muU1=${best.u1.toExponential(2)} beta=${fmtBeta(beta)}`);
        worstSU2 = Math.max(worstSU2, best.su2);
        worstU1 = Math.max(worstU1, best.u1);
        cleanSolves++;
      }
    }
  }
  console.log(
    `  [G] ${events} drag events x 40 drags (raw targets sweep [0,1], chamber locked): min chamber slack=${worstSlack === Infinity ? "n/a" : worstSlack.toExponential(2)}; end-of-drag solves ${solves}/40 (${cleanSolves} strictly in-chamber clean, ${pinnedFinals} pinned on-wall, worst pinned su2=${pinnedWorstSU2.toExponential(2)}); non-pinned worst su2=${worstSU2.toExponential(2)}  muU1=${worstU1.toExponential(2)}  slowest=${slowest}ms`
  );
}

// ---------------------------------------------------------------------------
// [H] chamber-lock focused checks (the chamber-lock mechanic that replaced
// snap-and-ride): exact wall pins, wall slide-along via cross-drags, wall
// contact release, 0-wall floor, bracket agreement, fuzz walks.
console.log("[H] chamber lock focused checks (applyBetaDrag + chamberInterval)");
{
  const DEF = [1 / 6, 1 / 7, 1 / 7, 1 / 10];
  const shorts = shortSubsets(DEF);
  const eqSubsets = (A, B) =>
    A.length === B.length &&
    A.every((I, k) => I.length === B[k].length && I.every((v, m) => v === B[k][m]));
  // (a) upper-wall pin on slider 0: the {0,3}|{1,2} pair wall at
  // b0 = b1+b2-b3 ≈ 0.1857. The pinned value must equal the bound
  // bit-exactly, no other leg may move, and the breaking inequality must
  // be exactly the short side {0,3} of that split.
  {
    const beta = DEF.slice();
    const iv0 = chamberInterval(0, beta, shorts);
    const ivOld = betaInterval(0, beta);
    if (!(Math.abs(iv0.lo - ivOld.prev) <= 1e-12 && Math.abs(iv0.hi - ivOld.next) <= 1e-12))
      fail(
        `[H](a) chamberInterval [${iv0.lo}, ${iv0.hi}] does not match the closed betaInterval bracket (${ivOld.prev}, ${ivOld.next})`
      );
    const raw = iv0.hi + 0.02;
    if (applyBetaDrag(0, beta, raw, shorts) !== true)
      fail("[H](a) wall-crossing drag not reported as clamped");
    if (beta[0] !== iv0.hi) fail(`[H](a) beta[0]=${beta[0]} not pinned at the bound ${iv0.hi}`);
    for (let n = 1; n < 4; n++)
      if (beta[n] !== DEF[n]) fail(`[H](a) beta[${n}] moved on a locked drag`);
    if (!(wallDist(beta) <= 1e-12))
      fail(`[H](a) not on the wall: wallDist=${wallDist(beta).toExponential(2)} beta=${fmtBeta(beta)}`);
    if (!eqSubsets(breakingSubsets(beta, shorts), [[0, 3]]))
      fail(`[H](a) breaking=${JSON.stringify(breakingSubsets(beta, shorts))}, expected [[0,3]]`);
    // (a2) lower-wall pin on slider 0: the {1,3}|{0,2} pair wall at
    // b0 = b1+b3-b2 = 0.1. Because beta1 = beta2 exactly (both 1/7), the
    // {2,3}|{0,1} wall COINCIDES with it (both bounds evaluate to 0.1), so
    // pinning there breaks two inequalities at once — a codim-2 pinch.
    const beta2 = DEF.slice();
    if (applyBetaDrag(0, beta2, iv0.lo - 0.02, shorts) !== true)
      fail("[H](a2) lower wall-crossing drag not reported as clamped");
    if (Math.abs(beta2[0] - iv0.lo) > 1e-12)
      fail(`[H](a2) beta2[0]=${beta2[0]} not pinned at ${iv0.lo}`);
    if (!(wallDist(beta2) <= 1e-12)) fail(`[H](a2) not on wall: ${fmtBeta(beta2)}`);
    if (!eqSubsets(breakingSubsets(beta2, shorts), [[2, 3], [1, 3]]))
      fail(`[H](a2) breaking=${JSON.stringify(breakingSubsets(beta2, shorts))}, expected [[2,3],[1,3]]`);
  }
  // (b/c) cross-drag slide-along and release: with beta[0] pinned on the
  // {0,3} wall, dragging beta[1] DOWN clamps at the SAME wall (the tuple
  // slides along it); dragging beta[1] UP releases that wall's contact and
  // pins at the next chamber wall ({1,3}); an inward in-span drag then
  // leaves wall contact entirely
  {
    const beta = DEF.slice();
    const iv0 = chamberInterval(0, beta, shorts);
    applyBetaDrag(0, beta, iv0.hi + 0.02, shorts);
    if (applyBetaDrag(1, beta, 0.05, shorts) !== true)
      fail("[H](b) downward cross-drag not clamped");
    const expected = beta[0] + beta[3] - beta[2];
    if (!(Math.abs(beta[1] - expected) <= 1e-12))
      fail(`[H](b) beta[1]=${beta[1]} not slid onto the {0,3} wall (expected ${expected})`);
    if (!(wallDist(beta) <= 1e-12)) fail(`[H](b) off wall after slide-along: ${fmtBeta(beta)}`);
    if (applyBetaDrag(1, beta, 0.3, shorts) !== true)
      fail("[H](b2) upward cross-drag not clamped");
    if (!(wallDist(beta) <= 1e-12)) fail(`[H](b2) off wall after upward cross-drag: ${fmtBeta(beta)}`);
    if (!eqSubsets(breakingSubsets(beta, shorts), [[1, 3]]))
      fail(`[H](b2) breaking=${JSON.stringify(breakingSubsets(beta, shorts))}, expected [[1,3]]`);
    if (applyBetaDrag(1, beta, 0.2, shorts) !== false)
      fail("[H](c) in-span drag reported as clamped");
    if (beta[1] !== 0.2) fail(`[H](c) beta[1]=${beta[1]} != raw 0.2`);
    if (breakingSubsets(beta, shorts).length !== 0)
      fail(`[H](c) wall contact not released: ${JSON.stringify(breakingSubsets(beta, shorts))}`);
  }
  // (d) the 0 positivity wall stays a hard floor (it is never a chamber
  // inequality, so no touching)
  {
    const beta = DEF.slice();
    if (applyBetaDrag(3, beta, 0.001, shorts) !== true)
      fail("[H](d) 0-wall drag not reported as clamped");
    if (beta[3] !== WALL_MARGIN) fail(`[H](d) 0-wall did not floor: beta[3]=${beta[3]}`);
    for (let n = 0; n < 3; n++)
      if (beta[n] !== DEF[n]) fail(`[H](d) beta[${n}] moved`);
  }
  // (e) chamberInterval reproduces the closed betaInterval bracket on
  // random off-wall NON-dominant betas. (betaWalls omits the "another leg
  // is dominant" wall positions, which are negative in non-dominant
  // chambers, so the bracket agreement is checked there; chamberInterval
  // itself is complete — it derives bounds from the short subsets, and
  // dominant chambers show up correctly as lower bounds from the short
  // triple.)
  {
    let checked = 0;
    let guard = 0;
    const bases = [];
    while (bases.length < 40 && guard < 5000) {
      guard++;
      const b = [0.05 + rand() * 0.35, 0.05 + rand() * 0.35, 0.05 + rand() * 0.35, 0.05 + rand() * 0.35];
      if (wallDist(b) <= 0.02) continue;
      const tot = b[0] + b[1] + b[2] + b[3];
      let dominant = false;
      for (let n = 0; n < 4; n++) if (2 * b[n] >= tot) dominant = true;
      if (dominant) continue;
      bases.push(b);
    }
    for (const base of bases) {
      const sh = shortSubsets(base);
      for (let i = 0; i < 4; i++) {
        const iv = betaInterval(i, base);
        const ci = chamberInterval(i, base, sh);
        const expLo = Math.max(iv.prev, WALL_MARGIN);
        const expHi = iv.next === null ? 1 : iv.next;
        if (!(ci.lo <= base[i] + 1e-12 && base[i] <= ci.hi + 1e-12))
          fail(`[H](e) beta[i]=${base[i]} outside the locked interval [${ci.lo}, ${ci.hi}] at beta=${fmtBeta(base)} slider ${i}`);
        if (!(Math.abs(ci.lo - expLo) <= 1e-9 && Math.abs(ci.hi - expHi) <= 1e-9))
          fail(
            `[H](e) chamberInterval [${ci.lo}, ${ci.hi}] != closed bracket [${expLo}, ${expHi}] at beta=${fmtBeta(base)} slider ${i}`
          );
        checked++;
      }
    }
    console.log(`  [H](e) chamberInterval matches the closed betaInterval bracket on ${checked} (slider, beta) pairs`);
  }
  // (f) fuzz: random-leg random-target walks with per-event invariants
  // (chamber closure, bit-exact leg isolation, pinning, idempotency,
  // breaking⟺on-wall) and end-of-walk solves at moderate t
  {
    let events = 0;
    let pinnedFinals = 0;
    let cleanEnds = 0;
    let worstPinnedSU2 = 0;
    let minSlack = Infinity;
    for (let walk = 0; walk < 60; walk++) {
      const beta = DEF.slice();
      for (let k = 0; k < 40; k++) {
        const i = Math.floor(rand() * 4);
        const raw = rand();
        const before = beta.slice();
        const iv0 = chamberInterval(i, before, shorts);
        const clamped = applyBetaDrag(i, beta, raw, shorts);
        events++;
        for (let n = 0; n < 4; n++) {
          if (n !== i && beta[n] !== before[n])
            fail(`[H](f) leg ${n} moved at walk ${walk} event ${k}: ${fmtBeta(beta)}`);
          if (!(beta[n] > 0 && isFinite(beta[n]) && beta[n] <= 1))
            fail(`[H](f) beta[${n}]=${beta[n]} outside (0,1] at walk ${walk} event ${k}`);
        }
        if (raw >= iv0.lo && raw <= iv0.hi) {
          if (clamped || beta[i] !== raw)
            fail(`[H](f) in-span pass-through broken at walk ${walk} event ${k}`);
        } else if (!clamped || (beta[i] !== iv0.lo && beta[i] !== iv0.hi)) {
          fail(`[H](f) out-of-span pin broken at walk ${walk} event ${k}: beta[i]=${beta[i]}`);
        }
        for (let s = 1; s < shorts.length; s++) {
          const I = shorts[s];
          let sI = 0;
          let sC = 0;
          for (let n = 0; n < 4; n++) {
            if (I.indexOf(n) === -1) sC += beta[n];
            else sI += beta[n];
          }
          if (sC - sI < minSlack) minSlack = sC - sI;
          if (!(sC - sI >= -1e-9))
            fail(
              `[H](f) chamber inequality violated at walk ${walk} event ${k}: ${JSON.stringify(I)} slack=${(sC - sI).toExponential(2)} beta=${fmtBeta(beta)}`
            );
        }
        const snap = beta.slice();
        applyBetaDrag(i, beta, raw, shorts);
        for (let n = 0; n < 4; n++) {
          if (beta[n] !== snap[n])
            fail(`[H](f) re-apply moved weights at walk ${walk} event ${k}`);
        }
        const wd = wallDist(beta);
        const brk = breakingSubsets(beta, shorts).length;
        if (wd <= 1e-12 && brk === 0)
          fail(`[H](f) on-wall but no breaking inequality at walk ${walk} event ${k}: wallDist=${wd.toExponential(2)}`);
        if (wd > 1e-8 && brk > 0)
          fail(`[H](f) breaking inequality off-wall at walk ${walk} event ${k}: wallDist=${wd.toExponential(2)}`);
      }
      // end-of-walk solve with the widget call pattern (best of 3 draws:
      // near-wall tuples can hit the theta=0 stall basin at isolated draws
      // — same mitigation as [B])
      let best = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = rand();
        const th = -Math.PI + 2 * Math.PI * rand();
        const res = solveSafe(r, th, 0.5, [beta[0], beta[1], beta[3], beta[2]], true);
        if (res.error) {
          fail(`[H](f) end-of-walk solve threw at walk ${walk}: ${res.error}`);
          continue;
        }
        const su2 = su2NormOf(res.x, res.y);
        const u1 = muU1Error(res.x, res.y, beta);
        if (!best || su2 < best.su2) best = { su2, u1 };
        if (best.su2 <= 1e-6) break;
      }
      if (best) {
        if (wallDist(beta) <= 1e-9) {
          pinnedFinals++;
          if (!(best.su2 <= 0.05))
            fail(`[H](f) pinned end-of-walk solve badly degraded: su2=${best.su2.toExponential(2)} beta=${fmtBeta(beta)}`);
          if (!(best.u1 <= 1e-8))
            fail(`[H](f) pinned end-of-walk muU1=${best.u1.toExponential(2)} beta=${fmtBeta(beta)}`);
          worstPinnedSU2 = Math.max(worstPinnedSU2, best.su2);
        } else {
          if (!(best.su2 <= 1e-6 && best.u1 <= 1e-8))
            fail(
              `[H](f) end-of-walk solve dirty at walk ${walk}: su2=${best.su2.toExponential(2)} muU1=${best.u1.toExponential(2)} beta=${fmtBeta(beta)}`
            );
          cleanEnds++;
        }
      }
    }
    console.log(
      `  [H](f) 60 fuzz walks x 40 events (chamber locked): ${events} events, min chamber slack=${minSlack === Infinity ? "n/a" : minSlack.toExponential(2)}; end-of-walk solves: ${cleanEnds} strictly in-chamber clean, ${pinnedFinals} pinned on-wall (worst su2=${worstPinnedSU2.toExponential(2)} at t=0.5)`
    );
  }
}

// ---------------------------------------------------------------------------
const ms = Date.now() - T0;
console.log(`\nwalls battery: ${failures === 0 ? "PASS" : "FAIL (" + failures + ")"}`);
console.log(`  total: ${solveCount} solves, ${ms} ms`);
process.exitCode = failures === 0 ? 0 : 1;
