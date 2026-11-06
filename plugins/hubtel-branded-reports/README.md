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

**PDF triggers (examples):** hubtel pdf report, hubtel pdf, hubtel report pdf, hubtel branded pdf, hubtel branded report, hubtel branded report pdf, hubtel branded pdf report, hubtel pdf doc, hubtel pdf doc report, hubtel HOD report, hubtel hod report, hubtel HOD pdf report, hubtel hod pdf report, hubtel HOD report pdf, hubtel hod report pdf, hubtel document, hubtel document report, hubtel doc, hubtel doc report, hubtel report, Hubtel-branded PDF, one-pager, HOD brief, board pack.

**PPTX triggers (examples):** hubtel powerpoint, hubtel power point, hubtel powerpoint presentation, hubtel power point presentation, Hubtel-branded PowerPoint presentation, Hubtel-branded Power Point presentation, hubtel powerpoint presentation slide, hubtel power point presentation slide, hubtel ppt, hubtel pptx, hubtel branded ppt, hubtel branded pptx, hubtel ppt report, hubtel pptx report, hubtel ppt presentation, hubtel pptx presentation, hubtel ppt slides, hubtel ppt slide, hubtel pptx slides, hubtel pptx slide, hubtel presentation slides, hubtel presentation slide, hubtel presentation report, hubtel slides report, hubtel slide report, hubtel slides, hubtel slide, hubtel presentation, hubtel slides presentation, hubtel slide presentation, Hubtel-branded PPT, Hubtel-branded PPTX, pitch deck, exec deck, board deck.
