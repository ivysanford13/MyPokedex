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

async function handleChatMessage(userMessage, { db, userId, embedQuery }) {
  const model = genAI.getGenerativeModel({
    model: "gemini-3.1-flash-lite",
    tools: toGeminiTools(),
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
        response: { result: toolResult.rows ?? toolResult },
      },
    }]);
  }

  return result.response.text();
}

module.exports = { handleChatMessage };