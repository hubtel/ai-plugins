---
name: hbtl-dac-validate
description: "Validate a Hubtel project's documentation against DAC compliance guidelines. Checks for required files (README.md, docs/index.md, docs/overview.md, docs/architecture/index.md), required directories (docs/flows/, docs/operations/, docs/adr/), required content sections, and Mermaid diagram syntax. Returns a compliance score and actionable recommendations. Use before merging PRs, in CI pipelines, or to assess documentation health."
metadata:
  author: "Hubtel Enablement Team"
  version: 1.2.0
  date_added: 2026-03-13
  last_updated: 2026-04-01
compatibility: Requires git. Designed for Hubtel engineering projects.
---

# Validate DAC Documentation

Follow the workflow in [references/validate-dac-docs.md](references/validate-dac-docs.md).

**Output formats:**
- **Markdown** (default): human-readable validation report with compliance score, findings table, and recommendations
- **Exit codes** (`--ci`): machine-readable output block with `EXIT_CODE=0` (≥90% compliance) or `EXIT_CODE=1` (<90%) — suitable for CI/CD pipeline integration
