import argparse
import io
import json
import re
import urllib.request
from pathlib import Path
from xml.etree import ElementTree

import numpy as np
import rawpy
from PIL import Image, ImageCms


BASE_URL = "https://data.csail.mit.edu/graphics/fivek"
IMAGE_IDS = (
    "a0001-jmac_DSC1459",
    "a0002-dgw_005",
    "a0003-NKIM_MG_8178",
    "a0004-jmac_MG_1384",
    "a0005-jn_2007_05_10__564",
)
CRS = "http://ns.adobe.com/camera-raw-settings/1.0/"
RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
CURVE_X = (0, 32, 64, 128, 192, 224, 255)
HSL_BANDS = ("Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta")


def download(url, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "GradeMatch-FiveK-Research-Sample/1.0"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        expected = response.headers.get("Content-Length")
        if expected is not None and destination.exists() and destination.stat().st_size == int(expected):
            return
        temporary = destination.with_name(destination.name + ".part")
        with temporary.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
    if expected is not None and temporary.stat().st_size != int(expected):
        raise OSError(
            f"Incomplete download for {destination.name}: "
            f"{temporary.stat().st_size} of {expected} bytes."
        )
    temporary.replace(destination)


def read_xmp(path):
    data = path.read_bytes()
    start = data.find(b"<x:xmpmeta")
    if start < 0:
        raise ValueError(f"No embedded XMP metadata found in {path.name}.")
    end_tag = b"</x:xmpmeta>"
    end = data.find(end_tag, start)
    if end < 0:
        raise ValueError(f"Unterminated XMP metadata in {path.name}.")
    root = ElementTree.fromstring(data[start : end + len(end_tag)])
    return root


def get_tag(root, name, default=None):
    element = root.find(f".//{{{CRS}}}{name}")
    if element is None or element.text is None:
        return default
    return element.text.strip()


def get_number(root, name, default=0):
    value = get_tag(root, name, default)
    return float(value)


def curve_values(root):
    curve = root.find(f".//{{{CRS}}}ToneCurve")
    if curve is None:
        return list(CURVE_X)
    points = []
    for item in curve.findall(f".//{{{RDF}}}li"):
        if item.text:
            match = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*", item.text)
            if match:
                points.append((float(match.group(1)), float(match.group(2))))
    if len(points) < 2:
        return list(CURVE_X)
    points.sort()
    x_values, y_values = zip(*points)
    return [
        float(np.interp(x, x_values, y_values))
        for x in CURVE_X
    ]


def settings_from_xmp(root):
    settings = {
        "temp": 0,
        "tint": get_number(root, "Tint"),
        "exposure": get_number(root, "Exposure"),
        "contrast": get_number(root, "Contrast"),
        "highlights": -get_number(root, "HighlightRecovery"),
        "shadows": get_number(root, "Shadows", get_number(root, "FillLight")),
        "whites": get_number(root, "Whites"),
        "blacks": get_number(root, "Blacks"),
        "vibrance": get_number(root, "Vibrance"),
        "saturation": get_number(root, "Saturation"),
        "curve": curve_values(root),
        "hsl": [
            {
                "h": get_number(root, f"HueAdjustment{band}"),
                "s": get_number(root, f"SaturationAdjustment{band}"),
                "l": get_number(root, f"LuminanceAdjustment{band}"),
            }
            for band in HSL_BANDS
        ],
        "grade": {
            "sh": {
                "hue": get_number(root, "SplitToningShadowHue"),
                "sat": get_number(root, "SplitToningShadowSaturation"),
            },
            "mid": {"hue": 0, "sat": 0},
            "hi": {
                "hue": get_number(root, "SplitToningHighlightHue"),
                "sat": get_number(root, "SplitToningHighlightSaturation"),
            },
        },
    }
    return settings


def convert_source(source_path, output_path):
    with rawpy.imread(str(source_path)) as raw:
        rgb = raw.postprocess(
            use_camera_wb=True,
            output_color=rawpy.ColorSpace.sRGB,
            output_bps=8,
            no_auto_bright=True,
            gamma=(2.4, 12.92),
        )
    image = Image.fromarray(rgb)
    image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    image.save(output_path, "JPEG", quality=90, optimize=True)


def convert_reference(reference_path, output_path):
    with Image.open(reference_path) as source:
        icc_profile = source.info.get("icc_profile")
        if not icc_profile:
            raise ValueError(f"No embedded ICC profile found in {reference_path.name}.")
        image = ImageCms.profileToProfile(
            source,
            ImageCms.ImageCmsProfile(io.BytesIO(icc_profile)),
            ImageCms.createProfile("sRGB"),
            outputMode="RGB",
        )
        image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        image.save(output_path, "JPEG", quality=90, optimize=True)


def prepare(output_dir, expert):
    raw_dir = output_dir / "raw"
    image_dir = output_dir / "images"
    license_dir = output_dir / "licenses"
    manifest_path = output_dir / "train.jsonl"
    output_dir.mkdir(parents=True, exist_ok=True)
    image_dir.mkdir(parents=True, exist_ok=True)
    license_dir.mkdir(parents=True, exist_ok=True)

    license_path = license_dir / "LicenseAdobe.txt"
    download(f"{BASE_URL}/legal/LicenseAdobe.txt", license_path)
    download(f"{BASE_URL}/legal/filesAdobe.txt", license_dir / "filesAdobe.txt")

    rows = []
    for image_id in IMAGE_IDS:
        source_path = raw_dir / f"{image_id}.dng"
        reference_path = raw_dir / f"{image_id}_{expert}.tif"
        source_jpeg = image_dir / f"{image_id}_source.jpg"
        reference_jpeg = image_dir / f"{image_id}_{expert}.jpg"

        download(f"{BASE_URL}/img/dng/{image_id}.dng", source_path)
        download(f"{BASE_URL}/img/tiff16_{expert.lower()}/{image_id}.tif", reference_path)
        metadata = read_xmp(reference_path)
        settings = settings_from_xmp(metadata)
        convert_source(source_path, source_jpeg)
        convert_reference(reference_path, reference_jpeg)
        rows.append(
            {
                "source": f"images/{source_jpeg.name}",
                "reference": f"images/{reference_jpeg.name}",
                "settings": settings,
            }
        )
        print(f"Prepared {image_id} using expert {expert} settings.")

    with manifest_path.open("w", encoding="utf-8") as manifest:
        for row in rows:
            manifest.write(json.dumps(row, separators=(",", ":")) + "\n")
    print(f"Wrote {len(rows)} labeled examples to {manifest_path}.")


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Prepare a small MIT–Adobe FiveK sample from individual official files. "
            "Images are licensed for research use only."
        )
    )
    parser.add_argument("--expert", choices=("A", "B", "C", "D", "E"), default="A")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("dataset/fivek_sample"),
    )
    args = parser.parse_args()
    prepare(args.output_dir.resolve(), args.expert)


if __name__ == "__main__":
    main()
