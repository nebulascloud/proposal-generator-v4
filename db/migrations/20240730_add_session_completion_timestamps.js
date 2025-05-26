/**
 * Adds completed_at and failed_at timestamps to the sessions table.
 */

exports.up = function(knex) {
  return knex.schema.table('sessions', table => {
    table.timestamp('completed_at').nullable();
    table.timestamp('failed_at').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.table('sessions', table => {
    table.dropColumn('completed_at');
    table.dropColumn('failed_at');
  });
};
