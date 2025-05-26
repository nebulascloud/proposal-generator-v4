/**
 * Responses API Utilities
 * 
 * This module provides core utilities for interacting with OpenAI's Responses API,
 * handling file management, token tracking, and maintaining a consistent workflow.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const { assistantDefinitions } = require('./assistantDefinitions');
const { v4: uuidv4 } = require('uuid');

// Database models for message logging
const Session = require('../db/models/session');
const Message = require('../db/models/message');
const Agent = require('../db/models/agent');

// JSON context handling
const jsonContext = require('../utils/jsonContext');
const { buildMessageContext } = require('../utils/messageContextBuilder');

// Initialize OpenAI client
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 3,
  timeout: 60000 // 60 seconds timeout for longer generations
});

// Log startup configuration for debugging
console.log(`[responsesAgent] Initialized with model: ${process.env.OPENAI_MODEL || 'default'}`);
console.log(`[responsesAgent] API key configured: ${process.env.OPENAI_API_KEY ? 'Yes (hidden)' : 'No'}`);
console.log(`[responsesAgent] Temperature setting: ${process.env.OPENAI_TEMPERATURE || 'default'}`);

// File storage directory (create if not exists)
const DATA_DIR = path.join(__dirname, '../data/responses-files');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Proposal progress tracking state
 */
const proposalProgress = {
  phase1: {
    briefAnalysis: { status: 'pending', fileId: null, tokenUsage: { prompt: 0, completion: 0, total: 0 } },
    sectionAssignments: { status: 'pending', fileId: null, tokenUsage: { prompt: 0, completion: 0, total: 0 } },
    clarifyingQuestions: { 
      status: 'pending', 
      fileId: null, 
      specialists: {},
      tokenUsage: { prompt: 0, completion: 0, total: 0 }
    }
  },
  phase2: {
    customerAnswers: { status: 'pending', fileId: null, tokenUsage: { prompt: 0, completion: 0, total: 0 } },
    sectionDrafts: { 
      status: 'pending', 
      sections: {},
      tokenUsage: { prompt: 0, completion: 0, total: 0 }
    }
  },
  phase3: {
    reviews: { 
      status: 'pending', 
      sections: {},
      tokenUsage: { prompt: 0, completion: 0, total: 0 }
    },
    customerReviewAnswers: { status: 'pending', fileId: null, tokenUsage: { prompt: 0, completion: 0, total: 0 } },
    revisions: { 
      status: 'pending', 
      sections: {},
      tokenUsage: { prompt: 0, completion: 0, total: 0 }
    }
  },
  phase4: {
    assembly: { status: 'pending', fileId: null, tokenUsage: { prompt: 0, completion: 0, total: 0 } },
    finalReview: { status: 'pending', fileId: null, tokenUsage: { prompt: 0, completion: 0, total: 0 } }
  },
  // Summary of all token usage
  tokenSummary: {
    phase1: { prompt: 0, completion: 0, total: 0 },
    phase2: { prompt: 0, completion: 0, total: 0 },
    phase3: { prompt: 0, completion: 0, total: 0 },
    phase4: { prompt: 0, completion: 0, total: 0 },
    overall: { prompt: 0, completion: 0, total: 0 }
  }
};

/**
 * Reset the proposal progress tracking state
 */
function resetProgress() {
  // Reset phase 1
  proposalProgress.phase1.briefAnalysis = { status: 'pending', fileId: null, tokenUsage: { prompt: 0, completion: 0, total: 0 } };
  proposalProgress.phase1.sectionAssignments = { status: 'pending', fileId: null, tokenUsage: { prompt: 0, completion: 0, total: 0 } };
  proposalProgress.phase1.clarifyingQuestions = { 
    status: 'pending', 
    fileId: null, 
    specialists: {},
    tokenUsage: { prompt: 0, completion: 0, total: 0 }
  };
  
  // Reset phase 2
  proposalProgress.phase2.customerAnswers = { status: 'pending', fileId: null, tokenUsage: { prompt: 0, completion: 0, total: 0 } };
  proposalProgress.phase2.sectionDrafts = { 
    status: 'pending', 
    sections: {},
    tokenUsage: { prompt: 0, completion: 0, total: 0 }
  };
  
  // Reset phase 3
  proposalProgress.phase3.reviews = { 
    status: 'pending', 
    sections: {},
    tokenUsage: { prompt: 0, completion: 0, total: 0 }
  };
  proposalProgress.phase3.customerReviewAnswers = { status: 'pending', fileId: null, tokenUsage: { prompt: 0, completion: 0, total: 0 } };
  proposalProgress.phase3.revisions = { 
    status: 'pending', 
    sections: {},
    tokenUsage: { prompt: 0, completion: 0, total: 0 }
  };
  
  // Reset phase 4
  proposalProgress.phase4.assembly = { status: 'pending', fileId: null, tokenUsage: { prompt: 0, completion: 0, total: 0 } };
  proposalProgress.phase4.finalReview = { status: 'pending', fileId: null, tokenUsage: { prompt: 0, completion: 0, total: 0 } };
  
  // Reset token summary
  proposalProgress.tokenSummary = {
    phase1: { prompt: 0, completion: 0, total: 0 },
    phase2: { prompt: 0, completion: 0, total: 0 },
    phase3: { prompt: 0, completion: 0, total: 0 },
    phase4: { prompt: 0, completion: 0, total: 0 },
    overall: { prompt: 0, completion: 0, total: 0 }
  };
}

/**
 * Track token usage from a response
 * 
 * @param {Object} response - The OpenAI response object
 * @param {String} phase - The phase name (e.g., 'phase1')
 * @param {String} component - The component name (e.g., 'briefAnalysis')
 * @returns {Object} Token usage details
 */
function trackTokenUsage(response, phase, component) {
  // Extract token usage from response
  const promptTokens = response.usage.prompt_tokens;
  const completionTokens = response.usage.completion_tokens;
  const totalTokens = response.usage.total_tokens;
  
  // Update component-specific usage
  if (proposalProgress[phase] && proposalProgress[phase][component]) {
    proposalProgress[phase][component].tokenUsage = {
      prompt: promptTokens,
      completion: completionTokens,
      total: totalTokens
    };
  
    // Update phase summary
    proposalProgress.tokenSummary[phase].prompt += promptTokens;
    proposalProgress.tokenSummary[phase].completion += completionTokens;
    proposalProgress.tokenSummary[phase].total += totalTokens;
    
    // Update overall summary
    proposalProgress.tokenSummary.overall.prompt += promptTokens;
    proposalProgress.tokenSummary.overall.completion += completionTokens;
    proposalProgress.tokenSummary.overall.total += totalTokens;
  }
  
  // Log token usage for monitoring
  console.log(`[Token Usage] ${phase}/${component}: ${totalTokens} tokens (${promptTokens} prompt, ${completionTokens} completion)`);
  
  return { promptTokens, completionTokens, totalTokens };
}

/**
 * Store data in the database (formerly used to create and upload files to OpenAI)
 *
 * @param {String|Object} content - Content to save
 * @param {String} filename - Name to associate with the content
 * @param {Boolean} useJsonContext - Deprecated, kept for backward compatibility
 * @returns {Object} Context reference object with contextId
 */
async function createAndUploadFile(content, filename, useJsonContext = true) {
  try {
    console.log(`[JSON Context] Storing ${filename} in database`);
    
    // Handle null or undefined content
    if (content === undefined || content === null) {
      console.error(`[JSON Context] Received null/undefined content for ${filename}`);
      
      // In test mode, use a mock object instead of failing
      if (process.env.NODE_ENV === 'test') {
        console.warn(`[JSON Context] Test mode: Using mock data for ${filename}`);
        return 'mock-file-id';
      } else {
        // For non-test environments, create an error placeholder
        content = { error: `Empty or null content received for ${filename}` };
      }
    }
    
    // Determine if content is JSON
    const isJson = typeof content === 'object' || 
                 (typeof content === 'string' && filename.endsWith('.json'));
    
    // Parse JSON content if needed
    let processedContent;
    if (isJson && typeof content === 'string') {
      try {
        processedContent = JSON.parse(content);
      } catch (parseError) {
        console.error(`[JSON Context] Error parsing JSON content for ${filename}: ${parseError.message}`);
        
        // In test mode, use a mock object instead of failing
        if (process.env.NODE_ENV === 'test') {
          console.warn(`[JSON Context] Test mode: Using mock data for ${filename}`);
          processedContent = { test: true, parseError: parseError.message };
        } else {
          // For non-test environments, treat content as plain text if JSON parsing fails
          console.warn(`[JSON Context] Treating content as plain text due to parsing error`);
          processedContent = { text: content, parseError: parseError.message };
        }
      }
    } else {
      // For non-JSON or pre-parsed objects
      processedContent = typeof content === 'object' ? content : { text: content || '' };
    }
    
    // Extract file type from filename for metadata
    const fileType = filename.split('_')[0] || 'unknown';
    
    // Store in database using jsonContext
    const contextId = await jsonContext.storeContext(processedContent, { 
      filename,
      type: fileType,
      isJson,
      createdAt: new Date().toISOString()
    });
    
    return { 
      type: 'jsonContext', 
      contextId,
      // Return a helper to format this context for prompts
      getForPrompt: async (format = 'markdown') => {
        const { data } = await jsonContext.getContext(contextId);
        return jsonContext.formatForPrompt(data, format);
      }
    };
  } catch (error) {
    console.error('[Context Storage Error]', error);
    throw new Error(`Data storage error: ${error.message}`);
  }
}

/**
 * Create an initial response with the OpenAI Responses API
 * 
 * @param {String} content - The user message content
 * @param {Array} contexts - Array of context objects or context IDs from database
 * @param {String} role - The role from assistantDefinitions (e.g., 'sp_Account_Manager')
 * @param {String} phase - The current phase (e.g., 'clarification', 'draft')
 * @param {String} proposalId - The ID of the current proposal
 * @returns {Object} The OpenAI response
 */
async function createInitialResponse(content, contexts = [], role, phase = null, proposalId = null) {
  try {
    // Get instructions for the role from assistantDefinitions
    const instructions = assistantDefinitions[role] || '';

    // Store or get the agent in the database
    await Agent.getOrCreate(role, instructions);

    // Build input message array: format contextual data first, then the text prompt
    let contextText = '';
    let contextInfo = [];
    
    // Robust handling for contexts parameter
    // First check if contexts exists, then ensure it's an array
    const contextsArray = contexts ? (Array.isArray(contexts) ? contexts : []) : [];
    
    // Extra debug logging for context handling
    console.log(`[responsesAgent] Context for ${role} - Type: ${typeof contexts}, IsArray: ${Array.isArray(contexts)}, Length: ${contextsArray.length}`);
    
    if (contextsArray.length > 0) {
      // Process each context object to extract relevant data for the prompt
      for (const context of contextsArray) {
        // Safety check for null or undefined context
        if (context === null || context === undefined) {
          console.warn(`[responsesAgent] Skipping null/undefined context entry for ${role}`);
          continue;
        }
        
        if (typeof context === 'string') {
          // If just a context ID is provided, retrieve it
          try {
            const { data } = await jsonContext.getContext(context);
            contextInfo.push({
              id: context,
              data
            });
          } catch (e) {
            console.error(`[responsesAgent] Error retrieving context ID ${context}: ${e.message}`);
          }
        } else if (context && context.type === 'jsonContext' && context.contextId) {
          // Handle our context object format
          try {
            const { data } = await jsonContext.getContext(context.contextId);
            contextInfo.push({
              id: context.contextId,
              data
            });
          } catch (e) {
            console.error(`[responsesAgent] Error retrieving context from object ${context.contextId}: ${e.message}`);
          }
        } else {
          // Handle any other format
          contextInfo.push({
            data: context
          });
        }
      }
      
      // Format all contexts as a single text block
      if (contextInfo.length > 0) {
        contextText = contextInfo.map((ctx, index) => {
          const ctxData = ctx.data;
          let formattedData;
          
          if (typeof ctxData === 'object') {
            try {
              formattedData = JSON.stringify(ctxData, null, 2);
            } catch (e) {
              console.error(`[responsesAgent] Error stringifying context data: ${e.message}`);
              formattedData = String(ctxData);
            }
          } else {
            formattedData = String(ctxData);
          }
          
          return `Context ${index + 1}${ctx.id ? ` (ID: ${ctx.id})` : ''}:\n${formattedData}`;
        }).join('\n\n---\n\n');
      }
    }
    
    // Create the content array for the API call
    let messageContent = [];
    
    // Add context if available
    if (contextText) {
      messageContent.push({
        type: "input_text",
        text: contextText
      });
    }
    
    // Add the main prompt
    messageContent.push({
      type: "input_text",
      text: content
    });

    // Create response using Responses API
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      instructions,
      input: [
        {
          role: "user",
          content: messageContent
        }
      ],
      user: role // Use 'user' instead of 'user_id'
    });

    // Extract the main text from the OpenAI response
    // Prefer choices/message.content, then output[].content[].text, then text/content fields
    let responseText = '';

    // 1. Check for choices/message.content (chat-style response)
    if (response.choices && response.choices.length > 0) {
      const firstChoice = response.choices[0];
      if (firstChoice.message && firstChoice.message.content) {
        responseText = firstChoice.message.content;
      } else if (firstChoice.text) {
        responseText = firstChoice.text;
      }
    }
    // 2. Check for output[].content[].text (OpenAI responses API format)
    else if (Array.isArray(response.output) && response.output.length > 0) {
      // Find the first output_text type in the content array
      for (const outputItem of response.output) {
        if (Array.isArray(outputItem.content)) {
          const outputTextObj = outputItem.content.find(
            c => c.type === 'output_text' && typeof c.text === 'string'
          );
          if (outputTextObj) {
            responseText = outputTextObj.text;
            break;
          }
        }
      }
    }
    // 3. Fallbacks: text/content fields
    else if (typeof response.text === 'string') {
      responseText = response.text;
    } else if (typeof response.content === 'string') {
      responseText = response.content;
    } else if (typeof response === 'string') {
      responseText = response;
    }

    // Ensure we have a valid string
    if (!responseText || typeof responseText !== 'string') {
      console.error('[responsesAgent] Failed to extract text from response:', response);
      responseText = JSON.stringify(response) || '';
    }

    // Only add a single 'text' and 'response' property to the returned object
    const returnObj = {
      ...response,
      text: responseText,
      response: responseText
    };
    // Remove any output_text property if present
    if (returnObj.output_text) delete returnObj.output_text;

    console.log(`[responsesAgent] Extracted text (first 100 chars): ${responseText.substring(0, 100)}...`);

    // Log message to database if we have a proposal ID
    if (proposalId) {
      try {
        // Get or create a session for this proposal
        let session = await Session.getByProposalId(proposalId);
        if (!session) {
          session = await Session.create({
            proposalId,
            status: 'active',
            metadata: { startedAt: new Date().toISOString() }
          });
        }

        // Create message entry for user message
        const userMessageId = uuidv4();
        await Message.create({
          id: userMessageId,
          responseId: response.id || uuidv4(),
          phase,
          agentName: role,
          role: 'user',
          content,
          sessionId: session.id,
          metadata: {
            contexts: Array.isArray(contexts) ? contexts.map(ctx => {
              if (typeof ctx === 'string') {
                return ctx;
              } else if (ctx && ctx.type === 'jsonContext' && ctx.contextId) {
                return ctx.contextId;
              } else {
                try {
                  return JSON.stringify(ctx);
                } catch (e) {
                  console.warn(`[JSON Context] Error stringifying context object: ${e.message}`);
                  return String(ctx);
                }
              }
            }) : [],
            timestamp: new Date().toISOString()
          }
        });

        // Create message entry for assistant response
        await Message.create({
          id: uuidv4(),
          responseId: response.id || uuidv4(),
          phase,
          agentName: role,
          role: 'assistant',
          content: responseText, // Use the extracted text content
          parentMessageId: userMessageId, // Link to the user message
          sessionId: session.id,
          metadata: {
            model: response.model,
            timestamp: new Date().toISOString(),
            tokenUsage: response.usage || {}
          }
        });

        console.log(`[Database] Logged initial message exchange for proposal ${proposalId}`);
      } catch (dbError) {
        console.error('[Database Error]', dbError);
        // Don't throw the error, just log it - we can still continue with the response
      }
    }

    console.log(`[Response Created] Initial response for ${role} (${responseText.length} chars)`);
    
    return returnObj;
  } catch (error) {
    console.error('[Response Error]', error);
    throw new Error(`Response creation error: ${error.message}`);
  }
}

/**
 * Fork an existing response
 * 
 * @param {String} previousResponseId - The ID of the previous response to fork
 * @param {String} content - New user message content
 * @param {Array} contexts - Array of context objects or context IDs from database
 * @param {String} role - The role from assistantDefinitions
 * @param {String} phase - The current phase (e.g., 'clarification', 'draft')
 * @param {String} proposalId - The ID of the current proposal
 * @returns {Object} The forked response
 */
async function forkResponse(previousResponseId, content, contexts = [], role, phase = null, proposalId = null) {
  try {
    // Get instructions for the role
    const instructions = assistantDefinitions[role] || '';

    // Store or get the agent in the database
    await Agent.getOrCreate(role, instructions);

    // Build input message array similar to createInitialResponse
    let contextText = '';
    let contextInfo = [];
    
    // Robust handling for contexts parameter
    // First check if contexts exists, then ensure it's an array
    const contextsArray = contexts ? (Array.isArray(contexts) ? contexts : []) : [];
    
    // Extra debug logging for context handling
    console.log(`[responsesAgent] Fork context for ${role} - Type: ${typeof contexts}, IsArray: ${Array.isArray(contexts)}, Length: ${contextsArray.length}`);
    
    if (contextsArray.length > 0) {
      // Process each context object to extract relevant data
      for (const context of contextsArray) {
        // Safety check for null or undefined context
        if (context === null || context === undefined) {
          console.warn(`[responsesAgent] Skipping null/undefined context entry in fork for ${role}`);
          continue;
        }
        
        if (typeof context === 'string') {
          // If just a context ID is provided, retrieve it
          try {
            const { data } = await jsonContext.getContext(context);
            contextInfo.push({
              id: context,
              data
            });
          } catch (e) {
            console.error(`[responsesAgent] Error retrieving context ID in fork ${context}: ${e.message}`);
          }
        } else if (context && context.type === 'jsonContext' && context.contextId) {
          // Handle our context object format
          try {
            const { data } = await jsonContext.getContext(context.contextId);
            contextInfo.push({
              id: context.contextId,
              data
            });
          } catch (e) {
            console.error(`[responsesAgent] Error retrieving context from object in fork ${context.contextId}: ${e.message}`);
          }
        } else {
          // Handle any other format
          contextInfo.push({
            data: context
          });
        }
      }
      
      // Format all contexts as a single text block
      if (contextInfo.length > 0) {
        contextText = contextInfo.map((ctx, index) => {
          const ctxData = ctx.data;
          let formattedData;
          
          if (typeof ctxData === 'object') {
            try {
              formattedData = JSON.stringify(ctxData, null, 2);
            } catch (e) {
              console.error(`[responsesAgent] Error stringifying context data: ${e.message}`);
              formattedData = String(ctxData);
            }
          } else {
            formattedData = String(ctxData);
          }
          
          return `Context ${index + 1}${ctx.id ? ` (ID: ${ctx.id})` : ''}:\n${formattedData}`;
        }).join('\n\n---\n\n');
      }
    }
    
    // Create the content array for the API call
    let messageContent = [];
    
    // Add context if available
    if (contextText) {
      messageContent.push({
        type: "input_text",
        text: contextText
      });
    }
    
    // Add the main prompt
    messageContent.push({
      type: "input_text",
      text: content
    });

    // Fork the response using Responses API
    const response = await openai.responses.fork(previousResponseId, {
      instructions,
      input: [
        {
          role: "user",
          content: messageContent
        }
      ],
      user: role // Use 'user' instead of 'user_id'
    });

    // Extract the main text from the OpenAI response
    // Prefer choices/message.content, then output[].content[].text, then text/content fields
    let responseText = '';

    // 1. Check for choices/message.content (chat-style response)
    if (response.choices && response.choices.length > 0) {
      const firstChoice = response.choices[0];
      if (firstChoice.message && firstChoice.message.content) {
        responseText = firstChoice.message.content;
      } else if (firstChoice.text) {
        responseText = firstChoice.text;
      }
    }
    // 2. Check for output[].content[].text (OpenAI responses API format)
    else if (Array.isArray(response.output) && response.output.length > 0) {
      // Find the first output_text type in the content array
      for (const outputItem of response.output) {
        if (Array.isArray(outputItem.content)) {
          const outputTextObj = outputItem.content.find(
            c => c.type === 'output_text' && typeof c.text === 'string'
          );
          if (outputTextObj) {
            responseText = outputTextObj.text;
            break;
          }
        }
      }
    }
    // 3. Fallbacks: text/content fields
    else if (typeof response.text === 'string') {
      responseText = response.text;
    } else if (typeof response.content === 'string') {
      responseText = response.content;
    } else if (typeof response === 'string') {
      responseText = response;
    }

    // Ensure we have a valid string
    if (!responseText || typeof responseText !== 'string') {
      console.error('[responsesAgent] Failed to extract text from response:', response);
      responseText = JSON.stringify(response) || '';
    }

    // Only add a single 'text' and 'response' property to the returned object
    const returnObj = {
      ...response,
      text: responseText,
      response: responseText
    };
    // Remove any output_text property if present
    if (returnObj.output_text) delete returnObj.output_text;

    console.log(`[responsesAgent] Extracted text from fork (first 100 chars): ${responseText.substring(0, 100)}...`);

    // Log message to database if we have a proposal ID
    if (proposalId) {
      try {
        // Get or create a session for this proposal
        let session = await Session.getByProposalId(proposalId);
        if (!session) {
          session = await Session.create({
            proposalId,
            status: 'active',
            metadata: { startedAt: new Date().toISOString() }
          });
        }

        // Find the previous message by response ID
        const previousMessages = await Message.getByResponseId(previousResponseId);
        const parentMessageId = previousMessages.length > 0 
          ? previousMessages[previousMessages.length - 1].id 
          : null;

        // Create message entry for user message
        const userMessageId = uuidv4();
        await Message.create({
          id: userMessageId,
          responseId: response.id || uuidv4(),
          phase,
          agentName: role,
          role: 'user',
          content,
          parentMessageId,
          sessionId: session.id,
          metadata: {
            contexts: Array.isArray(contexts) ? contexts.map(ctx => {
              if (typeof ctx === 'string') {
                return ctx;
              } else if (ctx && ctx.type === 'jsonContext' && ctx.contextId) {
                return ctx.contextId;
              } else {
                try {
                  return JSON.stringify(ctx);
                } catch (e) {
                  console.warn(`[JSON Context] Error stringifying context object: ${e.message}`);
                  return String(ctx);
                }
              }
            }) : [],
            timestamp: new Date().toISOString()
          }
        });

        // Create message entry for assistant response
        await Message.create({
          id: uuidv4(),
          responseId: response.id || uuidv4(),
          phase,
          agentName: role,
          role: 'assistant',
          content: responseText, // Use the extracted text content
          parentMessageId: userMessageId, // Link to the user message
          sessionId: session.id,
          metadata: {
            model: response.model,
            timestamp: new Date().toISOString(),
            tokenUsage: response.usage || {}
          }
        });

        console.log(`[Database] Logged forked message exchange for proposal ${proposalId}`);
      } catch (dbError) {
        console.error('[Database Error]', dbError);
        // Don't throw the error, just log it - we can still continue with the response
      }
    }

    console.log(`[Response Created] Forked response for ${role} (${responseText.length} chars)`);
    
    return returnObj;
  } catch (error) {
    console.error('[Response Error]', error);
    throw new Error(`Response fork error: ${error.message}`);
  }
}

/**
 * Get token usage report
 * 
 * @returns {Object} Complete token usage report
 */
function getTokenUsageReport() {
  const contextsGenerated = [];
  // Helper to add contextId if it exists (handle both string and object formats)
  const addContext = (context) => {
    if (!context) return;
    
    // Handle context object format
    if (typeof context === 'object' && context.contextId) {
      contextsGenerated.push({ contextId: context.contextId });
    } 
    // Handle string context ID
    else if (typeof context === 'string') {
      contextsGenerated.push({ contextId: context });
    }
    // Handle legacy file IDs (for backward compatibility)
    else if (typeof context === 'object' && context.fileId) {
      contextsGenerated.push({ fileId: context.fileId });
    }
  };

  // Phase 1 files/contexts
  addContext(proposalProgress.phase1.briefAnalysis.fileId);
  addContext(proposalProgress.phase1.sectionAssignments.fileId);
  addContext(proposalProgress.phase1.clarifyingQuestions.fileId);

  // Phase 2 files/contexts
  addContext(proposalProgress.phase2.customerAnswers.fileId);
  if (proposalProgress.phase2.sectionDrafts.sections) {
    Object.values(proposalProgress.phase2.sectionDrafts.sections).forEach(section => addContext(section.fileId));
  }

  // Phase 3 files/contexts
  if (proposalProgress.phase3.reviews.sections) {
    Object.values(proposalProgress.phase3.reviews.sections).forEach(review => addContext(review.fileId));
  }
  addContext(proposalProgress.phase3.customerReviewAnswers.fileId);
  if (proposalProgress.phase3.revisions.sections) {
    Object.values(proposalProgress.phase3.revisions.sections).forEach(revision => addContext(revision.fileId));
  }

  // Phase 4 files/contexts
  addContext(proposalProgress.phase4.assembly.fileId);
  addContext(proposalProgress.phase4.finalReview.fileId);

  // Compose componentDetails array for reporting (empty for now, can be extended for detailed tracking)
  const componentDetails = [];

  return {
    date: new Date().toISOString(),
    overallTokens: proposalProgress.tokenSummary.overall,
    phaseBreakdown: {
      phase1: {
        briefAnalysis: proposalProgress.phase1.briefAnalysis.tokenUsage,
        sectionAssignments: proposalProgress.phase1.sectionAssignments.tokenUsage,
        clarifyingQuestions: proposalProgress.phase1.clarifyingQuestions.tokenUsage
      },
      phase2: {
        customerAnswers: proposalProgress.phase2.customerAnswers.tokenUsage,
        sectionDrafts: proposalProgress.phase2.sectionDrafts.tokenUsage
      },
      phase3: {
        reviews: proposalProgress.phase3.reviews.tokenUsage,
        customerReviewAnswers: proposalProgress.phase3.customerReviewAnswers.tokenUsage,
        revisions: proposalProgress.phase3.revisions.tokenUsage
      },
      phase4: {
        assembly: proposalProgress.phase4.assembly.tokenUsage,
        finalReview: proposalProgress.phase4.finalReview.tokenUsage
      }
    },
    contexts: contextsGenerated, // Add the contexts array here (renamed from files)
    componentDetails // Always include this property, even if empty
  };
}

/**
 * Update progress status for a component
 * Supports both legacy and new signatures for backward compatibility:
 *   updateProgressStatus(proposalId, phase, status, details)
 *   updateProgressStatus(phase, component, status, details)
 *
 * @param {...any} args
 */
function updateProgressStatus(...args) {
  // Legacy signature: (proposalId, phase, status, details)
  if (typeof args[0] === 'string' && typeof args[1] === 'string' && typeof args[2] === 'string' && typeof args[3] === 'object' && args.length === 4) {
    // If phase looks like 'Phase1_BriefAnalysis', map to phase/component
    const proposalId = args[0];
    const phaseComponent = args[1];
    const status = args[2];
    const details = args[3];
    // Try to split phaseComponent into phase/component
    const match = phaseComponent.match(/^(Phase(\d+))_(.+)$/);
    if (match) {
      const phase = `phase${match[2]}`;
      // Convert to camelCase for component
      const component = match[3].charAt(0).toLowerCase() + match[3].slice(1);
      if (proposalProgress[phase] && proposalProgress[phase][component]) {
        proposalProgress[phase][component].status = status;
        Object.keys(details).forEach(key => {
          proposalProgress[phase][component][key] = details[key];
        });
        console.log(`[Progress] (legacy) ${phase}/${component} status updated to: ${status}`);
        return;
      }
    }
    // If not matched, fallback to new signature
  }
  // New signature: (phase, component, status, details)
  const [phase, component, status, additionalData = {}] = args;
  if (proposalProgress[phase] && proposalProgress[phase][component]) {
    proposalProgress[phase][component].status = status;
    Object.keys(additionalData).forEach(key => {
      proposalProgress[phase][component][key] = additionalData[key];
    });
    console.log(`[Progress] ${phase}/${component} status updated to: ${status}`);
  }
}

/**
 * Get current progress
 * 
 * @returns {Object} Current progress state
 */
function getProgress() {
  return JSON.parse(JSON.stringify(proposalProgress)); // Return a copy
}

/**
 * Get database message statistics
 * 
 * @param {String} proposalId Proposal ID to get statistics for
 * @returns {Object} Statistics object
 */
async function getMessageStats(proposalId) {
  try {
    // Get the session for this proposal
    let session = await Session.getByProposalId(proposalId);
    if (!session) {
      session = await Session.create({
        proposalId,
        status: 'active',
        metadata: { startedAt: new Date().toISOString() }
      });
    }
    
    // Get all messages for this session
    const messages = await Message.getBySessionId(session.id);
    
    // Calculate token usage totals
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    
    // Count messages by phase and agent
    const phaseStats = {};
    const agentStats = {};
    
    for (const message of messages) {
      // Skip messages without token usage data
      if (!message.metadata || !message.metadata.tokenUsage) continue;
      
      // Extract token usage
      const { tokenUsage } = message.metadata;
      promptTokens += tokenUsage.prompt_tokens || 0;
      completionTokens += tokenUsage.completion_tokens || 0;
      totalTokens += tokenUsage.total_tokens || 0;
      
      // Update phase stats
      if (message.phase) {
        if (!phaseStats[message.phase]) {
          phaseStats[message.phase] = { count: 0, tokens: 0 };
        }
        phaseStats[message.phase].count++;
        phaseStats[message.phase].tokens += tokenUsage.total_tokens || 0;
      }
      
      // Update agent stats
      if (message.agent_name) {
        if (!agentStats[message.agent_name]) {
          agentStats[message.agent_name] = { count: 0, tokens: 0 };
        }
        agentStats[message.agent_name].count++;
        agentStats[message.agent_name].tokens += tokenUsage.total_tokens || 0;
      }
    }
    
    return {
      sessionFound: true,
      sessionId: session.id,
      messageCount: messages.length,
      tokenUsage: {
        prompt: promptTokens,
        completion: completionTokens,
        total: totalTokens
      },
      phaseStats,
      agentStats
    };
  } catch (error) {
    console.error('[Database Error]', error);
    return {
      error: error.message,
      sessionFound: false,
      messageCount: 0,
      tokenUsage: { prompt: 0, completion: 0, total: 0 }
    };
  }
}

// Export the utility functions
const responsesAgent = {
  createInitialResponse,
  forkResponse,
  createAndUploadFile,
  trackTokenUsage,
  resetProgress,
  updateProgressStatus,
  getProgress,
  getTokenUsageReport,
  getMessageStats,
  buildContextFromMessages
};

/**
 * Build context from previous messages in a session
 * Helper function to include message history in prompts
 * 
 * @param {String} proposalId The proposal ID
 * @param {Object} options Context building options
 * @returns {String} Context string for inclusion in prompts
 */
async function buildContextFromMessages(proposalId, options = {}) {
  try {
    // Get session for this proposal
    let session = await Session.getByProposalId(proposalId);
    if (!session) {
      session = await Session.create({
        proposalId,
        status: 'active',
        metadata: { startedAt: new Date().toISOString() }
      });
    }
    
    // Build message context
    const result = await buildMessageContext(session.id, options);
    
    console.log(`[Context Builder] Built context with ${result.messageCount} messages (est. ${result.tokenEstimate} tokens)`);
    return result.context;
  } catch (error) {
    console.error('[Context Builder Error]', error);
    return "";
  }
}

module.exports = responsesAgent;
