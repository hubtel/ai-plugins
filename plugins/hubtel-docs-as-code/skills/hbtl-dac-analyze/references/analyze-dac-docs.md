# Analyze DAC Documentation

## Metadata

```yaml
name: Analyze DAC Documentation
description: Analyze specific documentation subdirectories for completeness and quality
command: *analyze-docs
elicit: true
```

## Purpose

Perform deep analysis of specific DAC documentation sections to assess completeness, quality, and identify improvement opportunities.

## Workflow Steps

### Step 1: Present Subdirectory Options

**Prompt user to select section:**

```
I'll analyze your DAC documentation in detail!

Please select which section to analyze:

1. **Overview** (docs/overview.md) - Business context and system purpose
2. **Architecture** (docs/architecture/) - System design and components
3. **Flows** (docs/flows/) - Business and technical process flows
4. **Operations** (docs/operations/) - Production behavior and support
5. **ADR** (docs/adr/) - Architectural decision records
6. **All Sections** - Comprehensive analysis of entire documentation

Which section would you like me to analyze? (type 1-6)
```

### Step 2: Perform Section-Specific Analysis

#### If "Overview" Selected:

**Analyze docs/overview.md for:**

- **Completeness:**
  - Is business context clearly explained?
  - Are system responsibilities well-defined?
  - Are key integrations documented?
  - Are external OneDrive links present and accessible?

- **Quality:**
  - Is the language clear and concise?
  - Would a new engineer understand the system's purpose?
  - Is the scope well-defined (what's included vs external)?

- **Gaps:**
  - Missing business context?
  - Unclear system boundaries?
  - Undocumented integrations?

#### If "Architecture" Selected:

**Analyze docs/architecture/ for:**

- **Completeness:**
  - Is overall system structure explained?
  - Are major components identified and described?
  - Are dependencies (internal and external) documented?
  - Are architecture diagrams present (external links or Mermaid)?

- **Quality:**
  - Do diagrams accurately represent the system?
  - Is component interaction clearly explained?
  - Are technology choices justified?
  - Valid Mermaid syntax if embedded diagrams?
  - Mermaid diagrams use `:::mermaid` fence convention (NOT `` ```mermaid ``)?

- **Gaps:**
  - Missing component descriptions?
  - Undocumented dependencies?
  - No visual representation of architecture?
  - Outdated diagrams?

#### If "Flows" Selected:

**Analyze docs/flows/ for:**

- **Completeness:**
  - Are key user flows documented?
  - Are business processes narrated clearly?
  - Are technical flows (API interactions) explained?
  - Are actors identified in each flow?
  - Are diagrams present for each flow?

- **Quality:**
  - Are flows easy to follow?
  - Do sequence diagrams match narrative descriptions?
  - Are edge cases and error paths documented?
  - Valid Mermaid syntax in diagrams?
  - Mermaid diagrams use `:::mermaid` fence convention (NOT `` ```mermaid ``)?

- **Gaps:**
  - Missing critical user flows?
  - Authentication/authorization flow missing?
  - Payment or transaction flows undocumented?
  - No visual diagrams for complex flows?

#### If "Operations" Selected:

**Analyze docs/operations/ for:**

- **Completeness:**
  - Is normal system behavior documented?
  - Are failure modes identified?
  - Are logging and monitoring patterns explained?
  - Are metrics and dashboards referenced?
  - Are operational notes provided for support teams?

- **Quality:**
  - Is troubleshooting information actionable?
  - Are log patterns easy to search for?
  - Are alert thresholds clearly defined?
  - Is on-call guidance sufficient?

- **Gaps:**
  - Missing failure mode documentation?
  - No logging examples?
  - Undefined monitoring metrics?
  - Lack of runbook procedures?

#### If "ADR" Selected:

**Analyze docs/adr/ for:**

- **Completeness:**
  - Are significant decisions documented?
  - Do ADRs follow standard format?
  - Are alternatives considered and documented?
  - Are consequences clearly stated?

- **Quality:**
  - Is the context clearly explained?
  - Are trade-offs honestly assessed?
  - Is the reasoning sound?
  - Are ADRs properly numbered and titled?

- **Gaps:**
  - Missing ADRs for major technology choices?
  - Framework selection not documented?
  - Database choice not justified?
  - Authentication method decision missing?

#### If "All Sections" Selected:

Perform complete analysis across all sections and provide holistic assessment of documentation quality.

### Step 3: Check Against DAC Expectations

For selected section, verify against [DAC guidelines](../hbtl-dac-validate/references/dac-guidelines-ref.md) using [dac-completeness-checklist.md](dac-completeness-checklist.md).

### Step 4: Assess Quality and Clarity

Evaluate documentation quality:

- **Readability**: Is content clear and well-structured?
- **Accuracy**: Does documentation match current codebase?
- **Usefulness**: Would this help a new engineer?
- **Completeness**: Are all required elements present?
- **Consistency**: Is terminology used consistently?

### Step 5: Identify Gaps and Inconsistencies

List specific missing elements:

- Missing required sections
- Incomplete descriptions
- Broken links (external or internal)
- Out-of-date information
- Inconsistent terminology

### Step 6: Generate Analysis Report

```markdown
# DAC Documentation Analysis Report

**Section Analyzed:** [Section Name]
**Date:** [Timestamp]

## Overall Assessment

**Score:** X/10
**Status:** ✅ Excellent / ⚠️ Good / ❌ Needs Improvement

## Completeness Analysis

| Element                 | Present | Quality | Notes                        |
| ----------------------- | ------- | ------- | ---------------------------- |
| Business Context        | ✅      | High    | Clear and comprehensive      |
| System Responsibilities | ⚠️      | Medium  | Could be more specific       |
| Key Integrations        | ❌      | N/A     | Missing several integrations |
| External Links          | ✅      | High    | OneDrive brief linked        |

## Quality Assessment

### Strengths

- Clear business context explanation
- Well-structured content
- Good use of examples

### Weaknesses

- Some technical jargon not explained
- Missing visual diagrams
- Incomplete integration documentation

## Identified Gaps

1. **Missing Integrations Documentation**
   - Payment gateway integration not documented
   - SMS service integration missing

2. **Unclear System Boundaries**
   - External vs internal components not clearly delineated

3. **No Architecture Diagrams**
   - Would benefit from system architecture diagram
   - Consider adding component interaction diagram

## Specific Recommendations

### High Priority

1. **Document payment gateway integration** in docs/overview.md
   - Explain how system connects to payment service
   - Clarify data flow and error handling

2. **Add system architecture diagram** to docs/architecture/index.md
   - Show major components and their relationships
   - Either link to external diagram or generate Mermaid diagram

### Medium Priority

3. **Clarify system boundaries** in docs/overview.md
   - Explicitly state what's in-scope vs external
   - Define integration points

### Low Priority

4. **Add glossary** for technical terms
   - Define domain-specific terminology
   - Explain abbreviations

## Suggested Actions

- Run `*update-docs` to add missing integrations
- Run `*generate-docs` to create missing architecture diagrams
- Consider creating ADR for integration decisions

## Next Steps

1. Address high-priority recommendations first
2. Run `*validate-docs` after making updates
3. Schedule documentation review with team
```

## Output

Detailed analysis report with assessment scores, identified gaps, and actionable recommendations for improving the selected documentation section.
