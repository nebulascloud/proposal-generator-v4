// agents/flowAgentOrchestrator.js

const { initializeFlow } = require('./flowSteps/phase0_initializeFlow');
const { analyzeBrief, assignProposalSections } = require('./flowSteps/phase1_briefProcessing');
const { generateSpecialistQuestions, organizeAllQuestions } = require('./flowSteps/phase1_questionGeneration');
const { defaultTemplate } = require('../templates/defaultTemplate');
const { VALID_SPECIALISTS } = require('./assistantDefinitions');

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
    const { currentProposalId, sessionId, sections, contextId: briefContextId } = initResult;

    // --- Phase 1.1: Brief Analysis ---
    const { analysisContextId, analysisResponseId } = await analyzeBrief(currentProposalId, sessionId, briefContextId, jobId);

    // --- Phase 1.2: Section Assignments ---
    // For section assignment and related logic, use Object.keys(defaultTemplate) as the canonical section list
    const SECTION_NAMES = Object.keys(defaultTemplate);

    const { assignments, assignmentsContextId, assignResponseId } = await assignProposalSections(
      currentProposalId, sessionId, briefContextId, analysisContextId, sections, analysisResponseId, jobId
    );

    // --- Phase 1.3: Specialist Question Generation ---
    // Get all specialist agent names starting with 'sp_' (excluding cst_Customer)
    const specialistAgentNames = Object.values(VALID_SPECIALISTS).filter(
      name => name.startsWith('sp_')
    );

    // Determine specialist roles from assignments
    const specialistRoles = Array.from(new Set(Object.values(assignments)));
    // When generating specialist questions, use all specialistAgentNames
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
      lastQuestionResponseId = result.lastQuestionResponseId;
    }

    // --- Phase 1.4: Question Organization & Deduplication ---
    // Pass lastQuestionResponseId as required by organizeAllQuestions
    const { organizedQuestions, organizedQuestionsContextId, organizedQuestionsResponseId } = await organizeAllQuestions(
      currentProposalId, sessionId, briefContextId, analysisContextId, allQuestions, assignResponseId, jobId
    );

    // Return all outputs for now (future: continue to next phases)
    return {
      ...initResult,
      analysisContextId,
      analysisResponseId,
      assignments,
      assignmentsContextId,
      assignResponseId,
      specialistRoles,
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
