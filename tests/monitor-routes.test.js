/**
 * Monitoring API Routes Tests
 * Integration tests for the monitoring API routes
 */

const request = require('supertest');
const express = require('express');
const monitorRoutes = require('../routes/monitor');

// Mock database models
jest.mock('../db/models/session', () => ({
  list: jest.fn(),
  getById: jest.fn(),
}));

jest.mock('../db/models/message', () => ({
  getBySessionId: jest.fn(),
  getById: jest.fn(),
  getThread: jest.fn(),
}));

jest.mock('../db/models/agent', () => ({
  list: jest.fn(),
}));

jest.mock('../db/index', () => ({
  ...jest.requireActual('../db/index'),
  // Mock the raw database query for phases
  // eslint-disable-next-line jest/unbound-method
  distinct: jest.fn().mockReturnThis(),
  // eslint-disable-next-line jest/unbound-method
  whereNotNull: jest.fn().mockReturnThis(),
  // eslint-disable-next-line jest/unbound-method
  orderBy: jest.fn().mockResolvedValue([
    { phase: 'clarification' },
    { phase: 'draft' },
    { phase: 'review' }
  ])
}));

describe('Monitoring API Routes', () => {
  let app;
  
  beforeEach(() => {
    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());
    app.use('/api/monitor', monitorRoutes);
    
    // Reset all mocks
    jest.resetAllMocks();
  });

  test('GET /api/monitor/sessions returns sessions list', async () => {
    // Mock the list function to return test data
    const mockSessions = [
      { id: '1', proposal_id: 'test-1', status: 'active', created_at: new Date().toISOString() },
      { id: '2', proposal_id: 'test-2', status: 'completed', created_at: new Date().toISOString() }
    ];
    
    const Session = require('../db/models/session');
    Session.list.mockResolvedValue(mockSessions);
    
    const response = await request(app).get('/api/monitor/sessions');
    
    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockSessions);
    expect(Session.list).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  test('GET /api/monitor/sessions/:id returns a specific session', async () => {
    const mockSession = { 
      id: 'test-123', 
      proposal_id: 'proposal-123', 
      status: 'active' 
    };
    
    const Session = require('../db/models/session');
    Session.getById.mockResolvedValue(mockSession);
    
    const response = await request(app).get('/api/monitor/sessions/test-123');
    
    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockSession);
    expect(Session.getById).toHaveBeenCalledWith('test-123');
  });

  test('GET /api/monitor/sessions/:id returns 404 if session not found', async () => {
    const Session = require('../db/models/session');
    Session.getById.mockResolvedValue(null);
    
    const response = await request(app).get('/api/monitor/sessions/not-found');
    
    expect(response.status).toBe(404);
    expect(response.body.error).toBeDefined();
  });

  test('GET /api/monitor/sessions/:id/messages returns messages for a session', async () => {
    const mockMessages = [
      { id: 'msg-1', content: 'Test message 1', role: 'user' },
      { id: 'msg-2', content: 'Test message 2', role: 'assistant' }
    ];
    
    const Message = require('../db/models/message');
    Message.getBySessionId.mockResolvedValue(mockMessages);
    // Mock Session.getById to return a valid session
    const Session = require('../db/models/session');
    Session.getById.mockResolvedValue({ id: 'test-123', proposal_id: 'proposal-123', status: 'active' });
    
    const response = await request(app).get('/api/monitor/sessions/test-123/messages');
    
    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockMessages);
    expect(Message.getBySessionId).toHaveBeenCalledWith('test-123', {});
  });

  test('GET /api/monitor/messages/:id/thread returns a message thread', async () => {
    const mockThread = [
      { id: 'msg-1', content: 'Parent message', role: 'user' },
      { id: 'msg-2', content: 'Child message', role: 'assistant' }
    ];
    
    const Message = require('../db/models/message');
    Message.getThread.mockResolvedValue(mockThread);
    
    const response = await request(app).get('/api/monitor/messages/msg-2/thread');
    
    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockThread);
    expect(Message.getThread).toHaveBeenCalledWith('msg-2');
  });

  test('GET /api/monitor/agents returns list of agents', async () => {
    const mockAgents = [
      { id: 1, name: 'clarification', instructions: 'Ask questions' },
      { id: 2, name: 'drafting', instructions: 'Write content' }
    ];
    
    const Agent = require('../db/models/agent');
    Agent.list.mockResolvedValue(mockAgents);
    
    const response = await request(app).get('/api/monitor/agents');
    
    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockAgents);
    expect(Agent.list).toHaveBeenCalled();
  });

  test('GET /api/monitor/phases returns list of phases', async () => {
    const response = await request(app).get('/api/monitor/phases');
    
    expect(response.status).toBe(200);
    expect(response.body).toEqual(['clarification', 'draft', 'review']);
  });
});
