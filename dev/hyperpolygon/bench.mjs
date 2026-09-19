// Micro-benchmarks for the hyperpolygon hot paths. Usage: node bench.mjs
// Reports per-op times; run before and after a change to compare.

import { copyFileSync } from "fs";
import { spawnSync } from "child_process";

// Bench the LIVE modules: refresh the dev-folder copies first, then re-exec.
// REQUIRED because the static imports below are hoisted and evaluated
// before this body runs (see fingerprint.mjs for the same pattern).
const BENCH_MODULES = ["solver.js", "orientation.js", "chambers.js", "sideview.js"];
if (!process.env.BENCH_REFRESHED) {
  for (const f of BENCH_MODULES) {
    copyFileSync(new URL(`../../assets/js/hyperpolygon/${f}`, import.meta.url).pathname, new URL(`./${f}`, import.meta.url).pathname);
  }
  const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname], {
    env: Object.assign({}, process.env, { BENCH_REFRESHED: "1" }),
    stdio: "inherit",
  });
  process.exit(r.status === null ? 1 : r.status);
}

import { makeHyperpolygon, hyperpolygonVertices, muSU2Coords } from "./solver.js";
import { makeOrientor } from "./orientation.js";
import { shortSubsets, chamberInterval } from "./chambers.js";
import { flowState } from "./sideview.js";

const now = () => Number(process.hrtime.bigint()) / 1e6; // ms

// n iterates of fn(i) after a proper warmup (one call never reaches
// steady-state JIT; ~n/10 warmup iterations keep tier-up out of the
// timed loop).
function bench(label, n, fn) {
  const warm = Math.max(10, Math.floor(n / 10));
  for (let i = 0; i < warm; i++) fn(i);
  const t0 = now();
  for (let i = 0; i < n; i++) fn(i);
  const total = now() - t0;
  console.log(`${label.padEnd(34)} ${n} iters  ${(total / n).toFixed(4)} ms/op  (${total.toFixed(0)} ms total)`);
}

const beta = [0.4, 0.5, 0.5, 0.25];

// solver: interior slider-style sweep (the per-input-event path), inputs
// derived from the loop index so every op solves a DIFFERENT point
let acc = 0;
bench("makeHyperpolygon interior", 300, (i) => {
  acc += makeHyperpolygon(0.1 + 0.8 * (i / 300), 0.3 * Math.sin(i / 7), 0.5, beta, false).accuracy.su2Norm;
});

// vertices + residual (display rebuild path)
const pair = makeHyperpolygon(0.4, 0.2, 0.5, beta, false);
bench("hyperpolygonVertices", 20000, () => { acc += hyperpolygonVertices(pair.x, pair.y)[8][0]; });
bench("muSU2Coords", 100000, () => { acc += muSU2Coords(pair.x, pair.y)[0]; });

// orientation servo, idle path (same walk every frame — the widget passes
// the unchanged solved vertices between slider events)
const o = makeOrientor();
bench("orientor.update (idle)", 50000, () => { acc += o.update(pair.vertices, 1 / 60)[0]; });

// orientation servo, active path: the walk input is PRE-ROTATED outside
// the timed loop (precomputed stimuli), so the measurement covers only
// update() itself (fillDp + Horn machinery), not stimulus construction.
const o2 = makeOrientor();
const WALKS = 64;
const walks = [];
{
  const axis = [0.267, 0.535, 0.802];
  const c = Math.cos(0.01), s = Math.sin(0.01), t = 1 - c;
  const R = [
    [t * axis[0] * axis[0] + c, t * axis[0] * axis[1] - s * axis[2], t * axis[0] * axis[2] + s * axis[1]],
    [t * axis[0] * axis[1] + s * axis[2], t * axis[1] * axis[1] + c, t * axis[1] * axis[2] - s * axis[0]],
    [t * axis[0] * axis[2] - s * axis[1], t * axis[1] * axis[2] + s * axis[0], t * axis[2] * axis[2] + c],
  ];
  let w = pair.vertices.map((p) => p.slice());
  for (let k = 0; k < WALKS; k++) {
    walks.push(w.map((p) => p.slice()));
    w = w.map((p) => [
      R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2],
      R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2],
      R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2],
    ]);
  }
}
bench("orientor.update (active walk)", 5000, (i) => { acc += o2.update(walks[i % WALKS], 1 / 60)[0]; });

// chambers (per beta-slider input event)
bench("shortSubsets+chamberInterval", 20000, () => {
  const s = shortSubsets(beta);
  acc += chamberInterval(1, beta, s)[0];
});

// side view flow state (per-frame)
const shorts = shortSubsets(beta);
bench("flowState", 20000, () => { acc += flowState(0.3, 0.4, 0.5, beta, shorts, [7, 5, 6], 0.3, null).dot[0]; });

if (!Number.isFinite(acc)) console.log("(unreachable)");
console.log("done");
