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
const request = require('supertest');
const app = require('../index');

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

describe('API: /api/flow/runFullFlow', () => {
  it('should expose Swagger docs with the new /api/flow/runFullFlow definition', async () => {
    const res = await request(app).get('/openapi.json');
    const pathKeys = Object.keys(res.body.paths);
    // Find the correct path key for runFullFlow - it should be "/api/flow/runFullFlow" in the spec
    const runFullFlowPath = pathKeys.find(k => k.toLowerCase().includes('runfullflow'));
    expect(res.status).toBe(200);
    expect(runFullFlowPath).toBeDefined();
    // Optionally, check the method exists (e.g., post)
    expect(res.body.paths[runFullFlowPath]).toHaveProperty('post');
    expect(JSON.stringify(res.body)).toMatch(/parallelAgentQuestionsMode/);
  });

  it('should accept a POST to /api/flow/runFullFlow with parallelAgentQuestionsMode true', async () => {
    const res = await request(app)
      .post('/api/flow/runFullFlow')
      .send({
        brief: { client_name: 'Test Client', project_description: 'Test Project' },
        parallelAgentQuestionsMode: true
      })
      .set('Accept', 'application/json');
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
    expect(res.body).toHaveProperty('status', 'accepted');
    expect(res.body).toHaveProperty('statusEndpoint');
    expect(res.body).toHaveProperty('resultEndpoint');
  });

  it('should accept a POST to /api/flow/runFullFlow with parallelAgentQuestionsMode false', async () => {
    const res = await request(app)
      .post('/api/flow/runFullFlow')
      .send({
        brief: { client_name: 'Test Client', project_description: 'Test Project' },
        parallelAgentQuestionsMode: false
      })
      .set('Accept', 'application/json');
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
    expect(res.body).toHaveProperty('status', 'accepted');
    expect(res.body).toHaveProperty('statusEndpoint');
    expect(res.body).toHaveProperty('resultEndpoint');
  });

  it('should return 400 if brief is missing', async () => {
    const res = await request(app)
      .post('/api/flow/runFullFlow')
      .send({})
      .set('Accept', 'application/json');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
