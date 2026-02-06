from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/sports", tags=["sports"])

SportKey = Literal["nba", "mlb", "soccer", "nfl"]


SPORT_CONFIG: dict[SportKey, dict[str, str]] = {
    "nba": {"sport": "basketball", "league": "nba", "title": "NBA"},
    "mlb": {"sport": "baseball", "league": "mlb", "title": "MLB"},
    "nfl": {"sport": "football", "league": "nfl", "title": "NFL"},
    # Default soccer league: English Premier League (eng.1). Override with ?league=...
    "soccer": {"sport": "soccer", "league": "eng.1", "title": "Soccer"},
}


def _normalize_state(raw: Any) -> Optional[str]:
    if not isinstance(raw, str):
        return None
    v = raw.strip().lower()
    if v in {"in", "live", "inprogress", "in_progress"}:
        return "in"
    if v in {"pre", "scheduled", "schedule"}:
        return "pre"
    if v in {"post", "final", "closed", "complete"}:
        return "post"
    return v or None


def _yyyymmdd(dt: datetime) -> str:
    return dt.strftime("%Y%m%d")


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _pick_logo(team_obj: dict[str, Any]) -> Optional[str]:
    # ESPN sometimes uses `logo` or `logos`.
    logo = team_obj.get("logo")
    if isinstance(logo, str) and logo:
        return logo
    logos = _as_list(team_obj.get("logos"))
    for entry in logos:
        e = _as_dict(entry)
        href = e.get("href")
        if isinstance(href, str) and href:
            return href
    return None


def _parse_competitor(competitor_obj: dict[str, Any]) -> dict[str, Any]:
    team = _as_dict(competitor_obj.get("team"))
    score = competitor_obj.get("score")
    score_val: Optional[int] = None
    if isinstance(score, str) and score.isdigit():
        score_val = int(score)
    elif isinstance(score, (int, float)):
        score_val = int(score)

    return {
        "name": team.get("displayName") if isinstance(team.get("displayName"), str) else None,
        "shortName": team.get("shortDisplayName") if isinstance(team.get("shortDisplayName"), str) else None,
        "abbr": team.get("abbreviation") if isinstance(team.get("abbreviation"), str) else None,
        "logo": _pick_logo(team),
        "score": score_val,
    }


@router.get("/scoreboard/{sport_key}")
async def get_scoreboard(
    sport_key: SportKey,
    league: Optional[str] = Query(default=None, description="Override league (ESPN code). e.g. eng.1, esp.1, nba, wnba, mlb, nfl"),
    dates: Optional[str] = Query(default=None, description="Optional ESPN dates param, format YYYYMMDD"),
):
    config = SPORT_CONFIG.get(sport_key)
    if not config:
        raise HTTPException(status_code=400, detail="Unsupported sport")

    sport = config["sport"]
    use_league = league or config["league"]

    url = f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{use_league}/scoreboard"
    params: dict[str, str] = {}
    params["limit"] = "200"
    if dates:
        params["dates"] = dates

    try:
        async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": "AskVox/1.0"}) as client:
            res = await client.get(url, params=params)
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Sports upstream request failed: {e}") from e

    if res.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Sports upstream returned {res.status_code}")

    payload = res.json()
    events = _as_list(payload.get("events"))

    live: list[dict[str, Any]] = []
    upcoming: list[dict[str, Any]] = []
    recent: list[dict[str, Any]] = []

    def _ingest_events(events_list: list[Any]):
        for event in events_list:
            e = _as_dict(event)
            event_id = e.get("id")
            event_name = e.get("name") if isinstance(e.get("name"), str) else None
            event_date = e.get("date") if isinstance(e.get("date"), str) else None

            comp = _as_dict((_as_list(e.get("competitions"))[:1] or [None])[0])
            competitors = _as_list(comp.get("competitors"))

            home_obj = next((c for c in competitors if _as_dict(c).get("homeAway") == "home"), None)
            away_obj = next((c for c in competitors if _as_dict(c).get("homeAway") == "away"), None)

            home = _parse_competitor(_as_dict(home_obj)) if home_obj else {}
            away = _parse_competitor(_as_dict(away_obj)) if away_obj else {}

            status = _as_dict(comp.get("status") or e.get("status"))
            status_type = _as_dict(status.get("type"))
            state = _normalize_state(status_type.get("state"))
            detail = status_type.get("detail") if isinstance(status_type.get("detail"), str) else None
            short_detail = status_type.get("shortDetail") if isinstance(status_type.get("shortDetail"), str) else None

            normalized = {
                "id": event_id,
                "name": event_name,
                "date": event_date,
                "status": {
                    "state": state,
                    "detail": detail,
                    "shortDetail": short_detail,
                },
                "home": home,
                "away": away,
            }

            if state == "in":
                live.append(normalized)
            elif state == "pre":
                upcoming.append(normalized)
            elif state == "post":
                recent.append(normalized)


    _ingest_events(events)

    # If ESPN's default day doesn't contain enough upcoming games, look ahead a few days
    # so the UI can show multiple fixtures (schedule-like).
    # Note: if the client passes `dates=`, we respect that and don't auto-extend.
    if not dates and len(upcoming) < 6:
        base = datetime.now(timezone.utc)
        forward_days = 5 if sport_key in {"nba", "mlb", "nfl"} else 10
        try:
            async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": "AskVox/1.0"}) as client:
                for i in range(1, forward_days + 1):
                    res2 = await client.get(url, params={"limit": "200", "dates": _yyyymmdd(base + timedelta(days=i))})
                    if res2.status_code != 200:
                        continue
                    p2 = res2.json()
                    _ingest_events(_as_list(p2.get("events")))

                    if len(upcoming) >= 6 or len(live) > 0:
                        break
        except httpx.RequestError:
            # Best-effort; keep empty if upstream fails.
            pass

    # If we still don't have enough finished games, look back a few days.
    # Soccer schedules can be more spread out, so we look further back.
    if not dates and len(recent) < 6:
        base = datetime.now(timezone.utc)
        back_days = 3 if sport_key in {"nba", "mlb", "nfl"} else 10
        try:
            async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": "AskVox/1.0"}) as client:
                for i in range(1, back_days + 1):
                    res_prev = await client.get(url, params={"limit": "200", "dates": _yyyymmdd(base - timedelta(days=i))})
                    if res_prev.status_code != 200:
                        continue
                    p_prev = res_prev.json()
                    _ingest_events(_as_list(p_prev.get("events")))
                    if len(recent) >= 6:
                        break
        except httpx.RequestError:
            pass

    # De-dupe in case multi-day lookahead repeats events
    def _dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        out: list[dict[str, Any]] = []
        for it in items:
            _id = it.get("id")
            if isinstance(_id, str) and _id:
                if _id in seen:
                    continue
                seen.add(_id)
            out.append(it)
        return out

    live = _dedupe(live)
    upcoming = _dedupe(upcoming)
    recent = _dedupe(recent)

    def _sort_key(item: dict[str, Any]) -> str:
        d = item.get("date")
        return d if isinstance(d, str) else ""

    live = sorted(live, key=_sort_key)
    upcoming = sorted(upcoming, key=_sort_key)
    # Most recent finals first
    recent = sorted(recent, key=_sort_key, reverse=True)
    recent = recent[:10]

    return {
        "sport": sport_key,
        "league": use_league,
        "title": config["title"],
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "live": live,
        "upcoming": upcoming,
        "recent": recent,
    }
