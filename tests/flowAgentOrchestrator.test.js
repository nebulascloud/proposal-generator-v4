// tests/flowAgentOrchestrator.test.js

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
jest.mock('../agents/flowSteps/flowPrompts', () => ({
  getAssignableSpecialists: jest.fn(() => ['sp_Account_Manager', 'sp_Project_Manager']),
  PHASE1: {
    ASSIGN_PROPOSAL_SECTIONS_TEMPLATE: undefined,
    ASSIGN_PROPOSAL_SECTIONS_INSTRUCTIONS: 'TEMPLATE: "Introduction": "Project Manager"',
    ASSIGN_PROPOSAL_SECTIONS_WITH_SECTIONS: 'Assign these sections: {sections}', // Add a valid template for .replace
    GENERATE_SPECIALIST_QUESTIONS: 'Please generate questions for the {role} based on the brief.', // Add a valid template for .replace
    ORGANIZE_ALL_QUESTIONS: 'Organize all questions for the {role}.' // Add a valid template for .replace
  },
}));

const { runFullFlow } = require('../agents/flowAgentOrchestrator');
const assistantDefinitions = require('../agents/assistantDefinitions');
const Session = require('../db/models/session');
const Agent = require('../db/models/agent');

// Minimal mock for responsesAgent if needed
jest.mock('../agents/responsesAgent', () => ({
  resetProgress: jest.fn(),
  createAndUploadFile: jest.fn(),
  createInitialResponse: jest.fn(),
  forkResponse: jest.fn(),
  trackTokenUsage: jest.fn(),
  updateProgressStatus: jest.fn(),
  getTokenUsageReport: jest.fn(),
}));

describe('flowAgentOrchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure Session.create and Session.update are mock functions
    Session.create = jest.fn().mockResolvedValue({ id: 'session-1' });
    Session.update = jest.fn().mockResolvedValue({ id: 'session-1', status: 'initialized' });
    Session.findByPk = jest.fn().mockResolvedValue({ id: 'session-1', status: 'initialized' });
    // Ensure Agent.getOrCreate is a mock function
    Agent.getOrCreate = jest.fn().mockResolvedValue({ id: 'agent-1', name: 'sp_Account_Manager' });
    // Mock contextModel.create to return unique context IDs for each call
    let contextCallCount = 0;
    require('../db/models/context').create = jest.fn().mockImplementation(() => {
      contextCallCount++;
      return { id: `context-id-${contextCallCount}` };
    });
    // Mock responsesAgent.createInitialResponse to return unique response IDs for each call
    let responseCallCount = 0;
    require('../agents/responsesAgent').createInitialResponse = jest.fn().mockImplementation(() => {
      responseCallCount++;
      return { id: `response-id-${responseCallCount}`, response: '{"questions":[]}' };
    });
  });

  it('should run the initial phases of the flow without error', async () => {
    // Arrange: minimal brief and mocks
    const brief = { client_name: 'Test Client', project_description: 'Test Project' };
    const proposalId = 'test-proposal-1';
    const jobId = 'job-123';
    // Act
    const result = await runFullFlow({ brief, proposalId, jobId });
    // Debug output
    console.log('runFullFlow result:', result);
    console.log('Agent.getOrCreate call count:', Agent.getOrCreate.mock.calls.length);
    // Assert
    expect(result).toBeDefined();
    expect(Session.create).toHaveBeenCalled();
  });
});
