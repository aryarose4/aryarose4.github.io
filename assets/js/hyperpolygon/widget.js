// Hyperpolygon widget: live three.js view of the su(2) polygon computed by ./solver.js.
// Loaded as an ES module after the vendored three.min.js and OrbitControls.js (global THREE).

import {
  makeHyperpolygon,
  stratumPair,
  muSU2Coords,
  hyperpolygonVertices,
  sl2Vertices,
  PERMUTE_23,
  starSlots,
  cycleSlots,
} from "./solver.js";
import { makeOrientor } from "./orientation.js";
import { shortSubsets, chamberInterval, applyBetaDrag, breakingSubsets } from "./chambers.js";
import { makeSideView, probeExteriorMap, attachmentRs, PERM, CAP_NEAR_INF_W, PARALLEL_TOL } from "./sideview.js";
import { makeTutorial } from "./tutorial.js";

const T_SOLVE_MAX = 0.99;
// Stratum-mode lim-button band (user request 2026-09-15): while the
// I-stratum is active the exit button ("lim t->0") shows only when the
// t slider sits in the first LIM_T0_BAND of its range — the tip end its
// label names, mirroring the entry button's t >= 0.9 gate.
const LIM_T0_BAND = 0.1;
// Stratum entry/exit morph (user request 2026-09-15): after the residual-
// gauge alignment on a branch switch, the remaining intrinsic shape
// change (the exit pop ~0.03-0.17 at t1 = 0.1, the crossover-class entry)
// plays as a short smoothstep morph instead of a teleport.
const STRATUM_MORPH_MS = 350;

const PALETTES = {
  light: {
    edgeA: 0x000000,
    edgeB: 0x0f8a3a,
    edgeYellow: 0xd9a800,
    axes: 0xb0b0b0,
    markers: 0x808080,
    border: "#cfd4da",
    caption: "#666666",
    // side view (task 3, light-mode adaptation): pure white spheres are
    // invisible on the white page, so the central sphere and the ACTIVE
    // (highlighted) exterior sphere / stratum carry a blue-gray tint in
    // light mode; dark mode keeps the original white-on-dark look.
    // User request 2026-09-15: the UNHIGHLIGHTED central and exterior
    // spheres share one color (`ext` = `sphere`) — only the highlight
    // lerp target (extHi) differs.
    sphere: 0xcdd7e2,
    sphereGrey: 0x93a5b8,
    ext: 0xcdd7e2,
    extHi: 0x8fa3ba,
    arc: 0x9aa4b2,
    sideBg: null,
  },
  dark: {
    edgeA: 0xffffff,
    edgeB: 0x3fce65,
    edgeYellow: 0xffd84d,
    axes: 0x555f6e,
    markers: 0x9aa4b2,
    border: "#4a525e",
    caption: "#a0a0a0",
    sphere: 0xffffff,
    sphereGrey: 0xb0b0b0,
    ext: 0xffffff,
    extHi: 0xffffff,
    arc: 0x707c8a,
    sideBg: null,
  },
};

function isDark() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function palette() {
  return PALETTES[isDark() ? "dark" : "light"];
}

// Spec 15: the L2 norm of the real moment map residuals of a solved pair,
// over all 7 real components — the three su(2) coordinates of
// mu_SU2 = Sum_i x_i x_i^dagger - y_i^dagger y_i plus the four per-leg
// U(1) residuals (1/2)(|x_i|^2 - |y_i|^2) - beta_i. Complex numbers are
// [re, im] pairs.
function momentResidual(x, y, beta) {
  const su2 = muSU2Coords(x, y);
  let s = su2[0] * su2[0] + su2[1] * su2[1] + su2[2] * su2[2];
  for (let j = 0; j < 4; j++) {
    const px =
      0.5 *
      (x[0][j][0] * x[0][j][0] +
        x[0][j][1] * x[0][j][1] +
        x[1][j][0] * x[1][j][0] +
        x[1][j][1] * x[1][j][1]);
    const py =
      0.5 *
      (y[j][0][0] * y[j][0][0] +
        y[j][0][1] * y[j][0][1] +
        y[j][1][0] * y[j][1][0] +
        y[j][1][1] * y[j][1][1]);
    const e = px - py - beta[j];
    s += e * e;
  }
  return Math.sqrt(s);
}

// ===== Stratum branch-switch alignment (user request 2026-09-15) =====
//
// The pipeline and I-stratum charts describe the same balanced pair only up
// to the residual U(2) x U(1)^4 gauge, so the raw representatives can be
// far apart: measured entry jumps are ~1e-3 (clean classes) but 0.45..0.8
// at the north sphere of cycle chambers (the stratum normal form puts the
// stick on the other axis — pure gauge) and 1.0..1.6 at the equator-locus
// class; the exit pops 0.03..0.17 intrinsically (the stratum family sits
// at M = M0(1 + t1/(1-t1)) while the pipeline's t = 0.99 approach hugs the
// t1 = 0 slice). On a branch switch the new pair is gauge-rotated onto the
// displayed representative (display layer only — all moment maps are
// gauge-invariant, so the rotated pair is an equally valid solved
// representative and the readout stays consistent), then the remaining
// intrinsic change plays as a short morph (STRATUM_MORPH_MS).

// Kabsch-optimal rotation mapping the point list P onto Q (both 9-point
// polygon walks starting at the origin; UNCENTERED — the gauge rotates
// about the walk origin). Horn quaternion method: 4x4 symmetric attitude
// matrix + Jacobi eigen solver. Straight-stick data has tied eigenvalue
// clusters there, so ALL four candidate eigenvectors are scored by their
// actual residual and the best kept (a signed-max pick can land in the
// wrong cluster and return a garbage rotation).
function kabschRotation(P, Q) {
  const S = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let k = 0; k < P.length; k++) {
    const p = P[k];
    const q = Q[k];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) S[i][j] += p[i] * q[j];
    }
  }
  const Sxx = S[0][0], Sxy = S[0][1], Sxz = S[0][2];
  const Syy = S[1][1], Syz = S[1][2];
  const Szz = S[2][2];
  const M = [
    [Sxx + Syy + Szz, Syz - S[2][1], S[2][0] - Sxz, Sxy - S[1][0]],
    [Syz - S[2][1], Sxx - Syy - Szz, Sxy + S[1][0], S[2][0] + Sxz],
    [S[2][0] - Sxz, Sxy + S[1][0], -Sxx + Syy - Szz, Syz + S[2][1]],
    [Sxy - S[1][0], S[2][0] + Sxz, Syz + S[2][1], -Sxx - Syy + Szz],
  ];
  const a = M.map((r) => r.slice());
  const v = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  for (let sweep = 0; sweep < 60; sweep++) {
    let am = 0, pi = 0, pj = 1;
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        if (Math.abs(a[i][j]) > am) {
          am = Math.abs(a[i][j]);
          pi = i;
          pj = j;
        }
      }
    }
    if (am < 1e-15) break;
    const phi = 0.5 * Math.atan2(2 * a[pi][pj], a[pj][pj] - a[pi][pi]);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    for (let i = 0; i < 4; i++) {
      const ap = a[i][pi], aq = a[i][pj];
      a[i][pi] = c * ap - s * aq;
      a[i][pj] = s * ap + c * aq;
    }
    for (let j = 0; j < 4; j++) {
      const ap = a[pi][j], aq = a[pj][j];
      a[pi][j] = c * ap - s * aq;
      a[pj][j] = s * ap + c * aq;
    }
    for (let i = 0; i < 4; i++) {
      const vp = v[i][pi], vq = v[i][pj];
      v[i][pi] = c * vp - s * vq;
      v[i][pj] = s * vp + c * vq;
    }
  }
  let bestR = null;
  let bestQ = null;
  let bestAl = Infinity;
  for (let bi = 0; bi < 4; bi++) {
    const qw = v[0][bi], qx = v[1][bi], qy = v[2][bi], qz = v[3][bi];
    const n = Math.hypot(qw, qx, qy, qz);
    if (!(n > 0)) continue;
    const w = qw / n, x = qx / n, y = qy / n, z = qz / n;
    const R = [
      [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
      [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
      [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ];
    let al = 0;
    for (let k = 0; k < P.length; k++) {
      al = Math.max(
        al,
        Math.hypot(
          R[0][0] * P[k][0] + R[0][1] * P[k][1] + R[0][2] * P[k][2] - Q[k][0],
          R[1][0] * P[k][0] + R[1][1] * P[k][1] + R[1][2] * P[k][2] - Q[k][1],
          R[2][0] * P[k][0] + R[2][1] * P[k][1] + R[2][2] * P[k][2] - Q[k][2]
        )
      );
    }
    if (al < bestAl) {
      bestAl = al;
      bestR = R;
      bestQ = [w, x, y, z];
    }
  }
  return { R: bestR, q: bestQ, residual: bestAl };
}

// SU(2) lift of the unit quaternion [w, x, y, z]: the complex 2x2 matrix
// g = [[w + i z, -y + i x], [y + i x, w - i z]] satisfies det g = 1 and
// Ad_g (conjugation on the traceless Hermitian matrices) is exactly the
// quaternion's rotation matrix above (verified against the solver's
// hyperpolygonVertices covariance to 1e-15).
function liftSU2(q) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  return [
    [[w, z], [-y, x]],
    [[y, x], [w, -z]],
  ];
}

// Residual-gauge rotation of a solved pair: x -> g x, y -> y g^dagger with
// g the SU(2) matrix above (rows/columns are [re, im] pairs). Unitary, so
// every moment map is unchanged; the su(2) polygon rotates by Ad_g.
function rotatePair(x, y, g) {
  const a = g[0][0];
  const b = g[0][1];
  // g^dagger = [[conj(a), -b], [conj(b), a]]
  const gd = [
    [[a[0], -a[1]], [-b[0], -b[1]]],
    [[b[0], -b[1]], [a[0], a[1]]],
  ];
  const xg = [0, 1].map((r) =>
    [0, 1, 2, 3].map((j) => {
      let s = [0, 0];
      for (let k = 0; k < 2; k++) {
        s = [s[0] + (g[r][k][0] * x[k][j][0] - g[r][k][1] * x[k][j][1]),
             s[1] + (g[r][k][0] * x[k][j][1] + g[r][k][1] * x[k][j][0])];
      }
      return s;
    })
  );
  const yg = y.map((row) => {
    const out = [[0, 0], [0, 0]];
    for (let j = 0; j < 2; j++) {
      for (let k = 0; k < 2; k++) {
        out[j] = [out[j][0] + (row[k][0] * gd[k][j][0] - row[k][1] * gd[k][j][1]),
                  out[j][1] + (row[k][0] * gd[k][j][1] + row[k][1] * gd[k][j][0])];
      }
    }
    return out;
  });
  return [xg, yg];
}

// Custom range-input styling: a 5px rounded track drawn as a gradient so
// blocked chamber-wall zones can be rendered at the edges. The CSS custom
// properties --hp-lo/--hp-hi give the inner (allowed) span as percentages;
// the defaults 0%/100% mean no blocked zone.
function ensureSliderStyles() {
  if (document.getElementById("hyperpolygon-slider-styles")) return;
  const style = document.createElement("style");
  style.id = "hyperpolygon-slider-styles";
  style.textContent = [
    "#hyperpolygon-widget .hp-slider {",
    "  -webkit-appearance: none;",
    "  appearance: none;",
    "  background: transparent;",
    "  height: 18px;",
    "  --hp-lo: 0%;",
    "  --hp-hi: 100%;",
    "}",
    "#hyperpolygon-widget .hp-slider::-webkit-slider-runnable-track {",
    "  height: 5px;",
    "  border-radius: 3px;",
    "  background: linear-gradient(to right, var(--hp-red) 0 var(--hp-lo),",
    "    var(--hp-track) var(--hp-lo) var(--hp-hi), var(--hp-red) var(--hp-hi) 100%);",
    "}",
    "#hyperpolygon-widget .hp-slider::-webkit-slider-thumb {",
    "  -webkit-appearance: none;",
    "  appearance: none;",
    "  width: 14px;",
    "  height: 14px;",
    "  border-radius: 50%;",
    "  background: var(--hp-thumb);",
    "  margin-top: -4.5px;",
    "}",
    "#hyperpolygon-widget .hp-slider::-moz-range-track {",
    "  height: 5px;",
    "  border-radius: 3px;",
    "  background: linear-gradient(to right, var(--hp-red) 0 var(--hp-lo),",
    "    var(--hp-track) var(--hp-lo) var(--hp-hi), var(--hp-red) var(--hp-hi) 100%);",
    "}",
    "#hyperpolygon-widget .hp-slider::-moz-range-thumb {",
    "  width: 13px;",
    "  height: 13px;",
    "  border: none;",
    "  border-radius: 50%;",
    "  background: var(--hp-thumb);",
    "}",
    "#hyperpolygon-widget .hp-chamber-box {",
    "  padding: 1px 8px;",
    "  border: 1px solid var(--hp-box-bd);",
    "  border-radius: 6px;",
    "  font-size: 0.8em;",
    "  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;",
    "  white-space: nowrap;",
    "  color: var(--hp-box-tx);",
    "  display: inline-flex;",
    "  align-items: center;",
    "  gap: 6px;",
    "}",
    "#hyperpolygon-widget .hp-chamber-box.hp-breaking {",
    "  border-color: var(--hp-amber);",
    "  background: var(--hp-amber-bg);",
    "  color: var(--hp-amber);",
    "  font-weight: 600;",
    "}",
    "#hyperpolygon-widget .hp-btn {",
    "  padding: 2px 10px;",
    "  border: 1px solid var(--hp-btn-bd);",
    "  border-radius: 6px;",
    "  background: transparent;",
    "  color: var(--hp-btn-tx);",
    "  font-size: 0.85em;",
    "  cursor: pointer;",
    "}",
    "#hyperpolygon-widget .hp-btn:hover:not(:disabled) {",
    "  border-color: var(--hp-btn-tx);",
    "}",
    "#hyperpolygon-widget .hp-btn:disabled {",
    "  opacity: 0.45;",
    "  cursor: default;",
    "}",
    "#hyperpolygon-widget .hp-slider:disabled {",
    "  opacity: 0.4;",
    "}",
    // tutorial control gating (task 24, milestone 1): a gated control group
    // is dimmed and inert; the active lesson's control gets an accent ring
    "#hyperpolygon-widget .hp-gated {",
    "  opacity: 0.35 !important;",
    "  pointer-events: none;",
    "}",
    "#hyperpolygon-widget .hp-tut-hilite {",
    "  outline: 2px solid var(--hp-amber);",
    "  outline-offset: 2px;",
    "}",
    // tutorial lesson card (task 24): a small floating explainer anchored
    // inside the widget container (near the control being taught, corner /
    // bottom dock as fallback)
    "#hyperpolygon-widget .hp-tut-card {",
    "  position: absolute;",
    "  z-index: 30;",
    "  box-sizing: border-box;",
    "  max-width: 340px;",
    "  padding: 10px 12px;",
    "  border: 1px solid var(--hp-box-bd);",
    "  border-radius: 10px;",
    "  background: var(--hp-tut-bg);",
    "  color: var(--hp-box-tx);",
    "  font-size: 0.85em;",
    "  line-height: 1.45;",
    "  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);",
    "}",
    "#hyperpolygon-widget .hp-tut-title {",
    "  font-weight: 600;",
    "  margin-bottom: 4px;",
    "}",
    "#hyperpolygon-widget .hp-tut-task {",
    "  margin-top: 6px;",
    "  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;",
    "  font-size: 0.95em;",
    "}",
    "#hyperpolygon-widget .hp-tut-row {",
    "  display: flex;",
    "  flex-wrap: wrap;",
    "  gap: 6px;",
    "  margin-top: 8px;",
    "}",
    // section labels: the header of every panel ("MODULI COORDINATES",
    // "PARAMETERS", ...) — small caps, one consistent style
    "#hyperpolygon-widget .hp-sec-label {",
    "  font-size: 0.78em;",
    "  font-weight: 600;",
    "  text-transform: uppercase;",
    "  letter-spacing: 0.07em;",
    "  color: var(--hp-box-tx);",
    "  margin: 0 0 8px 1px;",
    "}",
    // control panels (2026-09-15 cleanup): one bordered, rounded, tinted
    // box style shared by every panel — the matrices readout, Moduli
    // Coordinates, Parameters and the SL(2,C) details
    "#hyperpolygon-widget .hp-panel {",
    "  box-sizing: border-box;",
    "  border: 1px solid var(--hp-box-bd);",
    "  border-radius: 10px;",
    "  background: var(--hp-panel-bg);",
    "  padding: 10px 12px;",
    "  margin-top: 12px;",
    "}",
    // viewports (the polygon, the side view and the two SL(2,C) canvases):
    // one frame style — same border/radius family as the panels
    "#hyperpolygon-widget .hp-frame {",
    "  position: relative;",
    "  box-sizing: border-box;",
    "  border: 1px solid var(--hp-box-bd);",
    "  border-radius: 10px;",
    "  overflow: hidden;",
    "  background: var(--hp-frame-bg);",
    "}",
    "#hyperpolygon-widget .hp-cross-btn {",
    "  padding: 0 6px;",
    "  font-size: 0.75em;",
    "  border-color: var(--hp-amber);",
    "  color: var(--hp-amber);",
    "}",
    // top-right overlay listing the chamber's three short pairs (task 1):
    // each row names the two polygon sides of the pair and the exterior-
    // sphere attachment point (r value) that pair indexes; the row turns
    // yellow while its two sides are parallel (the straight pair)
    "#hyperpolygon-widget .hp-pair-list {",
    "  position: absolute;",
    "  top: 8px;",
    "  right: 8px;",
    "  display: flex;",
    "  flex-direction: column;",
    "  gap: 3px;",
    "  align-items: flex-end;",
    "  pointer-events: none;",
    "  font-size: 0.78em;",
    "}",
    "#hyperpolygon-widget .hp-pair-row {",
    "  padding: 1px 7px;",
    "  border: 1px solid var(--hp-box-bd);",
    "  border-radius: 6px;",
    "  background: var(--hp-pair-bg);",
    "  color: var(--hp-box-tx);",
    "  white-space: nowrap;",
    "  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;",
    "}",
    "#hyperpolygon-widget .hp-pair-row.hp-straight {",
    "  border-color: var(--hp-yellow);",
    "  background: var(--hp-yellow-bg);",
    "  color: var(--hp-yellow-tx);",
    "  font-weight: 600;",
    "}",
    "#hyperpolygon-widget {",
    "  --hp-red: #e9c2bd;",
    "  --hp-wall: #c0392b;",
    "  --hp-track: #c9cdd4;",
    "  --hp-thumb: #5b6570;",
    "  --hp-box-bd: #cfd4da;",
    "  --hp-box-tx: #666e78;",
    "  --hp-panel-bg: rgba(15, 23, 42, 0.028);",
    "  --hp-frame-bg: rgba(15, 23, 42, 0.016);",
    "  --hp-amber: #9a6a1f;",
    "  --hp-amber-bg: #f4e8d0;",
    "  --hp-btn-bd: #cfd4da;",
    "  --hp-btn-tx: #666e78;",
    "  --hp-yellow: #a67c00;",
    "  --hp-yellow-bg: #f6ecc2;",
    "  --hp-yellow-tx: #7a5c00;",
    "  --hp-pair-bg: rgba(255, 255, 255, 0.72);",
    "  --hp-tut-bg: rgba(255, 255, 255, 0.94);",
    "}",
    '[data-theme="dark"] #hyperpolygon-widget {',
    "  --hp-red: #6b3630;",
    "  --hp-wall: #e07060;",
    "  --hp-track: #454d59;",
    "  --hp-thumb: #a8b2bd;",
    "  --hp-box-bd: #4a525e;",
    "  --hp-box-tx: #a0a8b2;",
    "  --hp-panel-bg: rgba(148, 163, 184, 0.07);",
    "  --hp-frame-bg: rgba(148, 163, 184, 0.04);",
    "  --hp-amber: #d9a558;",
    "  --hp-amber-bg: #453519;",
    "  --hp-btn-bd: #4a525e;",
    "  --hp-btn-tx: #a0a8b2;",
    "  --hp-yellow: #e8c84a;",
    "  --hp-yellow-bg: #453a19;",
    "  --hp-yellow-tx: #e8c84a;",
    "  --hp-pair-bg: rgba(20, 24, 30, 0.6);",
    "  --hp-tut-bg: rgba(18, 22, 28, 0.94);",
    "}",
  ].join("\n");
  document.head.appendChild(style);
}

function activate(container) {
  ensureSliderStyles();
  // the tutorial card (task 24) and any future overlay position absolutely
  // against the widget container
  container.style.position = "relative";
  // symplectic parameters beta; the beta sliders stay inside ONE stability
  // chamber, fixed at load (chamber model: chambers.js). beta_1 starts at
  // 0.4 (user request 2026-09-15).
  const beta = [0.4, 0.5, 0.5, 0.25];
  // the chamber of the initial beta, recorded as its short subsets — the
  // {I} < {complement} inequalities shown as boxes below. applyBetaDrag
  // clamps every drag into the chamber's closure (walls may be touched,
  // never crossed), so dragging can never change the chamber; the amber
  // box highlight is the hook for the planned per-inequality "flop".
  const chamberShorts = shortSubsets(beta);
  // event bus (task 24, milestone 1): tutorial.js subscribes here; the
  // arrays stay empty (zero per-frame cost) until a tutorial is entered.
  // Declared this early so every fire site below sees it (TDZ discipline).
  const hooks = { onCrossWall: [], onStratum: [], onFrame: [], onSide: [] };
  // which chamberShorts pair slot attaches at each exterior-sphere point
  // (south, equator, north): measured once at load from the polygon
  // parallelism at the three attachment points (sideview.js). By the
  // solver's coherent attachment assignment (starSig / cycleSig) the map is
  // the constant [7,5,6] in EVERY chamber: south carries the chamber's
  // short side of split {0,3}|{1,2}, equator of {0,1}|{2,3}, north of
  // {0,2}|{1,3}. Crossing a wall (Cross Wall button) replaces one short
  // pair by its complement and THAT point transfers to the complement while
  // the other two points keep their pairs; the crossed sphere's size
  // formula shrinks to zero exactly on the wall and regrows. Null probe
  // entries (solver failure) fall back to the analytic rule (star/cycle
  // slots — cycleSlots also covers exterior/dominant chambers, whose pair
  // short sides are the cycle chamber's) and then to the unused slots in
  // fixed order so all three spheres exist.
  const extMap = [null, null, null];
  // Probe + fill: measured map (widget-exact solves), analytic fallback
  // (coherent star/cycle reindexing rule), then spare slots so all three
  // spheres exist. Runs at load and again after every Cross Wall flop (the
  // crossed chamber's short pairs change; the attachment POINTS do not).
  function fillExtMap() {
    for (let k = 0; k < 3; k++) extMap[k] = null;
    try {
      const probed = probeExteriorMap(beta, chamberShorts).map;
      // In dominant chambers every pair is parallel on the t = 0 exterior
      // stick, so the probe's margin test passes vacuously and the measured
      // map comes back with duplicate slots ([5,5,5]) — it cannot
      // distinguish the spheres (all three would highlight together and
      // share one size). Discard non-distinct measurements; the analytic
      // rule below (the coherent assignment, constant in every chamber)
      // then supplies the distinct map.
      const distinct =
        probed[0] !== probed[1] && probed[1] !== probed[2] && probed[0] !== probed[2];
      if (distinct) {
        for (let k = 0; k < 3; k++) extMap[k] = probed[k];
      }
    } catch (err) {
      // leave nulls; the fills below restore the spec's three spheres
    }
    if (!PERMUTE_23) {
      const analytic = starSlots(beta) || cycleSlots(beta);
      if (analytic) {
        for (let k = 0; k < 3; k++) if (extMap[k] === null) extMap[k] = analytic[k];
      }
    }
    const spareSlots = [];
    for (let s = 5; s <= 7; s++) if (extMap.indexOf(s) === -1) spareSlots.push(s);
    for (let k = 0; k < 3; k++) {
      if (extMap[k] === null && spareSlots.length > 0) extMap[k] = spareSlots.shift();
    }
  }
  fillExtMap();

  // Matrix readout (spec 13): the SOLVED representative (x: 2x4, y: 4x2,
  // complex entries) — the pair that satisfies the moment-map equations
  // after balancing, not the parameterization ansatz — centered above the
  // viewports and refreshed on every solve. The y readout shows the phi
  // action (updatePhiViews rotates it; see below).
  const matBox = document.createElement("div");
  matBox.className = "hp-panel";
  const matLabel = document.createElement("div");
  matLabel.className = "hp-sec-label";
  matLabel.textContent = "Solved pair";
  // tutorial button (task 24): floated right inside the matrix panel's
  // header — top-right "near the widget header", never gated
  const tutBtn = document.createElement("button");
  tutBtn.type = "button";
  tutBtn.className = "hp-btn";
  tutBtn.textContent = "Tutorial";
  tutBtn.style.float = "right";
  tutBtn.title = "guided introduction to the moduli-space widget";
  matBox.appendChild(matLabel);
  matBox.insertBefore(tutBtn, matLabel);
  const matRow = document.createElement("div");
  matRow.style.display = "flex";
  matRow.style.flexWrap = "wrap";
  matRow.style.justifyContent = "center";
  matRow.style.alignItems = "center";
  matRow.style.gap = "10px 26px";
  matBox.appendChild(matRow);
  container.appendChild(matBox);
  function makeMatrixView(label, rows, cols) {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "8px";
    const lab = document.createElement("span");
    lab.textContent = label;
    lab.style.color = "var(--hp-box-tx)";
    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(" + cols + ", auto)";
    grid.style.columnGap = "14px";
    grid.style.rowGap = "2px";
    grid.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    grid.style.fontSize = "0.78em";
    grid.style.fontVariantNumeric = "tabular-nums";
    const cells = [];
    for (let i = 0; i < rows * cols; i++) {
      const c = document.createElement("span");
      c.style.textAlign = "right";
      c.style.whiteSpace = "nowrap";
      grid.appendChild(c);
      cells.push(c);
    }
    // large parentheses flanking the grid (user request 2026-09-15):
    // rounded left/right borders spanning the grid's full height draw the
    // big delimiters; no border color is set, so they inherit the entry
    // text color (currentColor) in both themes.
    function makeParen(left) {
      const p = document.createElement("div");
      p.style.alignSelf = "stretch";
      p.style.width = "9px";
      p.style.boxSizing = "border-box";
      p.style.borderTop = "2px solid";
      p.style.borderBottom = "2px solid";
      if (left) {
        p.style.borderLeft = "2px solid";
        p.style.borderTopLeftRadius = "11px";
        p.style.borderBottomLeftRadius = "11px";
      } else {
        p.style.borderRight = "2px solid";
        p.style.borderTopRightRadius = "11px";
        p.style.borderBottomRightRadius = "11px";
      }
      return p;
    }
    wrap.appendChild(lab);
    wrap.appendChild(makeParen(true));
    wrap.appendChild(grid);
    wrap.appendChild(makeParen(false));
    matRow.appendChild(wrap);
    return {
      set: (M) => {
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols; j++) cells[i * cols + j].textContent = fmtComplex(M[i][j]);
        }
      },
    };
  }
  function fmtComplex(z) {
    const d = 3;
    const eps = 0.5 * Math.pow(10, -d);
    const re = z[0];
    const im = z[1];
    if (Math.abs(im) < eps) return re.toFixed(d);
    return re.toFixed(d) + (im < 0 ? "\u2212" : "+") + Math.abs(im).toFixed(d) + "i";
  }
  const matX = makeMatrixView("x =", 2, 4);
  const matY = makeMatrixView("y =", 4, 2);

  // Two-column layout: left = the polygon view, its caption, the "Moduli
  // Coordinates" slider section and the SL(2,C) view; right = the moduli-
  // space side view and the Parameters card with the beta/chamber panel.
  // Both viewports share equal, square (1:1) dimensions; flex-wrap lets
  // narrow containers stack.
  const topFlex = document.createElement("div");
  topFlex.style.display = "flex";
  topFlex.style.flexWrap = "wrap";
  topFlex.style.alignItems = "flex-start";
  topFlex.style.gap = "12px";
  // spacing below the matrix-readout panel, matching the panels' 12px
  topFlex.style.marginTop = "12px";
  container.appendChild(topFlex);
  const leftCol = document.createElement("div");
  leftCol.style.flex = "1 1 340px";
  leftCol.style.minWidth = "300px";
  topFlex.appendChild(leftCol);
  const rightCol = document.createElement("div");
  rightCol.style.flex = "1 1 340px";
  rightCol.style.minWidth = "280px";
  topFlex.appendChild(rightCol);

  const canvasBox = document.createElement("div");
  canvasBox.className = "hp-frame";
  canvasBox.style.width = "100%";
  canvasBox.style.aspectRatio = "1 / 1";
  leftCol.appendChild(canvasBox);

  // Moduli Coordinates (2026-09-15): the four moduli sliders sectioned in
  // one box. The rows are (r, theta) first, (t, phi) second — the t and
  // theta positions swapped back per user request 2026-09-15. The sliders
  // are appended into these rows further down (makeSlider).
  const moduliBox = document.createElement("div");
  moduliBox.className = "hp-panel";
  leftCol.appendChild(moduliBox);
  const moduliLabel = document.createElement("div");
  moduliLabel.className = "hp-sec-label";
  moduliLabel.textContent = "Moduli Coordinates";
  moduliBox.appendChild(moduliLabel);
  const modRowRT = document.createElement("div");
  modRowRT.style.display = "flex";
  modRowRT.style.flexWrap = "wrap";
  modRowRT.style.gap = "6px 16px";
  moduliBox.appendChild(modRowRT);
  const modRowTG = document.createElement("div");
  modRowTG.style.display = "flex";
  modRowTG.style.flexWrap = "wrap";
  modRowTG.style.gap = "6px 16px";
  modRowTG.style.marginTop = "6px";
  moduliBox.appendChild(modRowTG);

  // moment-map residual readout (spec 15), moved BELOW the Moduli
  // Coordinates panel (user request 2026-09-15)
  const caption = document.createElement("div");
  caption.style.marginTop = "8px";
  caption.style.fontSize = "0.85em";
  leftCol.appendChild(caption);

  // Top-right overlay (task 1): the chamber's three short pairs, one row
  // per exterior sphere, each naming the two leg vectors that pair
  // indexes. A row turns yellow while its two vectors are parallel — at
  // the attachment point that pair is exactly the straight one, so the
  // list indexes the spheres.
  const pairList = document.createElement("div");
  pairList.className = "hp-pair-list";
  canvasBox.appendChild(pairList);
  const pairRows = [];
  for (let k = 0; k < 3; k++) {
    const row = document.createElement("div");
    row.className = "hp-pair-row";
    pairList.appendChild(row);
    pairRows.push(row);
  }
  // 1-based display subscripts (user request 2026-09-15): the UI names
  // legs 1..4 everywhere (v₁..v₄, β₁..β₄, subsets {1,4}, ...). The SOLVER
  // indexing stays 0-based — these strings only map display j -> leg j+1.
  const SUBS = ["\u2081", "\u2082", "\u2083", "\u2084"];
  // 1-based subset rendering for tooltips / chamber boxes / the stratum tag
  const fmtSet = (I) => "{" + I.map((n) => n + 1).join(",") + "}";
  // side label for displayed leg j: the leg VECTOR v_j (from pts[2j] to
  // pts[2j+2]), not the vertices — user correction 2026-09-14; the four
  // vectors are v1..v4 and the bend points stay unlabeled.
  const sideName = (j) => "v" + SUBS[j];
  function rebuildPairList() {
    for (let k = 0; k < 3; k++) {
      const S = extMap[k];
      const I = S !== null && S !== undefined ? chamberShorts[S] : null;
      if (!I || I.length !== 2) {
        pairRows[k].textContent = "\u2014";
        pairRows[k].classList.remove("hp-straight");
        pairRows[k].title = "short pair of exterior sphere " + (k + 1);
        continue;
      }
      pairRows[k].textContent = sideName(I[0]) + " \u2225 " + sideName(I[1]);
      pairRows[k].title = "short pair " + fmtSet(I);
    }
  }
  rebuildPairList();

  // side view (task list #5): the (r, theta, t) moduli portrait — central
  // sphere + three exterior spheres + the flow dot; sideview.js owns the
  // scene, this widget only feeds it slider state. It sits to the RIGHT of
  // the polygon view (2026-09-15), above the Parameters tab.
  const sideBox = document.createElement("div");
  sideBox.className = "hp-frame";
  sideBox.style.width = "100%";
  sideBox.style.aspectRatio = "1 / 1";
  rightCol.appendChild(sideBox);

  // Parameters card (spec 14): a flat panel matching the Moduli Coordinates
  // section — no collapsible container.
  const paramsCard = document.createElement("div");
  paramsCard.className = "hp-panel";
  const paramsLabel = document.createElement("div");
  paramsLabel.className = "hp-sec-label";
  paramsLabel.textContent = "Parameters";
  paramsCard.appendChild(paramsLabel);
  rightCol.appendChild(paramsCard);

  // SL(2,C) view (task 2): the real and imaginary parts of the traceless
  // central moment map polygon (mu_SL, 3 + 3 = 6 real dimensions), drawn
  // as two small three.js canvases inside one collapsible panel. Collapsed
  // by default; the summary toggles it. The phase phi (the slider under t)
  // acts on y itself (updatePhiViews) — the rotation of these polygons is
  // the byproduct; the su(2) polygon is unaffected.
  const slDetails = document.createElement("details");
  slDetails.className = "hp-panel";
  const slSummary = document.createElement("summary");
  slSummary.textContent = "show SL(2,\u2102) polygons";
  slSummary.className = "hp-sec-label";
  slSummary.style.cursor = "pointer";
  slDetails.appendChild(slSummary);
  const slRow = document.createElement("div");
  slRow.style.display = "flex";
  slRow.style.flexWrap = "wrap";
  slRow.style.gap = "10px";
  slDetails.appendChild(slRow);
  leftCol.appendChild(slDetails);

  const SL_SEG = 5; // 4 leg edges + the v4 -> v0 closing segment
  function makeSlView(tag) {
    const host = document.createElement("div");
    host.className = "hp-frame";
    host.style.flex = "1 1 300px";
    host.style.height = "300px";
    host.style.minWidth = "240px";
    slRow.appendChild(host);
    const tagEl = document.createElement("div");
    tagEl.textContent = tag;
    tagEl.style.position = "absolute";
    tagEl.style.top = "6px";
    tagEl.style.left = "8px";
    tagEl.style.fontSize = "0.8em";
    tagEl.style.color = "var(--hp-box-tx)";
    tagEl.style.pointerEvents = "none";
    host.appendChild(tagEl);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(1.3, 0.9, 1.6);
    camera.lookAt(0, 0, 0);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    const axExtent = 1.2;
    const axGeom = new THREE.BufferGeometry();
    axGeom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          -axExtent, 0, 0, axExtent, 0, 0,
          0, -axExtent, 0, 0, axExtent, 0,
          0, 0, -axExtent, 0, 0, axExtent,
        ],
        3
      )
    );
    const axMat = new THREE.LineBasicMaterial({ color: 0xb0b0b0 });
    scene.add(new THREE.LineSegments(axGeom, axMat));

    const pos = new Float32Array(SL_SEG * 2 * 3);
    const col = new Float32Array(SL_SEG * 2 * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true });
    scene.add(new THREE.LineSegments(geom, mat));

    const markPos = new Float32Array(5 * 3);
    const markGeom = new THREE.BufferGeometry();
    markGeom.setAttribute("position", new THREE.BufferAttribute(markPos, 3));
    const markMat = new THREE.PointsMaterial({ size: 4, sizeAttenuation: false });
    scene.add(new THREE.Points(markGeom, markMat));

    function resize() {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(host);
    resize();

    return {
      host: host,
      renderer: renderer,
      scene: scene,
      camera: camera,
      controls: controls,
      axMat: axMat,
      markMat: markMat,
      pos: pos,
      col: col,
      geom: geom,
      markPos: markPos,
      markGeom: markGeom,
      setBorder: (c) => {
        host.style.borderColor = c;
      },
    };
  }
  const slRe = makeSlView("Re \u03bc\u209b\u2097");
  const slIm = makeSlView("Im \u03bc\u209b\u2097");
  // phi = 0 base data from the last solve: sl2Base = res.sl2 (the SL(2,C)
  // polygon) and solvedY = res.y (the solved pair's y matrix). The phi
  // slider acts on y ITSELF — y -> e^{i·phi} y, every entry scaled by the
  // unit complex number e^{i·phi} (user request 2026-09-15): the y matrix
  // readout shows the rotated entries, and because u_i = x_col_i · y_row_i
  // is linear in y, the SL(2,C) polygon rotates coordinatewise by
  // e^{i·phi} as a BYPRODUCT — the old "rotate the polygons directly"
  // display hack is gone. The su(2) polygon is untouched (|y|^2 and y†y
  // are phase-invariant) and the moment-map residuals are unchanged. At
  // phi = 0 the rotation is bit-exact (cos 0 = 1, sin 0 = 0).
  let sl2Base = null;
  let solvedY = null;
  const SL_SEG_ENDS = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 0],
  ];
  // Apply the current phi to the two things it acts on: the y matrix
  // readout (entrywise rotation by e^{i·phi}) and the SL(2,C) canvases
  // (the byproduct). Never triggers a solver run.
  function updatePhiViews() {
    const g = parseFloat(phiInput.value) * Math.PI;
    const c = Math.cos(g);
    const s = Math.sin(g);
    if (solvedY) {
      matY.set(
        solvedY.map((row) =>
          row.map((z) => [c * z[0] - s * z[1], s * z[0] + c * z[1]])
        )
      );
    }
    if (!sl2Base) return;
    for (let vi = 0; vi < 2; vi++) {
      const view = vi === 0 ? slRe : slIm;
      const isIm = vi === 1;
      for (let k = 0; k < 5; k++) {
        for (let j = 0; j < 3; j++) {
          const re = sl2Base.real[k][j];
          const im = sl2Base.imag[k][j];
          view.markPos[k * 3 + j] = isIm ? s * re + c * im : c * re - s * im;
        }
      }
      for (let si = 0; si < SL_SEG; si++) {
        for (let e = 0; e < 2; e++) {
          const k = SL_SEG_ENDS[si][e];
          const idx = (si * 2 + e) * 3;
          view.pos[idx] = view.markPos[k * 3];
          view.pos[idx + 1] = view.markPos[k * 3 + 1];
          view.pos[idx + 2] = view.markPos[k * 3 + 2];
        }
      }
      view.geom.attributes.position.needsUpdate = true;
      view.geom.computeBoundingSphere();
      view.markGeom.attributes.position.needsUpdate = true;
      view.markGeom.computeBoundingSphere();
    }
  }

  // Chamber content (task 2 + spec 14): the beta sliders, their scale
  // buttons and the chamber inequalities live directly in the flat
  // Parameters card (alias `panel` below) — no nested box, no collapse.
  const panel = paramsCard;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  canvasBox.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(1.6, 1.1, 1.9);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);

  const axisExtent = 1.2;
  const axesGeom = new THREE.BufferGeometry();
  axesGeom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -axisExtent, 0, 0, axisExtent, 0, 0,
        0, -axisExtent, 0, 0, axisExtent, 0,
        0, 0, -axisExtent, 0, 0, axisExtent,
      ],
      3
    )
  );
  const axesMat = new THREE.LineBasicMaterial({ color: 0xb0b0b0 });
  scene.add(new THREE.LineSegments(axesGeom, axesMat));

  // the polygon lives in its own group so the display orientation can be
  // re-aligned every frame without touching the world-fixed axes
  const polyGroup = new THREE.Group();
  scene.add(polyGroup);

  // Polygon edges (task 4, 2026-09-15; spec 5 update): WebGL ignores
  // LineBasicMaterial's linewidth, so each of the 8 segments is a unit
  // cylinder mesh. The thickness is DECOUPLED from the polygon's own
  // scale: the radius is recomputed every frame so the stroke stays a
  // fixed fraction of the viewport height at the current camera zoom
  // (perspective: world height at the orbit target = 2*dist*tan(fov/2)),
  // keeping the edges clearly visible at every zoom level.
  const EDGE_SCREEN_FRAC = 0.0035;
  let edgeRad = 0.01;
  const edgeGeomUnit = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
  const edgeMeshes = [];
  const segBase = [];
  for (let seg = 0; seg < 8; seg++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const m = new THREE.Mesh(edgeGeomUnit, mat);
    m.visible = false;
    polyGroup.add(m);
    edgeMeshes.push(m);
    segBase.push(new THREE.Color(1, 1, 1));
  }
  const edgeUp = new THREE.Vector3(0, 1, 0);
  const edgeDir = new THREE.Vector3();
  function setSegment(seg, a, b) {
    const m = edgeMeshes[seg];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) {
      m.visible = false;
      return;
    }
    m.visible = true;
    m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    m.scale.set(edgeRad, len, edgeRad);
    edgeDir.set(dx / len, dy / len, dz / len);
    m.quaternion.setFromUnitVectors(edgeUp, edgeDir);
  }
  function updateEdgeRadii() {
    const dist = camera.position.distanceTo(controls.target);
    edgeRad = 2 * dist * Math.tan((camera.fov * Math.PI) / 360) * EDGE_SCREEN_FRAC;
    for (let s = 0; s < 8; s++) {
      if (!edgeMeshes[s].visible) continue;
      edgeMeshes[s].scale.x = edgeRad;
      edgeMeshes[s].scale.z = edgeRad;
    }
  }

  const markPos = new Float32Array(9 * 3);
  const markGeom = new THREE.BufferGeometry();
  markGeom.setAttribute("position", new THREE.BufferAttribute(markPos, 3));
  const markMat = new THREE.PointsMaterial({ size: 4, sizeAttenuation: false });
  polyGroup.add(new THREE.Points(markGeom, markMat));

  // Edge labels (task 1): one sprite per displayed leg, drawn into a
  // canvas texture (crisp at any zoom, theme-colored via applyColors).
  // The sprite sits at the midpoint of the leg segment and names the leg
  // VECTOR v_j (j = 0..3); like the cylinder edges, its size tracks the
  // camera zoom (LABEL_SCREEN_FRAC of the viewport height, recomputed
  // every frame in updateLabelScales) so it neither grows with the
  // polygon as t gets large nor fades when the user zooms out. The bend
  // points stay unlabeled.
  const sideLabelSprites = [];
  function drawLabelTexture(sp, text, colorCss) {
    const pad = 14;
    const fontPx = 44;
    const fontSpec = fontPx + "px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    const cnv = document.createElement("canvas");
    let ctx = cnv.getContext("2d");
    ctx.font = fontSpec;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const h = fontPx + pad * 2;
    cnv.width = w;
    cnv.height = h;
    ctx = cnv.getContext("2d");
    ctx.font = fontSpec;
    ctx.fillStyle = colorCss;
    ctx.textBaseline = "middle";
    ctx.fillText(text, pad, h / 2);
    const tex = new THREE.CanvasTexture(cnv);
    tex.minFilter = THREE.LinearFilter;
    if (sp.material.map) sp.material.map.dispose();
    sp.material.map = tex;
    sp.material.needsUpdate = true;
    sp.userData.aspect = w / h;
  }

  const orientor = makeOrientor();
  let lastVerts = null;
  // last solved branch (0 = pipeline, 1 = I-stratum): crossing between the
  // two charts is where the display needs gauge alignment + morph
  let lastBranch = -1;
  // active entry/exit morph: { from, to, sl2From, sl2To, start } — the
  // polygon buffers play a short blend from the previously displayed
  // geometry to the aligned target instead of teleporting
  let morph = null;
  let lastInput = -1e9;
  let lastFrame = performance.now();
  // side-view scene; created below (applyColors refreshes its theme too)
  const sideView = makeSideView(sideBox, { getPalette: palette });

  for (let i = 0; i < 4; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
    sp.renderOrder = 10;
    polyGroup.add(sp);
    sideLabelSprites.push(sp);
    drawLabelTexture(sp, sideName(i), palette().caption);
  }

  // Label size (user request 2026-09-15): a fixed fraction of the viewport
  // height at the CURRENT camera distance — the same rule as the cylinder
  // edges (perspective: world height at the orbit target =
  // 2*dist*tan(fov/2)) — so zooming rescales labels exactly like the
  // edges, while the polygon's own scale (t -> infinity) does not.
  const LABEL_SCREEN_FRAC = 0.03;
  function updateLabelScales() {
    const dist = camera.position.distanceTo(controls.target);
    const labelScale = 2 * dist * Math.tan((camera.fov * Math.PI) / 360) * LABEL_SCREEN_FRAC;
    for (let i = 0; i < 4; i++) {
      const sp = sideLabelSprites[i];
      const asp = sp.userData.aspect || 3;
      sp.scale.set(labelScale * asp, labelScale, 1);
      sp.visible = !!lastVerts && labelScale > 1e-4;
    }
  }

  // Task 1 parallel-pair state. legSine[p] is the sine of the angle
  // between the v-side directions of LEG_PAIRS[p] (zero = parallel);
  // threshold matches sideview.js's probe tolerance. A pair entering
  // parallelism fires ONE yellow blink (a smooth in-and-out pulse over
  // BLINK_PERIOD seconds, played in the render loop); while a pair stays
  // parallel (the straight pair at an attachment snap) both v-sides hold
  // solid yellow.
  const LEG_PAIRS = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3],
  ];
  // alias of sideview.js's PARALLEL_TOL (imported): the polygon view's
  // straight-pair highlight and the side view's attachment-pair probe must
  // never disagree about which pair is straight
  const PAIR_SINE_TOL = PARALLEL_TOL;
  const BLINK_PERIOD = 0.9;
  const legSine = new Array(6).fill(Infinity);
  const legParallel = new Array(6).fill(false);
  let blinkPair = -1;
  let blinkStart = -1e9;
  // base edge colors for the blink lerp (recomputed from the palette in
  // applyColors, matched against the solver's segment order)
  const yellowCol = new THREE.Color();
  function legPairIndex(a, b) {
    for (let p = 0; p < 6; p++) {
      if (LEG_PAIRS[p][0] === a && LEG_PAIRS[p][1] === b) return p;
    }
    return -1;
  }
  // per-frame yellow overrides on the edge materials (base colors were
  // written into segBase by applyColors)
  function updateEdgeColors(now) {
    const fSeg = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let p = 0; p < 6; p++) {
      let f = 0;
      if (legParallel[p]) {
        f = 1;
      } else if (p === blinkPair) {
        const ph = (now - blinkStart) / BLINK_PERIOD;
        if (ph >= 0 && ph < 1) f = Math.sin(Math.PI * ph);
        else blinkPair = -1;
      }
      if (f > fSeg[2 * LEG_PAIRS[p][0]]) fSeg[2 * LEG_PAIRS[p][0]] = f;
      if (f > fSeg[2 * LEG_PAIRS[p][1]]) fSeg[2 * LEG_PAIRS[p][1]] = f;
    }
    for (let s = 0; s < 8; s++) {
      edgeMeshes[s].material.color.copy(segBase[s]).lerp(yellowCol, fSeg[s]);
    }
  }

  const colA = new THREE.Color();
  const colB = new THREE.Color();
  const grayCol = new THREE.Color();

  function applyColors() {
    const pal = palette();
    axesMat.color.setHex(pal.axes);
    markMat.color.setHex(pal.markers);
    colA.setHex(pal.edgeA);
    colB.setHex(pal.edgeB);
    yellowCol.setHex(pal.edgeYellow);
    grayCol.setHex(pal.markers);
    for (let seg = 0; seg < 8; seg++) {
      segBase[seg].copy(seg % 2 === 0 ? colA : colB);
    }
    canvasBox.style.borderColor = pal.border;
    caption.style.color = pal.caption;
    chamberLabel.style.color = pal.caption;
    // edge-label sprites: redraw the textures in the theme color
    for (let i = 0; i < sideLabelSprites.length; i++) {
      drawLabelTexture(sideLabelSprites[i], sideName(i), pal.caption);
    }
    // SL(2,C) views (task 2): leg-colored edges, closing segment gray
    for (const view of [slRe, slIm]) {
      view.axMat.color.setHex(pal.axes);
      view.markMat.color.setHex(pal.markers);
      for (let si = 0; si < SL_SEG; si++) {
        const c = si < 4 ? (si % 2 === 0 ? colA : colB) : grayCol;
        for (let k = 0; k < 2; k++) {
          const idx = (si * 2 + k) * 3;
          view.col[idx] = c.r;
          view.col[idx + 1] = c.g;
          view.col[idx + 2] = c.b;
        }
      }
      view.geom.attributes.color.needsUpdate = true;
      view.setBorder(pal.border);
    }
    if (sideView) sideView.refreshTheme();
  }

  // write the polygon geometry (edge cylinders, vertex markers, side-label
  // positions) from a 9-point vertex walk; called by solveAndDraw for a
  // direct write and by the per-frame morph step for the blend states
  function writePolygonGeometry(pts) {
    const scale = Math.max.apply(
      null,
      pts.map((p) => Math.hypot(p[0], p[1], p[2]))
    );
    for (let seg = 0; seg < 8; seg++) setSegment(seg, pts[seg], pts[seg + 1]);
    for (let i = 0; i < 9; i++) {
      markPos[i * 3] = pts[i][0];
      markPos[i * 3 + 1] = pts[i][1];
      markPos[i * 3 + 2] = pts[i][2];
    }
    markGeom.attributes.position.needsUpdate = true;
    // Task 1: edge labels at the side midpoints, pushed away from the
    // polygon centroid (their SIZE is set per frame in updateLabelScales)
    let cen = [0, 0, 0];
    for (let i = 0; i < 9; i++) {
      cen[0] += pts[i][0];
      cen[1] += pts[i][1];
      cen[2] += pts[i][2];
    }
    cen = [cen[0] / 9, cen[1] / 9, cen[2] / 9];
    for (let i = 0; i < 4; i++) {
      const sp = sideLabelSprites[i];
      const mx = (pts[2 * i][0] + pts[2 * i + 2][0]) / 2;
      const my = (pts[2 * i][1] + pts[2 * i + 2][1]) / 2;
      const mz = (pts[2 * i][2] + pts[2 * i + 2][2]) / 2;
      let dx = mx - cen[0];
      let dy = my - cen[1];
      let dz = mz - cen[2];
      const dn = Math.hypot(dx, dy, dz);
      if (dn > 1e-9 * scale) {
        const push = 0.06 * scale / dn;
        sp.position.set(mx + dx * push, my + dy * push, mz + dz * push);
      } else {
        sp.position.set(mx, my, mz);
      }
    }
  }

  // blend of the two 9-point walks / SL(2,C) polygons at morph weight e
  function morphBlend(e) {
    const verts = morph.from.map((p, k) => [
      p[0] + (morph.to[k][0] - p[0]) * e,
      p[1] + (morph.to[k][1] - p[1]) * e,
      p[2] + (morph.to[k][2] - p[2]) * e,
    ]);
    const mix = (A, B) =>
      A.map((p, k) => [
        p[0] + (B[k][0] - p[0]) * e,
        p[1] + (B[k][1] - p[1]) * e,
        p[2] + (B[k][2] - p[2]) * e,
      ]);
    return {
      verts: verts,
      sl2: {
        real: mix(morph.sl2From.real, morph.sl2To.real),
        imag: mix(morph.sl2From.imag, morph.sl2To.imag),
      },
    };
  }

  // the currently displayed polygon state — the morph blend while an
  // entry/exit morph plays, otherwise the last committed solve (used when
  // a second branch switch lands mid-morph: the new morph starts from
  // what is on screen, not from the interrupted target)
  function displayedState() {
    if (!morph) return { verts: lastVerts, sl2: sl2Base };
    const s = Math.min(1, Math.max(0, (performance.now() - morph.start) / STRATUM_MORPH_MS));
    return morphBlend(s * s * (3 - 2 * s));
  }

  function solveAndDraw() {
    const r = parseFloat(rInput.value);
    const theta = parseFloat(thetaInput.value) * Math.PI;
    const t = Math.min(parseFloat(tInput.value), T_SOLVE_MAX);
    // Beta legs 2/3 permutation, gated on PERMUTE_23 (solver.js). When true:
    // solve with legs 2 and 3 pre-swapped and permute = true — makeHyperpolygon
    // returns the leg-2<->3-swapped pair, which then satisfies the moment map
    // equations for the user's beta even when beta2 != beta3 (the double swap
    // cancels in the display). When false (current setting): pass beta
    // unchanged and permute = false, so the returned pair IS the solved
    // representative for the user's beta. Either way the displayed polygon
    // leg j is user leg j; the two calls are identical when beta2 = beta3.
    const betaSolve = PERMUTE_23 ? [beta[0], beta[1], beta[3], beta[2]] : beta;
    let res = null;
    try {
      if (stratum) {
        // I-stratum solve: the doubly-straight closed form at (t, beta) —
        // the t slider IS the stratum parameter here (task 2, 2026-09-15).
        // The pair I is mapped through the same PERMUTE_23 pre-swap as the
        // pipeline path (solve indexing), and stratumPair's permute
        // argument applies the matching output swap so the displayed leg
        // j is user leg j under either flag setting.
        const t1c = Math.min(Math.max(parseFloat(tInput.value), 0), T_SOLVE_MAX);
        const ISolve = PERMUTE_23 ? stratum.I.map((u) => PERM[u]) : stratum.I;
        res = stratumPair(t1c, betaSolve, ISolve, PERMUTE_23);
      } else {
        res = makeHyperpolygon(r, theta, t, betaSolve, PERMUTE_23);
      }
    } catch (err) {
      res = null;
    }
    if (!res || !Number.isFinite(res.accuracy.su2Norm)) {
      caption.textContent = "⚠ solver failed at this parameter point";
      return;
    }
    // Branch-switch alignment (stratum entry/exit, user request 2026-09-15):
    // the pipeline and I-stratum charts differ by the residual U(2) gauge —
    // measured entry jumps 1e-3..1.3e-2 clean but 0.45..0.8 at the north
    // sphere of cycle chambers (the stratum normal form puts the stick on
    // the other axis — pure gauge) and 1.0..1.6 at the equator-locus class.
    // Kabsch-align the new polygon onto the displayed one, apply the SU(2)
    // lift to the PAIR (x -> g x, y -> y g^dagger — unitary, moment maps
    // invariant, so the rotated pair is an equally valid solved
    // representative and the matrix readout stays consistent) and recompute
    // both polygon outputs from it. The remaining intrinsic change (the
    // exit pop, the crossover-class entry) is played as a short morph.
    const branch = stratum ? 1 : 0;
    const switched = lastVerts !== null && branch !== lastBranch;
    let pts = res.vertices;
    let sl2 = res.sl2;
    if (switched) {
      const ka = kabschRotation(pts, lastVerts);
      if (ka.q) {
        const rotated = rotatePair(res.x, res.y, liftSU2(ka.q));
        pts = hyperpolygonVertices(rotated[0], rotated[1]);
        sl2 = sl2Vertices(rotated[0], rotated[1]);
        res = {
          x: rotated[0],
          y: rotated[1],
          vertices: pts,
          sl2: sl2,
          accuracy: res.accuracy,
        };
      }
    }
    // capture the displayed state BEFORE any state updates (a second
    // branch switch mid-morph starts its blend from what is on screen)
    const prevDisplayed = displayedState();
    lastVerts = pts;
    if (switched) {
      // start (or re-target) the entry/exit morph from the CURRENTLY
      // displayed state — the polygon buffers keep playing the blend (the
      // per-frame morph step in loop() writes them from here on)
      morph = {
        from: prevDisplayed.verts,
        to: pts,
        sl2From: prevDisplayed.sl2,
        sl2To: sl2,
        start: performance.now(),
      };
    } else {
      morph = null;
      writePolygonGeometry(pts);
    }
    applyColors();
    // Spec 13: the live matrix readout shows the solved representative
    // (balanced, moment-map satisfying); updatePhiViews below writes the
    // y half, rotated by the current phi
    matX.set(res.x);

    // Task 1: v-side parallelism. Each displayed leg's v-side direction
    // is the segment (pts[2j], pts[2j+1]); two legs are parallel when the
    // sine of the angle between their directions is ~0. Entering
    // parallelism fires one yellow blink; staying parallel (the straight
    // pair at an attachment snap) holds both v-sides solid yellow, and
    // the matching row in the top-right short-pair list highlights.
    const dirs = [];
    for (let j = 0; j < 4; j++) {
      dirs.push([
        pts[2 * j + 1][0] - pts[2 * j][0],
        pts[2 * j + 1][1] - pts[2 * j][1],
        pts[2 * j + 1][2] - pts[2 * j][2],
      ]);
    }
    const nowSolve = performance.now();
    for (let p = 0; p < 6; p++) {
      const u = dirs[LEG_PAIRS[p][0]];
      const v = dirs[LEG_PAIRS[p][1]];
      const nu = Math.hypot(u[0], u[1], u[2]);
      const nv = Math.hypot(v[0], v[1], v[2]);
      const cr = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const sine =
        nu < 1e-12 || nv < 1e-12
          ? Infinity
          : Math.hypot(cr[0], cr[1], cr[2]) / (nu * nv);
      if (sine < PAIR_SINE_TOL && !legParallel[p]) {
        blinkPair = p;
        blinkStart = nowSolve;
      }
      legSine[p] = sine;
      legParallel[p] = sine < PAIR_SINE_TOL;
    }
    for (let k = 0; k < 3; k++) {
      const S = extMap[k];
      const I = S !== null && S !== undefined ? chamberShorts[S] : null;
      let straight = false;
      if (I && I.length === 2) {
        const p = legPairIndex(Math.min(I[0], I[1]), Math.max(I[0], I[1]));
        straight = p >= 0 && legParallel[p];
      }
      pairRows[k].classList.toggle("hp-straight", straight);
    }

    // Task 2/3: phi base data — the solved y (the phase acts on it) and
    // the SL(2,C) polygon; updatePhiViews applies the current phi to the
    // y readout and (as the byproduct) the SL canvases
    solvedY = res.y;
    sl2Base = res.sl2;
    updatePhiViews();
    // Spec 15: a single scalar — the L2 norm of the real moment map
    // residuals (the 3 su(2) components + the 4 per-leg U(1) components),
    // computed from the solved representative. The closure readout is gone.
    const muRes = momentResidual(res.x, res.y, beta);
    let text = "Moment map residuals " + muRes.toExponential(1);
    // (The former "· I-stratum … ∥ …" tag was removed 2026-09-16 — the
    // stratum state is clear from the mode button and the side view.)
    if (
      !Number.isFinite(muRes) ||
      res.accuracy.su2Norm > 1e-6 ||
      res.accuracy.muU1Error > 1e-6
    ) {
      text += " · ⚠ degraded";
    }
    caption.textContent = text;
    lastBranch = branch;
  }

  let pending = true;
  function scheduleSolve() {
    lastInput = performance.now();
    pending = true;
  }

  function makeSlider(label, min, max, step, value, format, snaps = [], noSolve = false, row = null) {
    const box = document.createElement("div");
    box.style.display = "flex";
    box.style.alignItems = "center";
    box.style.gap = "8px";
    box.style.flex = "1 1 220px";
    box.style.minWidth = "200px";
    const lab = document.createElement("span");
    lab.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.className = "hp-slider";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.flex = "1 1 auto";
    input.style.minWidth = "120px";
    const readout = document.createElement("span");
    readout.style.minWidth = "4.5em";
    readout.style.textAlign = "right";
    readout.style.fontVariantNumeric = "tabular-nums";
    const updateReadout = () => {
      readout.textContent = format(parseFloat(input.value));
    };
    updateReadout();
    input.addEventListener("input", () => {
      let v = parseFloat(input.value);
      for (const snap of snaps) {
        if (Math.abs(v - snap.value) <= snap.tol) {
          input.value = snap.value;
          v = snap.value;
          break;
        }
      }
      updateReadout();
      // noSolve sliders (phi) drive only display-side updates — they
      // must never trigger a solver run (rescue paths can cost 100 ms)
      if (!noSolve) scheduleSolve();
    });
    box.appendChild(lab);
    box.appendChild(input);
    box.appendChild(readout);
    (row || modRowRT).appendChild(box);
    return input;
  }

  // Spec 8: r snaps magnetically at the poles r = 0 and r = 1 (tol 0.05 =
  // 10 slider steps — the attachment points of the exterior spheres) in
  // addition to the equator snap at 0.5.
  // r starts at 0.25 (user request 2026-09-16): a generic interior point —
  // off the (0, 0.5, 1) attachment snaps and off the (1/2, 0) locus
  const rInput = makeSlider("r", 0, 1, 0.005, 0.25, (v) => v.toFixed(3), [
    { value: 0, tol: 0.05 },
    { value: 0.5, tol: 0.02 },
    { value: 1, tol: 0.05 },
  ], false, modRowRT);
  const thetaInput = makeSlider(
    "\u03b8",
    -1,
    1,
    0.005,
    0,
    (v) => (v >= 1 ? "\u03c0" : v <= -1 ? "-\u03c0" : (v * Math.PI).toFixed(2)),
    [{ value: 0, tol: 0.03 }],
    false,
    modRowRT
  );
  // t is DUAL-PURPOSE (2026-09-15, task 2): on the central sphere it is the
  // usual flow parameter (readout t/(1-t)); after the "lim t→∞" click it
  // parameterizes the I-stratum (0 = the tip slice, growing t lifts the
  // remaining rows) — entering the stratum jumps it to 0, leaving jumps it
  // back to infinity (1; the readout shows ∞ and the button says the rest).
  const tInput = makeSlider(
    "t",
    0,
    1,
    0.01,
    0,
    (v) => (v >= 1 ? "\u221e" : (v / (1 - v)).toFixed(2)),
    [],
    false,
    modRowTG
  );
  tInput.title =
    "flow parameter t (readout t/(1-t)); after lim t\u2192\u221e it drives the I-stratum (0 = tip slice)";
  // stack the lim button BELOW the t slider (2026-09-15): wrap the slider
  // row in a column and put the button under it. tCol lives in the SECOND
  // moduli row (user request 2026-09-15: the screen positions of t and
  // theta are swapped back, so row 1 is (r, theta) and row 2 is (t, phi)).
  const tCol = document.createElement("div");
  tCol.style.display = "flex";
  tCol.style.flexDirection = "column";
  tCol.style.gap = "3px";
  tCol.style.flex = "1 1 220px";
  tCol.style.minWidth = "200px";
  tCol.appendChild(tInput.parentNode);
  tInput.parentNode.style.flex = "1 1 auto";
  // phi (the U(1) phase; renamed from gamma, 2026-09-15): y -> e^{i·phi} y,
  // every entry of the y matrix scaled by the unit complex number
  // e^{i·phi} (user request 2026-09-15 — it acts on y itself, visible in
  // the matrix readout; the SL(2,C) rotation is the byproduct). Moment-map
  // preserving: |y_i|^2 and y_i† y_i are phase-invariant, so the su(2)
  // polygon and the residuals are fixed. In the side view the same phi
  // rotates the dot along the level circles of the exterior spheres /
  // paraboloids; t = 0 points are fixed (attachment points and the apex
  // are on the rotation axes), matching the moduli picture. noSolve: this
  // is a display-side action on the SOLVED pair — never a solver run.
  const phiInput = makeSlider(
    "\u03c6",
    -1,
    1,
    0.005,
    0,
    (v) => (v >= 1 ? "\u03c0" : v <= -1 ? "-\u03c0" : (v * Math.PI).toFixed(2)),
    [{ value: 0, tol: 0.03 }],
    true,
    modRowTG
  );
  phiInput.title =
    "U(1) phase e\u2071\u03c6 acting on y itself \u2014 every entry of the y " +
    "matrix is scaled by the unit complex number e\u2071\u03c6 (watch the readout); " +
    "the side-view dot rides the level circles; t = 0 points are fixed";
  phiInput.addEventListener("input", () => {
    updatePhiViews();
    refreshSide();
  });
  // Row placement: row 1 = (r, theta) — the sliders' creation rows; row 2
  // = (t, phi) — but phiBox is created before tCol exists, so tCol is
  // inserted before it here (a move, not a swap: the t/theta screen swap
  // of spec 11 is reverted per user request 2026-09-15, and the former
  // swap block — with its phiInput TDZ hazard — is gone).
  modRowTG.insertBefore(tCol, phiInput.parentNode);

  // I-stratum mode (the "lim t→∞" click, task 2 rework 2026-09-15): while
  // active, the r/θ sliders are parked and disabled at the attachment
  // point, the SOLVE comes from stratumPair (the doubly-straight closed
  // form), and the t slider itself drives the stratum family (the former
  // t₁ slider is gone): t = 0 is the tip slice (only the short pair's y
  // rows nonzero), growing t lifts the remaining rows (M = M0 (1 + t/(1-t))).
  let stratum = null; // { k, S, I, comp } while active
  let rBeforeStratum = null;
  let thetaBeforeStratum = null;

  // "lim t→∞": while the dot is on an exterior sphere near the t -> infinity
  // end (flowState.nearInfinity — the exact exterior branch at t >= 0.9, or
  // a captured central branch within CAP_NEAR_INF_W of the attachment) the
  // button enters the I-stratum of that sphere's short pair: r/θ park at
  // the attachment, the t slider jumps to 0 (the tip slice) and becomes the
  // stratum parameter, the solve switches to stratumPair, and the side view
  // draws the stratum paraboloid at the sphere's tip (highlight-white).
  // Clicking again leaves: the t slider jumps back to infinity (1).
  const limBtn = document.createElement("button");
  limBtn.type = "button";
  limBtn.className = "hp-btn";
  limBtn.textContent = "lim t\u2192\u221e";
  limBtn.style.display = "none";
  limBtn.style.alignSelf = "flex-start";
  limBtn.title = "enter the I-stratum (the tip of this exterior sphere)";
  tCol.appendChild(limBtn);
  // last flow state from the side view (refreshSide) — the captured
  // central branch names its attachment for the stratum entry
  let lastSideState = null;
  function attachmentIndexOfDot() {
    if (lastSideState && lastSideState.capture && lastSideState.capture.w >= CAP_NEAR_INF_W) {
      return lastSideState.capture.k;
    }
    const r = parseFloat(rInput.value);
    const theta = parseFloat(thetaInput.value) * Math.PI;
    for (let k = 0; k < 3; k++) {
      if (extMap[k] === null || extMap[k] === undefined) continue;
      if (Math.abs(r - attachmentRs[k]) > 1e-9) continue;
      if (k === 1 && Math.abs(theta) > 1e-9) continue;
      return k;
    }
    return -1;
  }
  function enterStratum() {
    const k = attachmentIndexOfDot();
    if (k < 0) return;
    const S = extMap[k];
    const I = chamberShorts[S];
    if (!I || I.length !== 2) return;
    const comp = [0, 1, 2, 3].filter((n) => I.indexOf(n) === -1);
    rBeforeStratum = parseFloat(rInput.value);
    thetaBeforeStratum = k === 1 ? parseFloat(thetaInput.value) : null;
    stratum = { k: k, S: S, I: I, comp: comp };
    rInput.disabled = true;
    thetaInput.disabled = true;
    // park exactly on the attachment (the stratum branch gate) — the
    // button can fire from inside the capture band, slightly off the point
    // (the input dispatch keeps the readouts in sync with the parked
    // values; the r/theta snaps are no-ops on the parked/restored numbers)
    rInput.value = String(attachmentRs[k]);
    rInput.dispatchEvent(new Event("input"));
    if (k === 1) thetaInput.value = "0";
    if (k === 1) thetaInput.dispatchEvent(new Event("input"));
    // task 2: the t slider jumps to position 0 = the tip slice
    tInput.value = "0";
    tInput.dispatchEvent(new Event("input"));
    // spec 3: consistent notation with the entry control — the inverse
    // limit t -> 0 is the stratum's tip slice
    limBtn.textContent = "lim t\u21920";
    limBtn.title = "leave the I-stratum (t jumps back to infinity on the exterior sphere)";
    scheduleSolve();
    refreshSide();
    hooks.onStratum.forEach((f) => f(true));
  }
  function leaveStratum() {
    stratum = null;
    rInput.disabled = false;
    thetaInput.disabled = false;
    if (rBeforeStratum !== null && Number.isFinite(rBeforeStratum)) {
      rInput.value = String(rBeforeStratum);
      rInput.dispatchEvent(new Event("input"));
    }
    if (thetaBeforeStratum !== null && Number.isFinite(thetaBeforeStratum)) {
      thetaInput.value = String(thetaBeforeStratum);
      thetaInput.dispatchEvent(new Event("input"));
    }
    // task 2: leaving jumps the t slider to infinity (1; readout ∞)
    tInput.value = "1";
    tInput.dispatchEvent(new Event("input"));
    limBtn.textContent = "lim t\u2192\u221e";
    limBtn.title = "enter the I-stratum (the tip of this exterior sphere)";
    scheduleSolve();
    refreshSide();
    hooks.onStratum.forEach((f) => f(false));
  }
  limBtn.addEventListener("click", () => {
    if (stratum) leaveStratum();
    else enterStratum();
  });

  // Side-view feed. Runs on the same cadence as the solve (pending block
  // in the loop) and immediately on t-slider hover (the paraboloid
  // preview must appear without a solve). The side view uses the RAW t
  // (1 allowed): the dot renders the t -> infinity LIMIT while the solve
  // keeps its own T_SOLVE_MAX clamp.
  let tHover = false;
  function refreshSide() {
    if (!sideView) return;
    const r = parseFloat(rInput.value);
    const theta = parseFloat(thetaInput.value) * Math.PI;
    const t = parseFloat(tInput.value);
    const phi = parseFloat(phiInput.value) * Math.PI;
    // in stratum mode the t slider IS the stratum parameter (task 2)
    const st = sideView.update(
      r,
      theta,
      t,
      beta,
      chamberShorts,
      extMap,
      tHover || t > 0,
      phi,
      stratum ? { k: stratum.k, t1: t } : null
    );
    lastSideState = st;
    // Button visibility (user request 2026-09-15): outside the stratum the
    // entry button ("lim t->infinity") shows near the t -> infinity end of
    // an exterior sphere (flowState's nearInfinity); inside the stratum the
    // exit button ("lim t->0") shows only when the t slider is near 0.
    const nearT0 = parseFloat(tInput.value) <= LIM_T0_BAND;
    limBtn.style.display = (stratum ? nearT0 : !!(st && st.nearInfinity)) ? "" : "none";
    hooks.onSide.forEach((f) => f(lastSideState));
  }
  function setTHover(on) {
    if (tHover === on) return;
    tHover = on;
    if (sideView) sideView.setHover(tHover);
    refreshSide();
  }
  tInput.addEventListener("mouseenter", () => setTHover(true));
  tInput.addEventListener("mouseleave", () => setTHover(false));
  tInput.addEventListener("focus", () => setTHover(true));
  tInput.addEventListener("blur", () => setTHover(false));

  // Spec 10: the instructional text is gone; in its place two
  // synchronized 1x1 plots — 2D slices of the parameter space in the
  // (beta0, beta1) and (beta2, beta3) planes, the other two coordinates
  // held fixed. The tracked chamber's seven wall equalities render as red
  // lines; the current parameter pair is the black dot. Both plots redraw
  // on every beta change (syncBetaSliders).
  const SUBSCRIPTS = SUBS; // 1-based display subscripts (shared with sideName)
  function cssVar(name) {
    return getComputedStyle(document.getElementById("hyperpolygon-widget"))
      .getPropertyValue(name)
      .trim();
  }
  // Cached theme colors for the slice-plot draw loop: getComputedStyle
  // reads force style recalcs, and the values only change on a theme
  // switch — which re-runs refreshPlotColors via the data-theme observer
  // (review fix 2026-09-15; light defaults keep the canvas sane if the
  // read lands before the styles resolve).
  let plotBoxBd = "#cfd4da";
  let plotWall = "#c0392b";
  function refreshPlotColors() {
    plotBoxBd = cssVar("--hp-box-bd");
    plotWall = cssVar("--hp-wall");
  }
  refreshPlotColors();
  const slicePlots = [];
  function makeSlicePlot(ix, iy) {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.alignItems = "center";
    wrap.style.gap = "1px";
    const cnv = document.createElement("canvas");
    const size = 110;
    cnv.style.width = size + "px";
    cnv.style.height = size + "px";
    cnv.style.display = "block";
    wrap.appendChild(cnv);
    const cap = document.createElement("div");
    cap.style.fontSize = "0.75em";
    cap.style.color = "var(--hp-box-tx)";
    cap.textContent = "\u03b2" + SUBSCRIPTS[ix] + ", \u03b2" + SUBSCRIPTS[iy];
    wrap.appendChild(cap);
    sliceRow.appendChild(wrap);
    const PAD = 7;
    const toPx = (u) => PAD + u * (size - 2 * PAD);
    const toPy = (v) => size - PAD - v * (size - 2 * PAD);
    function draw() {
      const dpr = window.devicePixelRatio || 1;
      if (cnv.width !== Math.round(size * dpr)) {
        cnv.width = Math.round(size * dpr);
        cnv.height = Math.round(size * dpr);
      }
      const ctx = cnv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = plotBoxBd;
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD + 0.5, PAD + 0.5, size - 2 * PAD - 1, size - 2 * PAD - 1);
      // the fixed coordinates of this slice
      const others = [];
      for (let n = 0; n < 4; n++) if (n !== ix && n !== iy) others.push(n);
      // wall lines: 2*sum_I = total  ->  a*u + b*v + c = 0 with u = beta_ix,
      // v = beta_iy and the other two coordinates fixed
      ctx.strokeStyle = plotWall;
      ctx.lineWidth = 1.5;
      for (let k = 1; k < chamberShorts.length; k++) {
        const I = chamberShorts[k];
        const a = 2 * (I.indexOf(ix) !== -1 ? 1 : 0) - 1;
        const b = 2 * (I.indexOf(iy) !== -1 ? 1 : 0) - 1;
        let sumIf = 0;
        for (let m = 0; m < I.length; m++) {
          if (I[m] !== ix && I[m] !== iy) sumIf += beta[I[m]];
        }
        const c = 2 * sumIf - (beta[others[0]] + beta[others[1]]);
        if (a === 0 && b === 0) continue;
        const pts = [];
        if (Math.abs(b) > 1e-12) {
          const v0 = -c / b;
          const v1 = -(c + a) / b;
          if (v0 >= -1e-9 && v0 <= 1 + 1e-9) pts.push([0, v0]);
          if (v1 >= -1e-9 && v1 <= 1 + 1e-9) pts.push([1, v1]);
        }
        if (Math.abs(a) > 1e-12) {
          const u0 = -c / a;
          const u1 = -(c + b) / a;
          if (u0 >= -1e-9 && u0 <= 1 + 1e-9) pts.push([u0, 0]);
          if (u1 >= -1e-9 && u1 <= 1 + 1e-9) pts.push([u1, 1]);
        }
        if (pts.length < 2) continue;
        const p0 = pts[0];
        const p1 = pts[pts.length - 1];
        ctx.beginPath();
        ctx.moveTo(toPx(p0[0]), toPy(p0[1]));
        ctx.lineTo(toPx(p1[0]), toPy(p1[1]));
        ctx.stroke();
      }
      // the active parameter pair
      ctx.fillStyle = "#000000";
      ctx.strokeStyle = plotBoxBd;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(toPx(beta[ix]), toPy(beta[iy]), 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
    const plot = { draw: draw, wrap: wrap };
    slicePlots.push(plot);
    return plot;
  }
  const sliceRow = document.createElement("div");
  sliceRow.style.flex = "1 1 100%";
  sliceRow.style.display = "flex";
  sliceRow.style.gap = "18px";
  sliceRow.style.justifyContent = "center";
  panel.appendChild(sliceRow);
  // the (beta_1, beta_2) and (beta_3, beta_4) plane plots; their placement
  // over the matching slider pairs is set in pickBetaColumns
  const plotA = makeSlicePlot(0, 1);
  const plotB = makeSlicePlot(2, 3);
  function drawSlicePlots() {
    for (let k = 0; k < slicePlots.length; k++) slicePlots[k].draw();
  }

  // dedicated beta-slider row: an explicit grid whose column count (4, 2
  // or 1) is picked from the measured width. A flex-wrap row with a
  // 170px basis produced a 3+1 orphan layout at some widths; an explicit
  // column count can never split 4 sliders unevenly, and the thresholds
  // (~190px per slider + gaps) guarantee nothing overflows.
  const betaRow = document.createElement("div");
  betaRow.style.flex = "1 1 100%";
  betaRow.style.display = "grid";
  betaRow.style.columnGap = "16px";
  betaRow.style.rowGap = "2px";
  betaRow.style.marginTop = "10px";
  panel.appendChild(betaRow);
  function pickBetaColumns() {
    const w = betaRow.clientWidth;
    const cols = w >= 700 ? 4 : w >= 340 ? 2 : 1;
    betaRow.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
    // Center each chamber-slice plot over its own slider pair (user
    // request 2026-09-16): the plots ride the SAME grid as the sliders.
    // At 4 columns the on-screen slider order is beta_1, beta_3, beta_2,
    // beta_4, so the (beta_1, beta_2) plot centers over the midpoint of
    // columns 1 and 3 (= the column-2 center, exact by symmetry) and the
    // (beta_3, beta_4) plot over the midpoint of columns 2 and 4 (the
    // column-3 center). At 2 columns each pair shares a column, so the
    // plots sit over columns 1 and 2. The 1-column layout falls back to
    // the centered row.
    const clearPlacement = (plot) => {
      plot.wrap.style.gridColumn = "";
      plot.wrap.style.gridRow = "";
      plot.wrap.style.justifySelf = "";
    };
    if (cols >= 2) {
      sliceRow.style.display = "grid";
      sliceRow.style.gap = "0px";
      sliceRow.style.columnGap = "16px";
      sliceRow.style.rowGap = "0px";
      sliceRow.style.justifyContent = "";
      sliceRow.style.gridTemplateColumns =
        "repeat(" + cols + ", minmax(0, 1fr))";
      if (cols === 4) {
        plotA.wrap.style.gridColumn = "1 / span 3";
        plotB.wrap.style.gridColumn = "2 / span 3";
      } else {
        plotA.wrap.style.gridColumn = "1";
        plotB.wrap.style.gridColumn = "2";
      }
      plotA.wrap.style.gridRow = "1";
      plotB.wrap.style.gridRow = "1";
      plotA.wrap.style.justifySelf = "center";
      plotB.wrap.style.justifySelf = "center";
    } else {
      sliceRow.style.display = "flex";
      sliceRow.style.gap = "18px";
      sliceRow.style.columnGap = "";
      sliceRow.style.rowGap = "";
      sliceRow.style.justifyContent = "center";
      sliceRow.style.gridTemplateColumns = "";
      clearPlacement(plotA);
      clearPlacement(plotB);
    }
  }
  new ResizeObserver(pickBetaColumns).observe(betaRow);

  const betaInputs = [];
  const betaReadouts = [];
  function makeBetaSlider(i) {
    const labels = ["\u03b2\u2081", "\u03b2\u2082", "\u03b2\u2083", "\u03b2\u2084"];
    const box = document.createElement("div");
    box.style.display = "flex";
    box.style.alignItems = "center";
    box.style.gap = "8px";
    box.style.minWidth = "0";
    const lab = document.createElement("span");
    lab.textContent = labels[i];
    const input = document.createElement("input");
    input.type = "range";
    input.className = "hp-slider";
    input.min = "0";
    input.max = "1";
    input.step = "any";
    input.value = String(beta[i]);
    input.style.flex = "1 1 auto";
    input.style.minWidth = "80px";
    const readout = document.createElement("span");
    readout.style.minWidth = "3.5em";
    readout.style.textAlign = "right";
    readout.style.fontVariantNumeric = "tabular-nums";
    readout.textContent = beta[i].toFixed(3);
    input.addEventListener("input", () => {
      const v = input.valueAsNumber;
      if (Number.isFinite(v)) {
        applyBetaDrag(i, beta, v, chamberShorts);
        syncBetaSliders();
        scheduleSolve();
      }
    });
    box.appendChild(lab);
    box.appendChild(input);
    box.appendChild(readout);
    betaRow.appendChild(box);
    betaInputs.push(input);
    betaReadouts.push(readout);
    return input;
  }

  function syncBetaSliders() {
    for (let i = 0; i < 4; i++) {
      const input = betaInputs[i];
      input.value = String(beta[i]);
      betaReadouts[i].textContent = beta[i].toFixed(3);
      // the allowed span runs exactly TO the chamber wall (wall contact
      // allowed, crossing not); chamberInterval never returns lo > hi
      const iv = chamberInterval(i, beta, chamberShorts);
      input.style.setProperty(
        "--hp-lo",
        (100 * Math.min(Math.max(iv.lo, 0), 1)).toFixed(4) + "%"
      );
      input.style.setProperty(
        "--hp-hi",
        (100 * Math.min(Math.max(iv.hi, 0), 1)).toFixed(4) + "%"
      );
    }
    drawSlicePlots();
    syncChamberBoxes();
  }

  for (let i = 0; i < 4; i++) {
    makeBetaSlider(i);
  }
  // user request 2026-09-15: the screen positions of the beta_1 and beta_2
  // sliders are swapped (labels stay with their values — the display order
  // becomes beta_0, beta_2, beta_1, beta_3). Moving the node keeps its
  // listeners.
  betaRow.insertBefore(betaInputs[1].parentNode, betaInputs[3].parentNode);

  // one box per tracked inequality (shortSubsets slot order, the trivial
  // split omitted); amber while its wall is touched, tooltip shows the
  // live subset sums. (The Scale β Down/Up buttons are GONE — user request
  // 2026-09-15; the beta sliders alone drive the tuple within the chamber.)
  const SUB = SUBS; // 1-based display subscripts (shared with sideName)
  const betaTerm = (I) =>
    I.length === 0 ? "0" : I.map((n) => "β" + SUB[n]).join("+");
  const chamberRow = document.createElement("div");
  chamberRow.style.flex = "1 1 100%";
  chamberRow.style.display = "flex";
  chamberRow.style.flexWrap = "wrap";
  chamberRow.style.alignItems = "center";
  chamberRow.style.gap = "6px";
  chamberRow.style.marginTop = "10px";
  const chamberLabel = document.createElement("span");
  chamberLabel.style.fontSize = "0.85em";
  chamberLabel.textContent = "Chamber inequalities:";
  chamberRow.appendChild(chamberLabel);
  const chamberBoxes = [];
  for (let k = 1; k < chamberShorts.length; k++) {
    const I = chamberShorts[k];
    const comp = [];
    for (let n = 0; n < 4; n++) if (I.indexOf(n) === -1) comp.push(n);
    const el = document.createElement("span");
    el.className = "hp-chamber-box";
    const text = document.createTextNode(fmtSet(I) + " < " + fmtSet(comp));
    el.appendChild(text);
    const crossBtn = document.createElement("button");
    crossBtn.type = "button";
    crossBtn.className = "hp-btn hp-cross-btn";
    crossBtn.textContent = "Cross Wall";
    crossBtn.style.display = "none";
    // k is captured per box (the shorts slot this box displays)
    crossBtn.addEventListener("click", () => crossWall(k));
    el.appendChild(crossBtn);
    chamberRow.appendChild(el);
    chamberBoxes.push({ I: I, el: el, text: text, btn: crossBtn, term: betaTerm(I), termC: betaTerm(comp) });
  }
  panel.appendChild(chamberRow);

  // refresh every box from chamberShorts (after a flop the slot's short
  // side is the complement, so label/terms must be rebuilt; the other
  // slots' subsets are unchanged by a single wall crossing but are
  // recomputed defensively)
  function rebuildChamberBoxes() {
    for (let k = 0; k < chamberBoxes.length; k++) {
      const rec = chamberBoxes[k];
      const I = chamberShorts[k + 1];
      const comp = [];
      for (let n = 0; n < 4; n++) if (I.indexOf(n) === -1) comp.push(n);
      rec.I = I;
      rec.term = betaTerm(I);
      rec.termC = betaTerm(comp);
      rec.text.nodeValue = fmtSet(I) + " < " + fmtSet(comp);
    }
  }

  function syncChamberBoxes() {
    const breaking = breakingSubsets(beta, chamberShorts);
    for (let k = 0; k < chamberBoxes.length; k++) {
      const rec = chamberBoxes[k];
      let sI = 0;
      for (let m = 0; m < rec.I.length; m++) sI += beta[rec.I[m]];
      let sC = 0;
      for (let n = 0; n < 4; n++) if (rec.I.indexOf(n) === -1) sC += beta[n];
      // breakingSubsets returns entries of chamberShorts and rec.I is
      // chamberShorts[k], so reference equality via indexOf is exact
      const isBreaking = breaking.indexOf(rec.I) !== -1;
      rec.el.classList.toggle("hp-breaking", isBreaking);
      rec.btn.style.display = isBreaking ? "" : "none";
      rec.el.title =
        rec.term + " = " + sI.toFixed(4) + " · " + rec.termC + " = " + sC.toFixed(4);
    }
  }

  // the Cross Wall action on box k: flop split k (chamberShorts[k] is
  // replaced by its complement — the tracked chamber moves to the one on
  // the other side of that wall) and re-sync. Spec 9: the beta sliders do
  // NOT jump away from the wall — the tuple stays pinned exactly against
  // the crossed wall (now the new chamber's boundary) and only the active
  // red boundary thresholds re-sync to the new chamber (syncBetaSliders).
  // The flopped box stays amber (the pinned wall is still at equality), so
  // crossing back — or dragging off the wall into the interior — both
  // remain available.
  function crossWall(k) {
    // a wall crossing can invalidate the stratum (the flopped split's
    // short side changes) — leave the stratum first
    if (stratum) leaveStratum();
    const I = chamberShorts[k];
    const comp = [];
    for (let n = 0; n < 4; n++) if (I.indexOf(n) === -1) comp.push(n);
    chamberShorts[k] = comp;
    // the exterior-sphere <-> short-pair correspondence is chamber-
    // dependent: re-probe the attachment map for the NEW chamber and
    // rebuild the top-right pair list (task 1)
    fillExtMap();
    rebuildPairList();
    rebuildChamberBoxes();
    syncBetaSliders();
    scheduleSolve();
    hooks.onCrossWall.forEach((f) => f(k));
  }

  // tutorial exit (task 24): restore the load-time chamber for the default
  // beta tuple (Cross Wall may have flopped chamberShorts; the chamber is
  // recomputed from the restored beta and every dependent display syncs)
  function resetChamber() {
    const sh = shortSubsets(beta);
    for (let k = 0; k < chamberShorts.length; k++) chamberShorts[k] = sh[k];
    fillExtMap();
    rebuildPairList();
    rebuildChamberBoxes();
    syncBetaSliders();
  }

  syncBetaSliders();

  // Control-gating registry (task 24, milestone 1): every interactive
  // control group registers with its interactive element(s); tutorial.js
  // drives the enable-set through setGate. enableSet === null means ALL
  // enabled (free play). Ordered TDZ-safely: every referenced symbol is
  // declared above this line.
  const gated = [
    { id: "r", els: [rInput, rInput.parentNode] },
    { id: "theta", els: [thetaInput, thetaInput.parentNode] },
    { id: "t", els: [tInput, tInput.parentNode] },
    { id: "phi", els: [phiInput, phiInput.parentNode] },
    { id: "beta0", els: [betaInputs[0], betaInputs[0].parentNode] },
    { id: "beta1", els: [betaInputs[1], betaInputs[1].parentNode] },
    { id: "beta2", els: [betaInputs[2], betaInputs[2].parentNode] },
    { id: "beta3", els: [betaInputs[3], betaInputs[3].parentNode] },
    { id: "lim", els: [limBtn] },
    { id: "sl", els: [slDetails] },
    { id: "cross", els: chamberBoxes.map((b) => b.btn) },
  ];
  let lastGateKey = null;
  let lastGateHilite = undefined;
  function setGate(enableSet, highlightId) {
    // cheap no-op when the gate state is unchanged (repeated calls from a
    // per-frame tick must not rewrite the DOM)
    const key =
      enableSet === null ? "ALL" : enableSet.slice().sort().join(",");
    if (key === lastGateKey && highlightId === lastGateHilite) return;
    lastGateKey = key;
    lastGateHilite = highlightId === undefined ? null : highlightId;
    for (let i = 0; i < gated.length; i++) {
      const g = gated[i];
      const on = enableSet === null || enableSet.indexOf(g.id) !== -1;
      for (let j = 0; j < g.els.length; j++) {
        const el = g.els[j];
        el.classList.toggle("hp-gated", !on);
        const tag = el.tagName;
        if (tag === "INPUT" || tag === "BUTTON" || tag === "SELECT") {
          el.disabled = !on;
        }
      }
    }
    for (let i = 0; i < gated.length; i++) {
      const g = gated[i];
      const h = g.id === lastGateHilite;
      for (let j = 0; j < g.els.length; j++) {
        g.els[j].classList.toggle("hp-tut-hilite", h && j === 0);
      }
    }
  }
  setGate(null, null);

  // Tutorial (task 24, milestone 1): instantiated ONLY on the button click
  // — nothing tutorial-related binds or renders before that. tutorial.js
  // owns the lesson state machine and the exit cleanup; the button toggles
  // enter/exit and is never gated.
  let tutorial = null;
  tutBtn.addEventListener("click", () => {
    if (tutorial) {
      tutorial.exit();
      tutorial = null;
      tutBtn.textContent = "Tutorial";
      return;
    }
    tutorial = makeTutorial({
      container: container,
      hooks: hooks,
      setGate: setGate,
      controls: {
        rInput: rInput,
        thetaInput: thetaInput,
        tInput: tInput,
        phiInput: phiInput,
        beta: beta,
        betaInputs: betaInputs,
        syncBetaSliders: syncBetaSliders,
        scheduleSolve: scheduleSolve,
        chamberBoxes: chamberBoxes,
        crossWall: crossWall,
        limBtn: limBtn,
        enterStratum: enterStratum,
        leaveStratum: leaveStratum,
        stratumRef: () => stratum,
        resetChamber: resetChamber,
        defaultR: 0.25,
        defaultBeta: [0.4, 0.5, 0.5, 0.25],
      },
    });
    tutorial.enter();
    tutBtn.textContent = "Exit tutorial";
  });

  function resize() {
    const w = canvasBox.clientWidth;
    const h = canvasBox.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvasBox);
  resize();

  // Theme switch: refresh the cached slice-plot colors, then re-apply the
  // palette and redraw the plots ONCE (the plots depend only on beta + the
  // chamber, never on a solve — their per-event redraw lives solely in
  // syncBetaSliders/crossWall; review fix 2026-09-15).
  new MutationObserver(() => {
    refreshPlotColors();
    applyColors();
    drawSlicePlots();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    let dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (dt > 0.05) dt = 0.05;
    if (pending) {
      pending = false;
      solveAndDraw();
      refreshSide();
    }
    // stratum entry/exit morph: play the aligned geometry change as a
    // short smoothstep blend (the orientor consumes the blended walk, so
    // the chord transport stays continuous through the transition)
    if (morph) {
      // clamp to [0,1]: morph.start is set mid-frame (after the loop read
      // `now`), so the creation frame's raw s is slightly negative
      const s = Math.min(1, Math.max(0, (now - morph.start) / STRATUM_MORPH_MS));
      const e = s * s * (3 - 2 * s);
      const cur = morphBlend(e);
      lastVerts = cur.verts;
      writePolygonGeometry(cur.verts);
      sl2Base = cur.sl2;
      updatePhiViews();
      if (s >= 1) morph = null;
    }
    if (lastVerts) {
      const q = orientor.update(lastVerts, dt, { idle: now - lastInput > 250 });
      polyGroup.quaternion.set(q[0], q[1], q[2], q[3]);
    }
    // yellow edge overrides (straight pair solid, blink pulse decaying)
    updateEdgeColors(now);
    // spec 5: edge thickness tracks the camera zoom every frame
    updateEdgeRadii();
    // user request 2026-09-15: label size tracks the camera zoom too
    updateLabelScales();
    controls.update();
    renderer.render(scene, camera);
    // SL(2,C) views render only while expanded (task 2)
    if (slDetails.open) {
      for (const view of [slRe, slIm]) {
        view.controls.update();
        view.renderer.render(view.scene, view.camera);
      }
    }
    // tutorial frame hooks (task 24): guarded plain loop — no cost while
    // the array is empty (no per-frame forEach allocation)
    if (hooks.onFrame.length > 0) {
      for (let i = 0; i < hooks.onFrame.length; i++) hooks.onFrame[i]();
    }
  }
  loop();
}

const widget = document.getElementById("hyperpolygon-widget");
if (widget) {
  if (typeof THREE === "undefined" || typeof THREE.OrbitControls === "undefined") {
    console.warn("hyperpolygon widget: three.js or OrbitControls failed to load");
  } else {
    activate(widget);
  }
}