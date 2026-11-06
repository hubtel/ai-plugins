---
name: hbtl-pdf-report
description: "Use this skill whenever the user asks for a Hubtel-branded PDF report or document — including phrases like hubtel pdf report, hubtel pdf, hubtel report pdf, hubtel branded pdf, hubtel branded report, hubtel branded report pdf, hubtel branded pdf report, hubtel pdf doc, hubtel pdf doc report, hubtel HOD report, hubtel hod report, hubtel HOD pdf report, hubtel hod pdf report, hubtel HOD report pdf, hubtel hod report pdf, hubtel document, hubtel document report, hubtel doc, hubtel doc report, hubtel report, Hubtel-branded PDF, analysis document, one-pager, HOD brief, board pack, or any deliverable rendered as a .pdf that must look and feel like Hubtel. Self-contained: full Hubtel visual language (palette, Sora typography, wave motif, layouts, section patterns, chart palette) plus PDF mechanics (A4, print CSS, Chromium render via Playwright, running footer with page number, cover page). Does NOT prescribe analytical voice, structure of findings, or depth — that stays with the caller or whichever content skill drives the report."
metadata:
  author: "Hubtel Enablement Team"
  version: "1.1.0"
  date_added: 2026-11-06
  last_updated: 2026-11-06
compatibility: Requires Python with playwright and pypdf, plus Chromium via `playwright install chromium`. Designed for Hubtel engineering projects.
---

# Hubtel PDF report (`/hbtl-pdf-report`)

## Invocation

```text
/hbtl-pdf-report
```

Slash is optional. Also activate this skill when the user asks in natural language for a Hubtel PDF or document deliverable — for example: hubtel pdf report, hubtel pdf, hubtel report pdf, hubtel branded pdf, hubtel branded report, hubtel branded report pdf, hubtel branded pdf report, hubtel pdf doc, hubtel pdf doc report, hubtel HOD report, hubtel hod report, hubtel HOD pdf report, hubtel hod pdf report, hubtel HOD report pdf, hubtel hod report pdf, hubtel document, hubtel document report, hubtel doc, hubtel doc report, hubtel report, Hubtel-branded PDF, one-pager, HOD brief, or board pack.


Produces `.pdf` deliverables that carry the Hubtel brand. This skill is **self-contained** — the whole design system lives inside it, plus the PDF-specific mechanics. Build the report as HTML using the rules below, then render it to PDF with the headless-Chromium recipe at the end.

**Scope.** One `.pdf`. For HTML use `hbtl-html-report`, slides `hbtl-pptx-report`, Word `docx`, spreadsheet `xlsx`.

## Renderer constraints — read first

**The renderer is headless Chromium via Playwright** — `page.pdf()` against real HTML. A real browser engine resolves `var()` inside SVG, supports `:has()`, and applies `gap` consistently, so design normally. Five real differences from an ordinary web page:

**C1 — No CSS `@page` margin-box footer.** Chromium ignores `@page { @bottom-center { … } }`. The running footer comes from Playwright's own mechanism instead: `page.pdf(display_header_footer=True, header_template=…, footer_template=…)`. See **Running footer** below for the template.

**C2 — Header/footer templates don't inherit the page's styles.** Only inline styles inside the template string itself apply — no Sora, no `<style>` block. Keep the footer plain (inline colour/size, system font). A data-URI `<img>` does render inside a template — the logo could go in the footer now — but this skill still keeps it out by default (see **Logo → Placement and sizing**); that's a design choice, not a limitation.

**C3 — Backgrounds are opt-in.** Pass `print_background=True`, or every background, wash, and wave motif renders white.

**C4 — Wait for rendering to finish before calling `page.pdf()`.** Load with `page.set_content(html, wait_until="networkidle")` so fonts and images are decoded first. A JS chart/diagram library works here (unlike the old WeasyPrint renderer) if the build waits for its completion signal first — but default to static inline SVG / server-rendered images unless the caller already has one wired up.

**C5 — Page size and margins come from the Playwright API, not CSS.** Pass `format="A4"` and `margin={...}` to `page.pdf()`. Don't also declare `@page { size; margin }` in the CSS — the two can disagree across Chromium versions.

**Not a renderer quirk, just still true:** style `<ul>`/`<ol>` explicitly wherever the Hubtel bullet is wanted — an unstyled list is plain browser default, same as anywhere else.

## Non-negotiables

- **Self-contained HTML input — zero external files.** One file, all CSS inlined, the Hubtel wordmark inlined as a data URI (see Logo) — same as `hbtl-html-report`, and simplest regardless of renderer.
- **Sora embedded as base64 `@font-face`** in the report's own `<style>` (see the build recipe). A system or Google Font substitution is not Hubtel-branded. Keep a full fallback stack on `font-family` anyway.
- **Sentence case** for headings, labels, buttons. UPPERCASE only for the eyebrow kicker.
- **Money format: `GHS 1,240.50`** for Hubtel figures — `GHS` prefix, grouped thousands, two decimals. Never `₵`, `GH¢`, `Ghc`. **Only Hubtel figures** get this treatment: vendor pricing, third-party invoices, and any non-GHS numbers stay in their source currency (`USD 800.00` for Anthropic / Cursor bills, `EUR`/`GBP` as issued). Never restamp `$800` as `GHS 800.00`.
- **No emoji, anywhere.** Meaning is carried by iconography and colour.
- **Line icons only** — 24×24, 2 px stroke, rounded joins, `currentColor` so they take the surrounding theme colour.
- **Flat white or teal-50 wash** for backgrounds. Colour comes from wave motif, stat tiles, full-bleed image blocks — never page-wide gradients or textures.
- **A4 with 20 mm margins** — see PDF-specific rules further down.

## The token block

Paste into every report's `<style>`. Transcribed from the Hubtel design system verbatim — do not tweak.

```css
:root {
  /* Brand */
  --hub-teal: rgb(0,153,153);
  --hub-teal-accent: rgb(1,199,177);
  --hub-blue: rgb(8,46,77);        /* navy */
  --hub-red: rgb(239,73,35);
  --hub-saffron: rgb(255,204,8);

  /* Teal scale */
  --teal-50:  rgb(237,250,247);
  --teal-100: rgb(204,243,239);
  --teal-200: rgb(153,232,223);
  --teal-500: rgb(1,199,177);
  --teal-600: rgb(0,153,153);
  --teal-700: rgb(1,139,124);

  /* Slate neutrals */
  --slate-900: rgb(1,5,8);
  --slate-700: rgb(61,82,99);
  --slate-600: rgb(129,149,166);
  --slate-500: rgb(156,171,184);
  --slate-300: rgb(195,208,219);
  --slate-200: rgb(230,236,240);
  --slate-100: rgb(242,245,247);
  --slate-50:  rgb(250,251,252);
  --white: rgb(255,255,255);

  /* Feedback */
  --success: rgb(0,178,124);
  --danger:  rgb(237,27,46);
  --warning: rgb(254,204,47);
  --info:    rgb(51,149,255);

  /* Semantic aliases */
  --surface: var(--white);
  --surface-subtle: var(--slate-50);
  --surface-wash: var(--teal-50);
  --surface-inverse: var(--hub-blue);
  --text-primary: var(--slate-900);
  --text-secondary: var(--slate-700);
  --text-tertiary: var(--slate-600);
  --text-on-brand: var(--white);
  --border: var(--slate-200);
  --border-strong: var(--slate-300);

  /* Type — REPORT scale (not slide scale) */
  --font-sans: "Sora", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --fw-regular: 400; --fw-medium: 500; --fw-semibold: 600; --fw-bold: 700; --fw-extrabold: 800;

  --fs-cover:  40px; --lh-cover:  48px;
  --fs-h1:     28px; --lh-h1:     36px;
  --fs-h2:     20px; --lh-h2:     28px;
  --fs-h3:     16px; --lh-h3:     24px;
  --fs-lead:   18px; --lh-lead:   28px;
  --fs-body:   15px; --lh-body:   24px;
  --fs-small:  13px; --lh-small:  20px;
  --fs-eyebrow: 11px; --tracking-eyebrow: 0.18em;

  /* Spacing (4-based) */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;
  --space-12: 48px; --space-16: 64px;

  /* Radii */
  --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* Shadows — soft, low-contrast */
  --shadow-xs: 0 1px 2px rgba(3,15,26,0.06);
  --shadow-sm: 0 1px 3px rgba(3,15,26,0.08), 0 1px 2px rgba(3,15,26,0.04);
  --shadow-md: 0 4px 12px rgba(3,15,26,0.08);
  --shadow-lg: 0 8px 24px rgba(3,15,26,0.10);

  /* Report page */
  --page-max: 960px;
  --page-pad: 48px;
  --print-pad: 20mm;
}
```

Headings use `--fw-extrabold` (cover) or `--fw-bold` (h1/h2). Cards use `--fw-semibold` for their `<h3>`. Body is `--fw-regular`. Eyebrows are UPPERCASE, `--fs-eyebrow`, `letter-spacing: var(--tracking-eyebrow)`, `--text-tertiary` (or the section accent).

## The Hubtel logo (embedded)

The Hubtel wordmark ships in the **Embedded logo block** section at the bottom of this file.

Only sanctioned logo source. Do not draw a placeholder, do not fetch from a URL, do not recolour — the fills are baked in, so it only works on a light surface.

### Placement and sizing

| Where | Position | Height |
|---|---|---|
| Cover page (opt-in) | Top-left | 48 px |
| Masthead (first content page) | Top-left | 32 px |
| Full-bleed section band | **Never** | — |
| Running footer | **Not by default** | — |

These are the only placements. A logo in the running footer is no longer technically blocked (**C2**) — Chromium renders a data-URI `<img>` inside a footer template fine — but this skill keeps it out of the footer by default anyway: it's the same one-wordmark-per-document-flow discipline `hbtl-html-report` uses, and a corner mark repeating on every single page reads as noisier than the brand needs. If a caller explicitly wants it in the footer, that's a one-line addition to the footer template below — don't default to it. No logo on a reversed section band either: the band carries a topic change through its own colour and reversed type, and a corner mark there would need a second, white asset to be legible at all. (`hbtl-pptx-report` puts a `logo.br` on every slide; slides are pages, a flowing report is not. Don't import the deck's rule.)

Never stretch, filter, or crop. Source art is 301 × 200 px, enough for 300 dpi at every height above; scaled past ~300 px of layout width it upscales and goes soft.

**Size in CSS and carry all four properties.** Only `height` is contextual; the other three are universal and inert outside flex and grid.

```html
<img class="hubtel-logo" src="data:image/png;base64,…" alt="Hubtel">
```
```css
.hubtel-logo { height: 32px; width: auto; align-self: flex-start; justify-self: start; }
```

Three independent mechanisms stretch the wordmark and all three look identical — a flattened lockup at container width — so defend against all of them rather than diagnosing which one is active:

| Cause | Defence |
|---|---|
| `width`/`height` **attributes**: ignored, renders at intrinsic 301 × 200 px | size in CSS only |
| Global `img { width: 100% }`: both axes set, stretched to 642 × 32 (aspect 20:1 vs 1.51:1) | `width: auto` |
| **Flex or grid container**: cross-axis stretch — a column-flex masthead fills the width, grid stretches both axes | `align-self: flex-start`, `justify-self: start` |

The third needs no reset to fire and `width: auto` does not stop it, which is what makes it hard to find. Put all four properties directly in the report's own CSS under the `.hubtel-logo` class — there's no adapter step patching this in afterwards, so get it right in the authored HTML.

### Using the embedded wordmarks

Each block at the bottom of this file holds a complete `data:image/png;base64,…` string between its parentheses. Copy that string verbatim into `src`. There is no file to read, no path to resolve, and no encoding step.

```html
<img class="hubtel-logo" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg…" alt="Hubtel">
```

The text to the left of the parentheses is a caption, not a filename. If what you find inside the parentheses is not a `data:` URI, stop and say so — do not go looking for an image file and do not draw a substitute.

## The report template

Every report opens with a **masthead** (title + meta row + wordmark), a required **executive summary**, then a series of **sections**. There is no in-page footer element — the running footer carries the report title and page number on every page (see PDF-specific rules). No cover page by default; opt-in for formal briefs.

### Page shell

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{Report title}} — Hubtel</title>
  <style>/* token block + @font-face + page styles + component styles + print CSS */</style>
</head>
<body>
  <main class="report">
    <header class="masthead">…</header>
    <section class="section section--summary" id="summary">…</section>
    <section class="section">…</section>
    …
  </main>
</body>
</html>
```

No `<link>` to Google Fonts — Sora is embedded as base64 `@font-face` (see the build recipe).

### Masthead

Wordmark (colour) top-left, 32 px tall. Title as `--fs-cover` `--fw-extrabold` navy, one-line lead in `--text-secondary` beneath. Meta row (period, author/team, date) as `--fs-small` `--text-tertiary`. Hairline `--border` rule closes the masthead. No wave.

### Executive summary — required

First section after the masthead. Eyebrow `EXECUTIVE SUMMARY`, `--fs-h1` `--fw-bold` navy title (defaulting to "Executive summary"), then the summary content in a `--surface-wash` panel with `--radius-lg` and `padding: var(--space-6)`. If no summary content, do not fabricate — leave the panel with a `data-pending` marker and a plain `—`, and tell the user it's missing.

### Focus-box padding — match to content density

A focus box is any element with a coloured/tinted background wrapping text (KPI tiles, callouts, evidence strips, zoom banners, section panels). Uniform 24 px on every box is the common mistake — a single-figure tile then reads as "mostly colour, a bit of text in a corner". **Scale padding to the content.**

- **Tight — `--space-3` (12 px) to `--space-4` (16 px).** Single-figure tiles, one-line banners, inline chips/tags, boxes with one label + one value.
- **Standard — `--space-4` (16 px) to `--space-5` (20 px).** 2–4 line content: small stat tiles with label + value + delta, short eyebrow + heading banners.
- **Comfortable — `--space-6` (24 px).** Prose passages: a callout of 1–3 sentences, an evidence strip with label + small grid.
- **Generous — `--space-8` (32 px).** Section-scale panels holding multiple paragraphs and their own sub-headings — the executive summary is the canonical case, and even there `--space-6` is often enough.

**Check.** If the visible coloured background around the text takes up more area than the text itself, drop one tier and re-check. Single-value tiles and short banners nearly always trip this; prose-heavy boxes almost never do.

### Section header

Topical eyebrow (`DIAGNOSIS`, `ZOOM-IN`, `OUTPUT KPIs`), `--fs-h1` `--fw-bold` navy title, optional one-sentence deck. 3 px teal accent bar (24 px long) above the title. For a strong topic change, use a full-bleed navy or teal band with eyebrow + title reversed to white. No logo on the band.

**Eyebrow is topical, not serial.** Label the section by *what it is*, not its position. Do not number sections (`SECTION 01`, `SECTION 02`) unless the caller asks or the report is long enough (10+ sections, or a formal brief) to be navigated by number.

### KPI / stat tile row

Grid of 3–4 tiles. White on `--border`, `--radius-xl`, `--shadow-xs`. Padding `--space-4` (16 px); `--space-3` (12 px) if a tile is just label + value. Each tile has three slots in fixed order: **eyebrow**, **value**, **support** (delta and/or footnote).

A tile row is a row, not three independent cards. Resolve these rules from the actual strings before writing the HTML, not by eye afterwards.

**1. One value size for the whole row, set by the longest value.** Value is `--fw-extrabold` `--hub-blue`. Size each by rendered character count, then **apply the smallest that any tile requires to every tile**:

| Characters | Three-up | Four-up |
|---|---|---|
| ≤ 4 | 40 px | 32 px |
| 5 | 40 px | 28 px |
| 6 | 32 px | 28 px |
| 7 | 32 px | 24 px |
| 8–9 | 28 px | demote |
| 10 | 24 px | demote |
| 11+ | demote | demote |

Count everything that renders (`~100%` is 5; `GHS 1,240.50` is 12). A row of `7,979+` (6) and `48%` (3) renders both at 32 px — matched weight across the row beats maximum size on one tile. A four-up tile cannot carry 40 px at all.

**2. The value never wraps, and an over-long one will not tell you.** A value is one unbroken token, so it has no break opportunity: Chromium does not wrap it, it **overflows** — a 12-digit value at 40 px lays out 325 px wide in a 172 px tile, printing across the next card, with no error and nothing that looks wrapped. Demote per rule 4; never shrink past the last rung.

**3. Slots share baselines across the row.** Take the largest eyebrow line-count in the row and set it as an explicit `min-height` on every eyebrow; same for the support row. Otherwise a one-line label lifts its value above its neighbours'. Subgrid is the cleaner way to express this in a browser that supports it — `min-height` is the safe default that works everywhere.

Eyebrows are uppercase at 0.18em tracking, so they run wide: **17 characters per line three-up, 12 four-up**. Plan line counts from those, not from how short the string looks. Unlike the value, an eyebrow breaks at spaces and wraps rather than overflows.

**4. If the value is not a measurement, it is not a KPI tile.** The slot takes a number, or a short categorical value that behaves like one (status, tier, class, grade). Anything longer goes to the footnote, with the real metric or `—` in the slot. If no tile in the row has a measurement, use a callout, a table, or prose.

**5. Slots are uniform across the row.** Deltas on every tile or none; same for footnotes.

**6. The row is atomic across pages.** Give the container `.kpi-row` and each tile `.kpi-tile` — both are in the print CSS avoid-break list. Protecting only tiles still lets the row break between them, stranding a tile or its support line overleaf.

**Delta spec.** `--fs-small`, `--success`/`--danger`, inline up/down arrow SVG in `currentColor`. It means a signed period-over-period change, arrow matching the sign. If the value already *is* the change (`~100%` YoY), there is no delta — the qualifier is a footnote. Never use the slot or its arrow as a caption.

**Measured at** A4 / 20 mm with Sora: 172 px inside a three-up tile, 117 px four-up, at `--space-4` padding and 16 px gap, worst case being widest-digit and uppercase. Change padding, gap, tile count or page size and re-measure.

### Body prose

One column, `max-width: var(--page-max)`, `--fs-body` / `--lh-body`, `--text-primary`. Lead paragraphs use `--fs-lead`. Blockquotes: 3 px teal left border, `--text-secondary` italic — reserve for direct source quotes, not pull-quotes.

**Bulleted lists.** Never the browser default disc. Bullet is a small 11 × 11 px `--hub-teal` square, 3 px radius, to the left of each item. `--space-2` between items, `--space-5` left padding.

```css
ul.hubtel { list-style: none; padding: 0; margin: var(--space-3) 0 var(--space-4); }
ul.hubtel li { position: relative; padding-left: var(--space-5); margin-bottom: var(--space-2);
  font-size: var(--fs-body); line-height: var(--lh-body); color: var(--text-primary); }
ul.hubtel li::before { content: ""; position: absolute; left: 0; top: 9px;
  width: 11px; height: 11px; border-radius: 3px; background: var(--hub-teal); }
```

**Numbered steps — the `num` badge.** For "Step 1 · Step 2 · Step 3" content — process, ordered principles, ranked recommendations — use the shared badge: 32 × 32 circle, `--hub-teal` fill, bold white number. Never a plain "1." in body text where a badge is warranted.

```css
.num { width: 32px; height: 32px; border-radius: 9999px; background: var(--hub-teal);
  color: var(--white); display: inline-flex; align-items: center; justify-content: center;
  font-weight: var(--fw-extrabold); font-size: 15px; flex: none; }
```

### Callout

`--surface-wash` background, `--radius-lg`, small teal icon top-left. For "why this matters", methodology notes, definitional asides. Variants: `.callout--warning` (saffron wash), `.callout--danger` (red-50 wash), `.callout--info` (blue-50 wash).

**Padding by content.** 1–2 sentences: `--space-5` (Standard). Paragraph or more, or callout with title + body: `--space-6` (Comfortable). One-line banner-style callout: `--space-4` (Standard tight).

### Zoom banner / highlighted beat

Short full-width strip flagging "we're about to zoom in on X" — HUB_BLUE (navy) or HUB_TEAL fill, eyebrow + one-line heading in white. `--radius-lg`, `padding: var(--space-4) var(--space-6)` (Standard). Do not push to `var(--space-6)` on both axes — 2 lines of content leaves obvious empty coloured band above and below.

### Statement — assertion + evidence

Section-scale beat pairing one bold claim with a short proof list. Two columns on white:

- **Left:** large `--hub-teal` sentence at `40px` `--fw-extrabold`, `letter-spacing: -0.02em`. One line, at most two.
- **Right:** bordered evidence list — 1.5 px teal border, `--radius-xl`, `padding: var(--space-6)`. Inside, 4–6 items each with a 24 × 24 teal circle (white checkmark) beside `--fs-body` `--text-secondary` text.

For manifesto beats that need proof beside them. Not prose sections.

### Framing cards — triads of concepts

Three coloured cards on a `--surface-wash` background, `--radius-xl`, `overflow: hidden`. Each has three internal sections:

- **Top strip** — headline, `padding: var(--space-5) var(--space-4)`, 18 px ExtraBold `--white`, centred.
- **Mid strip** — sub-label, `padding: var(--space-2) var(--space-4)`, 13 px bold white on `rgba(0,0,0,0.2)`, centred.
- **Body** — `padding: var(--space-5) var(--space-4)`, 14 px 92% white.

Colours in order: `--hub-teal`, `--hub-blue`, `--hub-red`. Optional footnote row beneath in `--fs-small` `--text-secondary`. For triads with both label and body — three risks, three principles, three tracks.

### Colour panels — tall coloured columns

Same triad idea, "brochure" feel. Three tall panels on `--surface-wash`, `--radius-lg`, min-height 320 px, `padding: var(--space-6)`. Inside each:

- Rounded pill label centred at top — 1.5 px 65% white border, `--radius-full`, `padding: var(--space-2) var(--space-6)`, 16 px `--fw-extrabold`, `letter-spacing: 0.03em`.
- 15 px bold 90% white subtitle beneath.
- Two body paragraphs at 14.5 px 90% white.

Colours: `--hub-teal`, `--hub-blue`, `--hub-red`. For section-scale content where each panel is a small essay.

### Pillars — coloured panels with number badges

Three or four large coloured panels, `--radius-2xl`, min-height 340 px. Floating 56 px white circle badge on top with the panel's colour number inside. Inside: 24 px ExtraBold white H3, dark-overlay strip (`rgba(0,0,0,0.17)`, 19 px ExtraBold white), body paragraph (14.5 px 92% white). Colours in order: teal / navy / saffron / red. For triads or quads with a natural numerical order.

### Two tracks + note

Two side-by-side outlined cards with a shared conclusion beneath. Each: 1.5 px teal border, `--radius-xl`, white fill, `--hub-teal` header strip (16 × 24 px padding, 19 px ExtraBold white centred, "Track A · Title"), teal 15 px bold subtitle, 14.5 px `--text-secondary` body. Beneath: full-width teal note banner — `--radius-lg`, 16 × 24 px padding, 15 px SemiBold white centred. For either/or content where both tracks are legitimate.

### Table

Sora, `--fs-small` / `--lh-small`. `border-collapse: collapse`. Header: `--fw-semibold`, `--text-secondary`, `--surface-subtle` background. Body rows: `--text-primary`, `border-bottom: 1px solid var(--border)`. Numeric columns `text-align: right`, `font-variant-numeric: tabular-nums`. No vertical rules. Zebra stripe only if >15 rows, using `--surface-subtle`.

**Cells hold plain text or one small inline tag — nothing more.** A tag is a rounded rectangle (`--radius-full`, `padding: 2px 8px`, `--fs-eyebrow`, one accent colour) for status/category. Do **not** put stat-circle badges, decorated numbers, or absolutely-positioned decorative shapes inside a cell — they size independently of the column width and overlap adjacent cells. If a value warrants a big-number badge, move it to a KPI tile row above or below the table.

**Column widths must be explicit for tables with 4+ columns.** `table-layout: fixed` on the table plus explicit `width` on each `<col>` (percent or fixed). Without this, columns auto-size from content and any cell with a wider inline element steals width from its neighbours.

```html
<table class="hubtel">
  <colgroup>
    <col style="width: 22%">
    <col style="width: 14%">
    <col style="width: 14%">
    <col style="width: 10%">
    <col style="width: 40%">
  </colgroup>
  <thead>…</thead>
  <tbody>…</tbody>
</table>
```

**Column count.** A4 portrait comfortably fits 4–5 columns of body-text width. Beyond that, columns get too narrow to read. If the data needs 6+ columns, transpose, split into two tables that share a key column, or move that section to landscape. Cramming 7 onto A4 always reads badly.

### Multi-column diagrams — headers and columns must share one grid

Any custom layout where a header row sits above a row of columns — process diagram, role-vs-stage matrix, category-header split, swim diagram — put **both rows in one CSS grid**, not two separate flex/grid containers. If the header row is one `display: flex` and the content row is another, their widths compute independently and drift by pixels on the left, whole column-widths on the right — which is what makes column headers sit off-centre relative to their content.

```html
<div class="process-grid">
  <div class="col-header">DETECTION</div>
  <div class="col-header">VALIDATE &amp; PRIORITISE</div>
  <div class="col-header">EXECUTION</div>
  <div class="col-header">OUTPUTS</div>
  <div class="col-body">…</div>
  <div class="col-body">…</div>
  <div class="col-body">…</div>
  <div class="col-body">…</div>
</div>

<style>
.process-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  column-gap: var(--space-4);
  row-gap: var(--space-3);
}
.col-header {
  font-size: var(--fs-eyebrow);
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--text-secondary);
  text-align: center;
  font-weight: var(--fw-semibold);
}
</style>
```

If a header spans more than one column, use `grid-column: span 2` — don't leave it to accidental flex/auto sizing.

### Diagrams — inventory the source, then pick the substrate

Two substrates, for consistency with `hbtl-html-report` and build determinism:

- **`.process-grid`** (HTML + CSS) — use when every row has the same number of cells and every arrow runs between adjacent cells: role-vs-stage matrix, two-column comparison, swim-lane, linear process.
- **Inline SVG** — everything else.

*Everything else* means any of: a node branching to 3+ children, an arrow that skips a row or spans columns, a diagonal connector, parallel tracks that fork and rejoin, a rejoin pulling from two different rows, a node sitting between rows. Forced into `.process-grid`, these put nodes in the wrong row, drop arrows, and leave orphaned "/" characters between cells.

When recreating an existing diagram — from a PDF, image, whiteboard photo or pasted slide — list the following before drawing anything. Item 3 decides the substrate; item 4 becomes the SVG coordinates.

1. **Every node** — label, row and column, fill and border colour, bottleneck / success / danger / neutral highlight.
2. **Every edge** — start, end, solid or dashed, label, curved or bent.
3. **The topology** — forks, rejoins, parallel tracks, loopbacks into earlier rows.
4. **The spatial grid** — row and column count; which cells are occupied and which are deliberately empty. The empty cells carry the source's balance.

### Inline SVG diagrams — width, viewBox, node spacing

- **Width `100%`, never fixed pixels.** Author every `<svg>` as `<svg viewBox="0 0 W H" width="100%" style="max-width: 100%; height: auto;">`. `viewBox` carries aspect; `width: 100%` fills the ~170 mm content column at A4 20 mm margins. A `width="600"` diagram renders at ~60% of the column with labels below the `--fs-small` minimum.
- **No bounding-box overlaps.** Walk the node list before shipping; no two `<rect>` (or `<foreignObject>`) rectangles intersect, no arrow path crosses a label. Minimum clearance between nodes is `--space-4` (16 px) horizontally and vertically, edge-to-edge.
- **Sketch a positional grid before drawing.** Which nodes on row 1, row 2, row 3; which columns; where forks and rejoins happen. Assign coordinates from the grid. Free-hand placement without this is why SVG diagrams overlap.
- **`var()` and inherited CSS both work fine on paint attributes and `<text>` here** — use whichever is more convenient.

### Custom diagrams — minimum sizes and legends

**Minimum text size inside any diagram is `--fs-small` (13 px).** Labels, arrow annotations, node captions, legend text — everything.

**Minimum node padding is `--space-2` (8 px), `--space-3` (12 px) preferred.**

**Legend spec** (any diagram whose meaning depends on colour, line style, or shape must have one, below the diagram, left-aligned):

- Text: `--fs-small` (13 px), `--text-secondary`.
- Swatches: 12 × 12 px, `--radius-sm` (6 px).
- Gap swatch → label: `--space-2` (8 px). Gap between items: `--space-4` (16 px), wrap if the row exceeds diagram width.
- Optional "LEGEND" eyebrow prefix: `--fs-eyebrow`, `--text-tertiary`, uppercase, followed by `--space-4`.

```html
<figure class="diagram">
  <svg viewBox="…">…</svg>
  <figcaption class="diagram__legend">
    <span class="lg-eyebrow">LEGEND</span>
    <span class="lg-item"><span class="lg-sw" style="background: var(--hub-blue)"></span>Bottleneck</span>
    <span class="lg-item"><span class="lg-sw" style="background: var(--white); border: 1px solid var(--border)"></span>Neutral</span>
    <span class="lg-item"><span class="lg-sw" style="background: var(--success)"></span>Success</span>
    <span class="lg-item"><span class="lg-sw" style="background: var(--danger)"></span>Failed</span>
    <span class="lg-item"><span class="lg-line"></span>Recovery path</span>
  </figcaption>
</figure>

<style>
.diagram { width: 100%; }
.diagram > svg {
  width: 100% !important;
  height: auto !important;
  max-width: 100% !important;
  display: block;
}
.diagram__legend {
  display: flex; flex-wrap: wrap; align-items: center;
  gap: var(--space-4); margin-top: var(--space-4);
  font-size: var(--fs-small); color: var(--text-secondary);
}
.lg-eyebrow { font-size: var(--fs-eyebrow); letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase; color: var(--text-tertiary); }
.lg-item { display: inline-flex; align-items: center; gap: var(--space-2); }
.lg-sw { width: 12px; height: 12px; border-radius: var(--radius-sm); display: inline-block; }
.lg-line { width: 24px; height: 0; border-top: 2px dashed var(--text-secondary); display: inline-block; }
</style>
```

**Figure caption goes below the legend, not above.** Use `<figcaption>` for accessibility. Format: `Figure C.` in `--fw-bold` `--text-primary`, then a one-sentence description in `--text-secondary`. Never inside the diagram itself.

## The wave motif

Signature soft undulation, not a quarter-circle. Same shape as the deck template so the formats stay one system.

**Size it in CSS, with `display: block`.** An inline `<svg>` given no size, or a percentage width plus a `height` attribute, is laid out at full width × its viewBox aspect (2.80) — measured, that is **232.9 px tall** in a 642 px column whatever height you asked for. `display: block` removes a further 3.8 px of inline baseline gap.

```html
<!-- Horizontal band. Height is set in CSS, never as an attribute. -->
<svg class="wave wave--band" viewBox="0 0 115.2 41.12" preserveAspectRatio="none" aria-hidden="true">
  <path d="M115.2,0v38.15c-17.18,1.75-37.01,2.97-57.6,2.97s-40.42-1.22-57.6-2.97V0h115.2Z"
        fill="rgb(0,153,153)"/> <!-- teal -->
</svg>
```
```css
.wave { display: block; width: 100%; }
.wave--band { height: 150px; }
```

| Markup | Rendered height |
|---|---|
| no width/height | 232.9 px |
| `width="100%" height="150"` attributes | 232.9 px |
| `style="width:100%;height:150px"` | 153.8 px |
| `.wave { display:block; width:100% }` + `height:150px` | **150.0 px** |

Recolour `fill` per accent — `rgb(0,153,153)` teal (default), `rgb(8,46,77)` navy, `rgb(255,204,8)` saffron, `rgb(239,73,35)` red, or `fill="var(--hub-teal)"` etc. — both work under this renderer. Never modify the path, rotate, or skew.

**One placement: `wave--band`, 140–170 px**, full-width behind a full-bleed section header. The range is not free choice. Below it the motif stops reading: `preserveAspectRatio="none"` squashes the undulation with the box, so a 150 px band shows 10.8 px of curve across 642 px, a 96 px band shows 6.9 px — visually a rectangle. Above it the band eats the page: 150 px is 15% of A4's 971 px content height.

**Once per document**, at a genuine topic change. A PDF already separates sections with the page break and the section header's own accent bar, so a wave used as a repeating divider is paying 15% of a page for decoration. Never behind body text, never on the masthead, never stacked.

## Icons

Line icons from Untitled UI. Inline as SVG; do not link to icon fonts. Common ones: **wallet / credit-card** (payments), **line-chart-up / bar-chart** (growth, KPIs), **users** (customers), **globe** (reach), **shield** (trust, compliance), **zap** (speed), **settings** (operations), **send** (outbound), **gift** (rewards), **star** (highlights).

Default spec: `width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"` — as attributes, as CSS, or a mix of both; this renderer honours either. If you don't have the exact glyph, draw a clean geometric version at that spec — never an emoji or filled shape.

## Charts

### Form heuristic — pick the chart type by the question

- **How does X change over time?** → line chart. Sparkline for a one-line-inside-body figure; full line chart for a section headline.
- **Which category is biggest?** → bar chart. Horizontal bars when category labels are long; vertical when time-ordered.
- **How does X divide?** → stacked bar. Avoid pie unless there are two or three slices with clearly different sizes.
- **How are two variables related?** → scatter.
- **What's the distribution?** → histogram or a small box plot. Don't put both on one page.
- **How does it rank?** → sorted bar chart, largest at top.
- **Is it above or below target?** → bullet chart or a bar with a target line overlaid, not two charts.
- **One number, right now** → a KPI tile, not a chart. One number with a trend gets a sparkline inside the tile.

When two chart types would work, pick the simpler one. A stacked area over three points is a stacked bar.

### Mark specs

- **Bars.** Minimum width 12 px. Rounded top corners `--radius-sm` (6 px) only. `--space-2` between adjacent bars, `--space-4` between groups (≈25% of bar width between bars, ≈100% between groups).
- **Lines.** 2 px stroke, rounded caps, monotone-x interpolation for time-series. No markers on dense series; `r=3` on sparse (≤12 points).
- **Areas.** Same hue as the line at 12% opacity. Never stacked areas beyond three series.
- **Points (scatter).** `r=4` to `r=6`, 50% opacity when overlap is common.
- **Text labels on marks.** Minimum 11 px, sentence case. Label only the values the reader must know exactly (max, min, latest); labelling every bar creates noise.

### Palette

**Categorical (in order).**

```
1  --hub-teal          rgb(0,153,153)   primary series
2  --hub-blue          rgb(8,46,77)     secondary comparison
3  --hub-saffron       rgb(255,204,8)   highlighted "our number" / CTA
4  --hub-red           rgb(239,73,35)   negative outcome
5  --hub-teal-accent   rgb(1,199,177)   fifth
6  --slate-600         rgb(129,149,166) sixth / catch-all
```

Six categories ceiling; group rest into "Other". Feed these literal values (or the matching CSS variable — either works here) into whichever renderer draws the chart — never a library's default palette.

**Sequential (single-hue).** Teal ramp `teal-50 → teal-100 → teal-200 → teal-500 → teal-600 → teal-700`. Navy ramp: mix `--hub-blue` with white at 90/70/50/30/10%.

**Diverging.** `--hub-red` (low) → `--slate-100` (zero) → `--hub-teal` (high). Hubtel red always reads as loss/attention — do not put red on the positive side even when convention would.

**Semantic (fixed meanings — never reuse).** `--success` positive/above target · `--danger` negative/below target · `--warning` on-hold · `--info` neutral info.

### Chart defaults

- **Type.** Sora, `--fs-small` axis labels, `--fs-eyebrow` UPPERCASE axis titles with `--tracking-eyebrow`, `--text-secondary`. Chart title above the plot as `--fs-h3` `--fw-semibold` `--text-primary`; one-line subtitle `--fs-small` `--text-tertiary`.
- **Gridlines.** Horizontal only, `--border`, 1 px. No vertical grid, no chart border.
- **Axis.** Baseline `--border-strong` 1 px, tick labels `--text-tertiary`. Y-axis starts at zero for magnitudes; a broken axis must be labelled `↯` and mentioned in the caption.
- **Legend.** Below plot, left-aligned, `--fs-small`, `--text-secondary`, swatches 10 × 10 px `--radius-sm`. Skip for one-series charts.
- **Numbers.** GHS values `GHS 1,240.50` on axes and tooltips. Percentages with one decimal only when precision matters (`54.3 %`), else whole (`54 %`). Large counts as `k`/`m` on axes but full numbers in tooltips.

### Accessibility

- **Never encode meaning by colour alone.** Add a shape, data label, pattern, or annotation — a colour-blind reader, and anyone printing in black-and-white, must be able to tell "above target" from "below target" without seeing green vs red.
- **Contrast.** Text on any coloured fill meets WCAG AA (4.5:1). Data labels on light backgrounds use `--text-primary`; on dark fills use `--white`.
- **Alt text on chart images.** Describe the *finding*, not "chart of X". Good: "Weekly signups climbed from 320 to 540 across September, biggest jump in week 3." Bad: "Line chart showing signups over time."

### Static rendering, and the hover defaults that survive it

Default to static charts — hand-authored inline SVG (fine for bar, line, and simple scatter), or a server-side library rendered to PNG/SVG and embedded as a data URI `<img>`. A JS charting library works here if the caller already has one wired up (**C4**).

Tooltips never fire in a static PDF render, but the visual defaults still apply if a chart is drawn with a static "highlighted" state: tooltip is `--surface-inverse` (navy) fill, `--text-on-brand` text, `--radius-md`, `--shadow-md`, `--space-3` padding. Keyboard focus rings and click-to-drill-down are HTML-only concerns — ignore them here.

---

## PDF-specific rules

### Page size — A4, 20 mm margins

A4 portrait (210 × 297 mm), **20 mm on all sides** → 170 mm content width, 257 mm content height. Matches `--print-pad: 20mm` in the token block. Set via the Playwright API (**C5**), not `@page` CSS. US Letter only if the caller explicitly asks for a US audience.

### Page breaks — print CSS

Add this block near the end of the report's `<style>`. **Tables split across pages with the `<thead>` repeating** — that stops the "section heading alone on a mostly-empty page above a table" symptom.

```css
@media print {
  /* Focus boxes and heavy blocks — never split. The KPI row is listed  */
  /* as a whole (.kpi-row) as well as per tile: protecting only the     */
  /* tiles still lets the row break between them, stranding a tile —    */
  /* or a tile's support line — on the next page.                       */
  .summary-panel, .horizon-tile, .target-tile, .callout, .zoom-banner,
  .evidence-strip, .statement, .framing-card, .colour-panel, .pillar, .two-track,
  .diagram, .kpi-row, .kpi-tile {
    break-inside: avoid;
    break-inside: avoid-page;
  }

  /* Long tables split with a repeating <thead>. */
  table.hubtel        { break-inside: auto; }
  table.hubtel thead  { display: table-header-group; }
  table.hubtel tfoot  { display: table-footer-group; }
  table.hubtel tr     { break-inside: avoid; }

  /* Headings and section-intro banners stick to what follows. Include the      */
  /* banner itself, not just its inner eyebrow/title: break-after on a child     */
  /* only binds to its next sibling inside the same parent, so a banner block    */
  /* needs its own rule to stick to the paragraph beneath it. Anything else      */
  /* that must stick to the block after it gets .keep-with-next by hand —        */
  /* likewise .lead-in on a paragraph introducing a list, diagram or table.      */
  h1, h2, h3, .section__title,
  .zoom-banner, .zoom-banner__eyebrow, .zoom-banner__title,
  .section-header, .section-header__eyebrow, .section-header__title,
  [class*="eyebrow"],
  .keep-with-next, .lead-in {
    break-after: avoid;
  }
  h1, h2, h3 { orphans: 3; widows: 3; }

  ul, ol { break-inside: auto; }
  li     { break-inside: avoid; }

  .section { break-before: auto; }
}
```

Chromium's print engine reads the modern `break-*` properties natively and consistently, so there's no need to double them up with the legacy `page-break-*` aliases the way the old WeasyPrint version of this skill did.

**If a focus box still splits**, the culprit is almost always a nested flex/grid child that fragments separately. Two mitigations:

1. Wrap in `<div style="break-inside: avoid;">` — the wrapper becomes a block-level fragment container.
2. Last resort: hard `break-before: page;` on the element when you know exactly where it should land. Manual override, not the default.

**If a banner or lead-in still orphans** (usually a very long first paragraph), wrap it and the first content block in a `<div class="keep-together">` with `break-inside: avoid;`. Use sparingly.

### Content-to-footer clearance

The 20 mm bottom margin holds both the running footer and any spillover from the page's last block.

**Footer ≤ 12 mm.** Text at 9 pt plus ~2 mm padding either side puts the footer at ~12 mm; the remaining ~8 mm is the visible gap between the last line of content and the footer. Do not add taller text or extra lines in the footer template — they eat the gap.

**No single diagram, table, or focus box exceeds one page's content area (257 mm).** When Chromium finds a `break-inside: avoid` block taller than the remaining page, it pushes the whole block to the next page — and if the block is taller than a full page it overflows the bottom margin and clips.

```css
@media print {
  .diagram, .process-grid, .framing-cards, .colour-panels, .pillars, .two-tracks {
    max-height: 240mm;
  }
  /* table.hubtel is NOT here — it splits across pages via the rules
     above, so max-height would just clip the last row. */
}
```

If a diagram or table would exceed 240 mm, restructure — split into two smaller diagrams with a normal break between, or reduce content density.

### Running footer

The running footer is the only element that repeats on every page. It is produced by Playwright's header/footer templates (**C1**), not CSS — pass both to `page.pdf()`:

```python
FOOTER_TEMPLATE = """
<div style="width:100%; font-size:9px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
            color:#819AA6; padding:0 20mm; display:flex; justify-content:space-between;">
  <span>{report_title}</span>
  <span>Page <span class="pageNumber"></span></span>
</div>
"""
```

- **Left:** report title, interpolated into the template string at build time — not the template's special `title` class, which pulls from the document's `<title>` tag instead and can drift from what's wanted on the page.
- **Centre:** `Page N`, via the template's built-in `<span class="pageNumber"></span>` — plain, not zero-padded, not "of M" unless asked.
- **Right:** empty by default (see **Placement and sizing** above).

`header_template` is required even when empty — pass `"<div></div>"`, or Chromium shows its own default header (URL and date).

No in-page `.report-footer` element to suppress — the running footer does the whole job. (`hbtl-html-report`'s in-page footer with a 24 px wordmark belongs to a document read on screen; no equivalent here.)

### Cover page — opt-in

By default the PDF opens with the masthead on page 1. Add a dedicated cover only when the caller asks for one, or for a formal brief (board pack, HOD brief, external report) where a cover is the convention.

```html
<section class="pdf-cover">
  <img class="pdf-cover__logo" src="{colour data URI}" alt="Hubtel">   <!-- height: 48px in CSS -->
  <h1>{report title}</h1>
  <p class="lead">{one-line subtitle}</p>
  <div class="meta"><span>{author or team}</span><span>{date}</span></div>
</section>
```

Full-bleed (`min-height: calc(100vh - 48mm)`), centred vertically, `background: var(--surface)` (white) or `var(--surface-wash)` (teal-50). Title uses `--fs-cover` `--fw-extrabold` navy. Wordmark top-left at 48 px.

**Suppressing the footer on the cover needs a second render pass, not a CSS class.** `display_header_footer` applies to a whole `page.pdf()` call, not to one section — no "no footer on page 1 only" switch exists. Instead:

1. Render the cover alone, as its own one-page document, with `display_header_footer=False`.
2. Render the masthead-onward body as its own document, with `display_header_footer=True` and the footer template above.
3. Merge the two PDFs into one file, cover first (`pypdf.PdfWriter`).

Side effect, for free: the body's `pageNumber` counter starts at 1 on its own first page, so the cover is naturally unnumbered. See the build recipe below.

`min-height: calc(100vh - 48mm)` resolves against the page box as in any browser print preview. If the cover spills to a second page, reduce the content rather than chasing the units.

## The build recipe

Requires Playwright with its bundled Chromium and `pypdf` for the cover/body merge. Same two commands on macOS and Windows — Playwright's own installer downloads a matching Chromium build for whichever OS it's run on, so there's no platform branching to write:

```
pip install playwright pypdf
playwright install chromium
```

Skip the second line if Chromium is already present (it is in most dev-machine setups where Playwright has been used before) — `playwright install chromium` is a no-op if the matching build is already cached, so it's harmless to run anyway when unsure.

Three steps: write the HTML (one document if there's no cover, two if there is), render each with Playwright, merge if there were two.

```python
import os
from playwright.sync_api import sync_playwright
from pypdf import PdfWriter, PdfReader

PAGE_OPTS = dict(
    format="A4",
    margin={"top": "20mm", "bottom": "20mm", "left": "20mm", "right": "20mm"},
    print_background=True,   # C3 — without this every background is white
)

def footer_template(report_title):
    safe = (report_title or "").replace("<", "&lt;").replace(">", "&gt;")
    return f"""
    <div style="width:100%; font-size:9px; font-family:-apple-system,BlinkMacSystemFont,
                'Segoe UI',sans-serif; color:#819AA6; padding:0 20mm;
                display:flex; justify-content:space-between;">
      <span>{safe}</span>
      <span>Page <span class="pageNumber"></span></span>
    </div>
    """

def render_pdf(page, html_string, out_path, *, header_footer, report_title=None):
    page.set_content(html_string, wait_until="networkidle")
    # C4 — belt-and-braces wait for web fonts before the render.
    page.evaluate("document.fonts.ready")
    kwargs = dict(PAGE_OPTS)
    if header_footer:
        kwargs.update(
            display_header_footer=True,
            header_template="<div></div>",
            footer_template=footer_template(report_title),
        )
    else:
        kwargs["display_header_footer"] = False
    page.pdf(path=out_path, **kwargs)

def build_pdf(body_html, output_path, report_title, cover_html=None):
    cwd = os.getcwd()
    body_path = os.path.join(cwd, "_hubtel_pdf_body_tmp.pdf")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        render_pdf(page, body_html, body_path, header_footer=True, report_title=report_title)

        if cover_html:
            cover_path = os.path.join(cwd, "_hubtel_pdf_cover_tmp.pdf")
            cover_page = browser.new_page()
            render_pdf(cover_page, cover_html, cover_path, header_footer=False)
            cover_page.close()
        browser.close()

    if cover_html:
        writer = PdfWriter()
        for path in (cover_path, body_path):
            reader = PdfReader(path)
            for pg in reader.pages:
                writer.add_page(pg)
        with open(output_path, "wb") as f:
            writer.write(f)
        os.remove(cover_path)
        os.remove(body_path)
    else:
        os.replace(body_path, output_path)

    print("wrote:", output_path, os.path.getsize(output_path), "bytes")
```

Call it from the build:

```python
build_pdf(
    body_html=html_ready,          # masthead onward, including the token <style> block
    output_path=os.path.join(os.getcwd(), "hubtel-q3-review.pdf"),
    report_title="Q3 operating review",
    cover_html=cover_html_or_None, # pass the cover section's own full HTML doc, or omit
)
```

This replaces the old WeasyPrint adapter entirely — no safety-net pass for `var()`, icon defaults, or `gap`, because the renderer doesn't need one (see renderer constraints, above). One thing still worth checking before calling `build_pdf()`: no unrendered diagram-library placeholder (e.g. `<pre class="mermaid">`) survives into the HTML unless the build actually waited for it to finish (**C4**).

```python
def sora_face_css():
    """Embed Sora as base64 @font-face. Same four weights as before — just no
    longer wrapped in a WeasyPrint-specific adapter step; paste this CSS
    directly into the report's own <style> block."""
    import base64, urllib.request
    SORA_URL = ("https://raw.githubusercontent.com/sora-xor/sora-font/"
                "master/fonts/ttf/Sora-{}.ttf")
    WEIGHTS = {400: "Regular", 600: "SemiBold", 700: "Bold", 800: "ExtraBold"}
    cache = os.path.join(os.path.expanduser("~"), ".cache", "hubtel-sora")
    os.makedirs(cache, exist_ok=True)
    faces = []
    for weight, name in WEIGHTS.items():
        path = os.path.join(cache, f"Sora-{name}.ttf")
        if not os.path.exists(path):
            with urllib.request.urlopen(SORA_URL.format(name), timeout=30) as r:
                data = r.read()
            if len(data) < 10_000:
                raise RuntimeError(f"Sora-{name}.ttf download looks truncated")
            open(path, "wb").write(data)
        b64 = base64.b64encode(open(path, "rb").read()).decode()
        faces.append(
            f'@font-face{{font-family:"Sora";font-weight:{weight};'
            f'src:url(data:font/ttf;base64,{b64}) format("truetype");}}'
        )
    return "\n".join(faces)
```

Paste the returned CSS into the report's `<style>` block alongside the token block, before calling `build_pdf()`. The cache path uses `os.path.expanduser("~")`, which resolves correctly on both macOS and Windows — don't hardcode either form. No network on this machine? Drop the four TTFs into that resolved folder once and the function picks them up without touching the network again.

## Delivery

**Write the PDF once, into the current working directory, and never move it.** Copying or relocating can break the hand-off to the user. Resolve the path at runtime (`os.getcwd()`) rather than hardcoding one:

```python
filename = "hubtel-q3-review"          # kebab-case slug of the report title
out_path = os.path.join(os.getcwd(), f"{filename}.pdf")
build_pdf(html_ready, out_path, "Q3 operating review", cover_html=cover_html_or_None)
```

The slug takes no spaces, no dates unless the title has one, no version suffix, and no subdirectory. Under ~20 KB usually means the render half-failed.

**The final step is handing the finished PDF back to the user through whatever this environment's file-delivery mechanism is.** Nothing runs after it. Don't display the intermediate HTML separately — it's an implementation detail.

**Disclosure — required.** One line: *"Rendered with headless Chromium (Playwright). Flowcharts are inline SVG; the wordmark appears on the masthead rather than the running footer."*

## What this skill does not do

- **Analytical voice, structure, depth** — from the caller.
- **Numbers.** Never invent a stat or KPI. Leave `—` and mark tiles `data-pending`.
- **Copy Bank lines.** Separate asset, marketing/pitch use only.

## Embedded logo block

Copy the data URI from inside the parentheses into `src`.

![HUBTEL WORDMARK — COLOUR — copy the data URI inside the parentheses into src=](data:image/png;base64,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)
