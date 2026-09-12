// Orientation battery for the display orientor (./orientation.js).
//
// Simulates the widget loop: one orientor.update() call per frame at
// dt = 1/60, idle (servo on) except during drag frames, against vertices
// from the real solver along the slider paths. Checks chord pinning (A),
// drag continuity (B), one-step jump smoothness (C), static stability (D),
// servo path-independence (E) and quaternion sanity (F).
//
// Tolerance note (deviation from the flat spec ceilings, measured): the
// pointwise frameJump of DISPLAYED frames inherently contains the raw
// polygon's own frame-to-frame motion, which reaches 0.95-1.0 per frame on
// the t=0.99 paths (scale explosions / chord whips near r -> 1 and s -> 0)
// and on the defaults -> target jumps of test C. The kabsch shape-slush
// ceiling (scale-normalized) and the flat 0.5 ceiling therefore cannot
// hold there for ANY chord-pinning orientor; the exact-pinning reference
// sim below jumps the same way. The assertions use
//   max(literal ceiling, raw-motion allowance)
// so the literal ceiling still applies wherever the raw data allows it,
// and the worst violation of each literal ceiling is reported alongside.

import { makeHyperpolygon } from "./solver.js";
import { makeOrientor } from "./orientation.js";

const BETA = [1 / 6, 1 / 7, 1 / 7, 1 / 10];
const DT = 1 / 60;
const SETTLE = 40;
const FL = 1 - Math.exp(-DT / 0.04); // transport lag factor per frame
const SERVO_CAP = 2.5 * DT; // max servo twist per frame (rad)

function norm3(a) {
  return Math.hypot(a[0], a[1], a[2]);
}
function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function wrapToPi(x) {
  return x - 2 * Math.PI * Math.round(x / (2 * Math.PI));
}
// rotate v by the quaternion in three.js [x, y, z, w] order
function qRot(q, v) {
  const qv = [q[0], q[1], q[2]];
  const c1 = cross3(qv, v);
  const t = [c1[0] + q[3] * v[0], c1[1] + q[3] * v[1], c1[2] + q[3] * v[2]];
  const c2 = cross3(qv, t);
  return [v[0] + 2 * c2[0], v[1] + 2 * c2[1], v[2] + 2 * c2[2]];
}
function disp(pts, q) {
  return pts.map((p) => qRot(q, p));
}
function frameJump(A, B) {
  const sa = Math.max(...A.map(norm3));
  const sb = Math.max(...B.map(norm3));
  const sc = Math.max(sa, sb, 1e-12);
  let mx = 0;
  for (let i = 0; i < A.length; i++) mx = Math.max(mx, norm3(sub3(A[i], B[i])));
  return mx / sc;
}
// deviation of the displayed chord from the +y axis: norm of its xz-plane
// components (0 = exactly vertical)
function chordDev(pts, q) {
  const c = sub3(pts[4], pts[0]);
  const l = norm3(c);
  const u = qRot(q, c);
  return Math.hypot(u[0] / l, u[2] / l);
}
function chordRatio(pts) {
  let sc = 0;
  for (const p of pts) sc = Math.max(sc, norm3(p));
  return norm3(sub3(pts[4], pts[0])) / sc;
}
// kabsch shape difference (optimal rotation, per-shape scale normalized);
// copied from the transport prototype
function kabschAngle(P, Q) {
  const n = P.length;
  const cp = [0, 0, 0];
  const cq = [0, 0, 0];
  for (const p of P) for (let k = 0; k < 3; k++) cp[k] += p[k] / n;
  for (const q of Q) for (let k = 0; k < 3; k++) cq[k] += q[k] / n;
  const H = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < n; i++)
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) H[a][b] += (P[i][a] - cp[a]) * (Q[i][b] - cq[b]);
  const Sxx = H[0][0], Sxy = H[0][1], Sxz = H[0][2];
  const Syx = H[1][0], Syy = H[1][1], Syz = H[1][2];
  const Szx = H[2][0], Szy = H[2][1], Szz = H[2][2];
  const S = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  let q = [1, 0, 0, 0];
  for (let it = 0; it < 100; it++) {
    const nq = [0, 0, 0, 0];
    for (let a = 0; a < 4; a++) {
      let v = 0;
      for (let b = 0; b < 4; b++) v += S[a][b] * q[b];
      nq[a] = v;
    }
    const nn = Math.hypot(nq[0], nq[1], nq[2], nq[3]) || 1;
    q = nq.map((v) => v / nn);
  }
  function rot(p) {
    const [w, x, y, z] = q;
    return [
      (1 - 2 * (y * y + z * z)) * p[0] + 2 * (x * y - w * z) * p[1] + 2 * (x * z + w * y) * p[2],
      2 * (x * y + w * z) * p[0] + (1 - 2 * (x * x + z * z)) * p[1] + 2 * (y * z - w * x) * p[2],
      2 * (x * z - w * y) * p[0] + 2 * (y * z + w * x) * p[1] + (1 - 2 * (x * x + y * y)) * p[2],
    ];
  }
  const np = P.map((p) => sub3(p, cp));
  const nq = Q.map((p) => sub3(p, cq));
  const sp = Math.max(...np.map(norm3)) || 1;
  const sq = Math.max(...nq.map(norm3)) || 1;
  let res = 0;
  for (let i = 0; i < n; i++) {
    const rp = rot(np[i].map((v) => v / sp));
    const qq = nq[i].map((v) => v / sq);
    res = Math.max(res, norm3(sub3(rp, qq)));
  }
  return res;
}

// exact chord-pinning reference (no lag, no servo), same freeze rules as
// the orientor; from the transport prototype
function axisAngleMat(k, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const t = 1 - c;
  const [x, y, z] = k;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}
function matVec(M, v) {
  return [
    M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
    M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
    M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
  ];
}
function matMul(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let v = 0;
      for (let k = 0; k < 3; k++) v += A[3 * i + k] * B[3 * k + j];
      C[3 * i + j] = v;
    }
  return C;
}
function shortestArc(u, v) {
  const c = Math.max(-1, Math.min(1, dot3(u, v)));
  const k = cross3(u, v);
  const s = norm3(k);
  if (s < 1e-14) return c > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : axisAngleMat([1, 0, 0], Math.PI);
  return axisAngleMat([k[0] / s, k[1] / s, k[2] / s], Math.acos(c));
}
const EY = [0, 1, 0];
function refAlign(pts, state) {
  const d = sub3(pts[4], pts[0]);
  const dl = norm3(d);
  let scale = 0;
  for (const p of pts) scale = Math.max(scale, norm3(p));
  if (dl < 1e-3 * scale) state.frozen = true;
  else if (dl > 1e-2 * scale) state.frozen = false;
  if (state.R === null) {
    if (state.frozen) return pts.slice();
    state.R = shortestArc([d[0] / dl, d[1] / dl, d[2] / dl], EY);
  } else if (!state.frozen) {
    const u = matVec(state.R, [d[0] / dl, d[1] / dl, d[2] / dl]);
    state.R = matMul(shortestArc(u, EY), state.R);
  }
  return pts.map((p) => matVec(state.R, p));
}

const cache = new Map();
function solve(r, s, t) {
  const key = r + "|" + s + "|" + t;
  let v = cache.get(key);
  if (!v) {
    v = makeHyperpolygon(r, s * Math.PI, t, BETA).vertices;
    cache.set(key, v);
  }
  return v;
}

// slider paths, as in the transport prototype (200 param steps each)
const paths = [];
for (const r of [0, 0.25, 0.5, 0.75, 1]) for (const t of [0.1, 0.5, 0.99]) paths.push({ type: "s", r, t });
for (const s of [-1, -0.5, 0, 0.5, 1]) for (const t of [0.1, 0.5, 0.99]) paths.push({ type: "r", s, t });
for (const r of [0, 0.5, 1]) for (const s of [-1, 0, 1]) paths.push({ type: "t", r, s });

function pathPoint(path, f) {
  if (path.type === "s") return { r: path.r, s: -1 + 2 * f, t: path.t };
  if (path.type === "r") return { r: f, s: path.s, t: path.t };
  return { r: path.r, s: path.s, t: 0.99 * f };
}
// linear walk from widget defaults to the path start (init realism)
function walkPoint(path, f) {
  const d = pathPoint(path, 0);
  return { r: 0.5 + (d.r - 0.5) * f, s: d.s * f, t: 0.5 + (d.t - 0.5) * f };
}

let failures = 0;
function report(name, ok, detail) {
  console.log((ok ? "PASS " : "FAIL ") + name + "  " + detail);
  if (!ok) failures++;
}

// ---- A + B + F: one simulation over all paths ----
const t0 = Date.now();
let worstA = 0;
let worstAAt = null;
let worstFunit = 0;
let worstFrot = 0;
let worstJt = 0;
let worstLit = 0;
let worstLitAt = null;
let worstBEx = 0;
let worstBExAt = null;
let worstWinJt = 0;
let worstWinLit = 0;
let worstWinEx = 0;
let nPairs = 0;
let nChecked = 0;
let nTrans = 0;
for (const path of paths) {
  const orientor = makeOrientor();
  const ref = { R: null, frozen: false };
  const seq = [];
  for (let i = 0; i <= 50; i++) {
    const p = walkPoint(path, i / 50);
    const pts = solve(p.r, p.s, p.t);
    seq.push({ pts, idle: false });
    for (let k = 0; k < SETTLE; k++) seq.push({ pts, idle: true });
  }
  const walkLen = seq.length;
  const groupEnds = [];
  for (let i = 1; i <= 200; i++) {
    const p = pathPoint(path, i / 200);
    const pts = solve(p.r, p.s, p.t);
    const start = seq.length;
    seq.push({ pts, idle: false });
    for (let k = 0; k < SETTLE; k++) seq.push({ pts, idle: true });
    groupEnds.push(start + SETTLE);
  }
  const frames = [];
  let frozen = false;
  for (const st of seq) {
    const q = orientor.update(st.pts, DT, { idle: st.idle });
    const rd = refAlign(st.pts, ref);
    const x = chordRatio(st.pts);
    if (x < 1e-3) frozen = true;
    else if (x > 1e-2) frozen = false;
    frames.push({ raw: st.pts, q, d: disp(st.pts, q), rd, fr: frozen, e: chordDev(st.pts, q) });
  }
  for (const gi of groupEnds) frames[gi].settled = true;
  const transIdx = [];
  for (let k = walkLen; k < frames.length; k++) {
    if (frames[k].fr !== frames[k - 1].fr) transIdx.push(k);
  }
  nTrans += transIdx.length;
  let ti = 0;
  for (let k = Math.max(1, walkLen); k < frames.length; k++) {
    nPairs++;
    const f = frames[k];
    const p = frames[k - 1];
    // F: unit norm and pure rotation at every simulated frame
    const nn = Math.hypot(f.q[0], f.q[1], f.q[2], f.q[3]);
    worstFunit = Math.max(worstFunit, Math.abs(nn - 1));
    for (let i = 0; i < 9; i++) {
      const ri = qRot(f.q, f.raw[i]);
      worstFrot = Math.max(worstFrot, Math.abs(norm3(ri) - norm3(f.raw[i])));
    }
    while (ti < transIdx.length && transIdx[ti] < k - 30) ti++;
    const inWindow = ti < transIdx.length && transIdx[ti] <= k;
    // A: pinning at settle ends with a visible chord
    if (f.settled && !(f.fr || p.fr) && chordRatio(f.raw) > 1e-2) {
      if (f.e > worstA) {
        worstA = f.e;
        worstAAt = { path: JSON.stringify(path), k };
      }
    }
    const jt = Math.max(frameJump(p.d, f.d), frameJump(f.d, p.d));
    const rawFJ = frameJump(p.raw, f.raw);
    const lagAllow = FL * Math.asin(Math.min(1, p.e)) + SERVO_CAP + 0.03;
    if (inWindow || f.fr || p.fr) {
      // freeze windows (and held frozen stretches): literal 0.5 ceiling,
      // relaxed by the raw motion allowance (see header note)
      worstWinJt = Math.max(worstWinJt, jt);
      worstWinLit = Math.max(worstWinLit, jt - 0.5);
      const ex = jt - Math.max(0.5, rawFJ + lagAllow);
      if (ex > worstWinEx) worstWinEx = ex;
      continue;
    }
    nChecked++;
    worstJt = Math.max(worstJt, jt);
    const shape = kabschAngle(p.raw, f.raw);
    const lit = shape * 1.15 + 0.03;
    if (jt - lit > worstLit) {
      worstLit = jt - lit;
      worstLitAt = {
        path: JSON.stringify(path),
        step: (k - walkLen) / (SETTLE + 1),
        jt: +jt.toFixed(3),
        jk: +shape.toFixed(3),
        rawFJ: +rawFJ.toFixed(3),
      };
    }
    const refJt = Math.max(frameJump(p.rd, f.rd), frameJump(f.rd, p.rd));
    const bnd = Math.max(lit, refJt * 1.15 + 0.03, lagAllow);
    if (jt - bnd > worstBEx) {
      worstBEx = jt - bnd;
      worstBExAt = { path: JSON.stringify(path), step: (k - walkLen) / (SETTLE + 1), jt: +jt.toFixed(3) };
    }
  }
}
report(
  "A pinning",
  worstA <= 2e-3,
  "worst chord dev (xz) " + worstA.toExponential(2) + " (limit 2e-3) at " + JSON.stringify(worstAAt)
);
report(
  "B drag continuity",
  worstBEx <= 0,
  "worst jump " + worstJt.toFixed(4) + ", worst excess over pinning-aware bound " +
    worstBEx.toFixed(4) + " " + JSON.stringify(worstBExAt) +
    " | literal shape-slush ceiling exceeded by " + worstLit.toFixed(4) + " (raw motion " +
    (worstLitAt ? worstLitAt.rawFJ : "-") + " dominates there), worst literal excess " +
    worstLit.toFixed(4) + " " + JSON.stringify(worstLitAt) +
    " | frozen/window worst jump " + worstWinJt.toFixed(4) +
    " (literal 0.5 exceeded by " + worstWinLit.toFixed(4) + ", pinning-aware excess " + worstWinEx.toFixed(4) + ")"
);

// ---- C: one-step jumps from widget defaults ----
const defPts = solve(0.5, 0, 0.5);
let worstCJt = 0;
let worstCEx = 0;
let worstCpin = 0;
for (const [r, s, t] of [[0, 1, 0.99], [1, -1, 0.1], [0.25, -1, 0.99], [1, 1, 0.5]]) {
  const tp = solve(r, s, t);
  const rawJump = frameJump(defPts, tp);
  const orientor = makeOrientor();
  let q = orientor.update(defPts, DT, { idle: true });
  for (let i = 1; i < 120; i++) q = orientor.update(defPts, DT, { idle: true });
  const qs = [q];
  let exW = 0;
  let jtW = 0;
  for (let i = 0; i < 90; i++) {
    const prevPts = i === 0 ? defPts : tp;
    const prevD = disp(prevPts, qs[i]);
    const qi = orientor.update(tp, DT, { idle: i > 0 });
    const curD = disp(tp, qi);
    const jt = Math.max(frameJump(prevD, curD), frameJump(curD, prevD));
    jtW = Math.max(jtW, jt);
    const lagAllow = FL * Math.asin(Math.min(1, chordDev(prevPts, qs[i]))) + SERVO_CAP + 0.03;
    exW = Math.max(exW, jt - Math.max(0.5, rawJump + lagAllow));
    qs.push(qi);
  }
  worstCJt = Math.max(worstCJt, jtW);
  // pinning by frame 60 (only when the chord is visible at the target)
  const e60 = chordDev(tp, qs[60]);
  if (chordRatio(tp) > 1e-2) worstCpin = Math.max(worstCpin, e60);
  worstCEx = Math.max(worstCEx, exW);
}
report(
  "C jump smoothness",
  worstCEx <= 0 && worstCpin <= 2e-3,
  "worst jump " + worstCJt.toFixed(4) + " (raw jumps reach 1.0, see header note), worst bound excess " +
    worstCEx.toFixed(4) + ", worst pin deviation by frame 60 " + worstCpin.toExponential(2) + " (limit 2e-3, visible targets only)"
);

// ---- D: static stability at defaults ----
{
  const orientor = makeOrientor();
  let q = orientor.update(defPts, DT, { idle: true });
  let worstDq = 0;
  let worstDe = 0;
  let worstDpsi = 0;
  for (let i = 1; i < 600; i++) {
    const qn = orientor.update(defPts, DT, { idle: true });
    if (i >= 120) {
      worstDq = Math.max(
        worstDq,
        Math.max(Math.abs(qn[0] - q[0]), Math.abs(qn[1] - q[1]), Math.abs(qn[2] - q[2]), Math.abs(qn[3] - q[3]))
      );
      worstDe = Math.max(worstDe, chordDev(defPts, qn));
      const r1 = qRot(qn, defPts[1]);
      worstDpsi = Math.max(worstDpsi, Math.abs(wrapToPi(Math.atan2(r1[2], r1[0]))));
    }
    q = qn;
  }
  report(
    "D static stability",
    worstDq <= 1e-6 && worstDe <= 1e-4 && worstDpsi <= 1e-4,
    "max |dq| " + worstDq.toExponential(2) + " (limit 1e-6), chord dev " + worstDe.toExponential(2) +
      " (limit 1e-4), |psi| " + worstDpsi.toExponential(2) + " (limit 1e-4)"
  );
}

// ---- E: servo path-independence ----
{
  const target = { r: 0.25, s: 0.5, t: 0.7 };
  function route(order) {
    const orientor = makeOrientor();
    let cur = { r: 0.5, s: 0, t: 0.5 };
    let pts = solve(cur.r, cur.s, cur.t);
    orientor.update(pts, DT, { idle: true });
    for (let k = 0; k < SETTLE; k++) orientor.update(pts, DT, { idle: true });
    for (const key of order) {
      for (let i = 1; i <= 5; i++) {
        const p = Object.assign({}, cur);
        p[key] = cur[key] + (target[key] - cur[key]) * (i / 5);
        pts = solve(p.r, p.s, p.t);
        orientor.update(pts, DT, { idle: false });
        for (let k = 0; k < SETTLE; k++) orientor.update(pts, DT, { idle: true });
        cur = p;
      }
    }
    for (let k = 0; k < 300; k++) orientor.update(pts, DT, { idle: true });
    return disp(pts, orientor.update(pts, DT, { idle: true }));
  }
  const d1 = route(["r", "s", "t"]);
  const d2 = route(["t", "s", "r"]);
  let scale = 0;
  const raw = solve(target.r, target.s, target.t);
  for (const p of raw) scale = Math.max(scale, norm3(p));
  let mx = 0;
  for (let i = 0; i < 9; i++) mx = Math.max(mx, norm3(sub3(d1[i], d2[i])) / scale);
  report(
    "E path independence",
    mx <= 5e-3,
    "worst per-vertex rel diff " + mx.toExponential(2) + " (limit 5e-3)"
  );
}

// ---- F: sanity (tracked over every frame of the A/B simulation) ----
report(
  "F quaternion sanity",
  worstFunit <= 1e-9 && worstFrot <= 1e-8,
  "worst |norm-1| " + worstFunit.toExponential(2) + " (limit 1e-9), worst |Rv|-|v| " +
    worstFrot.toExponential(2) + " (limit 1e-8)"
);

console.log(
  "orientation battery: " +
    (failures === 0 ? "PASS" : "FAIL") +
    " (" + (6 - failures) + "/6 tests, " + paths.length + " paths, " +
    cache.size + " solves, " + ((Date.now() - t0) / 1000).toFixed(1) + " s)"
);
process.exitCode = failures === 0 ? 0 : 1;
