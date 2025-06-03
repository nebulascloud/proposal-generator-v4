-- Backup the current agents table to a new table with a timestamp generated from the current date/time
DO $$
DECLARE
    backup_table_name text;
BEGIN
    backup_table_name := 'agents_backup_' || to_char(NOW(), 'YYYYMMDD_HH24MISS');
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I AS TABLE agents', backup_table_name);
    RAISE NOTICE 'Agents table backed up to %', backup_table_name;
END $$;

-- To restore, you can copy data back from the backup table if needed.

-- After backup, you may TRUNCATE the agents table to prepare for repopulation.
-- Example:
-- TRUNCATE TABLE agents RESTART IDENTITY;

-- This script will automatically generate a backup table with the current timestamp.
