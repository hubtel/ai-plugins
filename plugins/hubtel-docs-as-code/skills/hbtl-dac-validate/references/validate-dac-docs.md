# Validate DAC Documentation

## Metadata

```yaml
name: Validate DAC Documentation
description: Validate project documentation compliance
command: *validate-docs
elicit: true
```

## Purpose

Validate that project documentation meets Hubtel's [Docs-As-Code guidelines](../hbtl-dac-validate/references/dac-guidelines-ref.md). Produce a human-readable markdown validation report by default.

## Workflow Steps

### Step 1: Validate Mandatory Structure

Check that all required files and directories exist:

#### Required Files:

- ✅ README.md
- ✅ docs/index.md
- ✅ docs/overview.md
- ✅ docs/architecture/index.md

#### Required Directories:

- ✅ docs/
- ✅ docs/architecture/
- ✅ docs/flows/
- ✅ docs/operations/
- ✅ docs/adr/

**Record missing elements for report.**

### Step 2: Validate README.md Content

Use [dac-validator.md](dac-validator.md) utility to check README.md contains:

- [ ] Project name and description
- [ ] How to run the system locally
- [ ] How to test the system
- [ ] Link to `docs/index.md`

**Track pass/fail/warning status.**

### Step 3: Validate docs/index.md Content

Check docs/index.md contains:

- [ ] Navigation to key documentation sections
- [ ] High-level documentation overview
- [ ] Ownership and maintainership information

### Step 4: Validate docs/overview.md Content

Check docs/overview.md contains:

- [ ] Business context (why system exists)
- [ ] System responsibilities
- [ ] Key integrations
- [ ] External links (OneDrive briefs) if applicable

### Step 5: Validate docs/architecture/

Check docs/architecture/index.md contains:

- [ ] Overall system structure explanation
- [ ] Major components description
- [ ] Dependencies (internal and external)
- [ ] Architecture diagrams (external links OR embedded Mermaid)

**Validate Mermaid if diagrams are embedded:** Must use `:::mermaid` / `:::` fence syntax. Flag `` ```mermaid `` fences as ❌ FAIL. Also validate diagram syntax.

### Step 6: Validate docs/flows/

Check docs/flows/ directory:

- [ ] Contains at least one flow documentation file
- [ ] Each flow has narrated description
- [ ] Actors are identified
- [ ] Diagrams present (external links OR Mermaid sequence diagrams)

**Validate Mermaid in flow diagrams:** Must use `:::mermaid` / `:::` fence syntax. Flag `` ```mermaid `` fences as ❌ FAIL. Also validate diagram syntax.

### Step 7: Validate docs/operations/

Check docs/operations/ content covers:

- [ ] Normal system behavior
- [ ] Failure modes
- [ ] Logging and monitoring information
- [ ] Operational notes for support teams

### Step 8: Validate docs/adr/

Check docs/adr/ directory:

- [ ] Contains at least one ADR file
- [ ] ADR files follow naming convention (0001-decision-name.md)
- [ ] Each ADR contains required sections:
  - Decision made
  - Context
  - Alternatives considered
  - Consequences

### Step 9: Calculate Compliance Score

Calculate overall compliance percentage:

```
Compliance Score = (Passed Checks / Total Checks) × 100%
```

- **90-100%**: ✅ Pass
- **70-89%**: ⚠️ Warning - Needs improvement
- **< 70%**: ❌ Fail - Major gaps

### Step 10: Generate Validation Report

#### If Markdown Format Selected:

**CRITICAL: Use this EXACT structure for all markdown validation reports. All sections are mandatory.**

```markdown
# DAC Documentation Validation Report

**Project:** [Project Name]  
**Date:** [YYYY-MM-DD]  
**Compliance Score:** [XX]%  
**Project Root:** [file:///absolute/path/to/project](file:///absolute/path/to/project)

## Status: [✅ PASS | ⚠️ WARNING | ❌ FAIL]

---

## Structure Validation

| Component                              | Status     | Notes                |
| -------------------------------------- | ---------- | -------------------- |
| [README.md](file:///path/to/README.md) | [✅/⚠️/❌] | [Status description] |
| docs/index.md                          | [✅/⚠️/❌] | [Status description] |
| docs/overview.md                       | [✅/⚠️/❌] | [Status description] |
| docs/architecture/                     | [✅/⚠️/❌] | [Status description] |
| docs/architecture/index.md             | [✅/⚠️/❌] | [Status description] |
| docs/flows/                            | [✅/⚠️/❌] | [Status description] |
| docs/operations/                       | [✅/⚠️/❌] | [Status description] |
| docs/operations/index.md               | [✅/⚠️/❌] | [Status description] |
| docs/adr/                              | [✅/⚠️/❌] | [Status description] |

**Note:** All file paths in the table should be clickable file:// links when files exist.

---

## Detailed Findings

### ✅ Passed Checks ([X])

[List all checks that passed. Be specific about what was found and validated.]

- README.md file exists at project root
- README.md contains project description
- README.md contains setup instructions
- [Additional passed checks...]

### ⚠️ Warnings ([X])

[List all warnings with explanations. Use bold for the warning title.]

- **[Warning title]**
  - [Explanation of what's missing or incomplete]
  - [Impact or recommendation]

[Additional warnings...]

### ❌ Failed Checks ([X])

[Group failed checks by category for clarity]

#### Missing Required Files:

- **[file name]** - [What this file should contain]
- [Additional missing files...]

#### Missing Required Directories:

- **[directory name]** - [Purpose of this directory]
- [Additional missing directories...]

#### Content Gaps:

- [Description of missing content or incomplete sections]
- [Additional content gaps...]

---

## Recommendations

### 1. **[Recommendation Title]**

[Detailed explanation of the recommendation]

[If applicable, include code block or command:]
```

[command or code snippet]

```

[Additional context or notes about this recommendation]

### 2. **[Next Recommendation Title]**

[Continue with additional recommendations, numbered sequentially...]

**Use markdown alerts for important information:**

> [!IMPORTANT]
> [Critical information the user should know]

> [!NOTE]
> [Helpful contextual information]

---

## Current Documentation Assets

[If applicable, list existing documentation found:]

### Existing Files Found:

- ✅ [file name](file:///path/to/file) ([size info])
- 📊 [diagram name] (referenced in README)
- [Additional assets...]

---

## Next Steps

1. **[First action]** - [Description]
2. **[Second action]** - [Description]
3. **[Third action]** - [Description]
4. **[Fourth action]** - [Description]
5. **[Final action]** - [Description]

---

## Summary

[Provide a 2-3 sentence summary of the validation results. Include:]
- Current compliance score and status
- Key gaps or issues found
- Primary action recommended

[End with an encouraging call-to-action if compliance is low]

**[Suggested command to improve compliance]** 📚
```

**REPORT STRUCTURE REQUIREMENTS:**

1. **Summary Section (Top):** Must include Project name, Date (YYYY-MM-DD), Compliance Score percentage, and clickable Project Root link
2. **Status:** Single clear status badge (PASS/WARNING/FAIL)
3. **Structure Validation Table:** Complete table with all 9+ components, their status, and notes. Use file:// links where applicable
4. **Detailed Findings:** Three subsections (Passed, Warnings, Failed) with counts in headings
5. **Recommendations:** Numbered list with bold titles, detailed explanations, and markdown alerts where appropriate
6. **Current Documentation Assets:** List of existing files found (if any)
7. **Next Steps:** Numbered action list (typically 5 steps)
8. **Summary:** Brief closing summary with call-to-action

**FORMATTING RULES:**

- Use horizontal rules (---) to separate major sections
- Include file:// links for all existing files
- Use emojis for status indicators (✅ ⚠️ ❌ 📊 📚)
- Use markdown alerts (> [!IMPORTANT], > [!NOTE]) for key information
- Bold important terms and file/directory names
- Include code blocks for commands
- End summary with emoji

#### If Exit Code Format Selected:

**Console Output:**

```
DAC_VALIDATION_STATUS=FAIL
DAC_COMPLIANCE_SCORE=65
DAC_PASSED_CHECKS=13
DAC_WARNING_CHECKS=5
DAC_FAILED_CHECKS=7

MISSING_FILES=docs/architecture/index.md
MISSING_SECTIONS=ownership,failure_modes,architecture_diagrams
INVALID_MERMAID=none

RECOMMENDATIONS:
1. Add architecture diagrams to docs/architecture/index.md
2. Add ownership section to docs/index.md
3. Document failure modes in docs/operations/

EXIT_CODE=1
```

**Exit with appropriate code:**

- Exit 0: Compliance >= 90% (PASS)
- Exit 1: Compliance < 90% (WARNING or FAIL)

## Output

Validation report in selected format with compliance status, detailed findings, and actionable recommendations.
