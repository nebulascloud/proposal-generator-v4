/**
 * Database-backed Message Context Builder
 * 
 * Utility to build conversation context from database messages instead of files
 */

const Message = require('../db/models/message');
const jsonContext = require('../utils/jsonContext');

/**
 * Build conversation context from database messages
 * 
 * @param {String} sessionId Session ID
 * @param {Object} options Context building options
 * @returns {Object} Context string and token estimate
 */
async function buildMessageContext(sessionId, options = {}) {
  try {
    const { 
      maxMessages = 10,     // Maximum number of messages to include
      includePhases = null, // Specific phases to include
      agentName = null,     // Specific agent to include
      format = 'text'       // 'text', 'markdown', or 'compact'
    } = options;
    
    // Get messages for this session
    const query = {
      phase: includePhases,
      agentName: agentName
    };
    
    const messages = await Message.getBySessionId(sessionId, query);
    
    // Sort messages by created_at (newest first)
    messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    // Take the most recent messages up to maxMessages
    const recentMessages = messages.slice(0, maxMessages);
    
    // Sort back to chronological order
    recentMessages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    
    // Build context string
    let contextStr = '';
    let tokenEstimate = 0;
    
    for (const msg of recentMessages) {
      const roleName = msg.role === 'user' ? 'User' : 'Assistant';
      
      if (format === 'markdown') {
        contextStr += `### ${roleName} (${msg.phase || 'unknown phase'}):\n\n${msg.content}\n\n`;
      } else if (format === 'compact') {
        contextStr += `${roleName}: ${msg.content.replace(/\n+/g, ' ')}\n`;
      } else {
        // Default text format
        contextStr += `${roleName}: ${msg.content}\n\n`;
      }
      
      // Rough token estimate (about 4 chars per token)
      tokenEstimate += Math.ceil(msg.content.length / 4);
    }
    
    return {
      context: contextStr,
      tokenEstimate,
      messageCount: recentMessages.length
    };
  } catch (error) {
    console.error('[Context Builder Error]', error);
    return {
      context: '',
      tokenEstimate: 0,
      messageCount: 0,
      error: error.message
    };
  }
}

module.exports = {
  buildMessageContext
};
