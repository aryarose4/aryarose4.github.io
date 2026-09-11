import { makeHyperpolygon, muSU2Coords } from "./solver.js";
const BETA = [1 / 6, 1 / 7, 1 / 7, 1 / 10];
for (const th of [-Math.PI, -1.0, 0.0, Math.PI]) {
  const res = makeHyperpolygon(1.0, th, 0.5, BETA);
  const su2 = muSU2Coords(res.x, res.y);
  console.log(
    `th=${th.toFixed(2)} t=0.5: su2=${Math.hypot(su2[0], su2[1], su2[2]).toExponential(2)}  mu_U1=${res.accuracy.muU1Error.toExponential(2)}  stable=${res.accuracy.usedStable}`
  );
}