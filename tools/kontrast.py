"""Prüft die Design-Tokens aus www/css/themes.css gegen WCAG AA.
Text: >= 4.5:1, Bedienelemente/Grafik (Fokus, Prioritätsbalken): >= 3:1.
Aufruf: python tools/kontrast.py"""
import re, sys, pathlib

css = (pathlib.Path(__file__).parent.parent / "www/css/themes.css").read_text(encoding="utf-8")

def lum(h):
    h = h.lstrip('#')
    r, g, b = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def ratio(a, b):
    la, lb = lum(a), lum(b)
    if la < lb: la, lb = lb, la
    return (la + 0.05) / (lb + 0.05)

blocks = re.findall(r'(?:\:root,\s*)?\[data-theme="(\w+)"\]\s*\{(.*?)\n\}', css, re.S)
themes = {}
for name, body in blocks:
    themes[name] = dict(re.findall(r'--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;', body))

base = themes["hell"]
TEXT = [  # (Vordergrund, Hintergrund)
    ("text", "bg"), ("text", "bg-2"), ("text", "surface"), ("text", "surface-2"),
    ("text-2", "bg"), ("text-2", "bg-2"), ("text-2", "surface"), ("text-2", "surface-2"),
    ("accent-ink", "accent"), ("accent-text", "surface"), ("accent-text", "bg"),
    ("accent-text", "accent-soft"), ("text", "accent-soft"),
    ("danger", "surface"), ("danger", "bg"), ("text", "danger-soft"), ("danger", "danger-soft"),
    ("success", "surface"), ("warn", "surface"),
    ("text", "today-bg"), ("text-2", "today-bg"), ("text", "weekend-bg"), ("text-2", "weekend-bg"),
] + [("text", f"tile-{i}") for i in range(1, 8)]
UI = [("prio-low", "surface"), ("prio-med", "surface"), ("prio-high", "surface"),
      ("focus", "surface"), ("focus", "bg"), ("border-strong", "surface")]

bad = 0
for name, t in themes.items():
    t = {**{k: v for k, v in base.items()}, **t} if name != "hell" else t
    print(f"== {name}")
    for fg, bg in TEXT:
        if fg in t and bg in t:
            r = ratio(t[fg], t[bg])
            if r < 4.5:
                bad += 1; print(f"  TEXT  {fg:12s} auf {bg:12s} {r:5.2f}  < 4.5  ({t[fg]} / {t[bg]})")
    for fg, bg in UI:
        if fg in t and bg in t:
            r = ratio(t[fg], t[bg])
            if r < 3:
                bad += 1; print(f"  UI    {fg:12s} auf {bg:12s} {r:5.2f}  < 3.0  ({t[fg]} / {t[bg]})")
print("\nProbleme:", bad)
sys.exit(1 if bad else 0)
