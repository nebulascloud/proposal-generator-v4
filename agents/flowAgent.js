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
const Session = require('../db/models/session'); // Added Session model

// Initialize tracking and state
// let currentProposalId = null; // Will be set inside runFullFlow

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
    'Section Assignment': 'Phase1_SectionAssignments',
    'Section Assignments': 'Phase1_SectionAssignments',
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
 * @param {String} phase - Current phase (optional)
 * @param {String} proposalIdForAgent - Proposal ID (optional)
 * @param {String} previousResponseId - ID of previous response for chaining (optional)
 * @returns {Object} The response object
 */
async function safeCreateResponse(content, contexts, role, operation = 'API Call', phase = null, proposalIdForAgent, previousResponseId = null) {
  try {
    // Sanitize contexts to ensure it's always an array
    const sanitizedContexts = contexts ? 
      (Array.isArray(contexts) ? contexts.filter(c => c !== null && c !== undefined) : []) : [];
    
    // Determine the phase based on the operation if not explicitly provided
    const currentPhase = phase || convertOperationToPhase(operation);
    
    console.log(`[flowAgent] ${operation} - Calling createInitialResponse with ${sanitizedContexts.length} contexts, phase: ${currentPhase || 'none'}, proposalId: ${proposalIdForAgent}${previousResponseId ? ', previousResponseId: ' + previousResponseId : ''}`);
    
    const response = await responsesAgent.createInitialResponse(
      content,
      sanitizedContexts,
      role,
      currentPhase, // Use the determined phase
      proposalIdForAgent, // use passed proposalId
      previousResponseId // Pass the previous response ID for chaining
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
 * Parse JSON from a string. Throws on error.
 * @param {string} raw - Raw text containing JSON
 * @param {string} label - Label for error reporting
 * @returns {Object} Parsed JSON object
 */
function parseJson(raw, label) {
  if (typeof raw !== 'string') {
    throw new Error(`[parseJson] Input for ${label} must be a string`);
  }
  try {
    return extractJsonFromText(raw, label);
  } catch (err) {
    throw new Error(`[parseJson] Failed to parse JSON for ${label}: ${err.message}`);
  }
}

/**
 * Extract JSON from a string (optionally from a code block). Throws on error.
 * @param {string} text - String containing JSON or JSON code block
 * @param {string} label - Label for error reporting
 * @returns {Object} Parsed JSON object
 */
function extractJsonFromText(text, label) {
  if (typeof text !== 'string') {
    throw new Error(`[extractJsonFromText] Input for ${label} must be a string`);
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`[extractJsonFromText] Empty string for ${label}`);
  }
  // Look for JSON code blocks
  const jsonCodeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
  const match = trimmed.match(jsonCodeBlockRegex);
  let jsonStr = match && match[1] ? match[1].trim() : trimmed;
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`[extractJsonFromText] Invalid JSON for ${label}: ${err.message}`);
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
  let sessionId = null; // Declare sessionId for use in try/catch
  let currentProposalId = `proposal-${Date.now()}`; // Initialize currentProposalId here

  // Declare variables used in try/catch here to ensure they are in scope for the catch block
  let briefFileId = null;
  let analysisFileId = null;
  let assignmentsFileId = null;
  let questionsFileId = null;
  let answersFileId = null;
  let customerReviewAnswersFileId = null;
  let manifestFileId = null;
  let finalApprovalFileId = null;
  let finalProposalFileId = null;
  
  // Initialize objects that will be populated
  let sectionFileIds = {};
  let reviewFileIds = {};
  let revisedSectionFileIds = {};
  // Always define customerAnswersResponse for consistent chaining logic
  let customerAnswersResponse = null;

  try {
    responsesAgent.resetProgress();
    console.log(`[flowAgent] Starting new proposal generation (ID: ${currentProposalId})`);
    
    // Better logging for initialCustomerAnswers
    if (initialCustomerAnswers === undefined || initialCustomerAnswers === null) {
      console.log(`[flowAgent] No initial customerAnswers provided - will generate during flow.`);
    } else if (typeof initialCustomerAnswers !== 'string') {
      console.warn(`[flowAgent] initialCustomerAnswers is not a string (${typeof initialCustomerAnswers})`);
      console.log(`[flowAgent] Attempting to convert initialCustomerAnswers to string.`);
      initialCustomerAnswers = String(initialCustomerAnswers || '');
    } else {
      console.log(`[flowAgent] Received initial customerAnswers: ${initialCustomerAnswers.substring(0,100)}${initialCustomerAnswers.length > 100 ? '...' : ''}`);
      console.log(`[flowAgent] initialCustomerAnswers length: ${initialCustomerAnswers.length} characters`);
    }
    
    // Better logging for initialCustomerReviewAnswers
    if (initialCustomerReviewAnswers === undefined || initialCustomerReviewAnswers === null) {
      console.log(`[flowAgent] No initial customerReviewAnswers provided - will generate during flow if needed.`);
    } else if (typeof initialCustomerReviewAnswers !== 'string') {
      console.warn(`[flowAgent] initialCustomerReviewAnswers is not a string (${typeof initialCustomerReviewAnswers})`);
      console.log(`[flowAgent] Attempting to convert initialCustomerReviewAnswers to string.`);
      initialCustomerReviewAnswers = String(initialCustomerReviewAnswers || '');
    } else {
      console.log(`[flowAgent] Received initial customerReviewAnswers: ${initialCustomerReviewAnswers.substring(0,100)}${initialCustomerReviewAnswers.length > 100 ? '...' : ''}`);
      console.log(`[flowAgent] initialCustomerReviewAnswers length: ${initialCustomerReviewAnswers.length} characters`);
    }

    if (jobId && global.flowJobs && global.flowJobs[jobId]) {
      global.flowJobs[jobId].proposalId = currentProposalId;
      console.log(`[flowAgent] Associated proposal ${currentProposalId} with job ${jobId}`);
    }

    // Create a new session in the database
    const sessionData = {
      proposalId: currentProposalId,
      customerBriefId: brief && brief.id ? brief.id : null, // Assuming brief might have an id
      status: 'processing',
      metadata: { 
        jobId: jobId, // Link to the async job ID from global.flowJobs
        startTime: new Date().toISOString(),
        initialBriefSummary: brief ? { client_name: brief.client_name, project_description: brief.project_description } : null,
        hasInitialCustomerAnswers: !!initialCustomerAnswers,
        hasInitialCustomerReviewAnswers: !!initialCustomerReviewAnswers
      }
    };
    const newDbSession = await Session.create(sessionData);
    sessionId = newDbSession.id; // Store the DB session ID
    console.log(`[flowAgent] Created DB session ${sessionId} for proposal ${currentProposalId}`);

    // updateFlowJobStatus(currentProposalId, 'Setup', 'initializing', {
    //   message: 'Starting production flow',
    //   timestamp: new Date().toISOString()
    // });
    
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
    
    // console.log(`[flowAgent] Working with ${sections.length} sections: ${sections.join(', ')}`);
    
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
      "Brief Analysis",
      null,
      currentProposalId
    );
    const analysis = analysisResponse.response || "Unable to generate analysis";
    
    // Fixed parameter order: (response, phase, component) instead of (response, proposalId, componentName)
    responsesAgent.trackTokenUsage(analysisResponse, "phase1", "briefAnalysis");
    
    analysisFileId = await responsesAgent.createAndUploadFile(
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
      "Section Assignments",
      null,
      currentProposalId,
      analysisResponse.id // Pass the analysis response ID for chaining
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
      // Use our strict parseJson helper
      if (typeof assignResponse.response === 'string') {
        assignments = parseJson(assignResponse.response, "section assignments (response)");
      } else if (typeof assignResponse.text === 'string') {
        assignments = parseJson(assignResponse.text, "section assignments (text)");
      } else if (typeof assignResponse === 'string') {
        assignments = parseJson(assignResponse, "section assignments (response)");
      } else {
        throw new Error("No valid string property found in assignResponse");
      }
    } catch (error) {
      console.error(`[flowAgent] Error parsing section assignments: ${error.message}`);
      throw new Error(`Failed to parse section assignments: ${error.message}`);
    }
    
    responsesAgent.trackTokenUsage(assignResponse, "phase1", "sectionAssignments");
    
    assignmentsFileId = await responsesAgent.createAndUploadFile(
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
    let lastQuestionResponseId = null; // Track a response ID for chaining
    
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
            `Questions from ${role}`,
            null,
            currentProposalId,
            assignResponse.id // Chain from the section assignments response
          );
          
          responsesAgent.trackTokenUsage(response, currentProposalId, `phase1`, `clarifyingQuestions_${role}`);
          
          // Store response ID for chaining
          if (response.id) {
            lastQuestionResponseId = response.id;
          }
          
          let parsedQuestions;
          try {
            // Try using the parseJson helper first for robust parsing
            // Use our strict parseJson helper
            if (typeof response.response === 'string') {
              parsedQuestions = parseJson(response.response, "questions from " + role);
            } else if (typeof response.text === 'string') {
              parsedQuestions = parseJson(response.text, "questions from " + role);
            } else if (typeof response === 'string') {
              parsedQuestions = parseJson(response, "questions from " + role);
            } else {
              throw new Error("No valid string property found in response");
            }
            console.log(`[flowAgent] Successfully parsed questions JSON for ${role} with parseJson helper, found ${Array.isArray(parsedQuestions) ? parsedQuestions.length : 'non-array'} result`);
          } catch (parseError) {
            console.error(`[flowAgent] parseJson failed for ${role}: ${parseError.message}`);
            throw parseError;
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
      "Phase1_OrganizeQuestions", // Explicitly pass the phase
      currentProposalId,
      lastQuestionResponseId // Chain from a specialist question response
    );
    
    // Log details about the response for debugging
    logResponseDetails(organizedQuestionsResponse, "Question Organization");
    
    responsesAgent.trackTokenUsage(organizedQuestionsResponse, "phase1", "organizeQuestions");
    
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
      
      // For organizedQuestions
      if (typeof responseText === 'string') {
        organizedQuestions = parseJson(responseText, "organized questions");
      } else {
        throw new Error("No valid string property found for organized questions");
      }
      
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
    
    questionsFileId = await responsesAgent.createAndUploadFile(
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

    let customerAnswers; // This will hold the actual answer text/data.
    // `answersFileId` is already declared in the outer scope and initialized to null.
    // `customerAnswersResponse` is already declared in the outer scope and initialized to null.

    if (initialCustomerAnswers) {
      console.log(`[flowAgent] Processing provided initial customer answers.`);
      // Ensure initialCustomerAnswers is a string for uploading
      const answersContentString = typeof initialCustomerAnswers === 'string'
        ? initialCustomerAnswers
        : JSON.stringify(initialCustomerAnswers, null, 2);

      // Use the answersFileId from the outer scope
      answersFileId = await responsesAgent.createAndUploadFile(
        answersContentString,
        `${currentProposalId}_initial_customer_answers.json` // Assuming JSON or text
      );

      if (answersFileId) {
        console.log(`[flowAgent] Initial customer answers uploaded. File ID: ${answersFileId}`);
        customerAnswersResponse = { id: answersFileId }; // Core fix
      } else {
        console.warn("[flowAgent] Failed to upload initial customer answers file. customerAnswersResponse.id will be null.");
        customerAnswersResponse = { id: null }; // Ensure it's an object, id is null
      }
      customerAnswers = initialCustomerAnswers; // Store the raw/original answers

      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_with_initial", { answersFileId: answersFileId || null });
      console.log(`[flowAgent] Initial customer answers processed. customerAnswersResponse set to:`, customerAnswersResponse);

    } else {
      // No initial answers, proceed with generating questions and getting answers from customer/mock
      console.log(`[flowAgent] No initial customer answers provided. Generating questions for customer.`);
      
      let customerPrompt = `As our valued client, we'd like to ask you some clarifying questions about your project to ensure we create the most effective proposal for your needs. Please provide your responses to the following questions:\\n\\n`;

      try {
        // Placeholder for the logic that was originally here for generating prompt from organizedQuestions
        // and then calling an agent (e.g., customer agent or mock) to get answers.
        // This logic would set:
        // - customerAnswers (the text/content of the answers)
        // - customerAnswersResponse (the object from the agent, ideally with an .id for the file)
        // - answersFileId (from customerAnswersResponse.id or by uploading customerAnswers)
        
        // Example of how this block should be structured:
        // 1. Build the prompt for the customer using `organizedQuestions`.
        //    if (organizedQuestions && organizedQuestions.organizedQuestions) {
        //      organizedQuestions.organizedQuestions.forEach(group => {
        //        customerPrompt += `\n**${group.theme}**\n`;
        //        group.questions.forEach(q => {
        //          customerPrompt += `- ${q.question} (ID: ${q.id})\n`;
        //        });
        //      });
        //    } else {
        //      console.warn("[flowAgent] organizedQuestions is not available for customer prompt generation.");
        //      // Potentially add default questions to prompt or handle error
        //    }
        //
        // 2. Call an agent (e.g., a "CustomerInteractionAgent" or use a mock for testing)
        //    const qaAgentResponse = await safeCreateResponse(
        //      customerPrompt,
        //      [questionsFileId, briefFileId].filter(id => id), // Context for the customer agent
        //      "CustomerInteractionAgent", // Or a mock agent role
        //      "Customer Q&A",
        //      "Phase2_CustomerAnswers",
        //      currentProposalId,
        //      questionsFileId // Chaining from question organization
        //    );
        //
        // 3. Process the response
        //    if (qaAgentResponse) {
        //      customerAnswersResponse = qaAgentResponse; // This should have an .id if a file was created by the agent
        //      customerAnswers = qaAgentResponse.response || qaAgentResponse.text; // Actual answers
        //
        //      if (qaAgentResponse.id) {
        //        answersFileId = qaAgentResponse.id;
        //      } else if (customerAnswers) {
        //        // If answers were received but not as a file, upload them
        //        const answersToUpload = typeof customerAnswers === 'string' ? customerAnswers : JSON.stringify(customerAnswers, null, 2);
        //        answersFileId = await responsesAgent.createAndUploadFile(
        //          answersToUpload,
        //          `${currentProposalId}_customer_answers.json`
        //        );
        //        if (answersFileId) {
        //          // Update customerAnswersResponse if it was null or its id was null, or if it wasn't an object with an id
        //          if (!customerAnswersResponse || typeof customerAnswersResponse.id === 'undefined') {
        //             customerAnswersResponse = { id: answersFileId };
        //          } else if (customerAnswersResponse.id === null) {
        //             customerAnswersResponse.id = answersFileId;
        //          }
        //        }
        //      }
        //      console.log(`[flowAgent] Customer answers received. File ID: ${answersFileId || 'N/A'}`);
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_via_interaction", { answersFileId: answersFileId || null });
        //    } else {
        //      console.error("[flowAgent] No response from QA agent for customer questions.");
        //      customerAnswersResponse = { id: null }; // Ensure it's an object with id
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_no_qa_response");
        //    }

        console.log('[flowAgent] Customer Q&A processing logic (else branch) needs to be fully implemented here.');
        // If not implemented, ensure customerAnswersResponse is at least {id: null} if it's still null from initialization.
        if (customerAnswersResponse === null) { // Check against initial value
            console.warn('[flowAgent] customerAnswersResponse is still null after attempting Q&A (else branch). Setting to {id: null}.');
            customerAnswersResponse = { id: null };
        }

      } catch (error) {
        console.error(`[flowAgent] Error during customer Q&A (else branch): ${error.message}`);
        updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_during_interaction", { error: error.message });
        customerAnswersResponse = { id: null }; // Default on error
        // throw error; // Or re-throw if this is a critical failure
      }
    }
    
    // Ensure customerAnswersResponse is an object with an id before proceeding to use it.
    if (!customerAnswersResponse) { // Catches if it's null or undefined
        console.warn('[flowAgent] customerAnswersResponse is not set after Q&A phase (e.g. null or undefined). Defaulting to { id: null }.');
        customerAnswersResponse = { id: null };
    } else if (typeof customerAnswersResponse.id === 'undefined') { // Catches if it's an object but no 'id'
        console.warn('[flowAgent] customerAnswersResponse.id is undefined after Q&A phase. Attempting to use answersFileId or defaulting id to null. Response was:', customerAnswersResponse);
        // Try to use answersFileId if it was set (e.g. by manual upload in the 'else' branch or if initialCustomerAnswers path set it)
        if (answersFileId) {
            customerAnswersResponse.id = answersFileId;
            console.log(`[flowAgent] Used answersFileId ('${answersFileId}') for customerAnswersResponse.id`);
        } else {
            customerAnswersResponse.id = null; // Ensure id property exists
            console.warn('[flowAgent] answersFileId was not available, customerAnswersResponse.id set to null.');
        }
    }

    // The rest of the flow will use customerAnswersResponse.id for chaining,
    // and customerAnswers for content if needed.
    // For example, in Phase 2.2 Section Drafting:
    // const draftContexts = [briefFileId, analysisFileId, assignmentsFileId, questionsFileId, customerAnswersResponse.id].filter(id => id);

    console.log("[flowAgent] Phase 2.2: Starting section drafting");
    updateFlowJobStatus(currentProposalId, "Phase 2", "Section Drafting", { step: "Starting section drafting" });
    
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
    // sectionFileIds is already declared above try block
    
    try {
      responsesAgent.resetProgress();
      console.log(`[flowAgent] Starting new proposal generation (ID: ${currentProposalId})`);
      
      // Better logging for initialCustomerAnswers
      if (initialCustomerAnswers === undefined || initialCustomerAnswers === null) {
        console.log(`[flowAgent] No initial customerAnswers provided - will generate during flow.`);
      } else if (typeof initialCustomerAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerAnswers is not a string (${typeof initialCustomerAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerAnswers to string.`);
        initialCustomerAnswers = String(initialCustomerAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerAnswers: ${initialCustomerAnswers.substring(0,100)}${initialCustomerAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerAnswers length: ${initialCustomerAnswers.length} characters`);
      }
      
      // Better logging for initialCustomerReviewAnswers
      if (initialCustomerReviewAnswers === undefined || initialCustomerReviewAnswers === null) {
        console.log(`[flowAgent] No initial customerReviewAnswers provided - will generate during flow if needed.`);
      } else if (typeof initialCustomerReviewAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerReviewAnswers is not a string (${typeof initialCustomerReviewAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerReviewAnswers to string.`);
        initialCustomerReviewAnswers = String(initialCustomerReviewAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerReviewAnswers: ${initialCustomerReviewAnswers.substring(0,100)}${initialCustomerReviewAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerReviewAnswers length: ${initialCustomerReviewAnswers.length} characters`);
      }

      if (jobId && global.flowJobs && global.flowJobs[jobId]) {
        global.flowJobs[jobId].proposalId = currentProposalId;
        console.log(`[flowAgent] Associated proposal ${currentProposalId} with job ${jobId}`);
      }

      // Create a new session in the database
      const sessionData = {
        proposalId: currentProposalId,
        customerBriefId: brief && brief.id ? brief.id : null, // Assuming brief might have an id
        status: 'processing',
        metadata: { 
          jobId: jobId, // Link to the async job ID from global.flowJobs
          startTime: new Date().toISOString(),
          initialBriefSummary: brief ? { client_name: brief.client_name, project_description: brief.project_description } : null,
          hasInitialCustomerAnswers: !!initialCustomerAnswers,
          hasInitialCustomerReviewAnswers: !!initialCustomerReviewAnswers
        }
      };
      const newDbSession = await Session.create(sessionData);
      sessionId = newDbSession.id; // Store the DB session ID
      console.log(`[flowAgent] Created DB session ${sessionId} for proposal ${currentProposalId}`);

      // updateFlowJobStatus(currentProposalId, 'Setup', 'initializing', {
      //   message: 'Starting production flow',
      //   timestamp: new Date().toISOString()
      // });
      
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
      
      // console.log(`[flowAgent] Working with ${sections.length} sections: ${sections.join(', ')}`);
      
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
        "Brief Analysis",
        null,
        currentProposalId
      );
      const analysis = analysisResponse.response || "Unable to generate analysis";
      
      // Fixed parameter order: (response, phase, component) instead of (response, proposalId, componentName)
      responsesAgent.trackTokenUsage(analysisResponse, "phase1", "briefAnalysis");
      
      analysisFileId = await responsesAgent.createAndUploadFile(
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
        "Section Assignments",
        null,
        currentProposalId,
        analysisResponse.id // Pass the analysis response ID for chaining
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
        // Use our strict parseJson helper
        if (typeof assignResponse.response === 'string') {
          assignments = parseJson(assignResponse.response, "section assignments (response)");
        } else if (typeof assignResponse.text === 'string') {
          assignments = parseJson(assignResponse.text, "section assignments (text)");
        } else if (typeof assignResponse === 'string') {
          assignments = parseJson(assignResponse, "section assignments (response)");
        } else {
          throw new Error("No valid string property found in assignResponse");
        }
      } catch (error) {
        console.error(`[flowAgent] Error parsing section assignments: ${error.message}`);
        throw new Error(`Failed to parse section assignments: ${error.message}`);
      }
      
      responsesAgent.trackTokenUsage(assignResponse, "phase1", "sectionAssignments");
      
      assignmentsFileId = await responsesAgent.createAndUploadFile(
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
      let lastQuestionResponseId = null; // Track a response ID for chaining
      
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
              `Questions from ${role}`,
              null,
              currentProposalId,
              assignResponse.id // Chain from the section assignments response
            );
            
            responsesAgent.trackTokenUsage(response, currentProposalId, `phase1`, `clarifyingQuestions_${role}`);
            
            // Store response ID for chaining
            if (response.id) {
              lastQuestionResponseId = response.id;
            }
            
            let parsedQuestions;
            try {
              // Try using the parseJson helper first for robust parsing
              // Use our strict parseJson helper
              if (typeof response.response === 'string') {
                parsedQuestions = parseJson(response.response, "questions from " + role);
              } else if (typeof response.text === 'string') {
                parsedQuestions = parseJson(response.text, "questions from " + role);
              } else if (typeof response === 'string') {
                parsedQuestions = parseJson(response, "questions from " + role);
              } else {
                throw new Error("No valid string property found in response");
              }
              console.log(`[flowAgent] Successfully parsed questions JSON for ${role} with parseJson helper, found ${Array.isArray(parsedQuestions) ? parsedQuestions.length : 'non-array'} result`);
            } catch (parseError) {
              console.error(`[flowAgent] parseJson failed for ${role}: ${parseError.message}`);
              throw parseError;
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
      "Phase1_OrganizeQuestions", // Explicitly pass the phase
      currentProposalId,
      lastQuestionResponseId // Chain from a specialist question response
    );
    
    // Log details about the response for debugging
    logResponseDetails(organizedQuestionsResponse, "Question Organization");
    
    responsesAgent.trackTokenUsage(organizedQuestionsResponse, "phase1", "organizeQuestions");
    
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
      
      // For organizedQuestions
      if (typeof responseText === 'string') {
        organizedQuestions = parseJson(responseText, "organized questions");
      } else {
        throw new Error("No valid string property found for organized questions");
      }
      
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
    
    questionsFileId = await responsesAgent.createAndUploadFile(
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

    let customerAnswers; // This will hold the actual answer text/data.
    // `answersFileId` is already declared in the outer scope and initialized to null.
    // `customerAnswersResponse` is already declared in the outer scope and initialized to null.

    if (initialCustomerAnswers) {
      console.log(`[flowAgent] Processing provided initial customer answers.`);
      // Ensure initialCustomerAnswers is a string for uploading
      const answersContentString = typeof initialCustomerAnswers === 'string'
        ? initialCustomerAnswers
        : JSON.stringify(initialCustomerAnswers, null, 2);

      // Use the answersFileId from the outer scope
      answersFileId = await responsesAgent.createAndUploadFile(
        answersContentString,
        `${currentProposalId}_initial_customer_answers.json` // Assuming JSON or text
      );

      if (answersFileId) {
        console.log(`[flowAgent] Initial customer answers uploaded. File ID: ${answersFileId}`);
        customerAnswersResponse = { id: answersFileId }; // Core fix
      } else {
        console.warn("[flowAgent] Failed to upload initial customer answers file. customerAnswersResponse.id will be null.");
        customerAnswersResponse = { id: null }; // Ensure it's an object, id is null
      }
      customerAnswers = initialCustomerAnswers; // Store the raw/original answers

      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_with_initial", { answersFileId: answersFileId || null });
      console.log(`[flowAgent] Initial customer answers processed. customerAnswersResponse set to:`, customerAnswersResponse);

    } else {
      // No initial answers, proceed with generating questions and getting answers from customer/mock
      console.log(`[flowAgent] No initial customer answers provided. Generating questions for customer.`);
      
      let customerPrompt = `As our valued client, we'd like to ask you some clarifying questions about your project to ensure we create the most effective proposal for your needs. Please provide your responses to the following questions:\\n\\n`;

      try {
        // Placeholder for the logic that was originally here for generating prompt from organizedQuestions
        // and then calling an agent (e.g., customer agent or mock) to get answers.
        // This logic would set:
        // - customerAnswers (the text/content of the answers)
        // - customerAnswersResponse (the object from the agent, ideally with an .id for the file)
        // - answersFileId (from customerAnswersResponse.id or by uploading customerAnswers)
        
        // Example of how this block should be structured:
        // 1. Build the prompt for the customer using `organizedQuestions`.
        //    if (organizedQuestions && organizedQuestions.organizedQuestions) {
        //      organizedQuestions.organizedQuestions.forEach(group => {
        //        customerPrompt += `\n**${group.theme}**\n`;
        //        group.questions.forEach(q => {
        //          customerPrompt += `- ${q.question} (ID: ${q.id})\n`;
        //        });
        //      });
        //    } else {
        //      console.warn("[flowAgent] organizedQuestions is not available for customer prompt generation.");
        //      // Potentially add default questions to prompt or handle error
        //    }
        //
        // 2. Call an agent (e.g., a "CustomerInteractionAgent" or use a mock for testing)
        //    const qaAgentResponse = await safeCreateResponse(
        //      customerPrompt,
        //      [questionsFileId, briefFileId].filter(id => id), // Context for the customer agent
        //      "CustomerInteractionAgent", // Or a mock agent role
        //      "Customer Q&A",
        //      "Phase2_CustomerAnswers",
        //      currentProposalId,
        //      questionsFileId // Chaining from question organization
        //    );
        //
        // 3. Process the response
        //    if (qaAgentResponse) {
        //      customerAnswersResponse = qaAgentResponse; // This should have an .id if a file was created by the agent
        //      customerAnswers = qaAgentResponse.response || qaAgentResponse.text; // Actual answers
        //
        //      if (qaAgentResponse.id) {
        //        answersFileId = qaAgentResponse.id;
        //      } else if (customerAnswers) {
        //        // If answers were received but not as a file, upload them
        //        const answersToUpload = typeof customerAnswers === 'string' ? customerAnswers : JSON.stringify(customerAnswers, null, 2);
        //        answersFileId = await responsesAgent.createAndUploadFile(
        //          answersToUpload,
        //          `${currentProposalId}_customer_answers.json`
        //        );
        //        if (answersFileId) {
        //          // Update customerAnswersResponse if it was null or its id was null, or if it wasn't an object with an id
        //          if (!customerAnswersResponse || typeof customerAnswersResponse.id === 'undefined') {
        //             customerAnswersResponse = { id: answersFileId };
        //          } else if (customerAnswersResponse.id === null) {
        //             customerAnswersResponse.id = answersFileId;
        //          }
        //        }
        //      }
        //      console.log(`[flowAgent] Customer answers received. File ID: ${answersFileId || 'N/A'}`);
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_via_interaction", { answersFileId: answersFileId || null });
        //    } else {
        //      console.error("[flowAgent] No response from QA agent for customer questions.");
        //      customerAnswersResponse = { id: null }; // Ensure it's an object with id
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_no_qa_response");
        //    }

        console.log('[flowAgent] Customer Q&A processing logic (else branch) needs to be fully implemented here.');
        // If not implemented, ensure customerAnswersResponse is at least {id: null} if it's still null from initialization.
        if (customerAnswersResponse === null) { // Check against initial value
            console.warn('[flowAgent] customerAnswersResponse is still null after attempting Q&A (else branch). Setting to {id: null}.');
            customerAnswersResponse = { id: null };
        }

      } catch (error) {
        console.error(`[flowAgent] Error during customer Q&A (else branch): ${error.message}`);
        updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_during_interaction", { error: error.message });
        customerAnswersResponse = { id: null }; // Default on error
        // throw error; // Or re-throw if this is a critical failure
      }
    }
    
    // Ensure customerAnswersResponse is an object with an id before proceeding to use it.
    if (!customerAnswersResponse) { // Catches if it's null or undefined
        console.warn('[flowAgent] customerAnswersResponse is not set after Q&A phase (e.g. null or undefined). Defaulting to { id: null }.');
        customerAnswersResponse = { id: null };
    } else if (typeof customerAnswersResponse.id === 'undefined') { // Catches if it's an object but no 'id'
        console.warn('[flowAgent] customerAnswersResponse.id is undefined after Q&A phase. Attempting to use answersFileId or defaulting id to null. Response was:', customerAnswersResponse);
        // Try to use answersFileId if it was set (e.g. by manual upload in the 'else' branch or if initialCustomerAnswers path set it)
        if (answersFileId) {
            customerAnswersResponse.id = answersFileId;
            console.log(`[flowAgent] Used answersFileId ('${answersFileId}') for customerAnswersResponse.id`);
        } else {
            customerAnswersResponse.id = null; // Ensure id property exists
            console.warn('[flowAgent] answersFileId was not available, customerAnswersResponse.id set to null.');
        }
    }

    // The rest of the flow will use customerAnswersResponse.id for chaining,
    // and customerAnswers for content if needed.
    // For example, in Phase 2.2 Section Drafting:
    // const draftContexts = [briefFileId, analysisFileId, assignmentsFileId, questionsFileId, customerAnswersResponse.id].filter(id => id);

    console.log("[flowAgent] Phase 2.2: Starting section drafting");
    updateFlowJobStatus(currentProposalId, "Phase 2", "Section Drafting", { step: "Starting section drafting" });
    
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
    // sectionFileIds is already declared above try block
    
    try {
      responsesAgent.resetProgress();
      console.log(`[flowAgent] Starting new proposal generation (ID: ${currentProposalId})`);
      
      // Better logging for initialCustomerAnswers
      if (initialCustomerAnswers === undefined || initialCustomerAnswers === null) {
        console.log(`[flowAgent] No initial customerAnswers provided - will generate during flow.`);
      } else if (typeof initialCustomerAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerAnswers is not a string (${typeof initialCustomerAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerAnswers to string.`);
        initialCustomerAnswers = String(initialCustomerAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerAnswers: ${initialCustomerAnswers.substring(0,100)}${initialCustomerAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerAnswers length: ${initialCustomerAnswers.length} characters`);
      }
      
      // Better logging for initialCustomerReviewAnswers
      if (initialCustomerReviewAnswers === undefined || initialCustomerReviewAnswers === null) {
        console.log(`[flowAgent] No initial customerReviewAnswers provided - will generate during flow if needed.`);
      } else if (typeof initialCustomerReviewAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerReviewAnswers is not a string (${typeof initialCustomerReviewAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerReviewAnswers to string.`);
        initialCustomerReviewAnswers = String(initialCustomerReviewAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerReviewAnswers: ${initialCustomerReviewAnswers.substring(0,100)}${initialCustomerReviewAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerReviewAnswers length: ${initialCustomerReviewAnswers.length} characters`);
      }

      if (jobId && global.flowJobs && global.flowJobs[jobId]) {
        global.flowJobs[jobId].proposalId = currentProposalId;
        console.log(`[flowAgent] Associated proposal ${currentProposalId} with job ${jobId}`);
      }

      // Create a new session in the database
      const sessionData = {
        proposalId: currentProposalId,
        customerBriefId: brief && brief.id ? brief.id : null, // Assuming brief might have an id
        status: 'processing',
        metadata: { 
          jobId: jobId, // Link to the async job ID from global.flowJobs
          startTime: new Date().toISOString(),
          initialBriefSummary: brief ? { client_name: brief.client_name, project_description: brief.project_description } : null,
          hasInitialCustomerAnswers: !!initialCustomerAnswers,
          hasInitialCustomerReviewAnswers: !!initialCustomerReviewAnswers
        }
      };
      const newDbSession = await Session.create(sessionData);
      sessionId = newDbSession.id; // Store the DB session ID
      console.log(`[flowAgent] Created DB session ${sessionId} for proposal ${currentProposalId}`);

      // updateFlowJobStatus(currentProposalId, 'Setup', 'initializing', {
      //   message: 'Starting production flow',
      //   timestamp: new Date().toISOString()
      // });
      
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
      
      // console.log(`[flowAgent] Working with ${sections.length} sections: ${sections.join(', ')}`);
      
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
        "Brief Analysis",
        null,
        currentProposalId
      );
      const analysis = analysisResponse.response || "Unable to generate analysis";
      
      // Fixed parameter order: (response, phase, component) instead of (response, proposalId, componentName)
      responsesAgent.trackTokenUsage(analysisResponse, "phase1", "briefAnalysis");
      
      analysisFileId = await responsesAgent.createAndUploadFile(
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
        "Section Assignments",
        null,
        currentProposalId,
        analysisResponse.id // Pass the analysis response ID for chaining
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
        // Use our strict parseJson helper
        if (typeof assignResponse.response === 'string') {
          assignments = parseJson(assignResponse.response, "section assignments (response)");
        } else if (typeof assignResponse.text === 'string') {
          assignments = parseJson(assignResponse.text, "section assignments (text)");
        } else if (typeof assignResponse === 'string') {
          assignments = parseJson(assignResponse, "section assignments (response)");
        } else {
          throw new Error("No valid string property found in assignResponse");
        }
      } catch (error) {
        console.error(`[flowAgent] Error parsing section assignments: ${error.message}`);
        throw new Error(`Failed to parse section assignments: ${error.message}`);
      }
      
      responsesAgent.trackTokenUsage(assignResponse, "phase1", "sectionAssignments");
      
      assignmentsFileId = await responsesAgent.createAndUploadFile(
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
      let lastQuestionResponseId = null; // Track a response ID for chaining
      
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
              `Questions from ${role}`,
              null,
              currentProposalId,
              assignResponse.id // Chain from the section assignments response
            );
            
            responsesAgent.trackTokenUsage(response, currentProposalId, `phase1`, `clarifyingQuestions_${role}`);
            
            // Store response ID for chaining
            if (response.id) {
              lastQuestionResponseId = response.id;
            }
            
            let parsedQuestions;
            try {
              // Try using the parseJson helper first for robust parsing
              // Use our strict parseJson helper
              if (typeof response.response === 'string') {
                parsedQuestions = parseJson(response.response, "questions from " + role);
              } else if (typeof response.text === 'string') {
                parsedQuestions = parseJson(response.text, "questions from " + role);
              } else if (typeof response === 'string') {
                parsedQuestions = parseJson(response, "questions from " + role);
              } else {
                throw new Error("No valid string property found in response");
              }
              console.log(`[flowAgent] Successfully parsed questions JSON for ${role} with parseJson helper, found ${Array.isArray(parsedQuestions) ? parsedQuestions.length : 'non-array'} result`);
            } catch (parseError) {
              console.error(`[flowAgent] parseJson failed for ${role}: ${parseError.message}`);
              throw parseError;
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
      "Phase1_OrganizeQuestions", // Explicitly pass the phase
      currentProposalId,
      lastQuestionResponseId // Chain from a specialist question response
    );
    
    // Log details about the response for debugging
    logResponseDetails(organizedQuestionsResponse, "Question Organization");
    
    responsesAgent.trackTokenUsage(organizedQuestionsResponse, "phase1", "organizeQuestions");
    
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
      
      // For organizedQuestions
      if (typeof responseText === 'string') {
        organizedQuestions = parseJson(responseText, "organized questions");
      } else {
        throw new Error("No valid string property found for organized questions");
      }
      
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
    
    questionsFileId = await responsesAgent.createAndUploadFile(
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

    let customerAnswers; // This will hold the actual answer text/data.
    // `answersFileId` is already declared in the outer scope and initialized to null.
    // `customerAnswersResponse` is already declared in the outer scope and initialized to null.

    if (initialCustomerAnswers) {
      console.log(`[flowAgent] Processing provided initial customer answers.`);
      // Ensure initialCustomerAnswers is a string for uploading
      const answersContentString = typeof initialCustomerAnswers === 'string'
        ? initialCustomerAnswers
        : JSON.stringify(initialCustomerAnswers, null, 2);

      // Use the answersFileId from the outer scope
      answersFileId = await responsesAgent.createAndUploadFile(
        answersContentString,
        `${currentProposalId}_initial_customer_answers.json` // Assuming JSON or text
      );

      if (answersFileId) {
        console.log(`[flowAgent] Initial customer answers uploaded. File ID: ${answersFileId}`);
        customerAnswersResponse = { id: answersFileId }; // Core fix
      } else {
        console.warn("[flowAgent] Failed to upload initial customer answers file. customerAnswersResponse.id will be null.");
        customerAnswersResponse = { id: null }; // Ensure it's an object, id is null
      }
      customerAnswers = initialCustomerAnswers; // Store the raw/original answers

      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_with_initial", { answersFileId: answersFileId || null });
      console.log(`[flowAgent] Initial customer answers processed. customerAnswersResponse set to:`, customerAnswersResponse);

    } else {
      // No initial answers, proceed with generating questions and getting answers from customer/mock
      console.log(`[flowAgent] No initial customer answers provided. Generating questions for customer.`);
      
      let customerPrompt = `As our valued client, we'd like to ask you some clarifying questions about your project to ensure we create the most effective proposal for your needs. Please provide your responses to the following questions:\\n\\n`;

      try {
        // Placeholder for the logic that was originally here for generating prompt from organizedQuestions
        // and then calling an agent (e.g., customer agent or mock) to get answers.
        // This logic would set:
        // - customerAnswers (the text/content of the answers)
        // - customerAnswersResponse (the object from the agent, ideally with an .id for the file)
        // - answersFileId (from customerAnswersResponse.id or by uploading customerAnswers)
        
        // Example of how this block should be structured:
        // 1. Build the prompt for the customer using `organizedQuestions`.
        //    if (organizedQuestions && organizedQuestions.organizedQuestions) {
        //      organizedQuestions.organizedQuestions.forEach(group => {
        //        customerPrompt += `\n**${group.theme}**\n`;
        //        group.questions.forEach(q => {
        //          customerPrompt += `- ${q.question} (ID: ${q.id})\n`;
        //        });
        //      });
        //    } else {
        //      console.warn("[flowAgent] organizedQuestions is not available for customer prompt generation.");
        //      // Potentially add default questions to prompt or handle error
        //    }
        //
        // 2. Call an agent (e.g., a "CustomerInteractionAgent" or use a mock for testing)
        //    const qaAgentResponse = await safeCreateResponse(
        //      customerPrompt,
        //      [questionsFileId, briefFileId].filter(id => id), // Context for the customer agent
        //      "CustomerInteractionAgent", // Or a mock agent role
        //      "Customer Q&A",
        //      "Phase2_CustomerAnswers",
        //      currentProposalId,
        //      questionsFileId // Chaining from question organization
        //    );
        //
        // 3. Process the response
        //    if (qaAgentResponse) {
        //      customerAnswersResponse = qaAgentResponse; // This should have an .id if a file was created by the agent
        //      customerAnswers = qaAgentResponse.response || qaAgentResponse.text; // Actual answers
        //
        //      if (qaAgentResponse.id) {
        //        answersFileId = qaAgentResponse.id;
        //      } else if (customerAnswers) {
        //        // If answers were received but not as a file, upload them
        //        const answersToUpload = typeof customerAnswers === 'string' ? customerAnswers : JSON.stringify(customerAnswers, null, 2);
        //        answersFileId = await responsesAgent.createAndUploadFile(
        //          answersToUpload,
        //          `${currentProposalId}_customer_answers.json`
        //        );
        //        if (answersFileId) {
        //          // Update customerAnswersResponse if it was null or its id was null, or if it wasn't an object with an id
        //          if (!customerAnswersResponse || typeof customerAnswersResponse.id === 'undefined') {
        //             customerAnswersResponse = { id: answersFileId };
        //          } else if (customerAnswersResponse.id === null) {
        //             customerAnswersResponse.id = answersFileId;
        //          }
        //        }
        //      }
        //      console.log(`[flowAgent] Customer answers received. File ID: ${answersFileId || 'N/A'}`);
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_via_interaction", { answersFileId: answersFileId || null });
        //    } else {
        //      console.error("[flowAgent] No response from QA agent for customer questions.");
        //      customerAnswersResponse = { id: null }; // Ensure it's an object with id
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_no_qa_response");
        //    }

        console.log('[flowAgent] Customer Q&A processing logic (else branch) needs to be fully implemented here.');
        // If not implemented, ensure customerAnswersResponse is at least {id: null} if it's still null from initialization.
        if (customerAnswersResponse === null) { // Check against initial value
            console.warn('[flowAgent] customerAnswersResponse is still null after attempting Q&A (else branch). Setting to {id: null}.');
            customerAnswersResponse = { id: null };
        }

      } catch (error) {
        console.error(`[flowAgent] Error during customer Q&A (else branch): ${error.message}`);
        updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_during_interaction", { error: error.message });
        customerAnswersResponse = { id: null }; // Default on error
        // throw error; // Or re-throw if this is a critical failure
      }
    }
    
    // Ensure customerAnswersResponse is an object with an id before proceeding to use it.
    if (!customerAnswersResponse) { // Catches if it's null or undefined
        console.warn('[flowAgent] customerAnswersResponse is not set after Q&A phase (e.g. null or undefined). Defaulting to { id: null }.');
        customerAnswersResponse = { id: null };
    } else if (typeof customerAnswersResponse.id === 'undefined') { // Catches if it's an object but no 'id'
        console.warn('[flowAgent] customerAnswersResponse.id is undefined after Q&A phase. Attempting to use answersFileId or defaulting id to null. Response was:', customerAnswersResponse);
        // Try to use answersFileId if it was set (e.g. by manual upload in the 'else' branch or if initialCustomerAnswers path set it)
        if (answersFileId) {
            customerAnswersResponse.id = answersFileId;
            console.log(`[flowAgent] Used answersFileId ('${answersFileId}') for customerAnswersResponse.id`);
        } else {
            customerAnswersResponse.id = null; // Ensure id property exists
            console.warn('[flowAgent] answersFileId was not available, customerAnswersResponse.id set to null.');
        }
    }

    // The rest of the flow will use customerAnswersResponse.id for chaining,
    // and customerAnswers for content if needed.
    // For example, in Phase 2.2 Section Drafting:
    // const draftContexts = [briefFileId, analysisFileId, assignmentsFileId, questionsFileId, customerAnswersResponse.id].filter(id => id);

    console.log("[flowAgent] Phase 2.2: Starting section drafting");
    updateFlowJobStatus(currentProposalId, "Phase 2", "Section Drafting", { step: "Starting section drafting" });
    
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
    // sectionFileIds is already declared above try block
    
    try {
      responsesAgent.resetProgress();
      console.log(`[flowAgent] Starting new proposal generation (ID: ${currentProposalId})`);
      
      // Better logging for initialCustomerAnswers
      if (initialCustomerAnswers === undefined || initialCustomerAnswers === null) {
        console.log(`[flowAgent] No initial customerAnswers provided - will generate during flow.`);
      } else if (typeof initialCustomerAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerAnswers is not a string (${typeof initialCustomerAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerAnswers to string.`);
        initialCustomerAnswers = String(initialCustomerAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerAnswers: ${initialCustomerAnswers.substring(0,100)}${initialCustomerAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerAnswers length: ${initialCustomerAnswers.length} characters`);
      }
      
      // Better logging for initialCustomerReviewAnswers
      if (initialCustomerReviewAnswers === undefined || initialCustomerReviewAnswers === null) {
        console.log(`[flowAgent] No initial customerReviewAnswers provided - will generate during flow if needed.`);
      } else if (typeof initialCustomerReviewAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerReviewAnswers is not a string (${typeof initialCustomerReviewAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerReviewAnswers to string.`);
        initialCustomerReviewAnswers = String(initialCustomerReviewAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerReviewAnswers: ${initialCustomerReviewAnswers.substring(0,100)}${initialCustomerReviewAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerReviewAnswers length: ${initialCustomerReviewAnswers.length} characters`);
      }

      if (jobId && global.flowJobs && global.flowJobs[jobId]) {
        global.flowJobs[jobId].proposalId = currentProposalId;
        console.log(`[flowAgent] Associated proposal ${currentProposalId} with job ${jobId}`);
      }

      // Create a new session in the database
      const sessionData = {
        proposalId: currentProposalId,
        customerBriefId: brief && brief.id ? brief.id : null, // Assuming brief might have an id
        status: 'processing',
        metadata: { 
          jobId: jobId, // Link to the async job ID from global.flowJobs
          startTime: new Date().toISOString(),
          initialBriefSummary: brief ? { client_name: brief.client_name, project_description: brief.project_description } : null,
          hasInitialCustomerAnswers: !!initialCustomerAnswers,
          hasInitialCustomerReviewAnswers: !!initialCustomerReviewAnswers
        }
      };
      const newDbSession = await Session.create(sessionData);
      sessionId = newDbSession.id; // Store the DB session ID
      console.log(`[flowAgent] Created DB session ${sessionId} for proposal ${currentProposalId}`);

      // updateFlowJobStatus(currentProposalId, 'Setup', 'initializing', {
      //   message: 'Starting production flow',
      //   timestamp: new Date().toISOString()
      // });
      
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
      
      // console.log(`[flowAgent] Working with ${sections.length} sections: ${sections.join(', ')}`);
      
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
        "Brief Analysis",
        null,
        currentProposalId
      );
      const analysis = analysisResponse.response || "Unable to generate analysis";
      
      // Fixed parameter order: (response, phase, component) instead of (response, proposalId, componentName)
      responsesAgent.trackTokenUsage(analysisResponse, "phase1", "briefAnalysis");
      
      analysisFileId = await responsesAgent.createAndUploadFile(
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
        "Section Assignments",
        null,
        currentProposalId,
        analysisResponse.id // Pass the analysis response ID for chaining
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
        // Use our strict parseJson helper
        if (typeof assignResponse.response === 'string') {
          assignments = parseJson(assignResponse.response, "section assignments (response)");
        } else if (typeof assignResponse.text === 'string') {
          assignments = parseJson(assignResponse.text, "section assignments (text)");
        } else if (typeof assignResponse === 'string') {
          assignments = parseJson(assignResponse, "section assignments (response)");
        } else {
          throw new Error("No valid string property found in assignResponse");
        }
      } catch (error) {
        console.error(`[flowAgent] Error parsing section assignments: ${error.message}`);
        throw new Error(`Failed to parse section assignments: ${error.message}`);
      }
      
      responsesAgent.trackTokenUsage(assignResponse, "phase1", "sectionAssignments");
      
      assignmentsFileId = await responsesAgent.createAndUploadFile(
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
      let lastQuestionResponseId = null; // Track a response ID for chaining
      
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
              `Questions from ${role}`,
              null,
              currentProposalId,
              assignResponse.id // Chain from the section assignments response
            );
            
            responsesAgent.trackTokenUsage(response, currentProposalId, `phase1`, `clarifyingQuestions_${role}`);
            
            // Store response ID for chaining
            if (response.id) {
              lastQuestionResponseId = response.id;
            }
            
            let parsedQuestions;
            try {
              // Try using the parseJson helper first for robust parsing
              // Use our strict parseJson helper
              if (typeof response.response === 'string') {
                parsedQuestions = parseJson(response.response, "questions from " + role);
              } else if (typeof response.text === 'string') {
                parsedQuestions = parseJson(response.text, "questions from " + role);
              } else if (typeof response === 'string') {
                parsedQuestions = parseJson(response, "questions from " + role);
              } else {
                throw new Error("No valid string property found in response");
              }
              console.log(`[flowAgent] Successfully parsed questions JSON for ${role} with parseJson helper, found ${Array.isArray(parsedQuestions) ? parsedQuestions.length : 'non-array'} result`);
            } catch (parseError) {
              console.error(`[flowAgent] parseJson failed for ${role}: ${parseError.message}`);
              throw parseError;
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
      "Phase1_OrganizeQuestions", // Explicitly pass the phase
      currentProposalId,
      lastQuestionResponseId // Chain from a specialist question response
    );
    
    // Log details about the response for debugging
    logResponseDetails(organizedQuestionsResponse, "Question Organization");
    
    responsesAgent.trackTokenUsage(organizedQuestionsResponse, "phase1", "organizeQuestions");
    
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
      
      // For organizedQuestions
      if (typeof responseText === 'string') {
        organizedQuestions = parseJson(responseText, "organized questions");
      } else {
        throw new Error("No valid string property found for organized questions");
      }
      
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
    
    questionsFileId = await responsesAgent.createAndUploadFile(
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

    let customerAnswers; // This will hold the actual answer text/data.
    // `answersFileId` is already declared in the outer scope and initialized to null.
    // `customerAnswersResponse` is already declared in the outer scope and initialized to null.

    if (initialCustomerAnswers) {
      console.log(`[flowAgent] Processing provided initial customer answers.`);
      // Ensure initialCustomerAnswers is a string for uploading
      const answersContentString = typeof initialCustomerAnswers === 'string'
        ? initialCustomerAnswers
        : JSON.stringify(initialCustomerAnswers, null, 2);

      // Use the answersFileId from the outer scope
      answersFileId = await responsesAgent.createAndUploadFile(
        answersContentString,
        `${currentProposalId}_initial_customer_answers.json` // Assuming JSON or text
      );

      if (answersFileId) {
        console.log(`[flowAgent] Initial customer answers uploaded. File ID: ${answersFileId}`);
        customerAnswersResponse = { id: answersFileId }; // Core fix
      } else {
        console.warn("[flowAgent] Failed to upload initial customer answers file. customerAnswersResponse.id will be null.");
        customerAnswersResponse = { id: null }; // Ensure it's an object, id is null
      }
      customerAnswers = initialCustomerAnswers; // Store the raw/original answers

      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_with_initial", { answersFileId: answersFileId || null });
      console.log(`[flowAgent] Initial customer answers processed. customerAnswersResponse set to:`, customerAnswersResponse);

    } else {
      // No initial answers, proceed with generating questions and getting answers from customer/mock
      console.log(`[flowAgent] No initial customer answers provided. Generating questions for customer.`);
      
      let customerPrompt = `As our valued client, we'd like to ask you some clarifying questions about your project to ensure we create the most effective proposal for your needs. Please provide your responses to the following questions:\\n\\n`;

      try {
        // Placeholder for the logic that was originally here for generating prompt from organizedQuestions
        // and then calling an agent (e.g., customer agent or mock) to get answers.
        // This logic would set:
        // - customerAnswers (the text/content of the answers)
        // - customerAnswersResponse (the object from the agent, ideally with an .id for the file)
        // - answersFileId (from customerAnswersResponse.id or by uploading customerAnswers)
        
        // Example of how this block should be structured:
        // 1. Build the prompt for the customer using `organizedQuestions`.
        //    if (organizedQuestions && organizedQuestions.organizedQuestions) {
        //      organizedQuestions.organizedQuestions.forEach(group => {
        //        customerPrompt += `\n**${group.theme}**\n`;
        //        group.questions.forEach(q => {
        //          customerPrompt += `- ${q.question} (ID: ${q.id})\n`;
        //        });
        //      });
        //    } else {
        //      console.warn("[flowAgent] organizedQuestions is not available for customer prompt generation.");
        //      // Potentially add default questions to prompt or handle error
        //    }
        //
        // 2. Call an agent (e.g., a "CustomerInteractionAgent" or use a mock for testing)
        //    const qaAgentResponse = await safeCreateResponse(
        //      customerPrompt,
        //      [questionsFileId, briefFileId].filter(id => id), // Context for the customer agent
        //      "CustomerInteractionAgent", // Or a mock agent role
        //      "Customer Q&A",
        //      "Phase2_CustomerAnswers",
        //      currentProposalId,
        //      questionsFileId // Chaining from question organization
        //    );
        //
        // 3. Process the response
        //    if (qaAgentResponse) {
        //      customerAnswersResponse = qaAgentResponse; // This should have an .id if a file was created by the agent
        //      customerAnswers = qaAgentResponse.response || qaAgentResponse.text; // Actual answers
        //
        //      if (qaAgentResponse.id) {
        //        answersFileId = qaAgentResponse.id;
        //      } else if (customerAnswers) {
        //        // If answers were received but not as a file, upload them
        //        const answersToUpload = typeof customerAnswers === 'string' ? customerAnswers : JSON.stringify(customerAnswers, null, 2);
        //        answersFileId = await responsesAgent.createAndUploadFile(
        //          answersToUpload,
        //          `${currentProposalId}_customer_answers.json`
        //        );
        //        if (answersFileId) {
        //          // Update customerAnswersResponse if it was null or its id was null, or if it wasn't an object with an id
        //          if (!customerAnswersResponse || typeof customerAnswersResponse.id === 'undefined') {
        //             customerAnswersResponse = { id: answersFileId };
        //          } else if (customerAnswersResponse.id === null) {
        //             customerAnswersResponse.id = answersFileId;
        //          }
        //        }
        //      }
        //      console.log(`[flowAgent] Customer answers received. File ID: ${answersFileId || 'N/A'}`);
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_via_interaction", { answersFileId: answersFileId || null });
        //    } else {
        //      console.error("[flowAgent] No response from QA agent for customer questions.");
        //      customerAnswersResponse = { id: null }; // Ensure it's an object with id
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_no_qa_response");
        //    }

        console.log('[flowAgent] Customer Q&A processing logic (else branch) needs to be fully implemented here.');
        // If not implemented, ensure customerAnswersResponse is at least {id: null} if it's still null from initialization.
        if (customerAnswersResponse === null) { // Check against initial value
            console.warn('[flowAgent] customerAnswersResponse is still null after attempting Q&A (else branch). Setting to {id: null}.');
            customerAnswersResponse = { id: null };
        }

      } catch (error) {
        console.error(`[flowAgent] Error during customer Q&A (else branch): ${error.message}`);
        updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_during_interaction", { error: error.message });
        customerAnswersResponse = { id: null }; // Default on error
        // throw error; // Or re-throw if this is a critical failure
      }
    }
    
    // Ensure customerAnswersResponse is an object with an id before proceeding to use it.
    if (!customerAnswersResponse) { // Catches if it's null or undefined
        console.warn('[flowAgent] customerAnswersResponse is not set after Q&A phase (e.g. null or undefined). Defaulting to { id: null }.');
        customerAnswersResponse = { id: null };
    } else if (typeof customerAnswersResponse.id === 'undefined') { // Catches if it's an object but no 'id'
        console.warn('[flowAgent] customerAnswersResponse.id is undefined after Q&A phase. Attempting to use answersFileId or defaulting id to null. Response was:', customerAnswersResponse);
        // Try to use answersFileId if it was set (e.g. by manual upload in the 'else' branch or if initialCustomerAnswers path set it)
        if (answersFileId) {
            customerAnswersResponse.id = answersFileId;
            console.log(`[flowAgent] Used answersFileId ('${answersFileId}') for customerAnswersResponse.id`);
        } else {
            customerAnswersResponse.id = null; // Ensure id property exists
            console.warn('[flowAgent] answersFileId was not available, customerAnswersResponse.id set to null.');
        }
    }

    // The rest of the flow will use customerAnswersResponse.id for chaining,
    // and customerAnswers for content if needed.
    // For example, in Phase 2.2 Section Drafting:
    // const draftContexts = [briefFileId, analysisFileId, assignmentsFileId, questionsFileId, customerAnswersResponse.id].filter(id => id);

    console.log("[flowAgent] Phase 2.2: Starting section drafting");
    updateFlowJobStatus(currentProposalId, "Phase 2", "Section Drafting", { step: "Starting section drafting" });
    
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
    // sectionFileIds is already declared above try block
    
    try {
      responsesAgent.resetProgress();
      console.log(`[flowAgent] Starting new proposal generation (ID: ${currentProposalId})`);
      
      // Better logging for initialCustomerAnswers
      if (initialCustomerAnswers === undefined || initialCustomerAnswers === null) {
        console.log(`[flowAgent] No initial customerAnswers provided - will generate during flow.`);
      } else if (typeof initialCustomerAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerAnswers is not a string (${typeof initialCustomerAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerAnswers to string.`);
        initialCustomerAnswers = String(initialCustomerAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerAnswers: ${initialCustomerAnswers.substring(0,100)}${initialCustomerAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerAnswers length: ${initialCustomerAnswers.length} characters`);
      }
      
      // Better logging for initialCustomerReviewAnswers
      if (initialCustomerReviewAnswers === undefined || initialCustomerReviewAnswers === null) {
        console.log(`[flowAgent] No initial customerReviewAnswers provided - will generate during flow if needed.`);
      } else if (typeof initialCustomerReviewAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerReviewAnswers is not a string (${typeof initialCustomerReviewAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerReviewAnswers to string.`);
        initialCustomerReviewAnswers = String(initialCustomerReviewAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerReviewAnswers: ${initialCustomerReviewAnswers.substring(0,100)}${initialCustomerReviewAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerReviewAnswers length: ${initialCustomerReviewAnswers.length} characters`);
      }

      if (jobId && global.flowJobs && global.flowJobs[jobId]) {
        global.flowJobs[jobId].proposalId = currentProposalId;
        console.log(`[flowAgent] Associated proposal ${currentProposalId} with job ${jobId}`);
      }

      // Create a new session in the database
      const sessionData = {
        proposalId: currentProposalId,
        customerBriefId: brief && brief.id ? brief.id : null, // Assuming brief might have an id
        status: 'processing',
        metadata: { 
          jobId: jobId, // Link to the async job ID from global.flowJobs
          startTime: new Date().toISOString(),
          initialBriefSummary: brief ? { client_name: brief.client_name, project_description: brief.project_description } : null,
          hasInitialCustomerAnswers: !!initialCustomerAnswers,
          hasInitialCustomerReviewAnswers: !!initialCustomerReviewAnswers
        }
      };
      const newDbSession = await Session.create(sessionData);
      sessionId = newDbSession.id; // Store the DB session ID
      console.log(`[flowAgent] Created DB session ${sessionId} for proposal ${currentProposalId}`);

      // updateFlowJobStatus(currentProposalId, 'Setup', 'initializing', {
      //   message: 'Starting production flow',
      //   timestamp: new Date().toISOString()
      // });
      
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
      
      // console.log(`[flowAgent] Working with ${sections.length} sections: ${sections.join(', ')}`);
      
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
        "Brief Analysis",
        null,
        currentProposalId
      );
      const analysis = analysisResponse.response || "Unable to generate analysis";
      
      // Fixed parameter order: (response, phase, component) instead of (response, proposalId, componentName)
      responsesAgent.trackTokenUsage(analysisResponse, "phase1", "briefAnalysis");
      
      analysisFileId = await responsesAgent.createAndUploadFile(
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
        "Section Assignments",
        null,
        currentProposalId,
        analysisResponse.id // Pass the analysis response ID for chaining
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
        // Use our strict parseJson helper
        if (typeof assignResponse.response === 'string') {
          assignments = parseJson(assignResponse.response, "section assignments (response)");
        } else if (typeof assignResponse.text === 'string') {
          assignments = parseJson(assignResponse.text, "section assignments (text)");
        } else if (typeof assignResponse === 'string') {
          assignments = parseJson(assignResponse, "section assignments (response)");
        } else {
          throw new Error("No valid string property found in assignResponse");
        }
      } catch (error) {
        console.error(`[flowAgent] Error parsing section assignments: ${error.message}`);
        throw new Error(`Failed to parse section assignments: ${error.message}`);
      }
      
      responsesAgent.trackTokenUsage(assignResponse, "phase1", "sectionAssignments");
      
      assignmentsFileId = await responsesAgent.createAndUploadFile(
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
      let lastQuestionResponseId = null; // Track a response ID for chaining
      
      for (const role of specialistRoles) {
        const questionPrompt = `As a ${role.replace('sp_', '')}, review the customer brief and generate 3-5 important strategic clarifying questions that would help you better understand the customer's needs and provide an expert proposal. 
    
Your questions should:
- Be relevant to your specific expertise and role
- Focus on understanding business needs, constraints, and priorities
- Cover different aspects of the project that need clarification
- NOT ask how to write orstructure the proposal
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
              `Questions from ${role}`,
              null,
              currentProposalId,
              assignResponse.id // Chain from the section assignments response
            );
            
            responsesAgent.trackTokenUsage(response, currentProposalId, `phase1`, `clarifyingQuestions_${role}`);
            
            // Store response ID for chaining
            if (response.id) {
              lastQuestionResponseId = response.id;
            }
            
            let parsedQuestions;
            try {
              // Try using the parseJson helper first for robust parsing
              // Use our strict parseJson helper
              if (typeof response.response === 'string') {
                parsedQuestions = parseJson(response.response, "questions from " + role);
              } else if (typeof response.text === 'string') {
                parsedQuestions = parseJson(response.text, "questions from " + role);
              } else if (typeof response === 'string') {
                parsedQuestions = parseJson(response, "questions from " + role);
              } else {
                throw new Error("No valid string property found in response");
              }
              console.log(`[flowAgent] Successfully parsed questions JSON for ${role} with parseJson helper, found ${Array.isArray(parsedQuestions) ? parsedQuestions.length : 'non-array'} result`);
            } catch (parseError) {
              console.error(`[flowAgent] parseJson failed for ${role}: ${parseError.message}`);
              throw parseError;
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
      "Phase1_OrganizeQuestions", // Explicitly pass the phase
      currentProposalId,
      lastQuestionResponseId // Chain from a specialist question response
    );
    
    // Log details about the response for debugging
    logResponseDetails(organizedQuestionsResponse, "Question Organization");
    
    responsesAgent.trackTokenUsage(organizedQuestionsResponse, "phase1", "organizeQuestions");
    
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
      
      // For organizedQuestions
      if (typeof responseText === 'string') {
        organizedQuestions = parseJson(responseText, "organized questions");
      } else {
        throw new Error("No valid string property found for organized questions");
      }
      
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
    
    questionsFileId = await responsesAgent.createAndUploadFile(
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

    let customerAnswers; // This will hold the actual answer text/data.
    // `answersFileId` is already declared in the outer scope and initialized to null.
    // `customerAnswersResponse` is already declared in the outer scope and initialized to null.

    if (initialCustomerAnswers) {
      console.log(`[flowAgent] Processing provided initial customer answers.`);
      // Ensure initialCustomerAnswers is a string for uploading
      const answersContentString = typeof initialCustomerAnswers === 'string'
        ? initialCustomerAnswers
        : JSON.stringify(initialCustomerAnswers, null, 2);

      // Use the answersFileId from the outer scope
      answersFileId = await responsesAgent.createAndUploadFile(
        answersContentString,
        `${currentProposalId}_initial_customer_answers.json` // Assuming JSON or text
      );

      if (answersFileId) {
        console.log(`[flowAgent] Initial customer answers uploaded. File ID: ${answersFileId}`);
        customerAnswersResponse = { id: answersFileId }; // Core fix
      } else {
        console.warn("[flowAgent] Failed to upload initial customer answers file. customerAnswersResponse.id will be null.");
        customerAnswersResponse = { id: null }; // Ensure it's an object, id is null
      }
      customerAnswers = initialCustomerAnswers; // Store the raw/original answers

      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_with_initial", { answersFileId: answersFileId || null });
      console.log(`[flowAgent] Initial customer answers processed. customerAnswersResponse set to:`, customerAnswersResponse);

    } else {
      // No initial answers, proceed with generating questions and getting answers from customer/mock
      console.log(`[flowAgent] No initial customer answers provided. Generating questions for customer.`);
      
      let customerPrompt = `As our valued client, we'd like to ask you some clarifying questions about your project to ensure we create the most effective proposal for your needs. Please provide your responses to the following questions:\\n\\n`;

      try {
        // Placeholder for the logic that was originally here for generating prompt from organizedQuestions
        // and then calling an agent (e.g., customer agent or mock) to get answers.
        // This logic would set:
        // - customerAnswers (the text/content of the answers)
        // - customerAnswersResponse (the object from the agent, ideally with an .id for the file)
        // - answersFileId (from customerAnswersResponse.id or by uploading customerAnswers)
        
        // Example of how this block should be structured:
        // 1. Build the prompt for the customer using `organizedQuestions`.
        //    if (organizedQuestions && organizedQuestions.organizedQuestions) {
        //      organizedQuestions.organizedQuestions.forEach(group => {
        //        customerPrompt += `\n**${group.theme}**\n`;
        //        group.questions.forEach(q => {
        //          customerPrompt += `- ${q.question} (ID: ${q.id})\n`;
        //        });
        //      });
        //    } else {
        //      console.warn("[flowAgent] organizedQuestions is not available for customer prompt generation.");
        //      // Potentially add default questions to prompt or handle error
        //    }
        //
        // 2. Call an agent (e.g., a "CustomerInteractionAgent" or use a mock for testing)
        //    const qaAgentResponse = await safeCreateResponse(
        //      customerPrompt,
        //      [questionsFileId, briefFileId].filter(id => id), // Context for the customer agent
        //      "CustomerInteractionAgent", // Or a mock agent role
        //      "Customer Q&A",
        //      "Phase2_CustomerAnswers",
        //      currentProposalId,
        //      questionsFileId // Chaining from question organization
        //    );
        //
        // 3. Process the response
        //    if (qaAgentResponse) {
        //      customerAnswersResponse = qaAgentResponse; // This should have an .id if a file was created by the agent
        //      customerAnswers = qaAgentResponse.response || qaAgentResponse.text; // Actual answers
        //
        //      if (qaAgentResponse.id) {
        //        answersFileId = qaAgentResponse.id;
        //      } else if (customerAnswers) {
        //        // If answers were received but not as a file, upload them
        //        const answersToUpload = typeof customerAnswers === 'string' ? customerAnswers : JSON.stringify(customerAnswers, null, 2);
        //        answersFileId = await responsesAgent.createAndUploadFile(
        //          answersToUpload,
        //          `${currentProposalId}_customer_answers.json`
        //        );
        //        if (answersFileId) {
        //          // Update customerAnswersResponse if it was null or its id was null, or if it wasn't an object with an id
        //          if (!customerAnswersResponse || typeof customerAnswersResponse.id === 'undefined') {
        //             customerAnswersResponse = { id: answersFileId };
        //          } else if (customerAnswersResponse.id === null) {
        //             customerAnswersResponse.id = answersFileId;
        //          }
        //        }
        //      }
        //      console.log(`[flowAgent] Customer answers received. File ID: ${answersFileId || 'N/A'}`);
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_via_interaction", { answersFileId: answersFileId || null });
        //    } else {
        //      console.error("[flowAgent] No response from QA agent for customer questions.");
        //      customerAnswersResponse = { id: null }; // Ensure it's an object with id
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_no_qa_response");
        //    }

        console.log('[flowAgent] Customer Q&A processing logic (else branch) needs to be fully implemented here.');
        // If not implemented, ensure customerAnswersResponse is at least {id: null} if it's still null from initialization.
        if (customerAnswersResponse === null) { // Check against initial value
            console.warn('[flowAgent] customerAnswersResponse is still null after attempting Q&A (else branch). Setting to {id: null}.');
            customerAnswersResponse = { id: null };
        }

      } catch (error) {
        console.error(`[flowAgent] Error during customer Q&A (else branch): ${error.message}`);
        updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_during_interaction", { error: error.message });
        customerAnswersResponse = { id: null }; // Default on error
        // throw error; // Or re-throw if this is a critical failure
      }
    }
    
    // Ensure customerAnswersResponse is an object with an id before proceeding to use it.
    if (!customerAnswersResponse) { // Catches if it's null or undefined
        console.warn('[flowAgent] customerAnswersResponse is not set after Q&A phase (e.g. null or undefined). Defaulting to { id: null }.');
        customerAnswersResponse = { id: null };
    } else if (typeof customerAnswersResponse.id === 'undefined') { // Catches if it's an object but no 'id'
        console.warn('[flowAgent] customerAnswersResponse.id is undefined after Q&A phase. Attempting to use answersFileId or defaulting id to null. Response was:', customerAnswersResponse);
        // Try to use answersFileId if it was set (e.g. by manual upload in the 'else' branch or if initialCustomerAnswers path set it)
        if (answersFileId) {
            customerAnswersResponse.id = answersFileId;
            console.log(`[flowAgent] Used answersFileId ('${answersFileId}') for customerAnswersResponse.id`);
        } else {
            customerAnswersResponse.id = null; // Ensure id property exists
            console.warn('[flowAgent] answersFileId was not available, customerAnswersResponse.id set to null.');
        }
    }

    // The rest of the flow will use customerAnswersResponse.id for chaining,
    // and customerAnswers for content if needed.
    // For example, in Phase 2.2 Section Drafting:
    // const draftContexts = [briefFileId, analysisFileId, assignmentsFileId, questionsFileId, customerAnswersResponse.id].filter(id => id);

    console.log("[flowAgent] Phase 2.2: Starting section drafting");
    updateFlowJobStatus(currentProposalId, "Phase 2", "Section Drafting", { step: "Starting section drafting" });
    
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
    // sectionFileIds is already declared above try block
    
    try {
      responsesAgent.resetProgress();
      console.log(`[flowAgent] Starting new proposal generation (ID: ${currentProposalId})`);
      
      // Better logging for initialCustomerAnswers
      if (initialCustomerAnswers === undefined || initialCustomerAnswers === null) {
        console.log(`[flowAgent] No initial customerAnswers provided - will generate during flow.`);
      } else if (typeof initialCustomerAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerAnswers is not a string (${typeof initialCustomerAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerAnswers to string.`);
        initialCustomerAnswers = String(initialCustomerAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerAnswers: ${initialCustomerAnswers.substring(0,100)}${initialCustomerAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerAnswers length: ${initialCustomerAnswers.length} characters`);
      }
      
      // Better logging for initialCustomerReviewAnswers
      if (initialCustomerReviewAnswers === undefined || initialCustomerReviewAnswers === null) {
        console.log(`[flowAgent] No initial customerReviewAnswers provided - will generate during flow if needed.`);
      } else if (typeof initialCustomerReviewAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerReviewAnswers is not a string (${typeof initialCustomerReviewAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerReviewAnswers to string.`);
        initialCustomerReviewAnswers = String(initialCustomerReviewAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerReviewAnswers: ${initialCustomerReviewAnswers.substring(0,100)}${initialCustomerReviewAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerReviewAnswers length: ${initialCustomerReviewAnswers.length} characters`);
      }

      if (jobId && global.flowJobs && global.flowJobs[jobId]) {
        global.flowJobs[jobId].proposalId = currentProposalId;
        console.log(`[flowAgent] Associated proposal ${currentProposalId} with job ${jobId}`);
      }

      // Create a new session in the database
      const sessionData = {
        proposalId: currentProposalId,
        customerBriefId: brief && brief.id ? brief.id : null, // Assuming brief might have an id
        status: 'processing',
        metadata: { 
          jobId: jobId, // Link to the async job ID from global.flowJobs
          startTime: new Date().toISOString(),
          initialBriefSummary: brief ? { client_name: brief.client_name, project_description: brief.project_description } : null,
          hasInitialCustomerAnswers: !!initialCustomerAnswers,
          hasInitialCustomerReviewAnswers: !!initialCustomerReviewAnswers
        }
      };
      const newDbSession = await Session.create(sessionData);
      sessionId = newDbSession.id; // Store the DB session ID
      console.log(`[flowAgent] Created DB session ${sessionId} for proposal ${currentProposalId}`);

      // updateFlowJobStatus(currentProposalId, 'Setup', 'initializing', {
      //   message: 'Starting production flow',
      //   timestamp: new Date().toISOString()
      // });
      
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
      
      // console.log(`[flowAgent] Working with ${sections.length} sections: ${sections.join(', ')}`);
      
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
        "Brief Analysis",
        null,
        currentProposalId
      );
      const analysis = analysisResponse.response || "Unable to generate analysis";
      
      // Fixed parameter order: (response, phase, component) instead of (response, proposalId, componentName)
      responsesAgent.trackTokenUsage(analysisResponse, "phase1", "briefAnalysis");
      
      analysisFileId = await responsesAgent.createAndUploadFile(
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
        "Section Assignments",
        null,
        currentProposalId,
        analysisResponse.id // Pass the analysis response ID for chaining
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
        // Use our strict parseJson helper
        if (typeof assignResponse.response === 'string') {
          assignments = parseJson(assignResponse.response, "section assignments (response)");
        } else if (typeof assignResponse.text === 'string') {
          assignments = parseJson(assignResponse.text, "section assignments (text)");
        } else if (typeof assignResponse === 'string') {
          assignments = parseJson(assignResponse, "section assignments (response)");
        } else {
          throw new Error("No valid string property found in assignResponse");
        }
      } catch (error) {
        console.error(`[flowAgent] Error parsing section assignments: ${error.message}`);
        throw new Error(`Failed to parse section assignments: ${error.message}`);
      }
      
      responsesAgent.trackTokenUsage(assignResponse, "phase1", "sectionAssignments");
      
      assignmentsFileId = await responsesAgent.createAndUploadFile(
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
      let lastQuestionResponseId = null; // Track a response ID for chaining
      
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
              `Questions from ${role}`,
              null,
              currentProposalId,
              assignResponse.id // Chain from the section assignments response
            );
            
            responsesAgent.trackTokenUsage(response, currentProposalId, `phase1`, `clarifyingQuestions_${role}`);
            
            // Store response ID for chaining
            if (response.id) {
              lastQuestionResponseId = response.id;
            }
            
            let parsedQuestions;
            try {
              // Try using the parseJson helper first for robust parsing
              // Use our strict parseJson helper
              if (typeof response.response === 'string') {
                parsedQuestions = parseJson(response.response, "questions from " + role);
              } else if (typeof response.text === 'string') {
                parsedQuestions = parseJson(response.text, "questions from " + role);
              } else if (typeof response === 'string') {
                parsedQuestions = parseJson(response, "questions from " + role);
              } else {
                throw new Error("No valid string property found in response");
              }
              console.log(`[flowAgent] Successfully parsed questions JSON for ${role} with parseJson helper, found ${Array.isArray(parsedQuestions) ? parsedQuestions.length : 'non-array'} result`);
            } catch (parseError) {
              console.error(`[flowAgent] parseJson failed for ${role}: ${parseError.message}`);
              throw parseError;
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
      "Phase1_OrganizeQuestions", // Explicitly pass the phase
      currentProposalId,
      lastQuestionResponseId // Chain from a specialist question response
    );
    
    // Log details about the response for debugging
    logResponseDetails(organizedQuestionsResponse, "Question Organization");
    
    responsesAgent.trackTokenUsage(organizedQuestionsResponse, "phase1", "organizeQuestions");
    
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
      
      // For organizedQuestions
      if (typeof responseText === 'string') {
        organizedQuestions = parseJson(responseText, "organized questions");
      } else {
        throw new Error("No valid string property found for organized questions");
      }
      
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
    
    questionsFileId = await responsesAgent.createAndUploadFile(
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

    let customerAnswers; // This will hold the actual answer text/data.
    // `answersFileId` is already declared in the outer scope and initialized to null.
    // `customerAnswersResponse` is already declared in the outer scope and initialized to null.

    if (initialCustomerAnswers) {
      console.log(`[flowAgent] Processing provided initial customer answers.`);
      // Ensure initialCustomerAnswers is a string for uploading
      const answersContentString = typeof initialCustomerAnswers === 'string'
        ? initialCustomerAnswers
        : JSON.stringify(initialCustomerAnswers, null, 2);

      // Use the answersFileId from the outer scope
      answersFileId = await responsesAgent.createAndUploadFile(
        answersContentString,
        `${currentProposalId}_initial_customer_answers.json` // Assuming JSON or text
      );

      if (answersFileId) {
        console.log(`[flowAgent] Initial customer answers uploaded. File ID: ${answersFileId}`);
        customerAnswersResponse = { id: answersFileId }; // Core fix
      } else {
        console.warn("[flowAgent] Failed to upload initial customer answers file. customerAnswersResponse.id will be null.");
        customerAnswersResponse = { id: null }; // Ensure it's an object, id is null
      }
      customerAnswers = initialCustomerAnswers; // Store the raw/original answers

      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_with_initial", { answersFileId: answersFileId || null });
      console.log(`[flowAgent] Initial customer answers processed. customerAnswersResponse set to:`, customerAnswersResponse);

    } else {
      // No initial answers, proceed with generating questions and getting answers from customer/mock
      console.log(`[flowAgent] No initial customer answers provided. Generating questions for customer.`);
      
      let customerPrompt = `As our valued client, we'd like to ask you some clarifying questions about your project to ensure we create the most effective proposal for your needs. Please provide your responses to the following questions:\\n\\n`;

      try {
        // Placeholder for the logic that was originally here for generating prompt from organizedQuestions
        // and then calling an agent (e.g., customer agent or mock) to get answers.
        // This logic would set:
        // - customerAnswers (the text/content of the answers)
        // - customerAnswersResponse (the object from the agent, ideally with an .id for the file)
        // - answersFileId (from customerAnswersResponse.id or by uploading customerAnswers)
        
        // Example of how this block should be structured:
        // 1. Build the prompt for the customer using `organizedQuestions`.
        //    if (organizedQuestions && organizedQuestions.organizedQuestions) {
        //      organizedQuestions.organizedQuestions.forEach(group => {
        //        customerPrompt += `\n**${group.theme}**\n`;
        //        group.questions.forEach(q => {
        //          customerPrompt += `- ${q.question} (ID: ${q.id})\n`;
        //        });
        //      });
        //    } else {
        //      console.warn("[flowAgent] organizedQuestions is not available for customer prompt generation.");
        //      // Potentially add default questions to prompt or handle error
        //    }
        //
        // 2. Call an agent (e.g., a "CustomerInteractionAgent" or use a mock for testing)
        //    const qaAgentResponse = await safeCreateResponse(
        //      customerPrompt,
        //      [questionsFileId, briefFileId].filter(id => id), // Context for the customer agent
        //      "CustomerInteractionAgent", // Or a mock agent role
        //      "Customer Q&A",
        //      "Phase2_CustomerAnswers",
        //      currentProposalId,
        //      questionsFileId // Chaining from question organization
        //    );
        //
        // 3. Process the response
        //    if (qaAgentResponse) {
        //      customerAnswersResponse = qaAgentResponse; // This should have an .id if a file was created by the agent
        //      customerAnswers = qaAgentResponse.response || qaAgentResponse.text; // Actual answers
        //
        //      if (qaAgentResponse.id) {
        //        answersFileId = qaAgentResponse.id;
        //      } else if (customerAnswers) {
        //        // If answers were received but not as a file, upload them
        //        const answersToUpload = typeof customerAnswers === 'string' ? customerAnswers : JSON.stringify(customerAnswers, null, 2);
        //        answersFileId = await responsesAgent.createAndUploadFile(
        //          answersToUpload,
        //          `${currentProposalId}_customer_answers.json`
        //        );
        //        if (answersFileId) {
        //          // Update customerAnswersResponse if it was null or its id was null, or if it wasn't an object with an id
        //          if (!customerAnswersResponse || typeof customerAnswersResponse.id === 'undefined') {
        //             customerAnswersResponse = { id: answersFileId };
        //          } else if (customerAnswersResponse.id === null) {
        //             customerAnswersResponse.id = answersFileId;
        //          }
        //        }
        //      }
        //      console.log(`[flowAgent] Customer answers received. File ID: ${answersFileId || 'N/A'}`);
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_via_interaction", { answersFileId: answersFileId || null });
        //    } else {
        //      console.error("[flowAgent] No response from QA agent for customer questions.");
        //      customerAnswersResponse = { id: null }; // Ensure it's an object with id
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_no_qa_response");
        //    }

        console.log('[flowAgent] Customer Q&A processing logic (else branch) needs to be fully implemented here.');
        // If not implemented, ensure customerAnswersResponse is at least {id: null} if it's still null from initialization.
        if (customerAnswersResponse === null) { // Check against initial value
            console.warn('[flowAgent] customerAnswersResponse is still null after attempting Q&A (else branch). Setting to {id: null}.');
            customerAnswersResponse = { id: null };
        }

      } catch (error) {
        console.error(`[flowAgent] Error during customer Q&A (else branch): ${error.message}`);
        updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_during_interaction", { error: error.message });
        customerAnswersResponse = { id: null }; // Default on error
        // throw error; // Or re-throw if this is a critical failure
      }
    }
    
    // Ensure customerAnswersResponse is an object with an id before proceeding to use it.
    if (!customerAnswersResponse) { // Catches if it's null or undefined
        console.warn('[flowAgent] customerAnswersResponse is not set after Q&A phase (e.g. null or undefined). Defaulting to { id: null }.');
        customerAnswersResponse = { id: null };
    } else if (typeof customerAnswersResponse.id === 'undefined') { // Catches if it's an object but no 'id'
        console.warn('[flowAgent] customerAnswersResponse.id is undefined after Q&A phase. Attempting to use answersFileId or defaulting id to null. Response was:', customerAnswersResponse);
        // Try to use answersFileId if it was set (e.g. by manual upload in the 'else' branch or if initialCustomerAnswers path set it)
        if (answersFileId) {
            customerAnswersResponse.id = answersFileId;
            console.log(`[flowAgent] Used answersFileId ('${answersFileId}') for customerAnswersResponse.id`);
        } else {
            customerAnswersResponse.id = null; // Ensure id property exists
            console.warn('[flowAgent] answersFileId was not available, customerAnswersResponse.id set to null.');
        }
    }

    // The rest of the flow will use customerAnswersResponse.id for chaining,
    // and customerAnswers for content if needed.
    // For example, in Phase 2.2 Section Drafting:
    // const draftContexts = [briefFileId, analysisFileId, assignmentsFileId, questionsFileId, customerAnswersResponse.id].filter(id => id);

    console.log("[flowAgent] Phase 2.2: Starting section drafting");
    updateFlowJobStatus(currentProposalId, "Phase 2", "Section Drafting", { step: "Starting section drafting" });
    
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
    // sectionFileIds is already declared above try block
    
    try {
      responsesAgent.resetProgress();
      console.log(`[flowAgent] Starting new proposal generation (ID: ${currentProposalId})`);
      
      // Better logging for initialCustomerAnswers
      if (initialCustomerAnswers === undefined || initialCustomerAnswers === null) {
        console.log(`[flowAgent] No initial customerAnswers provided - will generate during flow.`);
      } else if (typeof initialCustomerAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerAnswers is not a string (${typeof initialCustomerAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerAnswers to string.`);
        initialCustomerAnswers = String(initialCustomerAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerAnswers: ${initialCustomerAnswers.substring(0,100)}${initialCustomerAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerAnswers length: ${initialCustomerAnswers.length} characters`);
      }
      
      // Better logging for initialCustomerReviewAnswers
      if (initialCustomerReviewAnswers === undefined || initialCustomerReviewAnswers === null) {
        console.log(`[flowAgent] No initial customerReviewAnswers provided - will generate during flow if needed.`);
      } else if (typeof initialCustomerReviewAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerReviewAnswers is not a string (${typeof initialCustomerReviewAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerReviewAnswers to string.`);
        initialCustomerReviewAnswers = String(initialCustomerReviewAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerReviewAnswers: ${initialCustomerReviewAnswers.substring(0,100)}${initialCustomerReviewAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerReviewAnswers length: ${initialCustomerReviewAnswers.length} characters`);
      }

      if (jobId && global.flowJobs && global.flowJobs[jobId]) {
        global.flowJobs[jobId].proposalId = currentProposalId;
        console.log(`[flowAgent] Associated proposal ${currentProposalId} with job ${jobId}`);
      }

      // Create a new session in the database
      const sessionData = {
        proposalId: currentProposalId,
        customerBriefId: brief && brief.id ? brief.id : null, // Assuming brief might have an id
        status: 'processing',
        metadata: { 
          jobId: jobId, // Link to the async job ID from global.flowJobs
          startTime: new Date().toISOString(),
          initialBriefSummary: brief ? { client_name: brief.client_name, project_description: brief.project_description } : null,
          hasInitialCustomerAnswers: !!initialCustomerAnswers,
          hasInitialCustomerReviewAnswers: !!initialCustomerReviewAnswers
        }
      };
      const newDbSession = await Session.create(sessionData);
      sessionId = newDbSession.id; // Store the DB session ID
      console.log(`[flowAgent] Created DB session ${sessionId} for proposal ${currentProposalId}`);

      // updateFlowJobStatus(currentProposalId, 'Setup', 'initializing', {
      //   message: 'Starting production flow',
      //   timestamp: new Date().toISOString()
      // });
      
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
      
      // console.log(`[flowAgent] Working with ${sections.length} sections: ${sections.join(', ')}`);
      
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
        "Brief Analysis",
        null,
        currentProposalId
      );
      const analysis = analysisResponse.response || "Unable to generate analysis";
      
      // Fixed parameter order: (response, phase, component) instead of (response, proposalId, componentName)
      responsesAgent.trackTokenUsage(analysisResponse, "phase1", "briefAnalysis");
      
      analysisFileId = await responsesAgent.createAndUploadFile(
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
        "Section Assignments",
        null,
        currentProposalId,
        analysisResponse.id // Pass the analysis response ID for chaining
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
        // Use our strict parseJson helper
        if (typeof assignResponse.response === 'string') {
          assignments = parseJson(assignResponse.response, "section assignments (response)");
        } else if (typeof assignResponse.text === 'string') {
          assignments = parseJson(assignResponse.text, "section assignments (text)");
        } else if (typeof assignResponse === 'string') {
          assignments = parseJson(assignResponse, "section assignments (response)");
        } else {
          throw new Error("No valid string property found in assignResponse");
        }
      } catch (error) {
        console.error(`[flowAgent] Error parsing section assignments: ${error.message}`);
        throw new Error(`Failed to parse section assignments: ${error.message}`);
      }
      
      responsesAgent.trackTokenUsage(assignResponse, "phase1", "sectionAssignments");
      
      assignmentsFileId = await responsesAgent.createAndUploadFile(
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
      let lastQuestionResponseId = null; // Track a response ID for chaining
      
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
              `Questions from ${role}`,
              null,
              currentProposalId,
              assignResponse.id // Chain from the section assignments response
            );
            
            responsesAgent.trackTokenUsage(response, currentProposalId, `phase1`, `clarifyingQuestions_${role}`);
            
            // Store response ID for chaining
            if (response.id) {
              lastQuestionResponseId = response.id;
            }
            
            let parsedQuestions;
            try {
              // Try using the parseJson helper first for robust parsing
              // Use our strict parseJson helper
              if (typeof response.response === 'string') {
                parsedQuestions = parseJson(response.response, "questions from " + role);
              } else if (typeof response.text === 'string') {
                parsedQuestions = parseJson(response.text, "questions from " + role);
              } else if (typeof response === 'string') {
                parsedQuestions = parseJson(response, "questions from " + role);
              } else {
                throw new Error("No valid string property found in response");
              }
              console.log(`[flowAgent] Successfully parsed questions JSON for ${role} with parseJson helper, found ${Array.isArray(parsedQuestions) ? parsedQuestions.length : 'non-array'} result`);
            } catch (parseError) {
              console.error(`[flowAgent] parseJson failed for ${role}: ${parseError.message}`);
              throw parseError;
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
      "Phase1_OrganizeQuestions", // Explicitly pass the phase
      currentProposalId,
      lastQuestionResponseId // Chain from a specialist question response
    );
    
    // Log details about the response for debugging
    logResponseDetails(organizedQuestionsResponse, "Question Organization");
    
    responsesAgent.trackTokenUsage(organizedQuestionsResponse, "phase1", "organizeQuestions");
    
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
      
      // For organizedQuestions
      if (typeof responseText === 'string') {
        organizedQuestions = parseJson(responseText, "organized questions");
      } else {
        throw new Error("No valid string property found for organized questions");
      }
      
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
    
    questionsFileId = await responsesAgent.createAndUploadFile(
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

    let customerAnswers; // This will hold the actual answer text/data.
    // `answersFileId` is already declared in the outer scope and initialized to null.
    // `customerAnswersResponse` is already declared in the outer scope and initialized to null.

    if (initialCustomerAnswers) {
      console.log(`[flowAgent] Processing provided initial customer answers.`);
      // Ensure initialCustomerAnswers is a string for uploading
      const answersContentString = typeof initialCustomerAnswers === 'string'
        ? initialCustomerAnswers
        : JSON.stringify(initialCustomerAnswers, null, 2);

      // Use the answersFileId from the outer scope
      answersFileId = await responsesAgent.createAndUploadFile(
        answersContentString,
        `${currentProposalId}_initial_customer_answers.json` // Assuming JSON or text
      );

      if (answersFileId) {
        console.log(`[flowAgent] Initial customer answers uploaded. File ID: ${answersFileId}`);
        customerAnswersResponse = { id: answersFileId }; // Core fix
      } else {
        console.warn("[flowAgent] Failed to upload initial customer answers file. customerAnswersResponse.id will be null.");
        customerAnswersResponse = { id: null }; // Ensure it's an object, id is null
      }
      customerAnswers = initialCustomerAnswers; // Store the raw/original answers

      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_with_initial", { answersFileId: answersFileId || null });
      console.log(`[flowAgent] Initial customer answers processed. customerAnswersResponse set to:`, customerAnswersResponse);

    } else {
      // No initial answers, proceed with generating questions and getting answers from customer/mock
      console.log(`[flowAgent] No initial customer answers provided. Generating questions for customer.`);
      
      let customerPrompt = `As our valued client, we'd like to ask you some clarifying questions about your project to ensure we create the most effective proposal for your needs. Please provide your responses to the following questions:\\n\\n`;

      try {
        // Placeholder for the logic that was originally here for generating prompt from organizedQuestions
        // and then calling an agent (e.g., customer agent or mock) to get answers.
        // This logic would set:
        // - customerAnswers (the text/content of the answers)
        // - customerAnswersResponse (the object from the agent, ideally with an .id for the file)
        // - answersFileId (from customerAnswersResponse.id or by uploading customerAnswers)
        
        // Example of how this block should be structured:
        // 1. Build the prompt for the customer using `organizedQuestions`.
        //    if (organizedQuestions && organizedQuestions.organizedQuestions) {
        //      organizedQuestions.organizedQuestions.forEach(group => {
        //        customerPrompt += `\n**${group.theme}**\n`;
        //        group.questions.forEach(q => {
        //          customerPrompt += `- ${q.question} (ID: ${q.id})\n`;
        //        });
        //      });
        //    } else {
        //      console.warn("[flowAgent] organizedQuestions is not available for customer prompt generation.");
        //      // Potentially add default questions to prompt or handle error
        //    }
        //
        // 2. Call an agent (e.g., a "CustomerInteractionAgent" or use a mock for testing)
        //    const qaAgentResponse = await safeCreateResponse(
        //      customerPrompt,
        //      [questionsFileId, briefFileId].filter(id => id), // Context for the customer agent
        //      "CustomerInteractionAgent", // Or a mock agent role
        //      "Customer Q&A",
        //      "Phase2_CustomerAnswers",
        //      currentProposalId,
        //      questionsFileId // Chaining from question organization
        //    );
        //
        // 3. Process the response
        //    if (qaAgentResponse) {
        //      customerAnswersResponse = qaAgentResponse; // This should have an .id if a file was created by the agent
        //      customerAnswers = qaAgentResponse.response || qaAgentResponse.text; // Actual answers
        //
        //      if (qaAgentResponse.id) {
        //        answersFileId = qaAgentResponse.id;
        //      } else if (customerAnswers) {
        //        // If answers were received but not as a file, upload them
        //        const answersToUpload = typeof customerAnswers === 'string' ? customerAnswers : JSON.stringify(customerAnswers, null, 2);
        //        answersFileId = await responsesAgent.createAndUploadFile(
        //          answersToUpload,
        //          `${currentProposalId}_customer_answers.json`
        //        );
        //        if (answersFileId) {
        //          // Update customerAnswersResponse if it was null or its id was null, or if it wasn't an object with an id
        //          if (!customerAnswersResponse || typeof customerAnswersResponse.id === 'undefined') {
        //             customerAnswersResponse = { id: answersFileId };
        //          } else if (customerAnswersResponse.id === null) {
        //             customerAnswersResponse.id = answersFileId;
        //          }
        //        }
        //      }
        //      console.log(`[flowAgent] Customer answers received. File ID: ${answersFileId || 'N/A'}`);
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_via_interaction", { answersFileId: answersFileId || null });
        //    } else {
        //      console.error("[flowAgent] No response from QA agent for customer questions.");
        //      customerAnswersResponse = { id: null }; // Ensure it's an object with id
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_no_qa_response");
        //    }

        console.log('[flowAgent] Customer Q&A processing logic (else branch) needs to be fully implemented here.');
        // If not implemented, ensure customerAnswersResponse is at least {id: null} if it's still null from initialization.
        if (customerAnswersResponse === null) { // Check against initial value
            console.warn('[flowAgent] customerAnswersResponse is still null after attempting Q&A (else branch). Setting to {id: null}.');
            customerAnswersResponse = { id: null };
        }

      } catch (error) {
        console.error(`[flowAgent] Error during customer Q&A (else branch): ${error.message}`);
        updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_during_interaction", { error: error.message });
        customerAnswersResponse = { id: null }; // Default on error
        // throw error; // Or re-throw if this is a critical failure
      }
    }
    
    // Ensure customerAnswersResponse is an object with an id before proceeding to use it.
    if (!customerAnswersResponse) { // Catches if it's null or undefined
        console.warn('[flowAgent] customerAnswersResponse is not set after Q&A phase (e.g. null or undefined). Defaulting to { id: null }.');
        customerAnswersResponse = { id: null };
    } else if (typeof customerAnswersResponse.id === 'undefined') { // Catches if it's an object but no 'id'
        console.warn('[flowAgent] customerAnswersResponse.id is undefined after Q&A phase. Attempting to use answersFileId or defaulting id to null. Response was:', customerAnswersResponse);
        // Try to use answersFileId if it was set (e.g. by manual upload in the 'else' branch or if initialCustomerAnswers path set it)
        if (answersFileId) {
            customerAnswersResponse.id = answersFileId;
            console.log(`[flowAgent] Used answersFileId ('${answersFileId}') for customerAnswersResponse.id`);
        } else {
            customerAnswersResponse.id = null; // Ensure id property exists
            console.warn('[flowAgent] answersFileId was not available, customerAnswersResponse.id set to null.');
        }
    }

    // The rest of the flow will use customerAnswersResponse.id for chaining,
    // and customerAnswers for content if needed.
    // For example, in Phase 2.2 Section Drafting:
    // const draftContexts = [briefFileId, analysisFileId, assignmentsFileId, questionsFileId, customerAnswersResponse.id].filter(id => id);

    console.log("[flowAgent] Phase 2.2: Starting section drafting");
    updateFlowJobStatus(currentProposalId, "Phase 2", "Section Drafting", { step: "Starting section drafting" });
    
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
    // sectionFileIds is already declared above try block
    
    try {
      responsesAgent.resetProgress();
      console.log(`[flowAgent] Starting new proposal generation (ID: ${currentProposalId})`);
      
      // Better logging for initialCustomerAnswers
      if (initialCustomerAnswers === undefined || initialCustomerAnswers === null) {
        console.log(`[flowAgent] No initial customerAnswers provided - will generate during flow.`);
      } else if (typeof initialCustomerAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerAnswers is not a string (${typeof initialCustomerAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerAnswers to string.`);
        initialCustomerAnswers = String(initialCustomerAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerAnswers: ${initialCustomerAnswers.substring(0,100)}${initialCustomerAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerAnswers length: ${initialCustomerAnswers.length} characters`);
      }
      
      // Better logging for initialCustomerReviewAnswers
      if (initialCustomerReviewAnswers === undefined || initialCustomerReviewAnswers === null) {
        console.log(`[flowAgent] No initial customerReviewAnswers provided - will generate during flow if needed.`);
      } else if (typeof initialCustomerReviewAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerReviewAnswers is not a string (${typeof initialCustomerReviewAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerReviewAnswers to string.`);
        initialCustomerReviewAnswers = String(initialCustomerReviewAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerReviewAnswers: ${initialCustomerReviewAnswers.substring(0,100)}${initialCustomerReviewAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerReviewAnswers length: ${initialCustomerReviewAnswers.length} characters`);
      }

      if (jobId && global.flowJobs && global.flowJobs[jobId]) {
        global.flowJobs[jobId].proposalId = currentProposalId;
        console.log(`[flowAgent] Associated proposal ${currentProposalId} with job ${jobId}`);
      }

      // Create a new session in the database
      const sessionData = {
        proposalId: currentProposalId,
        customerBriefId: brief && brief.id ? brief.id : null, // Assuming brief might have an id
        status: 'processing',
        metadata: { 
          jobId: jobId, // Link to the async job ID from global.flowJobs
          startTime: new Date().toISOString(),
          initialBriefSummary: brief ? { client_name: brief.client_name, project_description: brief.project_description } : null,
          hasInitialCustomerAnswers: !!initialCustomerAnswers,
          hasInitialCustomerReviewAnswers: !!initialCustomerReviewAnswers
        }
      };
      const newDbSession = await Session.create(sessionData);
      sessionId = newDbSession.id; // Store the DB session ID
      console.log(`[flowAgent] Created DB session ${sessionId} for proposal ${currentProposalId}`);

      // updateFlowJobStatus(currentProposalId, 'Setup', 'initializing', {
      //   message: 'Starting production flow',
      //   timestamp: new Date().toISOString()
      // });
      
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
      
      // console.log(`[flowAgent] Working with ${sections.length} sections: ${sections.join(', ')}`);
      
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
        "Brief Analysis",
        null,
        currentProposalId
      );
      const analysis = analysisResponse.response || "Unable to generate analysis";
      
      // Fixed parameter order: (response, phase, component) instead of (response, proposalId, componentName)
      responsesAgent.trackTokenUsage(analysisResponse, "phase1", "briefAnalysis");
      
      analysisFileId = await responsesAgent.createAndUploadFile(
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
        "Section Assignments",
        null,
        currentProposalId,
        analysisResponse.id // Pass the analysis response ID for chaining
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
        // Use our strict parseJson helper
        if (typeof assignResponse.response === 'string') {
          assignments = parseJson(assignResponse.response, "section assignments (response)");
        } else if (typeof assignResponse.text === 'string') {
          assignments = parseJson(assignResponse.text, "section assignments (text)");
        } else if (typeof assignResponse === 'string') {
          assignments = parseJson(assignResponse, "section assignments (response)");
        } else {
          throw new Error("No valid string property found in assignResponse");
        }
      } catch (error) {
        console.error(`[flowAgent] Error parsing section assignments: ${error.message}`);
        throw new Error(`Failed to parse section assignments: ${error.message}`);
      }
      
      responsesAgent.trackTokenUsage(assignResponse, "phase1", "sectionAssignments");
      
      assignmentsFileId = await responsesAgent.createAndUploadFile(
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
      let lastQuestionResponseId = null; // Track a response ID for chaining
      
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
              `Questions from ${role}`,
              null,
              currentProposalId,
              assignResponse.id // Chain from the section assignments response
            );
            
            responsesAgent.trackTokenUsage(response, currentProposalId, `phase1`, `clarifyingQuestions_${role}`);
            
            // Store response ID for chaining
            if (response.id) {
              lastQuestionResponseId = response.id;
            }
            
            let parsedQuestions;
            try {
              // Try using the parseJson helper first for robust parsing
              // Use our strict parseJson helper
              if (typeof response.response === 'string') {
                parsedQuestions = parseJson(response.response, "questions from " + role);
              } else if (typeof response.text === 'string') {
                parsedQuestions = parseJson(response.text, "questions from " + role);
              } else if (typeof response === 'string') {
                parsedQuestions = parseJson(response, "questions from " + role);
              } else {
                throw new Error("No valid string property found in response");
              }
              console.log(`[flowAgent] Successfully parsed questions JSON for ${role} with parseJson helper, found ${Array.isArray(parsedQuestions) ? parsedQuestions.length : 'non-array'} result`);
            } catch (parseError) {
              console.error(`[flowAgent] parseJson failed for ${role}: ${parseError.message}`);
              throw parseError;
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
      "Phase1_OrganizeQuestions", // Explicitly pass the phase
      currentProposalId,
      lastQuestionResponseId // Chain from a specialist question response
    );
    
    // Log details about the response for debugging
    logResponseDetails(organizedQuestionsResponse, "Question Organization");
    
    responsesAgent.trackTokenUsage(organizedQuestionsResponse, "phase1", "organizeQuestions");
    
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
      
      // For organizedQuestions
      if (typeof responseText === 'string') {
        organizedQuestions = parseJson(responseText, "organized questions");
      } else {
        throw new Error("No valid string property found for organized questions");
      }
      
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
    
    questionsFileId = await responsesAgent.createAndUploadFile(
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

    let customerAnswers; // This will hold the actual answer text/data.
    // `answersFileId` is already declared in the outer scope and initialized to null.
    // `customerAnswersResponse` is already declared in the outer scope and initialized to null.

    if (initialCustomerAnswers) {
      console.log(`[flowAgent] Processing provided initial customer answers.`);
      // Ensure initialCustomerAnswers is a string for uploading
      const answersContentString = typeof initialCustomerAnswers === 'string'
        ? initialCustomerAnswers
        : JSON.stringify(initialCustomerAnswers, null, 2);

      // Use the answersFileId from the outer scope
      answersFileId = await responsesAgent.createAndUploadFile(
        answersContentString,
        `${currentProposalId}_initial_customer_answers.json` // Assuming JSON or text
      );

      if (answersFileId) {
        console.log(`[flowAgent] Initial customer answers uploaded. File ID: ${answersFileId}`);
        customerAnswersResponse = { id: answersFileId }; // Core fix
      } else {
        console.warn("[flowAgent] Failed to upload initial customer answers file. customerAnswersResponse.id will be null.");
        customerAnswersResponse = { id: null }; // Ensure it's an object, id is null
      }
      customerAnswers = initialCustomerAnswers; // Store the raw/original answers

      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_with_initial", { answersFileId: answersFileId || null });
      console.log(`[flowAgent] Initial customer answers processed. customerAnswersResponse set to:`, customerAnswersResponse);

    } else {
      // No initial answers, proceed with generating questions and getting answers from customer/mock
      console.log(`[flowAgent] No initial customer answers provided. Generating questions for customer.`);
      
      let customerPrompt = `As our valued client, we'd like to ask you some clarifying questions about your project to ensure we create the most effective proposal for your needs. Please provide your responses to the following questions:\\n\\n`;

      try {
        // Placeholder for the logic that was originally here for generating prompt from organizedQuestions
        // and then calling an agent (e.g., customer agent or mock) to get answers.
        // This logic would set:
        // - customerAnswers (the text/content of the answers)
        // - customerAnswersResponse (the object from the agent, ideally with an .id for the file)
        // - answersFileId (from customerAnswersResponse.id or by uploading customerAnswers)
        
        // Example of how this block should be structured:
        // 1. Build the prompt for the customer using `organizedQuestions`.
        //    if (organizedQuestions && organizedQuestions.organizedQuestions) {
        //      organizedQuestions.organizedQuestions.forEach(group => {
        //        customerPrompt += `\n**${group.theme}**\n`;
        //        group.questions.forEach(q => {
        //          customerPrompt += `- ${q.question} (ID: ${q.id})\n`;
        //        });
        //      });
        //    } else {
        //      console.warn("[flowAgent] organizedQuestions is not available for customer prompt generation.");
        //      // Potentially add default questions to prompt or handle error
        //    }
        //
        // 2. Call an agent (e.g., a "CustomerInteractionAgent" or use a mock for testing)
        //    const qaAgentResponse = await safeCreateResponse(
        //      customerPrompt,
        //      [questionsFileId, briefFileId].filter(id => id), // Context for the customer agent
        //      "CustomerInteractionAgent", // Or a mock agent role
        //      "Customer Q&A",
        //      "Phase2_CustomerAnswers",
        //      currentProposalId,
        //      questionsFileId // Chaining from question organization
        //    );
        //
        // 3. Process the response
        //    if (qaAgentResponse) {
        //      customerAnswersResponse = qaAgentResponse; // This should have an .id if a file was created by the agent
        //      customerAnswers = qaAgentResponse.response || qaAgentResponse.text; // Actual answers
        //
        //      if (qaAgentResponse.id) {
        //        answersFileId = qaAgentResponse.id;
        //      } else if (customerAnswers) {
        //        // If answers were received but not as a file, upload them
        //        const answersToUpload = typeof customerAnswers === 'string' ? customerAnswers : JSON.stringify(customerAnswers, null, 2);
        //        answersFileId = await responsesAgent.createAndUploadFile(
        //          answersToUpload,
        //          `${currentProposalId}_customer_answers.json`
        //        );
        //        if (answersFileId) {
        //          // Update customerAnswersResponse if it was null or its id was null, or if it wasn't an object with an id
        //          if (!customerAnswersResponse || typeof customerAnswersResponse.id === 'undefined') {
        //             customerAnswersResponse = { id: answersFileId };
        //          } else if (customerAnswersResponse.id === null) {
        //             customerAnswersResponse.id = answersFileId;
        //          }
        //        }
        //      }
        //      console.log(`[flowAgent] Customer answers received. File ID: ${answersFileId || 'N/A'}`);
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_via_interaction", { answersFileId: answersFileId || null });
        //    } else {
        //      console.error("[flowAgent] No response from QA agent for customer questions.");
        //      customerAnswersResponse = { id: null }; // Ensure it's an object with id
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_no_qa_response");
        //    }

        console.log('[flowAgent] Customer Q&A processing logic (else branch) needs to be fully implemented here.');
        // If not implemented, ensure customerAnswersResponse is at least {id: null} if it's still null from initialization.
        if (customerAnswersResponse === null) { // Check against initial value
            console.warn('[flowAgent] customerAnswersResponse is still null after attempting Q&A (else branch). Setting to {id: null}.');
            customerAnswersResponse = { id: null };
        }

      } catch (error) {
        console.error(`[flowAgent] Error during customer Q&A (else branch): ${error.message}`);
        updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_during_interaction", { error: error.message });
        customerAnswersResponse = { id: null }; // Default on error
        // throw error; // Or re-throw if this is a critical failure
      }
    }
    
    // Ensure customerAnswersResponse is an object with an id before proceeding to use it.
    if (!customerAnswersResponse) { // Catches if it's null or undefined
        console.warn('[flowAgent] customerAnswersResponse is not set after Q&A phase (e.g. null or undefined). Defaulting to { id: null }.');
        customerAnswersResponse = { id: null };
    } else if (typeof customerAnswersResponse.id === 'undefined') { // Catches if it's an object but no 'id'
        console.warn('[flowAgent] customerAnswersResponse.id is undefined after Q&A phase. Attempting to use answersFileId or defaulting id to null. Response was:', customerAnswersResponse);
        // Try to use answersFileId if it was set (e.g. by manual upload in the 'else' branch or if initialCustomerAnswers path set it)
        if (answersFileId) {
            customerAnswersResponse.id = answersFileId;
            console.log(`[flowAgent] Used answersFileId ('${answersFileId}') for customerAnswersResponse.id`);
        } else {
            customerAnswersResponse.id = null; // Ensure id property exists
            console.warn('[flowAgent] answersFileId was not available, customerAnswersResponse.id set to null.');
        }
    }

    // The rest of the flow will use customerAnswersResponse.id for chaining,
    // and customerAnswers for content if needed.
    // For example, in Phase 2.2 Section Drafting:
    // const draftContexts = [briefFileId, analysisFileId, assignmentsFileId, questionsFileId, customerAnswersResponse.id].filter(id => id);

    console.log("[flowAgent] Phase 2.2: Starting section drafting");
    updateFlowJobStatus(currentProposalId, "Phase 2", "Section Drafting", { step: "Starting section drafting" });
    
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
    // sectionFileIds is already declared above try block
    
    try {
      responsesAgent.resetProgress();
      console.log(`[flowAgent] Starting new proposal generation (ID: ${currentProposalId})`);
      
      // Better logging for initialCustomerAnswers
      if (initialCustomerAnswers === undefined || initialCustomerAnswers === null) {
        console.log(`[flowAgent] No initial customerAnswers provided - will generate during flow.`);
      } else if (typeof initialCustomerAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerAnswers is not a string (${typeof initialCustomerAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerAnswers to string.`);
        initialCustomerAnswers = String(initialCustomerAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerAnswers: ${initialCustomerAnswers.substring(0,100)}${initialCustomerAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerAnswers length: ${initialCustomerAnswers.length} characters`);
      }
      
      // Better logging for initialCustomerReviewAnswers
      if (initialCustomerReviewAnswers === undefined || initialCustomerReviewAnswers === null) {
        console.log(`[flowAgent] No initial customerReviewAnswers provided - will generate during flow if needed.`);
      } else if (typeof initialCustomerReviewAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerReviewAnswers is not a string (${typeof initialCustomerReviewAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerReviewAnswers to string.`);
        initialCustomerReviewAnswers = String(initialCustomerReviewAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerReviewAnswers: ${initialCustomerReviewAnswers.substring(0,100)}${initialCustomerReviewAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerReviewAnswers length: ${initialCustomerReviewAnswers.length} characters`);
      }

      if (jobId && global.flowJobs && global.flowJobs[jobId]) {
        global.flowJobs[jobId].proposalId = currentProposalId;
        console.log(`[flowAgent] Associated proposal ${currentProposalId} with job ${jobId}`);
      }

      // Create a new session in the database
      const sessionData = {
        proposalId: currentProposalId,
        customerBriefId: brief && brief.id ? brief.id : null, // Assuming brief might have an id
        status: 'processing',
        metadata: { 
          jobId: jobId, // Link to the async job ID from global.flowJobs
          startTime: new Date().toISOString(),
          initialBriefSummary: brief ? { client_name: brief.client_name, project_description: brief.project_description } : null,
          hasInitialCustomerAnswers: !!initialCustomerAnswers,
          hasInitialCustomerReviewAnswers: !!initialCustomerReviewAnswers
        }
      };
      const newDbSession = await Session.create(sessionData);
      sessionId = newDbSession.id; // Store the DB session ID
      console.log(`[flowAgent] Created DB session ${sessionId} for proposal ${currentProposalId}`);

      // updateFlowJobStatus(currentProposalId, 'Setup', 'initializing', {
      //   message: 'Starting production flow',
      //   timestamp: new Date().toISOString()
      // });
      
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
      
      // console.log(`[flowAgent] Working with ${sections.length} sections: ${sections.join(', ')}`);
      
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
        "Brief Analysis",
        null,
        currentProposalId
      );
      const analysis = analysisResponse.response || "Unable to generate analysis";
      
      // Fixed parameter order: (response, phase, component) instead of (response, proposalId, componentName)
      responsesAgent.trackTokenUsage(analysisResponse, "phase1", "briefAnalysis");
      
      analysisFileId = await responsesAgent.createAndUploadFile(
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
        "Section Assignments",
        null,
        currentProposalId,
        analysisResponse.id // Pass the analysis response ID for chaining
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
        // Use our strict parseJson helper
        if (typeof assignResponse.response === 'string') {
          assignments = parseJson(assignResponse.response, "section assignments (response)");
        } else if (typeof assignResponse.text === 'string') {
          assignments = parseJson(assignResponse.text, "section assignments (text)");
        } else if (typeof assignResponse === 'string') {
          assignments = parseJson(assignResponse, "section assignments (response)");
        } else {
          throw new Error("No valid string property found in assignResponse");
        }
      } catch (error) {
        console.error(`[flowAgent] Error parsing section assignments: ${error.message}`);
        throw new Error(`Failed to parse section assignments: ${error.message}`);
      }
      
      responsesAgent.trackTokenUsage(assignResponse, "phase1", "sectionAssignments");
      
      assignmentsFileId = await responsesAgent.createAndUploadFile(
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
      let lastQuestionResponseId = null; // Track a response ID for chaining
      
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
              `Questions from ${role}`,
              null,
              currentProposalId,
              assignResponse.id // Chain from the section assignments response
            );
            
            responsesAgent.trackTokenUsage(response, currentProposalId, `phase1`, `clarifyingQuestions_${role}`);
            
            // Store response ID for chaining
            if (response.id) {
              lastQuestionResponseId = response.id;
            }
            
            let parsedQuestions;
            try {
              // Try using the parseJson helper first for robust parsing
              // Use our strict parseJson helper
              if (typeof response.response === 'string') {
                parsedQuestions = parseJson(response.response, "questions from " + role);
              } else if (typeof response.text === 'string') {
                parsedQuestions = parseJson(response.text, "questions from " + role);
              } else if (typeof response === 'string') {
                parsedQuestions = parseJson(response, "questions from " + role);
              } else {
                throw new Error("No valid string property found in response");
              }
              console.log(`[flowAgent] Successfully parsed questions JSON for ${role} with parseJson helper, found ${Array.isArray(parsedQuestions) ? parsedQuestions.length : 'non-array'} result`);
            } catch (parseError) {
              console.error(`[flowAgent] parseJson failed for ${role}: ${parseError.message}`);
              throw parseError;
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
      "Phase1_OrganizeQuestions", // Explicitly pass the phase
      currentProposalId,
      lastQuestionResponseId // Chain from a specialist question response
    );
    
    // Log details about the response for debugging
    logResponseDetails(organizedQuestionsResponse, "Question Organization");
    
    responsesAgent.trackTokenUsage(organizedQuestionsResponse, "phase1", "organizeQuestions");
    
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
      
      // For organizedQuestions
      if (typeof responseText === 'string') {
        organizedQuestions = parseJson(responseText, "organized questions");
      } else {
        throw new Error("No valid string property found for organized questions");
      }
      
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
    
    questionsFileId = await responsesAgent.createAndUploadFile(
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

    let customerAnswers; // This will hold the actual answer text/data.
    // `answersFileId` is already declared in the outer scope and initialized to null.
    // `customerAnswersResponse` is already declared in the outer scope and initialized to null.

    if (initialCustomerAnswers) {
      console.log(`[flowAgent] Processing provided initial customer answers.`);
      // Ensure initialCustomerAnswers is a string for uploading
      const answersContentString = typeof initialCustomerAnswers === 'string'
        ? initialCustomerAnswers
        : JSON.stringify(initialCustomerAnswers, null, 2);

      // Use the answersFileId from the outer scope
      answersFileId = await responsesAgent.createAndUploadFile(
        answersContentString,
        `${currentProposalId}_initial_customer_answers.json` // Assuming JSON or text
      );

      if (answersFileId) {
        console.log(`[flowAgent] Initial customer answers uploaded. File ID: ${answersFileId}`);
        customerAnswersResponse = { id: answersFileId }; // Core fix
      } else {
        console.warn("[flowAgent] Failed to upload initial customer answers file. customerAnswersResponse.id will be null.");
        customerAnswersResponse = { id: null }; // Ensure it's an object, id is null
      }
      customerAnswers = initialCustomerAnswers; // Store the raw/original answers

      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_with_initial", { answersFileId: answersFileId || null });
      console.log(`[flowAgent] Initial customer answers processed. customerAnswersResponse set to:`, customerAnswersResponse);

    } else {
      // No initial answers, proceed with generating questions and getting answers from customer/mock
      console.log(`[flowAgent] No initial customer answers provided. Generating questions for customer.`);
      
      let customerPrompt = `As our valued client, we'd like to ask you some clarifying questions about your project to ensure we create the most effective proposal for your needs. Please provide your responses to the following questions:\\n\\n`;

      try {
        // Placeholder for the logic that was originally here for generating prompt from organizedQuestions
        // and then calling an agent (e.g., customer agent or mock) to get answers.
        // This logic would set:
        // - customerAnswers (the text/content of the answers)
        // - customerAnswersResponse (the object from the agent, ideally with an .id for the file)
        // - answersFileId (from customerAnswersResponse.id or by uploading customerAnswers)
        
        // Example of how this block should be structured:
        // 1. Build the prompt for the customer using `organizedQuestions`.
        //    if (organizedQuestions && organizedQuestions.organizedQuestions) {
        //      organizedQuestions.organizedQuestions.forEach(group => {
        //        customerPrompt += `\n**${group.theme}**\n`;
        //        group.questions.forEach(q => {
        //          customerPrompt += `- ${q.question} (ID: ${q.id})\n`;
        //        });
        //      });
        //    } else {
        //      console.warn("[flowAgent] organizedQuestions is not available for customer prompt generation.");
        //      // Potentially add default questions to prompt or handle error
        //    }
        //
        // 2. Call an agent (e.g., a "CustomerInteractionAgent" or use a mock for testing)
        //    const qaAgentResponse = await safeCreateResponse(
        //      customerPrompt,
        //      [questionsFileId, briefFileId].filter(id => id), // Context for the customer agent
        //      "CustomerInteractionAgent", // Or a mock agent role
        //      "Customer Q&A",
        //      "Phase2_CustomerAnswers",
        //      currentProposalId,
        //      questionsFileId // Chaining from question organization
        //    );
        //
        // 3. Process the response
        //    if (qaAgentResponse) {
        //      customerAnswersResponse = qaAgentResponse; // This should have an .id if a file was created by the agent
        //      customerAnswers = qaAgentResponse.response || qaAgentResponse.text; // Actual answers
        //
        //      if (qaAgentResponse.id) {
        //        answersFileId = qaAgentResponse.id;
        //      } else if (customerAnswers) {
        //        // If answers were received but not as a file, upload them
        //        const answersToUpload = typeof customerAnswers === 'string' ? customerAnswers : JSON.stringify(customerAnswers, null, 2);
        //        answersFileId = await responsesAgent.createAndUploadFile(
        //          answersToUpload,
        //          `${currentProposalId}_customer_answers.json`
        //        );
        //        if (answersFileId) {
        //          // Update customerAnswersResponse if it was null or its id was null, or if it wasn't an object with an id
        //          if (!customerAnswersResponse || typeof customerAnswersResponse.id === 'undefined') {
        //             customerAnswersResponse = { id: answersFileId };
        //          } else if (customerAnswersResponse.id === null) {
        //             customerAnswersResponse.id = answersFileId;
        //          }
        //        }
        //      }
        //      console.log(`[flowAgent] Customer answers received. File ID: ${answersFileId || 'N/A'}`);
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "completed_via_interaction", { answersFileId: answersFileId || null });
        //    } else {
        //      console.error("[flowAgent] No response from QA agent for customer questions.");
        //      customerAnswersResponse = { id: null }; // Ensure it's an object with id
        //      updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_no_qa_response");
        //    }

        console.log('[flowAgent] Customer Q&A processing logic (else branch) needs to be fully implemented here.');
        // If not implemented, ensure customerAnswersResponse is at least {id: null} if it's still null from initialization.
        if (customerAnswersResponse === null) { // Check against initial value
            console.warn('[flowAgent] customerAnswersResponse is still null after attempting Q&A (else branch). Setting to {id: null}.');
            customerAnswersResponse = { id: null };
        }

      } catch (error) {
        console.error(`[flowAgent] Error during customer Q&A (else branch): ${error.message}`);
        updateFlowJobStatus(currentProposalId, "Phase2_CustomerAnswers", "error_during_interaction", { error: error.message });
        customerAnswersResponse = { id: null }; // Default on error
        // throw error; // Or re-throw if this is a critical failure
      }
    }
    
    // Ensure customerAnswersResponse is an object with an id before proceeding to use it.
    if (!customerAnswersResponse) { // Catches if it's null or undefined
        console.warn('[flowAgent] customerAnswersResponse is not set after Q&A phase (e.g. null or undefined). Defaulting to { id: null }.');
        customerAnswersResponse = { id: null };
    } else if (typeof customerAnswersResponse.id === 'undefined') { // Catches if it's an object but no 'id'
        console.warn('[flowAgent] customerAnswersResponse.id is undefined after Q&A phase. Attempting to use answersFileId or defaulting id to null. Response was:', customerAnswersResponse);
        // Try to use answersFileId if it was set (e.g. by manual upload in the 'else' branch or if initialCustomerAnswers path set it)
        if (answersFileId) {
            customerAnswersResponse.id = answersFileId;
            console.log(`[flowAgent] Used answersFileId ('${answersFileId}') for customerAnswersResponse.id`);
        } else {
            customerAnswersResponse.id = null; // Ensure id property exists
            console.warn('[flowAgent] answersFileId was not available, customerAnswersResponse.id set to null.');
        }
    }

    // The rest of the flow will use customerAnswersResponse.id for chaining,
    // and customerAnswers for content if needed.
    // For example, in Phase 2.2 Section Drafting:
    // const draftContexts = [briefFileId, analysisFileId, assignmentsFileId, questionsFileId, customerAnswersResponse.id].filter(id => id);

    console.log("[flowAgent] Phase 2.2: Starting section drafting");
    updateFlowJobStatus(currentProposalId, "Phase 2", "Section Drafting", { step: "Starting section drafting" });
    
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
    // sectionFileIds is already declared above try block
    
    try {
      responsesAgent.resetProgress();
      console.log(`[flowAgent] Starting new proposal generation (ID: ${currentProposalId})`);
      
      // Better logging for initialCustomerAnswers
      if (initialCustomerAnswers === undefined || initialCustomerAnswers === null) {
        console.log(`[flowAgent] No initial customerAnswers provided - will generate during flow.`);
      } else if (typeof initialCustomerAnswers !== 'string') {
        console.warn(`[flowAgent] initialCustomerAnswers is not a string (${typeof initialCustomerAnswers})`);
        console.log(`[flowAgent] Attempting to convert initialCustomerAnswers to string.`);
        initialCustomerAnswers = String(initialCustomerAnswers || '');
      } else {
        console.log(`[flowAgent] Received initial customerAnswers: ${initialCustomerAnswers.substring(0,100)}${initialCustomerAnswers.length > 100 ? '...' : ''}`);
        console.log(`[flowAgent] initialCustomerAnswers length: ${initialCustomerAnswers.length} characters`);
      }
      
      // Better logging for initialCustomerReviewAnswers
      if (initialCustomerReviewAnswers ===