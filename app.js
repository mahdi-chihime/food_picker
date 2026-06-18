const COLORS = [
  "#e64b4b", "#2f8fce", "#38a169", "#9f7aea", "#f6ad35", "#2dd4bf",
  "#ed8936", "#667eea", "#d53f8c", "#68d391", "#f56565", "#4fd1c5",
];

const MOTORCYCLE_MODELS = [
  {
    key: "bmw",
    label: "BMW S1000RR",
    primary: "#f7f7f3",
    image: "assets/motorcycles/bmw-s1000rr.png",
    flip: true,
  },
  {
    key: "ducati",
    label: "Ducati Panigale V4",
    primary: "#d71920",
    image: "assets/motorcycles/ducati-panigale-v4.png",
  },
  {
    key: "h2r",
    label: "Kawasaki H2R",
    primary: "#090d10",
    image: "assets/motorcycles/kawasaki-h2r.png",
  },
  {
    key: "cbr",
    label: "CBR1000RR-R",
    primary: "#e31b23",
    image: "assets/motorcycles/honda-cbr1000rrr.png",
  },
  {
    key: "r1",
    label: "Yamaha R1",
    primary: "#1d4ed8",
    image: "assets/motorcycles/yamaha-r1.png",
  },
];
const RACE_START_X = 120;
const TRACK_PIXELS_PER_SECOND = 265;
const MIN_TRACK_DISTANCE = 2300;
// Master pace of the personality engine. Tuned so a full race lasts roughly the
// chosen duration WHILE leaving headroom for every bike to genuinely accelerate
// across the finish line instead of coasting/waiting. Lower = bikes lean harder
// on their surges; higher = flatter, more metronomic racing.
const RACE_PACE = 0.58;
// Race-length lock. A uniform global "tempo" nudges the WHOLE field (every bike
// scaled equally, so relative racing/lead-changes/sprint are untouched) to keep
// the front-runner on a time schedule, so the leader crosses the line right as
// the clock runs out. The schedule is eased (exponent > 1) so bikes build up and
// genuinely accelerate into the flag instead of holding a flat pace.
const RACE_SCHEDULE_EXP = 1.9;
const RACE_TEMPO_GAIN = 4.2;
const BYBLOS_PURPLE = "#4b1777";
const BYBLOS_DARK_PURPLE = "#2a0f42";
const BYBLOS_GOLD = "#e5c100";

const state = {
  restaurants: [],
  allRestaurants: [],
  history: [],
  racers: [],
  running: false,
  paused: false,
  finished: false,
  savingWinner: false,
  savingRatingId: null,
  expandedRatings: new Set(),
  ratingDrafts: new Map(),

  racePositions: [],
  lastRaceId: null,
  lastWinnerName: null,
  lastWinnerRating: null,
  animationId: null,
  lastFrame: 0,
  raceTime: 0,
  raceDuration: 60,
  cameraX: 0,
  dust: [],
  confetti: [],
  sceneTick: 0,
  currentParticipants: [],
  currentRaceMode: "normal",
  tournament: null,
  tournamentQualifiers: 3,
  activeTab: "lineup",

  countdown: 0,
  announcements: [],
  prevLeaderId: null,
  leadChangeCooldown: 0,
  slowMo: 1,
  photoFinishAnnounced: false,
  finalStretchAnnounced: false,
  shake: 0,
};

const gameShell = document.querySelector(".game-shell");
const arena = document.querySelector(".arena");
const canvas = document.querySelector("#raceCanvas");
const ctx = canvas.getContext("2d");
const motorcycleSprites = new Map();
const restaurantLogoSprites = new Map();
const byblosLogo = new Image();
byblosLogo.src = "assets/byblos-bank-logo.png";
byblosLogo.onload = drawRace;
const LOGO_REQUEST_TOKEN = Date.now().toString(36);

const entryForm = document.querySelector("#entryForm");
const restaurantInput = document.querySelector("#restaurantInput");
const entriesList = document.querySelector("#entriesList");
const startBtn = document.querySelector("#startBtn");
const pauseBtn = document.querySelector("#pauseBtn");
const panelToggle = document.querySelector("#panelToggle");
const resetBtn = document.querySelector("#resetBtn");
const tournamentBtn = document.querySelector("#tournamentBtn");
const resetAllBtn = document.querySelector("#resetAllBtn");
const countLabel = document.querySelector("#countLabel");
const lineupSummary = document.querySelector("#lineupSummary");
const restaurantSuggestions = document.querySelector("#restaurantSuggestions");
const suggestionToggle = document.querySelector("#suggestionToggle");
const statsList = document.querySelector("#statsList");
const historyList = document.querySelector("#historyList");
const historyCountLabel = document.querySelector("#historyCountLabel");
const lastWinnerLabel = document.querySelector("#lastWinnerLabel");
const winnerBanner = document.querySelector("#winnerBanner");
const winnerStage = document.querySelector("#winnerStage");
const winnerName = document.querySelector("#winnerName");
const raceTimer = document.querySelector("#raceTimer");
const durationPreview = document.querySelector("#durationPreview");
const minutesInput = document.querySelector("#minutesInput");
const secondsInput = document.querySelector("#secondsInput");
const presetButtons = document.querySelectorAll(".preset-btn");
const qualifierButtons = document.querySelectorAll(".qualifier-btn");
const tabs = document.querySelectorAll(".tab-btn");
const panels = document.querySelectorAll(".tab-panel");

loadState();

entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await addRestaurant(restaurantInput.value);
  restaurantInput.value = "";
  restaurantInput.focus();
});

startBtn.addEventListener("click", () => {
  if (state.tournament?.active && !state.tournament.complete) {
    if (state.running && state.paused) {
      state.paused = false;
      state.lastFrame = performance.now();
      requestAnimationFrame(tick);
      renderControls();
      return;
    }
    startTournamentRound();
    return;
  }
  if (state.tournament?.complete) state.tournament = null;

  if (state.restaurants.length < 2) {
    showMessage("Add more motorcycles", "Two restaurants minimum");
    return;
  }

  if (state.finished || !state.racers.length) {
    resetRace();
    buildRace();
  }

  state.currentRaceMode = "normal";
  state.running = true;
  state.paused = false;
  state.lastFrame = performance.now();
  state.countdown = 3.2;
  winnerBanner.hidden = true;
  requestAnimationFrame(tick);
  renderControls();
});

function setPanelHidden(hidden) {
  gameShell.classList.toggle("panel-hidden", hidden);
  panelToggle.textContent = hidden ? "Show Menu" : "Hide Menu";
  try {
    localStorage.setItem("fp_panel_hidden", hidden ? "1" : "0");
  } catch (_) { /* private mode */ }
  drawRace();
}

panelToggle.addEventListener("click", () => {
  setPanelHidden(!gameShell.classList.contains("panel-hidden"));
});

try {
  if (localStorage.getItem("fp_panel_hidden") === "1") setPanelHidden(true);
} catch (_) { /* private mode */ }

pauseBtn.addEventListener("click", () => {
  if (!state.running) return;
  state.paused = !state.paused;
  state.lastFrame = performance.now();
  if (!state.paused) requestAnimationFrame(tick);
  renderControls();
});

resetBtn.addEventListener("click", () => {
  state.tournament = null;
  resetRace();
  syncFromState();
});

tournamentBtn.addEventListener("click", () => {
  startTournament();
});

resetAllBtn.addEventListener("click", async () => {
  const ok = window.confirm("Remove all restaurants from the grid?");
  if (!ok) return;
  state.tournament = null;
  resetRace();
  applyServerState(await api("/api/restaurants/clear", { method: "POST", body: JSON.stringify({}) }));
  restaurantInput.focus();
});

restaurantInput.addEventListener("input", () => {
  renderSuggestions();
  showSuggestions();
});
restaurantInput.addEventListener("focus", () => {
  renderSuggestions();
  showSuggestions();
});
suggestionToggle.addEventListener("click", () => {
  renderSuggestions();
  restaurantSuggestions.hidden ? showSuggestions() : hideSuggestions();
  restaurantInput.focus();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".entry-combobox")) hideSuggestions();
});
minutesInput.addEventListener("input", syncDurationFromInputs);
secondsInput.addEventListener("input", syncDurationFromInputs);
minutesInput.addEventListener("change", () => applyDuration(state.raceDuration));
secondsInput.addEventListener("change", () => applyDuration(state.raceDuration));

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyDuration(Number(button.dataset.duration || 60));
  });
});

qualifierButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.tournamentQualifiers = Number(button.dataset.qualifiers);
    renderControls();
    const t = state.tournament;
    if (t?.active && !t.complete && !state.running) {
      const heatSizes = t.heats.map((h) => h.length).join(" / ");
      const phase = t.finalStarted ? "Final Race"
        : t.heatIndex >= t.heats.length ? "Final Ready"
        : `Heat ${t.heatIndex + 1}/${t.heats.length}`;
      const detail = t.heats.length && !t.finalStarted
        ? `Top ${state.tournamentQualifiers} per heat advance`
        : "";
      showMessage(phase, detail || `Top ${state.tournamentQualifiers} advance`);
    }
  });
});

tabs.forEach((button) => {
  button.addEventListener("click", () => setTab(button.dataset.tab));
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function loadState() {
  try {
    applyServerState(await api("/api/state"));
  } catch (error) {
    showMessage("Server not ready", error.message);
  }
}

function applyServerState(payload) {
  state.allRestaurants = payload.restaurants || [];
  state.restaurants = state.allRestaurants.filter((restaurant) => restaurant.active);
  state.history = payload.history || [];
  state.lastRaceId = payload.last_race_id || null;
  state.lastWinnerName = payload.last_winner_name || null;
  state.lastWinnerRating = payload.last_winner_rating || null;
  assignColors();
  syncFromState();
}

async function addRestaurant(rawName) {
  const name = String(rawName || "").trim().replace(/\s+/g, " ");
  if (!name) return;
  state.tournament = null;
  resetRace();
  applyServerState(await api("/api/restaurants", {
    method: "POST",
    body: JSON.stringify({ name }),
  }));
}

async function changeEntryCount(id, delta) {
  state.tournament = null;
  resetRace();
  try {
    applyServerState(await api(`/api/restaurants/${id}/count`, {
      method: "POST",
      body: JSON.stringify({ delta }),
    }));
  } catch (error) {
    showMessage("Could not update count", error.message);
  }
}

async function removeRestaurant(id) {
  state.tournament = null;
  resetRace();
  applyServerState(await api(`/api/restaurants/${id}`, { method: "DELETE" }));
}

async function hideSuggestion(id) {
  applyServerState(await api(`/api/restaurants/${id}/hide-suggestion`, { method: "DELETE" }));
  restaurantInput.focus();
  renderSuggestions();
  showSuggestions();
}

async function deleteRace(raceId) {
  if (!window.confirm("Delete this race result? The winner's win count will drop by 1.")) return;
  try {
    applyServerState(await api(`/api/races/${raceId}`, { method: "DELETE" }));
  } catch (error) {
    showMessage("Delete failed", error.message);
  }
}

function assignColors() {
  state.allRestaurants.forEach((restaurant, index) => {
    restaurant.color = COLORS[index % COLORS.length];
    restaurant.coat = MOTORCYCLE_MODELS[index % MOTORCYCLE_MODELS.length].primary;
  });
  state.restaurants.forEach((restaurant) => {
    const full = state.allRestaurants.find((item) => item.id === restaurant.id);
    restaurant.color = full?.color || COLORS[0];
    restaurant.coat = full?.coat || MOTORCYCLE_MODELS[0].primary;
  });
}

function syncFromState() {
  renderTabs();
  renderSuggestions();
  renderEntries();
  renderStats();
  renderHistory();
  renderControls();
  drawRace();
}

function setTab(tab) {
  state.activeTab = tab;
  renderTabs();
}

function renderTabs() {
  tabs.forEach((button) => {
    const active = button.dataset.tab === state.activeTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  panels.forEach((panel) => {
    const active = panel.id === `${state.activeTab}Panel`;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function resetRace() {
  cancelAnimationFrame(state.animationId);
  state.racers = [];
  state.currentParticipants = [];
  state.currentRaceMode = "normal";
  state.running = false;
  state.paused = false;
  state.finished = false;
  state.lastFrame = 0;
  state.raceTime = 0;
  state.cameraX = 0;
  state.dust = [];
  state.confetti = [];
  state.sceneTick = 0;
  state.countdown = 0;
  state.announcements = [];
  state.prevLeaderId = null;
  state.leadChangeCooldown = 0;
  state.slowMo = 1;
  state.photoFinishAnnounced = false;
  state.finalStretchAnnounced = false;
  state.shake = 0;
  arena.classList.remove("final-sprint");
  winnerBanner.hidden = true;
  renderTimer();
}

function expandEntries(restaurants) {
  // One rider per entry count: "sandwich w noss ×3" races 3 bikes.
  return restaurants.flatMap((restaurant) =>
    Array.from({ length: Math.max(1, restaurant.entries_count || 1) }, () => restaurant)
  );
}

function totalRiders() {
  return state.restaurants.reduce((sum, r) => sum + Math.max(1, r.entries_count || 1), 0);
}

function buildRace() {
  const entries = shuffled(expandEntries(state.restaurants));
  buildRaceFrom(entries);
}

function buildRaceFrom(entries) {
  state.currentParticipants = [...entries];
  state.racers = entries.map((restaurant, index) => makeRacer(restaurant, index, entries.length));
  state.cameraX = 0;
  state.finished = false;
  state.raceTime = 0;
  state.dust = [];
  state.confetti = [];
  state.sceneTick = 0;
  state.announcements = [];
  state.prevLeaderId = null;
  state.leadChangeCooldown = 0;
  state.slowMo = 1;
  state.photoFinishAnnounced = false;
  state.finalStretchAnnounced = false;
  state.shake = 0;
  drawRace();
}

function startTournament() {
  if (state.restaurants.length < 2) {
    showMessage("Need more picks", "Two restaurants minimum");
    return;
  }

  resetRace();
  const entrants = shuffled(expandEntries(state.restaurants));
  const heats = entrants.length > 6 ? balancedHeats(entrants, 6) : [];
  state.tournament = {
    active: true,
    heats,
    heatSizes: heats.map((heat) => heat.length),
    heatIndex: 0,
    finalists: heats.length ? [] : entrants,
    finalStarted: !heats.length,
    complete: false,
  };
  const heatSizes = heats.map((heat) => heat.length).join(" / ");
  const phaseText = heats.length
    ? `${heats.length} heats · Top ${state.tournamentQualifiers} per heat advance`
    : "Final race ready";
  showMessage("Tournament Ready", phaseText);
  renderControls();
  drawRace();
}

function startTournamentRound() {
  const tournament = state.tournament;
  if (!tournament?.active || tournament.complete || state.running) return;

  let entries = [];
  let stage = "";
  if (tournament.heatIndex < tournament.heats.length) {
    entries = tournament.heats[tournament.heatIndex];
    stage = `Heat ${tournament.heatIndex + 1} of ${tournament.heats.length}`;
    state.currentRaceMode = "tournament_heat";
  } else {
    entries = tournament.finalists;
    tournament.finalStarted = true;
    stage = "Tournament Final";
    state.currentRaceMode = "tournament_final";
  }

  if (entries.length < 2) {
    showMessage("Tournament stopped", "Not enough riders for the next race");
    tournament.complete = true;
    renderControls();
    return;
  }

  buildRaceFrom(entries);
  state.running = true;
  state.paused = false;
  state.lastFrame = performance.now();
  state.countdown = 3.2;
  winnerBanner.hidden = true;
  showMessage(stage, `${entries.length} motorcycles`);
  requestAnimationFrame(tick);
  renderControls();
}

function makeRacer(restaurant, index, total) {
  const lane = laneGeometry(total, index);
  const startX = RACE_START_X;
  const ratingBoost = ratingPerformanceModifier(restaurant);
  const cruiseKmh = 205 + Math.random() * 130 + ratingBoost * 36;
  const fieldBias = (Math.random() - 0.5) * 0.08 + ratingBoost * 0.025;
  return {
    ...restaurant,
    lane: index,
    x: startX,
    startX,
    y: lane.y,
    scale: lane.scale,
    speed: 0,
    cruiseKmh,
    currentKmh: cruiseKmh,
    paceBias: 0.9 + Math.random() * 0.2 + ratingBoost * 0.08,
    stamina: 0.84 + Math.random() * 0.34 + ratingBoost * 0.07,
    clutch: 0.86 + Math.random() * 0.32,
    drag: 0.88 + Math.random() * 0.28,
    trafficNerve: Math.random(),
    ratingBoost,
    fieldBias,
    closingKick: Math.random(),
    collapseRisk: Math.random(),
    finishHunger: 0.65 + Math.random() * 0.7,
    burst: 0,
    surge: 0,
    nextSurge: 0,
    traffic: 0,
    attack: 0,
    attackTarget: 0,
    slump: 0,
    slumpTarget: 0,
    eventTimer: 0.6 + Math.random() * 1.8,
    surgeTimer: 0.35 + Math.random() * 1.1,
    raceOffset: 0,
    model: MOTORCYCLE_MODELS[index % MOTORCYCLE_MODELS.length],
    bob: Math.random() * Math.PI * 2,
    stride: Math.random() * Math.PI * 2,
    mane: Math.random() * Math.PI * 2,
    volatility: dramaLevel(),
    dustTimer: 0,
    waveFreq: 0.18 + Math.random() * 0.3,
    wavePhase: Math.random() * Math.PI * 2,
    waveAmp: 0.18 + Math.random() * 0.2,
    wave2Freq: 0.05 + Math.random() * 0.09,
    wave2Phase: Math.random() * Math.PI * 2,
    nitro: 0,
    nitroCooldown: 2 + Math.random() * 3,
  };
}

function ratingPerformanceModifier(restaurant) {
  const rating = Number(restaurant.avg_rating || 0);
  if (!Number.isFinite(rating) || rating <= 0) return 0;
  return clamp((rating - 3) / 2, -1, 1);
}

function tick(now) {
  if (!state.running || state.paused) return;

  let delta = Math.min((now - state.lastFrame) / 1000, 0.05);
  state.lastFrame = now;

  if (state.countdown > 0) {
    state.countdown -= delta;
    state.sceneTick += delta;
    if (state.countdown <= 0) {
      state.countdown = 0;
      addAnnouncement("GO!", "#6ee84c", 1.1);
    }
    drawRace();
    renderTimer();
    state.animationId = requestAnimationFrame(tick);
    return;
  }

  delta *= state.slowMo;
  state.raceTime = Math.min(state.raceDuration, state.raceTime + delta);
  state.sceneTick += delta;

  const finisher = updateRace(delta);
  drawRace();
  renderTimer();

  if (finisher) {
    finishRace(finisher);
    return;
  }

  state.animationId = requestAnimationFrame(tick);
}

function updateRace(delta) {
  const finish = finishX();
  const distance = raceDistance();
  const duration = Math.max(1, state.raceDuration);
  const basePace = distance / duration;
  const progress = clamp(state.raceTime / duration, 0, 1);
  const leaderX = state.racers.reduce((best, racer) => Math.max(best, racer.x), 0);
  const drama = dramaLevel();
  // The whole field is on the home straight together — used for crowd cues,
  // camera shake and the timer flash. Individual bikes decide their OWN sprint
  // from their own distance to the line (below), so trailing bikes charge too.
  const distToFinishLeader = finish - leaderX;
  const finalStretch = distToFinishLeader < distance * 0.2 || progress > 0.8;
  arena.classList.toggle("final-sprint", state.running && finalStretch);

  // Tempo governor — keeps the race length matched to the timer. We compare the
  // leader's progress to where the eased time-schedule says it should be, then
  // scale the entire field by one factor. Because it's uniform it never bunches
  // the pack; it just stretches the whole race to fill the chosen duration so a
  // 30s race lasts ~30s and the winner crosses as the clock hits zero.
  const timeFrac = clamp(progress, 0, 1);
  const leaderFrac = clamp((leaderX - RACE_START_X) / distance, 0, 1);
  const schedule = Math.pow(timeFrac, RACE_SCHEDULE_EXP);
  const tempo = clamp(1 - (leaderFrac - schedule) * RACE_TEMPO_GAIN, 0.85, 1.8);

  let raceFinisher = null;
  let raceFinishTime = Infinity;
  const ranked = [...state.racers].sort((a, b) => b.x - a.x);
  const ranks = new Map(ranked.map((racer, index) => [racer, index]));

  state.racers.forEach((racer) => {
    const rank = ranks.get(racer) || 0;
    const rankRatio = state.racers.length <= 1 ? 0 : rank / (state.racers.length - 1);

    // Each bike judges its OWN run to the line, so a bike 2nd or 3rd still
    // throws everything at the finish instead of waiting on the leader's clock.
    const myDistToFinish = Math.max(0, finish - racer.x);
    const sprinting = myDistToFinish < distance * 0.24 || progress > 0.78;
    const homeStretch = myDistToFinish < distance * 0.09 || progress > 0.93;

    // --- personality events: surges and dips that shuffle the running order ---
    racer.eventTimer -= delta;
    if (racer.eventTimer <= 0) {
      const hungry = sprinting && rank > 0;
      const attackChance = hungry ? 0.9 : 0.45 + rankRatio * 0.3;
      if (Math.random() < attackChance) {
        racer.attackTarget = 0.3 + Math.random() * (hungry ? 1.2 : 0.7);
        racer.slumpTarget = Math.random() < 0.16 ? 0.06 + Math.random() * 0.14 : 0;
      } else {
        racer.attackTarget = 0;
        racer.slumpTarget = 0.2 + Math.random() * (racer.collapseRisk > 0.55 ? 0.6 : 0.4);
      }
      // A leader can ease off ONLY mid-race, so the lead changes hands. Once the
      // sprint is on, the leader fights flat-out — no easing, no waiting.
      if (rank === 0 && !sprinting && Math.random() < 0.3) {
        racer.slumpTarget += 0.18 + Math.random() * 0.3;
        racer.attackTarget *= 0.6;
      }
      racer.eventTimer = sprinting ? 0.3 + Math.random() * 0.6 : 0.6 + Math.random() * 1.4;
    }

    racer.surgeTimer -= delta;
    if (racer.surgeTimer <= 0) {
      racer.nextSurge = (Math.random() - 0.48) * racer.volatility * (sprinting ? 0.4 : 0.26);
      racer.traffic = !sprinting && Math.random() < 0.2 ? Math.random() : 0;
      racer.surgeTimer = sprinting ? 0.22 + Math.random() * 0.5 : 0.35 + Math.random() * 1.0;
    }

    racer.nitroCooldown -= delta;
    if (racer.nitroCooldown <= 0) {
      const chance = (sprinting ? 0.6 : 0.3) + rankRatio * 0.4;
      // Chasers attack with nitro; the leader is allowed to answer on the line.
      if ((rank > 0 || homeStretch) && Math.random() < chance) {
        racer.nitro = 1;
        if (state.announcements.length < 2 && (sprinting || Math.random() < 0.3)) {
          addAnnouncement(`${racer.name} HITS THE NITRO!`, racer.color || "#fff", 1.4);
        }
      }
      racer.nitroCooldown = sprinting ? 1.0 + Math.random() * 1.7 : 2.4 + Math.random() * 3.6;
    }
    racer.nitro = Math.max(0, racer.nitro - delta * 0.6);

    racer.attack += (racer.attackTarget - racer.attack) * Math.min(1, delta * (sprinting ? 3.8 : 2.2));
    racer.slump += (racer.slumpTarget - racer.slump) * Math.min(1, delta * (sprinting ? 3.4 : 1.9));
    racer.surge += (racer.nextSurge - racer.surge) * Math.min(1, delta * (sprinting ? 5.5 : 3.8));
    racer.burst += (Math.random() - 0.5) * racer.volatility * (sprinting ? 1.7 : 1.1) * delta;
    racer.burst = clamp(racer.burst, sprinting ? -0.2 : -0.18, sprinting ? 0.32 : 0.24);
    racer.raceOffset += (Math.random() - 0.5) * racer.volatility * (sprinting ? 90 : 80) * delta;
    racer.fieldBias += (Math.random() - 0.48) * racer.volatility * 0.02 * delta;
    racer.fieldBias = clamp(racer.fieldBias, -0.03, 0.034);
    const offsetLimit = distance * (sprinting ? 0.02 : 0.034);
    racer.raceOffset = clamp(racer.raceOffset, -offsetLimit, offsetLimit);

    const gapToLeader = Math.max(0, leaderX - racer.x);
    const wave = Math.sin(state.raceTime * racer.waveFreq * Math.PI * 2 + racer.wavePhase) * racer.waveAmp
      + Math.sin(state.raceTime * racer.wave2Freq * Math.PI * 2 + racer.wave2Phase) * 0.12;
    const nitroBoost = racer.nitro * 0.9;
    const personality = racer.fieldBias * 0.9;

    // Core multiplier, centred near RACE_PACE so the whole race lasts ~duration.
    let mult = racer.paceBias * RACE_PACE + personality + racer.attack - racer.slump * 0.8
      + racer.surge + racer.burst + wave * 0.6 + nitroBoost;

    if (!sprinting) {
      // Gentle rubber band: trailing bikes claw back so the lead keeps changing
      // and the pack stays in contention. It FADES OUT before the sprint, so it
      // never compresses everyone into a frozen blob at the line.
      const gapFactor = clamp(gapToLeader / (distance * 0.16), 0, 1);
      const fade = clamp(1 - progress / 0.78, 0, 1);
      mult += gapFactor * 0.5 * drama * racer.clutch * fade;
      mult -= racer.traffic * 0.16 * racer.drag;
    } else {
      // HOME STRAIGHT: throttles open, the hungriest bikes dig deepest, gaps
      // OPEN instead of closing — a real drag to the flag, nobody coasting.
      const ramp = clamp(1 - myDistToFinish / (distance * 0.24), 0, 1);
      const hunger = racer.finishHunger * (0.55 + racer.closingKick * 0.7);
      mult += ramp * (0.45 + hunger * 0.9);
      if (homeStretch) mult += ramp * (0.25 + racer.finishHunger * 0.45);
    }

    // Speed floor stays HIGH during the sprint so no bike ever crawls or waits.
    mult = clamp(mult, sprinting ? 0.95 : 0.32, sprinting ? 3.7 : 2.6);
    const speed = basePace * mult * tempo;
    racer.speed = speed;
    racer.currentKmh += (clamp(racer.cruiseKmh * (speed / basePace), 70, sprinting ? 540 : 430) - racer.currentKmh) * Math.min(1, delta * 4.4);
    racer.bob += delta * (14 + speed / 18);
    racer.stride += delta * (22 + speed / 9);
    racer.mane += delta * (10 + speed / 22);
    const rawNextX = racer.x + speed * delta;
    if (rawNextX >= finish && racer.x < finish && speed > 0) {
      const t = (finish - racer.x) / speed;
      if (t < raceFinishTime) { raceFinishTime = t; raceFinisher = racer; }
    }
    racer.x = Math.min(finish, rawNextX);

    racer.dustTimer -= delta;
    if (racer.dustTimer <= 0) {
      spawnDust(racer);
      racer.dustTimer = 0.026 + Math.random() * 0.035;
    }
  });

  state.dust = state.dust.filter((particle) => {
    particle.life -= delta;
    particle.x -= particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.size += 15 * delta;
    return particle.life > 0;
  });

  state.confetti = state.confetti.filter((piece) => {
    piece.life -= delta;
    piece.y += piece.vy * delta;
    piece.x += Math.sin(piece.life * 8) * 1.6;
    piece.rotation += delta * piece.spin;
    return piece.life > 0;
  });

  const leader = state.racers.reduce((best, racer) => racer.x > best.x ? racer : best, state.racers[0]);
  if (!raceFinisher && state.raceTime >= state.raceDuration + 3) raceFinisher = leader;
  const target = (leader?.x || 0) - canvas.width * 0.55;
  state.cameraX += (target - state.cameraX) * Math.min(1, delta * 3.5);
  state.cameraX = clamp(state.cameraX, 0, Math.max(0, finishX() - canvas.width * 0.86));

  state.announcements = state.announcements.filter((a) => {
    a.life -= delta;
    return a.life > 0;
  });

  state.leadChangeCooldown = Math.max(0, state.leadChangeCooldown - delta);
  if (leader && state.prevLeaderId !== null && leader.id !== state.prevLeaderId
      && state.raceTime > 1.5 && state.leadChangeCooldown <= 0 && !raceFinisher) {
    addAnnouncement(`${leader.name} TAKES THE LEAD!`, leader.color || "#fff", 1.7);
    state.shake = Math.max(state.shake, 6);
    state.leadChangeCooldown = 1.6;
  }
  if (leader) state.prevLeaderId = leader.id;

  if (finalStretch && !state.finalStretchAnnounced) {
    state.finalStretchAnnounced = true;
    addAnnouncement("FINAL STRETCH!", BYBLOS_GOLD, 1.8);
  }

  // Photo finish: a brief, LIGHT slow-mo (never below ~0.74x) reserved for a
  // genuine blanket finish in the last few metres, and it snaps back fast. The
  // old code dropped to 0.35x on a loose pack and lingered — that was the
  // "bikes freeze and wait for each other" feeling. Gone now.
  const podium = leadersByDistance(2);
  const lead = podium[0];
  const gap = podium.length > 1 ? podium[0].x - podium[1].x : 9999;
  const photoFinish = lead && (finish - lead.x) < 240 && (finish - lead.x) > 0
    && gap < 36 && !raceFinisher;
  const targetSlow = photoFinish ? 0.74 : 1;
  if (photoFinish && !state.photoFinishAnnounced) {
    state.photoFinishAnnounced = true;
    addAnnouncement("PHOTO FINISH!", "#ff5470", 2.2);
  }
  state.slowMo += (targetSlow - state.slowMo) * Math.min(1, delta * 9);

  if (finalStretch) state.shake = Math.max(state.shake, 1.8);
  state.shake = Math.max(0, state.shake - delta * 12);

  return raceFinisher;
}

function addAnnouncement(text, color, duration = 1.5) {
  state.announcements.push({ text, color, life: duration, total: duration });
  if (state.announcements.length > 3) state.announcements.shift();
}

function leaderByDistance() {
  return state.racers.reduce((best, racer) => racer.x > best.x ? racer : best, state.racers[0]);
}

function leadersByDistance(count) {
  return [...state.racers].sort((a, b) => b.x - a.x).slice(0, count);
}

function spawnDust(racer) {
  const screen = worldToScreen(racer.x - 102, racer.y + 26 * racer.scale);
  state.dust.push({
    x: screen.x,
    y: screen.y,
    vx: 90 + Math.random() * 120,
    vy: -16 + Math.random() * 18,
    size: 10 + Math.random() * 14,
    life: 0.4 + Math.random() * 0.26,
  });
}

function finishRace(winner) {
  state.running = false;
  state.paused = false;
  state.finished = true;
  winner.x = finishX();
  state.racePositions = leadersByDistance(state.racers.length);
  makeConfetti();
  const raceMode = state.currentRaceMode;
  const tournamentMessage = finishTournamentRound(winner);
  if (!tournamentMessage) showPodiumMessage();
  if (raceMode === "normal" || raceMode === "tournament_final") recordWinner(winner);
  renderControls();
  drawRace();
}

function showPodiumMessage() {
  const podium = leadersByDistance(Math.min(3, state.racers.length));
  const medals = ["🥇", "🥈", "🥉"];
  winnerStage.textContent = "Finish Order";
  winnerName.textContent = podium[0]?.name ?? "";
  const list = document.getElementById("podiumList");
  if (list) {
    list.innerHTML = podium.map((racer, i) =>
      `<li><span class="podium-medal">${medals[i] ?? `${i + 1}.`}</span><span class="podium-name">${escapeHtml(racer.name)}</span></li>`
    ).join("");
  }
  winnerBanner.hidden = false;
}

function finishTournamentRound(winner) {
  const tournament = state.tournament;
  if (!tournament?.active) return null;

  if (tournament.finalStarted) {
    tournament.complete = true;
    showMessage("Tournament Winner", winner.name);
    return "final";
  }

  const qualifiers = leadersByDistance(Math.min(state.tournamentQualifiers, state.racers.length));
  tournament.finalists.push(...qualifiers.map((racer) => {
    const match = state.currentParticipants.find((restaurant) => restaurant.id === racer.id);
    return match || racer;
  }));
  tournament.heatIndex += 1;

  const names = qualifiers.map((racer) => racer.name).join(", ");
  const nextIsFinal = tournament.heatIndex >= tournament.heats.length;
  showMessage(nextIsFinal ? "Final Ready" : `Top ${state.tournamentQualifiers} Advance`, names);
  return "heat";
}

function makeConfetti() {
  state.confetti = Array.from({ length: 170 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * 160,
    vy: 90 + Math.random() * 120,
    rotation: Math.random() * Math.PI,
    spin: -7 + Math.random() * 14,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    life: 2.2 + Math.random() * 1.3,
  }));
}

async function recordWinner(winner) {
  if (state.savingWinner) return;
  if (state.currentRaceMode === "tournament_heat") return;
  if (state.currentRaceMode === "tournament_final" && !state.tournament?.complete) return;
  state.savingWinner = true;
  try {
    const participants = state.currentParticipants.length ? state.currentParticipants : state.restaurants;
    const participantIds = [...new Set(participants.map((restaurant) => restaurant.id))];
    const positions = state.racePositions.map((r) => ({ id: r.id, name: r.name }));
    const payload = await api("/api/races", {
      method: "POST",
      body: JSON.stringify({ winner_id: winner.id, participant_ids: participantIds, positions_json: JSON.stringify(positions) }),
    });
    if (!state.tournament?.active || state.tournament.complete) state.activeTab = "history";
    applyServerState(payload);
    if (!state.tournament?.active) showMessage("Lunch Winner Saved", winner.name);
  } catch (error) {
    showMessage("Winner not saved", error.message);
  } finally {
    state.savingWinner = false;
  }
}

async function saveGroupRatings(raceId) {
  const drafts = state.ratingDrafts.get(raceId) || [];
  if (!drafts.length) {
    setRatingStatus(raceId, "Add at least one rating first", "error");
    return;
  }
  if (state.savingRatingId) return;
  state.savingRatingId = raceId;
  setRatingStatus(raceId, "Saving…", "");
  try {
    const payload = await api(`/api/races/${raceId}/group-rating`, {
      method: "POST",
      body: JSON.stringify({ ratings: drafts }),
    });
    state.ratingDrafts.delete(raceId);
    applyServerState(payload);
  } catch (error) {
    setRatingStatus(raceId, `Error: ${error.message}`, "error");
  } finally {
    state.savingRatingId = null;
  }
}

function setRatingStatus(raceId, message, type) {
  const el = document.getElementById(`ratingStatus${raceId}`);
  if (!el) return;
  el.textContent = message;
  el.className = `rating-status${type ? ` rating-status-${type}` : ""}`;
}

function addDraftEntry(raceId, nameInput, valInput) {
  const name = (nameInput.value || "").trim();
  const raw = parseFloat(valInput.value);
  if (!name) { nameInput.focus(); return; }
  if (!Number.isFinite(raw) || raw < 1 || raw > 5) { valInput.focus(); return; }
  const rounded = Math.round(raw * 2) / 2;
  const current = state.ratingDrafts.get(raceId) || [];
  current.push({ name, rating: rounded });
  state.ratingDrafts.set(raceId, current);
  nameInput.value = "";
  valInput.value = "";
  nameInput.focus();
  refreshRatingForm(raceId, current);
}

function refreshRatingForm(raceId, drafts) {
  const container = document.getElementById(`ratingEntries${raceId}`);
  const avgEl = document.getElementById(`ratingAvg${raceId}`);
  if (!container) return;
  container.innerHTML = "";
  if (!drafts || !drafts.length) {
    const empty = document.createElement("span");
    empty.className = "rating-empty";
    empty.textContent = "No ratings yet — add names above.";
    container.append(empty);
  } else {
    drafts.forEach(({ name, rating }, index) => {
      const row = document.createElement("div");
      row.className = "rating-entry";
      row.innerHTML = `
        <span class="rating-entry-name">${escapeHtml(name)}</span>
        <span class="rating-entry-val">${Number(rating).toFixed(1)} / 5</span>
        <button class="rating-entry-remove" type="button" aria-label="Remove">✕</button>
      `;
      row.querySelector(".rating-entry-remove").addEventListener("click", () => {
        const list = state.ratingDrafts.get(raceId) || [];
        list.splice(index, 1);
        state.ratingDrafts.set(raceId, list);
        refreshRatingForm(raceId, list);
      });
      container.append(row);
    });
  }
  if (avgEl) {
    if (drafts && drafts.length) {
      const avg = drafts.reduce((s, { rating }) => s + rating, 0) / drafts.length;
      avgEl.textContent = `Average: ${avg.toFixed(2)} / 5`;
    } else {
      avgEl.textContent = "";
    }
  }
}

function showMessage(stage, name) {
  winnerStage.textContent = stage;
  winnerName.textContent = name;
  const list = document.getElementById("podiumList");
  if (list) list.innerHTML = "";
  winnerBanner.hidden = false;
}

function renderEntries() {
  entriesList.innerHTML = "";
  state.restaurants.forEach((restaurant) => {
    const item = document.createElement("li");
    item.className = "entry-item";
    const pinned = Boolean(restaurant.logo_pinned);
    const count = Math.max(1, restaurant.entries_count || 1);
    item.innerHTML = `
      <span class="entry-color" style="background:${restaurant.color}"></span>
      <span class="entry-name">${escapeHtml(restaurant.name)}</span>
      <span class="entry-count" title="Riders in the race">
        <button class="count-btn count-minus" type="button" aria-label="One rider less"${count <= 1 ? " disabled" : ""}>−</button>
        <strong>${count}</strong>
        <button class="count-btn count-plus" type="button" aria-label="One rider more"${count >= 9 ? " disabled" : ""}>+</button>
      </span>
      <button class="entry-pin${pinned ? " pinned" : ""}" type="button" title="${pinned ? "Picture confirmed — click to unlock" : "Picture is correct — lock it"}" aria-label="Confirm picture">${pinned ? "🔒" : "✓"}</button>
      <button class="entry-bad" type="button" title="Picture is wrong — choose another" aria-label="Picture is wrong">✕</button>
      <button class="entry-upload" type="button" title="Upload your own picture" aria-label="Upload picture">⬆</button>
      <button class="entry-remove" type="button" title="Remove ${escapeHtml(restaurant.name)}" aria-label="Remove ${escapeHtml(restaurant.name)}">X</button>
    `;
    item.querySelector(".count-minus").addEventListener("click", () => changeEntryCount(restaurant.id, -1));
    item.querySelector(".count-plus").addEventListener("click", () => changeEntryCount(restaurant.id, 1));
    item.querySelector(".entry-pin").addEventListener("click", async () => {
      try {
        applyServerState(await api("/api/logo-pin", {
          method: "POST",
          body: JSON.stringify({ name: restaurant.name }),
        }));
        refreshLogo(restaurant.name);
      } catch (error) {
        showMessage("Could not lock picture", error.message);
      }
    });
    item.querySelector(".entry-bad").addEventListener("click", () => openLogoPicker(restaurant));
    item.querySelector(".entry-upload").addEventListener("click", () => pickUploadFile(restaurant));
    item.querySelector(".entry-remove").addEventListener("click", () => removeRestaurant(restaurant.id));
    entriesList.append(item);
  });
}

async function openLogoPicker(restaurant) {
  closeLogoPicker();
  const overlay = document.createElement("div");
  overlay.className = "logo-picker-overlay";
  overlay.id = "logoPickerOverlay";
  overlay.innerHTML = `
    <div class="logo-picker">
      <header>
        <strong>Pick a photo for ${escapeHtml(restaurant.name)}</strong>
        <button class="logo-picker-close" type="button" aria-label="Close">✕</button>
      </header>
      <div class="logo-picker-grid" id="logoPickerGrid">
        <span class="logo-picker-status">Searching images…</span>
      </div>
      <footer>
        <span class="logo-picker-hint">Click an image to use it on the storefront</span>
        <div class="logo-picker-actions">
          <button class="logo-picker-upload" type="button">⬆ Upload a photo</button>
          <button class="logo-picker-none" type="button">Use letter badge</button>
        </div>
      </footer>
    </div>
  `;
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeLogoPicker();
  });
  overlay.querySelector(".logo-picker-close").addEventListener("click", closeLogoPicker);
  overlay.querySelector(".logo-picker-upload").addEventListener("click", () => pickUploadFile(restaurant));
  overlay.querySelector(".logo-picker-none").addEventListener("click", async () => {
    try {
      await api("/api/logo-choice", {
        method: "POST",
        body: JSON.stringify({ name: restaurant.name, image_url: "" }),
      });
      refreshLogo(restaurant.name);
      closeLogoPicker();
      loadState();
    } catch (error) {
      showMessage("Could not save", error.message);
    }
  });
  document.body.append(overlay);

  let candidates = [];
  try {
    const data = await api(`/api/logo-candidates?name=${encodeURIComponent(restaurant.name)}`);
    candidates = data.candidates || [];
  } catch (error) {
    const grid = overlay.querySelector("#logoPickerGrid");
    if (grid) grid.innerHTML = `<span class="logo-picker-status">Search failed: ${escapeHtml(error.message)}</span>`;
    return;
  }

  const grid = overlay.querySelector("#logoPickerGrid");
  if (!grid) return;
  grid.innerHTML = "";
  if (!candidates.length) {
    grid.innerHTML = "<span class=\"logo-picker-status\">No images found. The letter badge will be used.</span>";
    return;
  }

  candidates.forEach((item) => {
    if (!item.image) return;
    const cell = document.createElement("button");
    cell.className = "logo-picker-cell";
    cell.type = "button";
    cell.title = item.title || "";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.alt = item.title || restaurant.name;
    img.src = item.thumbnail || item.image;
    img.addEventListener("error", () => cell.remove());
    cell.append(img);
    cell.addEventListener("click", async () => {
      cell.classList.add("saving");
      try {
        await api("/api/logo-choice", {
          method: "POST",
          body: JSON.stringify({ name: restaurant.name, image_url: item.image }),
        });
        refreshLogo(restaurant.name);
        closeLogoPicker();
        loadState();
      } catch (error) {
        cell.classList.remove("saving");
        cell.classList.add("failed");
        cell.title = error.message;
      }
    });
    grid.append(cell);
  });
}

function closeLogoPicker() {
  document.getElementById("logoPickerOverlay")?.remove();
}

let logoFileInput = null;

function pickUploadFile(restaurant) {
  if (!logoFileInput) {
    logoFileInput = document.createElement("input");
    logoFileInput.type = "file";
    logoFileInput.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
    logoFileInput.style.display = "none";
    document.body.append(logoFileInput);
  }
  logoFileInput.onchange = () => {
    const file = logoFileInput.files && logoFileInput.files[0];
    logoFileInput.value = "";
    if (file) uploadLogo(restaurant, file);
  };
  logoFileInput.click();
}

async function uploadLogo(restaurant, file) {
  try {
    const response = await fetch(`/api/logo-upload?name=${encodeURIComponent(restaurant.name)}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Upload failed.");
    applyServerState(payload);
    refreshLogo(restaurant.name);
    closeLogoPicker();
  } catch (error) {
    showMessage("Upload failed", error.message);
  }
}

function refreshLogo(name) {
  const key = restaurantLogoKey(name);
  restaurantLogoSprites.delete(key);
  const image = new Image();
  image.referrerPolicy = "no-referrer";
  image.decoding = "async";
  image.onload = drawRace;
  image.onerror = () => {
    image.dataset.failed = "1";
    drawRace();
  };
  image.src = `/api/logo?name=${encodeURIComponent(name)}&fresh=${Date.now().toString(36)}`;
  restaurantLogoSprites.set(key, image);
  drawRace();
}

function showSuggestions() {
  if (restaurantSuggestions.childElementCount) restaurantSuggestions.hidden = false;
}

function hideSuggestions() {
  restaurantSuggestions.hidden = true;
}

function renderSuggestions() {
  restaurantSuggestions.innerHTML = "";
  const seen = new Set();
  const typed = normalizeRestaurantName(restaurantInput.value);
  const matches = [];

  state.allRestaurants.forEach((restaurant) => {
    if (restaurant.hidden_suggestion) return;
    const key = normalizeRestaurantName(restaurant.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (!typed || key.includes(typed)) matches.push(restaurant);
  });

  matches.slice(0, 30).forEach((restaurant) => {
    const row = document.createElement("div");
    row.className = "suggestion-row";
    const rating = restaurant.avg_rating ? `${Number(restaurant.avg_rating).toFixed(1)} rating` : "not rated";
    row.innerHTML = `
      <button class="suggestion-pick" type="button">
        <strong>${escapeHtml(restaurant.name)}</strong>
        <span>${restaurant.wins} wins - ${rating}</span>
      </button>
      <button class="suggestion-remove" type="button" title="Hide ${escapeHtml(restaurant.name)}" aria-label="Hide ${escapeHtml(restaurant.name)}">X</button>
    `;
    row.querySelector(".suggestion-pick").addEventListener("click", () => {
      restaurantInput.value = restaurant.name;
      hideSuggestions();
      restaurantInput.focus();
    });
    row.querySelector(".suggestion-remove").addEventListener("click", async (event) => {
      event.stopPropagation();
      await hideSuggestion(restaurant.id);
    });
    restaurantSuggestions.append(row);
  });

  restaurantSuggestions.hidden = !restaurantSuggestions.childElementCount || document.activeElement !== restaurantInput;
}
function renderStats() {
  lastWinnerLabel.textContent = state.lastWinnerName ? `Last winner: ${state.lastWinnerName}` : "No winner yet";
  statsList.innerHTML = "";

  const ranked = [...state.restaurants].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.name.localeCompare(b.name);
  });

  if (!ranked.length) {
    addStatRow("No restaurants yet", "Add two restaurants and start the first race.");
    return;
  }

  ranked.forEach((restaurant) => {
    const rating = restaurant.avg_rating ? `${Number(restaurant.avg_rating).toFixed(1)} rating` : "not rated";
    addStatRow(restaurant.name, `${restaurant.wins} wins - ${restaurant.appearances} races - ${rating}`);
  });
}

function addStatRow(name, meta) {
  const row = document.createElement("div");
  row.className = "stat-row";
  row.innerHTML = `
    <strong>${escapeHtml(name)}</strong>
    <div class="stat-meta">${escapeHtml(meta)}</div>
  `;
  statsList.append(row);
}

function renderHistory() {
  historyCountLabel.textContent = `${state.history.length} ${state.history.length === 1 ? "race" : "races"}`;
  historyList.innerHTML = "";

  if (!state.history.length) {
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = "<strong>No winners yet</strong><div class=\"history-meta\">Race results and ratings show here.</div>";
    historyList.append(item);
    return;
  }

  state.history.forEach((race) => {
    const isExpanded = state.expandedRatings.has(race.id);

    if (isExpanded && !state.ratingDrafts.has(race.id)) {
      state.ratingDrafts.set(
        race.id,
        (race.ratings || []).map((r) => ({ name: r.name, rating: r.rating })),
      );
    }

    const savedCount = (race.ratings || []).length;
    const avgText = race.winner_rating
      ? `${Number(race.winner_rating).toFixed(2)} / 5${savedCount ? ` (${savedCount} ${savedCount === 1 ? "person" : "people"})` : ""}`
      : "No rating yet";

    let positionsHtml = "";
    if (race.positions_json) {
      try {
        const positions = JSON.parse(race.positions_json);
        const medals = ["🥇", "🥈", "🥉"];
        if (positions.length > 1) {
          positionsHtml = `<ol class="history-positions">${positions.slice(0, 5).map((p, i) =>
            `<li><span class="podium-medal">${medals[i] ?? `${i + 1}.`}</span>${escapeHtml(p.name)}</li>`
          ).join("")}</ol>`;
        }
      } catch (_) { /* bad JSON */ }
    }

    const item = document.createElement("article");
    item.className = "history-item";
    item.innerHTML = `
      <header>
        <strong>${escapeHtml(race.winner_name)}</strong>
        <span class="history-meta">${escapeHtml(race.race_date)}</span>
        <button class="race-delete-btn" type="button" title="Delete this race result">×</button>
      </header>
      ${positionsHtml}
      <div class="rating-row">
        <span class="rating-summary">${escapeHtml(avgText)}</span>
        <button class="rate-toggle-btn" type="button">${isExpanded ? "Close" : "Rate"}</button>
      </div>
      ${isExpanded ? `
        <div class="group-rating-form">
          <div class="rating-entries-list" id="ratingEntries${race.id}"></div>
          <div class="rating-add-row">
            <input class="rating-name-input" type="text" placeholder="Name" maxlength="30" id="ratingName${race.id}" autocomplete="off">
            <input class="rating-val-input" type="number" step="0.5" min="1" max="5" placeholder="1–5" id="ratingVal${race.id}">
            <button class="rating-add-btn" type="button">+ Add</button>
          </div>
          <div class="rating-footer">
            <span class="rating-avg-display" id="ratingAvg${race.id}"></span>
            <button class="rating-save-btn" type="button" id="ratingSave${race.id}">Save Ratings</button>
          </div>
          <span class="rating-status" id="ratingStatus${race.id}"></span>
        </div>
      ` : ""}
      <div class="history-participants">${escapeHtml(race.participants || "")}</div>
    `;

    item.querySelector(".race-delete-btn").addEventListener("click", () => deleteRace(race.id));

    item.querySelector(".rate-toggle-btn").addEventListener("click", () => {
      if (state.expandedRatings.has(race.id)) {
        state.expandedRatings.delete(race.id);
        state.ratingDrafts.delete(race.id);
      } else {
        state.expandedRatings.add(race.id);
      }
      renderHistory();
    });

    historyList.append(item);

    if (isExpanded) {
      const drafts = state.ratingDrafts.get(race.id) || [];
      refreshRatingForm(race.id, drafts);

      const nameIn = document.getElementById(`ratingName${race.id}`);
      const valIn = document.getElementById(`ratingVal${race.id}`);

      item.querySelector(".rating-add-btn").addEventListener("click", () => {
        addDraftEntry(race.id, nameIn, valIn);
      });
      [nameIn, valIn].forEach((input) => {
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") addDraftEntry(race.id, nameIn, valIn);
        });
      });

      document.getElementById(`ratingSave${race.id}`).addEventListener("click", () => {
        saveGroupRatings(race.id);
      });
    }
  });
}

function renderControls() {
  const count = state.restaurants.length;
  const riders = totalRiders();
  const tournament = state.tournament;
  arena.classList.toggle("is-racing", state.running && !state.paused);
  countLabel.textContent = riders === count
    ? `${count} ${count === 1 ? "pick" : "picks"}`
    : `${count} picks · ${riders} riders`;
  lineupSummary.textContent = tournament?.active && !tournament.complete ? tournamentSummary(tournament) : (count ? "Race Ready" : "Ready Room");
  durationPreview.textContent = formatDuration(state.raceDuration);
  highlightPreset();

  if (tournament?.active && !tournament.complete) {
    startBtn.textContent = tournamentStartLabel(tournament);
    startBtn.disabled = tournament.complete || (state.running && !state.paused);
  } else {
    startBtn.textContent = "Start Race";
    startBtn.disabled = count < 2 || (state.running && !state.paused);
  }
  pauseBtn.disabled = !state.running;
  pauseBtn.textContent = state.paused ? "Resume" : "Pause";
  tournamentBtn.disabled = count < 2 || state.running;
  tournamentBtn.textContent = tournament?.active && !tournament.complete ? "Restart Tournament" : "Tournament Mode";
  minutesInput.disabled = state.running;
  secondsInput.disabled = state.running;
  presetButtons.forEach((button) => {
    button.disabled = state.running;
  });
  qualifierButtons.forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.qualifiers) === state.tournamentQualifiers);
    button.disabled = state.running;
  });

  renderTimer();
}

function tournamentSummary(tournament) {
  if (tournament.finalStarted) return "Final Race";
  if (tournament.heatIndex >= tournament.heats.length) return "Final Ready";
  return `Heat ${tournament.heatIndex + 1}/${tournament.heats.length}`;
}

function tournamentStartLabel(tournament) {
  if (tournament.complete) return "Tournament Done";
  if (state.running && state.paused) return "Resume";
  if (tournament.finalStarted || tournament.heatIndex >= tournament.heats.length) return "Start Final";
  return `Start Heat ${tournament.heatIndex + 1}`;
}

function renderTimer() {
  const remaining = Math.max(0, state.raceDuration - state.raceTime);
  const totalSeconds = Math.floor(remaining);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor((remaining - totalSeconds) * 100);
  raceTimer.textContent = `${pad(minutes)}:${pad(seconds)}:${pad(hundredths)}`;
}

function drawRace() {
  resizeCanvas();

  ctx.save();
  if (state.shake > 0.3) {
    ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
  }
  drawWorld();

  const total = state.racers.length || state.restaurants.length;
  drawTrack(total || 5);

  if (!state.racers.length) {
    drawPreviewMotorcycles();
    drawEmptyMessage();
    ctx.restore();
    return;
  }

  drawDust();
  [...state.racers].sort((a, b) => a.y - b.y).forEach(drawMotorcycle);
  drawFinishLine();
  drawConfetti();
  ctx.restore();

  drawPhotoFinishOverlay();
  drawLeaderboard();
  drawAnnouncements();
  drawCountdown();
  drawCanvasTimer();
}

function drawPhotoFinishOverlay() {
  if (state.slowMo > 0.9) return;
  const strength = clamp((0.9 - state.slowMo) / 0.55, 0, 1);
  const grad = ctx.createRadialGradient(
    canvas.width / 2, canvas.height * 0.6, canvas.height * 0.25,
    canvas.width / 2, canvas.height * 0.6, canvas.width * 0.72,
  );
  grad.addColorStop(0, "rgba(20, 5, 40, 0)");
  grad.addColorStop(1, `rgba(20, 5, 40, ${0.5 * strength})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawLeaderboard() {
  if (!state.running || state.countdown > 0 || state.racers.length < 2) return;
  const top = leadersByDistance(Math.min(3, state.racers.length));
  const x = 18;
  const y0 = trackTop() + 16;
  top.forEach((racer, i) => {
    const y = y0 + i * 42;
    const name = racer.name.length > 18 ? `${racer.name.slice(0, 16)}…` : racer.name;
    ctx.font = "900 17px system-ui";
    const w = ctx.measureText(name).width + 72;
    ctx.fillStyle = "rgba(5, 10, 18, 0.82)";
    roundRect(x, y, w, 34, 8);
    ctx.fill();
    ctx.strokeStyle = i === 0 ? "rgba(229,193,0,0.65)" : "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = i === 0 ? BYBLOS_GOLD : "rgba(255,255,255,0.78)";
    ctx.font = "950 15px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(`P${i + 1}`, x + 11, y + 23);
    ctx.fillStyle = racer.color || "#fff";
    ctx.beginPath();
    ctx.arc(x + 46, y + 17, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "900 17px system-ui";
    ctx.fillText(name, x + 60, y + 23);
  });
}

function drawAnnouncements() {
  if (!state.announcements.length) return;
  let y = canvas.height * 0.42;
  state.announcements.forEach((a) => {
    const t = 1 - a.life / a.total;
    const alpha = a.life < 0.4 ? a.life / 0.4 : 1;
    const scale = t < 0.12 ? 0.55 + (t / 0.12) * 0.45 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(canvas.width / 2, y);
    ctx.scale(scale, scale);
    ctx.font = "950 46px system-ui";
    ctx.textAlign = "center";
    ctx.lineWidth = 9;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(5, 10, 18, 0.88)";
    ctx.strokeText(a.text, 0, 0);
    ctx.fillStyle = a.color;
    ctx.fillText(a.text, 0, 0);
    ctx.restore();
    y += 58;
  });
}

function drawCountdown() {
  if (state.countdown <= 0) return;
  const n = Math.max(1, Math.ceil(state.countdown));
  const frac = state.countdown - Math.floor(state.countdown);
  const scale = 1 + (1 - frac) * 0.45;
  const cx = canvas.width / 2;
  const cy = canvas.height * 0.3;

  ctx.save();
  ctx.fillStyle = "rgba(5, 10, 18, 0.42)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const lit = 4 - n;
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.arc(cx + (i - 1) * 78, cy, 26, 0, Math.PI * 2);
    ctx.fillStyle = i < lit ? "#ff4040" : "rgba(255,255,255,0.14)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 3;
    ctx.stroke();
    if (i < lit) {
      const glow = ctx.createRadialGradient(cx + (i - 1) * 78, cy, 6, cx + (i - 1) * 78, cy, 52);
      glow.addColorStop(0, "rgba(255, 64, 64, 0.5)");
      glow.addColorStop(1, "rgba(255, 64, 64, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx + (i - 1) * 78, cy, 52, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.font = `950 ${Math.round(120 * scale)}px system-ui`;
  ctx.textAlign = "center";
  ctx.lineWidth = 12;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(5, 10, 18, 0.9)";
  ctx.strokeText(String(n), cx, cy + 185);
  ctx.fillStyle = BYBLOS_GOLD;
  ctx.fillText(String(n), cx, cy + 185);
  ctx.restore();
}

function drawCanvasTimer() {
  if (!state.running && !state.finished) return;
  const remaining = Math.max(0, state.raceDuration - state.raceTime);
  const totalSeconds = Math.floor(remaining);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor((remaining - totalSeconds) * 100);
  const text = `${pad(minutes)}:${pad(seconds)}:${pad(hundredths)}`;
  const finalTen = remaining <= 10 && state.running;
  const fgColor = finalTen ? BYBLOS_GOLD : "#ffffff";
  const borderColor = finalTen ? "rgba(229,193,0,0.78)" : "rgba(229,193,0,0.55)";
  ctx.save();
  ctx.font = "900 32px system-ui";
  const tw = ctx.measureText(text).width;
  const bw = tw + 32;
  const bh = 50;
  const bx = (canvas.width - bw) / 2;
  const by = canvas.height - bh - 24;
  ctx.fillStyle = "rgba(5,10,18,0.82)";
  roundRect(bx, by, bw, bh, 9);
  ctx.fill();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = fgColor;
  ctx.textAlign = "center";
  ctx.fillText(text, canvas.width / 2, by + 35);
  ctx.restore();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(760, Math.floor(rect.width * scale));
  const height = Math.max(520, Math.floor(rect.height * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    state.racers.forEach((racer, index) => {
      const lane = laneGeometry(state.racers.length, index);
      racer.y = lane.y;
      racer.scale = lane.scale;
    });
  }
}

function drawWorld() {
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.46);
  sky.addColorStop(0, "#fff7d6");
  sky.addColorStop(0.54, "#efe4ff");
  sky.addColorStop(1, "#faf7ff");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawSun();
  drawCloud(canvas.width * 0.24, canvas.height * 0.15, 0.9);
  drawCloud(canvas.width * 0.78, canvas.height * 0.12, 0.72);
  drawMovingCity();
  drawRestaurantStores();
  drawRoadside();
}

function drawSun() {
  const x = canvas.width * 0.08;
  const y = canvas.height * 0.12;
  const glow = ctx.createRadialGradient(x, y, 20, x, y, 160);
  glow.addColorStop(0, "rgba(229, 193, 0, 0.38)");
  glow.addColorStop(1, "rgba(229, 193, 0, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 160, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BYBLOS_GOLD;
  ctx.beginPath();
  ctx.arc(x, y, 52, 0, Math.PI * 2);
  ctx.fill();
}

function drawCloud(x, y, scale) {
  const drift = state.running ? Math.sin(state.sceneTick * 0.22 + x * 0.001) * 12 : 0;
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.beginPath();
  ctx.ellipse(x - 48 * scale + drift, y + 18 * scale, 50 * scale, 25 * scale, 0, 0, Math.PI * 2);
  ctx.ellipse(x + drift, y, 62 * scale, 34 * scale, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 55 * scale + drift, y + 18 * scale, 50 * scale, 25 * scale, 0, 0, Math.PI * 2);
  ctx.rect(x - 64 * scale + drift, y + 13 * scale, 132 * scale, 32 * scale);
  ctx.fill();
}

function drawHills() {
  const y = trackTop() - 70;
  ctx.fillStyle = "#45a653";
  ctx.beginPath();
  ctx.moveTo(0, y + 44);
  ctx.quadraticCurveTo(canvas.width * 0.18, y - 20, canvas.width * 0.38, y + 38);
  ctx.quadraticCurveTo(canvas.width * 0.62, y + 100, canvas.width * 0.82, y + 22);
  ctx.quadraticCurveTo(canvas.width * 0.94, y - 12, canvas.width, y + 32);
  ctx.lineTo(canvas.width, trackTop());
  ctx.lineTo(0, trackTop());
  ctx.closePath();
  ctx.fill();
}

function drawMovingCity() {
  const horizon = trackTop() - 42;
  const offset = -(state.cameraX * 0.16 + state.sceneTick * 14) % 420;
  ctx.fillStyle = "#eadcf4";
  ctx.beginPath();
  ctx.moveTo(0, horizon + 28);
  ctx.quadraticCurveTo(canvas.width * 0.2, horizon - 24, canvas.width * 0.42, horizon + 20);
  ctx.quadraticCurveTo(canvas.width * 0.68, horizon + 68, canvas.width, horizon + 2);
  ctx.lineTo(canvas.width, trackTop() + 8);
  ctx.lineTo(0, trackTop() + 8);
  ctx.closePath();
  ctx.fill();

  for (let x = offset - 420; x < canvas.width + 420; x += 420) {
    drawBuilding(x + 10, horizon - 112, 70, 120, "#7a5b93");
    drawBuilding(x + 96, horizon - 72, 95, 82, "#4b1777");
    drawBuilding(x + 216, horizon - 138, 82, 148, "#9b84ad");
    drawBuilding(x + 320, horizon - 92, 64, 102, "#2a0f42");
    drawByblosBillboard(x + 168, horizon - 160);
  }
}

function drawByblosBillboard(x, y) {
  ctx.save();
  ctx.fillStyle = "rgba(42, 15, 66, 0.22)";
  ctx.beginPath();
  ctx.ellipse(x + 96, y + 72, 98, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  roundRect(x, y, 192, 58, 7);
  ctx.fill();
  ctx.strokeStyle = "rgba(75, 23, 119, 0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  if (byblosLogo.complete && byblosLogo.naturalWidth > 0) {
    const logoWidth = 162;
    const logoHeight = logoWidth * (byblosLogo.naturalHeight / byblosLogo.naturalWidth);
    ctx.drawImage(byblosLogo, x + 14, y + 11, logoWidth, logoHeight);
  } else {
    ctx.fillStyle = BYBLOS_PURPLE;
    ctx.font = "950 18px system-ui";
    ctx.textAlign = "left";
    ctx.fillText("BYBLOS BANK", x + 20, y + 34);
  }
  ctx.fillStyle = BYBLOS_PURPLE;
  ctx.font = "800 9px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("LUNCH PRIX", x + 105, y + 51);
  ctx.strokeStyle = "#5d4a22";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x + 30, y + 58);
  ctx.lineTo(x + 30, y + 88);
  ctx.moveTo(x + 162, y + 58);
  ctx.lineTo(x + 162, y + 88);
  ctx.stroke();
  ctx.restore();
}

function drawBuilding(x, y, width, height, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = "rgba(255, 238, 147, 0.62)";
  for (let row = 0; row < Math.floor(height / 28); row += 1) {
    for (let col = 0; col < Math.floor(width / 22); col += 1) {
      const flicker = state.running && Math.sin(state.sceneTick * 5 + x * 0.03 + row + col) > 0.75;
      ctx.globalAlpha = flicker ? 0.25 : 1;
      ctx.fillRect(x + 10 + col * 22, y + 12 + row * 26, 9, 12);
    }
  }
  ctx.globalAlpha = 1;
}

function drawRestaurantStores() {
  const restaurants = state.restaurants;
  if (!restaurants.length) return;

  const visibleStores = Math.min(restaurants.length, 3);
  const storeWidth = clamp(canvas.width / visibleStores - 18, 340, 520);
  const gap = 24;
  const stride = storeWidth + gap;
  const totalWidth = stride * restaurants.length;
  const height = Math.min(245, Math.max(190, trackTop() * 0.56));
  const y = Math.max(28, trackTop() - height - 8);
  const offset = -((state.cameraX * 0.32 + state.sceneTick * (state.running ? 20 : 3)) % totalWidth);

  for (let pass = -1; pass <= Math.ceil(canvas.width / totalWidth) + 1; pass += 1) {
    restaurants.forEach((restaurant, index) => {
      const x = offset + pass * totalWidth + index * stride;
      if (x > canvas.width + stride || x + storeWidth < -stride) return;
      drawStorefront(restaurant, x, y, storeWidth, height, index);
    });
  }
}

function drawStorefront(restaurant, x, y, width, height, index) {
  const accent = restaurant.color || COLORS[index % COLORS.length];
  const darkAccent = darken(accent, 0.36);
  const lightAccent = lighten(accent, 0.24);
  const facade = index % 2 === 0 ? "#f5efe4" : "#edf5f6";
  const side = index % 2 === 0 ? "#cfc2b2" : "#c4d3da";
  const glass = ctx.createLinearGradient(0, y + 78, 0, y + height - 24);
  glass.addColorStop(0, "rgba(255,255,255,0.78)");
  glass.addColorStop(0.48, "rgba(170,224,238,0.45)");
  glass.addColorStop(1, "rgba(32,55,66,0.28)");

  ctx.fillStyle = "rgba(5, 10, 18, 0.28)";
  ctx.beginPath();
  ctx.ellipse(x + width / 2, y + height + 12, width * 0.48, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = side;
  roundRect(x, y + 44, width, height - 44, 8);
  ctx.fill();
  ctx.fillStyle = facade;
  roundRect(x + 10, y + 58, width - 20, height - 66, 7);
  ctx.fill();

  const sign = ctx.createLinearGradient(x, y, x + width, y + 66);
  sign.addColorStop(0, darkAccent);
  sign.addColorStop(0.5, accent);
  sign.addColorStop(1, lightAccent);
  ctx.fillStyle = sign;
  roundRect(x + 12, y, width - 24, 66, 8);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.24)";
  ctx.fillRect(x + 24, y + 8, width - 48, 12);

  const logo = restaurantLogoImage(restaurant);
  const logoSize = Math.min(width * 0.38, height * 0.48);
  const logoX = x + (width - logoSize) / 2;
  const logoY = y + 86;
  ctx.fillStyle = "#fff";
  roundRect(logoX, logoY, logoSize, logoSize, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 3;
  ctx.stroke();

  if (logo?.complete && logo.naturalWidth > 0 && !logo.dataset.failed) {
    const pad = Math.max(14, logoSize * 0.1);
    const avail = logoSize - pad * 2;
    const aspect = logo.naturalWidth / logo.naturalHeight;
    let drawW = avail;
    let drawH = avail / aspect;
    if (drawH > avail) {
      drawH = avail;
      drawW = avail * aspect;
    }
    ctx.drawImage(logo, logoX + (logoSize - drawW) / 2, logoY + (logoSize - drawH) / 2, drawW, drawH);
  } else {
    drawLogoFallback(restaurant, logoX, logoY, logoSize, accent);
  }

  ctx.fillStyle = "#fff";
  ctx.font = "950 24px system-ui";
  ctx.textAlign = "center";
  drawClampedText(restaurant.name, x + width / 2, y + 42, width - 58, 24);

  ctx.fillStyle = glass;
  roundRect(x + 24, y + 82, Math.max(12, logoX - x - 36), height - 112, 9);
  ctx.fill();
  roundRect(logoX + logoSize + 12, y + 82, Math.max(12, x + width - logoX - logoSize - 36), height - 112, 9);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.moveTo(x + 34, y + 92);
  ctx.lineTo(logoX - 18, y + 86);
  ctx.lineTo(logoX - 40, y + 112);
  ctx.lineTo(x + 34, y + 120);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(95, 130, 145, 0.3)";
  ctx.fillRect(x + 20, y + height - 20, width - 40, 10);
  ctx.fillStyle = "rgba(5, 10, 18, 0.2)";
  ctx.fillRect(x + width * 0.46, y + height - 70, width * 0.08, 50);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillRect(x + width * 0.5 - 3, y + height - 48, 6, 6);
  ctx.fill();
}

function restaurantLogoImage(restaurant) {
  const key = restaurantLogoKey(restaurant.name);
  if (restaurantLogoSprites.has(key)) return restaurantLogoSprites.get(key);
  const image = new Image();
  image.referrerPolicy = "no-referrer";
  image.decoding = "async";
  image.onload = drawRace;
  image.onerror = () => {
    image.dataset.failed = "1";
    drawRace();
  };
  image.src = restaurantLogoUrl(restaurant.name);
  restaurantLogoSprites.set(key, image);
  return image;
}

function restaurantLogoUrl(name) {
  return `/api/logo?name=${encodeURIComponent(name)}&fresh=${LOGO_REQUEST_TOKEN}`;
}

function restaurantDomain(name) {
  const normalized = normalizeRestaurantName(name);
  return normalized || "restaurant";
}

function restaurantLogoKey(name) {
  return restaurantDomain(name).toLowerCase();
}

function normalizeRestaurantName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function drawLogoFallback(restaurant, x, y, size, accent) {
  const cx = x + size / 2;
  const cy = y + size / 2;

  const grad = ctx.createLinearGradient(x, y, x + size, y + size);
  grad.addColorStop(0, lighten(accent, 0.22));
  grad.addColorStop(1, darken(accent, 0.3));
  ctx.fillStyle = grad;
  roundRect(x + 6, y + 6, size - 12, size - 12, size * 0.16);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 2;
  roundRect(x + 12, y + 12, size - 24, size - 24, size * 0.12);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = Math.max(2.5, size * 0.022);
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.06, size * 0.27, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.font = `950 ${Math.round(size * 0.24)}px system-ui`;
  ctx.textAlign = "center";
  ctx.fillText(restaurantInitials(restaurant.name), cx, cy + size * 0.03);

  ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
  ctx.font = `800 ${Math.round(size * 0.1)}px system-ui`;
  ctx.fillText("★ ★ ★", cx, cy + size * 0.33);
}

function restaurantInitials(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function drawClampedText(text, x, y, maxWidth, fontSize) {
  const raw = String(text || "");
  let value = raw;
  while (value.length > 3 && ctx.measureText(value).width > maxWidth) {
    value = `${value.slice(0, -4)}...`;
  }
  ctx.fillText(value, x, y, maxWidth);
}

function drawRoadside() {
  const y = trackTop() - 10;
  ctx.fillStyle = "#26343a";
  ctx.fillRect(0, y, canvas.width, 16);
  ctx.fillStyle = "#d7e6ea";
  ctx.fillRect(0, y + 16, canvas.width, 8);
}

function drawGrandstands() {
  const y = trackTop() - 34;
  const offset = -(state.cameraX * 0.12) % 260;
  const cheer = state.running ? Math.sin(state.sceneTick * 6) * 2 : 0;
  for (let x = offset - 260; x < canvas.width + 260; x += 360) {
    ctx.fillStyle = "#a7b8bf";
    ctx.fillRect(x, y - 86, 210, 72);
    ctx.fillStyle = "#758992";
    ctx.fillRect(x, y - 16, 210, 16);
    ctx.fillStyle = "#4c6068";
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        ctx.beginPath();
        ctx.arc(x + 18 + col * 22, y - 62 + row * 20 + cheer, 7, Math.PI, 0);
        ctx.fill();
      }
    }
    ctx.fillStyle = COLORS[Math.abs(Math.floor(x / 360)) % COLORS.length];
    ctx.beginPath();
    ctx.moveTo(x + 14, y - 104);
    ctx.lineTo(x + 58, y - 90);
    ctx.lineTo(x + 14, y - 78);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#50616a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + 14, y - 104);
    ctx.lineTo(x + 14, y - 22);
    ctx.stroke();
  }
}

function drawRail() {
  const y = trackTop() - 14;
  ctx.strokeStyle = "#f9fff5";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(canvas.width, y);
  ctx.stroke();

  ctx.strokeStyle = "#e9f8e8";
  ctx.lineWidth = 7;
  const offset = -(state.cameraX * 0.25) % 180;
  for (let x = offset; x < canvas.width + 180; x += 180) {
    ctx.beginPath();
    ctx.moveTo(x, y - 2);
    ctx.lineTo(x, y + 54);
    ctx.stroke();
  }

  if (state.running) {
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 3;
    for (let x = -state.cameraX % 160; x < canvas.width + 160; x += 160) {
      ctx.beginPath();
      ctx.moveTo(x, y + 62);
      ctx.lineTo(x + 30, y + 50 + Math.sin(state.sceneTick * 4 + x * 0.01) * 4);
      ctx.stroke();
    }
  }

}

function drawTrack(total) {
  const top = trackTop();
  const bottom = trackBottom();
  const laneHeight = (bottom - top) / total;
  const asphalt = ctx.createLinearGradient(0, top, 0, bottom);
  asphalt.addColorStop(0, "#56435f");
  asphalt.addColorStop(0.52, "#362844");
  asphalt.addColorStop(1, "#201627");
  ctx.fillStyle = asphalt;
  ctx.fillRect(0, top, canvas.width, bottom - top);

  for (let i = 0; i < total; i += 1) {
    const laneY = top + i * laneHeight;
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.07)";
    ctx.fillRect(0, laneY, canvas.width, laneHeight + 1);

    if (i > 0) drawDashedLaneLine(laneY);
  }

  ctx.fillStyle = BYBLOS_GOLD;
  ctx.fillRect(0, top + 8, canvas.width, 5);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, top + 15, canvas.width, 3);
  ctx.fillStyle = BYBLOS_PURPLE;
  ctx.fillRect(0, bottom - 13, canvas.width, 5);

  ctx.fillStyle = "rgba(255,255,255,0.055)";
  const grainOffset = state.running ? -(state.cameraX * 2.8) % 72 : 0;
  for (let x = grainOffset - 80; x < canvas.width + 80; x += 72) {
    for (let y = top + 24; y < bottom - 24; y += 46) {
      ctx.fillRect(x + ((y * 3) % 40), y, 10, 2);
    }
  }

  const shadow = ctx.createLinearGradient(0, top, 0, bottom);
  shadow.addColorStop(0, "rgba(255,255,255,0.08)");
  shadow.addColorStop(0.5, "rgba(255,255,255,0)");
  shadow.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = shadow;
  ctx.fillRect(0, top, canvas.width, bottom - top);

  const finalSprint = state.running && state.raceDuration - state.raceTime <= 10;
  if (finalSprint) {
    const pulse = 0.34 + Math.sin(state.sceneTick * 16) * 0.1;
    ctx.fillStyle = `rgba(229, 193, 0, ${pulse})`;
    ctx.fillRect(0, top, canvas.width, 10);
    ctx.fillRect(0, bottom - 18, canvas.width, 10);
  }

  const speedOffset = state.running ? -(state.cameraX * (finalSprint ? 6.2 : 3.8) + state.sceneTick * (finalSprint ? 470 : 180)) % 240 : 0;
  for (let x = speedOffset - 260; x < canvas.width + 260; x += finalSprint ? 150 : 240) {
    ctx.fillStyle = finalSprint ? "rgba(229,193,0,0.28)" : (state.running ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.045)");
    ctx.beginPath();
    ctx.moveTo(x, bottom - 48);
    ctx.lineTo(x + (finalSprint ? 152 : 106), bottom - 54);
    ctx.lineTo(x + (finalSprint ? 108 : 76), bottom - 40);
    ctx.lineTo(x - 30, bottom - 34);
    ctx.closePath();
    ctx.fill();
  }
}

function drawDashedLaneLine(y) {
  const offset = state.running ? -(state.cameraX * 1.9 + state.sceneTick * 88) % 126 : 0;
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  for (let x = offset - 126; x < canvas.width + 126; x += 126) {
    roundRect(x, y - 2, 76, 4, 2);
    ctx.fill();
  }
}

function drawCourseMarkers(railY) {
  const markerOffset = state.running ? -(state.cameraX * 1.55 + state.sceneTick * 110) % 230 : 0;
  for (let x = markerOffset - 260; x < canvas.width + 260; x += 230) {
    const baseY = railY - 64;
    ctx.fillStyle = "rgba(5, 10, 18, 0.18)";
    ctx.beginPath();
    ctx.ellipse(x + 28, baseY + 54, 40, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ff7a21";
    ctx.beginPath();
    ctx.moveTo(x + 18, baseY + 4);
    ctx.lineTo(x + 44, baseY + 4);
    ctx.lineTo(x + 58, baseY + 56);
    ctx.lineTo(x + 4, baseY + 56);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff2df";
    ctx.fillRect(x + 13, baseY + 24, 36, 8);

    ctx.fillStyle = "#f2c94c";
    ctx.beginPath();
    ctx.moveTo(x + 94, baseY + 10);
    ctx.lineTo(x + 146, baseY + 10);
    ctx.lineTo(x + 126, baseY + 38);
    ctx.lineTo(x + 74, baseY + 38);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#171717";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + 94, baseY + 40);
    ctx.lineTo(x + 94, baseY + 72);
    ctx.moveTo(x + 126, baseY + 40);
    ctx.lineTo(x + 126, baseY + 72);
    ctx.stroke();
  }
}

function drawPreviewMotorcycles() {
  if (!state.restaurants.length) return;
  const expanded = expandEntries(state.restaurants);
  const preview = expanded.map((restaurant, index) => makeRacer(restaurant, index, expanded.length));
  preview.forEach((racer, index) => {
    racer.x = 145 + index * 8;
    racer.stride = 0.4;
    drawMotorcycle(racer);
  });
}

function drawEmptyMessage() {
  const text = state.restaurants.length < 2 ? "Add restaurant picks to reach the start line" : "Lineup ready. Start the race.";
  ctx.fillStyle = "rgba(5, 10, 18, 0.78)";
  roundRect(canvas.width / 2 - 310, canvas.height * 0.48 - 42, 620, 84, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(229, 193, 0, 0.42)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "900 28px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(text, canvas.width / 2, canvas.height * 0.48 + 10);
}

function drawDust() {
  state.dust.forEach((particle) => {
    const alpha = clamp(particle.life / 0.66, 0, 1);
    ctx.fillStyle = `rgba(190, 205, 216, ${alpha * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(particle.x, particle.y, particle.size * 2.4, particle.size * 0.86, -0.18, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawSpeedLines(racer, x, y) {
  if (!state.running) return;
  const speedFactor = clamp((racer.currentKmh || racer.cruiseKmh || 220) / 260, 0.65, 1.55);
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${0.12 + speedFactor * 0.2})`;
  ctx.lineWidth = 3 + speedFactor * 2;
  for (let index = 0; index < 6; index += 1) {
    const offset = index * 28;
    ctx.beginPath();
    ctx.moveTo(x - 170 - offset, y - 44 + index * 15);
    ctx.lineTo(x - 74 + speedFactor * 34 - offset, y - 50 + index * 15);
    ctx.stroke();
  }
  ctx.strokeStyle = `rgba(0, 210, 255,${0.08 + speedFactor * 0.08})`;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(x - 220, y + 20);
  ctx.lineTo(x - 70, y + 8);
  ctx.stroke();
  ctx.restore();
}

function drawMotorcycle(racer) {
  const screen = worldToScreen(Math.min(racer.x, finishX()), racer.y);
  const rev = state.countdown > 0 ? Math.sin(state.sceneTick * 46 + racer.lane * 2.3) * 1.6 : 0;
  const x = screen.x;
  const y = screen.y + Math.sin(racer.bob) * 1.8 * racer.scale + rev;
  const model = racer.model || MOTORCYCLE_MODELS[racer.lane % MOTORCYCLE_MODELS.length];

  drawSpeedLines(racer, x, y);
  if (racer.nitro > 0.05) drawNitroFlame(racer, x, y);
  drawRealMotorcycleImage(racer, model, x, y);
  drawNameBadge(racer, x, y);
}

function drawNitroFlame(racer, x, y) {
  const s = racer.scale;
  const n = racer.nitro;
  const flick = 0.85 + Math.random() * 0.3;
  const len = (190 + Math.random() * 70) * n * s * flick;
  const rearX = x - 150 * s;
  const fy = y + 14 * s;

  ctx.save();
  const glow = ctx.createRadialGradient(rearX, fy, 4, rearX, fy, 60 * s);
  glow.addColorStop(0, `rgba(120, 200, 255, ${0.55 * n})`);
  glow.addColorStop(1, "rgba(120, 200, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(rearX, fy, 60 * s, 0, Math.PI * 2);
  ctx.fill();

  const grad = ctx.createLinearGradient(rearX - len, fy, rearX, fy);
  grad.addColorStop(0, "rgba(255, 150, 0, 0)");
  grad.addColorStop(0.55, `rgba(255, 150, 30, ${0.55 * n})`);
  grad.addColorStop(0.85, `rgba(255, 220, 90, ${0.75 * n})`);
  grad.addColorStop(1, `rgba(140, 215, 255, ${0.9 * n})`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(rearX, fy - 13 * s);
  ctx.lineTo(rearX - len, fy + (Math.random() - 0.5) * 14 * s);
  ctx.lineTo(rearX, fy + 13 * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRealMotorcycleImage(racer, model, x, y) {
  const image = motorcycleImage(model);
  const scale = racer.scale;
  const boxWidth = 305 * scale;
  const boxHeight = 162 * scale;
  const lean = state.running ? -0.04 + Math.sin(racer.stride) * 0.008 : -0.025;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean);
  ctx.translate(-x, -y);

  ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
  ctx.beginPath();
  ctx.ellipse(x + boxWidth * 0.02, y + boxHeight * 0.2, boxWidth * 0.43, boxHeight * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();

  if (image?.complete && image.naturalWidth > 0) {
    const imageAspect = image.naturalWidth / image.naturalHeight;
    const boxAspect = boxWidth / boxHeight;
    const width = imageAspect > boxAspect ? boxWidth : boxHeight * imageAspect;
    const height = imageAspect > boxAspect ? boxWidth / imageAspect : boxHeight;
    const drawX = x - width * 0.52;
    const drawY = y - height * 0.62;
    if (model.flip) {
      ctx.save();
      ctx.translate(drawX + width, drawY);
      ctx.scale(-1, 1);
      ctx.drawImage(image, 0, 0, width, height);
      ctx.restore();
    } else {
      ctx.drawImage(image, drawX, drawY, width, height);
    }
    drawMotorcyclePlate(model, drawX, drawY, width, height);
  } else {
    drawMotorcycleLoading(model, x - boxWidth * 0.52, y - boxHeight * 0.62, boxWidth, boxHeight);
  }

  ctx.restore();
}

function motorcycleImage(model) {
  if (!model?.image) return null;
  if (motorcycleSprites.has(model.key)) return motorcycleSprites.get(model.key);
  const image = new Image();
  image.referrerPolicy = "no-referrer";
  image.decoding = "async";
  image.onload = drawRace;
  image.onerror = drawRace;
  image.src = model.image;
  motorcycleSprites.set(model.key, image);
  return image;
}

function drawMotorcyclePlate(model, x, y, width, height) {
  ctx.fillStyle = "rgba(5, 10, 18, 0.82)";
  roundRect(x + width * 0.31, y + height * 0.04, width * 0.38, 22, 6);
  ctx.fill();
  ctx.strokeStyle = model.primary;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "950 12px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(model.label, x + width * 0.5, y + height * 0.04 + 15);
}

function drawMotorcycleLoading(model, x, y, width, height) {
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
  ctx.font = "950 12px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(model.label, x + width / 2, y + height * 0.56);
  ctx.restore();
}

function drawNameBadge(racer, x, y) {
  const many = state.restaurants.length > 10;
  const max = many ? 18 : 24;
  const name = racer.name.length > max ? `${racer.name.slice(0, max - 3)}...` : racer.name;
  const fontSize = many ? 16 : 21;
  const showSpeed = state.running && state.restaurants.length <= 8 && Number.isFinite(racer.currentKmh);
  const speedText = showSpeed ? `${racer.currentKmh.toFixed(1)} km/h` : "";
  ctx.font = `900 ${fontSize}px system-ui`;
  const nameWidth = ctx.measureText(name).width;
  ctx.font = "800 12px system-ui";
  const speedWidth = showSpeed ? ctx.measureText(speedText).width : 0;
  const width = Math.min(320, Math.max(nameWidth, speedWidth) + 32);
  const tagX = clamp(x + 54 * racer.scale, 10, canvas.width - width - 10);
  const tagY = y - 28 * racer.scale;
  const height = fontSize + (showSpeed ? 36 : 20);

  ctx.save();
  ctx.shadowColor = racer.color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = "rgba(5, 10, 18, 0.96)";
  roundRect(tagX, tagY, width, height, 8);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = racer.color;
  roundRect(tagX, tagY, 6, height, 8);
  ctx.fill();

  ctx.strokeStyle = racer.color;
  ctx.lineWidth = 2.5;
  roundRect(tagX, tagY, width, height, 8);
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.font = `900 ${fontSize}px system-ui`;
  ctx.fillText(name, tagX + 16, tagY + fontSize + 5);
  if (showSpeed) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
    ctx.font = "800 12px system-ui";
    ctx.fillText(speedText, tagX + 16, tagY + fontSize + 22);
  }
  ctx.restore();
}

function drawFinishLine() {
  const x = worldToScreen(finishX(), 0).x;
  const top = trackTop() - 10;
  const bottom = trackBottom() + 12;
  const square = 18;
  const pulse = state.running ? Math.sin(state.sceneTick * 10) * 2 : 0;
  for (let y = top; y < bottom; y += square) {
    ctx.fillStyle = Math.floor((y - top) / square) % 2 === 0 ? "#fff" : "#111";
    ctx.fillRect(x, y, square, square);
  }
  ctx.fillStyle = "#111";
  ctx.fillRect(x + square, top, 8, bottom - top);
  ctx.fillStyle = "#fff";
  roundRect(x - 46, top - 40 - pulse, 108, 28, 6);
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.font = "900 16px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("FINISH", x + 8, top - 20 - pulse);
}

function drawConfetti() {
  state.confetti.forEach((piece) => {
    ctx.save();
    ctx.translate(piece.x, piece.y);
    ctx.rotate(piece.rotation);
    ctx.fillStyle = piece.color;
    ctx.fillRect(-4, -7, 8, 14);
    ctx.restore();
  });
}

function trackTop() {
  return canvas.height * 0.34;
}

function trackBottom() {
  return canvas.height;
}

function laneGeometry(total, index) {
  const top = trackTop() + 10;
  const bottom = trackBottom() - 18;
  const laneHeight = (bottom - top) / Math.max(1, total);
  const center = top + laneHeight * index + laneHeight / 2;
  const depth = total <= 1 ? 1 : index / (total - 1);
  const scale = clamp(laneHeight / 172, 0.28, 0.62) + depth * 0.06;
  return { y: center, scale };
}

function worldToScreen(x, y) {
  return { x: x - state.cameraX + 118, y };
}

function finishX() {
  return RACE_START_X + raceDistance();
}

function raceDistance() {
  return Math.max(MIN_TRACK_DISTANCE, state.raceDuration * TRACK_PIXELS_PER_SECOND);
}

function dramaLevel() {
  return 2.0;
}

function syncDurationFromInputs() {
  // Update state only while the user is typing — never rewrite the input
  // boxes mid-keystroke (that was overwriting whatever you typed).
  const minutes = clamp(Number(minutesInput.value) || 0, 0, 9);
  const seconds = clamp(Number(secondsInput.value) || 0, 0, 599);
  state.raceDuration = clamp(Math.round(minutes * 60 + seconds), 10, 9 * 60 + 59);
  renderControls();
}

function applyDuration(totalSeconds) {
  const normalized = clamp(Math.round(totalSeconds), 10, 9 * 60 + 59);
  const minutes = Math.floor(normalized / 60);
  const seconds = normalized % 60;
  state.raceDuration = normalized;
  minutesInput.value = String(minutes);
  secondsInput.value = String(seconds);
  renderControls();
}

function highlightPreset() {
  presetButtons.forEach((button) => {
    const active = Number(button.dataset.duration || 0) === state.raceDuration;
    button.classList.toggle("active", active);
  });
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${pad(minutes)}:${pad(seconds)}`;
}

function shuffled(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function chunked(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function balancedHeats(items, maxSize) {
  const heatCount = Math.ceil(items.length / maxSize);
  const baseSize = Math.floor(items.length / heatCount);
  let extra = items.length % heatCount;
  const heats = [];
  let index = 0;

  for (let heat = 0; heat < heatCount; heat += 1) {
    const size = baseSize + (extra > 0 ? 1 : 0);
    heats.push(items.slice(index, index + size));
    index += size;
    extra -= 1;
  }

  return heats;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function darken(hex, amount) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const mix = (value) => Math.max(0, Math.round(value * (1 - amount)));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function lighten(hex, amount) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const mix = (value) => Math.min(255, Math.round(value + (255 - value) * amount));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[char]);
}

function roundRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

window.addEventListener("resize", drawRace);
drawRace();
// build: 20260618-timelock
