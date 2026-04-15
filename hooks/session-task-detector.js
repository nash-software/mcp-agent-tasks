#!/usr/bin/env node
// @version 2.0.0
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── get git branch + infer task ID ───────────────────────────────────────────
let branch = null;
try {
  branch = execSync('git branch --show-current', {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim() || null;
} catch {
  branch = null;
}

let taskIdFromBranch = null;
if (branch) {
  const m = /([A-Z]+-\d+)/.exec(branch);
  if (m) taskIdFromBranch = m[1];
}

// ── locate .mcp-tasks.json ────────────────────────────────────────────────────
function findMcpTasksConfig() {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, '.mcp-tasks.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const configPath = findMcpTasksConfig();
if (!configPath) {
  process.exit(0);
}

// ── if we have a branch task ID, try to find it in index.yaml ────────────────
function findIndexYaml(configPath) {
  const configDir = path.dirname(configPath);
  let mcpConfig = {};
  try {
    mcpConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }

  const projects = Array.isArray(mcpConfig.projects) ? mcpConfig.projects : [];
  for (const proj of projects) {
    if (proj.path) {
      const candidate = path.join(proj.path, 'agent-tasks', 'index.yaml');
      if (fs.existsSync(candidate)) return candidate;
      const candidate2 = path.join(proj.path, 'tasks', 'index.yaml');
      if (fs.existsSync(candidate2)) return candidate2;
    }
  }

  // Fallback: look adjacent to config
  const candidate = path.join(configDir, 'agent-tasks', 'index.yaml');
  if (fs.existsSync(candidate)) return candidate;
  const candidate2 = path.join(configDir, 'tasks', 'index.yaml');
  if (fs.existsSync(candidate2)) return candidate2;

  return null;
}

function findTaskInIndex(indexYamlPath, taskId) {
  let content;
  try {
    content = fs.readFileSync(indexYamlPath, 'utf-8');
  } catch {
    return null;
  }

  const lines = content.split('\n');
  let currentId = null;
  let currentTitle = null;
  let currentStatus = null;

  for (const line of lines) {
    const idMatch = /^\s*[-\s]*id:\s*([A-Z]+-\d+)/i.exec(line);
    if (idMatch) {
      // Flush previous if it matches
      if (currentId === taskId && currentStatus) {
        return { id: currentId, title: currentTitle, status: currentStatus };
      }
      currentId = idMatch[1];
      currentTitle = null;
      currentStatus = null;
    }

    const titleMatch = /^\s*title:\s*(.+)/.exec(line);
    if (titleMatch && currentId === taskId) {
      currentTitle = titleMatch[1].trim().replace(/^["']|["']$/g, '');
    }

    const statusMatch = /^\s*status:\s*(\S+)/.exec(line);
    if (statusMatch && currentId === taskId) {
      currentStatus = statusMatch[1];
    }
  }

  // Check last block
  if (currentId === taskId && currentStatus) {
    return { id: currentId, title: currentTitle, status: currentStatus };
  }

  return null;
}

if (taskIdFromBranch) {
  const indexYaml = findIndexYaml(configPath);
  if (indexYaml) {
    const found = findTaskInIndex(indexYaml, taskIdFromBranch);
    if (found && found.status === 'in_progress') {
      const title = found.title || '(untitled)';
      process.stdout.write(`[task-context] Active task: ${found.id} — "${title}" (in_progress)\n`);
      process.exit(0);
    }
  }
  // Fall through to session check
}

// ── check session file ────────────────────────────────────────────────────────
const configDir = path.dirname(configPath);
const sessionFile = path.join(configDir, '.mcp-tasks-session.json');

let sessionState = null;
try {
  sessionState = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
} catch {
  sessionState = null;
}

if (sessionState && sessionState.active_task) {
  const taskId = sessionState.active_task;
  const indexYaml = findIndexYaml(configPath);
  let title = '(untitled)';
  if (indexYaml) {
    const found = findTaskInIndex(indexYaml, taskId);
    if (found) title = found.title || title;
  }
  process.stdout.write(`[task-context] Active task: ${taskId} — "${title}" (session)\n`);
  process.exit(0);
}

// Silent exit — no active task
process.exit(0);
