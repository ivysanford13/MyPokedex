# Pokemon GO companion app

Website with:
1. A Pokemon storage tracker (screenshot upload + questionnaire, no Niantic login)
2. An AI chatbot with Pokemon GO knowledge, always citing its sources
3. Custom tags for organizing your collection

## Status

**Built:**
- `sql/schema.sql` — Postgres schema (pokemon_entries, tags, knowledge_chunks w/ pgvector), RLS enabled
- `data/type_chart.json` — type effectiveness matrix
- `data/cp_multipliers.json` — CPM per level (verify against a current source before shipping)
- `lib/cpFormula.js` — CP calculation + candidate IV finder from OCR'd CP/HP
- `lib/tools.js` — function-calling tool definitions for the chatbot (get_user_pokemon, search_knowledge_base, etc.)

**Stubbed (TODO):**
- `data/base_stats.json` — per-species base stats, needed by cpFormula.js (pull from PokeAPI)
- `ingest/` — scraping (wiki + YouTube transcripts), chunking, embedding pipeline
- `api/` — actual backend routes (pokemon CRUD, tags CRUD, chat endpoint, OCR endpoint)
- `frontend/` — React components for the three-tab UI (Tags / Pokemon / Chat bot)

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your DB connection string + API keys
3. Create a Postgres database (or a Supabase project) and run `sql/schema.sql` against it
   - Requires the `pgvector` extension (schema.sql creates it automatically if available)
4. Start filling in the TODO files, roughly in this order:
   - `data/base_stats.json` (unblocks cpFormula.js)
   - `api/ocr.js` + `api/pokemon.js` (get the storage tracker working end-to-end)
   - `frontend/components/PokemonCard.jsx` + `TagList.jsx`
   - `ingest/` pipeline (unblocks real chatbot knowledge)
   - `api/chat.js` + `frontend/components/ChatPanel.jsx`
