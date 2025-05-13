const request = require('supertest');
const app = require('../index');
const { customerBrief } = require('./fixtures/customerBrief');
const { defaultTemplate } = require('../templates/defaultTemplate');

test('flow test file loaded', () => {
  expect(true).toBe(true);
});

describe('POST /agents/flow', () => {
  test('full stubbed flow in test env', async () => {
    const res = await request(app)
      .post('/agents/flow')
      .send({ brief: customerBrief });
    expect(res.statusCode).toBe(200);
    // Analysis step
    expect(res.body).toHaveProperty('analysis');
    expect(res.body.analysis).toContain(customerBrief.client_name);

    // Sections and assignments
    const sections = Object.keys(defaultTemplate);
    expect(res.body.sections).toEqual(sections);
    sections.forEach(section => {
      expect(res.body.assignments[section]).toBe('Account Manager');
    });

    // Questions and answers
    expect(Array.isArray(res.body.questions)).toBe(true);
    expect(res.body.questions).toHaveLength(sections.length);
    expect(Array.isArray(res.body.answers)).toBe(true);
    expect(res.body.answers.every(ans => ans.startsWith('Mock answer to'))).toBe(true);

    // Development drafts and reviews
    sections.forEach(section => {
      expect(res.body.development[section]).toContain(`Draft for ${section}`);
      expect(res.body.reviews[section]).toBe(`Review comment for ${section}`);
    });

    // Approval and compilation
    expect(res.body.approval).toBe('Final approval granted');
    const expectedAssembled = sections.map(sec => res.body.development[sec]).join('\n\n');
    expect(res.body.assembled).toBe(expectedAssembled);
  });

  test('returns 400 when missing brief', async () => {
    const res = await request(app)
      .post('/agents/flow')
      .send({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
