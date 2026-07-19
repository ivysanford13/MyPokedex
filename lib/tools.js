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

      return db.query(query, params);
    }

    case "get_user_pokemon_by_id": {
      return db.query(
        "SELECT * FROM pokemon_entries WHERE id = $1 AND user_id = $2",
        [input.id, userId]
      );
    }

    case "search_knowledge_base": {
      const queryEmbedding = await embedQuery(input.query);
      return db.query(
        `SELECT content, source_type, source_url, source_title, published_date,
                1 - (embedding <=> $1) AS similarity
         FROM knowledge_chunks
         ORDER BY embedding <=> $1
         LIMIT 5`,
        [queryEmbedding]
      );
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = { toolDefinitions, executeTool };
