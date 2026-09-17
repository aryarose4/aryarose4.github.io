// Tutorial (task 24, milestone 2): a game-like guided tour of the widget.
// Dependency-free ES module, statically imported by widget.js but
// instantiated ONLY on the "Tutorial" button click — nothing here binds,
// subscribes or renders before that. The state machine drives the widget's
// control-gating registry (setGate) and subscribes one function to the
// widget's frame hook for task predicates, the live task line and card
// anchoring. NO solver coupling whatsoever.
//
// Lesson plan (complete, 2026-09-17): every lesson's task gates the Next
// button (Skip is gone — progression requires completion):
//   0 Welcome — the widget shows ONE point of the moduli space.
//   1 The moduli space is a space — sweep r, then theta.
//   2 The t direction — generic position, then inflate via t.
//   3 North pole — reset t, r -> 1, t up again (ordered sub-tasks).
//   4 phi — the gauge phase on y; the polygon does not move.
//   5 Stability data — drag a beta slider to a chamber wall (amber box).
//   6 Wall-crossing — Cross Wall (locked until THIS lesson) at a wall.
//   7 Strata — lim t->infinity entry, climb, leave (lim locked until here).
//   8 Free play / recap — everything unlocked.
//
// Card docking (user request 2026-09-17: the card must never block the
// sliders a task needs): the card docks BELOW the anchor's OWNING panel —
// the Moduli Coordinates panel for r/theta/t/phi/lim, the Parameters card
// for the beta sliders and Cross Wall — with the container's bottom
// padding reserved to the card's height, so there is always room below the
// content and no control is ever covered. Below ~700px container width it
// becomes a full-width bottom dock in the same reserved band; placeholder
// lessons without an anchor fall back to the top-right corner dock.
//
// Progress is session-only; exit restores the free-play default state
// (r = 0.25, default beta, all controls enabled, stratum left).

export function makeTutorial(ctx) {
  const controls = ctx.controls;
  const hooks = ctx.hooks;
  const setGate = ctx.setGate;
  const container = ctx.container;

  // ---- lesson data -------------------------------------------------------
  // controls: gated ids enabled during the lesson (UNION with `unlocked`);
  // highlight: which control gets the accent ring (or null); anchor: gate id
  // to anchor the card near (null = corner dock); predicate(controls) ->
  // task complete. init(controls) optionally (re)sets per-lesson task state
  // (called on every entry, incl. Back). Every lesson that has a task gates
  // Next on it (tasks 2-3, 2026-09-17); Skip is gone — progression requires
  // completion. Cross Wall stays locked until the wall-crossing lesson
  // (user request 4), lim until the strata lesson.
  const LESSONS = [
    {
      id: "welcome",
      title: "Welcome",
      body:
        "This widget shows ONE point of a moduli space: the matrices x, y " +
        "are a stable pair, balanced by the moment map. The sliders are " +
        "coordinates on that space. Only r and \u03b8 are unlocked for now.",
      controls: ["r", "theta"],
      highlight: "r",
      anchor: "r",
      task: null,
    },
    {
      id: "space",
      title: "The moduli space is a space",
      body:
        "Each (r, \u03b8) labels one point: sliding them walks the moduli " +
        "space. Drag r up to 0.5, then bring \u03b8 to 0.",
      controls: ["r", "theta"],
      highlight: "r",
      anchor: "r",
      task: "sweep",
      predicate: (c) =>
        parseFloat(c.rInput.value) >= 0.49 && Math.abs(parseFloat(c.thetaInput.value)) <= 0.01,
    },
    {
      id: "tdir",
      title: "The t direction",
      body:
        "Put the dot in a generic position (nudge r or \u03b8 off the " +
        "attachments 0, 0.5, 1 if you are on one), then scale t up to " +
        "0.99: the polygon inflates and the dot climbs its paraboloid.",
      controls: ["r", "theta", "t"],
      highlight: "t",
      anchor: "t",
      task: "sweep",
      taskText: "t \u2192 0.99",
      predicate: (c) => parseFloat(c.tInput.value) >= 0.98,
    },
    {
      id: "r1",
      title: "Back to zero, then the north pole",
      body:
        "Reset t = 0. Then move r all the way to 1 \u2014 the north " +
        "attachment \u2014 and scale t up again.",
      controls: ["r", "theta", "t"],
      highlight: "r",
      anchor: "r",
      task: "r1",
      predicate: r1Predicate,
    },
    {
      id: "phi",
      title: "What \u03c6 does",
      body:
        "\u03c6 applies a gauge phase e\u2071\u03c6 to the y matrix itself: " +
        "watch the y readout rotate while the polygon and the residuals " +
        "stay put \u2014 the display always shows the unique balanced " +
        "representative. Swing \u03c6 by at least \u03c0/2.",
      controls: ["r", "theta", "t", "phi"],
      highlight: "phi",
      anchor: "phi",
      task: "phi",
      predicate: phiPredicate,
    },
    {
      id: "beta",
      title: "Stability data: \u03b2",
      body:
        "The four \u03b2 sliders are stability data: they decide which " +
        "representations count as stable. The widget keeps them inside ONE " +
        "chamber \u2014 drags clamp at a wall, never cross it. Drag any " +
        "\u03b2 slider to a red-zone end until an inequality turns amber.",
      controls: ["r", "theta", "t", "beta0", "beta1", "beta2", "beta3"],
      highlight: "beta0",
      anchor: "beta0",
      task: "wall",
      predicate: anyBreaking,
    },
    {
      id: "wall",
      title: "Wall-crossing",
      body:
        "The amber box is a wall of your chamber: there two legs become " +
        "parallel, and the chambers on either side are different moduli " +
        "spaces glued along it. Cross Wall flops to the other chamber at " +
        "the same \u03b2. If no box is amber, drag a \u03b2 slider to a " +
        "wall first \u2014 then press Cross Wall.",
      controls: ["r", "theta", "t", "beta0", "beta1", "beta2", "beta3", "cross"],
      highlight: "cross",
      anchor: "cross",
      task: "cross",
      predicate: crossPredicate,
    },
    {
      id: "strata",
      title: "Strata & the side view",
      body:
        "Snap to an attachment (r = 0, 0.5 or 1, \u03b8 = 0), raise t past " +
        "0.9 and press lim t\u2192\u221e: the dot climbs the stratum " +
        "paraboloid \u2014 the doubly-parallel degenerate pair at " +
        "t = \u221e. Climb near the rim, then drag t back down to leave.",
      controls: [
        "r", "theta", "t", "beta0", "beta1", "beta2", "beta3", "cross", "lim",
      ],
      highlight: "lim",
      anchor: "lim",
      task: "strata",
      predicate: strataPredicate,
    },
    {
      id: "recap",
      title: "Free play",
      body:
        "That is the whole picture: (r, \u03b8) move you on the central " +
        "sphere, t scales the pair toward infinity, \u03b2 picks the " +
        "chamber, walls connect chambers, and the exterior spheres + strata " +
        "show the t = \u221e side of it all. Everything is unlocked \u2014 " +
        "explore freely.",
      all: true, // free play: every control enabled (setGate(null))
      controls: null,
      highlight: null,
      anchor: null,
    },
  ];

  // ---- task predicates (stateful ones keep their state on the lesson
  // object; enterLesson re-inits it) ---------------------------------------
  function r1Predicate(c) {
    const st = LESSONS[3];
    const t = parseFloat(c.tInput.value);
    const r = parseFloat(c.rInput.value);
    if (st._phase === undefined) st._phase = 0;
    if (st._phase === 0 && t <= 0.01) st._phase = 1;
    if (st._phase === 1 && r >= 0.95) st._phase = 2;
    return st._phase === 2 && t >= 0.98;
  }
  function phiPredicate(c) {
    const st = LESSONS[4];
    if (st._start === undefined) st._start = parseFloat(c.phiInput.value);
    return Math.abs(parseFloat(c.phiInput.value) - st._start) >= 0.5;
  }
  function crossPredicate(c) {
    const st = LESSONS[6];
    if (st._snap === undefined) st._snap = snapOf(c);
    return snapOf(c) !== st._snap;
  }
  function strataPredicate(c) {
    const st = LESSONS[7];
    if (st._phase === undefined) st._phase = 0;
    if (st._phase === 0 && c.stratumRef()) st._phase = 1;
    if (st._phase === 1 && parseFloat(c.tInput.value) >= 0.8) st._phase = 2;
    return st._phase === 2 && !c.stratumRef();
  }
  function snapOf(c) {
    const s = [];
    for (let k = 0; k < c.chamberShorts.length; k++) s.push(String(c.chamberShorts[k]));
    return s.join("|");
  }

  // ---- state -------------------------------------------------------------
  let active = false;
  let lesson = 0;
  let done = false; // current lesson's predicate satisfied this session
  const unlocked = ["r", "theta"]; // controls unlocked so far (union)

  // ---- card DOM ----------------------------------------------------------
  const card = document.createElement("div");
  card.className = "hp-tut-card";
  const titleEl = document.createElement("div");
  titleEl.className = "hp-tut-title";
  const bodyEl = document.createElement("div");
  const taskEl = document.createElement("div");
  taskEl.className = "hp-tut-task";
  const rowEl = document.createElement("div");
  rowEl.className = "hp-tut-row";
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "hp-btn";
  backBtn.textContent = "Back";
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "hp-btn";
  nextBtn.textContent = "Next";
  const exitBtn = document.createElement("button");
  exitBtn.type = "button";
  exitBtn.className = "hp-btn";
  exitBtn.textContent = "Exit";
  rowEl.appendChild(backBtn);
  rowEl.appendChild(nextBtn);
  rowEl.appendChild(exitBtn);
  card.appendChild(titleEl);
  card.appendChild(bodyEl);
  card.appendChild(taskEl);
  card.appendChild(rowEl);

  // ---- gating ------------------------------------------------------------
  function applyGate() {
    const L = LESSONS[lesson];
    if (L.all) {
      // free play: everything enabled, no highlight (setGate(null) = all)
      setGate(null, null);
      return;
    }
    let set = unlocked.slice();
    if (L.controls) {
      for (let i = 0; i < L.controls.length; i++) {
        if (set.indexOf(L.controls[i]) === -1) set.push(L.controls[i]);
      }
    }
    setGate(set, L.highlight);
  }

  // ---- card rendering ----------------------------------------------------
  function render() {
    const L = LESSONS[lesson];
    titleEl.textContent = "Lesson " + lesson + " \u00b7 " + L.title;
    bodyEl.innerHTML = L.body;
    backBtn.style.display = lesson > 0 ? "" : "none";
    if (L.locked) {
      // placeholder lessons: Back / Exit only
      nextBtn.style.display = "none";
      taskEl.textContent = "";
      taskEl.style.display = "none";
    } else {
      nextBtn.style.display = "";
      if (L.task) {
        taskEl.style.display = "";
        if (done) {
          taskEl.textContent = "Task complete! \u2713";
          taskEl.style.color = "";
        } else {
          taskEl.textContent = "Task: " + liveTaskText();
          taskEl.style.color = "inherit";
        }
        nextBtn.disabled = !done;
      } else {
        taskEl.style.display = "none";
        nextBtn.disabled = false;
      }
    }
  }

  // live task progress, e.g. "r = 0.31 / 0.5, then \u03b8 \u2192 0"
  function liveTaskText() {
    const L = LESSONS[lesson];
    if (L.id === "space") {
      const r = parseFloat(controls.rInput.value);
      const th = parseFloat(controls.thetaInput.value);
      const rDone = r >= 0.49;
      const thDone = Math.abs(th) <= 0.01;
      let s = "r = " + r.toFixed(2) + " / 0.5" + (rDone ? " \u2713" : "");
      s += "  \u00b7  \u03b8 = " + (th * Math.PI).toFixed(2) + " / 0" + (thDone ? " \u2713" : "");
      return s;
    }
    if (L.id === "tdir") {
      const t = parseFloat(controls.tInput.value);
      return "t = " + t.toFixed(2) + " / 0.99";
    }
    if (L.id === "r1") {
      const ph = LESSONS[3]._phase || 0;
      const t = parseFloat(controls.tInput.value);
      const r = parseFloat(controls.rInput.value);
      if (ph === 0) return "t = " + t.toFixed(2) + " \u2192 0";
      if (ph === 1) return "r = " + r.toFixed(2) + " \u2192 1";
      return "t = " + t.toFixed(2) + " / 0.99";
    }
    if (L.id === "phi") {
      const v = parseFloat(controls.phiInput.value);
      const start = LESSONS[4]._start || 0;
      const d = Math.abs(v - start);
      return "\u03c6 swept " + ((d * 180) / Math.PI).toFixed(0) + "\u00b0 of 90\u00b0";
    }
    if (L.id === "wall") {
      const snap = LESSONS[6]._snap;
      if (snap !== undefined && snapOf(controls) !== snap) return "chamber crossed \u2713";
      return anyBreaking() ? "press Cross Wall" : "drag a \u03b2 slider to a wall (amber)";
    }
    if (L.id === "strata") {
      const ph = LESSONS[7]._phase || 0;
      const t = parseFloat(controls.tInput.value);
      if (ph === 0) return "in stratum mode: " + (controls.stratumRef() ? "\u2713" : "press lim t\u2192\u221e (r at 0 / 0.5 / 1, \u03b8 = 0, t \u2265 0.9)");
      if (ph === 1) return "climb: t = " + t.toFixed(2) + " / 0.8";
      return "drag t back down to leave" + (controls.stratumRef() ? "" : " \u2713");
    }
    if (L.id === "beta") {
      // live wall proximity (the red-zone ends of the tracks) + the amber
      // count once a wall is touched
      let amber = 0;
      const boxes = controls.chamberBoxes;
      for (let k = 0; k < boxes.length; k++) {
        if (boxes[k].el.classList.contains("hp-breaking")) amber++;
      }
      if (amber > 0) {
        return amber + (amber === 1 ? " wall" : " walls") + " touched \u2713";
      }
      let best = Infinity;
      for (let i = 0; i < 4; i++) {
        const iv = controls.chamberInterval(
          i, controls.beta, controls.chamberShorts
        );
        const v = controls.beta[i];
        const d = Math.min(v - iv.lo, iv.hi - v);
        if (d < best) best = d;
      }
      return (
        "nearest wall: " +
        (best === Infinity ? "?" : best.toFixed(3)) +
        " — drag a \u03b2 slider to a red-zone end"
      );
    }
    return L.taskText || "";
  }

  // ---- lesson transitions ------------------------------------------------
  function anyBreaking() {
    const boxes = controls.chamberBoxes;
    for (let k = 0; k < boxes.length; k++) {
      if (boxes[k].el.classList.contains("hp-breaking")) return true;
    }
    return false;
  }

  // restore the default beta tuple through the widget's own path (the beta
  // ARRAY, never display-order slider assumptions; resetChamber recomputes
  // the chamber + red zones from the restored tuple)
  function resetBeta() {
    if (controls.stratumRef()) controls.leaveStratum();
    const db = controls.defaultBeta;
    for (let i = 0; i < 4; i++) controls.beta[i] = db[i];
    controls.betaInputs.forEach((inp, i) => {
      inp.value = String(controls.beta[i]);
    });
    controls.resetChamber();
    controls.scheduleSolve();
  }

  function enterLesson(i) {
    lesson = i;
    done = false;
    const L = LESSONS[i];
    // fresh task state on every entry (Back re-arms the predicate too)
    delete L._phase;
    delete L._start;
    delete L._snap;
    if (L.id === "wall") L._snap = snapOf(controls);
    if (L.id === "phi") L._start = parseFloat(controls.phiInput.value);
    // every lesson starts OUTSIDE the stratum (r/theta/t are parked and
    // disabled while it is active — entering any lesson mid-stratum would
    // soft-lock its task; Back out of the strata lesson included)
    if (controls.stratumRef()) controls.leaveStratum();
    applyGate();
    // the beta lesson must START from an interior tuple: entering while
    // already on a wall (the user was playing with walls) would
    // auto-complete the task — restore the default beta for a clean start
    if (L.id === "beta" && anyBreaking()) resetBeta();
    render();
  }

  function markDone() {
    if (done) return;
    done = true;
    // completing a lesson unlocks its target control for later lessons.
    // Cross Wall and lim are NOT granted here (user request 2026-09-17):
    // Cross Wall unlocks only in the wall-crossing lesson, lim only in the
    // strata lesson (both via their lesson control lists); phi unlocks in
    // the phi lesson and the recap enables everything.
    const L = LESSONS[lesson];
    const grant = (id) => {
      if (unlocked.indexOf(id) === -1) unlocked.push(id);
    };
    if (L.id === "space") grant("t");
    if (L.id === "phi") grant("phi");
    if (L.id === "beta") {
      grant("beta0");
      grant("beta1");
      grant("beta2");
      grant("beta3");
    }
    if (L.id === "wall") grant("cross");
    if (L.id === "strata") grant("lim");
    applyGate();
    render();
  }

  // ---- anchoring ---------------------------------------------------------
  // The card docks BELOW the anchor's owning panel (never over a control):
  // the Moduli Coordinates panel for the moduli sliders and the lim button,
  // the Parameters card for the beta sliders and Cross Wall. The
  // container's bottom padding is reserved for the card's height so the
  // docked card always fits below the content (the page grows instead of
  // the card covering controls). Null anchor (placeholder lessons) falls
  // back to the top-right corner dock.
  function anchorPanel(id) {
    if (
      id === "r" || id === "theta" || id === "t" || id === "phi" || id === "lim"
    ) {
      return controls.moduliBox || null;
    }
    if (
      id === "beta0" || id === "beta1" || id === "beta2" ||
      id === "beta3" || id === "cross"
    ) {
      return controls.paramsCard || null;
    }
    return null;
  }

  let lastLeft = -1;
  let lastTop = -1;
  let lastPad = -1;
  let lastMaxW = null;
  let lastW = null;
  function setMaxW(px) {
    if (px !== lastMaxW) {
      lastMaxW = px;
      card.style.maxWidth = px;
    }
  }
  function setW(px) {
    if (px !== lastW) {
      lastW = px;
      card.style.width = px;
    }
  }
  function reposition() {
    const L = LESSONS[lesson];
    const cw = container.clientWidth;
    if (!(cw > 0)) return;
    let left;
    let top;
    let bottomDock = false;
    if (cw < 700) {
      // bottom dock: full width minus small margins, pinned below the
      // content (inside the reserved padding band)
      setMaxW("");
      setW(Math.max(0, cw - 16) + "px");
      left = 8;
      bottomDock = true;
    } else {
      setW("");
      const panel = anchorPanel(L.anchor);
      let ok = false;
      if (panel) {
        const rect = panel.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setMaxW(Math.min(340, rect.width) + "px");
          const crect = container.getBoundingClientRect();
          left = rect.left - crect.left;
          top = rect.bottom - crect.top + 8;
          ok = true;
        }
      }
      if (!ok) {
        // corner dock: top-right, below the Tutorial button
        setMaxW("340px");
        left = cw - Math.min(340, card.offsetWidth) - 12;
        top = 8;
      }
    }
    // reserve the band below the content sized to the card, so the docked
    // card can always sit below every panel without covering a control
    const h = card.offsetHeight;
    const pad = h + 12;
    if (pad !== lastPad) {
      lastPad = pad;
      container.style.paddingBottom = pad + "px";
    }
    const ch = container.clientHeight;
    if (bottomDock) top = Math.max(0, ch - h - 8);
    // clamp within the container
    const w = card.offsetWidth;
    left = Math.min(Math.max(4, left), Math.max(4, cw - w - 4));
    top = Math.min(Math.max(4, top), Math.max(4, ch - h - 4));
    if (Math.abs(left - lastLeft) > 1 || Math.abs(top - lastTop) > 1) {
      lastLeft = left;
      lastTop = top;
      card.style.left = left + "px";
      card.style.top = top + "px";
    }
  }

  // ---- per-frame tick ----------------------------------------------------
  function tick() {
    if (!active) return;
    const L = LESSONS[lesson];
    if (L.task && !done && L.predicate(controls)) markDone();
    if (L.task && !done) taskEl.textContent = "Task: " + liveTaskText();
    reposition();
  }

  // ---- enter / exit ------------------------------------------------------
  let prevPad = null; // the container's inline bottom padding before enter()
  function enter() {
    if (active) return;
    active = true;
    lesson = 0;
    done = false;
    unlocked.length = 0;
    unlocked.push("r", "theta");
    prevPad = container.style.paddingBottom || "";
    lastPad = -1;
    lastMaxW = null;
    lastLeft = -1;
    lastTop = -1;
    container.appendChild(card);
    hooks.onFrame.push(tick);
    applyGate();
    render();
    reposition();
  }

  function restoreDefaults() {
    // leave the stratum first (it parks r/\u03b8/t and disables sliders)
    if (controls.stratumRef()) controls.leaveStratum();
    // r slider -> 0.25 via an input event (snaps/readouts stay in sync)
    controls.rInput.value = String(controls.defaultR);
    controls.rInput.dispatchEvent(new Event("input"));
    // beta -> the default tuple through the beta ARRAY (the display order
    // of the sliders on screen is beta0, beta2, beta1, beta3 — never write
    // values through display-order assumptions)
    resetBeta();
  }

  function exit() {
    if (!active) return;
    active = false;
    const idx = hooks.onFrame.indexOf(tick);
    if (idx !== -1) hooks.onFrame.splice(idx, 1);
    if (card.parentNode) card.parentNode.removeChild(card);
    // release the reserved padding band (the card is gone)
    container.style.paddingBottom = prevPad;
    lastPad = -1;
    lastMaxW = null;
    restoreDefaults();
    setGate(null, null);
  }

  // ---- card buttons ------------------------------------------------------
  backBtn.addEventListener("click", () => {
    if (lesson > 0) enterLesson(lesson - 1);
  });
  nextBtn.addEventListener("click", () => {
    if (lesson < LESSONS.length - 1) enterLesson(lesson + 1);
  });
  exitBtn.addEventListener("click", () => exit());

  return {
    enter: enter,
    exit: exit,
    isActive: () => active,
  };
}
