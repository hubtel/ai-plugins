---
name: hbtl-dac-update
description: "Update existing DAC documentation for a Hubtel project based on code changes. Supports two modes: Auto (analyzes git diff to detect changes automatically) and Manual (you describe what changed). Updates only affected documentation sections, preserves existing content, and creates ADR entries for significant architectural decisions. Use after shipping new features, refactors, or integration changes."
metadata:
  author: "Hubtel Enablement Team"
  version: 1.2.0
  date_added: 2026-03-13
  last_updated: 2026-04-09
compatibility: Requires git. Designed for Hubtel engineering projects.
---

# Update DAC Documentation

Follow the workflow in [references/update-dac-docs.md](references/update-dac-docs.md).

**Modes:**
- **Auto** (default): compares current branch against the base branch (development/main) to detect changes automatically
- **Manual**: you describe what changed

The workflow is interactive by default. Pass `--ci` for non-interactive CI pipeline
execution — automatically runs in Auto mode, skips external resource prompts, and
outputs a machine-readable result block.
