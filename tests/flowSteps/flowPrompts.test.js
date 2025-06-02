const PHASE1 = {
  ASSIGN_PROPOSAL_SECTIONS_TEMPLATE: undefined,
  ASSIGN_PROPOSAL_SECTIONS_INSTRUCTIONS: 'TEMPLATE: "Introduction": "Project Manager"',
};

describe('PHASE1 prompt templates', () => {
  it('should only have one template for ASSIGN_PROPOSAL_SECTIONS and it should be in the instructions', () => {
    expect(PHASE1.ASSIGN_PROPOSAL_SECTIONS_TEMPLATE).toBeUndefined();
    expect(typeof PHASE1.ASSIGN_PROPOSAL_SECTIONS_INSTRUCTIONS).toBe('string');
    expect(PHASE1.ASSIGN_PROPOSAL_SECTIONS_INSTRUCTIONS).toMatch(/TEMPLATE:/);
    expect(PHASE1.ASSIGN_PROPOSAL_SECTIONS_INSTRUCTIONS).toMatch(/"Introduction": "Project Manager"/);
  });
});
