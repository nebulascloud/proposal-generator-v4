/**
 * Extract JSON from a string (optionally from a code block). Throws on error.
 * @param {string} text - String containing JSON or JSON code block
 * @param {string} label - Label for error reporting
 * @returns {Object} Parsed JSON object
 */
function extractJsonFromText(text, label) {
  if (typeof text !== 'string') {
    throw new Error(`[extractJsonFromText] Input for ${label} must be a string`);
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`[extractJsonFromText] Empty string for ${label}`);
  }
  // Look for JSON code blocks
  const jsonCodeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
  const match = trimmed.match(jsonCodeBlockRegex);
  let jsonStr = match && match[1] ? match[1].trim() : trimmed;
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`[extractJsonFromText] Invalid JSON for ${label}: ${err.message}`);
  }
}
