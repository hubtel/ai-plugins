---
name: hbtl-dac-analyze
description: "Perform a deep analysis of a specific DAC documentation section for a Hubtel project. Assesses completeness, quality, accuracy, and identifies improvement opportunities for a chosen section: overview, architecture, flows, operations, or adr. Returns detailed findings with specific, actionable recommendations. Use when you want focused feedback on one area rather than a full compliance check."
metadata:
  author: "Hubtel Enablement Team"
  version: 1.0.0
  date_added: 2026-03-13
  last_updated: 2026-03-13
compatibility: Requires git. Designed for Hubtel engineering projects.
---

# Analyze DAC Documentation

Follow the workflow in [references/analyze-dac-docs.md](references/analyze-dac-docs.md).

**Sections you can analyze:**
- `overview` — business context and system responsibilities
- `architecture` — system design, components, and diagrams
- `flows` — user flows and process documentation
- `operations` — failure modes, logging, and monitoring
- `adr` — Architecture Decision Records

Pass the section name as an argument, e.g. `/dac-analyze architecture`, or let the
workflow prompt you to select one interactively.
