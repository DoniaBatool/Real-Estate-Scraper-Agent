export interface Agency {
  id: string;
  name: string;
  owner_name?: string;
  founded_year?: number;
  description?: string;
  logo_url?: string;
  website_url: string;
  email?: string[];
  phone?: string[];
  whatsapp?: string;
  facebook_url?: string;
  instagram_url?: string;
  linkedin_url?: string;
  twitter_url?: string;
  google_rating?: number;
  review_count?: number;
  specialization?: string;
  price_range_min?: number;
  price_range_max?: number;
  currency?: string;
  total_listings?: number;
  /** Inferred from menus + listing types */
  property_categories?: string[];
  city?: string;
  country?: string;
  scrape_status?: string;
  created_at?: string;
}

export interface Property {
  id: string;
  agency_id?: string;
  title?: string;
  property_type?: string;
  category?: string;
  description?: string;
  images?: string[];
  bedrooms?: number;
  bathroom_count?: number;
  bedroom_sqm?: number;
  bathroom_sqm?: number;
  total_sqm?: number;
  /** Land / outdoor plot size when available */
  plot_sqm?: number;
  price?: number;
  price_per_sqm?: number;
  currency?: string;
  locality?: string;
  district?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  listing_date?: string;
  amenities?: string[];
  listing_url?: string;
  created_at?: string;
  /** LLM / extraction extras */
  furnished?: string | boolean;
  /** Listing reference / SKU */
  reference?: string;
  listing_reference?: string;
  floor_number?: number;
  total_floors?: number;
  year_built?: number;
  condition?: string;
  energy_rating?: string;
  virtual_tour_url?: string;
  /** Single-line formatted address when scraped */
  full_address?: string;
}

export interface ScrapeJob {
  job_id: string;
  status: "queued" | "running" | "complete" | "failed";
  city: string;
  country: string;
  agencies_found: number;
  agencies_scraped: number;
  message: string;
}

/** Structured payloads returned with assistant replies (tables, agency drill-down). */
export type ChatMessageDisplayMeta =
  | {
      display: "agency_table";
      caption?: string;
      columns: { key: string; label: string }[];
      rows: Record<string, unknown>[];
    }
  | {
      display: "agency_detail";
      agency: Agency;
      properties: Property[];
    };

export interface ChatResponse {
  reply: string;
  action: string;
  job?: ScrapeJob;
  context_summary?: {
    summary: string;
    message_count: number;
  };
  recent_turns_used: number;
  /** UI payload: tables and agency/property detail blocks */
  message_meta?: ChatMessageDisplayMeta | Record<string, unknown> | null;
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

export interface PricingData {
  avg_price_by_locality: { locality: string; avg_price_sqm: number }[];
  price_range_by_type: { type: string; min: number; max: number; avg: number }[];
  sqm_vs_price: { total_sqm: number; price: number; property_type: string }[];
  bedrooms_vs_avg_price: { bedrooms: number; avg_price: number }[];
  summary: {
    cheapest_locality?: string;
    most_expensive_locality?: string;
    total_properties: number;
    total_agencies: number;
  };
}

export interface PropertyFilters {
  agency_id?: string;
  type?: string;
  bedrooms?: number;
  locality?: string;
  min_price?: number;
  max_price?: number;
  min_sqm?: number;
  max_sqm?: number;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export interface AgencyFilters {
  city?: string;
  country?: string;
  search?: string;
  page?: number;
  limit?: number;
}
