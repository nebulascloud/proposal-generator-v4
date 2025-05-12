require('dotenv').config();

const useStub = process.env.NODE_ENV === 'test' || !process.env.OPENAI_API_KEY;
if (useStub) {
  async function createAssistant(role, instructions) {
    return 'test-assistant';
  }
  async function getAssistantResponse(assistantId, userMessage) {
    return `Test assistant response for ${assistantId}`;
  }
  module.exports = { createAssistant, getAssistantResponse };
} else {
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  async function createAssistant(role, instructions) {
    const res = await openai.assistants.create({ name: role, instructions });
    return res.id;
  }

  async function getAssistantResponse(assistantId, userMessage) {
    const res = await openai.responses.create({ assistant: assistantId, input: { text: userMessage } });
    return res.choices?.[0]?.message?.content;
  }

  module.exports = { createAssistant, getAssistantResponse };
}
