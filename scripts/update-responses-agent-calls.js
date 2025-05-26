/**
 * Script to update responsesAgent function calls
 * This script adds the phase and proposalId parameters to the function calls
 */

const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../agents/flowAgent.js');
const content = fs.readFileSync(filePath, 'utf8');

// Helper function to determine phase based on context
function determinePhase(line, index, lines) {
  // Look a few lines above for clues about the phase
  const contextLines = lines.slice(Math.max(0, index - 10), index);
  
  if (contextLines.some(l => l.includes('Phase1') || l.includes('brief') || l.includes('analysis') || l.includes('clarify'))) {
    return 'clarification';
  }
  if (contextLines.some(l => l.includes('Phase2') || l.includes('draft') || l.includes('section'))) {
    return 'draft';
  }
  if (contextLines.some(l => l.includes('Phase3') || l.includes('review') || l.includes('revision'))) {
    return 'review';
  }
  if (contextLines.some(l => l.includes('Phase4') || l.includes('final') || l.includes('assembly'))) {
    return 'final';
  }
  
  return 'unknown';
}

// Process the file content
function processFile(content) {
  const lines = content.split('\n');
  let modified = false;
  let inCreateInitialResponse = false;
  let inForkResponse = false;
  let createInitialResponseStart = -1;
  let forkResponseStart = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check for createInitialResponse
    if (line.includes('await responsesAgent.createInitialResponse(')) {
      inCreateInitialResponse = true;
      createInitialResponseStart = i;
    }
    
    // Check for forkResponse
    if (line.includes('await responsesAgent.forkResponse(')) {
      inForkResponse = true;
      forkResponseStart = i;
    }
    
    // If we find a closing parenthesis and we're in a function call
    if ((line.includes(');') || line.trim() === ')') && (inCreateInitialResponse || inForkResponse)) {
      const phase = determinePhase(line, i, lines);
      const functionStart = inCreateInitialResponse ? createInitialResponseStart : forkResponseStart;
      
      // Count parameters by looking at commas
      const relevantLines = lines.slice(functionStart, i + 1);
      const paramsCount = relevantLines.join('').split(',').length;
      
      if (paramsCount <= 3 && inCreateInitialResponse) {
        // Add the phase and proposalId parameters
        lines[i] = line.replace(');', `, "${phase}", currentProposalId);`);
        modified = true;
      }
      else if (paramsCount <= 4 && inForkResponse) {
        // Add the phase and proposalId parameters
        lines[i] = line.replace(');', `, "${phase}", currentProposalId);`);
        modified = true;
      }
      
      inCreateInitialResponse = false;
      inForkResponse = false;
    }
  }
  
  if (modified) {
    return lines.join('\n');
  } else {
    return content;
  }
}

// Process the file
const updatedContent = processFile(content);

// Write the file back if it was modified
if (updatedContent !== content) {
  fs.writeFileSync(filePath, updatedContent, 'utf8');
  console.log('Updated flowAgent.js with new parameters');
} else {
  console.log('No changes needed in flowAgent.js');
}
