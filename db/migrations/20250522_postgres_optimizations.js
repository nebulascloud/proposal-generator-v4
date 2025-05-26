/**
 * Production Database Optimizations
 * Additional indexes and optimizations for PostgreSQL
 */

exports.up = function(knex) {
  // Only run these migrations if using PostgreSQL
  if (knex.client.config.client !== 'pg') {
    return Promise.resolve();
  }
  
  return knex.schema
    // Add GIN index for message content text search (PostgreSQL specific)
    .raw('CREATE INDEX IF NOT EXISTS messages_content_search_idx ON messages USING GIN (to_tsvector(\'english\', content))')
    
    // Add index for timestamp querying
    .table('messages', table => {
      table.index('created_at');
    })
    
    // Add index for session status
    .table('sessions', table => {
      table.index(['status', 'created_at']);
    });
};

exports.down = function(knex) {
  // Only run these migrations if using PostgreSQL
  if (knex.client.config.client !== 'pg') {
    return Promise.resolve();
  }
  
  return knex.schema
    .raw('DROP INDEX IF EXISTS messages_content_search_idx')
    .table('messages', table => {
      table.dropIndex('created_at');
    })
    .table('sessions', table => {
      table.dropIndex(['status', 'created_at']);
    });
};
