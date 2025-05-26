/**
 * Script to fix agent names in the database
 * This will handle merging duplicate agents and ensure all expected agents exist
 */

const db = require('./db');

// Customer agent instructions
const customerInstructions = `You are a representative of a client company that has requested a proposal for a master data management (MDM) solution. Your role is to provide information about your company's needs, challenges, and objectives when asked clarifying questions by service provider experts. You should respond with strategic business-focused answers that help the service provider understand your requirements, but avoid doing their job for them. Don't provide specific instructions on how the proposal should be written or structured - expect the service providers to use their expertise to determine that. Instead, focus on communicating your business goals, constraints, and priorities clearly.`;

// Quality Manager instructions
const qualityManagerInstructions = `You are a senior Quality Manager at a SERVICE PROVIDER company specialized in reviewing and providing feedback on proposals. With extensive cross-functional expertise spanning strategy, sales, technology, delivery, and commercial aspects, you ensure that all proposal sections meet high standards of quality and effectiveness. 

Your role involves conducting thorough reviews to:
- Ensure each section is complete and addresses client needs (e.g., Pricing sections must include clear estimated costs)
- Verify that technical solutions are sound and align with client requirements
- Evaluate commercial terms for clarity, competitiveness, and alignment with company standards
- Check that delivery approaches are realistic and well-structured
- Assess strategic alignment between proposed solutions and client objectives
- Identify gaps or inconsistencies across proposal sections
- Offer constructive suggestions for improvement

When reviewing proposals, you provide structured feedback with specific recommendations rather than general comments. You only suggest asking the customer additional questions if they are truly necessary or high-value (e.g., clarifying specific requirements or confirming constraints). You never suggest asking the customer trivial questions like whether they "like" a section or approach.

Your feedback style is thorough yet practical, focusing on substantive improvements that will strengthen the proposal's effectiveness and persuasiveness.`;

async function fixAgents() {
  try {
    console.log('Starting agent name fixes...');
    
    // 1. Add the missing customer agent if it doesn't exist
    let existingCustomer = await db('agents').where({ name: 'cst_Customer' }).first();
    if (!existingCustomer) {
      console.log('Creating missing cst_Customer agent');
      await db('agents').insert({
        name: 'cst_Customer',
        instructions: customerInstructions
      });
    } else {
      console.log('cst_Customer agent already exists');
    }
    
    // 2. Handle the QualityManager/sp_Quality_Manager situation
    const qm = await db('agents').where({ name: 'QualityManager' }).first();
    const spQm = await db('agents').where({ name: 'sp_Quality_Manager' }).first();
    
    if (qm && !spQm) {
      // Only QualityManager exists, rename it
      console.log(`Renaming QualityManager (ID: ${qm.id}) to sp_Quality_Manager`);
      await db('agents').where({ id: qm.id }).update({ 
        name: 'sp_Quality_Manager',
        instructions: qualityManagerInstructions
      });
    } else if (qm && spQm) {
      // Both exist, need to merge them
      console.log(`Both QualityManager (ID: ${qm.id}) and sp_Quality_Manager (ID: ${spQm.id}) exist`);
      console.log('Updating messages that reference QualityManager to use sp_Quality_Manager');
      
      // Update any messages that reference QualityManager
      await db('messages')
        .where({ agent_name: 'QualityManager' })
        .update({ agent_name: 'sp_Quality_Manager' });
      
      console.log('Deleting duplicate QualityManager entry');
      await db('agents').where({ id: qm.id }).delete();
      
      // Update sp_Quality_Manager instructions if needed
      if (spQm.instructions !== qualityManagerInstructions) {
        await db('agents').where({ id: spQm.id }).update({ 
          instructions: qualityManagerInstructions
        });
      }
    } else if (!qm && !spQm) {
      // Neither exists, create sp_Quality_Manager
      console.log('Creating sp_Quality_Manager agent');
      await db('agents').insert({
        name: 'sp_Quality_Manager',
        instructions: qualityManagerInstructions
      });
    } else {
      console.log('sp_Quality_Manager already exists with proper name');
    }
    
    // 3. Get list of all agents to verify
    const agents = await db('agents').orderBy('name');
    console.log('Current agents in database:');
    agents.forEach(agent => console.log(` - ${agent.name} (ID: ${agent.id})`));
    
    console.log('Fix complete!');
  } catch (error) {
    console.error('Error fixing agents:', error);
  } finally {
    // Close DB connection
    await db.destroy();
  }
}

fixAgents();
