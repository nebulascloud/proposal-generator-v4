/**
 * Docker Configuration Tests
 * Tests for Docker-related files and configuration
 */

const fs = require('fs');
const path = require('path');

describe('Docker Configuration', () => {
  const rootDir = path.join(__dirname, '..');
  
  test('Dockerfile exists and contains required configuration', () => {
    const dockerfilePath = path.join(rootDir, 'Dockerfile');
    expect(fs.existsSync(dockerfilePath)).toBe(true);
    
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
    
    // Check for Node.js base image
    expect(dockerfile).toMatch(/FROM node:18-alpine/);
    
    // Check for PostgreSQL client installation
    expect(dockerfile).toMatch(/postgresql-client/);
    
    // Check for start script usage
    expect(dockerfile).toMatch(/CMD \["\.\/start\.sh"\]/);
  });

  test('docker-compose.yml exists and contains required services', () => {
    const dockerComposePath = path.join(rootDir, 'docker-compose.yml');
    expect(fs.existsSync(dockerComposePath)).toBe(true);
    
    const dockerCompose = fs.readFileSync(dockerComposePath, 'utf8');
    
    // Check for app service
    expect(dockerCompose).toMatch(/services:\s+app:/);
    
    // Check for postgres service
    expect(dockerCompose).toMatch(/postgres:/);
    
    // Check for volume configuration
    expect(dockerCompose).toMatch(/volumes:\s+postgres_data:/);
    
    // Check for environment variables
    expect(dockerCompose).toMatch(/DB_HOST=postgres/);
    expect(dockerCompose).toMatch(/DB_PORT=5432/);
    
    // Check for dependency configuration
    expect(dockerCompose).toMatch(/depends_on:\s+- postgres/);
  });

  test('start.sh exists and contains database connection waiting logic', () => {
    const startScriptPath = path.join(rootDir, 'start.sh');
    expect(fs.existsSync(startScriptPath)).toBe(true);
    
    const startScript = fs.readFileSync(startScriptPath, 'utf8');
    
    // Check for waiting for PostgreSQL
    expect(startScript).toMatch(/Waiting for PostgreSQL/);
    
    // Check for pg_isready command
    expect(startScript).toMatch(/pg_isready -h \$DB_HOST/);
    
    // Check for migration execution
    expect(startScript).toMatch(/Running database migrations/);
    expect(startScript).toMatch(/node scripts\/db-migration.js/);
  });

  test('package.json contains Docker-related scripts', () => {
    const packageJsonPath = path.join(rootDir, 'package.json');
    expect(fs.existsSync(packageJsonPath)).toBe(true);
    
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    // Check for Docker scripts
    expect(packageJson.scripts).toBeDefined();
    expect(packageJson.scripts['docker:up']).toBe('docker-compose up -d');
    expect(packageJson.scripts['docker:down']).toBe('docker-compose down');
    
    // Check for database scripts
    expect(packageJson.scripts['db:migrate']).toBeDefined();
    
    // Check for PostgreSQL dependency
    expect(packageJson.dependencies).toBeDefined();
    expect(packageJson.dependencies.pg).toBeDefined();
  });
});
