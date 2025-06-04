/**
 * Agent Model
 * Represents an LLM agent with specific instructions
 */

const db = require('../index');

/**
 * Valid Service Provider specialists used in the application
 * This list should match the one in assistantDefinitions.js
 */
const VALID_AGENT_PREFIXES = ['sp_', 'cst_'];
const INTERNAL_TOOLS = ['SectionAssignments', 'OrganizeQuestions', 'CustomerAnswers', 'QualityManager'];

/**
 * Get agent by name, create if doesn't exist
 * 
 * @param {String} name Agent name
 * @param {String} instructions Agent instructions
 * @returns {Object} Agent record
 */
async function getOrCreate(name, instructions = '') {
  // Ensure name is valid
  if (!name || typeof name !== 'string') {
    throw new Error(`[Agent Model] Invalid agent name: ${name}`);
  }

  // Basic validation - check that agent names follow our prefix convention
  const hasValidPrefix = VALID_AGENT_PREFIXES.some(prefix => name.startsWith(prefix));
  const isInternalTool = INTERNAL_TOOLS.includes(name);
  
  if (!hasValidPrefix && !isInternalTool) {
    console.warn(`[Agent Model] Agent name '${name}' doesn't follow naming convention. Should start with ${VALID_AGENT_PREFIXES.join(' or ')}`);
  }
  
  // Try to get existing agent
  let agent = await db('agents').where({ name }).first();
  
  // If not found, create it
  if (!agent) {
    // Ensure instructions is a string
    const safeInstructions = instructions || '';
    // Robust insert for both array/object return types
    const insertedArr = await db('agents').insert({
      name,
      instructions: safeInstructions
    }, ['id']);
    let agentId;
    if (Array.isArray(insertedArr)) {
      // For PostgreSQL/Knex >=0.95, insertedArr is array of objects with 'id'
      agentId = insertedArr[0] && insertedArr[0].id ? insertedArr[0].id : insertedArr[0];
    } else if (insertedArr && insertedArr.id) {
      // For SQLite/other, insertedArr may be an object
      agentId = insertedArr.id;
    } else {
      agentId = insertedArr;
    }
    agent = await db('agents').where({ id: agentId }).first();
  } 
  // If instructions have changed, update them
  else if (instructions && agent.instructions !== instructions) {
    // Ensure instructions is a string
    const safeInstructions = instructions || '';
    await db('agents').where({ id: agent.id }).update({ 
      instructions: safeInstructions,
      updated_at: db.fn.now() // Ensure updated_at is set to current timestamp
    });
    agent.instructions = safeInstructions;
    agent.updated_at = new Date(); // For in-memory return value
  }
  
  return agent;
}

/**
 * Get agent by name
 * 
 * @param {String} name Agent name
 * @returns {Object} Agent
 */
async function getByName(name) {
  return db('agents').where({ name }).first();
}

/**
 * Get agent by ID
 * 
 * @param {Number} id Agent ID
 * @returns {Object} Agent
 */
async function getById(id) {
  return db('agents').where({ id }).first();
}

/**
 * List all agents
 * 
 * @returns {Array} List of agents
 */
async function list() {
  return db('agents').orderBy('name');
}

module.exports = {
  getOrCreate,
  getByName,
  getById,
  list
};
