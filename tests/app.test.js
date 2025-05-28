const request = require('supertest');
const fs = require('fs');
const path = require('path');

// Mock database modules
jest.mock('../db/index', () => ({
  destroy: jest.fn().mockResolvedValue(true),
  schema: {
    hasTable: jest.fn().mockResolvedValue(true)
  },
  migrate: {
    latest: jest.fn().mockResolvedValue([]),
    rollback: jest.fn().mockResolvedValue([]),
    currentVersion: jest.fn().mockResolvedValue('test_version')
  },
  raw: jest.fn().mockResolvedValue([])
}));

// Mock database models to avoid actual database operations
jest.mock('../db/models/session', () => ({
  create: jest.fn().mockImplementation(async (data) => ({ 
    id: 'mock-session-id', 
    ...data, 
    created_at: new Date().toISOString() 
  })),
  update: jest.fn().mockImplementation(async (data) => ({ 
    ...data, 
    updated_at: new Date().toISOString() 
  })),
  getByProposalId: jest.fn().mockResolvedValue({
    id: 'mock-session-id',
    proposal_id: 'test-proposal-id',
    status: 'active'
  }),
  getById: jest.fn().mockResolvedValue({
    id: 'mock-session-id',
    proposal_id: 'test-proposal-id',
    status: 'active'
  })
}));

// Mock other database operations
jest.mock('../db/setup', () => ({
  initDatabase: jest.fn().mockResolvedValue(true),
  resetDatabase: jest.fn().mockResolvedValue(true)
}));

// Ensure test environment before requiring app
process.env.NODE_ENV = 'test';
const { resetDatabase, initDatabase } = require('../db/setup');
const app = require('../index');
const dbPath = path.join(__dirname, '..', 'data', 'db.json');

beforeAll(async () => {
  // No need to actually reset the database as it's mocked
  console.log('[Test Setup] Using mocked database');
})

beforeEach(async () => {
  // Reset file-based mock DB
  fs.writeFileSync(dbPath, JSON.stringify({ proposals: [] }, null, 2));
});

afterAll(async () => {
  // Attempt to close DB connections if possible
  if (global.db && global.db.destroy) {
    await global.db.destroy();
  }
  // No need to close db connection as it's mocked
});

describe('GET /', () => {
  it('should return Hello, world!', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.text).toBe('Hello, world!');
  });
});

describe('GET /health', () => {
  it('should return status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('POST /proposals', () => {
  it('should return a stub proposal draft', async () => {
    const payload = { title: 'Test Title', client: 'Test Client' };
    const res = await request(app).post('/proposals').send(payload);
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('title', payload.title);
    expect(res.body).toHaveProperty('client', payload.client);
    expect(res.body).toHaveProperty('content');
  });
});

describe('POST /proposals validation', () => {
  it('should return 400 if title is missing', async () => {
    const res = await request(app).post('/proposals').send({ client: 'Client Only' });
    expect(res.statusCode).toEqual(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should return 400 if client is missing', async () => {
    const res = await request(app).post('/proposals').send({ title: 'Title Only' });
    expect(res.statusCode).toEqual(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /proposals', () => {
  it('should return empty array initially', async () => {
    const res = await request(app).get('/proposals');
    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual([]);
  });

  it('should return array with saved proposal after POST', async () => {
    const payload = { title: 'Saved', client: 'Client A' };
    await request(app).post('/proposals').send(payload);
    const res = await request(app).get('/proposals');
    expect(res.statusCode).toEqual(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0]).toHaveProperty('id', 1);
    expect(res.body[0]).toHaveProperty('title', payload.title);
    expect(res.body[0]).toHaveProperty('client', payload.client);
  });
});

describe('POST /agents/proposals', () => {
  it('should return a stub agent proposal draft', async () => {
    const payload = { title: 'Agent Title', client: 'Agent Client', details: 'Some details' };
    const res = await request(app).post('/agents/proposals').send(payload);
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('title', payload.title);
    expect(res.body).toHaveProperty('client', payload.client);
    expect(res.body).toHaveProperty('details', payload.details);
    expect(res.body).toHaveProperty('content');
    expect(typeof res.body.content).toBe('string');
    expect(res.body.content).toContain('Test proposal draft');
    expect(res.body).toHaveProperty('createdAt');
  });

  it('should return 400 if details is missing', async () => {
    const res = await request(app).post('/agents/proposals').send({ title: 'T', client: 'C' });
    expect(res.statusCode).toEqual(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /api-docs', () => {
  it('should serve Swagger UI documentation', async () => {
    const res = await request(app).get('/api-docs/');
    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toMatch(/html/);
    // Swagger UI serves its own HTML title
    expect(res.text).toContain('<title>Swagger UI</title>');
  });
});
