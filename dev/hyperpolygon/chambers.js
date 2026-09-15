// Stability-chamber geometry for the star-quiver parabolic weights
// beta = (b0, b1, b2, b3), shared by the browser widget and the Node
// harness (dev/hyperpolygon/walls.mjs). Dependency-free ES module.
//
// The moment-map problem is chamber-dependent. The stability walls are
// the hyperplanes where some subset of legs sums to exactly half the
// total:
//   b_i = b_j + b_k + b_l        ("one leg against the rest")
//   b_i + b_j = b_k + b_l        (three distinct walls up to complement)
// Chambers themselves are not all equivalent: in a dominant chamber
// (b_i >= b_j + b_k + b_l for any i, i.e. beyond a leg-vs-rest wall) the
// balanced representative degenerates at small t (no solution at t = 0,
// measured su(2) residuals up to ~0.4 for t <~ 0.01), for any dominant
// leg.
//
// The widget tracks ONE chamber, fixed at load: the chamber containing
// the initial beta, recorded through its "short subsets" — the subsets I
// of {0,1,2,3} with sum_I beta < sum_complement beta (shortSubsets; the
// widget displays these inequalities as boxes). Dragging a beta slider is
// clamped into the CLOSURE of that chamber (chamberInterval +
// applyBetaDrag): a chamber wall may be touched — the binding inequality
// sits exactly at equality, and the widget highlights its box — but never
// crossed, so dragging can never change the chamber. breakingSubsets is
// the hook for the planned per-inequality "flop" action (deliberate
// wall-crossing; it replaced the 2026-09-12 "snap and ride" mechanic the
// same day, after riding made accidental chamber flips too easy). The
// point b_i = 0 is treated as a wall as well — the solver degenerates
// there (leg 0's x-column vanishes, so the (C*)^4 balancing root hits
// u = 0 and the torus action blows up) — and keeps a hard WALL_MARGIN
// floor even at wall-touch time.
//
// betaWalls / betaInterval / clampToChamber remain as geometry utilities
// (used by the walls battery; no longer the widget's drag path).

// Clearance from the 0 positivity wall (the only hard wall), as a
// fraction of the slider range. The near-wall conditioning profile
// measured in walls.mjs ([A]) is the evidence for the value: healthy at
// >= 3e-3 from any wall, degraded by 1e-4.
export const WALL_MARGIN = 0.003;

// Wall positions on the b_i axis for the given beta (the 0 positivity
// wall is always included), restricted to [0, 1] and sorted ascending.
// Complete: every subset-sum hyperplane through the point restricted to
// the b_i axis — the leg-i-dominant wall (a+b+c), the three pair walls
// (b+c-a, a+c-b, a+b-c) and the three other-leg-dominant walls
// (a-b-c, b-a-c, c-a-b; negative — hence invisible — unless that leg
// already outweighs the remaining two). Nonpositive values are dropped.
export function betaWalls(i, beta) {
  const others = [];
  for (let n = 0; n < 4; n++) if (n !== i) others.push(beta[n]);
  const a = others[0];
  const b = others[1];
  const c = others[2];
  const raw = [0, a + b + c, b + c - a, a + c - b, a + b - c, a - b - c, b - a - c, c - a - b];
  const walls = [];
  for (let k = 0; k < raw.length; k++) {
    const w = raw[k];
    if (w >= 0 && w <= 1 && walls.indexOf(w) === -1) walls.push(w);
  }
  walls.sort((p, q) => p - q);
  return walls;
}

// Allowed interval for b_i given the other three: between the adjacent
// wall points, kept WALL_MARGIN clear of each. {lo, hi} is the drag
// range; lo > hi only in degenerate pinches (adjacent walls closer than
// 2*WALL_MARGIN), where the caller should fall back to the midpoint of
// [prev, next] (prev/next bracket the chamber interval itself). Geometry
// utility used by the harness batteries; the widget's drag path is
// chamberInterval (which allows wall contact instead of enforcing this
// margin).
export function betaInterval(i, beta) {
  const walls = betaWalls(i, beta);
  const cur = beta[i];
  let prev = 0;
  let next = null;
  for (let k = 0; k < walls.length; k++) {
    if (walls[k] <= cur) {
      prev = walls[k];
    } else if (next === null) {
      next = walls[k];
    }
  }
  return {
    prev: prev,
    next: next,
    lo: prev + WALL_MARGIN,
    hi: next === null ? 1 : next - WALL_MARGIN,
  };
}

// Clamp every beta entry into its chamber interval, in place. Moving one
// entry shifts the other sliders' walls, so iterate to a fixed point:
// bounded passes, treating sub-1e-11 adjustments as converged (near a
// pinch the walls graze the other entries' clearances and the exact
// fixed point is only approached geometrically; skipping sub-resolution
// moves keeps repeated calls idempotent — the state stays well inside
// the safety margins either way). Returns true if any entry moved.
// Harness-only utility (the widget locks the chamber instead).
const CLAMP_EPS = 1e-11;
export function clampToChamber(beta) {
  let anyMoved = false;
  for (let pass = 0; pass < 200; pass++) {
    let moved = false;
    for (let i = 0; i < 4; i++) {
      const iv = betaInterval(i, beta);
      const cur = beta[i];
      let v;
      if (iv.lo <= iv.hi) {
        v = Math.min(Math.max(cur, iv.lo), iv.hi);
      } else {
        v = 0.5 * (iv.prev + (iv.next === null ? 1 : iv.next));
      }
      if (Math.abs(v - cur) > CLAMP_EPS) {
        beta[i] = v;
        moved = true;
        anyMoved = true;
      }
    }
    if (!moved) break;
  }
  return anyMoved;
}

function lexLess(a, b) {
  for (let k = 0; k < Math.min(a.length, b.length); k++) {
    if (a[k] !== b[k]) return a[k] < b[k];
  }
  return a.length < b.length;
}

function pickShort(I, comp, sI, sC) {
  if (sI < sC) return I;
  if (sC < sI) return comp;
  return lexLess(I, comp) ? I : comp;
}

// The short subsets of beta: for the 8 unordered splits of {0,1,2,3} —
// the trivial one, the 4 leg-vs-rest partitions, and the 3 pair-vs-pair
// partitions, in that fixed slot order — the side with the SMALLER sum.
// The list fully determines the chamber: the chamber containing beta is
// exactly the set where all 8 inequalities hold strictly, so recording
// the short subsets fixes the chamber once and for all. Exact ties (beta
// already ON a wall) pick the lexicographically smaller side, which keeps
// the result deterministic. Slot 0 is the trivial split, always short for
// positive weights.
export function shortSubsets(beta) {
  const total = beta[0] + beta[1] + beta[2] + beta[3];
  const shorts = [[]];
  for (let i = 0; i < 4; i++) {
    const rest = [];
    for (let n = 0; n < 4; n++) if (n !== i) rest.push(n);
    shorts.push(pickShort([i], rest, beta[i], total - beta[i]));
  }
  const pairs = [[0, 1], [0, 2], [0, 3]];
  for (let k = 0; k < 3; k++) {
    const p = pairs[k];
    const comp = [];
    for (let n = 0; n < 4; n++) if (p.indexOf(n) === -1) comp.push(n);
    const s = beta[p[0]] + beta[p[1]];
    shorts.push(pickShort(p, comp, s, total - s));
  }
  return shorts;
}

// The closed allowed interval for b_i with the other three weights held
// fixed, so that every tracked-chamber inequality still holds: a short
// subset I containing i forces sum_I <= sum_comp, i.e. b_i <= R - 2A
// (A = sum of I minus i, R = sum of the other three); a short I without i
// forces b_i >= 2A - R. The tightest of these bounds is exactly the
// closed chamber slice [prev, next] of betaInterval (the wall bounding
// the chamber above always belongs to a short subset containing i, and
// likewise below), so {lo, hi} is the drag range with wall contact
// ALLOWED. The 0 positivity wall stays hard: lo is raised to WALL_MARGIN
// unless that would empty the interval (degenerate pinches keep the
// chamber bound instead). Never returns lo > hi for an in-chamber beta,
// so callers need no pinch fallback.
export function chamberInterval(i, beta, shorts) {
  // R = sum of the OTHER three, accumulated directly: deriving it as
  // (total - beta[i]) would re-associate with beta[i] on every drag and
  // shift the bounds by ~1e-16, breaking the bit-exact idempotency that
  // applyBetaDrag promises.
  let R = 0;
  for (let n = 0; n < 4; n++) if (n !== i) R += beta[n];
  let lo = 0;
  let hi = Infinity;
  for (let k = 0; k < shorts.length; k++) {
    const I = shorts[k];
    let A = 0;
    for (let m = 0; m < I.length; m++) if (I[m] !== i) A += beta[I[m]];
    if (I.indexOf(i) !== -1) {
      const u = R - 2 * A;
      if (u < hi) hi = u;
    } else {
      const l = 2 * A - R;
      if (l > lo) lo = l;
    }
  }
  const hiEff = Math.min(hi, 1);
  const loEff = Math.min(Math.max(lo, WALL_MARGIN), hiEff);
  return { lo: loEff, hi: hiEff };
}

// Apply one beta-slider drag with the chamber LOCKED to `shorts` (the
// short-subset list recorded at load — see shortSubsets): slider i is
// dragged to raw value v, clamped into chamberInterval(i, beta, shorts).
// Mutates beta in place; ONLY beta[i] changes (the bounds depend on the
// other three weights alone), and the tuple stays in the closure of the
// tracked chamber: a wall may be touched (the binding inequality exactly
// at equality) but never crossed. Since the clamped value is a function
// of v and the untouched other legs, repeated calls with the same raw
// value are exact no-ops. Returns true if the raw value was clamped
// (pinned at a chamber wall or at the 0-wall floor), false if it landed
// strictly inside the allowed span.
export function applyBetaDrag(i, beta, v, shorts) {
  if (!Number.isFinite(v)) return false;
  const iv = chamberInterval(i, beta, shorts);
  const c = Math.min(Math.max(v, iv.lo), iv.hi);
  beta[i] = c;
  return c !== v;
}

// The tracked-chamber inequalities currently sitting exactly ON their
// wall (|sum_I - sum_comp| <= tol): the "breaking" inequalities the
// widget highlights, and the hooks for the future per-inequality flop
// (flopping split k means replacing shorts[k] by its complement). Slot 0
// (the trivial split) is never breaking for positive weights and is
// skipped.
export function breakingSubsets(beta, shorts, tol = 1e-9) {
  const out = [];
  for (let k = 1; k < shorts.length; k++) {
    const I = shorts[k];
    let sI = 0;
    let sC = 0;
    for (let n = 0; n < 4; n++) {
      if (I.indexOf(n) === -1) sC += beta[n];
      else sI += beta[n];
    }
    if (Math.abs(sI - sC) <= tol) out.push(I);
  }
  return out;
}