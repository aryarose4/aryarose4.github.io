// Hyperpolygon widget: live three.js view of the su(2) polygon computed by ./solver.js.
// Loaded as an ES module after the vendored three.min.js and OrbitControls.js (global THREE).

import { makeHyperpolygon } from "./solver.js";
import { makeOrientor } from "./orientation.js";
import { shortSubsets, chamberInterval, applyBetaDrag, breakingSubsets } from "./chambers.js";

const T_SOLVE_MAX = 0.99;

const PALETTES = {
  light: { edgeA: 0xc0392b, edgeB: 0x2c5f8a, axes: 0xb0b0b0, markers: 0x808080, border: "#d0d0d0", caption: "#666666" },
  dark: { edgeA: 0xff6b5b, edgeB: 0x7ab3ff, axes: 0x555f6e, markers: 0x9aa4b2, border: "#3a414b", caption: "#a0a0a0" },
};

function isDark() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function palette() {
  return PALETTES[isDark() ? "dark" : "light"];
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
    "#hyperpolygon-widget .hp-cross-btn {",
    "  padding: 0 6px;",
    "  font-size: 0.75em;",
    "  border-color: var(--hp-amber);",
    "  color: var(--hp-amber);",
    "}",
    "#hyperpolygon-widget {",
    "  --hp-red: #e9c2bd;",
    "  --hp-track: #c9cdd4;",
    "  --hp-thumb: #5b6570;",
    "  --hp-box-bd: #cfd4da;",
    "  --hp-box-tx: #666e78;",
    "  --hp-amber: #9a6a1f;",
    "  --hp-amber-bg: #f4e8d0;",
    "  --hp-btn-bd: #cfd4da;",
    "  --hp-btn-tx: #666e78;",
    "}",
    '[data-theme="dark"] #hyperpolygon-widget {',
    "  --hp-red: #6b3630;",
    "  --hp-track: #454d59;",
    "  --hp-thumb: #a8b2bd;",
    "  --hp-box-bd: #4a525e;",
    "  --hp-box-tx: #a0a8b2;",
    "  --hp-amber: #d9a558;",
    "  --hp-amber-bg: #453519;",
    "  --hp-btn-bd: #4a525e;",
    "  --hp-btn-tx: #a0a8b2;",
    "}",
  ].join("\n");
  document.head.appendChild(style);
}

function activate(container) {
  ensureSliderStyles();
  // parabolic weights; the beta sliders stay inside ONE stability
  // chamber, fixed at load (chamber model: chambers.js)
  const beta = [0.5, 0.5, 0.5, 0.25];
  // the chamber of the initial beta, recorded as its short subsets — the
  // {I} < {complement} inequalities shown as boxes below. applyBetaDrag
  // clamps every drag into the chamber's closure (walls may be touched,
  // never crossed), so dragging can never change the chamber; the amber
  // box highlight is the hook for the planned per-inequality "flop".
  const chamberShorts = shortSubsets(beta);
  const canvasBox = document.createElement("div");
  canvasBox.style.width = "100%";
  canvasBox.style.height = "420px";
  canvasBox.style.boxSizing = "border-box";
  container.appendChild(canvasBox);

  const controlsRow = document.createElement("div");
  controlsRow.style.display = "flex";
  controlsRow.style.flexWrap = "wrap";
  controlsRow.style.gap = "16px";
  controlsRow.style.marginTop = "10px";
  container.appendChild(controlsRow);

  const caption = document.createElement("div");
  caption.style.marginTop = "6px";
  caption.style.fontSize = "0.85em";
  container.appendChild(caption);

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

  const posArr = new Float32Array(16 * 3);
  const colArr = new Float32Array(16 * 3);
  const polyGeom = new THREE.BufferGeometry();
  polyGeom.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
  polyGeom.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
  const polyMat = new THREE.LineBasicMaterial({ vertexColors: true });

  // the polygon lives in its own group so the display orientation can be
  // re-aligned every frame without touching the world-fixed axes
  const polyGroup = new THREE.Group();
  scene.add(polyGroup);
  polyGroup.add(new THREE.LineSegments(polyGeom, polyMat));

  const markPos = new Float32Array(9 * 3);
  const markGeom = new THREE.BufferGeometry();
  markGeom.setAttribute("position", new THREE.BufferAttribute(markPos, 3));
  const markMat = new THREE.PointsMaterial({ size: 4, sizeAttenuation: false });
  polyGroup.add(new THREE.Points(markGeom, markMat));

  const orientor = makeOrientor();
  let lastVerts = null;
  let lastInput = -1e9;
  let lastFrame = performance.now();

  const colA = new THREE.Color();
  const colB = new THREE.Color();

  function applyColors() {
    const pal = palette();
    axesMat.color.setHex(pal.axes);
    markMat.color.setHex(pal.markers);
    colA.setHex(pal.edgeA);
    colB.setHex(pal.edgeB);
    for (let seg = 0; seg < 8; seg++) {
      const c = seg % 2 === 0 ? colA : colB;
      for (let k = 0; k < 2; k++) {
        const idx = (seg * 2 + k) * 3;
        colArr[idx] = c.r;
        colArr[idx + 1] = c.g;
        colArr[idx + 2] = c.b;
      }
    }
    polyGeom.attributes.color.needsUpdate = true;
    canvasBox.style.border = "1px solid " + pal.border;
    caption.style.color = pal.caption;
    betaHeader.style.color = pal.caption;
    chamberLabel.style.color = pal.caption;
  }

  function solveAndDraw() {
    const r = parseFloat(rInput.value);
    const theta = parseFloat(thetaInput.value) * Math.PI;
    const t = Math.min(parseFloat(tInput.value), T_SOLVE_MAX);
    // Solve with legs 2 and 3 pre-swapped: makeHyperpolygon(permute=true)
    // returns the leg-2<->3-swapped pair, which then satisfies the moment
    // map equations for the user's beta even when beta2 != beta3 (see
    // solver.js). When beta2 = beta3 this call is identical to passing
    // beta directly, preserving the historical default view.
    const betaSolve = [beta[0], beta[1], beta[3], beta[2]];
    let res = null;
    try {
      res = makeHyperpolygon(r, theta, t, betaSolve, true);
    } catch (err) {
      res = null;
    }
    if (!res || !Number.isFinite(res.accuracy.su2Norm)) {
      caption.textContent = "⚠ solver failed at this parameter point";
      return;
    }
    const pts = res.vertices;
    lastVerts = pts;
    for (let seg = 0; seg < 8; seg++) {
      for (let k = 0; k < 2; k++) {
        const p = pts[seg + k];
        const idx = (seg * 2 + k) * 3;
        posArr[idx] = p[0];
        posArr[idx + 1] = p[1];
        posArr[idx + 2] = p[2];
      }
    }
    polyGeom.attributes.position.needsUpdate = true;
    for (let i = 0; i < 9; i++) {
      markPos[i * 3] = pts[i][0];
      markPos[i * 3 + 1] = pts[i][1];
      markPos[i * 3 + 2] = pts[i][2];
    }
    markGeom.attributes.position.needsUpdate = true;
    applyColors();
    const closure = Math.hypot(pts[8][0], pts[8][1], pts[8][2]);
    let text =
      "su(2) residual " +
      res.accuracy.su2Norm.toExponential(1) +
      " · closure " +
      closure.toExponential(1);
    if (
      !Number.isFinite(closure) ||
      res.accuracy.su2Norm > 1e-6 ||
      res.accuracy.muU1Error > 1e-6
    ) {
      text += " · ⚠ degraded";
    }
    caption.textContent = text;
  }

  let pending = true;
  function scheduleSolve() {
    lastInput = performance.now();
    pending = true;
  }

  function makeSlider(label, min, max, step, value, format, snaps = []) {
    const box = document.createElement("div");
    box.style.display = "flex";
    box.style.alignItems = "center";
    box.style.gap = "8px";
    box.style.flex = "1 1 220px";
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
      scheduleSolve();
    });
    box.appendChild(lab);
    box.appendChild(input);
    box.appendChild(readout);
    controlsRow.appendChild(box);
    return input;
  }

  const rInput = makeSlider("r", 0, 1, 0.005, 0.5, (v) => v.toFixed(3), [
    { value: 0.5, tol: 0.02 },
  ]);
  const thetaInput = makeSlider(
    "θ",
    -1,
    1,
    0.005,
    0,
    (v) => (v >= 1 ? "π" : v <= -1 ? "-π" : (v * Math.PI).toFixed(2)),
    [{ value: 0, tol: 0.03 }]
  );
  const tInput = makeSlider("t", 0, 1, 0.01, 0, (v) =>
    v >= 1 ? "t→∞" : (v / (1 - v)).toFixed(2)
  );

  // beta sliders: the red spans at the slider edges are the parts beyond
  // the fixed chamber's walls, recomputed on every change (see
  // chamberShorts above)
  const betaHeader = document.createElement("div");
  betaHeader.style.flex = "1 1 100%";
  betaHeader.style.marginTop = "4px";
  betaHeader.style.fontSize = "0.85em";
  betaHeader.textContent =
    "β — parabolic weights · red: past a chamber wall — dragging pins there; the chamber stays fixed · an amber box's Cross Wall button flips that inequality";
  controlsRow.appendChild(betaHeader);

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
  controlsRow.appendChild(betaRow);
  function pickBetaColumns() {
    const w = betaRow.clientWidth;
    const cols = w >= 700 ? 4 : w >= 340 ? 2 : 1;
    betaRow.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
  }
  new ResizeObserver(pickBetaColumns).observe(betaRow);

  const betaInputs = [];
  const betaReadouts = [];
  function makeBetaSlider(i) {
    const labels = ["β₀", "β₁", "β₂", "β₃"];
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
    syncScaleButtons();
    syncChamberBoxes();
  }

  for (let i = 0; i < 4; i++) {
    makeBetaSlider(i);
  }

  // scale buttons: chambers are scale-invariant (the wall inequalities are
  // homogeneous in beta), so uniform scaling never crosses a wall — no
  // clamping is needed, the whole state is just re-synced from the scaled
  // tuple. 0.25 and 4 are powers of two, so down-scaling and the unclamped
  // part of up-scaling are fp-exact; up-scaling clamps the factor to
  // 1/max(beta) so the tuple scales exactly until the largest weight
  // equals 1.0 (the slider limit). The Scale Down floor 0.02 exists
  // because chamberInterval's hard WALL_MARGIN = 0.003 0-wall floor
  // collapses the displayed allowed spans once the tuple scale approaches
  // ~2*WALL_MARGIN (the solver itself is scale-robust far below that).
  const SCALE_DOWN_MIN = 0.02;
  const scaleRow = document.createElement("div");
  scaleRow.style.flex = "1 1 100%";
  scaleRow.style.display = "flex";
  scaleRow.style.gap = "8px";
  scaleRow.style.marginTop = "6px";
  const scaleDownBtn = document.createElement("button");
  scaleDownBtn.type = "button";
  scaleDownBtn.className = "hp-btn";
  scaleDownBtn.textContent = "Scale \u03b2\u20d7 Down";
  const scaleUpBtn = document.createElement("button");
  scaleUpBtn.type = "button";
  scaleUpBtn.className = "hp-btn";
  scaleUpBtn.textContent = "Scale \u03b2\u20d7 Up";
  scaleRow.appendChild(scaleDownBtn);
  scaleRow.appendChild(scaleUpBtn);
  controlsRow.appendChild(scaleRow);

  function syncScaleButtons() {
    let mx = 0;
    for (let i = 0; i < 4; i++) if (beta[i] > mx) mx = beta[i];
    scaleUpBtn.disabled = mx >= 1 - 1e-12;
    scaleDownBtn.disabled = mx * 0.25 < SCALE_DOWN_MIN;
  }

  scaleDownBtn.addEventListener("click", () => {
    if (scaleDownBtn.disabled) return;
    for (let i = 0; i < 4; i++) beta[i] *= 0.25;
    syncBetaSliders();
    scheduleSolve();
  });
  scaleUpBtn.addEventListener("click", () => {
    if (scaleUpBtn.disabled) return;
    let mx = 0;
    let arg = 0;
    for (let i = 0; i < 4; i++)
      if (beta[i] > mx) {
        mx = beta[i];
        arg = i;
      }
    const f = Math.min(4, 1 / mx);
    for (let i = 0; i < 4; i++) beta[i] *= f;
    // x * (1/x) can land 1 ulp off 1.0, so pin the largest weight exactly
    beta[arg] = 1;
    syncBetaSliders();
    scheduleSolve();
  });

  // one box per tracked inequality (shortSubsets slot order, the trivial
  // split omitted); amber while its wall is touched, tooltip shows the
  // live subset sums
  const SUB = ["₀", "₁", "₂", "₃"];
  const fmtSet = (I) => "{" + I.join(",") + "}";
  const betaTerm = (I) =>
    I.length === 0 ? "0" : I.map((n) => "β" + SUB[n]).join("+");
  const chamberRow = document.createElement("div");
  chamberRow.style.flex = "1 1 100%";
  chamberRow.style.display = "flex";
  chamberRow.style.flexWrap = "wrap";
  chamberRow.style.alignItems = "center";
  chamberRow.style.gap = "6px";
  chamberRow.style.marginTop = "2px";
  const chamberLabel = document.createElement("span");
  chamberLabel.style.fontSize = "0.85em";
  chamberLabel.textContent = "chamber (fixed):";
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
  controlsRow.appendChild(chamberRow);

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

  // true when the tuple sits inside the closure of the tracked chamber
  // (every leg within its closed chamberInterval, tolerance for fp noise)
  function inTrackedChamber(t) {
    for (let i = 0; i < 4; i++) {
      const iv = chamberInterval(i, t, chamberShorts);
      if (t[i] < iv.lo - 1e-12 || t[i] > iv.hi + 1e-12) return false;
    }
    return true;
  }

  // push beta across the just-flopped wall into the NEW chamber: the old
  // short subset I had sum_I === sum_complement; grow the legs of I by
  // eps in total (sequential fill, bounded by the slider max 1) so
  // sum_I - sum_C becomes positive, or — if the legs of I have no room —
  // shrink the complement legs by eps instead. Growing one leg at a time
  // (rather than uniformly) matters at coincident walls: growing all legs
  // of I by the same amount slides along a coincident pair wall and keeps
  // it breaking. eps halves while the candidate leaves the new chamber
  // (other walls, the 0-wall floor, the slider limits); if nothing fits
  // (fully pinched corner) the nudge is skipped and beta stays on the
  // wall. Mutates beta in place.
  function nudgeAcross(I, comp) {
    let eps = 0.05 * Math.max(beta[0], beta[1], beta[2], beta[3]);
    for (let attempt = 0; attempt < 8 && eps > 1e-9; attempt++) {
      const up = beta.slice();
      let remaining = eps;
      for (let m = 0; m < I.length && remaining > 0; m++) {
        const n = I[m];
        const d = Math.min(remaining, Math.max(1 - up[n], 0));
        up[n] += d;
        remaining -= d;
      }
      if (remaining < eps) {
        let sI = 0;
        let sC = 0;
        for (let m = 0; m < I.length; m++) sI += up[I[m]];
        for (let n = 0; n < 4; n++) if (I.indexOf(n) === -1) sC += up[n];
        if (sI - sC > 1e-12 && inTrackedChamber(up)) {
          for (let i = 0; i < 4; i++) beta[i] = up[i];
          return true;
        }
      }
      const down = beta.slice();
      remaining = eps;
      for (let m = 0; m < comp.length && remaining > 0; m++) {
        const n = comp[m];
        const d = Math.min(remaining, Math.max(down[n], 0));
        down[n] -= d;
        remaining -= d;
      }
      if (remaining < eps) {
        let sI = 0;
        let sC = 0;
        for (let m = 0; m < I.length; m++) sI += down[I[m]];
        for (let n = 0; n < 4; n++) if (I.indexOf(n) === -1) sC += down[n];
        if (sI - sC > 1e-12 && inTrackedChamber(down)) {
          for (let i = 0; i < 4; i++) beta[i] = down[i];
          return true;
        }
      }
      eps *= 0.5;
    }
    return false;
  }

  // the Cross Wall action on box k: flop split k (chamberShorts[k] is
  // replaced by its complement — the tracked chamber moves to the one on
  // the other side of that wall), nudge beta across the wall into the new
  // chamber, re-sync everything and re-solve. The flopped inequality is no
  // longer at equality after a successful nudge, so the box un-highlights;
  // dragging back to the wall re-highlights it and allows crossing back.
  function crossWall(k) {
    const I = chamberShorts[k];
    const comp = [];
    for (let n = 0; n < 4; n++) if (I.indexOf(n) === -1) comp.push(n);
    chamberShorts[k] = comp;
    nudgeAcross(I, comp);
    rebuildChamberBoxes();
    syncBetaSliders();
    scheduleSolve();
  }

  syncBetaSliders();

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

  new MutationObserver(applyColors).observe(document.documentElement, {
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
    }
    if (lastVerts) {
      const q = orientor.update(lastVerts, dt, { idle: now - lastInput > 250 });
      polyGroup.quaternion.set(q[0], q[1], q[2], q[3]);
    }
    controls.update();
    renderer.render(scene, camera);
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