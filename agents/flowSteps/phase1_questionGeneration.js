// agents/flowSteps/phase1_questionGeneration.js

const responsesAgent = require('../responsesAgent');
const contextModel = require('../../db/models/context');
const { PHASE1 } = require('./flowPrompts');
const { VALID_SPECIALISTS, isValidSpecialist, getProperRoleName, assistantDefinitions } = require('../assistantDefinitions');
const Agent = require('../../db/models/agent');
const flowUtilities = require('./flowUtilities'); // Import the full module for access to all utilities
const { updateSessionStatus } = require('./flowUtilities'); // Added import
const { retryWithBackoff } = require('../../utils/apiRetryHelper');

/**
 * Phase 1.3: Specialist Question Generation
 * Logs questions as contexts in the database (no files)
 * @param {string} currentProposalId
 * @param {string} sessionId
 * @param {string} briefContextId
 * @param {string} analysisContextId
 * @param {Array<string>} specialistRoles
 * @param {string} assignResponseId
 * @param {string} jobId
 * @param {Array<string>} [additionalContextIds=[]] - Additional context IDs to include (for sequential mode)
 * @returns {Promise<{allQuestions: Array, questionsContextIds: Array, lastQuestionResponseId: string}>}
 */
async function generateSpecialistQuestions(currentProposalId, sessionId, briefContextId, analysisContextId, specialistRoles, assignResponseId, jobId, additionalContextIds = []) {
  if (!currentProposalId || !sessionId || !briefContextId || !analysisContextId || !specialistRoles || !assignResponseId || !jobId) {
    throw new Error('Missing required parameter for generateSpecialistQuestions');
  }
  
  // Ensure additionalContextIds is an array
  if (!Array.isArray(additionalContextIds)) {
    additionalContextIds = [];
  }
  try {
    await updateSessionStatus(sessionId, 'phase1.3_generate_specialist_questions_started');
    const allQuestions = [];
    const questionsContextIds = [];
    let lastQuestionResponseId = null;

    for (let role of specialistRoles) {
      // Get the proper role name from our predefined list
      const validRole = getProperRoleName(role);
      if (!validRole) {
        console.error(`[generateSpecialistQuestions] Invalid role "${role}" provided. This role will be skipped.`);
        continue;
      }
      
      const instructions = assistantDefinitions[validRole];
      if (!instructions) {
        console.error(`[generateSpecialistQuestions] Missing assistant definition for ${validRole}`);
        continue;
      }
      await Agent.getOrCreate(validRole, instructions);

      // Determine which prompt to use based on whether we're in sequential mode
      let questionPrompt;
      let previousQuestions = '';
      
      // Add any additional contexts to the context list
      const contextIds = [briefContextId, analysisContextId, ...additionalContextIds];
      
      // If we have additional contexts (sequential mode), use the sequential prompt and get previous questions
      if (additionalContextIds.length > 0) {
        // In sequential mode, we need to fetch the previous questions to show in the prompt
        try {
          // Get the previous questions from the context
          for (const contextId of additionalContextIds) {
            let context = await contextModel.getById(contextId); // Removed findByPk check
            if (context && context.data) {
              const previousQuestionsData = typeof context.data === 'object' ? context.data : JSON.parse(context.data);
              previousQuestions += flowUtilities.formatPreviousQuestions(previousQuestionsData) + '\\n\\n';
            }
          }
          
          // Use the sequential prompt with previous questions included
          questionPrompt = PHASE1.GENERATE_SPECIALIST_QUESTIONS_SEQUENTIAL
            .replace('{role}', validRole)
            .replace('{previousQuestions}', previousQuestions || 'No previous questions available.');
            
          console.log(`[Sequential Mode] Generating questions for ${validRole} with context from previous specialists`);
        } catch (err) {
          console.warn(`Error retrieving previous questions: ${err.message}. Falling back to standard prompt.`);
          questionPrompt = PHASE1.GENERATE_SPECIALIST_QUESTIONS.replace('{role}', validRole);
        }
      } else {
        // Standard parallel mode prompt
        questionPrompt = PHASE1.GENERATE_SPECIALIST_QUESTIONS.replace('{role}', validRole);
      }
      
      const response = await retryWithBackoff(
        (timeout) => responsesAgent.createInitialResponse(
          questionPrompt,
          contextIds,
          validRole,
          'Specialist Questions',
          currentProposalId,
          assignResponseId,
          false,
          { timeout }
        ),
        {
          retries: 3,
          initialDelay: 2000,
          maxDelay: 15000,
          operationDescription: `OpenAI API - Specialist Questions (${validRole}, proposalId: ${currentProposalId}, sessionId: ${sessionId})`,
          timeout: responsesAgent.apiTimeout
        }
      );
      lastQuestionResponseId = response.id;
      let roleQuestions = [];
      try {
        const parsedResponse = JSON.parse(response.response);
        
        // Expect format: {"questions": [array of questions]}
        if (parsedResponse && parsedResponse.questions && Array.isArray(parsedResponse.questions)) {
          roleQuestions = parsedResponse.questions;
        } else {
          console.warn(`Unexpected response format from ${validRole}, expected {"questions": [...]}, got:`, 
                      JSON.stringify(parsedResponse).substring(0, 200)); // Increased substring length for better debugging
          // Attempt to handle direct array as a fallback, though this should be rare with the new prompt
          if (Array.isArray(parsedResponse)) {
            console.warn(`Fallback: ${validRole} returned a direct array. Processing as is.`);
            roleQuestions = parsedResponse;
          } else {
            roleQuestions = []; // Ensure roleQuestions is an array to prevent downstream errors
          }
        }
      } catch (err) {
        // Log the problematic response string for easier debugging
        console.error(`Failed to parse questions JSON for role ${validRole}. Response string:`, response.response);
        throw new Error(`Failed to parse questions JSON for role ${validRole}: ` + err.message);
      }
      
      // Add role to each question
      const questionsWithRole = roleQuestions.map(q => ({ ...q, role: validRole }));
      console.log(`Processing ${questionsWithRole.length} questions from ${validRole}`);
      allQuestions.push(...questionsWithRole);
      // Log as context
      const context = await contextModel.create({
        data: JSON.stringify(questionsWithRole),
        metadata: {
          jobId,
          phase: 'generateSpecialistQuestions', // This metadata phase can remain as is or be updated too
          proposalId: currentProposalId,
          sessionId,
          briefContextId,
          analysisContextId,
          role: validRole,
          responseId: response.id,
          createdAt: new Date().toISOString(),
        },
      });
      questionsContextIds.push(context.id);
    }
    await updateSessionStatus(sessionId, 'phase1.3_generate_specialist_questions_completed');
    return {
      allQuestions,
      questionsContextIds,
      lastQuestionResponseId,
    };
  } catch (err) {
    await updateSessionStatus(sessionId, 'phase1.3_generate_specialist_questions_failed');
    // Add more specific error message if possible
    throw new Error(`Failed to generate specialist questions: ${err.message}`);
  }
}

/**
 * Phase 1.4: Question Organization & Deduplication
 * Logs organized questions as a context in the database (no files)
 * @param {string} currentProposalId
 * @param {string} sessionId
 * @param {string} briefContextId
 * @param {string} analysisContextId
 * @param {Array} allQuestions
 * @param {string} lastQuestionResponseId
 * @param {string} jobId
 * @returns {Promise<{organizedQuestions: object, organizedQuestionsContextId: string, organizedQuestionsResponseId: string}>}
 */
async function organizeAllQuestions(currentProposalId, sessionId, briefContextId, analysisContextId, allQuestions, lastQuestionResponseId, jobId) {
  if (!currentProposalId || !sessionId || !briefContextId || !analysisContextId || !allQuestions || !lastQuestionResponseId || !jobId) {
    throw new Error('Missing required parameter for organizeAllQuestions');
  }
  try {
    await updateSessionStatus(sessionId, 'phase1.4_organize_all_questions_started');
    
    // Removed MAX_QUESTIONS and related question limiting/distribution logic
    
    // Use centralized prompt from flowPrompts.js with questions placeholder replaced
    // The 'allQuestions' variable here will be the original, unfiltered list.
    const dedupePrompt = PHASE1.ORGANIZE_ALL_QUESTIONS.replace('{allQuestions}', JSON.stringify(allQuestions));
    
    // Log the number of questions being processed (preserve existing logging)
    console.log(`Organizing questions. Processing ${allQuestions.length} questions...`);

    // Use retryWithBackoff instead of manual retry logic
    const response = await retryWithBackoff(
      (timeout) => responsesAgent.createInitialResponse(
        dedupePrompt,
        [briefContextId, analysisContextId],
        VALID_SPECIALISTS.SP_COLLABORATION_ORCHESTRATOR,
        'Organize Questions',
        currentProposalId,
        lastQuestionResponseId,
        false,
        { timeout }
      ),
      {
        retries: 3,
        initialDelay: 2000,
        maxDelay: 15000,
        operationDescription: `OpenAI API - Organize Questions (proposalId: ${currentProposalId}, sessionId: ${sessionId})`,
        timeout: responsesAgent.apiTimeout
      }
    );
    let organizedQuestions;
    try {
      organizedQuestions = JSON.parse(response.response);
    } catch (err) {
      throw new Error('Failed to parse organized questions JSON: ' + err.message);
    }
    const context = await contextModel.create({
      data: JSON.stringify(organizedQuestions),
      metadata: {
        jobId,
        phase: 'organizeAllQuestions', // This metadata phase can remain as is or be updated too
        proposalId: currentProposalId,
        sessionId,
        briefContextId,
        analysisContextId,
        responseId: response.id,
        createdAt: new Date().toISOString(),
      },
    });
    await updateSessionStatus(sessionId, 'phase1.4_organize_all_questions_completed');
    return {
      organizedQuestions,
      organizedQuestionsContextId: context.id,
      organizedQuestionsResponseId: response.id,
    };
  } catch (err) {
    await updateSessionStatus(sessionId, 'phase1.4_organize_all_questions_failed');
    throw new Error(`Failed to organize all questions: ${err.message}`);
  }
}

module.exports = {
  generateSpecialistQuestions,
  organizeAllQuestions,
};
