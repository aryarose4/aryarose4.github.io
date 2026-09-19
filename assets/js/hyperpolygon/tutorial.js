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
//   7 Free play / recap — everything unlocked.
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
// Progress is session-only. ENTERING the tutorial resets every parameter
// slider to its default (r = 0.25, theta = t = phi = 0, default beta — user
// request 2026-09-19); EXITING preserves the current slider positions (only
// the stratum is left, which restores the user's own parked r/theta).

// Number of chamber-inequality boxes currently in the amber ("breaking")
// state — the shared computation of the beta lesson's live task line and
// its amber predicate (anyBreaking). Reads the widget's box DOM state.
function breakingCount(boxes) {
  let amber = 0;
  for (let k = 0; k < boxes.length; k++) {
    if (boxes[k].el.classList.contains("hp-breaking")) amber++;
  }
  return amber;
}

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
  // (user request 4); lim only where its lesson includes it (r1).
  const LESSONS = [
    {
      id: "welcome",
      title: "Welcome",
      body:
        "The right panel shows the whole moduli space, with the current " +
        "position marked by the black dot. The left panel displays the " +
        "polygon corresponding to the current position. The four sliders " +
        "parameterize the four-dimensional space.  We'll begin with r and \u03b8.",
      // user request 2026-09-18: ALL sliders disabled during the welcome
      // lesson (lockAll short-circuits the gate before the unlocked union)
      lockAll: true,
      controls: null,
      highlight: null,
      anchor: "r",
      task: null,
    },
    {
      id: "space",
      title: "The central sphere",
      body:
        "With the t slider fixed to 0, we are restricted to <em>polygon space</em> " +
        "with no telescoping edges. Play around with the sliders, and when " +
        "you're ready to continue bring \u03b8 to 0 and r between 0 and 0.5.",
      controls: ["r", "theta"],
      highlight: "r",
      anchor: "r",
      task: "0 < r < 0.5 and \u03b8 = 0",
      predicate: spacePredicate,
    },
    {
      id: "tdir",
      title: "The upward flow",
      body:
        "The t slider telescopes the polygon's edges while keeping it balanced. " +
        "Geometrically, t parameterizes the gradient flow of the Morse function. " +
        "Try moving this slider, and see how it interacts with the r and \u03b8 sliders. ",
      controls: ["r", "theta", "t"],
      highlight: "t",
      anchor: "t",
      task: "sweep",
      predicate: (c) => parseFloat(c.tInput.value) > 0,
    },
    {
      id: "r1",
      title: "Finding critical points",
      body:
        "There are some polygons for which the t\u2192\u221e limit exists. " +
        "Reset t = 0 and move r to 1. Then take t to 99 and press the limit " +
        "button. From there, you can explore the higher energy Morse stratum.",
      controls: ["r", "theta", "t", "lim"],
      highlight: "lim",
      anchor: "lim",
      task: "r1",
      predicate: r1Predicate,
    },
    {
      id: "phi",
      title: "The \u03c6 slider",
      body:
        "\u03c6 applies a gauge phase e<sup>i\u03c6</sup> to the y matrix. " +
        "This change is not reflected in the su(2) polygon, but you can see " +
        "its effect in the sl(2,C) polygon views. Open that panel and try " +
        "moving \u03c6. Then leave the stratum with the lim t\u21920 button " +
        "and return to the central sphere: t = 0 with 0 < r < 0.5 and " +
        "\u03b8 = 0.",
      controls: ["r", "theta", "t", "phi", "sl", "lim"],
      highlight: "phi",
      anchor: "sl",
      task: "phi",
      predicate: phiPredicate,
    },
    {
      id: "beta",
      title: "The symplectic parameters \u03b2",
      body:
        "The four \u03b2 sliders control the moment map levels, which constrain " +
        "the polygon edge lengths.  These are not moduli coordinates, but " +
        "rather parameters <em>defining</em> the moduli space.  There are "+
        "chamber walls where the moduli space is singular. Try dragging a "+
        "\u03b2 slider to a red-zone until an inequality turns amber.",
      controls: ["r", "theta", "t", "sl", "lim", "beta0", "beta1",
        "beta2", "beta3"],
      highlight: "beta0",
      anchor: "beta0",
      task: "wall",
      predicate: anyBreaking,
    },
    {
      id: "wall",
      title: "Wall-crossing",
      body:
        "Pressing the Cross Wall button flops to another chamber.  This changes "+
        "the list of short subsets and the meaning of stability.  Try entering "+
        "the interior of another chamber now.",
      controls: ["r", "theta", "t", "beta0", "beta1", "beta2", "beta3", "cross"],
      highlight: "cross",
      anchor: "cross",
      task: "cross",
      predicate: crossPredicate,
    },
    {
      id: "recap",
      title: "Free play",
      body:
        "That's everything! You may now explore freely. See if you can "+
        "(1) find the meanings of the parallelism indicators in the polygon "+
        "view, (2) determine why chamber walls correspond to spheres shrinking, "+
        "and (3) find a chamber wall where the central sphere crunches down.",
      all: true, // free play: every control enabled (setGate(null))
      controls: null,
      highlight: null,
      anchor: "cross", // keep the card where the wall-crossing lesson had it
    },
  ];

  // ---- task predicates (stateful ones keep their state on the lesson
  // object; enterLesson re-inits it) ---------------------------------------
  // Lesson 1 (user request 2026-09-19): the start point (r = 0.25, θ = 0)
  // already satisfies the target condition, so Next enables only after the
  // user has SWEPT the sliders — a cumulative travel threshold (total
  // slider-path length, r + θ contributions) AND the target state must
  // both hold. The per-frame tick folds the movement since the previous
  // read into the lesson's accumulator.
  const SWEEP_MIN = 0.5; // slider units: ~half a full r traversal
  function spacePredicate(c) {
    const st = LESSONS[1];
    const r = parseFloat(c.rInput.value);
    const th = parseFloat(c.thetaInput.value);
    if (st._r0 === undefined) {
      st._r0 = r;
      st._th0 = th;
      st._travel = 0;
    }
    st._travel += Math.abs(r - st._r0) + Math.abs(th - st._th0);
    st._r0 = r;
    st._th0 = th;
    return (
      st._travel >= SWEEP_MIN &&
      r >= 0.2 &&
      r <= 0.48 &&
      Math.abs(th) <= 0.01
    );
  }
  function r1Predicate(c) {
    const st = LESSONS[3];
    const t = parseFloat(c.tInput.value);
    if (st._phase === undefined) st._phase = 0;
    if (st._phase === 0 && c.stratumRef()) st._phase = 1;
    // user request 2026-09-19: the gate holds only WHILE the active
    // configuration remains inside the stratum — leaving it (lim t→0 or
    // any other path) disables Next again
    return st._phase === 1 && c.stratumRef() && t > 0.01;
  }
  function phiPredicate(c) {
    const st = LESSONS[4];
    if (st._phase === undefined) st._phase = 0;
    if (st._phase === 0) {
      if (!c.slDetails.open) return false;
      if (st._start === undefined) st._start = parseFloat(c.phiInput.value);
      if (Math.abs(parseFloat(c.phiInput.value) - st._start) < 0.5) return false;
      st._phase = 1;
    }
    // phase 1: leave the stratum (lim t→0) and return to the central
    // sphere: t = 0 with 0 < r < 0.5 and theta = 0 (user request 2026-09-18)
    if (c.stratumRef()) return false;
    const r = parseFloat(c.rInput.value);
    const t = parseFloat(c.tInput.value);
    const th = parseFloat(c.thetaInput.value);
    return t <= 0.01 && r > 0.01 && r < 0.49 && Math.abs(th) <= 0.01;
  }
  function crossPredicate(c) {
    const st = LESSONS[6];
    if (st._snap === undefined) st._snap = snapOf(c);
    // user request 2026-09-18: completing the lesson requires BOTH the wall
    // crossing AND a subsequent slider move away from that wall (the tuple
    // stays pinned on the wall after the flop — the crossed box stays amber —
    // so "off the wall" = no amber inequality remains)
    if (st._phase === undefined) st._phase = 0;
    if (st._phase === 0) {
      if (snapOf(c) === st._snap) return false;
      st._phase = 1;
    }
    return !anyBreaking();
  }
  // String fingerprint of the current chamber (the chamberShorts list) —
  // the wall-crossing lesson's task compares snapshots to detect a change.
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
    if (L.lockAll) {
      // welcome lesson (user request 2026-09-18): every slider disabled
      setGate([], null);
      return;
    }
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
    // last lesson: Next becomes the sole Finish button (user request
    // 2026-09-18) — no separate Exit
    const last = lesson === LESSONS.length - 1;
    exitBtn.style.display = last ? "none" : "";
    nextBtn.textContent = last ? "Finish" : "Next";
    nextBtn.style.display = "";
    if (L.task) {
      taskEl.style.display = "";
      nextBtn.disabled = !L.predicate(controls);
      if (!nextBtn.disabled) {
        taskEl.textContent = "Task complete! \u2713";
        taskEl.style.color = "";
      } else {
        taskEl.textContent = "Task: " + liveTaskText();
        taskEl.style.color = "inherit";
      }
    } else {
      taskEl.style.display = "none";
      nextBtn.disabled = false;
    }
  }

  // live task progress, e.g. "r = 0.31 / 0.5, then \u03b8 \u2192 0"
  function liveTaskText() {
    const L = LESSONS[lesson];
    if (L.id === "space") {
      const st = LESSONS[1];
      const r = parseFloat(controls.rInput.value);
      const th = parseFloat(controls.thetaInput.value);
      // staged text (user request 2026-09-19): sweep first, target after —
      // the travel fraction mirrors the PREDICATE's accumulator (SWEEP_MIN)
      const travel = st._travel || 0;
      if (travel < SWEEP_MIN) {
        return (
          "sweep r and \u03b8 (" +
          Math.min(100, Math.round((travel / SWEEP_MIN) * 100)) +
          "% of " + SWEEP_MIN.toFixed(1) + " slider distance)"
        );
      }
      // the check marks must mirror the PREDICATE's completion window
      // (0.2..0.48, below the r = 0.5 snap), not an unreachable threshold
      const rDone = r >= 0.2 && r <= 0.48;
      const thDone = Math.abs(th) <= 0.01;
      let s = "now bring r to " + r.toFixed(2) + " (0.2 to 0.48)" +
        (rDone ? " \u2713" : "");
      s += "  \u00b7  \u03b8 = " + (th * Math.PI).toFixed(2) + " / 0" + (thDone ? " \u2713" : "");
      return s;
    }
    if (L.id === "tdir") {
      const t = parseFloat(controls.tInput.value);
      return "sweep t upward: t = " + t.toFixed(2);
    }
    if (L.id === "r1") {
      // staged instructions (user request 2026-09-19), matching the body:
      // "enter the higher energy Morse stratum" -> "move t > 0 from there"
      const ph = LESSONS[3]._phase || 0;
      const t = parseFloat(controls.tInput.value);
      if (ph === 0) {
        return (
          "enter the higher energy Morse stratum" +
          (controls.stratumRef() ? " \u2713" : " (r at 1, \u03b8 = 0, t \u2265 0.9, press lim t\u2192\u221e)")
        );
      }
      return "move t > 0 from there: t = " + t.toFixed(2);
    }
    if (L.id === "phi") {
      const ph = LESSONS[4]._phase || 0;
      if (ph === 0) {
        if (!controls.slDetails.open) return "open the SL(2,\u2102) panel first";
        const v = parseFloat(controls.phiInput.value);
        const start = LESSONS[4]._start || 0;
        const d = Math.abs(v - start);
        return "\u03c6 swept " + ((d * 180) / Math.PI).toFixed(0) + "\u00b0 of 90\u00b0";
      }
      if (controls.stratumRef()) return "press lim t\u21920 to leave the stratum";
      const r = parseFloat(controls.rInput.value);
      const t = parseFloat(controls.tInput.value);
      const th = parseFloat(controls.thetaInput.value);
      return (
        "central sphere: t = " + t.toFixed(2) + " / 0" +
        (t <= 0.01 ? " \u2713" : "") +
        "  \u00b7  r = " + r.toFixed(2) + " / < 0.5" +
        (r > 0.01 && r < 0.49 ? " \u2713" : "") +
        "  \u00b7  \u03b8 = " + (th * Math.PI).toFixed(2) + " / 0" +
        (Math.abs(th) <= 0.01 ? " \u2713" : "")
      );
    }
    if (L.id === "wall") {
      const snap = LESSONS[6]._snap;
      if (snap !== undefined && snapOf(controls) !== snap) {
        return anyBreaking()
          ? "drag a \u03b2 slider away from the wall"
          : "wall crossed \u2713";
      }
      return anyBreaking() ? "press Cross Wall" : "drag a \u03b2 slider to a wall (amber)";
    }
    if (L.id === "beta") {
      // live wall proximity (the red-zone ends of the tracks) + the amber
      // count once a wall is touched
      const amber = breakingCount(controls.chamberBoxes);
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
    return "";
  }

  // ---- lesson transitions ------------------------------------------------
  function anyBreaking() {
    return breakingCount(controls.chamberBoxes) > 0;
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

  // Switch to lesson i: reset its fresh task state (Back re-arms the
  // predicate), snapshot the wall/phi lesson anchors, leave the stratum
  // first EXCEPT for the phi lesson, then apply the control gating and
  // reposition the card.
  function enterLesson(i) {
    lesson = i;
    done = false;
    const L = LESSONS[i];
    // fresh task state on every entry (Back re-arms the predicate too)
    delete L._phase;
    delete L._start;
    delete L._snap;
    delete L._r0;
    delete L._th0;
    if (L.id === "wall") L._snap = snapOf(controls);
    if (L.id === "phi") L._start = parseFloat(controls.phiInput.value);
    // lessons start OUTSIDE the stratum (r/theta/t are parked and disabled
    // while it is active — entering most lessons mid-stratum would
    // soft-lock their task). EXCEPTION (user request 2026-09-18): the phi
    // lesson follows lesson 3, which ENDS in the stratum — stay there and
    // keep the lim button enabled (the phi task needs t > 0 anyway).
    if (L.id !== "phi" && controls.stratumRef()) controls.leaveStratum();
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
    // Cross Wall unlocks only in the wall-crossing lesson, lim only via the
    // r1 lesson's control list; phi unlocks in the phi lesson and the recap
    // enables everything. t is NOT granted here either (user request
    // 2026-09-18): it enables only once the t lesson begins (its control
    // list), so finishing lesson 1 alone leaves it disabled.
    const L = LESSONS[lesson];
    const grant = (id) => {
      if (unlocked.indexOf(id) === -1) unlocked.push(id);
    };
    if (L.id === "phi") grant("phi");
    if (L.id === "beta") {
      grant("beta0");
      grant("beta1");
      grant("beta2");
      grant("beta3");
    }
    if (L.id === "wall") grant("cross");
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
  // back to the top-right corner dock. EXCEPTION: the phi lesson (user
  // request 2026-09-18) floats to the RIGHT of the Moduli Coordinates
  // panel, overlaying the Parameters card (handled in reposition).
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
  // Position the lesson card: < 700px = full-width bottom dock; otherwise
  // docked below the anchor's OWNING panel (the phi lesson floats right of
  // the Moduli Coordinates panel), top-right corner dock as the fallback.
  // The container's bottom padding is reserved for the card, so a docked
  // card never covers a control.
  function reposition() {
    const L = LESSONS[lesson];
    // Layout-thrash batching: read ALL layout values up front, then run the
    // existing arithmetic and style writes — the interleaved read/write
    // order below would otherwise force a synchronous reflow per read. The
    // reads reflect the styles applied by earlier calls (the setW/setMaxW
    // guards make steady-state frames no-ops, so values are identical
    // there; a transition frame self-corrects on the next tick).
    const cw = container.clientWidth;
    if (!(cw > 0)) return;
    const crect = container.getBoundingClientRect();
    const mb = L.anchor === "sl" ? controls.moduliBox : null;
    const mrect = mb ? mb.getBoundingClientRect() : null;
    const panel = anchorPanel(L.anchor);
    const rect = panel ? panel.getBoundingClientRect() : null;
    const cardW = card.offsetWidth;
    const cardH = card.offsetHeight;
    const ch = container.clientHeight;
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
      let ok = false;
      if (L.anchor === "sl") {
        // the phi lesson (user request 2026-09-18): float to the RIGHT of
        // the Moduli Coordinates panel, overlaying the Parameters card
        if (mb) {
          if (mrect.width > 0 && mrect.height > 0) {
            setMaxW("340px");
            left = mrect.right - crect.left + 8;
            top = mrect.top - crect.top;
            ok = true;
          }
        }
      }
      if (!ok) {
        if (panel) {
          if (rect.width > 0 && rect.height > 0) {
            setMaxW(Math.min(340, rect.width) + "px");
            left = rect.left - crect.left;
            top = rect.bottom - crect.top + 8;
            ok = true;
          }
        }
      }
      if (!ok) {
        // corner dock: top-right, below the Tutorial button
        setMaxW("340px");
        left = cw - Math.min(340, cardW) - 12;
        top = 8;
      }
    }
    // reserve the band below the content sized to the card, so the docked
    // card can always sit below every panel without covering a control
    const h = cardH;
    const pad = h + 12;
    if (pad !== lastPad) {
      lastPad = pad;
      container.style.paddingBottom = pad + "px";
    }
    if (bottomDock) top = Math.max(0, ch - h - 8);
    // clamp within the container
    const w = cardW;
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
    if (L.task) {
      // LIVE gating (user request 2026-09-18): Next is enabled only while
      // the predicate HOLDS — moving the sliders off the passing state
      // disables it again. `done` stays latched only for control unlocks.
      // Per-frame DOM writes are guarded: each write fires only when the
      // value differs from the node's currently applied one (render() and
      // markDone() also write these nodes, so the applied values themselves
      // are the source of truth, not a shadow cache).
      const pass = L.predicate(controls);
      if (pass && !done) markDone();
      if (nextBtn.disabled !== !pass) nextBtn.disabled = !pass;
      if (!pass) {
        const t = "Task: " + liveTaskText();
        if (taskEl.textContent !== t) taskEl.textContent = t;
      } else if (taskEl.textContent !== "Task complete! \u2713") {
        taskEl.textContent = "Task complete! \u2713";
        taskEl.style.color = "";
      }
    }
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
    // start from a clean default state (user request 2026-09-19): every
    // parameter slider resets to its default when the tutorial begins
    restoreDefaults();
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
    // theta and t back to 0 (theta slider is the normalized s in [-1,1])
    controls.thetaInput.value = "0";
    controls.thetaInput.dispatchEvent(new Event("input"));
    controls.tInput.value = "0";
    controls.tInput.dispatchEvent(new Event("input"));
    // phi back to 0 (display-only rotation of y; never triggers a solve)
    controls.phiInput.value = "0";
    controls.phiInput.dispatchEvent(new Event("input"));
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
    // preserve the current slider positions (user request 2026-09-19) —
    // no reset on exit. Only the stratum is left if active (it owns the
    // r/theta sliders' disabled state; leaveStratum restores the parked
    // values, i.e. the user's own positions)
    if (controls.stratumRef()) controls.leaveStratum();
    setGate(null, null);
    // sync the widget's toggle button label back to "Tutorial" (user
    // request 2026-09-18: exiting from the card's Exit button must reset
    // the exterior "Exit tutorial" button too, not just the widget's own
    // toggle path)
    if (typeof ctx.onExit === "function") ctx.onExit();
  }

  // ---- card buttons ------------------------------------------------------
  backBtn.addEventListener("click", () => {
    if (lesson > 0) enterLesson(lesson - 1);
  });
  nextBtn.addEventListener("click", () => {
    if (lesson === LESSONS.length - 1) exit();
    else enterLesson(lesson + 1);
  });
  exitBtn.addEventListener("click", () => exit());

  return {
    enter: enter,
    exit: exit,
  };
}
