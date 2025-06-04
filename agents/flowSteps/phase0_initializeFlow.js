// agents/flowSteps/phase0_initializeFlow.js

const { v4: uuidv4 } = require('uuid');
const responsesAgent = require('../responsesAgent');
const Session = require('../../db/models/session');
const contextModel = require('../../db/models/context');
const { updateSessionStatus } = require('./flowUtilities');
const { assistantDefinitions } = require('../assistantDefinitions');
const Agent = require('../../db/models/agent');

/**
 * Phase 0: Initialization & Setup
 * @param {Object} brief
 * @param {Object} initialCustomerReviewAnswers
 * @param {string} jobId
 * @returns {Promise<{currentProposalId, sessionId, briefFileId, initialCustomerReviewAnswers}>}
 */
async function initializeFlow(brief, initialCustomerReviewAnswers, jobId) {
  if (!brief) throw new Error('Missing required brief');
  if (!jobId) throw new Error('Missing required jobId');

  // Generate a new proposal ID
  const currentProposalId = uuidv4();
  let sessionId; // Declare sessionId here to be available in catch block

  // --- Agent DB Sync (Phase 0) ---
  // This is a batch sync, so we degrade gracefully and warn if any fail
  const failedAgents = [];
  for (const [agentName, instructions] of Object.entries(assistantDefinitions)) {
    try {
      await Agent.getOrCreate(agentName, instructions);
    } catch (err) {
      failedAgents.push({ agentName, error: err.message });
      // Optionally: log error
      console.warn(`[Phase0 Agent Sync] Failed to sync agent '${agentName}': ${err.message}`);
    }
  }
  if (failedAgents.length) {
    // Log a warning, but do not throw. The flow can continue, but downstream steps should check for missing agents as needed.
    console.warn(`[Phase0 Agent Sync] Some agents failed to sync:`, failedAgents.map(a => a.agentName).join(', '));
  }

  try {
    // Create and store a new Session in the database
    // Initial status will be 'creating_session' or similar, then updated.
    // For now, let's assume 'phase0_started' is the first status after creation.
    const session = await Session.create({
      jobId,
      proposalId: currentProposalId,
      status: 'phase0_initialize_flow_started', // Standardized initial status
      createdAt: new Date(),
    });
    sessionId = session.id;
    // Explicit status update, though technically set at creation, this ensures the utility is used.
    await updateSessionStatus(sessionId, 'phase0_initialize_flow_started'); // Explicit status update

    // Reset responsesAgent progress (assume a resetProgress method exists)
    if (typeof responsesAgent.resetProgress === 'function') {
      await responsesAgent.resetProgress();
    }

    // Log initial inputs (could be expanded for audit)
    console.log('Initializing flow with jobId:', jobId, 'proposalId:', currentProposalId);

    // Associate jobId with proposalId in global.flowJobs
    if (global.flowJobs) {
      global.flowJobs[jobId] = { proposalId: currentProposalId };
    }

    // Sections are no longer initialized or returned here
    // They will be fetched by phase1_briefProcessing.js using a utility function

    // Store the brief in the contexts table
    let contextId;
    let contextRecord;
    try {
      contextRecord = await contextModel.create({
        data: JSON.stringify(brief),
        metadata: { jobId, phase: 'initializeFlow', createdAt: new Date().toISOString() },
      });
      contextId = contextRecord.id;
    } catch (err) {
      await updateSessionStatus(sessionId, 'phase0_initialize_flow_failed_brief_logging');
      throw new Error('Failed to log brief in contexts table: ' + err.message);
    }

    // Optionally log
    console.log(`[initializeFlow] Brief logged in contexts table: contextId=${contextId} jobId=${jobId}`);

    await updateSessionStatus(sessionId, 'phase0_initialize_flow_completed'); // Mark phase0 as completed

    // Return all relevant outputs
    return {
      currentProposalId,
      sessionId,
      contextId,
      initialCustomerReviewAnswers,
    };
  } catch (err) {
    // If sessionId was obtained, update status to failed.
    if (sessionId) {
      const currentSession = await Session.findByPk(sessionId);
      // Check if a more specific failure status was already set by a nested try/catch
      if (currentSession && !currentSession.status.startsWith('phase0_initialize_flow_failed')) {
        await updateSessionStatus(sessionId, 'phase0_initialize_flow_failed');
      }
    }
    // Re-throw the error to be handled by the caller
    // Avoid creating a new error here if it's just for re-throwing,
    // unless adding more context.
    throw new Error(`Failed to initialize flow: ${err.message}`);
  }
}

module.exports = { initializeFlow };
