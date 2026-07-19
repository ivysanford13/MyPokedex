-- Pokemon GO companion app schema
-- Requires: CREATE EXTENSION IF NOT EXISTS vector;  (pgvector, run once per database)

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Users ────────────────────────────────────────────────
-- Handled by your auth provider (e.g. Supabase Auth creates auth.users automatically).
-- Every table below references that table's id.

-- ── User's logged Pokemon (from screenshot + questionnaire) ─
CREATE TABLE pokemon_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  species         TEXT NOT NULL,
  nickname        TEXT,
  cp              INTEGER NOT NULL,
  level           NUMERIC(3,1),                 -- e.g. 25.5
  hp              INTEGER,
  attack_iv       SMALLINT CHECK (attack_iv BETWEEN 0 AND 15),
  defense_iv      SMALLINT CHECK (defense_iv BETWEEN 0 AND 15),
  stamina_iv      SMALLINT CHECK (stamina_iv BETWEEN 0 AND 15),
  fast_move       TEXT,
  charged_move    TEXT,
  is_shiny        BOOLEAN NOT NULL DEFAULT FALSE,
  is_shadow       BOOLEAN NOT NULL DEFAULT FALSE,
  is_purified     BOOLEAN NOT NULL DEFAULT FALSE,
  is_favorited    BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pokemon_entries_user ON pokemon_entries(user_id);
CREATE INDEX idx_pokemon_entries_species ON pokemon_entries(user_id, species);

-- Row Level Security: users can only touch their own rows
ALTER TABLE pokemon_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY pokemon_entries_owner ON pokemon_entries
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Tags ─────────────────────────────────────────────────
CREATE TABLE tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#378ADD',   -- hex, used for the dot on the card
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tags_owner ON tags
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE pokemon_tags (
  pokemon_entry_id  UUID NOT NULL REFERENCES pokemon_entries(id) ON DELETE CASCADE,
  tag_id            UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (pokemon_entry_id, tag_id)
);

-- ── Knowledge base (RAG) ─────────────────────────────────
CREATE TABLE knowledge_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content         TEXT NOT NULL,
  embedding       VECTOR(1536),          -- dims match your embedding model (1536 = text-embedding-3-small)
  source_type     TEXT NOT NULL CHECK (source_type IN ('youtube', 'wiki', 'official', 'static')),
  source_url      TEXT,
  source_title    TEXT,
  published_date  DATE,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Approximate nearest-neighbor index for fast similarity search
CREATE INDEX idx_knowledge_chunks_embedding ON knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_knowledge_chunks_source_type ON knowledge_chunks(source_type);
CREATE INDEX idx_knowledge_chunks_published ON knowledge_chunks(published_date);
