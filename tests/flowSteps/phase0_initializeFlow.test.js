// tests/flowSteps/phase0_initializeFlow.test.js

const { initializeFlow } = require('../../agents/flowSteps/phase0_initializeFlow');
const responsesAgent = require('../../agents/responsesAgent');
const defaultTemplate = require('../../templates/defaultTemplate');
const Session = require('../../db/models/session');
const contextModel = require('../../db/models/context');
const Agent = require('../../db/models/agent');
jest.mock('../../agents/responsesAgent');
jest.mock('../../db/models/session');
jest.mock('../../db/models/context');
jest.mock('../../db/models/agent');
jest.mock('../../templates/defaultTemplate', () => ({ sections: [{ id: 's1', name: 'Section 1' }] }));
const { assistantDefinitions } = require('../../agents/assistantDefinitions');

describe('initializeFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.flowJobs = {};
    // Mock Agent.getOrCreate to always resolve (simulate DB sync success)
    Agent.getOrCreate = jest.fn().mockResolvedValue({ name: 'mock', instructions: 'mock' });
  });

  it('should initialize flow and return expected output', async () => {
    // Arrange
    const brief = { title: 'Test Brief' };
    const initialCustomerReviewAnswers = { q1: 'a1' };
    const jobId = 'job-123';
    const fakeSession = { id: 'session-abc' };
    const fakeContextId = 'context-xyz';
    Session.create.mockResolvedValue({ ...fakeSession, createdAt: new Date(), jobId, proposalId: '3ce7fbba-5744-43fe-b840-e73a4e5f58f1', status: 'phase0_initialize_flow_started' });
    Session.findByPk = jest.fn().mockResolvedValue({ id: 'session-1', status: 'phase0_initialize_flow_started' });
    const fakeContextRecord = { id: fakeContextId };

    responsesAgent.resetProgress = jest.fn().mockResolvedValue();
    contextModel.create.mockResolvedValue(fakeContextRecord);

    // Act
    const result = await initializeFlow(brief, initialCustomerReviewAnswers, jobId);

    // Assert
    expect(responsesAgent.resetProgress).toHaveBeenCalled();
    expect(Session.create).toHaveBeenCalledWith(
      expect.objectContaining({ jobId, proposalId: expect.any(String), status: 'phase0_initialize_flow_started' })
    );
    expect(contextModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: JSON.stringify(brief),
        metadata: expect.objectContaining({ jobId, phase: 'initializeFlow' })
      })
    );
    expect(result).toEqual({
      currentProposalId: expect.any(String),
      sessionId: fakeSession.id,
      contextId: fakeContextId,
      initialCustomerReviewAnswers,
    });
    expect(global.flowJobs[jobId].proposalId).toBe(result.currentProposalId);
    expect(Agent.getOrCreate).toHaveBeenCalled();
  });

  it('should throw if session creation fails', async () => {
    Session.create.mockRejectedValue(new Error('db error'));
    responsesAgent.resetProgress = jest.fn().mockResolvedValue();
    await expect(
      initializeFlow({}, {}, 'job-err')
    ).rejects.toThrow('Failed to initialize flow: db error');
  });

  it('should throw if brief logging fails', async () => {
    Session.create.mockResolvedValue({ id: 'session-1' });
    contextModel.create.mockRejectedValue(new Error('upload error'));
    await expect(
      initializeFlow({}, {}, 'job-err2')
    ).rejects.toThrow('Failed to initialize flow: Failed to log brief in contexts table: upload error');
  });

  it('should continue if some agents fail to sync', async () => {
    // Simulate one agent failing
    const agentNames = Object.keys(assistantDefinitions);
    let callCount = 0;
    Agent.getOrCreate.mockImplementation((name) => {
      callCount++;
      if (callCount === 1) throw new Error('sync error');
      return Promise.resolve({ name, instructions: 'mock' });
    });
    Session.create.mockResolvedValue({ id: 'session-1' });
    contextModel.create.mockResolvedValue({ id: 'context-1' });
    responsesAgent.resetProgress = jest.fn().mockResolvedValue();
    const result = await initializeFlow({ title: 'Test' }, {}, 'job-err3');
    expect(result).toHaveProperty('currentProposalId');
    expect(Agent.getOrCreate).toHaveBeenCalled();
  });
});
