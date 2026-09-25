"use strict";

/* =========================================================================
   Foodie Pick — a static, browser-only lunch decider.
   Everything is saved to localStorage, so it runs on any static host.
   ========================================================================= */

const STORE_KEY = "foodiepick:v2";
const MAX_TICKETS = 5;
const MAX_RACE_LANES = 16;

const PALETTE = [
  "#ff5a36", "#ffb400", "#22a867", "#e0457b", "#4c6fff", "#ff8a1f",
  "#8e5cf7", "#14b8a6", "#b5651d", "#8bc34a", "#f0507a", "#2f9bd6",
];

const EMOJIS = [
  "🍕", "🍔", "🌯", "🥙", "🍗", "🥪", "🍟", "🌮", "🍣", "🍜", "🍝", "🥗",
  "🍖", "🥩", "🫓", "🧆", "🍱", "🥘", "🍛", "🥟", "🌭", "🧀", "🍩", "☕",
  "🥞", "🍳", "🥐", "🍦", "🐔", "🐐", "🔥", "🌶️", "🧄", "🍋", "🥑", "🍤",
];

// Emoji guesses from the restaurant name. First match wins.
const EMOJI_RULES = [
  [/pizz|montana|napoli/i, "🍕"],
  [/burger|goat|cheese on top|roadster|diner|smash/i, "🍔"],
  [/tawo+[kl]|tawouk|shawarma|shawerma|doner|donner|kebab|wrap/i, "🌯"],
  [/farr?o+u?j|chicken|birdy|broast|crispy|crunch|wings?/i, "🍗"],
  [/sushi|maki|japan/i, "🍣"],
  [/noodle|ramen|wok|chinese|thai|asian/i, "🍜"],
  [/pasta|italian|trattoria/i, "🍝"],
  [/taco|mexican|burrito/i, "🌮"],
  [/salad|green|healthy|vegan/i, "🥗"],
  [/grill|bbq|barbecue|meat|lahm|steak/i, "🍖"],
  [/basterma|sujuk|soujouk/i, "🥩"],
  [/manou?ch|manaki|zaatar|za'atar|furn|bakery|fatay/i, "🫓"],
  [/falafel|foul|fool/i, "🧆"],
  [/sandwich|sub|noss/i, "🥪"],
  [/coffee|caf[eé]|brown|starbucks/i, "☕"],
  [/sweet|dessert|donut|crepe|waffle/i, "🍩"],
  [/hot ?dog/i, "🌭"],
];

// Spots this team has raced before. Offered as one-tap suggestions.
const TEAM_FAVES = [
  "Malak al Tawook", "Sandwich w Noss", "Atyab Farrouj", "Crunchyz",
  "Jammal", "Chez Patou", "Al Abdallah", "Pizzanini", "Mr Brown",
  "Basterma Mano", "Hayat Doner", "Grill Gate", "The Goat", "Birdy Fam",
  "Cheese on Top", "Roadster Diner", "Pizza Montana", "Classic Pizza Joint",
  "Farrouj l Shames", "Al Qaysar", "Matar",
];

const TAGLINES = [
  "Where are we eating today?",
  "Hangry? We've got you.",
  "Democracy, but tastier.",
  "Ending “I don't mind, you choose” since today.",
  "Let fate season your lunch.",
  "No more 20-minute debates.",
];

const WIN_QUIPS = [
  "Stretchy pants recommended.",
  "Your stomach has been heard.",
  "No take-backs. Okay, maybe one.",
  "Somebody call ahead!",
  "A delicious decision, if we say so ourselves.",
  "The crowd goes wild. The crowd is hungry.",
  "Chef's kiss. 🤌",
];

const VETO_QUIPS = [
  "Veto #{n}… someone's picky 👀",
  "Veto #{n}. The wheel is getting tired.",
  "Veto #{n}. Lunch break is ticking ⏰",
];

const MODE_INFO = {
  wheel: {
    hint: "Classic spin. More chances = bigger slice.",
    go: "🎡 Spin the wheel!",
    busy: "Spinning…",
  },
  race: {
    hint: "Every spot gets a racer. First one to the plate wins!",
    go: "🏁 Start the race!",
    busy: "Racing…",
  },
  knockout: {
    hint: "Each spin knocks one out. Last bite standing wins.",
    go: "🥊 Start knockout!",
    busy: "Knocking out…",
  },
};

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- Persistence ---------------- */

function defaultStore() {
  return {
    restaurants: [],
    history: [],
    settings: { mode: "wheel", sound: true, noRepeat: false, bias: false, raceLen: 20, theme: null },
    team: null,
    nick: "",
  };
}

function loadStore() {
  const base = defaultStore();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return base;
    const data = JSON.parse(raw);
    return {
      restaurants: Array.isArray(data.restaurants) ? data.restaurants : [],
      history: Array.isArray(data.history) ? data.history : [],
      settings: { ...base.settings, ...(data.settings || {}) },
      team: data.team && data.team.id ? data.team : null,
      nick: typeof data.nick === "string" ? data.nick : "",
    };
  } catch (_) {
    return base;
  }
}

function saveStore() {
  try {
    // In team mode the lists come from the server; keep the personal ones on disk.
    const lists = store.solo || store;
    const out = { ...store, restaurants: lists.restaurants, history: lists.history, solo: undefined };
    localStorage.setItem(STORE_KEY, JSON.stringify(out));
  } catch (_) { /* private mode or storage full: app still works this session */ }
}

const store = loadStore();

// Filled in by team.js when shared Teams are configured.
const hooks = { onCommit: null, onPlan: null };

const ui = {
  busy: false,
  vetoes: 0,
  rotation: 0,
  slices: [],
  race: null,
  pending: null,
  koOut: [],
};

/* ---------------- DOM ---------------- */

const $ = (sel) => document.querySelector(sel);
const els = {
  tagline: $("#tagline"),
  soundBtn: $("#soundBtn"),
  themeBtn: $("#themeBtn"),
  modeTabs: document.querySelectorAll(".mode-tab"),
  modeHint: $("#modeHint"),
  wheelWrap: $("#wheelWrap"),
  wheelCanvas: $("#wheelCanvas"),
  pointer: $("#wheelPointer"),
  hubBtn: $("#hubBtn"),
  raceWrap: $("#raceWrap"),
  raceCanvas: $("#raceCanvas"),
  emptyStage: $("#emptyStage"),
  emptyAddBtn: $("#emptyAddBtn"),
  koTrail: $("#knockoutTrail"),
  goBtn: $("#goBtn"),
  goLabel: $("#goLabel"),
  raceLength: $("#raceLength"),
  live: $("#liveRegion"),
  sideTabs: document.querySelectorAll(".side-tab"),
  lineupCount: $("#lineupCount"),
  addForm: $("#addForm"),
  nameInput: $("#nameInput"),
  datalist: $("#nameSuggestions"),
  quickAddWrap: $("#quickAddWrap"),
  quickAdd: $("#quickAdd"),
  lineup: $("#lineup"),
  noRepeat: $("#noRepeatToggle"),
  bias: $("#biasToggle"),
  shareBtn: $("#shareBtn"),
  clearBtn: $("#clearBtn"),
  historyList: $("#historyList"),
  fameList: $("#fameList"),
  dialog: $("#resultDialog"),
  resultClose: $("#resultClose"),
  resultKicker: $("#resultKicker"),
  resultEmoji: $("#resultEmoji"),
  resultName: $("#resultName"),
  resultQuip: $("#resultQuip"),
  resultPodium: $("#resultPodium"),
  eatBtn: $("#eatBtn"),
  rerollBtn: $("#rerollBtn"),
  mapLink: $("#mapLink"),
  emojiPop: $("#emojiPop"),
  toastZone: $("#toastZone"),
  confetti: $("#confettiCanvas"),
};

/* ---------------- Helpers ---------------- */

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === "class") node.className = value;
    else if (key === "style") node.style.cssText = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  });
  children.flat().forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (Math.random() * 16) >> (c / 4)).toString(16)));

// Seeded RNG so every teammate's screen replays the exact same spin or race.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const norm = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanName(raw) {
  return String(raw || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function titleCase(name) {
  return name.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function hashCode(text) {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  return Math.abs(hash);
}

function guessEmoji(name) {
  const rule = EMOJI_RULES.find(([pattern]) => pattern.test(name));
  if (rule) return rule[1];
  const fallback = ["🍽️", "🥙", "🍱", "🥘", "🍛", "🥟", "🍤", "🧆"];
  return fallback[hashCode(norm(name)) % fallback.length];
}

function colorFor(restaurant) {
  const index = store.restaurants.findIndex((r) => r.id === restaurant.id);
  return PALETTE[(index < 0 ? hashCode(restaurant.name) : index) % PALETTE.length];
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170;
}

function formatDate(ts) {
  const date = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return `Today · ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday · ${time}`;
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function announce(text) {
  els.live.textContent = "";
  requestAnimationFrame(() => { els.live.textContent = text; });
}

/* ---------------- Stats from history ---------------- */

function statsFor(name) {
  const key = norm(name);
  const races = store.history.filter((entry) => norm(entry.name) === key);
  const scoreOf = (e) => e.avg || e.rating;
  const rated = races.filter(scoreOf);
  const avg = rated.length ? rated.reduce((sum, e) => sum + scoreOf(e), 0) / rated.length : null;
  return { wins: races.length, avg };
}

function lastWinnerKey() {
  return store.history.length ? norm(store.history[0].name) : null;
}

function isSkippedByNoRepeat(restaurant) {
  if (!store.settings.noRepeat) return false;
  const available = store.restaurants.filter((r) => !r.out);
  return available.length > 2 && norm(restaurant.name) === lastWinnerKey();
}

function eligible() {
  return store.restaurants.filter((r) => !r.out && !isSkippedByNoRepeat(r));
}

function weightOf(restaurant) {
  let weight = restaurant.tickets || 1;
  if (store.settings.bias) {
    const { avg } = statsFor(restaurant.name);
    if (avg) weight *= clamp(1 + (avg - 3) * 0.25, 0.5, 1.5);
  }
  return weight;
}

/* ---------------- Sound ---------------- */

const sfx = {
  ctx: null,
  ensure() {
    if (!store.settings.sound) return null;
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch (_) {
      return null;
    }
    return this.ctx;
  },
  tone(freq, dur, type = "sine", vol = 0.08, delay = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },
  tick() { this.tone(1300, 0.03, "square", 0.025); },
  pop() { this.tone(620, 0.07, "sine", 0.08); this.tone(930, 0.06, "sine", 0.05, 0.05); },
  beep(high) { this.tone(high ? 880 : 440, high ? 0.3 : 0.15, "triangle", 0.12); },
  knock() { this.tone(160, 0.22, "sawtooth", 0.06); this.tone(80, 0.35, "sine", 0.14); },
  boost() { this.tone(300, 0.12, "sawtooth", 0.03); this.tone(600, 0.12, "sawtooth", 0.03, 0.06); },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.28, "triangle", 0.1, i * 0.11));
    this.tone(1319, 0.5, "triangle", 0.08, 0.48);
  },
};

/* ---------------- Toasts ---------------- */

function toast(message, action) {
  const node = h("div", { class: "toast", role: "status" }, h("span", {}, message));
  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    node.classList.add("out");
    setTimeout(() => node.remove(), 260);
  };
  if (action) {
    node.append(h("button", {
      type: "button",
      onclick: () => { action.run(); dismiss(); },
    }, action.label));
  }
  els.toastZone.append(node);
  while (els.toastZone.children.length > 3) els.toastZone.firstChild.remove();
  timer = setTimeout(dismiss, action ? 5000 : 2600);
}

/* ---------------- Lineup actions ---------------- */

function addRestaurant(raw) {
  const name = cleanName(raw);
  if (!name) return false;
  const existing = store.restaurants.find((r) => norm(r.name) === norm(name));
  if (existing) {
    if (existing.out) {
      existing.out = false;
      toast(`${existing.emoji} ${existing.name} is back in the game`);
    } else if (existing.tickets < MAX_TICKETS) {
      existing.tickets += 1;
      toast(`${existing.emoji} ${existing.name} gets an extra chance (×${existing.tickets})`);
    } else {
      toast(`${existing.name} already has max chances 😅`);
    }
  } else {
    const display = name === name.toLowerCase() ? titleCase(name) : name;
    store.restaurants.push({ id: uid(), name: display, emoji: guessEmoji(display), tickets: 1, out: false });
    sfx.pop();
  }
  commit();
  return true;
}

function updateRestaurant(id, patch) {
  const restaurant = store.restaurants.find((r) => r.id === id);
  if (!restaurant) return;
  Object.assign(restaurant, patch);
  commit();
}

function removeRestaurant(id) {
  const index = store.restaurants.findIndex((r) => r.id === id);
  if (index < 0) return;
  const [removed] = store.restaurants.splice(index, 1);
  commit();
  toast(`${removed.emoji} ${removed.name} removed`, {
    label: "Undo",
    run: () => {
      store.restaurants.splice(Math.min(index, store.restaurants.length), 0, removed);
      commit();
    },
  });
}

function clearLineup() {
  if (!store.restaurants.length) return;
  const snapshot = store.restaurants.slice();
  store.restaurants = [];
  commit();
  toast("Lineup cleared", {
    label: "Undo",
    run: () => { store.restaurants = snapshot; commit(); },
  });
}

function commit() {
  saveStore();
  render();
  if (hooks.onCommit) hooks.onCommit();
}

/* ---------------- Sharing ---------------- */

function encodeLineup() {
  const payload = JSON.stringify(store.restaurants.map((r) => [r.name, r.emoji, r.tickets]));
  const bytes = new TextEncoder().encode(payload);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeLineup(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const rows = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(rows)) throw new Error("bad lineup");
  return rows
    .filter((row) => Array.isArray(row) && cleanName(row[0]))
    .slice(0, 40)
    .map(([name, emoji, tickets]) => ({
      id: uid(),
      name: cleanName(name),
      emoji: typeof emoji === "string" && emoji.length <= 8 ? emoji : guessEmoji(name),
      tickets: clamp(Number(tickets) || 1, 1, MAX_TICKETS),
      out: false,
    }));
}

async function shareLineup() {
  if (!store.restaurants.length) {
    toast("Add some spots first, then share 🙂");
    return;
  }
  const url = `${location.origin}${location.pathname}#l=${encodeLineup()}`;
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title: "Foodie Pick lineup", text: "Help pick lunch!", url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast("🔗 Link copied. Paste it in the team chat!");
  } catch (_) {
    window.prompt("Copy this link:", url);
  }
}

function loadSharedLineup() {
  const match = location.hash.match(/^#l=([\w-]+)/);
  if (!match) return;
  history.replaceState(null, "", location.pathname + location.search);
  try {
    const incoming = decodeLineup(match[1]);
    if (!incoming.length) return;
    const previous = store.restaurants.slice();
    store.restaurants = incoming;
    saveStore();
    toast(`Loaded a shared lineup of ${incoming.length} spots`, previous.length ? {
      label: "Undo",
      run: () => { store.restaurants = previous; commit(); },
    } : null);
  } catch (_) {
    toast("That share link looks broken 🤔");
  }
}

/* ---------------- Rendering: lineup ---------------- */

function render() {
  renderLineup();
  renderQuickAdd();
  renderHistory();
  renderFame();
  renderStage();
}

function renderLineup() {
  els.lineup.replaceChildren();
  const count = eligible().length;
  els.lineupCount.textContent = String(count);

  if (!store.restaurants.length) {
    els.lineup.append(h("li", { class: "lineup-empty" }, "Nothing here yet. Add your first spot above 👆"));
  }

  store.restaurants.forEach((r) => {
    const { wins, avg } = statsFor(r.name);
    const skipped = isSkippedByNoRepeat(r);
    let meta = wins ? `🏆 ${wins} ${wins === 1 ? "win" : "wins"}` : "New challenger";
    if (avg) meta += ` · ⭐ ${avg.toFixed(1)}`;
    if (skipped) meta = "💤 Won last time, sitting this one out";
    if (r.out) meta = "🙈 Sitting out today";

    const item = h("li", {
      class: `entry${r.out || skipped ? " sitting-out" : ""}`,
      style: `--c:${colorFor(r)}`,
    },
      h("button", {
        class: "entry-emoji",
        type: "button",
        title: "Change emoji",
        "aria-label": `Change emoji for ${r.name}`,
        onclick: (event) => openEmojiPicker(r, event.currentTarget),
      }, r.emoji),
      h("div", { class: "entry-main" },
        h("span", { class: "entry-name", title: r.name }, r.name),
        h("span", { class: "entry-meta" }, meta),
      ),
      h("div", { class: "tickets", title: "Chances. More chances = better odds" },
        h("button", {
          type: "button",
          "aria-label": `Fewer chances for ${r.name}`,
          disabled: r.tickets <= 1,
          onclick: () => updateRestaurant(r.id, { tickets: r.tickets - 1 }),
        }, "−"),
        h("strong", { "aria-label": `${r.tickets} chances` }, `×${r.tickets}`),
        h("button", {
          type: "button",
          "aria-label": `More chances for ${r.name}`,
          disabled: r.tickets >= MAX_TICKETS,
          onclick: () => updateRestaurant(r.id, { tickets: r.tickets + 1 }),
        }, "+"),
      ),
      h("button", {
        class: "entry-btn",
        type: "button",
        title: r.out ? "Bring back" : "Closed today? Sit this one out",
        "aria-label": r.out ? `Bring back ${r.name}` : `Sit out ${r.name}`,
        "aria-pressed": String(Boolean(r.out)),
        onclick: () => updateRestaurant(r.id, { out: !r.out }),
      }, r.out ? "🙈" : "👀"),
      h("button", {
        class: "entry-btn",
        type: "button",
        title: "Remove",
        "aria-label": `Remove ${r.name}`,
        onclick: () => removeRestaurant(r.id),
      }, "✕"),
    );
    els.lineup.append(item);
  });

  els.noRepeat.checked = store.settings.noRepeat;
  els.bias.checked = store.settings.bias;
  els.clearBtn.disabled = !store.restaurants.length;
}

function suggestionPool() {
  const inLineup = new Set(store.restaurants.map((r) => norm(r.name)));
  const counts = new Map();
  store.history.forEach((entry) => {
    const key = norm(entry.name);
    const current = counts.get(key) || { name: entry.name, count: 0 };
    current.count += 1;
    counts.set(key, current);
  });
  const fromHistory = [...counts.values()].sort((a, b) => b.count - a.count).map((e) => e.name);
  const seen = new Set();
  return [...fromHistory, ...TEAM_FAVES].filter((name) => {
    const key = norm(name);
    if (inLineup.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderQuickAdd() {
  const pool = suggestionPool();
  els.datalist.replaceChildren(...pool.map((name) => h("option", { value: name })));
  const chips = pool.slice(0, 8);
  els.quickAddWrap.hidden = !chips.length;
  els.quickAdd.replaceChildren(...chips.map((name) =>
    h("button", {
      class: "chip",
      type: "button",
      onclick: () => addRestaurant(name),
    }, `${guessEmoji(name)} ${name}`)
  ));
}

/* ---------------- Rendering: history & fame ---------------- */

function renderHistory() {
  els.historyList.replaceChildren();
  if (!store.history.length) {
    els.historyList.append(h("li", { class: "muted-empty" },
      h("span", {}, "📜"),
      "No lunches yet. Pick one and hit “Let's eat!” to save it here."));
    return;
  }
  const modeIcon = { wheel: "🎡", race: "🏁", knockout: "🥊" };
  store.history.slice(0, 60).forEach((entry) => {
    const stars = h("div", { class: "stars", role: "group", "aria-label": `Rate ${entry.name}` },
      [1, 2, 3, 4, 5].map((n) => h("button", {
        type: "button",
        class: entry.rating >= n ? "on" : "",
        "aria-label": `${n} star${n > 1 ? "s" : ""}`,
        "aria-pressed": String(entry.rating === n),
        onclick: () => rateEntry(entry.id, n),
      }, "⭐")),
    );
    els.historyList.append(h("li", { class: "history-item" },
      h("span", { class: "history-emoji", "aria-hidden": "true" }, entry.emoji || "🍽️"),
      h("div", {},
        h("div", { class: "history-name" }, entry.name),
        h("div", { class: "history-date" },
          `${modeIcon[entry.mode] || ""} ${formatDate(entry.ts)}${entry.by ? ` · ${entry.by}` : ""}`
          + (entry.raters ? ` · ⭐ ${entry.avg.toFixed(1)} (${entry.raters})` : "")),
      ),
      h("button", {
        class: "entry-btn history-del",
        type: "button",
        "aria-label": `Delete ${entry.name} from history`,
        onclick: () => deleteHistory(entry.id),
      }, "✕"),
      h("div", { style: "grid-column: 2 / 3" }, stars),
    ));
  });
}

function rateEntry(id, rating) {
  const entry = store.history.find((e) => e.id === id);
  if (!entry) return;
  entry.rating = entry.rating === rating ? null : rating;
  sfx.tick();
  commit();
}

function deleteHistory(id) {
  const index = store.history.findIndex((e) => e.id === id);
  if (index < 0) return;
  const [removed] = store.history.splice(index, 1);
  commit();
  toast("Lunch removed from history", {
    label: "Undo",
    run: () => { store.history.splice(index, 0, removed); commit(); },
  });
}

function renderFame() {
  els.fameList.replaceChildren();
  const table = new Map();
  store.history.forEach((entry) => {
    const key = norm(entry.name);
    const row = table.get(key) || { name: entry.name, emoji: entry.emoji, wins: 0, ratings: [] };
    row.wins += 1;
    if (entry.avg || entry.rating) row.ratings.push(entry.avg || entry.rating);
    table.set(key, row);
  });
  const rows = [...table.values()].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
  if (!rows.length) {
    els.fameList.append(h("li", { class: "muted-empty" },
      h("span", {}, "🏆"),
      "The Hall of Fame is hungry for its first champion."));
    return;
  }
  const top = rows[0].wins;
  const medals = ["🥇", "🥈", "🥉"];
  rows.forEach((row, i) => {
    const avg = row.ratings.length ? row.ratings.reduce((a, b) => a + b, 0) / row.ratings.length : null;
    els.fameList.append(h("li", { class: "fame-item" },
      h("span", { class: "fame-rank" }, medals[i] || String(i + 1)),
      h("span", { class: "fame-emoji", "aria-hidden": "true" }, row.emoji || "🍽️"),
      h("div", {},
        h("div", { class: "fame-name" }, row.name),
        h("div", { class: "fame-bar" }, h("span", { style: `width:${(row.wins / top) * 100}%` })),
      ),
      h("div", { class: "fame-stats" },
        h("strong", {}, String(row.wins)),
        avg ? `⭐ ${avg.toFixed(1)}` : (row.wins === 1 ? "win" : "wins"),
      ),
    ));
  });
}

/* ---------------- Emoji picker ---------------- */

let emojiTarget = null;

function openEmojiPicker(restaurant, anchor) {
  emojiTarget = restaurant.id;
  els.emojiPop.replaceChildren(...EMOJIS.map((emoji) =>
    h("button", {
      type: "button",
      "aria-label": `Use ${emoji}`,
      onclick: () => {
        updateRestaurant(emojiTarget, { emoji });
        closeEmojiPicker();
      },
    }, emoji)
  ));
  els.emojiPop.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const pop = els.emojiPop.getBoundingClientRect();
  const left = clamp(rect.left, 8, window.innerWidth - pop.width - 8);
  const below = rect.bottom + 6;
  const top = below + pop.height > window.innerHeight - 8 ? rect.top - pop.height - 6 : below;
  els.emojiPop.style.left = `${left}px`;
  els.emojiPop.style.top = `${Math.max(8, top)}px`;
  els.emojiPop.querySelector("button")?.focus();
}

function closeEmojiPicker() {
  els.emojiPop.hidden = true;
  emojiTarget = null;
}

/* ---------------- Stage ---------------- */

function setMode(mode) {
  if (ui.busy || !MODE_INFO[mode]) return;
  store.settings.mode = mode;
  ui.race = null;
  ui.koOut = [];
  saveStore();
  renderStage();
}

function renderStage() {
  const mode = store.settings.mode;
  const info = MODE_INFO[mode];
  const ready = eligible().length >= 2;

  els.modeTabs.forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.mode === mode));
    tab.disabled = ui.busy && tab.dataset.mode !== mode;
  });
  els.modeHint.textContent = ready ? info.hint : "";
  els.goLabel.textContent = ui.busy ? info.busy : info.go;
  els.goBtn.disabled = ui.busy || !ready;
  els.goBtn.classList.toggle("wiggle", ready && !ui.busy && !REDUCED_MOTION);
  els.hubBtn.disabled = ui.busy || !ready;

  els.emptyStage.hidden = ready || ui.busy;
  els.wheelWrap.hidden = mode === "race";
  els.raceWrap.hidden = mode !== "race";
  els.raceLength.hidden = mode !== "race";
  els.raceLength.querySelectorAll("button").forEach((btn) => {
    btn.setAttribute("aria-checked", String(Number(btn.dataset.len) === store.settings.raceLen));
    btn.disabled = ui.busy;
  });

  els.koTrail.hidden = mode !== "knockout" || !ui.koOut.length;
  els.koTrail.replaceChildren(...ui.koOut.map((r) => h("li", {}, `${r.emoji} ${r.name}`)));

  if (mode === "race") {
    drawRace();
  } else {
    if (!ui.busy) ui.slices = buildSlices(eligible());
    drawWheel();
  }
}

/* ---------------- Wheel ---------------- */

const TAU = Math.PI * 2;
const wheelCtx = els.wheelCanvas.getContext("2d");

function buildSlices(entries) {
  const weight = (r) => r.weight ?? weightOf(r);
  const total = entries.reduce((sum, r) => sum + weight(r), 0) || 1;
  let angle = 0;
  return entries.map((r) => {
    const span = (weight(r) / total) * TAU;
    const slice = { r, start: angle, end: angle + span, color: r.color || colorFor(r) };
    angle += span;
    return slice;
  });
}

function sizeWheel() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.round((els.wheelWrap.clientWidth || 480) * dpr);
  if (els.wheelCanvas.width !== size) {
    els.wheelCanvas.width = size;
    els.wheelCanvas.height = size;
  }
  return size;
}

function drawWheel(glow = 0) {
  if (els.wheelWrap.hidden) return;
  const size = sizeWheel();
  const ctx = wheelCtx;
  const c = size / 2;
  const radius = c * 0.94;
  ctx.clearRect(0, 0, size, size);

  // Outer rim with bulbs
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, TAU);
  ctx.fillStyle = "#2b1d14";
  ctx.fill();
  const bulbs = 24;
  for (let i = 0; i < bulbs; i += 1) {
    const a = (i / bulbs) * TAU;
    const lit = glow ? (i + Math.floor(glow)) % 2 === 0 : i % 2 === 0;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * radius * 0.955, c + Math.sin(a) * radius * 0.955, radius * 0.022, 0, TAU);
    ctx.fillStyle = lit ? "#ffe07a" : "#8a6a3a";
    ctx.fill();
  }

  const inner = radius * 0.9;
  const slices = ui.slices;

  if (!slices.length) {
    ctx.beginPath();
    ctx.arc(c, c, inner, 0, TAU);
    ctx.fillStyle = "#f5e6d3";
    ctx.fill();
    return;
  }

  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(ui.rotation);

  slices.forEach((slice) => {
    const a0 = slice.start - Math.PI / 2;
    const a1 = slice.end - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, inner, a0, a1);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();
    ctx.lineWidth = Math.max(2, size * 0.004);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    if (slices.length > 1) ctx.stroke();

    // Labels
    const span = slice.end - slice.start;
    const mid = (a0 + a1) / 2;
    ctx.save();
    ctx.rotate(mid);
    const emojiSize = clamp(span * inner * 0.42, size * 0.028, size * 0.07);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${emojiSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillText(slice.r.emoji, inner * 0.84, 0);

    if (span > 0.14) {
      const maxWidth = inner * 0.52;
      const minFont = size * 0.022;
      let fontSize = clamp(span * inner * 0.3, minFont, size * 0.042);
      ctx.font = `700 ${fontSize}px Fredoka, Nunito, sans-serif`;
      // Shrink long names before resorting to "…"
      while (fontSize > minFont && ctx.measureText(slice.r.name).width > maxWidth) {
        fontSize -= 1;
        ctx.font = `700 ${fontSize}px Fredoka, Nunito, sans-serif`;
      }
      ctx.fillStyle = isLight(slice.color) ? "#2b1d14" : "#ffffff";
      const label = fitText(ctx, slice.r.name, maxWidth);
      // Keep text upright on the left half of the wheel
      const screenAngle = ((mid + ui.rotation) % TAU + TAU) % TAU;
      if (screenAngle > Math.PI / 2 && screenAngle < Math.PI * 1.5) {
        ctx.rotate(Math.PI);
        ctx.textAlign = "left";
        ctx.fillText(label, -inner * 0.72, 0);
      } else {
        ctx.textAlign = "right";
        ctx.fillText(label, inner * 0.72, 0);
      }
    }
    ctx.restore();
  });
  ctx.restore();

  // Hub shadow ring
  ctx.beginPath();
  ctx.arc(c, c, radius * 0.14, 0, TAU);
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fill();
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) trimmed = trimmed.slice(0, -1);
  return `${trimmed.trim()}…`;
}

function weightedPick(slices, rng) {
  const total = slices.reduce((sum, s) => sum + (s.end - s.start), 0);
  let roll = rng() * total;
  for (const slice of slices) {
    roll -= slice.end - slice.start;
    if (roll <= 0) return slice;
  }
  return slices[slices.length - 1];
}

function sliceAtPointer() {
  const theta = ((-ui.rotation % TAU) + TAU) % TAU;
  return ui.slices.find((s) => theta >= s.start && theta < s.end) || ui.slices[ui.slices.length - 1];
}

function spinWheel(rng, duration) {
  return new Promise((resolve) => {
    const target = weightedPick(ui.slices, rng);
    const span = target.end - target.start;
    const landAt = target.start + span * (0.15 + rng() * 0.7);
    const start = ui.rotation;
    const turns = Math.max(3, Math.round(duration / 900)) * TAU;
    let end = -landAt;
    while (end < start + turns) end += TAU;
    const t0 = performance.now();
    let lastSlice = sliceAtPointer();

    const frame = (now) => {
      const t = clamp((now - t0) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      ui.rotation = start + (end - start) * eased;
      drawWheel(now / 90);
      const current = sliceAtPointer();
      if (current !== lastSlice) {
        lastSlice = current;
        sfx.tick();
        els.pointer.classList.remove("tick");
        void els.pointer.offsetWidth;
        els.pointer.classList.add("tick");
      }
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        ui.rotation = end % TAU;
        drawWheel();
        resolve(target.r);
      }
    };
    requestAnimationFrame(frame);
  });
}

/* ---------------- Race ---------------- */

const raceCtx = els.raceCanvas.getContext("2d");
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

function raceLanes(entries) {
  let lanes = entries.flatMap((r) => Array.from({ length: r.tickets || 1 }, () => r));
  if (lanes.length > MAX_RACE_LANES) lanes = entries.slice();
  return lanes;
}

function raceLayout(laneCount) {
  const width = els.raceWrap.clientWidth || 600;
  const header = 46;
  const laneH = clamp(Math.floor(440 / Math.max(laneCount, 1)), 30, 64);
  const height = header + laneCount * laneH + 12;
  return { width, height, header, laneH, startX: 34, finishX: width - 42 };
}

function sizeRace(layout) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(layout.width * dpr);
  const hgt = Math.round(layout.height * dpr);
  if (els.raceCanvas.width !== w || els.raceCanvas.height !== hgt) {
    els.raceCanvas.width = w;
    els.raceCanvas.height = hgt;
    els.raceCanvas.style.height = `${layout.height}px`;
  }
  raceCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function makeRace(plan, rng) {
  const lanes = raceLanes(plan.entries);
  const dupes = new Map();
  const rr = (min, max) => min + rng() * (max - min);
  return {
    rng,
    rr,
    t: 0,
    duration: plan.raceLen,
    countdown: REDUCED_MOTION ? 1 : 3.6,
    lastBeep: 4,
    finishedAt: null,
    winner: null,
    finalAnnounced: false,
    leaderId: null,
    leadCooldown: 2,
    banner: null,
    crumbs: [],
    racers: lanes.map((r, lane) => {
      const n = (dupes.get(r.id) || 0) + 1;
      dupes.set(r.id, n);
      return {
        r,
        lane,
        tag: n > 1 ? ` #${n}` : "",
        p: 0,
        pace: rr(0.9, 1.1) + (r.bias || 0),
        kick: rr(0, 0.6),
        f1: rr(0.25, 0.6), ph1: rr(0, TAU),
        f2: rr(0.08, 0.18), ph2: rr(0, TAU),
        hop: rr(0, TAU),
        boost: 0,
        nap: 0,
        eventIn: rr(2, 5),
        finishTime: null,
      };
    }),
  };
}

const RACE_STEP = 1 / 60;

function runRace(plan, rng) {
  return new Promise((resolve) => {
    const race = makeRace(plan, rng);
    ui.race = race;
    let last = performance.now();
    let acc = 0;

    const frame = (now) => {
      // Fixed timestep: identical results on every device, whatever its frame rate.
      acc += Math.min((now - last) / 1000, 0.25);
      last = now;
      while (acc >= RACE_STEP) {
        stepRace(race, RACE_STEP);
        acc -= RACE_STEP;
      }
      drawRace();
      if (race.finishedAt !== null && race.t - race.finishedAt > 1.1) {
        const order = [...race.racers].sort((a, b) =>
          (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity) || b.p - a.p);
        resolve({ winner: race.winner.r, order });
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

function stepRace(race, dt) {
  if (race.countdown > 0) {
    race.countdown -= dt;
    const whole = Math.ceil(race.countdown);
    if (whole < race.lastBeep && whole >= 1 && whole <= 3) {
      race.lastBeep = whole;
      sfx.beep(false);
    }
    if (race.countdown <= 0) {
      sfx.beep(true);
      setBanner(race, "🍴 EAT!", "#22a867");
    }
    race.racers.forEach((x) => { x.hop += dt * 3; });
    return;
  }

  race.t += dt;
  const base = 1 / race.duration;
  const progress = race.t / race.duration;
  const leader = race.racers.reduce((best, x) => (x.p > best.p ? x : best), race.racers[0]);

  // Keep the leader roughly on schedule so the race lasts about as long as chosen.
  const schedule = Math.pow(clamp(progress, 0, 1), 1.12);
  const tempo = clamp(1 - (leader.p - schedule) * 3.2, 0.55, 1.8);
  const finalStretch = progress > 0.78 || leader.p > 0.85;

  race.racers.forEach((x) => {
    if (x.finishTime !== null) {
      x.hop += dt * 4;
      return;
    }
    x.eventIn -= dt;
    if (x.eventIn <= 0 && race.finishedAt === null) {
      const trailing = leader.p - x.p;
      const roll = race.rng();
      if (roll < 0.28 + trailing * 1.5) {
        x.boost = race.rr(0.9, 1.5);
        if (!race.banner || race.banner.life < 0.4) {
          setBanner(race, `🌶️ ${x.r.name}${x.tag} hits the hot sauce!`, "#ff5a36");
          sfx.boost();
        }
      } else if (roll > 0.86 && x === leader && progress < 0.8) {
        x.nap = race.rr(0.6, 1.1);
        if (!race.banner || race.banner.life < 0.4) setBanner(race, `😴 ${x.r.name}${x.tag} hit a food coma!`, "#8e5cf7");
      }
      x.eventIn = finalStretch ? race.rr(1, 2.2) : race.rr(2.2, 4.5);
    }
    x.boost = Math.max(0, x.boost - dt);
    x.nap = Math.max(0, x.nap - dt);

    const wave = Math.sin(race.t * x.f1 * TAU + x.ph1) * 0.18 + Math.sin(race.t * x.f2 * TAU + x.ph2) * 0.1;
    const band = progress < 0.75 ? (leader.p - x.p) * 2.4 : 0;
    let mult = x.pace + wave + band + (x.boost > 0 ? 0.85 : 0) - (x.nap > 0 ? 0.65 : 0);
    if (finalStretch) mult += x.kick;
    mult = clamp(mult, 0.12, 2.8);

    const move = base * mult * tempo * dt;
    x.hop += dt * (6 + mult * 8);
    if (x.p + move >= 1) {
      const frac = move > 0 ? (1 - x.p) / move : 0;
      x.finishTime = race.t - dt + dt * frac;
      x.p = 1;
      if (!race.winner) {
        race.winner = x;
        race.finishedAt = race.t;
        setBanner(race, `🏆 ${x.r.name} takes the plate!`, "#ffb400");
        sfx.win();
      }
    } else {
      x.p += move;
    }

    if (Math.random() < dt * 14) {
      race.crumbs.push({ racer: x, p: x.p, y: rand(-4, 6), life: 0.6, size: rand(2, 4.5) });
    }
  });

  race.crumbs = race.crumbs.filter((c) => (c.life -= dt) > 0);

  if (race.banner) {
    race.banner.life -= dt;
    if (race.banner.life <= 0) race.banner = null;
  }

  race.leadCooldown -= dt;
  if (!race.winner && leader.r.id !== race.leaderId) {
    if (race.leaderId !== null && race.leadCooldown <= 0 && (!race.banner || race.banner.life < 0.6)) {
      setBanner(race, `${leader.r.emoji} ${leader.r.name} takes the lead!`, leader.r.color || colorFor(leader.r));
      race.leadCooldown = 1.8;
    }
    race.leaderId = leader.r.id;
  }

  if (finalStretch && !race.finalAnnounced && !race.winner) {
    race.finalAnnounced = true;
    setBanner(race, "🔥 FINAL STRETCH!", "#ff5a36");
  }

  // Safety net: never let a race overstay its welcome.
  if (!race.winner && race.t > race.duration + 5) {
    race.winner = leader;
    leader.finishTime = race.t;
    race.finishedAt = race.t;
    sfx.win();
  }
}

function setBanner(race, text, color) {
  race.banner = { text, color, life: 1.8 };
}

function drawRace() {
  if (els.raceWrap.hidden) return;
  const race = ui.race;
  const racers = race ? race.racers : raceLanes(eligible()).map((r, lane) => ({
    r, lane, p: 0, hop: lane, boost: 0, nap: 0, tag: "", finishTime: null,
  }));
  const L = raceLayout(Math.max(racers.length, 2));
  sizeRace(L);
  const ctx = raceCtx;

  // Tablecloth background
  ctx.fillStyle = "#fff3df";
  ctx.fillRect(0, 0, L.width, L.height);
  racers.forEach((_, i) => {
    const y = L.header + i * L.laneH;
    ctx.fillStyle = i % 2 ? "#ffe8c8" : "#fff6e6";
    ctx.fillRect(0, y, L.width, L.laneH);
    ctx.strokeStyle = "rgba(180,120,60,0.25)";
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(0, y + L.laneH);
    ctx.lineTo(L.width, y + L.laneH);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // Header strip: gingham + banner + timer
  ctx.fillStyle = "#2b1d14";
  ctx.fillRect(0, 0, L.width, L.header);
  for (let x = 0; x < L.width; x += 16) {
    ctx.fillStyle = (x / 16) % 2 ? "rgba(255,90,54,0.35)" : "rgba(255,90,54,0.15)";
    ctx.fillRect(x, L.header - 6, 16, 6);
  }

  ctx.textBaseline = "middle";
  ctx.font = "700 16px Fredoka, Nunito, sans-serif";
  if (race && race.banner) {
    ctx.globalAlpha = clamp(race.banner.life * 2, 0, 1);
    ctx.fillStyle = race.banner.color;
    ctx.textAlign = "left";
    ctx.fillText(fitText(ctx, race.banner.text, L.width - 110), 14, L.header / 2 - 2);
    ctx.globalAlpha = 1;
  } else if (!race) {
    ctx.fillStyle = "#ffc23c";
    ctx.textAlign = "left";
    ctx.fillText("Racers ready… first to the plate wins 🍽️", 14, L.header / 2 - 2);
  }
  if (race) {
    const left = Math.max(0, race.duration - race.t);
    ctx.fillStyle = left < 5 && !race.winner ? "#ff5a36" : "#fff";
    ctx.textAlign = "right";
    ctx.font = "700 18px Fredoka, Nunito, sans-serif";
    ctx.fillText(`⏱ ${left.toFixed(1)}s`, L.width - 12, L.header / 2 - 2);
  }

  // Start and finish lines
  ctx.fillStyle = "rgba(43,29,20,0.25)";
  ctx.fillRect(L.startX - 2, L.header, 3, L.height - L.header);
  const cell = 7;
  for (let y = L.header, row = 0; y < L.height; y += cell, row += 1) {
    for (let col = 0; col < 2; col += 1) {
      ctx.fillStyle = (row + col) % 2 ? "#2b1d14" : "#ffffff";
      ctx.fillRect(L.finishX + col * cell, y, cell, cell);
    }
  }

  const leader = race ? racers.reduce((best, x) => (x.p > best.p ? x : best), racers[0]) : null;
  const size = Math.round(L.laneH * 0.66);
  const track = L.finishX - L.startX;

  // Crumbs
  if (race) {
    race.crumbs.forEach((crumb) => {
      const cy = L.header + crumb.racer.lane * L.laneH + L.laneH / 2 + size * 0.3 + crumb.y;
      const cx = L.startX + crumb.p * track - size * 0.5 - (0.6 - crumb.life) * 60;
      ctx.globalAlpha = clamp(crumb.life / 0.6, 0, 1);
      ctx.fillStyle = "#c8894a";
      ctx.beginPath();
      ctx.arc(cx, cy, crumb.size, 0, TAU);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  racers.forEach((x) => {
    const cy = L.header + x.lane * L.laneH + L.laneH / 2;
    const cx = L.startX + x.p * track;
    const moving = race && race.countdown <= 0 && x.finishTime === null;
    const hop = moving ? Math.abs(Math.sin(x.hop)) * L.laneH * 0.16 : Math.abs(Math.sin(x.hop)) * 2;

    // Lane label trails behind the racer
    ctx.font = `700 ${clamp(L.laneH * 0.32, 11, 15)}px Nunito, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(43,29,20,0.55)";
    const labelRoom = cx - size * 0.6 - L.startX - 6;
    if (labelRoom > 40) ctx.fillText(fitText(ctx, x.r.name + x.tag, labelRoom), cx - size * 0.6, cy);
    else {
      ctx.textAlign = "left";
      ctx.fillText(fitText(ctx, x.r.name + x.tag, L.finishX - cx - size), cx + size * 0.65, cy);
    }

    // Shadow
    ctx.fillStyle = "rgba(43,29,20,0.18)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + size * 0.42, size * 0.38 * (1 - hop / (L.laneH * 0.5)), size * 0.1, 0, 0, TAU);
    ctx.fill();

    // Emoji glyphs inherit fillStyle alpha, so reset to opaque first
    ctx.fillStyle = "#000";

    // Hot sauce flames
    if (x.boost > 0) {
      ctx.font = `${size * 0.6}px ${EMOJI_FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("🔥", cx - size * 0.75, cy - hop * 0.5);
    }

    ctx.font = `${size}px ${EMOJI_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(x.r.emoji, cx, cy - hop);

    if (x.nap > 0) {
      ctx.font = `${size * 0.45}px ${EMOJI_FONT}`;
      ctx.fillText("💤", cx + size * 0.45, cy - size * 0.5);
    }
    if (race && x === leader && race.countdown <= 0) {
      ctx.font = `${size * 0.45}px ${EMOJI_FONT}`;
      ctx.fillText("👑", cx, cy - hop - size * 0.62);
    }
  });

  // Countdown overlay
  if (race && race.countdown > 0) {
    ctx.fillStyle = "rgba(43,29,20,0.45)";
    ctx.fillRect(0, L.header, L.width, L.height - L.header);
    const n = Math.ceil(race.countdown);
    const label = n > 3 ? "Ready?" : String(n);
    const pulse = 1 + (race.countdown % 1) * 0.3;
    ctx.save();
    ctx.translate(L.width / 2, L.header + (L.height - L.header) / 2);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = "#ffc23c";
    ctx.strokeStyle = "#2b1d14";
    ctx.lineWidth = 6;
    ctx.font = `700 ${n > 3 ? 42 : 72}px Fredoka, Nunito, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText(label, 0, 0);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
}

/* ---------------- Play ---------------- */

function makePlan() {
  return {
    id: uid(),
    seed: Math.floor(Math.random() * 4294967296),
    mode: store.settings.mode,
    raceLen: store.settings.raceLen,
    by: store.team ? store.nick : null,
    // Snapshot the field so every screen races exactly the same lineup.
    entries: eligible().map((r) => {
      const { avg } = statsFor(r.name);
      return {
        id: r.id,
        name: r.name,
        emoji: r.emoji,
        tickets: r.tickets || 1,
        weight: weightOf(r),
        bias: store.settings.bias && avg ? (avg - 3) * 0.03 : 0,
        color: colorFor(r),
      };
    }),
  };
}

function play() {
  if (ui.busy) return;
  if (eligible().length < 2) {
    focusAdd();
    return;
  }
  const plan = makePlan();
  if (hooks.onPlan) hooks.onPlan(plan);
  runPlan(plan);
}

async function runPlan(plan) {
  if (ui.busy || !plan || !Array.isArray(plan.entries) || plan.entries.length < 2) return;
  closeEmojiPicker();
  closeResult();
  sfx.ensure();
  ui.busy = true;
  ui.race = null;
  ui.koOut = [];
  if (MODE_INFO[plan.mode]) store.settings.mode = plan.mode;
  renderStage();

  const rng = mulberry32(plan.seed);
  try {
    if (plan.mode === "race") {
      const { winner, order } = await runRace(plan, rng);
      showResult(winner, { plan, order });
    } else if (plan.mode === "knockout") {
      const winner = await runKnockout(plan.entries, rng);
      showResult(winner, { plan });
    } else {
      ui.slices = buildSlices(plan.entries);
      const duration = 4200 + rng() * 1200;
      const winner = await spinWheel(rng, REDUCED_MOTION ? 1200 : duration);
      sfx.win();
      await wait(350);
      showResult(winner, { plan });
    }
  } finally {
    ui.busy = false;
    renderStage();
  }
}

async function runKnockout(entries, rng) {
  ui.koOut = [];
  let alive = entries.slice();
  ui.slices = buildSlices(alive);
  renderStage();
  while (alive.length > 1) {
    const finalSpin = alive.length === 2;
    const loser = await spinWheel(rng, REDUCED_MOTION ? 700 : finalSpin ? 3600 : 2300);
    sfx.knock();
    ui.koOut.push(loser);
    alive = alive.filter((r) => r.id !== loser.id);
    announce(`${loser.name} is out`);
    els.koTrail.hidden = false;
    els.koTrail.replaceChildren(...ui.koOut.map((r) => h("li", {}, `${r.emoji} ${r.name}`)));
    els.modeHint.textContent = alive.length > 1
      ? `💥 ${loser.name} is out! ${alive.length} left standing…`
      : `💥 ${loser.name} is out!`;
    await wait(REDUCED_MOTION ? 200 : 750);
    ui.slices = buildSlices(alive);
    drawWheel();
    await wait(REDUCED_MOTION ? 100 : 350);
  }
  sfx.win();
  return alive[0];
}

function showResult(restaurant, { plan, order } = {}) {
  const mode = plan.mode;
  ui.pending = { restaurant, mode, planId: plan.id };
  const kickers = {
    wheel: "The wheel has spoken",
    race: "And the winner is…",
    knockout: "Last bite standing",
  };
  els.resultKicker.textContent = plan.by ? `${plan.by} rolled · ${kickers[mode]}` : kickers[mode];
  els.resultEmoji.textContent = restaurant.emoji;
  els.resultName.textContent = restaurant.name;
  els.resultQuip.textContent = ui.vetoes
    ? pick(VETO_QUIPS).replace("{n}", String(ui.vetoes))
    : pick(WIN_QUIPS);
  els.mapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurant.name)}`;

  if (order && order.length > 2) {
    const medals = ["🥇", "🥈", "🥉"];
    els.resultPodium.hidden = false;
    els.resultPodium.replaceChildren(...order.slice(0, 3).map((x, i) =>
      h("li", {}, `${medals[i]} ${x.r.emoji} ${x.r.name}${x.tag}`)));
  } else {
    els.resultPodium.hidden = true;
  }

  announce(`Today's pick: ${restaurant.name}`);
  if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
  burstConfetti(restaurant.emoji);
  if (typeof els.dialog.showModal === "function") els.dialog.showModal();
  else els.dialog.setAttribute("open", "");
  els.eatBtn.focus();
}

function closeResult() {
  if (els.dialog.open) els.dialog.close();
}

function confirmEat() {
  const pending = ui.pending;
  if (!pending) return;
  const { restaurant, mode, planId } = pending;
  // The plan id doubles as the lunch id, so two teammates saving the same pick don't duplicate it.
  if (!store.history.some((e) => e.id === planId)) {
    store.history.unshift({
      id: planId,
      ts: Date.now(),
      name: restaurant.name,
      emoji: restaurant.emoji,
      mode,
      rating: null,
      by: store.team ? store.nick : undefined,
    });
  }
  store.history = store.history.slice(0, 200);
  ui.pending = null;
  ui.vetoes = 0;
  ui.race = null;
  ui.koOut = [];
  closeResult();
  commit();
  burstConfetti("😋");
  toast(`Enjoy ${restaurant.name}! Rate it later in History ⭐`);
}

function reroll() {
  ui.vetoes += 1;
  ui.pending = null;
  ui.race = null;
  ui.koOut = [];
  closeResult();
  play();
}

function focusAdd() {
  setSideTab("lineup");
  els.nameInput.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "center" });
  els.nameInput.focus({ preventScroll: true });
  els.addForm.classList.remove("shake");
  void els.addForm.offsetWidth;
  els.addForm.classList.add("shake");
}

/* ---------------- Confetti ---------------- */

const confetti = { ctx: els.confetti.getContext("2d"), parts: [], running: false };

function burstConfetti(emoji) {
  const canvas = els.confetti;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  confetti.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const count = REDUCED_MOTION ? 30 : 150;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.38;
  for (let i = 0; i < count; i += 1) {
    const angle = rand(0, TAU);
    const speed = rand(4, 15);
    confetti.parts.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6,
      rot: rand(0, TAU),
      vr: rand(-0.3, 0.3),
      size: rand(6, 11),
      color: pick(PALETTE),
      emoji: Math.random() < 0.14 ? emoji : null,
      life: rand(1.6, 2.6),
    });
  }
  if (!confetti.running) {
    confetti.running = true;
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const ctx = confetti.ctx;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      confetti.parts = confetti.parts.filter((p) => {
        p.life -= dt;
        p.vy += 22 * dt;
        p.vx *= 0.99;
        p.x += p.vx * dt * 60;
        p.y += p.vy * dt * 60;
        p.rot += p.vr;
        if (p.life <= 0 || p.y > window.innerHeight + 40) return false;
        ctx.save();
        ctx.globalAlpha = clamp(p.life, 0, 1);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.emoji) {
          ctx.fillStyle = "#000";
          ctx.font = `${p.size * 2.6}px ${EMOJI_FONT}`;
          ctx.textAlign = "center";
          ctx.fillText(p.emoji, 0, 0);
        } else {
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        ctx.restore();
        return true;
      });
      if (confetti.parts.length) requestAnimationFrame(frame);
      else {
        confetti.running = false;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    };
    requestAnimationFrame(frame);
  }
}

/* ---------------- Side tabs, theme, sound ---------------- */

function setSideTab(name) {
  els.sideTabs.forEach((tab) => {
    const active = tab.dataset.panel === name;
    tab.setAttribute("aria-selected", String(active));
    document.getElementById(`panel-${tab.dataset.panel}`).hidden = !active;
  });
}

function effectiveTheme() {
  if (store.settings.theme) return store.settings.theme;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme() {
  if (store.settings.theme) document.documentElement.dataset.theme = store.settings.theme;
  else delete document.documentElement.dataset.theme;
  const dark = effectiveTheme() === "dark";
  els.themeBtn.textContent = dark ? "☀️" : "🌙";
  els.themeBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}

function applySound() {
  const on = store.settings.sound;
  els.soundBtn.textContent = on ? "🔊" : "🔇";
  els.soundBtn.setAttribute("aria-pressed", String(on));
  els.soundBtn.setAttribute("aria-label", on ? "Mute sounds" : "Turn sounds on");
}

function rotateTagline() {
  let index = 0;
  setInterval(() => {
    index = (index + 1) % TAGLINES.length;
    els.tagline.style.opacity = "0";
    setTimeout(() => {
      els.tagline.textContent = TAGLINES[index];
      els.tagline.style.opacity = "1";
    }, 300);
  }, 7000);
}

/* ---------------- Events ---------------- */

els.addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!addRestaurant(els.nameInput.value)) {
    focusAdd();
    return;
  }
  els.nameInput.value = "";
  els.nameInput.focus();
});

els.modeTabs.forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
els.sideTabs.forEach((tab) => tab.addEventListener("click", () => setSideTab(tab.dataset.panel)));
els.goBtn.addEventListener("click", play);
els.hubBtn.addEventListener("click", play);
els.emptyAddBtn.addEventListener("click", focusAdd);

els.raceLength.querySelectorAll("button").forEach((btn) => {
  btn.addEventListener("click", () => {
    store.settings.raceLen = Number(btn.dataset.len);
    saveStore();
    renderStage();
  });
});

els.noRepeat.addEventListener("change", () => {
  store.settings.noRepeat = els.noRepeat.checked;
  commit();
});
els.bias.addEventListener("change", () => {
  store.settings.bias = els.bias.checked;
  commit();
});

els.shareBtn.addEventListener("click", shareLineup);
els.clearBtn.addEventListener("click", clearLineup);

els.eatBtn.addEventListener("click", confirmEat);
els.rerollBtn.addEventListener("click", reroll);
els.resultClose.addEventListener("click", closeResult);
els.dialog.addEventListener("click", (event) => {
  if (event.target === els.dialog) closeResult();
});

els.soundBtn.addEventListener("click", () => {
  store.settings.sound = !store.settings.sound;
  saveStore();
  applySound();
  sfx.pop();
});

els.themeBtn.addEventListener("click", () => {
  store.settings.theme = effectiveTheme() === "dark" ? "light" : "dark";
  saveStore();
  applyTheme();
});

document.addEventListener("click", (event) => {
  if (!els.emojiPop.hidden && !event.target.closest("#emojiPop, .entry-emoji")) closeEmojiPicker();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.emojiPop.hidden) closeEmojiPicker();
});

let resizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    closeEmojiPicker();
    if (store.settings.mode === "race") drawRace();
    else drawWheel();
  });
});

matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);

/* ---------------- Boot ---------------- */

if (!MODE_INFO[store.settings.mode]) store.settings.mode = "wheel";
loadSharedLineup();
applyTheme();
applySound();
render();
rotateTagline();
// Fonts load after first paint; redraw the canvases so labels use them.
document.fonts?.ready.then(() => renderStage());
