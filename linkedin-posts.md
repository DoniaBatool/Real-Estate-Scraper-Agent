# LinkedIn Posts — ARIA Real Estate Agent

---

## 1. PERSONAL PAGE POST
*(Conversational, personal story, shows your journey)*

---

🏡 I built an AI agent that searches real estate websites the way a human agent would.

Meet **ARIA** — my latest full-stack project.

You type: *"Find me 3-bed apartments in Dubai under AED 2M"*
ARIA visits real estate agency websites live, extracts fresh listings, and brings them back to you — in seconds.

No database. No cached listings. **100% live web browsing + AI extraction.**

Here's what's under the hood:
→ **OpenAI Agents SDK** — orchestrates the entire search pipeline
→ **Stagehand v3 + Playwright** — real browser automation (visits actual websites)
→ **FastAPI + Next.js** — async backend + cinematic chat UI
→ **pgvector + Supabase** — cross-session memory (ARIA remembers your city and budget)
→ **Self-improvement loop** — scores every response on 5 dimensions, auto-corrects below threshold

The hardest part wasn't the AI. It was making a real browser run reliably on a cloud VM — `ECONNREFUSED`, `--no-zygote`, Chrome crashes, 1GB RAM limits... I debugged every single one.

Ask ARIA anything:
💱 "Convert this price to PKR"
📈 "What's the rental yield on this property?"
🌍 "Find villas for sale in Malta"
🗣️ Urdu, Arabic, English — she matches your language

**GitHub:** [link in comments]

What city would you want ARIA to search first? 👇

#AI #FullStack #OpenAI #Playwright #RealEstate #Python #NextJS #BuildInPublic

---

## 2. COMPANY PAGE POST
*(Professional, product-focused, business value)*

---

**Introducing ARIA — AI-Powered Real Estate Intelligence**

Traditional property portals show you stale listings from a database. ARIA does something different: it browses real estate agency websites live, in real time, and extracts fresh listings the moment you ask.

**How it works:**
1. User describes what they're looking for
2. ARIA discovers top agencies for that city via Apify
3. Stagehand (AI browser automation) visits each website
4. GPT-4o extracts structured property data
5. Results delivered in seconds — always fresh

**Key capabilities:**
• Any city, any country, any language
• Paste any agency URL → instant extraction
• Investment calculator (ROI, yield, cap rate)
• Currency conversion across 21 currencies
• Cross-session memory — remembers your preferences
• PDF export of property shortlists
• Self-improving response quality engine

**Tech stack:** FastAPI · Next.js 14 · OpenAI Agents SDK · Stagehand v3 · Supabase + pgvector · Playwright

This project demonstrates how AI agents can replace entire data pipelines — not by storing data, but by fetching it live on demand.

Open source. Built by Donia Batool.

🔗 GitHub: [link]

#AIAgent #RealEstate #PropTech #OpenAI #GenerativeAI #FullStackAI

---

## 3. LINKEDIN GROUPS POST
*(Technical, detailed, value-first for dev communities)*
*(Use in: AI Developers, Python Developers, Full Stack Developers, PropTech groups)*

---

**Built a full-stack AI real estate agent with live web scraping — here's the architecture**

After weeks of building (and debugging Chrome crashes on GCP 😅), I'm sharing the full breakdown of ARIA — an AI agent that searches real estate websites live.

**The core challenge:** Real estate data is fragmented across thousands of local agency websites. No single API covers them all. Solution: send an AI browser to visit them directly.

**Pipeline:**
```
User query → Intent detection → Agency discovery (Apify)
→ Stagehand visits each agency website
→ GPT-4o-mini extracts structured listings
→ Post-filtering + deduplication
→ Formatted response with investment metrics
```

**Technical decisions worth sharing:**

🔹 **Stagehand v3 vs Playwright directly**
Stagehand wraps Playwright with AI — instead of writing CSS selectors, you write natural language instructions. `page.extract("get all property listings with price and bedrooms")` just works, even across wildly different site layouts.

🔹 **Two-step scraping (navigate then extract)**
Splitting the agent into "navigate to listings page" and "extract data" separately reduced token usage by ~60% and improved accuracy. One agent for navigation, `extract()` for data.

🔹 **Self-improvement loop**
Every ARIA response is scored on 5 dimensions (clarity, helpfulness, completeness, tool usage, on-brand). Scores below 55/100 trigger a re-run with correction hints. Inspired by M.Kashef's self-improving AI pattern.

🔹 **pgvector for memory**
User preferences stored as 1536-dim embeddings. On each session, ARIA retrieves relevant past context via cosine similarity — so returning users get personalized responses without any login system.

**Biggest deployment lesson:**
Playwright/Stagehand on a cloud VM needs `--single-process` flag + minimum 4GB RAM. The `--no-zygote` flag helps but is NOT enough alone — Chrome still crashes if you're OOM. Spent 2 days debugging `ECONNREFUSED` before realizing the e2-micro (1GB) was just too small.

**Stack:** Python 3.11 · FastAPI · OpenAI Agents SDK v0.17 · Next.js 14 · Stagehand v3 · playwright-core · Supabase · pgvector · PM2

96 tests covering intent detection, edge cases, and auto-correction. All run without a live API key.

GitHub: [link] — happy to answer any questions on the architecture!

#Python #OpenAI #AIAgents #Playwright #Stagehand #FullStack #RealEstate #BuildInPublic

---

## VIDEO CAPTION (for LinkedIn video post)
*(Short, punchy — use when posting the demo video)*

---

I asked an AI agent to find me apartments in Dubai. It opened a real browser, visited agency websites, and came back with live listings. 🏙️

No database. No API. Just AI browsing the web like a human.

This is **ARIA** — my full-stack AI real estate agent built with OpenAI Agents SDK + Stagehand v3 + Next.js.

Full breakdown 👇 (GitHub in comments)

#AI #RealEstate #OpenAI #FullStack #BuildInPublic
