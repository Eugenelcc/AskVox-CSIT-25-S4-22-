from typing import List, Optional
import os
import httpx
import asyncio
import json
import re
import urllib.parse
from datetime import datetime, timezone
from difflib import SequenceMatcher 

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession 
from sqlalchemy import select, delete
from pydantic import BaseModel 
from bs4 import BeautifulSoup 

try:
    from ddgs import DDGS
except ImportError:
    try:
        from duckduckgo_search import DDGS
    except ImportError:
        DDGS = None
        print("❌ CRITICAL: 'ddgs' library not found. Run 'pip install ddgs'.")

from google import genai 
from google.genai import types
from app.db.session import get_db 
from app.models import NewsCache

router = APIRouter()

# --- CONFIGURATION ---
GEMINI_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash") 
JINA_KEY = os.getenv("JINA_API_KEY")

gemini_client = None
if GEMINI_KEY:
    try:
        gemini_client = genai.Client(api_key=GEMINI_KEY)
    except Exception as e:
        print(f"❌ Gemini Client Error: {e}")

CACHE_MINUTES = 30 

# --- COUNTRY SIGNALS ---
COUNTRY_DATA = {
    "sg": {
        "name": "Singapore",
        "aliases": ["sg", "s'pore", "singapura", "singapur"],
        "domains": [
            ".sg",
            "straitstimes.com",
            "channelnewsasia.com",
            "cna.asia",
            "todayonline.com",
            "businesstimes.com.sg",
            "mothership.sg",
            "zaobao.com",
            "gov.sg",
        ],
        "source_keywords": ["straits times", "channel newsasia", "cna", "today", "business times", "mothership", "zaobao"],
        "query_terms": ["Singapore", "SG"],
    },
    "us": {
        "name": "United States",
        "aliases": ["usa", "u.s.", "u.s", "america"],
        "domains": [".us"],
        "source_keywords": ["reuters", "ap", "associated press"],
        "query_terms": ["United States", "US"],
    },
    "gb": {
        "name": "United Kingdom",
        "aliases": ["uk", "u.k.", "britain", "british"],
        "domains": [".uk", ".co.uk"],
        "source_keywords": ["bbc", "reuters", "the guardian"],
        "query_terms": ["United Kingdom", "UK"],
    },
    "in": {
        "name": "India",
        "aliases": ["bharat"],
        "domains": [".in"],
        "source_keywords": ["times of india", "hindustan times"],
        "query_terms": ["India"],
    },
    "jp": {
        "name": "Japan",
        "aliases": ["nippon"],
        "domains": [".jp"],
        "source_keywords": ["nhk", "yomiuri"],
        "query_terms": ["Japan"],
    },
    "au": {
        "name": "Australia",
        "aliases": ["australia", "aussie"],
        "domains": [".au"],
        "source_keywords": ["abc", "sydney morning herald"],
        "query_terms": ["Australia"],
    },
}

# --- HELPERS ---

def clean_html(raw_html):
    if not raw_html: return ""
    clean = re.sub('<.*?>', '', raw_html)
    return clean.strip()

def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip().lower()

def extract_domain(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).netloc.lower().replace("www.", "")
    except Exception:
        return ""

def is_category_match(text: str, category: str) -> bool:
    cat_lower = (category or "").lower()
    if not cat_lower:
        return True
    if cat_lower in {"trending", "breaking", "top"}:
        return True
    if cat_lower in text:
        return True

    keywords = {
        "gaming": ["game", "playstation", "xbox", "nintendo", "steam", "esports", "console", "pc", "mobile", "review", "ign", "kotaku"],
        "technology": ["tech", "ai", "software", "apple", "google", "samsung", "mobile", "app", "cyber", "robot", "chip", "startup", "data"],
        "business": ["market", "stock", "economy", "trade", "finance", "invest", "bank", "ceo", "startup", "biz"],
        "sports": ["score", "team", "league", "cup", "champion", "olympic", "football", "soccer", "nba", "tennis", "f1"],
        "entertainment": ["movie", "film", "music", "song", "star", "celebrity", "hollywood", "netflix", "disney", "drama"],
        "science": ["space", "nasa", "planet", "study", "research", "biology", "physics", "climate", "environment"],
        "health": ["virus", "disease", "medicine", "medical", "doctor", "health", "vaccine", "cancer", "hospital"],
        "world": ["politics", "war", "election", "government", "policy", "international", "crisis", "un", "law"],
    }

    related_words = keywords.get(cat_lower, [])
    return any(word in text for word in related_words)

def is_country_match(item: dict, country_info: Optional[dict]) -> bool:
    if not country_info:
        return True

    title = normalize_text(item.get("title", ""))
    body = normalize_text(item.get("body", ""))
    source = normalize_text(item.get("source", ""))
    text = f"{title} {body} {source}"

    name = normalize_text(country_info.get("name", ""))
    aliases = [normalize_text(x) for x in country_info.get("aliases", [])]
    if name and name in text:
        return True
    if any(alias and alias in text for alias in aliases):
        return True

    domain = extract_domain(item.get("url", ""))
    for d in country_info.get("domains", []):
        d = d.lower()
        if d.startswith(".") and domain.endswith(d):
            return True
        if d in domain:
            return True

    for kw in country_info.get("source_keywords", []):
        if kw in source:
            return True

    return False

def is_relevant(item, category, country_info):
    text = normalize_text((item.get("title", "") + " " + item.get("body", "")))
    if not is_category_match(text, category):
        return False
    if not is_country_match(item, country_info):
        return False
    return True

def parse_pubdate(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    try:
        dt = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
        return dt.replace(tzinfo=timezone.utc)
    except Exception:
        pass
    try:
        dt = datetime.strptime(value, "%Y-%m-%d")
        return dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None

def normalize_pubdate(value: Optional[str]) -> Optional[str]:
    dt = parse_pubdate(value)
    return dt.isoformat() if dt else None

def pick_entry_pubdate(entry: dict) -> Optional[str]:
    candidates = [
        entry.get("updated"),
        entry.get("updated_at"),
        entry.get("date"),
        entry.get("published"),
        entry.get("published_at"),
        entry.get("pubDate"),
        entry.get("publishedAt"),
    ]
    latest_dt = None
    for value in candidates:
        dt = parse_pubdate(value)
        if dt and (latest_dt is None or dt > latest_dt):
            latest_dt = dt
    return latest_dt.isoformat() if latest_dt else None

async def get_main_image(client, url):
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"}
        response = await client.get(url, headers=headers, timeout=2.5, follow_redirects=True)
        if response.status_code != 200: return ""

        soup = BeautifulSoup(response.text, "html.parser")
        og = soup.find("meta", property="og:image")
        if og and og.get("content"): 
            if "google" not in og["content"] and "gstatic" not in og["content"]:
                return og["content"]
        
        tw = soup.find("meta", name="twitter:image")
        if tw and tw.get("content"): return tw["content"]
    except:
        pass 
    return ""

async def fetch_jina_content(client, url):
    try:
        jina_url = f"https://r.jina.ai/{url}"
        headers = {"Authorization": f"Bearer {JINA_KEY}"} if JINA_KEY else {}
        response = await client.get(jina_url, headers=headers, timeout=5.0)
        if response.status_code == 200:
            data = response.json()
            return data.get("data", {}).get("content", "")[:15000] 
    except:
        return ""
    return ""

class NewsSynthesizeRequest(BaseModel):
    query: str 
    sources: Optional[List[dict]] = [] 

# 🟢 SYNC FUNCTION: DuckDuckGo Batch Fetch
def fetch_ddg_batch(query, region, max_results=80, timelimit="w"):
    try:
        if DDGS is None: return []
        with DDGS() as ddgs:
            # High volume fetch per query
            results = ddgs.news(query=query, region=region, timelimit=timelimit, max_results=max_results)
            return list(results)
    except:
        return []

# ==========================================
# ENDPOINT: REFRESH NEWS (HIGH SOURCE DENSITY)
# ==========================================
@router.post("/news/refresh")
async def refresh_news(category: str = "technology", country: str = None, db: AsyncSession = Depends(get_db)):
    
    # 1. CACHE CHECK
    cache_key = f"AI_FEED_{category}_{country}" if country else f"AI_FEED_{category}"
    result = await db.execute(select(NewsCache).where(NewsCache.category == cache_key))
    existing_row = result.scalar_one_or_none()
    
    if existing_row:
        last_updated = existing_row.updated_at.replace(tzinfo=timezone.utc)
        if (datetime.now(timezone.utc) - last_updated).total_seconds() < (CACHE_MINUTES * 60):
            print(f"📦 CACHE HIT: {cache_key}")
            return existing_row.data

    print(f"==========================================")
    
    # 2. QUERY CONSTRUCTION
    country_code = None
    if country and country != "global":
        country_code = country.lower()
        if country_code not in COUNTRY_DATA and len(country_code) != 2:
            country_code = None

    country_info = COUNTRY_DATA.get(country_code) if country_code else None
    if not country_info and country and country != "global":
        country_info = {
            "name": country,
            "aliases": [],
            "domains": [],
            "source_keywords": [],
            "query_terms": [country],
        }
    c_name = country_info["name"] if country_info else (country if country and country != "global" else None)

    region_param = f"{country_code}-en" if country_code else "wt-wt"

    queries = [
        f"{category} news",
        f"latest {category} news",
        f"{category} headlines",
        f"breaking {category}",
        f"{category} updates",
        f"top {category} stories",
    ]

    if c_name:
        queries.extend([
            f"{category} news {c_name}",
            f"{category} headlines {c_name}",
            f"{c_name} {category} news",
            f"{category} {c_name}",
        ])

    if country_info:
        for term in country_info.get("query_terms", []):
            queries.append(f"{category} news {term}")
            queries.append(f"{category} headlines {term}")
        for domain_hint in country_info.get("domains", []):
            if domain_hint.startswith("."):
                queries.append(f"{category} site:{domain_hint}")
    
    print(f"🚀 DDG MULTI-FETCH: {queries} (Region: {region_param})")

    # 3. PARALLEL EXECUTION
    tasks = []
    for q in queries:
        tasks.append(asyncio.to_thread(fetch_ddg_batch, q, region_param, 80, "w"))
    
    batch_results = await asyncio.gather(*tasks)
    raw_list = [item for batch in batch_results for item in batch]
    # Fallback: If region is too restrictive, retry with global (still filtered by country signals)
    if len(raw_list) < 25 and region_param != "wt-wt":
        print("⚠️ Low results for region, retrying with global region (country filter still enforced)...")
        global_tasks = [asyncio.to_thread(fetch_ddg_batch, q, "wt-wt", 80, "w") for q in queries]
        global_results = await asyncio.gather(*global_tasks)
        raw_list.extend([item for batch in global_results for item in batch])
    print(f"✅ COMBINED FETCH: {len(raw_list)} items found")

    # 4. FILTERING (🟢 REMOVED TITLE DEDUP)
    valid_items = []
    seen_urls = set() 
    
    for entry in raw_list:
        title = entry.get('title')
        url = entry.get('url')
        if not title or not url: continue

        # 🟢 Deduplicate ONLY by URL (Exact same link)
        # We WANT the same title from different sources (e.g. IGN vs Verge)
        if url in seen_urls: continue
        seen_urls.add(url)
        
        # Relevance Check
        if not is_relevant(entry, category, country_info):
            continue
        
        valid_items.append({
            "title": title,
            "link": url,
            "source": entry.get('source', 'Unknown'),
            "domain_url": url,
            "pubDate": pick_entry_pubdate(entry) or datetime.now(timezone.utc).isoformat(),
            "description": entry.get('body', ''), 
            "image": "" 
        })

    print(f"🧹 FINAL LIST: {len(valid_items)} valid stories (Includes duplicate titles from diff sources)")

    # If country filter is too strict, relax to category-only to avoid empty feeds
    if country_info and len(valid_items) < 10:
        print("⚠️ Low country-matched results, relaxing to category-only filter...")
        for entry in raw_list:
            title = entry.get('title')
            url = entry.get('url')
            if not title or not url:
                continue
            if url in seen_urls:
                continue

            text = normalize_text(title + " " + entry.get('body', ''))
            if not is_category_match(text, category):
                continue

            seen_urls.add(url)
            valid_items.append({
                "title": title,
                "link": url,
                "source": entry.get('source', 'Unknown'),
                "domain_url": url,
                "pubDate": pick_entry_pubdate(entry) or datetime.now(timezone.utc).isoformat(),
                "description": entry.get('body', ''),
                "image": ""
            })

        print(f"🧹 RELAXED LIST: {len(valid_items)} valid stories after category-only fallback")
    
    # Increase buffer to allow more sources
    valid_items = valid_items[:140]

    # 4.5 ENRICHMENT: Pull additional sources for top headlines
    if len(valid_items) < 60:
        seed_titles = [it['title'] for it in valid_items[:8]]
        enrich_tasks = []
        for title in seed_titles:
            enrich_query = f"\"{title}\""
            enrich_tasks.append(asyncio.to_thread(fetch_ddg_batch, enrich_query, region_param, 40, "m"))
        enrich_results = await asyncio.gather(*enrich_tasks)
        for batch in enrich_results:
            for entry in batch:
                title = entry.get('title')
                url = entry.get('url')
                if not title or not url: 
                    continue
                if url in seen_urls:
                    continue
                if not is_relevant(entry, category, country_info):
                    continue
                seen_urls.add(url)
                valid_items.append({
                    "title": title,
                    "link": url,
                    "source": entry.get('source', 'Unknown'),
                    "domain_url": url,
                    "pubDate": pick_entry_pubdate(entry) or datetime.now(timezone.utc).isoformat(),
                    "description": entry.get('body', ''),
                    "image": ""
                })

    # 5. FETCH IMAGES PARALLEL
    async with httpx.AsyncClient() as client:
        tasks = [get_main_image(client, item['link']) for item in valid_items]
        images = await asyncio.gather(*tasks)

    for i, item in enumerate(valid_items):
        item['image'] = images[i] or ""

    if not valid_items: return []

    # 6. GEMINI CLUSTERING
    headlines_text = "\n".join([f"[{i}] {item['title']} ({item['source']})" for i, item in enumerate(valid_items)])
    
    prompt = f"""
    Act as a News Editor. Group these {len(valid_items)} headlines into news clusters.
    
    CRITICAL INSTRUCTION:
    We WANT many sources per story.
    If you see 5 articles with the headline "Sony PS5 Pro Announced" from different sources, GROUP THEM ALL TOGETHER.
    Do not split them because the titles are similar. Stack them to show 5+ sources.

    HEADLINES:
    {headlines_text}

    OUTPUT JSON ONLY (A list of lists of integers):
    [[0, 1, 5, 8, 9], [2], [3, 4]]
    """

    clustered_stories = []
    
    for attempt in range(3):
        try:
            if not gemini_client: raise Exception("No API Key")

            response = gemini_client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json")
            )
            groups_of_indices = json.loads(response.text)
            
            for indices in groups_of_indices:
                if not indices: continue
                
                cluster_items = []
                for idx in indices:
                    if idx < len(valid_items):
                        cluster_items.append(valid_items[idx])
                
                if not cluster_items: continue

                lead = cluster_items[0]
                latest_dt = None
                for it in cluster_items:
                    dt = parse_pubdate(it.get("pubDate"))
                    if dt and (latest_dt is None or dt > latest_dt):
                        latest_dt = dt
                latest_pub = latest_dt.isoformat() if latest_dt else lead.get("pubDate")
                hero_image = next((item['image'] for item in cluster_items if item['image']), "")
                
                if not hero_image: 
                    hero_image = "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=800&q=80"

                story_obj = {
                    "id": f"group_{datetime.now().timestamp()}_{indices[0]}",
                    "title": lead['title'],       
                    "description": lead['description'],
                    "publishedAt": latest_pub,
                    "url": lead['link'],
                    "imageUrl": hero_image,
                    "source": lead['source'],
                    "all_sources": [
                        {
                            "title": it['title'],
                            "url": it['link'],
                            "source": it['source'],
                            "domain_url": it['domain_url'],
                            "description": it['description']
                        } for it in cluster_items
                    ]
                }
                clustered_stories.append(story_obj)

            # Sort by cluster size (Stories with MORE sources float to top)
            clustered_stories.sort(key=lambda x: len(x['all_sources']), reverse=True)
            
            # Return Top 20
            clustered_stories = clustered_stories[:20]
            
            print(f"✅ CLUSTERING DONE: Returning Top {len(clustered_stories)}.")
            break 

        except Exception as e:
            if attempt < 2:
                await asyncio.sleep(2)
            else:
                print(f"❌ Clustering Failed: {e}")
                return []

    # 7. SAVE TO CACHE
    if clustered_stories:
        try:
            await db.execute(delete(NewsCache).where(NewsCache.category == cache_key))
            new_entry = NewsCache(category=cache_key, data=clustered_stories, updated_at=datetime.now(timezone.utc))
            db.add(new_entry)
            await db.commit()
        except Exception as e:
            print(f"⚠️ Cache Error: {e}")
            
    return clustered_stories

# ==========================================
# ENDPOINT 2: DETAIL VIEW (Synthesis)
# ==========================================
@router.post("/news/synthesize")
async def synthesize_news(request: NewsSynthesizeRequest):
    topic = request.query
    print(f"🧪 SYNTHESIZING: '{topic}'")
    sources = request.sources or [] 

    # Fallback if no sources (use DDG instead of Google RSS for reliability)
    if not sources:
        try:
            if DDGS is None: raise Exception("DDGS library not found")
            with DDGS() as ddgs:
                results = ddgs.news(query=topic, region="wt-wt", max_results=5)
                for r in results:
                    sources.append({
                        "title": r['title'],
                        "url": r['url'],
                        "source": r['source'],
                        "snippet": r['body']
                    })
        except Exception as e:
            return {"content": "Could not fetch sources.", "sources": []}

    async with httpx.AsyncClient() as client:
        tasks = [fetch_jina_content(client, s["url"]) for s in sources]
        contents = await asyncio.gather(*tasks)

    combined_text = ""
    valid_sources = []
    for i, text in enumerate(contents):
        final_text = text if len(text) > 200 else sources[i].get('snippet', '')
        combined_text += f"\n--- SOURCE {i+1}: {sources[i].get('source', 'Unknown')} ---\n{final_text}\n"
        s_copy = sources[i].copy()
        s_copy["citation_index"] = i + 1
        valid_sources.append(s_copy)

    # 🟢 UPDATED PROMPT: Dynamic Headers + Senior Journalist Persona
    prompt = f"""
    You are a Senior Chief Editor for a top-tier global publication (like Reuters, The New York Times, or The Economist). 
    Your task is to write a definitive, deep-dive news briefing on: "{topic}".

    ### GOAL:
    Synthesize the provided sources into a master narrative. Do not just list facts; weave them into a story.

    ### STRUCTURE & FORMATTING (Crucial):
    You must use the "Inverted Pyramid" structure.
    **CRITICAL:** For each section, generate a **Dynamic, Descriptive Header** (H2 markdown) that summarizes that specific section's content. 
    *Do not use generic headers like "Introduction" or "Details".*

    **1. The Lede (Executive Summary):**
       * **Header Example:** "## Apple Unveils the iPhone 16 Amidst AI Hype" (Not "Introduction")
       * **Content:** Hook the reader. Answer the Big 4 (Who, What, Where, When). Why is this breaking news?

    **2. The Deep Dive (The Core Details):**
       * **Header Example:** "## A Shift in Strategy: The Move to Custom Silicon" (Not "The Details")
       * **Content:** Synthesize the facts. Cross-reference sources. 
           * If sources disagree, note it (e.g., "While [1] reports X, [2] suggests Y").
           * Include specific numbers, dates, stats, or quotes.

    **3. Context & Implications (The Analysis):**
       * **Header Example:** "## Ripples in the Tech Sector: What This Means for Competitors" (Not "Conclusion")
       * **Content:** Provide historical background and future outlook. Why does this matter in the grand scheme?

    ### TONE & CITATIONS:
    * **Tone:** Authoritative, objective, and dense. No flowery language.
    * **Citations:** You MUST cite sources as [1], [2] immediately after specific claims.
    
    ### SOURCE MATERIAL:
    {combined_text}
    """

    try:
        response = gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
        content = response.text
    except Exception as e:
        content = f"AI Error: {e}"

    return {"content": content, "sources": valid_sources}