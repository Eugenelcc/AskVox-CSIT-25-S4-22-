import os
import uuid
from datetime import datetime
from pathlib import Path
import httpx
from dotenv import load_dotenv

"""
Seeds Supabase `queries` for a specific user across key learning domains.

Requirements:
- Environment variables (loaded automatically from backend/.env):
    - SUPABASE_URL
    - SUPABASE_SERVICE_ROLE_KEY
- Target user email: update TARGET_EMAIL below or pass via env `SEED_TARGET_EMAIL`.

Run:
    python seeding/seed_supabase_queries.py
"""

# Load env from backend/.env so keys are available when running locally
BASE_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = BASE_DIR / ".env"
load_dotenv(ENV_PATH)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
TARGET_EMAIL = os.getenv("SEED_TARGET_EMAIL", "askvoxfyp@gmail.com")

REST = f"{SUPABASE_URL}/rest/v1"
HEADERS = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY or "",
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}" if SUPABASE_SERVICE_ROLE_KEY else "",
    "Content-Type": "application/json",
}

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise SystemExit(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Ensure backend/.env is populated or export envs before running."
    )


def get_user_profile_id(client: httpx.Client, email: str) -> str:
    # Query profiles by email to resolve the auth user id
    url = f"{REST}/profiles?email=eq.{email}&select=id,email,username&limit=1"
    r = client.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    rows = r.json()
    if not rows:
        raise RuntimeError(f"No profile found for email {email}")
    return rows[0]["id"]


def ensure_domain_session(client: httpx.Client, user_id: str, domain: str) -> str:
    """Find or create a chat session for a specific domain so all queries of
    that domain share the same chat thread. Title format: "Seeded: {domain}".
    """
    title = f"Seeded: {domain}"
    url = f"{REST}/chat_sessions?user_id=eq.{user_id}&title=eq.{title}&select=id,title&limit=1"
    r = client.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    rows = r.json()
    if rows:
        return rows[0]["id"]
    payload = {"user_id": user_id, "title": title}
    r = client.post(
        f"{REST}/chat_sessions",
        headers={**HEADERS, "Prefer": "return=representation"},
        json=payload,
        timeout=30,
    )
    r.raise_for_status()
    new_rows = r.json()
    if not new_rows:
        raise RuntimeError("Failed to create chat session for domain")
    return new_rows[0]["id"]


def build_seed_questions(limit: int = 10):
    """Return exactly `limit` (domain, text) pairs drawn from the 7 domains."""
    pool = [
        ("Science", "How does Newton's second law explain acceleration?"),
        ("Science", "What do mitochondria do in human cells?"),
        ("History and World Events", "Summarize the causes of the Cold War."),
        ("History and World Events", "What were the turning points of World War II?"),
        ("Sports", "How is rugby different from American football?"),
        ("Sports", "Create a 4-week plan to improve my 5K time."),
        ("Cooking & Food", "How do I make a classic béchamel sauce?"),
        ("Language Learning", "Best ways to memorize new Spanish vocabulary."),
        ("Geography and Travel", "Why is the Pacific Ring of Fire so active?"),
        ("Art, Music and Literature", "What defines Impressionism in painting?"),
        # extras in case limit changes later
        ("Cooking & Food", "Tips for fermenting a sourdough starter at home."),
        ("Language Learning", "Explain the difference between 'ser' and 'estar'."),
        ("Geography and Travel", "3-day itinerary suggestions for Kyoto."),
        ("Art, Music and Literature", "Compare a sonata and a symphony in classical music."),
    ]
    return pool[:limit]


def main():
    with httpx.Client() as client:
        user_id = get_user_profile_id(client, TARGET_EMAIL)

        # Build 10 questions and assign each to its domain-specific session
        now_iso = datetime.utcnow().isoformat() + "Z"
        questions = build_seed_questions(limit=10)
        payload = []
        for domain, text in questions:
            session_id = ensure_domain_session(client, user_id, domain)
            payload.append({
                "user_id": user_id,
                "session_id": session_id,
                "input_mode": "text",
                "transcribed_text": text,
                "detected_domain": domain,
                "created_at": now_iso,
            })
        r = client.post(
            f"{REST}/queries",
            headers={**HEADERS, "Prefer": "return=representation"},
            json=payload,
            timeout=60,
        )
        r.raise_for_status()
        rows = r.json()
        print(f"Inserted {len(rows)} queries for user {TARGET_EMAIL} (user_id={user_id}) into domain sessions.")

        # Also seed responses + chat_messages per query
        def assistant_reply(domain: str, text: str) -> str:
            d = domain.lower()
            if "science" in d:
                return "In physics, F = m·a describes how force changes motion; in biology, mitochondria produce ATP for energy."
            if "history" in d or "world events" in d:
                return "The Cold War mixed ideological rivalry with proxy conflicts, nuclear deterrence, and shifting alliances."
            if "sports" in d:
                return "Rugby uses continuous play, no forward passes, and contested scrums—unlike gridiron's downs and forward passing."
            if "cooking" in d or "food" in d:
                return "Béchamel: cook butter + flour (roux), whisk in warm milk, simmer till smooth; season with salt and nutmeg."
            if "language" in d:
                return "Span. 'ser' describes essence/identity; 'estar' covers states/locations (soy estudiante vs. estoy cansado)."
            if "geography" in d or "travel" in d:
                return "The Ring of Fire encircles the Pacific due to subduction zones, causing frequent quakes and volcanism."
            if "art" in d or "music" in d or "literature" in d:
                return "Impressionism captures light and momentary perception with loose brushwork and outdoor scenes (plein air)."
            # Fallback: brief helpful acknowledgement
            return "Here's a concise overview and key facts for that topic."

        # First, insert responses linked to each query
        # Insert responses (schema-tolerant)
        base_responses = []
        for q in rows:
            q_text = q.get("transcribed_text") or ""
            q_domain = q.get("detected_domain") or "General"
            base_responses.append({
                "query_id": q["id"],
                "response_text": assistant_reply(q_domain, q_text),
            })

        responses_inserted = []
        try:
            rc_resp = client.post(
                f"{REST}/responses",
                headers={**HEADERS, "Prefer": "return=representation"},
                json=base_responses,
                timeout=60,
            )
            rc_resp.raise_for_status()
            responses_inserted = rc_resp.json()
            print(f"Inserted {len(responses_inserted)} responses linked to queries.")
        except httpx.HTTPStatusError:
            alt_responses = []
            for br, q in zip(base_responses, rows):
                alt_responses.append({
                    "query_id": q["id"],
                    "content": br["response_text"],
                })
            rc_resp = client.post(
                f"{REST}/responses",
                headers={**HEADERS, "Prefer": "return=representation"},
                json=alt_responses,
                timeout=60,
            )
            rc_resp.raise_for_status()
            responses_inserted = rc_resp.json()
            print(f"Inserted {len(responses_inserted)} responses (alt schema) linked to queries.")

        # Build chat messages (user + assistant) using the inserted responses' text
        resp_map = {}
        for r in responses_inserted:
            qid = r.get("query_id")
            txt = r.get("response_text") or r.get("content")
            if qid and txt:
                resp_map[qid] = txt
        chat_rows = []
        for q in rows:
            q_text = q.get("transcribed_text") or ""
            q_session = q.get("session_id")
            # user message
            chat_rows.append({
                "id": str(uuid.uuid4()),
                "session_id": q_session,
                "user_id": user_id,
                "role": "user",
                "content": q_text,
                "display_name": None,
            })
            # assistant message
            chat_rows.append({
                "id": str(uuid.uuid4()),
                "session_id": q_session,
                "user_id": None,
                "role": "assistant",
                "content": resp_map.get(q["id"], "Here's a concise overview and key facts for that topic."),
                "display_name": "AskVox",
            })

        if chat_rows:
            rc = client.post(
                f"{REST}/chat_messages",
                headers={**HEADERS, "Prefer": "return=representation"},
                json=chat_rows,
                timeout=60,
            )
            rc.raise_for_status()
            inserted = rc.json()
            print(f"Inserted {len(inserted)} chat_messages linked to seeded queries across domain sessions.")


if __name__ == "__main__":
    main()
