// agents/flowSteps/phase0_initializeFlow.js

const { v4: uuidv4 } = require('uuid');
const responsesAgent = require('../responsesAgent');
const defaultTemplate = require('../../templates/defaultTemplate');
const Session = require('../../db/models/session');
const path = require('path');
const contextModel = require('../../db/models/context');

/**
 * Phase 0: Initialization & Setup
 * @param {Object} brief
 * @param {Object} initialCustomerReviewAnswers
 * @param {string} jobId
 * @returns {Promise<{currentProposalId, sessionId, sections, briefFileId, initialCustomerReviewAnswers}>}
 */
async function initializeFlow(brief, initialCustomerReviewAnswers, jobId) {
  if (!brief) throw new Error('Missing required brief');
  if (!jobId) throw new Error('Missing required jobId');

  // Generate a new proposal ID
  const currentProposalId = uuidv4();

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

  // Create and store a new Session in the database
  let sessionId;
  try {
    const session = await Session.create({
      jobId,
      proposalId: currentProposalId,
      status: 'initialized',
      createdAt: new Date(),
    });
    sessionId = session.id;
  } catch (err) {
    throw new Error('Failed to create session: ' + err.message);
  }

  // Initialize sections from defaultTemplate
  const sections = defaultTemplate.sections ? JSON.parse(JSON.stringify(defaultTemplate.sections)) : [];

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
    throw new Error('Failed to log brief in contexts table: ' + err.message);
  }

  // Optionally log
  console.log(`[initializeFlow] Brief logged in contexts table: contextId=${contextId} jobId=${jobId}`);

  // Return all relevant outputs
  return {
    currentProposalId,
    sessionId,
    sections,
    contextId,
    initialCustomerReviewAnswers,
  };
}

module.exports = { initializeFlow };
