// Display-orientation servo for the hyperpolygon widget.
//
// The solver output is gauge-defined only up to a residual rotation, so the
// raw polygon tumbles as the sliders move. This module owns ONE displayed
// orientation: a quaternion Q that pins the chord (vertex 0 -> vertex 4) to
// the +y world axis (three.js up) via exponential-lag transport, plus a slow
// idle "twist servo" that removes the residual spin about the chord axis.
// While the chord is numerically invisible (chordLen/scale < FREEZE_LO) the
// orientation is deliberately held: the raw chord direction carries no
// information there, and the transport lag turns the deferred correction
// into a smooth swoosh instead of a snap. The solver itself is never
// modified.
//
// update() returns the displayed orientation as a unit quaternion in
// three.js Quaternion.set(x, y, z, w) component order.

const T_DISPLAY = 0.04; // s, exponential lag chasing the chord-pinning goal
const T_SERVO = 0.5; // s, twist servo time constant
const SERVO_MAX_RATE = 2.5; // rad/s cap on servo twist speed
// Servo twist on/off switch (user request 2026-09-14): set to false to
// disable the idle twist servo entirely — the displayed orientation then
// only pins the chord to +y and the residual spin about the chord axis is
// left to the solver data (the one-time twist canonicalization at
// initialization still runs, it just no longer tracks). The orient.mjs
// battery skips its servo-dependent assertions when this is false.
export const SERVO_TWIST = true;
const FREEZE_LO = 1e-3; // freeze when chordLen/scale < FREEZE_LO
const FREEZE_HI = 1e-2; // unfreeze when chordLen/scale > FREEZE_HI (hysteresis)
const SERVO_SIN_MIN = 0.25; // min |sin(angle between v1 and chord)| for servo to run
// Gauge-jump robustness (2026-09-16): between solves the solver's residual
// gauge can step discontinuously (chart-switch representatives, endpoint
// rescues, stratum entry) as a RIGID rotation of the whole walk — the
// polygon's displayed pose is defined only up to that rotation. If left
// alone, the chord transport whips the display (its slerp takes ~34% of the
// re-pin arc per frame) and the idle servo then spins the new twist back to
// its reference at up to SERVO_MAX_RATE; both read as a discontinuous jump
// during chamber/stratum transitions. Detection: the Horn best-fit rotation
// between the consecutive raw walks has a small residual (shape unchanged)
// while its angle is large — a pure gauge step, independent of where its
// axis points. On detection the rotation is absorbed into Q up front, so the
// displayed pose does not move at all and the arbitrary new twist simply
// stays where it landed.
const JUMP_ROT_MIN = 0.2; // rad, best-fit rotation qualifying as a jump
const JUMP_RESID_FRAC = 0.05; // residual/scale ceiling for calling it rigid
// A one-frame step of the DISPLAYED azimuth larger than this adopts that
// pose as the new servo reference (non-rigid data steps, e.g. the stratum
// entry's intrinsic residual shape change) instead of spinning to the old
// reference; continuous drift stays below it and keeps being parked.
const TARGET_STEP_PSI = 0.35;

const EY = [0, 1, 0]; // three.js up axis: the chord target

function norm3(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Hamilton product; qMul(a, b) applies b first, then a
function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function qy(angle) {
  return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
}

// inverse of a unit quaternion (the conjugate)
function qInv(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

function normalizeQ(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (n < 1e-300) return [0, 0, 0, 1];
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

// rotate v by unit quaternion q:
// v + 2*cross(q.xyz, cross(q.xyz, v) + w*v)
function qRotate(q, v) {
  const qv = [q[0], q[1], q[2]];
  const c1 = cross3(qv, v);
  const t = [c1[0] + q[3] * v[0], c1[1] + q[3] * v[1], c1[2] + q[3] * v[2]];
  const c2 = cross3(qv, t);
  return [v[0] + 2 * c2[0], v[1] + 2 * c2[1], v[2] + 2 * c2[2]];
}

// Best-fit rotation mapping the point list P rigidly onto P + dP, both
// walks treated as rotations about the ORIGIN (the residual gauge acts on
// the walk that way). Horn quaternion method diagonalized by Jacobi sweeps;
// ALL FOUR candidate eigenvectors are scored by their actual residual and
// the best kept — the solver walks are near-planar with vertices wandering
// through the origin, so their Horn matrix carries tied eigenclusters where
// a single pick lands in the wrong pair and returns garbage (measured; the
// same shape of hazard as widget.js's task-21 stratum alignment). Returns
// { q, angle, residual, scale } with residual = the maximum |R p - q| over
// the points. A RIGID rotation of the walk (P and Q differing only by the
// gauge rotation) gives residual ~ 0 and angle = the gauge angle; a shape-
// changing flow step gives a large residual that disqualifies it.
export function bestFitRotation(P, dP) {
  const S = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  let scale = 0;
  for (let k = 0; k < P.length; k++) {
    const p = P[k];
    const q = [p[0] + dP[k][0], p[1] + dP[k][1], p[2] + dP[k][2]];
    scale = Math.max(scale, norm3(q));
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
  let bestQ = null;
  let bestRes = Infinity;
  for (let bi = 0; bi < 4; bi++) {
    const w = v[0][bi], x = v[1][bi], y = v[2][bi], z = v[3][bi];
    const nn = Math.hypot(w, x, y, z);
    if (!(nn > 0)) continue;
    const wu = w / nn, xu = x / nn, yu = y / nn, zu = z / nn;
    const R = [
      [1 - 2 * (yu * yu + zu * zu), 2 * (xu * yu - wu * zu), 2 * (xu * zu + wu * yu)],
      [2 * (xu * yu + wu * zu), 1 - 2 * (xu * xu + zu * zu), 2 * (yu * zu - wu * xu)],
      [2 * (xu * zu - wu * yu), 2 * (yu * zu + wu * xu), 1 - 2 * (xu * xu + yu * yu)],
    ];
    let res = 0;
    for (let k = 0; k < P.length; k++) {
      const p = P[k];
      const q = [p[0] + dP[k][0], p[1] + dP[k][1], p[2] + dP[k][2]];
      const rr = [
        R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] - q[0],
        R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] - q[1],
        R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] - q[2],
      ];
      res = Math.max(res, norm3(rr));
    }
    if (res < bestRes) {
      bestRes = res;
      // returned in the orientor's three.js [x, y, z, w] order (the Jacobi
      // layout is [w, x, y, z]; the angle below still reads the real w)
      bestQ = [xu, yu, zu, wu];
    }
  }
  // bestQ is [x, y, z, w]; the quaternion's real part is bestQ[3].
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, bestQ[3])));
  return { q: bestQ, angle: angle, residual: bestRes, scale: scale };
}

function wrapToPi(x) {
  return x - 2 * Math.PI * Math.round(x / (2 * Math.PI));
}

// shortest-arc rotation taking unit vector a to unit vector b; never NaN
function shortestArcQuat(a, b) {
  const d = Math.max(-1, Math.min(1, dot3(a, b)));
  if (d <= -1 + 1e-9) {
    // 180 degrees about the basis axis least aligned with a, made
    // orthogonal to a (Gram-Schmidt) so the axis is well defined
    let e = [1, 0, 0];
    let m = Math.abs(a[0]);
    if (Math.abs(a[1]) < m) {
      e = [0, 1, 0];
      m = Math.abs(a[1]);
    }
    if (Math.abs(a[2]) < m) {
      e = [0, 0, 1];
    }
    const ea = dot3(e, a);
    const k = [e[0] - ea * a[0], e[1] - ea * a[1], e[2] - ea * a[2]];
    const n = norm3(k);
    const inv = 1 / n;
    return [k[0] * inv, k[1] * inv, k[2] * inv, 0];
  }
  const k = cross3(a, b);
  const s = norm3(k);
  if (s < 1e-12) return [0, 0, 0, 1];
  const half = Math.acos(d) / 2;
  const sn = Math.sin(half) / s;
  return [k[0] * sn, k[1] * sn, k[2] * sn, Math.cos(half)];
}

function slerp(q1, q2, f) {
  let d = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
  let b = q2;
  if (d < 0) {
    b = [-q2[0], -q2[1], -q2[2], -q2[3]];
    d = -d;
  }
  if (d > 0.9995) {
    return normalizeQ([
      q1[0] + f * (b[0] - q1[0]),
      q1[1] + f * (b[1] - q1[1]),
      q1[2] + f * (b[2] - q1[2]),
      q1[3] + f * (b[3] - q1[3]),
    ]);
  }
  const th = Math.acos(Math.max(-1, Math.min(1, d)));
  const st = Math.sin(th);
  const s1 = Math.sin((1 - f) * th) / st;
  const s2 = Math.sin(f * th) / st;
  return [
    q1[0] * s1 + b[0] * s2,
    q1[1] * s1 + b[1] * s2,
    q1[2] * s1 + b[2] * s2,
    q1[3] * s1 + b[3] * s2,
  ];
}

export function makeOrientor() {
  let Q = null; // displayed quaternion [x, y, z, w]; null = uninitialized
  let frozen = false;
  // Gauge-jump state: a copy of the previous frame's raw walk (for the
  // rigidity test) and the current servo parking reference (the displayed
  // azimuth the servo steers toward; re-anchored when the data steps
  // discontinuously).
  let prevWalk = null;
  let targetPsi = 0;
  let lastPsi = null;

  // azimuth of the displayed v1 about the chord axis (+y), measured in the
  // xz-plane from +x toward +z (null when the servo must not run: v1
  // negligible, or v1 too parallel to the chord for the azimuth to be
  // well conditioned)
  function servoPsi(vertices, scale, chord, chordLen) {
    const v1 = vertices[1];
    const v1n = norm3(v1);
    if (!(v1n > 1e-9 * scale)) return null;
    const sn = norm3(cross3(v1, chord)) / (v1n * chordLen);
    if (!(sn > SERVO_SIN_MIN)) return null;
    const r = qRotate(Q, v1);
    return Math.atan2(r[2], r[0]);
  }

  return {
    update(vertices, dt, flags) {
      if (!(dt > 0)) dt = 1e-3;
      else if (dt > 0.5) dt = 0.5;

      // 1. polygon scale and chord
      let scale = 0;
      for (let i = 0; i < vertices.length; i++) {
        scale = Math.max(scale, norm3(vertices[i]));
      }
      if (scale === 0) {
        return Q ? Q.slice() : [0, 0, 0, 1];
      }
      const chord = [
        vertices[4][0] - vertices[0][0],
        vertices[4][1] - vertices[0][1],
        vertices[4][2] - vertices[0][2],
      ];
      const chordLen = norm3(chord);

      // 2. freeze hysteresis
      if (chordLen / scale < FREEZE_LO) frozen = true;
      else if (chordLen / scale > FREEZE_HI) frozen = false;

      // 3. initialize: pin the chord, then canonicalize the twist once
      if (Q === null) {
        prevWalk = vertices.map((p) => p.slice());
        lastPsi = null;
        targetPsi = 0;
        if (frozen) return [0, 0, 0, 1];
        const c = [chord[0] / chordLen, chord[1] / chordLen, chord[2] / chordLen];
        Q = shortestArcQuat(c, EY);
        const psi = servoPsi(vertices, scale, chord, chordLen);
        if (psi !== null) Q = qMul(qy(wrapToPi(psi)), Q);
        return Q.slice();
      }

      // 4. frozen: deliberately hold the orientation (prevWalk keeps
      // tracking, so the first unfrozen frame sees the accumulated walk
      // motion rather than a mis-timed one-frame spike)
      if (frozen) {
        prevWalk = vertices.map((p) => p.slice());
        lastPsi = null;
        return Q.slice();
      }

      // 4.5 gauge-jump absorption: between solves the residual gauge can
      // rotate the whole walk rigidly (chart-switch representatives,
      // endpoint rescues, stratum entry). Detection: the Horn best-fit
      // rotation prev-walk -> walk has a small residual (the shape did not
      // change — only its gauge rotation did) while its angle is large
      // enough to whip the transport or spin the servo. The rotation is
      // then absorbed into Q up front, so the displayed pose does not move
      // at all and the arbitrary new twist simply stays where it landed.
      // Degenerate semi-sticks at chordRatio in the (FREEZE_LO, FREEZE_HI)
      // band cannot misfire: a best-fit there fits any rotation about the
      // walk axis, but whatever member it picks keeps the display pose
      // fixed for the rigid motion — exactly the outcome wanted. Legit flow
      // steps deform the walk (residual above the ceiling) and are left
      // to the transport, as before.
      if (prevWalk !== null) {
        const dP = vertices.map((p, k) => [
          p[0] - prevWalk[k][0],
          p[1] - prevWalk[k][1],
          p[2] - prevWalk[k][2],
        ]);
        const bf = bestFitRotation(prevWalk, dP);
        if (
          bf.angle > JUMP_ROT_MIN &&
          bf.angle < 2 * Math.PI - 0.6 &&
          bf.residual / bf.scale < JUMP_RESID_FRAC
        ) {
          Q = normalizeQ(qMul(Q, qInv(bf.q)));
        }
      }
      prevWalk = vertices.map((p) => p.slice());

      // Servo azimuth measurement + its data-step re-anchor, tracked every
      // frame (idle or not) so a step that arrives during a drag still
      // adopts the new twist as the reference instead of spinning to it.
      const psi = servoPsi(vertices, scale, chord, chordLen);
      if (psi !== null) {
        if (lastPsi !== null && Math.abs(wrapToPi(psi - lastPsi)) > TARGET_STEP_PSI) {
          targetPsi = psi;
        }
        lastPsi = psi;
      } else {
        lastPsi = null;
      }

      // 5. transport: chase the chord-pinning goal with exponential lag
      const u = qRotate(Q, chord);
      const uh = [u[0] / chordLen, u[1] / chordLen, u[2] / chordLen];
      const T = shortestArcQuat(uh, EY);
      Q = slerp(Q, qMul(T, Q), 1 - Math.exp(-dt / T_DISPLAY));

      // 6. idle twist servo (a y-rotation cannot move the chord off +y;
      // rotating about +y by alpha shifts the xz-azimuth by -alpha)
      if (SERVO_TWIST && flags && flags.idle && psi !== null) {
        const dpsi = Math.max(
          -SERVO_MAX_RATE * dt,
          Math.min(SERVO_MAX_RATE * dt, (1 - Math.exp(-dt / T_SERVO)) * wrapToPi(psi - targetPsi))
        );
        Q = qMul(qy(dpsi), Q);
      }

      // 7. normalize and return in three.js [x, y, z, w] order
      Q = normalizeQ(Q);
      return Q.slice();
    },
  };
}
