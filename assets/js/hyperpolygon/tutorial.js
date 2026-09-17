// Tutorial (task 24, milestone 1): a game-like guided tour of the widget.
// Dependency-free ES module, statically imported by widget.js but
// instantiated ONLY on the "Tutorial" button click — nothing here binds,
// subscribes or renders before that. The state machine drives the widget's
// control-gating registry (setGate) and subscribes one function to the
// widget's frame hook for task predicates, the live task line and card
// anchoring. NO solver coupling whatsoever.
//
// Lesson plan (milestone 1 implements 0-2; 3-7 are placeholders):
//   0 Welcome — the widget shows ONE point of the moduli space.
//   1 The moduli space is a space — sweep r, then theta.
//   2 The t direction — inflate the polygon via t.
// Progress is session-only; exit restores the free-play default state
// (r = 0.25, default beta, all controls enabled, stratum left).

export function makeTutorial(ctx) {
  const controls = ctx.controls;
  const hooks = ctx.hooks;
  const setGate = ctx.setGate;
  const container = ctx.container;

  // ---- lesson data -------------------------------------------------------
  // controls: gated ids enabled during the lesson; highlight: which control
  // gets the accent ring (or null); anchor: gate id to anchor the card
  // near (null = corner dock); predicate(controls) -> task complete.
  const LESSONS = [
    {
      id: "welcome",
      title: "Welcome to the moduli space",
      body:
        "This widget shows ONE point of a moduli space: each point is a " +
        "gauge-inequivalent stable pair (the matrices x and y in the readout), " +
        "balanced so the moment-map residuals vanish. The sliders are " +
        "coordinates on that space — moving one walks to a different point. " +
        "Only the r and \u03b8 sliders are unlocked; the lessons will unlock " +
        "the rest as you go.",
      controls: ["r", "theta"],
      highlight: "r",
      anchor: "r",
      task: null,
    },
    {
      id: "space",
      title: "The moduli space is a space",
      body:
        "Each (r, \u03b8) labels one stable pair. Drag r from 0.25 to 0.5 and " +
        "watch the polygon reshape while the dot rides the central sphere in " +
        "the side view. Then bring \u03b8 to 0.",
      controls: ["r", "theta"],
      highlight: "r",
      anchor: "r",
      task: "sweep",
      taskText: "r \u2192 0.5, then \u03b8 \u2192 0",
      predicate: (c) =>
        parseFloat(c.rInput.value) >= 0.49 && Math.abs(parseFloat(c.thetaInput.value)) <= 0.01,
    },
    {
      id: "tdir",
      title: "The t direction",
      body:
        "The slider t sets the relative scale of the y matrix: the solve " +
        "prescribes its size as t/(1-t), so the polygon inflates as t grows " +
        "and the readout shows \u221e at t = 1. (The solve clamps at " +
        "t = 0.99, where the prescription is finite.) Drag t from 0 up to " +
        "0.99 and watch the polygon inflate while the dot climbs its " +
        "paraboloid in the side view.",
      controls: ["r", "theta", "t"],
      highlight: "t",
      anchor: "t",
      task: "sweep",
      taskText: "t \u2192 0.99",
      predicate: (c) => parseFloat(c.tInput.value) >= 0.98,
    },
    {
      id: "gauge",
      title: "Gauge freedom & the moment map",
      body: "This lesson is under construction.",
      locked: true,
      controls: ["r", "theta", "t", "phi"],
      highlight: "phi",
      anchor: "phi",
    },
    {
      id: "beta",
      title: "Stability data: \u03b2 and the chamber",
      body: "This lesson is under construction.",
      locked: true,
      controls: ["r", "theta", "t", "phi", "beta0", "beta1", "beta2", "beta3"],
      highlight: "beta0",
      anchor: "beta0",
    },
    {
      id: "wall",
      title: "Wall-crossing",
      body: "This lesson is under construction.",
      locked: true,
      controls: ["r", "theta", "t", "phi", "beta0", "beta1", "beta2", "beta3", "cross"],
      highlight: "cross",
      anchor: null,
    },
    {
      id: "strata",
      title: "Strata & the side view",
      body: "This lesson is under construction.",
      locked: true,
      controls: ["r", "theta", "t", "phi", "beta0", "beta1", "beta2", "beta3", "cross", "lim"],
      highlight: "lim",
      anchor: "lim",
    },
    {
      id: "recap",
      title: "Free play",
      body: "This lesson is under construction.",
      locked: true,
      controls: null,
      highlight: null,
      anchor: null,
    },
  ];

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
  const skipBtn = document.createElement("button");
  skipBtn.type = "button";
  skipBtn.className = "hp-btn";
  skipBtn.textContent = "Skip";
  const exitBtn = document.createElement("button");
  exitBtn.type = "button";
  exitBtn.className = "hp-btn";
  exitBtn.textContent = "Exit";
  rowEl.appendChild(backBtn);
  rowEl.appendChild(nextBtn);
  rowEl.appendChild(skipBtn);
  rowEl.appendChild(exitBtn);
  card.appendChild(titleEl);
  card.appendChild(bodyEl);
  card.appendChild(taskEl);
  card.appendChild(rowEl);

  // ---- gating ------------------------------------------------------------
  function applyGate() {
    const L = LESSONS[lesson];
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
      skipBtn.style.display = "none";
      taskEl.textContent = "";
      taskEl.style.display = "none";
    } else {
      nextBtn.style.display = "";
      skipBtn.style.display = "";
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
    return L.taskText || "";
  }

  // ---- lesson transitions ------------------------------------------------
  function enterLesson(i) {
    lesson = i;
    done = false;
    applyGate();
    render();
  }

  function markDone() {
    if (done) return;
    done = true;
    // completing a lesson unlocks its target control for later lessons
    const L = LESSONS[lesson];
    if (L.id === "space" && unlocked.indexOf("t") === -1) unlocked.push("t");
    if (L.id === "tdir" && unlocked.indexOf("phi") === -1) unlocked.push("phi");
    applyGate();
    render();
  }

  // ---- anchoring ---------------------------------------------------------
  let lastLeft = -1;
  let lastTop = -1;
  function reposition() {
    const L = LESSONS[lesson];
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (!(cw > 0)) return;
    let left;
    let top;
    if (cw < 700) {
      // bottom dock: full width minus small margins, pinned to the bottom
      card.style.maxWidth = "";
      card.style.width = Math.max(0, cw - 16) + "px";
      left = 8;
      top = Math.max(0, ch - card.offsetHeight - 8);
    } else {
      card.style.width = "";
      card.style.maxWidth = "340px";
      const anchorEl =
        L.anchor === "r"
          ? controls.rInput
          : L.anchor === "theta"
          ? controls.thetaInput
          : L.anchor === "t"
          ? controls.tInput
          : L.anchor === "phi"
          ? controls.phiInput
          : L.anchor === "beta0"
          ? controls.betaInputs[0]
          : L.anchor === "lim"
          ? controls.limBtn
          : null;
      const crect = container.getBoundingClientRect();
      let ok = false;
      if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          left = rect.left - crect.left;
          top = rect.bottom - crect.top + 6;
          ok = true;
        }
      }
      if (!ok) {
        // corner dock: top-right, below the Tutorial button
        left = cw - Math.min(340, card.offsetWidth) - 12;
        top = 8;
      }
    }
    // clamp within the container
    const w = card.offsetWidth;
    const h = card.offsetHeight;
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
  function enter() {
    if (active) return;
    active = true;
    lesson = 0;
    done = false;
    unlocked.length = 0;
    unlocked.push("r", "theta");
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
    const db = controls.defaultBeta;
    for (let i = 0; i < 4; i++) controls.beta[i] = db[i];
    controls.betaInputs.forEach((inp, i) => {
      inp.value = String(controls.beta[i]);
    });
    controls.syncBetaSliders();
    controls.resetChamber();
    controls.scheduleSolve();
  }

  function exit() {
    if (!active) return;
    active = false;
    const idx = hooks.onFrame.indexOf(tick);
    if (idx !== -1) hooks.onFrame.splice(idx, 1);
    if (card.parentNode) card.parentNode.removeChild(card);
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
  skipBtn.addEventListener("click", () => {
    // skip = move forward WITHOUT completing: no unlock is granted for the
    // skipped lesson (the user can come Back to it)
    if (lesson < LESSONS.length - 1) enterLesson(lesson + 1);
  });
  exitBtn.addEventListener("click", () => exit());

  return {
    enter: enter,
    exit: exit,
    isActive: () => active,
  };
}
