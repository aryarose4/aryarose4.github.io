// Side-view geometry for the hyperpolygon moduli space (task-list item 5):
// the (r, theta, t) portrait as a central 2-sphere with three exterior
// 2-spheres attached at the theta = 0 meridian points r = 0, 0.5, 1, plus
// the "Higgs-flow" picture — a black dot that climbs off the central
// sphere along the paraboloid normal direction as t grows (central
// branch), or rides an exterior sphere from its attachment point toward
// the antipode as t grows (exterior branch).
//
// All label/index math is in USER leg indexing: with the widget-exact
// call (makeHyperpolygon(r, theta, t, [b0, b1, b3, b2], true)) the
// widget's beta pre-swap and the solver's output swap cancel, so a
// displayed polygon leg index j IS user beta leg j (see the PERM note
// below and the walls.mjs [E] regression).
//
// Dependency-free ES module. Node-safe: THREE is only touched inside
// makeSideView (browser-only), guarded like widget.js guards its setup —
// the pure geometry above it never references THREE.

import { makeHyperpolygon } from "./solver.js";

// Placeholder radius of the central 2-sphere. Single knob until a
// chamber-dependent area formula replaces it.
export const CENTRAL_RADIUS = 1;

// The three exterior-sphere attachment points, all on the theta = 0
// (+x) meridian: (r, theta, t) = (0, 0, 0) south pole, (0.5, 0, 0)
// equator, (1, 0, 0) north pole.
export const attachmentRs = [0, 0.5, 1];

// Paraboloid shape constants. phi(t) = atan(PHI_K * t / (1 - t)) opens
// gently (PHI_K = 0.5 puts phi ~ 0.46 rad at t = 0.5) and saturates at
// PHI_CAP = 80 deg near t ~ 0.92, so the dot stops climbing before the
// paraboloid gets cartoonishly steep. PARAB_FOCAL sets the scale:
// surface z_local = rho^2 / (2 * PARAB_FOCAL) above the apex.
export const PARAB_FOCAL = 0.6;
export const PHI_K = 0.5;
export const PHI_CAP = (80 * Math.PI) / 180;

// Exterior branch: t at or beyond this shows the "lim t -> infinity"
// regime (the widget owns the button/state; this is the data).
export const T_NEAR_INF = 0.9;

// Widget solve permutation, exported for the harness/spec. NOTE (measured,
// and the walls.mjs [E] regression): the widget's PRE-swap of beta legs 2/3
// plus the solver's POST-swap of the returned pair cancel each other, so a
// displayed polygon leg index j already corresponds to USER beta leg j —
// no conversion is applied anywhere in this module. PERM is its own
// inverse, which is why the double swap is the identity.
export const PERM = [0, 1, 3, 2];

const Y_HAT = [0, 1, 0];

// Attachment-point parallel-pair probe thresholds: a slot qualifies when
// its pair sine is < PARALLEL_TOL and at least PARALLEL_RATIO times
// smaller than the runner-up slot's (both chamber-short slots; the
// measured margins are ~1e4 or better).
const PARALLEL_TOL = 1e-3;
const PARALLEL_RATIO = 10;
// Retry theta when the theta = 0 solve is unusable: the documented
// theta = 0 stall basin extends to at least 1e-8 but is clean by 1e-6,
// and the geometric parallel-pair residual grows only ~linearly in
// theta, so 1e-4 stays under PARALLEL_TOL while escaping the basin.
const PROBE_THETA_RETRY = 1e-4;

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale3(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function len3(a) {
  return Math.sqrt(dot3(a, a));
}

// Unit vector along a (or null when degenerate — callers substitute a
// fallback axis, e.g. +x when the yHat-perpendicular frame vanishes at
// the sphere poles).
function unit3(a) {
  const n = len3(a);
  if (n < 1e-12) return null;
  return [a[0] / n, a[1] / n, a[2] / n];
}

// Point on the central sphere, polar angle measured from the south pole:
// r = 0 is (0, -R, 0), r = 1 is (0, R, 0), theta = 0 the +x meridian.
export function spherePoint(r, theta, R) {
  const rad = R === undefined ? CENTRAL_RADIUS : R;
  const psi = Math.PI * r;
  return [rad * Math.sin(psi) * Math.cos(theta), -rad * Math.cos(psi), rad * Math.sin(psi) * Math.sin(theta)];
}

// (PI/2) * (sum of beta off I - sum over I). Chamber shorts guarantee a
// nonnegative value; clamp guards fp noise at wall-touch tuples.
export function pairArea(beta, I) {
  let inSum = 0;
  let outSum = 0;
  for (let n = 0; n < 4; n++) {
    if (I.indexOf(n) === -1) outSum += beta[n];
    else inSum += beta[n];
  }
  const d = outSum - inSum;
  return (Math.PI / 2) * (d > 0 ? d : 0);
}

// Exterior-sphere radius from the pair area: area = 4 PI r^2.
export function pairRadius(beta, I) {
  return Math.sqrt(pairArea(beta, I) / (4 * Math.PI));
}

// Unit outward frame at a central-sphere point p: u = the yHat direction
// made tangent (the +x meridian direction where theta = 0), v = n x u.
// u degenerates only at the poles, where the fallback [1, 0, 0] keeps
// the frame right-handed and continuous with the theta = 0 meridian.
function tangentFrame(p) {
  const n = unit3(p);
  let u = unit3(sub3(Y_HAT, scale3(n, dot3(Y_HAT, n))));
  if (!u) u = [1, 0, 0];
  return { n: n, u: u, v: cross3(n, u) };
}

// The core flow state. Branch selection: an attachment point k "owns"
// the flow when (r, theta) sits on it — poles accept any theta (theta is
// degenerate there), the equator needs theta ~ 0. t is the RAW slider
// value (1 allowed; the widget's T_SOLVE_MAX clamp is its own business).
// Returns null on any non-finite input; never throws for finite input.
export function flowState(r, theta, t, beta, chamberShorts, extMap) {
  if (!Number.isFinite(r) || !Number.isFinite(theta) || !Number.isFinite(t)) return null;
  if (!beta || beta.length !== 4) return null;
  for (let i = 0; i < 4; i++) if (!Number.isFinite(beta[i])) return null;

  const ARC_N = 33;
  for (let k = 0; k < 3; k++) {
    const S = extMap ? extMap[k] : null;
    if (S === null || S === undefined) continue;
    const onR = Math.abs(r - attachmentRs[k]) <= 1e-9;
    const onTheta = k === 1 ? Math.abs(theta) <= 1e-9 : true;
    if (!onR || !onTheta) continue;

    const I = chamberShorts ? chamberShorts[S] : null;
    if (!I || I.length !== 2) continue;
    let rk = pairRadius(beta, I);
    if (!(rk >= 1e-9)) rk = 1e-9;
    const p = spherePoint(attachmentRs[k], 0);
    const n = unit3(p);
    // Side direction: yHat made tangent to the central sphere at p; at
    // the poles that is zero, so fall back to +x (the theta = 0 tangent).
    let w = unit3(sub3(Y_HAT, scale3(n, dot3(Y_HAT, n))));
    if (!w) w = [1, 0, 0];
    const c = add3(p, scale3(n, rk));
    const climb = (alpha) => {
      const ca = Math.cos(alpha);
      const sa = Math.sin(alpha);
      return [c[0] + rk * (-ca * n[0] + sa * w[0]), c[1] + rk * (-ca * n[1] + sa * w[1]), c[2] + rk * (-ca * n[2] + sa * w[2])];
    };
    const arc = [];
    for (let i = 0; i < ARC_N; i++) arc.push(climb((Math.PI * i) / (ARC_N - 1)));
    return {
      kind: "exterior",
      slot: S,
      dot: climb(Math.PI * t),
      exterior: { center: c, radius: rk, normal: n, side: w, attachment: p },
      paraboloid: null,
      arc: arc,
      nearInfinity: t >= T_NEAR_INF,
    };
  }

  // Central branch: the dot climbs the paraboloid z = rho^2/(2f) tangent
  // at p, opening along +n. phi(t) rises from 0 and saturates at PHI_CAP.
  const p = spherePoint(r, theta);
  const frame = tangentFrame(p);
  const n = frame.n;
  const u = frame.u;
  let phi = t <= 0 ? 0 : t >= 1 ? PHI_CAP : Math.atan((PHI_K * t) / (1 - t));
  if (phi > PHI_CAP) phi = PHI_CAP;
  const rhoMax = PARAB_FOCAL * Math.tan(PHI_CAP);
  const climb = (ph) => {
    const rho = Math.min(PARAB_FOCAL * Math.tan(ph), rhoMax);
    const z = (rho * rho) / (2 * PARAB_FOCAL);
    return [p[0] + rho * u[0] + z * n[0], p[1] + rho * u[1] + z * n[1], p[2] + rho * u[2] + z * n[2]];
  };
  const arc = [];
  for (let i = 0; i < ARC_N; i++) arc.push(climb((phi * i) / (ARC_N - 1)));
  return {
    kind: "central",
    slot: null,
    dot: climb(phi),
    exterior: null,
    paraboloid: { apex: p, u: u, v: frame.v, n: n, f: PARAB_FOCAL, cap: PHI_CAP },
    arc: arc,
    nearInfinity: false,
  };
}

// Which chamberShorts pair slot (5, 6 or 7) is the parallel pair at each
// attachment point. Measured, not assumed: at each attachment the
// widget-exact solve (legs 2/3 pre-swapped, permute = true) is taken at
// t = 0, the 8 polygon edges are grouped into legs (edges (2j, 2j+1),
// which for this call pattern are the user legs directly — see the PERM
// note), and for each of the chamber's pair-shorts the residual is the
// min over the valid edge-cross combinations of the sine of the angle
// between the two edges (zero-length edges are skipped — at t = 0 each
// leg's second edge collapses; a slot with no valid combo reads
// Infinity). The winning slot needs residual < PARALLEL_TOL and a
// PARALLEL_RATIO margin over the runner-up; on failure the measurement
// retries at a small theta (the documented theta = 0 solver stall
// basin), else the attachment maps to null. Empirically the result is
// the chamber-INDEPENDENT slot map [6, 5, 7] (south, equator, north),
// with the parallel pair being that chamber's short side — see
// dev/hyperpolygon/sideview.mjs [P]. Runs 3-6 solves, so call it on
// beta changes, not per frame.
export function probeExteriorMap(beta, chamberShorts) {
  const map = [null, null, null];
  const detail = [];
  for (let k = 0; k < 3; k++) {
    const entry = { theta: 0, residuals: [Infinity, Infinity, Infinity], retried: false };
    detail.push(entry);
    let got = null;
    for (let attempt = 0; attempt < 2 && got === null; attempt++) {
      const theta = attempt === 0 ? 0 : PROBE_THETA_RETRY;
      entry.theta = theta;
      entry.retried = attempt === 1;
      const res = measureSlots(attachmentRs[k], theta, beta, chamberShorts);
      if (res === null) continue;
      entry.residuals = res;
      let best = -1;
      for (let s = 0; s < 3; s++) {
        if (best === -1 || res[s] < res[best]) best = s;
      }
      if (best === -1 || !(res[best] < PARALLEL_TOL)) continue;
      let runnerUp = Infinity;
      for (let s = 0; s < 3; s++) if (s !== best && res[s] < runnerUp) runnerUp = res[s];
      if (res[best] * PARALLEL_RATIO > runnerUp) continue;
      got = 5 + best;
    }
    map[k] = got;
  }
  return { map: map, detail: detail };
}

// Per-slot parallelism residuals at (r, theta, t = 0) with the
// widget-exact call pattern; null on solve failure or NaN vertices.
function measureSlots(r, theta, beta, chamberShorts) {
  let res;
  try {
    res = makeHyperpolygon(r, theta, 0, [beta[0], beta[1], beta[3], beta[2]], true);
  } catch (e) {
    return null;
  }
  const V = res.vertices;
  for (let i = 0; i < V.length; i++) {
    if (!Number.isFinite(V[i][0]) || !Number.isFinite(V[i][1]) || !Number.isFinite(V[i][2])) return null;
  }
  const edges = [];
  for (let i = 0; i < 8; i++) edges.push(sub3(V[i + 1], V[i]));
  // displayed leg j owns edges (2j, 2j+1); for the widget-exact call the
  // double swap cancels, so displayed j IS user leg j (see PERM note)
  const out = [];
  for (let s = 5; s <= 7; s++) {
    out.push(pairSine(edges, chamberShorts[s][0], chamberShorts[s][1]));
  }
  return out;
}

// Min sine of the angle between one edge from displayed leg a and one
// from displayed leg b, over combos where both edges are non-degenerate
// (at t = 0 each leg's second edge has zero length). Infinity when a leg
// has no measurable edge.
function pairSine(edges, a, b) {
  let m = Infinity;
  for (let ia = 0; ia < 2; ia++) {
    for (let ib = 0; ib < 2; ib++) {
      const u = edges[2 * a + ia];
      const v = edges[2 * b + ib];
      const nu = len3(u);
      const nv = len3(v);
      if (nu < 1e-12 || nv < 1e-12) continue;
      const s = len3(cross3(u, v)) / (nu * nv);
      if (s < m) m = s;
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Browser-only side-view factory. Call only when global THREE exists
// (returns null otherwise). Palette keys (getPalette() -> object):
//   sideBg   — clear color as number, or null/undefined for a
//              transparent canvas (default: transparent)
//   sphere   — central 2-sphere color (default 0xffffff)
//   ext      — exterior 2-sphere base color (default 0xffffff); the
//              active attachment lerps to pure white
//   dot      — black dot color (default 0x000000)
//   parab    — paraboloid color (default 0x3a7bd5)
//   arc      — guide-arc color (default 0x808080)
//   border   — CSS color for the host border (default "#d0d0d0")
//   caption  — reserved for future labels; accepted, currently unused
export function makeSideView(host, opts) {
  if (typeof THREE === "undefined" || typeof THREE.OrbitControls === "undefined") return null;
  opts = opts || {};
  const getPalette = opts.getPalette || function () { return {}; };

  const pal = function () {
    const p = getPalette() || {};
    return {
      sideBg: p.sideBg === undefined ? null : p.sideBg,
      sphere: p.sphere === undefined ? 0xffffff : p.sphere,
      ext: p.ext === undefined ? 0xffffff : p.ext,
      dot: p.dot === undefined ? 0x000000 : p.dot,
      parab: p.parab === undefined ? 0x3a7bd5 : p.parab,
      arc: p.arc === undefined ? 0x808080 : p.arc,
      border: p.border === undefined ? "#d0d0d0" : p.border,
      caption: p.caption === undefined ? "#666666" : p.caption,
    };
  };

  host.style.position = host.style.position || "relative";
  host.style.boxSizing = host.style.boxSizing || "border-box";

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(2.3, 1.3, 2.7);
  camera.lookAt(0, 0, 0);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0.1, 0, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x777788, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(3, 5, 4);
  scene.add(sun);

  const centralMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const central = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), centralMat);
  central.scale.setScalar(CENTRAL_RADIUS);
  scene.add(central);

  // Shared unit-sphere geometry for the three exterior bubbles.
  const extGeom = new THREE.SphereGeometry(1, 32, 24);
  const WHITE = new THREE.Color(0xffffff);
  const exts = [];
  for (let k = 0; k < 3; k++) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
    const mesh = new THREE.Mesh(extGeom, mat);
    mesh.visible = false;
    scene.add(mesh);
    exts.push({ mesh: mesh, mat: mat, glow: 0 });
  }

  const dotMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), dotMat);
  scene.add(dot);

  // Paraboloid: fixed topology, positions recomputed from the flowState
  // frame whenever visible (28 angular x 14 radial grid).
  const PARA_A = 28;
  const PARA_R = 14;
  const paraPos = new Float32Array(PARA_A * PARA_R * 3);
  const paraIdx = [];
  for (let i = 0; i < PARA_A; i++) {
    for (let j = 0; j < PARA_R - 1; j++) {
      const a0 = i * PARA_R + j;
      const a1 = ((i + 1) % PARA_A) * PARA_R + j;
      paraIdx.push(a0, a1, a0 + 1, a1, a1 + 1, a0 + 1);
    }
  }
  const paraGeom = new THREE.BufferGeometry();
  paraGeom.setAttribute("position", new THREE.BufferAttribute(paraPos, 3));
  paraGeom.setIndex(paraIdx);
  const paraMat = new THREE.MeshLambertMaterial({ color: 0x3a7bd5, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
  const paraMesh = new THREE.Mesh(paraGeom, paraMat);
  paraMesh.visible = false;
  scene.add(paraMesh);

  const arcPos = new Float32Array(33 * 3);
  const arcGeom = new THREE.BufferGeometry();
  arcGeom.setAttribute("position", new THREE.BufferAttribute(arcPos, 3));
  const arcMat = new THREE.LineBasicMaterial({ color: 0x808080, transparent: true, opacity: 0.55 });
  const arcLine = new THREE.Line(arcGeom, arcMat);
  scene.add(arcLine);

  let lastState = null;
  let lastShowParab = false;
  let hovered = false;
  // Placement of every mapped exterior sphere, recomputed in update():
  // each attachment k with extMap[k] != null shows its sphere at
  // center p + rk * n with radius rk (pairRadius of the mapped slot's
  // pair) — the active branch's sphere is the one whose slot matches
  // lastState.exterior.slot and it glows.
  let extPlacement = [null, null, null];
  let lastExtMap = [null, null, null];
  let disposed = false;

  function applyColors() {
    const p = pal();
    centralMat.color.setHex(p.sphere);
    dotMat.color.setHex(p.dot);
    paraMat.color.setHex(p.parab);
    arcMat.color.setHex(p.arc);
    for (let k = 0; k < 3; k++) exts[k].mat.color.setHex(p.ext);
    if (p.sideBg === null) renderer.setClearColor(0x000000, 0);
    else renderer.setClearColor(p.sideBg, 1);
    host.style.border = "1px solid " + (hovered ? p.caption : p.border);
  }
  applyColors();

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  function setArc(st) {
    const a = st.arc;
    for (let i = 0; i < 33; i++) {
      const p = a[Math.min(i, a.length - 1)];
      arcPos[3 * i] = p[0];
      arcPos[3 * i + 1] = p[1];
      arcPos[3 * i + 2] = p[2];
    }
    arcGeom.attributes.position.needsUpdate = true;
    arcGeom.computeBoundingSphere();
  }

  function setParaboloid(P) {
    const rhoMax = P.f * Math.tan(P.cap);
    for (let i = 0; i < PARA_A; i++) {
      const ang = (2 * Math.PI * i) / PARA_A;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      for (let j = 0; j < PARA_R; j++) {
        const rho = (rhoMax * j) / (PARA_R - 1);
        const z = (rho * rho) / (2 * P.f);
        const ou = rho * ca;
        const ov = rho * sa;
        const o = 3 * (i * PARA_R + j);
        paraPos[o] = P.apex[0] + ou * P.u[0] + ov * P.v[0] + z * P.n[0];
        paraPos[o + 1] = P.apex[1] + ou * P.u[1] + ov * P.v[1] + z * P.n[1];
        paraPos[o + 2] = P.apex[2] + ou * P.u[2] + ov * P.v[2] + z * P.n[2];
      }
    }
    paraGeom.attributes.position.needsUpdate = true;
    paraGeom.computeVertexNormals();
    paraGeom.computeBoundingSphere();
  }

  // Total update: on any failure or NaN the previous frame's objects are
  // frozen (belt-and-suspenders, same style as widget.js). Returns the
  // flow state (or null) so the widget can drive UI off it (the
  // "lim t -> infinity" button reads nearInfinity without a re-solve).
  function update(r, theta, t, beta, chamberShorts, extMap, showParaboloid) {
    let st = null;
    try {
      st = flowState(r, theta, t, beta, chamberShorts, extMap);
    } catch (e) {
      st = null;
    }
    if (
      st === null ||
      !Number.isFinite(st.dot[0]) || !Number.isFinite(st.dot[1]) || !Number.isFinite(st.dot[2]) ||
      (st.exterior !== null && !Number.isFinite(st.exterior.radius)) ||
      (st.paraboloid !== null && !Number.isFinite(st.paraboloid.f))
    ) {
      return null;
    }
    lastState = st;
    lastShowParab = !!showParaboloid;
    lastExtMap = extMap || [null, null, null];
    dot.position.set(st.dot[0], st.dot[1], st.dot[2]);
    setArc(st);
    if (lastShowParab && st.paraboloid) setParaboloid(st.paraboloid);

    // Recompute every mapped exterior sphere's placement (the two
    // inactive attachments never appear in flowState's exterior branch).
    for (let k = 0; k < 3; k++) {
      const S = lastExtMap[k];
      if (S === null || S === undefined || !chamberShorts[S]) {
        extPlacement[k] = null;
        continue;
      }
      let rk = pairRadius(beta, chamberShorts[S]);
      if (!(rk >= 1e-9)) rk = 1e-9;
      const p = spherePoint(attachmentRs[k], 0);
      const n = unit3(p);
      extPlacement[k] = { center: add3(p, scale3(n, rk)), radius: rk };
    }
    return st;
  }

  function setHover(on) {
    // Visual affordance only (border emphasis); the widget decides what
    // hover means for interaction.
    hovered = !!on;
    host.classList.toggle("hp-side-hover", hovered);
    applyColors();
  }

  function refreshTheme() {
    applyColors();
  }

  let lastFrame = performance.now();
  function loop() {
    if (disposed) return;
    requestAnimationFrame(loop);
    const now = performance.now();
    let dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (dt > 0.05) dt = 0.05;

    // Exterior bubbles from the placement recomputed in update(); the
    // attachment whose slot is the current flow branch glows to full
    // opacity with an ~80 ms exponential lag.
    const activeSlot = lastState && lastState.exterior ? lastState.exterior.slot : null;
    for (let k = 0; k < 3; k++) {
      const e = exts[k];
      const place = extPlacement[k];
      const target = place !== null && activeSlot !== null && activeSlot === (lastExtMap ? lastExtMap[k] : null) ? 1 : 0;
      e.glow += (target - e.glow) * (1 - Math.exp(-dt / 0.08));
      if (place) {
        e.mesh.visible = true;
        e.mesh.position.set(place.center[0], place.center[1], place.center[2]);
        e.mesh.scale.setScalar(place.radius);
        e.mat.opacity = 0.16 + (1.0 - 0.16) * e.glow;
        e.mat.color.setHex(pal().ext).lerp(WHITE, e.glow);
      } else {
        e.mesh.visible = false;
        e.glow = 0;
      }
    }

    const showPara = lastShowParab && lastState && lastState.paraboloid !== null;
    paraMesh.visible = !!showPara;
    arcLine.visible = !!lastState && (lastState.kind === "exterior" || !!showPara);

    controls.update();
    renderer.render(scene, camera);
  }
  loop();

  function dispose() {
    disposed = true;
    ro.disconnect();
    controls.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    host.classList.remove("hp-side-hover");
  }

  return { update: update, setHover: setHover, refreshTheme: refreshTheme, dispose: dispose };
}
