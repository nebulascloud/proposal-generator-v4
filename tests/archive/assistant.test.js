// filepath: tests/assistant.test.js
const request = require('supertest');
const app = require('../index');

describe('Assistant endpoints', () => {
  it('POST /agents/assistants should return a test assistant id', async () => {
    const res = await request(app)
      .post('/agents/assistants')
      .send({ role: 'RoleX', instructions: 'Do something' });
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('assistantId', 'test-assistant');
  });

  it('should validate request body for assistant creation', async () => {
    const res = await request(app).post('/agents/assistants').send({ role: 'RoleOnly' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should validate request body when missing role', async () => {
    const res = await request(app)
      .post('/agents/assistants')
      .send({ instructions: 'Do something' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should reject non-string role and instructions types', async () => {
    const res = await request(app)
      .post('/agents/assistants')
      .send({ role: 123, instructions: { text: 'Invalid' } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /agents/assistants/:id/messages should return test reply', async () => {
    const assistantId = 'test-assistant';
    const res = await request(app)
      .post(`/agents/assistants/${assistantId}/messages`)
      .send({ message: 'Hello' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('reply');
    expect(res.body.reply).toBe(`Test assistant response for ${assistantId}`);
  });

  it('should validate request body for assistant messaging', async () => {
    const res = await request(app).post('/agents/assistants/test/messages').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  // This test is for legacy /proposals endpoint and can be archived.
  it('POST /proposals should return a test proposal id', async () => {
    const res = await request(app)
      .post('/proposals')
      .send({ title: 'ProposalX', content: 'Some content' });
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('proposalId', 'test-proposal');
  });

  it('should validate request body for proposal creation', async () => {
    const res = await request(app).post('/proposals').send({ title: 'TitleOnly' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should validate request body when missing title', async () => {
    const res = await request(app)
      .post('/proposals')
      .send({ content: 'Some content' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should reject non-string title and content types', async () => {
    const res = await request(app)
      .post('/proposals')
      .send({ title: 123, content: { text: 'Invalid' } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /proposals/:id/comments should return test comment', async () => {
    const proposalId = 'test-proposal';
    const res = await request(app)
      .post(`/proposals/${proposalId}/comments`)
      .send({ comment: 'Nice proposal' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('comment');
    expect(res.body.comment).toBe(`Test comment for ${proposalId}`);
  });

  it('should validate request body for proposal commenting', async () => {
    const res = await request(app).post('/proposals/test/comments').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
