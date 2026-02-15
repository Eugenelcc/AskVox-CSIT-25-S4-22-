"""
Domain classification for AskVox queries using Google Cloud Natural Language API
Supports custom domains and domain whitelisting.
"""
import base64
import json
import os
import re
from typing import Any


try:
    from google.cloud import language_v2  # type: ignore
    from google.api_core.exceptions import GoogleAPIError  # type: ignore
    _GOOGLE_NLP_AVAILABLE = True
except Exception:  # pragma: no cover
    language_v2 = None  # type: ignore
    GoogleAPIError = Exception  # type: ignore
    _GOOGLE_NLP_AVAILABLE = False


_client = None

def get_client():
    global _client
    if not _GOOGLE_NLP_AVAILABLE:
        raise RuntimeError("google-cloud-language is not installed")
    if _client is None:


        json_b64 = os.getenv("GOOGLE_CREDENTIALS_JSON_B64")
        json_str = os.getenv("GOOGLE_CREDENTIALS_JSON")
        credentials_path = os.getenv("GOOGLE_CREDENTIALS_PATH")
        adc_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

        if json_b64 and json_b64.strip():
            from google.oauth2 import service_account  # type: ignore

            creds_dict = json.loads(base64.b64decode(json_b64).decode("utf-8"))
            creds = service_account.Credentials.from_service_account_info(creds_dict)
            _client = language_v2.LanguageServiceClient(credentials=creds)
        elif json_str and json_str.strip():
            from google.oauth2 import service_account  # type: ignore

            creds_dict = json.loads(json_str)
            creds = service_account.Credentials.from_service_account_info(creds_dict)
            _client = language_v2.LanguageServiceClient(credentials=creds)
        elif credentials_path and credentials_path.strip():
            _client = language_v2.LanguageServiceClient.from_service_account_json(credentials_path)
        elif adc_path and adc_path.strip():
            _client = language_v2.LanguageServiceClient.from_service_account_json(adc_path)
        else:
            _client = language_v2.LanguageServiceClient()
    return _client

# ========================================
# ✅ YOUR CUSTOM DOMAINS CONFIGURATION
# ========================================
# Modify this to match YOUR exact domain taxonomy
ASKVOX_DOMAINS = [
    "Science",
    "History and World Events",
    "Current Affairs",
    "Sports",
    "Cooking & Food",
    "Astronomy",
    "Geography and Travel",
    "Art, Music and Literature",
    "Technology",
    "Health & Wellness",
    "general",
]

# Whitelist: Only allow these domains (reject others)
DOMAIN_WHITELIST = set(ASKVOX_DOMAINS)

# Google NLP → AskVox domain mapping
GOOGLE_TO_ASKVOX = {
     # --- Direct obvious mappings ---
    "/Science/Astronomy": "Astronomy",
    "/Science": "Science",

    "/Food & Drink": "Cooking & Food",

    "/Sports": "Sports",

    "/Travel & Transportation": "Geography and Travel",
    "/Science/Earth Sciences/Geology": "Geography and Travel",

    "/Reference/Humanities/History": "History and World Events",
    "/Reference/Humanities": "History and World Events",
    "/History": "History and World Events",
    "/Sensitive Subjects/War & Conflict": "History and World Events",

    "/Geography": "Geography and Travel",

    # --- Arts / literature / culture ---
    "/Arts & Entertainment": "Art, Music and Literature",
    "/Books & Literature": "Art, Music and Literature",

    # --- Tech / computing / internet ---
    "/Computers & Electronics": "Technology",
    "/Internet & Telecom": "Technology",
    "/Science/Computer Science": "Technology",

    # --- Health / fitness ---
    "/Health": "Health & Wellness",
    "/Beauty & Fitness": "Health & Wellness",

    # --- Current affairs bucket (news + public policy) ---
    "/News": "Current Affairs",
    "/Law & Government": "Current Affairs",
    "/Business & Industrial": "Current Affairs",
    "/Finance": "Current Affairs",

    # --- Usually not core for AskVox; send to general unless you want a new domain ---
    "/Sensitive Subjects": "general",
    "/Adult": "general",

    # --- Catchalls ---
    "/Other": "general",
}

# Custom domain keywords (for domains Google NLP doesn't cover well)
CUSTOM_DOMAIN_KEYWORDS = {
    "Technology": ["ai", "machine learning", "coding", "programming", "software", "app", "website", "algorithm"],
    "Health & Wellness": ["exercise", "fitness", "diet", "nutrition", "meditation", "yoga", "wellness"],
    "History and World Events": (
        "war, battle, conflict, treaty, empire, kingdom, dynasty, civilization, ruler, king, queen, emperor, tsar, sultan, "
        "caliph, shah, pharaoh, caesar, consul, senate, revolution, independence, colonial, colonization, colonisation, annexation, occupation, conquest, invasion, rebellion, "
        "uprising, reform, republic, monarchy, feudalism, aristocracy, oligarchy, theocracy, imperialism, abolition, emancipation, segregation, constitution, parliament, coup, civil war, "
        "nationalism, federalism, sovereignty, decolonization, ancient, classical, medieval, renaissance, industrial revolution, modern era, contemporary history, century, decade, era, period, age, epoch, "
        "slavery, serfdom, colonialism, total war, guerrilla warfare, naval blockade, military coup, peace settlement, mesopotamian civilization, sumerian civilization, akkadian empire, babylonian empire, assyrian empire, "
        "ancient egyptian civilization, old kingdom, middle kingdom, new kingdom, indus valley civilization, vedic civilization, ancient greek civilization, hellenistic period, roman republic, roman empire, "
        "han dynasty, qin dynasty, zhou dynasty, mauryan empire, gupta empire, persian empire, achaemenid empire, olmec civilization, maya civilization, aztec empire, inca empire, qin dynasty, han dynasty, tang dynasty, song dynasty, "
        "yuan dynasty, ming dynasty, qing dynasty, mauryan dynasty, gupta dynasty, chola dynasty, mughal empire, delhi sultanate, rashidun caliphate, umayyad caliphate, abbasid caliphate, ottoman empire, safavid dynasty, mamluk sultanate, "
        "carolingian dynasty, capetian dynasty, tudor dynasty, stuart dynasty, habsburg dynasty, romanov dynasty, bourbon dynasty, plantagenet dynasty, shogunate, tokugawa shogunate, samurai class, daimyo, mandate of heaven, dynastic cycle, "
        "mali empire, songhai empire, ghana empire, zulu kingdom, american revolution, french revolution, haitian revolution, mexican revolution, world war i, world war ii, cold war, great depression, new deal, civil rights movement, non-aligned movement, "
        "alexander the great, julius caesar, augustus caesar, charlemagne, genghis khan, kublai khan, napoleon bonaparte, queen victoria, tsar nicholas ii, emperor meiji, qin shi huang, ashoka the great, akbar the great, suleiman the magnificent, ramesses ii, cleopatra vii, "
        "feudal contract, manorial system, serfdom, vassalage, scholasticism, canon law, papal authority, investiture controversy, absolute monarchy, constitutional monarchy, enlightenment, scientific revolution, totalitarianism, authoritarian regime, mass mobilization, industrialization"
    ).split(", "),
    "Geography and Travel": (
        "volcano, volcanic, eruption, lava, earthquake, seismic, aftershock, fault line, tectonic, plate tectonics, "
        "tsunami, epicenter, magnitude, richter scale, subduction zone, mid-ocean ridge, rift valley, continental drift, crust, mantle, "
        "mountain, mountain range, plateau, plain, valley, canyon, delta, river basin, tributary, waterfall, glacier, ice cap, "
        "desert, dune, oasis, coastline, peninsula, island, archipelago, strait, isthmus, fjord, bay, gulf, cliff, erosion, weathering, "
        "sedimentation, alluvial plain, climate, weather pattern, monsoon, trade winds, jet stream, cyclone, hurricane, typhoon, drought, floodplain, "
        "precipitation, humidity, temperature range, climate zone, tropical, arid climate, temperate climate, polar climate, savanna climate, mediterranean climate, "
        "river system, watershed, aquifer, groundwater, estuary, lagoon, ocean current, tide, coral reef, atoll, rainforest, grassland, tundra, taiga, wetland, mangrove, "
        "biodiversity, ecosystem, habitat, vegetation zone, urbanization, megacity, population density, migration pattern, demographic transition, birth rate, death rate, "
        "urban sprawl, infrastructure, transport network, rural settlement, metropolitan area, land use, zoning, economic corridor, latitude, longitude, equator, hemisphere, "
        "prime meridian, time zone, topography, elevation, altitude, relief, contour line, map projection, cartography, geographic coordinates, spatial distribution, resource distribution, "
        "natural resource, deforestation, desertification, climate change, global warming, carbon cycle, greenhouse effect, sea level rise, sustainability, renewable resource, tourism, eco-tourism, "
        "backpacking, itinerary, landmark, heritage site, travel destination, cultural landscape, national park, visa, border crossing, airport hub, travel route"
    ).split(", "),
    
}

def classify_domain(text: str, allowed_domains: set = None) -> str:

    text = text.strip()
    if not text:
        return "general"
    
    text_lower = text.lower()
    
    # Use provided whitelist or default
    whitelist = allowed_domains if allowed_domains is not None else DOMAIN_WHITELIST
    
    # ✅ CUSTOM DOMAIN KEYWORD MATCHING (for domains Google doesn't cover)
    for domain, keywords in CUSTOM_DOMAIN_KEYWORDS.items():
        if domain not in whitelist:
            continue
        for keyword in keywords:
            if " " in keyword or "-" in keyword:
                if keyword in text_lower:
                    return domain
            else:
                if re.search(rf"\b{re.escape(keyword)}\b", text_lower):
                    return domain
    
    # ✅ OPTIMIZATION: Ultra-short fragments with obvious intent
    if len(text.split()) < 3:
        if any(k in text_lower for k in ["recipe", "bake", "cook", "ingredient"]):
            return "Cooking & Food" if "Cooking & Food" in whitelist else "general"
        if any(k in text_lower for k in ["score", "match", "tournament", "champion"]):
            return "Sports" if "Sports" in whitelist else "general"
        if any(k in text_lower for k in ["news", "breaking", "latest", "today"]):
            return "Current Affairs" if "Current Affairs" in whitelist else "general"
    
    # ✅ PRIMARY: Google NLP semantic classification (optional)
    if not _GOOGLE_NLP_AVAILABLE:
        return "general"

    try:
        truncated = text[:1000]
        
        document = {
            "content": truncated,
            "type_": language_v2.Document.Type.PLAIN_TEXT,
            "language_code": "en",
        }
        
        response = get_client().classify_text(request={"document": document})
        
        if response.categories:
            top_cat = response.categories[0]
            google_path = top_cat.name
            
            # Exact match
            if google_path in GOOGLE_TO_ASKVOX:
                mapped = GOOGLE_TO_ASKVOX[google_path]
                if mapped in whitelist:
                    return mapped
            
            # Parent category fallback
            parent = "/" + google_path.strip("/").split("/")[0]
            if parent in GOOGLE_TO_ASKVOX:
                mapped = GOOGLE_TO_ASKVOX[parent]
                if mapped in whitelist:
                    return mapped
            
            # Debug: Log unmapped categories
            if os.getenv("DEBUG_DOMAIN_CLASSIFICATION", "false").lower() == "true":
                print(f"⚠️ Unmapped: '{text[:50]}' → Google category: {google_path} (conf: {top_cat.confidence:.2f})")
    
    except GoogleAPIError as e:
        if os.getenv("DEBUG_DOMAIN_CLASSIFICATION", "false").lower() == "true":
            print(f"Google NLP error: {e}")
    except Exception as e:
        if os.getenv("DEBUG_DOMAIN_CLASSIFICATION", "false").lower() == "true":
            print(f"Classification error: {e}")
    
    # ✅ SAFE FALLBACK
    return "general"


def _debug_enabled() -> bool:
    return os.getenv("DEBUG_DOMAIN_CLASSIFICATION", "false").lower() == "true"


def classify_domain_debug(text: str, allowed_domains: set = None) -> tuple[str, dict[str, Any]]:
    """Like classify_domain, but also returns debug metadata.

    The debug payload is safe to expose to the frontend (no secrets), and helps you
    understand:
    - what Google NLP classified the query as
    - what AskVox domain we mapped it to
    - which strategy produced the final result
    """

    debug: dict[str, Any] = {
        "input_text": text,
        "strategy": None,
        "allowed_domains": sorted(list(allowed_domains)) if allowed_domains is not None else None,
        "google_nlp_available": _GOOGLE_NLP_AVAILABLE,
        "google_categories": [],
        "google_top_category": None,
        "google_top_confidence": None,
        "mapped_domain": None,
        "matched_keyword_domain": None,
        "matched_keyword": None,
        "note": None,
    }

    original_text = text
    text = text.strip()
    if not text:
        debug["strategy"] = "empty"
        debug["mapped_domain"] = "general"
        if _debug_enabled():
            print(f"[domain] empty input -> general")
        return "general", debug

    text_lower = text.lower()
    whitelist = allowed_domains if allowed_domains is not None else DOMAIN_WHITELIST

    # Custom keyword matching
    for domain, keywords in CUSTOM_DOMAIN_KEYWORDS.items():
        if domain not in whitelist:
            continue
        for keyword in keywords:
            matched = False
            if " " in keyword or "-" in keyword:
                matched = keyword in text_lower
            else:
                matched = re.search(rf"\b{re.escape(keyword)}\b", text_lower) is not None
            if matched:
                debug["strategy"] = "custom_keywords"
                debug["matched_keyword_domain"] = domain
                debug["matched_keyword"] = keyword
                debug["mapped_domain"] = domain
                if _debug_enabled():
                    print(
                        f"[domain] custom_keywords keyword='{keyword}' -> domain='{domain}' text='{text[:80]}'"
                    )
                return domain, debug

    # Ultra-short heuristics
    if len(text.split()) < 3:
        if any(k in text_lower for k in ["recipe", "bake", "cook", "ingredient"]):
            mapped = "Cooking & Food" if "Cooking & Food" in whitelist else "general"
            debug["strategy"] = "short_fragment"
            debug["mapped_domain"] = mapped
            if _debug_enabled():
                print(f"[domain] short_fragment -> domain='{mapped}' text='{text[:80]}'")
            return mapped, debug
        if any(k in text_lower for k in ["score", "match", "tournament", "champion"]):
            mapped = "Sports" if "Sports" in whitelist else "general"
            debug["strategy"] = "short_fragment"
            debug["mapped_domain"] = mapped
            if _debug_enabled():
                print(f"[domain] short_fragment -> domain='{mapped}' text='{text[:80]}'")
            return mapped, debug
        if any(k in text_lower for k in ["news", "breaking", "latest", "today"]):
            mapped = "Current Affairs" if "Current Affairs" in whitelist else "general"
            debug["strategy"] = "short_fragment"
            debug["mapped_domain"] = mapped
            if _debug_enabled():
                print(f"[domain] short_fragment -> domain='{mapped}' text='{text[:80]}'")
            return mapped, debug

    # Google NLP
    if not _GOOGLE_NLP_AVAILABLE:
        debug["strategy"] = "google_nlp_unavailable"
        debug["note"] = "google-cloud-language not installed"
        debug["mapped_domain"] = "general"
        if _debug_enabled():
            print(f"[domain] google_nlp_unavailable -> general text='{text[:80]}'")
        return "general", debug

    try:
        truncated = text[:1000]
        document = {
            "content": truncated,
            "type_": language_v2.Document.Type.PLAIN_TEXT,
            "language_code": "en",
        }

        response = get_client().classify_text(request={"document": document})

        if response.categories:
            debug["google_categories"] = [
                {"name": c.name, "confidence": float(getattr(c, "confidence", 0.0))}
                for c in response.categories
            ]

            top_cat = response.categories[0]
            google_path = top_cat.name
            top_conf = float(getattr(top_cat, "confidence", 0.0))

            debug["google_top_category"] = google_path
            debug["google_top_confidence"] = top_conf

            # Exact match
            if google_path in GOOGLE_TO_ASKVOX:
                mapped = GOOGLE_TO_ASKVOX[google_path]
                if mapped in whitelist:
                    debug["strategy"] = "google_nlp_exact"
                    debug["mapped_domain"] = mapped
                    if _debug_enabled():
                        print(
                            f"[domain] google_nlp_exact google='{google_path}' ({top_conf:.2f}) -> domain='{mapped}' text='{truncated[:80]}'"
                        )
                    return mapped, debug

            # Parent fallback
            parent = "/" + google_path.strip("/").split("/")[0]
            if parent in GOOGLE_TO_ASKVOX:
                mapped = GOOGLE_TO_ASKVOX[parent]
                if mapped in whitelist:
                    debug["strategy"] = "google_nlp_parent"
                    debug["mapped_domain"] = mapped
                    if _debug_enabled():
                        print(
                            f"[domain] google_nlp_parent google='{google_path}' ({top_conf:.2f}) parent='{parent}' -> domain='{mapped}' text='{truncated[:80]}'"
                        )
                    return mapped, debug

            debug["strategy"] = "google_nlp_unmapped"
            debug["mapped_domain"] = "general"
            if _debug_enabled():
                print(
                    f"[domain] google_nlp_unmapped google='{google_path}' ({top_conf:.2f}) -> general text='{truncated[:80]}'"
                )
            return "general", debug

        debug["strategy"] = "google_nlp_no_categories"
        debug["mapped_domain"] = "general"
        if _debug_enabled():
            print(f"[domain] google_nlp_no_categories -> general text='{truncated[:80]}'")
        return "general", debug

    except GoogleAPIError as e:
        debug["strategy"] = "google_nlp_error"
        debug["note"] = f"GoogleAPIError: {e}"
        debug["mapped_domain"] = "general"
        if _debug_enabled():
            print(f"[domain] google_nlp_error -> general err='{e}' text='{original_text[:80]}'")
        return "general", debug
    except Exception as e:
        debug["strategy"] = "classification_error"
        debug["note"] = f"Exception: {e}"
        debug["mapped_domain"] = "general"
        if _debug_enabled():
            print(f"[domain] classification_error -> general err='{e}' text='{original_text[:80]}'")
        return "general", debug


def get_available_domains() -> list:
    """Return list of all available domains for UI/display"""
    return sorted(ASKVOX_DOMAINS)


def validate_domain(domain: str) -> bool:
    """Check if domain is in whitelist"""
    return domain in DOMAIN_WHITELIST
