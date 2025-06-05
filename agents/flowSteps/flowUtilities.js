// agents/flowSteps/flowUtilities.js

const templateModule = require('../../templates/defaultTemplate'); // Renamed import for clarity

// Placeholder for shared utility functions to be migrated/refined during refactor

/**
 * Safely parse a JSON string, with helpful error messages.
 * @param {string} raw - The raw string to parse.
 * @param {string} label - Label for error context.
 * @returns {any} Parsed JSON object.
 * @throws {Error} If parsing fails.
 */
function parseJson(raw, label = 'JSON') {
  if (typeof raw !== 'string') {
    throw new Error(`[parseJson] Non-string input for ${label}`);
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'undefined') {
    throw new Error(`[parseJson] Empty or undefined input for ${label}`);
  }
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    throw new Error(`[parseJson] Failed to parse ${label}: ${e.message}`);
  }
}

/**
 * Deep clone a value (object, array, etc.) using structuredClone if available, else fallback to JSON.
 * @param {any} value - The value to clone.
 * @returns {any} Deep cloned value.
 */
function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  // Fallback: works for JSON-safe data only
  return JSON.parse(JSON.stringify(value));
}

/**
 * Recursively remove undefined values from an object or array.
 * @param {any} obj - The object or array to clean.
 * @returns {any} Cleaned object/array.
 */
function removeUndefined(obj) {
  if (Array.isArray(obj)) {
    return obj.map(removeUndefined).filter(v => v !== undefined);
  } else if (obj && typeof obj === 'object') {
    return Object.entries(obj).reduce((acc, [k, v]) => {
      const cleaned = removeUndefined(v);
      if (cleaned !== undefined) acc[k] = cleaned;
      return acc;
    }, {});
  }
  return obj === undefined ? undefined : obj;
}

/**
 * Retrieves and validates the sections from the default proposal template.
 * @returns {Array} A deep clone of the proposal sections.
 * @throws {Error} If sections are missing, invalid, or empty in the default template.
 */
function getProposalSections() {
  // Access the actual template object from the imported module
  const actualTemplateObject = templateModule.defaultTemplate;

  if (!actualTemplateObject || typeof actualTemplateObject !== 'object' || Object.keys(actualTemplateObject).length === 0) {
    throw new Error('[getProposalSections] Default proposal template object (templateModule.defaultTemplate) is missing, not an object, or empty. Cannot proceed.');
  }
  // Transform the keys of the actualTemplateObject into an array of {name: sectionKey} objects
  const sectionsArray = Object.keys(actualTemplateObject).map(key => ({ name: key }));
  
  // Return a deep clone to prevent accidental modification of the original template structure
  return deepClone(sectionsArray);
}

/**
 * Updates the status of a session in the database.
 * @param {string} sessionId - The ID of the session to update.
 * @param {string} status - The new status string.
 * @returns {Promise<void>}
 * @throws {Error} If the session is not found or if the database update fails.
 */
async function updateSessionStatus(sessionId, status) {
  const Session = require('../../db/models/session'); // Moved require here to avoid circular dependencies if Session model uses flowUtilities
  if (!sessionId || !status) {
    console.error('[updateSessionStatus] Missing sessionId or status.');
    // Depending on desired strictness, could throw an error here
    return;
  }

  try {
    // Use the existing Session.update method which expects an object
    const updatedSession = await Session.update({ id: sessionId, status });
    
    if (!updatedSession) {
      // Log an error but don't throw, as the flow might continue or handle this specific case
      console.error(`[updateSessionStatus] Session not found with ID: ${sessionId} or update failed. Cannot update status to "${status}".`);
      return;
    }
    console.log(`Session ${sessionId} status updated to: ${status}`);
  } catch (error) {
    console.error(`[updateSessionStatus] Failed to update session ${sessionId} to status "${status}":`, error);
    // Re-throw the error to be handled by the calling phase function
    throw error;
  }
}

/**
 * Formats questions from previous specialists for use in sequential question generation.
 * Groups questions by specialist role for better organization.
 * @param {Array<Object>} questions - Array of question objects from previous specialists
 * @returns {string} Formatted string of previous questions
 */
function formatPreviousQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return 'No previous questions available.';
  }
  
  // Handle case where the question data might be nested
  if (questions.length === 1 && questions[0].questions && Array.isArray(questions[0].questions)) {
    questions = questions[0].questions.map(q => ({...q, role: questions[0].role || 'Unknown Specialist'}));
  }
  
  // Group questions by specialist role
  const questionsBySpecialist = questions.reduce((acc, q) => {
    const specialist = q.role || 'Unknown Specialist';
    if (!acc[specialist]) acc[specialist] = [];
    acc[specialist].push(q);
    return acc;
  }, {});
  
  // Build formatted output grouped by specialist
  const formattedSections = [];
  
  for (const [specialist, specialistQuestions] of Object.entries(questionsBySpecialist)) {
    // Format the section for this specialist
    const formattedQuestions = specialistQuestions.map(q => {
      let questionText = q.question;
      
      // Add importance if available
      if (q.importance) {
        questionText += ` (${q.importance} importance)`;
      }
      
      return questionText;
    }).join('\n\n');
    
    const specialistSection = `Questions from ${specialist}:\n\n${formattedQuestions}`;
    formattedSections.push(specialistSection);
  }
    
  return formattedSections.join('\n\n');
}

module.exports = {
  parseJson,
  deepClone,
  removeUndefined,
  getProposalSections,
  updateSessionStatus, // Export the new utility
  formatPreviousQuestions
  // ...add other utilities as needed
};
