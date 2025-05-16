require('dotenv').config();
const { createAssistant, getAssistantResponse, initializeThread } = require('./assistantAgent');

/**
 * Generates a proposal draft using the Assistants API with context sharing.
 * Falls back to a test stub when NODE_ENV is 'test' or when OPENAI_API_KEY is not set.
 */
async function generateProposal({ title, client, details, section, threadId = null }) {
  // Stub in test or without API key
  if (process.env.NODE_ENV === 'test' || !process.env.OPENAI_API_KEY) {
    return `Test proposal draft for title: ${title}, client: ${client}, details: ${details}${section ? `, section: ${section}` : ''}`;
  }
  
  const proposalWriterId = await createAssistant('RPE Account Manager (AM)');
  
  // Determine if we need to create a new thread with context
  let thread = threadId;
  let prompt;
  
  if (!threadId) {
    // No existing thread, so initialize one with comprehensive context
    const brief = { 
      title, 
      client_name: client, 
      project_description: details
    };
    thread = await initializeThread(brief);
    
    if (section) {
      // Focus on specific section
      prompt = `Draft the "${section}" section of the proposal. It should be formal, persuasive, and well-structured.`;
    } else {
      // Draft the full proposal
      prompt = `Draft a complete, formal and persuasive proposal. The proposal should be well-structured and concise.`;
    }
  } else {
    // Using existing thread with context
    if (section) {
      prompt = `Draft the "${section}" section of the proposal. It should be formal, persuasive, and well-structured.`;
    } else {
      prompt = `Draft a complete, formal and persuasive proposal based on the provided context. The proposal should be well-structured and concise.`;
    }
  }
  
  const response = await getAssistantResponse(
    proposalWriterId, 
    prompt, 
    thread ? thread.id : null,
    { skipContextReminder: !!threadId }
  );
  
  return response;
}

// Export for CommonJS
module.exports = { generateProposal };
