/**
 * PostgreSQL Configuration Tests
 * Tests for PostgreSQL-specific configuration in the knexfile
 */

const path = require('path');
const knexConfig = require('../db/knexfile');

describe('PostgreSQL Configuration', () => {
  // Store original environment
  const originalEnv = process.env;
  
  beforeEach(() => {
    // Reset environment variables before each test
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_DATABASE;
  });

  afterAll(() => {
    // Restore environment after tests
    process.env = originalEnv;
  });

  test('Development environment uses SQLite', () => {
    const config = knexConfig.development;
    
    expect(config.client).toBe('sqlite3');
    expect(config.connection.filename).toContain('messages.sqlite');
    expect(config.useNullAsDefault).toBe(true);
  });

  test('Production environment uses PostgreSQL with default values', () => {
    const config = knexConfig.production;
    
    expect(config.client).toBe('pg');
    expect(config.connection.host).toBe('postgres');
    expect(config.connection.port).toBe(5432);
    expect(config.connection.user).toBe('pguser');
    expect(config.connection.password).toBe('pgpassword');
    expect(config.connection.database).toBe('proposal_generator');
  });

  test('Production environment uses environment variables when provided', () => {
    // Set custom environment variables
    process.env.DB_HOST = 'custom-db-host';
    process.env.DB_PORT = 5433;
    process.env.DB_USER = 'custom-user';
    process.env.DB_PASSWORD = 'custom-password';
    process.env.DB_DATABASE = 'custom-database';
    
    // Re-import the knexfile with the new environment variables
    jest.resetModules();
    const knexConfig = require('../db/knexfile');
    const config = knexConfig.production;
    
    expect(config.client).toBe('pg');
    expect(config.connection.host).toBe('custom-db-host');
    expect(config.connection.port).toBe(5433);
    expect(config.connection.user).toBe('custom-user');
    expect(config.connection.password).toBe('custom-password');
    expect(config.connection.database).toBe('custom-database');
  });

  test('Both environments have migrations and seeds paths', () => {
    const devConfig = knexConfig.development;
    const prodConfig = knexConfig.production;
    
    // Check migrations directory
    expect(devConfig.migrations.directory).toBeDefined();
    expect(prodConfig.migrations.directory).toBeDefined();
    expect(devConfig.migrations.directory).toBe(prodConfig.migrations.directory);
    
    // Check seeds directory
    expect(devConfig.seeds.directory).toBeDefined();
    expect(prodConfig.seeds.directory).toBeDefined();
    expect(devConfig.seeds.directory).toBe(prodConfig.seeds.directory);
  });

  test('Production environment has correct connection pool settings', () => {
    const config = knexConfig.production;
    
    expect(config.pool).toBeDefined();
    expect(config.pool.min).toBe(2);
    expect(config.pool.max).toBe(10);
  });
});
