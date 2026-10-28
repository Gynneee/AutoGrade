import argparse
import json
import math
import random
import re
import tarfile
from pathlib import Path, PurePosixPath

import numpy as np
from PIL import Image


DATASET_URL = "https://storage.googleapis.com/download.tensorflow.org/example_images/flower_photos.tgz"
EXPECTED_ARCHIVE_SIZE = 228_813_984
FLOWER_CLASSES = ("daisy", "dandelion", "roses", "sunflowers", "tulips")
IMAGE_SIZE = (256, 256)
BASE = Path("dataset/flower_match")
ARCHIVE = Path("dataset/flower_photos.tgz")
PHOTO_DIR = BASE / "photos"
SOURCE_DIR = BASE / "images/source"
REFERENCE_DIR = BASE / "images/reference"
MANIFEST_PATH = BASE / "train.jsonl"
ATTRIBUTION_PATH = BASE / "ATTRIBUTION.txt"


def download_archive(path):
    if path.exists():
        if path.stat().st_size != EXPECTED_ARCHIVE_SIZE:
            raise ValueError(
                f"{path} is {path.stat().st_size} bytes; expected "
                f"{EXPECTED_ARCHIVE_SIZE}. Remove the incomplete archive and retry."
            )
        return

    import urllib.request

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".part")
    request = urllib.request.Request(
        DATASET_URL,
        headers={"User-Agent": "GradeMatchLocalTraining/1.0"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        with temporary.open("wb") as output:
            total = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                total += len(chunk)
                if total % (32 * 1024 * 1024) < len(chunk):
                    print(f"Downloaded {total / 1e6:.0f} MB...", flush=True)
    if temporary.stat().st_size != EXPECTED_ARCHIVE_SIZE:
        raise OSError(
            f"Archive download ended at {temporary.stat().st_size} bytes; "
            f"expected {EXPECTED_ARCHIVE_SIZE}."
        )
    temporary.replace(path)


def extract_photos(archive_path, destination):
    destination.mkdir(parents=True, exist_ok=True)
    extracted = 0
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive:
            if not member.isfile():
                continue
            relative = PurePosixPath(member.name)
            if member.name == "flower_photos/LICENSE.txt":
                license_path = destination.parent / "Flower_Photos_LICENSE.txt"
                if not license_path.exists():
                    source = archive.extractfile(member)
                    if source is not None:
                        with source, license_path.open("wb") as target:
                            target.write(source.read())
                continue
            if (
                len(relative.parts) != 3
                or relative.parts[0] != "flower_photos"
                or relative.parts[1] not in FLOWER_CLASSES
                or relative.suffix.lower() not in (".jpg", ".jpeg")
            ):
                continue
            output = destination.joinpath(*relative.parts[1:])
            if output.exists():
                continue
            source = archive.extractfile(member)
            if source is None:
                continue
            output.parent.mkdir(parents=True, exist_ok=True)
            with source, output.open("wb") as target:
                target.write(source.read())
            extracted += 1
            if extracted % 500 == 0:
                print(f"Extracted {extracted} photos...", flush=True)
    counts = {
        category: sum(1 for path in (destination / category).glob("*.jpg"))
        for category in FLOWER_CLASSES
    }
    if sum(counts.values()) < 100:
        raise ValueError(f"Dataset extraction found too few photos: {counts}")
    license_path = destination.parent / "Flower_Photos_LICENSE.txt"
    if not license_path.is_file():
        raise FileNotFoundError(
            f"The archive's image attribution license was not extracted: {license_path}"
        )
    print(f"Available source photos by category: {counts}")
    return counts


def linear_to_oklab(rgb):
    r, g, b = np.moveaxis(rgb, -1, 0)
    l = np.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = np.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = np.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return np.stack(
        (
            0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
        ),
        axis=-1,
    )


def oklab_to_linear(lab):
    lightness, a, b = np.moveaxis(lab, -1, 0)
    l = lightness + 0.3963377774 * a + 0.2158037573 * b
    m = lightness - 0.1055613458 * a - 0.0638541728 * b
    s = lightness - 0.0894841775 * a - 1.291485548 * b
    l, m, s = l**3, m**3, s**3
    return np.stack(
        (
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        ),
        axis=-1,
    )


def srgb_to_linear(rgb):
    return np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(rgb):
    rgb = np.clip(rgb, 0, 1)
    return np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - 0.055)


def apply_settings(image, settings):
    rgb = np.asarray(image.convert("RGB"), dtype=np.float64) / 255
    linear = srgb_to_linear(rgb)

    temperature = settings["temp"]
    tint = settings["tint"]
    red = 2 ** (0.0045 * temperature)
    blue = 2 ** (-0.0045 * temperature)
    green = 2 ** (-0.0035 * tint)
    normalization = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    gains = np.array((red, green, blue)) / normalization
    linear *= gains * 2 ** settings["exposure"]
    linear = np.clip(linear, 0, 1)

    luminance = (
        0.2126 * linear[..., 0]
        + 0.7152 * linear[..., 1]
        + 0.0722 * linear[..., 2]
    )
    encoded_luminance = linear_to_srgb(luminance)
    contrast = settings["contrast"] / 100 * 0.9
    highlights = settings["highlights"] / 100 * 0.22
    shadows = settings["shadows"] / 100 * 0.22
    whites = settings["whites"] / 100 * 0.12
    blacks = settings["blacks"] / 100 * 0.12
    tone_input = np.linspace(0, 1, 1025)
    tone_output = tone_input.copy()
    tone_output += (
        contrast * 4 * tone_input * (1 - tone_input) * (tone_input - 0.5)
        + highlights * np.exp(-((tone_input - 0.75) / 0.2) ** 2)
        + shadows * np.exp(-((tone_input - 0.25) / 0.2) ** 2)
        + whites * np.exp(-((tone_input - 0.93) / 0.1) ** 2)
        + blacks * np.exp(-((tone_input - 0.07) / 0.1) ** 2)
    )
    tone_output = np.maximum.accumulate(np.clip(tone_output, 0, 1))
    toned = np.interp(encoded_luminance, tone_input, tone_output)
    toned_linear = srgb_to_linear(toned)
    ratio = (toned_linear + 0.003) / (luminance + 0.003)
    offset = 0.003 * (toned_linear - luminance) / (luminance + 0.003)
    linear = np.clip(linear * ratio[..., None] + offset[..., None], 0, 1)

    lab = linear_to_oklab(linear)
    chroma = np.sqrt(lab[..., 1] ** 2 + lab[..., 2] ** 2)
    hue = np.arctan2(lab[..., 2], lab[..., 1])
    saturation = max(0, 1 + settings["saturation"] / 100)
    vibrance = settings["vibrance"] / 100 * 0.8
    vibrance_multiplier = np.maximum(0, 1 + vibrance * (1 - np.minimum(chroma / 0.2, 1)))
    chroma_adjusted = chroma * saturation * vibrance_multiplier
    lab[..., 1] = chroma_adjusted * np.cos(hue)
    lab[..., 2] = chroma_adjusted * np.sin(hue)
    result = linear_to_srgb(np.clip(oklab_to_linear(lab), 0, 1))
    return Image.fromarray(np.round(result * 255).astype(np.uint8))


def random_settings(rng):
    return {
        "temp": rng.uniform(-35, 35),
        "tint": rng.uniform(-25, 25),
        "exposure": rng.uniform(-1.25, 1.25),
        "contrast": rng.uniform(-45, 45),
        "highlights": rng.uniform(-55, 55),
        "shadows": rng.uniform(-55, 55),
        "whites": rng.uniform(-40, 40),
        "blacks": rng.uniform(-40, 40),
        "vibrance": rng.uniform(-55, 55),
        "saturation": rng.uniform(-35, 35),
        "curve": [0, 32, 64, 128, 192, 224, 255],
        "hsl": [{"h": 0, "s": 0, "l": 0} for _ in range(8)],
        "grade": {
            "sh": {"hue": 0, "sat": 0},
            "mid": {"hue": 0, "sat": 0},
            "hi": {"hue": 0, "sat": 0},
        },
    }


def prepare(photo_dir, output_dir, variants, seed, max_images):
    rng = random.Random(seed)
    source_dir = output_dir / "images" / "source"
    reference_dir = output_dir / "images" / "reference"
    source_dir.mkdir(parents=True, exist_ok=True)
    reference_dir.mkdir(parents=True, exist_ok=True)
    photos_by_class = {
        category: sorted((photo_dir / category).glob("*.jpg"))
        for category in FLOWER_CLASSES
    }
    if not all(photos_by_class.values()):
        raise FileNotFoundError(f"No extracted photos found under {photo_dir}.")

    if max_images:
        image_count = min(max_images, sum(map(len, photos_by_class.values())))
        per_class = max(1, math.ceil(image_count / len(FLOWER_CLASSES)))
        selected = [
            path
            for category in FLOWER_CLASSES
            for path in rng.sample(
                photos_by_class[category],
                min(per_class, len(photos_by_class[category])),
            )
        ][:image_count]
    else:
        selected = [path for category in FLOWER_CLASSES for path in photos_by_class[category]]
        rng.shuffle(selected)

    license_path = output_dir / "Flower_Photos_LICENSE.txt"
    license_entries = {}
    with license_path.open(encoding="utf-8") as license_file:
        for line in license_file:
            match = re.fullmatch(
                r"(\S+\.jpe?g) CC-BY (?:by (.+?) - (https?://\S+)|"
                r"(https?://\S+) - by (.+))",
                line.rstrip(),
            )
            if not match:
                continue
            image_name, author_first, url_first, url_last, author_last = match.groups()
            author = author_first or author_last
            url = url_first or url_last
            license_entries[image_name] = f"by {author} - {url}"

    validation_ids = {f"{path.parent.name}_{path.stem}" for path in selected[::5]}
    source_images = {}
    source_pools = {"train": [], "validation": []}
    selected_credits = {}
    for image_index, path in enumerate(selected):
        image_id = f"{path.parent.name}_{path.stem}"
        archive_relative = f"{path.parent.name}/{path.name}"
        if archive_relative not in license_entries:
            raise ValueError(
                f"Missing photographer attribution for dataset image {archive_relative}."
            )
        selected_credits[archive_relative] = license_entries[archive_relative]
        source_relative = Path("images") / "source" / f"{image_id}.jpg"
        source_path = output_dir / source_relative
        try:
            if source_path.is_file():
                with Image.open(source_path) as image:
                    source_image = image.convert("RGB")
            else:
                with Image.open(path) as image:
                    source_image = image.convert("RGB")
                    source_image.thumbnail(IMAGE_SIZE, Image.Resampling.LANCZOS)
        except OSError as error:
            print(f"Skipping unreadable image {path}: {error}")
            continue
        if not source_path.exists():
            source_image.save(source_path, "JPEG", quality=88)
        split = "validation" if image_id in validation_ids else "train"
        source_images[image_id] = (source_relative, split)
        source_pools[split].append(source_path)
        if (image_index + 1) % 100 == 0:
            print(f"Prepared {image_index + 1}/{len(selected)} source photos...", flush=True)

    rows = []
    for image_index, (image_id, (source_relative, split)) in enumerate(source_images.items()):
        candidates = source_pools[split]
        source_path = output_dir / source_relative
        reference_candidates = [path for path in candidates if path != source_path]
        if not reference_candidates:
            raise ValueError(f"Not enough photos in the {split} split to pair references.")
        for variant in range(variants):
            settings = random_settings(rng)
            reference_source_path = rng.choice(reference_candidates)
            reference_id = reference_source_path.stem
            reference_relative = (
                Path("images")
                / "reference"
                / f"{image_id}_from_{reference_id}_edit_{variant:02}.jpg"
            )
            reference_path = output_dir / reference_relative
            if not reference_path.exists():
                with Image.open(reference_source_path) as image:
                    reference_image = image.convert("RGB")
                apply_settings(reference_image, settings).save(reference_path, "JPEG", quality=88)
            rows.append(
                {
                    "source": source_relative.as_posix(),
                    "reference": reference_relative.as_posix(),
                    "settings": settings,
                    "group": image_id,
                    "split": split,
                }
            )
        if (image_index + 1) % 100 == 0:
            print(
                f"Prepared {image_index + 1}/{len(source_images)} source photos "
                f"and {len(rows)} cross-photo labeled pairs...",
                flush=True,
            )

    if len(rows) < 10:
        raise ValueError(f"Too few synthetic examples were prepared: {len(rows)}.")
    manifest_path = output_dir / "train.jsonl"
    with manifest_path.open("w", encoding="utf-8") as manifest:
        for row in rows:
            manifest.write(json.dumps(row, separators=(",", ":")) + "\n")

    attribution = (
        "Photo dataset: TensorFlow Flower Photos dataset (3,670 photographs from Flickr).\n"
        f"Dataset archive: {DATASET_URL}\n"
        "Dataset documentation: https://www.tensorflow.org/tutorials/load_data/images\n"
        "Image license: Creative Commons Attribution 2.0 Generic (CC BY 2.0).\n"
        "License: https://creativecommons.org/licenses/by/2.0/\n"
        "The full attribution list for the original archive is in Flower_Photos_LICENSE.txt.\n"
        "Photographer credits for the original photos used in this manifest:\n"
        + "".join(
            f"{image_name} CC-BY {credit}\n"
            for image_name, credit in sorted(selected_credits.items())
        )
        + "\n"
        "Original images and synthetic derivatives are retained locally under dataset/ "
        "and are not published by this preparation script.\n"
        "Training references are generated from different flower photos in the same split "
        "as their source, with synthetic settings generated locally by this project. "
        "They are not human-authored edits or Lightroom labels.\n"
    )
    (output_dir / "ATTRIBUTION.txt").write_text(attribution, encoding="utf-8")
    print(
        json.dumps(
            {
                "sourcePhotos": len(selected),
                "syntheticPairs": len(rows),
                "variantsPerPhoto": variants,
                "manifest": str(manifest_path),
                "attribution": str(output_dir / "ATTRIBUTION.txt"),
            },
            indent=2,
        )
    )


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Build a compact synthetic photo-grading dataset from the TensorFlow "
            "Flower Photos archive. The generated labels are not expert edits."
        )
    )
    parser.add_argument("--archive", type=Path, default=ARCHIVE)
    parser.add_argument("--output-dir", type=Path, default=BASE)
    parser.add_argument("--photo-dir", type=Path, default=BASE / "photos")
    parser.add_argument("--variants", type=int, default=3)
    parser.add_argument("--max-images", type=int, default=0)
    parser.add_argument("--seed", type=int, default=23)
    args = parser.parse_args()
    if args.variants < 1:
        parser.error("--variants must be positive.")
    if args.max_images < 0:
        parser.error("--max-images cannot be negative.")
    archive_path = args.archive.resolve()
    photo_dir = args.photo_dir.resolve()
    output_dir = args.output_dir.resolve()
    download_archive(archive_path)
    extract_photos(archive_path, photo_dir)
    prepare(photo_dir, output_dir, args.variants, args.seed, args.max_images)


if __name__ == "__main__":
    main()
