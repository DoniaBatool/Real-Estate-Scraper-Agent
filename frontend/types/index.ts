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
