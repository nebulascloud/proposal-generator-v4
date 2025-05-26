/**
 * Agent Model
 * Represents an LLM agent with specific instructions
 */

const db = require('../index');

/**
 * Get agent by name, create if doesn't exist
 * 
 * @param {String} name Agent name
 * @param {String} instructions Agent instructions
 * @returns {Object} Agent record
 */
async function getOrCreate(name, instructions) {
  // Ensure proper naming convention for service provider agents
  // If name doesn't start with 'sp_' or 'cst_', prefix with 'sp_' for internal tools
  // Exceptions for well-known internal tools that aren't service providers
  const internalTools = ['BriefAnalysis', 'SectionAssignments', 'OrganizeQuestions', 'CustomerAnswers', 'QualityManager'];
  
  if (!name.startsWith('sp_') && !name.startsWith('cst_') && !internalTools.includes(name)) {
    console.warn(`[Agent Model] Agent name '${name}' doesn't follow naming convention. Consider prefixing with 'sp_' or 'cst_'`);
  }
  
  // Try to get existing agent
  let agent = await db('agents').where({ name }).first();
  
  // If not found, create it
  if (!agent) {
    const [id] = await db('agents').insert({
      name,
      instructions
    });
    
    agent = await db('agents').where({ id }).first();
  } 
  // If instructions have changed, update them
  else if (instructions && agent.instructions !== instructions) {
    await db('agents').where({ id: agent.id }).update({ instructions });
    agent.instructions = instructions;
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
