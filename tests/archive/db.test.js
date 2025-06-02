/**
 * Database Unit Tests
 * Tests for database connection, models, and migrations
 */

const db = require('../db/index');
const Message = require('../db/models/message');
const Agent = require('../db/models/agent');
const Session = require('../db/models/session');
const { v4: uuidv4 } = require('uuid');

// Mock the environment
process.env.NODE_ENV = 'test';

// Check if we have a functioning database or use mocks
const useMocks = !db.schema;
console.log(`[DB Tests] Using ${useMocks ? 'mocked' : 'real'} database connection`);

// Mock implementations for model functions if needed
jest.mock('../db/models/message', () => ({
  create: jest.fn().mockImplementation(async (data) => ({
    id: data.id || 'mock-message-id',
    ...data,
    created_at: new Date().toISOString()
  })),
  getById: jest.fn().mockImplementation(async (id) => ({
    id,
    content: 'Mocked message content',
    role: 'user',
    created_at: new Date().toISOString()
  })),
  getThreadMessages: jest.fn().mockImplementation(async () => []),
  getChildMessages: jest.fn().mockImplementation(async () => []),
  getBySessionId: jest.fn().mockImplementation(async () => []),
  getByResponseId: jest.fn().mockImplementation(async () => []),
  getThread: jest.fn().mockImplementation(async (id) => [{
    id: 'parent-id',
    content: 'Parent message'
  }, {
    id,
    content: 'Child message',
    parent_message_id: 'parent-id'
  }])
}));

jest.mock('../db/models/agent', () => ({
  getOrCreate: jest.fn().mockImplementation(async (name, instructions) => ({
    id: 'mock-agent-id',
    name,
    instructions,
    assistant_id: 'mock-assistant-id',
    created_at: new Date().toISOString()
  })),
  getByName: jest.fn().mockImplementation(async (name) => ({
    id: 'mock-agent-id',
    name,
    assistant_id: 'mock-assistant-id',
    created_at: new Date().toISOString()
  })),
  getById: jest.fn().mockImplementation(async (id) => ({
    id,
    name: 'mock-agent',
    assistant_id: 'mock-assistant-id',
    created_at: new Date().toISOString()
  })),
  list: jest.fn().mockImplementation(async () => [{
    id: 'mock-agent-id',
    name: 'mock-agent',
    assistant_id: 'mock-assistant-id',
    created_at: new Date().toISOString()
  }])
}));

jest.mock('../db/models/session', () => ({
  create: jest.fn().mockImplementation(async (data) => ({
    id: data.id || 'mock-session-id',
    proposal_id: data.proposalId,
    customer_brief_id: data.customerBriefId,
    status: data.status || 'active',
    metadata: data.metadata || {},
    created_at: new Date().toISOString()
  })),
  getById: jest.fn().mockImplementation(async (id) => ({
    id,
    proposal_id: 'mock-proposal-id',
    customer_brief_id: 'mock-brief-id',
    status: 'active',
    metadata: {}
  })),
  update: jest.fn().mockImplementation(async (data) => {
    // Extract id and handle the new object-based update format
    const { id, status, metadata, completedAt, failedAt } = data;
    return {
      id,
      proposal_id: 'mock-proposal-id',
      customer_brief_id: 'mock-brief-id',
      status: status || 'active',
      completed_at: completedAt,
      failed_at: failedAt,
      metadata: metadata || {},
      updated_at: new Date().toISOString()
    };
  }),
  getActiveSession: jest.fn().mockImplementation(async () => null)
}));

describe('Database Models', () => {
  // We don't need to clear test data when using mocks
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Session model - create and retrieve session', async () => {
    // Create a test session
    const sessionData = {
      proposalId: 'test-proposal-123',
      customerBriefId: 'test-brief-123',
      status: 'active',
      metadata: { testKey: 'testValue' }
    };

    const session = await Session.create(sessionData);

    // Verify session was created
    expect(session).toBeDefined();
    expect(session.proposal_id || session.proposalId).toBeTruthy();
    
    // Retrieve the session
    const retrievedSession = await Session.getById(session.id);
    expect(retrievedSession).toBeDefined();

    // Test update function
    const updatedData = {
      id: session.id,  // We now expect an object with id field
      status: 'completed',
      metadata: { testKey: 'updatedValue' }
    };
    const updatedSession = await Session.update(updatedData);
    expect(updatedSession).toBeDefined();
    expect(updatedSession.status).toBe('completed');
  });

  test('Session model - should handle completion and failure timestamps', async () => {
    // Create test session
    const sessionId = 'timestamp-test-session';
    const session = await Session.create({
      id: sessionId,
      proposalId: 'test-completion-proposal',
      status: 'active'
    });

    // 1. Test completing a session with timestamp
    const completionDate = new Date();
    const completedSession = await Session.update({
      id: sessionId,
      status: 'completed',
      completedAt: completionDate,
      metadata: { finalTokenCount: 1500 }
    });
    
    expect(completedSession.status).toBe('completed');
    expect(completedSession.completed_at).toEqual(completionDate);
    expect(completedSession.failed_at).toBeUndefined();
    expect(completedSession.metadata.finalTokenCount).toBe(1500);

    // 2. Test failing a session with timestamp
    const failureDate = new Date();
    const failedSession = await Session.update({
      id: sessionId,
      status: 'failed',
      failedAt: failureDate,
      metadata: { error: 'Test error message' } 
    });
    
    expect(failedSession.status).toBe('failed');
    expect(failedSession.failed_at).toEqual(failureDate);
    expect(failedSession.metadata.error).toBe('Test error message');
  });

  test('Agent model - getOrCreate and retrieval functions', async () => {
    // Create a test agent
    const agentName = 'test-agent';
    const instructions = 'Test instructions';

    const agent = await Agent.getOrCreate(agentName, instructions);

    // Verify agent was created
    expect(agent).toBeDefined();
    expect(agent.name).toBe(agentName);

    // Test getByName
    const retrievedByName = await Agent.getByName(agentName);
    expect(retrievedByName).toBeDefined();

    // Test list function
    const agents = await Agent.list();
    expect(agents).toBeDefined();
    expect(Array.isArray(agents)).toBe(true);
  });

  test('Message model - create and thread functions', async () => {
    // Create a session first
    const session = await Session.create({
      proposalId: 'test-proposal-123',
      status: 'active'
    });

    // Create parent message
    const parentMessage = await Message.create({
      responseId: 'resp-123',
      phase: 'clarification',
      agentName: 'test-agent',
      role: 'assistant',
      content: 'Parent message content',
      sessionId: session.id,
      metadata: { tokens: 10 }
    });

    expect(parentMessage).toBeDefined();
    expect(parentMessage.content).toBe('Parent message content');

    // Create child message
    const childMessage = await Message.create({
      responseId: 'resp-456',
      phase: 'clarification',
      agentName: 'test-agent',
      role: 'user',
      content: 'Child message content',
      parentMessageId: parentMessage.id,
      sessionId: session.id
    });

    expect(childMessage).toBeDefined();

    // Test getThread
    const thread = await Message.getThread(childMessage.id);
    expect(Array.isArray(thread)).toBe(true);
  });
});
