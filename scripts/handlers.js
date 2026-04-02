import { execSync, spawn as spawnChild } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_BASE = '/home/njb/projects';
const ENV_DIR = '/home/njb/branch-manager/envs';

const RUNNING_PORTS = new Map(); // project:branch -> port
let nextPort = 9000;

function getPort() {
  while (RUNNING_PORTS.has(nextPort) || isPortInUse(nextPort)) {
    nextPort++;
    if (nextPort > 10000) nextPort = 9000;
  }
  return nextPort++;
}

function isPortInUse(port) {
  try {
    execSync(`lsof -i :${port}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function log(project, branch, msg) {
  console.log(`[${project}/${branch}] ${msg}`);
}

export async function spawnProject(projectName, branch, config) {
  const projectDir = join(PROJECTS_BASE, projectName, 'features', branch);
  const envFile = config.env;
  
  // Clone repo if not exists
  if (!existsSync(projectDir)) {
    log(projectName, branch, `Cloning ${config.repo} branch ${branch}...`);
    execSync(`git clone -b ${branch} ${config.repo} "${projectDir}"`, {
      cwd: PROJECTS_BASE,
      stdio: 'inherit'
    });
  }
  
  // Copy env file - resolve path
  const targetEnv = join(projectDir, '.env');
  let sourceEnv = envFile;
  if (!envFile.startsWith('/') && config._file) {
    sourceEnv = join(dirname(config._file), envFile);
  }
  
  if (existsSync(sourceEnv)) {
    log(projectName, branch, `Copying env file from ${sourceEnv}...`);
    execSync(`cp "${sourceEnv}" "${targetEnv}"`);
  } else {
    log(projectName, branch, `Warning: env file not found at ${sourceEnv}`);
  }
  
  // Get port and install deps if needed
  const port = getPort();
  RUNNING_PORTS.set(`${projectName}:${branch}`, port);
  
  // Check if node_modules exists, if not install
  if (!existsSync(join(projectDir, 'node_modules'))) {
    log(projectName, branch, `Installing dependencies...`);
    execSync('npm install', { cwd: projectDir, stdio: 'inherit' });
  }
  
  // Update .env with port if it contains PORT or similar
  if (existsSync(targetEnv)) {
    const envContent = readFileSync(targetEnv, 'utf8');
    const updated = envContent.replace(/PORT\s*=\s*\d+/, `PORT=${port}`);
    if (updated !== envContent) {
      writeFileSync(targetEnv, updated);
    }
  }
  
  // Update package.json dev script to use port if needed
  // Actually, just pass PORT env to npm run dev
  
  log(projectName, branch, `Starting on port ${port}...`);
  
  const child = spawnChild('npm', ['run', 'dev'], {
    cwd: projectDir,
    env: { ...process.env, PORT: String(port) },
    detached: true,
    stdio: 'ignore'
  });
  
  child.unref();
  
  // Wait a moment for server to start
  await new Promise(r => setTimeout(r, 2000));
  
  log(projectName, branch, `Running at http://${port}.nealbozeman.com`);
  
  return { port, url: `http://${port}.nealbozeman.com` };
}

export async function teardown(projectName, branch) {
  const key = `${projectName}:${branch}`;
  const port = RUNNING_PORTS.get(key);
  
  if (port) {
    log(projectName, branch, `Stopping port ${port}...`);
    try {
      execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: 'ignore' });
    } catch {}
    RUNNING_PORTS.delete(key);
  }
  
  const projectDir = join(PROJECTS_BASE, projectName, 'features', branch);
  if (existsSync(projectDir)) {
    log(projectName, branch, `Removing files...`);
    rmSync(projectDir, { recursive: true, force: true });
  }
  
  log(projectName, branch, `Teardown complete`);
}