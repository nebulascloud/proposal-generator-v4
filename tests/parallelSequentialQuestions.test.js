// tests/parallelSequentialQuestions.test.js

jest.mock('../agents/assistantDefinitions', () => {
  const realDefs = jest.requireActual('../agents/assistantDefinitions');
  return {
    ...realDefs,
    getAssignableSpecialists: jest.fn(() => ['sp_Account_Manager', 'sp_Project_Manager']),
    getAssignableSpecialistsString: jest.fn(() => '- sp_Account_Manager\n- sp_Project_Manager'),
    getProperRoleName: realDefs.getProperRoleName,
    VALID_SPECIALISTS: realDefs.VALID_SPECIALISTS,
  };
});

jest.mock('../agents/responsesAgent', () => ({
  resetProgress: jest.fn(),
  createAndUploadFile: jest.fn(),
  createInitialResponse: jest.fn().mockImplementation((prompt) => {
    // Return different responses based on the prompt
    if (prompt.includes('AVOID ASKING DUPLICATE OR SIMILAR QUESTIONS')) {
      // Sequential mode response
      return {
        id: `response-${Date.now()}`,
        response: JSON.stringify({
          questions: [
            { question: "Unique sequential question 1", importance: "high", rationale: "Sequential mode test" },
            { question: "Unique sequential question 2", importance: "medium", rationale: "Sequential mode test" }
          ]
        })
      };
    } else {
      // Parallel mode response
      return {
        id: `response-${Date.now()}`,
        response: JSON.stringify({
          questions: [
            { question: "Standard question 1", importance: "high", rationale: "Parallel mode test" },
            { question: "Standard question 2", importance: "medium", rationale: "Parallel mode test" }
          ]
        })
      };
    }
  }),
  forkResponse: jest.fn(),
  trackTokenUsage: jest.fn(),
  updateProgressStatus: jest.fn(),
  getTokenUsageReport: jest.fn(),
}));

jest.mock('../db/models/context', () => ({
  create: jest.fn().mockImplementation(() => ({
    id: `context-${Date.now()}`
  })),
  getById: jest.fn().mockImplementation(() => ({
    id: `context-${Date.now()}`,
    data: JSON.stringify([
      { question: "Previous question 1", role: "sp_Account_Manager", importance: "high" },
      { question: "Previous question 2", role: "sp_Account_Manager", importance: "medium" }
    ])
  }))
}));

jest.mock('../db/models/agent', () => ({
  getOrCreate: jest.fn().mockResolvedValue({ id: 'agent-1' })
}));

jest.mock('../db/models/session', () => ({
  create: jest.fn().mockResolvedValue({ id: 'session-1' }),
  update: jest.fn().mockResolvedValue({ id: 'session-1' }),
  findByPk: jest.fn().mockResolvedValue({ id: 'session-1' })
}));

const { runFullFlow } = require('../agents/flowAgentOrchestrator');
const responsesAgent = require('../agents/responsesAgent');

describe('Parallel vs Sequential Question Generation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use parallel mode by default', async () => {
    const brief = { client_name: 'Test Client', project_description: 'Test Project' };
    const jobId = 'job-parallel-default';
    
    // Run with default settings (should be parallel)
    await runFullFlow({ brief, jobId });
    
    // Log the prompts that were used
    const prompts = responsesAgent.createInitialResponse.mock.calls.map(call => call[0]);
    
    // Check that none of the prompts include the sequential mode marker
    const hasSequentialPrompt = prompts.some(prompt => 
      prompt.includes('AVOID ASKING DUPLICATE OR SIMILAR QUESTIONS')
    );
    
    expect(hasSequentialPrompt).toBe(false);
    expect(responsesAgent.createInitialResponse).toHaveBeenCalled();
  });

  it('should use parallel mode when explicitly set to true', async () => {
    const brief = { client_name: 'Test Client', project_description: 'Test Project' };
    const jobId = 'job-parallel-explicit';
    
    // Run with parallel mode explicitly set
    await runFullFlow({ brief, jobId, parallelAgentQuestionsMode: true });
    
    // Log the prompts that were used
    const prompts = responsesAgent.createInitialResponse.mock.calls.map(call => call[0]);
    
    // Check that none of the prompts include the sequential mode marker
    const hasSequentialPrompt = prompts.some(prompt => 
      prompt.includes('AVOID ASKING DUPLICATE OR SIMILAR QUESTIONS')
    );
    
    expect(hasSequentialPrompt).toBe(false);
    expect(responsesAgent.createInitialResponse).toHaveBeenCalled();
  });

  it('should use sequential mode when set to false', async () => {
    const brief = { client_name: 'Test Client', project_description: 'Test Project' };
    const jobId = 'job-sequential';
    
    // Run with sequential mode
    const result = await runFullFlow({ brief, jobId, parallelAgentQuestionsMode: false });
    
    // Check the result includes the mode used
    expect(result.questionGenerationMode).toBe('sequential');
    
    // Check that at least some prompts include the sequential mode marker
    const prompts = responsesAgent.createInitialResponse.mock.calls.map(call => call[0]);
    const hasSequentialPrompt = prompts.some(prompt => 
      prompt.includes('PREVIOUS QUESTIONS')
    );
    
    expect(hasSequentialPrompt).toBe(true);
    expect(responsesAgent.createInitialResponse).toHaveBeenCalled();
  });
});
