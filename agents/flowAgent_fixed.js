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
  
  // If it's already an object (not a string), try to use it directly
  if (typeof raw === 'object') {
    console.log(`[flowAgent] Response for ${label} is already an object, checking properties`);
    
    // Check for output property in the format returned by Responses API
    if (raw.output && Array.isArray(raw.output) && raw.output.length > 0) {
      // Try to extract JSON from the output content
      for (const outputItem of raw.output) {
        if (outputItem.content && Array.isArray(outputItem.content)) {
          for (const contentItem of outputItem.content) {
            if (contentItem.text && typeof contentItem.text === 'string') {
              // Try to extract JSON from the text
              console.log(`[flowAgent] Found text content in output, attempting to parse`);
              try {
                return extractJsonFromText(contentItem.text, label);
              } catch (err) {
                console.log(`[flowAgent] Could not extract JSON from output text: ${err.message}`);
                // Continue checking other properties
              }
            }
          }
        }
      }
    }
    
    // If we have output_text property
    if (raw.output_text && typeof raw.output_text === 'string') {
      console.log(`[flowAgent] Found output_text property, attempting to parse`);
      try {
        return extractJsonFromText(raw.output_text, label);
      } catch (err) {
        console.log(`[flowAgent] Could not extract JSON from output_text: ${err.message}`);
        // Continue checking other properties
      }
    }
    
    // Return the raw object if no processing succeeded
    console.log(`[flowAgent] Using raw object as JSON for ${label}`);
    return raw;
  }
  
  // Handle string responses
  if (typeof raw === 'string') {
    return extractJsonFromText(raw, label);
  }
  
  // If it's neither an object nor a string, throw an error
  console.error(`[flowAgent] Unexpected type for ${label}: ${typeof raw}`);
  throw new Error(`Unexpected response type for ${label}: ${typeof raw}`);
}

// Helper function to extract JSON from text (markdown, code blocks, etc.)
function extractJsonFromText(text, label) {
  const trimmed = text.trim();
  if (!trimmed || trimmed === 'undefined') {
    console.error(`[flowAgent] Undefined or empty response for ${label}`);
    throw new Error(`No JSON response for ${label}`);
  }
  
  // First try: If the entire response is valid JSON, parse it directly
  try {
    return JSON.parse(trimmed);
  } catch (directParseError) {
    console.log(`[flowAgent] Direct JSON parse failed, attempting to extract JSON from text: ${directParseError.message}`);
  }
  
  // Second try: Find first opening brace and last closing brace for JSON object
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  
  // Find first opening bracket and last closing bracket for JSON array
  const firstArray = trimmed.indexOf('[');
  const lastArray = trimmed.lastIndexOf(']');
  
  // Determine if we're dealing with an object or array
  let jsonStr;
  if (first >= 0 && last > first) {
    // It's an object
    jsonStr = trimmed.substring(first, last + 1);
  } else if (firstArray >= 0 && lastArray > firstArray) {
    // It's an array
    jsonStr = trimmed.substring(firstArray, lastArray + 1);
  } else {
    // Try to handle cases where markdown formatting might be present
    const codeBlockStart = trimmed.indexOf("```json");
    if (codeBlockStart >= 0) {
      const codeContentStart = trimmed.indexOf("\n", codeBlockStart) + 1;
      const codeBlockEnd = trimmed.indexOf("```", codeContentStart);
      if (codeBlockEnd > codeContentStart) {
        jsonStr = trimmed.substring(codeContentStart, codeBlockEnd).trim();
        console.log(`[flowAgent] Extracted JSON from code block for ${label}`);
      }
    } else {
      // Try other code block formats (```javascript, etc.)
      const genericCodeBlockStart = trimmed.indexOf("```");
      if (genericCodeBlockStart >= 0) {
        const genericCodeContentStart = trimmed.indexOf("\n", genericCodeBlockStart) + 1;
        const genericCodeBlockEnd = trimmed.indexOf("```", genericCodeContentStart);
        if (genericCodeBlockEnd > genericCodeContentStart) {
          jsonStr = trimmed.substring(genericCodeContentStart, genericCodeBlockEnd).trim();
          console.log(`[flowAgent] Extracted JSON from generic code block for ${label}`);
        }
      }
    }
    
    // If still no JSON found
    if (!jsonStr) {
      console.error(`[flowAgent] JSON structure not found in ${label} response`);
      throw new Error(`Invalid JSON for ${label}`);
    }
  }
  
  // Try to parse the extracted JSON
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error(`[flowAgent] JSON.parse error for ${label}:`, e.message);
    // Try to fix common JSON issues
    const fixAttempts = [
      // Replace single quotes with double quotes
      () => JSON.parse(jsonStr.replace(/'/g, '"')),
      // Replace unquoted keys with quoted keys
      () => JSON.parse(jsonStr.replace(/(\b\w+\b)(?=\s*:)/g, '"$1"')),
      // Fix trailing commas in objects
      () => JSON.parse(jsonStr.replace(/,\s*}/g, '}')),
      // Fix trailing commas in arrays
      () => JSON.parse(jsonStr.replace(/,\s*\]/g, ']')),
      // Add double quotes to keys and string values that seem to be missing them
      () => {
        let result = jsonStr;
        // Replace unquoted properties
        result = result.replace(/(\b\w+\b)(?=\s*:)/g, '"$1"');
        // Try to fix unquoted string values (simplistic approach)
        result = result.replace(/:(\s*)([A-Za-z][A-Za-z0-9_\s]+)(?=,|}|$)/g, ':"$2"');
        return JSON.parse(result);
      }
    ];
    
    // Try each fix attempt
    for (const fixAttempt of fixAttempts) {
      try {
        return fixAttempt();
      } catch (fixError) {
        // Continue to next attempt
      }
    }
    
    console.error(`[flowAgent] All JSON parsing attempts failed for ${label}`);
    console.error(`[flowAgent] JSON string was: ${jsonStr}`);
    throw new Error(`Invalid JSON for ${label}: ${e.message}`);
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
async function runFullFlow({ brief, customerAnswers: initialCustomerAnswers, customerReviewAnswers: initialCustomerReviewAnswers }) {
  // Reset progress tracking for new proposal
  responsesAgent.resetProgress();
  
  // Generate unique proposal ID
  currentProposalId = `proposal-${Date.now()}`;
  console.log(`[flowAgent] Starting new proposal generation (ID: ${currentProposalId})`);
  console.log(`[flowAgent] Received initial customerAnswers: ${initialCustomerAnswers}`);
  console.log(`[flowAgent] Received initial customerReviewAnswers: ${initialCustomerReviewAnswers}`);

  // --- Ensure all key file IDs are declared and always available ---
  let briefFileId = null;
  let analysisFileId = null;
  let assignmentsFileId = null;
  let questionsFileId = null;
  let answersFileId = null;
  let customerReviewAnswersFileId = null;
  let manifestFileId = null;
  let finalApprovalFileId = null;
  let finalProposalFileId = null;

  // Mock flow for testing environments
  if (process.env.NODE_ENV === 'test' || !process.env.OPENAI_API_KEY) {
    const analysis = `Brief analysis for ${brief.client_name}`;
    const sections = Object.keys(defaultTemplate);
    const assignments = await assignSections({ sections, title: '', client: brief.client_name, details: brief.project_description });
    
    const organizedQuestions = {
      organizedQuestions: [
        {
          theme: "Business Objectives",
          questions: [
            {
              question: "What are your primary business goals for this project?",
              source: "sp_Account_Manager",
              id: "q1"
            },
            {
              question: "How do you measure success for this initiative?",
              source: "sp_Commercial_Manager",
              id: "q2"
            }
          ]
        },
        {
          theme: "Technical Requirements",
          questions: [
            {
              question: "What are your existing systems that need integration?",
              source: "sp_Solution_Architect",
              id: "q3"
            }
          ]
        }
      ]
    };
    
    const customerAnswers = initialCustomerAnswers || `Here are my answers to your questions:

## Business Objectives
q1. Our primary business goals are to improve data quality and customer experience.
q2. We measure success through reduced errors and improved customer satisfaction scores.

## Technical Requirements
q3. We need integration with our Oracle ERP system and Salesforce CRM.`;
    
    const questionsAndAnswers = {
      organizedQuestions,
      customerAnswers
    };
    
    const development = {};
    for (const section of sections) {
      development[section] = `Draft for ${section} incorporating all customer answers about business objectives and technical requirements.`;
    }
    
    const reviews = {};
    sections.forEach(sec => {
      reviews[sec] = {
        review: 'Review feedback from the Quality Manager covering all aspects of the section including strategy, sales, technology, delivery, and commercial considerations.',
        customerQuestions: ['How do you plan to measure ROI?', 'What is your timeline for implementation?'],
        customerAnswers: initialCustomerReviewAnswers || 'Mock answers to review questions'
      };
    });
    
    const revisedDevelopment = {};
    sections.forEach(sec => {
      revisedDevelopment[sec] = `Revised draft for ${sec} after incorporating feedback and customer answers.`;
    });
    
    const approval = 'Final approval granted';
    const assembled = sections.map(sec => revisedDevelopment[sec]).join('\n\n');
    return { 
      analysis, 
      sections, 
      assignments, 
      questionsAndAnswers, 
      development, 
      reviews, 
      revisedDevelopment,
      approval, 
      assembled 
    };
  }
  
  // PRODUCTION FLOW USING RESPONSES API
  try {
    console.log(`[flowAgent] Starting production flow using Responses API`);
    const sections = Object.keys(defaultTemplate);
    
    // ===== PHASE 1: Brief Analysis & Planning =====
    
    // Step 1: Brief analysis
    console.log("[flowAgent] Phase 1.1: Starting brief analysis");
    
    briefFileId = await responsesAgent.createAndUploadFile(
      JSON.stringify(brief, null, 2),
      `${currentProposalId}_brief.json`
    );
    if (!briefFileId) {
      throw new Error("Failed to upload brief file or fileId missing.");
    }
    
    const analysisPrompt = "Analyze the provided customer brief thoroughly. Consider all aspects including business objectives, technical requirements, commercial aspects, and potential challenges. Provide a comprehensive assessment that will guide the proposal development process.";
    
    const analysisResponse = await responsesAgent.createInitialResponse(
      analysisPrompt,
      [briefFileId],
      "BriefAnalysis"
    );
    const analysis = analysisResponse.response || "Unable to generate analysis";
    
    responsesAgent.trackTokenUsage(analysisResponse, currentProposalId, "Phase1_BriefAnalysis");
    
    analysisFileId = await responsesAgent.createAndUploadFile(
      analysis,
      `${currentProposalId}_analysis.md`
    );
    if (!analysisFileId) {
      throw new Error("Failed to upload analysis file or fileId missing.");
    }
    
    responsesAgent.updateProgressStatus(currentProposalId, "Phase1_BriefAnalysis", "completed", {
      analysisFileId: analysisFileId
    });
    
    console.log("[flowAgent] Brief analysis completed");
    
    // Step 2: Section assignments
    console.log("[flowAgent] Phase 1.2: Starting section assignments");
    
    const availableRoles = Object.keys(assistantDefinitions).filter(role => role.startsWith('sp_'));
    
    const assignPrompt = `Based on the brief and analysis, assign these sections: ${sections.join(', ')}.
  
IMPORTANT: You must ONLY use these exact roles in your assignments: ${availableRoles.join(', ')}

Return a JSON object mapping each section name to exactly one of these role names.`;
    
    const assignResponse = await responsesAgent.createInitialResponse(
      assignPrompt,
      [briefFileId, analysisFileId],
      "SectionAssignments"
    );
    
    // Add extensive logging to debug the issue
    console.log(`[flowAgent] [DEBUG] Section Assignments Response Type: ${typeof assignResponse.response}`);
    
    // Safely log JSON representation
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
    
    // Safely log text property with type checking
    if (assignResponse.text !== undefined) {
        const textType = typeof assignResponse.text;
        console.log(`[flowAgent] [DEBUG] Section Assignments Text Type: ${textType}`);
        if (textType === 'string') {
            console.log(`[flowAgent] [DEBUG] Section Assignments Text: ${assignResponse.text.substring(0, 1000)}`);
        } else {
            console.log(`[flowAgent] [DEBUG] Section Assignments Text is not a string:`, assignResponse.text);
        }
    } else {
        console.log(`[flowAgent] [DEBUG] Section Assignments Text: Property undefined`);
    }
    
    // Safely log response property with type checking
    if (assignResponse.response !== undefined) {
        const respType = typeof assignResponse.response;
        console.log(`[flowAgent] [DEBUG] Section Assignments Response Type: ${respType}`);
        if (respType === 'string') {
            console.log(`[flowAgent] [DEBUG] Section Assignments Response: ${assignResponse.response.substring(0, 1000)}`);
        } else {
            console.log(`[flowAgent] [DEBUG] Section Assignments Response is not a string:`, assignResponse.response);
        }
    } else {
        console.log(`[flowAgent] [DEBUG] Section Assignments Response: Property undefined`);
    }
    
    // Try multiple properties in order of preference
    let responseText;
    let assignments;
    
    try {
      // Try text property first if it's a string
      if (assignResponse.text && typeof assignResponse.text === 'string') {
        console.log(`[flowAgent] Trying to parse text property (string)`);
        responseText = assignResponse.text;
        assignments = parseJson(responseText, "section assignments (text)");
      } 
      // Then try response property if it's a string
      else if (assignResponse.response && typeof assignResponse.response === 'string') {
        console.log(`[flowAgent] Trying to parse response property (string)`);
        responseText = assignResponse.response;
        assignments = parseJson(responseText, "section assignments (response)");
      } 
      // Then try the whole response object as a fallback
      else {
        console.log(`[flowAgent] No valid string property found, trying whole response object`);
        assignments = parseJson(assignResponse, "section assignments (full object)");
      }
    } catch (error) {
      console.error(`[flowAgent] Error parsing section assignments: ${error.message}`);
      throw new Error(`Failed to parse section assignments: ${error.message}`);
    }
    
    responsesAgent.trackTokenUsage(assignResponse, currentProposalId, "Phase1_SectionAssignments");
    
    assignmentsFileId = await responsesAgent.createAndUploadFile(
      JSON.stringify(assignments, null, 2),
      `${currentProposalId}_assignments.json`
    );
    if (!assignmentsFileId) {
      throw new Error("Failed to upload assignments file or fileId missing.");
    }
    
    responsesAgent.updateProgressStatus(currentProposalId, "Phase1_SectionAssignments", "completed", {
      assignmentsFileId: assignmentsFileId
    });
    
    console.log("[flowAgent] Section assignments completed");
    
    // --- rest of the file continues as before ---
