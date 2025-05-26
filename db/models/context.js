/**
 * Context Model
 * Represents stored JSON context for API calls
 */

const db = require('../index');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a new context
 * 
 * @param {Object} data Context data
 * @returns {Object} Created context
 */
async function create(data) {
  const id = data.id || uuidv4();
  
  // Fix JSON serialization for data.data
  let serializedData;
  if (typeof data.data === 'object') {
    // Make sure data.data is properly stringified
    serializedData = JSON.stringify(data.data);
  } else if (typeof data.data === 'string') {
    // Handle case where data.data might already be a JSON string
    try {
      // Test if it's valid JSON by parsing and re-stringifying
      const parsed = JSON.parse(data.data);
      serializedData = JSON.stringify(parsed);
    } catch (e) {
      // Not valid JSON, store as-is
      serializedData = data.data;
    }
  } else {
    // Fallback for other types
    serializedData = String(data.data);
  }
  
  const context = {
    id,
    data: serializedData,
    metadata: data.metadata ? JSON.stringify(data.metadata) : null
  };
  
  await db('contexts').insert(context);
  return getById(id);
}

/**
 * Get context by ID
 * 
 * @param {String} id Context ID
 * @returns {Object} Context
 */
async function getById(id) {
  const context = await db('contexts').where({ id }).first();
  if (!context) return null;
  
  // Enhanced JSON parsing with validation and error handling
  if (context.data) {
    // If it's a string, attempt to parse it safely
    if (typeof context.data === 'string') {
      try {
        // First check if it's actually JSON by looking for JSON markers
        if (context.data.trim().startsWith('{') && context.data.trim().endsWith('}') ||
            context.data.trim().startsWith('[') && context.data.trim().endsWith(']')) {
          try {
            context.data = JSON.parse(context.data);
          } catch (e) {
            console.warn(`[Context model] Invalid JSON data for context ID ${id}: ${e.message}`);
            console.log(`[Context model] First 100 chars of problematic data: ${context.data.substring(0, 100)}`);
            // Leave as string if parsing fails
          }
        }
        // Otherwise keep as string - it's not meant to be JSON
      } catch (e) {
        console.error(`[Context model] Error handling context data for ID ${id}: ${e.message}`);
        // Leave as is if there's any error
      }
    }
  }
  
  // Parse metadata if it exists - with enhanced error handling
  if (context.metadata) {
    if (typeof context.metadata === 'string') {
      try {
        context.metadata = JSON.parse(context.metadata);
      } catch (e) {
        console.warn(`[Context model] Invalid metadata JSON for context ID ${id}: ${e.message}`);
        // If metadata isn't valid JSON, provide a valid object as fallback
        context.metadata = {
          parseError: e.message,
          originalMetadata: context.metadata.substring(0, 100) + '...'
        };
      }
    } else if (typeof context.metadata !== 'object') {
      // Ensure metadata is an object if it's not a string
      context.metadata = { value: context.metadata };
    }
  } else {
    // Ensure metadata is never null/undefined
    context.metadata = {};
  }
  
  return context;
}

/**
 * Find contexts by metadata
 * 
 * @param {Object} metadataQuery Query to match against metadata
 * @returns {Array} List of matching contexts
 */
async function findByMetadata(metadataQuery) {
  // This is a simplistic implementation that only works for SQLite and PostgreSQL
  // In a real-world scenario, you might need more advanced JSON querying
  const contexts = await db('contexts')
    .whereRaw(`JSON_EXTRACT(metadata, '$.type') = ?`, [metadataQuery.type])
    .orderBy('created_at', 'desc');
  
  return contexts.map(context => {
    try {
      context.data = JSON.parse(context.data);
    } catch (e) {
      // If it's not valid JSON, leave as is
    }
    
    if (context.metadata) {
      context.metadata = JSON.parse(context.metadata);
    }
    
    return context;
  });
}

/**
 * List contexts with pagination
 * 
 * @param {Object} options Pagination options
 * @returns {Array} List of contexts
 */
async function list(options = {}) {
  const { page = 1, limit = 20 } = options;
  
  const contexts = await db('contexts')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset((page - 1) * limit);
  
  return contexts.map(context => {
    try {
      context.data = JSON.parse(context.data);
    } catch (e) {
      // If it's not valid JSON, leave as is
    }
    
    if (context.metadata) {
      context.metadata = JSON.parse(context.metadata);
    }
    
    return context;
  });
}

module.exports = {
  create,
  getById,
  findByMetadata,
  list
};
