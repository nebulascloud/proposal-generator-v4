/**
 * Script to add the missing sp_Collaboration_Orchestrator agent
 */

const db = require('./db');
const { assistantDefinitions } = require('./agents/assistantDefinitions');

async function fixOrchestrator() {
  try {
    console.log('Starting orchestrator fix...');
    
    // Check if orchestrator exists
    const existingOrchestrator = await db('agents').where({ name: 'sp_Collaboration_Orchestrator' }).first();
    
    if (!existingOrchestrator) {
      console.log('Creating missing sp_Collaboration_Orchestrator agent');
      const orchestratorDef = assistantDefinitions['sp_Collaboration_Orchestrator'];
      
      if (orchestratorDef) {
        await db('agents').insert({
          name: 'sp_Collaboration_Orchestrator',
          instructions: orchestratorDef
        });
        console.log('sp_Collaboration_Orchestrator agent added successfully');
      } else {
        console.error('Error: Could not find orchestrator definition in assistantDefinitions.js');
      }
    } else {
      console.log(`sp_Collaboration_Orchestrator already exists with ID ${existingOrchestrator.id}`);
    }
    
    // Verify all other speciality agents exist
    const expectedAgents = [
      'sp_Account_Manager',
      'sp_Project_Manager',
      'sp_Commercial_Manager', 
      'sp_Legal_Counsel',
      'sp_Solution_Architect',
      'sp_Data_Architect',
      'sp_Lead_Engineer',
      'sp_Quality_Manager',
      'cst_Customer'
    ];
    
    console.log('\nChecking that all expected agents exist:');
    for (const agentName of expectedAgents) {
      const agent = await db('agents').where({ name: agentName }).first();
      if (agent) {
        console.log(`✅ ${agentName} exists (ID: ${agent.id})`);
      } else {
        console.log(`❌ ${agentName} is missing - adding it now`);
        const definition = assistantDefinitions[agentName];
        if (definition) {
          await db('agents').insert({
            name: agentName,
            instructions: definition
          });
          console.log(`  Added ${agentName} successfully`);
        } else {
          console.error(`  Error: Could not find definition for ${agentName}`);
        }
      }
    }
    
    console.log('\nVerifying internal tool agents:');
    const internalTools = ['BriefAnalysis', 'SectionAssignments', 'OrganizeQuestions', 'CustomerAnswers'];
    for (const toolName of internalTools) {
      const tool = await db('agents').where({ name: toolName }).first();
      if (tool) {
        console.log(`🔧 ${toolName} exists (ID: ${tool.id}) - these are internal workflow tools`);
      }
    }
    
    console.log('\nFix complete!');
  } catch (error) {
    console.error('Error fixing orchestrator:', error);
  } finally {
    // Close DB connection
    await db.destroy();
  }
}

fixOrchestrator();
