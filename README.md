# Foodie Pick 🍽️

Can't decide where to eat? Add your spots and let the food gods pick.

Live: https://foodie-pick.netlify.app/

## Pick modes

- **🎡 Wheel**: classic spin. More chances = bigger slice.
- **🏁 Race**: every spot gets a racer. Hot-sauce boosts, food comas, first to the plate wins.
- **🥊 Knockout**: each spin knocks one out. Last bite standing wins.

## Features

- Emoji auto-picked from the restaurant name (tap it to change)
- Extra chances (×1–×5) per spot, "sit out today" toggle
- Skip yesterday's winner, and let star ratings tip the odds
- History with 1–5 star ratings, plus a Hall of Fame leaderboard
- Share a lineup as a link with the team
- Light/dark mode, sound toggle, works on phones

## Teams (shared, live)

Create a team, share the invite link, and everyone gets the same lineup, history and ratings.
When anyone spins, the same wheel / race plays on every teammate's screen at once.
No sign-up: people pick a nickname and their browser remembers them.

Teams run on [Supabase](https://supabase.com). Until `config.js` has keys, the app runs in solo mode
and the Team button stays hidden.

One-time setup:

1. Create a Supabase project (free tier is fine).
2. SQL Editor → paste and run [`supabase/schema.sql`](supabase/schema.sql).
3. Authentication → Sign In / Providers → turn on **Allow anonymous sign-ins**.
4. Project Settings → API → copy the **Project URL** and the **anon public** key into `config.js`.

The anon key is meant to be public. Row level security in the schema keeps each team's data
visible only to its members.

## How it runs

Plain static files (`index.html`, `styles.css`, `app.js`, `team.js`, `config.js`), no build step.
Solo mode saves to the browser's localStorage. Team mode syncs through Supabase.

Local preview: open `index.html`, or run any static server (e.g. `python -m http.server`).

Netlify: publish directory is the repo root (see `netlify.toml`).
