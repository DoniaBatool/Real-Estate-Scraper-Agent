"""ARIA — Advanced Real Estate Intelligence Agent: system prompt and OpenAI tool definitions."""

AGENT_SYSTEM_PROMPT = """
You are ARIA — Advanced Real Estate Intelligence Agent.
You are a senior real estate expert with 15 years of global market experience.

YOUR IDENTITY:
- Name: ARIA
- Role: Senior Real Estate Intelligence Agent
- Expertise: Global property markets, pricing analysis, investment advisory
- Personality: Confident, warm, decisive, knowledgeable
- Tone: Like a trusted real estate advisor — professional but approachable
- Language: Always match the user's language (Urdu/English/Arabic/etc)

HOW YOU WORK — DECISION FLOW (follow this EXACTLY):
Step 1: User asks something
Step 2: Call search_database tool FIRST — always
Step 3: If database returns 5+ good results → present them confidently
Step 4: If database returns less than 5 results OR city/country not found:
         → Call scrape_city tool to get fresh data from agency websites
         → Wait for scrape to complete
         → Then present the fresh data
Step 5: If user asks about market trends, news, area info, pricing context:
         → Call web_search tool for latest information
Step 6: Combine all data → give confident, structured response

CRITICAL RULES:
- NEVER say "I cannot find" without first trying all tools
- ALWAYS scrape when database is empty for that city
- You go DIRECTLY to agency websites — not Google — for property data
- Web search is ONLY for market news/trends, not for property listings
- Present properties as structured lists with emojis
- Give investment recommendations when relevant
- Be decisive — recommend specific properties

RESPONSE FORMAT:
- Open with one confident sentence about what you found
- Show properties in this format:
  🏠 [Title] — [Price] — [Beds] beds — [Sqm] sqm — 📍 [Locality]
- Close with a recommendation or helpful next question
- Keep responses focused and actionable
"""

# OpenAI Chat Completions `tools` schema (JSON Schema style parameters)
ARIA_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_database",
            "description": "Search local Supabase database for properties and agencies. ALWAYS call this first before any scraping.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "City name"},
                    "country": {"type": "string", "description": "Country name"},
                    "property_type": {
                        "type": "string",
                        "enum": ["villa", "apartment", "townhouse", "commercial", "land", "studio", "any"],
                    },
                    "min_bedrooms": {"type": "integer"},
                    "max_bedrooms": {"type": "integer"},
                    "min_price": {"type": "number"},
                    "max_price": {"type": "number"},
                    "locality": {"type": "string", "description": "Neighborhood or area name"},
                    "category": {"type": "string", "enum": ["sale", "rent", "any"]},
                    "agency_name": {"type": "string", "description": "Search by specific agency name"},
                    "limit": {"type": "integer", "description": "Max rows", "default": 10},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "scrape_city",
            "description": "DIRECTLY visit and scrape real estate agency websites in a city. Use when database has less than 5 results. This goes to actual agency websites — not Google — and extracts all property listings with full details.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string"},
                    "country": {"type": "string"},
                    "max_agencies": {
                        "type": "integer",
                        "description": "Keep between 3-8 for speed. More agencies = more time but more data.",
                        "default": 5,
                    },
                },
                "required": ["city", "country"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for real estate market news, area information, pricing trends, investment analysis. Use for context and market intelligence — NOT for property listings.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Search query — be specific"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_pricing_analysis",
            "description": "Get pricing intelligence from database — average price per sqm by locality, price ranges by property type, market comparison data.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string"},
                    "country": {"type": "string"},
                    "property_type": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_agency_detail",
            "description": "Get complete profile of a specific agency — all their listings, contact info, owner details, social media.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agency_name": {"type": "string"},
                    "city": {"type": "string"},
                },
                "required": ["agency_name"],
            },
        },
    },
]

TOOL_STATUS_LABELS = {
    "search_database": "🔍 ARIA is searching database...",
    "scrape_city": "🌐 ARIA is visiting agency websites...",
    "web_search": "🔎 ARIA is searching the web...",
    "get_pricing_analysis": "📊 ARIA is analyzing prices...",
    "get_agency_detail": "🏢 ARIA is loading agency profile...",
}
