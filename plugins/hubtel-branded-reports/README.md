# Hubtel Branded Reports

Plugin for producing Hubtel-branded PDF reports and PowerPoint decks.

## Contents

| Kind | Name | Pack |
|------|------|------|
| Skill | `hbtl-pdf-report` | `developer-enablement` |
| Skill | `hbtl-pptx-report` | `developer-enablement` |

No MCP servers.

## Install

```shell
aqua add-plugin --plugin hubtel-branded-reports --agent cursor claude-code codex \
  --source /absolute/path/to/Hubtel-Agent-Repo
```

After the marketplace is published, omit `--source` to install from the org catalog.

## Runtime dependencies

These skills render locally with Python. Install before building deliverables:

**PDF (`hbtl-pdf-report`)**

```shell
pip install weasyprint beautifulsoup4
```

**PPTX (`hbtl-pptx-report`)**

```shell
pip install python-pptx Pillow cairosvg fonttools
```

## Invocation

```text
/hbtl-pdf-report
/hbtl-pptx-report
```
