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
const FREEZE_LO = 1e-3; // freeze when chordLen/scale < FREEZE_LO
const FREEZE_HI = 1e-2; // unfreeze when chordLen/scale > FREEZE_HI (hysteresis)
const SERVO_SIN_MIN = 0.25; // min |sin(angle between v1 and chord)| for servo to run

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
        if (frozen) return [0, 0, 0, 1];
        const c = [chord[0] / chordLen, chord[1] / chordLen, chord[2] / chordLen];
        Q = shortestArcQuat(c, EY);
        const psi = servoPsi(vertices, scale, chord, chordLen);
        if (psi !== null) Q = qMul(qy(wrapToPi(psi)), Q);
        return Q.slice();
      }

      // 4. frozen: deliberately hold the orientation
      if (frozen) return Q.slice();

      // 5. transport: chase the chord-pinning goal with exponential lag
      const u = qRotate(Q, chord);
      const uh = [u[0] / chordLen, u[1] / chordLen, u[2] / chordLen];
      const T = shortestArcQuat(uh, EY);
      Q = slerp(Q, qMul(T, Q), 1 - Math.exp(-dt / T_DISPLAY));

      // 6. idle twist servo (a y-rotation cannot move the chord off +y;
      // rotating about +y by alpha shifts the xz-azimuth by -alpha)
      if (flags && flags.idle) {
        const psi = servoPsi(vertices, scale, chord, chordLen);
        if (psi !== null) {
          const dpsi = Math.max(
            -SERVO_MAX_RATE * dt,
            Math.min(SERVO_MAX_RATE * dt, (1 - Math.exp(-dt / T_SERVO)) * wrapToPi(psi))
          );
          Q = qMul(qy(dpsi), Q);
        }
      }

      // 7. normalize and return in three.js [x, y, z, w] order
      Q = normalizeQ(Q);
      return Q.slice();
    },
  };
}
