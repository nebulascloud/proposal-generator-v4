require('dotenv').config();
const { assistantDefinitions } = require('./assistantDefinitions');

const useStub = process.env.NODE_ENV === 'test' || !process.env.OPENAI_API_KEY;
if (useStub) {
  async function createAssistant(role) {
    return 'test-assistant';
  }
  async function getAssistantResponse(assistantId, userMessage) {
    return `Test assistant response for ${assistantId}`;
  }
  const assistantIds = {};
  module.exports = { createAssistant, getAssistantResponse, assistantDefinitions, assistantIds };
} else {
  const fs = require('fs');
  const path = require('path');
  const OpenAI = require('openai').default || require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // Load or initialize persistent assistant ID store
  const dataDir = path.resolve(__dirname, '../data');
  const dataFile = path.join(dataDir, 'assistants.json');
  let assistantIds = {};
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
    assistantIds = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  } catch {
    assistantIds = {};
    // Reset corrupt or missing assistants.json
    try { fs.writeFileSync(dataFile, JSON.stringify(assistantIds, null, 2)); } catch {};
  }

  const threadIds = {};
  const runIds = {};
  const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS) || 200;
  const POLL_TIMEOUT_MS = parseInt(process.env.POLL_TIMEOUT_MS) || 120000;

  // Map arbitrary role names to our defined assistant roles
  function mapRoleToAssistant(role) {
    if (!role) return 'Collaboration Orchestrator';
    
    // Direct match with our assistants
    const directMatch = Object.keys(assistantDefinitions).find(
      key => key === role || key.toLowerCase() === role.toLowerCase()
    );
    if (directMatch) return directMatch;
    
    // Map common variations to our defined roles
    const roleLower = role.toLowerCase();
    
    // Account Manager variations
    if (roleLower.includes('account') || roleLower === 'am') {
      return 'RPE Account Manager (AM)';
    }
    
    // Project Manager variations
    if (roleLower.includes('project manager') || roleLower === 'pm' || roleLower === 'project') {
      return 'RPE Project Manager (PM)';
    }
    
    // Commercial/Finance variations
    if (roleLower.includes('commercial') || roleLower.includes('finance') || 
        roleLower.includes('pricing') || roleLower === 'cm') {
      return 'RPE Commercial Manager (CM)';
    }
    
    // Legal variations
    if (roleLower.includes('legal') || roleLower.includes('counsel') || roleLower === 'lc') {
      return 'RPE Legal Counsel (LC)';
    }
    
    // Technical roles
    if (roleLower.includes('solution') || roleLower.includes('architect') || roleLower === 'sa') {
      return 'RPE Solution Architect (SA)';
    }
    
    if (roleLower.includes('data architect') || roleLower === 'da') {
      return 'RPE Data Architect (DA)';
    }
    
    if (roleLower.includes('engineer') || roleLower.includes('technical') || roleLower === 'le') {
      return 'RPE Lead Engineer (LE)';
    }
    
    // Customer variations
    if (roleLower.includes('customer') || roleLower === 'cu') {
      return 'RPE Customer (CU)';
    }
    
    // Marketing/creative roles default to Account Manager
    if (roleLower.includes('marketing') || roleLower.includes('design') || roleLower.includes('creative')) {
      return 'RPE Account Manager (AM)';
    }
    
    // Business Analyst also defaults to Account Manager
    if (roleLower.includes('business analyst') || roleLower.includes('analyst')) {
      return 'RPE Account Manager (AM)';
    }
    
    // Default to Account Manager for unknown roles
    console.log(`[assistantAgent] Unknown role "${role}" mapped to Account Manager`);
    return 'RPE Account Manager (AM)';
  }

  async function createAssistant(role) {
    // Map role name to one of our defined assistants
    const mappedRole = mapRoleToAssistant(role);
    console.log(`[assistantAgent] ${role !== mappedRole ? `Mapped role "${role}" to "${mappedRole}"` : `Using role "${role}"`}`);
    
    const instructions = assistantDefinitions[mappedRole];
    if (!instructions) throw new Error(`No assistant definition for role: ${role}`);
    if (assistantIds[mappedRole]) return assistantIds[mappedRole];
    const assistant = await openai.beta.assistants.create({
      name: mappedRole,
      instructions,
      model: process.env.OPENAI_MODEL
    });
    assistantIds[mappedRole] = assistant.id;
    fs.writeFileSync(dataFile, JSON.stringify(assistantIds, null, 2));
    return assistant.id;
  }

  async function getAssistantResponse(assistantId, userMessage, specificThreadId = null) {
    console.log(`[AssistantAgent] (${assistantId}) getAssistantResponse called with message: ${userMessage}`);
    // Use provided threadId or create/retrieve from cached threadIds
    let threadId = specificThreadId;
    if (!threadId) {
      if (!threadIds[assistantId]) {
        const thread = await openai.beta.threads.create();
        console.log(`[assistantAgent] Created thread ${thread.id} for assistant ${assistantId}`);
        threadIds[assistantId] = thread.id;
      }
      threadId = threadIds[assistantId];
    } else {
      console.log(`[assistantAgent] Using provided thread ${threadId} for assistant ${assistantId}`);
    }
    // Post user message to thread
    console.log(`[assistantAgent] Posting message to thread ${threadId}: ${userMessage}`);
    await openai.beta.threads.messages.create(threadId, { role: 'user', content: userMessage });
    // Run assistant on thread
    const run = await openai.beta.threads.runs.create(threadId, { assistant_id: assistantId });
    console.log(`[assistantAgent] Created run ${run.id} for thread ${threadId}`);
    // Poll until complete with exponential backoff
    const startTime = Date.now();
    let delayMs = POLL_INTERVAL_MS;
    while (true) {
      const poll = await openai.beta.threads.runs.retrieve(threadId, run.id);
      console.log(`[assistantAgent] Polling run ${run.id}, status=${poll.status}`);
      // log entire poll object for debugging
      console.debug(poll);
      // Success when run.status is 'succeeded' or legacy 'completed'
      if (poll.status === 'succeeded' || poll.status === 'completed') {
        // Need to fetch the latest messages from the thread to get the actual response
        console.log(`[AssistantAgent] (${assistantId}) Run ${run.id} completed, fetching thread messages`);
        try {
          const messages = await openai.beta.threads.messages.list(threadId);
          const assistantMessages = messages.data.filter(m => m.role === 'assistant');
          if (assistantMessages.length === 0) {
            console.error(`[AssistantAgent] No assistant messages found in thread ${threadId}`);
            throw new Error('No assistant messages found in thread');
          }
          // Get the most recent assistant message
          const latestMessage = assistantMessages[0];
          // Access the first text content value
          let result = '';
          if (latestMessage.content && latestMessage.content.length > 0) {
            for (const content of latestMessage.content) {
              if (content.type === 'text') {
                result = content.text.value.trim();
                break;
              }
            }
          }
          if (!result) {
            console.error(`[AssistantAgent] (${assistantId}) No text content found in assistant message`);
            throw new Error('No text content found in assistant message');
          }
          console.log(`[AssistantAgent] (${assistantId}) Got response from thread:`, result);
          return result;
        } catch (e) {
          console.error(`[AssistantAgent] (${assistantId}) Error fetching thread messages:`, e);
          throw new Error(`Failed to get assistant response: ${e.message}`);
        }
      }
      if (poll.status === 'failed' || poll.status === 'cancelled') {
        console.error(`[AssistantAgent] (${assistantId}) Run ${run.id} ended with status: ${poll.status}`);
        throw new Error(`Assistant run ${run.id} did not succeed, status: ${poll.status}`);
      }
      if (Date.now() - startTime > POLL_TIMEOUT_MS) {
        console.error(`[AssistantAgent] (${assistantId}) Run ${run.id} timed out after ${POLL_TIMEOUT_MS}ms`);
        throw new Error(`Assistant run ${run.id} timed out`);
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 2000);
    }
  }

  module.exports = { createAssistant, getAssistantResponse, assistantDefinitions, assistantIds };
}
