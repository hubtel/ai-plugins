---
name: hbtl-pptx-report
description: "Use this skill whenever the user asks for a Hubtel-branded PowerPoint presentation or slides — including phrases like hubtel powerpoint, hubtel power point, hubtel slides, hubtel slide, hubtel presentation, hubtel slides presentation, hubtel slide presentation, Hubtel-branded PPTX, slide deck, pitch deck, exec deck, board deck, or any deliverable rendered as a .pptx that must look and feel like Hubtel. Covers only the visual/design layer: the palette, Sora typography, spacing, the wave motif, logo/icon usage, chart palette, and a set of slide layouts. Does NOT prescribe the deck's analytical voice, argument, section order, or depth — that stays with the caller or whichever content skill drives the deck."
metadata:
  author: "Hubtel Enablement Team"
  version: "1.1.0"
  date_added: 2026-11-06
  last_updated: 2026-11-06
compatibility: Requires Python with python-pptx, Pillow, cairosvg, and fonttools. Designed for Hubtel engineering projects.
---

# Hubtel PPTX report (`/hbtl-pptx-report`)

## Invocation

```text
/hbtl-pptx-report
```

Slash is optional. Also activate this skill when the user asks in natural language for Hubtel slides or a PowerPoint deliverable — for example: hubtel powerpoint, hubtel power point, hubtel slides, hubtel slide, hubtel presentation, hubtel slides presentation, hubtel slide presentation, Hubtel-branded PPTX, pitch deck, exec deck, or board deck.

Dresses a PowerPoint deck in Hubtel's brand. Design layer only — the argument, section order, and depth come from the caller. This skill is self-contained for that: the helper module below covers everything needed to build every layout in this file. It does not re-teach general python-pptx mechanics (masters, layouts, placeholders, runs, shapes, charts) — those are out of scope here because the helpers are built specifically to avoid them (see Non-negotiables: never a built-in layout, never a placeholder).

**Scope.** One editable `.pptx`. Not HTML (`hbtl-html-report`), not PDF (`hbtl-pdf-report`), not Word (`docx`), not spreadsheet (`xlsx`).

## Non-negotiables

- **Deck size 13.333" × 7.5"** (16:9). Set via `new_deck()` in the helper module below.
- **Sentence case** for titles, labels, buttons. UPPERCASE only for the eyebrow kicker.
- **Money format: `GHS 1,240.50`** for Hubtel figures — `GHS` prefix, grouped thousands, two decimals. Never `₵`, `GH¢`, `Ghc`. **Only Hubtel figures** get this treatment: vendor pricing, third-party invoices, and any non-GHS numbers stay in their source currency (`USD 800.00` for Anthropic / Cursor bills, `EUR`/`GBP` as issued). Never restamp `$800` as `GHS 800.00`.
- **No emoji, anywhere.** Meaning is carried by iconography and colour.
- **Line icons only** (see Icons). Never filled shapes, never emoji.
- **Flat white or teal-50 wash** for backgrounds. Colour comes from wave motif, KPI tiles, full-bleed image slots — never page-wide gradients or textures.
- **Wordmark only from the logo blocks at the bottom of this file** (see Logo) — pass the `data:` URI straight to `add_logo`. Never draw or fabricate one.
- **Cover and closing slides carry no footer.** Never call `add_page_footer` on either. Every other slide gets one.
- **Every slide starts with `add_blank_slide(prs)`.** Never use a built-in PowerPoint layout and never touch a placeholder. A placeholder brings the theme's own font, colour and autofit with it, which puts a 44 Pt black Calibri title on a teal band.
- **The cover comes from `add_cover_slide(prs, title, ...)`.** Do not hand-assemble a cover. Pass `logo_color_uri`; a Hubtel cover without the wordmark is not branded. Pass `picture=` when you have an image — it balances the composition against the wave. `picture_slot=True` draws an empty grey placeholder instead, for a template someone will fill by hand, never a finished deck.
- **Every content slide's header comes from `add_slide_header(slide, eyebrow, title)`.** Do not hand-compose `add_wave` + `add_text` for a title. The geometry inside the helper is what keeps the title off the wave.
- **Chrome sizes are fixed; content sizes are yours to set.** Eyebrows, stat-tile labels and page numbers are identical on every slide — the helpers pin them, do not override them. Bullets, card copy, callout text and table cells depend on how much has to fit, so each is a `size=` parameter with a starting default. Raise or lower them per slide. Below about 14 Pt a slide stops being readable from the back of a room; treat that as a sign the slide is carrying too much, not as a reason to keep shrinking.

- **Content lives inside the margins: x from `CONTENT_LEFT` (0.667") to `CONTENT_RIGHT` (12.666"), y from `CONTENT_TOP` (1.95") to `CONTENT_BOTTOM` (6.85").** Take every row's geometry from `columns(n)` — a three-up row is 3.82" per card with a 0.27" gap, and guessing 4.0" pushes the third card off the slide. Fill the band, too: content that stops at 3.5" leaves the slide half empty, so either it is too thin for its own slide or the shapes need to grow.
- **Save the deck with `save_deck(prs, path)`** — this is the only supported way to ship. It embeds Sora; a plain `prs.save(...)` produces a fontless deck.

## How this skill works — helper module

**Before writing any build script**, write the helper module below to `/tmp/hubtel_pptx.py`. Every build script then does `from hubtel_pptx import *` (or names it needs) and calls helpers by name instead of typing out python-pptx primitives.

This is what keeps deck-build scripts short. A stat tile is one line — `add_stat_tile(slide, 0.667, 2.0, 3.5, 1.8, "COMPLETION", "78.3%", delta="+4.5pp")` — instead of the fifteen lines of shape creation, fill, border, text runs, font settings, and shadow-clearing that primitive python-pptx would require. Every design rule (colours, sizes, shadow removal, tabular-figure numerals) is enforced inside the helper, so a build script that uses the helpers cannot accidentally violate the brand.

If a slide needs a shape the helpers don't cover, fall through to raw python-pptx for that shape only — do not reimplement helpers you have.

### The helper module — extract it to `/tmp/hubtel_pptx.py`

Do not retype it. Copy it out of this file with one command, where `$SKILL` is the path to this SKILL.md:

```bash
sed -n '/^# >>> hubtel_pptx begin$/,/^# <<< hubtel_pptx end$/p' "$SKILL" > /tmp/hubtel_pptx.py
```

The `^`/`$` anchors matter: without them the range also matches this very command, and you extract prose instead of code. The sentinels matter too — keying on "the first python code block" breaks silently when the file gains a block or the sections move, yielding a short fragment that imports cleanly with every helper missing. Check the result is ~890 lines and imports; if the sed finds nothing, write the block out verbatim instead.

```python
# >>> hubtel_pptx begin
"""Hubtel PPTX helpers. Import everything you need at the top of any build
script: `from hubtel_pptx import *`. All coordinates and sizes are in inches
unless otherwise noted; that matches python-pptx's Inches() convention."""
import base64, io, os, re, shutil, tempfile, urllib.request, zipfile
from PIL import Image
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from lxml import etree
from pptx.oxml.ns import qn

# ---------- Palette ----------
TEAL         = RGBColor(0,   153, 153)
TEAL_ACCENT  = RGBColor(1,   199, 177)
NAVY         = RGBColor(8,    46,  77)
RED          = RGBColor(239,  73,  35)
SAFFRON      = RGBColor(255, 204,   8)
TEAL_50   = RGBColor(237, 250, 247)
TEAL_100  = RGBColor(204, 243, 239)
TEAL_200  = RGBColor(153, 232, 223)
TEAL_500  = RGBColor(1,   199, 177)
TEAL_600  = RGBColor(0,   153, 153)
TEAL_700  = RGBColor(1,   139, 124)
SLATE_900 = RGBColor(1,     5,   8)
SLATE_700 = RGBColor(61,   82,  99)
SLATE_600 = RGBColor(129, 149, 166)
SLATE_500 = RGBColor(156, 171, 184)
SLATE_300 = RGBColor(195, 208, 219)
SLATE_200 = RGBColor(230, 236, 240)
SLATE_100 = RGBColor(242, 245, 247)
SLATE_50  = RGBColor(250, 251, 252)
WHITE     = RGBColor(255, 255, 255)
SUCCESS   = RGBColor(0,   178, 124)
DANGER    = RGBColor(237,  27,  46)
WARNING   = RGBColor(254, 204,  47)
INFO      = RGBColor(51,  149, 255)

# String → RGB lookup so callers can pass "teal", "navy", etc.
PALETTE = {
    "teal": TEAL, "teal-accent": TEAL_ACCENT, "navy": NAVY, "red": RED, "saffron": SAFFRON,
    "teal-50": TEAL_50, "teal-100": TEAL_100, "teal-200": TEAL_200,
    "teal-500": TEAL_500, "teal-600": TEAL_600, "teal-700": TEAL_700,
    "slate-900": SLATE_900, "slate-700": SLATE_700, "slate-600": SLATE_600,
    "slate-500": SLATE_500, "slate-300": SLATE_300, "slate-200": SLATE_200,
    "slate-100": SLATE_100, "slate-50": SLATE_50, "white": WHITE,
    "success": SUCCESS, "danger": DANGER, "warning": WARNING, "info": INFO,
}
def C(color):
    """Resolve a colour argument that may be a palette name or an RGBColor."""
    if isinstance(color, RGBColor): return color
    if color is None: return None
    return PALETTE[color]

# ---------- Deck & slide setup ----------
def new_deck():
    """Return an empty Presentation sized 13.333" × 7.5"."""
    prs = Presentation()
    prs.slide_width  = Inches(13.333)
    prs.slide_height = Inches(7.5)
    return prs

def add_blank_slide(prs):
    """Add and return a blank layout slide."""
    return prs.slides.add_slide(prs.slide_layouts[6])

# ---------- Shape primitives ----------
def clear_shadow(shape):
    """Remove the theme-inherited shadow by injecting <a:effectLst/>."""
    spPr = shape._element.find(qn("p:spPr"))
    if spPr is None: return
    for el in spPr.findall(qn("a:effectLst")): spPr.remove(el)
    etree.SubElement(spPr, qn("a:effectLst"))

def add_rect(slide, x, y, w, h, *, fill="white", border=None, border_w=1.5,
             radius=True, clear_theme_shadow=True):
    """Rounded rectangle. Radius True → default corner (0.167"); False → sharp."""
    check_bounds(x, y, w, h, "add_rect")
    shape_type = MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE
    shp = slide.shapes.add_shape(shape_type, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill is None:
        shp.fill.background()
    else:
        shp.fill.solid(); shp.fill.fore_color.rgb = C(fill)
    if border is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = C(border); shp.line.width = Pt(border_w)
    if clear_theme_shadow: clear_shadow(shp)
    return shp

def add_ground(slide, fill):
    """Full-bleed coloured ground. Shorthand for the 13.333 x 7.5 sharp rect
    every dark or washed layout opens with."""
    return add_rect(slide, 0, 0, 13.333, 7.5, fill=fill, radius=False)

def add_circle(slide, x, y, diameter, *, fill="teal", border=None, border_w=1.5,
               clear_theme_shadow=True):
    shp = slide.shapes.add_shape(MSO_SHAPE.OVAL,
                                 Inches(x), Inches(y), Inches(diameter), Inches(diameter))
    shp.fill.solid(); shp.fill.fore_color.rgb = C(fill)
    if border is None: shp.line.fill.background()
    else: shp.line.color.rgb = C(border); shp.line.width = Pt(border_w)
    if clear_theme_shadow: clear_shadow(shp)
    return shp

REVERSED = {"white", "teal-100", "teal-50", "teal-200"}

def check_clear_of_band(slide, y, h, color, where):
    """Warn when text collides with a top wave drawn on this slide.

    Two failures, both visible on any deck that hand-composes a header instead
    of calling add_slide_header: text straddling the wave's lower edge (half on
    the band, half on white), and dark text sitting on the band."""
    edge = getattr(slide, "_hub_band_edge", None)
    if edge is None:
        return True
    ok = True
    if y < edge < y + h:
        print(f"WARNING [{where}]: text spans {y:.2f}\"–{y + h:.2f}\" and "
              f"crosses the wave edge at {edge:.2f}\". Keep it above the edge "
              f"or below {getattr(slide, '_hub_band_deep', edge):.2f}\".")
        ok = False
    elif y + h <= edge and color not in REVERSED:
        print(f"WARNING [{where}]: '{color}' text sits on the wave band — use "
              f"a reversed colour (white, teal-100).")
        ok = False
    return ok

def add_text(slide, x, y, w, h, text, *, font="Sora", size=17, bold=False,
             color="slate-900", align="left", anchor="top"):
    """Text box. font accepts 'Sora', 'Sora SemiBold', 'Sora ExtraBold'.
    align: 'left'|'center'|'right'. anchor: 'top'|'middle'|'bottom'."""
    check_clear_of_band(slide, y, h, color, "add_text")
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame; tf.word_wrap = True
    # python-pptx reserves 0.1" left+right and 0.05" top+bottom by default.
    # Every figure in this skill is the full box, so zero them.
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = {"top": MSO_ANCHOR.TOP, "middle": MSO_ANCHOR.MIDDLE,
                          "bottom": MSO_ANCHOR.BOTTOM}[anchor]
    p = tf.paragraphs[0]
    p.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER,
                   "right": PP_ALIGN.RIGHT}[align]
    run = p.add_run(); run.text = text
    run.font.name = font; run.font.size = Pt(size)
    if bold: run.font.bold = True
    run.font.color.rgb = C(color)
    return box

def set_text_in(shape, text, *, font="Sora", size=17, bold=False,
                color="slate-900", align="left"):
    """Replace text inside an existing shape (e.g. one returned by add_rect)."""
    tf = shape.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.paragraphs[0].text = ""  # clear
    p = tf.paragraphs[0]
    p.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER,
                   "right": PP_ALIGN.RIGHT}[align]
    run = p.add_run(); run.text = text
    run.font.name = font; run.font.size = Pt(size)
    if bold: run.font.bold = True
    run.font.color.rgb = C(color)

# ---------- Font embedding ----------
SORA_URLS = {
    "Regular":   "https://raw.githubusercontent.com/sora-xor/sora-font/master/fonts/ttf/Sora-Regular.ttf",
    "SemiBold":  "https://raw.githubusercontent.com/sora-xor/sora-font/master/fonts/ttf/Sora-SemiBold.ttf",
    "Bold":      "https://raw.githubusercontent.com/sora-xor/sora-font/master/fonts/ttf/Sora-Bold.ttf",
    "ExtraBold": "https://raw.githubusercontent.com/sora-xor/sora-font/master/fonts/ttf/Sora-ExtraBold.ttf",
}
def fetch_sora(cache_dir="/tmp/sora-cache"):
    """Download the four Sora TTFs (cached). Returns {weight: local_path}. Halts on failure."""
    os.makedirs(cache_dir, exist_ok=True)
    out = {}
    for weight, url in SORA_URLS.items():
        path = os.path.join(cache_dir, f"Sora-{weight}.ttf")
        if not os.path.exists(path) or os.path.getsize(path) < 10_000:
            req = urllib.request.Request(url, headers={"User-Agent": "hubtel-pptx/1.0"})
            with urllib.request.urlopen(req, timeout=15) as r, open(path, "wb") as f:
                f.write(r.read())
        out[weight] = path
    return out

def embed_sora(pptx_path, sora_paths):
    """Inject the four Sora TTFs into a saved .pptx (post-python-pptx). Verified
    in PowerPoint desktop; ignored by Keynote and Google Slides."""
    slots = [("Regular","Sora"), ("Bold","Sora"),
             ("SemiBold","Sora SemiBold"), ("ExtraBold","Sora ExtraBold")]
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(pptx_path, "r") as z: z.extractall(tmp)
        fonts_dir = os.path.join(tmp, "ppt", "fonts"); os.makedirs(fonts_dir, exist_ok=True)
        filenames = []
        for i, (weight, _) in enumerate(slots, 1):
            fn = f"font{i}.fntdata"
            shutil.copy(sora_paths[weight], os.path.join(fonts_dir, fn))
            filenames.append(fn)
        ct_path = os.path.join(tmp, "[Content_Types].xml")
        ct = open(ct_path, encoding="utf-8").read()
        if 'Extension="fntdata"' not in ct:
            ct = ct.replace(
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Default Extension="fntdata" '
                'ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>'
            )
            open(ct_path, "w", encoding="utf-8").write(ct)
        rels_path = os.path.join(tmp, "ppt", "_rels", "presentation.xml.rels")
        rels = open(rels_path, encoding="utf-8").read()
        max_id = max(int(x) for x in re.findall(r'Id="rId(\d+)"', rels))
        rids, inserts = [], ""
        for i, fn in enumerate(filenames, 1):
            rid = f"rId{max_id + i}"; rids.append(rid)
            inserts += (f'<Relationship Id="{rid}" '
                        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" '
                        f'Target="fonts/{fn}"/>')
        rels = rels.replace("</Relationships>", inserts + "</Relationships>")
        open(rels_path, "w", encoding="utf-8").write(rels)
        pres_path = os.path.join(tmp, "ppt", "presentation.xml")
        pres = open(pres_path, encoding="utf-8").read()
        ns = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
        if ns not in pres:
            pres = pres.replace("<p:presentation ", f"<p:presentation {ns} ")
        embed_lst = (
            '<p:embeddedFontLst>'
            '<p:embeddedFont>'
            '<p:font typeface="Sora" panose="020B0604020202020204" pitchFamily="34" charset="0"/>'
            f'<p:regular r:id="{rids[0]}"/><p:bold r:id="{rids[1]}"/>'
            '</p:embeddedFont>'
            '<p:embeddedFont>'
            '<p:font typeface="Sora SemiBold" panose="020B0704020202020204" pitchFamily="34" charset="0"/>'
            f'<p:regular r:id="{rids[2]}"/>'
            '</p:embeddedFont>'
            '<p:embeddedFont>'
            '<p:font typeface="Sora ExtraBold" panose="020B0904020202020204" pitchFamily="34" charset="0"/>'
            f'<p:regular r:id="{rids[3]}"/>'
            '</p:embeddedFont>'
            '</p:embeddedFontLst>'
        )
        # OOXML requires embeddedFontLst BEFORE defaultTextStyle.
        if "<p:defaultTextStyle>" in pres:
            pres = pres.replace("<p:defaultTextStyle>", embed_lst + "<p:defaultTextStyle>")
        else:
            pres = pres.replace("</p:presentation>", embed_lst + "</p:presentation>")
        open(pres_path, "w", encoding="utf-8").write(pres)
        with zipfile.ZipFile(pptx_path, "w", zipfile.ZIP_DEFLATED) as z:
            for root, _, files in os.walk(tmp):
                for name in files:
                    full = os.path.join(root, name)
                    z.write(full, os.path.relpath(full, tmp))

# ---------- Save + Sora embed (one call) ----------
def save_deck(prs, path, *, embed_fonts=True):
    """Save the deck and (default) embed the four Sora weights in one call.

    Halts if the font fetch fails — a fontless deck must never ship silently.
    Pass `embed_fonts=False` only for a fast dev iteration; production always
    embeds. This replaces the two-call `prs.save(...) + embed_sora(...)`
    idiom so the embed step can never be forgotten."""
    prs.save(path)
    if embed_fonts:
        embed_sora(path, fetch_sora())
    return path

# ---------- Logo ----------
def logo_png_stream(source):
    """Return a PNG BytesIO for a Hubtel wordmark. `source` is the data URI
    from a logo block below, or a path if your copy has them as files."""
    if source.startswith("data:"):
        return io.BytesIO(base64.b64decode(source.split(",", 1)[1]))
    with open(source, "rb") as fh:
        return io.BytesIO(fh.read())

def add_logo(slide, source, x, y, *, height=0.44):
    """Add a Hubtel wordmark at (x, y). Set height only; width follows aspect."""
    return slide.shapes.add_picture(logo_png_stream(source),
                                    left=Inches(x), top=Inches(y), height=Inches(height))

# ---------- Wave motif ----------
WAVE_H = ('<svg viewBox="0 0 115.2 41.12" xmlns="http://www.w3.org/2000/svg">'
          '<path d="M115.2,0v38.15c-17.18,1.75-37.01,2.97-57.6,2.97'
          's-40.42-1.22-57.6-2.97V0h115.2Z" fill="{fill}"/></svg>')
WAVE_S = ('<svg viewBox="0 0 55.91 64.8" xmlns="http://www.w3.org/2000/svg">'
          '<path d="M55.91,32.4c0,11.98-.92,23.39-2.07,32.4H0V0h53.84'
          'c1.15,9.01,2.07,20.42,2.07,32.4Z" fill="{fill}"/></svg>')
WAVE_FILL_HEX = {"teal": "#009999", "navy": "#082E4D",
                 "saffron": "#FFCC08", "red": "#EF4923"}
# variant → (svg template, default width_px, default height_in, default y_in, flipV)
# Two sizes exist for the horizontal wave: an accent size (default) for
# content slides, and a hero size for layouts where the wave IS the backdrop
# (section header, closing). Use the -hero variants only on those layouts.
# `flatten` is the measured ratio of the variant's aspect to the SVG's own
# (WAVE_H 2.80, WAVE_S 0.86). Above 1.0 is a DELIBERATE squash: the accents are
# ribbons, not full curves. Do not "correct" these towards 1.0.
WAVE_VARIANTS = {
    "band":       (WAVE_H, 2400, 1.50, 0.00, False),   # top accent, flatten 3.2x
    "band-hero":  (WAVE_H, 2400, 4.87, 0.00, False),   # section-header bed, 0.98x
    "strip":      (WAVE_H, 2400, 1.79, 0.00, False),   # narrative accent, 2.7x
    "foot":       (WAVE_H, 2400, 0.90, 6.60, True),    # bottom accent, 5.3x (y = 7.5 - h)
    "foot-hero":  (WAVE_H, 2400, 2.19, 5.31, True),    # closing / blank bed, 2.2x
    "side":       (WAVE_S, 1800, 7.50, 0.00, False),   # anchored left,  1.18x wider
    "side-r":     (WAVE_S, 1800, 7.50, 0.00, False),   # anchored right, flipped H
    "corner":     (WAVE_H, 1200, 0.90, None, False),   # user gives x/y; 1.0x, see below
}
def wave_png(variant, fill="teal", width_px=None):
    import cairosvg
    svg_tpl, default_w, *_ = WAVE_VARIANTS[variant]
    svg = svg_tpl.replace("{fill}", WAVE_FILL_HEX[fill])
    return io.BytesIO(cairosvg.svg2png(bytestring=svg.encode("utf-8"),
                                       output_width=width_px or default_w))

def add_wave(slide, variant="band", fill="teal", *, x=None, y=None, w=None, h=None):
    """Add a wave. Sensible defaults per variant; override x/y/w/h when needed.
    'side-r' is drawn on the right, mirrored horizontally."""
    svg_tpl, default_w, def_h, def_y, flip_v = WAVE_VARIANTS[variant]
    if variant == "side":
        x, y = 0.0, 0.0; w = w or 7.66; h = h or 7.5
    elif variant == "side-r":
        x = x if x is not None else (13.333 - (w or 7.66))
        y, w, h = 0.0, (w or 7.66), 7.5
    elif variant == "corner":
        if x is None or y is None:
            raise ValueError("corner wave needs explicit x, y")
        # 2.5 x 0.9" is the path's own aspect — corner shows the full curve.
        w = w or 2.5; h = h or 0.9
    else:  # band, strip, foot
        x = 0.0; w = 13.333
        y = y if y is not None else def_y
        h = h or def_h
    pic = slide.shapes.add_picture(wave_png(variant, fill, default_w),
                                   left=Inches(x), top=Inches(y),
                                   width=Inches(w), height=Inches(h))
    if variant in ("band", "band-hero", "strip"):
        # Shallowest point of the wave (its edges) — the line text must clear.
        # WAVE_H is 38.15/41.12 deep at the edges, full depth at the centre.
        slide._hub_band_edge = y + h * 0.9278
        slide._hub_band_deep = y + h
    if variant == "side-r":
        pic.element.spPr.xfrm.set("flipH", "1")
    if flip_v:
        pic.element.spPr.xfrm.set("flipV", "1")
    return pic

# ---------- Numbered badge & feature icon container ----------
def add_num_badge(slide, x, y, number, *, diameter=0.54, fill="teal",
                  text_color="white", size=22):
    """52 px = 0.54" (default). Draws the circle and centres the number inside.

    The number is measured down to fit the circle's inscribed width (0.8 x
    diameter): 22 Pt carries two digits at 0.54", three needs about 15."""
    circ = add_circle(slide, x, y, diameter, fill=fill)
    inner = diameter * 0.8
    while size > 8 and text_w_in(str(number), size) > inner:
        size -= 1
    add_text(slide, x, y, diameter, diameter, str(number),
             font="Sora ExtraBold", size=size, color=text_color,
             align="center", anchor="middle")
    return circ

def add_ficon(slide, x, y, *, diameter=0.667, fill="teal", icon_png_stream=None):
    """64 px round icon container. Pass an icon PNG stream (transparent bg, 30×30 px)."""
    circ = add_circle(slide, x, y, diameter, fill=fill)
    if icon_png_stream is not None:
        pad = (diameter - 0.31) / 2   # 30 px ≈ 0.31"
        slide.shapes.add_picture(icon_png_stream, left=Inches(x + pad), top=Inches(y + pad),
                                 width=Inches(0.31), height=Inches(0.31))
    return circ

# ---------- Stat tile (KPI card) ----------
def add_stat_tile(slide, x, y, w, h, label, value, *, delta=None, delta_tone="success",
                  caption=None, footnote=None, fill="white", border="slate-200",
                  value_color="navy", value_size=40):
    """KPI tile with a top-down stacked layout so children never collide with
    the label or with each other.

    Row order: label -> value -> [delta] -> [caption] -> [footnote].

    - `delta`   : a change indicator ('+4.5pp', '-12%'), rendered in `delta_tone`
                  ('success' | 'danger' | 'warning'). Reserve for actual deltas.
    - `caption` : a descriptive line ('Revenue growth', 'Since 2022'). Rendered
                  in slate-600 so it does NOT read as a green positive delta.
    - `footnote`: small footnote line at the bottom, slate-600.

    The value auto-shrinks to 18 Pt on BOTH axes — down if the tile is too short
    for the full stack, and down if the value is too wide for the tile. Width is
    the common case: a GHS figure at 40 Pt is wider than a 4-up card, and it has
    no space to wrap at. Optional rows are dropped from the bottom before the
    value is allowed to overflow, and every drop is reported.

    Height is what decides the value's size, so pick h from the value you want,
    not the other way round. Height needed to KEEP the value at:

      value pt   label+value   +delta   +caption   +note
        40 Pt        1.39"      1.67"     1.91"    2.17"
        32 Pt        1.25"      1.53"     1.77"    2.03"
        24 Pt        1.11"      1.39"     1.63"    1.89"
        18 Pt        1.00"      1.28"     1.52"    1.78"

    A 1.3" card with a delta caps the value at 18 Pt - body-text size, which is
    not a KPI. For a 40 Pt value with a delta give the tile 1.67" and start it
    at y <= 5.18" so it still clears CONTENT_BOTTOM. This is the one place where
    the generic "cards no taller than 1.3\" from y = 5.5\"" guidance does not
    apply: KPI tiles need the extra height or they stop reading as KPIs."""
    add_rect(slide, x, y, w, h, fill=fill, border=border, radius=True)
    pad, gap, label_h = 0.167, 0.05, 0.30
    MIN_VALUE_PT = 18

    # ALL-CAPS holds about a fifth fewer characters. Step down until it fits
    # one line; a wrapped label overruns label_h onto the value.
    inner = w - 2 * pad
    label_pt = 16
    while label_pt > 12 and not fits(label.upper(), inner, label_pt, weight="SemiBold"):
        label_pt -= 1
    warn_if_overruns(label.upper(), inner, label_pt, f"add_stat_tile label {label!r}",
                     weight="SemiBold")

    # Optional rows, bottom-most last. Each is (height, text, kwargs).
    tail = []
    if delta:
        tail.append((0.28, delta, dict(font="Sora", size=13, bold=True,
                                       color=delta_tone)))
    if caption:
        tail.append((0.24, caption, dict(font="Sora", size=13, color="slate-600")))
    if footnote:
        tail.append((0.26, footnote, dict(font="Sora", size=13, color="slate-600")))

    # Fit the stack to the tile: value shrinks first, then optional rows are
    # dropped from the bottom. Nothing may escape the tile, and no drop is silent.
    def fixed_h():
        return pad * 2 + label_h + gap + sum(rh for rh, _, _ in tail)

    # Shrink on BOTH axes. Width is what bites: a GHS figure at 40 Pt is wider
    # than a 4-up tile and has nowhere to wrap, so the size has to come down.
    vs = value_size
    while vs > MIN_VALUE_PT and (fixed_h() + vs * SORA_LINE_RATIO > h
                                 or text_w_in(value, vs) > inner):
        vs -= 2
    dropped = []
    while tail and h - fixed_h() < vs * SORA_LINE_RATIO:
        dropped.append(tail.pop()[1])
    value_h = h - fixed_h()

    if value_h < vs * SORA_LINE_RATIO:
        # Not even label + value fits. Place what we can and say so plainly.
        need = pad * 2 + label_h + gap + MIN_VALUE_PT * SORA_LINE_RATIO
        print(f"WARNING [add_stat_tile] {label!r}: a tile needs at least "
              f"{need:.2f}\" for a label and a {MIN_VALUE_PT} Pt value; this one "
              f"is {h:.2f}\". The value will overflow - raise h.")
        value_h = max(0.0, h - pad * 2 - label_h - gap)
    elif dropped:
        print(f"WARNING [add_stat_tile] {label!r}: {h:.2f}\" holds the label and "
              f"the value but not {', '.join(repr(d) for d in reversed(dropped))}; "
              f"dropped. Raise h to about "
              f"{fixed_h() + 0.28 * len(dropped) + vs * SORA_LINE_RATIO:.2f}\" or "
              f"drop a row yourself.")

    cy = y + pad
    add_text(slide, x + pad, cy, inner, label_h, label.upper(),
             font="Sora SemiBold", size=label_pt, color="slate-600", align="left")
    cy += label_h + gap
    warn_if_overruns(value, inner, vs, f"add_stat_tile value {label!r}")
    add_text(slide, x + pad, cy, inner, value_h, value,
             font="Sora ExtraBold", size=vs, color=value_color, align="left")
    cy += value_h
    for rh, text, kw in tail:
        add_text(slide, x + pad, cy, inner, rh, text, align="left", **kw)
        cy += rh

# ---------- Zoom banner ----------
# ---------- Fit warning (advisory, never halts) ----------
# Characters x point-size per inch, measured from the TTFs. Case is what moves
# them, not weight, so all-caps has its own; each is the conservative end.
SORA_CHARS_PT_IN = 122   # mixed-case headings, ExtraBold (measured 125-131)
SORA_BODY_CHARS  = 128   # body text, Regular             (measured 130-140)
SORA_CAPS_CHARS  = 95    # ALL-CAPS, any weight           (measured 95-107)
SORA_LINE_RATIO  = 0.0175  # line height in inches per point (Sora hhea, 1.26 em)

def sora_line_h(size_pt):
    return size_pt * SORA_LINE_RATIO

def is_caps(text):
    """True when the text is effectively all-caps (eyebrows, kickers, labels)."""
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and sum(c.isupper() for c in letters) / len(letters) > 0.8

def caps_chars(text):
    """The character-capacity constant that applies to this text."""
    return SORA_CAPS_CHARS if is_caps(text) else SORA_CHARS_PT_IN

# --- measured fit: wrap text with real Sora advance widths ---
# Fit checks measure; the constants above are only the fallback. Counting
# characters cannot see word boundaries, so it passes titles that wrap.
_SORA_TT = {}

def _sora_metrics(weight):
    """(unitsPerEm, cmap, hmtx) for a cached Sora TTF, or None if unavailable."""
    if weight not in _SORA_TT:
        try:
            from fontTools.ttLib import TTFont
            path = os.path.join("/tmp/sora-cache", f"Sora-{weight}.ttf")
            if not os.path.exists(path):
                path = fetch_sora()[weight]
            f = TTFont(path)
            _SORA_TT[weight] = (f["head"].unitsPerEm, f.getBestCmap(), f["hmtx"])
        except Exception:
            _SORA_TT[weight] = None      # fontTools missing or fetch failed
    return _SORA_TT[weight]

def sora_text_w(text, size_pt, weight="ExtraBold"):
    """Rendered width of `text` in inches, or None if Sora can't be measured."""
    m = _sora_metrics(weight)
    if m is None:
        return None
    upm, cmap, hmtx = m
    fallback = cmap.get(ord("?"))
    adv = sum(hmtx[cmap.get(ord(c), fallback)][0] for c in text)
    return adv / upm * size_pt / 72

def sora_wrap(text, width_in, size_pt, weight="ExtraBold"):
    """Greedy word wrap at real Sora widths. Returns the list of lines."""
    if sora_text_w("x", size_pt, weight) is None:          # estimate instead
        per = max(1, int(caps_chars(text) * width_in / size_pt))
        return [text[i:i + per] for i in range(0, len(text), per)] or [""]
    lines, cur = [], ""
    for word in text.split():
        trial = (cur + " " + word).strip()
        if not cur or sora_text_w(trial, size_pt, weight) <= width_in:
            cur = trial
        else:
            lines.append(cur); cur = word
    if cur:
        lines.append(cur)
    return lines or [""]

def sora_lines(text, width_in, size_pt, weight="Regular"):
    """Wrapped line count for body text."""
    return len(sora_wrap(text, width_in, size_pt, weight))

def text_w_in(text, size_pt, weight="ExtraBold"):
    """Rendered width in inches. Falls back to the character constant."""
    w = sora_text_w(text, size_pt, weight)
    return w if w is not None else len(text) * size_pt / caps_chars(text)

def fits(text, width_in, size_pt, *, lines=1, weight="ExtraBold"):
    """True when `text` fits a box `width_in` wide in at most `lines` lines.

    Line count alone is not enough: a word wider than the box has nowhere to
    wrap, so it returns one line and overflows sideways. Widths are checked too."""
    for line in sora_wrap(text, width_in, size_pt, weight):
        if text_w_in(line, size_pt, weight) > width_in + 1e-9:
            return False
    return len(sora_wrap(text, width_in, size_pt, weight)) <= lines

def warn_if_overruns(text, width_in, size_pt, where, *, lines=1,
                     weight="ExtraBold"):
    """Print a warning when text will not fit. Advisory only — never raises."""
    wrapped = sora_wrap(text, width_in, size_pt, weight)
    got = len(wrapped)
    wide = [l for l in wrapped if text_w_in(l, size_pt, weight) > width_in + 1e-9]
    room = "one line" if lines == 1 else f"{lines} lines"
    if wide:
        print(f"WARNING [{where}]: {wide[0][:32]!r} is "
              f"{text_w_in(wide[0], size_pt, weight):.2f}\" at {size_pt} Pt and "
              f"cannot wrap inside a {width_in:.2f}\" box — it will run past the "
              f"edge. Shorten it or step the size down.")
    elif got > lines:
        print(f"WARNING [{where}]: text wraps to {got} lines at {size_pt} Pt in "
              f"a {width_in:.2f}\" box; the layout holds {room}. It will overrun "
              f"— shorten it or step the size down.")
    return got <= lines and not wide

# ---------- Cover slides (every element in ONE call) ----------
def add_cover_slide(prs, title, *, lead=None, meta=None, logo_color_uri=None,
                    style="wave", picture=None, picture_slot=False,
                    title_size=52):
    """Build a complete cover slide and return it. Two styles, never blended:

      style="wave"  — white ground, full-height teal wave on the left, title on
                      the teal, picture slot right.
      style="solid" — full teal ground, title left, hero picture slot right.

    Every element the layout requires is placed here. A hand-assembled cover
    drops one — usually the logo or the picture slot — and the composition
    collapses into a teal slab beside empty white.

    Title is 52 Pt in a 1.85" box at y=2.50, which holds two lines at any size
    down to 40 Pt without reaching the lead at y=4.45. Rough capacity per line
    for authoring (the helper itself measures the real wrap, so treat these as
    a guide, not the rule - one long word can cost a whole line):

      style="wave"  (6.4" wide)   ~15 chars at 52 Pt, 17 at 44, 19 at 40
      style="solid" (7.5" wide)   ~17 chars at 52 Pt, 20 at 44, 22 at 40

    Cover titles are short by nature. Two lines at 52 Pt is fine; a title that
    needs three is stepped down automatically (52 -> 44 -> 40) because a third
    line overruns the box and lands on the lead. The ladder stops at 40: below
    that the cover stops reading as a cover, so a title that still does not fit
    warns and must be shortened.

    Lead (20 Pt) and meta (14 Pt) are fixed at one line each: their boxes are
    0.60" and 0.35", with no room for a second. Both are checked, and a lead
    that wraps warns rather than sliding into the meta row.

    `picture` takes an image path or stream and fits it into the slot, centred,
    without stretching. `picture_slot=True` draws the empty grey placeholder
    instead, for a template someone will fill by hand.

    Covers never get a footer — do not call add_page_footer on the result."""
    slide = add_blank_slide(prs)

    if style == "wave":
        add_wave(slide, "side", fill="teal")
        text_x, text_w, text_color = 0.667, 6.4, "white"
        slot_x, slot_y, slot_w, slot_h = 8.0, 1.23, 4.4, 5.04
    elif style == "solid":
        add_rect(slide, 0, 0, 13.333, 7.5, fill="teal", radius=False)
        text_x, text_w, text_color = 0.667, 7.5, "white"
        slot_x, slot_y, slot_w, slot_h = 8.9, 1.75, 3.75, 4.0
    else:
        raise ValueError("style must be 'wave' or 'solid'")

    if logo_color_uri:
        add_logo(slide, logo_color_uri, x=13.333 - 0.667 - 1.5, y=0.5, height=0.33)

    # Step down before a third line: three lines overrun the 1.85" box and
    # collide with the lead at y=4.45.
    for candidate in [s for s in (title_size, 44, 40) if s <= title_size]:
        title_size = candidate
        if fits(title, text_w, candidate, lines=2):
            break
    warn_if_overruns(title, text_w, title_size, f"add_cover_slide style={style}",
                     lines=2)
    add_text(slide, text_x, 2.50, text_w, 1.85, title,
             font="Sora ExtraBold", size=title_size, color=text_color, align="left")
    # One line each: 0.60" holds one 20 Pt line, 0.35" one at 14 Pt. A long
    # lead wraps into the meta row.
    if lead:
        warn_if_overruns(lead, text_w, 20, "add_cover_slide lead", weight="Regular")
        add_text(slide, text_x, 4.45, text_w, 0.6, lead,
                 font="Sora", size=20, color=text_color, align="left")
    if meta:
        warn_if_overruns(meta, text_w, 14, "add_cover_slide meta", weight="Regular")
        add_text(slide, text_x, 6.1, text_w, 0.35, meta,
                 font="Sora", size=14, bold=True, color=text_color, align="left")
    if picture is not None:
        # Fit inside the slot and centre; forcing both dimensions squashes it.
        with Image.open(picture) as im:
            ar = im.width / im.height
        w, h = (slot_w, slot_w / ar) if slot_w / ar <= slot_h else (slot_h * ar, slot_h)
        slide.shapes.add_picture(picture,
                                 left=Inches(slot_x + (slot_w - w) / 2),
                                 top=Inches(slot_y + (slot_h - h) / 2),
                                 width=Inches(w), height=Inches(h))
    elif picture_slot:
        add_rect(slide, slot_x, slot_y, slot_w, slot_h,
                 fill="slate-50", border=None, radius=True)
    return slide

# ---------- Content-slide header (band + eyebrow + title, as ONE unit) ----------
CONTENT_TOP    = 1.95   # first y a content shape may occupy
CONTENT_BOTTOM = 6.85   # last y a content shape may occupy (footer sits below)
MARGIN_X       = 0.667
CONTENT_LEFT   = MARGIN_X                 # 0.667"
CONTENT_RIGHT  = 13.333 - MARGIN_X        # 12.666"
CONTENT_W      = CONTENT_RIGHT - CONTENT_LEFT   # 11.999"

def columns(n, *, gap=0.27, left=CONTENT_LEFT, total=CONTENT_W):
    """Column geometry for an n-up row: [(x, w), ...] inside the margins.

    Use this for every card row, tile row and column split. Hand-arithmetic is
    what pushes the last card off the right edge — the width has to absorb the
    gaps, and n-1 gaps is easy to get wrong as n."""
    w = (total - gap * (n - 1)) / n
    return [(left + i * (w + gap), w) for i in range(n)]

def check_bounds(x, y, w, h, where):
    """Warn when a shape crosses the slide margins. Advisory, never raises.
    Full-bleed shapes (waves, background fills) are detected and skipped."""
    if w >= 13.2 or h >= 7.4 or (x <= 0.01 and w >= 13.0):
        return True                        # deliberate full bleed
    ok = True
    if x < CONTENT_LEFT - 0.01:
        print(f"WARNING [{where}]: starts at {x:.2f}\", left margin is "
              f"{CONTENT_LEFT}\"."); ok = False
    if x + w > CONTENT_RIGHT + 0.01:
        print(f"WARNING [{where}]: ends at {x + w:.2f}\", right margin is "
              f"{CONTENT_RIGHT:.2f}\" — it will bleed off the slide. Use "
              f"columns() to size the row."); ok = False
    if y + h > CONTENT_BOTTOM + 0.01:
        print(f"WARNING [{where}]: ends at {y + h:.2f}\", below "
              f"CONTENT_BOTTOM ({CONTENT_BOTTOM}\")."); ok = False
    return ok

def add_slide_header(slide, eyebrow, title, *, fill="teal", title_size=30):
    """Standard content-slide header: wave band + eyebrow + title, bound together.

    The band, the eyebrow and the title are ONE call because they are one unit —
    composing them by hand is how titles end up black, straddling the band edge,
    or in an eyebrow colour with no contrast against the fill.

    Geometry is fixed and must not be overridden. The `band` wave is 1.50" deep
    at centre and ~1.39" at the edges, so all text ends above 1.26":
      eyebrow  y=0.32  h=0.34   18 Pt SemiBold, reversed (line height 0.32")
      title    y=0.68  h=0.58   30 Pt ExtraBold, white   (line height 0.53")

    One line only — a wrapped title crosses the wave, and the box has no room
    for a second line at any size. Rough capacity in the 12" box: ~48 characters
    at 30 Pt, ~56 at 26 Pt (the helper measures the real wrap and warns with the
    actual line count). If the title overruns, step to title_size=26 once. Do
    not go below 26: against an 18 Pt eyebrow the hierarchy flattens, and 24 Pt
    buys only five more characters. A title that still does not fit at 26 is too
    long — shorten it."""
    add_wave(slide, "band", fill=fill)
    eyebrow_color = "teal-100" if fill == "navy" else "white"
    add_text(slide, MARGIN_X, 0.32, 12, 0.34, eyebrow.upper(),
             font="Sora SemiBold", size=18, color=eyebrow_color, align="left")
    warn_if_overruns(title, 12.0, title_size, "add_slide_header")
    add_text(slide, MARGIN_X, 0.68, 12, 0.58, title,
             font="Sora ExtraBold", size=title_size, color="white", align="left")

def add_zoom_banner(slide, x, y, w, eyebrow, title, *, fill="navy", h=1.4):
    """Full-width flag: 'we're about to zoom in on X'. Standard padding."""
    add_rect(slide, x, y, w, h, fill=fill, radius=True)
    add_text(slide, x + 0.25, y + 0.20, w - 0.5, 0.34, eyebrow.upper(),
             font="Sora SemiBold", size=16, color="teal-100", align="left")
    add_text(slide, x + 0.25, y + 0.55, w - 0.5, 0.65, title,
             font="Sora", size=28, bold=True, color="white", align="left")

# ---------- Section header (full-bleed) ----------
def add_section_header_band(slide, eyebrow, title, *, deck_line=None,
                            fill="navy", logo_white_uri=None, title_size=52):
    """Full-bleed navy or teal band with eyebrow + reversed title. White logo top-right.

    Title box is 1.9" tall so a two-line 52 Pt title wraps without colliding
    with the deck_line beneath it. If the title is very long, pass a smaller
    `title_size` (44 or 40) rather than trusting wrap."""
    add_rect(slide, 0, 0, 13.333, 7.5, fill=fill, radius=False)
    add_text(slide, 0.667, 2.86, 12, 0.44, eyebrow.upper(),
             font="Sora SemiBold", size=18, color="teal-100", align="left")
    warn_if_overruns(title, 12.0, title_size, "add_section_header_band", lines=2)
    add_text(slide, 0.667, 3.35, 12, 1.9, title,
             font="Sora ExtraBold", size=title_size, color="white", align="left")
    if deck_line:
        add_text(slide, 0.667, 5.35, 12, 0.6, deck_line,
                 font="Sora", size=20, color="teal-100", align="left")
    if logo_white_uri:
        add_logo(slide, logo_white_uri, x=13.333 - 0.667 - 1.5, y=0.5, height=0.33)

# ---------- Footer (page number left, logo right) ----------
# The footer strip lives from FOOTER_SAFE_Y downward. Card layouts must clamp
# their bottom above this line so the page number and wordmark don't collide
# with content.
FOOTER_SAFE_Y = 6.9  # inches: reserved for footer strip

def add_page_footer(slide, page_num, *, treatment="standard", has_foot_wave=False,
                    logo_color_uri=None, logo_white_uri=None):
    """treatment: 'standard' | 'on-dark' | 'banded'.

    If `has_foot_wave=True`, treatment is forced to 'banded' regardless of the
    passed value — a dark page number and colour wordmark on top of a teal
    wave read badly. Draw the wave BEFORE calling this helper.

    Cover and closing slides do NOT get a footer. Never call this on page 1
    of a cover-led deck or on the closing slide."""
    if has_foot_wave:
        treatment = "banded"
    num_color = {"standard": "slate-700", "on-dark": "white", "banded": "white"}[treatment]
    logo_uri  = logo_white_uri if treatment != "standard" else logo_color_uri
    # Zero-pad two digits
    add_text(slide, 0.667, 7.5 - 0.31 - 0.22, 2.0, 0.26, f"{page_num:02d}",
             font="Sora SemiBold", size=13, color=num_color, align="left")
    if logo_uri:
        add_logo(slide, logo_uri, x=13.333 - 0.667 - 0.9, y=7.5 - 0.31 - 0.28, height=0.28)

# ---------- Pack label (deck-label eyebrow) ----------
def add_pack_label(slide, x, y, text, *, on_dark=True):
    color = "white" if on_dark else "slate-700"
    add_text(slide, x, y, 8, 0.24, text.upper(),
             font="Sora", size=13, bold=True, color=color, align="left")

# ---------- Bulleted list (teal-square bullets) ----------
def add_bulleted_list(slide, x, y, w, items, *, size=15, gap=0.12,
                      color="slate-700", bullet_fill="teal"):
    """Teal square bullets (11×11 px ≈ 0.115") to the left of each item.

    Each row is measured, not assumed: a wrapping item gets the height it needs
    and the next row starts below it. `gap` is the space BETWEEN rows, not the
    row height — a fixed per-item advance draws long bullets over short ones.

    Returns the y of the bottom of the list, so the caller can place the next
    block or check it against CONTENT_BOTTOM."""
    bullet_size = 0.115
    text_w = w - 0.20
    row_y = y
    for item in items:
        row_h = sora_lines(item, text_w, size) * sora_line_h(size) + 0.04
        sq = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE,
                                    Inches(x), Inches(row_y + 0.06),
                                    Inches(bullet_size), Inches(bullet_size))
        sq.fill.solid(); sq.fill.fore_color.rgb = C(bullet_fill)
        sq.line.fill.background(); clear_shadow(sq)
        add_text(slide, x + 0.20, row_y, text_w, row_h, item,
                 font="Sora", size=size, color=color, align="left")
        row_y += row_h + gap
    bottom = row_y - gap
    if bottom > CONTENT_BOTTOM:
        print(f"WARNING [add_bulleted_list]: list ends at {bottom:.2f}\", past "
              f"CONTENT_BOTTOM ({CONTENT_BOTTOM}\"). Cut items or reduce size.")
    return bottom

# ---------- Table ----------
def add_table(slide, x, y, w, headers, rows, *, col_widths=None, header_fill="teal",
              header_text="white", body_text="slate-700", hairline="slate-200",
              row_h=0.35, header_h=0.42):
    """Hubtel table. col_widths in inches (must sum to w if given). Numeric columns
    are right-aligned automatically for values matching /^-?[\\d,\\.]+%?$/."""
    ncols = len(headers)
    if col_widths is None:
        col_widths = [w / ncols] * ncols
    total_h = header_h + row_h * len(rows)
    tbl = slide.shapes.add_table(rows=1 + len(rows), cols=ncols,
                                 left=Inches(x), top=Inches(y),
                                 width=Inches(w), height=Inches(total_h)).table
    for i, cw in enumerate(col_widths):
        tbl.columns[i].width = Inches(cw)
    tbl.rows[0].height = Inches(header_h)
    for r in range(len(rows)):
        tbl.rows[r + 1].height = Inches(row_h)

    def _style_cell(cell, text, *, fill, color, size=15, bold=False, align="left"):
        cell.fill.solid(); cell.fill.fore_color.rgb = C(fill)
        cell.margin_left = Inches(0.13); cell.margin_right = Inches(0.13)
        cell.margin_top = Inches(0.05);  cell.margin_bottom = Inches(0.05)
        tf = cell.text_frame; tf.paragraphs[0].text = ""
        p = tf.paragraphs[0]
        p.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER,
                       "right": PP_ALIGN.RIGHT}[align]
        run = p.add_run(); run.text = str(text)
        run.font.name = "Sora"; run.font.size = Pt(size)
        run.font.bold = bold; run.font.color.rgb = C(color)

    for j, h in enumerate(headers):
        _style_cell(tbl.cell(0, j), h, fill=header_fill, color=header_text,
                    size=15, bold=True, align="left")
    numeric_re = re.compile(r"^-?[\d,\.]+%?$")
    for i, row in enumerate(rows):
        for j, v in enumerate(row):
            align = "right" if numeric_re.match(str(v).strip()) else "left"
            _style_cell(tbl.cell(i + 1, j), v, fill="white", color=body_text, align=align)
    return tbl

# ---------- Callout ----------
# Wash fills — the accent at ~12 % over white. Paired with a full-strength
# accent bar so the variant survives monochrome printing.
CALLOUT_WASH = {"info": TEAL_50,
                "warning": RGBColor(254, 249, 228),
                "danger":  RGBColor(253, 235, 231)}
CALLOUT_ACCENT = {"info": "teal", "warning": "saffron", "danger": "red"}

def add_callout(slide, x, y, w, h, text, *, variant="info", title=None):
    """variant: 'info' (teal wash), 'warning' (saffron wash), 'danger' (red wash).

    Each variant gets its own wash plus a 0.04" accent bar down the left edge
    in the full-strength colour — colour alone must not carry the meaning, and
    the three washes are close in value when printed monochrome.

    `h` is the caller's. The text is measured against it and a short callout
    warns rather than clipping in silence."""
    shp = add_rect(slide, x, y, w, h, fill=None, radius=True)
    shp.fill.solid(); shp.fill.fore_color.rgb = CALLOUT_WASH[variant]
    add_rect(slide, x, y + 0.08, 0.04, h - 0.16,
             fill=CALLOUT_ACCENT[variant], radius=False)

    pad = 0.18
    text_x, text_w = x + pad + 0.08, w - 2*pad - 0.08
    title_h = 0.36 if title else 0
    if title:
        add_text(slide, text_x, y + pad, text_w, 0.32, title,
                 font="Sora", size=15, bold=True, color="slate-900", align="left")

    body_h = h - 2*pad - title_h
    needed = sora_lines(text, text_w, 14) * sora_line_h(14)
    if needed > body_h:
        print(f"WARNING [add_callout]: body needs {needed:.2f}\" but the box "
              f"gives {body_h:.2f}\". Raise h to about "
              f"{needed + 2*pad + title_h:.2f}\" or shorten the text.")
    add_text(slide, text_x, y + pad + title_h, text_w, body_h, text,
             font="Sora", size=14, color="slate-700", align="left")
    return shp
# <<< hubtel_pptx end
```

## Palette (reference — helpers already know these)

```
BRAND        RGB            USE
teal         (  0,153,153)  primary
teal-accent  (  1,199,177)  tiffany
navy         (  8, 46, 77)  dark surfaces
red          (239, 73, 35)
saffron      (255,204,  8)

TEAL SCALE    teal-50, teal-100, teal-200, teal-500, teal-600, teal-700
SLATES        slate-900 (primary text), slate-700 (secondary), slate-600 (tertiary),
              slate-500/300/200/100/50, white
FEEDBACK      success (0,178,124) · danger (237,27,46) · warning (254,204,47) · info (51,149,255)
```

Body colour `slate-900`; secondary `slate-700`; eyebrows `slate-600` (or the section accent). On dark surfaces (navy, teal, red), flip to `white`.

## Typography — Sora

Pass the typeface name to helpers that take `font=`; `bold=True` flips Regular to Bold within the `"Sora"` family. PowerPoint reads embedded fonts by exact typeface name.

| Purpose                | Pt  | Weight    | `font=` value             |
|------------------------|-----|-----------|---------------------------|
| Title (cover, closing) | 52  | ExtraBold | `"Sora ExtraBold"`        |
| Slide H2               | 40  | Bold      | `"Sora"` + `bold=True`    |
| Card / column H3       | 28  | Bold      | `"Sora"` + `bold=True`    |
| Lead / subtitle        | 20  | Regular   | `"Sora"`                  |
| Body                   | 17  | Regular   | `"Sora"`                  |
| Eyebrow (UPPER)        | 12  | SemiBold  | `"Sora SemiBold"`         |

### Font embedding

`save_deck(prs, path)` saves and embeds all four Sora weights in one call; `fetch_sora()` caches the TTFs to `/tmp/sora-cache` and halts on network failure so a fontless deck never ships silently. Calling `prs.save(...)` on its own ships the deck in a fallback font — see **Delivery** for what embedding does and does not guarantee.

## Dimensions & padding

- **Slide** 13.333" × 7.5" (set by `new_deck()`).
- **Edge padding** 0.667" (~64 px). Titles, body, and cards keep to this inset.
- **Spacing scale (inches, 4-based, ×0.042")**: `space-1=0.042`, `space-2=0.083`, `space-3=0.125`, `space-4=0.167`, `space-5=0.208`, `space-6=0.25`, `space-8=0.333`, `space-10=0.417`, `space-12=0.5`, `space-16=0.667`.
- **Card radii** 0.167" (helpers use this automatically).
- **Converting the brand's px — two rules.** Lengths (padding, radii, diameters, rule lengths) are `px / 96`: a 16 px radius is 0.167". Thicknesses (strokes, borders, hairlines, accent bars) are 1 px → 1 Pt, not `px / 96`: a 1.5 px card border is `border_w=1.5`, a 3 px accent bar is 3 Pt. A thickness given as a shape height is that Pt value in inches — 3 Pt = 0.042".
- **Shadows** — helpers call `clear_shadow` on every rounded rectangle automatically. Never `SHADOW_TYPE.OUTER` — its defaults are the heavy theme shadow. For a wanted subtle elevation, attach a small `<a:outerShdw blurRad="76200" dist="25400" dir="5400000">` with alpha ~15% via the same lxml mechanism as `clear_shadow`.

## Logo — embedded wordmarks

The two `data:` URIs are in **Logo blocks** at the bottom of this file. Pass one straight to `add_logo` — or a file path, if your copy has them extracted as files; `add_logo` takes either. Never re-encode one yourself.

- **Colour wordmark** — light surfaces (white, teal-50, saffron).
- **White wordmark** — dark surfaces (navy, teal, red). Slides are often dark-ground, so unlike the report skills this deck needs both.

Only these sources. Do not draw a replacement, fetch from a URL, or recolour them — the fills are baked in, which is why there are two.

```python
add_logo(slide, colour_source, x=0.667, y=0.4, height=0.44)
```

The wordmarks are already PNG, so `logo_png_stream` only decodes or reads them — cairosvg is needed just for the wave and icons.

**Sizes.** Masthead 0.44" tall, section slide 0.33", footer 0.28", watermark 0.22". Set `height=` only; width follows aspect. The art is 301 × 200 px, above 300 dpi at every one of those sizes.

## Slide layouts

One row per layout. The name in the first column is the canonical `data-label`. Where a helper exists, use it; where a layout is compositional, assemble it from primitives. Units are **Pt** for type and **inches** for geometry — python-pptx has no px.

Three rules hoisted out of the table so no row repeats them:

- **Ground.** A coloured or washed layout opens with `add_ground(slide, fill)`. "white" in the Ground column means no ground shape at all.
- **Card.** "card" means `add_rect(..., fill="white", border="teal", border_w=1.5, radius=True)` at the default 0.167" radius. A row states only what differs.
- **Frame.** Every layout keeps the 0.667" edge padding, clamps content to `CONTENT_BOTTOM` (6.85"), and uses `columns(n)` for any row of cards — never hand arithmetic. H2 is 40 Pt Bold navy.

XB = ExtraBold, SB = SemiBold, B = Bold.

| Layout | Ground | Motif | Type (Pt) | Geometry | Build |
|---|---|---|---|---|---|
| `Title / cover` | white | `side` teal | title 52 XB white · lead 20 at 78% white · meta 14 B at 60% white | title ~2.94" from top; picture slot 5.66" from left, 4.4 × 5.04" | `add_cover_slide(style="wave")`; colour logo top-right 0.33"; **no footer** |
| `Title solid` | teal | — | title 52 XB white · lead 20 at 82% white · presenter 13 B at 70% white | title ~4.7" from edge; hero picture 3.75 × 4.0" | `add_cover_slide(style="solid")`; white logo top-right 0.33"; `add_pack_label(0.667, 6.5, …, on_dark=True)`; **no footer** |
| `Section header` | navy or teal | `band-hero` | eyebrow 18 SB · title 52 XB reversed · deck line 20 | title box 1.9" tall so a two-line title clears the deck line; very long title → `title_size=44` or `40`, not wrap | `add_section_header_band(...)`; white logo top-right |
| `Basic content` | white | — | H2 40 B navy · body 17 slate-700 | teal accent bar above the H2, 0.25" long × 0.042" thick (3 Pt); body one column ~8.5" wide | `add_rect` + `add_text` |
| `Two content` | white | — | H2 40 · H3 22 navy · body 17 | `columns(2)` | `add_text` |
| `Three content` | white | — | H3 20 navy · body 15 | `columns(3)` → 3.82" cards; pad 0.292 × 0.25" | card |
| `Narrative` | navy | `strip` teal | title 40 XB white · body 19 then 17, both at 82% white | picture slot right ~3.75 × 3.3", teal-tinted placeholder | `add_ground` + `add_wave` |
| `Content + picture` | white | — | as `Basic content` | 60/40 split; image slot `add_rect(fill="slate-50", border=None)` | `add_rect` |
| `Big picture` | full-bleed image | — | title 40 B white | translucent navy panel at 55% opacity under the title | `add_rect` |
| `Process` | navy | — | H3 19 B white · body 15 at 75% white | 3–5 numbered pillars across `columns(n)` | `add_ground` + `add_num_badge(diameter=0.54)` |
| `Steps` | white | — | H3 19 navy · body 15 slate-700 | vertical card list; pad 0.188 × 0.229" | card + `add_num_badge(0.54)` |
| `Steps grid` | white | — | H3 20 navy · body 15 | 2×2 or 2×3; pad 0.25"; badge top-left | card + `add_num_badge` |
| `Framework` | white | — | H3 20 navy · body 15 slate-700 | central shape naming the framework + 3–4 satellites; pad 0.271 × 0.25", min-height 1.77" | card |
| `Features 3` | dark | — | H3 21 white · body 15 at 78% white | `columns(3)` | `add_ground` + `add_ficon(diameter=0.667)` |
| `Features 4` | dark | — | H3 19 white · body 14 at 80% white | `columns(4)` | `add_ground` + `add_ficon` |
| `Features vertical` | white | — | H3 19 navy · body 14 slate-700 | 4-up; pad 0.271 × 0.229" | card + `add_ficon` |
| `Feature cards` | white | — | H3 22 navy · body 15 · link 14 B teal | 3-up; pad 0.313 × 0.271"; "Learn more →" on the bottom row | card + `add_ficon` |
| `Feature stats` | dark | — | number 46 XB white · H3 17 B white · support 14 at 80% white | left border `add_rect(w=0.042, fill="white")` (3 Pt) at 60% opacity | `add_ground` + `add_rect` |
| `Stat circles` | dark | — | number 66 XB · kicker 14 caps · description 15 at 88% white | `add_circle(..., border="white", border_w=6)`; kicker letter-spacing 0.13em where python-pptx supports it | `add_ground` + `add_circle` |
| `Quote` | teal | — | mark 110 Georgia white at 90% · quote 26 SB white · attribution 16 B white | white rule 0.729" long × 0.028" thick (2 Pt) between mark and quote | `add_ground` + `add_text(font="Georgia")` |
| `Comparison` | white | — | header white B · body 15 B navy | two columns; header cells pad 0.146 × 0.104" — "is Hubtel" teal, "not Hubtel" navy; the header colours carry the meaning | `add_rect` + card |
| `Table` | white | — | header white · body slate-700 | numeric columns right-aligned automatically; slate-200 hairlines; zebra on slate-50 applied manually after the call | `add_table(...)` |
| `Pillars` | white | — | H3 24 XB white · mid strip 19 XB white · body 14.5 at 92% white | 3–4 panels at 0.208" radius, min-height 3.58"; 0.583" white circle badge floating on top; mid strip at 17% black; colours in order teal, navy, saffron, red | `add_rect` + `add_circle` |
| `Color panels` | teal-50 | — | pill 16 XB · subtitle 15 B at 90% white · body 14.5 at 90% white | 3 panels (teal / navy / red), min-height 4.08", pad 0.313 × 0.271"; pill border 1.5 Pt at 65% white, letter-spacing 0.03em | `add_ground` + `add_pill` |
| `Statement` | white or teal-50 | — | sentence 64 XB teal · items 15 slate-700 | sentence letter-spacing -0.03em; right-hand list card 0.208" radius, pad 0.271 × 0.292", 4–6 items each with a 0.25" teal circle and white check | card |
| `Callout` (CTA) | white | — | headline 32 XB white | 0.208" radius, pad 0.354 × 0.375", 0.479" arrow icon right. Build with `add_rect(fill="teal")` + `add_text`, **not** `add_callout()` | `add_rect` |
| `Prose` | white | — | title 40 B navy · body 16 slate-700 | two balanced columns, gap 0.583"; teal pill with WHITE text, pad 0.104 × 0.25", 15 B | `add_pill` |
| `Framing cards` | teal-50 | — | top 18 XB white · mid 13 B white · body 14 at 92% white | 3 cards (teal / navy / red), three stacked sections: top pad 0.229 × 0.208" centred, mid pad 0.115 × 0.188" over 20% black centred, body pad 0.229 × 0.208"; optional footnote row 14 slate-700 | `add_ground` + `add_rect` |
| `Two tracks` | white | — | header 19 XB white · subtitle 15 B teal · body 14.5 slate-700 | cards 0.188" radius with a teal header strip on top (pad 0.167 × 0.25", "Track A · Title" centred); below, a full-width teal note banner 0.146" radius, pad 0.167 × 0.271", 15 SB white centred | card |
| `Blank` | white | `foot-hero` teal | — | deliberately empty, wordmark on the wave. Only for genuinely custom content | `add_wave` |
| `Closing` | teal | `foot-hero` teal at reduced opacity | "Thank you" 56 XB white · lead 20 at 80% white · footer row 18 B white | lead max-width ~5"; white wordmark centred horizontally at the top, 0.35" tall — a deliberate override, not `add_page_footer` | `add_ground` + `add_wave`; **no page number, no bottom-right logo** |

**Pick ONE title layout per deck.** `Title / cover` is white ground with the left-side wave; `Title solid` is the full teal ground. If a cover ends up navy with a horizontal accent on top, the two have been blended — go back to one of them.

**Every content slide opens with `add_slide_header(slide, eyebrow, title)`** unless the row above names its own header treatment. It draws the `band` wave, the eyebrow and the title as one unit; composing those by hand is how titles end up black, straddling the band edge, or invisible against the fill.

## Shared primitives — API summary

| Helper                       | Use                                                        |
|------------------------------|------------------------------------------------------------|
| `new_deck()`                 | Empty 13.333 × 7.5 Presentation                            |
| `add_blank_slide(prs)`       | Add a blank layout slide                                   |
| `add_rect(...)`              | Rounded rectangle (or square with `radius=False`)          |
| `add_ground(slide, fill)`    | Full-bleed 13.333 × 7.5 ground for a dark or washed layout  |
| `add_circle(...)`            | Circle                                                     |
| `add_text(...)`              | Text box with Sora, size, weight, colour, align, anchor    |
| `set_text_in(shape, text)`   | Set the text inside an existing shape                      |
| `clear_shadow(shape)`        | Kill theme shadow (called automatically by `add_rect`)     |
| `fetch_sora()`               | Download the four TTFs (cached)                            |
| `embed_sora(pptx, paths)`    | Embed all four weights into the .pptx post-save            |
| `save_deck(prs, path)`       | One-call save + Sora embed. **Use this instead of `prs.save`.** |
| `add_logo(slide, uri, x, y)` | Rasterise & place a Hubtel wordmark                        |
| `add_wave(slide, variant)`   | Wave motif — `band` / `band-hero`, `strip`, `foot` / `foot-hero`, `side`, `side-r`, `corner`. Use `-hero` sizes only where the wave is the layout's backdrop (section header, closing, blank). |
| `add_num_badge(slide, ...)`  | 0.54" teal circle with a bold white number                 |
| `add_ficon(slide, ...)`      | 0.667" round icon container                                |
| `add_stat_tile(slide, ...)`  | KPI tile — label, auto-shrunk value, optional `delta`, `caption`, `footnote`. `caption=` for descriptive lines (slate-600); `delta=` reserved for change indicators (success/danger/warning) |
| `columns(n, gap=0.27)`       | Column geometry for an n-up row — `[(x, w), …]` inside the margins. **Use for every card/tile row; do not compute widths by hand.** |
| `check_bounds(...)`          | Margin check, called by `add_rect`. Warns on bleed, never halts.       |
| `check_clear_of_band(...)`   | Wave-collision check, called by `add_text`. Catches a title straddling the wave edge, or dark text on the band. |
| `sora_wrap(text, w, pt)`     | Greedy word wrap at real Sora widths — the line list                 |
| `fits(text, w, pt, lines=)`  | True when the text wraps to no more than `lines` lines               |
| `warn_if_overruns(...)` | Advisory fit check, called by the title helpers. Measures the real wrap and reports the actual line count. Prints, never halts. |
| `add_cover_slide(prs, title, ...)` | **Complete cover — wave/ground, logo, title, lead, meta, picture slot in one call. `style="wave"` or `"solid"`; never blend them.** |
| `add_slide_header(slide, eyebrow, title)` | **Content-slide header — band + eyebrow + title as one unit. Use on every content slide; never compose these by hand.** |
| `add_zoom_banner(slide, ...)`| Full-width navy/teal flag with eyebrow + one-line title    |
| `add_section_header_band(slide, ...)` | Full-bleed section-header slide                   |
| `add_pack_label(slide, ...)` | 13 Pt bold uppercase deck label                            |
| `add_bulleted_list(slide, ...)` | Teal-square bullets (never disc / dot)                  |
| `add_table(slide, ...)`      | Hubtel table with header fill and auto-right-aligned numbers |
| `add_callout(slide, ...)`    | Callout — `info` / `warning` / `danger`                    |
| `add_page_footer(slide, n)`  | Zero-padded page number + wordmark right. Pass `has_foot_wave=True` when the slide has a bottom wave — treatment auto-switches to `banded`. Never call on cover/closing. |

## Slide footer

`add_page_footer(slide, page_num, treatment=..., has_foot_wave=..., logo_color_uri=..., logo_white_uri=...)`. Three treatments:

- **standard** (light slide) — number `slate-700`, colour logo.
- **on-dark** (navy / teal) — number `white` at 60% alpha (helper approximates with pure white; adjust manually if the reduced-alpha look matters), white logo.
- **banded** (section / divider, or any slide with a `foot`/`foot-hero` wave at the bottom) — caller draws the wave first; helper then adds white number + white logo on top. Pass `has_foot_wave=True` and the helper switches to `banded` automatically.

**Footer safe-zone.** Two constants, one boundary. `FOOTER_SAFE_Y = 6.9"` is where the footer strip begins — the topmost footer element, the wordmark, sits at 6.91". `CONTENT_BOTTOM = 6.85"` is the last y content may occupy, 0.05" of clearance below it, and it is what `check_bounds` actually warns on. **Clamp to `CONTENT_BOTTOM`;** `FOOTER_SAFE_Y` is there to explain why it is where it is.

Every layout that places cards, tiles, or bullet lists needs `y + h <= CONTENT_BOTTOM` — otherwise the page number and wordmark collide with content (this is what put the wordmark inside the Growth card on the executive-summary slide). Three-content, features-3/4, feature stats, steps grid and framing cards all need it. For those card rows it means cards no taller than 1.3" starting from y = 5.5".

**KPI tile rows are the exception.** A 1.3" tile does not have the height for a 40 Pt value plus a label and a delta — `add_stat_tile` shrinks the value to make the stack fit, and at that height it lands on 18 Pt, the same size as body text. A KPI row with deltas wants **h = 1.67" starting at y ≤ 5.18"**; add a caption and it is 1.91" from y ≤ 4.94". See the height table in `add_stat_tile`. If a KPI row has to sit at y = 5.5", drop the delta rather than the value size.

**Page number.** Zero-padded two digits — `01`, `02`, `10`, `23`. Never `1`, `Slide 1`, or `1 / 24`. Sora SemiBold 13 Pt.

Cover and closing have no footer. Numbering starts on the first content slide as `01` and ends on the last content slide before closing.

## The wave motif

Signature soft undulation, not a quarter-circle. `add_wave(slide, variant, fill)` handles all placement variants — sizes and positions are wired in per variant. The horizontal wave comes in TWO sizes: an accent size (used on every content slide) and a hero size (used only where the wave IS the backdrop of the layout).

- **`band`** — full-width horizontal top accent, ~1.5" tall. Use on cover/hero slides where the wave is a colour ribbon, not a section-header bed.
- **`band-hero`** — full-width horizontal, ~4.87" tall. Reserved for the *Section header* layout where the band forms the header's coloured area.
- **`strip`** — full-width horizontal, ~1.79" tall. Top accent on a narrative section.
- **`foot`** — full-width horizontal bottom accent, flipped, ~0.9" tall. Use on content slides where the wave is a footer band, not a full-bleed backdrop.
- **`foot-hero`** — full-width horizontal, flipped, ~2.19" tall. Reserved for the *Closing* and *Blank* layouts where the wave dominates the bottom.
- **`side`** / **`side-r`** — full-height, anchored left or right. ~7.66" × 7.5".
- **`corner`** — small standalone accent, 2.5" × 0.9", needs explicit x, y. The one variant at the path's own aspect, so it shows the full curve.

Recolour by `fill=` — `"teal"` (default), `"navy"`, `"saffron"`, `"red"`.

**The path is fixed; the box is not.** Never edit the SVG path, never rotate or skew it — the helper handles the flips. Width and height belong to the variant, and the accent sizes flatten the curve deliberately: against the path's own aspect `band` is 3.2× flatter, `strip` 2.7×, `foot-hero` 2.2×, `foot` 5.3×, with `band-hero` 0.98× and `corner` 1.0×. Intended, not drift — do not "correct" them.

**Pairing rule.** A `foot` (or `foot-hero`) wave under a content slide always pairs with `add_page_footer(..., has_foot_wave=True)` — the helper switches the number/wordmark to the `banded` (white-on-teal) treatment automatically.

**Use sparingly.** One or two waves in a deck of ten; six is decoration. Never behind body text, never on the masthead, never stacked.

Requires cairosvg (`pip install cairosvg`).

## Fit checks

Every fit check measures: `sora_wrap` lays the text out with the real Sora advance widths and returns the lines, and `fits`/`warn_if_overruns`/the auto-shrink ladders all read that. The TTFs are already on disk because `fetch_sora` caches them for embedding; measurement needs fontTools (`pip install fonttools`) and falls back to the character constants without it.

The constants (`SORA_CHARS_PT_IN` 122 mixed case, `SORA_CAPS_CHARS` 95 all-caps, `SORA_BODY_CHARS` 128 body, `SORA_LINE_RATIO` 0.0175) are the fallback and the authoring rule of thumb. **Do not use them to decide whether something fits** — counting characters cannot see word boundaries, so a title inside its character budget can still wrap and overrun.

## Icons

Line icons — 2 Pt stroke, rounded joins, single colour matching the surround. python-pptx can't draw arbitrary line icons; the reliable path:

1. Pick from Untitled UI (v1.6) — same set as the Hubtel template. Common: `wallet`, `credit-card`, `line-chart-up`, `bar-chart`, `users`, `globe`, `shield`, `zap`, `settings`, `send`, `gift`, `star`.
2. Render each to a small PNG (transparent background, `currentColor` swapped for the target hue) at 96 or 128 px square.
3. Pass to `add_ficon(slide, x, y, icon_png_stream=...)` when using a feature-icon container, or `slide.shapes.add_picture(...)` directly for inline placement.

**Never** substitute an emoji or filled shape.

## Charts

Use pptx-native charts (not embedded images) so they stay editable. **Read `dataviz` first** for chart-type choice, form heuristics, mark specs. This section overrides only the colour and typographic defaults for Hubtel.

**Categorical palette (in order).** `TEAL` (primary) → `NAVY` (secondary) → `SAFFRON` (highlighted "our number" / CTA) → `RED` (negative outcome) → `TEAL_ACCENT` (fifth) → `SLATE_600` (sixth / catch-all). Six categories ceiling; group rest into "Other".

**Sequential (single-hue).** Teal ramp `TEAL_50 → TEAL_100 → TEAL_200 → TEAL_500 → TEAL_600 → TEAL_700`. Navy ramp: mix `NAVY` with `WHITE` at 90/70/50/30/10%.

**Diverging.** `RED` (low) → `SLATE_100` (zero) → `TEAL` (high). Hubtel red always reads as loss/attention — do not put red on the positive side even when convention would.

**Semantic (fixed meanings — never reuse).** `SUCCESS` positive/above target · `DANGER` negative/below target · `WARNING` on-hold · `INFO` neutral info.

**Chart defaults.**
- **Type** — Sora, 12 Pt axis labels `SLATE_700`, title 18 Pt Bold `SLATE_900`, one-line subtitle 13 Pt `SLATE_600`.
- **Gridlines** — horizontal only, `SLATE_200`, 1 Pt. No vertical grid, no chart border.
- **Axis** — baseline `SLATE_300` 1 Pt, tick labels `SLATE_600`. Y starts at zero for magnitudes; a broken axis needs a `↯` mark and a caption.
- **Bars** — small rounded top corners (leave square if pptx can't round). Gap width 60%, group gap 90%.
- **Lines** — 2 Pt stroke. No markers on dense series; `r=4` markers on sparse series (≤12 points).
- **Legend** — below plot, left-aligned, 12 Pt, `SLATE_700`. Skip for one-series charts.
- **Numbers** — GHS values `GHS 1,240.50` on axes and data labels; percentages with one decimal only when precision matters; large counts as `k`/`m` on axes but full numbers in data labels.
- **Print** — the deck may be printed monochrome. Never encode meaning by hue alone; add a shape, label, or pattern.

## Delivery

**Save with `save_deck(prs, out_path)` — never `prs.save(...)`.** One call saves the deck and embeds the four Sora weights. It halts if the Sora fetch fails; pass `embed_fonts=False` only if the user accepts it, and say so.

**What embedding actually guarantees — say this, do not overstate it.** The deck renders in Sora wherever Sora is installed, and wherever the reader's app honours embedded fonts, which in practice means PowerPoint on Windows. LibreOffice, Google Slides, Keynote, most web previewers and often PowerPoint on macOS substitute a fallback while still reporting "Sora" in the font panel. For an external audience, say so in one line and offer a PDF, which carries fonts unconditionally.

**Write the deck once, into the working directory, and never move it.** Copying or relocating it can break the hand-off to the user. Resolve the path at runtime (os.getcwd()) rather than hardcoding one:

```python
import os

filename = "hubtel-q3-review"          # kebab-case slug of the deck title
out_path = os.path.join(os.getcwd(), f"{filename}.pptx")
save_deck(prs, out_path)
print("wrote:", out_path, os.path.getsize(out_path), "bytes")
```

The slug takes no spaces, no dates unless the title has one, no version suffix, and no subdirectory. (`/tmp/hubtel_pptx.py` is a scratch file and can live anywhere; the deck cannot.)

**Verify the embed, do not infer it from file size.** Four embedded weights land around 240 KB, but the zip deflates the ~376 KB of TTFs by roughly half, so size proves nothing. Check the zip:

```python
import zipfile

with zipfile.ZipFile(out_path) as z:
    fonts = [n for n in z.namelist() if n.startswith("ppt/fonts/")]
print("embedded fonts:", len(fonts), fonts)
if len(fonts) < 4:
    print("WARNING: expected 4 embedded weights, found", len(fonts))
```

**The final step is handing the finished deck back to the user through whatever this environment’s file-delivery tool is**. That tool is the whole delivery mechanism — preview and hand-off in one — so there is no separate send step, and pasting the path into the reply delivers nothing. Nothing runs after it.

## What this skill does not do

Argument, section order, depth. Numbers (never invent a stat or KPI; leave `—` and mark the notes with a pending marker). Copy Bank lines (separate asset, marketing/pitch use only). HTML reports, PDFs, Word docs, spreadsheets — hand off.



---

## Logo blocks

Two `data:` URIs. Copy one whole and pass it to `add_logo`.

**Colour wordmark** — light surfaces (white, teal-50, saffron):

```
data:image/png;base64,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
```

**White wordmark** — dark surfaces (navy, teal, red):

```
data:image/png;base64,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
```