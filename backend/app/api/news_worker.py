import os
import httpx
from datetime import datetime, timedelta, timezone 
from dateutil import parser 
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession 
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert
from app.db.session import get_db 
from app.models import NewsCache

router = APIRouter()

NEWSDATA_KEY = os.getenv("NEWSDATA_API_KEY")
BASE_URL = "https://newsdata.io/api/1/news"

# --- CONFIGURATION ---
CACHE_MINUTES = 60
SGT = timezone(timedelta(hours=8))

@router.post("/news/refresh")
async def refresh_news(category: str = "technology", db: AsyncSession = Depends(get_db)):
    if not NEWSDATA_KEY:
        raise HTTPException(status_code=500, detail="API Key missing")

    # --- STEP 1: CHECK DATABASE ---
    result = await db.execute(select(NewsCache).where(NewsCache.category == category))
    existing_row = result.scalar_one_or_none()
    
    if existing_row:
        # 1. Get Last Update Time
        last_updated_utc = existing_row.updated_at
        if last_updated_utc.tzinfo is None:
            last_updated_utc = last_updated_utc.replace(tzinfo=timezone.utc)
            
        # 2. Calculate Math
        current_time_utc = datetime.now(timezone.utc)
        time_since_update = current_time_utc - last_updated_utc
        minutes_ago = int(time_since_update.total_seconds() // 60)
        
        # 3. Decision
        if minutes_ago < CACHE_MINUTES:
            wait_time = CACHE_MINUTES - minutes_ago
            time_str = last_updated_utc.astimezone(SGT).strftime('%H:%M:%S')
            
            print(f"📦 CACHE HIT for '{category}':")
            print(f"   - Last Update: {time_str} (SGT) -> {minutes_ago} mins ago.")
            print(f"   - 🛑 SAVING CREDIT. (Wait {wait_time} mins for next refresh)")
            return existing_row.data
        else:
            print(f"⏰ TIMER EXPIRED. {minutes_ago} >= {CACHE_MINUTES} mins. Refreshing '{category}'...")

    else:
        print(f"🆕 FIRST RUN: No data found for '{category}'. Fetching fresh...")

    # --- STEP 2: FETCH FRESH DATA ---
    print(f"🔄 CONTACTING API: Fetching fresh news for: {category}...")
    
    old_articles = existing_row.data if existing_row else []

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                BASE_URL,
                params={
                    "apikey": NEWSDATA_KEY,
                    "category": category,
                    "language": "en", 
                    "image": 1,
                    "size": 10 
                }
            )
            response.raise_for_status()
            data = response.json()
        except Exception as e:
            print(f"❌ External API Error: {e}")
            if old_articles:
                print("⚠️ API failed, serving old data instead.")
                return old_articles
            raise HTTPException(status_code=502, detail="Failed to fetch external news")

    # --- STEP 3: MERGE LOGIC ---
    new_results = data.get('results', [])
    combined_list = []
    seen_titles = set()
    
    def add_if_unique(item_list, is_new):
        for item in item_list:
            if is_new:
                title = item.get('title')
                url = item.get('link')
                img = item.get('image_url')
                pub = item.get('pubDate')
                src = item.get('source_id')
            else:
                title = item.get('title')
                url = item.get('url')
                img = item.get('imageUrl')
                pub = item.get('publishedAt')
                src = item.get('source')

            if not title or not img: continue
            
            clean_title = title.strip().lower()
            if clean_title not in seen_titles:
                seen_titles.add(clean_title)
                combined_list.append({
                    "id": item.get('article_id') if is_new else item.get('id'),
                    "title": title.strip(),
                    "description": item.get('description'),
                    "imageUrl": img,
                    "publishedAt": pub,
                    "category": category,
                    "source": src,
                    "url": url
                })

    add_if_unique(new_results, is_new=True)
    add_if_unique(old_articles, is_new=False)

    def get_date(d):
        try: return parser.parse(str(d))
        except: return datetime.min
        
    combined_list.sort(key=lambda x: get_date(x['publishedAt']), reverse=True)
    final_list = combined_list[:20]

    if not final_list: 
        return []

    # --- PRINT LIST (NOW WITH SGT CONVERSION) ---
    print(f"\n📝 --- FINAL UNIQUE LIST FOR '{category}' ({len(final_list)} items) ---")
    
    for i, article in enumerate(final_list):
        src_label = article.get('source', 'Unknown')
        raw_date = article.get('publishedAt')
        
        # Convert to SGT for display
        try:
            dt = parser.parse(raw_date)
            # If naive, assume UTC
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            # Shift to SG Time
            sgt_date = dt.astimezone(SGT).strftime('%Y-%m-%d %H:%M:%S')
        except:
            sgt_date = "Unknown Date"

        print(f"   [{i+1}] [{src_label}] {article['title'][:40]}... ({sgt_date} SGT)")
        
    print("------------------------------------------------------------\n")

    # --- STEP 4: SAVE ---
    try:
        await db.execute(delete(NewsCache).where(NewsCache.category == category))
        
        new_entry = NewsCache(
            category=category,
            data=final_list,
            updated_at=datetime.now(timezone.utc)
        )
        db.add(new_entry)
        await db.commit()
        
        time_str = datetime.now(SGT).strftime('%H:%M:%S')
        print(f"✅ FRESH UPDATE COMPLETE at {time_str} (SGT).")
        print(f"   (Saved {len(final_list)} articles. Credits Used: 1)")
    except Exception as e:
        print(f"❌ DB SAVE ERROR: {e}")
        await db.rollback()

    return final_list