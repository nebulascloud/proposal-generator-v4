/**
 * Flow Agent for Proposal Generator using Responses API
 * 
 * This module orchestrates the end-to-end flow of the proposal generation process
 * using OpenAI's Responses API for improved parallelism and context management.
 */

require('dotenv').config();
const { defaultTemplate } = require('../templates/defaultTemplate');
const { assignSections } = require('./orchestratorAgent');
const { assistantDefinitions } = require('./assistantDefinitions');
const responsesAgent = require('./responsesAgent');
const fs = require('fs');
const path = require('path');

// Initialize tracking and state
let currentProposalId = null;

/**
 * Helper to log details about AI response for debugging
 * @param {Object} response - The response from LLM
 * @param {String} operation - Name of the operation
 */
function logResponseDetails(response, operation) {
  console.log(`[flowAgent] ${operation} - Response ID: ${response.id || 'N/A'}`);
  console.log(`[flowAgent] ${operation} - Model: ${response.model || 'N/A'}`);
  
  let textSample = 'undefined';
  if (response.text) {
    textSample = typeof response.text === 'string' 
      ? `${response.text.substring(0, 100)}...` 
      : `[Non-string: ${typeof response.text}]`;
      
    console.log(`[flowAgent] ${operation} - Text sample: ${textSample}`);
    console.log(`[flowAgent] ${operation} - Text length: ${typeof response.text === 'string' ? response.text.length : 0}`);
  } else {
    console.log(`[flowAgent] ${operation} - Text property missing`);
  }
}

/**
 * Helper function to convert operation names to standardized phase names
 * This ensures consistent phase labeling across the application
 * 
 * @param {String} operation - The operation label used in safeCreateResponse
 * @returns {String} The standardized phase name for database logging
 */
function convertOperationToPhase(operation) {
  const operationMap = {
    'Brief Analysis': 'Phase1_BriefAnalysis',
    'Section Assignment': 'Phase1_SectionAssignment',
    'Section Assignments': 'Phase1_SectionAssignment',
    'Clarifying Questions': 'Phase1_ClarifyingQuestions',
    'Question Organization': 'Phase1_OrganizeQuestions',
    'Customer Q&A': 'Phase2_CustomerAnswers',
    'Section Drafting': 'Phase2_SectionDrafts',
    'Section Review': 'Phase3_Reviews',
    'Customer Review': 'Phase3_CustomerReviewAnswers',
    'Section Revision': 'Phase3_Revisions',
    'Final Approval': 'Phase4_FinalApproval',
    'Proposal Assembly': 'Phase4_Assembly'
  };
  
  // Try to match the operation with one of our known phases
  const matchedPhase = operationMap[operation];
  if (matchedPhase) {
    return matchedPhase;
  }
  
  // For operations not in our map, try to derive a phase name
  if (operation.toLowerCase().includes('question')) {
    return 'Phase1_ClarifyingQuestions';
  } else if (operation.toLowerCase().includes('draft')) {
    return 'Phase2_SectionDrafts';
  } else if (operation.toLowerCase().includes('review')) {
    return 'Phase3_Reviews';
  } else if (operation.toLowerCase().includes('revision')) {
    return 'Phase3_Revisions';
  } else if (operation.toLowerCase().includes('final') || operation.toLowerCase().includes('assembly')) {
    return 'Phase4_Assembly';
  }
  
  // Default to null if we can't determine the phase
  return null;
}

/**
 * Helper to safely call responseAgent.createInitialResponse with proper error handling
 * @param {String} content - Content to send
 * @param {Array} contexts - Context objects/IDs (will be sanitized)
 * @param {String} role - Agent role
 * @param {String} operation - Label for logging
 * @returns {Object} The response object
 */
async function safeCreateResponse(content, contexts, role, operation = 'API Call', phase = null) {
  try {
    // Sanitize contexts to ensure it's always an array
    const sanitizedContexts = contexts ? 
      (Array.isArray(contexts) ? contexts.filter(c => c !== null && c !== undefined) : []) : [];
    
    // Determine the phase based on the operation if not explicitly provided
    const currentPhase = phase || convertOperationToPhase(operation);
    
    console.log(`[flowAgent] ${operation} - Calling createInitialResponse with ${sanitizedContexts.length} contexts, phase: ${currentPhase || 'none'}`);
    
    const response = await responsesAgent.createInitialResponse(
      content,
      sanitizedContexts,
      role,
      currentPhase, // Use the determined phase
      currentProposalId // always include proposal ID
    );
    
    // Log response details for debugging
    logResponseDetails(response, operation);
    
    return response;
  } catch (error) {
    console.error(`[flowAgent] ${operation} Error: ${error.message}`);
    throw new Error(`${operation} failed: ${error.message}`);
  }
}

/**
 * Parse JSON safely from response text
 * 
 * @param {String|Object} raw - Raw text or object that may contain JSON
 * @param {String} label - Label for error reporting
 * @returns {Object} Parsed JSON object
 */
function parseJson(raw, label) {
  console.log(`[flowAgent] Attempting to parse JSON for ${label}`);
  
  // If it's an undefined or null value
  if (raw === undefined || raw === null) {
    console.error(`[flowAgent] Empty response for ${label}: ${raw}`);
    throw new Error(`No JSON response for ${label}`);
  }

  // 1. If raw is already a string, try to parse it directly
  if (typeof raw === 'string') {
    console.log(`[flowAgent] Raw input for ${label} is a string of length ${raw.length}, attempting to parse directly.`);
    console.log(`[flowAgent] First 200 characters: ${raw.substring(0, 200)}`);
    try {
      return extractJsonFromText(raw, label);
    } catch (err) {
      console.error(`[flowAgent] Failed to parse raw string for ${label}: ${err.message}`);
      
      // For empty or very short inputs, return a default object
      if (!raw || raw.length < 10) {
        console.warn(`[flowAgent] Response text too short, returning default object`);
        return { warning: "Empty or invalid response", _source: raw };
      }
      throw err;
    }
  }
  
  // 2. If it's an object, check for .text or .response properties (from responsesAgent)
  if (typeof raw === 'object') {
    // Log available properties for debugging
    console.log(`[flowAgent] Object properties for ${label}: ${Object.keys(raw).join(', ')}`);
    
    if (raw.text && typeof raw.text === 'string') {
      console.log(`[flowAgent] Found .text property for ${label}, attempting to parse.`);
      try {
        return extractJsonFromText(raw.text, label);
      } catch (err) {
        console.warn(`[flowAgent] Could not extract JSON from .text property for ${label}: ${err.message}`);
      }
    }
    if (raw.response && typeof raw.response === 'string') {
      console.log(`[flowAgent] Found .response property for ${label}, attempting to parse.`);
      try {
        return extractJsonFromText(raw.response, label);
      } catch (err) {
        console.warn(`[flowAgent] Could not extract JSON from .response property for ${label}: ${err.message}`);
      }
    }
    
    if (raw.choices && Array.isArray(raw.choices) && raw.choices.length > 0) {
      console.log(`[flowAgent] Found choices array, attempting to parse content`);
      const firstChoice = raw.choices[0];
      if (firstChoice.message && firstChoice.message.content) {
        try {
          return extractJsonFromText(firstChoice.message.content, label);
        } catch (err) {
          console.warn(`[flowAgent] Could not extract JSON from choices content: ${err.message}`);
        }
      }
    }

    // Check for output property in the format returned by older Responses API versions or other structures
    if (raw.output && Array.isArray(raw.output) && raw.output.length > 0) {
      for (const outputItem of raw.output) {
        if (outputItem.content && Array.isArray(outputItem.content)) {
          for (const contentItem of outputItem.content) {
            if (contentItem.text && typeof contentItem.text === 'string') {
              console.log(`[flowAgent] Found text content in output, attempting to parse`);
              try {
                return extractJsonFromText(contentItem.text, label);
              } catch (err) {
                console.log(`[flowAgent] Could not extract JSON from output text: ${err.message}`);
              }
            }
          }
        }
      }
    }
    
    if (raw.output_text && typeof raw.output_text === 'string') {
      console.log(`[flowAgent] Found output_text property, attempting to parse`);
      try {
        return extractJsonFromText(raw.output_text, label);
      } catch (err) {
        console.log(`[flowAgent] Could not extract JSON from output_text: ${err.message}`);
      }
    }
    
    // If all else fails, but the object appears to be JSON-compatible, return it
    if (!('then' in raw)) { // Avoid returning promise objects
      console.log(`[flowAgent] Using raw object as JSON for ${label}`);
      return raw;
    }
  }

  console.error(`[flowAgent] Unexpected type for ${label}: ${typeof raw}`);
  throw new Error(`Unexpected response type for ${label}: ${typeof raw}`);
}

// Helper function to extract JSON from text (markdown, code blocks, etc.)
function extractJsonFromText(text, label) {
  if (!text) {
    throw new Error(`Empty text for ${label}`);
  }
  
  const trimmed = text.trim();
  if (trimmed === 'undefined' || trimmed === 'null') {
    console.error(`[flowAgent] Undefined or null text for ${label}`);
    throw new Error(`Invalid text for ${label}: ${trimmed}`);
  }
  
  // Try direct parsing first
  try {
    return JSON.parse(trimmed);
  } catch (directParseError) {
    console.log(`[flowAgent] Direct JSON parse failed, attempting to extract JSON from text: ${directParseError.message}`);
  }
  
  // Search for code blocks first
  let jsonStr;
  
  // Look for JSON code blocks
  const jsonCodeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
  const jsonCodeBlockMatch = trimmed.match(jsonCodeBlockRegex);
  if (jsonCodeBlockMatch && jsonCodeBlockMatch[1]) {
    jsonStr = jsonCodeBlockMatch[1].trim();
    console.log(`[flowAgent] Extracted JSON from code block for ${label}`);
  } else {
    // If no code blocks, try to find JSON object or array
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    const firstArray = trimmed.indexOf('[');
    const lastArray = trimmed.lastIndexOf(']');
    
    if (first >= 0 && last > first) {
      jsonStr = trimmed.substring(first, last + 1);
      console.log(`[flowAgent] Extracted JSON object for ${label}`);
    } else if (firstArray >= 0 && lastArray > firstArray) {
      jsonStr = trimmed.substring(firstArray, lastArray + 1);
      console.log(`[flowAgent] Extracted JSON array for ${label}`);
    } else {
      console.error(`[flowAgent] JSON structure not found in ${label} response`);
      console.log(`[flowAgent] Response content (first 200 chars): ${trimmed.substring(0, 200)}...`);
      
      // For non-JSON content, create a text wrapper object
      return {
        text: trimmed,
        _warning: "No JSON structure found, returning plain text"
      };
    }
  }
  
  // Try to parse the extracted string
  try {
    const parsed = JSON.parse(jsonStr);
    console.log(`[flowAgent] Successfully parsed JSON for ${label}`);
    return parsed;
  } catch (parseError) {
    console.error(`[flowAgent] Failed to parse extracted JSON for ${label}: ${parseError.message}`);
    console.log(`[flowAgent] Extracted JSON string (first 200 chars): ${jsonStr.substring(0, 200)}...`);
    
    // Try to fix common JSON issues and retry
    try {
      // Replace single quotes with double quotes
      let fixedString = jsonStr.replace(/'/g, '"');
      
      // Try to fix trailing commas
      fixedString = fixedString
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']');
        
      // Fix missing quotes around property names
      fixedString = fixedString.replace(/(\{|\,)\s*(\w+)\s*\:/g, '$1"$2":');
      
      const parsed = JSON.parse(fixedString);
      console.log(`[flowAgent] Successfully parsed JSON after fixing common issues for ${label}`);
      return parsed;
    } catch (fixedParseError) {
      console.error(`[flowAgent] All JSON parsing attempts failed for ${label}`);
      
      // Last resort: return a wrapper object with the raw text
      return {
        text: jsonStr,
        parseError: parseError.message,
        _warning: "Could not parse as JSON"
      };
    }
  }
}

/**
 * Update the status of the flow job if jobId is provided
 * 
 * @param {String} proposalId - The proposal ID
 * @param {String} phase - The current phase
 * @param {String} status - The status of the phase
 * @param {Object} details - Additional details
 */
function updateFlowJobStatus(proposalId, phase, status, details = {}) {
  if (!global.flowJobs || !proposalId) return;
  
  const jobId = Object.keys(global.flowJobs).find(id => 
    global.flowJobs[id].proposalId === proposalId);
  
  if (jobId) {
    global.flowJobs[jobId].progress = { 
      ...global.flowJobs[jobId].progress,
      status: status,
      currentPhase: phase,
      details: details,
      timestamp: new Date().toISOString()
    };
    
    console.log(`[flowAgent] Updated job ${jobId} status: ${phase} - ${status}`);
  }
}

/**
 * Mock customer agent for testing environments
 * 
 * @param {String} question - The question to ask
 * @param {Object} brief - The project brief
 * @returns {String} Mock customer response
 */
function mockCustomerAnswer(question, brief) {
  return `Mock answer to "${question}" for ${brief.client_name}`;
}

/**
 * Run the complete proposal generation workflow
 * 
 * @param {Object} options - Configuration options
 * @param {Object} options.brief - The customer brief
 * @param {String} options.customerAnswers - Initial customer answers (optional)
 * @param {String} options.customerReviewAnswers - Initial customer review answers (optional)
 * @returns {Object} The complete proposal output
 */
async function runFullFlow({ brief, customerAnswers: initialCustomerAnswers, customerReviewAnswers: initialCustomerReviewAnswers, jobId }) {
  try {
    responsesAgent.resetProgress();
    
    currentProposalId = `proposal-${Date.now()}`;
    console.log(`[flowAgent] Starting new proposal generation (ID: ${currentProposalId})`);
    console.log(`[flowAgent] Received initial customerAnswers: ${initialCustomerAnswers}`);
    console.log(`[flowAgent] Received initial customerReviewAnswers: ${initialCustomerReviewAnswers}`);

    if (jobId && global.flowJobs && global.flowJobs[jobId]) {
      global.flowJobs[jobId].proposalId = currentProposalId;
      console.log(`[flowAgent] Associated proposal ${currentProposalId} with job ${jobId}`);
    }

    let briefFileId = null;

    updateFlowJobStatus(currentProposalId, 'Setup', 'initializing', {
      message: 'Starting production flow',
      timestamp: new Date().toISOString()
    });
    
    // Make sure sections is always defined and is an array
    let sections = Array.isArray(defaultTemplate) 
      ? [...defaultTemplate]
      : Object.keys(defaultTemplate || {});
      
    // Safety check to ensure sections is always an array
    if (!Array.isArray(sections)) {
      console.error(`[flowAgent] Sections is not an array (${typeof sections}), initializing empty array`);
      sections = [];
    }
    
    if (sections.length === 0) {
      console.warn('[flowAgent] No sections found in template, adding default section');
      sections = ['Overview'];
    }
    
    console.log(`[flowAgent] Working with ${sections.length} sections: ${sections.join(', ')}`);
    
    console.log("[flowAgent] Phase 1.1: Starting brief analysis");
    updateFlowJobStatus(currentProposalId, "Phase 1", "Brief Analysis", { step: "Starting brief analysis" });
    
    briefFileId = await responsesAgent.createAndUploadFile(
      JSON.stringify(brief, null, 2),
      `${currentProposalId}_brief.json`
    );
    if (!briefFileId) {
      throw new Error("Failed to upload brief file or fileId missing.");
    }
    
    const analysisPrompt = "Analyze the provided customer brief thoroughly. Consider all aspects including business objectives, technical requirements, commercial aspects, and potential challenges. Provide a comprehensive assessment that will guide the proposal development process.";
    
    const analysisResponse = await safeCreateResponse(
      analysisPrompt,
      [briefFileId].filter(id => id),
      "BriefAnalysis",
      "Brief Analysis"
    );
    const analysis = analysisResponse.response || "Unable to generate analysis";
    
    responsesAgent.trackTokenUsage(analysisResponse, currentProposalId, "Phase1_BriefAnalysis");
    
    const analysisFileId = await responsesAgent.createAndUploadFile(
      analysis,
      `${currentProposalId}_analysis.md`
    );
    if (!analysisFileId) {
      throw new Error("Failed to upload analysis file or fileId missing.");
    }

    responsesAgent.updateProgressStatus(currentProposalId, "Phase1_BriefAnalysis", "completed", { fileId: analysisFileId });

    updateFlowJobStatus(currentProposalId, "Phase1_BriefAnalysis", "completed", {
      analysisFileId: analysisFileId
    });
    
    console.log("[flowAgent] Brief analysis completed");
    updateFlowJobStatus(currentProposalId, "Phase 1", "Brief Analysis Completed", { analysisFileId: analysisFileId });
    
    console.log("[flowAgent] Phase 1.2: Starting section assignments");
    updateFlowJobStatus(currentProposalId, "Phase 1", "Section Assignments", { step: "Starting section assignments" });
    
    const availableRoles = Object.keys(assistantDefinitions).filter(role => role.startsWith('sp_'));
    
    const assignPrompt = `Based on the brief and analysis, assign these sections: ${sections.join(', ')}.
  
IMPORTANT: You must ONLY use these exact roles in your assignments: ${availableRoles.join(', ')}

Return a JSON object mapping each section name to exactly one of these role names.`;
    
    const assignResponse = await safeCreateResponse(
      assignPrompt,
      [briefFileId, analysisFileId].filter(id => id),
      "sp_Collaboration_Orchestrator",
      "Section Assignments"
    );
    
    console.log(`[flowAgent] [DEBUG] Section Assignments Response Type: ${typeof assignResponse}`);
    
    try {
        const jsonString = JSON.stringify(assignResponse);
        if (typeof jsonString === 'string') {
            console.log(`[flowAgent] [DEBUG] Section Assignments Full Response: ${jsonString.substring(0, 1000)}`);
        } else {
            console.log('[flowAgent] [DEBUG] Section Assignments Full Response: Unable to stringify response');
        }
    } catch (e) {
        console.log(`[flowAgent] [DEBUG] Could not stringify assignResponse: ${e.message}`);
    }
    
    if (assignResponse.text !== undefined) {
        const textType = typeof assignResponse.text;
        console.log(`[flowAgent] [DEBUG] Section Assignments Text Type: ${textType}`);
        if (textType === 'string') {
            try {
                console.log(`[flowAgent] [DEBUG] Section Assignments Text: ${assignResponse.text.substring(0, 1000)}`);
            } catch (e) {
                console.log(`[flowAgent] [DEBUG] Error accessing text.substring: ${e.message}`);
                console.log(`[flowAgent] [DEBUG] Text value:`, assignResponse.text);
            }
        } else {
            console.log(`[flowAgent] [DEBUG] Section Assignments Text is not a string:`, assignResponse.text);
        }
    } else {
        console.log(`[flowAgent] [DEBUG] Section Assignments Text: Property undefined`);
    }
    
    if (assignResponse.response !== undefined) {
        const respType = typeof assignResponse.response;
        console.log(`[flowAgent] [DEBUG] Section Assignments Response Type: ${respType}`);
        if (respType === 'string') {
            try {
                console.log(`[flowAgent] [DEBUG] Section Assignments Response: ${assignResponse.response.substring(0, 1000)}`);
            } catch (e) {
                console.log(`[flowAgent] [DEBUG] Error accessing response.substring: ${e.message}`);
                console.log(`[flowAgent] [DEBUG] Response value:`, assignResponse.response);
            }
        } else {
            console.log(`[flowAgent] [DEBUG] Section Assignments Response is not a string:`, assignResponse.response);
        }
    } else {
        console.log(`[flowAgent] [DEBUG] Section Assignments Response: Property undefined`);
    }
    
    let responseText;
    let assignments;
    
    try {
      if (assignResponse.text && typeof assignResponse.text === 'string') {
        console.log(`[flowAgent] Trying to parse text property (string)`);
        responseText = assignResponse.text;
        assignments = parseJson(responseText, "section assignments (text)");
      } 
      else if (assignResponse.response && typeof assignResponse.response === 'string') {
        console.log(`[flowAgent] Trying to parse response property (string)`);
        responseText = assignResponse.response;
        assignments = parseJson(responseText, "section assignments (response)");
      } 
      else {
        console.log(`[flowAgent] No valid string property found, trying whole response object`);
        assignments = parseJson(assignResponse, "section assignments (full object)");
      }
    } catch (error) {
      console.error(`[flowAgent] Error parsing section assignments: ${error.message}`);
      throw new Error(`Failed to parse section assignments: ${error.message}`);
    }
    
    responsesAgent.trackTokenUsage(assignResponse, currentProposalId, "Phase1_SectionAssignments");
    
    const assignmentsFileId = await responsesAgent.createAndUploadFile(
      JSON.stringify(assignments, null, 2),
      `${currentProposalId}_assignments.json`
    );
    if (!assignmentsFileId) {
      throw new Error("Failed to upload assignments file or fileId missing.");
    }
    
    updateFlowJobStatus(currentProposalId, "Phase1_SectionAssignments", "completed", {
      assignmentsFileId: assignmentsFileId
    });
    
    console.log("[flowAgent] Section assignments completed");
    updateFlowJobStatus(currentProposalId, "Phase 1", "Section Assignments Completed", { assignmentsFileId: assignmentsFileId });
    
    console.log("[flowAgent] Phase 1.3: Generating clarifying questions");
    updateFlowJobStatus(currentProposalId, "Phase 1", "Generating Questions", { step: "Generating specialist questions" });
    
    const specialistRoles = Object.keys(assistantDefinitions).filter(role => 
      role.startsWith('sp_') && !role.includes('Collaboration_Orchestrator')
    );
    
    console.log(`[flowAgent] Identified ${specialistRoles.length} specialist roles for question generation`);
    
    updateFlowJobStatus(currentProposalId, "Phase1_ClarifyingQuestions", "in-progress", {
      specialists: specialistRoles.reduce((acc, role) => {
        acc[role] = { status: "pending", questions: [] };
        return acc;
      }, {})
    });
    
    const questionPromises = [];
    const specialistQuestions = {};
    
    for (const role of specialistRoles) {
      const questionPrompt = `As a ${role.replace('sp_', '')}, review the customer brief and generate 3-5 important strategic clarifying questions that would help you better understand the customer's needs and provide an expert proposal. 
    
Your questions should:
- Be relevant to your specific expertise and role
- Focus on understanding business needs, constraints, and priorities
- Cover different aspects of the project that need clarification
- NOT ask how to write or structure the proposal
- NOT ask section-specific questions
- Demonstrate your expertise in your domain

Return your questions as a JSON array in this format:
[
  {
    "question": "Your first question text here",
    "rationale": "Brief explanation of why this question is important from your role's perspective",
    "category": "General topic/category for this question (e.g., 'Technical Requirements', 'Timeline', 'Business Objectives')"
  },
  ...more questions...
]`;
      
      const questionPromise = (async () => {
        try {
          console.log(`[flowAgent] Requesting questions from ${role}`);
          
          const response = await safeCreateResponse(
            questionPrompt,
            [briefFileId, analysisFileId].filter(id => id),
            role,
            `Questions from ${role}`
          );
          
          responsesAgent.trackTokenUsage(response, currentProposalId, `Phase1_ClarifyingQuestions_${role}`);
          
          try {
            // Try using the parseJson helper first for robust parsing
            let parsedQuestions;
            
            try {
              // Use our more robust parseJson helper
              parsedQuestions = parseJson(response, "questions from " + role);
              console.log(`[flowAgent] Successfully parsed questions JSON for ${role} with parseJson helper, found ${Array.isArray(parsedQuestions) ? parsedQuestions.length : 'non-array'} result`);
            } catch (parseError) {
              // Fall back to manual string extraction
              console.log(`[flowAgent] parseJson helper failed for ${role}, trying manual extraction: ${parseError.message}`);
              const responseStr = response.response ? response.response.trim() : 
                                  response.text ? response.text.trim() : 
                                  typeof response === 'string' ? response.trim() : '';
                                  
              const jsonStartIdx = responseStr.indexOf('[');
              const jsonEndIdx = responseStr.lastIndexOf(']') + 1;
              
              if (jsonStartIdx >= 0 && jsonEndIdx > jsonStartIdx) {
                const jsonStr = responseStr.substring(jsonStartIdx, jsonEndIdx);
                console.log(`[flowAgent] Extracted JSON string for ${role}: ${jsonStr.substring(0, 100)}...`);
                parsedQuestions = JSON.parse(jsonStr);
              } else {
                console.log(`[flowAgent] Could not find JSON array markers in response for ${role}, text sample: ${responseStr.substring(0, 100)}...`);
                throw new Error("Could not find JSON array in response");
              }
            }
            
            // Ensure we have a valid array
            if (!Array.isArray(parsedQuestions)) {
              // If we got an object with a questions property that's an array, use that
              if (parsedQuestions && parsedQuestions.questions && Array.isArray(parsedQuestions.questions)) {
                parsedQuestions = parsedQuestions.questions;
              } else {
                throw new Error("Response did not contain a valid questions array");
              }
            }
            
            // Add role to each question for tracking
            parsedQuestions.forEach(q => {
              q.role = role;
            });
            
            specialistQuestions[role] = parsedQuestions;
            
            updateFlowJobStatus(currentProposalId, "Phase1_ClarifyingQuestions", "in-progress", {
              specialists: {
                [role]: { status: "completed", questions: parsedQuestions }
              }
            });
            
            console.log(`[flowAgent] Added ${parsedQuestions.length} questions from ${role}`);
          } catch (e) {
            console.error(`[flowAgent] Error parsing questions from ${role}:`, e);
            updateFlowJobStatus(currentProposalId, "Phase1_ClarifyingQuestions", "in-progress", {
                specialists: { [role]: { status: "error", error: e.message } }
            });
          }
        } catch (error) {
          console.error(`[flowAgent] Error getting questions from ${role}:`, error);
          updateFlowJobStatus(currentProposalId, "Phase1_ClarifyingQuestions", "in-progress", {
              specialists: { [role]: { status: "error", error: error.message } }
          });
        }
      })();
      
      questionPromises.push(questionPromise);
    }
    
    await Promise.all(questionPromises);
    
    // Log the specialists who contributed questions
    console.log(`[flowAgent] Specialists who provided questions: ${Object.keys(specialistQuestions).join(', ')}`);
    
    // Log any specialists who didn't provide questions
    const missingSpecialists = specialistRoles.filter(role => !specialistQuestions[role]);
    if (missingSpecialists.length > 0) {
      console.warn(`[flowAgent] WARNING: No questions collected from these specialists: ${missingSpecialists.join(', ')}`);
    }
    
    const allQuestions = [];
    
    // Enhanced debugging for question collection
    console.log(`[flowAgent] specialistQuestions object keys: ${Object.keys(specialistQuestions).join(', ')}`);
    
    Object.entries(specialistQuestions).forEach(([role, questions]) => {
      console.log(`[flowAgent] Processing questions from ${role}: ${Array.isArray(questions) ? questions.length : 'not an array'} questions found`);
      if (Array.isArray(questions)) {
        // Debug log specific questions
        questions.forEach((q, i) => {
          console.log(`[flowAgent] Question ${i+1} from ${role}: "${q.question.substring(0, 50)}..."`);
        });
        allQuestions.push(...questions);
      } else {
        console.log(`[flowAgent] Warning: Questions from ${role} is not an array: ${typeof questions}`);
      }
    });
    
    console.log(`[flowAgent] Collected ${allQuestions.length} questions from all specialists`);
    
    // Ensure we always have some questions to organize
    if (allQuestions.length === 0) {
      console.warn(`[flowAgent] No questions were collected from specialists, adding default questions`);
      // Add default questions to ensure the process can continue
      allQuestions.push(
        {
          question: "Can you provide more details about your current data infrastructure and the specific challenges you're facing?",
          rationale: "Understanding the current state helps us tailor the solution",
          category: "Technical Requirements",
          role: "sp_Account_Manager"
        },
        {
          question: "What are your most important success criteria for this project?",
          rationale: "Helps prioritize solution components",
          category: "Business Objectives",
          role: "sp_Project_Manager"
        },
        {
          question: "What is your expected timeline for implementation?",
          rationale: "Critical for resource planning and phased approach",
          category: "Timeline",
          role: "sp_Delivery_Manager"
        }
      );
      console.log(`[flowAgent] Added ${allQuestions.length} default questions to ensure process continuity`);
    }
    
    const dedupePrompt = `I've collected clarifying questions from various specialists regarding the customer brief. 
Please review these questions, remove duplicates or very similar questions, and organize them into logical groups or themes.

Format the final questions in a clear, organized manner that would be easy for the customer to respond to.

Here are all the questions (${allQuestions.length} total from ${Object.keys(specialistQuestions).length} specialists):
${JSON.stringify(allQuestions, null, 2)}

Return the organized questions as a JSON object with the following structure:
{
  "organizedQuestions": [
    {
      "theme": "Theme/Category Name",
      "questions": [
        {
          "question": "The question text",
          "source": "Original role that suggested this question",
          "id": "q1" // Assign a simple ID to each question
        },
        ...more questions in this theme...
      ]
    },
    ...more themes...
  ]
}`;

    const organizedQuestionsResponse = await safeCreateResponse(
      dedupePrompt,
      [briefFileId, analysisFileId].filter(id => id),
      "OrganizeQuestions",
      "Question Organization",
      "Phase1_OrganizeQuestions" // Explicitly pass the phase
    );
    
    // Log details about the response for debugging
    logResponseDetails(organizedQuestionsResponse, "Question Organization");
    
    responsesAgent.trackTokenUsage(organizedQuestionsResponse, currentProposalId, "Phase1_OrganizeQuestions");
    
    logResponseDetails(organizedQuestionsResponse, "Organize Questions");

    // Enhanced error handling for organized questions parsing
    let organizedQuestions;
    
    try {
      // First try to parse the response properly
      let responseText = organizedQuestionsResponse.response;
      
      // Make sure we have a string to parse
      if (typeof responseText !== 'string') {
        console.log(`[flowAgent] Response is not a string: ${typeof responseText}`);
        // Try to convert to string if possible
        responseText = responseText ? JSON.stringify(responseText) : '{}';
      }
      
      // Try direct parsing with our helper function
      organizedQuestions = parseJson(responseText, "organized questions");
      
    } catch (error) {
      console.error("[flowAgent] Error parsing organized questions:", error.message);
      // Create a default structure as fallback
      organizedQuestions = {
        organizedQuestions: [
          {
            theme: "General Questions",
            questions: []
          }
        ]
      };
    }
    
    // Ensure organizedQuestions has the expected structure
    if (!organizedQuestions || !organizedQuestions.organizedQuestions || !Array.isArray(organizedQuestions.organizedQuestions)) {
      console.warn("[flowAgent] organizedQuestions doesn't have the expected structure. Creating a compatible structure.");
      
      // If it's an array directly at the top level, wrap it
      if (Array.isArray(organizedQuestions)) {
        console.log("[flowAgent] Found array at top level, wrapping in proper structure");
        organizedQuestions = { 
          organizedQuestions: organizedQuestions 
        };
      } 
      // If it contains a 'questions' array or 'themes' array
      else if (organizedQuestions && typeof organizedQuestions === 'object') {
        if (Array.isArray(organizedQuestions.questions)) {
          console.log("[flowAgent] Found 'questions' array, converting to proper structure");
          // If it has a questions array, convert to proper structure
          organizedQuestions = {
            organizedQuestions: [
              {
                theme: "General Questions",
                questions: organizedQuestions.questions
              }
            ]
          };
        } else if (Array.isArray(organizedQuestions.themes)) {
          console.log("[flowAgent] Found 'themes' array, converting to proper structure");
          // If it has a themes array, convert to proper structure
          organizedQuestions = {
            organizedQuestions: organizedQuestions.themes
          };
        } else {
          // Last resort: create a minimal structure with empty questions
          console.log("[flowAgent] Creating minimal compatible structure");
          organizedQuestions = {
            organizedQuestions: [
              {
                theme: "General Questions",
                questions: []
              }
            ]
          };
        }
      } else {
        // Last resort: create a minimal structure with empty questions
        console.log("[flowAgent] Creating minimal compatible structure");
        organizedQuestions = {
          organizedQuestions: [
            {
              theme: "General Questions",
              questions: []
            }
          ]
        };
      }
    }
    
    // Final sanity check to ensure we have a valid structure before saving
    if (!organizedQuestions.organizedQuestions[0] || !Array.isArray(organizedQuestions.organizedQuestions[0].questions)) {
      console.warn("[flowAgent] Final check: repairing organizedQuestions structure");
      // Create a safe structure for the first theme
      organizedQuestions.organizedQuestions[0] = {
        theme: "General Questions",
        questions: []
      };
    }
    
    const questionsFileId = await responsesAgent.createAndUploadFile(
      JSON.stringify(organizedQuestions, null, 2),
      `${currentProposalId}_questions.json`
    );
    if (!questionsFileId) {
      throw new Error("Failed to upload questions file or fileId missing.");
    }
    
    updateFlowJobStatus(currentProposalId, "Phase1_ClarifyingQuestions", "completed", {
      questionsFileId: questionsFileId,
      organizedQuestions
    });
    
    console.log("[flowAgent] Question organization completed");
    updateFlowJobStatus(currentProposalId, "Phase 1", "Questions Organized", { questionsFileId: questionsFileId });
    
    console.log("[flowAgent] Phase 2.1: Customer Q&A");
    updateFlowJobStatus(currentProposalId, "Phase 2", "Customer Q&A", { step: "Collecting customer answers" });
    
    let customerAnswers;
    let answersFileId = null;
    customerPrompt = `As our valued client, we'd like to ask you some clarifying questions about your project to ensure we create the most effective proposal for your needs. Please provide your responses to the following questions:\n\n`;

    try {
      if (organizedQuestions && 
          Array.isArray(organizedQuestions.organizedQuestions) &&
          organizedQuestions.organizedQuestions.length > 0) {
          
        // Log the structure to help debug
        console.log(`[flowAgent] Found ${organizedQuestions.organizedQuestions.length} question themes`);
        
        organizedQuestions.organizedQuestions.forEach((theme, themeIndex) => {
          if (theme && theme.theme && Array.isArray(theme.questions)) {
            customerPrompt += `\n## ${theme.theme}\n\n`;
            console.log(`[flowAgent] Theme: ${theme.theme} has ${theme.questions.length} questions`);
            
            theme.questions.forEach((q, qIndex) => {
              if (q && q.question) {
                const questionId = q.id || `q${themeIndex + 1}.${qIndex + 1}`;
                customerPrompt += `${questionId}. ${q.question}\n`;
              }
            });
          }
        });
        
        customerPrompt += `\n\nPlease provide thorough answers to each question. You may organize your response by theme or answer each question individually by referencing its ID.`;
      } else {
        console.error("[flowAgent] organizedQuestions structure is not as expected", JSON.stringify(organizedQuestions, null, 2));
        
        // Fallback to a simple prompt
        customerPrompt = `As our valued client, we'd like to ask you some additional questions about your project to ensure we create the most effective proposal for your needs.
        
1. What is your timeline for this project?
2. What is your budget range?
3. What are your primary goals and success metrics?
        
Please provide thorough answers to help us tailor our proposal to your specific needs.`;
        
        console.log("[flowAgent] Using fallback customer prompt due to question organization issues");
      }
    } catch (error) {
      console.error(`[flowAgent] Error generating customer prompt: ${error.message}`);
      
      // Fallback to a simple prompt
      customerPrompt = `As our valued client, we'd like to ask you some additional questions about your project to ensure we create the most effective proposal for your needs.
      
1. What is your timeline for this project?
2. What is your budget range?
3. What are your primary goals and success metrics?
      
Please provide thorough answers to help us tailor our proposal to your specific needs.`;
      
      console.log("[flowAgent] Using fallback customer prompt due to error");
    }

    if (initialCustomerAnswers) {
      console.log("[flowAgent] Using provided initial customer answers.");
      customerAnswers = initialCustomerAnswers;
      answersFileId = await responsesAgent.createAndUploadFile(
        customerAnswers,
        `${currentProposalId}_customer_answers_initial.md`
      );
      if (!answersFileId) {
        throw new Error("Failed to upload initial customer answers file or fileId missing.");
      }
    } else {
      console.log("[flowAgent] Sending consolidated questions to customer");
      
      // Use safe helper instead of direct call
      const customerAnswersResponse = await safeCreateResponse(
        customerPrompt,
        [briefFileId, questionsFileId].filter(id => id), // Filter out any undefined/null IDs
        "CustomerAnswers",
        "Customer Q&A"
      );
      
      responsesAgent.trackTokenUsage(customerAnswersResponse, currentProposalId, "Phase2_CustomerAnswers");
      
      customerAnswers = customerAnswersResponse.response;
      console.log("[flowAgent] Received comprehensive answers from customer");
      
      answersFileId = await responsesAgent.createAndUploadFile(
        customerAnswers,
        `${currentProposalId}_customer_answers.md`
      );
      if (!answersFileId) {
        throw new Error("Failed to upload customer answers file or fileId missing.");
      }
    }
    
    const questionsAndAnswers = {
      organizedQuestions,
      customerAnswers
    };
    
    responsesAgent.updateProgressStatus(currentProposalId, "Phase2_CustomerAnswers", "completed", {
      answersFileId: answersFileId
    });
    updateFlowJobStatus(currentProposalId, "Phase 2", "Customer Answers Collected", { answersFileId: answersFileId });
    
    console.log("[flowAgent] Phase 2.2: Starting section development");
    updateFlowJobStatus(currentProposalId, "Phase 2", "Section Development", { step: "Starting section drafting" });
    
    // Validate and normalize assignments before proceeding
    if (!assignments) {
      console.error(`[flowAgent] Assignments is null or undefined`);
      assignments = {}; // Default to empty object instead of throwing
    }
    
    // Check if assignments is an object and has keys
    if (typeof assignments !== 'object' || Array.isArray(assignments)) {
      console.error(`[flowAgent] Invalid assignments type: ${typeof assignments}, isArray: ${Array.isArray(assignments)}`);
      console.log(`[flowAgent] Converting invalid assignments to empty object`);
      assignments = {}; // Default to empty object
    }
    
    // For the case of missing assignments, set up defaults
    if (Object.keys(assignments).length === 0) {
      console.warn(`[flowAgent] No sections assigned! Creating default assignment for section "truncation"`);
      assignments = {
        "truncation": "sp_Account_Manager"
      };
    }
    
    // Safety check - initialize the needed objects
    const sectionPromises = [];
    const development = {};
    const sectionMessageIds = {};
    const sectionFileIds = {}; 
    
    // Debug assignments structure
    try {
      console.log(`[flowAgent] Assignment keys: ${Object.keys(assignments || {}).join(', ')}`);
    } catch (err) {
      console.error(`[flowAgent] Error accessing assignment keys: ${err.message}`);
    }
    
    // Loop through assignments with safety checks
    try {
      // Ensure assignments is an object before attempting to iterate
      if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
        console.error('[flowAgent] Cannot iterate through assignments - not a valid object');
        assignments = { "truncation": "sp_Account_Manager" };
        console.log('[flowAgent] Created default assignment as fallback');
      }
      
      for (const [section, role] of Object.entries(assignments)) {
        const sectionPromise = (async () => {
          try {
            const prompt = `Draft the "${section}" section of the proposal based on:
1. The initial project brief
2. The clarifying questions and customer answers
3. Your expertise as a ${role.replace('sp_', '')}

Your draft should be well-structured, persuasive, and demonstrate expert understanding of the customer's needs. Focus on providing value and addressing the customer's specific requirements as revealed through the Q&A process.`;

            console.log(`[flowAgent] Requesting draft for "${section}" from ${role}`);
            
            const sectionResponse = await safeCreateResponse(
              prompt,
              [briefFileId, analysisFileId, questionsFileId, answersFileId].filter(id => id),
              role,
              `Section Draft for ${section}`
            );
            
            responsesAgent.trackTokenUsage(sectionResponse, currentProposalId, `Phase2_DevelopSection_${section}`);
            
            development[section] = sectionResponse.response;
            sectionMessageIds[section] = sectionResponse.id;
            
            const sectionFileUploadResponse = await responsesAgent.createAndUploadFile(
              sectionResponse.response,
              `${currentProposalId}_${section.replace(/\s+/g, '_')}_draft.md`
            );
            if (!sectionFileUploadResponse) {
              throw new Error(`Failed to upload draft for section ${section} or fileId missing.`);
            }
            sectionFileIds[section] = sectionFileUploadResponse;
            
            updateFlowJobStatus(currentProposalId, "Phase2_SectionDrafts", "in-progress", {
              sections: {
                [section]: { status: "completed", fileId: sectionFileIds[section] }
              }
            });
            
            console.log(`[flowAgent] Completed draft for "${section}"`);
          } catch (error) {
            console.error(`[flowAgent] Error drafting section "${section}":`, error);
            
            updateFlowJobStatus(currentProposalId, "Phase2_SectionDrafts", "in-progress", {
              sections: {
                [section]: { status: "error", error: error.message }
              }
            });
          }
        })();
        
        sectionPromises.push(sectionPromise);
      }
    } catch (error) {
      console.error(`[flowAgent] Error iterating through assignments: ${error.message}`);
      throw new Error(`Failed to process section assignments: ${error.message}`);
    }
    
    await Promise.all(sectionPromises);
    
    updateFlowJobStatus(currentProposalId, "Phase2_SectionDrafts", "completed");
    
    console.log("[flowAgent] All section drafts completed");
    
    console.log("[flowAgent] Phase 3.1: Starting Quality Manager reviews");
    
    const reviews = {};
    console.log(`[flowAgent] Initialized reviews object for sections: ${sections ? sections.join(', ') : 'undefined'}`);
    
    // Preemptively create slots for all sections
    if (Array.isArray(sections)) {
      sections.forEach(section => {
        reviews[section] = {
          review: {},
          customerQuestions: [],
          customerAnswers: ''
        };
      });
    } else {
      console.error(`[flowAgent] ERROR: sections is not an array: ${typeof sections}`);
    }
    
    updateFlowJobStatus(currentProposalId, "Phase3_Reviews", "in-progress", {
      sections: sections.reduce((acc, section) => {
        acc[section] = { 
          status: "pending", 
          fileId: null,
          customerQuestions: []
        };
        return acc;
      }, {})
    });
    
    const reviewPromises = [];
    const reviewFileIds = {};
    const reviewMessageIds = {};
    
    for (const [section, ownerRole] of Object.entries(assignments)) {
      const reviewPromise = (async () => {
        try {
          // Make sure reviews[section] is set regardless of errors
          if (!reviews[section]) {
            console.log(`[flowAgent] Initializing reviews[${section}] that should have been set earlier`);
            reviews[section] = {
              review: {},
              customerQuestions: [],
              customerAnswers: ''
            };
          }

          const draftSectionFileId = sectionFileIds ? sectionFileIds[section] : null;
          if (!draftSectionFileId) {
             console.error(`[flowAgent] ERROR: Missing draft file ID for section ${section} before review.`);
             
             // Update the status but don't throw to allow other sections to continue
             updateFlowJobStatus(currentProposalId, `Phase3_Review_${section}`, "error", {
               message: `Missing draft file ID for section ${section}`
             });
             
             reviews[section].review = {
               generalFeedback: "ERROR: Could not complete review due to missing draft file",
               suggestedRevisions: "",
               questionsForCustomer: [],
               questionsForDraftingAgent: ["Please check if this section was properly generated"]
             };
             
             // Skip the rest of this function rather than throw or continue
             // (continue can't be used across functions in JavaScript)
             return;
          }
          
          console.log(`[flowAgent] Requesting Quality Manager review for "${section}"`);
          
          const qualityManagerReviewPrompt = `Please review the attached section draft ("${section}"). Provide feedback, suggested revisions, and any high-value questions for the customer.

Your feedback should be structured as a JSON object with the following keys:
- "generalFeedback": "Overall assessment of the section."
- "suggestedRevisions": "Specific, actionable revisions."
- "questionsForCustomer": ["Array of strings, only if essential and high-value. Otherwise, an empty array." ]
- "questionsForDraftingAgent": ["Array of strings for the original author (${ownerRole.replace('sp_', '')})."]

Focus on clarity, accuracy, persuasiveness, and alignment with the customer's brief and answers.`;
          
          const reviewResponse = await safeCreateResponse(
            qualityManagerReviewPrompt,
            [briefFileId, analysisFileId, questionsFileId, answersFileId, draftSectionFileId].filter(id => id),
            "QualityManager",
            `Quality Review for ${section}`
          );
          
          responsesAgent.trackTokenUsage(reviewResponse, currentProposalId, `Phase3_ReviewSection_${section}`);
          
          // Place reviewJson in a wider scope so we can access it outside the try block
          let reviewJson = {};
          
          try {
            reviewJson = parseJson(reviewResponse.response, `review for ${section}`);
            
            // Ensure reviews[section] exists before assigning to it
            if (!reviews[section]) {
              console.warn(`[flowAgent] reviews[${section}] was undefined, initializing it`);
              reviews[section] = {
                review: {},
                customerQuestions: [],
                customerAnswers: ''
              };
            }
            
            // Make sure reviewJson is at least an empty object if parsing failed
            reviewJson = reviewJson || {};
            reviews[section].review = reviewJson;
            reviewMessageIds[section] = reviewResponse.id;
          } catch (error) {
            console.error(`[flowAgent] Error parsing review JSON for ${section}: ${error.message}`);
            if (!reviews[section]) {
              reviews[section] = {
                review: {},
                customerQuestions: [],
                customerAnswers: ''
              };
            }
            
            // Create a fallback review object if parsing failed completely
            reviewJson = {
              generalFeedback: `Error parsing review: ${error.message}`,
              suggestedRevisions: "",
              questionsForCustomer: [],
              questionsForDraftingAgent: ["Review parsing failed, please check the section"]
            };
            
            // Update the section's review with our fallback
            reviews[section].review = reviewJson;
          }
          
          const reviewFileUploadResponse = await responsesAgent.createAndUploadFile(
            JSON.stringify(reviewJson, null, 2),
            `${currentProposalId}_${section.replace(/\s+/g, '_')}_review.json`
          );
          if (!reviewFileUploadResponse) {
            throw new Error(`Failed to upload review for section ${section} or fileId missing.`);
          }
          reviewFileIds[section] = reviewFileUploadResponse;
          
          updateFlowJobStatus(currentProposalId, "Phase3_Reviews", "in-progress", {
            sections: {
              [section]: { 
                status: "completed", 
                fileId: reviewFileIds[section],
                customerQuestions: reviewJson.questionsForCustomer || []
              }
            }
          });
          
          console.log(`[flowAgent] Completed review for "${section}"`);
        } catch (error) {
          console.error(`[flowAgent] Error reviewing section "${section}":`, error);
          
          updateFlowJobStatus(currentProposalId, "Phase3_Reviews", "in-progress", {
            sections: {
              [section]: { status: "error", error: error.message }
            }
          });
        }
      })();
      
      reviewPromises.push(reviewPromise);
    }
    
    await Promise.all(reviewPromises);
    
    updateFlowJobStatus(currentProposalId, "Phase3_Reviews", "completed");
    
    console.log("[flowAgent] All section reviews completed");
    
    // DEBUG: Log review structure to help diagnose issues
    console.log(`[flowAgent] DEBUG: Review object keys: ${Object.keys(reviews)}`);
    console.log(`[flowAgent] DEBUG: Expected section keys: ${JSON.stringify(sections)}`);
    
    // Check if any sections are missing reviews
    const missingSections = sections.filter(section => !reviews[section]);
    if (missingSections.length > 0) {
      console.warn(`[flowAgent] WARNING: Missing review data for sections: ${missingSections.join(', ')}`);
    }
    
    console.log("[flowAgent] Consolidating customer questions from reviews");
    
    const allCustomerQuestionsFromReviews = {};
    let hasReviewQuestions = false;
    
    for (const [section, reviewData] of Object.entries(reviews || {})) {
      if (reviewData && reviewData.review && reviewData.review.questionsForCustomer && 
          Array.isArray(reviewData.review.questionsForCustomer) && 
          reviewData.review.questionsForCustomer.length > 0) {
        allCustomerQuestionsFromReviews[section] = reviewData.review.questionsForCustomer;
        hasReviewQuestions = true;
      } else if (reviewData) {
        // Initialize with empty array if no questions exist
        allCustomerQuestionsFromReviews[section] = [];
      }
    }
    
    let customerReviewAnswersFileId = null;
    let customerReviewAnswersText = initialCustomerReviewAnswers || "";

    if (hasReviewQuestions && !initialCustomerReviewAnswers) {
      console.log("[flowAgent] Sending review-generated questions to customer");
      
      let customerReviewQuestionsPrompt = `Based on our internal review of the draft proposal, we have some follow-up questions to help us refine the content. Please provide answers to the following questions:\n\n`;
      
      for (const [section, questionsArray] of Object.entries(allCustomerQuestionsFromReviews)) {
        customerReviewQuestionsPrompt += `\n## Questions regarding the "${section}" section:\n`;
        questionsArray.forEach((q, idx) => {
          customerReviewQuestionsPrompt += `${idx + 1}. ${q}\n`;
        });
      }
      
      customerReviewQuestionsPrompt += `\n\nYour answers will help us refine the proposal to better meet your needs.`;
      
      const customerReviewAnswersResponse = await safeCreateResponse(
        customerReviewQuestionsPrompt,
        [briefFileId].filter(id => id),
        "CustomerReviewAnswers",
        "Customer Review Answers"
      );
      
      responsesAgent.trackTokenUsage(customerReviewAnswersResponse, currentProposalId, "Phase3_CustomerReviewAnswers");
      
      customerReviewAnswersText = customerReviewAnswersResponse.response;
      
      for (const section of Object.keys(allCustomerQuestionsFromReviews || {})) {
        if (reviews && reviews[section]) {
           reviews[section].customerAnswers = customerReviewAnswersText || '';
        }
      }
      
      const reviewAnswersFileUploadResponse = await responsesAgent.createAndUploadFile(
        customerReviewAnswersText,
        `${currentProposalId}_review_customer_answers.md`
      );
      if (!reviewAnswersFileUploadResponse) {
        throw new Error("Failed to upload customer review answers file or fileId missing.");
      }
      customerReviewAnswersFileId = reviewAnswersFileUploadResponse;
      
      updateFlowJobStatus(currentProposalId, "Phase3_CustomerReviewAnswers", "completed", {
        fileId: customerReviewAnswersFileId
      });
    } else if (initialCustomerReviewAnswers) {
        console.log("[flowAgent] Using provided initial customer review answers.");
        const reviewAnswersFileUploadResponse = await responsesAgent.createAndUploadFile(
            initialCustomerReviewAnswers,
            `${currentProposalId}_review_customer_answers_initial.md`
        );
        if (!reviewAnswersFileUploadResponse) {
            throw new Error("Failed to upload initial customer review answers file or fileId missing.");
        }
        customerReviewAnswersFileId = reviewAnswersFileUploadResponse;
        for (const section of sections || []) {
            if (reviews && reviews[section]) {
                reviews[section].customerAnswers = initialCustomerReviewAnswers || '';
            }
        }
        updateFlowJobStatus(currentProposalId, "Phase3_CustomerReviewAnswers", "completed", {
            fileId: customerReviewAnswersFileId,
            message: "Used pre-provided answers."
        });
    } else {
      updateFlowJobStatus(currentProposalId, "Phase3_CustomerReviewAnswers", "skipped");
    }
    
    console.log("[flowAgent] Phase 3.3: Authors revising sections based on feedback");
    
    updateFlowJobStatus(currentProposalId, "Phase3_Revisions", "in-progress", {
      sections: sections.reduce((acc, section) => {
        acc[section] = { status: "pending", fileId: null };
        return acc;
      }, {})
    });
    
    const revisedDevelopment = {};
    const revisionPromises = [];
    const revisedSectionFileIds = {};
    
    for (const [section, ownerRole] of Object.entries(assignments)) {
      const revisionPromise = (async () => {
        try {
          const reviewFileId = reviewFileIds[section];
          const draftSectionFileId = sectionFileIds[section];
          const previousMessageIdForRevision = reviewMessageIds[section];

          if (!reviewFileId || !draftSectionFileId || !previousMessageIdForRevision) {
            throw new Error(`Missing data for revising section ${section}: reviewFileId=${reviewFileId}, draftSectionFileId=${draftSectionFileId}, previousMessageId=${previousMessageIdForRevision}`);
          }

          const revisionPrompt = `Please revise the "${section}" section based on the attached Quality Manager's review and any new customer answers provided.

Your revision should:
- Address all feedback and questions from the Quality Manager.
- Incorporate new information from customer answers (if provided).
- Maintain the original intent and quality of the section.
- Ensure the revised section is polished and ready for final assembly.

Original Draft, QM Review, and potentially new Customer Answers are attached.`;

          const attachmentsForRevision = [
              briefFileId, 
              analysisFileId, 
              questionsFileId, 
              answersFileId, 
              draftSectionFileId, 
              reviewFileId
          ];

          if (customerReviewAnswersFileId) {
              attachmentsForRevision.push(customerReviewAnswersFileId);
          }
          
          console.log(`[flowAgent] Requesting revision for "${section}" from ${ownerRole}`);
          
          const revisionResponse = await responsesAgent.forkResponse(
            previousMessageIdForRevision,
            revisionPrompt,
            attachmentsForRevision,
            ownerRole
          );
          
          responsesAgent.trackTokenUsage(revisionResponse, currentProposalId, `Phase3_ReviseSection_${section}`);
          
          revisedDevelopment[section] = revisionResponse.response;
          
          const revisedFileUploadResponse = await responsesAgent.createAndUploadFile(
            revisionResponse.response,
            `${currentProposalId}_${section.replace(/\s+/g, '_')}_revised.md`
          );
          if (!revisedFileUploadResponse) {
            throw new Error(`Failed to upload revised section ${section} or fileId missing.`);
          }
          revisedSectionFileIds[section] = revisedFileUploadResponse;
          
          updateFlowJobStatus(currentProposalId, "Phase3_Revisions", "in-progress", {
            sections: {
              [section]: { status: "completed", fileId: revisedSectionFileIds[section] }
            }
          });
          
          console.log(`[flowAgent] Completed revision for "${section}"`);
        } catch (error) {
          console.error(`[flowAgent] Error revising section "${section}":`, error);
          
          updateFlowJobStatus(currentProposalId, "Phase3_Revisions", "in-progress", {
            sections: {
              [section]: { status: "error", error: error.message }
            }
          });
        }
      })();
      
      revisionPromises.push(revisionPromise);
    }
    
    await Promise.all(revisionPromises);
    
    updateFlowJobStatus(currentProposalId, "Phase3_Revisions", "completed");
    
    console.log("[flowAgent] All section revisions completed");
    
    console.log("[flowAgent] Phase 4.1: Final review and assembly");
    
    const revisedSectionsForApproval = sections.map(section => {
        const fileId = revisedSectionFileIds[section];
        if (!fileId) {
            console.warn(`[flowAgent] Missing revised file ID for section ${section} during final approval prep.`);
        }
        return {
            sectionName: section,
            content: revisedDevelopment[section] || "Content not available",
            fileId: fileId 
        };
    });

    const manifestContent = revisedSectionsForApproval.map(rs => `Section: ${rs.sectionName}\nFile ID: ${rs.fileId || 'N/A'}\n---`).join('\n');
    const manifestFileUploadResponse = await responsesAgent.createAndUploadFile(
        manifestContent, 
        `${currentProposalId}_final_review_manifest.txt`
    );
    if (!manifestFileUploadResponse) {
        throw new Error("Failed to upload final review manifest file or fileId missing.");
    }
    const manifestFileId = manifestFileUploadResponse;
    
    const finalReviewPrompt = `All sections have been drafted, reviewed, and revised. Please perform a final review of all attached revised sections. 
Confirm that the proposal is cohesive, addresses all customer requirements, and is of high quality.

If approved, respond with "Final approval granted." 
If not, provide specific reasons and outstanding issues.

A manifest file (${manifestFileId}) is attached listing all revised section files. The individual section files are also attached.`;

    const attachmentsForFinalReview = [
        briefFileId, 
        analysisFileId, 
        questionsFileId, 
        answersFileId,
        manifestFileId,
        ...revisedSectionsForApproval.map(rs => rs.fileId).filter(id => id)
    ];

    if (customerReviewAnswersFileId) {
        attachmentsForFinalReview.push(customerReviewAnswersFileId);
    }
    
    const finalApprovalResponse = await safeCreateResponse(
      finalReviewPrompt,
      attachmentsForFinalReview.filter(id => id),
      "QualityManager",
      "Final Approval Review"
    );
    
    responsesAgent.trackTokenUsage(finalApprovalResponse, currentProposalId, "Phase4_FinalApproval");
    
    const finalApprovalContent = finalApprovalResponse.response;
    
    const finalApprovalFileUploadResponse = await responsesAgent.createAndUploadFile(
      finalApprovalContent,
      `${currentProposalId}_final_approval.txt`
    );
    if (!finalApprovalFileUploadResponse) {
      throw new Error("Failed to upload final approval file or fileId missing.");
    }
    const finalApprovalFileId = finalApprovalFileUploadResponse;
    
    updateFlowJobStatus(currentProposalId, "Phase4_FinalApproval", "completed", {
      approvalFileId: finalApprovalFileId,
      approvalContent: finalApprovalContent
    });
    
    console.log("[flowAgent] Final QM approval received");

    // Add a final check for any remaining review issues
    try {
      if (sections && Array.isArray(sections)) {
        sections.forEach(section => {
          if (!reviews[section]) {
            console.error(`[flowAgent] CRITICAL: Section "${section}" is missing from reviews object at final assembly stage`);
            // Initialize with empty data to prevent errors
            reviews[section] = {
              review: {},
              customerQuestions: [],
              customerAnswers: ''
            };
          } else if (!reviews[section].review) {
            console.error(`[flowAgent] CRITICAL: Section "${section}" has no review property at final assembly stage`);
            reviews[section].review = {}; // Initialize with empty object
          }
        });
      } else {
        console.error(`[flowAgent] CRITICAL: sections is not an array at final assembly stage: ${typeof sections}`);
      }
    } catch (err) {
      console.error(`[flowAgent] Error in final review check: ${err.message}`);
    }
    
    console.log("[flowAgent] Phase 4.2: Assembling final proposal");
    
    const assembledProposalContent = sections.map(section => revisedDevelopment[section] || `Error: Content for section '${section}' was not generated.`).join('\n\n---\n\n');
    
    const finalProposalFileUploadResponse = await responsesAgent.createAndUploadFile(
      assembledProposalContent,
      `${currentProposalId}_final_proposal.md`
    );
    if (!finalProposalFileUploadResponse) {
      throw new Error("Failed to upload final proposal file or fileId missing.");
    }
    const finalProposalFileId = finalProposalFileUploadResponse;
    
    updateFlowJobStatus(currentProposalId, "Phase4_Assembly", "completed", {
      finalProposalFileId: finalProposalFileId
    });
    
    console.log("[flowAgent] Final proposal assembled");
    
    const finalReport = responsesAgent.getTokenUsageReport();
    console.log("[flowAgent] Final Token Usage Report:", JSON.stringify(finalReport, null, 2));
    
    const allGeneratedFiles = [];
    const addPath = (filePath) => { if (filePath) allGeneratedFiles.push(filePath); };

    addPath(briefFileId ? `/uploads/${currentProposalId}/${currentProposalId}_brief.json` : null);
    addPath(analysisFileId ? `/uploads/${currentProposalId}/${currentProposalId}_analysis.md` : null);
    addPath(assignmentsFileId ? `/uploads/${currentProposalId}/${currentProposalId}_assignments.json` : null);
    addPath(questionsFileId ? `/uploads/${currentProposalId}/${currentProposalId}_questions.json` : null);
    if (initialCustomerAnswers) {
        addPath(answersFileId ? `/uploads/${currentProposalId}/${currentProposalId}_customer_answers_initial.md` : null);
    } else {
        addPath(answersFileId ? `/uploads/${currentProposalId}/${currentProposalId}_customer_answers.md` : null);
    }
    sections.forEach(section => {
        const s_ = section.replace(/\s+/g, '_');
        addPath(sectionFileIds[section] ? `/uploads/${currentProposalId}/${currentProposalId}_${s_}_draft.md` : null);
        addPath(reviewFileIds[section] ? `/uploads/${currentProposalId}/${currentProposalId}_${s_}_review.json` : null);
        addPath(revisedSectionFileIds[section] ? `/uploads/${currentProposalId}/${currentProposalId}_${s_}_revised.md` : null);
    });
    if (initialCustomerReviewAnswers) {
        addPath(customerReviewAnswersFileId ? `/uploads/${currentProposalId}/${currentProposalId}_review_customer_answers_initial.md` : null);
    } else if (customerReviewAnswersFileId) {
        addPath(customerReviewAnswersFileId ? `/uploads/${currentProposalId}/${currentProposalId}_review_customer_answers.md` : null);
    }
    addPath(manifestFileId ? `/uploads/${currentProposalId}/${currentProposalId}_final_review_manifest.txt` : null);
    addPath(finalApprovalFileId ? `/uploads/${currentProposalId}/${currentProposalId}_final_approval.txt` : null);
    addPath(finalProposalFileId ? `/uploads/${currentProposalId}/${currentProposalId}_final_proposal.md` : null);

    return {
      flowData: {
        proposalId: currentProposalId,
        briefFileId,
        briefAnalysis: analysis,
        analysisFileId,
        sectionAssignments: assignments,
        assignmentsFileId,
        clarifyingQuestions: organizedQuestions,
        questionsFileId,
        customerAnswers,
        customerAnswersFileId: answersFileId,
        sectionDrafts: sections.reduce((acc, section) => {
          acc[section] = { 
            content: development[section] || '', 
            fileId: sectionFileIds ? sectionFileIds[section] : null 
          };
          return acc;
        }, {}),
        sectionReviews: sections.reduce((acc, section) => {
          // Safely handle potentially undefined review sections
          if (reviews[section]) {
            acc[section] = { 
              reviewContent: reviews[section].review || {}, 
              customerQuestions: reviews[section].customerQuestions || [], 
              customerAnswers: reviews[section].customerAnswers || '',
              fileId: reviewFileIds ? reviewFileIds[section] : null 
            };
          } else {
            console.warn(`[flowAgent] Missing review data for section "${section}"`);
            acc[section] = { 
              reviewContent: {}, 
              customerQuestions: [], 
              customerAnswers: '',
              fileId: reviewFileIds ? reviewFileIds[section] : null 
            };
          }
          return acc;
        }, {}),
        customerReviewAnswersFileId: customerReviewAnswersFileId,
        revisedSections: sections.reduce((acc, section) => {
          acc[section] = { 
            content: revisedDevelopment && revisedDevelopment[section] ? revisedDevelopment[section] : '', 
            fileId: revisedSectionFileIds ? revisedSectionFileIds[section] : null 
          };
          return acc;
        }, {}),
        finalApprovalContent,
        finalApprovalFileId,
        assembledProposalContent,
        finalProposalFileId
      },
      summary: {
        status: 'completed',
        message: 'Flow completed successfully.',
        totalTokensUsed: finalReport.overallTokens.total,
        progressUpdates: finalReport.componentDetails,
        filesGenerated: allGeneratedFiles
      }
    };
  } catch (error) {
    console.error(`[flowAgent] CRITICAL ERROR in runFullFlow (ID: ${currentProposalId}):`, error.message);
    console.error(`[flowAgent] Error stack:`, error.stack);
    
    const finalReport = responsesAgent.getTokenUsageReport();
    console.log(`[flowAgent] Token Usage Report on Failure:`, JSON.stringify(finalReport, null, 2));
    
    const errorGeneratedFiles = [];
    const addErrorPath = (filePath) => { if (filePath) errorGeneratedFiles.push(filePath); };

    addErrorPath(briefFileId ? `/uploads/${currentProposalId}/${currentProposalId}_brief.json` : null);
    addErrorPath(analysisFileId ? `/uploads/${currentProposalId}/${currentProposalId}_analysis.md` : null);

    if (global.flowJobs) {
      const jobId = Object.keys(global.flowJobs).find(id => 
        global.flowJobs[id].proposalId === currentProposalId);
      
      if (jobId) {
        global.flowJobs[jobId].status = 'failed';
        global.flowJobs[jobId].error = {
          message: error.message,
          stack: error.stack
        };
        global.flowJobs[jobId].endTime = new Date().toISOString();
      }
    }
    
    return {
      error: true,
      message: error.message,
      stack: error.stack,
      proposalId: currentProposalId,
      generatedFiles: errorGeneratedFiles,
      tokenUsage: finalReport.overallTokens?.total || 0
    };
  }
}

module.exports = { runFullFlow };
