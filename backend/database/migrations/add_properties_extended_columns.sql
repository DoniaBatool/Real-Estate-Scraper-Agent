-- Run in Supabase SQL Editor (or psql) against existing databases that already have `properties`.
ALTER TABLE properties
ADD COLUMN IF NOT EXISTS plot_sqm FLOAT,
ADD COLUMN IF NOT EXISTS furnished TEXT,
ADD COLUMN IF NOT EXISTS floor_number INT,
ADD COLUMN IF NOT EXISTS total_floors INT,
ADD COLUMN IF NOT EXISTS year_built INT,
ADD COLUMN IF NOT EXISTS condition TEXT,
ADD COLUMN IF NOT EXISTS energy_rating TEXT,
ADD COLUMN IF NOT EXISTS virtual_tour_url TEXT,
ADD COLUMN IF NOT EXISTS listing_reference TEXT,
ADD COLUMN IF NOT EXISTS full_address TEXT,
ADD COLUMN IF NOT EXISTS category TEXT;
