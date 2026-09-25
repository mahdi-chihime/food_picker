"use strict";

/* =========================================================================
   Foodie Pick Teams: a shared lineup, history and ratings, plus live spins.
   Runs only when config.js has Supabase keys; otherwise the app stays solo.
   Data model and security rules live in supabase/schema.sql.
   ========================================================================= */

(() => {
  const cfg = window.FOODIE_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    store.team = null;
    return;
  }

  const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/dist/umd/supabase.js";
  const MODE_NAMES = { wheel: "wheel spin", race: "food race", knockout: "knockout" };

  const t = {
    sb: null,
    userId: null,
    channel: null,
    ready: false,
    queue: Promise.resolve(),
    refetchTimer: 0,
    members: [],
    online: new Set(),
    server: { restaurants: new Map(), lunches: new Set(), ratings: new Map() },
  };

  const q = (sel) => document.querySelector(sel);
  const dom = {
    btn: q("#teamBtn"),
    btnLabel: q("#teamBtnLabel"),
    badge: q("#onlineBadge"),
    dialog: q("#teamDialog"),
    close: q("#teamClose"),
    solo: q("#teamSolo"),
    inside: q("#teamIn"),
    nick: q("#nickInput"),
    createForm: q("#createTeamForm"),
    teamName: q("#teamNameInput"),
    bring: q("#bringLineup"),
    joinForm: q("#joinTeamForm"),
    joinCode: q("#joinCodeInput"),
    error: q("#teamError"),
    name: q("#teamName"),
    code: q("#teamCode"),
    copy: q("#copyInviteBtn"),
    members: q("#memberList"),
    leave: q("#leaveTeamBtn"),
  };

  /* ---------------- Boot ---------------- */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = () => reject(new Error("Could not load the team service"));
      document.head.append(tag);
    });
  }

  async function boot() {
    dom.btn.hidden = false;
    updateButton();
    const joinCode = takeJoinParam();
    try {
      await loadScript(SDK_URL);
      t.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      if (store.team) {
        await ensureSession();
        await enterTeam(store.team);
      }
    } catch (error) {
      if (store.team) toast(`Team offline: ${friendly(error)}`);
    }
    if (joinCode) openDialog(joinCode);
  }

  function takeJoinParam() {
    const params = new URLSearchParams(location.search);
    const code = (params.get("join") || "").trim().toUpperCase();
    if (!code) return null;
    params.delete("join");
    const rest = params.toString();
    history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
    return /^[A-Z0-9]{4,8}$/.test(code) ? code : null;
  }

  // Sign in lazily and anonymously: no email or password, the browser remembers you.
  async function ensureSession() {
    if (t.userId) return;
    if (!t.sb) throw new Error("Team service is still loading, try again in a second");
    const { data } = await t.sb.auth.getSession();
    if (data.session) {
      t.userId = data.session.user.id;
      return;
    }
    const { data: signed, error } = await t.sb.auth.signInAnonymously();
    if (error) throw error;
    t.userId = signed.user.id;
  }

  function friendly(error) {
    const msg = (error && error.message) || String(error);
    if (/anonymous/i.test(msg)) return "Teams aren't switched on yet (enable anonymous sign-ins in Supabase)";
    if (/fetch|network/i.test(msg)) return "Can't reach the server. Check your connection";
    return msg;
  }

  /* ---------------- Entering and leaving ---------------- */

  async function enterTeam(team, { carry = null } = {}) {
    if (t.channel) {
      t.sb.removeChannel(t.channel);
      t.channel = null;
    }
    if (!store.solo) store.solo = { restaurants: store.restaurants, history: store.history };
    store.team = { id: team.id, name: team.name, code: team.join_code || team.code };
    store.restaurants = [];
    store.history = [];
    t.ready = false;
    resetServer();
    saveStore();
    render();
    updateButton();

    await refetch();
    subscribe();

    if (carry && carry.length) {
      const known = new Set(store.restaurants.map((r) => norm(r.name)));
      carry.forEach((r) => {
        if (known.has(norm(r.name))) return;
        store.restaurants.push({ id: uid(), name: r.name, emoji: r.emoji, tickets: r.tickets || 1, out: false });
      });
      commit();
    }
  }

  function leaveLocal() {
    if (t.channel) t.sb.removeChannel(t.channel);
    t.channel = null;
    store.team = null;
    if (store.solo) {
      store.restaurants = store.solo.restaurants;
      store.history = store.solo.history;
      store.solo = null;
    }
    t.ready = false;
    t.members = [];
    t.online = new Set();
    resetServer();
    saveStore();
    render();
    updateButton();
    renderDialog();
  }

  async function leaveTeam() {
    if (!store.team) return;
    if (!window.confirm(`Leave ${store.team.name}? You can rejoin later with the code.`)) return;
    const teamId = store.team.id;
    try {
      await t.sb.from("team_members").delete().eq("team_id", teamId).eq("user_id", t.userId);
    } catch (_) { /* still leave locally */ }
    leaveLocal();
    toast("You left the team. Back to solo mode 🍽️");
  }

  /* ---------------- Sync: local edits -> server ---------------- */

  function resetServer() {
    t.server = { restaurants: new Map(), lunches: new Set(), ratings: new Map() };
  }

  const rowOf = (r, index, teamId) => ({
    id: r.id,
    team_id: teamId,
    name: r.name,
    emoji: r.emoji,
    tickets: r.tickets || 1,
    sitting_out: Boolean(r.out),
    position: index,
  });

  // Compare the in-memory lists against the last known server state and
  // return the writes needed. Snapshots update right away so a quick second
  // edit only sends what changed since.
  function diff() {
    const teamId = store.team.id;
    const rows = store.restaurants.map((r, i) => rowOf(r, i, teamId));
    const ids = new Set(rows.map((r) => r.id));
    const upsertRestaurants = rows.filter((row) => t.server.restaurants.get(row.id) !== JSON.stringify(row));
    const deleteRestaurants = [...t.server.restaurants.keys()].filter((id) => !ids.has(id));

    const lunchIds = new Set(store.history.map((e) => e.id));
    const insertLunches = store.history
      .filter((e) => !t.server.lunches.has(e.id))
      .map((e) => ({
        id: e.id,
        team_id: teamId,
        name: e.name,
        emoji: e.emoji || "🍽️",
        mode: MODE_NAMES[e.mode] ? e.mode : "wheel",
        created_at: new Date(e.ts).toISOString(),
      }));
    const deleteLunches = [...t.server.lunches].filter((id) => !lunchIds.has(id));

    const rate = [];
    const unrate = [];
    store.history.forEach((e) => {
      const mine = e.rating || null;
      if (mine === (t.server.ratings.get(e.id) || null)) return;
      if (mine) rate.push({ lunch_id: e.id, team_id: teamId, user_id: t.userId, rating: mine });
      else unrate.push(e.id);
    });

    rows.forEach((row) => t.server.restaurants.set(row.id, JSON.stringify(row)));
    deleteRestaurants.forEach((id) => t.server.restaurants.delete(id));
    insertLunches.forEach((l) => t.server.lunches.add(l.id));
    deleteLunches.forEach((id) => t.server.lunches.delete(id));
    rate.forEach((r) => t.server.ratings.set(r.lunch_id, r.rating));
    unrate.forEach((id) => t.server.ratings.delete(id));

    const empty = !upsertRestaurants.length && !deleteRestaurants.length && !insertLunches.length
      && !deleteLunches.length && !rate.length && !unrate.length;
    return empty ? null : { upsertRestaurants, deleteRestaurants, insertLunches, deleteLunches, rate, unrate };
  }

  async function apply(ops) {
    const sb = t.sb;
    const errors = [];
    const run = async (request) => {
      const { error } = await request;
      if (error) errors.push(error);
    };
    if (ops.upsertRestaurants.length) await run(sb.from("restaurants").upsert(ops.upsertRestaurants));
    if (ops.deleteRestaurants.length) await run(sb.from("restaurants").delete().in("id", ops.deleteRestaurants));
    if (ops.insertLunches.length) {
      await run(sb.from("lunches").upsert(ops.insertLunches, { onConflict: "id", ignoreDuplicates: true }));
    }
    if (ops.deleteLunches.length) await run(sb.from("lunches").delete().in("id", ops.deleteLunches));
    if (ops.rate.length) await run(sb.from("lunch_ratings").upsert(ops.rate));
    if (ops.unrate.length) {
      await run(sb.from("lunch_ratings").delete().eq("user_id", t.userId).in("lunch_id", ops.unrate));
    }
    if (errors.length) {
      toast(`Couldn't save to the team: ${friendly(errors[0])}`);
      await refetch();
    }
    ping();
  }

  hooks.onCommit = () => {
    if (!store.team || !t.ready || !t.userId) return;
    const ops = diff();
    if (!ops) return;
    t.queue = t.queue.then(() => apply(ops)).catch((error) => toast(friendly(error)));
  };

  /* ---------------- Sync: server -> local ---------------- */

  async function refetch() {
    const team = store.team;
    if (!team || !t.sb) return;
    const id = team.id;
    const sb = t.sb;
    const [teamRes, restRes, lunchRes, rateRes, memberRes] = await Promise.all([
      sb.from("teams").select("id,name,join_code").eq("id", id).maybeSingle(),
      sb.from("restaurants").select("*").eq("team_id", id).order("position").order("created_at"),
      sb.from("lunches").select("*").eq("team_id", id).order("created_at", { ascending: false }).limit(200),
      sb.from("lunch_ratings").select("lunch_id,user_id,rating").eq("team_id", id),
      sb.from("team_members").select("user_id,nickname").eq("team_id", id).order("joined_at"),
    ]);
    const failed = [teamRes, restRes, lunchRes, rateRes, memberRes].find((res) => res.error);
    if (failed) {
      toast(`Team sync hiccup: ${friendly(failed.error)}`);
      return;
    }
    if (!store.team || store.team.id !== id) return;
    if (!teamRes.data) {
      toast("You're no longer in that team");
      leaveLocal();
      return;
    }

    store.team = { ...store.team, name: teamRes.data.name, code: teamRes.data.join_code };
    t.members = memberRes.data || [];
    const nickOf = new Map(t.members.map((m) => [m.user_id, m.nickname]));
    const byLunch = new Map();
    (rateRes.data || []).forEach((r) => {
      if (!byLunch.has(r.lunch_id)) byLunch.set(r.lunch_id, []);
      byLunch.get(r.lunch_id).push(r);
    });

    store.restaurants = (restRes.data || []).map((row) => ({
      id: row.id,
      name: row.name,
      emoji: row.emoji,
      tickets: row.tickets,
      out: row.sitting_out,
    }));
    store.history = (lunchRes.data || []).map((row) => {
      const ratings = byLunch.get(row.id) || [];
      const mine = ratings.find((r) => r.user_id === t.userId);
      return {
        id: row.id,
        ts: Date.parse(row.created_at),
        name: row.name,
        emoji: row.emoji,
        mode: row.mode,
        rating: mine ? mine.rating : null,
        avg: ratings.length ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length : null,
        raters: ratings.length,
        by: nickOf.get(row.created_by) || undefined,
      };
    });

    resetServer();
    store.restaurants.forEach((r, i) => t.server.restaurants.set(r.id, JSON.stringify(rowOf(r, i, id))));
    store.history.forEach((e) => {
      t.server.lunches.add(e.id);
      if (e.rating) t.server.ratings.set(e.id, e.rating);
    });
    t.ready = true;

    saveStore();
    render();
    updateButton();
    renderDialog();

    // A teammate already locked in the pick we're looking at.
    if (ui.pending && els.dialog.open && store.history.some((e) => e.id === ui.pending.planId)) {
      ui.pending = null;
      closeResult();
      toast("🍴 Locked in by the team. See you there!");
    }
  }

  function scheduleRefetch() {
    clearTimeout(t.refetchTimer);
    t.refetchTimer = setTimeout(() => {
      t.queue = t.queue.then(refetch).catch(() => {});
    }, 250);
  }

  /* ---------------- Live channel ---------------- */

  function subscribe() {
    const team = store.team;
    if (!team) return;
    const channel = t.sb.channel(`team:${team.id}`, {
      config: { broadcast: { self: false }, presence: { key: t.userId } },
    });
    channel
      .on("broadcast", { event: "sync" }, scheduleRefetch)
      .on("broadcast", { event: "spin" }, ({ payload }) => onRemoteSpin(payload))
      .on("presence", { event: "sync" }, () => {
        t.online = new Set(Object.keys(channel.presenceState()));
        updateButton();
        renderDialog();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel.track({ nick: store.nick || "Someone" });
          scheduleRefetch();
        }
      });
    t.channel = channel;
  }

  function ping() {
    if (t.channel) t.channel.send({ type: "broadcast", event: "sync", payload: {} });
  }

  hooks.onPlan = (plan) => {
    if (store.team && t.channel) t.channel.send({ type: "broadcast", event: "spin", payload: { plan } });
  };

  // Teammates' data is still untrusted input: keep only well-formed fields.
  function sanitizePlan(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.entries)) return null;
    const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
    const entries = raw.entries.slice(0, 60).map((e) => ({
      id: str(e && e.id, 64),
      name: str(e && e.name, 40) || "???",
      emoji: str(e && e.emoji, 16) || "🍽️",
      tickets: clamp(Number(e && e.tickets) || 1, 1, 5),
      weight: clamp(Number(e && e.weight) || 1, 0.1, 10),
      bias: clamp(Number(e && e.bias) || 0, -0.1, 0.1),
      color: /^#[0-9a-f]{6}$/i.test(e && e.color) ? e.color : "#ff5a36",
    })).filter((e) => e.id);
    if (entries.length < 2) return null;
    return {
      id: str(raw.id, 64) || uid(),
      seed: Number(raw.seed) >>> 0,
      mode: MODE_NAMES[raw.mode] ? raw.mode : "wheel",
      raceLen: [10, 20, 40].includes(Number(raw.raceLen)) ? Number(raw.raceLen) : 20,
      by: str(raw.by, 24) || "A teammate",
      entries,
    };
  }

  function onRemoteSpin(payload) {
    const plan = sanitizePlan(payload && payload.plan);
    if (!plan) return;
    if (ui.busy) {
      toast(`${plan.by} tried to start a ${MODE_NAMES[plan.mode]} while one was running`);
      return;
    }
    toast(`${plan.by} started a ${MODE_NAMES[plan.mode]}! 👀`);
    runPlan(plan);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && store.team) scheduleRefetch();
  });

  /* ---------------- UI ---------------- */

  function updateButton() {
    const inTeam = Boolean(store.team);
    dom.btnLabel.textContent = inTeam ? store.team.name : "Team up";
    dom.btn.setAttribute("aria-label", inTeam ? `Team: ${store.team.name}` : "Create or join a team");
    const count = t.online.size;
    dom.badge.hidden = !inTeam || !count;
    dom.badge.textContent = String(count);
    dom.badge.title = `${count} online`;
  }

  function renderDialog() {
    const inTeam = Boolean(store.team);
    dom.solo.hidden = inTeam;
    dom.inside.hidden = !inTeam;
    if (!inTeam) return;
    dom.name.textContent = store.team.name;
    dom.code.textContent = store.team.code || "…";
    const sorted = [...t.members].sort((a, b) =>
      Number(t.online.has(b.user_id)) - Number(t.online.has(a.user_id)) || a.nickname.localeCompare(b.nickname));
    dom.members.replaceChildren(...sorted.map((m) => h("li", {},
      h("span", { class: `status${t.online.has(m.user_id) ? " on" : ""}`, title: t.online.has(m.user_id) ? "Online" : "Offline" }),
      m.nickname,
      m.user_id === t.userId ? h("small", {}, "you") : null,
    )));
  }

  function openDialog(prefillCode) {
    dom.nick.value = store.nick || "";
    dom.error.textContent = "";
    if (prefillCode) dom.joinCode.value = prefillCode;
    renderDialog();
    if (typeof dom.dialog.showModal === "function") dom.dialog.showModal();
    else dom.dialog.setAttribute("open", "");
    if (!store.team) (dom.nick.value ? (prefillCode ? dom.joinCode : dom.teamName) : dom.nick).focus();
  }

  function closeDialog() {
    if (dom.dialog.open) dom.dialog.close();
  }

  function requireNick() {
    const nick = cleanName(dom.nick.value).slice(0, 24);
    if (!nick) {
      dom.error.textContent = "Pick a nickname first so your team knows who's who 🙂";
      dom.nick.focus();
      return null;
    }
    store.nick = nick;
    saveStore();
    return nick;
  }

  function setFormsBusy(busy) {
    dom.dialog.querySelectorAll("form button, form input").forEach((node) => { node.disabled = busy; });
  }

  async function createTeam(event) {
    event.preventDefault();
    const nick = requireNick();
    const name = cleanName(dom.teamName.value);
    if (!nick) return;
    if (!name) {
      dom.teamName.focus();
      return;
    }
    dom.error.textContent = "";
    setFormsBusy(true);
    try {
      await ensureSession();
      const { data, error } = await t.sb.rpc("create_team", { p_name: name, p_nick: nick });
      if (error) throw error;
      const team = Array.isArray(data) ? data[0] : data;
      const carry = dom.bring.checked ? (store.solo || store).restaurants.slice() : null;
      await enterTeam(team, { carry });
      renderDialog();
      burstConfetti("🎉");
      toast(`🎉 ${team.name} is ready. Send the invite link to your crew!`);
    } catch (error) {
      dom.error.textContent = friendly(error);
    } finally {
      setFormsBusy(false);
    }
  }

  async function joinTeam(event) {
    event.preventDefault();
    const nick = requireNick();
    const code = dom.joinCode.value.trim().toUpperCase();
    if (!nick) return;
    if (!code) {
      dom.joinCode.focus();
      return;
    }
    dom.error.textContent = "";
    setFormsBusy(true);
    try {
      await ensureSession();
      const { data, error } = await t.sb.rpc("join_team", { p_code: code, p_nick: nick });
      if (error) throw error;
      const team = Array.isArray(data) ? data[0] : data;
      await enterTeam(team);
      renderDialog();
      burstConfetti("👋");
      toast(`👋 Welcome to ${team.name}, ${nick}!`);
    } catch (error) {
      dom.error.textContent = friendly(error);
    } finally {
      setFormsBusy(false);
    }
  }

  async function copyInvite() {
    if (!store.team) return;
    const url = `${location.origin}${location.pathname}?join=${store.team.code}`;
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: `Join ${store.team.name} on Foodie Pick`, text: "Help pick lunch!", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast("🔗 Invite link copied. Paste it in the group chat!");
    } catch (_) {
      window.prompt("Copy this invite link:", url);
    }
  }

  dom.btn.addEventListener("click", () => openDialog());
  dom.close.addEventListener("click", closeDialog);
  dom.dialog.addEventListener("click", (event) => {
    if (event.target === dom.dialog) closeDialog();
  });
  dom.createForm.addEventListener("submit", createTeam);
  dom.joinForm.addEventListener("submit", joinTeam);
  dom.copy.addEventListener("click", copyInvite);
  dom.leave.addEventListener("click", leaveTeam);
  dom.joinCode.addEventListener("input", () => {
    dom.joinCode.value = dom.joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  boot();
})();
