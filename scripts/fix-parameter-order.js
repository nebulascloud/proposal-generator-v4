#!/usr/bin/env node

/**
 * This script identifies and helps refactor all incorrect trackTokenUsage calls
 * in the codebase, following the pattern defined in the parameter-handling-refactoring-plan.md
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Configuration
const rootDir = path.resolve(__dirname, '..');
const filesToSearch = ['agents/flowAgent.js'];
const functionName = 'trackTokenUsage';

// Regular expression to find the incorrect parameter pattern
const incorrectCallRegex = /responsesAgent\.trackTokenUsage\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*["']Phase(\d+)_([^"']+)["']/g;

// Function to process a file
async function processFile(filePath) {
  console.log(`Processing ${filePath}...`);
  const fullPath = path.join(rootDir, filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    return;
  }
  
  const fileContent = fs.readFileSync(fullPath, 'utf8');
  const lines = fileContent.split('\n');
  
  let modified = false;
  let foundCalls = [];
  
  // Find all incorrect calls
  let match;
  while ((match = incorrectCallRegex.exec(fileContent)) !== null) {
    const [fullMatch, response, proposalId, phaseNumber, componentName] = match;
    const lineIndex = fileContent.substring(0, match.index).split('\n').length - 1;
    
    foundCalls.push({
      lineNumber: lineIndex + 1,
      originalCall: fullMatch,
      response: response.trim(),
      proposalId: proposalId.trim(),
      phaseNumber,
      componentName: componentName.trim(),
      index: match.index
    });
  }
  
  // Log found calls
  if (foundCalls.length === 0) {
    console.log(`No incorrect ${functionName} calls found in ${filePath}`);
    return;
  }
  
  console.log(`Found ${foundCalls.length} incorrect ${functionName} calls in ${filePath}:`);
  foundCalls.forEach((call, index) => {
    console.log(`\n[${index + 1}/${foundCalls.length}] Line ${call.lineNumber}:`);
    console.log(`  Original: ${call.originalCall}`);
    
    // Generate the corrected call
    const correctComponent = call.componentName.toLowerCase()
      .replace(/^[a-z]/, match => match.toLowerCase())
      .replace(/([A-Z])/g, match => match.toLowerCase());
    
    const correctedCall = `responsesAgent.trackTokenUsage(${call.response}, "phase${call.phaseNumber}", "${correctComponent}")`;
    console.log(`  Corrected: ${correctedCall}`);
    
    // Show context
    const contextStart = Math.max(0, call.lineNumber - 3);
    const contextEnd = Math.min(lines.length, call.lineNumber + 2);
    
    console.log('\n  Context:');
    for (let i = contextStart; i < contextEnd; i++) {
      if (i === call.lineNumber - 1) {
        console.log(`  > ${lines[i]}`);
      } else {
        console.log(`    ${lines[i]}`);
      }
    }
  });
  
  // Interactive mode interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));
  
  const answer = await askQuestion('\nWould you like to automatically fix these issues? (y/n) ');
  
  if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
    // Apply fixes starting from the end to avoid index shifting
    let newContent = fileContent;
    
    for (let i = foundCalls.length - 1; i >= 0; i--) {
      const call = foundCalls[i];
      const correctComponent = call.componentName.toLowerCase()
        .replace(/^[a-z]/, match => match.toLowerCase())
        .replace(/([A-Z])/g, match => match.toLowerCase());
      
      const correctedCall = `responsesAgent.trackTokenUsage(${call.response}, "phase${call.phaseNumber}", "${correctComponent}")`;
      
      // Replace in the content
      newContent = newContent.substring(0, call.index) + 
                   correctedCall + 
                   newContent.substring(call.index + call.originalCall.length);
      
      modified = true;
    }
    
    if (modified) {
      // Create a backup
      fs.writeFileSync(`${fullPath}.bak`, fileContent);
      console.log(`Created backup at ${fullPath}.bak`);
      
      // Write the modified file
      fs.writeFileSync(fullPath, newContent);
      console.log(`Updated ${filePath} with ${foundCalls.length} fixes`);
    }
  } else {
    console.log('No changes made.');
  }
  
  rl.close();
}

// Main function
async function main() {
  console.log(`Searching for incorrect ${functionName} calls...`);
  
  for (const file of filesToSearch) {
    await processFile(file);
  }
  
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
