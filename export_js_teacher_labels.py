import argparse
import json
import math
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "dataset" / "flower_match"
SOURCE_MANIFEST = DATASET / "train.jsonl"


class TeacherExportServer(ThreadingHTTPServer):
    def __init__(self, address, handler, selected, output_path):
        super().__init__(address, handler)
        self.selected = selected
        self.expected = {row["group"]: row for row in selected}
        self.seen = set()
        self.output_path = output_path


class Handler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def send_json(self, status, value):
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        request = urlparse(self.path)
        if request.path == "/pairs":
            query = parse_qs(request.query)
            try:
                offset = int(query.get("offset", ["0"])[0])
                limit = int(query.get("limit", ["100"])[0])
            except ValueError:
                self.send_json(400, {"error": "offset and limit must be integers"})
                return
            if offset < 0 or limit < 1 or limit > 250:
                self.send_json(400, {"error": "Use a nonnegative offset and limit 1-250"})
                return
            pairs = self.server.selected[offset : offset + limit]
            self.send_json(
                200,
                {"pairs": pairs, "total": len(self.server.selected), "offset": offset},
            )
            return

        if request.path == "/image":
            relative = parse_qs(request.query).get("path", [""])[0]
            image_path = (DATASET / relative).resolve()
            allowed = (DATASET / "images").resolve()
            if (
                not image_path.is_relative_to(allowed)
                or image_path.suffix.lower() not in (".jpg", ".jpeg")
                or not image_path.is_file()
            ):
                self.send_json(404, {"error": "Training image not found"})
                return
            body = image_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if request.path == "/status":
            self.send_json(
                200,
                {
                    "labeledPairs": len(self.server.seen),
                    "totalPairs": len(self.server.selected),
                },
            )
            return

        self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if urlparse(self.path).path != "/labels":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            batch = json.loads(self.rfile.read(length))
            if not isinstance(batch, list) or not batch:
                raise ValueError("Expected a non-empty array of teacher-labeled pairs.")
            accepted = []
            accepted_groups = set()
            for row in batch:
                group = row["group"]
                expected = self.server.expected.get(group)
                if (
                    expected is None
                    or group in self.server.seen
                    or group in accepted_groups
                ):
                    raise ValueError(f"Unexpected or duplicate training group: {group}")
                for key in ("source", "reference", "split"):
                    if row[key] != expected[key]:
                        raise ValueError(f"Unexpected {key} for training group {group}")
                settings = row["settings"]
                numeric_values = [
                    settings[key]
                    for key in (
                        "temp",
                        "tint",
                        "exposure",
                        "contrast",
                        "highlights",
                        "shadows",
                        "whites",
                        "blacks",
                        "vibrance",
                        "saturation",
                    )
                ]
                numeric_values.extend(settings["curve"])
                for band in settings["hsl"]:
                    numeric_values.extend(band[key] for key in ("h", "s", "l"))
                for zone in ("sh", "mid", "hi"):
                    numeric_values.extend(
                        settings["grade"][zone][key] for key in ("hue", "sat")
                    )
                if len(settings["curve"]) != 7 or len(settings["hsl"]) != 8:
                    raise ValueError(f"Incomplete settings for training group {group}")
                if any(not math.isfinite(float(value)) for value in numeric_values):
                    raise ValueError(f"Non-finite settings for training group {group}")
                accepted.append(
                    {
                        "source": expected["source"],
                        "reference": expected["reference"],
                        "settings": settings,
                        "group": group,
                        "split": expected["split"],
                    }
                )
                accepted_groups.add(group)
            with self.server.output_path.open("a", encoding="utf-8") as output:
                for row in accepted:
                    output.write(json.dumps(row, separators=(",", ":")) + "\n")
                output.flush()
            self.server.seen.update(row["group"] for row in accepted)
            self.send_json(
                200,
                {
                    "accepted": len(accepted),
                    "labeledPairs": len(self.server.seen),
                    "totalPairs": len(self.server.selected),
                },
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})

    def log_message(self, format_string, *args):
        if self.path.startswith("/labels") or self.path.startswith("/status"):
            super().log_message(format_string, *args)


def load_pairs(limit):
    by_group = {}
    with SOURCE_MANIFEST.open(encoding="utf-8") as manifest:
        for line in manifest:
            if not line.strip():
                continue
            row = json.loads(line)
            by_group.setdefault(row["group"], row)
    if limit > len(by_group):
        raise ValueError(f"Requested {limit} pairs; only {len(by_group)} groups exist.")
    if limit < 10:
        raise ValueError("At least 10 pairs are required for a useful teacher dataset.")
    return list(by_group.values())[:limit]


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Collect labels from the browser's existing JavaScript matching solver "
            "for the local synthetic photo pairs."
        )
    )
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--output",
        type=Path,
        default=DATASET / "js_teacher_manifest.jsonl",
    )
    args = parser.parse_args()
    if not SOURCE_MANIFEST.is_file():
        raise FileNotFoundError(
            f"Prepare the flower dataset first: {SOURCE_MANIFEST}"
        )
    output_path = args.output.resolve()
    if output_path.exists():
        raise FileExistsError(
            f"Refusing to overwrite existing teacher labels: {output_path}"
        )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    selected = load_pairs(args.limit)
    server = TeacherExportServer(("127.0.0.1", args.port), Handler, selected, output_path)
    print(f"Teacher-label server: http://127.0.0.1:{args.port}", flush=True)
    print(
        "Open http://localhost:5173/Grade%20Match.html?trainingTeacher=1 "
        "in the browser, then collect batches from /pairs and POST labels to /labels.",
        flush=True,
    )
    print(f"Writing labels to {output_path}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print(
            f"\nCollected {len(server.seen)}/{len(selected)} teacher labels.",
            flush=True,
        )
        if len(server.seen) != len(selected):
            raise RuntimeError("Teacher-label collection was incomplete.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
