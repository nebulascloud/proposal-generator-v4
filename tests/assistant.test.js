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
});
