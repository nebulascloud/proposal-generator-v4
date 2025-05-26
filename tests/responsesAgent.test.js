const { 
  resetProgress,
  updateProgressStatus,
  getProgress,
  getTokenUsageReport,
  trackTokenUsage
} = require('../agents/responsesAgent');

// Set test environment
process.env.NODE_ENV = 'test';

// Mock the OpenAI client
jest.mock('openai', () => {
  return {
    OpenAI: jest.fn().mockImplementation(() => {
      return {
        responses: {
          create: jest.fn().mockResolvedValue({
            id: 'resp_mock123',
            object: 'response',
            created: Date.now(),
            model: 'gpt-4o',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Mock response content'
                },
                finish_reason: 'complete'
              }
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150
            }
          }),
          fork: jest.fn().mockResolvedValue({
            id: 'resp_fork123',
            object: 'response',
            created: Date.now(),
            model: 'gpt-4o',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Mock forked response content'
                },
                finish_reason: 'complete'
              }
            ],
            usage: {
              prompt_tokens: 120,
              completion_tokens: 60,
              total_tokens: 180
            }
          })
        },
        files: {
          create: jest.fn().mockResolvedValue({
            id: 'file-mock123',
            object: 'file',
            purpose: 'responses'
          })
        }
      };
    })
  };
});

// Mock fs module
jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  createReadStream: jest.fn().mockReturnValue({}),
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn()
}));

// Mock database models
jest.mock('../db/models/session', () => ({
  getByProposalId: jest.fn().mockResolvedValue({
    id: 'mock-session-id',
    proposal_id: 'mock-proposal-id',
    status: 'active',
    metadata: { startedAt: new Date().toISOString() }
  }),
  create: jest.fn().mockImplementation(async (data) => ({
    id: 'mock-session-id',
    ...data,
    created_at: new Date().toISOString()
  }))
}));

jest.mock('../db/models/message', () => ({
  create: jest.fn().mockImplementation(async (data) => ({
    id: data.id || 'mock-message-id',
    ...data,
    created_at: new Date().toISOString()
  })),
  getBySessionId: jest.fn().mockResolvedValue([])
}));

jest.mock('../db/models/agent', () => ({
  getOrCreate: jest.fn().mockImplementation(async (name, instructions) => ({
    id: 'mock-agent-id',
    name,
    instructions,
    created_at: new Date().toISOString()
  })),
  getByName: jest.fn().mockResolvedValue(null)
}));

// Mock JSON context
jest.mock('../utils/jsonContext', () => ({
  storeContext: jest.fn().mockResolvedValue('mock-context-id'),
  getContext: jest.fn().mockResolvedValue({
    data: { testKey: 'testValue' },
    metadata: { type: 'test' }
  }),
  formatForPrompt: jest.fn().mockReturnValue('Formatted JSON content')
}));

// Mock the messageContextBuilder
jest.mock('../utils/messageContextBuilder', () => ({
  buildMessageContext: jest.fn().mockResolvedValue({
    context: 'Mocked message context for the conversation',
    messageCount: 5,
    tokenEstimate: 250
  })
}));

describe('responsesAgent', () => {
  beforeEach(() => {
    // Reset progress tracking before each test
    resetProgress();
  });

  test('progress tracking state should be properly initialized', () => {
    const progress = getProgress();
    
    // Check structure
    expect(progress).toHaveProperty('phase1');
    expect(progress).toHaveProperty('phase2');
    expect(progress).toHaveProperty('phase3');
    expect(progress).toHaveProperty('phase4');
    expect(progress).toHaveProperty('tokenSummary');
    
    // Check initial values
    expect(progress.phase1.briefAnalysis.status).toBe('pending');
    expect(progress.phase1.briefAnalysis.fileId).toBeNull();
    expect(progress.phase1.briefAnalysis.tokenUsage.total).toBe(0);
  });
  
  test('updateProgressStatus should properly update component status', () => {
    // Update status
    updateProgressStatus('phase1', 'briefAnalysis', 'completed', { fileId: 'file-123' });
    
    const progress = getProgress();
    expect(progress.phase1.briefAnalysis.status).toBe('completed');
    expect(progress.phase1.briefAnalysis.fileId).toBe('file-123');
  });
  
  test('token usage report should have proper structure', () => {
    const report = getTokenUsageReport();
    
    expect(report).toHaveProperty('date');
    expect(report).toHaveProperty('overallTokens');
    expect(report).toHaveProperty('phaseBreakdown');
    expect(report).toHaveProperty('componentDetails');
    
    // Check structure of token usage data
    expect(report.overallTokens).toHaveProperty('prompt');
    expect(report.overallTokens).toHaveProperty('completion');
    expect(report.overallTokens).toHaveProperty('total');
  });
  
  test('resetProgress should reset all tracking data', () => {
    // First set some data
    updateProgressStatus('phase1', 'briefAnalysis', 'completed', { fileId: 'file-123' });
    
    // Verify it was set
    let progress = getProgress();
    expect(progress.phase1.briefAnalysis.status).toBe('completed');
    
    // Reset and verify
    resetProgress();
    progress = getProgress();
    expect(progress.phase1.briefAnalysis.status).toBe('pending');
    expect(progress.phase1.briefAnalysis.fileId).toBeNull();
  });
  
  test('trackTokenUsage should properly update token usage statistics', () => {
    const mockResponse = {
      usage: {
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300
      }
    };
    
    // Track token usage
    trackTokenUsage(mockResponse, 'phase1', 'briefAnalysis');
    
    // Verify token usage was tracked
    const progress = getProgress();
    expect(progress.phase1.briefAnalysis.tokenUsage.prompt).toBe(200);
    expect(progress.phase1.briefAnalysis.tokenUsage.completion).toBe(100);
    expect(progress.phase1.briefAnalysis.tokenUsage.total).toBe(300);
    
    // Verify phase summary was updated
    expect(progress.tokenSummary.phase1.total).toBe(300);
    
    // Verify overall summary was updated
    expect(progress.tokenSummary.overall.total).toBe(300);
    
    // Add more token usage and verify accumulation
    const mockResponse2 = {
      usage: {
        prompt_tokens: 150,
        completion_tokens: 50,
        total_tokens: 200
      }
    };
    
    trackTokenUsage(mockResponse2, 'phase1', 'sectionAssignments');
    
    const updatedProgress = getProgress();
    expect(updatedProgress.tokenSummary.phase1.total).toBe(500); // 300 + 200
    expect(updatedProgress.tokenSummary.overall.total).toBe(500);
  });
  
  // Test for buildContextFromMessages function
  test('buildContextFromMessages returns context string from message history', async () => {
    // Get the mocked implementation
    const { buildMessageContext } = require('../utils/messageContextBuilder');
    const Session = require('../db/models/session');
    
    // Set up mock implementation for this test
    Session.getByProposalId.mockResolvedValue({
      id: 'mock-session-id',
      proposal_id: 'test-proposal-123',
      status: 'active'
    });
    
    // Call the function
    const context = await require('../agents/responsesAgent').buildContextFromMessages('test-proposal-123');
    
    // Verify Session.getByProposalId was called with the right param
    expect(Session.getByProposalId).toHaveBeenCalledWith('test-proposal-123');
    
    // Verify buildMessageContext was called with the session ID
    expect(buildMessageContext).toHaveBeenCalledWith('mock-session-id', expect.any(Object));
    
    // Verify the result
    expect(context).toBe('Mocked message context for the conversation');
  });
  
  // Test for session not found case
  test('buildContextFromMessages creates session if missing and returns context string', async () => {
    const Session = require('../db/models/session');
    // Mock no session found on first call, then return a session on second call
    Session.getByProposalId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'mock-session-id',
        proposal_id: 'non-existent-proposal',
        status: 'active'
      });
    // Call the function
    const context = await require('../agents/responsesAgent').buildContextFromMessages('non-existent-proposal');
    // Should create a session and then return the mocked context string
    expect(Session.getByProposalId).toHaveBeenCalledWith('non-existent-proposal');
    expect(context).toBe('Mocked message context for the conversation');
  });
});
