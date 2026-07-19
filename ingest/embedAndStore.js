// TODO: chunk raw text (~200-500 words, ~50 word overlap), embed each chunk,
// and insert into knowledge_chunks (see sql/schema.sql).
// Reuse this for wiki, YouTube, and static game-data ingestion alike.
module.exports = async function embedAndStore(chunks, { db, embed, sourceType }) {
  throw new Error("Not implemented yet");
};
