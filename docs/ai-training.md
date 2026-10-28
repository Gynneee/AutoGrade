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
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-train.txt
python train_color_matcher.py --manifest dataset\train.jsonl
```

The trainer requires at least five labeled examples to run and keeps a validation split. Five is only a technical minimum, not enough to expect reliable color matching; use many varied examples and keep genuinely separate photos for evaluation. It prints validation metrics and exports `public/models/color_matcher.onnx`. These metrics are a smoke check, not a guarantee of perceptual quality.

### Try a small FiveK sample

You do not need the 50 GB archive for a first pipeline test. The project can download five individual FiveK examples (DNG plus one expert TIFF each), convert them locally, and read the Lightroom settings embedded in the TIFF metadata:

```powershell
python -m pip install -r requirements-train.txt
python prepare_fivek_sample.py
python train_color_matcher.py --manifest dataset\fivek_sample\train.jsonl --output dataset\fivek_sample\color_matcher_trial.onnx
```

The sample is only a smoke test: five photos are far too few to evaluate generalization, and the output model is kept under `dataset\` rather than enabled in the website. Some older Lightroom settings do not map directly to this app's controls, so the preparation script uses neutral values for unsupported controls such as temperature. FiveK is licensed for research use only; retain the included license files, do not use the sample for commercial purposes, and do not upload its images or model to GitHub.

## Run the app

For a single HTML file you can open directly, run:

```powershell
npm install
npm run build:single
Start-Process ".\dist\Grade Match.html"
```

The page, app code, styles and browser inference runtime are bundled into `dist\Grade Match.html`. If you train a model and want the app to load that model, run it through the local development server instead:

```powershell
npm run dev
```

Open the local URL printed by Vite. When the ONNX file exists, this mode runs the trained model in the browser. If it is missing, the app clearly says that the trained model is unavailable and uses the existing non-AI solver as a fallback. The generated ONNX file is ignored by git so the dataset/model can remain private.

## Model outline

The input is a pair of 101-value image summaries: luminance and OKLab quantiles, color-band measurements, and shadow/midtone/highlight measurements. A small multilayer perceptron predicts 50 normalized settings, including the tone curve, HSL, and color grading. Training is supervised: it learns from your desired edits rather than calling a hosted model.
