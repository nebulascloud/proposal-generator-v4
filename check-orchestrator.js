/**
 * Script to check if the orchestrator agent exists
 */

const db = require('./db');

async function checkOrchestrator() {
  try {
    console.log('Checking for orchestrator agent...');
    
    // Check for Collaboration Orchestrator
    const orchestrator = await db('agents').where({ name: 'sp_Collaboration_Orchestrator' }).first();
    if (orchestrator) {
      console.log(`Found sp_Collaboration_Orchestrator with ID ${orchestrator.id}`);
    } else {
      console.log('sp_Collaboration_Orchestrator NOT found in database');
    }
    
    // List all agents that might be related to orchestration
    console.log('\nSearching for any agents with "orchestrat" in their name:');
    const orchestrators = await db('agents').whereRaw("name LIKE ?", ['%orchestrat%']);
    console.log(orchestrators);
    
    console.log('\nListing internal tool agents:');
    const internalTools = ['BriefAnalysis', 'SectionAssignments', 'OrganizeQuestions', 'CustomerAnswers', 'QualityManager'];
    const toolAgents = await db('agents').whereIn('name', internalTools);
    console.log(toolAgents.map(a => `${a.name} (ID: ${a.id})`));
    
    console.log('Check complete!');
  } catch (error) {
    console.error('Error checking agents:', error);
  } finally {
    await db.destroy();
  }
}

checkOrchestrator();
