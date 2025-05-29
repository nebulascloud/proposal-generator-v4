// agents/flowAgentOrchestrator.js

const { initializeFlow } = require('./flowSteps/phase0_initializeFlow');
const { analyzeBrief, assignProposalSections } = require('./flowSteps/phase1_briefProcessing');
const { generateSpecialistQuestions, organizeAllQuestions } = require('./flowSteps/phase1_questionGeneration');

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
    const { assignments, assignmentsContextId, assignResponseId } = await assignProposalSections(
      currentProposalId, sessionId, briefContextId, analysisContextId, sections, analysisResponseId, jobId
    );

    // --- Phase 1.3: Specialist Question Generation ---
    // Determine specialist roles from assignments
    const specialistRoles = Array.from(new Set(Object.values(assignments)));
    const { allQuestions, questionsContextIds, lastQuestionResponseId } = await generateSpecialistQuestions(
      currentProposalId, sessionId, briefContextId, analysisContextId, specialistRoles, assignResponseId, jobId
    );

    // --- Phase 1.4: Question Organization & Deduplication ---
    const { organizedQuestions, organizedQuestionsContextId, organizedQuestionsResponseId } = await organizeAllQuestions(
      currentProposalId, sessionId, briefContextId, analysisContextId, allQuestions, lastQuestionResponseId, jobId
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
      questionsContextIds,
      lastQuestionResponseId,
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
