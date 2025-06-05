// agents/flowAgentOrchestrator.js

const { initializeFlow } = require('./flowSteps/phase0_initializeFlow');
const { analyzeBrief, assignProposalSections } = require('./flowSteps/phase1_briefProcessing');
const { generateSpecialistQuestions, organizeAllQuestions } = require('./flowSteps/phase1_questionGeneration');
// const { defaultTemplate } = require('../templates/defaultTemplate'); // No longer directly used here for specialist list
const { getAssignableSpecialists, assistantDefinitions } = require('./assistantDefinitions'); // Import getAssignableSpecialists
const Agent = require('../db/models/agent');

/**
 * Orchestrates the full proposal generation flow by calling each phase helper in sequence.
 * @param {Object} params
 * @param {Object} params.brief
 * @param {Object} [params.customerReviewAnswers]
 * @param {string} params.jobId
 * @param {boolean} [params.parallelAgentQuestionsMode=true] If true, agent questions are generated in parallel. If false, questions are generated sequentially with context chaining.
 * @returns {Promise<Object>} Final result of the flow
 */
async function runFullFlow({ brief, customerReviewAnswers, jobId, parallelAgentQuestionsMode = true }) {
  try {
    // --- Initial Agent Sync (Warm-up) ---
    for (const [agentName, instructions] of Object.entries(assistantDefinitions)) {
      try {
        await Agent.getOrCreate(agentName, instructions);
      } catch (err) {
        console.error(`[Agent Sync] Failed to sync agent '${agentName}':`, err.message);
        // Optionally: throw or continue depending on strictness required
      }
    }

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

    // Log which mode we're using for question generation
    console.log(`Using ${parallelAgentQuestionsMode ? 'PARALLEL' : 'SEQUENTIAL'} mode for agent question generation`);

    let allQuestions = [];
    let questionsContextIds = [];
    let lastQuestionResponseId = null;
    let warnings = [];
    
    // For logging/debugging purposes
    console.log(`Starting question generation for ${specialistAgentNames.length} specialist agents`);
    
    if (parallelAgentQuestionsMode) {
      // PARALLEL MODE: Process all agents in parallel using Promise.all
      console.log('Running specialist question generation in PARALLEL mode');
      
      try {
        const questionPromises = specialistAgentNames.map(agentName => 
          generateSpecialistQuestions(
            currentProposalId, sessionId, briefContextId, analysisContextId, 
            [agentName], assignResponseId, jobId
          ).catch(error => {
            // Capture errors but don't fail the entire process
            console.error(`Error generating questions for ${agentName}:`, error);
            warnings.push({ agent: agentName, error: error.message });
            // Return a placeholder result to maintain array structure
            return { allQuestions: [], questionsContextIds: [], lastQuestionResponseId: null };
          })
        );
        
        // Wait for all question generation to complete
        const results = await Promise.all(questionPromises);
        
        // Process the results
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const agentName = specialistAgentNames[i];
          
          if (result.allQuestions && Array.isArray(result.allQuestions)) {
            console.log(`Collected ${result.allQuestions.length} questions from ${agentName}`);
            allQuestions = allQuestions.concat(result.allQuestions);
            
            // Collect context IDs and update lastQuestionResponseId
            if (result.questionsContextIds) {
              questionsContextIds = questionsContextIds.concat(result.questionsContextIds);
            }
            
            if (result.lastQuestionResponseId) {
              lastQuestionResponseId = result.lastQuestionResponseId;
            }
          }
        }
      } catch (error) {
        console.error('Error in parallel question generation:', error);
        throw new Error(`Failed to generate questions in parallel mode: ${error.message}`);
      }
    } else {
      // SEQUENTIAL MODE: Process agents one by one, passing previous questions as context
      console.log('Running specialist question generation in SEQUENTIAL mode');
      
      // Keep track of all previous questions context IDs
      let allPreviousQuestionContextIds = [];
      
      for (const agentName of specialistAgentNames) {
        try {
          // Generate questions for each agent, passing ALL previous question contexts
          // This ensures each agent sees questions from ALL previous agents, not just the last one
          const result = await generateSpecialistQuestions(
            currentProposalId, sessionId, briefContextId, analysisContextId, 
            [agentName], assignResponseId, jobId, allPreviousQuestionContextIds
          );
          
          if (!result.allQuestions || !Array.isArray(result.allQuestions)) {
            console.error(`Error: generateSpecialistQuestions for ${agentName} did not return expected allQuestions array`);
            warnings.push({ agent: agentName, error: 'Failed to generate expected question format' });
            continue;
          }
          
          console.log(`Collected ${result.allQuestions.length} questions from ${agentName}`);
          allQuestions = allQuestions.concat(result.allQuestions);
          
          // Update context IDs and lastQuestionResponseId
          if (result.questionsContextIds && result.questionsContextIds.length > 0) {
            questionsContextIds = questionsContextIds.concat(result.questionsContextIds);
            // Add the new question context to our accumulated list
            allPreviousQuestionContextIds = allPreviousQuestionContextIds.concat(result.questionsContextIds);
            console.log(`Added questions from ${agentName} to context. Now have ${allPreviousQuestionContextIds.length} question contexts.`);
          }
          
          if (result.lastQuestionResponseId) {
            lastQuestionResponseId = result.lastQuestionResponseId;
          }
        } catch (error) {
          console.error(`Error generating questions for ${agentName}:`, error);
          warnings.push({ agent: agentName, error: error.message });
        }
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
      questionGenerationMode: parallelAgentQuestionsMode ? 'parallel' : 'sequential',
      warnings: warnings.length > 0 ? warnings : undefined, // Only include warnings if there are any
      status: 'phase1_complete',
    };
  } catch (err) {
    // Top-level error handling
    console.error('runFullFlow error:', err);
    throw err;
  }
}

module.exports = { runFullFlow };
