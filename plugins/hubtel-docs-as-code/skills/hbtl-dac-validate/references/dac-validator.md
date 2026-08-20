# DAC Validator Utility

## Purpose

Provides validation logic for checking DAC compliance. Used by the `validate-dac-docs` task.

## Validation Rules

### Structure Validation

Check for required files and directories:

```yaml
required_files:
  - path: README.md
    type: file
    priority: critical

  - path: docs/index.md
    type: file
    priority: critical

  - path: docs/overview.md
    type: file
    priority: critical

  - path: docs/architecture/index.md
    type: file
    priority: critical

required_directories:
  - path: docs/
    type: directory
    priority: critical

  - path: docs/architecture/
    type: directory
    priority: critical

  - path: docs/flows/
    type: directory
    priority: high

  - path: docs/operations/
    type: directory
    priority: high

  - path: docs/adr/
    type: directory
    priority: high
```

### Content Validation Rules

#### README.md

- [ ] Contains project description
- [ ] Has "How to run locally" section
- [ ] Has "How to test" section
- [ ] Links to docs/index.md

#### docs/index.md

- [ ] Has navigation to documentation sections
- [ ] Includes ownership information
- [ ] Links to all major sections (overview, architecture, flows, operations, adr)

#### docs/overview.md

- [ ] Explains business context
- [ ] Documents system responsibilities
- [ ] Lists key integrations
- [ ] May include external links to OneDrive briefs

#### docs/architecture/

- **docs/architecture/**: Must contain "diagram" or ":::mermaid".

#### docs/flows/

- [ ] Contains at least one flow file
- [ ] Each flow has narrated description
- [ ] Actors are identified
- [ ] Diagrams present (external or Mermaid)

#### docs/operations/

- [ ] Documents normal behavior
- [ ] Lists failure modes
- [ ] Explains logging patterns
- [ ] Provides operational notes

#### docs/adr/

- [ ] Contains at least one ADR
- [ ] ADR files follow naming (0001-decision.md)
- [ ] Each ADR has required sections

### Mermaid Syntax Validation

When embedded Mermaid diagrams are found, validate:

1. **Fence format:** Must use `:::mermaid` / `:::` fence syntax. Triple-backtick `` ```mermaid `` fences are **non-compliant** and must be flagged as ❌ FAIL
2. Valid Mermaid syntax (basic check for diagram type keywords)
3. No obvious syntax errors

```
Valid diagram types:
- graph
- sequenceDiagram
- classDiagram
- stateDiagram
- erDiagram
- flowchart
```

### Link Validation

Check that:

- Internal links point to existing files
- External links are properly formatted
- No broken relative paths

## Compliance Scoring

```
Score Calculation:
- Each check has a weight (critical=3, high=2, medium=1)
- Calculate: (passed_weight / total_weight) × 100

Status Assignment:
- 90-100%: PASS ✅
- 70-89%: WARNING ⚠️
- <70%: FAIL ❌
```

## Output Formatting

### Markdown Format

Generate human-readable report with:

- Status badge
- Compliance score
- Table of component statuses
- Detailed findings (passed/warnings/failed)
- Actionable recommendations

### Exit Code Format

Output machine-readable variables:

```bash
DAC_VALIDATION_STATUS=[PASS|WARNING|FAIL]
DAC_COMPLIANCE_SCORE=[0-100]
DAC_PASSED_CHECKS=[number]
DAC_WARNING_CHECKS=[number]
DAC_FAILED_CHECKS=[number]
MISSING_FILES=[comma-separated]
MISSING_SECTIONS=[comma-separated]
RECOMMENDATIONS=[newline-separated]
EXIT_CODE=[0|1]
```
