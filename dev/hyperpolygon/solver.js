// Hyperpolygon solver.
//
// JavaScript port of the Mathematica pipeline in
// "Torelli Parameters and Hitchin Section.nb", Section 9,
// subsection "Full Moduli Space": a star-shaped quiver with a
// central C^2 vertex and four outer C vertices. For parabolic
// weights beta (4 positive reals) and parameters (r, theta, t),
// finds the representative (x, y) solving
//   mu_C(x, y) = 0,  mu_SL(x, y) = 0,  mu_U1(x, y) = beta,  mu_SU2(x, y) = 0
// and returns polygon vertex data for display.
//
// Pipeline (matching the notebook step by step):
//   1. x = [[sqrt(2 beta1), 0, 1, 1-r], [0, 1, 1, r e^{i theta}]]
//   2. y: 7 free entries solved from mu_C = 0, mu_SL = 0 with
//      y42 = t/(1-t) prescribed; whole y scaled by (1 - reff).
//      Evaluated at reff = min(r, 1-1e-5): the linear system is
//      singular at r = 1 and the (1-r) factor cancels the pole, so
//      the r = 1 value is obtained as the limit (offset chosen to
//      balance truncation vs conditioning of the near-singular solve).
//      AT the r endpoints the balanced pair is instead evaluated as
//      the limit at a small offset (see the endpoint-retry block in
//      makeHyperpolygon): both endpoints are degenerate for the raw
//      pair the balancer is fed and would otherwise stall.
//   3. fixMuU1: closed-form (C*)^4 balancing (torus action
//      x -> x.diag(1/lam^2), y -> diag(lam^2).y) solving
//      mu_U1 = beta exactly. Per leg: c/u - d u = 2 beta with
//      u = lam^4, c = |x_leg|^2, d = |y_leg|^2.
//   4. Newton (or a cyclic 1-D minimization fallback) on the three
//      real parameters (a12, b12, a22) of A = [[1, a12 + i b12],[0, a22^2]]
//      so that the su(2) coordinates of mu_SU2 vanish after fixMuU1.
//
// Exterior branch (dominant chamber, t = 0): when one beta >= the sum of the
// rest, the t = 0 slice has no y = 0 solution (the tight-frame inequality
// fails) and the historical pipeline stalls at a stick with a gap. The
// t -> 0+ limit of the genuine t > 0 solutions is instead constructed in
// closed form below (exteriorPair) and returned at t = 0; see the section
// comment for the derivation.
//
// Complex numbers are 2-element arrays [re, im].

const C = (re, im = 0) => [re, im];

const cAdd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const cSub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cMul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cConj = (a) => [a[0], -a[1]];
const cScale = (a, s) => [a[0] * s, a[1] * s];
const cAbs2 = (a) => a[0] * a[0] + a[1] * a[1];
const cDiv = (a, b) => {
  const den = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / den, (a[1] * b[0] - a[0] * b[1]) / den];
};

// i * (basis matrices b1, b2, b3 of su(2)), for 1/2 Tr(i b_k . B)
const IB1 = [
  [C(0), C(-1)],
  [C(-1), C(0)],
];
const IB2 = [
  [C(0), C(0, 1)],
  [C(0, -1), C(0)],
];
const IB3 = [
  [C(-1), C(0)],
  [C(0), C(1)],
];

function mat2mul(A, B) {
  return [
    [
      cAdd(cMul(A[0][0], B[0][0]), cMul(A[0][1], B[1][0])),
      cAdd(cMul(A[0][0], B[0][1]), cMul(A[0][1], B[1][1])),
    ],
    [
      cAdd(cMul(A[1][0], B[0][0]), cMul(A[1][1], B[1][0])),
      cAdd(cMul(A[1][0], B[0][1]), cMul(A[1][1], B[1][1])),
    ],
  ];
}

function mat2trace(T) {
  return cAdd(T[0][0], T[1][1]);
}

function su2Component(IB, B00, B01, B10, B11) {
  const B = [
    [B00, B01],
    [B10, B11],
  ];
  return 0.5 * mat2trace(mat2mul(IB, B))[0];
}

// su(2)^* coordinates of the trace-free part of B (trace part is
// annihilated by all three functionals, so it is dropped here)
export function traceFreeCoords(B00, B01, B10, B11) {
  return [
    su2Component(IB1, B00, B01, B10, B11),
    su2Component(IB2, B00, B01, B10, B11),
    su2Component(IB3, B00, B01, B10, B11),
  ];
}

// x normal form
export function buildX(r, theta, beta1) {
  return [
    [C(Math.sqrt(2 * beta1)), C(0), C(1), C(1 - r)],
    [C(0), C(1), C(1), [r * Math.cos(theta), r * Math.sin(theta)]],
  ];
}

// Generic complex n x n solver (LU with partial pivoting); null if singular
function solveComplexLinear(M, b) {
  const n = M.length;
  const A = M.map((row) => row.slice());
  const rhs = b.slice();
  for (let k = 0; k < n; k++) {
    let best = k;
    let bestNorm = cAbs2(A[k][k]);
    for (let i = k + 1; i < n; i++) {
      const v = cAbs2(A[i][k]);
      if (v > bestNorm) {
        best = i;
        bestNorm = v;
      }
    }
    if (bestNorm < 1e-300) return null;
    if (best !== k) {
      const tr = A[k];
      A[k] = A[best];
      A[best] = tr;
      const tb = rhs[k];
      rhs[k] = rhs[best];
      rhs[best] = tb;
    }
    for (let i = k + 1; i < n; i++) {
      const f = cDiv(A[i][k], A[k][k]);
      for (let j = k; j < n; j++) A[i][j] = cSub(A[i][j], cMul(f, A[k][j]));
      rhs[i] = cSub(rhs[i], cMul(f, rhs[k]));
    }
  }
  const u = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = rhs[i];
    for (let j = i + 1; j < n; j++) s = cSub(s, cMul(A[i][j], u[j]));
    u[i] = cDiv(s, A[i][i]);
  }
  return u;
}

// The 7x7 complex linear system of the y-solve: mu_C(x, y) = 0 and
// mu_SL(x, y) = 0 for the 7 free entries of y (order y11, y12, y21, y22,
// y31, y32, y41) with y42 prescribed. With y42 = T the right-hand side is
// exactly T * b1 (the system is linear in T), so the solve is linear in T.
// Returns [M, b1].
function ySolveSystem(x) {
  const M = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => C(0)));
  const b1 = Array.from({ length: 7 }, () => C(0));
  // mu_C rows
  M[0][0] = x[0][0];
  M[0][1] = x[1][0];
  M[1][2] = x[0][1];
  M[1][3] = x[1][1];
  M[2][4] = x[0][2];
  M[2][5] = x[1][2];
  M[3][6] = x[0][3];
  b1[3] = cScale(x[1][3], -1);
  // mu_SL rows M11, M12, M21 (M22 is dependent on mu_C and M11)
  M[4][0] = x[0][0];
  M[4][2] = x[0][1];
  M[4][4] = x[0][2];
  M[4][6] = x[0][3];
  M[5][1] = x[0][0];
  M[5][3] = x[0][1];
  M[5][5] = x[0][2];
  b1[5] = cScale(x[0][3], -1);
  M[6][0] = x[1][0];
  M[6][2] = x[1][1];
  M[6][4] = x[1][2];
  M[6][6] = x[1][3];
  return [M, b1];
}

// Solves mu_C(x, y) = 0 and mu_SL(x, y) = 0 for the 7 free entries of y
// (order y11, y12, y21, y22, y31, y32, y41) with y42 = t/(1-t) prescribed,
// then scales the whole y by (1 - reff). x must be built at reff.
export function solveY(x, reff, t) {
  const T = t / (1 - t);
  const [M, b1] = ySolveSystem(x);
  const b = b1.map((v) => cScale(v, T));
  const u = solveComplexLinear(M, b);
  if (!u) return null;
  const s = 1 - reff;
  return [
    [cScale(u[0], s), cScale(u[1], s)],
    [cScale(u[2], s), cScale(u[3], s)],
    [cScale(u[4], s), cScale(u[5], s)],
    [cScale(u[6], s), cScale(C(T), s)],
  ];
}

// Direction of the y-solve in T: solveY(x, reff, t) = (1-reff) * t/(1-t) * Y
// EXACTLY (the system is linear in T), so Y is the T-derivative direction.
// For the normal form x = buildX(reff, theta, beta0) it has the exact zeros
// Y[0][0] = 0 (row 0, col 0) and Y[1][1] = 0 (row 1, col 1), and its (3,1)
// entry is exactly 1. Used by the exterior branch below.
export function ySolveDirection(x) {
  const [M, b1] = ySolveSystem(x);
  const u = solveComplexLinear(M, b1);
  if (!u) return null;
  return [
    [u[0], u[1]],
    [u[2], u[3]],
    [u[4], u[5]],
    [u[6], C(1)],
  ];
}

// Closed form of the same direction for the normal form x =
// buildX(reff, theta, beta0), obtained by back-substituting the system by
// hand (the normal form's zeros x[1][0] = x[0][1] = 0 make it triangular).
// Algebraically identical to ySolveDirection(buildX(...)) but free of the LU
// conditioning loss at the r endpoints (where entries of Y reach ~1/(1-reff)
// ~ 1e5 and the solve residual would sit at ~1e-11 instead of roundoff).
export function exteriorYDirection(reff, theta, beta0) {
  const e = [Math.cos(theta), Math.sin(theta)];
  const re = [reff * e[0], reff * e[1]]; // reff e^{i theta}
  const s = Math.sqrt(2 * beta0);
  // D = reff e^{i theta} - (1 - reff): the small quantity of the (1/2, 0)
  // degeneracy. Y[1][0] is written as reff e^{i theta} * D / (1 - reff) —
  // algebraically identical to reff^2 e^{2i theta}/(1-reff) - reff e^{i theta}
  // but free of the O(ulp(1/2)) absolute cancellation error that the direct
  // form suffers near reff = 1/2 (that error is amplified by the 1/sqrt(wMax)
  // of the weight normalization and showed up as a ~1e-10 central mu_C
  // residual at the nudged degenerate locus).
  const D = cSub(re, C(1 - reff));
  const y10 = cScale(cMul(re, D), 1 / (1 - reff));
  return [
    [C(0), cScale(D, 1 / s)],
    [y10, C(0)],
    [re, cScale(re, -1)],
    [cScale(re, -1 / (1 - reff)), C(1)],
  ];
}

// ===== Cycle-ansatz y-solve (cycle chambers, see the reindexing section) =====

// Cycle x normal form: x = [[1, 1, 1, 0], [0, r e^{i theta}, 1 - r, 1]].
// Straight pairs: r = 0 -> columns {0,1}; (r, theta) = (1/2, 0) -> {1,2};
// r = 1 -> {0,2}. Column 3 = (0,1) is never parallel to any other column;
// column 0 = (1,0) is fixed.
export function buildXCycle(r, theta) {
  return [
    [C(1), C(1), C(1), C(0)],
    [C(0), [r * Math.cos(theta), r * Math.sin(theta)], C(1 - r), C(1)],
  ];
}

// The 7x7 complex linear system of the cycle y-solve: the same moment map
// equations, unknown order y11, y12, y21, y31, y32, y41, y42 with y22
// prescribed. For the cycle ansatz mu_C leg 3 reads y42 = 0 exactly (x[0][3]
// = 0, x[1][3] = 1), so the free-scale prescription MUST move from y42 to
// y22 — leg 1's second entry, finite across the whole r axis (the y32/y31
// alternatives blow up at r = 0 like 1/re^{i theta}). With y22 = T the
// right-hand side is exactly T * b1 (linear in T). Returns [M, b1].
function ySolveSystemCycle(x) {
  const M = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => C(0)));
  const b1 = Array.from({ length: 7 }, () => C(0));
  // mu_C rows
  M[0][0] = x[0][0];
  M[0][1] = x[1][0];
  M[1][2] = x[0][1];
  b1[1] = cScale(x[1][1], -1);
  M[2][3] = x[0][2];
  M[2][4] = x[1][2];
  M[3][5] = x[0][3];
  M[3][6] = x[1][3];
  // mu_SL rows M11, M12, M21 (M22 is dependent on mu_C and M11)
  M[4][0] = x[0][0];
  M[4][2] = x[0][1];
  M[4][3] = x[0][2];
  M[4][5] = x[0][3];
  M[5][1] = x[0][0];
  M[5][4] = x[0][2];
  M[5][6] = x[0][3];
  b1[5] = cScale(x[0][1], -1);
  M[6][0] = x[1][0];
  M[6][2] = x[1][1];
  M[6][3] = x[1][2];
  M[6][5] = x[1][3];
  return [M, b1];
}

// Cycle counterpart of solveY: y22 = t/(1-t) prescribed, then the whole y
// scaled by (1 - reff) exactly like solveY. x must be built at reff
// (buildXCycle). Nonsingular for all r < 1; the only pole is y32 ~ 1/(1-r),
// cut by reff = 1-1e-5 exactly like the star ansatz's y41. Closed form of
// the T=1 direction (x = buildXCycle(reff, theta), re := reff e^{i theta}):
//   Y11 = 0; Y21 = -re; Y31 = re; Y32 = -re/(1-r); Y42 = 0;
//   Y12 = re/(1-r) - 1; Y41 = re (re - (1-r)).
// Returns null on a singular LU.
export function solveYCycle(x, reff, t) {
  const T = t / (1 - t);
  const [M, b1] = ySolveSystemCycle(x);
  const b = b1.map((v) => cScale(v, T));
  const u = solveComplexLinear(M, b);
  if (!u) return null;
  const s = 1 - reff;
  return [
    [cScale(u[0], s), cScale(u[1], s)],
    [cScale(u[2], s), cScale(C(T), s)],
    [cScale(u[3], s), cScale(u[4], s)],
    [cScale(u[5], s), cScale(u[6], s)],
  ];
}

// Ansatze for solveCore: buildX makes the raw x normal form at (r, theta),
// solveY solves the raw y for it. STAR_ANSATZ is the historical default, so
// every existing call path is bit-exact.
export const STAR_ANSATZ = {
  buildX: (r, theta, beta0) => buildX(r, theta, beta0),
  solveY: solveY,
};
export const CYCLE_ANSATZ = {
  buildX: (r, theta) => buildXCycle(r, theta),
  solveY: solveYCycle,
};

// U(1)^4 balancing: solves mu_U1(x', y') = beta exactly.
// Torus action x -> x.diag(1/lam^2), y -> diag(lam^2).y; per leg
// c/u - d u = 2 beta with u = lam^4 has the closed-form positive root.
// The root is evaluated in the rationalized form
//   u = c / (beta + sqrt(beta^2 + c d)),
// which is algebraically identical to (-beta + sqrt(beta^2 + c d)) / d
// (multiply num and denom by beta + sqrt(...): the numerator becomes
// sqrt(...)^2 - beta^2 = c d, and the d cancels) but free of the total
// numerator cancellation that destroys it when c*d <<~ beta^2 * 2^-52:
// there (-beta + sqrt(...)) rounds to exactly 0, u = 0, and the x-scale
// 1/lam^2 = 1/0 = Infinity produces NaN. That regime is reached for real
// parameters: d = |y_leg|^2 ~ r^2 near r = 0 and d ~ (1-reff)^2 near
// r = 1 (the whole y is scaled by 1-reff). The rationalized form is
// forward-stable (every factor carries its own relative error) and its
// d -> 0 limit c/(2 beta) matches the d == 0 branch exactly, so the two
// branches agree seamlessly on legs whose y vanishes. As c -> 0 it gives
// u -> 0 like the old form. Healthy solves change only in the last ulps.
export function fixMuU1(x, y, beta) {
  const c = [];
  const d = [];
  const u = [];
  const lam = [];
  for (let i = 0; i < 4; i++) {
    c.push(cAbs2(x[0][i]) + cAbs2(x[1][i]));
    d.push(cAbs2(y[i][0]) + cAbs2(y[i][1]));
  }
  for (let i = 0; i < 4; i++) {
    u.push(
      d[i] > 0
        ? c[i] / (beta[i] + Math.sqrt(beta[i] * beta[i] + c[i] * d[i]))
        : c[i] / (2 * beta[i])
    );
    lam.push(Math.pow(u[i], 0.25));
  }
  const x2 = x.map((row) => row.map((v, j) => cScale(v, 1 / (lam[j] * lam[j]))));
  const y2 = y.map((row, i) => row.map((v) => cScale(v, lam[i] * lam[i])));
  return [x2, y2];
}

// max_i |mu_U1_i - beta_i|
export function muU1Error(x, y, beta) {
  let e = 0;
  for (let i = 0; i < 4; i++) {
    const v =
      0.5 * (cAbs2(x[0][i]) + cAbs2(x[1][i])) -
      0.5 * (cAbs2(y[i][0]) + cAbs2(y[i][1]));
    e = Math.max(e, Math.abs(v - beta[i]));
  }
  return e;
}

// su(2)^* coordinates (3 reals) of mu_SU2(x, y)
export function muSU2Coords(x, y) {
  let B00 = C(0);
  let B01 = C(0);
  let B10 = C(0);
  let B11 = C(0);
  for (let i = 0; i < 4; i++) {
    const x0 = x[0][i];
    const x1 = x[1][i];
    // v_i = x_col_i x_col_i^dagger
    B00 = cAdd(B00, cMul(x0, cConj(x0)));
    B01 = cAdd(B01, cMul(x0, cConj(x1)));
    B10 = cAdd(B10, cMul(cConj(x0), x1));
    B11 = cAdd(B11, cMul(x1, cConj(x1)));
    const y0 = y[i][0];
    const y1 = y[i][1];
    // w_i = y_row_i^dagger y_row_i
    B00 = cSub(B00, cMul(cConj(y0), y0));
    B01 = cSub(B01, cMul(cConj(y0), y1));
    B10 = cSub(B10, cMul(cConj(y1), y0));
    B11 = cSub(B11, cMul(cConj(y1), y1));
  }
  const h = 0.5 * (B00[0] + B11[0]);
  const T00 = C(B00[0] - h, B00[1]);
  const T11 = C(B11[0] - h, B11[1]);
  return [
    su2Component(IB1, T00, B01, B10, T11),
    su2Component(IB2, T00, B01, B10, T11),
    su2Component(IB3, T00, B01, B10, T11),
  ];
}

// mu_C(x, y) as 4 complex numbers
export function muC(x, y) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    out.push(cAdd(cMul(y[i][0], x[0][i]), cMul(y[i][1], x[1][i])));
  }
  return out;
}

// central GL(2) action: x -> A.x, y -> y.A^{-1}
function actCentral(A, x, y) {
  const xa = [
    x[0].map((v, j) => cAdd(cMul(A[0][0], v), cMul(A[0][1], x[1][j]))),
    x[1].map((v, j) => cAdd(cMul(A[1][0], v), cMul(A[1][1], x[1][j]))),
  ];
  const det = cSub(cMul(A[0][0], A[1][1]), cMul(A[0][1], A[1][0]));
  const Ainv = [
    [cDiv(A[1][1], det), cDiv(cScale(A[0][1], -1), det)],
    [cDiv(cScale(A[1][0], -1), det), cDiv(A[0][0], det)],
  ];
  const ya = y.map((row) => [
    cAdd(cMul(row[0], Ainv[0][0]), cMul(row[1], Ainv[1][0])),
    cAdd(cMul(row[0], Ainv[0][1]), cMul(row[1], Ainv[1][1])),
  ]);
  return [xa, ya];
}

function normInf3(v) {
  return Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));
}

function euclidNorm3(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

// F(p) = su(2) coordinates of mu_SU2 after U(1)^4 balancing, with
// A = [[1, a12 + i b12], [0, a22^2]] (fast path, as in MakeHyperpolygon)
function makeFastResidual(x0, y0, beta) {
  return (p) => {
    const A = [
      [C(1), [p[0], p[1]]],
      [C(0), C(p[2] * p[2])],
    ];
    const [xa, ya] = actCentral(A, x0, y0);
    const [xb, yb] = fixMuU1(xa, ya, beta);
    return muSU2Coords(xb, yb);
  };
}

// damped Newton with numeric Jacobian; norm selects the line-search merit
// function (the historical path uses the max norm; euclidNorm3 is offered
// as a rescue variant, see makeHyperpolygon)
function newton(F, p0, norm = normInf3) {
  let p = p0.slice();
  let f = F(p);
  let n0 = norm(f);
  for (let it = 0; it < 60; it++) {
    if (n0 < 1e-11) break;
    const J = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (let k = 0; k < 3; k++) {
      const h = 1e-7 * (1 + Math.abs(p[k]));
      const old = p[k];
      p[k] = old + h;
      const fk = F(p);
      p[k] = old;
      for (let r = 0; r < 3; r++) J[r][k] = (fk[r] - f[r]) / h;
    }
    const dp = solveReal3(J, [-f[0], -f[1], -f[2]]);
    if (!dp) break;
    let alpha = 1;
    const base = n0;
    let improved = false;
    for (let ls = 0; ls < 20; ls++) {
      const pn = [p[0] + alpha * dp[0], p[1] + alpha * dp[1], p[2] + alpha * dp[2]];
      const fn = F(pn);
      if (norm(fn) < base) {
        p = pn;
        f = fn;
        n0 = norm(fn);
        improved = true;
        break;
      }
      alpha *= 0.5;
    }
    if (!improved) break;
  }
  return { p, residual: n0 };
}

function solveReal3(J, rhs) {
  const n = 3;
  const A = J.map((row) => row.slice());
  const b = rhs.slice();
  for (let k = 0; k < n; k++) {
    let best = k;
    let bestV = Math.abs(A[k][k]);
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(A[i][k]) > bestV) {
        best = i;
        bestV = Math.abs(A[i][k]);
      }
    }
    if (bestV < 1e-300) return null;
    if (best !== k) {
      const tr = A[k];
      A[k] = A[best];
      A[best] = tr;
      const tb = b[k];
      b[k] = b[best];
      b[best] = tb;
    }
    for (let i = k + 1; i < n; i++) {
      const f = A[i][k] / A[k][k];
      for (let j = k; j < n; j++) A[i][j] -= f * A[k][j];
      b[i] -= f * b[k];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}

// Stable fallback (port of MakeHyperpolygonStable): cyclic one-parameter
// minimization; other parameters are reset to their initial values each
// pass, and A's a22 entry enters linearly (not squared), as in the notebook.
// start = initial (a12, b12, a22); the notebook uses [0, 0, 1].
function stablePath(x0, y0, beta, tolerance, start = [0, 0, 1]) {
  const p0 = start.slice();
  const searchMin = [-1, -1, 0.01];
  const searchMax = [1, 1, 2];
  const G = (p) => {
    const A = [
      [C(1), [p[0], p[1]]],
      [C(0), C(p[2])],
    ];
    const [xa, ya] = actCentral(A, x0, y0);
    const [xb, yb] = fixMuU1(xa, ya, beta);
    return muSU2Coords(xb, yb);
  };
  let xT = x0;
  let yT = y0;
  let last = normInf3(G(p0));
  for (let counter = 1; counter <= 18 && last > tolerance; counter++) {
    const i = (counter - 1) % 3;
    const g = (pv) => {
      const p = p0.slice();
      p[i] = pv;
      const A = [
        [C(1), [p[0], p[1]]],
        [C(0), C(p[2])],
      ];
      const [xa, ya] = actCentral(A, xT, yT);
      const [xb, yb] = fixMuU1(xa, ya, beta);
      return Math.abs(muSU2Coords(xb, yb)[i]);
    };
    const newP = minimize1D(g, searchMin[i], searchMax[i]);
    const cand = p0.slice();
    cand[i] = newP;
    const A = [
      [C(1), [cand[0], cand[1]]],
      [C(0), C(cand[2])],
    ];
    const [xa, ya] = actCentral(A, xT, yT);
    const dNew = normInf3(muSU2Coords(...fixMuU1(xa, ya, beta)));
    if (dNew <= last) {
      xT = xa;
      yT = ya;
    }
    last = dNew;
  }
  return fixMuU1(xT, yT, beta);
}

// bounded 1-D minimization: coarse scan + golden-section refinement
function minimize1D(g, lo, hi) {
  const N = 64;
  const step = (hi - lo) / N;
  let bestV = Infinity;
  let bestP = lo;
  for (let k = 0; k <= N; k++) {
    const pv = lo + k * step;
    const v = g(pv);
    if (v < bestV) {
      bestV = v;
      bestP = pv;
    }
  }
  let a = Math.max(lo, bestP - step);
  let b = Math.min(hi, bestP + step);
  const phi = (Math.sqrt(5) - 1) / 2;
  let c1 = b - phi * (b - a);
  let c2 = a + phi * (b - a);
  let f1 = g(c1);
  let f2 = g(c2);
  for (let it = 0; it < 60 && b - a > 1e-12; it++) {
    if (f1 < f2) {
      b = c2;
      c2 = c1;
      f2 = f1;
      c1 = b - phi * (b - a);
      f1 = g(c1);
    } else {
      a = c1;
      c1 = c2;
      f1 = f2;
      c2 = a + phi * (b - a);
      f2 = g(c2);
    }
  }
  return 0.5 * (a + b);
}

const TOLERANCE = 1e-3;

// rescue starts (see balancedPair): extra Newton starts, Euclidean-line-search
// Newton starts, and stable-fallback starts tried when the primary balance
// stalls (basin traps observed at parameter-space endpoints and near t = 0)
const RESCUE_NEWTON_STARTS = [
  [0, 0, 2],
  [0.7, 0.7, 1],
  [-0.7, -0.7, 1],
  [-0.3, 0.3, 1],
];
const RESCUE_EUCLID_STARTS = [
  [0, 0, 1],
  [-0.3, 0.3, 1],
];
const RESCUE_STABLE_STARTS = [
  [0.7, -0.7, 1],
  [0, 0, 0.25],
];

// Euclidean norm of the su(2) residual of a balanced pair
function su2NormOf(pair) {
  const s = muSU2Coords(pair[0], pair[1]);
  return Math.hypot(s[0], s[1], s[2]);
}

// max-norm of mu_C of a balanced pair
function muCNormOf(pair) {
  return Math.max(...muC(pair[0], pair[1]).map(cAbs2)) ** 0.5;
}

// Endpoint retry selection: prefer the candidate when both representatives
// are fully converged and the candidate has the smaller mu_C mismatch (the
// O(1-reff) endpoint artifact moves with the offset), otherwise when it has
// the smaller su(2) residual (NaN candidates never win: comparisons fail).
function pairBetter(cand, best) {
  const a = su2NormOf(cand);
  const b = su2NormOf(best);
  if (!(a <= 1e-9) || !(b <= 1e-9)) {
    return a < b;
  }
  return muCNormOf(cand) < muCNormOf(best);
}

// The complete balancing cascade for one raw pair (x0, y0): damped Newton
// from [0, 0, 1] (historical max-norm line search), the cyclic stable
// fallback when Newton fails or stalls above 1e-8, then the rescue starts
// when the su(2) residual is still above the 1e-6 rescue gate.
// Returns [pair, usedStable]; usedStable keeps the historical meaning
// (the initial Newton attempt failed, i.e. the stable fallback produced
// the surviving pair). The gate comparisons are NaN-safe (!(x <= eps)) so a
// NaN residual routes into the rescue instead of silently returning NaN.
function balancedPair(x0, y0, beta) {
  const F = makeFastResidual(x0, y0, beta);
  const newtonPair = (p0, norm = normInf3) => {
    const nrm = newton(F, p0, norm);
    if (!(nrm.residual <= TOLERANCE)) return null;
    const A = [
      [C(1), [nrm.p[0], nrm.p[1]]],
      [C(0), C(nrm.p[2] * nrm.p[2])],
    ];
    const [xa, ya] = actCentral(A, x0, y0);
    return fixMuU1(xa, ya, beta);
  };
  let pair = newtonPair([0, 0, 1]);
  const usedStable = pair === null;
  if (pair !== null) {
    // if Newton stalled above the tight threshold, also try the stable
    // fallback and keep the more accurate result
    if (su2NormOf(pair) > 1e-8) {
      const alt = stablePath(x0, y0, beta, TOLERANCE);
      if (su2NormOf(alt) < su2NormOf(pair)) {
        pair = alt;
      }
    }
  } else {
    pair = stablePath(x0, y0, beta, TOLERANCE);
  }
  // rescue: for rare parameter points both Newton and the cyclic fallback
  // land in a local minimum (observed near t = 0 for lopsided in-chamber
  // betas, and at the r endpoints r = 0 and r = 1, where the su(2) basin of
  // attraction of the balanced point shrinks dramatically: at the widget's
  // swapped beta the [0,0,1] start stalls at ~0.25 for exactly r = 0 and
  // the max-norm line search walks past the narrow true basin near r = 1).
  // Retry from varied starts and merit functions and keep the best
  // representative; convergent solves never enter this branch.
  if (!(su2NormOf(pair) <= 1e-6)) {
    for (const p0 of RESCUE_NEWTON_STARTS) {
      const cand = newtonPair(p0);
      if (cand !== null && su2NormOf(cand) < su2NormOf(pair)) {
        pair = cand;
      }
    }
    for (const p0 of RESCUE_EUCLID_STARTS) {
      const cand = newtonPair(p0, euclidNorm3);
      if (cand !== null && su2NormOf(cand) < su2NormOf(pair)) {
        pair = cand;
      }
    }
    for (const p0 of RESCUE_STABLE_STARTS) {
      const cand = stablePath(x0, y0, beta, TOLERANCE, p0);
      if (su2NormOf(cand) < su2NormOf(pair)) {
        pair = cand;
      }
    }
  }
  return [pair, usedStable];
}

// swap quiver legs 2 and 3 (columns 2/3 of x, rows 2/3 of y); fresh copies
function swapLegs23(x, y) {
  const xs = [
    [x[0][0], x[0][1], x[0][3], x[0][2]],
    [x[1][0], x[1][1], x[1][3], x[1][2]],
  ];
  const ys = [y[0].slice(), y[1].slice(), y[3].slice(), y[2].slice()];
  return [xs, ys];
}

// ===== Exterior branch (dominant chamber, t = 0) =====
//
// When one parabolic weight dominates, beta_j >= sum_{i != j} beta_i, the
// t = 0 moduli slice is empty for the y = 0 representative (mu_SU2 = 0 needs
// sum_i x_i x_i^dagger to be a scalar matrix, which forces the tight-frame
// inequality beta_i <= sum_{k != i} beta_k). The t -> 0+ limit of the genuine
// t > 0 solutions instead converges to a "minimum energy" configuration with
// y_j = 0 and the remaining y-rows nonzero, which satisfies ALL moment map
// equations exactly. This section constructs that limit in closed form;
// makeHyperpolygon returns it at t = 0 in exterior chambers.
//
// Form (up to the residual gauge): the dominant leg j keeps an axis vector
// x_j = sqrt(2 beta_j) * e_a, every other column of x is parallel to the
// orthogonal axis e_b, y_j = 0, and every other row of y is parallel to e_a.
// Writing c_i, alpha_i for the surviving magnitudes, the moment map
// equations reduce to
//   |c_i|^2 - |alpha_i|^2 = 2 beta_i            (mu_U1, per leg)
//   sum_{i != j} c_i alpha_i = 0                (central mu_C)
//   sum_{i != j} (|c_i|^2 + |alpha_i|^2) = 2 beta_j   (mu_SU2)
// With S_i := sqrt(beta_i^2 + K w_i) the solution is
//   |c_i|^2 = beta_i + S_i,  |alpha_i|^2 = S_i - beta_i,
// where K >= 0 is the unique root of sum_{i != j} S_i = beta_j (monotone in
// K; K = 0 exactly on the wall beta_j = sum_{i != j} beta_i, so the branch
// telescopes smoothly out of the wall stick as beta_j grows). The
// (r, theta) dependence enters through the direction weights
//   w_i = |xdir_i|^2 |ydir_i|^2
// and the phases arg c_i = arg xdir_i, arg alpha_i = arg ydir_i, where the
// directions are read off the t -> 0+ asymptotics of the balanced pipeline:
//   pattern A (j = 0):  xdir_i = x0[1][i],          ydir_i = Y[i][0]
//   pattern B (j > 0):  xdir_i = x0[0][i] + a* x0[1][i]
//                       ydir_i = Y[i][1] - a* Y[i][0]
// with x0 = buildX(reff, theta, beta0), Y = ySolveDirection(x0) and
// a* = Y[j][1] / Y[j][0] chosen so the dominant leg's ydir vanishes
// (a* = 0 for j = 1, -1 for j = 2, -(1-reff) e^{-i theta} / reff for j = 3).
// Both patterns make sum_i xdir_i ydir_i = 0 an identity (all four sums
// sum_i x0[r][i] Y[i][c] vanish), so the central mu_C holds automatically.
// The S_i are invariant under a common rescaling of the w_i, which the
// K-solve exploits for normalization (and which makes the r -> 0 and
// r -> 1 limits of the weights tame).

// Index of the dominant leg (beta_j >= sum of the rest, wall inclusive up to
// a 1e-12 slack so a one-ulp-below-wall tuple still takes the branch), or -1
// if no leg dominates (the stable chamber, where the historical path runs).
export function dominantLeg(beta) {
  let j = 0;
  for (let i = 1; i < 4; i++) if (beta[i] > beta[j]) j = i;
  let rest = 0;
  for (let i = 0; i < 4; i++) if (i !== j) rest += beta[i];
  return beta[j] >= rest - 1e-12 ? j : -1;
}

// The balanced exterior-branch pair (x, y) at (r, theta), t = 0, for the
// dominant leg j (as returned by dominantLeg). Solves mu_C = 0, the central
// complex moment map, mu_U1 = beta and mu_SU2 = 0 to roundoff.
export function exteriorPair(r, theta, beta, j) {
  // Display at the limit: floor reff at 1e-9 (at r = 0 every Y[i][0]
  // vanishes for pattern A and the K-solve would degenerate; the limit is
  // smooth and 1e-9 is far below display precision), cap at 1 - 1e-5 as
  // everywhere else.
  const reff = Math.min(Math.max(r, 1e-9), 1 - 1e-5);
  let pair = exteriorPairAt(reff, theta, beta, j);
  if (pair !== null) return pair;
  // Degenerate direction weights: at (r, theta) = (1/2, 0) every Y-entry
  // combination in the pattern-B directions vanishes identically (the
  // y-solve direction itself degenerates to second order there; the whole
  // t > 0 pipeline stalls at this locus too, at every t). Re-evaluate at a
  // tiny r offset: along the theta = 0 row the weights behave like
  // w_0 ~ w_1 ~ (r - 1/2)^2 and w_3 ~ (r - 1/2)^4, so the offset result is
  // the continuous extension of the theta = 0 row and matches the
  // pipeline's converged behavior next to the point.
  for (let nudge = 1e-7; nudge <= 1e-3; nudge *= 10) {
    pair = exteriorPairAt(Math.min(reff + nudge, 1 - 1e-5), theta, beta, j);
    if (pair !== null) return pair;
  }
  return null;
}

function exteriorPairAt(reff, theta, beta, j) {
  const x0 = buildX(reff, theta, beta[0]);
  const Y = exteriorYDirection(reff, theta, beta[0]);
  const x01 = [C(0), C(1), C(1), x0[1][3]];
  const x00 = [x0[0][0], C(0), C(1), x0[0][3]];
  const xdir = [];
  const ydir = [];
  if (j === 0) {
    for (let i = 0; i < 4; i++) {
      xdir.push(x01[i]);
      ydir.push(Y[i][0]);
    }
  } else {
    const a =
      cAbs2(Y[j][0]) < 1e-300 ? C(0) : cDiv(Y[j][1], Y[j][0]);
    for (let i = 0; i < 4; i++) {
      xdir.push(cAdd(x00[i], cMul(a, x01[i])));
      ydir.push(cSub(Y[i][1], cMul(a, Y[i][0])));
    }
  }
  const idx = [0, 1, 2, 3].filter((i) => i !== j);
  const w = idx.map((i) => cAbs2(xdir[i]) * cAbs2(ydir[i]));
  const wMax = Math.max(...w);
  if (!(wMax > 0) || !isFinite(wMax)) return null; // degenerate locus: caller nudges
  const what = w.map((v) => v / wMax);
  // K-solve: sum_i sqrt(beta_i^2 + K what_i) = beta_j, monotone in K.
  // what is w normalized to max 1; the S_i only see the product K * what.
  let rest = 0;
  for (const i of idx) rest += beta[i];
  const target = Math.max(beta[j], rest);
  let K = 0;
  if (target > rest + 1e-15) {
    const g = (K) =>
      idx.reduce((s, i, k) => s + Math.sqrt(beta[i] * beta[i] + K * what[k]), 0) -
      target;
    let lo = 0;
    let hi = 1;
    while (g(hi) < 0 && hi < 1e200) hi *= 2;
    for (let it = 0; it < 100 && hi - lo > 1e-16 * hi; it++) {
      const mid = 0.5 * (lo + hi);
      if (g(mid) < 0) lo = mid;
      else hi = mid;
    }
    K = 0.5 * (lo + hi);
  }
  // Surviving magnitudes and phases.
  const c = [];
  const al = [];
  idx.forEach((i, k) => {
    const S = Math.sqrt(beta[i] * beta[i] + K * what[k]);
    const cMag = Math.sqrt(beta[i] + S);
    // aMag = sqrt(S - beta_i), evaluated in the cancellation-free form
    // sqrt(K what / (beta + S)): the direct form rounds S - beta_i to 0
    // when K what is below ulp(beta_i^2) (e.g. r = 0, where the direction
    // weights span 18 orders of magnitude), which would drop that leg's
    // term of the central moment map identity sum c_i alpha_i = 0 while the
    // other legs keep their ulp-level contamination — a residual ~1e-10.
    const aMag = Math.sqrt((K * what[k]) / (beta[i] + S));
    const xd2 = cAbs2(xdir[i]);
    const yd2 = cAbs2(ydir[i]);
    c[i] = xd2 < 1e-300 ? C(cMag) : cScale(xdir[i], cMag / Math.sqrt(xd2));
    al[i] = aMag === 0 || yd2 < 1e-300 ? C(0) : cScale(ydir[i], aMag / Math.sqrt(yd2));
  });
  // Assemble the balanced pair.
  const x = [
    [C(0), C(0), C(0), C(0)],
    [C(0), C(0), C(0), C(0)],
  ];
  const y = [
    [C(0), C(0)],
    [C(0), C(0)],
    [C(0), C(0)],
    [C(0), C(0)],
  ];
  if (j === 0) {
    x[0][0] = C(Math.sqrt(2 * beta[0]));
    for (const i of idx) {
      x[1][i] = c[i];
      y[i][0] = al[i];
    }
  } else {
    const ph2 = cAbs2(x01[j]);
    const ph = ph2 < 1e-300 ? C(1) : cScale(x01[j], 1 / Math.sqrt(ph2));
    x[1][j] = cScale(ph, Math.sqrt(2 * beta[j]));
    for (const i of idx) {
      x[0][i] = c[i];
      y[i][1] = al[i];
    }
  }
  return [x, y];
}

// ===== I-stratum (doubly-straight pair split; the "lim t -> infinity" target) =====
//
// Entering the stratum of a pair split {I | comp} from the tip (antipode) of
// the exterior sphere carrying the short pair I: the stratum consists of the
// balanced pairs for which BOTH the two I-legs and the two comp-legs have
// parallel x-columns, i.e. the displayed polygon is a closed walk on a single
// line (every pair of v-sides within I and within comp is straight). The
// t1 = 0 slice has exactly TWO nonzero rows of y (the comp side's rows
// vanish), and growing t1 makes the remaining rows nonzero.
//
// Normal form (user leg indexing; the side CONTAINING LEG 0 sits on e1 — this
// matches the pipeline approach shape measured at every attachment — the
// other side on e2):
//   e1Side legs: x_col = (m_i, 0),  y_row = (0, +-n_i)
//   e2Side legs: x_col = (0, m_i),  y_row = (+-n_i, 0)
// mu_C (per leg, row . col = 0) then holds by structure, and with M >=
// max(sum_I beta, sum_comp beta) := M0 the magnitudes
//   m_i^2 = (M + b_p - b_q)(M + b_p + b_q)/(2M)      (factored forms; the
//   n_i^2 = (M - b_p - b_q)(M - b_p + b_q)/(2M)       direct expansions cancel
//                                                     catastrophically near
//                                                     the wall M = b_p + b_q)
// for the side's legs (p, q) solve EVERYTHING identically:
//   mu_U1: (m^2 - n^2)/2 = beta  (telescopes to 4 M beta / 4 M),
//   mu_SU2: both sides carry |x|^2 + |y|^2 = 2M, so the trace-free part of
//     sum (v_i - w_i) vanishes,
//   mu_SL (x.y = 0): within each side the products have EQUAL magnitudes
//     m_i^2 n_i^2 = (M^2-(b_p+b_q)^2)(M^2-(b_p-b_q)^2)/(4M^2), and the sign
//     rule (+n on the side's lower-index leg, -n on the higher-index leg)
//     makes them cancel pairwise.
// The stratum family is M(t1) = M0 (1 + t1/(1-t1)): at t1 = 0 the comp side
// has n_i = 0 exactly (its |x|^2 = 2 beta_i), so only the two I-side rows are
// nonzero; t1 > 0 lifts all four rows. On the pair wall (M0 = sum_I beta)
// every row vanishes and the branch degenerates to the y = 0 stick — the
// same point the shrinking exterior sphere (radius -> 0) attaches at.
//
// CONTINUITY: the t -> 1^- pipeline approach shape at an attachment converges
// to the t1 = 0 slice (measured to ~1e-5 relative in |C|^2, |alpha|^2 at
// t = 0.99 for exterior chambers (all three attachments, asymmetric betas,
// dominant legs 0 and 1) AND interior chambers; the axis convention above is
// read off those shapes). The pipeline only FOLLOWS the stratum up to
// T ~ 1e4..1e5 (all leg energies then equalize and the shape leaves the
// stratum), which is why this branch is constructed in closed form instead of
// reusing the pipeline (the widget's T_SOLVE_MAX = 0.99 stays inside the
// approach window, so entering the stratum is display-continuous).

// The balanced stratum pair at t1 for the short pair I (a 2-element array of
// user leg indices; the complement is the long side). Returns the same shape
// as makeHyperpolygon ({x, y, vertices, sl2, accuracy}) or null when I is not
// a short pair or the input is degenerate. permute swaps quiver legs 2 and 3
// of the returned pair (same semantics as makeHyperpolygon's permute
// argument, for the PERMUTE_23 widget call pattern).
export function stratumPair(t1, beta, I, permute = false) {
  if (!Array.isArray(I) || I.length !== 2 || !Array.isArray(beta) || beta.length !== 4) {
    return null;
  }
  if (!Number.isFinite(t1)) return null;
  const comp = [0, 1, 2, 3].filter((i) => i !== I[0] && i !== I[1]);
  const sumI = beta[I[0]] + beta[I[1]];
  const sumC = beta[comp[0]] + beta[comp[1]];
  if (!(sumC >= sumI - 1e-12)) return null; // I must be the short side
  const t1c = Math.min(Math.max(t1, 0), 1 - 1e-9); // keep T1 finite
  const T1 = t1c / (1 - t1c);
  const M = sumC * (1 + T1);
  // Per-side magnitudes for legs (p, q), sideSum = beta[p] + beta[q] (the same
  // floating-point sum used for sumI / sumC, so A = M - sideSum is EXACTLY 0
  // at t1 = 0 on the comp side and on the pair wall). The two y magnitudes
  // share ONE product magnitude sqrt(G) — m_p n_p = m_q n_q = sqrt(G)
  // algebraically, and evaluating both as sqrt(G)/m_i keeps the mu_SL
  // cancellation at roundoff instead of leaving an O(n) mismatch when the
  // direct n^2 forms round independently (at t1 = 0 the comp n^2 ~ 1e-17
  // noise otherwise survives as a ~1e-9 mu_SL residual).
  //   m_i^2 = (M + b_i - b_k)(M + b_i + b_k)/(2M)   (factored: no cancellation)
  //   G     = (M - sideSum)(M + sideSum)(M - b_p + b_q)(M + b_p - b_q)/(4 M^2)
  //         = m_i^2 n_i^2 for both legs; >= 0 for short I.
  const sideMags = (p, q, sideSum) => {
    const m2p = ((M + beta[p] - beta[q]) * (M + beta[p] + beta[q])) / (2 * M);
    const m2q = ((M + beta[q] - beta[p]) * (M + beta[q] + beta[p])) / (2 * M);
    const G =
      ((M - sideSum) *
        (M + sideSum) *
        (M - beta[p] + beta[q]) *
        (M + beta[p] - beta[q])) /
      (4 * M * M);
    const g = Math.sqrt(Math.max(G, 0));
    return [Math.sqrt(m2p), g / Math.sqrt(m2p), Math.sqrt(m2q), g / Math.sqrt(m2q)];
  };
  // Assemble one side: legs (p, q) = the side's two legs in ascending order;
  // onE1 = the side's columns sit on e1 (rows on e2) or the reverse.
  const buildSide = (p, q, onE1) => {
    const [mp, np, mq, nq] = sideMags(p, q, beta[p] + beta[q]);
    if (onE1) {
      // columns (m, 0), rows (0, +-n)
      x[0][p] = C(mp);
      x[0][q] = C(mq);
      y[p][1] = C(np);
      y[q][1] = C(-nq);
    } else {
      // columns (0, m), rows (+-n, 0)
      x[1][p] = C(mp);
      x[1][q] = C(mq);
      y[p][0] = C(np);
      y[q][0] = C(-nq);
    }
  };
  const x = [
    [C(0), C(0), C(0), C(0)],
    [C(0), C(0), C(0), C(0)],
  ];
  const y = [
    [C(0), C(0)],
    [C(0), C(0)],
    [C(0), C(0)],
    [C(0), C(0)],
  ];
  const loI = Math.min(I[0], I[1]);
  const hiI = Math.max(I[0], I[1]);
  const loC = Math.min(comp[0], comp[1]);
  const hiC = Math.max(comp[0], comp[1]);
  // the side containing leg 0 sits on e1 (pipeline approach convention)
  if (I.indexOf(0) >= 0) {
    buildSide(loI, hiI, true);
    buildSide(loC, hiC, false);
  } else {
    buildSide(loC, hiC, true);
    buildSide(loI, hiI, false);
  }
  const [xf, yf] = permute ? swapLegs23(x, y) : [x, y];
  const su2 = muSU2Coords(x, y);
  return {
    x: xf,
    y: yf,
    vertices: hyperpolygonVertices(xf, yf),
    sl2: sl2Vertices(xf, yf),
    accuracy: {
      su2Norm: Math.hypot(su2[0], su2[1], su2[2]),
      muU1Error: muU1Error(x, y, beta),
      muCNorm: Math.max(...muC(x, y).map(cAbs2)) ** 0.5,
      usedStable: false,
    },
  };
}

// ===== Interior-chamber classification (star reindexing) =====
//
// Interior chambers (no dominant leg) come in two flavors: the three short
// size-2 subsets (one per pair-vs-pair split) either share a common index
// ("star" chambers) or they do not ("cycle" chambers). The original x/y
// ansatz below was built for the star chamber with short pairs {0,3}, {1,3},
// {2,3} and distinguished index 3: (r, theta) parameterize the leg-3 column
// of x, and the three snap points (0,0), (1/2,0), (1,0) are exactly where
// the three short pairs become straight (column 3 parallel to columns 0, 2,
// 1 respectively). Every OTHER star chamber is handled by an internal leg
// reindexing (see starIndex / makeHyperpolygon): solve with the legs
// permuted so the chamber's distinguished index lands in slot 3, then
// unpermute the output. Cycle chambers are reindexed the same way onto the
// cycle ansatz (see cycleIndex / cycleReindexed / buildXCycle above).

// chambers.js tie convention for the short side of a split: strict less,
// exact ties pick the lexicographically smaller side (for the three pair
// splits that is always the pair containing leg 0).
function shortPair01(beta, a, b) {
  const c = [0, 1, 2, 3].filter((i) => i !== a && i !== b);
  const sAB = beta[a] + beta[b];
  const sCD = beta[c[0]] + beta[c[1]];
  if (sAB < sCD) return true;
  if (sCD < sAB) return false;
  return Math.min(a, b) < Math.min(c[0], c[1]);
}

// The distinguished index of the star chamber containing beta: the common
// element of the three short pairs, or -1 (cycle chamber, or a degenerate
// on-wall tie pattern). Pure; the caller gates on dominantLeg(beta) < 0.
export function starIndex(beta) {
  const p01 = shortPair01(beta, 0, 1) ? [0, 1] : [2, 3];
  const p02 = shortPair01(beta, 0, 2) ? [0, 2] : [1, 3];
  const p03 = shortPair01(beta, 0, 3) ? [0, 3] : [1, 2];
  for (const j of p01) {
    if (p02.includes(j) && p03.includes(j)) return j;
  }
  return -1;
}

// Coherent attachment-point assignment (user request 2026-09-14, replacing
// the per-chamber "others ascending" sig): the three pair-SPLITS map to the
// three exterior-sphere attachment points ONCE AND FOR ALL, identically in
// every chamber. Crossing a pair wall replaces one short pair by its
// complement, and the wall's attachment point transfers to the complement
// while the other two points keep their pairs — i.e. in split terms the
// assignment is constant across the whole chamber graph:
//   south (r,theta) = (0,0)   <-> split {0,3}|{1,2}  (shortSubsets slot 7)
//   equator         = (1/2,0) <-> split {0,1}|{2,3}  (slot 5)
//   north           = (1,0)   <-> split {0,2}|{1,3}  (slot 6)
// so the attachment-slot map is the CONSTANT [7, 5, 6]. Anchored on the two
// chambers whose charts were already fixed: the historical star-3 map
// (south {0,3}, equator {2,3}, north {1,3}) and the cycle-0 ascending
// schedule (south {1,2}, equator {2,3}, north {1,3}) — they already agree.
// Each chart realizes the assignment by choosing which user legs occupy the
// ansatz's first three columns (slots 0..2; slot 3 holds the distinguished
// leg). Partner tables: for leg k, the other leg in k's side of each split.
const PARTNER_T3 = [3, 2, 1, 0]; // sides {0,3} | {1,2}
const PARTNER_T1 = [1, 0, 3, 2]; // sides {0,1} | {2,3}
const PARTNER_T2 = [2, 3, 0, 1]; // sides {0,2} | {1,3}

// The coherent sig for the star chamber with distinguished index j:
// sig = [partner_T3(j), partner_T2(j), partner_T1(j), j] so that the
// straight pairs south {sig[0], j}, north {sig[1], j}, equator {sig[2], j}
// are exactly j's sides of splits T3, T2, T1. For j = 3 this is the
// identity (historical path preserved bit-exactly).
export function starSig(j) {
  return [PARTNER_T3[j], PARTNER_T2[j], PARTNER_T1[j], j];
}

// The coherent sig for the cycle chamber with distinguished index m (also
// the right sig for the exterior chamber dominant in m, whose pair short
// sides are the same three pairs avoiding m): S/E/N are the sides of
// splits T3/T1/T2 avoiding m, and the cycle chart's south {slot0,slot1} /
// equator {slot1,slot2} / north {slot0,slot2} force
// slot0 = S&N, slot1 = S&E, slot2 = E&N (each intersection is one leg).
// For m = 0 this is the ascending schedule [1, 2, 3, 0].
export function cycleSig(m) {
  const S = m === 0 || m === 3 ? [1, 2] : [0, 3];
  const E = m === 0 || m === 1 ? [2, 3] : [0, 1];
  const N = m === 0 || m === 2 ? [1, 3] : [0, 2];
  return [
    S.filter((i) => N.includes(i))[0],
    S.filter((i) => E.includes(i))[0],
    E.filter((i) => N.includes(i))[0],
    m,
  ];
}

// The exterior-sphere attachment-slot rule for the star chamber containing
// beta (null outside star chambers): derived from the coherent reindexing
// starSig(j) — the straight pair at (r, theta) = (0,0), (1/2,0), (1,0) is
// {sig[0], j}, {sig[2], j}, {sig[1], j}, and each pair maps to its
// pair-split slot among the chamber's short size-2 subsets (5: {0,1}|{2,3},
// 6: {0,2}|{1,3}, 7: {0,3}|{1,2}). By the coherent assignment this is the
// chamber-independent map [7, 5, 6] for EVERY star chamber (previously only
// j = 3). Used as the analytic expectation/fallback alongside the measured
// probe.
export function starSlots(beta) {
  const j = starIndex(beta);
  if (j < 0) return null;
  const sig = starSig(j);
  const slotOf = (a, b) => {
    const key = Math.min(a, b) * 4 + Math.max(a, b);
    if (key === 1 || key === 11) return 5;
    if (key === 2 || key === 7) return 6;
    return 7; // {0,3} or {1,2}
  };
  return [slotOf(sig[0], j), slotOf(sig[2], j), slotOf(sig[1], j)];
}

// Star-chamber solve by internal reindexing: sig[i] = the user leg solved in
// internal slot i (slot 3 = the distinguished index j, slots 0..2 = the
// remaining legs ordered by starSig's coherent attachment assignment). The
// pipeline runs unchanged on the permuted beta; the output is unpermuted so
// that returned column/row k is user leg k, mu_U1 = the user beta, and the
// straight pairs at (r, theta) = (0,0), (1/2,0), (1,0) are {sig[0], j},
// {sig[2], j}, {sig[1], j} — the chamber's short sides of the splits mapped
// to those points, globally. For j = 3 sig is the identity and
// makeHyperpolygon takes the direct solveCore path (bit-identical to the
// historical behavior).
function starReindexed(r, theta, t, beta, j, permute) {
  const sig = starSig(j);
  const betaP = sig.map((i) => beta[i]);
  const inner = solveCore(r, theta, t, betaP, false);
  const inv = [0, 0, 0, 0];
  sig.forEach((c, i) => {
    inv[c] = i;
  });
  const x = [0, 1].map((row) => inv.map((c) => inner.x[row][c]));
  const y = inv.map((c) => inner.y[c]);
  const [xd, yd] = permute ? swapLegs23(x, y) : [x, y];
  const su2 = muSU2Coords(x, y);
  return {
    x: xd,
    y: yd,
    vertices: hyperpolygonVertices(xd, yd),
    sl2: sl2Vertices(xd, yd),
    accuracy: {
      su2Norm: Math.hypot(su2[0], su2[1], su2[2]),
      muU1Error: muU1Error(x, y, beta),
      muCNorm: Math.max(...muC(x, y).map(cAbs2)) ** 0.5,
      usedStable: inner.accuracy.usedStable,
    },
  };
}

// The distinguished index of the cycle chamber containing beta: the three
// short size-2 subsets (same shortPair01 tie convention as starIndex) share
// NO common element, and the distinguished index is the one missing from
// their union (the union is then a 3-subset and the pairs are its three
// pairs). -1 outside cycle chambers (star chambers have union size 4).
// Pure; the caller gates on dominantLeg(beta) < 0 and starIndex(beta) < 0.
export function cycleIndex(beta) {
  const p01 = shortPair01(beta, 0, 1) ? [0, 1] : [2, 3];
  const p02 = shortPair01(beta, 0, 2) ? [0, 2] : [1, 3];
  const p03 = shortPair01(beta, 0, 3) ? [0, 3] : [1, 2];
  const union = p01.concat(p02.filter((i) => !p01.includes(i)), p03.filter((i) => !p01.includes(i) && !p02.includes(i)));
  if (union.length !== 3) return -1;
  return [0, 1, 2, 3].find((i) => !union.includes(i));
}

// The exterior-sphere attachment-slot rule for the cycle chamber containing
// beta (null outside cycle chambers — note an exterior/dominant chamber
// shares the cycle chamber's pair short sides, so this also covers it):
// derived from the coherent reindexing cycleSig(j) — the straight pair at
// (r, theta) = (0,0), (1/2,0), (1,0) is {sig[0],sig[1]}, {sig[1],sig[2]},
// {sig[0],sig[2]}, mapped to its pair-split slot with the same key as
// starSlots (5: {0,1}|{2,3}, 6: {0,2}|{1,3}, 7: {0,3}|{1,2}). By the
// coherent assignment this is the chamber-independent map [7, 5, 6] for
// EVERY cycle chamber (previously only j = 0).
export function cycleSlots(beta) {
  const j = cycleIndex(beta);
  if (j < 0) return null;
  const sig = cycleSig(j);
  const slotOf = (a, b) => {
    const key = Math.min(a, b) * 4 + Math.max(a, b);
    if (key === 1 || key === 11) return 5;
    if (key === 2 || key === 7) return 6;
    return 7; // {0,3} or {1,2}
  };
  return [slotOf(sig[0], sig[1]), slotOf(sig[1], sig[2]), slotOf(sig[0], sig[2])];
}

// Cycle-chamber solve by internal reindexing (mirror of starReindexed):
// sig[i] = the user leg solved in internal slot i (slot 3 = the
// distinguished index j, slots 0..2 = the remaining legs ordered by
// cycleSig's coherent attachment assignment), the pipeline runs on the
// CYCLE ansatz with the permuted beta, and the output is unpermuted so that
// returned column/row k is user leg k and mu_U1 = the user beta. The
// straight pairs at (r, theta) = (0,0), (1/2,0), (1,0) are
// {sig[0],sig[1]}, {sig[1],sig[2]}, {sig[0],sig[2]} — the chamber's short
// sides of the splits mapped to those points, globally. The permute
// argument applies last, exactly as in starReindexed.
function cycleReindexed(r, theta, t, beta, j, permute) {
  const sig = cycleSig(j); // [slot0, slot1, slot2, j] — complete
  const betaP = sig.map((i) => beta[i]);
  const inner = solveCore(r, theta, t, betaP, false, CYCLE_ANSATZ);
  const inv = [0, 0, 0, 0];
  sig.forEach((c, i) => {
    inv[c] = i;
  });
  const x = [0, 1].map((row) => inv.map((c) => inner.x[row][c]));
  const y = inv.map((c) => inner.y[c]);
  const [xd, yd] = permute ? swapLegs23(x, y) : [x, y];
  const su2 = muSU2Coords(x, y);
  return {
    x: xd,
    y: yd,
    vertices: hyperpolygonVertices(xd, yd),
    sl2: sl2Vertices(xd, yd),
    accuracy: {
      su2Norm: Math.hypot(su2[0], su2[1], su2[2]),
      muU1Error: muU1Error(x, y, beta),
      muCNorm: Math.max(...muC(x, y).map(cAbs2)) ** 0.5,
      usedStable: inner.accuracy.usedStable,
    },
  };
}


// pre-swap of beta plus this module's permute=true output swap, which cancel
// in the display). Set FALSE to disable the permutation: callers then pass
// beta unchanged and permute = false, so the returned (x, y) is the solved
// representative for the given beta directly. Either setting keeps the
// displayed polygon leg j = user beta leg j and mu_U1 = the user beta.
// Disabled per user request 2026-09-13 (briefly true 2026-09-13..14,
// then disabled again 2026-09-14 — the permutation is meant as a display
// choice only and will be superseded by the crease-consistency traversal
// fix, task list #6); flip to true to restore the historical widget-exact
// call pattern.
export const PERMUTE_23 = false;

// Main entry: (r, theta, t, beta, permute) -> {x, y, vertices, sl2, accuracy}
// permute = true (default) swaps quiver legs 2 and 3 in the returned (x, y)
// and builds the display polygons from the swapped pair; this re-orders the
// polygon's traversal (the chord v0 -> v4 and the closure are unchanged
// since they depend only on the leg sum). accuracy always describes the
// solved (unpermuted) representative, which solves the moment map equations
// for the given beta; the permuted pair does too only when beta2 = beta3.
// Callers that pair permute = true with a pre-swapped beta should gate both
// on PERMUTE_23 (see widget.js / sideview.js) so the swaps cancel together.
//
// Interior star chambers (the three short pairs share a common index j, see
// starIndex) with j !== 3 are solved by internal reindexing: the pipeline
// runs on the legs permuted so that j lands in slot 3, and the output is
// unpermuted back to user indexing. The returned pair therefore always has
// mu_U1 = the given beta and displayed leg k = user leg k; only the polygon
// traversal order changes with the chamber, same class as the permute swap.
// unpermute the output. Cycle chambers (starIndex < 0, cycleIndex >= 0, see
// below) are reindexed the same way onto the cycle x ansatz
// [[1,1,1,0],[0, r e^{i theta}, 1-r, 1]] via cycleReindexed / CYCLE_ANSATZ.
export function makeHyperpolygon(r, theta, t, beta, permute = true) {
  // Exterior branch: in a dominant chamber (one beta >= the sum of the rest)
  // the t = 0 slice has no y = 0 solution; return the closed-form minimum
  // energy configuration instead (see the exterior-branch section above).
  // For t > 0 the historical pipeline below already converges and its
  // t -> 0+ limit IS this configuration, so the display is continuous.
  const dom = dominantLeg(beta);
  if (dom >= 0 && t <= 0) {
    const branchPair = exteriorPair(r, theta, beta, dom);
    if (branchPair !== null) {
      const su2b = muSU2Coords(branchPair[0], branchPair[1]);
      const [xd, yd] = permute ? swapLegs23(branchPair[0], branchPair[1]) : branchPair;
      return {
        x: xd,
        y: yd,
        vertices: hyperpolygonVertices(xd, yd),
        sl2: sl2Vertices(xd, yd),
        accuracy: {
          su2Norm: Math.hypot(su2b[0], su2b[1], su2b[2]),
          muU1Error: muU1Error(branchPair[0], branchPair[1], beta),
          muCNorm: Math.max(...muC(branchPair[0], branchPair[1]).map(cAbs2)) ** 0.5,
          usedStable: false,
        },
      };
    }
  }

  const sj = dom < 0 ? starIndex(beta) : -1;
  if (sj >= 0 && sj !== 3) {
    return starReindexed(r, theta, t, beta, sj, permute);
  }
  // Cycle chambers (interior, the three short pairs share no common index):
  // solved by internal reindexing on the cycle ansatz, for every j (there is
  // no historical cycle path to preserve).
  if (dom < 0 && sj < 0) {
    const cj = cycleIndex(beta);
    if (cj >= 0) {
      return cycleReindexed(r, theta, t, beta, cj, permute);
    }
  }
  return solveCore(r, theta, t, beta, permute);
}

// The historical pipeline (raw ansatz -> balancing cascade -> endpoint and
// locus retries), on the beta as given. Star chambers with j !== 3 enter
// here only through starReindexed's permuted call, cycle chambers with any
// j only through cycleReindexed's permuted call. The ansatz picks the x
// normal form and its y-solve (STAR_ANSATZ = historical, CYCLE_ANSATZ = the
// cycle chart); the balancing cascade and the retry machinery are ansatz-
// generic (the orbit degeneracies live in the columns, not the beta ansatz).
export function solveCore(r, theta, t, beta, permute, ansatz = STAR_ANSATZ) {
  const reff = Math.min(r, 1 - 1e-5);
  const ySolveX = ansatz.buildX(reff, theta, beta[0]);
  const y0 = ansatz.solveY(ySolveX, reff, t);
  const x0 = ansatz.buildX(r, theta, beta[0]);

  const [pair0, usedStable] = balancedPair(x0, y0, beta);
  let pair = pair0;

  // Endpoint retries. Both ends of the r axis are degenerate for the raw
  // pair the pipeline feeds the balancer, in complementary ways:
  //   r = 0: the y-solve is perfectly regular, but x columns 0 and 3
  //     coincide ([sqrt(2 beta0), 0] and [1, 0] at beta0 = 1/2), the central
  //     A-orbit loses a dimension, and the su(2) balancing stalls at a flat
  //     ~0.25 plateau for every start (measured over the whole fast-slice
  //     box); at the true r = 0 point no start recovers the basin.
  //   r = 1: the y-solve is singular exactly at r = 1 (historical offset
  //     reff = 1-1e-5), the mixed pair inherits an O(1-reff) mu_C mismatch,
  //     and near the endpoint the max-norm Newton line search walks past the
  //     narrow su(2) basin (the Euclidean-line-search variant converges).
  // So when the cascade above leaves the endpoint pair broken (or, at the
  // high end, its mu_C sits at the offset scale), re-run the whole cascade
  // on the consistent pair evaluated AT the offset point (x built at
  // reffAlt, y solved at reffAlt). This is the display-at-the-limit
  // evaluation: the returned representative solves every moment map
  // equation exactly at (reffAlt, theta, t), differs from the true endpoint
  // representative by O(reffAlt) in the parameters (polygon invariants move
  // well below display precision), and carries no mu_C artifact at all.
  // It also rescues the t = 0 corners, where y vanishes identically and a
  // y-only offset would be a no-op. Healthy solves (1e-5 < r < 1-1e-5, su2
  // and mu_C clean) never enter this branch.
  const atLowEnd = r <= 1e-5;
  const atHighEnd = r > 1 - 1e-5;
  if (
    (atLowEnd || atHighEnd) &&
    (!(su2NormOf(pair) <= 1e-6) || (atHighEnd && muCNormOf(pair) > 1e-9))
  ) {
    const offsets = atLowEnd ? [1e-9, 1e-6] : [1e-6, 1e-8];
    for (const off of offsets) {
      const reffAlt = atLowEnd ? off : 1 - off;
      const x0Alt = ansatz.buildX(reffAlt, theta, beta[0]);
      const y0Alt = ansatz.solveY(x0Alt, reffAlt, t);
      if (!y0Alt) continue;
      const [cand] = balancedPair(x0Alt, y0Alt, beta);
      if (cand !== null && pairBetter(cand, pair)) {
        pair = cand;
      }
    }
  }

  // Degenerate-locus retries at (r, theta) = (1/2, 0), i.e. where the
  // parallelism defect of x columns 2 and 3, D = r e^{i theta} - (1 - r),
  // vanishes (columns (1,1) and (1-r, r e^{i theta}) become parallel exactly
  // there). For betas whose balanced representative requires the two columns
  // separated, the balancing family cannot represent it at the locus at all:
  // the fast-slice action keeps col2' - col3' = a22^2 (col2 - col3) = 0 and
  // the torus acts per leg, so every reachable representative keeps the
  // columns parallel and the su(2) residual has a positive infimum —
  // measured: every start (Newton, stable fallback, all rescues) stalls at
  // the SAME beta-dependent value (5.2e-2 for beta = (0.5,0.5,0.8,0.25),
  // 5.0e-1 for a dominant leg-2 chamber) at EVERY t, while the widget's
  // default beta has a parallel-columns representative and never stalls.
  // Just off the locus the tiny column angle is amplified through a
  // near-cancellation inside the A-action, so neighbors solve — but the
  // basin is chaotic for |D| <~ 1e-6 (stalls observed up to |D| ~ 6e-7,
  // clean from ~1.5e-6). So when the solve is not fully converged and
  // (r, theta) sits at the locus (gate 1e-4, 100x beyond the observed
  // band), re-run the whole cascade on the consistent pair evaluated at
  // r = 0.5 +- 1e-4 (ladder to 1e-3; the nudge side follows r so the
  // display continues the row the user is on). The retry trigger is 1e-9
  // (not the 1e-6 rescue gate): the true branch solves to ~1e-12
  // throughout the gate disk, so anything above 1e-9 is stall debris —
  // triggering on it makes the whole disk uniformly clean instead of
  // leaving a chaotically-varying 1e-10..1e-6 band. Display-at-the-limit evaluation again: the returned pair
  // solves every moment map equation exactly at (rAlt, theta, t) and its
  // polygon invariants match the neighboring true branch to ~2e-6 (measured
  // at 1e-4 offset; the r-slope of the invariants is ~0.01 there). Clean
  // solves never enter this branch; the break keeps the snap point
  // (the widget parks at r = 0.5, theta = 0) to one extra cascade.
  const locusD = Math.hypot(r * Math.cos(theta) - (1 - r), r * Math.sin(theta));
  if (locusD <= 1e-4 && !(su2NormOf(pair) <= 1e-9)) {
    for (const off of [1e-4, 1e-3]) {
      const rAlt = r <= 0.5 ? 0.5 - off : 0.5 + off;
      const x0Alt = ansatz.buildX(rAlt, theta, beta[0]);
      const y0Alt = ansatz.solveY(x0Alt, rAlt, t);
      if (!y0Alt) continue;
      const [cand] = balancedPair(x0Alt, y0Alt, beta);
      if (cand !== null && pairBetter(cand, pair)) {
        pair = cand;
        if (su2NormOf(pair) <= 1e-9) break;
      }
    }
  }

  const [xf, yf] = pair;
  const su2 = muSU2Coords(xf, yf);
  const [xd, yd] = permute ? swapLegs23(xf, yf) : [xf, yf];
  return {
    x: xd,
    y: yd,
    vertices: hyperpolygonVertices(xd, yd),
    sl2: sl2Vertices(xd, yd),
    accuracy: {
      su2Norm: Math.hypot(su2[0], su2[1], su2[2]),
      muU1Error: muU1Error(xf, yf, beta),
      muCNorm: Math.max(...muC(xf, yf).map(cAbs2)) ** 0.5,
      usedStable: usedStable,
    },
  };
}

// hyperpolygon vertices in su(2)^*: start at the origin, then for each
// leg add ToCoordinates(x_col_i x_col_i^dagger) and subtract
// ToCoordinates(y_row_i^dagger y_row_i). Closes at the origin when
// the moment map equations hold. (9 points)
export function hyperpolygonVertices(x, y) {
  const pts = [[0, 0, 0]];
  for (let i = 0; i < 4; i++) {
    const x0 = x[0][i];
    const x1 = x[1][i];
    const cV = traceFreeCoords(
      cMul(x0, cConj(x0)),
      cMul(x0, cConj(x1)),
      cMul(cConj(x0), x1),
      cMul(x1, cConj(x1))
    );
    const y0 = y[i][0];
    const y1 = y[i][1];
    const cW = traceFreeCoords(
      cMul(cConj(y0), y0),
      cMul(cConj(y0), y1),
      cMul(cConj(y1), y0),
      cMul(cConj(y1), y1)
    );
    const last = pts[pts.length - 1];
    pts.push([last[0] + cV[0], last[1] + cV[1], last[2] + cV[2]]);
    const last2 = pts[pts.length - 1];
    pts.push([last2[0] - cW[0], last2[1] - cW[1], last2[2] - cW[2]]);
  }
  return pts;
}

// SL(2,C) polygon: u_i = x_col_i . y_row_i, coordinates
// 1/2 {Tr(c1 u), Tr(c2 u), Tr(c3 u)} with c1 = [[0,1],[0,0]],
// c2 = [[1,0],[0,-1]], c3 = [[0,0],[1,0]]. Returns the real and
// imaginary parts of the 5 closed-polygon vertices.
export function sl2Vertices(x, y) {
  const pts = [
    [C(0), C(0), C(0)],
  ];
  for (let i = 0; i < 4; i++) {
    const u01 = cMul(x[0][i], y[i][1]);
    const u00 = cMul(x[0][i], y[i][0]);
    const u11 = cMul(x[1][i], y[i][1]);
    const u10 = cMul(x[1][i], y[i][0]);
    const coords = [cScale(u01, 0.5), cScale(cSub(u00, u11), 0.5), cScale(u10, 0.5)];
    const last = pts[pts.length - 1];
    pts.push([
      cAdd(last[0], coords[0]),
      cAdd(last[1], coords[1]),
      cAdd(last[2], coords[2]),
    ]);
  }
  return {
    real: pts.map((p) => [p[0][0], p[1][0], p[2][0]]),
    imag: pts.map((p) => [p[0][1], p[1][1], p[2][1]]),
  };
}