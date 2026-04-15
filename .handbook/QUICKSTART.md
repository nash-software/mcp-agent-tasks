# Handbook Quick Reference

This project uses **handbook** — an AI institutional memory system that captures
knowledge from development sessions and makes it searchable.

## Query the handbook

Search for relevant knowledge before starting work:

```bash
handbook query <keywords>
```

Examples:

```bash
handbook query authentication error
handbook query database migration
handbook query "null check" pattern
```

Filter by node type:

```bash
handbook query --type pattern <keywords>
handbook query --type decision <keywords>
handbook query --type rule <keywords>
```

Get JSON output for scripting:

```bash
handbook query --format json <keywords>
```

## Capture a learning

Append a structured entry to the capture queue:

```bash
# Via MCP tool (in Claude Code)
handbook_capture

# Via CLI (trigger a queue drain)
handbook update
```

The `capture.js` Stop hook automatically captures session output — no manual
action is needed during normal development.

## Check status

```bash
handbook status
```

Shows node counts, queue depth, last update time, and stale nodes.

## Run a manual update

Process the capture queue and merge new nodes into the graph:

```bash
handbook update
```

## Daemon (background updates)

```bash
handbook daemon --start    # Start automatic background updates
handbook daemon --stop     # Stop the daemon
handbook daemon --status   # Check if daemon is running
```

## Diagnose & remediate

Run health checks on the knowledge graph:

```bash
handbook diagnose                # L1 + L2 checks (fast, no LLM)
handbook diagnose --deep         # + L3 LLM-powered analysis (cached per subgraph)
handbook diagnose --deep --json  # Machine-readable output
handbook diagnose --quiet        # Exit code only (0 = healthy, 1 = unhealthy)
```

Reports are saved to `.handbook/diagnose/diagnose-YYYY-MM-DD-HH-mm.log`.

Generate actionable remediation plans from findings:

```bash
handbook remediate                              # From most recent report
handbook remediate --from .handbook/diagnose/diagnose-2025-01-15-14-30.log
handbook remediate --severity critical,high     # Filter by severity
handbook remediate --dry-run                    # Preview without writing files
```

Plans are written to `scratchpads/remediation-YYYY-MM-DD/`.

## Decision management

```bash
handbook supersede <new-id> <old-id>   # Mark decision as superseding another (bidirectional)
handbook pending                        # List all pending decisions
handbook resolve <node-id> --option 1   # Resolve a pending decision
handbook confirm <node-id>              # Set confidence=high, status=confirmed
handbook archive <node-id>              # Move to archived status
```

## Directory structure

```
.handbook/
  config.json      Project configuration (optional)
  meta.json        Build metadata and node counts
  index.json       Fast-lookup index (used by hooks)
  queue.jsonl      Pending captures (auto-cleared on update)
  graph/           Knowledge nodes by type
  diagnose/        Diagnostic reports and L3 cache
  QUICKSTART.md    This file
```

## Node types

| Type | What it captures |
|------|-----------------|
| `pattern` | Recurring bugs, gotchas, anti-patterns |
| `decision` | Architecture decisions with rationale |
| `rule` | Coding rules and constraints |
| `flow` | Process and execution flows |
| `intent` | Goals and requirements |
| `component` | System components |
| `change` | Notable changes and their impact |

## Rebuild from scratch

```bash
handbook init --full
```

## More help

```bash
handbook --help
```
