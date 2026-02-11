

from __future__ import annotations

import hashlib
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────
JINA_API_KEY = os.getenv("JINA_API_KEY", "").strip()
JINA_EMBED_URL = "https://api.jina.ai/v1/embeddings"
JINA_RERANK_URL = "https://api.jina.ai/v1/rerank"
JINA_EMBED_MODEL = os.getenv("JINA_EMBED_MODEL", "jina-embeddings-v3")
JINA_RERANK_MODEL = os.getenv("JINA_RERANK_MODEL", "jina-reranker-v2-base-multilingual")
EMBED_DIM = int(os.getenv("JINA_EMBED_DIM", "512"))

# Supabase connection (REST API, not raw PG — works from any environment)
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

# Tuning knobs
RAG_CANDIDATE_K = int(os.getenv("RAG_CANDIDATE_K", "15"))       # pgvector ANN candidates
RAG_RERANK_TOP_N = int(os.getenv("RAG_RERANK_TOP_N", "5"))      # after reranking, keep top N
RAG_MIN_RERANK_SCORE = float(os.getenv("RAG_MIN_RERANK_SCORE", "0.25"))  # drop low-confidence
RAG_TIMEOUT_SEC = float(os.getenv("RAG_TIMEOUT_SEC", "8.0"))    # total budget for RAG pipeline
RAG_ENABLED = os.getenv("RAG_ENABLED", "1").strip() == "1"

# Domain mapping: classifier domain name → rag_documents.domain column value
# Must match what you used in --domain when running process_dataset.py
RAG_DOMAIN_MAP: Dict[str, str] = {
    "Geography and Travel": "geography",
    "Cooking & Food": "cooking_food",
    "History and World Events": "history",
}

# In-memory query embedding cache (avoids re-embedding identical queries)
_embed_cache: Dict[str, Tuple[float, List[float]]] = {}
_EMBED_CACHE_TTL = 300  # seconds

# ──────────────────────────────────────────────
# Health check
# ──────────────────────────────────────────────
def is_rag_available() -> bool:
    
    return bool(
        RAG_ENABLED
        and JINA_API_KEY
        and SUPABASE_URL
        and SUPABASE_SERVICE_ROLE_KEY
    )


def is_rag_domain(classified_domain: str) -> bool:
    """Return True if this domain has a RAG dataset behind it."""
    return classified_domain in RAG_DOMAIN_MAP


# ──────────────────────────────────────────────
# Jina Embeddings 
# ──────────────────────────────────────────────
async def embed_query(text: str) -> Optional[List[float]]:
    """Embed a single query string using Jina with task=retrieval.query.

    Returns None on any failure (fail-soft).
    """
    if not JINA_API_KEY or not text.strip():
        return None

    # Check cache
    cache_key = hashlib.md5(text.strip().lower().encode()).hexdigest()
    now = time.perf_counter()
    cached = _embed_cache.get(cache_key)
    if cached and (now - cached[0] <= _EMBED_CACHE_TTL):
        return cached[1]

    payload = {
        "model": JINA_EMBED_MODEL,
        "task": "retrieval.query",       
        "dimensions": EMBED_DIM,
        "input": [text.strip()],
    }
    headers = {
        "Authorization": f"Bearer {JINA_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=RAG_TIMEOUT_SEC) as client:
            resp = await client.post(JINA_EMBED_URL, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()["data"]
            embedding = data[0]["embedding"]
            _embed_cache[cache_key] = (now, embedding)
            return embedding
    except Exception as e:
        print(f"[RAG] Jina embed error: {e}", flush=True)
        return None


# ──────────────────────────────────────────────
# Supabase pgvector search (via RPC)
# ──────────────────────────────────────────────
async def vector_search(
    query_embedding: List[float],
    domain_filter: str,
    match_count: int = RAG_CANDIDATE_K,
) -> List[Dict[str, Any]]:
    """Call the match_documents Postgres function via Supabase REST RPC.

    Returns a list of dicts: {id, domain, question, answer, metadata, similarity}
    """
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        return []

    rpc_url = f"{SUPABASE_URL}/rest/v1/rpc/match_documents"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    # The RPC function signature:
    #   match_documents(query_embedding vector(512), match_count int, filter_domain text)
    body = {
        "query_embedding": query_embedding,
        "match_count": match_count,
        "filter_domain": domain_filter,
    }

    try:
        async with httpx.AsyncClient(timeout=RAG_TIMEOUT_SEC) as client:
            resp = await client.post(rpc_url, json=body, headers=headers)
            if resp.status_code >= 400:
                print(
                    f"[RAG] Supabase RPC error: {resp.status_code} {resp.text[:300]}",
                    flush=True,
                )
                return []
            rows = resp.json() or []
            return rows
    except Exception as e:
        print(f"[RAG] Supabase vector search error: {e}", flush=True)
        return []


# ──────────────────────────────────────────────
# Jina Reranker
# ──────────────────────────────────────────────
async def rerank(
    query: str,
    documents: List[Dict[str, Any]],
    top_n: int = RAG_RERANK_TOP_N,
) -> List[Dict[str, Any]]:
    """Rerank candidate documents using Jina Reranker v2.

    Each document is represented as "Question: ... Answer: ..." to give the
    reranker full semantic context (same representation used during embedding).

    Returns documents sorted by relevance, trimmed to top_n, with rerank_score added.
    """
    if not JINA_API_KEY or not documents:
        return documents[:top_n]

    # Build document strings for the reranker
    doc_texts: List[str] = []
    for doc in documents:
        q = (doc.get("question") or "").strip()
        a = (doc.get("answer") or "").strip()
        # Truncate answer to avoid blowing up reranker context
        if len(a) > 500:
            a = a[:500] + "..."
        doc_texts.append(f"Question: {q}\nAnswer: {a}")

    payload = {
        "model": JINA_RERANK_MODEL,
        "query": query.strip(),
        "documents": doc_texts,
        "top_n": min(top_n, len(doc_texts)),
    }
    headers = {
        "Authorization": f"Bearer {JINA_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=RAG_TIMEOUT_SEC) as client:
            resp = await client.post(JINA_RERANK_URL, json=payload, headers=headers)
            resp.raise_for_status()
            results = resp.json().get("results", [])

        # Map reranker output back to original documents
        reranked: List[Dict[str, Any]] = []
        for r in results:
            idx = r["index"]
            score = float(r.get("relevance_score", 0.0))
            if score < RAG_MIN_RERANK_SCORE:
                continue
            doc = dict(documents[idx])
            doc["rerank_score"] = score
            reranked.append(doc)

        reranked.sort(key=lambda x: x.get("rerank_score", 0), reverse=True)
        return reranked[:top_n]

    except Exception as e:
        print(f"[RAG] Jina rerank error: {e}", flush=True)
        # Fallback: return top candidates by original vector similarity
        return documents[:top_n]


# ──────────────────────────────────────────────
# Full RAG pipeline (single entry point)
# ──────────────────────────────────────────────
async def retrieve_rag_context(
    query: str,
    classified_domain: str,
) -> List[Dict[str, str]]:

    if not is_rag_available():
        print("[RAG] disabled or not configured — skipping", flush=True)
        return []

    if not is_rag_domain(classified_domain):
        return []

    db_domain = RAG_DOMAIN_MAP[classified_domain]
    t0 = time.perf_counter()

    # Step 1: Embed the query
    embedding = await embed_query(query)
    if not embedding:
        print("[RAG] embedding failed — skipping", flush=True)
        return []
    t_embed = time.perf_counter() - t0

    # Step 2: Vector search in Supabase
    candidates = await vector_search(embedding, domain_filter=db_domain)
    if not candidates:
        print(
            f"[RAG] no candidates from pgvector for domain='{db_domain}'",
            flush=True,
        )
        return []
    t_search = time.perf_counter() - t0

    # Step 3: Rerank
    reranked = await rerank(query, candidates)
    t_rerank = time.perf_counter() - t0

    print(
        f"[RAG] pipeline complete: domain={db_domain} "
        f"candidates={len(candidates)} reranked={len(reranked)} "
        f"t_embed={t_embed:.2f}s t_search={t_search:.2f}s t_rerank={t_rerank:.2f}s "
        f"t_total={t_rerank:.2f}s",
        flush=True,
    )

    # Step 4: Format for build_rag_block()
    # The existing function expects: [{title, content, source}, ...]
    chunks: List[Dict[str, str]] = []
    for doc in reranked:
        question = (doc.get("question") or "").strip()
        answer = (doc.get("answer") or "").strip()
        meta = doc.get("metadata") or {}
        if isinstance(meta, str):
            try:
                import json
                meta = json.loads(meta)
            except Exception:
                meta = {}

        # Build a descriptive title
        title = question[:80] if question else "RAG Result"

        # Build source attribution from metadata
        source_parts: List[str] = []
        for key in ("source_type", "source_title", "book_name", "recipe_title"):
            val = meta.get(key)
            if val and isinstance(val, str) and val.strip():
                source_parts.append(val.strip())
        source = " — ".join(source_parts) if source_parts else db_domain

        # Content: the answer (this is what gets injected into the prompt)
        content = answer
        score_str = f" [rerank_score={doc.get('rerank_score', 'N/A'):.3f}]" if 'rerank_score' in doc else ""

        chunks.append({
            "title": title,
            "content": content,
            "source": f"{source}{score_str}",
        })

    return chunks