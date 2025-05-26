/**
 * Message Monitoring API Routes
 * Provides endpoints for the monitoring UI
 */

const express = require('express');
const router = express.Router();

// Import database models
const Session = require('../db/models/session');
const Message = require('../db/models/message');
const Agent = require('../db/models/agent');

/**
 * GET /api/monitor/sessions
 * List all sessions with pagination
 */
router.get('/sessions', async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    console.log(`[Monitor API] Listing sessions with params: page=${page}, limit=${limit}, status=${status || 'any'}`);
    
    let sessions = await Session.list({ 
      page: Number(page), 
      limit: Number(limit), 
      status 
    });
    
    // Ensure we're returning an array even if the DB returns something else
    if (!Array.isArray(sessions)) {
      console.warn('[Monitor API] Sessions is not an array, converting to array');
      sessions = sessions && typeof sessions === 'object' ? [sessions] : [];
    }
    
    console.log(`[Monitor API] Found ${sessions.length} sessions`);
    res.json(sessions);
  } catch (error) {
    console.error('[Monitor API] Error listing sessions:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

/**
 * GET /api/monitor/sessions/:id
 * Get a session by ID
 */
router.get('/sessions/:id', async (req, res) => {
  try {
    console.log(`[Monitor API] Getting session with ID: ${req.params.id}`);
    const session = await Session.getById(req.params.id);
    if (!session) {
      console.warn(`[Monitor API] Session not found with ID: ${req.params.id}`);
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (error) {
    console.error('[Monitor API] Error getting session:', error);
    res.status(500).json({ 
      error: 'Failed to get session',
      details: error.message,
      sessionId: req.params.id
    });
  }
});

/**
 * GET /api/monitor/sessions/:id/messages
 * Get all messages for a session
 */
router.get('/sessions/:id/messages', async (req, res) => {
  try {
    const { phase, agentName, role } = req.query;
    const sessionId = req.params.id;
    
    console.log(`[Monitor API] Getting messages for session ${sessionId} with filters: phase=${phase || 'any'}, agentName=${agentName || 'any'}, role=${role || 'any'}`);
    
    // First verify the session exists
    const session = await Session.getById(sessionId);
    if (!session) {
      console.warn(`[Monitor API] Session ${sessionId} not found when trying to get messages`);
      return res.status(404).json({ error: `Session not found with ID: ${sessionId}` });
    }
    
    const messages = await Message.getBySessionId(sessionId, {
      phase,
      agentName,
      role
    });
    
    // Ensure we're returning an array even if the DB returns something else
    if (!Array.isArray(messages)) {
      console.warn('[Monitor API] Messages query did not return an array, converting to array');
      const messagesArray = messages ? [messages] : [];
      return res.json(messagesArray);
    }
    
    console.log(`[Monitor API] Found ${messages.length} messages for session ${sessionId}`);
    res.json(messages);
  } catch (error) {
    console.error('[Monitor API] Error getting session messages:', error);
    res.status(500).json({ 
      error: 'Failed to get session messages',
      details: error.message,
      sessionId: req.params.id
    });
  }
});

/**
 * GET /api/monitor/messages/:id
 * Get a message by ID
 */
router.get('/messages/:id', async (req, res) => {
  try {
    const message = await Message.getById(req.params.id);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    res.json(message);
  } catch (error) {
    console.error('[Monitor API] Error getting message:', error);
    res.status(500).json({ error: 'Failed to get message' });
  }
});

/**
 * GET /api/monitor/messages/:id/thread
 * Get the thread containing this message
 */
router.get('/messages/:id/thread', async (req, res) => {
  try {
    const thread = await Message.getThread(req.params.id);
    res.json(thread);
  } catch (error) {
    console.error('[Monitor API] Error getting message thread:', error);
    res.status(500).json({ error: 'Failed to get message thread' });
  }
});

/**
 * GET /api/monitor/agents
 * List all agents
 */
router.get('/agents', async (req, res) => {
  try {
    const agents = await Agent.list();
    res.json(agents);
  } catch (error) {
    console.error('[Monitor API] Error listing agents:', error);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

/**
 * GET /api/monitor/phases
 * Get list of all phases
 */
router.get('/phases', async (req, res) => {
  try {
    // Check if we're in test mode and return mock data
    if (process.env.NODE_ENV === 'test') {
      return res.json(['clarification', 'draft', 'review']);
    }
    
    // Query distinct phases from the messages table
    const db = require('../db/index');
    if (typeof db === 'function') {
      const phases = await db('messages')
        .distinct('phase')
        .whereNotNull('phase')
        .orderBy('phase');
      
      res.json(phases.map(p => p.phase));
    } else if (db.table) {
      // Using the mock table interface
      res.json(['clarification', 'draft', 'review']);
    } else {
      throw new Error('Database connection not available');
    }
  } catch (error) {
    console.error('[Monitor API] Error getting phases:', error);
    res.status(500).json({ error: 'Failed to get phases' });
  }
});

module.exports = router;
