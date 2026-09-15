// Hyperpolygon widget: live three.js view of the su(2) polygon computed by ./solver.js.
// Loaded as an ES module after the vendored three.min.js and OrbitControls.js (global THREE).

import { makeHyperpolygon, stratumPair, PERMUTE_23, starSlots, cycleSlots } from "./solver.js";
import { makeOrientor } from "./orientation.js";
import { shortSubsets, chamberInterval, applyBetaDrag, breakingSubsets } from "./chambers.js";
import { makeSideView, probeExteriorMap, attachmentRs, PERM } from "./sideview.js";

const T_SOLVE_MAX = 0.99;
const T1_SOLVE_MAX = 0.99;

const PALETTES = {
  light: {
    edgeA: 0xc0392b,
    edgeB: 0x2c5f8a,
    edgeYellow: 0xd9a800,
    axes: 0xb0b0b0,
    markers: 0x808080,
    border: "#d0d0d0",
    caption: "#666666",
    // side view (task 3, light-mode adaptation): pure white spheres are
    // invisible on the white page, so the central sphere and the ACTIVE
    // (highlighted) exterior sphere / stratum carry a blue-gray tint in
    // light mode; dark mode keeps the original white-on-dark look.
    sphere: 0xcdd7e2,
    sphereGrey: 0x93a5b8,
    ext: 0xb9c6d4,
    extHi: 0x8fa3ba,
    parab: 0x4a7fd6,
    arc: 0x9aa4b2,
    sideBg: null,
  },
  dark: {
    edgeA: 0xff6b5b,
    edgeB: 0x7ab3ff,
    edgeYellow: 0xffd84d,
    axes: 0x555f6e,
    markers: 0x9aa4b2,
    border: "#3a414b",
    caption: "#a0a0a0",
    sphere: 0xffffff,
    sphereGrey: 0xb0b0b0,
    ext: 0x9fb0c2,
    extHi: 0xffffff,
    parab: 0x5a92e0,
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
    // chamber panel (task 2): the beta weights, scale buttons and chamber
    // inequalities live in one bordered box
    "#hyperpolygon-widget .hp-panel {",
    "  border: 1px solid var(--hp-box-bd);",
    "  border-radius: 8px;",
    "  padding: 8px 10px 7px;",
    "  margin-top: 10px;",
    "}",
    // \vec{β} for the scale buttons: the combining-arrow codepoint
    // (U+03B2 + U+20D7) renders badly in most UI fonts, so the arrow is
    // drawn as a separate ::after glyph positioned above the β.
    "#hyperpolygon-widget .hp-vec {",
    "  position: relative;",
    "  display: inline-block;",
    "}",
    "#hyperpolygon-widget .hp-vec::after {",
    "  content: '\\2192';",
    "  position: absolute;",
    "  left: 50%;",
    "  top: -0.95em;",
    "  transform: translateX(-50%);",
    "  font-size: 0.55em;",
    "  line-height: 1;",
    "  pointer-events: none;",
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
    "  --hp-track: #c9cdd4;",
    "  --hp-thumb: #5b6570;",
    "  --hp-box-bd: #cfd4da;",
    "  --hp-box-tx: #666e78;",
    "  --hp-amber: #9a6a1f;",
    "  --hp-amber-bg: #f4e8d0;",
    "  --hp-btn-bd: #cfd4da;",
    "  --hp-btn-tx: #666e78;",
    "  --hp-yellow: #a67c00;",
    "  --hp-yellow-bg: #f6ecc2;",
    "  --hp-yellow-tx: #7a5c00;",
    "  --hp-pair-bg: rgba(255, 255, 255, 0.72);",
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
    "  --hp-yellow: #e8c84a;",
    "  --hp-yellow-bg: #453a19;",
    "  --hp-yellow-tx: #e8c84a;",
    "  --hp-pair-bg: rgba(20, 24, 30, 0.6);",
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
      for (let k = 0; k < 3; k++) extMap[k] = probed[k];
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
  const canvasBox = document.createElement("div");
  canvasBox.style.width = "100%";
  canvasBox.style.height = "420px";
  canvasBox.style.boxSizing = "border-box";
  canvasBox.style.position = "relative";
  container.appendChild(canvasBox);

  // Top-right overlay (task 1): the chamber's three short pairs, one row
  // per exterior sphere (south/equator/north at r = 0 / 0.5 / 1), each
  // naming the two leg vectors that pair indexes. A row turns yellow
  // while its two vectors are parallel — at the attachment point that
  // pair is exactly the straight one, so the list indexes the spheres.
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
  const SUBS = ["\u2080", "\u2081", "\u2082", "\u2083"];
  // side label for displayed leg j: the leg VECTOR v_j (from pts[2j] to
  // pts[2j+2]), not the vertices — user correction 2026-09-14; the four
  // vectors are v0..v3 and the bend points stay unlabeled.
  const sideName = (j) => "v" + SUBS[j];
  const attachTag = (k) => (k === 0 ? "r=0" : k === 1 ? "r=\u00bd" : "r=1");
  function rebuildPairList() {
    for (let k = 0; k < 3; k++) {
      const S = extMap[k];
      const I = S !== null && S !== undefined ? chamberShorts[S] : null;
      if (!I || I.length !== 2) {
        pairRows[k].textContent = attachTag(k) + ": \u2014";
        pairRows[k].classList.remove("hp-straight");
        pairRows[k].title = "exterior sphere at " + attachTag(k);
        continue;
      }
      pairRows[k].textContent =
        attachTag(k) + ": " + sideName(I[0]) + " \u2225 " + sideName(I[1]);
      pairRows[k].title =
        "short pair {" + I.join(",") + "} \u2014 indexes the exterior sphere at " + attachTag(k);
    }
  }
  rebuildPairList();

  // side view (task list #5): the (r, theta, t) moduli portrait — central
  // sphere + three exterior spheres + the flow dot; sideview.js owns the
  // scene, this widget only feeds it slider state
  const sideBox = document.createElement("div");
  sideBox.style.width = "100%";
  sideBox.style.height = "320px";
  sideBox.style.boxSizing = "border-box";
  sideBox.style.marginTop = "10px";
  container.appendChild(sideBox);

  // SL(2,C) view (task 2): the real and imaginary parts of the traceless
  // central moment map polygon (mu_SL, 3 + 3 = 6 real dimensions), drawn
  // as two small three.js canvases. Collapsed by default; the summary
  // toggles it. The U(1) phase gamma (the slider under t) rotates these
  // polygons coordinatewise; the su(2) polygon is unaffected by gamma.
  const slDetails = document.createElement("details");
  slDetails.style.marginTop = "10px";
  const slSummary = document.createElement("summary");
  slSummary.textContent = "show SL(2,\u2102) polygons";
  slSummary.style.cursor = "pointer";
  slSummary.style.fontSize = "0.9em";
  slDetails.appendChild(slSummary);
  const slRow = document.createElement("div");
  slRow.style.display = "flex";
  slRow.style.flexWrap = "wrap";
  slRow.style.gap = "10px";
  slRow.style.marginTop = "8px";
  slDetails.appendChild(slRow);
  container.appendChild(slDetails);

  const SL_SEG = 5; // 4 leg edges + the v4 -> v0 closing segment
  function makeSlView(tag) {
    const host = document.createElement("div");
    host.style.flex = "1 1 300px";
    host.style.height = "300px";
    host.style.minWidth = "240px";
    host.style.position = "relative";
    host.style.boxSizing = "border-box";
    host.style.border = "1px solid " + palette().border;
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
        host.style.border = "1px solid " + c;
      },
    };
  }
  const slRe = makeSlView("Re \u03bc\u209b\u2097");
  const slIm = makeSlView("Im \u03bc\u209b\u2097");
  // gamma = 0 base data from the last solve (res.sl2); the displayed
  // polygons are the e^{i·gamma} rotation of these
  let sl2Base = null;
  const SL_SEG_ENDS = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 0],
  ];
  // Rewrite both SL(2,C) canvases from sl2Base rotated by the current
  // gamma: each complex coordinate z (of Re and Im arrays) maps to
  // e^{i·gamma} z, i.e. real' = cos·real − sin·imag, imag' = sin·real +
  // cos·imag — coordinatewise, exactly the U(1) action on y. At gamma = 0
  // this writes the base data bit-exactly (cos 0 = 1, sin 0 = 0).
  function updateSlViews() {
    if (!sl2Base) return;
    const g = parseFloat(gammaInput.value) * Math.PI;
    const c = Math.cos(g);
    const s = Math.sin(g);
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

  // Chamber panel (task 2): the parabolic weights, their scale buttons and
  // the chamber inequalities grouped in one bordered box.
  const panel = document.createElement("div");
  panel.className = "hp-panel";
  container.appendChild(panel);

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

  // Edge labels (task 1): one sprite per displayed leg, drawn into a
  // canvas texture (crisp at any zoom, theme-colored via applyColors).
  // The sprite sits at the midpoint of the leg segment and names the leg
  // VECTOR v_j (j = 0..3); scale follows the polygon scale so the labels
  // shrink/grow with the drawing. The bend points stay unlabeled.
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
  const PAIR_SINE_TOL = 1e-3;
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
  // per-frame yellow overrides on the segment color buffer (base colors
  // were written by applyColors)
  function updateEdgeColors(now) {
    let touched = false;
    for (let p = 0; p < 6; p++) {
      let f = 0;
      if (legParallel[p]) {
        f = 1;
      } else if (p === blinkPair) {
        const ph = (now - blinkStart) / BLINK_PERIOD;
        if (ph >= 0 && ph < 1) f = Math.sin(Math.PI * ph);
        else blinkPair = -1;
      }
      if (f > 0) {
        const a = LEG_PAIRS[p][0];
        const b = LEG_PAIRS[p][1];
        const segs = [2 * a, 2 * b];
        for (let s = 0; s < 2; s++) {
          for (let k = 0; k < 2; k++) {
            const idx = (segs[s] * 2 + k) * 3;
            colArr[idx] += (yellowCol.r - colArr[idx]) * f;
            colArr[idx + 1] += (yellowCol.g - colArr[idx + 1]) * f;
            colArr[idx + 2] += (yellowCol.b - colArr[idx + 2]) * f;
          }
        }
        touched = true;
      }
    }
    if (touched) polyGeom.attributes.color.needsUpdate = true;
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
        // I-stratum solve: the doubly-straight closed form at (t1, beta).
        // The pair I is mapped through the same PERMUTE_23 pre-swap as the
        // pipeline path (solve indexing), and stratumPair's permute
        // argument applies the matching output swap so the displayed leg
        // j is user leg j under either flag setting.
        const t1c = Math.min(Math.max(parseFloat(t1Input.value), 0), T1_SOLVE_MAX);
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

    // Task 1: v-side parallelism. Each displayed leg's v-side direction
    // is the segment (pts[2j], pts[2j+1]); two legs are parallel when the
    // sine of the angle between their directions is ~0. Entering
    // parallelism fires one yellow blink; staying parallel (the straight
    // pair at an attachment snap) holds both v-sides solid yellow, and
    // the matching row in the top-right short-pair list highlights.
    const scale = Math.max.apply(
      null,
      pts.map((p) => Math.hypot(p[0], p[1], p[2]))
    );
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

    // Task 1: edge labels at the side midpoints, pushed away from the
    // polygon centroid
    let cen = [0, 0, 0];
    for (let i = 0; i < 9; i++) {
      cen[0] += pts[i][0];
      cen[1] += pts[i][1];
      cen[2] += pts[i][2];
    }
    cen = [cen[0] / 9, cen[1] / 9, cen[2] / 9];
    const labelScale = 0.07 * scale;
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
      const asp = sp.userData.aspect || 3;
      sp.scale.set(labelScale * asp, labelScale, 1);
      sp.visible = labelScale > 1e-4;
    }

    // Task 2/3: SL(2,C) base data + the gamma rotation
    sl2Base = res.sl2;
    updateSlViews();
    const closure = Math.hypot(pts[8][0], pts[8][1], pts[8][2]);
    let text =
      "su(2) residual " +
      res.accuracy.su2Norm.toExponential(1) +
      " · closure " +
      closure.toExponential(1);
    if (stratum) {
      text +=
        " · I-stratum {" +
        stratum.I.join(",") +
        "} ∥ {" +
        stratum.comp.join(",") +
        "} · t\u2081 = " +
        parseFloat(t1Input.value).toFixed(2);
    }
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

  function makeSlider(label, min, max, step, value, format, snaps = [], noSolve = false) {
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
      // noSolve sliders (gamma) drive only display-side updates — they
      // must never trigger a solver run (rescue paths can cost 100 ms)
      if (!noSolve) scheduleSolve();
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
  // I-stratum mode (the "lim t→∞" click): while active, the r/θ/t sliders
  // are parked and disabled at the attachment point, the solve comes from
  // stratumPair (the doubly-straight closed form), and this t1 slider
  // drives the stratum family: t1 = 0 is the tip slice (two nonzero y
  // rows), growing t1 lifts the remaining rows (M = M0 (1 + t1/(1-t1))).
  let stratum = null; // { k, S, I, comp } while active
  let tBeforeStratum = 0.9;
  const t1Input = makeSlider(
    "t\u2081",
    0,
    1,
    0.005,
    0,
    (v) => (v >= 1 ? "t\u2081\u2192\u221e" : (v / (1 - v)).toFixed(2)),
    [{ value: 0, tol: 0.01 }]
  );
  t1Input.title =
    "stratum parameter: t\u2081 = 0 is the tip slice (only the short pair's y rows nonzero); growing t\u2081 lifts the remaining rows";
  t1Input.parentNode.style.display = "none";
  // gamma (task 3): the U(1) phase e^{i·gamma} acting on y. Moment-map
  // preserving; fixes the su(2) polygon (|y|^2 and y†y are phase-
  // invariant), rotates the SL(2,C) polygons coordinatewise, and in the
  // side view rotates the dot along the level circles of the exterior
  // spheres / paraboloids. t = 0 points are fixed (attachment points and
  // the apex are on the rotation axes), matching the moduli picture.
  const gammaInput = makeSlider(
    "γ",
    -1,
    1,
    0.005,
    0,
    (v) => (v >= 1 ? "π" : v <= -1 ? "-π" : (v * Math.PI).toFixed(2)),
    [{ value: 0, tol: 0.03 }],
    true
  );
  gammaInput.title =
    "U(1) phase e^{i\u03b3} on y \u2014 rotates the SL(2,\u2102) polygons and the " +
    "side-view dot along level circles; t = 0 points are fixed";
  gammaInput.addEventListener("input", () => {
    updateSlViews();
    refreshSide();
  });

  // "lim t→∞" (spec item 5, now implemented): while the dot is on an
  // exterior sphere near the t -> infinity end (flowState.nearInfinity,
  // t >= 0.9) the button enters the I-stratum of that sphere's short pair:
  // the r/θ/t sliders park at the attachment, a t1 slider appears, the
  // solve switches to stratumPair, and the side view draws the stratum
  // paraboloid at the sphere's tip (highlight-white). Clicking again
  // leaves (t restores to its pre-entry value).
  const limBtn = document.createElement("button");
  limBtn.type = "button";
  limBtn.className = "hp-btn";
  limBtn.textContent = "lim t\u2192\u221e";
  limBtn.style.display = "none";
  limBtn.title = "enter the I-stratum (the tip of this exterior sphere)";
  function attachmentIndexOfDot() {
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
    tBeforeStratum = parseFloat(tInput.value);
    stratum = { k: k, S: S, I: I, comp: comp };
    rInput.disabled = true;
    thetaInput.disabled = true;
    tInput.disabled = true;
    tInput.value = "1";
    tInput.dispatchEvent(new Event("input"));
    t1Input.parentNode.style.display = "";
    limBtn.textContent = "leave stratum";
    limBtn.title = "leave the stratum (return to the exterior sphere)";
    scheduleSolve();
    refreshSide();
  }
  function leaveStratum() {
    stratum = null;
    rInput.disabled = false;
    thetaInput.disabled = false;
    tInput.disabled = false;
    t1Input.value = "0";
    t1Input.dispatchEvent(new Event("input"));
    t1Input.parentNode.style.display = "none";
    tInput.value = String(Math.min(Math.max(tBeforeStratum, 0), 1));
    tInput.dispatchEvent(new Event("input"));
    limBtn.textContent = "lim t\u2192\u221e";
    limBtn.title = "enter the I-stratum (the tip of this exterior sphere)";
    scheduleSolve();
    refreshSide();
  }
  limBtn.addEventListener("click", () => {
    if (stratum) leaveStratum();
    else enterStratum();
  });
  tInput.parentNode.appendChild(limBtn);

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
    const gamma = parseFloat(gammaInput.value) * Math.PI;
    const t1 = stratum ? parseFloat(t1Input.value) : 0;
    const st = sideView.update(
      r,
      theta,
      t,
      beta,
      chamberShorts,
      extMap,
      tHover || t > 0,
      gamma,
      stratum ? { k: stratum.k, t1: t1 } : null
    );
    // the button shows near the t -> infinity end of an exterior sphere,
    // and STAYS while the stratum is active (it becomes "leave stratum")
    limBtn.style.display = st && (st.nearInfinity || stratum) ? "" : "none";
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

  // beta sliders: the red spans at the slider edges are the parts beyond
  // the fixed chamber's walls, recomputed on every change (see
  // chamberShorts above)
  const betaHeader = document.createElement("div");
  betaHeader.style.flex = "1 1 100%";
  betaHeader.style.marginTop = "2px";
  betaHeader.style.fontSize = "0.85em";
  betaHeader.textContent =
    "β — parabolic weights · red: past a chamber wall — dragging pins there; the chamber stays fixed · an amber box's Cross Wall button flips that inequality";
  panel.appendChild(betaHeader);

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
  panel.appendChild(betaRow);
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
  // tuple. Factors are SUBTLE by design (user request 2026-09-13 — the old
  // x0.25 / up-to-x4 steps maxed weights out in one click): down x0.8, up
  // x1.25, clamped to 1/max so the largest weight lands exactly on the
  // slider limit 1.0 (pinned exactly — x*(1/x) can land 1 ulp off). The
  // Scale Down floor 0.02 exists because chamberInterval's hard
  // WALL_MARGIN = 0.003 0-wall floor collapses the displayed allowed spans
  // once the tuple scale approaches ~2*WALL_MARGIN (the solver itself is
  // scale-robust far below that).
  const SCALE_UP_FACTOR = 1.25;
  const SCALE_DOWN_FACTOR = 0.8;
  const SCALE_DOWN_MIN = 0.02;
  const scaleRow = document.createElement("div");
  scaleRow.style.flex = "1 1 100%";
  scaleRow.style.display = "flex";
  scaleRow.style.gap = "8px";
  scaleRow.style.marginTop = "8px";
  // \vec{β} via the .hp-vec CSS overarrow (the combining codepoint renders
  // badly); extra top padding clears the arrow above the button label
  function vecBeta() {
    const s = document.createElement("span");
    s.className = "hp-vec";
    s.textContent = "\u03b2";
    return s;
  }
  const scaleDownBtn = document.createElement("button");
  scaleDownBtn.type = "button";
  scaleDownBtn.className = "hp-btn";
  scaleDownBtn.style.paddingTop = "5px";
  scaleDownBtn.append("Scale ", vecBeta(), " Down");
  const scaleUpBtn = document.createElement("button");
  scaleUpBtn.type = "button";
  scaleUpBtn.className = "hp-btn";
  scaleUpBtn.style.paddingTop = "5px";
  scaleUpBtn.append("Scale ", vecBeta(), " Up");
  scaleRow.appendChild(scaleDownBtn);
  scaleRow.appendChild(scaleUpBtn);
  panel.appendChild(scaleRow);

  function syncScaleButtons() {
    let mx = 0;
    for (let i = 0; i < 4; i++) if (beta[i] > mx) mx = beta[i];
    scaleUpBtn.disabled = mx >= 1 - 1e-12;
    scaleDownBtn.disabled = mx * SCALE_DOWN_FACTOR < SCALE_DOWN_MIN;
  }

  scaleDownBtn.addEventListener("click", () => {
    if (scaleDownBtn.disabled) return;
    for (let i = 0; i < 4; i++) beta[i] *= SCALE_DOWN_FACTOR;
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
    const f = Math.min(SCALE_UP_FACTOR, 1 / mx);
    for (let i = 0; i < 4; i++) beta[i] *= f;
    // when the factor was clamped to 1/max, x * (1/x) can land 1 ulp off
    // 1.0, so pin the largest weight exactly
    if (f === 1 / mx) beta[arg] = 1;
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
    // a wall crossing can invalidate the stratum (the flopped split's
    // short side changes) — leave the stratum first
    if (stratum) leaveStratum();
    const I = chamberShorts[k];
    const comp = [];
    for (let n = 0; n < 4; n++) if (I.indexOf(n) === -1) comp.push(n);
    chamberShorts[k] = comp;
    nudgeAcross(I, comp);
    // the exterior-sphere <-> short-pair correspondence is chamber-
    // dependent: re-probe the attachment map for the NEW chamber and
    // rebuild the top-right pair list (task 1)
    fillExtMap();
    rebuildPairList();
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
      refreshSide();
    }
    if (lastVerts) {
      const q = orientor.update(lastVerts, dt, { idle: now - lastInput > 250 });
      polyGroup.quaternion.set(q[0], q[1], q[2], q[3]);
    }
    // yellow edge overrides (straight pair solid, blink pulse decaying)
    updateEdgeColors(now);
    controls.update();
    renderer.render(scene, camera);
    // SL(2,C) views render only while expanded (task 2)
    if (slDetails.open) {
      for (const view of [slRe, slIm]) {
        view.controls.update();
        view.renderer.render(view.scene, view.camera);
      }
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