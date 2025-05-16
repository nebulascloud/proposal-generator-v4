require('dotenv').config();
const { defaultTemplate } = require('../templates/defaultTemplate');
const { OpenAI } = require('openai');
const { assignSections } = require('./orchestratorAgent');
const { createAssistant, getAssistantResponse, initializeThread } = require('./assistantAgent');
const { assistantDefinitions } = require('./assistantDefinitions');

// Mock customer agent
function mockCustomerAnswer(question, brief) {
  return `Mock answer to "${question}" for ${brief.client_name}`;
}

async function runFullFlow({ brief }) {
  if (process.env.NODE_ENV === 'test' || !process.env.OPENAI_API_KEY) {
    const analysis = `Brief analysis for ${brief.client_name}`;
    const sections = Object.keys(defaultTemplate);
    const assignments = await assignSections({ sections, title: '', client: brief.client_name, details: brief.project_description });
    const questions = sections.map(s => `What additional details do you have for "${s}"?`);
    const answers = questions.map(q => mockCustomerAnswer(q, brief));
    const development = {};
    for (const section of sections) {
      development[section] = `Draft for ${section} incorporating answers: ${answers.join('; ')}`;
    }
    const reviews = {};
    sections.forEach(sec => {
      reviews[sec] = `Review comment for ${sec}`;
    });
    const approval = 'Final approval granted';
    const assembled = sections.map(sec => development[sec]).join('\n\n');
    return { analysis, sections, assignments, questions, answers, development, reviews, approval, assembled };
  }
  // Production: orchestrate via assistants
  const sections = Object.keys(defaultTemplate);

  // Create and initialize a single thread for the entire flow with comprehensive context
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const mainThread = await initializeThread(brief);
  console.log("[flowAgent] Created and initialized main flow thread " + mainThread.id);
  
  // Get available roles for the orchestrator
  const availableRoles = Object.keys(assistantDefinitions);
  console.log("[flowAgent] Available roles: " + availableRoles.join(', '));
  
  // Create orchestration assistant
  const orchestratorId = await createAssistant('Collaboration Orchestrator');
  
  // Step 1: analysis - no need to include the brief again since it's in the thread context
  const analysisPrompt = "Analyze the previously provided brief and provide a comprehensive assessment.";
  const analysis = await getAssistantResponse(orchestratorId, analysisPrompt, mainThread.id, { skipContextReminder: true });
  
  // JSON parse helper
  function parseJson(raw, label) {
    console.log(`[flowAgent] Raw ${label}:`, raw);
    if (typeof raw !== 'string') {
      console.error(`[flowAgent] Non-string response for ${label}:`, raw);
      throw new Error(`No JSON response for ${label}`);
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed === 'undefined') {
      console.error(`[flowAgent] Undefined or empty response for ${label}`);
      throw new Error(`No JSON response for ${label}`);
    }
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first < 0 || last < first) {
      console.error(`[flowAgent] JSON object not found in ${label} response`);
      throw new Error(`Invalid JSON for ${label}`);
    }
    const jsonStr = trimmed.substring(first, last + 1);
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error(`[flowAgent] JSON.parse error for ${label}:`, e.message);
      throw new Error(`Invalid JSON for ${label}`);
    }
  }
  
  // Step 2: assign sections - specify ONLY available roles
  const assignPrompt = "Assign these sections: " + sections.join(', ') + 
                        " based on the brief information already provided.\n\n" +
                        "IMPORTANT: You must ONLY use these exact roles in your assignments: " + 
                        availableRoles.join(', ') + 
                        "\n\nReturn a JSON object mapping each section name to exactly one of these role names.";
  
  const assignRaw = await getAssistantResponse(orchestratorId, assignPrompt, mainThread.id, { skipContextReminder: true });
  const assignments = parseJson(assignRaw, 'section assignments');
  
  // Step 3: generate qualifying questions
  const questionsPrompt = "For each section in our proposal, generate relevant qualifying questions based on the project context. Return a JSON object mapping each section name to an array of questions.";
  const questionsRaw = await getAssistantResponse(orchestratorId, questionsPrompt, mainThread.id, { skipContextReminder: true });
  const questions = parseJson(questionsRaw, 'qualifying questions');
  
  // Step 4: get customer answers
  const customerId = await createAssistant('RPE Customer (CU)');
  const answers = {};
  for (const [section, qs] of Object.entries(questions)) {
    answers[section] = [];
    for (const q of qs) {
      // Customer needs specific questions without context reminders
      const ans = await getAssistantResponse(customerId, q, mainThread.id, { skipContextReminder: true });
      answers[section].push(ans);
    }
  }
  
  // Step 5: development by assignees
  const development = {};
  for (const [section, role] of Object.entries(assignments)) {
    // Map role to available assistant if needed
    const aid = await createAssistant(role);
    // Use focused prompt that relies on thread context and adds only relevant section answers
    const prompt = "Draft the \"" + section + "\" section based on the project context and these qualifying question answers: " + JSON.stringify(answers[section]);
    development[section] = await getAssistantResponse(aid, prompt, mainThread.id, { skipContextReminder: true });
  }
  
  // Step 6: reviews by orchestrator
  const reviews = {};
  for (const section of sections) {
    // Use context-aware prompts for reviews
    const reviewPrompt = "Review the following draft for the \"" + section + "\" section. Ensure it aligns with the project goals and addresses the client's needs:\n\n" + development[section];
    reviews[section] = await getAssistantResponse(orchestratorId, reviewPrompt, mainThread.id, { skipContextReminder: true });
  }
  
  // Step 7: final assembly
  const assembled = sections.map(sec => development[sec]).join('\n\n');
  const finalPrompt = "Finalize the complete proposal by assembling and harmonizing the following sections into a cohesive document:\n\n" + assembled;
  const final = await getAssistantResponse(orchestratorId, finalPrompt, mainThread.id, { skipContextReminder: true });
  
  console.log("[flowAgent] Completed flow using thread " + mainThread.id);
  return { analysis, assignments, questions, answers, development, reviews, final, assembled };
}

module.exports = { runFullFlow };
