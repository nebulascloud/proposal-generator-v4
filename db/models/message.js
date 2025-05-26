/**
 * Message Model
 * Represents a message in the OpenAI conversation
 */

const db = require('../index');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a new message
 * 
 * @param {Object} data Message data
 * @returns {Object} Created message
 */
async function create(data) {
  const id = data.id || uuidv4();
  const message = {
    id,
    response_id: data.responseId,
    phase: data.phase,
    agent_name: data.agentName,
    role: data.role,
    content: data.content,
    parent_message_id: data.parentMessageId || null,
    session_id: data.sessionId,
    metadata: data.metadata ? JSON.stringify(data.metadata) : null
  };
  
  await db('messages').insert(message);
  return getById(id);
}

/**
 * Get message by ID
 * 
 * @param {String} id Message ID
 * @returns {Object} Message
 */
async function getById(id) {
  try {
    const message = await db('messages').where({ id }).first();
    if (!message) {
      console.log(`[Message Model] Message not found with ID: ${id}`);
      return null;
    }
    
    if (message.metadata) {
      try {
        // Check if metadata is already an object (might have been parsed already)
        if (typeof message.metadata === 'object' && message.metadata !== null) {
          console.log(`[Message Model] Message ${id} metadata is already an object, skipping parsing`);
        } else if (typeof message.metadata === 'string') {
          // Check if the string is empty or not valid JSON
          if (message.metadata.trim() === '') {
            message.metadata = {};
          } else {
            message.metadata = JSON.parse(message.metadata);
          }
        } else {
          console.warn(`[Message Model] Message ${id} has metadata of unexpected type: ${typeof message.metadata}`);
          message.metadata = {};
        }
      } catch (e) {
        console.error(`[Message Model] Error parsing metadata for message ${id}: ${e.message}`);
        message.metadata = { 
          parseError: e.message,
          rawLength: message.metadata ? message.metadata.length : 0 
        };
      }
    }
    
    return message;
  } catch (error) {
    console.error(`[Message Model] Error retrieving message ${id}: ${error.message}`);
    return null;
  }
}

/**
 * Get messages by session ID
 * 
 * @param {String} sessionId Session ID
 * @param {Object} options Filter options
 * @returns {Array} List of messages
 */
async function getBySessionId(sessionId, options = {}) {
  const { phase, agentName, role } = options;
  
  console.log(`[Message Model] Getting messages for session ${sessionId} with filters: phase=${phase || 'any'}, agentName=${agentName || 'any'}, role=${role || 'any'}`);
  
  try {
    const query = db('messages').where({ session_id: sessionId });
    
    if (phase) query.where({ phase });
    if (agentName) query.where({ agent_name: agentName });
    if (role) query.where({ role });
    
    query.orderBy('created_at', 'asc');
    
    // Execute query and ensure we get an array back
    let messages = await query;
    if (!Array.isArray(messages)) {
      console.warn(`[Message Model] Query result for session ${sessionId} is not an array, converting to array`);
      messages = messages ? [messages] : [];
    }
    
    console.log(`[Message Model] Found ${messages.length} messages for session ${sessionId}`);
    
    // Process each message and handle errors individually
    return messages.map(message => {
      try {
        if (message.metadata) {
          try {
            // Check if metadata is already an object
            if (typeof message.metadata === 'object' && message.metadata !== null) {
              console.log(`[Message Model] Message ${message.id} metadata is already an object, skipping parsing`);
            } else if (typeof message.metadata === 'string') {
              // Only parse if it's a non-empty string
              if (message.metadata.trim() === '') {
                message.metadata = {};
              } else {
                message.metadata = JSON.parse(message.metadata);
              }
            } else {
              console.warn(`[Message Model] Message ${message.id} has metadata of unexpected type: ${typeof message.metadata}`);
              message.metadata = {};
            }
          } catch (e) {
            console.error(`[Message Model] Error parsing metadata for message ${message.id}: ${e.message}`);
            // Don't let a single message parsing error break the whole list
            message.metadata = { 
              parseError: e.message,
              originalType: typeof message.metadata
            };
          }
        }
        return message;
      } catch (messageError) {
        console.error(`[Message Model] Error processing message: ${messageError.message}`);
        // Return a placeholder for broken messages
        return {
          id: message.id || 'unknown',
          content: 'Error: Could not process message data',
          role: message.role || 'unknown',
          agent_name: message.agent_name || 'unknown',
          error: messageError.message,
          metadata: { error: 'Message processing error' }
        };
      }
    });
  } catch (error) {
    console.error(`[Message Model] Error retrieving messages for session ${sessionId}: ${error.message}`);
    // Return empty array instead of throwing to prevent UI from breaking
    return [];
  }
}

/**
 * Get messages by OpenAI response ID
 * 
 * @param {String} responseId OpenAI response ID
 * @returns {Array} List of messages
 */
async function getByResponseId(responseId) {
  try {
    let messages = await db('messages').where({ response_id: responseId });
    
    // Handle case when result is not an array
    if (!Array.isArray(messages)) {
      console.warn(`[Message Model] Response ID query result is not an array for ${responseId}, converting to array`);
      messages = messages ? [messages] : [];
    }
    
    console.log(`[Message Model] Found ${messages.length} messages for response ID ${responseId}`);
    
    // Process each message with error handling
    return messages.map(message => {
      try {
        if (message.metadata) {
          try {
            // Check if metadata is already an object
            if (typeof message.metadata === 'object' && message.metadata !== null) {
              console.log(`[Message Model] Message ${message.id} metadata is already an object, skipping parsing`);
            } else if (typeof message.metadata === 'string') {
              // Only parse if it's a non-empty string
              if (message.metadata.trim() === '') {
                message.metadata = {};
              } else {
                message.metadata = JSON.parse(message.metadata);
              }
            } else {
              console.warn(`[Message Model] Message ${message.id} has metadata of unexpected type: ${typeof message.metadata}`);
              message.metadata = {};
            }
          } catch (e) {
            console.error(`[Message Model] Error parsing metadata for message ${message.id} with response ID ${responseId}: ${e.message}`);
            message.metadata = { parseError: e.message };
          }
        }
        return message;
      } catch (messageError) {
        console.error(`[Message Model] Error processing message with response ID ${responseId}: ${messageError.message}`);
        return {
          id: message.id || 'unknown',
          content: 'Error: Could not process message data',
          role: message.role || 'unknown',
          error: messageError.message
        };
      }
    });
  } catch (error) {
    console.error(`[Message Model] Error retrieving messages for response ID ${responseId}: ${error.message}`);
    return [];
  }
}

/**
 * Get conversation thread (all related messages)
 * 
 * @param {String} messageId Starting message ID
 * @returns {Array} Conversation thread
 */
async function getThread(messageId) {
  // Get the initial message
  const message = await getById(messageId);
  if (!message) return [];
  
  // Get all messages in the same session
  const sessionMessages = await getBySessionId(message.session_id);
  
  // Build a map of messages by ID for quick lookup
  const messageMap = {};
  sessionMessages.forEach(msg => {
    messageMap[msg.id] = { 
      ...msg, 
      children: [] 
    };
  });
  
  // Build the tree structure
  const roots = [];
  sessionMessages.forEach(msg => {
    const messageWithChildren = messageMap[msg.id];
    
    if (msg.parent_message_id && messageMap[msg.parent_message_id]) {
      messageMap[msg.parent_message_id].children.push(messageWithChildren);
    } else {
      roots.push(messageWithChildren);
    }
  });
  
  // Function to flatten the tree into a thread
  function flattenThread(node, thread = []) {
    thread.push(node);
    node.children.forEach(child => flattenThread(child, thread));
    return thread;
  }
  
  // Find the root that contains our message
  let targetRoot = null;
  function findContainingRoot(node, targetId) {
    if (node.id === targetId) return true;
    for (const child of node.children) {
      if (findContainingRoot(child, targetId)) return true;
    }
    return false;
  }
  
  for (const root of roots) {
    if (findContainingRoot(root, messageId)) {
      targetRoot = root;
      break;
    }
  }
  
  if (!targetRoot) return [message]; // Fallback to just the requested message
  
  // Flatten the tree into a thread
  return flattenThread(targetRoot).map(node => {
    const { children, ...messageWithoutChildren } = node;
    return messageWithoutChildren;
  });
}

module.exports = {
  create,
  getById,
  getBySessionId,
  getByResponseId,
  getThread
};
