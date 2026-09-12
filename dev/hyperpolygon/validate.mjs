// Extracts sample (r, theta, t) entries from the Mathematica Put-format
// data file and compares them against the JS solver, using gauge-invariant
// quantities (the solver's output is only defined up to the residual
// U(2) x U(1)^4 gauge freedom).
import { readFileSync } from "fs";
import {
  makeHyperpolygon,
  muSU2Coords,
  muU1Error,
  muC,
  hyperpolygonVertices,
} from "./solver.js";

const FILE = "/workspaces/Website/aryarose4.github.io/mathematica/hyperpolygonDataPolar";
const BETA = [1 / 6, 1 / 7, 1 / 7, 1 / 10];
const DTHETA = 0.06283185307179587; // 0.01 * 2Pi, as in the data header

// [ir, itheta, it] (1-based), plus the (r, theta, t) we feed the solver
const targets = [
  { idx: [1, 1, 1], r: 0.0, th: -Math.PI, t: 0.0 },
  { idx: [51, 1, 1], r: 0.5, th: -Math.PI, t: 0.0 },
  { idx: [76, 1, 8], r: 0.75, th: -Math.PI, t: 0.35 },
  { idx: [101, 1, 11], r: 1.0, th: -Math.PI, t: 0.5 },
  { idx: [1, 1, 11], r: 0.0, th: -Math.PI, t: 0.5 },
  { idx: [38, 38, 8], r: 0.37, th: -Math.PI + 37 * DTHETA, t: 0.35 },
  { idx: [51, 101, 20], r: 0.5, th: -Math.PI + 100 * DTHETA, t: 0.95 },
];

function extractGroups(text, wanted) {
  const found = new Map();
  const commas = [0, 0, 0, 0, 0, 0, 0, 0];
  let depth = 0;
  let captureKey = null;
  let captureBuf = "";
  let balance = 0;
  for (let pos = 0; pos < text.length; pos++) {
    const ch = text[pos];
    if (captureKey !== null) {
      captureBuf += ch;
      if (ch === "{") balance++;
      else if (ch === "}") {
        balance--;
        if (balance === 0) {
          found.set(captureKey, captureBuf);
          captureKey = null;
          captureBuf = "";
          depth--; // we consumed the group's closing brace
        }
      }
      continue;
    }
    if (ch === "{") {
      depth++;
      commas[depth] = 0;
      if (depth === 5) {
        // it-group: children are ir, itheta, it element indices
        const key = `${commas[2] + 1},${commas[3] + 1},${commas[4] + 1}`;
        if (wanted.has(key)) {
          captureKey = key;
          captureBuf = "{";
          balance = 1;
        }
      }
    } else if (ch === "}") {
      depth--;
    } else if (ch === ",") {
      commas[depth]++;
    }
  }
  return found;
}

function parseNum(s) {
  const m = s.match(/\*\^([+-]?\d+)$/);
  if (m) return parseFloat(s.slice(0, m.index)) * Math.pow(10, parseInt(m[1], 10));
  return parseFloat(s);
}

function parseComplexGroup(s) {
  const tokenRe =
    /([-+]?(?:\d+\.?\d*|\.\d+)(?:\*\^[+-]?\d+)?)(?:\s*([+-])\s*((?:\d+\.?\d*|\.\d+)(?:\*\^[+-]?\d+)?)\s*\*?I)?/g;
  const out = [];
  let m;
  while ((m = tokenRe.exec(s)) !== null) {
    const re = parseNum(m[1]);
    if (m[2] !== undefined) {
      const mag = parseNum(m[3]);
      out.push([re, m[2] === "+" ? mag : -mag]);
    } else {
      out.push([re, 0]);
    }
  }
  return out;
}

function flatToXY(flat) {
  const x = [
    [flat[0], flat[1], flat[2], flat[3]],
    [flat[4], flat[5], flat[6], flat[7]],
  ];
  const y = [
    [flat[8], flat[9]],
    [flat[10], flat[11]],
    [flat[12], flat[13]],
    [flat[14], flat[15]],
  ];
  return { x, y };
}

function cAbs2(a) {
  return a[0] * a[0] + a[1] * a[1];
}

// gauge-invariant fingerprint: per-leg |y_row_i|^2, per-vertex norms and
// per-edge lengths of the su(2) polygon (all invariant under the residual
// U(2) x U(1)^4 gauge freedom)
function fingerprint(x, y) {
  const yNorms = [];
  for (let i = 0; i < 4; i++) {
    yNorms.push(cAbs2(y[i][0]) + cAbs2(y[i][1]));
  }
  const verts = hyperpolygonVertices(x, y);
  const vNorms = verts.map((p) => p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
  const edges = [];
  for (let k = 0; k < verts.length - 1; k++) {
    const d = [
      verts[k + 1][0] - verts[k][0],
      verts[k + 1][1] - verts[k][1],
      verts[k + 1][2] - verts[k][2],
    ];
    edges.push(Math.hypot(...d));
  }
  return { yNorms, vNorms, edges };
}

const fmt = (v) => v.toExponential(2);

console.time("read+extract");
const text = readFileSync(FILE, "utf8");
const wanted = new Set(targets.map((t) => t.idx.join(",")));
const groups = extractGroups(text, wanted);
console.timeEnd("read+extract");
for (const [k, g] of groups) {
  console.log(`group ${k}: head=${JSON.stringify(g.slice(0, 40))} len=${g.length}`);
}

console.log("\n=== comparison vs hyperpolygonDataPolar ===");
for (const tgt of targets) {
  const key = tgt.idx.join(",");
  const g = groups.get(key);
  if (!g) {
    console.log(`MISSING group ${key}`);
    continue;
  }
  const flat = parseComplexGroup(g);
  if (flat.length !== 16) {
    console.log(`group ${key}: expected 16 complex numbers, got ${flat.length}`);
    continue;
  }
  const { x: fileX, y: fileY } = flatToXY(flat);

  const t0 = Date.now();
  // permute=false: the notebook data uses the unpermuted leg convention
  const res = makeHyperpolygon(tgt.r, tgt.th, tgt.t, BETA, false);
  const ms = Date.now() - t0;

  const fileSU2 = muSU2Coords(fileX, fileY);
  const fileSU2Norm = Math.hypot(fileSU2[0], fileSU2[1], fileSU2[2]);
  const fileU1 = muU1Error(fileX, fileY, BETA);
  const fileCNorm = Math.sqrt(Math.max(...muC(fileX, fileY).map(cAbs2)));

  const fpA = fingerprint(res.x, res.y);
  const fpB = fingerprint(fileX, fileY);
  const yDiff = Math.max(...fpA.yNorms.map((v, k) => Math.abs(v - fpB.yNorms[k])));
  const vDiff = Math.max(...fpA.vNorms.map((v, k) => Math.abs(v - fpB.vNorms[k])));
  const eDiff = Math.max(...fpA.edges.map((v, k) => Math.abs(v - fpB.edges[k])));
  const closure = Math.hypot(...res.vertices[8]);

  console.log(
    `\n(r=${tgt.r}, th=${tgt.th.toFixed(4)}, t=${tgt.t})  idx=${key}  ${ms}ms` +
      (res.accuracy.usedStable ? "  [stable path]" : "")
  );
  console.log(
    `  my    residuals: mu_U1=${fmt(res.accuracy.muU1Error)}  su2=${fmt(res.accuracy.su2Norm)}  muC=${fmt(res.accuracy.muCNorm)}  closure=${fmt(closure)}`
  );
  console.log(
    `  file  residuals: mu_U1=${fmt(fileU1)}  su2=${fmt(fileSU2Norm)}  muC=${fmt(fileCNorm)}`
  );
  console.log(`  gauge-invariant | |y_i|^2 diff |_max = ${fmt(yDiff)}`);
  console.log(`  gauge-invariant | vertex norm diff |_max = ${fmt(vDiff)}`);
  console.log(`  gauge-invariant | edge length diff |_max = ${fmt(eDiff)}`);
}