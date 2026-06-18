from __future__ import annotations

import json
import re
import mimetypes
import sqlite3
import threading
from datetime import date, datetime
from html import unescape
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlparse

import requests


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "foodie_pick.db"
MAX_BODY = 32_000
LOGO_CACHE = ROOT / "assets" / "logos"
LOGO_CACHE_VERSION = "google_v12"
ARTICLE_TOKENS = {"al", "el", "la", "le", "the", "and"}


def _build_curated_logos() -> dict[str, list[str]]:
    """Hand-verified pictures for the restaurants already in the database.
    Sources: 'file:<name>' = local file in assets/logos, 'page:<url>' = og:image
    of that page, 'domain:<domain>' = site icon/logo, plain URL = direct image."""
    table: dict[str, list[str]] = {}

    def add(keys: list[str], sources: list[str]) -> None:
        for key in keys:
            table[key] = sources

    add(["atyab_farrouj", "atyab_farooj"], [
        "https://www.daleeeel.com/f/res/s07/locations-photos/000/850/0085055-269-rinnoo-d669de82891f497e908273b65614023d.jpg",
        "domain:atyabfarooj.com",
    ])
    add(["roadster", "roadster_diner"], [
        "https://www.daleeeel.com/f/res/s07/locations-photos/000/835/0083550-269-rinnoo-19b9a4abe5a147c69ac567c01495627d.jpg",
        "domain:roadsterdiner.com",
    ])
    add(["sandwich_w_noss"], [
        "https://www.daleeeel.com/f/res/s07/locations-photos/000/835/0083528-269-rinnoo-72c900deafb14417ab15f4a7b8ba916d.jpg",
        "domain:sandwichwnoss.com",
    ])
    add(["pizzanini", "pizzaninni"], [
        "https://www.daleeeel.com/f/res/s07/locations-photos/000/852/0085241-269-rinnoo-f8adcdbb8c8a4798a9c794a0af3cd86f.jpg",
    ])
    add(["malak_l_tawool", "malak_l_tawook", "malak_l_tawouk", "malak_tawouk", "malak_tawook", "malak_tawool"], [
        "file:google_v6_malak_al_tawouk.img",
        "domain:malakaltawouk.com",
    ])
    add(["crunchyz", "crunchys", "crunchyz_burgers"], [
        "file:google_v7_crunchyz.img",
        "https://gobatroun.com/wp-content/uploads/2022/07/Screenshot-872.png",
    ])
    add(["jammal"], [
        "https://gobatroun.com/wp-content/uploads/2022/06/jammal2.png",
        "page:https://gobatroun.com/location/jammal-restaurant/",
    ])
    add(["basterma_mano", "mano"], [
        "https://www.beirut.com/wp-content/uploads/2023/03/30322-4.png",
        "page:https://www.beirut.com/en/directory/basterma-mano/",
    ])
    add(["pizza_montana"], [
        "https://lebanondaleel.com/wp-content/uploads/2020/04/52051148_2707717262579644_1416729296554164224_n-150x150.jpg",
        "page:https://lebanondaleel.com/listing/pizza-montana/",
    ])
    add(["hayat_donner", "hayat_doner"], [
        "page:https://hayatdoner.com/",
        "domain:hayatdoner.com",
    ])
    add(["mr_brown"], [
        "domain:mrbrowndiner.com",
    ])
    add(["farrouj_l_shames", "farrouj_shames", "farrouj_shams", "farouj_shams"], [
        "https://faroujalshams.com/wp-content/uploads/2024/12/logo5.png",
        "domain:faroujalshams.com",
    ])
    add(["alabdalla", "alabdallah", "abdalla", "abdallah"], [
        "https://abdallahcorporate.koeinbeta.com/content/uploads/corporatepages/409~about-us-chicken.png",
        "https://alabdalla.org/assets/img/logo.svg",
        "domain:alabdalla.org",
    ])
    return table


CURATED_LOGOS = _build_curated_logos()
HTTP_TIMEOUT = 8
MIN_LOGO_DIM = 64

SEARCH_BLOCKED_DOMAINS = (
    "google.",
    "duckduckgo.",
    "facebook.",
    "instagram.",
    "tiktok.",
    "youtube.",
    "tripadvisor.",
    "zomato.",
    "talabat.",
    "toters.",
    "ubereats.",
    "deliveroo.",
    "linkedin.",
    "wikipedia.",
    "yelp.",
    "dreamstime.",
    "shutterstock.",
    "istockphoto.",
    "adobe.",
    "freepik.",
    "vecteezy.",
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept": "text/html,image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
}


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db() -> None:
    with connect() as con:
        con.executescript(
            """
            create table if not exists restaurants (
                id integer primary key autoincrement,
                name text not null,
                active integer not null default 1,
                created_at text not null
            );

            create table if not exists races (
                id integer primary key autoincrement,
                winner_id integer not null references restaurants(id),
                winner_rating integer,
                race_date text not null,
                created_at text not null
            );

            create table if not exists race_participants (
                race_id integer not null references races(id),
                restaurant_id integer not null references restaurants(id),
                primary key (race_id, restaurant_id)
            );

            create table if not exists race_ratings (
                id integer primary key autoincrement,
                race_id integer not null references races(id),
                person_name text not null,
                rating real not null,
                created_at text not null
            );
            """
        )
        ensure_column(con, "races", "winner_rating", "integer")
        ensure_column(con, "races", "positions_json", "text")
        ensure_column(con, "restaurants", "hidden_suggestion", "integer not null default 0")
        ensure_column(con, "restaurants", "entries_count", "integer not null default 1")
        allow_duplicate_restaurant_names(con)
        merge_duplicate_active_restaurants(con)


def merge_duplicate_active_restaurants(con: sqlite3.Connection) -> None:
    """Collapse duplicate active rows ('sandwich w noss' twice) into one row
    with the rider counter summed. Older rows stay for win history."""
    rows = con.execute(
        "select id, name, entries_count from restaurants where active = 1 order by id desc"
    ).fetchall()
    groups: dict[str, list] = {}
    for row in rows:
        groups.setdefault(normalize_logo_name(row["name"]), []).append(row)
    for group in groups.values():
        if len(group) < 2:
            continue
        keeper = group[0]
        total = min(9, sum(max(1, int(r["entries_count"] or 1)) for r in group))
        con.execute(
            "update restaurants set entries_count = ? where id = ?",
            (total, keeper["id"]),
        )
        con.executemany(
            "update restaurants set active = 0 where id = ?",
            [(r["id"],) for r in group[1:]],
        )


def reset_db() -> None:
    with connect() as con:
        con.execute("delete from race_participants")
        con.execute("delete from races")
        con.execute("delete from restaurants")
        con.execute("delete from sqlite_sequence where name in ('restaurants', 'races')")


def ensure_column(con: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in con.execute(f"pragma table_info({table})").fetchall()}
    if column not in columns:
        con.execute(f"alter table {table} add column {column} {definition}")


def allow_duplicate_restaurant_names(con: sqlite3.Connection) -> None:
    table = con.execute(
        "select sql from sqlite_master where type = 'table' and name = 'restaurants'",
    ).fetchone()
    if not table or "name text not null unique" not in table["sql"].lower():
        return

    con.executescript(
        """
        pragma foreign_keys = off;

        create table restaurants_new (
            id integer primary key autoincrement,
            name text not null,
            active integer not null default 1,
            created_at text not null
        );

        insert into restaurants_new (id, name, active, created_at)
        select id, name, active, created_at from restaurants;

        drop table restaurants;
        alter table restaurants_new rename to restaurants;

        pragma foreign_keys = on;
        """
    )


def restaurant_rows(con: sqlite3.Connection) -> list[dict]:
    rows = con.execute(
        """
        select
            r.id,
            r.name,
            r.active,
            r.hidden_suggestion,
            r.entries_count,
            r.created_at,
            count(distinct rp.race_id) as appearances,
            count(distinct win.id) as wins,
            max(win.race_date) as last_win_date,
            round(avg(case when win.winner_rating between 1 and 5 then win.winner_rating end), 2) as avg_rating,
            count(case when win.winner_rating between 1 and 5 then 1 end) as rating_count
        from restaurants r
        left join race_participants rp on rp.restaurant_id = r.id
        left join races win on win.winner_id = r.id
        group by r.id
        order by r.active desc, lower(r.name)
        """
    ).fetchall()

    restaurants = []
    for row in rows:
        wins = int(row["wins"])
        appearances = int(row["appearances"])
        restaurants.append(
            {
                "id": row["id"],
                "name": row["name"],
                "active": bool(row["active"]),
                "hidden_suggestion": bool(row["hidden_suggestion"]),
                "entries_count": int(row["entries_count"] or 1),
                "created_at": row["created_at"],
                "appearances": appearances,
                "wins": wins,
                "avg_rating": row["avg_rating"],
                "rating_count": int(row["rating_count"] or 0),
                "last_win_date": row["last_win_date"],
                "logo_pinned": logo_is_pinned(row["name"]),
            }
        )
    return restaurants


def logo_is_pinned(name: str) -> bool:
    manual_file = _manual_logo_path(name)
    return bool(manual_file and manual_file.exists() and manual_file.stat().st_size > 512)


def state_payload() -> dict:
    with connect() as con:
        restaurants = restaurant_rows(con)
        last_race = con.execute(
            """
            select
                races.id,
                races.race_date,
                races.created_at,
                races.winner_rating,
                restaurants.id as winner_id,
                restaurants.name as winner_name
            from races
            join restaurants on restaurants.id = races.winner_id
            order by races.race_date desc, races.id desc
            limit 1
            """
        ).fetchone()
        recent = con.execute(
            """
            select
                races.id,
                races.race_date,
                races.winner_rating,
                races.positions_json,
                restaurants.id as winner_id,
                restaurants.name as winner_name,
                group_concat(participants.name, ', ') as participants
            from races
            join restaurants on restaurants.id = races.winner_id
            left join race_participants on race_participants.race_id = races.id
            left join restaurants participants on participants.id = race_participants.restaurant_id
            group by races.id
            order by races.race_date desc, races.id desc
            limit 40
            """
        ).fetchall()
        rating_rows = con.execute(
            "select race_id, person_name, rating from race_ratings order by race_id, id"
        ).fetchall()

    ratings_by_race: dict = {}
    for rr in rating_rows:
        ratings_by_race.setdefault(rr["race_id"], []).append(
            {"name": rr["person_name"], "rating": rr["rating"]}
        )

    return {
        "restaurants": restaurants,
        "last_race_id": last_race["id"] if last_race else None,
        "last_winner_id": last_race["winner_id"] if last_race else None,
        "last_winner_name": last_race["winner_name"] if last_race else None,
        "last_winner_rating": last_race["winner_rating"] if last_race else None,
        "history": [
            {**dict(row), "ratings": ratings_by_race.get(row["id"], [])}
            for row in recent
        ],
    }


def normalize_logo_name(name: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9'\-\s&]", " ", name.lower().replace("&", " and "))).strip()


def name_tokens(name: str) -> list[str]:
    """Meaningful words of a restaurant name — Arabic/French articles like
    'al'/'el' don't count, so 'hayat al donner' matches 'hayat donner'."""
    return [
        token
        for token in re.split(r"[^a-z0-9]+", normalize_logo_name(name))
        if len(token) > 1 and token not in ARTICLE_TOKENS
    ]


def lebanese_name_variants(name: str) -> list[str]:
    """Spelling variants a Lebanese search would try: existing tawouk/farrouj
    swaps plus 'al' inserted between words ('hayat donner' -> 'hayat al donner')."""
    variants = list(google_query_names(name))
    words = normalize_logo_name(name).split()
    for i in range(1, len(words)):
        if words[i] in ARTICLE_TOKENS or words[i - 1] in ARTICLE_TOKENS:
            continue
        candidate = " ".join(words[:i] + ["al"] + words[i:])
        if candidate not in variants:
            variants.append(candidate)
    # also try with articles removed entirely
    stripped = " ".join(token for token in words if token not in ARTICLE_TOKENS)
    if stripped and stripped not in variants:
        variants.append(stripped)
    return variants[:6]


def generate_username_slugs(name: str) -> list[str]:
    normalized = normalize_logo_name(name)
    stripped = re.sub(r"\b(the|restaurant|resto|grill|cafe|kitchen|diner|bakery|pizza|burger|lebanon|lb|al)\b", "", normalized)
    compact = re.sub(r"[^a-z0-9]+", "", stripped or normalized).strip()
    full_slug = re.sub(r"[^a-z0-9]+", "", normalized).strip()
    slugs: list[str] = []
    for base in list(dict.fromkeys(filter(None, [compact, full_slug]))):
        slugs += [base, f"{base}lb", f"{base}_lb", f"{base}restaurant", f"{base}resto", f"{base}lebanon"]
    return slugs[:10]


def google_query_names(name: str) -> list[str]:
    normalized = normalize_logo_name(name)
    variants = [normalized]
    variants.append(re.sub(r"\bl\b", "al", normalized))
    variants.append(normalized.replace("tawool", "tawouk"))
    variants.append(normalized.replace("tawook", "tawouk"))
    variants.append(re.sub(r"\bl tawool\b", "al tawouk", normalized))
    variants.append(re.sub(r"\bl tawook\b", "al tawouk", normalized))
    variants.append(normalized.replace("farrouj", "farooj"))
    result = []
    for item in variants:
        clean = re.sub(r"\s+", " ", item).strip()
        if clean and clean not in result:
            result.append(clean)
    return result


def direct_logo_domains(name: str) -> list[str]:
    domains = []
    for variant in google_query_names(name):
        compact = re.sub(r"[^a-z0-9]+", "", variant)
        hyphenated = re.sub(r"[^a-z0-9]+", "-", variant).strip("-")
        if compact:
            domains.extend([f"{compact}.com", f"{compact}.com.lb", f"{compact}.net"])
        if hyphenated:
            domains.extend([f"{hyphenated}.com", f"{hyphenated}.com.lb"])

    normalized = normalize_logo_name(name)
    if "farrouj" in normalized or "farooj" in normalized:
        domains.extend(["atyabfarooj.com", "atyabfaroojcatalog.com"])
    if "malak" in normalized and ("tawook" in normalized or "tawouk" in normalized or "tawool" in normalized):
        domains.extend(["malakaltawouk.com", "malakaltawouk.net"])
    if "abdalla" in normalized or "abdallah" in normalized:
        domains.extend(["alabdalla.org"])
    if "crunchyz" in normalized or "crunchy" in normalized:
        domains.extend(["crunchyzburgers.com"])
    if "classic" in normalized and "pizza" in normalized:
        domains.extend(["classicpizzajoint.com"])

    seen = set()
    result = []
    for domain in domains:
        clean = domain.lower().strip().removeprefix("www.")
        if not clean or clean in seen or blocked_search_domain(clean):
            continue
        seen.add(clean)
        result.append(clean)
    return result[:24]


def direct_logo_pages(name: str) -> list[str]:
    normalized = normalize_logo_name(name)
    pages = []
    if "pizzanini" in normalized or "pizzaninni" in normalized:
        pages.append("https://www.daleeeel.com/en-lb/chain/5290/pizzaninni")
    if "crunchyz" in normalized or "crunchy" in normalized:
        pages.append("https://gobatroun.com/location/crunchyz-burgers/")
    return pages


def direct_logo_images(name: str) -> list[str]:
    normalized = normalize_logo_name(name)
    images = []
    if "crunchyz" in normalized or "crunchy" in normalized:
        images.append("https://gobatroun.com/wp-content/uploads/2022/07/Screenshot-872.png")
    return images


STOCK_IMAGE_DOMAINS = (
    "dreamstime.", "shutterstock.", "istockphoto.", "adobe.", "alamy.",
    "freepik.", "vecteezy.", "depositphotos.", "123rf.", "gettyimages.",
)


def stock_image_domain(domain: str) -> bool:
    return any(blocked in domain for blocked in STOCK_IMAGE_DOMAINS)


def ddg_image_results(name: str) -> list[dict]:
    """Collect image search results (with titles/sizes) across a few queries."""
    tokens = name_tokens(name)
    queries = []
    for variant in lebanese_name_variants(name):
        queries.append(f"{variant} restaurant lebanon logo")
        queries.append(f"{variant} restaurant lebanon")
    queries.append(f"{name} lebanon")
    queries = queries[:8]
    seen: set[str] = set()
    collected: list[dict] = []
    for query_text in queries:
        try:
            token_resp = requests.get(
                f"https://duckduckgo.com/?q={quote_plus(query_text)}&iax=images&ia=images",
                headers=HEADERS,
                timeout=HTTP_TIMEOUT,
            )
            match = re.search(r"vqd=[\"']?([\d-]+)", token_resp.text)
            if not match:
                continue
            api_url = (
                f"https://duckduckgo.com/i.js?l=xa-en&o=json"
                f"&q={quote_plus(query_text)}&vqd={match.group(1)}&f=,,,&p=1"
            )
            response = requests.get(
                api_url,
                headers={**HEADERS, "Referer": "https://duckduckgo.com/"},
                timeout=HTTP_TIMEOUT,
            )
            response.raise_for_status()
            results = response.json().get("results", [])
        except (requests.RequestException, ValueError):
            continue

        for item in results[:24]:
            img_url = str(item.get("image") or "")
            if not img_url.startswith(("http://", "https://")) or img_url.lower() in seen:
                continue
            domain = urlparse(img_url).netloc.lower().removeprefix("www.")
            if stock_image_domain(domain):
                continue
            seen.add(img_url.lower())
            entry = {
                "image": img_url,
                "thumbnail": str(item.get("thumbnail") or ""),
                "title": str(item.get("title") or ""),
                "url": str(item.get("url") or ""),
                "width": item.get("width") or 0,
                "height": item.get("height") or 0,
            }
            entry["score"] = ddg_result_score(entry, tokens)
            collected.append(entry)
        if len(collected) >= 30:
            break

    collected.sort(key=lambda item: item["score"], reverse=True)
    return collected


def ddg_result_score(item: dict, tokens: list[str]) -> int:
    hay = f"{item['title']} {item['url']} {item['image']}".lower()
    hay_compact = re.sub(r"[^a-z0-9]+", "", hay)
    score = sum(3 for token in tokens if token in hay)
    if tokens and all(token in hay for token in tokens):
        score += 12
    if tokens and "".join(tokens) in hay_compact:
        score += 8
    if "logo" in hay:
        score += 5
    if "lebanon" in hay or ".lb" in hay:
        score += 3
    width, height = item.get("width") or 0, item.get("height") or 0
    if width and height:
        aspect = width / max(1, height)
        if 0.6 <= aspect <= 1.8:
            score += 3  # logo-ish proportions
        if aspect > 3 or aspect < 0.3:
            score -= 6  # banners / screenshots
        if width >= 1200 and aspect > 1.5:
            score -= 4  # likely a webpage screenshot or photo banner
    return score


def search_duckduckgo_images(name: str) -> bytes | None:
    """Auto-pick: only accept a result if EVERY meaningful word of the name
    appears in its title/source — otherwise prefer no image over a wrong one."""
    tokens = name_tokens(name)
    for item in ddg_image_results(name)[:12]:
        hay = f"{item['title']} {item['url']} {item['image']}".lower()
        if tokens and not all(token in hay for token in tokens):
            continue
        width, height = item.get("width") or 0, item.get("height") or 0
        if width and height and not (0.35 <= width / max(1, height) <= 2.6):
            continue
        image = fetch_image(item["image"])
        if image:
            return image
    return None


def search_duckduckgo_entity_image(name: str) -> bytes | None:
    for query in [f"{name} restaurant Lebanon", name]:
        try:
            url = f"https://api.duckduckgo.com/?q={quote_plus(query)}&format=json&no_redirect=1&no_html=1"
            response = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT)
            response.raise_for_status()
            data = response.json()
            img_url = data.get("Image") or ""
            if img_url.startswith(("http://", "https://")):
                image = fetch_image(img_url)
                if image:
                    return image
        except (requests.RequestException, ValueError, KeyError):
            continue
    return None


def search_google_image_suggestion(name: str) -> bytes | None:
    normalized = normalize_logo_name(name)
    tokens = [token for token in re.split(r"[^a-z0-9]+", normalized) if len(token) > 1]
    queries = []
    for variant in google_query_names(name):
        queries.extend([
            f"{variant} restaurant logo Lebanon",
            f"{variant} restaurant Lebanon",
            f"{variant} official logo",
        ])
    for query_text in queries:
        url = f"https://www.google.com/search?tbm=isch&udm=2&q={quote_plus(query_text)}"
        try:
            response = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT)
            response.raise_for_status()
        except requests.RequestException:
            continue

        scored_urls = sorted(
            ((item, image_url_score(item, tokens)) for item in google_image_urls(response.text)),
            key=lambda item: item[1],
            reverse=True,
        )
        for img_url, score in scored_urls:
            if score < 4:
                continue
            image = fetch_image(img_url)
            if image:
                return image
    return None


def search_google_result_images(name: str) -> bytes | None:
    for variant in google_query_names(name):
        for query_text in (
            f'"{variant}" restaurant Lebanon',
            f'{variant} restaurant Lebanon',
            f'{variant} menu Lebanon',
        ):
            for url in google_result_urls(query_text):
                image = fetch_og_image(url)
                if image:
                    return image
    return None


def google_result_urls(query_text: str) -> list[str]:
    url = f"https://www.google.com/search?q={quote_plus(query_text)}"
    try:
        response = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
    except requests.RequestException:
        return []

    urls = []
    for raw in re.findall(r'href=["\'](?:/url\?q=)?(https?://[^"\'&]+)', response.text):
        clean = unquote(unescape(raw)).strip()
        parsed = urlparse(clean)
        if parsed.scheme not in {"http", "https"}:
            continue
        domain = parsed.netloc.lower().removeprefix("www.")
        if any(blocked in domain for blocked in (
            "google.", "youtube.", "wikipedia.", "linkedin.",
            "dreamstime.", "shutterstock.", "istockphoto.", "adobe.",
            "freepik.", "vecteezy.",
        )):
            continue
        if clean not in urls:
            urls.append(clean)
    return urls[:8]


def google_image_urls(html: str) -> list[str]:
    decoded = (
        html.replace("\\u003d", "=")
        .replace("\\u0026", "&")
        .replace("\\u003c", "<")
        .replace("\\u003e", ">")
        .replace("\\/", "/")
    )
    candidates = []
    candidates.extend(unescape(item) for item in re.findall(r'<img[^>]+src=["\'](https?://[^"\']+)["\']', decoded, flags=re.I))
    candidates.extend(unescape(item) for item in re.findall(r'"(https?://[^"]+\.(?:png|jpe?g|webp|gif)(?:\?[^"]*)?)"', decoded, flags=re.I))

    seen = set()
    urls = []
    for item in candidates:
        clean = item.strip()
        if clean.startswith("https://www.gstatic.com/") or clean.startswith("https://ssl.gstatic.com/"):
            continue
        if clean.lower() in seen:
            continue
        seen.add(clean.lower())
        urls.append(clean)
    return urls[:18]


def fetch_og_image(url: str) -> bytes | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT, allow_redirects=True)
        if resp.status_code != 200:
            return None
        html = resp.text[:80_000]
        for pattern in (
            r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)',
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        ):
            for img_url in re.findall(pattern, html, re.I):
                cleaned = unescape(img_url)
                if cleaned.startswith(("http://", "https://")):
                    image = fetch_image(cleaned)
                    if image:
                        return image
    except requests.RequestException:
        pass
    return None


def fetch_logo_from_page(url: str) -> bytes | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT, allow_redirects=True)
        if resp.status_code != 200:
            return None
        html = resp.text[:300_000]
    except requests.RequestException:
        return None

    existing = fetch_og_image(url)
    if existing:
        return existing

    candidates = []
    for tag in re.findall(r'<img[^>]+>', html, flags=re.I):
        looks_logo = re.search(r'(?:class|id|alt)=["\'][^"\']*(?:logo|brand)[^"\']*["\']', tag, flags=re.I)
        if looks_logo:
            match = re.search(r'src=["\']([^"\']+)', tag, flags=re.I)
            if match:
                candidates.append(urljoin(url, unescape(match.group(1))))
            lazy_match = re.search(r'data-src=["\']([^"\']+)', tag, flags=re.I)
            if lazy_match:
                candidates.append(urljoin(url, unescape(lazy_match.group(1))))
    candidates.extend(
        urljoin(url, unescape(item))
        for item in re.findall(r'<img[^>]+src=["\']([^"\']*(?:logo|brand)[^"\']*\.(?:png|jpe?g|webp|gif|svg))["\']', html, flags=re.I)
    )
    for candidate in unique_urls(candidates):
        image = fetch_image(candidate)
        if image:
            return image
    return None


def search_social_images(name: str) -> bytes | None:
    for slug in generate_username_slugs(name)[:6]:
        for url in (
            f"https://www.instagram.com/{slug}/",
            f"https://www.facebook.com/{slug}",
            f"https://m.facebook.com/{slug}",
        ):
            image = fetch_og_image(url)
            if image:
                return image
    return None


def _logo_key(name: str) -> str:
    # Article words are dropped so "hayat al donner" and "hayat donner"
    # share one saved picture, even after deleting and re-adding.
    words = [
        token
        for token in re.split(r"[^a-z0-9]+", normalize_logo_name(name))
        if token and token not in ARTICLE_TOKENS
    ]
    return "_".join(words).strip("_")[:80]


def _logo_cache_path(name: str) -> Path | None:
    key = _logo_key(name)
    return (LOGO_CACHE / f"{LOGO_CACHE_VERSION}_{key}.img") if key else None


def _manual_logo_path(name: str) -> Path | None:
    key = _logo_key(name)
    return (LOGO_CACHE / f"manual_{key}.img") if key else None


def _load_curated_source(source: str) -> bytes | None:
    if source.startswith("file:"):
        path = LOGO_CACHE / source[5:]
        if path.exists() and path.stat().st_size > 512:
            return path.read_bytes()
        return None
    if source.startswith("page:"):
        return fetch_og_image(source[5:])
    if source.startswith("domain:"):
        return fetch_logo_for_domain(source[7:])
    return fetch_image(source)


def seed_curated_logos() -> None:
    """Download the hand-verified pictures into locked (manual) files once,
    so every restaurant already in the database has its correct pic fixed."""
    seen_files: set[str] = set()
    for key, sources in CURATED_LOGOS.items():
        manual_file = LOGO_CACHE / f"manual_{key}.img"
        if manual_file.name in seen_files:
            continue
        seen_files.add(manual_file.name)
        if manual_file.exists() and manual_file.stat().st_size > 512:
            continue  # already picked/seeded — never overwrite a user's choice
        image = None
        for source in sources:
            image = _load_curated_source(source)
            if image:
                break
        if image:
            LOGO_CACHE.mkdir(parents=True, exist_ok=True)
            try:
                manual_file.write_bytes(image)
                print(f"[logos] seeded {key}")
            except OSError:
                pass


def logo_for_restaurant(name: str, refresh: bool = False) -> bytes | None:
    # A logo the user picked by hand (or a seeded curated one) always wins.
    manual_file = _manual_logo_path(name)
    if manual_file and manual_file.exists() and manual_file.stat().st_size > 512:
        return manual_file.read_bytes()

    cache_file = _logo_cache_path(name)
    if not refresh and cache_file and cache_file.exists() and cache_file.stat().st_size > 512:
        return cache_file.read_bytes()

    image = None
    # Curated sources for known restaurants (saved as locked once found).
    for source in CURATED_LOGOS.get(_logo_key(name), []):
        image = _load_curated_source(source)
        if image:
            break
    if image and manual_file:
        LOGO_CACHE.mkdir(parents=True, exist_ok=True)
        try:
            manual_file.write_bytes(image)
        except OSError:
            pass
        return image

    # Original auto pipeline for new restaurants.
    for url in direct_logo_images(name):
        image = fetch_image(url)
        if image:
            break
    for domain in direct_logo_domains(name):
        if image:
            break
        image = fetch_logo_for_domain(domain)
        if image:
            break
    for page in direct_logo_pages(name):
        if image:
            break
        image = fetch_logo_from_page(page)
    if not image:
        image = search_google_result_images(name)
    for variant in google_query_names(name):
        if image:
            break
        image = search_google_image_suggestion(variant)

    if image and cache_file:
        LOGO_CACHE.mkdir(parents=True, exist_ok=True)
        try:
            cache_file.write_bytes(image)
        except OSError:
            pass

    return image


def image_content_type(body: bytes) -> str:
    if body.startswith(b"\x89PNG"):
        return "image/png"
    if body.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if body.startswith(b"GIF"):
        return "image/gif"
    if body.lstrip().startswith((b"<svg", b"<?xml")):
        return "image/svg+xml"
    if body.startswith(b"RIFF") and body[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def logo_domains_for_name(name: str) -> list[str]:
    normalized = normalize_logo_name(name)
    domains = []
    domains.extend(search_restaurant_domains(name))

    compact = re.sub(r"\b(the|restaurant|resto|grill|cafe|kitchen|diner|bakery|pizza|burger|lebanon|lb)\b", "", normalized)
    guessed = re.sub(r"[^a-z0-9]+", "", compact or normalized)
    if guessed:
        domains.extend([
            f"{guessed}.com",
            f"{guessed}.com.lb",
            f"{guessed}.net",
            f"{guessed}.me.lb",
            f"{guessed}lb.com",
            f"{guessed}-lb.com",
            f"{guessed}restaurant.com",
        ])
    return unique_domains(domains)


def unique_domains(domains: list[str]) -> list[str]:
    seen = set()
    result = []
    for domain in domains:
        clean = domain.lower().strip().removeprefix("www.")
        if not clean or clean in seen or blocked_search_domain(clean):
            continue
        seen.add(clean)
        result.append(clean)
    return result[:8]


def search_restaurant_domains(name: str) -> list[str]:
    domains = []
    queries = [
        f'"{name}" Lebanon restaurant official website',
        f'"{name}" restaurant Lebanon logo',
        f'"{name}" restaurant menu Lebanon',
        f'{name} restaurant official website',
    ]
    for query_text in queries:
        query = quote_plus(query_text)
        url = f"https://duckduckgo.com/html/?q={query}"
        try:
            response = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT)
            response.raise_for_status()
        except requests.RequestException:
            continue

        for match in re.findall(r'href="([^"]+)"', response.text):
            target = unescape(match)
            if "uddg=" in target:
                target = unquote(parse_qs(urlparse(target).query).get("uddg", [""])[0])
            parsed = urlparse(target)
            if parsed.scheme not in {"http", "https"}:
                continue
            domain = parsed.netloc.lower().removeprefix("www.")
            if domain and not blocked_search_domain(domain):
                domains.append(domain)
    return domains


def search_logo_images(name: str) -> list[str]:
    urls = []
    normalized = normalize_logo_name(name)
    tokens = [token for token in re.split(r"[^a-z0-9]+", normalized) if len(token) > 1]
    lebanon_name = name if "lebanon" in name.lower() else f"{name} Lebanon"
    queries = [
        f'{lebanon_name} restaurant logo',
        f'{lebanon_name} food logo',
        f'{lebanon_name} restaurant sign',
        f'{name} official restaurant logo',
    ]
    for query_text in queries:
        url = f"https://www.bing.com/images/search?q={quote_plus(query_text)}"
        try:
            response = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT)
            response.raise_for_status()
        except requests.RequestException:
            continue

        html = response.text
        urls.extend(unescape(item) for item in re.findall(r'murl&quot;:&quot;(.*?)&quot;', html))
        urls.extend(unquote(unescape(item)) for item in re.findall(r'mediaurl=([^&"]+)', html))
    return sorted(unique_urls(urls), key=lambda item: image_url_score(item, tokens), reverse=True)[:12]


def image_url_score(url: str, tokens: list[str]) -> int:
    lowered = url.lower()
    slug = "-".join(tokens)
    full_slug = re.sub(r"[^a-z0-9]+", "-", " ".join(tokens)).strip("-")
    compact = "".join(tokens)
    score = sum(3 for token in tokens if token in lowered)
    if tokens and not all(token in lowered for token in tokens):
        score -= 10
    if slug and slug in lowered:
        score += 12
    if full_slug and full_slug in lowered:
        score += 12
    if len(tokens) >= 3:
        with_middle_words = "-".join(tokens)
        if with_middle_words in lowered:
            score += 8
    if compact and compact in re.sub(r"[^a-z0-9]+", "", lowered):
        score += 10
    if "lebanon" in lowered or ".lb" in lowered:
        score += 5
    if any(word in lowered for word in ("logo", "brand", "icon")):
        score += 4
    if any(word in lowered for word in ("sign", "store", "restaurant", "menu")):
        score += 2
    if any(word in lowered for word in ("screenshot", "whatsapp", "image-")):
        score -= 1
    return score


def unique_urls(urls: list[str]) -> list[str]:
    seen = set()
    result = []
    for url in urls:
        clean = url.strip().replace("\\/", "/")
        parsed = urlparse(clean)
        if parsed.scheme not in {"http", "https"}:
            continue
        if blocked_search_domain(parsed.netloc.lower().removeprefix("www.")):
            continue
        key = clean.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(clean)
    return result[:12]


def blocked_search_domain(domain: str) -> bool:
    return any(blocked in domain for blocked in SEARCH_BLOCKED_DOMAINS)


def fetch_logo_for_domain(domain: str) -> bytes | None:
    # Note: google s2 favicons removed on purpose — it returns a generic globe
    # for unknown domains, which produced wrong "logos".
    candidates = [
        f"https://logo.clearbit.com/{domain}?size=512",
    ]
    candidates.extend(site_logo_candidates(domain))

    for url in candidates:
        image = fetch_image(url)
        if image:
            return image
    return None


def site_logo_candidates(domain: str) -> list[str]:
    for scheme in ("https", "http"):
        base = f"{scheme}://{domain}"
        try:
            response = requests.get(base, headers=HEADERS, timeout=HTTP_TIMEOUT)
            response.raise_for_status()
        except requests.RequestException:
            continue

        html = response.text[:300_000]
        candidates = []
        for rel in ("apple-touch-icon", "icon", "shortcut icon", "mask-icon"):
            pattern = rf'<link[^>]+rel=["\'][^"\']*{re.escape(rel)}[^"\']*["\'][^>]+href=["\']([^"\']+)'
            candidates.extend(urljoin(base, unescape(item)) for item in re.findall(pattern, html, flags=re.I))
        candidates.extend(
            urljoin(base, unescape(item))
            for item in re.findall(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', html, flags=re.I)
        )
        for tag in re.findall(r'<img[^>]+>', html, flags=re.I):
            if re.search(r'(?:class|id|alt)=["\'][^"\']*(?:logo|brand)[^"\']*["\']', tag, flags=re.I):
                match = re.search(r'src=["\']([^"\']+)', tag, flags=re.I)
                if match:
                    candidates.append(urljoin(base, unescape(match.group(1))))
        candidates.extend(
            urljoin(base, unescape(item))
            for item in re.findall(r'<img[^>]+src=["\']([^"\']*(?:logo|brand)[^"\']*\.(?:png|jpe?g|webp|gif))["\']', html, flags=re.I)
        )
        candidates.extend([urljoin(base, "/favicon.ico"), urljoin(base, "/apple-touch-icon.png")])
        return candidates[:8]
    return []


def image_dimensions(body: bytes) -> tuple[int, int] | None:
    if body.startswith(b"\x89PNG") and len(body) > 24:
        return (
            int.from_bytes(body[16:20], "big"),
            int.from_bytes(body[20:24], "big"),
        )
    if body.startswith(b"GIF") and len(body) > 10:
        return (
            int.from_bytes(body[6:8], "little"),
            int.from_bytes(body[8:10], "little"),
        )
    if body.startswith(b"\xff\xd8"):
        i = 2
        sof_markers = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
        while i + 9 < len(body):
            if body[i] != 0xFF:
                i += 1
                continue
            marker = body[i + 1]
            if marker in sof_markers:
                return (
                    int.from_bytes(body[i + 7:i + 9], "big"),
                    int.from_bytes(body[i + 5:i + 7], "big"),
                )
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            segment = int.from_bytes(body[i + 2:i + 4], "big")
            i += 2 + segment
    return None


def fetch_image(url: str) -> bytes | None:
    try:
        response = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
    except requests.RequestException:
        return None

    content_type = response.headers.get("content-type", "").lower()
    body = response.content
    if len(body) < 512 or len(body) > 2_500_000:
        return None
    if "image" not in content_type and not body.startswith((b"\x89PNG", b"\xff\xd8", b"GIF", b"<svg")):
        return None
    dims = image_dimensions(body)
    if dims and (dims[0] < MIN_LOGO_DIM or dims[1] < MIN_LOGO_DIM):
        return None
    return body


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript",
        ".css": "text/css",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/state":
            self.send_json(state_payload())
            return
        if path == "/api/logo-candidates":
            query = parse_qs(parsed.query)
            name = query.get("name", [""])[0].strip()[:100]
            candidates = ddg_image_results(name) if name else []
            self.send_json({"candidates": candidates[:16]})
            return
        if path == "/api/logo":
            query = parse_qs(parsed.query)
            name = query.get("name", [""])[0].strip()[:100]
            refresh = query.get("refresh", [""])[0] == "1"
            logo = logo_for_restaurant(name, refresh=refresh) if name else None
            if not logo:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", image_content_type(logo))
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Content-Length", str(len(logo)))
            self.end_headers()
            self.wfile.write(logo)
            return
        if path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/logo-upload":
            query = parse_qs(parsed.query)
            name = " ".join(query.get("name", [""])[0].split())[:100]
            if not name:
                self.send_json({"error": "Restaurant name is required."}, status=400)
                return
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > 4_000_000:
                self.send_json({"error": "Image must be smaller than 4 MB."}, status=400)
                return
            body = self.rfile.read(length)
            is_image = body.startswith((b"\x89PNG", b"\xff\xd8", b"GIF")) \
                or body.lstrip().startswith((b"<svg", b"<?xml")) \
                or (body.startswith(b"RIFF") and body[8:12] == b"WEBP")
            if len(body) < 256 or not is_image:
                self.send_json({"error": "That file is not a usable image."}, status=400)
                return
            dims = image_dimensions(body)
            if dims and (dims[0] < 32 or dims[1] < 32):
                self.send_json({"error": "Image is too small."}, status=400)
                return
            manual_file = _manual_logo_path(name)
            if not manual_file:
                self.send_json({"error": "Invalid restaurant name."}, status=400)
                return
            LOGO_CACHE.mkdir(parents=True, exist_ok=True)
            try:
                manual_file.write_bytes(body)
            except OSError:
                self.send_json({"error": "Could not save the image."}, status=500)
                return
            self.send_json(state_payload())
            return

        if path == "/api/reset":
            reset_db()
            self.send_json(state_payload())
            return

        if path == "/api/logo-pin":
            data = self.read_json()
            name = " ".join(str(data.get("name", "")).split())[:100]
            if not name:
                self.send_json({"error": "Restaurant name is required."}, status=400)
                return
            manual_file = _manual_logo_path(name)
            if manual_file and manual_file.exists():
                # Already pinned -> unpin (auto search takes over again).
                try:
                    manual_file.unlink()
                except OSError:
                    pass
                self.send_json(state_payload())
                return
            logo = logo_for_restaurant(name)
            if not logo:
                self.send_json({"error": "No picture to lock yet — pick one with the picture button first."}, status=400)
                return
            LOGO_CACHE.mkdir(parents=True, exist_ok=True)
            try:
                manual_file.write_bytes(logo)
            except OSError:
                self.send_json({"error": "Could not save the picture."}, status=500)
                return
            self.send_json(state_payload())
            return

        if path == "/api/logo-choice":
            data = self.read_json()
            name = " ".join(str(data.get("name", "")).split())[:100]
            image_url = str(data.get("image_url", "")).strip()
            if not name:
                self.send_json({"error": "Restaurant name is required."}, status=400)
                return
            manual_file = _manual_logo_path(name)
            cache_file = _logo_cache_path(name)
            if not image_url:
                # Clear choice -> fall back to the letter badge.
                for stale in (manual_file, cache_file):
                    if stale and stale.exists():
                        try:
                            stale.unlink()
                        except OSError:
                            pass
                self.send_json({"ok": True})
                return
            if not image_url.startswith(("http://", "https://")):
                self.send_json({"error": "Invalid image URL."}, status=400)
                return
            image = fetch_image(image_url)
            if not image:
                self.send_json({"error": "Could not download that image."}, status=400)
                return
            LOGO_CACHE.mkdir(parents=True, exist_ok=True)
            try:
                manual_file.write_bytes(image)
            except OSError:
                self.send_json({"error": "Could not save the image."}, status=500)
                return
            self.send_json({"ok": True})
            return

        if path == "/api/restaurants/clear":
            with connect() as con:
                con.execute("update restaurants set active = 0")
            self.send_json(state_payload())
            return

        if path == "/api/restaurants":
            data = self.read_json()
            name = " ".join(str(data.get("name", "")).split())[:80]
            if not name:
                self.send_json({"error": "Restaurant name is required."}, status=400)
                return
            now = datetime.utcnow().isoformat(timespec="seconds")
            target = normalize_logo_name(name)
            with connect() as con:
                active_match = None
                inactive_match = None
                for row in con.execute(
                    "select id, name, active, entries_count from restaurants order by id desc"
                ).fetchall():
                    if normalize_logo_name(row["name"]) != target:
                        continue
                    if row["active"] and active_match is None:
                        active_match = row
                    elif not row["active"] and inactive_match is None:
                        inactive_match = row
                if active_match:
                    # Already in the lineup -> one more rider for it.
                    new_count = min(9, int(active_match["entries_count"] or 1) + 1)
                    con.execute(
                        "update restaurants set entries_count = ? where id = ?",
                        (new_count, active_match["id"]),
                    )
                elif inactive_match:
                    # Re-adding a known name -> reuse its row (keeps win stats).
                    con.execute(
                        "update restaurants set active = 1, entries_count = 1, hidden_suggestion = 0 where id = ?",
                        (inactive_match["id"],),
                    )
                else:
                    con.execute(
                        "insert into restaurants (name, active, created_at) values (?, 1, ?)",
                        (name, now),
                    )
            self.send_json(state_payload(), status=201)
            return

        parts_count = path.strip("/").split("/")
        if len(parts_count) == 4 and parts_count[:2] == ["api", "restaurants"] and parts_count[3] == "count":
            restaurant_id = int(parts_count[2])
            data = self.read_json()
            delta = int(data.get("delta") or 0)
            with connect() as con:
                row = con.execute(
                    "select entries_count from restaurants where id = ?", (restaurant_id,)
                ).fetchone()
                if not row:
                    self.send_json({"error": "Restaurant not found."}, status=404)
                    return
                new_count = max(1, min(9, int(row["entries_count"] or 1) + delta))
                con.execute(
                    "update restaurants set entries_count = ? where id = ?",
                    (new_count, restaurant_id),
                )
            self.send_json(state_payload())
            return

        if path == "/api/races":
            data = self.read_json()
            winner_id = int(data.get("winner_id") or 0)
            participant_ids = [int(item) for item in data.get("participant_ids", []) if int(item) > 0]
            if winner_id <= 0 or winner_id not in participant_ids:
                self.send_json({"error": "Winner must be one of the participants."}, status=400)
                return

            now = datetime.utcnow().isoformat(timespec="seconds")
            race_date = data.get("race_date") or date.today().isoformat()
            positions_json = data.get("positions_json") or None
            with connect() as con:
                known = con.execute(
                    f"select count(*) from restaurants where id in ({','.join('?' for _ in participant_ids)})",
                    participant_ids,
                ).fetchone()[0]
                if known != len(set(participant_ids)):
                    self.send_json({"error": "One or more restaurants do not exist."}, status=400)
                    return
                cur = con.execute(
                    "insert into races (winner_id, winner_rating, race_date, created_at, positions_json) values (?, ?, ?, ?, ?)",
                    (winner_id, None, race_date, now, positions_json),
                )
                race_id = cur.lastrowid
                con.executemany(
                    "insert into race_participants (race_id, restaurant_id) values (?, ?)",
                    [(race_id, item) for item in sorted(set(participant_ids))],
                )
            self.send_json(state_payload(), status=201)
            return

        parts = path.strip("/").split("/")
        if len(parts) == 4 and parts[:2] == ["api", "races"] and parts[3] == "rating":
            race_id = int(parts[2])
            data = self.read_json()
            rating = int(data.get("rating") or 0)
            if rating < 1 or rating > 5:
                self.send_json({"error": "Rating must be from 1 to 5."}, status=400)
                return
            with connect() as con:
                found = con.execute("select id from races where id = ?", (race_id,)).fetchone()
                if not found:
                    self.send_json({"error": "Race not found."}, status=404)
                    return
                con.execute("update races set winner_rating = ? where id = ?", (rating, race_id))
            self.send_json(state_payload())
            return

        if len(parts) == 4 and parts[:2] == ["api", "races"] and parts[3] == "group-rating":
            race_id = int(parts[2])
            data = self.read_json()
            items = data.get("ratings", [])
            if not items or not isinstance(items, list):
                self.send_json({"error": "Ratings list required."}, status=400)
                return
            parsed: list[tuple[str, float]] = []
            for item in items:
                name = " ".join(str(item.get("name", "")).split())[:50]
                if not name:
                    self.send_json({"error": "Name required for each rating."}, status=400)
                    return
                try:
                    raw = float(item.get("rating", 0))
                except (TypeError, ValueError):
                    self.send_json({"error": f"Invalid rating for '{name}'."}, status=400)
                    return
                rounded = round(raw * 2) / 2
                if rounded < 1 or rounded > 5:
                    self.send_json({"error": f"Rating for '{name}' must be 1–5."}, status=400)
                    return
                parsed.append((name, rounded))
            now = datetime.utcnow().isoformat(timespec="seconds")
            with connect() as con:
                if not con.execute("select id from races where id = ?", (race_id,)).fetchone():
                    self.send_json({"error": "Race not found."}, status=404)
                    return
                con.execute("delete from race_ratings where race_id = ?", (race_id,))
                con.executemany(
                    "insert into race_ratings (race_id, person_name, rating, created_at) values (?, ?, ?, ?)",
                    [(race_id, n, r, now) for n, r in parsed],
                )
                avg = round(sum(r for _, r in parsed) / len(parsed) * 100) / 100
                con.execute("update races set winner_rating = ? where id = ?", (avg, race_id))
            self.send_json(state_payload())
            return

        self.send_error(404)

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["api", "restaurants"]:
            restaurant_id = int(parts[2])
            with connect() as con:
                con.execute("update restaurants set active = 0 where id = ?", (restaurant_id,))
            self.send_json(state_payload())
            return
        if len(parts) == 4 and parts[:2] == ["api", "restaurants"] and parts[3] == "hide-suggestion":
            restaurant_id = int(parts[2])
            with connect() as con:
                row = con.execute("select name from restaurants where id = ?", (restaurant_id,)).fetchone()
                if row:
                    # Hide every duplicate with the same name, otherwise the
                    # suggestion immediately reappears from another row.
                    target = normalize_logo_name(row["name"])
                    ids = [
                        r["id"]
                        for r in con.execute("select id, name from restaurants").fetchall()
                        if normalize_logo_name(r["name"]) == target
                    ]
                    con.executemany(
                        "update restaurants set hidden_suggestion = 1 where id = ?",
                        [(item,) for item in ids],
                    )
            self.send_json(state_payload())
            return
        if len(parts) == 3 and parts[:2] == ["api", "races"]:
            race_id = int(parts[2])
            with connect() as con:
                if not con.execute("select id from races where id = ?", (race_id,)).fetchone():
                    self.send_json({"error": "Race not found."}, status=404)
                    return
                con.execute("delete from race_ratings where race_id = ?", (race_id,))
                con.execute("delete from race_participants where race_id = ?", (race_id,))
                con.execute("delete from races where id = ?", (race_id,))
            self.send_json(state_payload())
            return
        self.send_error(404)

    def read_json(self) -> dict:
        length = min(int(self.headers.get("content-length", "0")), MAX_BODY)
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def guess_type(self, path: str) -> str:
        return mimetypes.guess_type(path)[0] or "application/octet-stream"


# build: 20260611-race
if __name__ == "__main__":
    init_db()
    threading.Thread(target=seed_curated_logos, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("Foodie Pick Derby running at http://127.0.0.1:8000")
    server.serve_forever()
