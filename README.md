# CineMatch

CineMatch is a browser-based photo color-matching tool. Choose a photo to edit and a reference photo, compare the before-and-after preview, refine the suggested Lightroom-style settings, and export the result.

The app runs locally in your browser. Your photos are processed on your device and are not sent to an inference API.

## Features

- Upload a source photo and a reference image (JPEG, PNG, or WebP).
- Compare the original and matched result with a draggable split preview.
- Inspect luminance histograms and dominant colors.
- Adjust white balance, tone, tone curve, HSL, color grading, and match strength.
- Export the matched image as PNG or copy Lightroom-compatible preset XML and settings.
- Optionally run a locally trained ONNX model in the browser.
- Fall back to the built-in calculation-based matcher when no trained model is installed.

RAW files are not supported directly in the browser; export them as JPEG first.

## Run locally

Requirements: Node.js and npm.

```powershell
npm install
npm run dev
```

Open the local address printed by Vite. To create a self-contained HTML build:

```powershell
npm run build
```

The single-file build is written to `dist/Grade Match.html`. It can be opened in a browser; use the development server when testing a local ONNX model.

## AI model and current status

The optional AI is a supervised neural network trained locally with Python and exported to ONNX. The browser runs ONNX inference using ONNX Runtime Web. The model accepts summaries of the source and reference images and predicts 50 Lightroom-style adjustment values.

The model is trained locally to imitate the JavaScript color-matching solver on synthetic same-photo flower pairs. The browser runs both the ONNX model and the calculation matcher, then selects the result with the lower measured distance to the reference. This quality guard means the UI can use JavaScript when it outperforms the current model; the status message identifies which result was selected. This is not a claim that the neural network is more accurate than its teacher. See the training guide and attribution files for details.

The compact model uses 1,000 solver-labeled pairs from the CC BY 2.0 flower set (800 training / 200 held-out photos). In a held-out preview comparison, the AI alone reduced the app's reference-distance metric by 62%, versus 96% for the JavaScript solver; the app therefore selects the solver on that example. The model and detailed training statistics are local under `public\models\color_matcher.onnx` and `dataset\flower_match\`; both are Git-ignored and will not be present in a fresh clone. See [the training curve](docs/training_curves.svg) and [validation report](docs/ai-training.md#training-report-and-graph).

For training details, dataset format, and limitations, see [docs/ai-training.md](docs/ai-training.md).

### Train a compact local model

Requirements: Python 3.12 or newer. From PowerShell in the project folder:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-train.txt
python prepare_synthetic_training.py
python train_color_matcher.py --manifest dataset\flower_match\train.jsonl --output public\models\color_matcher.onnx
```

The preparation script downloads TensorFlow's 218 MB Flower Photos archive and generates three synthetic edits of each of 3,670 flower photos. Training and validation use separate source photos. The labels are synthetic, not expert retouching or proof of general photo-style matching. The photos are CC BY 2.0; keep the generated attribution file with the local dataset and review the license before redistribution. The dataset and trained model are ignored by Git.

For your own dataset, each JSONL training example needs a source image, a reference image, and the desired adjustment settings. See the training guide for the full schema and instructions.

## How matching works

1. The app extracts color and tone statistics from the source and reference images.
2. If a local ONNX model is available, it predicts adjustment settings from the two image summaries.
3. Otherwise, the built-in calculation-based matcher estimates settings from the image statistics.
4. The selected adjustments are applied to a browser canvas for preview and image export.

The model does not generate pixels directly. It predicts adjustment controls; the app applies those controls to the source image.

## Project files

- `Grade Match.html` — app interface.
- `script.js` and `styles.css` — browser behavior and styling.
- `train_color_matcher.py` — local neural-network training and ONNX export.
- `prepare_synthetic_training.py` — creates labeled synthetic examples from the compact flower-photo dataset.
- `docs/ai-training.md` — dataset, training, and model instructions.

## License

No project license is specified in this repository. The downloaded flower photos are licensed under CC BY 2.0; preserve their photographer credits from `dataset/flower_match/Flower_Photos_LICENSE.txt` and the selected-image credits in `dataset/flower_match/ATTRIBUTION.txt`.
