// Regression fingerprint for the hyperpolygon modules.
//
// Builds a deterministic, full-precision fingerprint of the BEHAVIOR of
// solver.js / chambers.js / orientation.js / sideview.js (pure parts) over a
// fixed grid of inputs, and compares it bit-for-bit against a stored golden
// file. Used to guarantee zero behavioral regressions across refactors.
//
// Usage:
//   node fingerprint.mjs golden [file]   write the golden fingerprint
//   node fingerprint.mjs check  [file]   compare against it (exit 1 on diff)
//
// The golden file is machine-local (V8 version + platform FP behavior enter
// the bits); regenerate it on a toolchain change. It is NOT wired into
// run-validation.sh — the committed suites own their own bit-exactness
// gates; this file exists for refactor audits.
//
// Serialization: JSON-like, object keys sorted, numbers via Number.toString
// (exact round-trip in V8), NaN -> "NaN", +-Infinity -> "+Inf"/"-Inf". Two
// runs on the same machine produce identical strings iff every observed
// value is bit-identical.

import { writeFileSync, readFileSync, existsSync, copyFileSync } from "fs";
import { spawnSync } from "child_process";

// Fingerprint the LIVE modules: refresh the dev-folder copies the same way
// run-validation.sh does (Node 12 needs the .js files next to the harness
// for ESM resolution), then re-exec this file. The re-exec is REQUIRED:
// the static imports of ./solver.js etc. below are hoisted and evaluated
// BEFORE this body runs, so loading them in THIS process would read the
// PREVIOUS copies; the child (FP_REFRESHED=1) skips the copy loop and
// imports the fresh files.
const FINGERPRINT_MODULES = ["solver.js", "orientation.js", "chambers.js", "sideview.js"];
if (!process.env.FP_REFRESHED) {
  for (const f of FINGERPRINT_MODULES) {
    copyFileSync(new URL(`../../assets/js/hyperpolygon/${f}`, import.meta.url).pathname, new URL(`./${f}`, import.meta.url).pathname);
  }
  const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname], {
    env: Object.assign({}, process.env, { FP_REFRESHED: "1" }),
    stdio: "inherit",
  });
  process.exit(r.status === null ? 1 : r.status);
}

import {
  makeHyperpolygon,
  solveCore,
  exteriorPair,
  stratumPair,
  dominantLeg,
  starIndex,
  cycleIndex,
  muSU2Coords,
  muU1Error,
  muC,
  CYCLE_ANSATZ,
} from "./solver.js";
import {
  shortSubsets,
  chamberInterval,
  breakingSubsets,
  applyBetaDrag,
  betaWalls,
  betaInterval,
  clampToChamber,
} from "./chambers.js";
import { makeOrientor, bestFitRotation } from "./orientation.js";
import {
  centralRadius,
  pairRadius,
  flowState,
  spherePoint,
  probeExteriorMap,
} from "./sideview.js";

// ---------- deterministic serialization ----------

function ser(v) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  const t = typeof v;
  if (t === "number") {
    if (Number.isNaN(v)) return "NaN";
    if (!Number.isFinite(v)) return v > 0 ? "+Inf" : "-Inf";
    return v.toString();
  }
  if (t === "boolean" || t === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(ser).join(",") + "]";
  if (t === "object") {
    const keys = Object.keys(v).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + ser(v[k])).join(",") + "}";
  }
  return JSON.stringify(String(v));
}

// ---------- deterministic pseudo-random fuzz ----------

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

// ---------- case builders (each returns [label, value] pairs) ----------

const PI = Math.PI;

const BETAS = [
  ["B0star3", [0.4, 0.5, 0.5, 0.25]],
  ["B1mixed", [0.1, 0.15, 0.2, 0.3]],
  ["B2dom0", [0.55, 0.2, 0.12, 0.13]],
  ["B3dom1", [0.2, 0.55, 0.13, 0.12]],
  ["B4cycle", [0.35, 0.35, 0.15, 0.15]],
  ["B5nearwall", [0.25, 0.25, 0.25, 0.250000001]],
  ["B6onwall", [0.25, 0.25, 0.25, 0.25]],
];

const RS = [0, 1e-5, 0.25, 0.5, 0.5 + 1e-4, 0.75, 1 - 1e-5, 1];
const THETAS = [0, 1e-4, -1e-4, PI / 2, -PI / 2, PI * (1 - 1e-9), -PI];
const TS = [0, 0.1, 0.5, 0.9, 0.99];

function solverCases() {
  const out = [];
  // classification of every beta set
  for (const [name, beta] of BETAS) {
    out.push([`class ${name}`, {
      dom: dominantLeg(beta),
      star: starIndex(beta),
      cycle: cycleIndex(beta),
      shorts: shortSubsets(beta),
    }]);
  }
  for (const [name, beta] of BETAS) {
    for (const r of RS) {
      for (const th of THETAS) {
        for (const t of TS) {
          const res = makeHyperpolygon(r, th, t, beta, false);
          out.push([`solve ${name} r=${r} th=${th} t=${t}`, res]);
          out.push([`resid ${name} r=${r} th=${th} t=${t}`, {
            su2: muSU2Coords(res.x, res.y),
            u1: muU1Error(res.x, res.y, beta),
            mc: muC(res.x, res.y),
          }]);
        }
      }
    }
  }
  // permute path (widget PERMUTE_23 call pattern) on the default beta
  for (const r of RS) {
    for (const th of THETAS) {
      const res = makeHyperpolygon(r, th, 0.5, BETAS[0][1], true);
      out.push([`permute r=${r} th=${th}`, res]);
    }
  }
  // direct solveCore on both ansatze
  for (const r of [0.1, 0.5, 0.9]) {
    for (const t of [0.1, 0.9]) {
      out.push([`core star r=${r} t=${t}`, solveCore(r, 0.3, t, BETAS[0][1], false)]);
      out.push([`core cycle r=${r} t=${t}`, solveCore(r, 0.3, t, BETAS[4][1], false, CYCLE_ANSATZ)]);
    }
  }
  return out;
}

function exteriorCases() {
  const out = [];
  for (const [name, beta] of [BETAS[2], BETAS[3]]) {
    const j = dominantLeg(beta);
    for (const r of [0, 1e-9, 0.25, 0.5, 0.75, 1]) {
      for (const th of [0, 0.5, PI / 2, -1.0, PI]) {
        const p = exteriorPair(r, th, beta, j);
        out.push([`ext ${name} j=${j} r=${r} th=${th}`, p === null ? null : { x: p[0], y: p[1] }]);
      }
    }
  }
  return out;
}

function stratumCases() {
  const out = [];
  for (const [name, beta] of [BETAS[0], BETAS[4], BETAS[6]]) {
    const shorts = shortSubsets(beta).filter((s) => s.length === 2);
    for (const I of shorts) {
      for (const t1 of [0, 0.25, 0.5, 0.99, 1]) {
        out.push([`strat ${name} I=${I} t1=${t1}`, stratumPair(t1, beta, I, false)]);
        out.push([`stratP ${name} I=${I} t1=${t1}`, stratumPair(t1, beta, I, true)]);
      }
    }
  }
  return out;
}

function chamberCases() {
  const out = [];
  const rand = lcg(20260919);
  const tuples = [];
  for (let k = 0; k < 16; k++) {
    const b = [0.05 + 0.9 * rand(), 0.05 + 0.9 * rand(), 0.05 + 0.9 * rand(), 0.05 + 0.9 * rand()];
    tuples.push(b.map((v) => Math.round(v * 1000) / 1000));
  }
  tuples.push([0.4, 0.5, 0.5, 0.25], [0.25, 0.25, 0.25, 0.25], [0.6, 0.13, 0.14, 0.13],
    [0.13, 0.14, 0.6, 0.13], [0.13, 0.13, 0.13, 0.61], [0.49999999, 0.5, 0.25, 0.25],
    [0.2, 0.55, 0.13, 0.12], [0.35, 0.35, 0.15, 0.15]);
  tuples.forEach((beta, bi) => {
    const shorts = shortSubsets(beta);
    out.push([`ch ${bi} shorts`, shorts]);
    out.push([`ch ${bi} walls`, beta.map((_, i) => betaWalls(i, beta))]);
    out.push([`ch ${bi} interval`, beta.map((_, i) => betaInterval(i, beta))]);
    out.push([`ch ${bi} clamp`, clampToChamber(beta)]);
    out.push([`ch ${bi} breaking`, breakingSubsets(beta, shorts)]);
    for (let i = 0; i < 4; i++) {
      out.push([`ch ${bi} ci i=${i}`, chamberInterval(i, beta, shorts)]);
      const b2 = beta.slice();
      const walk = [];
      for (let s = 0; s <= 12; s++) {
        applyBetaDrag(i, b2, s / 12, shorts);
        walk.push(b2.slice());
      }
      out.push([`ch ${bi} drag i=${i}`, walk]);
    }
  });
  return out;
}

// rigid rotation matrix for the orientation jump path
function rotMat(axis, ang) {
  const [x, y, z] = axis;
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}
function rotApply(R, v) {
  return [
    R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
    R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
    R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
  ];
}

function orientCases() {
  const out = [];
  const R = rotMat([0.3, 0.5, Math.sqrt(1 - 0.3 * 0.3 - 0.5 * 0.5)], 0.7);
  const beta = [0.4, 0.5, 0.5, 0.25];
  // path 1: a slider-style sweep of solved walks
  const o1 = makeOrientor();
  const captures1 = [];
  for (let f = 0; f < 180; f++) {
    const r = 0.25 + 0.5 * (f / 180);
    const th = 0.3 * Math.sin(f / 30);
    const res = makeHyperpolygon(r, th, 0.5, beta, false);
    const q = o1.update(res.vertices, 1 / 60);
    if (f % 15 === 0) captures1.push({ f, q });
  }
  out.push(["orient sweep", captures1]);
  // path 2: rigid gauge jump mid-walk (exercises bestFitRotation absorption)
  const o2 = makeOrientor();
  const captures2 = [];
  const base = makeHyperpolygon(0.4, 0.2, 0.5, beta, false).vertices;
  for (let f = 0; f < 60; f++) {
    const v = f < 30 ? base : base.map((p) => (p[0] === 0 && p[1] === 0 && p[2] === 0 ? p : rotApply(R, p)));
    const q = o2.update(v, 1 / 60);
    if (f % 10 === 0) captures2.push({ f, q });
  }
  out.push(["orient jump", captures2]);
  // bestFitRotation itself on the rigid pair
  out.push(["bestfit", bestFitRotation(base, base.map((p) => (p[0] === 0 && p[1] === 0 && p[2] === 0 ? p : rotApply(R, p))))]);
  return out;
}

function sideviewCases() {
  const out = [];
  for (const [name, beta] of [BETAS[0], BETAS[2], BETAS[4], BETAS[6]]) {
    const shorts = shortSubsets(beta);
    const R = centralRadius(beta);
    out.push([`sv ${name} centralRadius`, R]);
    const shorts2 = shorts.filter((s) => s.length === 2);
    for (const I of shorts2) out.push([`sv ${name} pairR ${I}`, pairRadius(beta, I)]);
    for (const extMap of [[7, 5, 6], [null, null, null]]) {
      for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        for (const th of [0, 0.3, -0.3, PI / 2]) {
          for (const t of [0, 0.05, 0.5, 0.95, 1]) {
            for (const gamma of [0, 0.7]) {
              const fs = flowState(r, th, t, beta, shorts, extMap, gamma, null);
              out.push([`sv ${name} flow r=${r} th=${th} t=${t} g=${gamma} m=${extMap[0]}`, fs]);
            }
          }
        }
      }
    }
    const fs = flowState(0.5, 0, 0.95, beta, shorts, [7, 5, 6], 0, { k: 0, t1: 0.3 });
    out.push([`sv ${name} stratumflow`, fs]);
  }
  for (const [name, beta] of [BETAS[0], BETAS[4], BETAS[2]]) {
    out.push([`sv ${name} probe`, probeExteriorMap(beta, shortSubsets(beta))]);
  }
  for (const [r, th] of [[0, 0], [0.5, 0], [1, 0], [0.3, 1.1]]) {
    out.push([`sv pt r=${r} th=${th}`, spherePoint(r, th, 0.37)]);
  }
  return out;
}

// ---------- driver ----------

const GOLDEN_DEFAULT = new URL("./fingerprint-golden.json", import.meta.url).pathname;

function build() {
  const sections = [
    ["solver", solverCases()],
    ["exterior", exteriorCases()],
    ["stratum", stratumCases()],
    ["chambers", chamberCases()],
    ["orientation", orientCases()],
    ["sideview", sideviewCases()],
  ];
  const parts = [];
  for (const [name, cases] of sections) {
    parts.push(`##${name}\n` + cases.map(([l, v]) => l + "\t" + ser(v)).join("\n"));
  }
  return parts.join("\n");
}

const mode = process.argv[2] || "check";
const path = process.argv[3] || GOLDEN_DEFAULT;

if (mode === "golden") {
  const fp = build();
  writeFileSync(path, JSON.stringify({ created: "regenerated on demand", bytes: fp.length, fingerprint: fp }, null, 1));
  console.log(`fingerprint written: ${path} (${fp.length} chars)`);
} else {
  if (!existsSync(path)) {
    console.error(`golden file missing: ${path} (run 'node fingerprint.mjs golden' first)`);
    process.exit(2);
  }
  const golden = JSON.parse(readFileSync(path, "utf8")).fingerprint;
  const now = build();
  if (now === golden) {
    console.log(`fingerprint OK (${now.length} chars, bit-identical)`);
  } else {
    let i = 0;
    while (i < Math.min(golden.length, now.length) && golden[i] === now[i]) i++;
    const lo = Math.max(0, i - 120);
    console.error(`FINGERPRINT MISMATCH at char ${i} of ${Math.min(golden.length, now.length)}`);
    console.error(`golden: ...${golden.slice(lo, i + 160)}`);
    console.error(`now   : ...${now.slice(lo, i + 160)}`);
    process.exit(1);
  }
}
