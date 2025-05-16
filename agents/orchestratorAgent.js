require('dotenv').config();
const { createAssistant, getAssistantResponse } = require('./assistantAgent');

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

  // Production: delegate to Collaboration Orchestrator assistant
  const orchestratorId = await createAssistant('Collaboration Orchestrator');
  const prompt = `Assign these sections to roles: ${sections.join(', ')} for title=${title}, client=${client}, details=${details}. Return JSON mapping section to role.`;
  const raw = await getAssistantResponse(orchestratorId, prompt);
  console.log(`[orchestratorAgent] Raw section assignments response: ${raw}`);
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Empty assistant response for section assignments');
  }
  // Extract JSON object from response
  let jsonStr = raw.trim();
  const first = jsonStr.indexOf('{');
  const last = jsonStr.lastIndexOf('}');
  if (first > 0 && last > first) {
    jsonStr = jsonStr.substring(first, last + 1);
    console.log('[orchestratorAgent] Trimmed JSON string:', jsonStr);
  }
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('[orchestratorAgent] JSON.parse error:', e.message);
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

  // Production: delegate to Collaboration Orchestrator assistant
  const orchestratorId = await createAssistant('Collaboration Orchestrator');
  const prompt = `Determine dependencies among sections: ${sections.join(', ')} for title=${title}, client=${client}, details=${details}. Return JSON mapping section to dependency array.`;
  const rawDep = await getAssistantResponse(orchestratorId, prompt);
  console.log(`[orchestratorAgent] Raw dependencies response: ${rawDep}`);
  if (typeof rawDep !== 'string' || !rawDep.trim()) {
    throw new Error('Empty assistant response for dependencies');
  }
  let depJson = rawDep.trim();
  const f = depJson.indexOf('{');
  const l = depJson.lastIndexOf('}');
  if (f > 0 && l > f) {
    depJson = depJson.substring(f, l + 1);
    console.log('[orchestratorAgent] Trimmed dependencies JSON string:', depJson);
  }
  try {
    return JSON.parse(depJson);
  } catch (e) {
    console.error('[orchestratorAgent] JSON.parse dependencies error:', e.message);
    throw new Error('Failed to parse dependencies');
  }
}

module.exports = { assignSections, determineDependencies };
