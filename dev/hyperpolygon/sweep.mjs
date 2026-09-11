// Randomized self-consistency sweep: for random (r, theta, t) and several
// beta choices, check that the solver's output satisfies the moment map
// equations to high precision and that the polygon closes.
import { makeHyperpolygon, muSU2Coords, muU1Error, muC } from "./solver.js";

function cAbs2(a) {
  return a[0] * a[0] + a[1] * a[1];
}

const betaSets = [
  { beta: [1 / 6, 1 / 7, 1 / 7, 1 / 10], label: "(1/6,1/7,1/7,1/10)" },
  { beta: [0.1, 0.15, 0.2, 0.3], label: "(0.1,0.15,0.2,0.3)" },
  { beta: [0.13, 0.17, 0.19, 0.27], label: "(0.13,0.27 mixed)" },
];

let seed = 12345;
function rand() {
  // LCG for reproducibility
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

for (const { beta, label } of betaSets) {
  let worstSU2 = 0;
  let worstU1 = 0;
  let worstC = 0;
  let worstClosure = 0;
  let stableCount = 0;
  let worstMs = 0;
  const N = 200;
  for (let k = 0; k < N; k++) {
    const r = rand();
    const th = -Math.PI + 2 * Math.PI * rand();
    const t = 0.99 * rand();
    const t0 = Date.now();
    const res = makeHyperpolygon(r, th, t, beta);
    const ms = Date.now() - t0;
    worstMs = Math.max(worstMs, ms);
    const su2 = muSU2Coords(res.x, res.y);
    const su2Norm = Math.hypot(su2[0], su2[1], su2[2]);
    const u1 = muU1Error(res.x, res.y, beta);
    const cn = Math.sqrt(Math.max(...muC(res.x, res.y).map(cAbs2)));
    const cl = Math.hypot(...res.vertices[8]);
    if (su2Norm > worstSU2) worstSU2 = su2Norm;
    if (u1 > worstU1) worstU1 = u1;
    if (cn > worstC) worstC = cn;
    if (cl > worstClosure) worstClosure = cl;
    if (res.accuracy.usedStable) stableCount++;
  }
  console.log(
    `beta=${label}: ${N} pts  worst su2=${worstSU2.toExponential(2)}  worst mu_U1=${worstU1.toExponential(2)}  worst muC=${worstC.toExponential(2)}  worst closure=${worstClosure.toExponential(2)}  stable-used=${stableCount}  slowest=${worstMs}ms`
  );
}

// stress the r -> 1 edge specifically
console.log("\nr = 1 edge cases:");
for (const th of [-Math.PI, -1.0, 0.0, 0.7, Math.PI]) {
  for (const t of [0.0, 0.5, 0.95]) {
    const beta = betaSets[0].beta;
    const t0 = Date.now();
    const res = makeHyperpolygon(1.0, th, t, beta);
    const ms = Date.now() - t0;
    const su2 = muSU2Coords(res.x, res.y);
    console.log(
      `  th=${th.toFixed(2)} t=${t}: su2=${Math.hypot(su2[0], su2[1], su2[2]).toExponential(2)}  mu_U1=${res.accuracy.muU1Error.toExponential(2)}  ${ms}ms${res.accuracy.usedStable ? " [stable]" : ""}`
    );
  }
}