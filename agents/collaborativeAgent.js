require('dotenv').config();
const { generateProposal } = require('./proposalAgent');
const { createAssistant, getAssistantResponse } = require('./assistantAgent');

/**
 * Orchestrates multiple agent roles to collaboratively refine a proposal.
 */
async function collaborateProposal({ title, client, details }) {
  if (process.env.NODE_ENV === 'test') {
    return {
      initial: await generateProposal({ title, client, details }),
      reviews: {},
      final: `Test collaborative proposal for ${title}`,
    };
  }

  // Step 1: initial draft
  const initial = await generateProposal({ title, client, details });

  // Define agent roles and instructions from SA-Agent PDF
  const agentInstructions = {
    'Account Manager':
      'As the Account Manager, review the proposal for client relationship alignment, pricing strategy, and ensure deliverables meet client expectations.',
    'Project Manager':
      'As the Project Manager, evaluate the project timeline, resource plan, milestones, and risk mitigation strategies in the proposal.',
    'Engineer':
      'As the Engineer, verify technical feasibility, solution architecture, and detail any technical requirements or considerations.',
    'Business Analyst':
      'As the Business Analyst, assess business requirements, identify potential gaps, and ensure proposal addresses stakeholder objectives and ROI.',
    'Finance':
      'As the Finance agent, validate cost estimates, budget alignment, and financial justification included in the proposal.',
    'Legal':
      'As the Legal agent, review terms and conditions, compliance requirements, and identify any legal or contractual risks.',
    'Customer':
      'As the Customer, answer clarifying questions from other agents regarding the proposal scope, budget, or requirements, and confirm any requested details.',
  };
  const reviews = {};
  let current = initial;

  // Create an assistant per role, send draft for review, collect feedback
  for (const [role, instructions] of Object.entries(agentInstructions)) {
    const assistantId = await createAssistant(role, instructions);
    const feedback = await getAssistantResponse(assistantId, current);
    reviews[role] = feedback;
    current = feedback;
  }

  return {
    initial,
    reviews,
    final: current,
  };
}

module.exports = { collaborateProposal };
