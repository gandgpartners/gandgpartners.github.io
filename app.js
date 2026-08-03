/* ============================================================
   G&G — app.js  (Glory & Grace church partnership platform)
   Vanilla JS, no build step, served straight to the browser.

   A live partnership space: sign in with your email + password, get a
   profile (a display name that's yours across devices), and step into the
   live Main Portal. For now the Portal is the single room, and only the host
   account may post — everyone else signs in, reads, and is present.

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
// For now there is ONE room: the Main Portal, the live home everyone lands in,
// open to ALL visitors, signed in or not. The partnership rooms (Gold,
// Platinum, Diamond, Light) have been retired for now — we'll build back out
// from this single portal.
const MAIN_CHANNEL = { id: "main", name: "Main Portal", guestOpen: true };

const ROOM_GROUPS = [
  {
    key: "portal",
    label: "THE PORTAL",
    rooms: [MAIN_CHANNEL],
  },
  {
    key: "rooms",
    label: "ROOMS",
    // These require a signed-in profile to step inside (the Main Portal stays
    // open to guests). Posting everywhere is still host-only (see canSend()).
    rooms: [
      { id: "prophecy", name: "Prophecy" },
      { id: "prayer", name: "Prayer" },
      { id: "testimonies", name: "Testimonies" },
      { id: "announcements", name: "Announcements" },
    ],
  },
];

const CHANNELS = ROOM_GROUPS.flatMap((g) =>
  g.rooms.map((room) => ({ ...room, groupKey: g.key, groupLabel: g.label }))
);

// Room line icons (SVG, inherit currentColor) — shown in the Rooms menu and the
// chat header: Main Portal = gateway/arch, Prophecy = scroll, Prayer = hands/
// heart, Testimonies = speech bubble with a star, Announcements = megaphone.
const ROOM_ICONS = {
  main: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V11a7 7 0 0 1 14 0v10"/><path d="M3 21h18"/><path d="M12 21v-6"/></svg>',
  prophecy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h9a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6"/><path d="M4 6a2 2 0 0 1 4 0v12"/><path d="M11 8h5M11 12h5"/></svg>',
  prayer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-4.35-9-8.28C1.4 10.2 2.4 6.5 5.6 6.5c1.9 0 3.2 1.1 6.4 4 3.2-2.9 4.5-4 6.4-4 3.2 0 4.2 3.7 2.6 6.22C18.5 16.65 12 21 12 21z"/></svg>',
  testimonies: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/><path d="M12 7.5l1.2 2.4 2.6.3-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.3z"/></svg>',
  announcements: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10v4a1 1 0 0 0 1 1h3l5 4V5L7 9H4a1 1 0 0 0-1 1z"/><path d="M16 9a3 3 0 0 1 0 6"/><path d="M19 6.5a6 6 0 0 1 0 11"/></svg>',
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

// For now, ONLY this account may post — everyone else can sign in, log in, read
// and be present, but the composer stays closed to them. (The matching DB-level
// lock lives in supabase/schema.sql; this is the client-side half.)
const OWNER_EMAIL = "prophetdian@gmail.com";
function canSend() {
  return !!(
    state.session &&
    String(state.session.user.email || "").trim().toLowerCase() === OWNER_EMAIL
  );
}

// ---- media (photos + videos) ----
// Public Storage bucket (supabase/schema.sql). Files are uploaded AS-IS — no
// client-side resize or re-encode — so they keep their full original quality.
const MEDIA_BUCKET = "media";
// Safe object-path piece from a filename (keep the extension, strip the rest).
function safeName(name) {
  const n = String(name || "file");
  const dot = n.lastIndexOf(".");
  const ext = dot > -1 ? n.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) : "";
  return Math.random().toString(36).slice(2, 8) + (ext ? "." + ext : "");
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
    // Email already taken → it's an existing account, so the password was just
    // wrong. Point them back at Log in rather than "sign up failed".
    if (/already|registered|exists/i.test(error.message)) {
      alert("That email already has an account — check the password and Log in.");
    } else {
      alert("Couldn't create your account: " + error.message);
    }
    return;
  }
  // With email confirmation turned OFF, a session comes straight back and
  // onAuthStateChange signs them in immediately — no link to click. (If it were
  // ever turned back on, there'd be no session and they'd confirm by email.)
  if (!data.session) {
    alert("Almost there — check your email for a confirmation link, then log in.");
  }
}

async function signIn(email, password) {
  rememberEmail(email);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (!error) return;
  // Supabase returns the same "Invalid login credentials" whether the email has
  // no account OR the password is wrong — it won't say which. So offer to Join:
  // if they confirm, we create the account right here (and they're logged in on
  // the spot). If the email already existed, signUp tells them to fix the
  // password instead.
  if (/invalid login credentials/i.test(error.message)) {
    if (!confirm(`No account signs in with ${email} yet.\n\nCreate one now with this email and password?`)) return;
    const name = (prompt("Pick a display name for the partnership (shown in the rooms):") || "").trim().slice(0, 32);
    await signUp(email, password, name);
    return;
  }
  alert("Couldn't sign in: " + error.message);
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

// The Main Portal (guestOpen) is open to EVERYONE, signed in or not. Every other
// room requires a signed-in profile to step inside — guests see it locked until
// they log in. (Posting anywhere is separately host-only; see canSend().)
function isChannelUnlocked(channel) {
  if (!channel) return false;
  return channel.guestOpen || !!state.session;
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
      .select("id, channel_id, user_id, author_name, content, media_url, media_kind, created_at")
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
  // Only the owner account may post (for now). Guests and other members read.
  if (!canSend()) return;

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
        .select("id, channel_id, user_id, author_name, content, media_url, media_kind, created_at")
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

// Send a photo or video. Host-only (same gate as text). The file is uploaded to
// Storage UNCHANGED — full original quality — and the message carries its public
// URL. Any text currently in the box rides along as a caption.
async function sendMedia(file) {
  const channel = channelById(state.activeChannelId);
  if (!channel || !isChannelUnlocked(channel) || !canSend() || !file) return;
  const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
  if (!kind) { alert("Please choose a photo or a video."); return; }

  const input = document.getElementById("chatInput");
  const caption = (input && input.value.trim()) || null;

  const attachBtn = document.getElementById("attachBtn");
  if (attachBtn) attachBtn.disabled = true; // guard against double-send while uploading

  // Upload the ORIGINAL bytes as-is (no canvas/resize/compression) → full quality.
  const path = `${channel.id}/${Date.now()}-${safeName(file.name)}`;
  let publicUrl = null;
  try {
    const { error: upErr } = await sb.storage
      .from(MEDIA_BUCKET)
      .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
    if (upErr) { alert("Upload failed: " + upErr.message); return; }
    publicUrl = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch (e) {
    alert("Upload failed. Please try again.");
    return;
  } finally {
    if (attachBtn) attachBtn.disabled = !canSend();
  }

  let msg = {
    id: null,
    channel_id: channel.id,
    user_id: state.session.user.id,
    author_name: displayName(),
    is_guest: false,
    content: caption,
    media_url: publicUrl,
    media_kind: kind,
    created_at: new Date().toISOString(),
  };

  // Save the row so it persists and shares one id across clients.
  try {
    const { data, error } = await sb
      .from("messages")
      .insert({
        channel_id: channel.id,
        user_id: state.session.user.id,
        author_name: msg.author_name,
        content: caption,
        media_url: publicUrl,
        media_kind: kind,
      })
      .select("id, channel_id, user_id, author_name, content, media_url, media_kind, created_at")
      .single();
    if (!error && data) msg = { ...data, is_guest: false };
    else msg.id = clientId();
  } catch (e) {
    msg.id = clientId();
  }

  if (input) input.value = "";
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

// ---- full-quality photo lightbox ----
function openLightbox(src) {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  if (!lb || !img) return;
  img.src = src;
  lb.hidden = false;
  lb.setAttribute("aria-hidden", "false");
}
function closeLightbox() {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  if (!lb) return;
  lb.hidden = true;
  lb.setAttribute("aria-hidden", "true");
  if (img) img.src = "";
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
  // The submit button specifically — the form now also holds the attach (+)
  // button, so a bare "#chatForm button" would grab the wrong one.
  const sendBtn = document.querySelector('#chatForm button[type="submit"]');

  if (!channel) {
    box.innerHTML = `<p class="chat-placeholder">No room selected yet.</p>`;
    input.disabled = true;
    sendBtn.disabled = true;
    return;
  }

  const unlocked = isChannelUnlocked(channel);
  if (!unlocked) {
    input.disabled = true;
    sendBtn.disabled = true;
    box.innerHTML = `<p class="chat-placeholder">🔒 ${escapeHtml(channel.name)} — log in or join to step inside.</p>`;
    return;
  }

  // The room is open to read for everyone, but for now only the owner account
  // may post. Everyone else sees the conversation with the composer closed.
  const mayPost = canSend();
  input.disabled = !mayPost;
  sendBtn.disabled = !mayPost;
  const attachBtn = document.getElementById("attachBtn");
  if (attachBtn) attachBtn.disabled = !mayPost;
  input.placeholder = mayPost
    ? "Message the portal…"
    : state.session
    ? "Only the host can post here for now"
    : "Log in to follow the portal";

  const me = displayName();
  box.innerHTML = state.messages.length
    ? state.messages
        .map((m) => {
          const cls = m.is_guest ? "guest" : m.author_name === me ? "me" : "";
          const del = canDelete(m)
            ? `<button class="msg-del" data-id="${escapeHtml(String(m.id))}" title="Delete message" aria-label="Delete message">×</button>`
            : "";
          const text = m.content ? `<span class="chat-text">${escapeHtml(m.content)}</span>` : "";
          let media = "";
          if (m.media_url) {
            const url = escapeHtml(m.media_url);
            media = m.media_kind === "video"
              ? `<video class="chat-media" src="${url}" controls controlslist="nofullscreen noremoteplayback" disablepictureinpicture preload="metadata" playsinline webkit-playsinline draggable="false"></video>`
              : `<img class="chat-media" src="${url}" alt="" loading="lazy" draggable="false" />`;
          }
          // Photos and videos show CLEAN — just the media (and any caption). No
          // author name, no timestamp, no storage filename: the point is the
          // picture/clip itself, at full quality. Text-only messages still carry
          // their author + time as before.
          const isMedia = !!m.media_url;
          const author = isMedia ? "" : `<span class="chat-author ${cls}">${escapeHtml(m.author_name || "partner")}</span>`;
          const time = isMedia ? "" : `<span class="chat-time">${escapeHtml(formatTime(m.created_at))}</span>`;
          return `
        <div class="chat-message${isMedia ? " media-only" : ""}">
          ${author}
          ${time}
          ${text}
          ${media}
          ${del}
        </div>`;
        })
        .join("")
    : `<p class="chat-placeholder">No messages yet — say hi 👋</p>`;

  box.querySelectorAll(".msg-del").forEach((el) => {
    el.addEventListener("click", () => deleteMessage(el.dataset.id));
  });
  // Tap a photo to view it full-quality in the lightbox (no URL is opened).
  box.querySelectorAll("img.chat-media").forEach((img) => {
    img.addEventListener("click", () => openLightbox(img.src));
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
  // Esc closes menus too (and the photo lightbox).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeMenus(); closeLightbox(); }
  });

  // Tapping the photo lightbox anywhere closes it.
  const lightbox = document.getElementById("lightbox");
  if (lightbox) lightbox.addEventListener("click", closeLightbox);

  document.getElementById("chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("chatInput");
    sendMessage(input.value);
    input.value = "";
  });

  // Photo / video attach: the + button opens the file picker; picking a file
  // uploads it at full quality and posts it (host-only).
  const attachBtn = document.getElementById("attachBtn");
  const mediaInput = document.getElementById("mediaInput");
  if (attachBtn && mediaInput) {
    attachBtn.addEventListener("click", () => { if (!attachBtn.disabled) mediaInput.click(); });
    mediaInput.addEventListener("change", () => {
      const file = mediaInput.files && mediaInput.files[0];
      mediaInput.value = ""; // let the same file be picked again later
      if (file) sendMedia(file);
    });
  }
});
