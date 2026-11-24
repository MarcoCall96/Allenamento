"use strict";

(() => {
  const STORAGE_KEY = "allenamento-personale-v1";
  const BACKUP_FORMAT = "palestra-backup-v1";
  const PLAN_FORMAT = "palestra-plan-v1";
  const views = {
    home: document.getElementById("view-home"),
    workout: document.getElementById("view-workout"),
    plan: document.getElementById("view-plan"),
    history: document.getElementById("view-history"),
    more: document.getElementById("view-more"),
  };
  const notice = document.getElementById("notice");
  const scrollContent = document.querySelector(".scroll-content");
  const restTimerDock = document.getElementById("rest-timer-dock");
  const restTimerValue = document.getElementById("rest-timer-value");
  const restTimerStatus = document.getElementById("rest-timer-status");
  const restTimerToggle = document.getElementById("rest-timer-toggle");
  const restTimerReset = document.getElementById("rest-timer-reset");
  const navButtons = Array.from(document.querySelectorAll("[data-screen]"));
  let state = null;
  let basePlan = null;
  let currentScreen = "home";
  let editorDraft = null;
  let editorDayId = null;
  let editorDirty = false;
  let storageAvailable = true;
  let illustrationsAvailable = true;
  let illustrationCatalog = [];
  let fieldCounter = 0;
  let restTimerState = null;
  let selectedRestTimer = null;
  let homeTilesRefresh = null;
  const dayColors = Array.from({ length: 21 }, () => ["#c6f135", "198,241,53"]);

  function node(tag, className = "", text = null) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== null) result.textContent = text;
    return result;
  }

  function button(label, className, action) {
    const result = node("button", className, label);
    result.type = "button";
    result.addEventListener("click", action);
    return result;
  }

  function field(label, value, options, onInput) {
    const wrapper = node("div", `field${options.full ? " full" : ""}`);
    const labelElement = node("label", "", label);
    const input = document.createElement(options.multiline ? "textarea" : "input");
    const id = `input-${++fieldCounter}`;
    labelElement.htmlFor = id;
    input.id = id;
    if (!options.multiline) input.type = options.type || "text";
    if (options.inputMode) input.inputMode = options.inputMode;
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.maxLength) input.maxLength = options.maxLength;
    if (options.disabled) input.disabled = true;
    input.value = value || "";
    input.addEventListener("input", () => onInput(input.value));
    wrapper.append(labelElement, input);
    return { wrapper, input };
  }

  function showNotice(message, isError = false) {
    notice.textContent = message;
    notice.classList.toggle("notice-error", isError);
    notice.hidden = false;
  }

  function clearNotice() {
    if (storageAvailable && illustrationsAvailable) notice.hidden = true;
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function shortText(value, maxLength, allowEmpty = false) {
    return typeof value === "string" && value.length <= maxLength &&
      (allowEmpty || value.trim().length > 0);
  }

  function validId(value) {
    return shortText(value, 100) && /^[a-z0-9_-]+$/i.test(value);
  }

  function validRirTarget(value) {
    if (value === "-") return true;
    const match = /^(0|[1-9]|10)(?:-(0|[1-9]|10))?$/.exec(value);
    return Boolean(match) && (match[2] === undefined || Number(match[1]) <= Number(match[2]));
  }

  function validatePlan(plan) {
    if (!isObject(plan) || plan.format !== PLAN_FORMAT || !validId(plan.id)) {
      return "Il formato della scheda non è riconosciuto.";
    }
    if (!shortText(plan.name, 100) || !Number.isInteger(plan.weeks) ||
        plan.weeks < 1 || plan.weeks > 52) {
      return "Il nome o il numero di settimane non è valido.";
    }
    if (!isObject(plan.rir) ||
        !["multi", "iso"].every((key) => Array.isArray(plan.rir[key]) &&
          plan.rir[key].length === plan.weeks && plan.rir[key].every(validRirTarget))) {
      return "I valori RIR non corrispondono alle settimane della scheda.";
    }
    if (!Array.isArray(plan.days) || plan.days.length < 1 || plan.days.length > 21) {
      return "La scheda deve avere da 1 a 21 giorni.";
    }
    const dayIds = new Set();
    for (const day of plan.days) {
      if (!isObject(day) || !validId(day.id) || dayIds.has(day.id) ||
          !shortText(day.name, 80) || !shortText(day.subtitle, 100, true) ||
          !Array.isArray(day.exercises) || day.exercises.length > 100) {
        return "Un giorno della scheda non è valido.";
      }
      dayIds.add(day.id);
      const exerciseIds = new Set();
      for (const exercise of day.exercises) {
        if (!isObject(exercise) || !validId(exercise.id) || exerciseIds.has(exercise.id) ||
            !shortText(exercise.name, 200) || !shortText(exercise.reps, 80) ||
            !shortText(exercise.rest, 40) || !shortText(exercise.pair, 30, true) ||
            (exercise.artId !== undefined && exercise.artId !== "" && !validId(exercise.artId)) ||
            (exercise.equipment !== undefined && !shortText(exercise.equipment, 100, true)) ||
            (exercise.instructions !== undefined && !shortText(exercise.instructions, 1200)) ||
            !["strength", "cardio"].includes(exercise.kind) ||
            typeof exercise.unilateral !== "boolean" ||
            !Array.isArray(exercise.sets) || exercise.sets.length !== plan.weeks) {
          return `Controlla i dati degli esercizi in ${day.name}.`;
        }
        if (exercise.kind === "cardio" && !exercise.sets.every((value) => value === null)) {
          return `Controlla le settimane del cardio in ${day.name}.`;
        }
        if (exercise.kind === "strength" && !exercise.sets.every(
          (value) => Number.isInteger(value) && value >= 0 && value <= 20
        )) {
          return `Le serie di ${exercise.name} devono essere numeri da 0 a 20.`;
        }
        exerciseIds.add(exercise.id);
      }
    }
    return null;
  }

  function recordKey(planId, dayId, week, exerciseId) {
    return JSON.stringify([planId, dayId, week, exerciseId]);
  }

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

  function validDayMap(value, validate) {
    if (value === undefined) return true;
    if (!isObject(value)) return false;
    const entries = Object.entries(value);
    return entries.length <= 4000 && entries.every(([key, item]) => DATE_KEY.test(key) && validate(item));
  }

  function validInt(value, minimum, maximum) {
    return Number.isInteger(value) && value >= minimum && value <= maximum;
  }

  function validHealth(health) {
    if (!isObject(health)) return false;
    const goals = health.goals;
    return validDayMap(health.steps, (item) => validInt(item, 0, 200000)) &&
      validDayMap(health.water, (item) => validInt(item, 0, 100)) &&
      validDayMap(health.supplementLog, (item) => Array.isArray(item) && item.length <= 50 && item.every(validId)) &&
      (health.weights === undefined || (Array.isArray(health.weights) && health.weights.length <= 4000 &&
        health.weights.every((item) => isObject(item) && DATE_KEY.test(item.date) &&
          typeof item.kg === "number" && item.kg >= 20 && item.kg <= 500))) &&
      (health.supplements === undefined || (Array.isArray(health.supplements) && health.supplements.length <= 50 &&
        health.supplements.every((item) => isObject(item) && validId(item.id) && shortText(item.name, 60)))) &&
      (goals === undefined || (isObject(goals) && validInt(goals.steps, 1000, 100000) &&
        validInt(goals.water, 1, 30) && validInt(goals.glassMl, 50, 1000)));
  }

  function ensureHealth() {
    if (!isObject(state.health)) state.health = {};
    const health = state.health;
    for (const key of ["steps", "water", "supplementLog"]) if (!isObject(health[key])) health[key] = {};
    for (const key of ["weights", "supplements"]) if (!Array.isArray(health[key])) health[key] = [];
    if (!isObject(health.goals)) health.goals = { steps: 8000, water: 8, glassMl: 250 };
    return health;
  }

  function dateKey(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function formatNumber(value, digits = 0) {
    return value.toLocaleString("it-IT", { maximumFractionDigits: digits });
  }

  function svgNode(tag, attributes = {}, text = null) {
    const result = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, String(value));
    if (text !== null) result.textContent = text;
    return result;
  }

  const ICONS = {
    steps: '<path d="M7.2 14.5c1.8-1 2.8-3.1 3.2-5.3.2-1.6-.4-2.6-1.7-2.6-1.5 0-2.3 1.4-2.8 3.1-.6 2-1.7 2.4-2.2 3.6-.9 2.2.9 4.5 3.5 4.1l2.2-.5m7.4-5c-1.8-1-2.8-3.1-3.2-5.3-.2-1.6.4-2.6 1.7-2.6 1.5 0 2.3 1.4 2.8 3.1.6 2 1.7 2.4 2.2 3.6.9 2.2-.9 4.5-3.5 4.1l-2.2-.5M8 20h8"/>',
    water: '<path d="M12 2.7C9.2 6.7 5.2 10.6 5.2 14.6a6.8 6.8 0 0 0 13.6 0c0-4-4-7.9-6.8-11.9Z"/><path d="M8.8 15.1c.2 1.6 1.2 2.6 2.6 2.9"/>',
    weight: '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M8 10a4 4 0 0 1 8 0m-4 0 1.5-2"/>',
    supplement: '<path d="m8 4 12 12a5.7 5.7 0 0 1-8 8L4 16a5.7 5.7 0 0 1 8-8Zm2 14 8-8" transform="translate(-1 -2)"/>',
    history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    settings: '<path d="M9.8 3h4.4l.5 2.1 1.8.8 1.9-1.1 3.1 3.1-1.1 1.9.8 1.8 2.1.5v4.4l-2.1.5-.8 1.8 1.1 1.9-3.1 3.1-1.9-1.1-1.8.8-.5 2.1H9.8l-.5-2.1-1.8-.8-1.9 1.1-3.1-3.1 1.1-1.9-.8-1.8-2.1-.5v-4.4l2.1-.5.8-1.8-1.1-1.9 3.1-3.1 1.9 1.1 1.8-.8.5-2.1Z" transform="translate(0 -1.5) scale(1 .96)"/><circle cx="12" cy="12" r="3"/>',
    close: '<path d="M5 5 19 19M19 5 5 19"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    camera: '<path d="M4 7h3l1.5-2h7L17 7h3v12H4Z"/><circle cx="12" cy="13" r="3"/>',
    backup: '<path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
  };
  function icon(name, size = 22) {
    const svg = svgNode("svg", { viewBox: "0 0 24 24", width: size, height: size,
      fill: "none", stroke: "currentColor", "stroke-width": 1.8,
      "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    svg.innerHTML = ICONS[name];
    return svg;
  }

  function validateState(candidate) {
    if (!isObject(candidate) || candidate.version !== 1 ||
        !Array.isArray(candidate.plans) || candidate.plans.length < 1 ||
        candidate.plans.length > 100 || !isObject(candidate.records) ||
        !isObject(candidate.selection)) {
      return "Il formato del salvataggio non è riconosciuto.";
    }
    if (candidate.profileImage !== undefined &&
        (!shortText(candidate.profileImage, 250000, true) ||
          (candidate.profileImage &&
            !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(candidate.profileImage)))) {
      return "L'immagine del profilo salvata non è valida.";
    }
    if (candidate.health !== undefined && !validHealth(candidate.health)) {
      return "I dati di passi, acqua, peso o integratori non sono validi.";
    }
    const ids = new Set();
    if (candidate.exerciseNotes !== undefined &&
        (!isObject(candidate.exerciseNotes) || Object.keys(candidate.exerciseNotes).length > 500 ||
          !Object.entries(candidate.exerciseNotes).every(([name, text]) => shortText(name, 200) && shortText(text, 300, true)))) {
      return "Le note degli esercizi non sono valide.";
    }
    if (candidate.sessions !== undefined &&
        (!isObject(candidate.sessions) || Object.keys(candidate.sessions).length > 3000 ||
          !Object.values(candidate.sessions).every((item) => isObject(item) && shortText(item.start, 50) &&
            (item.end === undefined || shortText(item.end, 50))))) {
      return "I dati delle sedute non sono validi.";
    }
    for (const plan of candidate.plans) {
      const error = validatePlan(plan);
      if (error || ids.has(plan.id)) return error || "Ci sono blocchi duplicati.";
      ids.add(plan.id);
    }
    if (!ids.has(candidate.activePlanId) || !validId(candidate.selection.dayId) ||
        !Number.isInteger(candidate.selection.week) ||
        candidate.selection.week < 1 || candidate.selection.week > 52) {
      return "La selezione salvata non è valida.";
    }
    const records = Object.entries(candidate.records);
    if (records.length > 20000) return "Il backup contiene troppi registri.";
    for (const [key, record] of records) {
      if (!isObject(record) ||
          ![record.planId, record.dayId, record.exerciseId].every(validId) ||
          !Number.isInteger(record.week) || record.week < 1 || record.week > 52 ||
          key !== recordKey(record.planId, record.dayId, record.week, record.exerciseId) ||
          !shortText(record.planName, 100) || !shortText(record.dayName, 80) ||
          !shortText(record.exerciseName, 200) ||
          !["strength", "cardio"].includes(record.kind) ||
          !shortText(record.load, 30, true) || !shortText(record.reps, 120, true) ||
          !shortText(record.rir, 20, true) || !shortText(record.notes, 600, true) ||
          typeof record.completed !== "boolean" || !shortText(record.updatedAt, 50)) {
        return "Un registro del backup non è valido.";
      }
      if (record.series !== undefined &&
          (!Array.isArray(record.series) || record.series.length > 20 ||
            !record.series.every((set) => isObject(set) &&
              ["load", "reps", "left", "right"].every((key) => shortText(set[key], 30, true)) &&
              (set.done === undefined || typeof set.done === "boolean")))) {
        return "Una serie nel backup non è valida.";
      }
    }
    return null;
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageAvailable = true;
      return true;
    } catch (error) {
      console.error("Salvataggio locale non riuscito:", error);
      storageAvailable = false;
      showNotice(
        "Non riesco a salvare sul dispositivo. I dati mostrati potrebbero andare persi: " +
        "esporta subito un backup dalla sezione Altro.",
        true
      );
      return false;
    }
  }

  function activePlan() {
    return state.plans.find((plan) => plan.id === state.activePlanId);
  }

  function ensureSelection() {
    const plan = activePlan();
    if (!plan.days.some((day) => day.id === state.selection.dayId)) {
      state.selection.dayId = plan.days[0].id;
    }
    state.selection.week = Math.min(Math.max(1, state.selection.week), plan.weeks);
  }

  function uniqueId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    const random = new Uint32Array(2);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      window.crypto.getRandomValues(random);
      return `${prefix}-${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function formatRir(value) {
    return value === "-" ? "non indicato" : value;
  }

  // Indicazioni di carico dalla scheda; i multiarticolari sono riconosciuti dal recupero lungo (>= 2').
  function coachingTip(plan, week, exercise, sets) {
    const text = String(exercise.reps || "").trim();
    const side = /braccio/i.test(text) ? " per braccio" : (/lato/i.test(text) || exercise.unilateral ? " per lato" : "");
    const range = text.match(/^(\d+)\s*[-–]\s*(\d+)/);
    const single = text.match(/^(\d+)/);
    if (exercise.kind === "cardio") {
      return range ? [`Resta tra ${range[1]} e ${range[2]} minuti a ritmo facile: devi riuscire a parlare senza fiatone.`] : [];
    }
    if (!range && !single) return [];
    const lines = [];
    const count = sets ? `${sets} ${sets === 1 ? "serie" : "serie"}` : "";
    if (range) {
      lines.push(`Fai ${count}${side}. Cerca di stare tra le ${range[1]} e le ${range[2]} ripetizioni.`);
    } else {
      lines.push(`Fai ${count}${side} da ${single[1]} ripetizioni, lente e controllate.`);
    }
    const kind = parseRestSeconds(exercise.rest) >= 120 ? "multi" : "iso";
    const rir = plan.rir && plan.rir[kind] ? String(plan.rir[kind][week - 1] || "") : "";
    if (rir && rir !== "-") {
      lines.push(/^0/.test(rir)
        ? `Porta la serie quasi a cedimento: ${rir} ripetizioni in riserva (RIR ${rir}), sempre con tecnica pulita.`
        : `Fermati quando te ne restano circa ${rir} in riserva (RIR ${rir}).`);
    }
    if (range) {
      lines.push(`Se in tutte le serie arrivi a ${range[2]} con tecnica pulita, aumenta di poco il carico alla prossima seduta. Se non arrivi a ${range[1]}, scalalo un po'.`);
    }
    return lines;
  }

  function setScreen(screen) {
    if (screen !== currentScreen && currentScreen === "plan" && editorDirty) {
      if (!window.confirm("Ci sono modifiche non salvate. Vuoi uscire senza salvarle?")) return;
      editorDraft = null;
      editorDirty = false;
    }
    currentScreen = screen;
    for (const [name, view] of Object.entries(views)) view.hidden = name !== screen;
    closeExerciseSheet();
    closeHealthSheet();
    for (const nav of navButtons) {
      const selected = nav.dataset.screen === screen;
      nav.classList.toggle("is-active", selected);
      if (selected) {
        nav.setAttribute("aria-current", "page");
        const bar = nav.closest(".bottom-nav");
        if (bar) bar.style.setProperty("--nav-i", String(navButtons.indexOf(nav)));
      } else nav.removeAttribute("aria-current");
    }
    clearNotice();
    if (screen === "home") renderHome();
    if (screen === "workout") renderWorkout();
    if (screen === "plan") renderPlan();
    if (screen === "history") renderHistory();
    if (screen === "more") renderMore();
    keepScreenAwake(screen === "workout");
    scrollContent.scrollTo({ top: 0, behavior: "auto" });
    syncTopbar();
  }

  function syncTopbar() {
    const heading = document.getElementById("topbar-title");
    const compact = scrollContent.scrollTop > 28;
    document.querySelector(".topbar").classList.toggle("is-scrolled", compact);
    document.querySelector(".topbar").classList.toggle("is-home", currentScreen === "home");
    heading.textContent = currentScreen === "home" ? "Riepilogo" :
      currentScreen === "workout" ? "Allenamento" :
      currentScreen === "history" ? "Statistiche" :
      currentScreen === "more" ? "Altro" : "Modifica scheda";
  }
  scrollContent.addEventListener("scroll", syncTopbar, { passive: true });

  function titleBlock(kicker, title, copy) {
    const result = node("div", "page-header");
    result.append(node("div", "eyebrow", kicker), node("h1", "page-title", title), node("p", "page-copy", copy));
    return result;
  }

  function dayStrip(days, selectedId, choose) {
    const strip = node("div", "day-strip");
    days.forEach((day, index) => {
      const item = button("", `day-pill${day.id === selectedId ? " is-active" : ""}`, () => choose(day.id));
      item.style.setProperty("--day-color", dayColors[index][0]);
      item.style.setProperty("--day-rgb", dayColors[index][1]);
      item.setAttribute("aria-pressed", String(day.id === selectedId));
      item.append(node("span", "", `GIORNO ${index + 1}`), node("strong", "", day.name));
      strip.append(item);
    });
    return strip;
  }

  function activeExercises(day, week) {
    return day.exercises.filter(
      (exercise) => exercise.kind === "cardio" || exercise.sets[week - 1] > 0
    );
  }

  function validNumber(value, maximum) {
    if (!value.trim()) return true;
    const normalized = value.trim().replace(",", ".");
    return /^\d{1,4}(?:\.\d{0,2})?$/.test(normalized) && Number(normalized) <= maximum;
  }

  function validLoggedRir(value) {
    if (!value.trim()) return true;
    const parts = value.trim().split("-").map((part) => part.trim());
    if (parts.length > 2 || parts.some((part) => !validNumber(part, 10) || part === "")) return false;
    return parts.length === 1 ||
      Number(parts[0].replace(",", ".")) <= Number(parts[1].replace(",", "."));
  }

  function validRepetitions(value) {
    return /^\d{1,4}$/.test(value.trim());
  }

  function completeSet(set, unilateral) {
    if (!isObject(set)) return false;
    if (typeof set.done === "boolean") return set.done;
    return Boolean(set.load.trim()) && validNumber(set.load, 1000) &&
      (unilateral ? validRepetitions(set.left) && validRepetitions(set.right) : validRepetitions(set.reps));
  }

  function recordIsComplete(plan, day, week, exercise) {
    const record = state.records[recordKey(plan.id, day.id, week, exercise.id)];
    if (!record) return false;
    if (exercise.kind === "cardio" || !Array.isArray(record.series)) return record.completed;
    const count = exercise.sets[week - 1];
    return count > 0 && record.series.length >= count &&
      record.series.slice(0, count).every((set) => completeSet(set, exercise.unilateral));
  }

  function setScore(set, unilateral) {
    if (!completeSet(set, unilateral)) return null;
    const load = Number(String(set.load || "").replace(",", "."));
    const reps = unilateral ? Math.min(Number(set.left), Number(set.right)) : Number(set.reps);
    if (!(load > 0) || !(reps > 0)) return null;
    return { load, e1rm: load * (1 + Math.min(reps, 15) / 30) };
  }

  function bestOfSeries(series, unilateral) {
    const best = { load: 0, e1rm: 0 };
    for (const set of series || []) {
      const score = setScore(set, unilateral);
      if (!score) continue;
      best.load = Math.max(best.load, score.load);
      best.e1rm = Math.max(best.e1rm, score.e1rm);
    }
    return best;
  }

  // Record personale: carico massimo o massimale stimato superiori a tutte le sedute precedenti dello stesso esercizio.
  function exercisePR(exercise, key, series) {
    if (exercise.kind === "cardio" || !Array.isArray(series)) return null;
    const now = bestOfSeries(series, exercise.unilateral);
    if (!now.e1rm) return null;
    const prior = { load: 0, e1rm: 0 };
    for (const [otherKey, record] of Object.entries(state.records)) {
      if (otherKey === key || !Array.isArray(record.series) || record.exerciseName !== exercise.name) continue;
      const best = bestOfSeries(record.series, exercise.unilateral);
      prior.load = Math.max(prior.load, best.load);
      prior.e1rm = Math.max(prior.e1rm, best.e1rm);
    }
    if (!prior.e1rm) return null;
    const load = now.load > prior.load + 1e-9;
    const strength = now.e1rm > prior.e1rm * 1.005;
    return load || strength ? { load, now, prior } : null;
  }

  function sessionKey(plan, day, week) {
    return `${plan.id}|${day.id}|${week}`;
  }

  function touchSession(plan, day, week) {
    if (!isObject(state.sessions)) state.sessions = {};
    const now = new Date();
    const key = sessionKey(plan, day, week);
    const current = state.sessions[key];
    const gap = current && current.end ? now - Date.parse(current.end) : 0;
    if (!current || gap > 3 * 3600 * 1000) state.sessions[key] = { start: now.toISOString() };
    state.sessions[key].end = now.toISOString();
    delete state.sessions[key].finished;
  }

  function finishSession(plan, day, week) {
    touchSession(plan, day, week);
    state.sessions[sessionKey(plan, day, week)].finished = true;
    persist();
    document.dispatchEvent(new CustomEvent("session-finished"));
  }

  function sessionStats(plan, day, week, exercises) {
    const stats = { exercisesDone: 0, total: exercises.length, setsDone: 0, volume: 0, prs: [], minutes: null };
    for (const exercise of exercises) {
      const key = recordKey(plan.id, day.id, week, exercise.id);
      if (recordIsComplete(plan, day, week, exercise)) stats.exercisesDone += 1;
      const record = state.records[key];
      if (!record || exercise.kind === "cardio" || !Array.isArray(record.series)) continue;
      for (const set of record.series) {
        if (!completeSet(set, exercise.unilateral)) continue;
        stats.setsDone += 1;
        const load = Number(String(set.load || "").replace(",", "."));
        const reps = exercise.unilateral ? Number(set.left) + Number(set.right) : Number(set.reps);
        if (load > 0 && reps > 0) stats.volume += load * reps;
      }
      const pr = exercisePR(exercise, key, record.series);
      if (pr) stats.prs.push({ name: exercise.name, ...pr });
    }
    const session = isObject(state.sessions) ? state.sessions[sessionKey(plan, day, week)] : null;
    if (session && session.start) {
      const minutes = Math.round((Date.parse(session.end || session.start) - Date.parse(session.start)) / 60000);
      if (minutes > 0 && minutes < 600) stats.minutes = minutes;
    }
    return stats;
  }

  function dayProgress(plan, day, week) {
    const exercises = activeExercises(day, week);
    return {
      total: exercises.length,
      completed: exercises.filter((exercise) => recordIsComplete(plan, day, week, exercise)).length,
    };
  }

  function weekProgress(plan, week) {
    const progress = plan.days.map((day) => dayProgress(plan, day, week));
    const scheduled = progress.filter((item) => item.total > 0);
    return {
      total: scheduled.length,
      completed: scheduled.filter((item) => item.completed === item.total).length,
      days: progress,
    };
  }

  function weekVolume(plan, week) {
    let total = 0;
    for (const day of plan.days) {
      for (const exercise of day.exercises) {
        if (exercise.kind !== "strength" || exercise.sets[week - 1] < 1) continue;
        const record = state.records[recordKey(plan.id, day.id, week, exercise.id)];
        if (!record || !Array.isArray(record.series)) continue;
        for (const set of record.series) {
          const load = Number(set.load.trim().replace(",", "."));
          if (!Number.isFinite(load) || load <= 0) continue;
          const repetitionCount = exercise.unilateral
            ? Number(set.left) + Number(set.right)
            : Number(set.reps);
          if (Number.isFinite(repetitionCount) && repetitionCount > 0) total += load * repetitionCount;
        }
      }
    }
    return Math.round(total);
  }

  function parseRestSeconds(value) {
    const minutes = value.match(/(\d+)\s*'/);
    const seconds = value.match(/(\d+)\s*"/);
    return (minutes ? Number(minutes[1]) * 60 : 0) + (seconds ? Number(seconds[1]) : 0);
  }

  function formatTimer(seconds) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  function updateRestTimerUI() {
    const active = restTimerState &&
      (restTimerState.running || (selectedRestTimer && restTimerState.key === selectedRestTimer.key))
      ? restTimerState
      : null;
    const display = active || selectedRestTimer;
    const duration = display ? display.duration : 0;
    const remaining = active
      ? (active.running ? Math.max(0, Math.ceil((active.endsAt - Date.now()) / 1000)) : active.remaining)
      : duration;
    restTimerDock.style.setProperty("--timer-ratio", String(duration ? Math.max(0, Math.min(1, remaining / duration)) : 0));
    restTimerValue.textContent = duration ? formatTimer(remaining) : "--:--";
    restTimerStatus.textContent = active
      ? (active.running ? "In corso" : (active.finished ? "Terminato" : "In pausa"))
      : "Pronto";
    restTimerDock.dataset.state = active ? (active.running ? "running" : (active.finished ? "finished" : "paused")) : "idle";
    restTimerDock.dataset.urgent = active && active.running && remaining <= 10 ? "1" : "0";
    const timerLabel = restTimerDock.querySelector(".rest-timer-label");
    if (timerLabel) timerLabel.textContent = active && active.finished ? "TERMINATO" : "RECUPERO";
    restTimerToggle.disabled = !duration;
    restTimerReset.disabled = !active;
    restTimerToggle.textContent = active && active.running ? "Pausa" : "Avvia";
    restTimerToggle.setAttribute("aria-label", active && active.running ? "Metti in pausa il timer" : "Avvia timer recupero");
    syncFloatingTimer();
  }

  function startRestTimer(timerState) {
    timerState.running = true;
    timerState.finished = false;
    timerState.endsAt = Date.now() + timerState.remaining * 1000;
    timerState.interval = window.setInterval(() => {
      timerState.remaining = Math.max(0, Math.ceil((timerState.endsAt - Date.now()) / 1000));
      if (!timerState.remaining) {
        window.clearInterval(timerState.interval);
        timerState.running = false;
        timerState.finished = true;
        timerState.finishedAt = Date.now();
        window.setTimeout(syncFloatingTimer, 8100);
        alertRestFinished();
        if (selectedRestTimer && selectedRestTimer.key !== timerState.key && activeSheet) restTimerState = null;
      }
      updateRestTimerUI();
    }, 250);
  }

  function selectRestTimer(plan, day, exercise) {
    const duration = parseRestSeconds(exercise.rest);
    const key = `${plan.id}:${day.id}:${exercise.id}`;
    selectedRestTimer = { key, duration, name: exercise.name };
    if (restTimerState && !restTimerState.running && restTimerState.key !== key) {
      if (restTimerState.interval) window.clearInterval(restTimerState.interval);
      restTimerState = null;
    }
    updateRestTimerUI();
  }

  function toggleRestTimer() {
    if (!selectedRestTimer || !selectedRestTimer.duration) return;
    if (restTimerState && restTimerState.running) {
      restTimerState.remaining = Math.max(0, Math.ceil((restTimerState.endsAt - Date.now()) / 1000));
      window.clearInterval(restTimerState.interval);
      restTimerState.running = false;
      restTimerState.finished = !restTimerState.remaining;
    } else {
      if (!restTimerState || restTimerState.key !== selectedRestTimer.key || restTimerState.finished) {
        restTimerState = {
          key: selectedRestTimer.key,
          name: selectedRestTimer.name,
          duration: selectedRestTimer.duration,
          remaining: selectedRestTimer.duration,
          finished: false,
          running: false,
          interval: null,
        };
      }
      startRestTimer(restTimerState);
    }
    updateRestTimerUI();
  }

  function resetRestTimer() {
    if (restTimerState && restTimerState.interval) window.clearInterval(restTimerState.interval);
    restTimerState = null;
    updateRestTimerUI();
  }

  function beginRest(plan, day, exercise) {
    selectRestTimer(plan, day, exercise);
    if (!selectedRestTimer.duration) return;
    if (restTimerState && restTimerState.interval) window.clearInterval(restTimerState.interval);
    restTimerState = {
      key: selectedRestTimer.key,
      name: selectedRestTimer.name,
      duration: selectedRestTimer.duration,
      remaining: selectedRestTimer.duration,
      finished: false,
      running: false,
      interval: null,
    };
    startRestTimer(restTimerState);
    updateRestTimerUI();
  }

  function adjustRestTimer(delta) {
    if (!selectedRestTimer) return;
    const active = restTimerState && restTimerState.key === selectedRestTimer.key ? restTimerState : null;
    if (active && active.running) {
      active.endsAt = Math.max(Date.now() + 1000, active.endsAt + delta * 1000);
    } else if (active) {
      active.remaining = Math.max(0, active.remaining + delta);
      active.finished = false;
    } else {
      selectedRestTimer.duration = Math.max(10, selectedRestTimer.duration + delta);
    }
    updateRestTimerUI();
  }

  function alertRestFinished() {
    try {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      const audio = new Context();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = 880;
      gain.gain.value = 0.15;
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.35);
      oscillator.onended = () => audio.close();
    } catch (error) {
      console.error("Avviso di fine recupero non riuscito:", error);
    }
  }

  let activeSheet = null;
  let healthSheet = null;

  function closeHealthSheet() {
    if (!healthSheet) return;
    healthSheet.remove();
    healthSheet = null;
  }

  function openHealthSheet(card, label) {
    closeHealthSheet();
    const overlay = node("div", "health-overlay");
    const sheet = node("div", "health-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", label);
    const grabber = node("div", "sheet-grabber");
    const heading = node("div", "health-sheet-heading");
    heading.append(node("h2", "", label));
    const dismiss = button("", "sheet-icon", closeHealthSheet);
    dismiss.append(icon("close", 19));
    dismiss.setAttribute("aria-label", "Chiudi dettagli");
    heading.append(dismiss);
    sheet.append(grabber, heading, card);
    overlay.append(sheet);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeHealthSheet();
    });
    let startY = 0;
    let startX = 0;
    let canDismiss = false;
    sheet.addEventListener("touchstart", (event) => {
      startY = event.touches[0].clientY;
      startX = event.touches[0].clientX;
      canDismiss = sheet.scrollTop < 2 && !event.target.closest("input, textarea, button, label");
    }, { passive: true });
    sheet.addEventListener("touchend", (event) => {
      const dy = event.changedTouches[0].clientY - startY;
      if (canDismiss && dy > 80 && dy > Math.abs(event.changedTouches[0].clientX - startX) * 1.5) closeHealthSheet();
    }, { passive: true });
    document.querySelector(".app-shell").append(overlay);
    healthSheet = overlay;
  }

  function syncFloatingTimer() {
    const shell = document.querySelector(".app-shell");
    if (activeSheet) {
      shell.classList.remove("has-timer");
      return;
    }
    if (restTimerDock.parentElement !== shell) shell.append(restTimerDock);
    const state = restTimerState;
    const show = Boolean(state && (state.running || (state.finished
      ? Date.now() - (state.finishedAt || 0) < 8000
      : state.remaining > 0)));
    restTimerDock.hidden = !show;
    shell.classList.toggle("has-timer", show);
  }

  function closeExerciseSheet() {
    if (activeSheet) {
      activeSheet.remove();
      activeSheet = null;
    }
    syncFloatingTimer();
  }

  function openExerciseSheet({ plan, day, week, exercises, index, card, openExercise }) {
    closeExerciseSheet();
    const exercise = exercises[index];
    selectRestTimer(plan, day, exercise);
    const sheet = node("div", "exercise-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", exercise.name);
    sheet.append(node("div", "sheet-grabber"));
    const top = node("div", "sheet-top");
    const close = button("", "sheet-icon", closeExerciseSheet);
    close.append(icon("close", 20));
    close.setAttribute("aria-label", "Chiudi esercizio");
    const progress = node("div", "sheet-progress");
    progress.setAttribute("aria-label", `Esercizio ${index + 1} di ${exercises.length}`);
    const fill = node("span");
    fill.style.width = `${(index + 1) / exercises.length * 100}%`;
    progress.append(fill);
    const historyButton = button("", "sheet-icon", () => card.sheetData.showHistory());
    historyButton.append(icon("history", 20));
    historyButton.setAttribute("aria-label", "Storico pesi");
    top.append(close, progress, historyButton);
    const scroll = node("div", "sheet-scroll");
    scroll.append(card.sheetData.body);
    const bottom = node("div", "sheet-bottom");
    restTimerDock.hidden = false;
    bottom.append(restTimerDock);
    const lastIndex = exercises.length - 1;
    const doneLabels = (ready) => (index === lastIndex
      ? (ready ? "✓ Fatto e termina" : "Completa e termina")
      : (ready ? "✓ Fatto" : "Completa esercizio"));
    const done = button(doneLabels(false), "primary-button done-button", () => {
      if (!card.sheetData.markDone()) return;
      closeExerciseSheet();
      const next = exercises.findIndex((item, itemIndex) => itemIndex > index && !recordIsComplete(plan, day, week, item));
      if (index < lastIndex && next >= 0) openExercise(next);
      else openSessionSummary(plan, day, week, exercises, true);
    });
    bottom.append(done);
    const refreshDone = () => {
      const ready = card.sheetData.isComplete();
      done.textContent = doneLabels(ready);
      done.classList.toggle("is-secondary", !ready);
    };
    card.sheetData.onUpdate = refreshDone;
    refreshDone();
    sheet.append(top, scroll, bottom);
    onHorizontalSwipe(sheet, { onRight: closeExerciseSheet, edgeOnly: true });
    onHorizontalSwipe(sheet, {
      skipEdge: true,
      ignore: ".series-table, .exercise-gallery, input, textarea, .optional-fields, .history-panel",
      onLeft: () => { if (index + 1 < exercises.length) openExercise(index + 1); },
      onRight: () => { if (index > 0) openExercise(index - 1); },
    });
    document.querySelector(".app-shell").append(sheet);
    activeSheet = sheet;
    updateRestTimerUI();
  }

  function smoothPath(points) {
    return points.reduce((path, point, index) => {
      if (!index) return `M ${point.x} ${point.y}`;
      const previous = points[index - 1];
      const mid = (previous.x + point.x) / 2;
      return `${path} C ${mid} ${previous.y}, ${mid} ${point.y}, ${point.x} ${point.y}`;
    }, "");
  }

  function volumeChart(values, selectedWeek) {
    const width = Math.max(320, (values.length - 1) * 48 + 48);
    const height = 150;
    const left = 24;
    const right = width - 24;
    const top = 14;
    const baseline = 116;
    const maximum = Math.max(...values, 1);
    const points = values.map((value, index) => {
      const x = values.length === 1 ? width / 2 : left + index * (right - left) / (values.length - 1);
      const y = baseline - value / maximum * (baseline - top);
      return { x, y, value, week: index + 1 };
    });
    const segments = [];
    let segment = [];
    points.forEach((point) => {
      if (point.value > 0) segment.push(point);
      else if (segment.length) {
        segments.push(segment);
        segment = [];
      }
    });
    if (segment.length) segments.push(segment);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label",
      "Volume registrato per settimana, in chilogrammi per ripetizioni. Le settimane senza dati non sono rappresentate.");
    const defs = document.createElementNS(svg.namespaceURI, "defs");
    const gradient = document.createElementNS(svg.namespaceURI, "linearGradient");
    gradient.id = "volume-fill-gradient";
    gradient.setAttribute("x1", "0");
    gradient.setAttribute("y1", "0");
    gradient.setAttribute("x2", "0");
    gradient.setAttribute("y2", "1");
    [["0%", "#c6f135", ".3"], ["100%", "#c6f135", "0"]].forEach(([offset, color, opacity]) => {
      const stop = document.createElementNS(svg.namespaceURI, "stop");
      stop.setAttribute("offset", offset);
      stop.setAttribute("stop-color", color);
      stop.setAttribute("stop-opacity", opacity);
      gradient.append(stop);
    });
    defs.append(gradient);
    svg.append(defs);
    [top, (top + baseline) / 2, baseline].forEach((y) => {
      const grid = document.createElementNS(svg.namespaceURI, "line");
      grid.setAttribute("x1", String(left));
      grid.setAttribute("x2", String(right));
      grid.setAttribute("y1", String(y));
      grid.setAttribute("y2", String(y));
      grid.setAttribute("class", "volume-gridline");
      svg.append(grid);
    });
    segments.forEach((recorded) => {
      if (recorded.length === 1) {
        const stem = document.createElementNS(svg.namespaceURI, "line");
        stem.setAttribute("x1", String(recorded[0].x));
        stem.setAttribute("x2", String(recorded[0].x));
        stem.setAttribute("y1", String(recorded[0].y));
        stem.setAttribute("y2", String(baseline));
        stem.setAttribute("class", "volume-stem");
        svg.append(stem);
        return;
      }
      const linePath = smoothPath(recorded);
      const area = document.createElementNS(svg.namespaceURI, "path");
      area.setAttribute("d", `${linePath} L ${recorded[recorded.length - 1].x} ${baseline} ` +
        `L ${recorded[0].x} ${baseline} Z`);
      area.setAttribute("fill", "url(#volume-fill-gradient)");
      svg.append(area);
      const line = document.createElementNS(svg.namespaceURI, "path");
      line.setAttribute("d", linePath);
      line.setAttribute("class", "volume-line");
      svg.append(line);
    });
    points.forEach((point) => {
      if (point.value > 0) {
        const dot = document.createElementNS(svg.namespaceURI, "circle");
        dot.setAttribute("cx", String(point.x));
        dot.setAttribute("cy", String(point.y));
        dot.setAttribute("r", point.week === selectedWeek ? "5" : "3.5");
        dot.setAttribute("class", `volume-dot${point.week === selectedWeek ? " is-current" : ""}`);
        const title = document.createElementNS(svg.namespaceURI, "title");
        title.textContent = `Settimana ${point.week}: ${point.value.toLocaleString("it-IT")} kg`;
        dot.append(title);
        svg.append(dot);
      }

      const label = document.createElementNS(svg.namespaceURI, "text");
      label.setAttribute("x", String(point.x));
      label.setAttribute("y", "140");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("class", `volume-week-label${point.week === selectedWeek ? " is-current" : ""}`);
      label.textContent = `S${point.week}`;
      svg.append(label);
    });
    svg.style.width = `${width}px`;
    return svg;
  }

  function readProfileImage(file) {
    if (!file || !file.type.startsWith("image/")) {
      return Promise.reject(new Error("Seleziona un file immagine."));
    }
    if (file.size > 15 * 1024 * 1024) {
      return Promise.reject(new Error("L'immagine supera il limite di 15 MB."));
    }
    const url = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Non riesco a elaborare questa immagine."));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("Non riesco a ridurre questa immagine."));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("Non riesco a leggere l'immagine elaborata."));
          reader.readAsDataURL(blob);
        }, "image/jpeg", .78);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Il file selezionato non è un'immagine leggibile."));
      };
      image.src = url;
    });
  }

  function exerciseIllustration(exercise) {
    if (exercise.artId) return illustrationCatalog.find((item) => item.id === exercise.artId) || null;
    return illustrationCatalog.find((item) => item.matches.includes(exercise.name)) || null;
  }

  function exerciseEquipment(exercise, illustration) {
    return exercise.equipment && exercise.equipment.trim()
      ? exercise.equipment.trim()
      : (illustration ? illustration.equipment : "Da specificare nella scheda");
  }

  function exerciseInstructions(day, exercise) {
    if (typeof exercise.instructions === "string" && exercise.instructions.trim()) {
      return exercise.instructions;
    }
    if (!basePlan) return "";
    const baseDay = basePlan.days.find((item) => item.id === day.id);
    if (!baseDay) return "";
    const baseExercise = baseDay.exercises.find((item) =>
      item.id === exercise.id && item.name === exercise.name);
    return baseExercise && typeof baseExercise.instructions === "string"
      ? baseExercise.instructions
      : "";
  }

  function renderProfileControl() {
    const container = document.getElementById("profile-control");
    container.replaceChildren();
    const profileButton = button("", "profile-photo-button", () => photoInput.click());
    profileButton.setAttribute("aria-label", state.profileImage ? "Cambia immagine profilo" : "Aggiungi immagine profilo");
    const profileImage = document.createElement("img");
    profileImage.alt = "";
    profileImage.hidden = !state.profileImage;
    if (state.profileImage) profileImage.src = state.profileImage;
    const profileInitial = node("span", "profile-initial", "M");
    profileInitial.hidden = Boolean(state.profileImage);
    const photoBadge = node("span", "profile-photo-badge");
    photoBadge.append(icon("camera", 11));
    const photoInput = document.createElement("input");
    photoInput.type = "file";
    photoInput.accept = "image/*";
    photoInput.hidden = true;
    photoInput.setAttribute("aria-label", "Scegli la tua immagine");
    photoInput.addEventListener("change", async () => {
      const file = photoInput.files && photoInput.files[0];
      if (!file) return;
      try {
        const previous = state.profileImage || "";
        state.profileImage = await readProfileImage(file);
        if (!persist()) {
          state.profileImage = previous;
          return;
        }
        showNotice("Immagine del profilo aggiornata.");
        renderHome();
      } catch (error) {
        console.error("Caricamento immagine profilo non riuscito:", error);
        showNotice(error.message || "Non riesco a caricare l'immagine selezionata.", true);
      }
    });
    profileButton.append(profileImage, profileInitial, photoBadge, photoInput);
    container.append(profileButton);
  }

  function dailyCard(className, build) {
    const card = node("div", `home-card ${className}`);
    const draw = () => {
      card.replaceChildren();
      build(card, draw);
      if (homeTilesRefresh && currentScreen === "home") homeTilesRefresh();
    };
    draw();
    return card;
  }

  function progressBar(ratio) {
    const track = node("div", "chart-track health-track");
    track.setAttribute("aria-hidden", "true");
    const fill = node("span", "chart-fill health-fill");
    fill.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
    track.append(fill);
    return track;
  }

  function stepsCard() {
    return dailyCard("steps-card", (card, draw) => {
      const health = ensureHealth();
      const today = dateKey();
      const total = health.steps[today] || 0;
      const goal = health.goals.steps;
      card.append(node("h3", "", "Passi di oggi"));
      const value = node("div", "home-progress-number", formatNumber(total));
      value.append(node("span", "", ` / ${formatNumber(goal)} passi`));
      card.append(value, progressBar(total / goal));
      card.append(node("p", "hint", total >= goal
        ? "Obiettivo raggiunto. Ottimo lavoro!"
        : `Ti mancano ${formatNumber(goal - total)} passi all'obiettivo.`));
      const row = node("div", "inline-form");
      const input = field("Aggiungi passi", "", { inputMode: "numeric", placeholder: "Es. 2500", maxLength: 6 }, () => {});
      const add = (amount) => {
        if (!/^\d{1,6}$/.test(String(amount)) || Number(amount) < 1) {
          showNotice("Inserisci un numero di passi valido.", true);
          return;
        }
        clearNotice();
        health.steps[today] = Math.min(200000, total + Number(amount));
        persist();
        draw();
      };
      row.append(input.wrapper, button("Aggiungi", "primary-button", () => add(input.input.value.trim())));
      card.append(row);
      const quick = node("div", "action-row");
      quick.append(button("+1.000", "secondary-button", () => add(1000)),
        button("+5.000", "secondary-button", () => add(5000)));
      if (total) {
        quick.append(button("Azzera oggi", "danger-button", () => {
          delete health.steps[today];
          persist();
          draw();
        }));
      }
      card.append(quick);
      const week = node("div", "weekly-chart");
      for (let offset = 6; offset >= 0; offset -= 1) {
        const date = new Date();
        date.setDate(date.getDate() - offset);
        const amount = health.steps[dateKey(date)] || 0;
        const column = node("div", `week-column${offset === 0 ? " is-current" : ""}`);
        column.title = `${formatNumber(amount)} passi`;
        const track = node("div", "week-bar-track");
        const fill = node("span", "week-bar-fill");
        fill.style.height = `${Math.min(100, amount / goal * 100)}%`;
        track.append(fill);
        column.append(track, node("span", "", date.toLocaleDateString("it-IT", { weekday: "narrow" }).toUpperCase()));
        week.append(column);
      }
      card.append(week);
    });
  }

  function waterCard() {
    return dailyCard("water-card", (card, draw) => {
      const health = ensureHealth();
      const today = dateKey();
      const count = health.water[today] || 0;
      const { water: goal, glassMl } = health.goals;
      const setCount = (next) => {
        const value = Math.min(100, Math.max(0, next));
        if (value) health.water[today] = value;
        else delete health.water[today];
        persist();
        draw();
      };
      card.append(node("h3", "", "Acqua di oggi"));
      const liters = count * glassMl / 1000;
      const value = node("div", "home-progress-number", `${formatNumber(liters, 2)} L`);
      value.append(node("span", "", ` / ${formatNumber(goal * glassMl / 1000, 2)} L · ${count}/${goal} bicchieri`));
      card.append(value);
      const glasses = node("div", "glass-grid");
      for (let index = 0; index < Math.min(30, Math.max(goal, count)); index += 1) {
        const glass = button("", `glass${index < count ? " is-full" : ""}`,
          () => setCount(count === index + 1 ? index : index + 1));
        glass.setAttribute("aria-label", `Bicchiere ${index + 1}`);
        glass.setAttribute("aria-pressed", String(index < count));
        glasses.append(glass);
      }
      card.append(glasses);
      const actions = node("div", "action-row");
      actions.append(button(`+${glassMl} ml`, "secondary-button", () => setCount(count + 1)),
        button(`+${glassMl * 2} ml`, "secondary-button", () => setCount(count + 2)));
      if (count) actions.append(button("− Bicchiere", "secondary-button", () => setCount(count - 1)));
      card.append(actions, node("p", "hint", `Un bicchiere = ${glassMl} ml. Puoi cambiare obiettivo e dimensione in Altro.`));
    });
  }

  function weightChart(entries) {
    const width = 320;
    const height = 150;
    const left = 30;
    const right = width - 14;
    const top = 16;
    const baseline = 118;
    const values = entries.map((item) => item.kg);
    const minimum = Math.floor(Math.min(...values) - 1);
    const maximum = Math.ceil(Math.max(...values) + 1);
    const points = entries.map((item, index) => ({
      x: entries.length === 1 ? (left + right) / 2 : left + index * (right - left) / (entries.length - 1),
      y: baseline - (item.kg - minimum) / (maximum - minimum) * (baseline - top),
      item,
    }));
    const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, class: "volume-chart", role: "img",
      "aria-label": `Andamento del peso: da ${formatNumber(values[0], 1)} a ${formatNumber(values[values.length - 1], 1)} kg` });
    svg.append(svgNode("text", { x: 2, y: top + 3, class: "volume-week-label" }, String(maximum)),
      svgNode("text", { x: 2, y: baseline + 3, class: "volume-week-label" }, String(minimum)),
      svgNode("line", { x1: left, x2: right, y1: baseline, y2: baseline, stroke: "#3a3a3a" }));
    if (points.length > 1) {
      svg.append(svgNode("path", { d: smoothPath(points), class: "volume-line" }));
    }
    points.forEach((point, index) => {
      const dot = svgNode("circle", { cx: point.x, cy: point.y, r: 4, class: `volume-dot${index === points.length - 1 ? " is-current" : ""}` });
      dot.append(svgNode("title", {}, `${point.item.date}: ${formatNumber(point.item.kg, 1)} kg`));
      svg.append(dot);
    });
    const label = (point, anchor) => {
      const [, month, day] = point.item.date.split("-");
      svg.append(svgNode("text", { x: point.x, y: 140, "text-anchor": anchor, class: "volume-week-label" }, `${day}/${month}`));
    };
    label(points[0], points.length === 1 ? "middle" : "start");
    if (points.length > 1) label(points[points.length - 1], "end");
    return svg;
  }

  function weightCard() {
    return dailyCard("weight-card", (card, draw) => {
      const health = ensureHealth();
      const entries = health.weights.slice().sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
      card.append(node("h3", "", "Il tuo peso"));
      if (entries.length) {
        const last = entries[entries.length - 1];
        const stats = node("div", "volume-stats");
        const current = node("div", "volume-stat");
        const currentValue = node("strong", "", formatNumber(last.kg, 1));
        currentValue.append(node("small", "", " kg"));
        current.append(node("span", "", "ULTIMO PESO"), currentValue);
        const changeBox = node("div", "volume-stat");
        const change = last.kg - entries[0].kg;
        const changeValue = node("strong", "", entries.length > 1
          ? `${change > 0 ? "+" : ""}${formatNumber(change, 1)}` : "—");
        if (entries.length > 1) changeValue.append(node("small", "", "kg"));
        changeBox.append(node("span", "", "VARIAZIONE"), changeValue);
        stats.append(current, changeBox);
        card.append(stats);
        if (entries.length > 1) {
          const wrap = node("div", "volume-chart-wrap");
          wrap.append(weightChart(entries));
          card.append(wrap);
        } else {
          card.append(node("p", "volume-empty",
            "Prima misurazione registrata. Aggiungine un'altra per vedere l'andamento."));
        }
      } else {
        card.append(node("p", "volume-empty", "Registra il tuo peso per vedere il grafico dell'andamento."));
      }
      const today = dateKey();
      const existing = health.weights.find((item) => item.date === today);
      const row = node("div", "inline-form");
      const input = field("Peso di oggi (kg)", existing ? String(existing.kg).replace(".", ",") : "",
        { inputMode: "decimal", placeholder: "Es. 76,4", maxLength: 6 }, () => {});
      row.append(input.wrapper, button(existing ? "Aggiorna" : "Salva", "primary-button", () => {
        const text = input.input.value.trim().replace(",", ".");
        const kg = Number(text);
        if (!/^\d{2,3}(?:\.\d{1,2})?$/.test(text) || kg < 20 || kg > 500) {
          showNotice("Inserisci un peso valido in kg, per esempio 76,4.", true);
          return;
        }
        clearNotice();
        const entry = health.weights.find((item) => item.date === today);
        if (entry) entry.kg = kg;
        else health.weights.push({ date: today, kg });
        persist();
        draw();
      }));
      card.append(row);
      if (existing) {
        card.append(button("Elimina il peso di oggi", "danger-button", () => {
          health.weights = health.weights.filter((item) => item.date !== today);
          persist();
          draw();
        }));
      }
    });
  }

  function supplementCard() {
    return dailyCard("supplement-card", (card, draw) => {
      const health = ensureHealth();
      const today = dateKey();
      const heading = node("h3", "settings-icon-heading");
      const symbol = node("span", "settings-icon settings-icon-supplement");
      symbol.append(icon("supplement", 19));
      heading.append(symbol, node("span", "", "Integratori di oggi"));
      card.append(heading);
      if (!health.supplements.length) {
        card.append(node("p", "hint", "Non hai ancora aggiunto integratori. Aggiungili qui sotto, in Impostazioni."));
        return;
      }
      const taken = new Set(health.supplementLog[today] || []);
      const done = health.supplements.filter((item) => taken.has(item.id)).length;
      card.append(node("p", "hint", `${done} di ${health.supplements.length} presi oggi.`),
        progressBar(done / health.supplements.length));
      const list = node("div", "check-list");
      for (const item of health.supplements) {
        const label = node("label", `check-item${taken.has(item.id) ? " is-done" : ""}`);
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = taken.has(item.id);
        box.addEventListener("change", () => {
          const next = new Set(health.supplementLog[today] || []);
          if (box.checked) next.add(item.id);
          else next.delete(item.id);
          if (next.size) health.supplementLog[today] = [...next];
          else delete health.supplementLog[today];
          persist();
          draw();
        });
        label.append(box, node("span", "", item.name));
        list.append(label);
      }
      card.append(list);
    });
  }

  function goalField(label, key, unit, minimum, maximum) {
    const health = ensureHealth();
    const item = field(`${label} (${unit})`, String(health.goals[key]),
      { inputMode: "numeric", maxLength: 6 }, (value) => {
        const number = Number(value.trim());
        const valid = /^\d{1,6}$/.test(value.trim()) && number >= minimum && number <= maximum;
        item.input.setAttribute("aria-invalid", String(!valid));
        if (!valid) return;
        health.goals[key] = number;
        persist();
      });
    return item.wrapper;
  }

  function settingsCard() {
    return dailyCard("settings-card", (card) => {
      const health = ensureHealth();
      const heading = node("h3", "settings-icon-heading");
      const symbol = node("span", "settings-icon settings-icon-settings");
      symbol.append(icon("settings", 18));
      heading.append(symbol, node("span", "", "Obiettivi giornalieri"));
      card.append(heading);
      const grid = node("div", "field-grid");
      grid.append(goalField("Passi", "steps", "passi", 1000, 100000),
        goalField("Acqua", "water", "bicchieri", 1, 30),
        goalField("Bicchiere", "glassMl", "ml", 50, 1000));
      card.append(grid);
      const supplementHeading = node("h3", "settings-subtitle settings-icon-heading");
      const supplementSymbol = node("span", "settings-icon settings-icon-supplement");
      supplementSymbol.append(icon("supplement", 18));
      supplementHeading.append(supplementSymbol, node("span", "", "Gestisci integratori"));
      card.append(supplementHeading);
      for (const item of health.supplements) {
        const row = node("div", "supplement-row");
        row.append(node("span", "", item.name), button("Rimuovi", "danger-button", () => {
          health.supplements = health.supplements.filter((entry) => entry.id !== item.id);
          persist();
          renderMore();
        }));
        card.append(row);
      }
      const form = node("div", "inline-form");
      const input = field("Nuovo integratore", "", { placeholder: "Es. Creatina 5 g", maxLength: 60 }, () => {});
      form.append(input.wrapper, button("Aggiungi", "primary-button", () => {
        const name = input.input.value.trim();
        if (!name) return;
        if (health.supplements.length >= 50) {
          showNotice("Hai raggiunto il numero massimo di integratori.", true);
          return;
        }
        clearNotice();
        health.supplements.push({ id: uniqueId("int"), name });
        persist();
        renderMore();
      }));
      card.append(form);
    });
  }

  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }

  const DAILY_QUOTES = [
    "💪 Un set alla volta.",
    "🔥 La costanza batte il talento.",
    "🚀 Oggi meglio di ieri.",
    "🏋️ Peso giusto, tecnica pulita.",
    "⚡ Ogni ripetizione conta.",
    "🎯 Concentrati sulla prossima serie.",
    "🌟 Piccoli passi, grandi risultati.",
    "💧 Bevi, respira, sei sul pezzo.",
    "🧠 La testa decide, il corpo segue.",
    "🏆 Il progresso vive nei dettagli.",
    "😤 Ancora una ripetizione pulita.",
    "🌙 Recupero e sonno fanno crescere.",
    "✨ Il tuo yo di domani ti ringrazia.",
    "🔋 Energia alta, testa libera.",
    "🥇 Non devi essere perfetto, solo presente.",
  ];

  function showDailyQuote() {
    const target = document.getElementById("daily-quote");
    if (!target) return;
    const now = new Date();
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    target.textContent = DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length];
  }

  function fitViewport() {
    const root = document.documentElement;
    const portrait = window.innerHeight >= window.innerWidth;
    const screenHeight = Math.max(window.screen.height, window.screen.width);
    const iphone = /iPhone/.test(navigator.userAgent);
    let state = "normale";
    if (isStandalone() && iphone && portrait) {
      // iOS 26+: dvh/innerHeight possono essere più corti dello schermo; 100vh no. La shell resta nel flusso normale.
      root.style.setProperty("--app-height", "100vh");
      const probe = node("div");
      probe.style.cssText = "position:absolute;visibility:hidden;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0";
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const measuredTop = parseFloat(style.paddingTop) || 0;
      const measuredBottom = parseFloat(style.paddingBottom) || 0;
      probe.remove();
      const topInset = screenHeight >= 874 ? 62 : screenHeight >= 852 ? 59 : screenHeight >= 812 ? 47 : 20;
      const bottomInset = screenHeight >= 812 ? 34 : 0;
      root.style.setProperty("--safe-top", `${Math.max(measuredTop, topInset)}px`);
      root.style.setProperty("--safe-bottom", `${Math.max(measuredBottom, bottomInset)}px`);
      state = measuredTop > 0 ? "cover" : "stimato";
    } else {
      root.style.removeProperty("--safe-bottom");
      root.style.removeProperty("--safe-top");
      if (!isStandalone()) root.style.removeProperty("--app-height");
    }
    root.dataset.viewportState = state;
  }

  function syncKeyboard() {
    const viewport = window.visualViewport;
    if (!viewport || !isStandalone() || !/iPhone/.test(navigator.userAgent)) return;
    const keyboardOpen = viewport.height < window.screen.height * 0.75;
    document.documentElement.style.setProperty("--app-height", keyboardOpen ? `${Math.round(viewport.height)}px` : "100vh");
    if (keyboardOpen) window.scrollTo(0, 0);
  }

  function resetScroll() {
    [0, 16, 50, 100, 200].forEach((delay) => window.setTimeout(() => {
      if (window.scrollY || (window.visualViewport && window.visualViewport.offsetTop)) window.scrollTo(0, 0);
    }, delay));
  }

  function diagnosticsCard() {
    const probe = node("div");
    probe.style.cssText = "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const insets = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(" / ");
    probe.remove();
    const vhProbe = node("div");
    vhProbe.style.cssText = "position:fixed;visibility:hidden;top:0;height:100vh;width:1px";
    document.body.append(vhProbe);
    const probeVh = Math.round(vhProbe.getBoundingClientRect().height);
    vhProbe.remove();
    const shell = document.querySelector(".app-shell").getBoundingClientRect();
    const lines = [
      `Finestra: ${window.innerWidth} × ${window.innerHeight}`,
      `Schermo: ${window.screen.width} × ${window.screen.height}`,
      `Viewport visivo: ${window.visualViewport ? Math.round(window.visualViewport.width) + " × " + Math.round(window.visualViewport.height) : "n.d."}`,
      `App: ${Math.round(shell.width)} × ${Math.round(shell.height)} (alto ${Math.round(shell.top)}, basso ${Math.round(shell.bottom)})`,
      `Barra in basso: alto ${Math.round(document.querySelector(".bottom-nav").getBoundingClientRect().top)}, basso ${Math.round(document.querySelector(".bottom-nav").getBoundingClientRect().bottom)}`,
      `Viewport visivo scostamento: ${window.visualViewport ? Math.round(window.visualViewport.offsetTop) : "n.d."}`,
      `Altezza usata: ${document.documentElement.clientHeight}px (100vh: ${probeVh}px)`,
      `Margini applicati (alto/basso): ${getComputedStyle(document.documentElement).getPropertyValue("--safe-top").trim() || "env"} / ${getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom").trim() || "env"}`,
      `Margini sicuri (alto/dx/basso/sx): ${insets}`,
      `Installata (standalone): ${isStandalone() ? "sì" : "no"} · stato ${document.documentElement.dataset.viewportState || "n.d."}`,
      `Sistema: ${(navigator.userAgent.match(/(?:iPhone )?OS [\d_]+|Android [\d.]+/) || ["n.d."])[0]}`,
    ];
    const card = node("div", "info-card");
    card.append(node("strong", "", "Diagnostica schermo"), node("pre", "diagnostics", lines.join("\n")));
    card.append(button("Mostra linee di prova", "secondary-button", () => {
      const old = document.getElementById("debug-lines");
      if (old) {
        old.remove();
        return;
      }
      const layer = node("div");
      layer.id = "debug-lines";
      layer.style.cssText = "position:fixed;inset:0;z-index:99999;pointer-events:none";
      const line = (css, label) => {
        const item = node("div", "", label);
        item.style.cssText = `position:fixed;left:0;right:0;height:3px;font:700 11px sans-serif;color:#fff;${css}`;
        layer.append(item);
      };
      line("top:0;background:#f00", "");
      line(`top:${window.innerHeight - 3}px;background:#0af`, "");
      line(`top:${window.screen.height - 3}px;background:#f0f`, "");
      line("bottom:0;background:#fa0", "");
      document.body.append(layer);
    }));
    return card;
  }

  function renderMore() {
    const view = views.more;
    view.replaceChildren();
    view.append(titleBlock("PERSONALIZZA", "Altro", "I tuoi obiettivi, integratori e dati in un unico posto."));
    const section = (label) => node("h2", "settings-section-title", label);
    view.append(section("INTEGRATORI DI OGGI"));
    view.append(supplementCard());
    view.append(section("OBIETTIVI E INTEGRATORI"), settingsCard());
    view.append(section("BACKUP"), backupCard());
    const script = document.querySelector('script[src*="app.js"]');
    const version = script ? new URL(script.src).searchParams.get("v") : "";
    const diagnostics = node("details", "diagnostic-details");
    diagnostics.append(node("summary", "", `Informazioni app${version ? ` · v${version}` : ""}`), diagnosticsCard());
    view.append(diagnostics);
  }

  function renderHome() {
    ensureSelection();
    homeTilesRefresh = null;
    const plan = activePlan();
    const week = state.selection.week;
    const progress = weekProgress(plan, week);
    const view = views.home;
    view.replaceChildren();
    renderProfileControl();

    const hour = new Date().getHours();
    const greeting = hour < 13 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera";
    const homeHeading = node("div", "home-heading");
    homeHeading.append(node("p", "eyebrow",
      new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })),
      node("h1", "page-title", "Riepilogo"),
      node("p", "home-salutation", `${greeting}, Marco`));
    view.append(homeHeading);
    const dayStates = plan.days.map((day, index) => ({ day, index, item: progress.days[index] }));
    const upcoming = dayStates.find(({ item }) => item.total > item.completed);
    const health = ensureHealth();
    const today = dateKey();
    const rings = node("div", "activity-card");
    const ringGraphic = svgNode("svg", { viewBox: "0 0 170 170", role: "img", "aria-label": "Anelli attività: allenamento, acqua e passi" });
    const trainingTotal = progress.days.reduce((sum, item) => sum + item.total, 0);
    const trainingDone = progress.days.reduce((sum, item) => sum + item.completed, 0);
    const ringValues = [
      { color: "#C6F135", ratio: trainingTotal ? trainingDone / trainingTotal : 0, label: "Allenamento",
        value: `${trainingDone}/${trainingTotal} esercizi` },
      { color: "#32ADE6", ratio: (health.water[today] || 0) / health.goals.water, label: "Acqua",
        value: `${health.water[today] || 0}/${health.goals.water} bicchieri` },
      { color: "#FF8A3D", ratio: (health.steps[today] || 0) / health.goals.steps, label: "Passi",
        value: formatNumber(health.steps[today] || 0) },
    ];
    ringValues.forEach((item, index) => {
      const radius = 70 - index * 19;
      const circumference = 2 * Math.PI * radius;
      ringGraphic.append(svgNode("circle", { cx: 85, cy: 85, r: radius, class: "ring-track", "stroke-width": 11 }));
      ringGraphic.append(svgNode("circle", { cx: 85, cy: 85, r: radius, class: "ring-progress",
        stroke: item.color, "stroke-width": 11, "stroke-dasharray": `${Math.min(1, Math.max(0, item.ratio)) * circumference} ${circumference}`,
        opacity: item.ratio ? 1 : 0, transform: "rotate(-90 85 85)" }));
    });
    if (ringValues.every((item) => item.ratio >= 1)) {
      ringGraphic.append(svgNode("path", { d: "M80 84l4 4 8-9", fill: "none", stroke: "#C6F135",
        "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    }
    const legend = node("div", "activity-legend");
    legend.append(node("h2", "", "Attività"));
    ringValues.forEach((item) => {
      const row = node("div", "ring-legend-row");
      row.style.setProperty("--metric-color", item.color);
      row.append(node("span", "ring-dot"), node("div", "ring-legend-text"));
      row.lastChild.append(node("span", "", item.label), node("strong", "", item.value));
      legend.append(row);
    });
    rings.append(ringGraphic, legend);
    view.append(rings);

    const hero = node("div", "hero");
    hero.append(node("span", "eyebrow", "PROSSIMO ALLENAMENTO"));
    if (upcoming) {
      const { day, item } = upcoming;
      const started = item.completed > 0;
      const next = node("div", "next-workout");
      const nextText = node("div");
      nextText.append(node("strong", "", day.name),
        node("span", "", `${day.subtitle || "La tua seduta"} · S${week} · ${item.completed}/${item.total}`));
      next.append(nextText);
      const art = activeExercises(day, week).map(exerciseIllustration).find(Boolean);
      if (art) {
        const image = document.createElement("img");
        image.className = "next-art";
        image.src = art.src;
        image.alt = "";
        next.append(image);
      }
      hero.append(next, button(started ? "Continua" : "Inizia allenamento", "primary-button hero-action", () => {
        state.selection.dayId = day.id;
        persist();
        setScreen("workout");
      }));
    } else {
      hero.append(node("p", "hero-copy", progress.total
        ? "Settimana completata. Ottimo lavoro! Recupera bene."
        : "Nessun esercizio programmato per questa settimana."));
    }
    view.append(hero);
    const dots = node("div", "week-dots");
    dots.setAttribute("aria-label", `${progress.completed} di ${progress.total} giornate completate`);
    dayStates.forEach(({ day, item }) => {
      const dot = button(day.name, `week-dot${item.total && item.completed === item.total ? " is-done" : ""}`, () => {
        state.selection.dayId = day.id;
        persist();
        setScreen("workout");
      });
      dots.append(dot);
    });
    view.append(dots);

    const todayHeading = node("div", "section-heading");
    todayHeading.append(node("h2", "", "Oggi"));
    const tiles = node("div", "today-grid");
    const detailCards = {};
    const miniBars = (kind, data) => {
      const graph = node("div", `tile-mini tile-mini-${kind}`);
      if (kind === "weight" && data.length > 1) {
        const minimum = Math.min(...data);
        const maximum = Math.max(...data);
        const points = data.map((value, index) => ({
          x: 2 + index * 80 / (data.length - 1),
          y: 19 - (value - minimum) / Math.max(maximum - minimum, 1) * 16,
        }));
        const svg = svgNode("svg", { viewBox: "0 0 85 22", "aria-hidden": "true" });
        svg.append(svgNode("path", { d: smoothPath(points), fill: "none", stroke: "currentColor",
          "stroke-width": 2, "stroke-linecap": "round" }));
        graph.append(svg);
        return graph;
      }
      data.forEach((value) => {
        const bar = node("span");
        bar.style.height = `${Math.max(3, Math.min(100, value * 100))}%`;
        graph.append(bar);
      });
      return graph;
    };
    const drawTiles = () => {
      const health = ensureHealth();
      const today = dateKey();
      const steps = health.steps[today] || 0;
      const glasses = health.water[today] || 0;
      const lastWeight = health.weights.slice().sort((a, b) => a.date.localeCompare(b.date)).pop();
      const taken = (health.supplementLog[today] || []).filter((id) => health.supplements.some((item) => item.id === id)).length;
      const tile = (kind, label, value, unit, data, action) => {
        const result = button("", `today-tile tile-${kind}`, action);
        result.setAttribute("aria-label", `${label}: ${value}${unit ? " " + unit : ""}. Apri dettagli`);
        const top = node("div", "tile-top");
        top.append(icon(kind, 23), node("span", "tile-label", label));
        const number = node("strong", "tile-value", value);
        number.append(node("small", "", unit));
        const foot = node("div", "tile-foot");
        foot.append(miniBars(kind, data), node("span", "tile-action", "+"));
        result.append(top, number, foot);
        return result;
      };
      const weekValues = (key, goal) => Array.from({ length: 7 }, (_, index) => {
        const day = new Date();
        day.setDate(day.getDate() - 6 + index);
        return (health[key][dateKey(day)] || 0) / goal;
      });
      const weightValues = health.weights.slice().sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
      tiles.replaceChildren(
        tile("steps", "PASSI", formatNumber(steps), "passi",
          weekValues("steps", health.goals.steps), () => openHealthSheet(detailCards.steps, "Passi")),
        tile("water", "ACQUA", formatNumber(glasses * health.goals.glassMl / 1000, 2), "L",
          weekValues("water", health.goals.water), () => openHealthSheet(detailCards.water, "Acqua")),
        tile("weight", "PESO", lastWeight ? formatNumber(lastWeight.kg, 1) : "—", "kg",
          weightValues.map((entry) => entry.kg),
          () => openHealthSheet(detailCards.weight, "Peso")),
        tile("supplement", "INTEGRATORI", health.supplements.length ? `${taken}/${health.supplements.length}` : "—", "presi",
          health.supplements.map((item) => (health.supplementLog[today] || []).includes(item.id) ? 1 : .16),
          () => setScreen("more"))
      );
      ringValues[0].ratio = trainingTotal ? trainingDone / trainingTotal : 0;
      ringValues[1].ratio = glasses / health.goals.water;
      ringValues[1].value = `${glasses}/${health.goals.water} bicchieri`;
      ringValues[2].ratio = steps / health.goals.steps;
      ringValues[2].value = formatNumber(steps);
      ringGraphic.querySelectorAll(".ring-progress").forEach((circle, index) => {
        const radius = 70 - index * 19;
        circle.setAttribute("stroke-dasharray",
          `${Math.min(1, Math.max(0, ringValues[index].ratio)) * 2 * Math.PI * radius} ${2 * Math.PI * radius}`);
        circle.setAttribute("opacity", ringValues[index].ratio ? "1" : "0");
      });
      legend.querySelectorAll(".ring-legend-text strong").forEach((label, index) => { label.textContent = ringValues[index].value; });
    };
    drawTiles();
    homeTilesRefresh = drawTiles;
    detailCards.steps = stepsCard();
    detailCards.water = waterCard();
    detailCards.weight = weightCard();
    view.append(todayHeading, tiles);

    const heading = node("div", "section-heading");
    heading.append(node("h2", "", "I tuoi progressi"));
    view.append(heading);
    const summary = node("div", "home-card");
    summary.append(node("h3", "", `Settimana ${week}`));
    const number = node("div", "home-progress-number", String(progress.completed));
    number.append(node("span", "", ` / ${progress.total} giornate completate`));
    summary.append(number);
    let motivation;
    if (!progress.total) motivation = "Aggiungi esercizi alla scheda per iniziare a vedere i progressi.";
    else if (progress.completed === progress.total) motivation = "Settimana completata. Ottimo lavoro!";
    else if (!progress.completed) motivation = "Quando sei pronto, inizia dal primo allenamento: un passo alla volta.";
    else {
      const remaining = progress.total - progress.completed;
      motivation = `Hai completato ${progress.completed} ${progress.completed === 1 ? "giornata" : "giornate"}. ` +
        `${remaining === 1 ? "Ne manca ancora una" : `Ne mancano ancora ${remaining}`} per completare la settimana.`;
    }
    summary.append(node("p", "hint", motivation));
    const chart = node("div", "progress-chart");
    plan.days.forEach((day, index) => {
      const item = progress.days[index];
      const row = node("div", "chart-row");
      row.style.setProperty("--day-color", dayColors[index][0]);
      row.setAttribute("aria-label", `${day.name}: ${item.completed} di ${item.total} esercizi completati`);
      const track = node("div", "chart-track");
      track.setAttribute("aria-hidden", "true");
      const fill = node("span", "chart-fill");
      fill.style.width = `${item.total ? item.completed / item.total * 100 : 0}%`;
      track.append(fill);
      row.append(node("span", "chart-name", day.name), track,
        node("span", "chart-value", `${item.completed}/${item.total}`));
      chart.append(row);
    });
    summary.append(chart);
    view.append(summary);

    const volumeValues = Array.from({ length: plan.weeks }, (_, index) => weekVolume(plan, index + 1));
    const volumeCard = node("div", "home-card volume-card");
    volumeCard.append(node("h3", "", "Il tuo volume"));
    volumeCard.append(node("p", "hint", "Quanto peso hai sollevato in totale: peso × ripetizioni di tutte le serie completate."));
    const volumeStats = node("div", "volume-stats");
    const currentVolume = node("div", "volume-stat");
    const currentValue = node("strong");
    currentValue.append(document.createTextNode(volumeValues[week - 1].toLocaleString("it-IT")),
      node("small", "", "kg"));
    currentVolume.append(node("span", "", `Settimana ${week}`), currentValue);
    const blockVolume = node("div", "volume-stat");
    const totalVolume = volumeValues.reduce((sum, value) => sum + value, 0);
    const blockValue = node("strong");
    blockValue.append(document.createTextNode(totalVolume.toLocaleString("it-IT")),
      node("small", "", "kg"));
    blockVolume.append(node("span", "", "Totale blocco"), blockValue);
    volumeStats.append(currentVolume, blockVolume);
    volumeCard.append(volumeStats);
    if (totalVolume === 0) {
      volumeCard.append(node("p", "volume-empty",
        "Ancora nessun dato. Inserisci peso e ripetizioni nelle serie: qui vedrai il carico sollevato settimana dopo settimana."));
    } else {
      const volumeChartWrap = node("div", "volume-chart-wrap");
      volumeChartWrap.append(volumeChart(volumeValues, week));
      volumeCard.append(volumeChartWrap);
      volumeCard.append(node("p", "hint volume-note",
        "Stima basata su peso × ripetizioni inseriti; per gli esercizi unilaterali somma entrambi i lati."));
    }
    view.append(volumeCard);

    const weekly = node("div", "home-card");
    weekly.append(node("h3", "", "Allenamenti completati"),
      node("p", "hint", "Giornate concluse in ogni settimana del blocco."));
    const bars = node("div", "weekly-chart");
    for (let number = 1; number <= plan.weeks; number += 1) {
      const item = weekProgress(plan, number);
      const column = node("div", `week-column${number === week ? " is-current" : ""}`);
      column.setAttribute("aria-label", `Settimana ${number}: ${item.completed} di ${item.total} giornate completate`);
      column.title = `${item.completed} / ${item.total} giornate`;
      const track = node("div", "week-bar-track");
      track.setAttribute("aria-hidden", "true");
      const fill = node("span", "week-bar-fill");
      fill.style.height = `${item.total ? item.completed / item.total * 100 : 0}%`;
      track.append(fill);
      column.append(track, node("span", "", `S${number}`));
      bars.append(column);
    }
    if (volumeValues.some((_, index) => weekProgress(plan, index + 1).completed > 0)) {
      weekly.append(bars);
    } else {
      weekly.append(node("p", "volume-empty",
        "Ancora nessuna giornata completata. Le settimane compariranno qui dopo il primo allenamento."));
    }
    view.append(weekly);

    const reminder = node("div", "info-card");
    reminder.style.marginTop = "18px";
    reminder.append(
      node("strong", "", "Un promemoria. "),
      document.createTextNode(
        "I dati restano su questo dispositivo. Mantieni tecnica e respirazione confortevoli; " +
        "se compaiono fastidi, interrompi e confrontati con il medico."
      )
    );
    view.append(reminder);
  }

  function stepDay(direction) {
    if (currentScreen !== "workout") return;
    const plan = activePlan();
    const index = plan.days.findIndex((item) => item.id === state.selection.dayId) + direction;
    if (index < 0 || index >= plan.days.length) return;
    state.selection.dayId = plan.days[index].id;
    persist();
    renderWorkout();
    scrollContent.scrollTo({ top: 0, behavior: "auto" });
  }

  function renderWorkout() {
    ensureSelection();
    const plan = activePlan();
    const day = plan.days.find((item) => item.id === state.selection.dayId);
    const week = state.selection.week;
    const exercises = activeExercises(day, week);
    const view = views.workout;
    view.replaceChildren();
    const timerExercise = exercises.find((exercise) => parseRestSeconds(exercise.rest) > 0) || exercises[0];
    if (timerExercise) selectRestTimer(plan, day, timerExercise);
    else {
      selectedRestTimer = null;
      updateRestTimerUI();
    }

    const heading = node("div", "section-heading workout-heading");
    const headingText = node("div");
    headingText.append(node("h1", "page-title", "Allenamento"), node("p", "", "Scegli il giorno"));
    const weekControl = node("div", "week-control");
    const chevron = (direction) => {
      const icon = svgNode("svg", { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor",
        "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
      icon.append(svgNode("path", { d: direction < 0 ? "M14.5 6l-6 6 6 6" : "M9.5 6l6 6-6 6" }));
      return icon;
    };
    const previous = button("", "icon-button", () => {
      state.selection.week -= 1;
      persist();
      renderWorkout();
    });
    previous.append(chevron(-1));
    previous.disabled = week === 1;
    previous.setAttribute("aria-label", "Settimana precedente");
    const next = button("", "icon-button", () => {
      state.selection.week += 1;
      persist();
      renderWorkout();
    });
    next.append(chevron(1));
    next.disabled = week === plan.weeks;
    next.setAttribute("aria-label", "Settimana successiva");
    const weekLabel = node("span", "week-label");
    weekLabel.setAttribute("aria-live", "polite");
    weekLabel.append(node("small", "", "SETTIMANA"), node("b", "", `${week} / ${plan.weeks}`));
    if (plan.weeks <= 10) {
      const dots = node("span", "week-pips");
      dots.setAttribute("aria-hidden", "true");
      for (let number = 1; number <= plan.weeks; number += 1) {
        dots.append(node("i", number === week ? "is-current" : (number < week ? "is-past" : "")));
      }
      weekLabel.append(dots);
    }
    weekControl.append(previous, weekLabel, next);
    heading.append(headingText, weekControl);
    view.append(heading);
    view.append(dayStrip(plan.days, day.id, (id) => {
      state.selection.dayId = id;
      persist();
      renderWorkout();
    }));

    const routine = node("div", "routine-meta");
    const rir = node("span");
    rir.append(
      document.createTextNode("RIR  "),
      node("strong", "", `multi ${formatRir(plan.rir.multi[week - 1])}`),
      document.createTextNode("  ·  "),
      node("strong", "", `isolamenti ${formatRir(plan.rir.iso[week - 1])}`)
    );
    const doneCount = node("span", "", "");
    routine.append(rir, doneCount);
    const guide = node("details", "workout-guide");
    guide.append(node("summary", "", "Come leggere la scheda"));
    guide.querySelector("summary").setAttribute("aria-label", "Come leggere la scheda");
    const guideList = node("ul", "workout-guide-list");
    [
      "3 × 8–12 significa 3 serie, ciascuna da 8 a 12 ripetizioni; recupera per il tempo indicato.",
      "RIR 3 significa fermarti quando stimi di poter fare ancora circa 3 ripetizioni pulite.",
      "Per progredire, mantieni il peso e aggiungi ripetizioni; aumenta di poco solo quando tutte le serie raggiungono il limite alto rispettando il RIR.",
      "Nei movimenti a un braccio completa entrambi i lati prima del recupero. Le sigle 7a/7b sono braccia sulla stessa panca; se è occupata, svolgili separati."
    ].forEach((text) => guideList.append(node("li", "", text)));
    guide.append(guideList);
    const closeGuide = (event) => {
      if (!guide.isConnected) {
        document.removeEventListener("pointerdown", closeGuide, true);
      } else if (guide.open && !guide.contains(event.target)) {
        guide.open = false;
      }
    };
    document.addEventListener("pointerdown", closeGuide, true);
    const routineGuide = node("div", "routine-guide");
    routineGuide.append(routine, guide);
    view.append(routineGuide);
    const exerciseHeading = node("div", "section-heading");
    const exerciseTitle = node("div");
    exerciseTitle.append(node("h2", "", day.name), node("p", "", day.subtitle || "La tua seduta"));
    exerciseHeading.append(exerciseTitle, node("span", "small-count", `${exercises.length} esercizi`));
    view.append(exerciseHeading);

    const list = node("div", "exercise-list");
    const cards = new Map();
    const dayIndex = plan.days.findIndex((item) => item.id === day.id);
    const finishButton = button("", "primary-button finish-button",
      () => openSessionSummary(plan, day, week, exercises, true));
    finishButton.hidden = true;
    const sessionFinished = () => {
      const session = isObject(state.sessions) ? state.sessions[sessionKey(plan, day, week)] : null;
      return Boolean(session && session.finished);
    };
    const refreshFinish = () => {
      if (!finishButton.isConnected) return;
      const hasData = sessionStats(plan, day, week, exercises).setsDone > 0 ||
        exercises.some((exercise) => recordIsComplete(plan, day, week, exercise));
      finishButton.hidden = !hasData;
      const finished = sessionFinished();
      finishButton.textContent = finished ? "✓ Allenamento terminato · vedi riepilogo" : "Termina allenamento";
      finishButton.classList.toggle("is-finished", finished);
    };
    const onSessionFinished = () => {
      if (!finishButton.isConnected) document.removeEventListener("session-finished", onSessionFinished);
      else refreshFinish();
    };
    document.addEventListener("session-finished", onSessionFinished);
    const updateCount = () => {
      const completed = exercises.filter((exercise) => recordIsComplete(plan, day, week, exercise)).length;
      const next = exercises.find((exercise) => !recordIsComplete(plan, day, week, exercise));
      for (const exercise of exercises) {
        const card = cards.get(exercise.id);
        if (!card) continue;
        const done = recordIsComplete(plan, day, week, exercise);
        card.classList.toggle("is-complete", done);
        card.classList.toggle("is-next", Boolean(next && next.id === exercise.id));
      }
      doneCount.textContent = `${completed}/${exercises.length} completati`;
      refreshFinish();
    };
    if (!exercises.length) {
      list.append(node("div", "empty-state", "Nessun esercizio programmato per questa settimana."));
    }
    exercises.forEach((exercise, exerciseIndex) => {
      const card = exerciseCard(plan, day, week, exercise, updateCount, () => openExercise(exerciseIndex));
      card.style.setProperty("--day-rgb", dayColors[dayIndex][1]);
      cards.set(exercise.id, card);
      list.append(card);
    });
    const openExercise = (index) => {
      const card = cards.get(exercises[index].id);
      openExerciseSheet({ plan, day, week, exercises, index, card, openExercise });
    };
    view.append(list, finishButton);
    updateCount();
    updateRestTimerUI();
  }

  function formatDuration(minutes) {
    if (!minutes) return "—";
    return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`;
  }

  function openSessionSummary(plan, day, week, exercises, finish = false) {
    if (finish) finishSession(plan, day, week);
    const stats = sessionStats(plan, day, week, exercises);
    const card = node("div", "summary-card");
    const allDone = stats.total > 0 && stats.exercisesDone === stats.total;
    const count = `${stats.exercisesDone} ${stats.exercisesDone === 1 ? "esercizio" : "esercizi"} su ${stats.total}`;
    card.append(node("p", "summary-lead", finish
      ? (allDone ? "Allenamento completato e salvato. Ottimo lavoro!" : `Allenamento salvato: ${count} completati.`)
      : (allDone ? `${day.name} completato. Ottimo lavoro!` : `Finora hai completato ${count}.`)));
    const tiles = node("div", "summary-tiles");
    const tile = (label, value, unit = "") => {
      const item = node("div", "sheet-tile");
      const strong = node("strong", "", value);
      if (unit) strong.append(node("small", "", ` ${unit}`));
      item.append(node("span", "", label), strong);
      return item;
    };
    tiles.append(
      tile("Durata", formatDuration(stats.minutes)),
      tile("Esercizi", `${stats.exercisesDone}/${stats.total}`),
      tile("Serie", String(stats.setsDone)),
      tile("Volume", formatNumber(Math.round(stats.volume)), "kg")
    );
    card.append(tiles);
    const prTitle = node("h3", "summary-title", stats.prs.length ? "Nuovi record" : "Record");
    card.append(prTitle);
    if (stats.prs.length) {
      for (const pr of stats.prs) {
        const row = node("div", "summary-pr");
        row.append(node("strong", "", pr.name), node("span", "", pr.load
          ? `${formatNumber(pr.now.load, 2)} kg · prima ${formatNumber(pr.prior.load, 2)} kg`
          : `Massimale stimato ${formatNumber(pr.now.e1rm, 1)} kg · prima ${formatNumber(pr.prior.e1rm, 1)} kg`));
        card.append(row);
      }
    } else {
      card.append(node("p", "hint", "Nessun nuovo record in questa seduta: i record compaiono quando superi peso o forza stimata delle sedute precedenti."));
    }
    if (finish) {
      card.append(node("p", "hint", "Tutti i dati sono salvati su questo dispositivo. Puoi riaprire l'allenamento e modificarlo quando vuoi."));
      card.append(button("Chiudi", "primary-button summary-close", closeHealthSheet));
    }
    openHealthSheet(card, finish ? "Allenamento terminato" : "Riepilogo seduta");
  }

  // Gli id degli esercizi si ripetono tra i giorni (exercise-1...): l'id vale solo dentro lo stesso blocco e giorno.
  function sameExercise(record, exercise, currentKey) {
    if (record.exerciseName === exercise.name) return true;
    let parts = null;
    try {
      parts = JSON.parse(currentKey);
    } catch (error) {
      return false;
    }
    return Array.isArray(parts) && record.planId === parts[0] && record.dayId === parts[1] &&
      record.exerciseId === exercise.id;
  }

  function formatSetSummary(set, unilateral) {
    const load = set.load ? `${formatNumber(Number(set.load.replace(",", ".")) || 0, 2)} kg` : "— kg";
    const reps = unilateral ? `dx ${set.right || "—"} · sx ${set.left || "—"}` : (set.reps || "—");
    return `${reps} × ${load}`;
  }

  function historyPanel(exercise, currentKey) {
    const wrapper = node("div", "history-panel");
    const toggle = button("Storico pesi", "secondary-button history-toggle", () => {
      const open = list.hidden;
      list.hidden = !open;
      toggle.textContent = open ? "Nascondi storico" : "Storico pesi";
      toggle.setAttribute("aria-expanded", String(open));
    });
    toggle.setAttribute("aria-expanded", "false");
    const list = node("div", "history-panel-list");
    list.hidden = true;
    const refresh = () => {
      list.replaceChildren();
      const hasData = (set) => set.load || set.reps || set.left || set.right;
      const entries = Object.entries(state.records)
        .filter(([, record]) => sameExercise(record, exercise, currentKey) &&
          (record.kind === "cardio" ? record.load : record.series && record.series.some(hasData)))
        .map(([key, record]) => ({ key, record }))
        .sort((left, right) => right.record.updatedAt.localeCompare(left.record.updatedAt));
      if (!entries.length) {
        list.append(node("p", "hint", "Nessun dato per questo esercizio: comparirà qui appena inserisci peso e ripetizioni."));
        return;
      }
      const loads = entries.flatMap(({ record }) => (record.series || [])
        .map((set) => Number((set.load || "").replace(",", "."))).filter((value) => value > 0));
      if (loads.length) {
        list.append(node("p", "history-best", `Massimo registrato: ${formatNumber(Math.max(...loads), 2)} kg`));
      }
      for (const { key, record } of entries.slice(0, 12)) {
        const row = node("div", "history-panel-row");
        const date = new Date(record.updatedAt);
        const dateLabel = Number.isNaN(date.getTime()) ? record.updatedAt
          : date.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        row.append(node("strong", "", dateLabel),
          node("small", "", `Settimana ${record.week} · ${record.dayName}${key === currentKey ? " · in corso" : ""}`));
        if (record.kind === "cardio") {
          row.append(node("span", "history-line", `${record.load} min${record.reps ? ` · ${record.reps}` : ""}`));
        } else {
          record.series.forEach((set, index) => {
            if (hasData(set)) row.append(node("span", "history-line", `Serie ${index + 1}: ${formatSetSummary(set, exercise.unilateral)}`));
          });
        }
        list.append(row);
      }
    };
    refresh();
    wrapper.append(toggle, list);
    return { wrapper, refresh, show() {
      if (list.hidden) toggle.click();
      wrapper.scrollIntoView({ behavior: "smooth", block: "start" });
    } };
  }

  function swipeToDelete(row, onDelete) {
    const wrap = node("div", "series-swipe");
    const remove = button("", "series-delete", onDelete);
    remove.setAttribute("aria-label", "Elimina la serie aggiunta");
    const icon = svgNode("svg", { viewBox: "0 0 24 24", width: 22, height: 22, fill: "none", stroke: "currentColor",
      "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    icon.append(svgNode("path", { d: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" }));
    remove.append(icon);
    const width = 72;
    let startX = 0;
    let startY = 0;
    let base = 0;
    let offset = 0;
    let open = false;
    let dragging = false;
    let decided = false;
    const move = (value, animate) => {
      row.style.transition = animate ? "transform .18s" : "none";
      row.style.transform = `translateX(${value}px)`;
      offset = value;
    };
    const begin = (x, y) => {
      startX = x;
      startY = y;
      base = open ? -width : 0;
      dragging = true;
      decided = false;
    };
    // Restituisce true quando il gesto è orizzontale e deve bloccare lo scorrimento della pagina.
    const track = (x, y) => {
      if (!dragging) return false;
      const dx = x - startX;
      const dy = y - startY;
      if (!decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return false;
        decided = true;
        if (Math.abs(dy) > Math.abs(dx)) {
          dragging = false;
          return false;
        }
      }
      move(Math.min(0, Math.max(-width, base + dx)), false);
      return true;
    };
    const finish = () => {
      if (!dragging) return;
      dragging = false;
      if (!decided) return;
      open = offset < -width / 2;
      move(open ? -width : 0, true);
    };
    row.addEventListener("touchstart", (event) => begin(event.touches[0].clientX, event.touches[0].clientY), { passive: true });
    row.addEventListener("touchmove", (event) => {
      if (track(event.touches[0].clientX, event.touches[0].clientY) && event.cancelable) event.preventDefault();
    }, { passive: false });
    row.addEventListener("touchend", finish);
    row.addEventListener("touchcancel", finish);
    row.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch") return;
      begin(event.clientX, event.clientY);
    });
    row.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      if (track(event.clientX, event.clientY) && row.setPointerCapture) row.setPointerCapture(event.pointerId);
    });
    row.addEventListener("pointerup", (event) => { if (event.pointerType !== "touch") finish(); });
    row.addEventListener("pointercancel", (event) => { if (event.pointerType !== "touch") finish(); });
    wrap.append(remove, row);
    return wrap;
  }

  // Gesto orizzontale generico: chiama onLeft / onRight quando lo spostamento è chiaro e prevalente.
  function onHorizontalSwipe(element, { onLeft, onRight, edgeOnly = false, skipEdge = false, ignore = "" }) {
    let startX = 0;
    let startY = 0;
    let active = false;
    element.addEventListener("touchstart", (event) => {
      const touch = event.touches[0];
      active = event.touches.length === 1 &&
        (!edgeOnly || touch.clientX < 28) &&
        (!skipEdge || touch.clientX >= 28) &&
        !(ignore && event.target.closest && event.target.closest(ignore));
      startX = touch.clientX;
      startY = touch.clientY;
    }, { passive: true });
    element.addEventListener("touchmove", (event) => {
      if (!active || !event.cancelable) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) event.preventDefault();
    }, { passive: false });
    element.addEventListener("touchend", (event) => {
      if (!active) return;
      active = false;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
      if (dx > 0 && onRight) onRight();
      if (dx < 0 && onLeft) onLeft();
    });
    element.addEventListener("touchcancel", () => { active = false; });
  }

  function exerciseCard(plan, day, week, exercise, updateCount, openSheet) {
    const key = recordKey(plan.id, day.id, week, exercise.id);
    const existing = state.records[key];
    const illustration = exerciseIllustration(exercise);
    const isCardio = exercise.kind === "cardio";
    const targetCount = isCardio ? 0 : exercise.sets[week - 1];
    let seriesTouched = Boolean(existing && Array.isArray(existing.series));
    const series = seriesTouched ? clone(existing.series) : [];
    while (series.length < targetCount) series.push({ load: "", reps: "", left: "", right: "", done: false });

    const card = node("div", "exercise-card");
    const top = node("button", "card-top");
    top.type = "button";
    top.addEventListener("click", () => openSheet(exercise.id));
    if (illustration) {
      const thumbnail = node("span", "exercise-thumbnail");
      const image = document.createElement("img");
      image.src = illustration.thumb || illustration.src;
      image.alt = "";
      image.width = 80;
      image.height = 56;
      image.loading = "lazy";
      thumbnail.append(image);
      top.append(thumbnail);
    }
    const info = node("div", "exercise-info");
    info.append(node("h3", "", exercise.name));
    const target = isCardio
      ? exercise.reps
      : `${exercise.sets[week - 1]} serie  ·  ${exercise.reps} rip.`;
    info.append(node("p", "exercise-target", target));
    const noteLine = node("p", "exercise-note");
    const savedNote = () => (isObject(state.exerciseNotes) && state.exerciseNotes[exercise.name]) || "";
    noteLine.textContent = savedNote();
    noteLine.hidden = !noteLine.textContent;
    const prChip = node("span", "pr-badge", "Record");
    prChip.hidden = true;
    info.append(noteLine, prChip);
    const status = node("span", "exercise-status sr-only");
    status.setAttribute("role", "status");
    info.append(status);
    const chevron = node("span", "card-chevron", "›");
    top.append(info, chevron);
    card.append(top);

    const body = node("div", "card-body");
    body.append(node("h2", "sheet-title", exercise.name));
    if (illustration) {
      const buildVisual = () => {
        const card = node("div", "visual-zoom");
        const figure = node("div", "exercise-figure");
        const big = document.createElement("img");
        big.src = illustration.src;
        big.alt = `${exercise.name}: schema indicativo con posizione di partenza, arrivo e direzione del movimento.`;
        big.width = 366;
        big.height = 270;
        figure.append(big);
        card.append(figure);
        if (Array.isArray(illustration.cues) && illustration.cues.length) {
          const cues = node("ol", "visual-cues");
          illustration.cues.forEach((cue) => {
            const item = node("li");
            item.append(node("b", "", String(cue.n)), node("span", "", cue.text));
            cues.append(item);
          });
          card.append(cues);
        }
        const note = node("div", "visual-note");
        if (illustration.move) {
          const move = node("p", "visual-move");
          move.append(node("strong", "", "Movimento: "), document.createTextNode(illustration.move));
          note.append(move);
        }
        if (illustration.avoid) {
          const avoid = node("p", "visual-avoid");
          avoid.append(node("strong", "", "Evita: "), document.createTextNode(illustration.avoid));
          note.append(avoid);
        }
        if (note.childElementCount) card.append(note);
        return card;
      };
      const peek = node("button", "exercise-peek");
      peek.type = "button";
      peek.setAttribute("aria-label", `Ingrandisci lo schema di ${exercise.name}`);
      const small = document.createElement("img");
      small.src = illustration.src;
      small.alt = "";
      small.width = 366;
      small.height = 270;
      peek.append(small);
      const hint = node("span", "peek-hint");
      hint.append(node("strong", "", illustration.muscle || "Schema"), node("small", "", "Tocca per ingrandire"));
      peek.append(hint);
      peek.addEventListener("click", () => openHealthSheet(buildVisual(), exercise.name));
      body.append(peek);
    }    const tiles = node("div", "sheet-tiles");
    const infoTile = (label, value, unit = "") => {
      const tile = node("div", "sheet-tile");
      const strong = node("strong", "", value);
      if (unit) strong.append(node("small", "", unit));
      tile.append(node("span", "", label), strong);
      return tile;
    };
    const restSeconds = parseRestSeconds(exercise.rest);
    const restValue = !restSeconds ? exercise.rest
      : restSeconds < 60 ? String(restSeconds)
        : `${Math.floor(restSeconds / 60)}${restSeconds % 60 ? `:${String(restSeconds % 60).padStart(2, "0")}` : ""}`;
    const restUnit = !restSeconds ? "" : restSeconds < 60 ? " sec" : " min";
    const repsParts = String(exercise.reps).split("/");
    if (isCardio) {
      tiles.append(infoTile("Durata", exercise.reps));
    } else {
      tiles.append(
        infoTile("Serie", String(targetCount), exercise.unilateral ? " per lato" : ""),
        infoTile("Ripetizioni", repsParts[0].trim(), repsParts[1] ? ` /${repsParts[1].trim()}` : ""),
        infoTile("Recupero", restValue, restUnit)
      );
    }
    body.append(tiles);
    const chips = node("div", "sheet-chips");
    if (exercise.pair) chips.append(node("span", "chip", `Superserie ${exercise.pair}`));
    if (exercise.unilateral) chips.append(node("span", "chip", "Per lato"));
    const prChipSheet = node("span", "chip pr-chip", "Nuovo record personale");
    prChipSheet.hidden = true;
    chips.append(prChipSheet);
    body.append(chips);
    const seriesSlot = node("div", "series-slot");
    body.append(seriesSlot);
    const coachLines = coachingTip(plan, week, exercise, targetCount);
    if (coachLines.length) {
      const coach = node("section", "coach-tip");
      const coachHead = node("div", "coach-head");
      coachHead.append(node("h3", "", "Obiettivo di oggi"));
      coach.append(coachHead);
      coachLines.forEach((line) => coach.append(node("p", "", line)));
      body.append(coach);
    }
    const instructions = exerciseInstructions(day, exercise);
    if (instructions) {
      const instructionBlock = node("details", "exercise-instructions");
      instructionBlock.append(node("summary", "", "Come eseguirlo"));
      const instructionList = node("ul", "exercise-instruction-list");
      instructions.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        .forEach((line) => instructionList.append(node("li", "", line)));
      instructionBlock.append(instructionList);
      if (exercise.pair) {
        const separateHint = plan.id === "blocco-iniziale"
          ? "Se non è praticabile, fai gli esercizi separati con 1 minuto di recupero tra le serie."
          : "Se non è praticabile, fai gli esercizi separati e recupera tra le serie.";
        instructionBlock.append(node("p", "hint", `Alterna gli esercizi dello stesso gruppo e recupera dopo la coppia. ${separateHint}`));
      }
      body.append(instructionBlock);
    }

    const machineNote = node("div", "machine-note");
    machineNote.append(node("h3", "", "Le mie regolazioni"));
    const machineInput = document.createElement("textarea");
    machineInput.rows = 2;
    machineInput.maxLength = 300;
    machineInput.placeholder = "Es. sedile 4 · schienale 3 · presa larga";
    machineInput.value = savedNote();
    machineInput.setAttribute("aria-label", `Regolazioni per ${exercise.name}`);
    machineInput.addEventListener("input", () => {
      if (!isObject(state.exerciseNotes)) state.exerciseNotes = {};
      const text = machineInput.value.trim();
      if (text) state.exerciseNotes[exercise.name] = text;
      else delete state.exerciseNotes[exercise.name];
      persist();
      noteLine.textContent = text;
      noteLine.hidden = !text;
    });
    machineNote.append(machineInput);
    body.append(machineNote);
    if (!isCardio && existing && (existing.load || existing.reps)) {
      const oldValues = [existing.load ? `${existing.load} kg` : "", existing.reps].filter(Boolean).join(" · ");
      body.append(node("div", "legacy-record",
        `Registro precedente: ${oldValues}. È conservato nello storico; compila le singole serie senza ricopiare valori incerti.`));
    }

    const historyView = historyPanel(exercise, key);
    const previousRecord = (() => {
      const candidates = Object.entries(state.records)
        .filter(([otherKey, record]) => otherKey !== key && Array.isArray(record.series) &&
          sameExercise(record, exercise, key) &&
          record.series.some((set) => set.load || set.reps || set.left || set.right))
        .map(([, record]) => record);
      const byRecent = (left, right) => right.updatedAt.localeCompare(left.updatedAt);
      const earlier = candidates.filter((record) => record.planId === plan.id && record.week < week)
        .sort((left, right) => right.week - left.week || byRecent(left, right));
      return earlier[0] || candidates.sort(byRecent)[0];
    })();

    const setFields = [];
    let minutes = null;
    let cardioDetails = null;
    if (isCardio) {
      const grid = node("div", "field-grid");
      minutes = field("Minuti", existing ? existing.load : "",
        { inputMode: "decimal", placeholder: "Es. 15", maxLength: 30 }, sync);
      cardioDetails = field("Pendenza / velocità", existing ? existing.reps : "",
        { placeholder: "Es. 6% · 5 km/h", maxLength: 120 }, sync);
      grid.append(minutes.wrapper, cardioDetails.wrapper);
      seriesSlot.append(grid);
    } else {
      const list = node("div", `series-table${exercise.unilateral ? " is-unilateral" : ""}`);
      const head = node("div", `series-row series-head${exercise.unilateral ? " is-unilateral" : ""}`);
      ["Set", "Precedente", ...(exercise.unilateral ? ["Dx", "Sx"] : ["Rip."]), "Kg", ""]
        .forEach((label) => head.append(node("span", "", label)));
      list.append(head);
      const cell = (value, placeholder, mode, maxLength, onInput, label) => {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "series-input";
        input.inputMode = mode;
        input.maxLength = maxLength;
        input.placeholder = placeholder || "—";
        input.value = value || "";
        input.setAttribute("aria-label", label);
        input.addEventListener("input", () => onInput(input.value));
        return { input };
      };
      const addSetRow = (index) => {
        const set = series[index];
        const before = previousRecord && previousRecord.series[index];
        const row = node("div", `series-row${exercise.unilateral ? " is-unilateral" : ""}`);
        row.setAttribute("role", "group");
        row.setAttribute("aria-label", `Serie ${index + 1}`);
        const hasBefore = Boolean(before && (before.load || before.reps || before.left || before.right));
        const prev = node("span", "series-prev");
        if (hasBefore) {
          const beforeReps = exercise.unilateral ? `${before.right || "—"}·${before.left || "—"}` : (before.reps || "—");
          const beforeLoad = before.load ? `${formatNumber(Number(before.load.replace(",", ".")) || 0, 2)} kg` : "— kg";
          prev.textContent = `${beforeReps} × ${beforeLoad}`;
          prev.classList.add("has-value");
        } else {
          prev.textContent = "–";
        }
        row.append(node("span", "series-number", String(index + 1)), prev);
        const weight = cell(set.load, before && before.load, "decimal", 30,
          (value) => { set.load = value.trim(); seriesTouched = true; sync(); }, `Peso serie ${index + 1}`);
        const repsFields = [];
        const addRepetitions = (property, label, hint) => {
          const item = cell(set[property], hint, "numeric", 4,
            (value) => { set[property] = value.trim(); seriesTouched = true; sync(); }, `${label} serie ${index + 1}`);
          repsFields.push(item);
          row.append(item.input);
        };
        if (exercise.unilateral) {
          addRepetitions("right", "Ripetizioni dx", before && before.right);
          addRepetitions("left", "Ripetizioni sx", before && before.left);
        } else {
          addRepetitions("reps", "Ripetizioni", before && before.reps);
        }
        row.append(weight.input);
        const checkLabel = node("label", "series-check");
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = completeSet(set, exercise.unilateral);
        check.setAttribute("aria-label", `Serie ${index + 1} completata`);
        check.addEventListener("change", () => {
          if (check.checked) {
            const previousSet = index > 0 ? series[index - 1] : null;
            const take = (current, fromBefore, fromPrevious) => current || fromBefore || fromPrevious || "";
            if (!set.load) {
              set.load = take("", before && before.load, previousSet && previousSet.load);
              weight.input.value = set.load;
            }
            if (exercise.unilateral) {
              if (!set.right) set.right = take("", before && before.right, previousSet && previousSet.right);
              if (!set.left) set.left = take("", before && before.left, previousSet && previousSet.left);
              repsFields[0].input.value = set.right;
              repsFields[1].input.value = set.left;
            } else if (!set.reps) {
              set.reps = take("", before && before.reps, previousSet && previousSet.reps);
              repsFields[0].input.value = set.reps;
            }
          }
          set.done = check.checked;
          seriesTouched = true;
          sync();
          if (check.checked) beginRest(plan, day, exercise);
        });
        checkLabel.append(check);
        row.append(checkLabel);
        setFields.push({ row, weight, repsFields, set });
        if (index >= targetCount) {
          list.append(swipeToDelete(row, () => {
            series.splice(index, 1);
            seriesTouched = true;
            renderRows();
            sync();
          }));
        } else {
          list.append(row);
        }
      };
      const renderRows = () => {
        setFields.length = 0;
        Array.from(list.children).forEach((child) => { if (child !== head) child.remove(); });
        for (let index = 0; index < series.length; index += 1) addSetRow(index);
      };
      renderRows();
      seriesSlot.append(list);
      if (previousRecord) {
        const when = new Date(previousRecord.updatedAt);
        const whenLabel = Number.isNaN(when.getTime()) ? ""
          : ` · ${when.toLocaleDateString("it-IT", { day: "numeric", month: "short" })}`;
        const caption = node("p", "prev-caption",
          `Precedente = Settimana ${previousRecord.week} · ${previousRecord.dayName}${whenLabel} (ripetizioni × kg)`);
        seriesSlot.append(caption);
      }
      seriesSlot.append(button("+ Aggiungi serie", "add-set-button", () => {
        if (series.length >= 20) return;
        series.push({ load: "", reps: "", left: "", right: "", done: false });
        seriesTouched = true;
        renderRows();
        sync();
      }));
    }
    body.append(historyView.wrapper);

    const errorText = node("p", "hint");
    errorText.setAttribute("aria-live", "polite");
    body.append(errorText);
    const optional = node("details", "optional-fields");
    optional.append(node("summary", "", "Note e RIR (facoltativi)"));
    const optionalGrid = node("div", "field-grid");
    const rir = field("RIR ultima serie", existing ? existing.rir : "",
      { placeholder: "Es. 2", maxLength: 20 }, sync);
    const notes = field("Note", existing ? existing.notes : "",
      { full: true, multiline: true, placeholder: "Facoltativo", maxLength: 600 }, sync);
    if (!isCardio) optionalGrid.append(rir.wrapper);
    optionalGrid.append(notes.wrapper);
    optional.append(optionalGrid);
    body.append(optional);
    card.sheetData = {
      body,
      showHistory: historyView.show,
      isComplete: () => recordIsComplete(plan, day, week, exercise),
      onUpdate: null,
      markDone() {
        if (isCardio) {
          if (!minutes.input.value.trim()) {
            errorText.textContent = "Inserisci i minuti svolti per completare l'esercizio.";
            errorText.scrollIntoView({ behavior: "smooth", block: "center" });
            minutes.input.setAttribute("aria-invalid", "true");
            return false;
          }
          sync();
          return true;
        }
        series.forEach((set) => { set.done = true; });
        seriesTouched = true;
        sync();
        return true;
      },
    };

    function updateVisual() {
      const complete = recordIsComplete(plan, day, week, exercise);
      chevron.textContent = complete ? "✓" : "›";
      if (complete) {
        status.textContent = seriesTouched || isCardio ? "✓ Completato" : "✓ Completato nel formato precedente";
      } else if (isCardio) {
        status.textContent = "Da completare";
      } else {
        const done = series.slice(0, targetCount).filter((set) => completeSet(set, exercise.unilateral)).length;
        status.textContent = `${done}/${targetCount} serie completate`;
      }
      setFields.forEach(({ row, set }) => row.classList.toggle("is-done", completeSet(set, exercise.unilateral)));
      const pr = isCardio ? null : exercisePR(exercise, key, series);
      prChip.hidden = !pr;
      prChipSheet.hidden = !pr;
      if (pr) {
        const detail = pr.load
          ? `${formatNumber(pr.now.load, 2)} kg (prima ${formatNumber(pr.prior.load, 2)} kg)`
          : `massimale stimato ${formatNumber(pr.now.e1rm, 1)} kg (prima ${formatNumber(pr.prior.e1rm, 1)} kg)`;
        prChip.title = detail;
        prChipSheet.textContent = `Nuovo record · ${detail}`;
      }
      setFields.forEach(({ row }, index) => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = completeSet(series[index], exercise.unilateral);
      });
      updateCount();
      if (card.sheetData && card.sheetData.onUpdate) card.sheetData.onUpdate();
    }

    function sync() {
      let hasErrors = false;
      if (isCardio) {
        const invalid = !validNumber(minutes.input.value, 1000);
        minutes.input.setAttribute("aria-invalid", String(invalid));
        hasErrors = invalid;
      } else {
        for (const { weight, repsFields } of setFields) {
          const invalidWeight = !validNumber(weight.input.value, 1000);
          weight.input.setAttribute("aria-invalid", String(invalidWeight));
          hasErrors = hasErrors || invalidWeight;
          for (const item of repsFields) {
            const invalidReps = Boolean(item.input.value.trim()) && !validRepetitions(item.input.value);
            item.input.setAttribute("aria-invalid", String(invalidReps));
            hasErrors = hasErrors || invalidReps;
          }
        }
      }
      const invalidRir = !validLoggedRir(rir.input.value);
      rir.input.setAttribute("aria-invalid", String(invalidRir));
      errorText.textContent = hasErrors || invalidRir
        ? "Controlla il formato di peso, minuti, ripetizioni o RIR."
        : "";
      const cardioMinutes = isCardio ? minutes.input.value.trim() : "";
      const completed = isCardio
        ? Boolean(cardioMinutes) && validNumber(cardioMinutes, 1000) &&
          Number(cardioMinutes.replace(",", ".")) > 0
        : (seriesTouched
          ? series.slice(0, targetCount).every((set) => completeSet(set, exercise.unilateral))
          : Boolean(existing && existing.completed));
      const record = {
        planId: plan.id,
        planName: plan.name,
        dayId: day.id,
        dayName: day.name,
        week,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        kind: exercise.kind,
        load: isCardio ? cardioMinutes : (existing ? existing.load : ""),
        reps: isCardio ? cardioDetails.input.value.trim() : (existing ? existing.reps : ""),
        rir: isCardio ? "" : rir.input.value.trim(),
        notes: notes.input.value.trim(),
        completed,
        updatedAt: new Date().toISOString(),
      };
      if (!isCardio && seriesTouched) record.series = clone(series);
      const hasSeriesData = record.series && record.series.some((set) =>
        Boolean(set.load || set.reps || set.left || set.right));
      if (!record.load && !record.reps && !record.rir && !record.notes && !hasSeriesData && !record.completed) {
        delete state.records[key];
      } else {
        state.records[key] = record;
        touchSession(plan, day, week);
      }
      persist();
      historyView.refresh();
      updateVisual();
    }

    updateVisual();
    return card;
  }

  function makeDraft(plan) {
    const draft = clone(plan);
    draft.weeksText = String(plan.weeks);
    draft.multiText = plan.rir.multi.join(", ");
    draft.isoText = plan.rir.iso.join(", ");
    draft.days.forEach((day) => day.exercises.forEach((exercise) => {
      exercise.setsText = exercise.kind === "cardio" ? "" : exercise.sets.join(", ");
    }));
    return draft;
  }

  function changeDraft(callback) {
    callback();
    editorDirty = true;
  }

  function parseList(raw, weeks, parser) {
    const values = raw.split(",").map((value) => value.trim());
    if (values.length === 1 && values[0] !== "") {
      const parsed = parser(values[0]);
      return parsed === null ? null : Array(weeks).fill(parsed);
    }
    if (values.length !== weeks) return null;
    const parsed = values.map(parser);
    return parsed.some((value) => value === null) ? null : parsed;
  }

  function parseSet(value) {
    if (!/^(?:0|[1-9]|1\d|20)$/.test(value)) return null;
    return Number(value);
  }

  function parseRir(value) {
    return validRirTarget(value) ? value : null;
  }

  function buildPlanFromDraft() {
    const weeks = Number(editorDraft.weeksText);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
      return { error: "Inserisci un numero di settimane tra 1 e 52." };
    }
    const multi = parseList(editorDraft.multiText, weeks, parseRir);
    const iso = parseList(editorDraft.isoText, weeks, parseRir);
    if (!multi || !iso) {
      return { error: "Controlla i RIR: inserisci un valore unico oppure uno per ogni settimana, separati da virgole." };
    }
    const plan = {
      format: PLAN_FORMAT,
      id: editorDraft.id,
      name: editorDraft.name.trim(),
      weeks,
      rir: { multi, iso },
      days: [],
    };
    for (const draftDay of editorDraft.days) {
      const day = {
        id: draftDay.id,
        name: draftDay.name.trim(),
        subtitle: draftDay.subtitle.trim(),
        exercises: [],
      };
      for (const exercise of draftDay.exercises) {
        const sets = exercise.kind === "cardio"
          ? Array(weeks).fill(null)
          : parseList(exercise.setsText, weeks, parseSet);
        if (!sets) {
          return { error: `Controlla le serie di "${exercise.name || "Nuovo esercizio"}": inserisci un numero unico oppure uno per settimana.` };
        }
        day.exercises.push({
          id: exercise.id,
          name: exercise.name.trim(),
          reps: exercise.reps.trim(),
          rest: exercise.rest.trim(),
          sets,
          kind: exercise.kind,
          unilateral: exercise.unilateral,
          pair: exercise.pair.trim(),
          artId: exercise.artId || "",
          equipment: (exercise.equipment || "").trim(),
        });
      }
      plan.days.push(day);
    }
    const error = validatePlan(plan);
    return error ? { error } : { plan };
  }

  function savePlan() {
    const result = buildPlanFromDraft();
    if (result.error) {
      showNotice(result.error, true);
      scrollContent.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    const index = state.plans.findIndex((plan) => plan.id === result.plan.id);
    state.plans[index] = result.plan;
    ensureSelection();
    if (!persist()) return;
    editorDraft = makeDraft(result.plan);
    editorDirty = false;
    showNotice("Scheda salvata su questo dispositivo.");
    renderPlan();
  }

  function startNewBlock() {
    if (editorDirty && !window.confirm("Le modifiche non salvate saranno scartate. Continuare?")) return;
    if (!window.confirm("Creare un nuovo blocco copiando questa scheda? I registri precedenti resteranno nello storico.")) return;
    if (state.plans.length >= 100) {
      showNotice("Hai raggiunto il numero massimo di blocchi su questo dispositivo.", true);
      return;
    }
    const plan = clone(activePlan());
    plan.id = uniqueId("blocco");
    plan.name = `${plan.name.slice(0, 82)} · nuovo blocco`;
    state.plans.push(plan);
    state.activePlanId = plan.id;
    state.selection = { dayId: plan.days[0].id, week: 1 };
    editorDraft = makeDraft(plan);
    editorDayId = plan.days[0].id;
    editorDirty = false;
    if (persist()) showNotice("Nuovo blocco creato. Ora puoi modificare la scheda.");
    renderPlan();
  }

  function switchBlock(id, select) {
    if (editorDirty && !window.confirm("Le modifiche non salvate saranno scartate. Cambiare blocco?")) {
      select.value = state.activePlanId;
      return;
    }
    const plan = state.plans.find((item) => item.id === id);
    if (!plan) {
      showNotice("Il blocco selezionato non esiste più.", true);
      return;
    }
    state.activePlanId = id;
    state.selection = { dayId: plan.days[0].id, week: 1 };
    editorDraft = makeDraft(plan);
    editorDayId = plan.days[0].id;
    editorDirty = false;
    persist();
    renderPlan();
  }

  function selectField(label, value, choices, onChange) {
    const wrapper = node("div", "field");
    const labelElement = node("label", "", label);
    const select = document.createElement("select");
    select.id = `input-${++fieldCounter}`;
    labelElement.htmlFor = select.id;
    for (const [choiceValue, choiceLabel] of choices) {
      const option = node("option", "", choiceLabel);
      option.value = choiceValue;
      select.append(option);
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value, select));
    wrapper.append(labelElement, select);
    return wrapper;
  }

  function renderPlan() {
    if (!editorDraft) {
      editorDraft = makeDraft(activePlan());
      editorDayId = state.selection.dayId;
      editorDirty = false;
    }
    if (!editorDraft.days.some((day) => day.id === editorDayId)) {
      editorDayId = editorDraft.days[0].id;
    }
    const view = views.plan;
    view.replaceChildren();
    view.append(titleBlock(
      "LA TUA SCHEDA",
      "La scheda cambia con te.",
      "Aggiungi, modifica o rimuovi giorni ed esercizi direttamente qui."
    ));

    const blockCard = node("div", "edit-card");
    blockCard.append(selectField(
      "Blocco attivo",
      state.activePlanId,
      state.plans.map((plan) => [plan.id, plan.name]),
      switchBlock
    ));
    const globalGrid = node("div", "field-grid");
    globalGrid.append(
      field("Nome del blocco", editorDraft.name, { maxLength: 100 }, (value) => changeDraft(() => { editorDraft.name = value; })).wrapper,
      field("Numero di settimane", editorDraft.weeksText, { inputMode: "numeric", maxLength: 2 },
        (value) => changeDraft(() => { editorDraft.weeksText = value; })).wrapper,
      field("RIR multiarticolari", editorDraft.multiText, { full: true, placeholder: "3, 2, 2, 1-2, 1, 1", maxLength: 420 },
        (value) => changeDraft(() => { editorDraft.multiText = value; })).wrapper,
      field("RIR isolamenti", editorDraft.isoText, { full: true, placeholder: "2, 2, 1-2, 1, 1, 0-1", maxLength: 420 },
        (value) => changeDraft(() => { editorDraft.isoText = value; })).wrapper
    );
    blockCard.append(globalGrid, node("p", "hint", "Per RIR e serie: un solo valore vale per tutte le settimane; altrimenti separa i valori con virgole. Usa - se il RIR non è indicato."));
    blockCard.append(button("＋  Nuovo blocco", "secondary-button", startNewBlock));
    view.append(blockCard);

    const dayHeading = node("div", "section-heading editor-day-title");
    dayHeading.append(node("h2", "", "Giorni della scheda"), button("＋  Giorno", "secondary-button", () => {
      if (editorDraft.days.length >= 21) {
        showNotice("La scheda può contenere al massimo 21 giorni.", true);
        return;
      }
      const day = { id: uniqueId("giorno"), name: `Giorno ${editorDraft.days.length + 1}`, subtitle: "", exercises: [] };
      changeDraft(() => editorDraft.days.push(day));
      editorDayId = day.id;
      renderPlan();
    }));
    view.append(dayHeading);
    view.append(dayStrip(editorDraft.days, editorDayId, (id) => {
      editorDayId = id;
      renderPlan();
    }));

    const day = editorDraft.days.find((item) => item.id === editorDayId);
    const dayCard = node("div", "edit-card");
    dayCard.style.marginTop = "14px";
    const dayGrid = node("div", "field-grid");
    dayGrid.append(
      field("Nome giorno", day.name, { maxLength: 80 }, (value) => changeDraft(() => { day.name = value; })).wrapper,
      field("Descrizione", day.subtitle, { maxLength: 100, placeholder: "Es. petto e dorso" },
        (value) => changeDraft(() => { day.subtitle = value; })).wrapper
    );
    dayCard.append(dayGrid);
    dayCard.append(button("Rimuovi giorno", "danger-button", () => {
      if (editorDraft.days.length === 1) {
        showNotice("La scheda deve mantenere almeno un giorno.", true);
        return;
      }
      if (!window.confirm("Rimuovere questo giorno dalla scheda? I registri già salvati resteranno nello storico.")) return;
      changeDraft(() => { editorDraft.days = editorDraft.days.filter((item) => item.id !== day.id); });
      editorDayId = editorDraft.days[0].id;
      renderPlan();
    }));
    view.append(dayCard);

    const exerciseHeading = node("div", "section-heading");
    exerciseHeading.append(
      node("h2", "", "Esercizi"),
      node("span", "small-count", `${day.exercises.length} inseriti`)
    );
    view.append(exerciseHeading);
    const list = node("div", "editor-list");
    if (!day.exercises.length) {
      list.append(node("div", "empty-state", "Nessun esercizio. Aggiungine uno per iniziare."));
    }
    day.exercises.forEach((exercise, index) => {
      list.append(editorExercise(day, exercise, index));
    });
    view.append(list);
    const actions = node("div", "action-row");
    actions.append(
      button("＋  Aggiungi esercizio", "secondary-button", () => {
        if (day.exercises.length >= 100) {
          showNotice("Questo giorno può contenere al massimo 100 esercizi.", true);
          return;
        }
        changeDraft(() => day.exercises.push({
          id: uniqueId("esercizio"),
          name: "",
          reps: "",
          rest: "—",
          sets: [],
          setsText: "",
          kind: "strength",
          unilateral: false,
          pair: "",
          artId: "",
          equipment: "",
        }));
        renderPlan();
      }),
      button("Salva modifiche", "primary-button", savePlan)
    );
    view.append(actions);
    const info = node("div", "info-card");
    info.style.marginTop = "18px";
    info.append(
      node("strong", "", "Dati sul dispositivo. "),
      document.createTextNode(
        "Questa app non sincronizza Excel o Blocco note. Safari e la web app aggiunta alla schermata Home " +
        "possono avere archivi separati: esporta un backup dallo Storico per trasferire o conservare i dati."
      )
    );
    view.append(info);
  }

  function editorExercise(day, exercise, index) {
    const card = node("div", "edit-card");
    const heading = node("div", "editor-heading");
    heading.append(
      node("strong", "", `Esercizio ${index + 1}`),
      button("Rimuovi", "danger-button", () => {
        if (!window.confirm("Rimuovere questo esercizio? I registri già salvati resteranno nello storico.")) return;
        changeDraft(() => { day.exercises = day.exercises.filter((item) => item.id !== exercise.id); });
        renderPlan();
      })
    );
    card.append(heading);
    const grid = node("div", "field-grid");
    grid.append(
      field("Nome esercizio", exercise.name, { full: true, maxLength: 200, placeholder: "Es. Pulley basso" },
        (value) => changeDraft(() => { exercise.name = value; })).wrapper,
      field("Ripetizioni / durata", exercise.reps, { maxLength: 80, placeholder: "Es. 8-12" },
        (value) => changeDraft(() => { exercise.reps = value; })).wrapper,
      field("Recupero", exercise.rest, { maxLength: 40, placeholder: "Es. 2 min" },
        (value) => changeDraft(() => { exercise.rest = value; })).wrapper,
      selectField("Tipo", exercise.kind, [["strength", "Pesi / corpo libero"], ["cardio", "Cardio"]], (value) => {
        changeDraft(() => { exercise.kind = value; });
        renderPlan();
      }),
      field("Gruppo superserie", exercise.pair, { maxLength: 30, placeholder: "Facoltativo, es. A" },
        (value) => changeDraft(() => { exercise.pair = value; })).wrapper,
      field("Attrezzo", exercise.equipment || "", {
        full: true, maxLength: 100,
        placeholder: exerciseEquipment(exercise, exerciseIllustration(exercise)),
      }, (value) => changeDraft(() => { exercise.equipment = value; })).wrapper
    );
    const artChoices = [["", "Automatica dal nome"]]
      .concat(illustrationCatalog.map((item) => [item.id, item.title]));
    if (exercise.artId && !illustrationCatalog.some((item) => item.id === exercise.artId)) {
      artChoices.push([exercise.artId, "Illustrazione salvata non disponibile"]);
    }
    grid.append(selectField("Illustrazione", exercise.artId || "", artChoices,
      (value) => changeDraft(() => { exercise.artId = value; })));
    if (exercise.kind !== "cardio") {
      grid.append(field(
        "Serie per settimana",
        exercise.setsText,
        { full: true, maxLength: 250, placeholder: "Es. 3 oppure 3, 3, 3, 4, 4, 4" },
        (value) => changeDraft(() => { exercise.setsText = value; })
      ).wrapper);
    }
    card.append(grid);
    const unilateralLabel = node("label", "checkbox-field");
    unilateralLabel.style.marginTop = "12px";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = exercise.unilateral;
    check.addEventListener("change", () => changeDraft(() => { exercise.unilateral = check.checked; }));
    unilateralLabel.append(check, document.createTextNode("Esercizio per lato / monobraccio"));
    card.append(unilateralLabel);
    card.append(node("p", "hint", "Per saltare un esercizio in una settimana inserisci 0 nella relativa posizione delle serie."));
    return card;
  }

  async function exportFile(filename, contents, mime = "application/json", title = "Backup allenamento") {
    const blob = new Blob([contents], { type: mime });
    // Su iPhone il foglio di condivisione permette di salvare nell'app File senza anteprima intermedia.
    try {
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return true;
      }
    } catch (error) {
      if (error && error.name === "AbortError") return false;
      console.error("Condivisione non riuscita, uso il download:", error);
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }

  function buildCsv() {
    const cell = (value) => {
      const text = String(value === undefined || value === null ? "" : value);
      return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const header = ["Data", "Blocco", "Settimana", "Giorno", "Esercizio", "Serie", "Kg", "Rip", "Rip dx", "Rip sx",
      "Completata", "Minuti", "Dettagli", "RIR", "Note"];
    const plansById = new Map(state.plans.map((plan) => [plan.id, plan]));
    const rows = [];
    const records = Object.values(state.records)
      .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)));
    for (const record of records) {
      const date = new Date(record.updatedAt);
      const day = Number.isNaN(date.getTime()) ? record.updatedAt : dateKey(date);
      const plan = plansById.get(record.planId);
      const exercise = plan && plan.days.flatMap((item) => item.exercises).find((item) => item.id === record.exerciseId);
      const unilateral = Boolean(exercise && exercise.unilateral);
      const common = [day, record.planName, record.week, record.dayName, record.exerciseName];
      if (record.kind === "cardio" || !Array.isArray(record.series)) {
        rows.push([...common, "", "", "", "", "", record.completed ? "sì" : "no", record.load, record.reps,
          record.rir, record.notes]);
        continue;
      }
      record.series.forEach((set, index) => {
        if (!(set.load || set.reps || set.left || set.right || set.done)) return;
        rows.push([...common, index + 1, set.load, unilateral ? "" : set.reps, unilateral ? set.right : "",
          unilateral ? set.left : "", completeSet(set, unilateral) ? "sì" : "no", "", "", record.rir, record.notes]);
      });
    }
    return `\uFEFF${[header, ...rows].map((row) => row.map(cell).join(";")).join("\r\n")}\r\n`;
  }

  async function exportCsv() {
    if (!Object.keys(state.records).length) {
      showNotice("Non ci sono ancora allenamenti registrati da esportare.", true);
      return;
    }
    const done = await exportFile("allenamenti.csv", buildCsv(), "text/csv", "Allenamenti (CSV)");
    if (done) showNotice("CSV pronto. Si apre con Excel, Numbers o Fogli.");
  }

  async function exportBackup() {
    const payload = { format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), data: state };
    const done = await exportFile("backup-allenamento.json", JSON.stringify(payload, null, 2));
    if (done) showNotice("Backup pronto. Salvalo nell'app File del tuo dispositivo.");
  }

  let wakeLock = null;

  async function keepScreenAwake(enable) {
    if (!("wakeLock" in navigator)) return;
    try {
      if (enable && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      } else if (!enable && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (error) {
      console.error("Schermo sempre acceso non disponibile:", error);
    }
  }

  async function restoreBackup(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showNotice("Il backup supera 5 MB e non può essere importato.", true);
      return;
    }
    let contents;
    try {
      contents = await file.text();
    } catch (error) {
      console.error("Lettura del backup non riuscita:", error);
      showNotice("Non riesco a leggere il file selezionato.", true);
      return;
    }
    let payload;
    try {
      payload = JSON.parse(contents);
    } catch (error) {
      console.error("Backup non interpretabile:", error);
      showNotice("Il file selezionato non è un JSON valido.", true);
      return;
    }
    const error = !isObject(payload) || payload.format !== BACKUP_FORMAT
      ? "Il file non è un backup di questa app."
      : validateState(payload.data);
    if (error) {
      showNotice(error, true);
      return;
    }
    if (!window.confirm("Ripristinare il backup? Sostituirà i dati presenti su questo dispositivo.")) return;
    state = payload.data;
    ensureSelection();
    ensureHealth();
    editorDraft = null;
    editorDirty = false;
    if (persist()) showNotice("Backup ripristinato su questo dispositivo.");
    renderMore();
  }

  function backupCard() {
    const card = node("div", "info-card");
    const heading = node("h3", "settings-icon-heading");
    const symbol = node("span", "settings-icon settings-icon-backup");
    symbol.append(icon("backup", 18));
    heading.append(symbol, node("span", "", "Backup dei tuoi dati"));
    card.append(
      heading,
      node("p", "hint",
        "Salva una copia nell'app File. Safari, la web app sulla schermata Home e dispositivi diversi " +
        "possono avere archivi separati. Il ripristino sostituisce i dati presenti nell'archivio corrente.")
    );
    card.append(button("Esporta backup", "secondary-button", exportBackup));
    const csvHint = node("p", "hint", "Il backup (JSON) serve per ripristinare l'app. Il CSV è solo una tabella leggibile degli allenamenti, da aprire in Excel, Numbers o Fogli: non si può ripristinare.");
    csvHint.style.marginTop = "10px";
    card.append(button("Esporta tabella (CSV)", "secondary-button", exportCsv), csvHint);
    const label = node("label", "field-title", "Ripristina un backup");
    label.style.display = "block";
    label.style.margin = "16px 0 8px";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.className = "file-input sr-only";
    input.id = `input-${++fieldCounter}`;
    label.htmlFor = input.id;
    input.addEventListener("change", () => {
      const selected = input.files && input.files[0];
      restoreBackup(selected);
      input.value = "";
    });
    const picker = node("label", "backup-picker-label", "Scegli file di backup");
    picker.htmlFor = input.id;
    card.append(label, input, picker);
    return card;
  }

  // ===== Statistiche =====
  let statsTab = "overview";
  let statsDay = "all";

  const MUSCLE_GROUPS = {
    "Petto alto": "Petto", Petto: "Petto", Dorso: "Dorso", Spalle: "Spalle", "Spalle posteriori": "Spalle",
    Tricipiti: "Braccia", Bicipiti: "Braccia", Quadricipiti: "Quadricipiti", Femorali: "Femorali",
    Glutei: "Glutei", "Glutei e femorali": "Glutei", Polpacci: "Polpacci", Core: "Core",
  };

  function statNumber(value) {
    const parsed = Number(String(value === undefined || value === null ? "" : value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function groupedNumber(value) {
    return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function compactNumber(value) {
    return value >= 10000 ? `${formatNumber(Math.round(value / 100) / 10, 1)}k` : groupedNumber(value);
  }

  // Nome breve per elenchi e titoli: toglie il prefisso superserie e le note tra parentesi.
  function shortExerciseName(name) {
    return name.replace(/^SS stessa panca(?: piana)?:\s*/i, "").replace(/\s*[(—].*$/, "").trim() || name;
  }

  function signedKg(value) {
    return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatNumber(Math.abs(value), 2)} kg`;
  }

  function collectStats() {
    const plan = activePlan();
    const weeks = plan.weeks;
    const exercises = [];
    const dayCells = [];
    for (const day of plan.days) {
      for (const exercise of day.exercises) {
        const illustration = exerciseIllustration(exercise);
        const cardio = exercise.kind === "cardio";
        const unilateral = Boolean(exercise.unilateral);
        const entry = {
          name: exercise.name, dayId: day.id, dayName: day.name, cardio, unilateral,
          muscle: cardio ? "Cardio" : (MUSCLE_GROUPS[illustration && illustration.muscle] || "Altro"),
          weeks: [],
        };
        for (let week = 1; week <= weeks; week += 1) {
          const planned = cardio ? 1 : (exercise.sets[week - 1] || 0);
          const record = state.records[recordKey(plan.id, day.id, week, exercise.id)];
          const item = { week, planned, sets: 0, volume: 0, bestLoad: 0, bestReps: 0, reps: 0, e1rm: 0, best: null, minutes: 0 };
          if (record && cardio) {
            item.minutes = statNumber(record.load);
            item.sets = record.completed ? 1 : 0;
          } else if (record && Array.isArray(record.series)) {
            for (const set of record.series) {
              if (!completeSet(set, unilateral)) continue;
              item.sets += 1;
              const load = statNumber(set.load);
              const reps = unilateral ? statNumber(set.left) + statNumber(set.right) : statNumber(set.reps);
              if (load > 0 && reps > 0) item.volume += load * reps;
              if (load > item.bestLoad) item.bestLoad = load;
              item.reps += reps;
              item.bestReps = Math.max(item.bestReps, unilateral ? Math.min(statNumber(set.left), statNumber(set.right)) : reps);
              const score = setScore(set, unilateral);
              if (score && score.e1rm > item.e1rm) {
                item.e1rm = score.e1rm;
                item.best = { load: score.load, reps: unilateral ? Math.min(statNumber(set.left), statNumber(set.right)) : statNumber(set.reps) };
              }
            }
          }
          entry.weeks.push(item);
        }
        entry.bodyweight = !cardio && entry.weeks.every((item) => item.bestLoad === 0) &&
          entry.weeks.some((item) => item.bestReps > 0);
        exercises.push(entry);
      }
      dayCells.push({ day, weeks: Array.from({ length: weeks }, (_, index) => dayProgress(plan, day, index + 1)) });
    }
    const records = [];
    for (const entry of exercises) {
      if (entry.cardio) continue;
      let bestE1rm = 0;
      let bestLoad = 0;
      for (const item of entry.weeks) {
        if (!item.e1rm) continue;
        if (bestE1rm && item.e1rm > bestE1rm * 1.005) {
          records.push({ name: entry.name, week: item.week, best: item.best, load: item.bestLoad,
            gain: item.bestLoad > bestLoad ? item.bestLoad - bestLoad : 0 });
        }
        bestE1rm = Math.max(bestE1rm, item.e1rm);
        bestLoad = Math.max(bestLoad, item.bestLoad);
      }
    }
    records.sort((left, right) => right.week - left.week);
    const totals = { sets: 0, volume: 0, daysDone: 0, daysTotal: 0 };
    for (const entry of exercises) {
      if (entry.cardio) continue;
      for (const item of entry.weeks) {
        totals.sets += item.sets;
        totals.volume += item.volume;
      }
    }
    for (const cell of dayCells) {
      for (const progress of cell.weeks) {
        if (progress.total > 0) totals.daysTotal += 1;
        if (progress.total > 0 && progress.completed === progress.total) totals.daysDone += 1;
      }
    }
    return { plan, weeks, exercises, dayCells, records, totals };
  }

  function svgChart(width, height, label) {
    return svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": label, class: "stat-svg" });
  }

  function barChartSvg(values, selected, label) {
    const width = 340;
    const top = 24;
    const base = 138;
    const gap = 12;
    const count = values.length;
    const barWidth = (width - 16 - gap * (count - 1)) / count;
    const maximum = Math.max(...values, 1);
    const svg = svgChart(width, 164, label);
    values.forEach((value, index) => {
      const x = 8 + index * (barWidth + gap);
      const height = value > 0 ? Math.max(5, value / maximum * (base - top)) : 4;
      const current = index + 1 === selected;
      svg.append(svgNode("rect", { x, y: base - height, width: barWidth, height, rx: 7,
        fill: value > 0 ? (current ? "#c6f135" : "rgba(198,241,53,.42)") : "rgba(255,255,255,.12)" }));
      if (value > 0) {
        svg.append(svgNode("text", { x: x + barWidth / 2, y: base - height - 7, "text-anchor": "middle",
          class: current ? "stat-value is-current" : "stat-value" }, compactNumber(value)));
      }
      svg.append(svgNode("text", { x: x + barWidth / 2, y: 157, "text-anchor": "middle",
        class: current ? "stat-axis is-current" : "stat-axis" }, `S${index + 1}`));
    });
    return svg;
  }

  function lineChartSvg(points, label, decimals = 1) {
    const width = 340;
    const height = 196;
    const left = 22;
    const right = width - 22;
    const top = 34;
    const base = 150;
    const values = points.filter((point) => point.value > 0).map((point) => point.value);
    const svg = svgChart(width, height, label);
    if (!values.length) return svg;
    let low = Math.min(...values);
    let high = Math.max(...values);
    const spread = Math.max(high - low, high * 0.08, 1);
    low -= spread * 0.35;
    high += spread * 0.15;
    const xAt = (index) => (points.length === 1 ? width / 2 : left + index * (right - left) / (points.length - 1));
    const yAt = (value) => base - (value - low) / (high - low) * (base - top);
    [0, 1, 2].forEach((step) => {
      const y = top + step * (base - top) / 2;
      svg.append(svgNode("line", { x1: left - 8, x2: right + 8, y1: y, y2: y, class: "stat-grid-line" }));
    });
    let path = "";
    let area = "";
    let started = false;
    points.forEach((point, index) => {
      if (!(point.value > 0)) {
        started = false;
        return;
      }
      path += `${started ? "L" : "M"} ${xAt(index).toFixed(1)} ${yAt(point.value).toFixed(1)} `;
      started = true;
    });
    svg.append(svgNode("path", { d: path.trim(), class: "stat-line" }));
    points.forEach((point, index) => {
      if (!(point.value > 0)) return;
      const x = xAt(index);
      const y = yAt(point.value);
      svg.append(svgNode("circle", { cx: x, cy: y, r: point.current ? 6 : 4.6, class: point.current ? "stat-dot is-current" : "stat-dot" }));
      svg.append(svgNode("text", { x, y: y - 12, "text-anchor": "middle", class: "stat-value" }, formatNumber(point.value, decimals)));
    });
    points.forEach((point, index) => {
      svg.append(svgNode("text", { x: xAt(index), y: 178, "text-anchor": "middle",
        class: point.current ? "stat-axis is-current" : "stat-axis" }, point.label));
    });
    return svg;
  }

  function sparklineSvg(values) {
    const width = 92;
    const height = 34;
    const svg = svgChart(width, height, "Andamento");
    svg.setAttribute("aria-hidden", "true");
    svg.removeAttribute("role");
    svg.setAttribute("class", "stat-spark");
    const present = values.filter((value) => value > 0);
    if (!present.length) {
      svg.append(svgNode("line", { x1: 4, x2: width - 4, y1: height / 2, y2: height / 2, class: "stat-grid-line" }));
      return svg;
    }
    const low = Math.min(...present);
    const high = Math.max(...present);
    const spread = Math.max(high - low, high * 0.06, 1);
    const xAt = (index) => (values.length === 1 ? width / 2 : 5 + index * (width - 10) / (values.length - 1));
    const yAt = (value) => height - 6 - (value - (low - spread * 0.25)) / (spread * 1.5) * (height - 12);
    let path = "";
    let started = false;
    let last = null;
    values.forEach((value, index) => {
      if (!(value > 0)) {
        started = false;
        return;
      }
      path += `${started ? "L" : "M"} ${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)} `;
      started = true;
      last = { x: xAt(index), y: yAt(value) };
    });
    svg.append(svgNode("path", { d: path.trim(), class: "stat-spark-line" }));
    if (last) svg.append(svgNode("circle", { cx: last.x, cy: last.y, r: 3.4, class: "stat-spark-dot" }));
    return svg;
  }

  function statCard(title, copy) {
    const card = node("section", "home-card stat-card");
    card.append(node("h3", "", title));
    if (copy) card.append(node("p", "hint", copy));
    return card;
  }

  function segmented(options, current, onChange) {
    const group = node("div", "stat-seg");
    group.setAttribute("role", "tablist");
    options.forEach(([value, label]) => {
      const item = button(label, `stat-seg-item${value === current ? " is-active" : ""}`, () => onChange(value));
      item.setAttribute("role", "tab");
      item.setAttribute("aria-selected", String(value === current));
      group.append(item);
    });
    return group;
  }

  function exerciseSummary(entry) {
    const metric = (item) => (entry.cardio ? item.minutes : entry.bodyweight ? item.bestReps : item.bestLoad);
    const done = entry.weeks.filter((item) => metric(item) > 0);
    if (!done.length) return null;
    const first = done[0];
    const last = done[done.length - 1];
    return { first, last, done, delta: done.length > 1 ? metric(last) - metric(first) : 0, metric };
  }

  function deltaBadge(entry, summary) {
    const badge = node("span", "stat-delta");
    if (!summary || summary.done.length < 2) {
      badge.classList.add("is-flat");
      badge.textContent = summary ? "1ª seduta" : "";
      return badge;
    }
    const unit = entry.cardio ? " min" : entry.bodyweight ? " rip." : " kg";
    const value = summary.delta;
    badge.classList.add(value > 0 ? "is-up" : value < 0 ? "is-down" : "is-flat");
    badge.textContent = value === 0 ? "stabile" : `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value), 2)}${unit}`;
    return badge;
  }

  function lastLabel(entry, item) {
    if (entry.cardio) return `${formatNumber(item.minutes)} min`;
    if (entry.bodyweight) return `${item.bestReps} rip.`;
    if (item.best) return `${item.best.reps} × ${formatNumber(item.best.load, 2)} kg`;
    return `${formatNumber(item.bestLoad, 2)} kg`;
  }

  function openExerciseStats(entry, stats) {
    const summary = exerciseSummary(entry);
    const week = state.selection.week;
    const card = node("div", "stat-detail");
    if (!summary) {
      card.append(node("p", "hint", "Ancora nessun dato per questo esercizio: appena completi le serie compare qui l'andamento."));
      openHealthSheet(card, shortExerciseName(entry.name));
      return;
    }
    const tiles = node("div", "summary-tiles");
    const tile = (label, value, unit = "") => {
      const item = node("div", "sheet-tile");
      const strong = node("strong", "", value);
      if (unit) strong.append(node("small", "", ` ${unit}`));
      item.append(node("span", "", label), strong);
      return item;
    };
    const total = entry.weeks.reduce((sum, item) => sum + (entry.cardio ? item.minutes : entry.bodyweight ? item.reps : item.volume), 0);
    const gainPercent = !entry.cardio && !entry.bodyweight && summary.first.bestLoad > 0 && summary.done.length > 1
      ? summary.delta / summary.first.bestLoad * 100 : null;
    tiles.append(
      tile("Ultima volta", lastLabel(entry, summary.last)),
      tile("Da inizio blocco", summary.done.length > 1
        ? (entry.cardio || entry.bodyweight ? `${summary.delta >= 0 ? "+" : "−"}${formatNumber(Math.abs(summary.delta))}` : signedKg(summary.delta).replace(" kg", ""))
        : "—", entry.cardio ? "min" : entry.bodyweight ? "rip." : "kg"),
      tile(entry.cardio ? "Minuti totali" : entry.bodyweight ? "Ripetizioni totali" : "Volume totale", groupedNumber(total),
        entry.cardio ? "min" : entry.bodyweight ? "" : "kg"),
      tile("Settimane fatte", `${summary.done.length}/${stats.weeks}`)
    );
    card.append(tiles);
    if (gainPercent !== null) {
      card.append(node("p", "stat-note", `${gainPercent >= 0 ? "+" : "−"}${formatNumber(Math.abs(gainPercent), 1)}% di carico massimo rispetto alla prima settimana registrata.`));
    }
    const lineCard = node("div", "stat-sub");
    lineCard.append(node("h4", "", entry.cardio ? "Minuti per settimana" : entry.bodyweight ? "Ripetizioni migliori per settimana" : "Carico massimo per settimana (kg)"));
    lineCard.append(lineChartSvg(entry.weeks.map((item) => ({
      label: `S${item.week}`, value: entry.cardio ? item.minutes : entry.bodyweight ? item.bestReps : item.bestLoad, current: item.week === week,
    })), `Andamento di ${entry.name}`, entry.cardio || entry.bodyweight ? 0 : 1));
    card.append(lineCard);
    if (!entry.cardio && !entry.bodyweight) {
      const barCard = node("div", "stat-sub");
      barCard.append(node("h4", "", "Volume per settimana (kg × rip.)"));
      barCard.append(barChartSvg(entry.weeks.map((item) => item.volume), week, `Volume settimanale di ${entry.name}`));
      card.append(barCard);
    }
    const table = node("div", "stat-table");
    const recordWeeks = new Set(stats.records.filter((record) => record.name === entry.name).map((record) => record.week));
    entry.weeks.forEach((item) => {
      if (!item.planned) return;
      const row = node("div", `stat-table-row${item.week === week ? " is-current" : ""}`);
      row.append(node("b", "", `S${item.week}`));
      const detail = (entry.cardio ? item.minutes > 0 : item.sets > 0)
        ? (entry.cardio ? `${formatNumber(item.minutes)} min` : `${item.sets}/${item.planned} serie · migliore ${lastLabel(entry, item)}`)
        : "non ancora fatto";
      row.append(node("span", item.sets > 0 || item.minutes > 0 ? "" : "is-empty", detail));
      if (recordWeeks.has(item.week)) row.append(node("em", "pr-badge", "Record"));
      table.append(row);
    });
    card.append(table);
    openHealthSheet(card, shortExerciseName(entry.name));
  }

  function renderStatsOverview(view, stats) {
    const week = state.selection.week;
    const grid = node("div", "stat-kpis");
    const kpi = (label, value, unit = "", sub = "") => {
      const item = node("div", "stat-kpi");
      const strong = node("strong", "", value);
      if (unit) strong.append(node("small", "", ` ${unit}`));
      item.append(node("span", "", label), strong);
      if (sub) item.append(node("small", "stat-sub-label", sub));
      return item;
    };
    grid.append(
      kpi("Allenamenti", `${stats.totals.daysDone}`, `/ ${stats.totals.daysTotal}`, "giornate completate"),
      kpi("Serie", formatNumber(stats.totals.sets), "", "serie completate"),
      kpi("Volume", compactNumber(stats.totals.volume), "kg", "peso × ripetizioni"),
      kpi("Record", String(stats.records.length), "", "nuovi massimali")
    );
    view.append(grid);

    const adherence = statCard("Costanza", "Per ogni giornata: esercizi completati sul totale.");
    const matrix = node("div", "stat-matrix");
    matrix.style.setProperty("--cols", String(stats.dayCells.length));
    matrix.append(node("span", "stat-matrix-corner", ""));
    stats.dayCells.forEach((cell) => matrix.append(node("span", "stat-matrix-head", cell.day.name)));
    for (let w = 1; w <= stats.weeks; w += 1) {
      matrix.append(node("span", `stat-matrix-week${w === week ? " is-current" : ""}`, `S${w}`));
      stats.dayCells.forEach((cell) => {
        const progress = cell.weeks[w - 1];
        const ratio = progress.total ? progress.completed / progress.total : 0;
        const item = node("span", `stat-matrix-cell${ratio === 1 ? " is-done" : ratio > 0 ? " is-partial" : ""}`,
          progress.total ? `${progress.completed}/${progress.total}` : "–");
        item.style.setProperty("--p", `${Math.round(ratio * 100)}%`);
        item.setAttribute("aria-label", `Settimana ${w}, ${cell.day.name}: ${progress.completed} esercizi su ${progress.total}`);
        matrix.append(item);
      });
    }
    adherence.append(matrix);
    view.append(adherence);

    const volumes = Array.from({ length: stats.weeks }, (_, index) => weekVolume(stats.plan, index + 1));
    const volumeCard = statCard("Volume per settimana", "Kg sollevati in totale (peso × ripetizioni).");
    volumeCard.append(barChartSvg(volumes, week, "Volume sollevato per settimana"));
    const previous = volumes[week - 2];
    if (week > 1 && previous > 0 && volumes[week - 1] > 0) {
      const change = (volumes[week - 1] - previous) / previous * 100;
      const chip = node("span", `stat-delta ${change >= 0 ? "is-up" : "is-down"}`,
        `${change >= 0 ? "+" : "−"}${formatNumber(Math.abs(change), 1)}% rispetto alla settimana ${week - 1}`);
      volumeCard.append(chip);
    }
    view.append(volumeCard);

    const muscles = new Map();
    for (const entry of stats.exercises) {
      if (entry.cardio) continue;
      const item = entry.weeks[week - 1];
      const slot = muscles.get(entry.muscle) || { done: 0, planned: 0 };
      slot.done += Math.min(item.sets, item.planned || item.sets);
      slot.planned += item.planned;
      muscles.set(entry.muscle, slot);
    }
    const muscleCard = statCard(`Serie per muscolo · settimana ${week}`, "Serie fatte sul totale previsto dalla scheda.");
    [...muscles.entries()].filter(([, slot]) => slot.planned > 0)
      .sort((left, right) => right[1].planned - left[1].planned).forEach(([name, slot]) => {
        const row = node("div", "stat-bar-row");
        row.append(node("span", "stat-bar-name", name));
        const track = node("span", "stat-bar-track");
        const fill = node("span", "stat-bar-fill");
        fill.style.width = `${Math.min(100, slot.planned ? slot.done / slot.planned * 100 : 0)}%`;
        track.append(fill);
        row.append(track, node("span", "stat-bar-value", `${slot.done}/${slot.planned}`));
        muscleCard.append(row);
      });
    view.append(muscleCard);

    const recordCard = statCard("Ultimi record", "Quando superi il tuo carico o la forza stimata delle settimane precedenti.");
    if (!stats.records.length) {
      recordCard.append(node("p", "volume-empty", "Ancora nessun record: compaiono dalla seconda settimana in poi."));
    } else {
      stats.records.slice(0, 6).forEach((record) => {
        const row = node("div", "stat-record");
        const text = node("div");
        text.append(node("strong", "", shortExerciseName(record.name)),
          node("small", "", `Settimana ${record.week} · ${record.best ? `${record.best.reps} × ${formatNumber(record.best.load, 2)} kg` : `${formatNumber(record.load, 2)} kg`}`));
        row.append(text, node("span", "stat-delta is-up", record.gain > 0 ? signedKg(record.gain) : "più forte"));
        recordCard.append(row);
      });
    }
    view.append(recordCard);
  }

  function renderStatsExercises(view, stats) {
    const days = stats.dayCells.map((cell) => cell.day);
    const chips = node("div", "stat-chips");
    [["all", "Tutti"], ...days.map((day) => [day.id, day.name])].forEach(([value, label]) => {
      const chip = button(label, `stat-chip${statsDay === value ? " is-active" : ""}`, () => {
        statsDay = value;
        renderHistory();
      });
      chip.setAttribute("aria-pressed", String(statsDay === value));
      chips.append(chip);
    });
    view.append(chips);
    const list = node("div", "stat-list");
    stats.exercises.filter((entry) => statsDay === "all" || entry.dayId === statsDay).forEach((entry) => {
      const summary = exerciseSummary(entry);
      const row = button("", "stat-row", () => openExerciseStats(entry, stats));
      const name = node("div", "stat-row-name");
      name.append(node("strong", "", shortExerciseName(entry.name)),
        node("small", "", `${entry.dayName} · ${entry.muscle}${/^SS /i.test(entry.name) ? " · SS" : ""}`));
      const values = entry.weeks.map((item) => (entry.cardio ? item.minutes : entry.bodyweight ? item.bestReps : item.bestLoad));
      const trend = node("div", "stat-row-trend");
      trend.append(sparklineSvg(values));
      const last = node("div", "stat-row-last");
      if (summary) {
        last.append(node("strong", "", lastLabel(entry, summary.last)), deltaBadge(entry, summary));
      } else {
        last.append(node("small", "", "nessun dato"));
      }
      row.append(name, trend, last);
      row.setAttribute("aria-label", `${entry.name}: apri andamento`);
      list.append(row);
    });
    view.append(list);
    view.append(node("p", "hint stat-foot", "Il grafico mostra il carico massimo di ogni settimana. Tocca un esercizio per il dettaglio."));
  }

  function renderHistory() {
    const view = views.history;
    view.replaceChildren();
    const stats = collectStats();
    const header = node("div", "page-header");
    header.append(node("h1", "page-title", "Statistiche"),
      node("p", "page-copy", `${stats.plan.name} · ${stats.weeks} settimane`));
    view.append(header);
    const hasData = Object.keys(state.records).length > 0;
    if (!hasData) {
      const empty = node("div", "empty-state");
      empty.append(icon("history", 64),
        node("p", "", "Il tuo percorso inizia dal primo allenamento: qui vedrai grafici e progressi."),
        button("Inizia un allenamento", "primary-button", () => setScreen("workout")));
      view.append(empty);
      return;
    }
    view.append(segmented([["overview", "Panoramica"], ["exercises", "Esercizi"], ["log", "Cronologia"]], statsTab, (value) => {
      statsTab = value;
      renderHistory();
    }));
    const body = node("div", "stat-body");
    view.append(body);
    if (statsTab === "overview") renderStatsOverview(body, stats);
    else if (statsTab === "exercises") renderStatsExercises(body, stats);
    else renderChronology(body);
  }

  function renderChronology(view) {
    const records = Object.values(state.records)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (!records.length) {
      const empty = node("div", "empty-state");
      empty.append(icon("history", 64),
        node("p", "", "Il tuo percorso inizia dal primo allenamento."),
        button("Inizia un allenamento", "primary-button", () => setScreen("workout")));
      view.append(empty);
      return;
    }
    const maximums = new Map();
    records.forEach((record) => {
      const maximum = Math.max(0, ...(record.series || [])
        .map((set) => Number((set.load || "").replace(",", ".")) || 0));
      maximums.set(record.exerciseName, Math.max(maximum, maximums.get(record.exerciseName) || 0));
    });
    let activeMonth = "";
    let activeDay = "";
    let list = null;
    for (const record of records) {
      const date = new Date(record.updatedAt);
      const valid = !Number.isNaN(date.getTime());
      const month = valid ? date.toLocaleDateString("it-IT", { month: "long", year: "numeric" }) : "Altre date";
      const day = valid ? date.toLocaleDateString("it-IT", { weekday: "long", day: "numeric" }) : record.updatedAt;
      if (month !== activeMonth) {
        activeMonth = month;
        activeDay = "";
        view.append(node("h2", "history-month", month.toLocaleUpperCase("it-IT")));
      }
      if (day !== activeDay) {
        activeDay = day;
        list = node("div", "history-list");
        list.append(node("div", "history-day", day));
        view.append(list);
      }
      const card = node("div", "history-card");
      card.append(node("span", "history-date-badge", valid ? String(date.getDate()) : "–"));
      const content = node("div", "history-record-content");
      const head = node("div", "record-head");
      head.append(node("strong", "", record.exerciseName));
      content.append(head, node("p", "record-meta", `${record.planName} · ${record.dayName} · S${record.week}`));
      const details = [];
      const previous = [];
      if (record.load) previous.push(`${record.load} ${record.kind === "cardio" ? "min" : "kg"}`);
      if (record.reps) previous.push(record.reps);
      if (previous.length) details.push(`${record.series ? "Prec.: " : ""}${previous.join(" · ")}`);
      if (record.series) {
        record.series.forEach((set, index) => {
          if (!set.load && !set.reps && !set.left && !set.right) return;
          const parts = [];
          if (set.load) parts.push(`${set.load} kg`);
          if (set.left || set.right) parts.push(`dx ${set.right || "—"} / sx ${set.left || "—"}`);
          else if (set.reps) parts.push(`${set.reps} rip.`);
          details.push(`${index + 1} × ${parts.join(" · ")}`);
        });
      }
      if (record.rir) details.push(`RIR ${record.rir}`);
      if (record.notes) details.push(record.notes);
      content.append(node("p", "record-data", details.join("  ·  ") || "Nessun dato inserito"));
      card.append(content);
      if ((record.series || []).some((set) => Number((set.load || "").replace(",", ".")) > 0 &&
          Number((set.load || "").replace(",", ".")) === maximums.get(record.exerciseName))) {
        card.append(node("span", "chip", "Max"));
      } else if (record.completed) {
        const complete = node("span", "history-complete");
        complete.append(icon("check", 16));
        complete.setAttribute("aria-label", "Completato");
        card.append(complete);
      }
      list.append(card);
    }
  }

  function fatal(message, raw) {
    const main = document.getElementById("main-content");
    main.replaceChildren();
    const box = node("div", "info-card");
    box.append(node("strong", "", "Impossibile aprire i dati"), node("p", "", message));
    if (raw) {
      box.append(button("Scarica copia dei dati", "secondary-button", () => {
        exportFile("dati-allenamento-da-recuperare.json", raw);
      }));
    }
    main.append(box);
    document.querySelector(".bottom-nav").hidden = true;
    document.querySelector(".bottom-scrim").hidden = true;
  }

  async function loadIllustrations() {
    try {
      const response = await fetch("./assets/illustrazioni/catalogo.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const catalog = await response.json();
      const ids = new Set();
      if (!Array.isArray(catalog) || !catalog.every((item) =>
        isObject(item) && validId(item.id) && !ids.has(item.id) && ids.add(item.id) &&
        shortText(item.title, 120) && shortText(item.equipment, 100) &&
        typeof item.src === "string" && /^\.\/assets\/illustrazioni\/[a-z0-9-]+\.svg$/.test(item.src) &&
        (item.thumb === undefined || (typeof item.thumb === "string" && /^\.\/assets\/illustrazioni\/[a-z0-9-]+\.svg$/.test(item.thumb))) &&
        (item.cues === undefined || (Array.isArray(item.cues) && item.cues.length <= 6 &&
          item.cues.every((cue) => isObject(cue) && Number.isInteger(cue.n) && shortText(cue.text, 120)))) &&
        (item.move === undefined || shortText(item.move, 160, true)) &&
        (item.avoid === undefined || shortText(item.avoid, 160, true)) &&
        Array.isArray(item.matches) && item.matches.every((name) => shortText(name, 200))
      )) throw new Error("Catalogo illustrazioni non valido");
      illustrationCatalog = catalog;
    } catch (error) {
      console.error("Caricamento delle illustrazioni non riuscito:", error);
      illustrationsAvailable = false;
      showNotice("Le illustrazioni non sono disponibili. Puoi comunque usare la scheda e i tuoi registri.", true);
    }
  }

  async function loadBasePlan() {
    const response = await fetch("./scheda-iniziale.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const plan = await response.json();
    const error = validatePlan(plan);
    if (error) throw new Error(error);
    return plan;
  }

  async function start() {
    showDailyQuote();
    fitViewport();
    let raw = null;
    let basePlanLoadFailed = false;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.error("Lettura locale non riuscita:", error);
      storageAvailable = false;
      showNotice("La memoria locale non è disponibile: i dati potrebbero andare persi.", true);
    }
    if (raw !== null) {
      try {
        state = JSON.parse(raw);
      } catch (error) {
        console.error("Salvataggio locale non interpretabile:", error);
        fatal("Il salvataggio esistente non è leggibile. Non è stato sovrascritto.", raw);
        return;
      }
      const error = validateState(state);
      if (error) {
        fatal(`${error} Il salvataggio esistente non è stato sovrascritto.`, raw);
        return;
      }
      try {
        basePlan = await loadBasePlan();
      } catch (error) {
        console.error("Caricamento delle indicazioni standard non riuscito:", error);
        basePlanLoadFailed = true;
      }
    } else {
      try {
        basePlan = await loadBasePlan();
      } catch (error) {
        console.error("Caricamento della scheda iniziale non riuscito:", error);
        fatal("Non riesco a caricare la scheda iniziale. Controlla la connessione e riprova.", null);
        return;
      }
      state = {
        version: 1,
        plans: [basePlan],
        activePlanId: basePlan.id,
        records: {},
        selection: { dayId: basePlan.days[0].id, week: 1 },
      };
      persist();
    }
    ensureSelection();
    ensureHealth();
    await loadIllustrations();
    navButtons.forEach((nav) => nav.addEventListener("click", () => setScreen(nav.dataset.screen)));
    fitViewport();
    window.setTimeout(fitViewport, 600);
    window.addEventListener("load", () => window.setTimeout(fitViewport, 300));
    onHorizontalSwipe(views.workout, {
      ignore: ".day-strip, .exercise-gallery, input, textarea, .series-swipe, .week-control",
      onLeft: () => stepDay(1),
      onRight: () => stepDay(-1),
    });
    window.addEventListener("orientationchange", () => window.setTimeout(fitViewport, 250));
    window.addEventListener("pageshow", fitViewport);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", syncKeyboard);
      window.visualViewport.addEventListener("scroll", resetScroll);
    }
    document.addEventListener("focusin", resetScroll);
    document.addEventListener("focusout", () => {
      resetScroll();
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
        fitViewport();
        syncKeyboard();
      }, 400);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && currentScreen === "workout") keepScreenAwake(true);
    });
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    restTimerToggle.addEventListener("click", toggleRestTimer);
    restTimerReset.addEventListener("click", resetRestTimer);
    document.getElementById("rest-timer-back").addEventListener("click", () => adjustRestTimer(-10));
    document.getElementById("rest-timer-forward").addEventListener("click", () => adjustRestTimer(10));
    setScreen("home");
    if (basePlanLoadFailed) {
      showNotice("Le istruzioni standard non sono state caricate; ricarica l'app quando sei online.", true);
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js").catch((error) => {
        console.error("Registrazione offline non riuscita:", error);
        showNotice("L'uso offline non è disponibile in questo browser. I dati restano locali.", true);
      });
    } else {
      showNotice("L'uso offline non è disponibile in questo browser. I dati restano locali.", true);
    }
  }

  start();
})();
