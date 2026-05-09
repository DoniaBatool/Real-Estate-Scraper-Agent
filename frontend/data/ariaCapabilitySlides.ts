/** Live vs roadmap — About ARIA page + shared copy; single source of truth. */

export const ARIA_LIVE_ITEMS = [
  "Property & agency database search",
  "Multi-level agency website scraping + OpenAI extraction",
  "Pricing dashboards with readable dark-theme charts",
  "ARIA chat with full tool suite & streaming-quality UX",
  "Cross-session memory (Supabase + pgvector) when migrations are applied",
  "Property PDF reports (download from listings where exposed)",
  "Property comparison & area pricing tools",
  "Tavily-enhanced web search when API key is set",
  "Voice: homepage VoiceOrb + chat microphone (Chrome recommended)",
  "Immersive homepage: Vanta 3D NET + motion design",
] as const;

export const ARIA_ROADMAP_ITEMS = [
  "Investment ROI & yield scenarios",
  "GPT-4o Vision on listing photos (condition, views)",
  "Live currency conversion",
  "Nearby amenities (e.g. Places-powered)",
  "Full RAG over internal + external docs",
  "Proactive alerts (“price dropped in your saved area”)",
] as const;
