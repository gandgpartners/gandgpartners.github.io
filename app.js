/* ============================================================
   G&G — app.js  (Glory & Grace church partnership platform)
   Vanilla JS, no build step, served straight to the browser.

   A live partnership space: sign in with your email + password, get a
   profile (a display name that's yours across devices), step into the live
   Main Portal, and connect in real time in any partnership room —
   Gold, Platinum, Diamond, and Light.

   Layout: rooms live in a "Rooms" dropdown menu at the top right; your
   profile lives in a profile dropdown next to it. The page itself is the
   live conversation.

   Runs on Supabase with only the publishable key:
   • Profiles ... Supabase Auth (email + password). Your display name lives
                  on your own Auth record (user_metadata), so it follows
                  your account and needs no table.
   • Live chat .. Supabase Realtime Broadcast — messages between everyone in
                  a room, instantly.
   • Who's here . Supabase Realtime Presence — a live count of who's in the
                  room right now.
   • Saved chat . the `messages` table (supabase/schema.sql) keeps history
                  permanently: it loads when a room opens and every member
                  message is stored until its author deletes it. Guests can
                  connect live in the Main Portal but their messages aren't
                  saved.

   Only the PUBLISHABLE key belongs in this file — it's public by design.
   The secret / service-role key must NEVER be added here or committed.
   ============================================================ */

const SUPABASE_URL = "https://dvhmhxhpimlvcdbkkgev.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_4k06QtH_wQn2jLPTYKEoKg_219yaujZ";
// The client is named `sb`, NOT `supabase`: the Supabase UMD script already
// registers a global `supabase` (the library), and re-declaring that name
// throws a page-breaking SyntaxError that blanks the whole app. Keep it `sb`.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ---- rooms ----
// The Main Portal is the live home everyone lands in — open to ALL visitors,
// signed in or not. The four partnership rooms — Gold, Platinum, Diamond and
// Light — ask for a signed-in profile so your voice carries your name.
const MAIN_CHANNEL = { id: "main", name: "Main Portal", guestOpen: true };

const ROOM_GROUPS = [
  {
    key: "portal",
    label: "THE PORTAL",
    rooms: [MAIN_CHANNEL],
  },
  {
    key: "partnership",
    label: "PARTNERSHIP ROOMS",
    rooms: [
      { id: "gold", name: "Gold" },
      { id: "platinum", name: "Platinum" },
      { id: "diamond", name: "Diamond" },
      { id: "light", name: "Light" },
    ],
  },
];

const CHANNELS = ROOM_GROUPS.flatMap((g) =>
  g.rooms.map((room) => ({ ...room, groupKey: g.key, groupLabel: g.label }))
);

// Per-room line icons (SVG, inherit currentColor) — shown in the Rooms menu and
// the chat header in place of the old emoji: Main Portal = gateway/arch,
// Gold = medal, Platinum = trophy, Diamond = gem, Light = radiant sun.
const ROOM_ICONS = {
  main: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V11a7 7 0 0 1 14 0v10"/><path d="M3 21h18"/><path d="M12 21v-6"/></svg>',
  gold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3l3 6M16 3l-3 6M8 3h8"/><circle cx="12" cy="15" r="5.5"/></svg>',
  platinum: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4.5a2.5 2.5 0 0 0 2.7 3.4M17 6h2.5a2.5 2.5 0 0 1-2.7 3.4"/><path d="M12 13v3M9 20h6M9.6 20l.4-4h4l.4 4"/></svg>',
  diamond: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l3 5.5L12 21 3 8.5z"/><path d="M3 8.5h18M9 3l3 5.5L15 3M8.5 8.5 12 21M15.5 8.5 12 21"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.1 5.1l1.8 1.8M17.1 17.1l1.8 1.8M18.9 5.1l-1.8 1.8M6.9 17.1l-1.8 1.8"/></svg>',
};
function roomIcon(id) {
  return ROOM_ICONS[id] || ROOM_ICONS.main;
}

function channelById(id) {
  return CHANNELS.find((c) => c.id === id) || null;
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}
function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
  } catch (e) {
    return "";
  }
}
// A local-only id for live messages that aren't saved to the DB (guest posts,
// or any post made while the table is briefly unreachable).
function clientId() {
  return "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

// ---- identity ----
// A stable per-browser guest id so ANY visitor can connect in the free Main
// Portal with no account. Signed-in members use their chosen display name.
function guestId() {
  let g = null;
  try { g = localStorage.getItem("gg_guest_id"); } catch (e) {}
  if (!g) {
    g = "guest-" + Math.random().toString(36).slice(2, 6);
    try { localStorage.setItem("gg_guest_id", g); } catch (e) {}
  }
  return g;
}
// The display name shown in chat / presence for the current visitor.
function displayName() {
  if (state.session) {
    const meta = state.session.user.user_metadata || {};
    return meta.display_name || String(state.session.user.email || "").split("@")[0] || "partner";
  }
  return guestId();
}
function isGuest() {
  return !state.session;
}
// Can the current user delete this message? Only signed-in members, and only
// their own saved messages (a numeric DB id + a matching user_id).
function canDelete(m) {
  return !!(state.session && m && m.user_id && m.user_id === state.session.user.id);
}

// Remember the last email so it's prefilled next time. The Supabase session is
// persisted by the client, so a logged-in member stays logged in across
// reloads and the browser's own password manager saves the password.
function rememberedEmail() {
  try { return localStorage.getItem("gg_last_email") || ""; } catch (e) { return ""; }
}
function rememberEmail(email) {
  try { localStorage.setItem("gg_last_email", email); } catch (e) {}
}

// ---- state ----
let state = {
  session: null,
  loading: true,
  activeChannelId: null,
  messages: [],
  rt: null,          // active realtime channel
  rtReady: false,
  onlineCount: 0,
};

async function refreshSession() {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  state.loading = false;

  // If they're sitting in a room that now needs a sign-in they no longer have
  // (they just signed out), drop them so the Main Portal fallback kicks in.
  const active = channelById(state.activeChannelId);
  if (active && !isChannelUnlocked(active)) {
    teardownRealtime();
    state.activeChannelId = null;
    state.messages = [];
  }

  render();

  // EVERYONE — member or guest — opens straight into the live Main Portal.
  // Only when nothing is active, so a later token refresh doesn't yank someone
  // out of a room they deliberately opened.
  if (!state.activeChannelId) {
    await selectChannel("main");
  } else {
    // Re-track presence under the (possibly new) name after an auth change.
    if (state.rt && state.rtReady) state.rt.track({ name: displayName() });
  }
}

async function signUp(email, password, name) {
  rememberEmail(email);
  const opts = name ? { data: { display_name: name } } : undefined;
  const { data, error } = await sb.auth.signUp({ email, password, options: opts });
  if (error) {
    alert("Couldn't sign up: " + error.message);
    return;
  }
  // Email confirmation ON (default) → no session; user must click the link.
  // Confirmation OFF → a session comes back and onAuthStateChange logs them in.
  if (!data.session) {
    alert("Welcome to the partnership! Check your email for a confirmation link, then log in.");
  }
}

async function signIn(email, password) {
  rememberEmail(email);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) alert("Couldn't sign in: " + error.message);
}

async function signOut() {
  await sb.auth.signOut();
}

async function editName() {
  if (!state.session) return;
  const current = displayName();
  const name = prompt("Your display name (shown in the rooms):", current);
  if (name == null) return;
  const trimmed = name.trim().slice(0, 32);
  if (!trimmed || trimmed === current) return;
  const { error } = await sb.auth.updateUser({ data: { display_name: trimmed } });
  if (error) {
    alert("Couldn't save your name: " + error.message);
    return;
  }
  render();
  if (state.rt && state.rtReady) state.rt.track({ name: trimmed });
}

// Every room is open to EVERYONE — any visitor can freely change into any room,
// signed in or not, so room-switching is never blocked. (Signed-in members'
// messages persist to the DB; guests connect live like they do in the Main
// Portal — the group labels are just topic headings.)
function isChannelUnlocked(channel) {
  return !!channel;
}

// ---- realtime chat + presence ----
// Tear down the current room's realtime channel. Deliberately SYNCHRONOUS and
// fire-and-forget: awaiting untrack() on a channel that is still mid-subscribe
// can stall for seconds, which used to make the FIRST room switch after page
// load look broken ("can't change rooms"). removeChannel already cleans up.
function teardownRealtime() {
  if (state.rt) {
    try { state.rt.untrack(); } catch (e) {}
    try { sb.removeChannel(state.rt); } catch (e) {}
    state.rt = null;
  }
  state.rtReady = false;
  state.onlineCount = 0;
}

async function selectChannel(channelId) {
  const channel = channelById(channelId);
  if (!channel || !isChannelUnlocked(channel)) return;

  // Switch INSTANTLY — set the active room and repaint before any async work,
  // so the UI never looks stuck no matter what the old channel is doing.
  teardownRealtime();
  state.activeChannelId = channelId;
  state.messages = [];
  renderRoomsMenu();
  renderChatHeader();
  renderMessages();
  renderPresence();

  // Saved history load — works when the `messages` table exists (schema.sql).
  // If it doesn't, this quietly fails and the room is simply live-only.
  try {
    const { data, error } = await sb
      .from("messages")
      .select("id, channel_id, user_id, author_name, content, created_at")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (!error && data && state.activeChannelId === channelId) {
      state.messages = data.map((m) => ({ ...m, is_guest: false }));
    }
  } catch (e) {
    /* no table — live-only room */
  }
  renderMessages();

  // Live messages (Broadcast) + who's-online (Presence) on one channel.
  const myKey = state.session ? state.session.user.id : guestId();
  const rt = sb.channel(`room:${channelId}`, {
    config: { broadcast: { self: false }, presence: { key: myKey } },
  });
  rt.on("broadcast", { event: "msg" }, ({ payload }) => {
    if (state.activeChannelId === channelId) {
      // Guard against a duplicate if we somehow already have this id.
      if (!state.messages.some((m) => String(m.id) === String(payload.id))) {
        state.messages.push(payload);
        renderMessages();
      }
    }
  });
  rt.on("broadcast", { event: "del" }, ({ payload }) => {
    if (state.activeChannelId === channelId) {
      state.messages = state.messages.filter((m) => String(m.id) !== String(payload.id));
      renderMessages();
    }
  });
  // Count unique people in the room. Listen to sync AND the join/leave diffs:
  // the client that subscribed first doesn't always get a `sync` when a later
  // member joins, but it does get a `join` diff — so recount on all three.
  const recount = () => {
    state.onlineCount = Object.keys(rt.presenceState()).length;
    renderPresence();
  };
  rt.on("presence", { event: "sync" }, recount);
  rt.on("presence", { event: "join" }, recount);
  rt.on("presence", { event: "leave" }, recount);
  rt.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      // If the user already switched away before this finished subscribing,
      // drop this orphaned channel instead of marking it ready.
      if (state.activeChannelId !== channelId) { try { sb.removeChannel(rt); } catch (e) {} return; }
      state.rtReady = true;
      await rt.track({ name: displayName() });
    }
  });
  state.rt = rt;
}

async function sendMessage(content) {
  const text = content.trim();
  const channel = channelById(state.activeChannelId);
  if (!channel || !isChannelUnlocked(channel) || !text) return;

  let msg = {
    id: null,
    channel_id: channel.id,
    user_id: state.session ? state.session.user.id : null,
    author_name: displayName(),
    is_guest: isGuest(),
    content: text,
    created_at: new Date().toISOString(),
  };

  // Members: SAVE to the DB first so history persists and every client shares
  // the same message id (needed so deletes match everywhere). If the table
  // isn't there, fall back to a live-only client id.
  if (state.session) {
    try {
      const { data, error } = await sb
        .from("messages")
        .insert({
          channel_id: channel.id,
          user_id: state.session.user.id,
          author_name: msg.author_name,
          content: text,
        })
        .select("id, channel_id, user_id, author_name, content, created_at")
        .single();
      if (!error && data) msg = { ...data, is_guest: false };
      else msg.id = clientId();
    } catch (e) {
      msg.id = clientId();
    }
  } else {
    // Guests connect live but aren't saved (RLS only lets members write).
    msg.id = clientId();
  }

  // Local echo (broadcast is self:false), then push live to the room.
  if (state.activeChannelId === channel.id) {
    state.messages.push(msg);
    renderMessages();
  }
  if (state.rt && state.rtReady) {
    state.rt.send({ type: "broadcast", event: "msg", payload: msg });
  }
}

async function deleteMessage(id) {
  const idx = state.messages.findIndex((m) => String(m.id) === String(id));
  if (idx === -1) return;
  const m = state.messages[idx];
  if (!canDelete(m)) return;
  if (!confirm("Delete this message for everyone?")) return;

  // Remove locally first for a snappy feel.
  state.messages.splice(idx, 1);
  renderMessages();

  // Remove the saved row (numeric ids are persisted DB rows).
  if (/^\d+$/.test(String(m.id))) {
    try { await sb.from("messages").delete().eq("id", m.id); } catch (e) {}
  }
  // Tell everyone else viewing the room to drop it too.
  if (state.rt && state.rtReady) {
    state.rt.send({ type: "broadcast", event: "del", payload: { id: m.id } });
  }
}

// ---- menus (rooms + profile dropdowns in the header) ----
// On phones the panels render as a centered modal (see style.css); the body
// `menu-open` class drives the dimmed backdrop behind them.
function syncBackdrop() {
  // No dimmed backdrop for any menu — opening the Rooms modal (or the profile
  // dropdown) never dims the screen behind it.
  document.body.classList.remove("menu-open");
}
function closeMenus() {
  document.querySelectorAll(".menu-panel").forEach((p) => (p.hidden = true));
  document.querySelectorAll(".menu-trigger").forEach((t) => t.setAttribute("aria-expanded", "false"));
  document.body.classList.remove("menu-open");
}
function toggleMenu(trigger, panel) {
  const willOpen = panel.hidden;
  closeMenus();
  panel.hidden = !willOpen;
  trigger.setAttribute("aria-expanded", String(willOpen));
  syncBackdrop();
}

// ---- rendering ----
function renderProfile() {
  const bar = document.getElementById("profileBar");
  if (state.loading) {
    bar.innerHTML = `<span class="auth-loading">Loading…</span>`;
    return;
  }
  if (state.session) {
    const name = displayName();
    const email = state.session.user.email || "";
    const initial = (name.trim()[0] || "G").toUpperCase();
    const since = formatDate(state.session.user.created_at);
    bar.innerHTML = `
      <div class="menu" id="profileMenu">
        <button class="menu-trigger profile-trigger" id="profileTrigger" aria-haspopup="true" aria-expanded="false">
          <span class="avatar-mini">${escapeHtml(initial)}</span>
          <span class="who-name">${escapeHtml(name)}</span>
          <span class="caret">▾</span>
        </button>
        <div class="menu-panel profile-panel" id="profilePanel" hidden>
          <div class="profile-head">
            <div class="avatar">${escapeHtml(initial)}</div>
            <div class="profile-id">
              <div class="profile-name">${escapeHtml(name)}</div>
              <div class="profile-email">${escapeHtml(email)}</div>
            </div>
          </div>
          ${since ? `<div class="profile-meta">Partner since ${escapeHtml(since)}</div>` : ""}
          <div class="profile-actions">
            <button class="btn btn-outline btn-small" id="editNameBtn">Edit name</button>
            <button class="btn btn-ghost btn-small" id="signOutBtn">Sign out</button>
          </div>
        </div>
      </div>`;
    const trigger = document.getElementById("profileTrigger");
    const panel = document.getElementById("profilePanel");
    trigger.addEventListener("click", () => toggleMenu(trigger, panel));
    document.getElementById("editNameBtn").addEventListener("click", () => { closeMenus(); editName(); });
    document.getElementById("signOutBtn").addEventListener("click", () => { closeMenus(); signOut(); });
  } else {
    bar.innerHTML = `
      <form id="authForm" class="auth-form">
        <input type="email" id="authEmail" name="email" placeholder="you@email.com" autocomplete="username" required value="${escapeHtml(rememberedEmail())}" />
        <input type="password" id="authPassword" name="password" placeholder="password" autocomplete="current-password" required minlength="6" />
        <button type="submit" class="btn btn-primary btn-small">Log in</button>
        <button type="button" id="signUpBtn" class="btn btn-outline btn-small">Join</button>
      </form>`;
    const form = document.getElementById("authForm");
    const emailInput = document.getElementById("authEmail");
    const passwordInput = document.getElementById("authPassword");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      signIn(emailInput.value.trim(), passwordInput.value);
    });
    document.getElementById("signUpBtn").addEventListener("click", () => {
      if (!form.reportValidity()) return;
      const name = (prompt("Pick a display name for the partnership (shown in the rooms):") || "").trim().slice(0, 32);
      signUp(emailInput.value.trim(), passwordInput.value, name);
    });
  }
}

function renderRoomsMenu() {
  const panel = document.getElementById("roomsPanel");
  if (!panel) return;
  panel.innerHTML = ROOM_GROUPS
    .map((g) => {
      const items = g.rooms
        .map((room) => {
          const channel = channelById(room.id);
          const unlocked = isChannelUnlocked(channel);
          const active = state.activeChannelId === channel.id;
          return `
            <li class="channel-item ${unlocked ? "" : "locked"} ${active ? "active" : ""}" data-channel="${channel.id}" title="${escapeHtml(channel.name)}">
              <span class="room-ico">${roomIcon(channel.id)}</span>
              <span class="room-name">${escapeHtml(channel.name)}</span>
            </li>`;
        })
        .join("");
      return `<div class="channel-group"><div class="channel-group-label group-${g.key}">${g.label}</div><ul>${items}</ul></div>`;
    })
    .join("");

  panel.querySelectorAll(".channel-item:not(.locked)").forEach((el) => {
    el.addEventListener("click", () => {
      selectChannel(el.dataset.channel);
      closeMenus();
    });
  });
}

function renderChatHeader() {
  const channel = channelById(state.activeChannelId);
  const el = document.getElementById("chatTitle");
  if (!channel) { el.textContent = "Pick a room"; return; }
  el.innerHTML = `<span class="room-ico">${roomIcon(channel.id)}</span><span class="room-name">${escapeHtml(channel.name)}</span>`;
}

function renderPresence() {
  const el = document.getElementById("presence");
  if (!state.activeChannelId || !state.rtReady) {
    el.textContent = "";
    el.classList.add("empty");
    return;
  }
  const n = Math.max(state.onlineCount, 1);
  el.textContent = n === 1 ? "1 here" : n + " here";
  el.classList.remove("empty");
}

function renderMessages() {
  const box = document.getElementById("chatMessages");
  const channel = channelById(state.activeChannelId);
  const input = document.getElementById("chatInput");
  const sendBtn = document.querySelector("#chatForm button");

  if (!channel) {
    box.innerHTML = `<p class="chat-placeholder">No room selected yet.</p>`;
    input.disabled = true;
    sendBtn.disabled = true;
    return;
  }

  const unlocked = isChannelUnlocked(channel);
  input.disabled = !unlocked;
  sendBtn.disabled = !unlocked;
  input.placeholder = unlocked ? "Message the room…" : "Sign in to enter this room";

  if (!unlocked) {
    box.innerHTML = `<p class="chat-placeholder">🔒 ${escapeHtml(channel.name)} is a partnership room — log in or join to step inside.</p>`;
    return;
  }

  const me = displayName();
  box.innerHTML = state.messages.length
    ? state.messages
        .map((m) => {
          const cls = m.is_guest ? "guest" : m.author_name === me ? "me" : "";
          const del = canDelete(m)
            ? `<button class="msg-del" data-id="${escapeHtml(String(m.id))}" title="Delete message" aria-label="Delete message">×</button>`
            : "";
          return `
        <div class="chat-message">
          <span class="chat-author ${cls}">${escapeHtml(m.author_name || "partner")}</span>
          <span class="chat-time">${escapeHtml(formatTime(m.created_at))}</span>
          <span class="chat-text">${escapeHtml(m.content)}</span>
          ${del}
        </div>`;
        })
        .join("")
    : `<p class="chat-placeholder">No messages yet — say hi 👋</p>`;

  box.querySelectorAll(".msg-del").forEach((el) => {
    el.addEventListener("click", () => deleteMessage(el.dataset.id));
  });
  box.scrollTop = box.scrollHeight;
}

function render() {
  renderProfile();
  renderRoomsMenu();
  renderChatHeader();
  renderMessages();
  renderPresence();
}

document.addEventListener("DOMContentLoaded", () => {
  render();
  refreshSession();
  sb.auth.onAuthStateChange(() => refreshSession());

  // Rooms dropdown trigger (the panel content is (re)rendered by renderRoomsMenu).
  const roomsTrigger = document.getElementById("roomsTrigger");
  const roomsPanel = document.getElementById("roomsPanel");
  if (roomsTrigger && roomsPanel) {
    roomsTrigger.addEventListener("click", () => toggleMenu(roomsTrigger, roomsPanel));
  }
  // Tapping/clicking anywhere outside an open menu closes it. Listen for both
  // click AND touchstart: on iOS Safari a document-level `click` doesn't fire
  // reliably for taps on non-interactive areas, so touch needs its own hook.
  const closeIfOutside = (e) => {
    if (!e.target.closest(".menu")) closeMenus();
  };
  document.addEventListener("click", closeIfOutside);
  document.addEventListener("touchstart", closeIfOutside, { passive: true });
  // Esc closes menus too.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenus();
  });

  document.getElementById("chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("chatInput");
    sendMessage(input.value);
    input.value = "";
  });
});
