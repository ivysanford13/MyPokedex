// Tool definitions passed to the LLM API (Claude/OpenAI-style function calling).
// The LLM decides when to call these; your backend executes them and returns the result.

const toolDefinitions = [
  {
    name: "get_user_pokemon",
    description:
      "Look up Pokemon from the current user's own logged collection. Use this whenever the question refers to 'my' Pokemon, a specific one the user owns, or their collection generally.",
    input_schema: {
      type: "object",
      properties: {
        species: { type: "string", description: "Filter by species name, e.g. 'Excadrill'. Omit to search all." },
        tag: { type: "string", description: "Filter by a tag name the user created, e.g. 'PvP great league'." },
        min_cp: { type: "integer", description: "Only return Pokemon at or above this CP." },
      },
    },
  },
  {
    name: "get_user_pokemon_by_id",
    description: "Get full stats (IVs, moves, level) for one specific logged Pokemon by its id.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The pokemon_entries.id to look up." },
      },
      required: ["id"],
    },
  },
  {
    name: "search_knowledge_base",
    description:
      "Search general Pokemon GO knowledge (guides, tier lists, mechanics) sourced from YouTube, wikis, and official game data. Use this for strategy questions, meta questions, or anything not specific to the user's own collection.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query." },
      },
      required: ["query"],
    },
  },
];

// Executor: maps a tool call from the LLM to an actual DB query.
// `db` is your Postgres client; `userId` scopes every query to the authenticated user.
// Every case returns a plain { rows: [...] } shape (optionally with a `note`),
// so the caller can pass the result straight to the model without extra handling.
async function executeTool(toolName, input, { db, userId, embedQuery }) {
  switch (toolName) {
    case "get_user_pokemon": {
      const conditions = ["user_id = $1"];
      const params = [userId];

      if (input.species) {
        params.push(input.species);
        conditions.push(`species ILIKE $${params.length}`);
      }
      if (input.min_cp) {
        params.push(input.min_cp);
        conditions.push(`cp >= $${params.length}`);
      }

      let query = `SELECT * FROM pokemon_entries WHERE ${conditions.join(" AND ")}`;

      if (input.tag) {
        query = `
          SELECT pe.* FROM pokemon_entries pe
          JOIN pokemon_tags pt ON pt.pokemon_entry_id = pe.id
          JOIN tags t ON t.id = pt.tag_id
          WHERE pe.user_id = $1 AND t.name ILIKE $${params.length + 1}
        `;
        params.push(input.tag);
      }

      const result = await db.query(query, params);
      return { rows: result.rows };
    }

    case "get_user_pokemon_by_id": {
      const result = await db.query(
        "SELECT * FROM pokemon_entries WHERE id = $1 AND user_id = $2",
        [input.id, userId]
      );
      return { rows: result.rows };
    }

    case "search_knowledge_base": {
      try {
        const queryEmbedding = await embedQuery(input.query);
        const result = await db.query(
          `SELECT content, source_type, source_url, source_title, published_date,
                  1 - (embedding <=> $1) AS similarity
           FROM knowledge_chunks
           ORDER BY embedding <=> $1
           LIMIT 5`,
          [queryEmbedding]
        );
        return { rows: result.rows };
      } catch (err) {
        // The knowledge base isn't populated/wired up yet. Return an empty
        // result with a note so the model falls back to its own general
        // knowledge instead of erroring out the whole chat request.
        return {
          rows: [],
          note: "The knowledge base is not available right now. Answer from your own general Pokemon GO knowledge instead, and clearly tell the user this answer has no specific cited source.",
        };
      }
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = { toolDefinitions, executeTool };
