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
pip install playwright pypdf
playwright install chromium
```

**PPTX (`hbtl-pptx-report`)**

```shell
pip install python-pptx Pillow cairosvg fonttools
```

## Invocation

Slash commands are optional. Natural-language phrases also activate the skills.

```text
/hbtl-pdf-report
/hbtl-pptx-report
```

**PDF triggers (examples):** hubtel pdf report, hubtel pdf, hubtel document, hubtel document report, hubtel doc, hubtel doc report, hubtel report, Hubtel-branded PDF, one-pager, HOD brief, board pack.

**PPTX triggers (examples):** hubtel powerpoint, hubtel power point, hubtel slides, hubtel slide, hubtel presentation, hubtel slides presentation, hubtel slide presentation, Hubtel-branded PPTX, pitch deck, exec deck, board deck.
