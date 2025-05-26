/**
 * Parse JSON safely from response text
 * 
 * @param {String|Object} raw - Raw text or object that may contain JSON
 * @param {String} label - Label for error reporting
 * @returns {Object} Parsed JSON object
 */
function parseJson(raw, label) {
  console.log(`[flowAgent] Attempting to parse JSON for ${label}`);
  
  // If it's an undefined or null value
  if (raw === undefined || raw === null) {
    console.error(`[flowAgent] Empty response for ${label}: ${raw}`);
    throw new Error(`No JSON response for ${label}`);
  }
  
  // If it's already an object (not a string), try to use it directly
  if (typeof raw === 'object') {
    console.log(`[flowAgent] Response for ${label} is already an object, checking properties`);
    
    // Check for output property in the format returned by Responses API
    if (raw.output && Array.isArray(raw.output) && raw.output.length > 0) {
      // Try to extract JSON from the output content
      for (const outputItem of raw.output) {
        if (outputItem.content && Array.isArray(outputItem.content)) {
          for (const contentItem of outputItem.content) {
            if (contentItem.text && typeof contentItem.text === 'string') {
              // Try to extract JSON from the text
              console.log(`[flowAgent] Found text content in output, attempting to parse`);
              try {
                return extractJsonFromText(contentItem.text, label);
              } catch (err) {
                console.log(`[flowAgent] Could not extract JSON from output text: ${err.message}`);
                // Continue checking other properties
              }
            }
          }
        }
      }
    }
    
    // If we have output_text property
    if (raw.output_text && typeof raw.output_text === 'string') {
      console.log(`[flowAgent] Found output_text property, attempting to parse`);
      try {
        return extractJsonFromText(raw.output_text, label);
      } catch (err) {
        console.log(`[flowAgent] Could not extract JSON from output_text: ${err.message}`);
        // Continue checking other properties
      }
    }
    
    // Return the raw object if no processing succeeded
    console.log(`[flowAgent] Using raw object as JSON for ${label}`);
    return raw;
  }
  
  // Handle string responses
  if (typeof raw === 'string') {
    return extractJsonFromText(raw, label);
  }
  
  // If it's neither an object nor a string, throw an error
  console.error(`[flowAgent] Unexpected type for ${label}: ${typeof raw}`);
  throw new Error(`Unexpected response type for ${label}: ${typeof raw}`);
}
