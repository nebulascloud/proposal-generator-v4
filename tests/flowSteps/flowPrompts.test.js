const { PHASE1 } = require('../../agents/flowSteps/flowPrompts');

describe('PHASE1 prompt templates', () => {
  it('should only have one template for ASSIGN_PROPOSAL_SECTIONS and it should be in the instructions', () => {
    expect(PHASE1.ASSIGN_PROPOSAL_SECTIONS_TEMPLATE).toBeUndefined();
    expect(PHASE1.ASSIGN_PROPOSAL_SECTIONS_INSTRUCTIONS).toMatch(/TEMPLATE:/);
    expect(PHASE1.ASSIGN_PROPOSAL_SECTIONS_INSTRUCTIONS).toMatch(/"Introduction": "Project Manager"/);
  });

  it('should provide a valid ORGANIZED_QUESTIONS_TEMPLATE', () => {
    expect(typeof PHASE1.ORGANIZED_QUESTIONS_TEMPLATE).toBe('object');
    expect(PHASE1.ORGANIZED_QUESTIONS_TEMPLATE).toHaveProperty('Financials');
    expect(Array.isArray(PHASE1.ORGANIZED_QUESTIONS_TEMPLATE.Financials)).toBe(true);
  });
});
