/**
 * Test script to run individual flow steps from the proposal generator
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

// Import flow steps
const flowPrompts = require('./agents/flowSteps/flowPrompts');
const flowUtilities = require('./agents/flowSteps/flowUtilities');
const phase0_initializeFlow = require('./agents/flowSteps/phase0_initializeFlow');
const phase1_briefProcessing = require('./agents/flowSteps/phase1_briefProcessing');
const phase1_questionGeneration = require('./agents/flowSteps/phase1_questionGeneration');

// Sample brief for testing
const sampleBrief = `
We need a new CRM system to replace our outdated solution. 
Key requirements:
- Integration with our existing ERP system (SAP)
- Mobile app for sales team
- Custom reporting dashboard
- Cloud-based with high security standards
- Budget: $100,000-$150,000
- Timeline: Implementation within 6 months
`;

// Test function to run flow steps
async function runFlowSteps() {
  try {
    console.log('Starting flow steps execution...');
    
    // Generate a test proposal ID
    const proposalId = 'test-proposal-' + Date.now();
    console.log(`Using test proposal ID: ${proposalId}`);
    
    // Phase 0: Initialize flow
    console.log('\n=== PHASE 0: INITIALIZE FLOW ===');
    const initializeResult = await phase0_initializeFlow.initializeFlow(sampleBrief, proposalId);
    console.log('Flow initialized:', initializeResult);
    
    // Phase 1a: Brief processing
    console.log('\n=== PHASE 1a: BRIEF PROCESSING ===');
    const briefAnalysisResult = await phase1_briefProcessing.analyzeBrief(sampleBrief, proposalId);
    console.log('Brief analysis result:', briefAnalysisResult);

    const sectionAssignmentsResult = await phase1_briefProcessing.assignProposalSections(briefAnalysisResult, proposalId);
    console.log('Section assignments:', sectionAssignmentsResult);
    
    // Phase 1b: Question generation
    console.log('\n=== PHASE 1b: QUESTION GENERATION ===');
    
    // Extract roles from section assignments
    const specialistRoles = Object.values(sectionAssignmentsResult);
    console.log('Specialist roles extracted:', specialistRoles);
    
    // Mock values for required parameters that weren't previously passed
    const mockSessionId = `session-${Date.now()}`;
    const briefContextId = `brief-context-${Date.now()}`;
    const analysisContextId = `analysis-context-${Date.now()}`; 
    const assignResponseId = null; // No previous response to chain
    const jobId = `job-${Date.now()}`;
    
    const specialistQuestions = await phase1_questionGeneration.generateSpecialistQuestions(
      proposalId, // currentProposalId
      mockSessionId,
      briefContextId,
      analysisContextId,
      specialistRoles, // The array of role names
      assignResponseId,
      jobId
    );
    console.log('Specialist questions:', specialistQuestions);
    
    const organizedQuestions = await phase1_questionGeneration.organizeAllQuestions(
      proposalId, // currentProposalId
      mockSessionId,
      briefContextId,
      analysisContextId,
      specialistQuestions.allQuestions, // Pass the questions array
      specialistQuestions.lastQuestionResponseId,
      jobId
    );
    console.log('Organized questions:', organizedQuestions);
    
    console.log('\nAll flow steps completed successfully!');
    return {
      proposalId,
      briefAnalysis: briefAnalysisResult,
      sectionAssignments: sectionAssignmentsResult,
      specialistQuestions,
      organizedQuestions
    };
  } catch (error) {
    console.error('Error running flow steps:', error);
    throw error;
  }
}

// Run the flow steps
runFlowSteps()
  .then(results => {
    console.log('\nFlow steps execution completed successfully.');
    // Save results to file for inspection
    fs.writeFileSync(
      path.join(__dirname, 'flow-steps-results.json'), 
      JSON.stringify(results, null, 2)
    );
    console.log('Results saved to flow-steps-results.json');
  })
  .catch(error => {
    console.error('Flow steps execution failed:', error);
    process.exit(1);
  });
