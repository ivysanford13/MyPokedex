// The chatbot endpoint. Uses Google's Gemini API (free tier) with function calling
// so the model can look up the user's own Pokemon data or search the knowledge base.
//
// npm install @google/generative-ai

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { toolDefinitions, executeTool } = require("../lib/tools");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Gemini's function-calling format is slightly different from the generic
// toolDefinitions in lib/tools.js -- this converts them.
function toGeminiTools() {
  return [{
    functionDeclarations: toolDefinitions.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    })),
  }];
}

const SYSTEM_INSTRUCTION = `You are the assistant inside a personal Pokemon GO companion app.

Scope: only answer questions about (1) the user's own logged Pokemon collection, or (2) Pokemon GO itself (mechanics, strategy, meta, moves, types, etc.). If asked about anything else, politely say that's outside what you can help with here and redirect to Pokemon GO topics.

You have two tools:
- get_user_pokemon / get_user_pokemon_by_id: look up the user's own logged Pokemon collection. Use these for anything about "my" Pokemon.
- search_knowledge_base: search indexed Pokemon GO guides for strategy, meta, and mechanics questions.

Rules:
- Whenever the user asks what Pokemon to use for something -- a raid, a Team GO Rocket leader, a gym, a PvP league, anything battle-related -- call get_user_pokemon FIRST, by default, without waiting to be asked "from my collection" or similar. Assume they want a recommendation from what they actually own, not generic examples. Only give general "here's what type/Pokemon typically counters this" advice as a supplement alongside their own options, or as a fallback if they own nothing suitable -- never as the whole answer on its own when a collection lookup was possible.
- Never claim the user owns a specific Pokemon, or state its CP/IVs/moves, unless that came directly from get_user_pokemon or get_user_pokemon_by_id results in this conversation. If you haven't looked it up, say you're not sure what they have rather than guessing.
- If search_knowledge_base returns results, base your answer on them and cite the source (title and/or URL) for each claim.
- If search_knowledge_base returns no rows, or a "note" saying the knowledge base isn't available, answer using your own general Pokemon GO knowledge instead -- but clearly tell the user up front that this isn't from a specific indexed source (for example: "I don't have a specific guide indexed for this, but based on general knowledge:").
- Keep answers concise and practical.`;

async function handleChatMessage(userMessage, { db, userId, embedQuery }) {
  const model = genAI.getGenerativeModel({
    model: "gemini-3.1-flash-lite",
    tools: toGeminiTools(),
    systemInstruction: SYSTEM_INSTRUCTION,
  });

  const chat = model.startChat();
  let result = await chat.sendMessage(userMessage);

  // Loop: keep handling function calls until Gemini returns a plain text answer.
  while (true) {
    const call = result.response.functionCalls()?.[0];
    if (!call) break;

    const toolResult = await executeTool(call.name, call.args, { db, userId, embedQuery });

    result = await chat.sendMessage([{
      functionResponse: {
        name: call.name,
        response: { result: toolResult },
      },
    }]);
  }

  return result.response.text();
}

module.exports = { handleChatMessage };
