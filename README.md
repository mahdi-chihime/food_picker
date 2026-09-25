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

## How it runs

Plain static files (`index.html`, `styles.css`, `app.js`), no build step and no server.
Everything is saved in the browser's localStorage, so each browser keeps its own lineup and history.
Use **Share lineup** to send the same lineup to teammates.

Local preview: open `index.html`, or run any static server (e.g. `python -m http.server`).

Netlify: publish directory is the repo root (see `netlify.toml`).
