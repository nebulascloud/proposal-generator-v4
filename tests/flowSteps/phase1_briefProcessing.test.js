// tests/flowSteps/phase1_briefProcessing.test.js

jest.mock('../../agents/assistantDefinitions', () => {
  const realDefs = jest.requireActual('../../agents/assistantDefinitions');
  return {
    ...realDefs,
    getAssignableSpecialists: jest.fn(() => ['sp_Account_Manager', 'sp_Project_Manager']),
    getAssignableSpecialistsString: jest.fn(() => '- sp_Account_Manager\n- sp_Project_Manager'),
    VALID_SPECIALISTS: {
      ...realDefs.VALID_SPECIALISTS,
      SP_ACCOUNT_MANAGER: 'sp_Account_Manager',
      SP_PROJECT_MANAGER: 'sp_Project_Manager',
      SP_COLLABORATION_ORCHESTRATOR: 'sp_Collaboration_Orchestrator',
      SP_BRIEF_ANALYSIS: 'sp_BriefAnalysis',
    },
    assistantDefinitions: {
      ...realDefs.assistantDefinitions,
      sp_Account_Manager: 'Do stuff',
      sp_Project_Manager: 'Do stuff',
      sp_Collaboration_Orchestrator: 'Orchestrate',
      sp_BriefAnalysis: 'Analyze',
    }
  };
});
jest.mock('../../agents/flowSteps/flowPrompts', () => ({
  getAssignableSpecialists: jest.fn(() => ['sp_Account_Manager', 'sp_Project_Manager']),
  PHASE1: {
    ASSIGN_PROPOSAL_SECTIONS_TEMPLATE: undefined,
    ASSIGN_PROPOSAL_SECTIONS_INSTRUCTIONS: 'TEMPLATE: "Introduction": "Project Manager"',
  },
}));

const phase1_briefProcessing = require('../../agents/flowSteps/phase1_briefProcessing');
const Session = require('../../db/models/session');
const Agent = require('../../db/models/agent');
const contextModel = require('../../db/models/context');

// Minimal mock for responsesAgent if needed
jest.mock('../../agents/responsesAgent', () => ({
  createInitialResponse: jest.fn(),
  createAndUploadFile: jest.fn(),
}));

// Mock the retryWithBackoff utility
jest.mock('../../utils/apiRetryHelper', () => ({
  retryWithBackoff: jest.fn((fn) => fn()),
}));

describe('phase1_briefProcessing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure Session.update is a mock function
    Session.update = jest.fn();
    // Ensure Agent.getOrCreate is a mock function
    Agent.getOrCreate = jest.fn();
    // Mock responsesAgent.createInitialResponse to call Agent.getOrCreate and return a valid response object
    require('../../agents/responsesAgent').createInitialResponse = jest.fn().mockImplementation((...args) => {
      Agent.getOrCreate('BriefAnalysis', 'Instructions');
      return Promise.resolve({ id: 'analysis-response-id', response: '{"summary": "Analysis text"}' });
    });
    // Mock contextModel.create to avoid DB errors
    contextModel.create = jest.fn().mockResolvedValue({ id: 'mock-context-id' });
  });

  it('should analyze the brief and assign sections', async () => {
    // Arrange
    const brief = { client_name: 'Test Client', project_description: 'Test Project' };
    const proposalId = 'test-proposal-1';
    const sessionId = 'session-1';
    const briefContextId = 'brief-context-1';
    const jobId = 'job-123';
    Session.update.mockResolvedValue({ id: sessionId, status: 'brief_processed' });
    Agent.getOrCreate.mockResolvedValue({ id: 'agent-1', name: 'sp_Account_Manager' });
    require('../../agents/assistantDefinitions').sp_Account_Manager = { instructions: 'Do stuff' };

    // Act
    const analysis = await phase1_briefProcessing.analyzeBrief(proposalId, sessionId, briefContextId, jobId);

    // Assert
    expect(analysis).toBeDefined();
    expect(Agent.getOrCreate).toHaveBeenCalled();
  });
});
