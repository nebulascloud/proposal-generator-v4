const request = require('supertest');
const app = require('../index');

describe('JSON parse error handler', () => {
  it('should return 400 and descriptive error on invalid JSON payload', async () => {
    const res = await request(app)
      .post('/agents/assistants')
      .set('Content-Type', 'application/json')
      .send('{"role": invalid}');
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid JSON payload');
  });

  it('should handle deeply nested invalid JSON', async () => {
    const invalidJson = '{"title": "Test", "client": "ClientX", "details": {"info": "Oops"';
    const res = await request(app)
      .post('/agents/proposals')
      .set('Content-Type', 'application/json')
      .send(invalidJson);
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid JSON payload');
  });
});
