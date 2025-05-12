const request = require('supertest');
const app = require('../index');
const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'db.json');

beforeEach(() => {
  fs.writeFileSync(dbPath, JSON.stringify({ proposals: [] }, null, 2));
});

describe('POST /proposals with default template', () => {
  it('should return a default-rendered proposal when useDefaultTemplate is true', async () => {
    const payload = { title: 'Default Title', client: 'Default Client', useDefaultTemplate: true };
    const res = await request(app).post('/proposals').send(payload);
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('content');
    // content should include the first default section
    expect(res.body.content).toContain('# Front Cover');
    expect(res.body.content).toContain('**Title**: Default Title');
  });

  it('should return template-based content when useDefaultTemplate is false or missing', async () => {
    const payload = { title: 'HBS Title', client: 'HBS Client' };
    const res = await request(app).post('/proposals').send(payload);
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('content');
    // Handlebars template has "# Proposal:" prefix
    expect(res.body.content).toContain('# Proposal: HBS Title');
  });
});
