/**
 * Database Setup Module
 * Runs migrations and initializes the database
 */

const db = require('./index');

// Silence console logging in test environment to avoid noisy logs after Jest teardown
if (process.env.NODE_ENV === 'test') {
  // Keep error logging for debugging database initialization issues
  // eslint-disable-next-line no-global-assign
  console.log = function(msg) {
    if (msg && msg.includes('Database')) {
      // Keep database-related logs
      process.stderr.write(msg + '\n');
    }
  };
  // eslint-disable-next-line no-global-assign
  console.warn = function(msg) {
    if (msg && msg.includes('Database')) {
      // Keep database-related warnings
      process.stderr.write(msg + '\n');
    }
  };
  // eslint-disable-next-line no-global-assign
  console.error = function(msg) {
    // Always show errors
    process.stderr.write(msg + '\n');
  };
}

/**
 * Wait for database to be available
 * Useful for Docker environments where the database might not be ready immediately
 */
async function waitForDatabase(maxAttempts = 10, delay = 5000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[Database] Connection attempt ${attempt}/${maxAttempts}...`);
      await db.raw('SELECT 1');
      console.log('[Database] Connection successful!');
      return true;
    } catch (error) {
      console.log(`[Database] Connection failed: ${error.message}`);
      if (attempt === maxAttempts) {
        console.error('[Database] Max connection attempts reached');
        throw error;
      }
      // Wait before trying again
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Initialize the database
 * Runs migrations to create tables
 */
async function initDatabase() {
  try {
    // If in production, wait for database to be available (for Docker environment)
    if (process.env.NODE_ENV === 'production') {
      await waitForDatabase();
    }
    
    console.log('[Database] Running migrations...');
    
    // Check if migrations table exists
    const migrationsTableExists = await db.schema.hasTable('knex_migrations');
    
    if (!migrationsTableExists) {
      console.log('[Database] First-time setup, creating migrations tables...');
    }
    
    // Run migrations
    await db.migrate.latest();
    
    const version = await db.migrate.currentVersion();
    console.log(`[Database] Migration complete. Current version: ${version}`);
    
    return true;
  } catch (error) {
    console.error('[Database] Migration failed:', error);
    // In test environment, we don't want to fail the test due to db issues
    if (process.env.NODE_ENV === 'test') {
      console.warn('[Database] Test environment: continuing despite error');
      return false;
    }
    throw error;
  }
}

/**
 * Reset the database (for testing only)
 */
async function resetDatabase() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Cannot reset database outside of test environment');
  }
  
  try {
    console.log('[Database] Resetting database...');
    
    // Check if tables exist
    const hasSessionsTable = await db.schema.hasTable('sessions');
    
    // If tables exist, roll back all migrations
    if (hasSessionsTable) {
      await db.migrate.rollback(undefined, true);
    }
    
    // Run all migrations from scratch
    await db.migrate.latest();
    
    console.log('[Database] Database reset complete');
    return true;
  } catch (error) {
    console.error('[Database] Database reset failed:', error);
    throw error;
  }
}

module.exports = {
  initDatabase,
  resetDatabase
};
