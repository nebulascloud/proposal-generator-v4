/**
 * Database Setup Tests
 * Tests for database setup and migration functions
 */

process.env.NODE_ENV = 'test';
const db = require('../db/index');
const { initDatabase } = require('../db/setup');

// Mock modules
jest.mock('../db/index', () => ({
  schema: {
    hasTable: jest.fn().mockResolvedValue(true)
  },
  migrate: {
    latest: jest.fn().mockResolvedValue([2, 2]),
    currentVersion: jest.fn().mockResolvedValue('20250522_postgres_optimizations')
  },
  raw: jest.fn().mockResolvedValue('connected')
}));

describe('Database Setup', () => {
  // Reset mocks between tests
  beforeEach(() => {
    jest.resetAllMocks();
    // Ensure we're in test mode
    process.env.NODE_ENV = 'test';
  });

  test('initDatabase runs migrations successfully', async () => {
    // Mock successful database operations
    db.schema.hasTable.mockResolvedValue(true);
    db.migrate.latest.mockResolvedValue([2, 2]);
    db.migrate.currentVersion.mockResolvedValue('20250522_postgres_optimizations');
    
    const result = await initDatabase();
    
    // Check that migrations were attempted
    expect(db.migrate.latest).toHaveBeenCalled();
    expect(db.migrate.currentVersion).toHaveBeenCalled();
  });

  test('initDatabase handles first-time setup', async () => {
    // Mock first-time setup (migrations table doesn't exist)
    db.schema.hasTable.mockResolvedValue(false);
    db.migrate.latest.mockResolvedValue([2, 2]);
    db.migrate.currentVersion.mockResolvedValue('20250522_postgres_optimizations');
    
    const result = await initDatabase();
    
    // Check that migrations were attempted
    expect(db.schema.hasTable).toHaveBeenCalledWith('knex_migrations');
    expect(db.migrate.latest).toHaveBeenCalled();
  });

  test('initDatabase handles migration errors in test environment', async () => {
    // Mock migration failure
    db.schema.hasTable.mockResolvedValue(true);
    db.migrate.latest.mockRejectedValue(new Error('Migration failed'));
    
    // In test mode, this should not throw an error
    const result = await initDatabase();
    expect(result).toBe(false);
  });
});
