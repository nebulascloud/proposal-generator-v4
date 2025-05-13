require('dotenv').config();
const { OpenAI } = require('openai');

const model = process.env.OPENAI_MODEL || 'gpt-4';
const temperature = parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7;

/**
 * Assigns proposal sections to agent roles via LLM.
 */
async function assignSections({ sections, title, client, details }) {
  if (process.env.NODE_ENV === 'test' || !process.env.OPENAI_API_KEY) {
    const mapping = {};
    sections.forEach(sec => { mapping[sec] = 'Account Manager'; });
    return mapping;
  }

  // Production: use OpenAI SDK
  const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = `You are an orchestration agent. Given these sections: ${sections.join(',')} and a customer brief:\n` +
    `Title: ${title}\nClient: ${client}\nDetails: ${details}.\n` +
    `Assign each section to one of these roles: Account Manager, Project Manager, Engineer, Business Analyst, Finance, Legal, Customer. Return a JSON object mapping section names to roles.`;
  const resp = await ai.chat.completions.create({
    model,
    messages: [{ role: 'system', content: prompt }]
  });
  try {
    return JSON.parse(resp.choices[0].message.content);
  } catch (e) {
    throw new Error('Failed to parse section assignments');
  }
}

/**
 * Determines dependencies between sections via LLM.
 */
async function determineDependencies({ sections, title, client, details }) {
  if (process.env.NODE_ENV === 'test' || !process.env.OPENAI_API_KEY) {
    return {};
  }

  // Production: use OpenAI SDK
  const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = `You are an orchestration agent. Given these sections: ${sections.join(',')} and brief:\n` +
    `Title: ${title}, Client: ${client}, Details: ${details}.\n` +
    `Determine dependencies between sections. Return a JSON object where keys are section names and values are arrays of section names they depend on.`;
  const resp = await ai.chat.completions.create({
    model,
    messages: [{ role: 'system', content: prompt }]
  });
  try {
    return JSON.parse(resp.choices[0].message.content);
  } catch (e) {
    throw new Error('Failed to parse dependencies');
  }
}

module.exports = { assignSections, determineDependencies };
