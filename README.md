# G&G — Glory & Grace Partnership Platform

The partnership platform for **Glory & Grace church**. Sign in with your email
and password, step into the live **Main Portal**, and connect in real time with
the partnership across four rooms — **Gold**, **Platinum**, **Diamond**, and
**Light**.

Static site — vanilla HTML/CSS/JS, no build step. Deployed on GitHub Pages at
**https://gandgpartners.github.io**.

## Design

- **Font:** [Fredoka](https://fonts.google.com/specimen/Fredoka)
- **Palette:** `#FFFFFF` (white base) · `#00F7FF` (cyan) · `#FA00FF` (magenta)
- **Rooms:** Main Portal ✦ (open to everyone) + Gold 🥇, Platinum 🏆, Diamond 💎,
  Light 🕊️ (open to signed-in partners)

## How it works (Supabase)

Project: `dvhmhxhpimlvcdbkkgev` — everything runs on the **publishable** key
only (public by design).

| Feature      | Backed by |
|--------------|-----------|
| Profiles     | Supabase **Auth** — email + password. Your display name lives on your own Auth record (`user_metadata`), so it follows your account with no table. |
| Live chat    | Supabase **Realtime Broadcast** — messages between everyone in a room, instantly. |
| Who's here   | Supabase **Realtime Presence** — a live count of who's in the room. |
| Saved chat   | The `messages` table (`supabase/schema.sql`) — history loads when a room opens, member messages persist, and stay saved until their author deletes them. Guests can talk live in the Main Portal but their messages aren't saved. |

### Setup

1. Run `supabase/schema.sql` once in the Supabase **SQL Editor** (dashboard) to
   enable permanent history. Until then, rooms are live-only (no reload
   history) — everything else already works.
2. Auth → Providers → **Email**: email confirmation is ON by default (new
   accounts confirm via a link before first login). Turn it off in the
   dashboard for instant sign-up.

## Security

Only the **publishable** key (`sb_publishable_…`) appears in `app.js` — it's
meant to be public. The **secret** and **service-role** keys are never in this
repo and must never be committed. If they were shared anywhere, rotate them in
Supabase → Settings → API.
