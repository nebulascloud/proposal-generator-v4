require('dotenv').config();
const { createAssistant, getAssistantResponse, initializeThread } = require('./assistantAgent');

const model = process.env.OPENAI_MODEL || 'gpt-4';
const temperature = parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7;

/**
 * Assigns proposal sections to agent roles via LLM.
 * Uses the context-aware approach when a thread is provided.
 */
async function assignSections({ sections, title, client, details, threadId = null }) {
  if (process.env.NODE_ENV === 'test' || !process.env.OPENAI_API_KEY) {
    const mapping = {};
    sections.forEach(sec => { mapping[sec] = 'sp_Account_Manager'; });
    return mapping;
  }

  // Production: delegate to Collaboration Orchestrator assistant
  const orchestratorId = await createAssistant('sp_Collaboration_Orchestrator');
  
  let thread = threadId;
  let prompt;
  
  // Create a thread with context if none provided
  if (!threadId) {
    const brief = { title, client_name: client, project_description: details };
    thread = await initializeThread(brief);
    prompt = `Assign these sections to appropriate roles: ${sections.join(', ')}. Return a JSON object mapping each section name to a role.`;
  } else {
    // Use context-aware prompt with existing thread
    prompt = `Assign these sections to appropriate roles: ${sections.join(', ')}. Return a JSON object mapping each section name to a role.`;
  }
  
  const raw = await getAssistantResponse(orchestratorId, prompt, thread ? thread.id : null, { skipContextReminder: !!threadId });
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
  const orchestratorId = await createAssistant('sp_Collaboration_Orchestrator');
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
