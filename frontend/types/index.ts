// ─── Live property data (returned from Stagehand scraping, not stored in DB) ──

export interface LiveProperty {
  title?: string;
  property_type?: string;
  category?: string; // "sale" | "rent"
  price?: number;
  currency?: string;
  bedrooms?: number;
  bathrooms?: number;
  total_sqm?: number;
  locality?: string;
  city?: string;
  country?: string;
  full_address?: string;
  description?: string;
  listing_url?: string;
  images?: string[];
  amenities?: string[];
  furnished?: string;
  floor_number?: number;
  year_built?: number;
  agency_name?: string;
  agency_website?: string;
  source_url?: string;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatResponse {
  reply: string;
  action: string;
  context_summary?: {
    summary: string;
    message_count: number;
  };
  recent_turns_used: number;
  /** Structured payload: live properties, comparison tables, etc. */
  message_meta?: {
    properties?: LiveProperty[];
    comparison?: Record<string, unknown>;
    insights?: string;
    tools_used?: string[];
    [key: string]: unknown;
  } | null;
}

export interface ChatThread {
  id: string;
  title: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  last_message_preview?: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  meta?: Record<string, unknown>;
}

export interface ChatToolRun {
  id: string;
  thread_id: string;
  message_id?: string;
  tool_name: string;
  tool_args?: Record<string, unknown>;
  rationale?: string;
  status: string;
  output?: Record<string, unknown>;
  created_at: string;
}
