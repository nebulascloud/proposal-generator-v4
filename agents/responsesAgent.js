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

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
 * Create and upload a file to OpenAI
 *
 * @param {String|Object} content - Content to save in the file
 * @param {String} filename - Name to give the file
 * @returns {String} File ID for OpenAI
 */
async function createAndUploadFile(content, filename) {
  try {
    // Convert objects to string if needed
    const contentStr = typeof content === 'object' ? JSON.stringify(content, null, 2) : content;
    
    // Create full file path
    const filePath = path.join(DATA_DIR, filename);
    
    // Write file locally
    fs.writeFileSync(filePath, contentStr);
    console.log(`[File Created] ${filename}`);
    
    // Upload to OpenAI
    const file = await openai.files.create({
      file: fs.createReadStream(filePath),
      purpose: "responses"
    });
    
    console.log(`[File Uploaded] ${filename} with ID: ${file.id}`);
    return file.id;
  } catch (error) {
    console.error('[File Error]', error);
    throw new Error(`File creation error: ${error.message}`);
  }
}

/**
 * Create an initial response with the OpenAI Responses API
 * 
 * @param {String} content - The user message content
 * @param {Array} files - Array of file IDs to attach
 * @param {String} role - The role from assistantDefinitions (e.g., 'sp_Account_Manager')
 * @returns {Object} The OpenAI response
 */
async function createInitialResponse(content, files = [], role) {
  try {
    // Get instructions for the role from assistantDefinitions
    const instructions = assistantDefinitions[role] || '';
    
    // Create response
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      instructions,
      max_tokens: 4096,
      response_format: { type: "text" },
      file_ids: files,
      user_id: role, // Use role as user ID for tracking
      messages: [{ role: "user", content }]
    });
    
    console.log(`[Response Created] Initial response for ${role}`);
    return response;
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
 * @param {Array} files - Array of file IDs to attach
 * @param {String} role - The role from assistantDefinitions
 * @returns {Object} The forked response
 */
async function forkResponse(previousResponseId, content, files = [], role) {
  try {
    // Get instructions for the role
    const instructions = assistantDefinitions[role] || '';
    
    // Fork the response
    const response = await openai.responses.fork(previousResponseId, {
      messages: [{ role: "user", content }],
      instructions,
      file_ids: files,
      user_id: role // Use role as user ID for tracking
    });
    
    console.log(`[Response Forked] Created fork from ${previousResponseId} for ${role}`);
    return response;
  } catch (error) {
    console.error('[Fork Error]', error);
    throw new Error(`Response forking error: ${error.message}`);
  }
}

/**
 * Get token usage report
 * 
 * @returns {Object} Complete token usage report
 */
function getTokenUsageReport() {
  return {
    date: new Date().toISOString(),
    overallTokens: proposalProgress.tokenSummary.overall,
    phaseBreakdown: {
      phase1: proposalProgress.tokenSummary.phase1,
      phase2: proposalProgress.tokenSummary.phase2,
      phase3: proposalProgress.tokenSummary.phase3,
      phase4: proposalProgress.tokenSummary.phase4
    },
    componentDetails: {
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
    }
  };
}

/**
 * Update progress status for a component
 * 
 * @param {String} phase - The phase name (e.g., 'phase1')
 * @param {String} component - The component name (e.g., 'briefAnalysis')
 * @param {String} status - New status value
 * @param {Object} additionalData - Additional data to update
 */
function updateProgressStatus(phase, component, status, additionalData = {}) {
  if (proposalProgress[phase] && proposalProgress[phase][component]) {
    proposalProgress[phase][component].status = status;
    
    // Update additional data (e.g., fileId, sections, etc.)
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

// Export the utility functions
const responsesAgent = {
  createInitialResponse,
  forkResponse,
  createAndUploadFile,
  trackTokenUsage,
  resetProgress,
  updateProgressStatus,
  getProgress,
  getTokenUsageReport
};

module.exports = responsesAgent;
