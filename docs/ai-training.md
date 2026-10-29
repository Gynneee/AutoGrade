# Training the local color matcher

Grade Match can use a small supervised neural network trained locally with your examples. Training runs with Python and the exported model runs in the browser through ONNX Runtime Web. There is no remote inference API; the photos are not uploaded.

## What data is needed?

Each labeled example must have:

1. A source photo to edit.
2. A reference photo showing the look to match.
3. The desired Lightroom-style settings for editing the source photo.

Photos without desired setting labels are not enough to teach this model which edit to predict. You can create labels by editing a source photo in Lightroom, then recording the settings for the intended matched result. Use varied scenes and looks, and reserve some examples for testing rather than training.

Create a JSON Lines file with one object per line. Photo paths are relative to the manifest file:

```json
{"source":"images/source-001.jpg","reference":"images/reference-001.jpg","settings":{"temp":6,"tint":-3,"exposure":0.2,"contrast":12,"highlights":-20,"shadows":15,"whites":4,"blacks":-8,"vibrance":10,"saturation":-2,"curve":[0,28,61,128,194,228,255],"hsl":[{"h":0,"s":0,"l":0},{"h":-2,"s":8,"l":1},{"h":0,"s":0,"l":0},{"h":0,"s":0,"l":0},{"h":0,"s":0,"l":0},{"h":-5,"s":4,"l":0},{"h":0,"s":0,"l":0},{"h":0,"s":0,"l":0}],"grade":{"sh":{"hue":205,"sat":18},"mid":{"hue":30,"sat":7},"hi":{"hue":42,"sat":10}}}}
```

`hsl` entries are ordered Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta. `curve` contains the output values for input points 0, 32, 64, 128, 192, 224, 255. The numeric limits match the settings controls in the app.

## Train and export

Use Python 3.12 or newer. From the project folder:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-train.txt
python train_color_matcher.py --manifest dataset\train.jsonl
```

The trainer requires at least five labeled examples to run and keeps a validation split. Five is only a technical minimum, not enough to expect reliable color matching; use many varied examples and keep genuinely separate photos for evaluation. It prints validation metrics and exports `public/models/color_matcher.onnx`. These metrics are a smoke check, not a guarantee of perceptual quality.

### Compact synthetic training run

For a local training run without FiveK, the project can use TensorFlow's 218 MB Flower Photos example archive. Its 3,670 CC BY 2.0 flower photos cover five flower categories; this is a small, domain-limited image set, not a professional photo-grading collection. The script creates three examples per photo by applying known, locally generated settings to the source itself and using that edited copy as the reference. This makes the labels correspond to the visible source-to-reference change:

```powershell
python -m pip install -r requirements-train.txt
python prepare_synthetic_training.py
python train_color_matcher.py --manifest dataset\flower_match\train.jsonl --output public\models\color_matcher.onnx
```

The resulting manifest contains 11,010 source/reference pairs. It keeps training and validation source-photo groups separate, so a photo cannot leak between the two splits. The trainer checks that source-image groups do not cross the split. The script writes per-photo credits to `dataset\flower_match\ATTRIBUTION.txt` and extracts the full archive credit list to `dataset\flower_match\Flower_Photos_LICENSE.txt`; source images, generated pairs, and the model stay under the Git-ignored `dataset/` folder or the ignored model path.

**Important limitation:** the flower references are synthetic edits, not photographer-authored grades. The extended run described below adds portraits, landscapes, architecture, and urban photos, but its targets still come from the JavaScript solver. The neural network can imitate that algorithm but cannot learn preferences the teacher does not express. It is not trained to detect faces or reliably segment skin; its skin-related input is only a color heuristic. Review held-out metrics before relying on or sharing the model.

### Distill the JavaScript solver

To train the neural network to imitate the existing JavaScript solver, collect teacher labels for a subset of the generated pairs:

1. Start Vite with `npm run dev`.
2. In a second terminal, start the local-only label collector: `.\.venv\Scripts\python.exe export_js_teacher_labels.py --limit 1000`.
3. Open the URL printed by the collector, adding `?trainingTeacher=1&collectTeacherLabels=1` after `Grade%20Match.html` (for example, `http://localhost:5173/Grade%20Match.html?trainingTeacher=1&collectTeacherLabels=1`). Leave the browser tab open while it processes batches.
4. When the page reports that collection is complete, stop the collector with Ctrl+C and train from its output:

```powershell
.\.venv\Scripts\python.exe train_color_matcher.py --manifest dataset\flower_match\js_teacher_manifest.jsonl --output public\models\color_matcher.onnx
```

The collector binds only to localhost. Its browser training mode uses the JavaScript calculation matcher to create targets; the resulting validation score measures imitation of that matcher on held-out flower photos. It does not show that the neural network is more perceptually accurate than the teacher or that it generalizes to other types of photographs. Use a larger `--limit` to collect more pairs, allowing several minutes for each thousand images.

### Extended mixed-scene training run

The base mixed-scene dataset combines 1,000 solver-labeled flower pairs with 60 pairs from openly licensed Commons photos: 15 portraits, 15 landscapes, 15 architecture scenes, and 15 urban scenes. Each source/reference pair is based on one photo plus a synthetic edit. The label collector runs the existing JavaScript solver to produce settings for each pair; no hosted inference API is used. Keep the downloaded files and `ATTRIBUTION.tsv` together, and check the license terms before redistributing any dataset. The latest run also included 36 additional portrait pairs.

To reproduce the diverse dataset and collect its labels, first prepare the flower dataset as above, then run:

```powershell
python prepare_diverse_training.py --count-per-category 15
```

In another terminal, start Vite (`npm run dev`) and run the label collector:

```powershell
.\.venv\Scripts\python.exe export_js_teacher_labels.py --manifest dataset\diverse_match\train.jsonl --limit 60 --output dataset\diverse_match\js_teacher_manifest.jsonl
```

Open `http://localhost:5173/Grade%20Match.html?trainingTeacher=1&collectTeacherLabels=1` and leave the page open until all 60 pairs are collected. Then stop the collector with Ctrl+C. To train using both labeled manifests:

```powershell
.\.venv\Scripts\python.exe train_color_matcher.py --manifest dataset\flower_match\js_teacher_manifest.jsonl --manifest dataset\diverse_match\js_teacher_manifest.jsonl --output public\models\color_matcher.onnx
```

The trainer uses the manifests' explicit train/validation splits and rejects groups that leak across them. The 60 diverse pairs increase scene variety, but are still a small synthetic dataset; they do not establish reliable portrait, skin-tone, or cinematic-style performance.

### Portrait-focused expansion and skin-tone handling

The browser now computes six soft skin-color summary features per image: estimated candidate share, the candidate lightness 25th/50th/75th percentiles, and mean OKLab `a`/`b`. A gradual YCbCr color heuristic feeds these summaries and optionally reduces HSL/color-grading chroma changes on likely skin-colored pixels. The **Protect skin tones** checkbox enables this behavior. It is not face detection, a learned segmentation mask, or a guarantee that every skin pixel is found and every non-skin pixel is excluded; colored clothing, wood, shadows, and unusual illumination can still confuse it.

To collect more licensed portrait scenes without overwriting the existing mixed dataset:

```powershell
.\.venv\Scripts\python.exe prepare_diverse_training.py --portrait-only --count-per-category 100 --output-dir dataset\portrait_match
```

The acquisition script records source titles, attribution, and license details in `dataset\portrait_match\ATTRIBUTION.tsv`. It may return fewer than 100 photos if Commons rate-limits the request or the selected categories do not have enough eligible items. The latest run prepared 36 licensed portraits after Commons rate-limited the larger download. Run teacher labeling with a separate port while another local collector is already using the default; set `--limit` to the actual number in `train.jsonl`:

```powershell
.\.venv\Scripts\python.exe export_js_teacher_labels.py --manifest dataset\portrait_match\train.jsonl --limit 36 --port 8766 --output dataset\portrait_match\js_teacher_manifest.jsonl
```

Open the app and leave it open to collect the labels:

```text
http://localhost:5173/Grade%20Match.html?trainingTeacher=1&collectTeacherLabels=1&teacherServer=http://127.0.0.1:8766
```

Then retrain from all labeled sources:

```powershell
.\.venv\Scripts\python.exe train_color_matcher.py --manifest dataset\flower_match\js_teacher_manifest.jsonl --manifest dataset\diverse_match\js_teacher_manifest.jsonl --manifest dataset\portrait_match\js_teacher_manifest.jsonl --output public\models\color_matcher.onnx
.\.venv\Scripts\python.exe local-report\generate_training_report.py
```

More portrait photographs increase scene exposure, but solver-generated labels do not measure whether skin tones look natural. To claim high skin-segmentation precision/recall, create manually annotated skin masks across a balanced set of skin tones, lighting conditions, and camera pipelines, and evaluate against a held-out annotated set. The current model predicts global editing controls; it is not a face-aware local retoucher.

### Training report and graph

The trainer reports the completed and best epoch, train and validation MSE, normalized MAE, and per-slider validation MAE against a zero-adjustment baseline in `dataset\flower_match\training_report.json`. It saves per-epoch training/validation MSE and normalized MAE to `dataset\flower_match\training_history.csv`. The MSE curve is saved as `docs\training_curves.svg`. Optional Word report-generation files and supplemental graphs are kept locally in the Git-ignored `local-report\` folder, not distributed with the application. Regression does not have a meaningful classification accuracy percentage; lower MAE/MSE is better, so the epoch-by-epoch MAE is reported instead of inventing an accuracy threshold.

The latest solver-distilled run used 1,096 pairs: 1,000 flower, 60 diverse-scene, and 36 additional portrait pairs (876 training / 220 validation groups). It completed 188 epochs and restored the best checkpoint from epoch 148. Validation MSE was 0.121745 (training MSE 0.115192). Mean normalized MAE across the 50 output values was 0.213570, compared with 0.329885 for predicting zero for every output. That is a 35.3% decrease in this setting-prediction metric against the baseline. Per-slider validation MAE is in the app's slider units:

| Setting | Model MAE | Always-zero MAE |
|---|---:|---:|
| Temperature | 18.64 | 23.99 |
| Tint | 17.11 | 24.81 |
| Exposure | 0.44 | 0.68 |
| Contrast | 33.68 | 38.06 |
| Highlights | 44.31 | 45.67 |
| Shadows | 32.36 | 33.23 |
| Whites | 60.44 | 65.39 |
| Blacks | 30.17 | 30.36 |
| Vibrance | 31.77 | 30.12 |
| Saturation | 19.54 | 22.00 |

This measures prediction of synthetic, solver-generated settings on held-out image groups, **not** perceptual similarity to human grading or equivalence to the JavaScript solver. The validation split is held out by source-image group. The training/validation curve is included below and saved as [`training_curves.svg`](./training_curves.svg) for reports.

![Training and validation MSE over 188 epochs](./training_curves.svg)

The app evaluates the AI and calculation-based candidates and selects the one that is closer according to its image-statistics distance metric. This is a hybrid quality safeguard, not evidence that the model wins on every image or that the metric matches human judgment.

## Run the app

Build the app with:

```powershell
npm install
npm run build
```

The page and styles are bundled into `dist\Grade Match.html`; the LibRaw worker bundles remain as separate files in `dist\`. Keep the complete output directory together. Do not open the HTML using `file://` if you need RAW decoding or ONNX model loading; use the development server or preview server:

```powershell
npm run preview
```

Vite's dev and preview servers set the cross-origin isolation headers required by the RAW worker. Other static hosts must set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` and serve the full build output. The ONNX model and datasets are Git-ignored and must be supplied locally. RAW files are decoded in the browser into rendered RGB pixels; the app can edit those pixels and export PNG, but it does not edit the original RAW sensor data. The Optics control applies a manual radial distortion adjustment to the source preview and PNG export; it is not selected from camera/lens metadata, and the adjustment is not included in exported XMP presets. Automatic camera/lens profiles, chromatic-aberration correction, and Lightroom-grade RAW rendering are not implemented.

## Model outline

The input is a pair of 107-value image summaries (214 values total): luminance and OKLab quantiles, color-band measurements, shadow/midtone/highlight measurements, and six soft skin-color statistics. A small multilayer perceptron predicts 50 normalized settings, including the tone curve, HSL, and color grading. Training is supervised: it learns from the supplied labels rather than calling a hosted model.
