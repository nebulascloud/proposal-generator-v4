/**
 * JSON Context Usage Examples
 * 
 * This file contains example functions that demonstrate how to use
 * the JSON context handling approach instead of file uploads.
 */

const { responsesAgent } = require('../agents/responsesAgent');
const jsonContext = require('../utils/jsonContext');

/**
 * Example 1: Analyze Customer Brief without file upload
 * 
 * @param {Object} customerBrief The customer brief object
 * @param {String} proposalId The proposal ID
 */
async function analyzeCustomerBriefExample(customerBrief, proposalId) {
  try {
    // Store the brief in the database with metadata
    const contextResult = await responsesAgent.createAndUploadFile(
      customerBrief, 
      `proposal-${proposalId}_brief.json`, 
      true // Use jsonContext
    );
    
    // If it's a JSON context (not a file ID)
    if (contextResult.type === 'jsonContext') {
      // Format the brief for inclusion in the prompt
      const briefContent = await contextResult.getForPrompt('markdown');
      
      // Create a prompt that includes the brief content
      const prompt = `Please analyze this customer brief and identify key requirements:
      
${briefContent}

Based on this brief, what are the key requirements and considerations?`;
      
      // Call OpenAI with the prompt (no file attachment needed)
      const response = await responsesAgent.createInitialResponse(
        prompt, 
        [], // Empty files array - we don't need file attachments
        "sp_Brief_Analyzer",
        "clarification",
        proposalId
      );
      
      return response;
    } else {
      // Fallback to the old approach if needed
      const response = await responsesAgent.createInitialResponse(
        "Please analyze this customer brief and identify key requirements.", 
        [contextResult], // File ID 
        "sp_Brief_Analyzer",
        "clarification",
        proposalId
      );
      
      return response;
    }
  } catch (error) {
    console.error('[Example Error]', error);
    throw error;
  }
}

/**
 * Example 2: Continue a conversation using database message history
 * 
 * @param {String} newQuestion The new question to ask
 * @param {String} proposalId The proposal ID
 */
async function continueConversationExample(newQuestion, proposalId) {
  try {
    // Build context from previous messages
    const messageHistory = await responsesAgent.buildContextFromMessages(
      proposalId,
      { 
        maxMessages: 5,
        format: 'markdown',
        includePhases: 'clarification'
      }
    );
    
    // Create a prompt that includes the message history
    const prompt = `Previous conversation:
    
${messageHistory}

New question: ${newQuestion}

Please respond to the new question based on our previous conversation.`;
    
    // Call OpenAI with the prompt
    const response = await responsesAgent.createInitialResponse(
      prompt,
      [], // No file attachments
      "sp_Clarification_Agent",
      "clarification",
      proposalId
    );
    
    return response;
  } catch (error) {
    console.error('[Example Error]', error);
    throw error;
  }
}

/**
 * Example 3: Draft a proposal section using specific context extraction
 * 
 * @param {String} sectionName The section to draft
 * @param {String} proposalId The proposal ID
 * @param {String} briefContextId The context ID for the brief
 */
async function draftSectionExample(sectionName, proposalId, briefContextId) {
  try {
    // Retrieve the brief context
    const { data: briefData } = await jsonContext.getContext(briefContextId);
    
    // Extract only the relevant parts based on the section
    let relevantContext;
    
    if (sectionName === 'introduction') {
      relevantContext = jsonContext.extractContext(briefData, 'company');
    } else if (sectionName === 'approach') {
      relevantContext = jsonContext.extractContext(briefData, 'requirements');
    } else if (sectionName === 'timeline') {
      relevantContext = jsonContext.extractContext(briefData, 'timeline');
    } else {
      // Get a summary for other sections
      relevantContext = jsonContext.extractContext(briefData, 'summary');
    }
    
    // Format the extracted context
    const formattedContext = jsonContext.formatForPrompt(relevantContext, 'markdown');
    
    // Build prompt including relevant messages from previous phases
    const clarificationContext = await responsesAgent.buildContextFromMessages(
      proposalId,
      { 
        maxMessages: 3,
        format: 'text',
        includePhases: 'clarification'
      }
    );
    
    // Create the complete prompt
    const prompt = `I need to draft the "${sectionName}" section of a proposal.

CUSTOMER BRIEF DETAILS:
${formattedContext}

CLARIFICATION CONVERSATION:
${clarificationContext}

Please draft the "${sectionName}" section for this proposal.`;
    
    // Call OpenAI with the prompt
    const response = await responsesAgent.createInitialResponse(
      prompt,
      [], // No file attachments
      "sp_Section_Drafter",
      "draft",
      proposalId
    );
    
    return response;
  } catch (error) {
    console.error('[Example Error]', error);
    throw error;
  }
}

module.exports = {
  analyzeCustomerBriefExample,
  continueConversationExample,
  draftSectionExample
};
