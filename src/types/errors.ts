export type ErrorCode =
  | 'TASK_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'CLAIM_CONFLICT'
  | 'CIRCULAR_DEPENDENCY'
  | 'MAX_DEPTH_EXCEEDED'
  | 'INVALID_FIELD'
  | 'SCHEMA_MISMATCH'
  | 'TASK_FILE_EXISTS';

export class McpTasksError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McpTasksError';
  }
}
