export type StorageMode = 'global' | 'local';
export type EnforcementMode = 'warn' | 'block' | 'off';

export interface ProjectConfig {
  prefix: string;
  path: string;
  storage: StorageMode;
}

export interface GlobalConfig {
  version: number;
  storageDir: string;
  defaultStorage: StorageMode;
  enforcement: EnforcementMode;
  autoCommit: boolean;
  claimTtlHours: number;
  trackManifest: boolean; // default: true (index.yaml git-tracked)
  tasksDirName: string;   // per-project subdirectory name (default: 'agent-tasks')
  projects: ProjectConfig[];
}

export interface PerProjectConfig {
  prefix: string;
  storage?: StorageMode;
  tasksDir?: string;
  enforcement?: EnforcementMode;
  autoCommit?: boolean;
  trackManifest?: boolean;
  templates?: Record<string, string>;
}
