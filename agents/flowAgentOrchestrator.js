// agents/flowAgentOrchestrator.js

const { initializeFlow } = require('./flowSteps/phase0_initializeFlow');
const { analyzeBrief, assignProposalSections } = require('./flowSteps/phase1_briefProcessing');
const { generateSpecialistQuestions, organizeAllQuestions } = require('./flowSteps/phase1_questionGeneration');
// const { defaultTemplate } = require('../templates/defaultTemplate'); // No longer directly used here for specialist list
const { getAssignableSpecialists } = require('./assistantDefinitions'); // Import getAssignableSpecialists

/**
 * Orchestrates the full proposal generation flow by calling each phase helper in sequence.
 * @param {Object} params
 * @param {Object} params.brief
 * @param {Object} [params.customerReviewAnswers]
 * @param {string} params.jobId
 * @returns {Promise<Object>} Final result of the flow
 */
async function runFullFlow({ brief, customerReviewAnswers, jobId }) {
  try {
    // --- Phase 0: Initialization & Setup ---
    const initResult = await initializeFlow(brief, customerReviewAnswers, jobId);
    // sections is no longer returned by initializeFlow
    const { currentProposalId, sessionId, contextId: briefContextId } = initResult;

    // --- Phase 1.1: Brief Analysis ---
    const { analysisContextId, analysisResponseId } = await analyzeBrief(currentProposalId, sessionId, briefContextId, jobId);

    // --- Phase 1.2: Section Assignments ---
    // SECTION_NAMES and sections parameter are removed as assignProposalSections will get sections directly
    // const SECTION_NAMES = Object.keys(defaultTemplate); // Removed

    const { assignments, assignmentsContextId, assignResponseId } = await assignProposalSections(
      currentProposalId, sessionId, briefContextId, analysisContextId, /* sections, */ analysisResponseId, jobId // sections parameter removed
    );

    // --- Phase 1.3: Specialist Question Generation ---
    // Get assignable specialist agent names using the function from assistantDefinitions
    const specialistAgentNames = getAssignableSpecialists();

    // Determine specialist roles from assignments (this might be redundant or used for a different purpose later)
    // const specialistRoles = Array.from(new Set(Object.values(assignments))); 
    // For now, we iterate through specialistAgentNames derived from getAssignableSpecialists for question generation.

    let allQuestions = [];
    let lastQuestionResponseId = null;
    
    // For logging/debugging purposes
    console.log(`Starting question generation for ${specialistAgentNames.length} specialist agents`);
    
    for (const agentName of specialistAgentNames) {
      // Generate questions for each agent using the standard interface defined in refactoring plan
      const result = await generateSpecialistQuestions(
        currentProposalId, sessionId, briefContextId, analysisContextId, [agentName], assignResponseId, jobId
      );
      
      // Standard interface per the refactoring plan
      if (!result.allQuestions || !Array.isArray(result.allQuestions)) {
        console.error(`Error: generateSpecialistQuestions for ${agentName} did not return expected allQuestions array`);
        continue;
      }
      
      console.log(`Collected ${result.allQuestions.length} questions from ${agentName}`);
      allQuestions = allQuestions.concat(result.allQuestions);
      // Correctly update lastQuestionResponseId with the ID from the latest specialist question generation
      if (result.lastQuestionResponseId) {
        lastQuestionResponseId = result.lastQuestionResponseId;
      }
    }

    // --- Phase 1.4: Question Organization & Deduplication ---
    // Pass the correct lastQuestionResponseId from the specialist question generation loop
    const { organizedQuestions, organizedQuestionsContextId, organizedQuestionsResponseId } = await organizeAllQuestions(
      currentProposalId, sessionId, briefContextId, analysisContextId, allQuestions, lastQuestionResponseId, jobId // Corrected: use lastQuestionResponseId
    );

    // Return all outputs for now (future: continue to next phases)
    return {
      ...initResult,
      analysisContextId,
      analysisResponseId,
      assignments,
      assignmentsContextId,
      assignResponseId,
      allQuestions,
      organizedQuestions,
      organizedQuestionsContextId,
      organizedQuestionsResponseId,
      status: 'phase1_complete',
    };
  } catch (err) {
    // Top-level error handling
    console.error('runFullFlow error:', err);
    throw err;
  }
}

module.exports = { runFullFlow };
