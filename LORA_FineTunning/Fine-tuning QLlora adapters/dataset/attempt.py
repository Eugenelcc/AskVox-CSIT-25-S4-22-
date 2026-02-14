

# tavily_extract.py
import json
import re
from tavily import TavilyClient

TAVILY_API_KEY = "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"
client = TavilyClient(api_key=TAVILY_API_KEY)

def clean_text(t: str) -> str:
    if not t:
        return ""
    t = re.sub(r"\s+", " ", t).strip()
    return t

def extract_key_sentences(text: str, max_sentences: int = 5):
    """
    Very lightweight extraction:
    - split into sentences
    - keep the first informative-looking ones
    """
    text = clean_text(text)
    if not text:
        return []

    # naive sentence split (good enough for quick checks)
    sentences = re.split(r"(?<=[.!?])\s+", text)

    picked = []
    for s in sentences:
        s = s.strip()
        # skip tiny / low-value sentences
        if len(s) < 40:
            continue
        # avoid boilerplate-ish lines
        if any(x in s.lower() for x in ["cookie", "subscribe", "sign up", "privacy policy"]):
            continue
        picked.append(s)
        if len(picked) >= max_sentences:
            break

    return picked

def tavily_search_and_extract(query: str, max_results: int = 5):
    resp = client.search(
        query=query,
        search_depth="advanced",
        include_answer=False,
        max_results=max_results,
        include_raw_content=True,   # helps extraction a lot if available
    )

    extracted = {
        "query": query,
        "results": []
    }

    for r in resp.get("results", []):
        title = r.get("title")
        url = r.get("url")
        score = r.get("score")
        content = r.get("content") or ""
        raw = r.get("raw_content") or ""

        # Prefer raw_content if it exists and is longer
        text_for_extraction = raw if len(raw) > len(content) else content

        evidence = extract_key_sentences(text_for_extraction, max_sentences=5)

        extracted["results"].append({
            "title": title,
            "url": url,
            "score": score,
            "evidence": evidence,
            "preview": clean_text(text_for_extraction)[:400]  # quick debug preview
        })

    return extracted

if __name__ == "__main__":
    q = "What causes the Northern Lights?"
    data = tavily_search_and_extract(q, max_results=5)

    print(json.dumps(data, indent=2, ensure_ascii=False))
