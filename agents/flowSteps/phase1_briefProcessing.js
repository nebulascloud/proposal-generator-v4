// agents/flowSteps/phase1_briefProcessing.js

const responsesAgent = require('../responsesAgent');
const contextModel = require('../../db/models/context');
const { PHASE1 } = require('./flowPrompts');
const { VALID_SPECIALISTS, assistantDefinitions } = require('../assistantDefinitions');
const Agent = require('../../db/models/agent');
const { getProposalSections, updateSessionStatus } = require('./flowUtilities');
const { retryWithBackoff } = require('../../utils/apiRetryHelper');

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
    // No sessionId available here if it's missing, so can't update status for this specific error.
    throw new Error('Missing required parameter for analyzeBrief');
  }
  try {
    await updateSessionStatus(sessionId, 'phase1.1_analyze_brief_started');
    // Use centralized prompt from flowPrompts.js
    const analysisPrompt = PHASE1.ANALYZE_BRIEF;

    // Ensure agent exists in DB before use
    const agentName = VALID_SPECIALISTS.SP_BRIEF_ANALYSIS;
    const instructions = assistantDefinitions[agentName];
    if (!instructions) throw new Error(`Missing assistant definition for ${agentName}`);
    await Agent.getOrCreate(agentName, instructions);

    // Call the AI agent for analysis
    const analysisResponse = await retryWithBackoff(
      (timeout) => responsesAgent.createInitialResponse(
        analysisPrompt,
        [briefContextId],
        VALID_SPECIALISTS.SP_BRIEF_ANALYSIS,
        'Brief Analysis',
        currentProposalId,
        null,
        false,
        { timeout }
      ),
      {
        retries: 3,
        initialDelay: 2000,
        maxDelay: 15000,
        operationDescription: `OpenAI API - Brief Analysis (proposalId: ${currentProposalId}, sessionId: ${sessionId})`,
        timeout: responsesAgent.apiTimeout
      }
    );

    // Log the analysis as a context in the database
    const analysisContext = await contextModel.create({
      data: analysisResponse.response,
      metadata: {
        jobId,
        phase: 'analyzeBrief', // This metadata phase can remain as is or be updated too
        proposalId: currentProposalId,
        sessionId,
        briefContextId,
        analysisResponseId: analysisResponse.id,
        createdAt: new Date().toISOString(),
      },
    });

    await updateSessionStatus(sessionId, 'phase1.1_analyze_brief_completed');
    return {
      analysisContextId: analysisContext.id,
      analysisResponseId: analysisResponse.id,
    };
  } catch (err) {
    await updateSessionStatus(sessionId, 'phase1.1_analyze_brief_failed');
    throw new Error(`Failed to analyze brief: ${err.message}`);
  }
}

/**
 * Phase 1.2: Section Assignments
 * Logs assignments as a context in the database (no files)
 * @param {string} currentProposalId
 * @param {string} sessionId
 * @param {string} briefContextId
 * @param {string} analysisContextId
 * @param {string} analysisResponseId
 * @param {string} jobId
 * @returns {Promise<{assignments: object, assignmentsContextId: string, assignResponseId: string}>}
 */
async function assignProposalSections(currentProposalId, sessionId, briefContextId, analysisContextId, analysisResponseId, jobId) {
  if (!currentProposalId || !sessionId || !briefContextId || !analysisContextId || !analysisResponseId || !jobId) {
    // No sessionId available here if it's missing, so can't update status for this specific error.
    throw new Error('Missing required parameter for assignProposalSections');
  }
  try {
    await updateSessionStatus(sessionId, 'phase1.2_assign_proposal_sections_started');
    // Get sections directly using the utility function
    // This also handles validation for missing/empty sections from the template
    const currentSections = getProposalSections();
    
    // Use centralized prompt from flowPrompts.js with formatted sections
    const sectionsText = currentSections.map(s => s.name || s).join(', ');
    const assignPrompt = PHASE1.ASSIGN_PROPOSAL_SECTIONS_WITH_SECTIONS.replace('{sections}', sectionsText);

    // Ensure agent exists in DB before use
    const agentName = VALID_SPECIALISTS.SP_COLLABORATION_ORCHESTRATOR;
    const instructions = assistantDefinitions[agentName];
    if (!instructions) throw new Error(`Missing assistant definition for ${agentName}`);
    await Agent.getOrCreate(agentName, instructions);

    // Call the AI agent for assignments
    const assignResponse = await retryWithBackoff(
      (timeout) => responsesAgent.createInitialResponse(
        assignPrompt,
        [briefContextId, analysisContextId],
        VALID_SPECIALISTS.SP_COLLABORATION_ORCHESTRATOR,
        'Section Assignments',
        currentProposalId,
        analysisResponseId,
        false,
        { timeout }
      ),
      {
        retries: 3,
        initialDelay: 2000,
        maxDelay: 15000,
        operationDescription: `OpenAI API - Section Assignments (proposalId: ${currentProposalId}, sessionId: ${sessionId})`,
        timeout: responsesAgent.apiTimeout
      }
    );

    // Parse assignments JSON
    let assignments;
    try {
      assignments = JSON.parse(assignResponse.response);
    } catch (err) {
      // Specific error for parsing, status update will be handled by the outer catch.
      throw new Error('Failed to parse assignments JSON: ' + err.message);
    }

    // Log assignments as a context in the database
    const assignmentsContext = await contextModel.create({
      data: JSON.stringify(assignments),
      metadata: {
        jobId,
        phase: 'assignProposalSections', // This metadata phase can remain as is or be updated too
        proposalId: currentProposalId,
        sessionId,
        briefContextId,
        analysisContextId,
        assignResponseId: assignResponse.id,
        createdAt: new Date().toISOString(),
      },
    });

    await updateSessionStatus(sessionId, 'phase1.2_assign_proposal_sections_completed');
    return {
      assignments,
      assignmentsContextId: assignmentsContext.id,
      assignResponseId: assignResponse.id,
    };
  } catch (err) {
    await updateSessionStatus(sessionId, 'phase1.2_assign_proposal_sections_failed');
    throw new Error(`Failed to assign proposal sections: ${err.message}`);
  }
}

module.exports = {
  analyzeBrief,
  assignProposalSections,
};
