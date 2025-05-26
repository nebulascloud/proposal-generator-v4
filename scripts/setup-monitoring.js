/**
 * Script to set up monitoring and seed the database
 */

const db = require('../db');
const { initDatabase } = require('../db/setup');
const Agent = require('../db/models/agent');
const { assistantDefinitions } = require('../agents/assistantDefinitions');

async function setupMonitoring() {
  try {
    console.log('Initializing database...');
    await initDatabase();
    
    console.log('Seeding agents from assistantDefinitions...');
    for (const [name, instructions] of Object.entries(assistantDefinitions)) {
      await Agent.getOrCreate(name, instructions);
      console.log(`Added agent: ${name}`);
    }
    
    console.log('Setup complete!');
    console.log('You can now access the monitoring dashboard at: http://localhost:3000/monitor/');
  } catch (error) {
    console.error('Error during setup:', error);
  } finally {
    // Close the database connection
    await db.destroy();
  }
}

setupMonitoring();
