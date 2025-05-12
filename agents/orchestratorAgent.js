require('dotenv').config();

/**
 * Assigns proposal sections to agent roles via LLM.
 */
async function assignSections({ sections, title, client, details }) {
  if (process.env.NODE_ENV === 'test') {
    const mapping = {};
    sections.forEach(sec => { mapping[sec] = 'Account Manager'; });
    return mapping;
  }

  // Dynamic import of LangChain
  const [{ OpenAI }, { PromptTemplate }, { LLMChain }] = await Promise.all([
    import('langchain/llms/openai'),
    import('langchain/prompts'),
    import('langchain/chains'),
  ]);
  const llm = new OpenAI({ openAIApiKey: process.env.OPENAI_API_KEY });
  const template = `You are an orchestration agent. Given these sections: {sections} and a customer brief:\nTitle: {title}\nClient: {client}\nDetails: {details}.\nAssign each section to one of these roles: Account Manager, Project Manager, Engineer, Business Analyst, Finance, Legal, Customer. Return a JSON object mapping section names to roles.`;
  const prompt = new PromptTemplate({ template, inputVariables: ['sections','title','client','details'] });
  const chain = new LLMChain({ llm, prompt });
  const response = await chain.call({ sections: sections.join(','), title, client, details });
  try {
    return JSON.parse(response.text || response.output);
  } catch (e) {
    throw new Error('Failed to parse section assignments');
  }
}

/**
 * Determines dependencies between sections via LLM.
 */
async function determineDependencies({ sections, title, client, details }) {
  if (process.env.NODE_ENV === 'test') {
    return {};
  }
  // Similar LLM call to get dependencies as JSON mapping section->[prereqs]
  const [{ OpenAI }, { PromptTemplate }, { LLMChain }] = await Promise.all([
    import('langchain/llms/openai'),
    import('langchain/prompts'),
    import('langchain/chains'),
  ]);
  const llm = new OpenAI({ openAIApiKey: process.env.OPENAI_API_KEY });
  const template = `You are an orchestration agent. Given these sections: {sections} and brief: Title: {title}, Client: {client}, Details: {details}. Determine dependencies between sections. Return a JSON object where keys are section names and values are arrays of section names they depend on.`;
  const prompt = new PromptTemplate({ template, inputVariables: ['sections','title','client','details'] });
  const chain = new LLMChain({ llm, prompt });
  const response = await chain.call({ sections: sections.join(','), title, client, details });
  try {
    return JSON.parse(response.text || response.output);
  } catch (e) {
    throw new Error('Failed to parse dependencies');
  }
}

module.exports = { assignSections, determineDependencies };
