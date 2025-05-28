/**
 * Parse JSON from a string. Throws on error.
 * @param {string} raw - Raw text containing JSON
 * @param {string} label - Label for error reporting
 * @returns {Object} Parsed JSON object
 */
function parseJson(raw, label) {
  if (typeof raw !== 'string') {
    throw new Error(`[parseJson] Input for ${label} must be a string`);
  }
  try {
    return extractJsonFromText(raw, label);
  } catch (err) {
    throw new Error(`[parseJson] Failed to parse JSON for ${label}: ${err.message}`);
  }
}
