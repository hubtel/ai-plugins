# Generate DAC-Compliant Documentation

## Metadata

```yaml
name: Generate DAC-Compliant Documentation
description: Complete workflow for generating Docs-As-Code compliant documentation structure for non-documented projects
command: *generate-docs
elicit: true
```

## Purpose

Generate complete DAC-compliant documentation structure for Hubtel projects that don't have existing documentation. This task ensures all required files and sections are created according to the standardized DAC structure defined in the [DAC Guidelines](../hbtl-dac-validate/references/dac-guidelines-ref.md).

## Workflow Steps

### Step 1: Analyze Project

- Identify project type (frontend/backend/fullstack/microservice/library)
- Detect technology stack (frameworks, languages, databases, tools)
- Identify main entry points and core modules
- Discover key integrations and dependencies

### Step 2: Gather External Resources from User

**Prompt the user for external materials:**

```
I'll help you generate DAC-compliant documentation for this project!

Before we begin, do you have any existing external resources I should link to?

1. **OneDrive Brief**: Do you have a project brief or business case document? (provide link)
2. **Architecture Diagrams**: Any existing architecture diagrams (draw.io, Lucidchart, etc.)? (provide link)
3. **Sprint Materials**: Sprint planning recordings or transcripts? (provide link)
4. **Meeting Notes**: Any meeting notes with architectural decisions? (provide link)

If you have any of these, please share the links. Otherwise, type 'skip' and I'll generate everything from scratch.
```

**Store user-provided links for integration in appropriate sections.**

### Step 3: Create Mandatory DAC Structure

Create the following directory and file structure:

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

### Step 4: Generate README.md

Use `dac-readme-tmpl.yaml` template to create README.md with:

- Project name and description
- How to run the system locally
- How to test the system
- Clear link to `docs/index.md`

### Step 5: Generate docs/index.md

Use `dac-index-tmpl.yaml` template to create the main documentation index with:

- Navigation to all documentation sections
- High-level overview
- Ownership and maintainership information

### Step 6: Generate docs/overview.md

Use `dac-overview-tmpl.yaml` template to create overview documentation:

- Business context (why this system exists)
- System responsibilities
- Key integrations
- **Link to OneDrive brief if user provided one**

### Step 7: Generate docs/architecture/index.md

Use `dac-architecture-tmpl.yaml` template:

- Overall system structure extracted from codebase
- Major components and their responsibilities
- Dependencies (internal and external)
- **Link to external architecture diagrams if user provided them**
- **If no external diagrams provided:** Generate Mermaid architecture diagram showing system components
- **Mermaid convention:** All diagrams MUST use `:::mermaid` / `:::` fence syntax. Do NOT use `` ```mermaid `` fences.

### Step 8: Generate Flow Documentation (docs/flows/)

Analyze codebase to identify key flows and create flow documentation:

- User authentication flow
- Main business process flows
- API interaction patterns

Use `dac-flows-tmpl.yaml` template for each flow:

- Narrated description of the flow
- Actors involved
- **Link to external flow diagrams if provided**
- **If no external diagrams:** Generate Mermaid sequence diagrams
- **Mermaid convention:** All diagrams MUST use `:::mermaid` / `:::` fence syntax. Do NOT use `` ```mermaid `` fences.

### Step 9: Generate docs/operations/

Use `dac-operations-tmpl.yaml` template:

- Normal system behavior
- Failure modes and error handling patterns
- Logging and monitoring patterns extracted from code
- Metrics and dashboards
- Operational notes for support teams

### Step 10: Create Initial ADR Entries (docs/adr/)

Analyze codebase for significant architectural decisions:

- Framework choices
- Database selection
- Authentication/authorization approach
- External service integrations

Use `dac-adr-tmpl.yaml` template to create ADR files (e.g., `0001-use-redis-for-caching.md`):

- Decision made
- Context
- Alternatives considered
- Consequences
- **Reference user-provided meeting notes if available**

### Step 11: Verify Content Accuracy

**⚠️ CRITICAL: ANTI-HALLUCINATION CHECK - MANDATORY BEFORE COMPLETING**

Use [content-verification.md](../hbtl-dac-validate/references/content-verification.md) guidelines. For each generated section:

#### 1. Source Verification

- Every fact MUST be traceable to source code, config file, or user-provided resource
- Add inline source citations: `_Source: filename.ext_`
- If source cannot be identified, DO NOT include the content

#### 2. Apply Placeholder Markers for Unverifiable Content

Use these markers instead of fabricating details:

```
[NEEDS_INPUT: description]     - Information only user can provide
[VERIFY_WITH_TEAM: assumption] - Reasonable inference, needs confirmation
[TODO: missing info]           - Section needs more research
```

**Example - CORRECT approach:**

```markdown
## Business Context

[NEEDS_INPUT: Please describe why this system exists and what business problem it solves]

## Technology Stack

- **Runtime:** .NET 8.0 _Source: `Hubtel.Api.csproj`_
- **Database:** PostgreSQL _Source: `docker-compose.yml`_
- **Cache:** [VERIFY_WITH_TEAM: Redis detected in config, confirm if actively used]
```

#### 3. Content Categories

**✅ GENERATE (Verified from code):**

- Technology stack (from package manifests)
- API endpoints (from route definitions)
- Database schemas (from migrations)
- Dependencies (from config files)
- File structure (from directory analysis)

**⚠️ INFER WITH WARNING (Mark for review):**

- Architectural patterns
- Performance characteristics
- Error handling strategies

**❌ NEVER FABRICATE (Use placeholder):**

- Business context/purpose
- User personas
- Integration purposes
- Performance metrics
- Team/ownership info

#### 4. Final Verification Checklist

- [ ] All technology claims cite source files
- [ ] Business context from user OR marked [NEEDS_INPUT]
- [ ] No invented endpoints, APIs, or integrations
- [ ] All diagrams reflect only verified components
- [ ] Inferred content marked with ⚠️ INFERRED
- [ ] Unknown content uses placeholders

### Step 12: Validate Generated Documentation

Run validation against DAC completeness checklist:

- All mandatory files exist
- All required sections are present
- External links are properly formatted
- Mermaid diagrams use `:::mermaid` fence syntax and are valid

### Step 12: Report to User

Provide summary of generated documentation:

```
✅ DAC-Compliant Documentation Generated!

**Created Files:**
- README.md
- docs/index.md
- docs/overview.md
- docs/architecture/index.md
- docs/flows/[flow-name].md (X files)
- docs/operations/index.md
- docs/adr/000X-[decision].md (X entries)

**External Resources Linked:**
- OneDrive brief: [link if provided]
- Architecture diagrams: [links if provided]

**Generated Diagrams:**
- System architecture diagram (Mermaid)
- X flow sequence diagrams (Mermaid)

**Next Steps:**
1. Review the generated documentation
2. Update any placeholders with project-specific details
3. Run `*validate-docs` to ensure full compliance
```

## Output

Complete DAC-compliant documentation structure with all required files, external resource links, and generated Mermaid diagrams where needed.
