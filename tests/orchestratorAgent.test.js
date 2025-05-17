const { assignSections, determineDependencies } = require('../agents/orchestratorAgent');
const { initializeThread } = require('../agents/assistantAgent');
const { defaultTemplate } = require('../templates/defaultTemplate');

describe('orchestratorAgent (stubbed)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  test('assignSections returns mapping of each section to sp_Account_Manager', async () => {
    const sections = Object.keys(defaultTemplate);
    const result = await assignSections({ sections, title: 'Title', client: 'Client', details: 'Details' });
    expect(typeof result).toBe('object');
    sections.forEach(sec => {
      expect(result).toHaveProperty(sec, 'sp_Account_Manager');
    });
  });
  
  test('assignSections works with an existing thread', async () => {
    const sections = Object.keys(defaultTemplate);
    const brief = { title: 'Title', client_name: 'Client', project_description: 'Details' };
    const thread = await initializeThread(brief);
    
    const result = await assignSections({ 
      sections, 
      title: 'Title', 
      client: 'Client', 
      details: 'Details',
      threadId: thread.id
    });
    
    expect(typeof result).toBe('object');
    sections.forEach(sec => {
      expect(result).toHaveProperty(sec, 'sp_Account_Manager');
    });
  });

  test('determineDependencies returns empty object', async () => {
    const sections = Object.keys(defaultTemplate);
    const result = await determineDependencies({ sections, title: 'T', client: 'C', details: 'D' });
    expect(result).toEqual({});
  });
});
