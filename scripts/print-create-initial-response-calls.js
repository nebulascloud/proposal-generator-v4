// Script to print all createInitialResponse calls from the last test run
const fs = require('fs');
const path = require('path');

const jestOutputPath = path.join(__dirname, '../jest-output.txt');

const content = fs.readFileSync(jestOutputPath, 'utf8');
const match = content.match(/All createInitialResponse calls:(.*?)(\n\]|\]\n)/s);
if (match) {
  const jsonStr = match[1] + ']';
  try {
    const calls = JSON.parse(jsonStr);
    calls.forEach((call, i) => {
      console.log(`Call #${i + 1}:`);
      console.dir(call, { depth: null });
    });
  } catch (e) {
    console.error('Failed to parse createInitialResponse calls:', e);
    console.log(jsonStr);
  }
} else {
  console.log('No createInitialResponse calls found in jest-output.txt');
}
