// agents/flowAgentOrchestrator.js

const { initializeFlow } = require('./flowSteps/phase0_initializeFlow');
// Future: import other phase helpers as they are implemented

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
    // Destructure for next phases
    const { currentProposalId, sessionId, sections, briefFileId } = initResult;

    // TODO: Call subsequent phase helpers here, passing along required data
    // e.g. const { analysisFileId, ... } = await analyzeBrief(...);

    // For now, just return the initialization result
    return {
      ...initResult,
      status: 'initialized',
    };
  } catch (err) {
    // Top-level error handling
    console.error('runFullFlow error:', err);
    // TODO: Update session status to 'error' if needed
    throw err;
  }
}

module.exports = { runFullFlow };
