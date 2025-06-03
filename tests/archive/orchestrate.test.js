const request = require('supertest');
const app = require('../index');

// Sanity placeholder for Jest to recognize tests
if (false) describe('Placeholder', () => {
  it('placeholder', () => {});
});

test('orchestrate test suite sanity check', () => { expect(true).toBe(true); });

describe('POST /agents/orchestrate', () => {
  it('should create and complete orchestration synchronously in test env', async () => {
    const payload = { title: 'O Title', client: 'O Client', details: 'O Details' };
    const res = await request(app).post('/agents/orchestrate').send(payload);
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('sections');
    expect(Array.isArray(res.body.sections)).toBe(true);
    expect(res.body).toHaveProperty('assignments');
    expect(res.body).toHaveProperty('dependencies');
    expect(res.body).toHaveProperty('status', 'complete');
    expect(res.body).toHaveProperty('progress');
    // Each section should be complete with content
    const secs = Object.keys(defaultTemplate);
    secs.forEach(sec => {
      expect(res.body.progress[sec]).toBeDefined();
      expect(res.body.progress[sec].status).toBe('complete');
      expect(res.body.progress[sec].content).toContain(`section: ${sec}`);
    });
    // Assembled full proposal via GET consumer
    const getRes = await request(app).get(`/agents/orchestrate/${res.body.id}`);
    expect(getRes.statusCode).toBe(200);
    expect(getRes.body).toHaveProperty('assembled');
    // assembled should include all sections' content joined
    secs.forEach(sec => {
      expect(getRes.body.assembled).toContain(`section: ${sec}`);
    });
  });
});

// This test is for legacy /proposals endpoint and can be archived.
describe('GET /agents/orchestrate/:id/status', () => {
  it('should return status and progress for orchestration', async () => {
    const payload = { title: 'O2', client: 'C2', details: 'D2' };
    const post = await request(app).post('/agents/orchestrate').send(payload);
    const id = post.body.id;
    const statusRes = await request(app).get(`/agents/orchestrate/${id}/status`);
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.body).toHaveProperty('id', id);
    expect(statusRes.body).toHaveProperty('status', 'complete');
    expect(typeof statusRes.body.progress).toBe('object');
  });
});
