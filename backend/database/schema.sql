-- Run this SQL in your Supabase SQL Editor (supabase.com → SQL Editor)

-- Table 1: Real estate agencies
CREATE TABLE IF NOT EXISTS agencies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  scraped_at      TIMESTAMPTZ DEFAULT NOW(),
  name            TEXT NOT NULL,
  owner_name      TEXT,
  founded_year    INT,
  description     TEXT,
  logo_url        TEXT,
  website_url     TEXT UNIQUE NOT NULL,
  email           TEXT[],
  phone           TEXT[],
  whatsapp        TEXT,
  facebook_url    TEXT,
  instagram_url   TEXT,
  linkedin_url    TEXT,
  twitter_url     TEXT,
  google_rating   FLOAT,
  review_count    INT,
  specialization  TEXT,
  price_range_min FLOAT,
  price_range_max FLOAT,
  currency        TEXT DEFAULT 'EUR',
  total_listings  INT,
  city            TEXT,
  country         TEXT,
  scrape_level    INT,
  scrape_status   TEXT DEFAULT 'pending'
);

-- Table 2: Individual property listings
CREATE TABLE IF NOT EXISTS properties (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id       UUID REFERENCES agencies(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  title           TEXT,
  property_type   TEXT,
  category        TEXT,
  description     TEXT,
  images          TEXT[],
  bedrooms        INT,
  bathroom_count  INT,
  bedroom_sqm     FLOAT,
  bathroom_sqm    FLOAT,
  total_sqm       FLOAT,
  price           FLOAT,
  price_per_sqm   FLOAT,
  currency        TEXT DEFAULT 'EUR',
  locality        TEXT,
  district        TEXT,
  city            TEXT,
  country         TEXT,
  latitude        FLOAT,
  longitude       FLOAT,
  listing_date    DATE,
  amenities       TEXT[],
  listing_url     TEXT
);

-- Indexes for fast filtering
CREATE INDEX IF NOT EXISTS idx_properties_agency   ON properties(agency_id);
CREATE INDEX IF NOT EXISTS idx_properties_locality ON properties(locality);
CREATE INDEX IF NOT EXISTS idx_properties_type     ON properties(property_type);
CREATE INDEX IF NOT EXISTS idx_properties_price    ON properties(price);
CREATE INDEX IF NOT EXISTS idx_agencies_city       ON agencies(city, country);
