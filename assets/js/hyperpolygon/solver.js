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
//      y42 = t/(1-t) prescribed; whole y scaled by (1-r).
//      Evaluated at reff = min(r, 1-1e-5): the linear system is
//      singular at r = 1 and the (1-r) factor cancels the pole, so
//      the r = 1 value is obtained as the limit (offset chosen to
//      balance truncation vs conditioning of the near-singular solve).
//   3. fixMuU1: closed-form (C*)^4 balancing (torus action
//      x -> x.diag(1/lam^2), y -> diag(lam^2).y) solving
//      mu_U1 = beta exactly. Per leg: c/u - d u = 2 beta with
//      u = lam^4, c = |x_leg|^2, d = |y_leg|^2.
//   4. Newton (or a cyclic 1-D minimization fallback) on the three
//      real parameters (a12, b12, a22) of A = [[1, a12+i b12],[0, a22^2]]
//      so that the su(2) coordinates of mu_SU2 vanish after fixMuU1.
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

// Solves mu_C(x, y) = 0 and mu_SL(x, y) = 0 for the 7 free entries of y
// (order y11, y12, y21, y22, y31, y32, y41) with y42 = t/(1-t) prescribed,
// then scales the whole y by (1 - reff). x must be built at reff.
export function solveY(x, reff, t) {
  const T = t / (1 - t);
  const M = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => C(0)));
  const b = Array.from({ length: 7 }, () => C(0));
  // mu_C rows
  M[0][0] = x[0][0];
  M[0][1] = x[1][0];
  M[1][2] = x[0][1];
  M[1][3] = x[1][1];
  M[2][4] = x[0][2];
  M[2][5] = x[1][2];
  M[3][6] = x[0][3];
  b[3] = cScale(x[1][3], -T);
  // mu_SL rows M11, M12, M21 (M22 is dependent on mu_C and M11)
  M[4][0] = x[0][0];
  M[4][2] = x[0][1];
  M[4][4] = x[0][2];
  M[4][6] = x[0][3];
  M[5][1] = x[0][0];
  M[5][3] = x[0][1];
  M[5][5] = x[0][2];
  b[5] = cScale(x[0][3], -T);
  M[6][0] = x[1][0];
  M[6][2] = x[1][1];
  M[6][4] = x[1][2];
  M[6][6] = x[1][3];
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

// U(1)^4 balancing: solves mu_U1(x', y') = beta exactly.
// Torus action x -> x.diag(1/lam^2), y -> diag(lam^2).y; per leg
// c/u - d u = 2 beta with u = lam^4 has the closed-form positive root.
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
        ? (-beta[i] + Math.sqrt(beta[i] * beta[i] + c[i] * d[i])) / d[i]
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

// damped Newton with numeric Jacobian
function newton(F, p0) {
  let p = p0.slice();
  let f = F(p);
  let n0 = normInf3(f);
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
      if (normInf3(fn) < base) {
        p = pn;
        f = fn;
        n0 = normInf3(fn);
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
function stablePath(x0, y0, beta, tolerance) {
  const p0 = [0, 0, 1];
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

// Main entry: (r, theta, t, beta) -> {x, y, vertices, sl2, accuracy}
export function makeHyperpolygon(r, theta, t, beta) {
  const reff = Math.min(r, 1 - 1e-5);
  const ySolveX = buildX(reff, theta, beta[0]);
  const y0 = solveY(ySolveX, reff, t);
  const x0 = buildX(r, theta, beta[0]);

  const F = makeFastResidual(x0, y0, beta);
  const nrm = newton(F, [0, 0, 1]);
  let pair;
  if (nrm.residual <= TOLERANCE) {
    const A = [
      [C(1), [nrm.p[0], nrm.p[1]]],
      [C(0), C(nrm.p[2] * nrm.p[2])],
    ];
    const [xa, ya] = actCentral(A, x0, y0);
    pair = fixMuU1(xa, ya, beta);
    // if Newton stalled above the tight threshold, also try the stable
    // fallback and keep the more accurate result
    const probe = muSU2Coords(pair[0], pair[1]);
    if (Math.hypot(probe[0], probe[1], probe[2]) > 1e-8) {
      const alt = stablePath(x0, y0, beta, TOLERANCE);
      const altSU2 = muSU2Coords(alt[0], alt[1]);
      if (Math.hypot(altSU2[0], altSU2[1], altSU2[2]) < Math.hypot(probe[0], probe[1], probe[2])) {
        pair = alt;
      }
    }
  } else {
    pair = stablePath(x0, y0, beta, TOLERANCE);
  }

  const [xf, yf] = pair;
  const su2 = muSU2Coords(xf, yf);
  return {
    x: xf,
    y: yf,
    vertices: hyperpolygonVertices(xf, yf),
    sl2: sl2Vertices(xf, yf),
    accuracy: {
      su2Norm: Math.hypot(su2[0], su2[1], su2[2]),
      muU1Error: muU1Error(xf, yf, beta),
      muCNorm: Math.max(...muC(xf, yf).map(cAbs2)) ** 0.5,
      usedStable: nrm.residual > TOLERANCE,
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