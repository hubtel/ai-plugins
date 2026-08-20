# DAC Validation Checklist

## Purpose

Validation criteria for CI/CD integration. Defines pass/fail/warning conditions. Used by `validate-dac-docs` task.

## Critical Validation Criteria (Must Pass)

These items must pass for CI/CD to succeed:

### Structure Validation

- [ ] README.md exists ❌ FAIL if missing
- [ ] docs/index.md exists ❌ FAIL if missing
- [ ] docs/overview.md exists ❌ FAIL if missing
- [ ] docs/ directory exists ❌ FAIL if missing

### README.md Validation

- [ ] Contains "How to run locally" section ❌ FAIL if missing
- [ ] Contains "How to test" section ❌ FAIL if missing
- [ ] Links to docs/index.md ⚠️ WARNING if missing

### docs/index.md Validation

- [ ] Contains navigation to major sections ⚠️ WARNING if incomplete
- [ ] Has ownership information ⚠️ WARNING if missing

### docs/overview.md Validation

- [ ] Explains business context ❌ FAIL if missing
- [ ] Documents system responsibilities ❌ FAIL if missing

## High Priority Validation (Warning if Missing)

These generate warnings but don't fail CI/CD:

### Architecture Documentation

- [ ] docs/architecture/index.md exists ⚠️ WARNING if missing
- [ ] Contains system structure explanation ⚠️ WARNING if incomplete
- [ ] Has architecture diagrams (external OR Mermaid) ⚠️ WARNING if missing
- [ ] If Mermaid: uses `:::mermaid` fence (NOT `` ```mermaid ``) ❌ FAIL if wrong fence
- [ ] If Mermaid: syntax is valid ❌ FAIL if invalid syntax

### Flow Documentation

- [ ] docs/flows/ directory exists ⚠️ WARNING if missing
- [ ] Contains at least one flow ⚠️ WARNING if empty
- [ ] Flows have diagrams ⚠️ WARNING if missing
- [ ] If Mermaid: uses `:::mermaid` fence (NOT `` ```mermaid ``) ❌ FAIL if wrong fence
- [ ] If Mermaid: syntax is valid ❌ FAIL if invalid syntax

### Operations Documentation

- [ ] docs/operations/ directory exists ⚠️ WARNING if missing
- [ ] Documents failure modes ⚠️ WARNING if missing
- [ ] Explains logging patterns ⚠️ WARNING if missing

### ADR Documentation

- [ ] docs/adr/ directory exists ⚠️ WARNING if missing
- [ ] Contains at least one ADR ⚠️ WARNING if empty
- [ ] ADRs follow naming convention ⚠️ WARNING if incorrect

## Medium Priority Validation (Informational)

These are best practices but don't affect CI/CD:

### Documentation Quality

- [ ] External links are accessible ℹ️ INFO if broken
- [ ] Tech stack is documented ℹ️ INFO if missing
- [ ] Service tier is specified ℹ️ INFO if missing
- [ ] Multiple flows documented ℹ️ INFO if only one
- [ ] Multiple ADRs present ℹ️ INFO if only one

## Exit Code Logic for CI/CD

```yaml
exit_conditions:
  exit_0_pass:
    conditions:
      - all_critical_checks_pass: true
      - compliance_score: >= 90%
    message: "Documentation meets DAC standards"

  exit_1_fail:
    conditions:
      any_of:
        - any_critical_check_fails: true
        - compliance_score: < 70%
        - invalid_mermaid_syntax: true
    message: "Documentation does not meet minimum DAC standards"

  exit_1_warning:
    conditions:
      - all_critical_checks_pass: true
      - compliance_score: 70-89%
    message: "Documentation meets minimum standards but has gaps"
```

## Validation Report Structure

### For Markdown Output:

- Status badge (PASS/WARNING/FAIL)
- Compliance score percentage
- Table of component statuses
- List of passed checks
- List of warnings
- List of failed checks
- Actionable recommendations

### For Exit Code Output:

```bash
DAC_VALIDATION_STATUS=[PASS|WARNING|FAIL]
DAC_COMPLIANCE_SCORE=[0-100]
DAC_CRITICAL_FAILURES=[count]
DAC_WARNINGS=[count]
DAC_INFO=[count]
EXIT_CODE=[0|1]
```

## Recommendation Generation

Based on validation results, provide specific recommendations:

### For Missing Structure

```
RECOMMENDATION: Create missing directory/file
COMMAND: mkdir -p docs/[section] && touch docs/[section]/index.md
PRIORITY: HIGH
```

### For Missing Content

```
RECOMMENDATION: Add [section name] to [file]
EXAMPLE: Document system responsibilities in docs/overview.md
PRIORITY: MEDIUM
```

### For Missing Diagrams

```
RECOMMENDATION: Add architecture diagrams
OPTIONS:
  1. Link to external diagrams (draw.io, Lucidchart)
  2. Generate Mermaid diagram
COMMAND: Run *generate-docs or *update-docs
PRIORITY: HIGH
```

### For Invalid Mermaid

```
RECOMMENDATION: Fix Mermaid syntax errors
FILE: [path to file with error]
ERROR: [specific syntax error]
PRIORITY: CRITICAL
```

## Compliance Thresholds

```yaml
compliance_levels:
  excellent:
    score: 95-100%
    status: PASS
    message: 'Exemplary DAC compliance'

  good:
    score: 90-94%
    status: PASS
    message: 'Good DAC compliance'

  acceptable:
    score: 80-89%
    status: WARNING
    message: 'Acceptable but improvement recommended'

  needs_improvement:
    score: 70-79%
    status: WARNING
    message: 'Needs improvement to meet standards'

  poor:
    score: < 70%
    status: FAIL
    message: 'Does not meet minimum DAC standards'
```
