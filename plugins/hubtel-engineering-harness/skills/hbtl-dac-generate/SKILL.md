---
name: hbtl-dac-generate
description: "Generate complete DAC-compliant documentation for a Hubtel project that has no existing docs. Creates README.md, docs/index.md, docs/overview.md, docs/architecture/, docs/flows/, docs/operations/, and docs/adr/. Prompts for external resources (OneDrive briefs, architecture diagrams, sprint recordings) and generates Mermaid diagrams when none are provided. Use when a project is missing documentation or when starting documentation from scratch."
metadata:
  author: "Hubtel Enablement Team"
  version: "1.2.0"
  date_added: 2026-03-13
  last_updated: 2026-04-09
compatibility: Requires git. Designed for Hubtel engineering projects.
---

# Generate DAC Documentation

Follow the workflow in [references/generate-dac-docs.md](references/generate-dac-docs.md).

The workflow is interactive by default — it will prompt for external resources and
confirm generated content. Pass `--ci` for non-interactive CI pipeline execution.

Templates are in the `assets/` directory alongside this skill.
