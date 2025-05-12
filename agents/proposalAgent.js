require('dotenv').config();

/**
 * Generates a proposal draft using LangChain and OpenAI.
 * Falls back to a test stub when NODE_ENV is 'test'.
 */
async function generateProposal({ title, client, details, section }) {
  if (process.env.NODE_ENV === 'test') {
    return `Test proposal draft for title: ${title}, client: ${client}, details: ${details}${section ? `, section: ${section}` : ''}`;
  }

  // Dynamically import ESM-based langchain modules
  const [{ OpenAI }, { PromptTemplate }, { LLMChain }] = await Promise.all([
    import('langchain/llms/openai'),
    import('langchain/prompts'),
    import('langchain/chains'),
  ]);
  const llm = new OpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7,
  });
  // Include section context if provided
  const sectionIntro = section ? `Focus on the "${section}" section specifically.\n` : '';
  const template = `You are a professional proposal writer.\n${sectionIntro}Given the following information, draft a formal and persuasive proposal.\n\nTitle: {title}\\nClient: {client}\\nDetails: {details}\\n\nCompose a well-structured, concise proposal.`;
  const prompt = new PromptTemplate({ template, inputVariables: ['title', 'client', 'details'] });
  const chain = new LLMChain({ llm, prompt });
  const response = await chain.call({ title, client, details });
  return response.text || response.output;
}

// Export for CommonJS
module.exports = { generateProposal };
