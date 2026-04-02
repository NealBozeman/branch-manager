import express from 'express';
import { spawnProject, teardown } from './scripts/handlers.js';
import yaml from 'yaml';
import { readFileSync } from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, 'projects.yaml');

const config = yaml.parse(readFileSync(CONFIG_PATH, 'utf8'));
// Attach file path to config for env file resolution
config._file = CONFIG_PATH;

const PORT = 9101;
const HOST = '0.0.0.0';

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', projects: Object.keys(config.projects) });
});

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    const event = req.headers['x-github-event'];
    const action = body.action;
    
    console.log(`Received: ${event} ${action || ''}`);
    
    const repoUrl = body.repository?.clone_url || body.repository?.git_url;
    // Extract repo name from URL (handles both git@ and https://)
    const repoMatch = repoUrl?.match(/([^/]+)\.git$/) || repoUrl?.match(/([^/]+)\/?$/);
    const repoName = repoMatch ? repoMatch[1] : null;
    
    // Skip self - branch-manager should not be managed by itself
    if (repoName === 'branch-manager') {
      console.log('Skipping self (branch-manager repo)');
      return res.json({ message: 'Skipped self' });
    }
    
    // Find matching project
    const project = Object.entries(config.projects).find(([name, cfg]) => {
      const cfgRepoName = cfg.repo.replace('.git', '').split('/').pop();
      return repoName === cfgRepoName;
    });
    
    if (!project) {
      console.log('Unknown repo:', repoName);
      return res.status(400).json({ error: 'Unknown project' });
    }
    
    const [projectName, projectConfig] = project;
    const defaultBranch = projectConfig.defaultBranch || 'main';
    
    // Handle push events
    if (event === 'push') {
      const ref = body.ref;
      const branch = ref.startsWith('refs/heads/') ? ref.replace('refs/heads/', '') : ref;
      
      if (branch === defaultBranch) {
        return res.json({ message: 'Main branch push ignored' });
      }
      
      // New branch created
      if (body.created && !body.deleted) {
        console.log(`Spawning ${projectName}/${branch}`);
        await spawnProject(projectName, branch, projectConfig);
        return res.json({ message: `Spawned ${branch}` });
      }
      
      // Branch deleted
      if (body.deleted) {
        console.log(`Tearing down ${projectName}/${branch}`);
        await teardown(projectName, branch);
        return res.json({ message: `Torn down ${branch}` });
      }
    }
    
    // Handle pull request events
    if (event === 'pull_request') {
      const pr = body.pull_request;
      const branch = pr.head.ref;
      
      if (action === 'opened' || action === 'reopened' || action === 'ready_for_review') {
        console.log(`Spawning PR ${projectName}/${branch}`);
        await spawnProject(projectName, branch, projectConfig);
        return res.json({ message: `Spawned PR ${branch}` });
      }
      
      if (action === 'closed' || action === 'merged') {
        console.log(`Tearing down PR ${projectName}/${branch}`);
        await teardown(projectName, branch);
        return res.json({ message: `Torn down PR ${branch}` });
      }
    }
    
    res.json({ message: 'Ignored' });
    
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Branch manager listening on http://${HOST}:${PORT}`);
  console.log(`Webhook URL: POST http://${HOST}:${PORT}/webhook`);
});