import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// Load schema without adding ajv as a dep — use hand-rolled validator
// that asserts the relevant schema properties exist.
const require = createRequire(import.meta.url);
const schema = require('../../schema/task.schema.json') as {
  properties: Record<string, { type?: string | string[]; enum?: string[]; maxLength?: number; minimum?: number; maximum?: number; maxItems?: number; items?: unknown }>;
};

describe('task.schema.json', () => {
  it('includes "plan" in type enum', () => {
    const typeProp = schema.properties['type'];
    expect(typeProp).toBeDefined();
    expect(typeProp?.enum).toContain('plan');
    expect(typeProp?.enum).toContain('feature');
    expect(typeProp?.enum).toContain('spec');
  });

  it('has all new optional field definitions', () => {
    expect(schema.properties['milestone']).toBeDefined();
    expect(schema.properties['milestone']?.type).toBe('string');
    expect(schema.properties['milestone']?.maxLength).toBe(100);

    expect(schema.properties['estimate_hours']).toBeDefined();
    expect(schema.properties['estimate_hours']?.type).toBe('number');
    expect(schema.properties['estimate_hours']?.minimum).toBe(0);
    expect(schema.properties['estimate_hours']?.maximum).toBe(10000);

    expect(schema.properties['plan_file']).toBeDefined();
    expect(schema.properties['plan_file']?.type).toBe('string');
    expect(schema.properties['plan_file']?.maxLength).toBe(500);

    expect(schema.properties['auto_captured']).toBeDefined();
    expect(schema.properties['auto_captured']?.type).toBe('boolean');

    expect(schema.properties['labels']).toBeDefined();
    expect(schema.properties['labels']?.type).toBe('array');
    expect(schema.properties['labels']?.maxItems).toBe(20);

    expect(schema.properties['references']).toBeDefined();
    expect(schema.properties['references']?.type).toBe('array');
    expect(schema.properties['references']?.maxItems).toBe(50);
  });

  it('still has all original required fields', () => {
    const required = ['schema_version', 'id', 'title', 'type', 'status', 'priority', 'project', 'why', 'created', 'updated', 'last_activity'];
    // We verify via property presence (required array is separate field)
    for (const field of required) {
      expect(schema.properties[field], `property ${field} should exist`).toBeDefined();
    }
  });
});
