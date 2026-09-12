// Hyperpolygon widget: live three.js view of the su(2) polygon computed by ./solver.js.
// Loaded as an ES module after the vendored three.min.js and OrbitControls.js (global THREE).

import { makeHyperpolygon } from "./solver.js";
import { makeOrientor } from "./orientation.js";
import { shortSubsets, chamberInterval, applyBetaDrag } from "./chambers.js";

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
    "}",
    "#hyperpolygon-widget .hp-chamber-box.hp-breaking {",
    "  border-color: var(--hp-amber);",
    "  background: var(--hp-amber-bg);",
    "  color: var(--hp-amber);",
    "  font-weight: 600;",
    "}",
    "#hyperpolygon-widget .hp-chamber-box.hp-trivial {",
    "  opacity: 0.5;",
    "}",
    "#hyperpolygon-widget {",
    "  --hp-red: #e9c2bd;",
    "  --hp-track: #c9cdd4;",
    "  --hp-thumb: #5b6570;",
    "  --hp-box-bd: #cfd4da;",
    "  --hp-box-tx: #666e78;",
    "  --hp-amber: #9a6a1f;",
    "  --hp-amber-bg: #f4e8d0;",
    "}",
    '[data-theme="dark"] #hyperpolygon-widget {',
    "  --hp-red: #6b3630;",
    "  --hp-track: #454d59;",
    "  --hp-thumb: #a8b2bd;",
    "  --hp-box-bd: #4a525e;",
    "  --hp-box-tx: #a0a8b2;",
    "  --hp-amber: #d9a558;",
    "  --hp-amber-bg: #453519;",
    "}",
  ].join("\n");
  document.head.appendChild(style);
}

function activate(container) {
  ensureSliderStyles();
  // parabolic weights; the beta sliders stay inside ONE stability
  // chamber, fixed at load (see chambers.js)
  const beta = [1 / 6, 1 / 7, 1 / 7, 1 / 10];
  // The chamber is fixed at load to the one containing this initial beta,
  // recorded as its short subsets: the inequalities {I} < {complement}
  // displayed below. Beta drags are clamped into the chamber's closure —
  // a wall may be touched (the inequality's box highlights) but never
  // crossed, so dragging can never change the chamber. The highlighted
  // boxes are the hooks for the planned per-inequality "flop" action.
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
  const tInput = makeSlider("t", 0, 1, 0.01, 0.5, (v) =>
    v >= 1 ? "t→∞" : (v / (1 - v)).toFixed(2)
  );

  // beta sliders: one per parabolic weight, clamped into the FIXED
  // stability chamber (see chambers.js): dragging pins at a chamber wall
  // (the red boundary) and never crosses it. The blocked (red) spans at
  // the slider edges are the parts beyond the chamber, recomputed on
  // every change; the chamber inequalities themselves are displayed as
  // boxes below (chamberRow) and highlight when a wall is touched.
  const betaHeader = document.createElement("div");
  betaHeader.style.flex = "1 1 100%";
  betaHeader.style.marginTop = "4px";
  betaHeader.style.fontSize = "0.85em";
  betaHeader.textContent =
    "β — parabolic weights · red: past a chamber wall — dragging pins there; the chamber stays fixed";
  controlsRow.appendChild(betaHeader);

  const betaInputs = [];
  const betaReadouts = [];
  function makeBetaSlider(i) {
    const labels = ["β₀", "β₁", "β₂", "β₃"];
    const box = document.createElement("div");
    box.style.display = "flex";
    box.style.alignItems = "center";
    box.style.gap = "8px";
    box.style.flex = "1 1 170px";
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
    input.style.minWidth = "100px";
    const readout = document.createElement("span");
    readout.style.minWidth = "4.5em";
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
    controlsRow.appendChild(box);
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
    syncChamberBoxes();
  }

  for (let i = 0; i < 4; i++) {
    makeBetaSlider(i);
  }

  // chamber tracker: one box per inequality defining the fixed chamber,
  // in shortSubsets slot order (trivial split first, dimmed). A box turns
  // amber while its inequality sits exactly on a wall — the future "flop"
  // hook; the tooltip shows the two subset sums live.
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
  for (let k = 0; k < chamberShorts.length; k++) {
    const I = chamberShorts[k];
    const comp = [];
    for (let n = 0; n < 4; n++) if (I.indexOf(n) === -1) comp.push(n);
    const el = document.createElement("span");
    el.className = "hp-chamber-box" + (k === 0 ? " hp-trivial" : "");
    el.textContent = fmtSet(I) + " < " + fmtSet(comp);
    chamberRow.appendChild(el);
    chamberBoxes.push({ I: I, el: el, term: betaTerm(I), termC: betaTerm(comp) });
  }
  controlsRow.appendChild(chamberRow);

  function syncChamberBoxes() {
    for (let k = 0; k < chamberBoxes.length; k++) {
      const rec = chamberBoxes[k];
      let sI = 0;
      for (let m = 0; m < rec.I.length; m++) sI += beta[rec.I[m]];
      let sC = 0;
      for (let n = 0; n < 4; n++) if (rec.I.indexOf(n) === -1) sC += beta[n];
      rec.el.classList.toggle("hp-breaking", k > 0 && Math.abs(sC - sI) <= 1e-9);
      rec.el.title =
        rec.term + " = " + sI.toFixed(4) + " · " + rec.termC + " = " + sC.toFixed(4);
    }
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