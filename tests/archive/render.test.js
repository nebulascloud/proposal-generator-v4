const request = require('supertest');
const app = require('../index');

// This test is for legacy /proposals endpoint and can be archived.

describe('GET /proposals/:id/html', () => {
  it('should return HTML for proposal', async () => {
    const payload = { title: 'HTML Title', client: 'HTML Client' };
    const postRes = await request(app).post('/proposals').send(payload);
    const id = postRes.body.id;
    const res = await request(app).get(`/proposals/${id}/html`);
    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('<h1>');
  });
});

describe('GET /proposals/:id/pdf', () => {
  it('should return PDF for proposal', async () => {
    const payload = { title: 'PDF Title', client: 'PDF Client' };
    const postRes = await request(app).post('/proposals').send(payload);
    const id = postRes.body.id;
    const res = await request(app).get(`/proposals/${id}/pdf`);
    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
    // In test environment, PDF generation is stubbed
    expect(res.body.toString()).toBe('Test PDF');
  });
});

describe('Render endpoints basic', () => {
  it('dummy test to ensure suite runs', () => {
    expect(true).toBe(true);
  });
});
