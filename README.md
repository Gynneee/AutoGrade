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

The model is trained locally from synthetic adjustments to the TensorFlow Flower Photos set. It varies ten basic settings; tone-curve, HSL, and color-grading targets are neutral. This teaches the model a limited slider-recovery task, not expert retouching, and the flower-only training domain does not establish accuracy on portraits, landscapes, or arbitrary cross-scene matching. See the training guide and attribution files for details.

This workspace has a trained, local-only model at `public\models\color_matcher.onnx`: 11,010 synthetic pairs from 3,670 credited photos, with 2,202 held-out validation pairs. Its validation MAE is only modestly better than predicting zero adjustments for most sliders, so treat it as a training-pipeline demonstration, not a reliable general-purpose matcher. The model and dataset are Git-ignored and will not be present in a fresh clone.

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

The preparation script downloads TensorFlow's 218 MB Flower Photos archive and generates synthetic labeled edits locally. It produces about 11,000 pairs from 3,670 flower photographs. This is enough to train and validate the pipeline, but it is flower-domain data with synthetic settings, not expert retouching or proof of general photo-style matching. The photos are CC BY 2.0; keep the generated attribution file with the local dataset and review the license before redistribution. The dataset and trained model are ignored by Git.

For your own dataset, each JSONL training example needs a source image, a reference image, and the desired adjustment settings. See the training guide for the full schema and instructions.

## How matching works

1. The app extracts color and tone statistics from the source and reference images.
2. If a local ONNX model is available, it predicts adjustment settings from the two image summaries.
3. Otherwise, the built-in calculation-based matcher estimates settings from the image statistics.
4. The selected adjustments are applied to a browser canvas for preview and image export.

The model does not generate pixels directly. It predicts adjustment controls; the app applies those controls to the source image.

## Related project: `hahnec/color-matcher`

[`hahnec/color-matcher`](https://github.com/hahnec/color-matcher) is a Python image-to-image color-transfer library. It offers algorithmic methods such as histogram matching, Reinhard transfer, MKL, and multivariate Gaussian transfer, with command-line and Python API usage. It can transfer the color distribution of a reference image directly onto a source image; it does not require training a neural network for those methods.

Grade Match is a browser editing application rather than a general-purpose Python library. Its optional AI is trained to predict editable Lightroom-style settings from paired image features and labeled adjustments. Until a sufficiently large, representative dataset is prepared and a model is installed, its normal matching path is the built-in calculation-based matcher. The two projects therefore use different approaches and are not the same model or interchangeable implementations.

## Project files

- `Grade Match.html` — app interface.
- `script.js` and `styles.css` — browser behavior and styling.
- `train_color_matcher.py` — local neural-network training and ONNX export.
- `prepare_synthetic_training.py` — creates labeled synthetic examples from the compact flower-photo dataset.
- `docs/ai-training.md` — dataset, training, and model instructions.

## License

No project license is specified in this repository. The downloaded flower photos are licensed under CC BY 2.0; preserve their photographer credits from `dataset/flower_match/Flower_Photos_LICENSE.txt` and the selected-image credits in `dataset/flower_match/ATTRIBUTION.txt`.
