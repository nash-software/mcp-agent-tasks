import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Milestone CRUD in UI', () => {
  it('api.ts exports createMilestone function', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'ui', 'src', 'api.ts'),
      'utf-8',
    );
    expect(source).toContain('createMilestone');
  });

  it('RoadmapView has a New Milestone button and form', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'ui', 'src', 'views', 'RoadmapView.tsx'),
      'utf-8',
    );
    expect(source).toContain('New Milestone');
    expect(source).toContain('useMutation');
  });

  it('RoadmapView has a create milestone form', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'ui', 'src', 'views', 'RoadmapView.tsx'),
      'utf-8',
    );
    expect(source).toContain('createMilestone');
  });

  it('createMilestone posts to /api/milestones', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'ui', 'src', 'api.ts'),
      'utf-8',
    );
    expect(source).toContain("'/api/milestones'");
    expect(source).toContain("'POST'");
  });
});
