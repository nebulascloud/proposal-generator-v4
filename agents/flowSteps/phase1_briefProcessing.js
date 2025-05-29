// agents/flowSteps/phase1_briefProcessing.js

const responsesAgent = require('../responsesAgent');
const contextModel = require('../../db/models/context');
const { PHASE1 } = require('./flowPrompts');
const { VALID_SPECIALISTS } = require('../assistantDefinitions');

/**
 * Phase 1.1: Brief Analysis
 * Logs the analysis as a context in the database (no files)
 * @param {string} currentProposalId
 * @param {string} sessionId
 * @param {string} briefContextId
 * @param {string} jobId
 * @returns {Promise<{analysisContextId: string, analysisResponseId: string}>}
 */
async function analyzeBrief(currentProposalId, sessionId, briefContextId, jobId) {
  if (!currentProposalId || !sessionId || !briefContextId || !jobId) {
    throw new Error('Missing required parameter for analyzeBrief');
  }
  // Use centralized prompt from flowPrompts.js
  const analysisPrompt = PHASE1.ANALYZE_BRIEF;

  // Call the AI agent for analysis
  const analysisResponse = await responsesAgent.createInitialResponse(
    analysisPrompt,
    [briefContextId],
    VALID_SPECIALISTS.SP_BRIEF_ANALYSIS,
    'Brief Analysis',
    currentProposalId
  );

  // Log the analysis as a context in the database
  const analysisContext = await contextModel.create({
    data: analysisResponse.response,
    metadata: {
      jobId,
      phase: 'analyzeBrief',
      proposalId: currentProposalId,
      sessionId,
      briefContextId,
      analysisResponseId: analysisResponse.id,
      createdAt: new Date().toISOString(),
    },
  });

  return {
    analysisContextId: analysisContext.id,
    analysisResponseId: analysisResponse.id,
  };
}

/**
 * Phase 1.2: Section Assignments
 * Logs assignments as a context in the database (no files)
 * @param {string} currentProposalId
 * @param {string} sessionId
 * @param {string} briefContextId
 * @param {string} analysisContextId
 * @param {Array} sections
 * @param {string} analysisResponseId
 * @param {string} jobId
 * @returns {Promise<{assignments: object, assignmentsContextId: string, assignResponseId: string}>}
 */
async function assignProposalSections(currentProposalId, sessionId, briefContextId, analysisContextId, sections, analysisResponseId, jobId) {
  if (!currentProposalId || !sessionId || !briefContextId || !analysisContextId || !sections || !analysisResponseId || !jobId) {
    throw new Error('Missing required parameter for assignProposalSections');
  }
  // Use centralized prompt from flowPrompts.js with formatted sections
  const sectionsText = sections.map(s => s.name || s).join(', ');
  const assignPrompt = PHASE1.ASSIGN_PROPOSAL_SECTIONS_WITH_SECTIONS.replace('{sections}', sectionsText);

  // Call the AI agent for assignments
  const assignResponse = await responsesAgent.createInitialResponse(
    assignPrompt,
    [briefContextId, analysisContextId],
    VALID_SPECIALISTS.SP_COLLABORATION_ORCHESTRATOR,
    'Section Assignments',
    currentProposalId,
    analysisResponseId
  );

  // Parse assignments JSON
  let assignments;
  try {
    assignments = JSON.parse(assignResponse.response);
  } catch (err) {
    throw new Error('Failed to parse assignments JSON: ' + err.message);
  }

  // Log assignments as a context in the database
  const assignmentsContext = await contextModel.create({
    data: JSON.stringify(assignments),
    metadata: {
      jobId,
      phase: 'assignProposalSections',
      proposalId: currentProposalId,
      sessionId,
      briefContextId,
      analysisContextId,
      assignResponseId: assignResponse.id,
      createdAt: new Date().toISOString(),
    },
  });

  return {
    assignments,
    assignmentsContextId: assignmentsContext.id,
    assignResponseId: assignResponse.id,
  };
}

module.exports = {
  analyzeBrief,
  assignProposalSections,
};
