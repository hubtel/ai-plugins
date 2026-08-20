# DAC Guidelines Quick Reference

> **Official Documentation:** [Hubtel DAC Guidelines](https://dev-docs.hubtel.com/repositories-docs/guidelines.html)

## Purpose

Quick reference extracted from Hubtel's Docs-As-Code guidelines for agent use. Contains essential DAC structure requirements and validation criteria.

For complete and authoritative information, always refer to the [official DAC guidelines](https://dev-docs.hubtel.com/repositories-docs/guidelines.html).

## DAC Core Principles

1. **Documentation Lives with Code**: All documentation in the same repository as the system
2. **Standardized Structure**: Every production system follows the same structure
3. **Versioned via Pull Requests**: Documentation changes reviewed like code
4. **Engineer Ownership**: Maintained by engineers who own the system
5. **Link, Don't Duplicate**: Reference external materials (OneDrive, diagrams) rather than duplicating

## Mandatory Repository Structure

```
.
├── README.md
└── docs/
    ├── index.md
    ├── overview.md
    ├── architecture/
    │   └── index.md
    ├── flows/
    ├── operations/
    └── adr/
```

## File-by-File Expectations

### README.md

**Purpose:** The front door. Lives at repo root. What is this service? Who owns it? How do I run it locally? Links into the /docs subfolders for depth. Should be readable in under 2 minutes.

**Must Include:**

- What this repository is
- How to run the system locally
- How to test the system
- Link to docs/index.md

### docs/index.md

**Purpose:** Main entry point for documentation

**Must Include:**

- Pointers to key documentation sections
- High-level navigation
- Ownership and maintainership information

### docs/overview.md

**Purpose:** Business context

**Must Include:**

- Why the system exists (business context)
- System responsibilities
- Key integrations
- Link to OneDrive briefing (if applicable)

### docs/architecture/

**Purpose:** System architecture. High-level overviews, component diagrams (mermaid diagrams), data models, infrastructure topology. The "big picture" that helps new engineers understand how things fit together.

**Must Include:**

- Overall system structure
- Major components
- Dependencies
- Architecture diagrams (external link OR Mermaid)

### docs/flows/

**Purpose:** Business and technical flows. Step-by-step descriptions of critical paths: order fulfillment, payment processing, user onboarding. Use Mermaid or plain-text sequence diagrams.

**Must Include:**

- Narrated business or technical flows
- Actors involved
- Diagrams with clear explanations (external OR Mermaid)

### docs/operations/

**Purpose:** Operational runbooks. Step-by-step instructions for incident response, deployments, data migrations, manual interventions. Written for the on-call engineer at 2 AM.

**Must Include:**

- Normal system behavior
- Failure modes
- Logs, metrics, and dashboards
- Operational notes for support/on-call teams

### docs/adr/

**Purpose:** Architecture Decision Records. One file per significant technical decision. Numbered sequentially: 001-use-temporal-for-orchestration.md. Immutable once accepted — supersede, don't edit.

**Must Include:**

- Significant technical decisions
- Context and motivation
- Alternatives considered
- Consequences and trade-offs

**Format:** `0001-decision-name.md`, `0002-another-decision.md`, etc.

## DAC Workflow Integration

### Sprint Planning

Supervisors/leads identify documentation impact during task breakdown

### Execution

Engineers update documentation alongside code changes

### Pull Request Review

Documentation correctness reviewed with code changes

### Post-Merge

Documentation supports testing, deployment, operations

## Service Tier Considerations

Documentation should include:

- **Service Tier**: Critical / High / Medium / Low
- **Business Impact**: Financial/operational impact of downtime
- **User Base**: Who and how many are affected
- **System Dependencies**: How many services depend on this
- **Compliance**: Any regulatory requirements

## Enforcement Model

- **Mandatory for new production systems**
- **Required for behavior-changing PRs**
- **Existing systems upgraded opportunistically**

## External Resource Guidelines

### What to Link

- OneDrive project briefs and business documentation
- Architecture diagrams (draw.io, Lucidchart, Visio)
- Sprint planning recordings
- Meeting notes with decisions
- Design specifications

### Where to Link

- **OneDrive briefs** → docs/overview.md
- **Architecture diagrams** → docs/architecture/index.md
- **Flow diagrams** → docs/flows/\*.md
- **Meeting notes** → docs/adr/\*.md

### Link Format

```markdown
- **Project Brief:** [OneDrive Document](https://link-to-onedrive)
```

## Diagram Strategy

### Prefer External Diagrams When:

- Team already uses draw.io/Lucidchart
- Complex diagrams requiring visual editing tools
- Diagrams shared across multiple projects

### Use Mermaid When:

- No external diagrams exist or as complements to insufficient external diagrams
- Simple diagrams (sequences, flowcharts)
- Want diagrams versioned with code

### Mermaid in Markdown

**REQUIRED:** Use `:::mermaid` / `:::` fence syntax for all Mermaid diagrams. Do **NOT** use triple-backtick `` ```mermaid `` fences — they are non-compliant and will fail validation.

```markdown
:::mermaid
sequenceDiagram
User->>API: Request
API->>Service: Process
Service-->>API: Response
API-->>User: Result
:::
```

## Validation Criteria

### Critical (Must Have)

- README.md with setup and test instructions
- docs/index.md with navigation
- docs/overview.md with business context
- All mandatory directory structure

### High Priority

- docs/architecture/ with diagrams
- docs/flows/ with at least one flow
- docs/operations/ with failure modes
- docs/adr/ with key decisions

### Pass Threshold

- 90%+ compliance: PASS
- 70-89% compliance: WARNING
- <70% compliance: FAIL
