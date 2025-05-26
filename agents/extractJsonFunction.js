// Helper function to extract JSON from text (markdown, code blocks, etc.)
function extractJsonFromText(text, label) {
  const trimmed = text.trim();
  if (!trimmed || trimmed === 'undefined') {
    console.error(`[flowAgent] Undefined or empty response for ${label}`);
    throw new Error(`No JSON response for ${label}`);
  }
  
  // First try: If the entire response is valid JSON, parse it directly
  try {
    return JSON.parse(trimmed);
  } catch (directParseError) {
    console.log(`[flowAgent] Direct JSON parse failed, attempting to extract JSON from text: ${directParseError.message}`);
  }
  
  // Second try: Find first opening brace and last closing brace for JSON object
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  
  // Find first opening bracket and last closing bracket for JSON array
  const firstArray = trimmed.indexOf('[');
  const lastArray = trimmed.lastIndexOf(']');
  
  // Determine if we're dealing with an object or array
  let jsonStr;
  if (first >= 0 && last > first) {
    // It's an object
    jsonStr = trimmed.substring(first, last + 1);
  } else if (firstArray >= 0 && lastArray > firstArray) {
    // It's an array
    jsonStr = trimmed.substring(firstArray, lastArray + 1);
  } else {
    // Try to handle cases where markdown formatting might be present
    const codeBlockStart = trimmed.indexOf("```json");
    if (codeBlockStart >= 0) {
      const codeContentStart = trimmed.indexOf("\n", codeBlockStart) + 1;
      const codeBlockEnd = trimmed.indexOf("```", codeContentStart);
      if (codeBlockEnd > codeContentStart) {
        jsonStr = trimmed.substring(codeContentStart, codeBlockEnd).trim();
        console.log(`[flowAgent] Extracted JSON from code block for ${label}`);
      }
    } else {
      // Try other code block formats (```javascript, etc.)
      const genericCodeBlockStart = trimmed.indexOf("```");
      if (genericCodeBlockStart >= 0) {
        const genericCodeContentStart = trimmed.indexOf("\n", genericCodeBlockStart) + 1;
        const genericCodeBlockEnd = trimmed.indexOf("```", genericCodeContentStart);
        if (genericCodeBlockEnd > genericCodeContentStart) {
          jsonStr = trimmed.substring(genericCodeContentStart, genericCodeBlockEnd).trim();
          console.log(`[flowAgent] Extracted JSON from generic code block for ${label}`);
        }
      }
    }
    
    // If still no JSON found
    if (!jsonStr) {
      console.error(`[flowAgent] JSON structure not found in ${label} response`);
      throw new Error(`Invalid JSON for ${label}`);
    }
  }
  
  // Try to parse the extracted JSON
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error(`[flowAgent] JSON.parse error for ${label}:`, e.message);
    // Try to fix common JSON issues
    const fixAttempts = [
      // Replace single quotes with double quotes
      () => JSON.parse(jsonStr.replace(/'/g, '"')),
      // Replace unquoted keys with quoted keys
      () => JSON.parse(jsonStr.replace(/(\b\w+\b)(?=\s*:)/g, '"$1"')),
      // Fix trailing commas in objects
      () => JSON.parse(jsonStr.replace(/,\s*}/g, '}')),
      // Fix trailing commas in arrays
      () => JSON.parse(jsonStr.replace(/,\s*\]/g, ']')),
      // Add double quotes to keys and string values that seem to be missing them
      () => {
        let result = jsonStr;
        // Replace unquoted properties
        result = result.replace(/(\b\w+\b)(?=\s*:)/g, '"$1"');
        // Try to fix unquoted string values (simplistic approach)
        result = result.replace(/:(\s*)([A-Za-z][A-Za-z0-9_\s]+)(?=,|}|$)/g, ':"$2"');
        return JSON.parse(result);
      }
    ];
    
    // Try each fix attempt
    for (const fixAttempt of fixAttempts) {
      try {
        return fixAttempt();
      } catch (fixError) {
        // Continue to next attempt
      }
    }
    
    console.error(`[flowAgent] All JSON parsing attempts failed for ${label}`);
    console.error(`[flowAgent] JSON string was: ${jsonStr}`);
    throw new Error(`Invalid JSON for ${label}: ${e.message}`);
  }
}
