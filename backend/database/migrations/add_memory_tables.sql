-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- User memory table
CREATE TABLE IF NOT EXISTS user_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT,
  user_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  preferred_cities TEXT[],
  preferred_countries TEXT[],
  preferred_property_types TEXT[],
  min_budget FLOAT,
  max_budget FLOAT,
  currency TEXT,
  min_bedrooms INT,
  preferred_localities TEXT[],
  investment_interest BOOLEAN DEFAULT FALSE,
  rental_interest BOOLEAN DEFAULT FALSE,
  language TEXT DEFAULT 'english',
  total_conversations INT DEFAULT 0,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  summary TEXT,
  raw_preferences JSONB DEFAULT '{}'
);

-- Conversation embeddings for RAG
CREATE TABLE IF NOT EXISTS conversation_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  user_fingerprint TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  message TEXT NOT NULL,
  role TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_conv_embedding
ON conversation_embeddings
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_user_memory_fingerprint
ON user_memory(user_fingerprint);

CREATE INDEX IF NOT EXISTS idx_conv_fingerprint
ON conversation_embeddings(user_fingerprint);
