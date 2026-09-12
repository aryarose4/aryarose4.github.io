import { makeHyperpolygon } from "./solver.js";
const BETA = [1 / 6, 1 / 7, 1 / 7, 1 / 10];
const t0 = Date.now();
const res = makeHyperpolygon(0.5, 0, 0.5, BETA);
const ms = Date.now() - t0;
console.log("solve:", ms + "ms", "accuracy:", JSON.stringify(res.accuracy));
console.log(
  "vertices:",
  res.vertices.map((p) => p.map((v) => v.toFixed(3)).join(",")).join("  ")
);
console.log("closure norm:", Math.hypot(...res.vertices[8]).toExponential(2));