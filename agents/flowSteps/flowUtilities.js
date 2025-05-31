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

module.exports = {
  parseJson,
  deepClone,
  removeUndefined,
  getProposalSections,
  // ...add other utilities as needed
};
