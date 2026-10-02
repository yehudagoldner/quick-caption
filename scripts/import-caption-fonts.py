"""Import Google's free Hebrew fonts as static TTFs shared by preview and FFmpeg.

Requires fonttools. Run from the repository root; no runtime Python dependency.
The Google Fonts legacy CSS endpoint supplies a static face at the chosen weight.
Original files and licenses are retained without subsetting or renaming fonts.
"""
import concurrent.futures
import io
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = ROOT / "public" / "fonts"
LICENSE_DIR = FONT_DIR / "licenses"
LICENSE_DIR.mkdir(parents=True, exist_ok=True)


def fetch(url):
    for attempt in range(3):
        try:
            return urllib.request.urlopen(url, timeout=60).read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def source_license(family):
    slug = re.sub(r"[^a-z0-9]", "", family.lower())
    for directory, filename in [("ofl", "OFL.txt"), ("apache", "LICENSE.txt")]:
        base = f"https://raw.githubusercontent.com/google/fonts/main/{directory}/{slug}/"
        try:
            metadata = fetch(base + "METADATA.pb").decode()
        except Exception:
            continue
        license_name = re.search(r'license: "([^"]+)"', metadata).group(1)
        if license_name not in ("OFL", "APACHE2"):
            raise ValueError(f"Unsupported license for {family}: {license_name}")
        try:
            license_text = fetch(base + filename).decode()
        except Exception:
            # Some families keep their license only in the pinned upstream tree.
            repository = re.search(r'repository_url: "https://github.com/([^"\n]+)"', metadata)
            commit = re.search(r'commit: "([^"]+)"', metadata)
            if not repository or not commit:
                raise
            upstream = f"https://raw.githubusercontent.com/{repository.group(1)}/{commit.group(1)}/{filename}"
            license_text = fetch(upstream).decode()
        return license_name, license_text, base
    raise ValueError(f"No redistributable license found for {family}")


def describe_font(path, family, font_id, category, source, license_name):
    font = TTFont(path)
    cmap = font.getBestCmap()
    missing = [chr(c) for c in range(0x05D0, 0x05EB) if c not in cmap]
    if missing:
        raise ValueError(f"{family} lacks Hebrew letters: {missing}")
    if "fvar" in font:
        raise ValueError(f"{family} is variable; static face required")
    metrics = font["OS/2"]
    return dict(id=font_id, label=family,
                family="Assistant SemiBold" if font_id == "assistant" else font["name"].getBestFamilyName(),
                postScriptName=font["name"].getDebugName(6),
                cssFamily="Assistant SemiBold" if font_id == "assistant" else f"QC Caption {family}",
                file=path.name, weight=metrics.usWeightClass,
                emRatio=font["head"].unitsPerEm / (metrics.usWinAscent + metrics.usWinDescent),
                category=category, license=license_name, source=source)


def import_family(family):
    name = family["family"]
    license_name, license_text, source = source_license(name)
    font_id = re.sub(r"[^a-z0-9]", "", name.lower())
    if name == "Assistant":
        path = FONT_DIR / "Assistant-SemiBold.ttf"
    else:
        weights = [int(w) for w in family["fonts"] if w.isdigit()]
        weight = 700 if 700 in weights else 600 if 600 in weights else 400
        css = fetch("https://fonts.googleapis.com/css?family=" + urllib.parse.quote(f"{name}:{weight}") + "&subset=hebrew,latin").decode()
        urls = re.findall(r"url\((https://[^)]+\.ttf)\)", css)
        if len(urls) != 1:
            raise ValueError(f"Expected one complete TTF for {name}")
        path = FONT_DIR / f"{font_id}.ttf"
        data = fetch(urls[0])
        # Validate before keeping any font asset.
        font = TTFont(io.BytesIO(data))
        if "fvar" in font:
            raise ValueError(f"Unexpected variable font for {name}")
        path.write_bytes(data)
    item = describe_font(path, name, font_id, family["category"], source, license_name)
    (LICENSE_DIR / f"{font_id}.md").write_text(f"Source: {source}\n\n{license_text}", encoding="utf-8")
    print(f"Imported {name}: {path.stat().st_size} bytes", flush=True)
    return item


metadata = fetch("https://fonts.google.com/metadata/fonts").decode()
families = [f for f in json.loads(metadata[metadata.index("{"):])["familyMetadataList"] if "hebrew" in f.get("subsets", [])]
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    jobs = {pool.submit(import_family, family): family["family"] for family in families}
    fonts = []
    for job in concurrent.futures.as_completed(jobs):
        try:
            fonts.append(job.result())
        except Exception as error:
            print(f"Excluded {jobs[job]}: {error}", flush=True)
categories = {"Sans Serif": 0, "Serif": 1, "Handwriting": 2, "Monospace": 3, "Display": 4}
fonts.sort(key=lambda f: (-1 if f["id"] == "assistant" else categories.get(f["category"], 5), f["label"]))
(ROOT / "src" / "captionFonts.js").write_text(
    "// Generated by scripts/import-caption-fonts.py; original licenses: public/fonts/licenses.\n"
    + "export const CAPTION_FONTS = " + json.dumps(fonts, ensure_ascii=False, indent=2) + ";\n"
    + 'export const DEFAULT_CAPTION_FONT_ID = "heebo";\n'
    + 'export function getCaptionFont(id) { return CAPTION_FONTS.find(font => font.id === id) ?? CAPTION_FONTS.find(font => font.id === DEFAULT_CAPTION_FONT_ID); }\n', encoding="utf-8")
css = ["/* Generated local static faces, also consumed by FFmpeg. Loaded on demand. */"]
for font in fonts:
    if font["id"] == "assistant":
        continue  # Existing face in App.css preserves its loading behavior.
    css.append(f'@font-face {{ font-family: "{font["cssFamily"]}"; src: url("/fonts/{font["file"]}") format("truetype"); font-weight: {font["weight"]}; font-style: normal; font-display: swap; }}')
(ROOT / "src" / "client" / "captionFonts.css").write_text("\n".join(css) + "\n", encoding="utf-8")
print(f"Total: {len(fonts)} Hebrew font families", flush=True)
