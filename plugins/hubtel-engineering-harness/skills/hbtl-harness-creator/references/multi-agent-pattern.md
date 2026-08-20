# Multi-Agent Coordination Pattern

## Problem

Single agents hit limits:
- **Context limits** — Can't hold full research + implementation in one session
- **Specialization** — Need separate researchers, implementers, reviewers
- **Parallelism** — Want to explore multiple approaches simultaneously

But multi-agent systems introduce chaos:
- Workers duplicate each other's research
- Coordinators delegate understanding instead of synthesizing
- Context inheritance explodes exponentially

## Golden Rules

### The Coordinator Must Synthesize, Not Delegate Understanding

**Anti-pattern:**
> "Based on your findings, fix the authentication system."

**Pattern:**
> "Research identified 3 auth flows: login, logout, token refresh. Implement ONLY the token refresh handler using the JWT strategy documented in [research output]. Return: implementation diff + test results."

The coordinator (orchestrator) adds value by digesting worker results into precise specs before dispatching implementation.

### Three Delegation Patterns

| Pattern | Context Sharing | Best For | Constraints |
|---------|----------------|----------|-------------|
| **Coordinator** | None — workers start fresh | Complex multi-phase tasks (research → synthesize → implement → verify) | Slowest but safest |
| **Resumable Coordinator** | None initially; preserved across rounds via resume | Multi-round planning with iterative clarification — avoids re-doing work each round | Requires agent ID tracking; subagent must be designed to return early and resume |
| **Fork** | Full — child inherits parent history | Quick parallel splits sharing loaded context | **Single-level only** — recursive forks multiply context cost |
| **Swarm** | Peer-to-peer via shared task list | Long-running independent workstreams | **Flat roster** — teammates can't spawn other teammates |

### Results Arrive Asynchronously; Fire-and-Forget Registration Returns ID Immediately

```typescript
// Example: Spawn worker, get ID back immediately
const taskId = await coordinator.spawn({
  type: 'research',
  prompt: 'Analyze auth flows...',
  toolFilter: ['read', 'search'], // Restrict tools
});

// Parent can continue working while worker runs
// Results arrive via callback or polling
```

## When To Use

- Task too large for single agent session
- Need parallel exploration (e.g., prototype multiple approaches)
- Want persistent specialized teammates (researcher, implementer, reviewer)
- Complex multi-phase workflows

## Tradeoffs

| Pattern | Speed | Safety | Context Cost |
|---------|-------|--------|--------------|
| **Coordinator** | Slowest | Safest | Lowest (zero inheritance) |
| **Resumable Coordinator** | Medium | Safest | Low (zero initial, preserved across rounds) |
| **Fork** | Fastest | Medium | Highest (full inheritance) |
| **Swarm** | Medium | Medium | Medium (shared state only) |

## Implementation Patterns

### Coordinator Pattern (Recommended for Complex Tasks)

Phased workflow:

```
Phase 1: Research
  ↓ (synthesize findings)
Phase 2: Plan  
  ↓ (precise specs)
Phase 3: Implement
  ↓ (verify)
Phase 4: Review
```

```typescript
// Example: Coordinator workflow
const research = await coordinator.spawn({
  role: 'researcher',
  prompt: `Analyze existing authentication in ${authDir}.
  Find: login flow, logout flow, token handling.
  Return: structured findings only. NO implementation suggestions.`,
  toolFilter: ['read', 'search', 'glob'], // Can't write
});

await coordinator.synthesize(research.results);

const implement = await coordinator.spawn({
  role: 'implementer',
  prompt: `Implement token refresh handler using the JWT strategy
  from [Phase 2 findings]. 
  Constraints: Use existing AuthService patterns, add tests.`,
  toolFilter: ['read', 'search', 'edit', 'test'], // Can write
});
```

### Resumable Coordinator Pattern (Recommended for Multi-Round Planning)

A variant of the Coordinator where the worker **pauses** on unknowns and gets **resumed** with answers, preserving all accumulated context across rounds. Eliminates the waste of re-probing and re-analyzing on each round.

```
Dispatch (zero context, self-contained prompt)
  ↓ (worker starts: probes, analyzes...)
  ↓ (hits unknown → returns early with questions)
Resume (same worker, context preserved, answers appended)
  ↓ (worker continues from where it paused)
  ↓ (hits another unknown → returns early again)
Resume (same worker, answers appended)
  ↓ (worker continues, no more unknowns)
  ↓ (produces final output)
```

```typescript
// Example: Resumable Coordinator for planning
const planner = await coordinator.spawn({
  role: 'planner',
  prompt: `Plan the implementation for: ${rawRequest}.
  Context: ${codebbaseContext}.
  If you encounter unknowns you cannot resolve, return early
  with { elicitationForm: { questions: [...] } }. Each question
  must contain question, a concise header, 2-4 described options,
  and multiSelect. The form has no question-count limit. You will
  be resumed with the complete structured answer set.`,
  toolFilter: ['read', 'search', 'mcp'], // Read + MCP tools
});

// Planner returns early with a client-neutral form. The coordinator
// partitions it to match the active client's AskUserQuestion limit,
// preserves order, and accumulates every answer before one resume.
while (planner.result.elicitationForm?.questions?.length > 0) {
  const form = planner.result.elicitationForm;
  const batches = coordinator.partitionForActiveClient(form.questions);
  const answers = {};

  for (const questions of batches) {
    const batchAnswers = await coordinator.askUser({ questions });
    if (batchAnswers.declined) {
      coordinator.retainInSession(form, answers);
      return; // Leave unanswered questions pending; do not resume or persist.
    }
    Object.assign(answers, batchAnswers.answers);
  }

  // Resume the SAME planner once — context preserved.
  await coordinator.resume(planner.id, {
    prompt: `Elicitation response: ${JSON.stringify({
      questions: form.questions,
      answers,
    })}. Continue.`,
  });
}

// Final result has plans + task breakdowns (no pending elicitationForm)
const plans = planner.result;
```

**Alias vs ID.** A resumable worker may carry a **stable visible alias** (e.g. `hbtl-harness-planner`, **Hubtel Harness Planner**) for the session UI. That label is presentation metadata only. The coordinator must capture the worker's **agent ID** on the first spawn and pass that ID to every `resume` call — never re-spawn keyed on the alias. Losing the ID forces a stateless re-dispatch and drops accumulated context.

```typescript
const planner = await coordinator.spawn({
  description: 'Hubtel Harness Planner', // Cursor / Claude Code Task tool — UI label only
  prompt: `Role: hbtl-harness-planner …`,
});
const plannerId = planner.id; // authoritative handle for resume(plannerId, …)
```

**Client capability (visible alias).**

| Client | Visible alias mechanism | Fallback when unsupported |
|---|---|---|
| Cursor | Task tool `description` → subagent card title | Prepend `Role: hbtl-harness-planner` to prompt |
| Claude Code | Task tool `description`/label | Same prompt preamble |
| Other (Codex CLI, runners without Task) | None | Prompt preamble only; UI unchanged |

**Key properties:**
- Zero context on initial dispatch (same isolation as Coordinator)
- Context-preserving across clarification rounds via resume (no re-probing, no re-analysis)
- Worker returns early on unknowns with a structured `elicitationForm`, then gets resumed once with the complete answer set
- Coordinator must capture and track the worker's agent ID
- The form has no question-count limit; client batching belongs to the coordinator
- Malformed forms are returned to the same worker for correction and are never shown raw
- If AskUserQuestion is unavailable, render the complete form as structured Markdown with the same options and a custom-answer path
- A declined batch retains answers only in active session context, leaves the rest pending, and pauses without resuming or persisting elicitation data
- Completed answers shape plans, contracts, tasks, acceptance criteria, and sequencing; raw Q&A and form metadata are never copied into artifacts
- Best for: multi-round planning where re-doing work per round is wasteful (docs probing, codebase analysis, MCP tool calls)

### Fork Pattern (Single-Level Only)

```typescript
// Parent spawns children for parallel work
const forks = await Promise.all([
  coordinator.fork({
    prompt: 'Implement login handler',
    inheritContext: true, // Full parent history
  }),
  coordinator.fork({
    prompt: 'Implement logout handler',
    inheritContext: true,
  }),
]);

// CRITICAL: Children must not fork recursively
// If allowed, context cost multiplies: parent + child1 + child2 + ...
```

### Swarm Pattern (Flat Roster)

```typescript
// Swarm: persistent team with shared task list
const swarm = new Swarm([
  { id: 'researcher', specialty: 'research' },
  { id: 'implementer', specialty: 'implementation' },
  { id: 'reviewer', specialty: 'verification' },
]);

// Agents pick tasks from shared queue
// Results posted back to shared state
await swarm.dispatch({
  taskId: 'feat-001',
  pickedBy: 'implementer',
});
```

## Gotchas

1. **Fork children must not fork** — Recursive guard preserves single-level invariant. Keep fork tool in child's pool (for prompt cache sharing) but block at call time.
2. **Coordinator workers start with zero context** — Only explicit prompt is passed. Don't assume child sees parent's accumulated research.
3. **Resumable Coordinator requires agent ID tracking** — The coordinator must capture the worker's agent ID on the initial dispatch and reuse it for every `resume` call. Losing the ID means losing accumulated context and falling back to stateless re-invocation.
4. **Resumable workers must be designed for return-early** — The worker's initial prompt must instruct it to return early with a valid `elicitationForm` when blocked, not to work around unknowns or wait until the end. On resume, it should continue from its pause point — not restart.
5. **Swarm teammates cannot spawn other teammates** — Roster is flat to prevent uncontrolled growth.
6. **Write self-contained prompts** — "Based on your findings" is an anti-pattern. Coordinator must digest first.
7. **Filter each worker's tool set** — Researcher doesn't need write; implementer doesn't need broad search.

## Related Patterns

- [Context Engineering](context-engineering-pattern.md) — Isolation patterns for delegation
- [Lifecycle & Bootstrap](lifecycle-bootstrap-pattern.md) — How agents are spawned at init

## Template: Worker Prompt Structure

```markdown
# Self-Contained Worker Prompt

## Context (Copied from Coordinator Synthesis)

**Task**: Implement token refresh handler
**Background**: Research identified JWT-based auth with 24h access tokens.
**Decision**: Use refresh token rotation (new refresh token on each refresh).

## Your Role

You are an **implementer**. Your job is to write production code following the specs above.

## Constraints

- Use existing patterns from `${authServicePath}`
- Add tests for success and failure cases
- Do NOT modify login/logout handlers (separate task)

## Your Tools

- read, search, edit, test
- Shell: npm test, npm run check only

## Deliverable

Return:
1. Implementation diff (files changed)
2. Test results (pass/fail)
3. Any blockers or clarifications needed

**Do NOT return**: Research findings, architectural debates, alternative designs.
```

## Evidence

Multi-agent coordination patterns are observed in production systems where:
- Coordinator workers start with zero context inheritance
- Fork is restricted to single-level to control context explosion
- Swarm agents communicate through shared task lists, not direct prompts
- Results arrive asynchronously with fire-and-forget registration
