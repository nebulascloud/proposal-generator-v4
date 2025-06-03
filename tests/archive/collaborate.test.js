const request = require('supertest');
const app = require('../index');

describe('POST /agents/collaborate', () => {
  it('should return stub collaborative proposal in test env', async () => {
    const payload = { title: 'Col Title', client: 'Col Client', details: 'Some details' };
    const res = await request(app).post('/agents/collaborate').send(payload);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('initial');
    expect(res.body).toHaveProperty('reviews');
    expect(res.body.reviews).toEqual({});
    expect(res.body).toHaveProperty('final', `Test collaborative proposal for ${payload.title}`);
  });

  it('should return 400 if missing fields', async () => {
    const res = await request(app).post('/agents/collaborate').send({ title: 'T', client: 'C' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// This test is for legacy /proposals endpoint and can be archived.
