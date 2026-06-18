# Foodie Pick Derby

Restaurant picker for Thursday lunch chaos: every employee adds a restaurant, every restaurant gets a horse, and the winner is where lunch comes from.

## Run

```powershell
python server.py
```

Open:

```text
http://127.0.0.1:8000
```

The app creates `foodie_pick.db` automatically. Restaurants you remove become inactive, but their old wins and race history stay saved.

## Reset Everything

Use **Reset Everything** in the Race Mood panel to delete all restaurants, race history, and ratings.

To reset manually, stop the server and delete `foodie_pick.db`. The next run recreates an empty database with no default restaurants.

## How it works

- Add as many restaurant names as you want.
- Start the stampede and every restaurant races at the same time.
- The winning restaurant is saved to history.
- Ratings can be changed from the History tab after each race.
