
      import * as ort from "onnxruntime-web/wasm";

      "use strict";
      const RAD = 180 / Math.PI,
        DEG = Math.PI / 180;
      const clampN = (x, a, b) => (x < a ? a : x > b ? b : x);
      const smooth = (a, b, x) => {
        const t = clampN((x - a) / (b - a), 0, 1);
        return t * t * (3 - 2 * t);
      };
      const gauss = (x, c, w) => {
        const d = (x - c) / w;
        return Math.exp(-d * d);
      };

      const S2L = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const c = i / 255;
        S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      }
      const srgb2lin = (v) =>
        v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      const lin2srgb = (x) => {
        x = x < 0 ? 0 : x > 1 ? 1 : x;
        return x <= 0.0031308
          ? 12.92 * x
          : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
      };
      const TN = 4096;
      const OETF = new Float32Array(TN + 1),
        EOTF = new Float32Array(TN + 1);
      for (let i = 0; i <= TN; i++) {
        OETF[i] = lin2srgb(i / TN);
        EOTF[i] = srgb2lin(i / TN);
      }
      function oetf(y) {
        y = y < 0 ? 0 : y > 1 ? 1 : y;
        const f = y * TN,
          i = f | 0;
        return i >= TN ? OETF[TN] : OETF[i] + (OETF[i + 1] - OETF[i]) * (f - i);
      }
      function eotf(v) {
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        const f = v * TN,
          i = f | 0;
        return i >= TN ? EOTF[TN] : EOTF[i] + (EOTF[i + 1] - EOTF[i]) * (f - i);
      }

      function lin2lab(r, g, b, o) {
        const l = Math.cbrt(
          0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
        );
        const m = Math.cbrt(
          0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
        );
        const s = Math.cbrt(
          0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
        );
        o[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
        o[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
        o[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
      }
      function lab2lin(L, a, b, o) {
        const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
        const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
        const s_ = L - 0.0894841775 * a - 1.291485548 * b;
        const l = l_ * l_ * l_,
          m = m_ * m_ * m_,
          s = s_ * s_ * s_;
        o[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
        o[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
        o[2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
      }

      function hsv2rgb(h, s, v) {
        h = ((h % 360) + 360) % 360;
        const c = v * s,
          x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
          m = v - c;
        let r, g, b;
        if (h < 60) {
          r = c;
          g = x;
          b = 0;
        } else if (h < 120) {
          r = x;
          g = c;
          b = 0;
        } else if (h < 180) {
          r = 0;
          g = c;
          b = x;
        } else if (h < 240) {
          r = 0;
          g = x;
          b = c;
        } else if (h < 300) {
          r = x;
          g = 0;
          b = c;
        } else {
          r = c;
          g = 0;
          b = x;
        }
        return [r + m, g + m, b + m];
      }
      const _lab = [0, 0, 0];
      function hsvToLabAngleExact(h) {
        const c = hsv2rgb(h, 1, 1);
        lin2lab(srgb2lin(c[0]), srgb2lin(c[1]), srgb2lin(c[2]), _lab);
        return (Math.atan2(_lab[2], _lab[1]) * RAD + 360) % 360;
      }
      const HUE_U = new Float64Array(361);
      (function () {
        HUE_U[0] = hsvToLabAngleExact(0);
        for (let h = 1; h <= 360; h++) {
          const a = hsvToLabAngleExact(h % 360),
            p = HUE_U[h - 1] % 360;
          HUE_U[h] = HUE_U[h - 1] + (((a - p + 540) % 360) - 180);
        }
      })();
      function hueToLabAngle(h) {
        return hsvToLabAngleExact(h);
      }
      function labAngleToHue(th) {
        let t = ((th % 360) + 360) % 360;
        if (t < HUE_U[0]) t += 360;
        let lo = 0,
          hi = 360;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (HUE_U[mid] <= t) lo = mid;
          else hi = mid;
        }
        const f = (t - HUE_U[lo]) / (HUE_U[hi] - HUE_U[lo]);
        return (lo + f) % 360;
      }

      const BANDS = [
        { key: "Red", name: "Red", hsv: 0 },
        { key: "Orange", name: "Orange", hsv: 30 },
        { key: "Yellow", name: "Yellow", hsv: 60 },
        { key: "Green", name: "Green", hsv: 120 },
        { key: "Aqua", name: "Aqua", hsv: 180 },
        { key: "Blue", name: "Blue", hsv: 240 },
        { key: "Purple", name: "Purple", hsv: 270 },
        { key: "Magenta", name: "Magenta", hsv: 315 },
      ];
      const BAND_ANG = BANDS.map((b) => hsvToLabAngleExact(b.hsv));
      const HUE_SLIDER_DEG = 30;
      const GRADE_K = 0.05;

      let _bi = 0,
        _bj = 0,
        _bt = 0,
        _d0 = 0,
        _d1 = 0;
      function bandOf(th) {
        const ths = th < BAND_ANG[0] ? th + 360 : th;
        let bi = 7;
        for (let q = 0; q < 7; q++) {
          if (ths < BAND_ANG[q + 1]) {
            bi = q;
            break;
          }
        }
        const a0 = BAND_ANG[bi],
          a1 = bi < 7 ? BAND_ANG[bi + 1] : BAND_ANG[0] + 360;
        let t = (ths - a0) / (a1 - a0);
        t = t * t * (3 - 2 * t);
        _bi = bi;
        _bj = bi === 7 ? 0 : bi + 1;
        _bt = t;
        _d0 = ths - a0;
        _d1 = ths - a1;
      }

      const CURVE_X = [0, 32, 64, 128, 192, 224, 255];
      function neutralParams() {
        return {
          temp: 0,
          tint: 0,
          exposure: 0,
          contrast: 0,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          vibrance: 0,
          saturation: 0,
          curve: CURVE_X.map((x) => [x, x]),
          hsl: BANDS.map(() => ({ h: 0, s: 0, l: 0 })),
          grade: {
            sh: { hue: 0, sat: 0 },
            mid: { hue: 0, sat: 0 },
            hi: { hue: 0, sat: 0 },
          },
        };
      }
      const ALL_MODS = () => ({
        wb: true,
        tone: true,
        color: true,
        hsl: true,
        grade: true,
      });

      function makeCurve(points) {
        const n = points.length,
          xs = points.map((q) => q[0] / 255),
          ys = points.map((q) => q[1] / 255);
        const d = new Array(n - 1),
          m = new Array(n);
        for (let i = 0; i < n - 1; i++)
          d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
        m[0] = d[0];
        m[n - 1] = d[n - 2];
        for (let i = 1; i < n - 1; i++)
          m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
        for (let i = 0; i < n - 1; i++) {
          if (d[i] === 0) {
            m[i] = 0;
            m[i + 1] = 0;
            continue;
          }
          const a = m[i] / d[i],
            b = m[i + 1] / d[i],
            s = a * a + b * b;
          if (s > 9) {
            const t = 3 / Math.sqrt(s);
            m[i] = t * a * d[i];
            m[i + 1] = t * b * d[i];
          }
        }
        return function (v) {
          if (v <= xs[0]) return ys[0];
          if (v >= xs[n - 1]) return ys[n - 1];
          let k = 0;
          while (v > xs[k + 1]) k++;
          const h = xs[k + 1] - xs[k],
            t = (v - xs[k]) / h,
            t2 = t * t,
            t3 = t2 * t;
          return (
            (2 * t3 - 3 * t2 + 1) * ys[k] +
            (t3 - 2 * t2 + t) * h * m[k] +
            (-2 * t3 + 3 * t2) * ys[k + 1] +
            (t3 - t2) * h * m[k + 1]
          );
        };
      }
      function buildToneLUT(p) {
        const N = 1024,
          lut = new Float32Array(N + 1),
          cf = makeCurve(p.curve);
        const c = (p.contrast / 100) * 0.9,
          hi = (p.highlights / 100) * 0.22,
          sh = (p.shadows / 100) * 0.22,
          wh = (p.whites / 100) * 0.12,
          bl = (p.blacks / 100) * 0.12;
        let prev = 0;
        for (let i = 0; i <= N; i++) {
          const v = i / N;
          const d =
            c * 4 * v * (1 - v) * (v - 0.5) +
            hi * gauss(v, 0.75, 0.2) +
            sh * gauss(v, 0.25, 0.2) +
            wh * gauss(v, 0.93, 0.1) +
            bl * gauss(v, 0.07, 0.1);
          let v2 = cf(clampN(v + d, 0, 1));
          if (v2 < prev) v2 = prev;
          prev = v2;
          lut[i] = clampN(v2, 0, 1);
        }
        return lut;
      }
      function wbGains(t, ti) {
        const r = Math.pow(2, 0.0045 * t),
          b = Math.pow(2, -0.0045 * t),
          g = Math.pow(2, -0.0035 * ti);
        const nrm = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return [r / nrm, g / nrm, b / nrm];
      }

      function rgbaToLinear(rgba, n) {
        const o = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          o[i * 3] = S2L[rgba[i * 4]];
          o[i * 3 + 1] = S2L[rgba[i * 4 + 1]];
          o[i * 3 + 2] = S2L[rgba[i * 4 + 2]];
        }
        return o;
      }
      function encodeToRGBA(lin, n, dst) {
        for (let i = 0; i < n; i++) {
          dst[i * 4] = oetf(lin[i * 3]) * 255 + 0.5;
          dst[i * 4 + 1] = oetf(lin[i * 3 + 1]) * 255 + 0.5;
          dst[i * 4 + 2] = oetf(lin[i * 3 + 2]) * 255 + 0.5;
          dst[i * 4 + 3] = 255;
        }
      }

      function process(lin, n, p, out) {
        const tone = buildToneLUT(p),
          tmax = tone.length - 1;
        const ev = Math.pow(2, p.exposure || 0),
          gn = wbGains(p.temp || 0, p.tint || 0);
        const gR = gn[0] * ev,
          gG = gn[1] * ev,
          gB = gn[2] * ev;
        const sat = Math.max(0, 1 + (p.saturation || 0) / 100),
          vib = ((p.vibrance || 0) / 100) * 0.8;
        const Hs = p.hsl.map((b) => (b.h / 100) * HUE_SLIDER_DEG),
          Ss = p.hsl.map((b) => b.s / 100),
          Ls = p.hsl.map((b) => (b.l / 100) * 0.15);
        const hasHSL = p.hsl.some((b) => b.h || b.s || b.l);
        const gr = ["sh", "mid", "hi"].map((k) => {
          const g = p.grade[k],
            th = hueToLabAngle(g.hue) * DEG,
            amt = clampN(g.sat / 100, 0, 1) * GRADE_K;
          return [Math.cos(th) * amt, Math.sin(th) * amt];
        });
        const hasGrade = gr.some((v) => v[0] || v[1]);
        const doColor = sat !== 1 || vib !== 0 || hasHSL || hasGrade;
        const lab = [0, 0, 0],
          rgb = [0, 0, 0],
          E0 = 0.003;
        for (let i = 0; i < n; i++) {
          const k = i * 3;
          let r = lin[k] * gR,
            g = lin[k + 1] * gG,
            b = lin[k + 2] * gB;
          r = r > 1 ? 1 : r;
          g = g > 1 ? 1 : g;
          b = b > 1 ? 1 : b;
          const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const f = oetf(Y) * tmax,
            fi = f >= tmax ? tmax - 1 : f | 0;
          const v2 = tone[fi] + (tone[fi + 1] - tone[fi]) * (f - fi);
          const Y2 = eotf(v2);
          const s = (Y2 + E0) / (Y + E0),
            off = (E0 * (Y2 - Y)) / (Y + E0);
          r = r * s + off;
          g = g * s + off;
          b = b * s + off;
          r = r < 0 ? 0 : r > 1 ? 1 : r;
          g = g < 0 ? 0 : g > 1 ? 1 : g;
          b = b < 0 ? 0 : b > 1 ? 1 : b;
          if (doColor) {
            lin2lab(r, g, b, lab);
            let L = lab[0],
              A = lab[1],
              B = lab[2];
            const C = Math.sqrt(A * A + B * B);
            if (C > 1e-6) {
              let th = Math.atan2(B, A) * RAD;
              if (th < 0) th += 360;
              bandOf(th);
              const w0 = 1 - _bt,
                w1 = _bt;
              const sm = 1 + Ss[_bi] * w0 + Ss[_bj] * w1;
              const hs = Hs[_bi] * w0 + Hs[_bj] * w1;
              const ls = (Ls[_bi] * w0 + Ls[_bj] * w1) * Math.min(C / 0.06, 1);
              const vm = 1 + vib * (1 - Math.min(C / 0.2, 1));
              const C2 = C * sat * (sm > 0 ? sm : 0) * (vm > 0 ? vm : 0),
                th2 = (th + hs) * DEG;
              A = C2 * Math.cos(th2);
              B = C2 * Math.sin(th2);
              L += ls;
            }
            if (hasGrade) {
              const ws = 1 - smooth(0.25, 0.65, L),
                wh = smooth(0.45, 0.85, L),
                wm = gauss(L, 0.55, 0.2);
              A += gr[0][0] * ws + gr[1][0] * wm + gr[2][0] * wh;
              B += gr[0][1] * ws + gr[1][1] * wm + gr[2][1] * wh;
            }
            lab2lin(L, A, B, rgb);
            r = rgb[0] < 0 ? 0 : rgb[0] > 1 ? 1 : rgb[0];
            g = rgb[1] < 0 ? 0 : rgb[1] > 1 ? 1 : rgb[1];
            b = rgb[2] < 0 ? 0 : rgb[2] > 1 ? 1 : rgb[2];
          }
          out[k] = r;
          out[k + 1] = g;
          out[k + 2] = b;
        }
      }

      const NB = 512;
      const bin = (x, lo, hi) => {
        const k = (((x - lo) / (hi - lo)) * NB) | 0;
        return k < 0 ? 0 : k >= NB ? NB - 1 : k;
      };
      function histQ(h, lo, hi, total, q) {
        const target = q * total;
        let acc = 0;
        for (let k = 0; k < NB; k++) {
          const nx = acc + h[k];
          if (nx >= target) {
            const f = h[k] > 0 ? (target - acc) / h[k] : 0.5;
            return lo + ((k + f) / NB) * (hi - lo);
          }
          acc = nx;
        }
        return hi;
      }
      function histCdf(h, lo, hi, total, x) {
        const t = ((x - lo) / (hi - lo)) * NB;
        if (t <= 0) return 0;
        if (t >= NB) return 1;
        const k = t | 0;
        let acc = 0;
        for (let i = 0; i < k; i++) acc += h[i];
        return (acc + h[k] * (t - k)) / total;
      }
      const PQ = [];
      for (let i = 0; i < 20; i++) PQ.push(0.025 + i * 0.05);

      function analyze(lin, n) {
        const hv = new Float64Array(NB),
          hL = new Float64Array(NB),
          hA = new Float64Array(NB),
          hB = new Float64Array(NB),
          hC = new Float64Array(NB);
        const bShare = new Float64Array(8),
          bC = new Float64Array(8),
          bDh = new Float64Array(8),
          bL = new Float64Array(8);
        const zW = [0, 0, 0],
          zA = [0, 0, 0],
          zB = [0, 0, 0],
          lab = [0, 0, 0];
        for (let i = 0; i < n; i++) {
          const k = i * 3,
            r = lin[k],
            g = lin[k + 1],
            b = lin[k + 2];
          hv[bin(oetf(0.2126 * r + 0.7152 * g + 0.0722 * b), 0, 1)]++;
          lin2lab(r, g, b, lab);
          const L = lab[0],
            A = lab[1],
            B = lab[2],
            C = Math.sqrt(A * A + B * B);
          hL[bin(L, 0, 1)]++;
          hA[bin(A, -0.4, 0.4)]++;
          hB[bin(B, -0.4, 0.4)]++;
          hC[bin(C, 0, 0.4)]++;
          const ws = 1 - smooth(0.25, 0.65, L),
            wh = smooth(0.45, 0.85, L),
            wm = gauss(L, 0.55, 0.2);
          zW[0] += ws;
          zA[0] += ws * A;
          zB[0] += ws * B;
          zW[1] += wm;
          zA[1] += wm * A;
          zB[1] += wm * B;
          zW[2] += wh;
          zA[2] += wh * A;
          zB[2] += wh * B;
          if (C > 0.02) {
            let th = Math.atan2(B, A) * RAD;
            if (th < 0) th += 360;
            bandOf(th);
            const w0 = 1 - _bt,
              w1 = _bt;
            bShare[_bi] += w0;
            bShare[_bj] += w1;
            bC[_bi] += w0 * C;
            bC[_bj] += w1 * C;
            bDh[_bi] += w0 * C * _d0;
            bDh[_bj] += w1 * C * _d1;
            bL[_bi] += w0 * C * L;
            bL[_bj] += w1 * C * L;
          }
        }
        const dq = new Float32Array(PQ.length * 3);
        PQ.forEach((q, i) => {
          dq[i] = histQ(hL, 0, 1, n, q);
          dq[PQ.length + i] = histQ(hA, -0.4, 0.4, n, q);
          dq[PQ.length * 2 + i] = histQ(hB, -0.4, 0.4, n, q);
        });
        return {
          n,
          hv,
          hC,
          dq,
          band: BANDS.map((_, i) => ({
            share: bShare[i] / n,
            c: bShare[i] > 0 ? bC[i] / bShare[i] : 0,
            dh: bC[i] > 0 ? bDh[i] / bC[i] : 0,
            l: bC[i] > 0 ? bL[i] / bC[i] : 0,
          })),
          zone: [0, 1, 2].map((z) => ({
            f: zW[z] / n,
            a: zW[z] > 0 ? zA[z] / zW[z] : 0,
            b: zW[z] > 0 ? zB[z] / zW[z] : 0,
          })),
          qv: (q) => histQ(hv, 0, 1, n, q),
          qc: (q) => histQ(hC, 0, 0.4, n, q),
        };
      }
      function distance(a, b) {
        let s = 0;
        for (let i = 0; i < a.dq.length; i++) s += Math.abs(a.dq[i] - b.dq[i]);
        return (s / PQ.length) * 100;
      }

      function palette(lin, n, K) {
        K = K || 6;
        const step = Math.max(1, Math.floor(n / 3000)),
          pts = [],
          lab = [0, 0, 0];
        for (let i = 0; i < n; i += step) {
          lin2lab(lin[i * 3], lin[i * 3 + 1], lin[i * 3 + 2], lab);
          pts.push([lab[0], lab[1], lab[2]]);
        }
        const m = pts.length;
        if (!m) return [];
        let seed = 7;
        const rnd = () => {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return seed / 4294967296;
        };
        const cent = [pts[(rnd() * m) | 0].slice()];
        while (cent.length < K) {
          const dist = pts.map((p) =>
            Math.min(
              ...cent.map(
                (c) =>
                  (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2,
              ),
            ),
          );
          const tot = dist.reduce((a, b) => a + b, 0);
          if (tot <= 1e-12) break;
          let t = rnd() * tot,
            j = 0;
          while (j < m - 1 && (t -= dist[j]) > 0) j++;
          cent.push(pts[j].slice());
        }
        const cnt = new Array(cent.length).fill(0);
        for (let it = 0; it < 12; it++) {
          const sum = cent.map(() => [0, 0, 0]);
          cnt.fill(0);
          for (const p of pts) {
            let bi = 0,
              bd = 1e9;
            for (let c = 0; c < cent.length; c++) {
              const d =
                (p[0] - cent[c][0]) ** 2 +
                (p[1] - cent[c][1]) ** 2 +
                (p[2] - cent[c][2]) ** 2;
              if (d < bd) {
                bd = d;
                bi = c;
              }
            }
            sum[bi][0] += p[0];
            sum[bi][1] += p[1];
            sum[bi][2] += p[2];
            cnt[bi]++;
          }
          for (let c = 0; c < cent.length; c++)
            if (cnt[c])
              cent[c] = [
                sum[c][0] / cnt[c],
                sum[c][1] / cnt[c],
                sum[c][2] / cnt[c],
              ];
        }
        const rgb = [0, 0, 0];
        return cent
          .map((c, i) => {
            lab2lin(c[0], c[1], c[2], rgb);
            return {
              rgb: rgb.map((x) => Math.round(oetf(clampN(x, 0, 1)) * 255)),
              share: cnt[i] / m,
              L: c[0],
            };
          })
          .filter((x) => x.share > 0)
          .sort((a, b) => a.L - b.L);
      }

      function vecToHueSat(vx, vy) {
        const mag = Math.sqrt(vx * vx + vy * vy);
        if (mag < 1e-5) return { hue: 0, sat: 0 };
        return {
          hue: labAngleToHue(Math.atan2(vy, vx) * RAD),
          sat: Math.min(100, (mag / GRADE_K) * 100),
        };
      }

      function solve(srcLin, n, ref, opts) {
        const mods = opts.modules,
          p = neutralParams(),
          out = new Float32Array(n * 3);
        const run = (pp) => {
          process(srcLin, n, pp || p, out);
          return analyze(out, n);
        };
        const base = run();
        let cur = base;
        const e = 0.55;

        if (mods.wb && ref.zone[1].f > 0.02 && base.zone[1].f > 0.02) {
          const mid = (s) => [s.zone[1].a, s.zone[1].b];
          const m0 = mid(base),
            mr = mid(ref);
          const pt = neutralParams();
          pt.temp = 20;
          const mt = mid(run(pt));
          const pg = neutralParams();
          pg.tint = 20;
          const mg = mid(run(pg));
          const j11 = (mt[0] - m0[0]) / 20,
            j21 = (mt[1] - m0[1]) / 20,
            j12 = (mg[0] - m0[0]) / 20,
            j22 = (mg[1] - m0[1]) / 20;
          const det = j11 * j22 - j12 * j21;
          if (Math.abs(det) > 1e-10) {
            const da = 0.6 * (mr[0] - m0[0]),
              db = 0.6 * (mr[1] - m0[1]);
            p.temp = clampN((j22 * da - j12 * db) / det, -45, 45);
            p.tint = clampN((-j21 * da + j11 * db) / det, -45, 45);
          }
        }

        const vecs = [
            [0, 0],
            [0, 0],
            [0, 0],
          ],
          zkeys = ["sh", "mid", "hi"];
        const NIT = 14;
        for (let it = 0; it < NIT; it++) {
          cur = run();

          if (mods.tone) {
            const yc = eotf(cur.qv(0.5)),
              yr = eotf(ref.qv(0.5));
            if (yc > 1e-4 && yr > 1e-4)
              p.exposure = clampN(p.exposure + 0.7 * Math.log2(yr / yc), -3, 3);
            const upd = (key, pr, c, w, amp) => {
              const vc = cur.qv(pr),
                vr = ref.qv(pr),
                sens = (amp * Math.max(gauss(vc, c, w), 0.3)) / 100;
              p[key] = clampN(p[key] + (e * (vr - vc)) / sens, -100, 100);
            };
            upd("blacks", 0.03, 0.07, 0.1, 0.12);
            upd("shadows", 0.2, 0.25, 0.2, 0.22);
            upd("highlights", 0.8, 0.75, 0.2, 0.22);
            upd("whites", 0.97, 0.93, 0.1, 0.12);
            const h = (v) => 4 * v * (1 - v) * (v - 0.5);
            const c25 = cur.qv(0.25),
              c75 = cur.qv(0.75);
            const sens = Math.max(0.009 * Math.abs(h(c75) - h(c25)), 0.0015);
            p.contrast = clampN(
              p.contrast +
                (e * (ref.qv(0.75) - ref.qv(0.25) - (c75 - c25))) / sens,
              -100,
              100,
            );

            if (it === 9) {
              const pts = CURVE_X.map((x255) => {
                const x = x255 / 255,
                  F = clampN(histCdf(cur.hv, 0, 1, cur.n, x), 0.002, 0.998),
                  M = ref.qv(F);
                return [x255, clampN(x + 0.55 * (M - x), x - 0.09, x + 0.09)];
              });
              pts[0][1] = clampN(pts[0][1], 0, 0.06);
              pts[pts.length - 1][1] = clampN(pts[pts.length - 1][1], 0.94, 1);
              for (let i = 1; i < pts.length; i++)
                if (pts[i][1] < pts[i - 1][1] + 0.004)
                  pts[i][1] = pts[i - 1][1] + 0.004;
              p.curve = pts.map((q) => [q[0], q[1] * 255]);
            }
          }

          if (mods.color) {
            const c50 = cur.qc(0.5),
              c90 = cur.qc(0.9),
              r50 = ref.qc(0.5),
              r90 = ref.qc(0.9);
            if (c50 > 0.004 && c90 > 0.01 && r50 > 0.002 && r90 > 0.005) {
              const l50 = clampN(Math.log(r50 / c50), -0.6, 0.6),
                l90 = clampN(Math.log(r90 / c90), -0.6, 0.6);
              const d50 = 0.8 * (1 - Math.min(c50 / 0.2, 1)),
                d90 = 0.8 * (1 - Math.min(c90 / 0.2, 1));
              let y = 0;
              if (Math.abs(d50 - d90) > 0.12)
                y = clampN((l50 - l90) / (d50 - d90), -0.4, 0.4);
              const x = l90 - d90 * y;
              p.vibrance = clampN(p.vibrance + e * 100 * y, -100, 100);
              p.saturation = clampN(
                100 *
                  (Math.max(1 + p.saturation / 100, 0.02) * Math.exp(e * x) -
                    1),
                -100,
                100,
              );
            }
          }

          if (mods.hsl && it >= 2) {
            for (let b = 0; b < 8; b++) {
              const cs = cur.band[b],
                rs = ref.band[b];
              const conf = Math.min(1, Math.min(cs.share, rs.share) / 0.015);
              if (conf <= 0.05 || cs.c <= 0 || rs.c <= 0) continue;
              const f = e * conf,
                hb = p.hsl[b];
              hb.h = clampN(
                hb.h +
                  ((f * 0.6 * clampN(rs.dh - cs.dh, -12, 12)) /
                    HUE_SLIDER_DEG) *
                    100,
                -100,
                100,
              );
              hb.s = clampN(
                100 *
                  (Math.max(1 + hb.s / 100, 0.02) *
                    Math.exp(f * clampN(Math.log(rs.c / cs.c), -0.7, 0.7)) -
                    1),
                -100,
                100,
              );
              hb.l = clampN(
                hb.l + ((f * clampN(rs.l - cs.l, -0.1, 0.1)) / 0.15) * 100,
                -100,
                100,
              );
            }
          }

          if (mods.grade && it >= 2) {
            for (let z = 0; z < 3; z++) {
              const cz = cur.zone[z],
                rz = ref.zone[z];
              if (cz.f < 0.02 || rz.f < 0.02) continue;
              let vx = vecs[z][0] + 0.7 * (rz.a - cz.a),
                vy = vecs[z][1] + 0.7 * (rz.b - cz.b);
              const mag = Math.sqrt(vx * vx + vy * vy);
              if (mag > GRADE_K) {
                vx *= GRADE_K / mag;
                vy *= GRADE_K / mag;
              }
              vecs[z] = [vx, vy];
              p.grade[zkeys[z]] = vecToHueSat(vx, vy);
            }
          }
        }
        cur = run();
        return { params: p, base, cur };
      }

      function finalizeParams(p, strength, mods) {
        const s = strength / 100,
          q = neutralParams();
        const ri = (x, lim) => {
          const v = Math.round(clampN(x * s, -lim, lim));
          return Number.isFinite(v) ? v : 0;
        };
        q.temp = ri(p.temp, 100);
        q.tint = ri(p.tint, 100);
        q.exposure = Math.round(clampN(p.exposure * s, -5, 5) * 100) / 100 || 0;
        [
          "contrast",
          "highlights",
          "shadows",
          "whites",
          "blacks",
          "vibrance",
          "saturation",
        ].forEach((k) => {
          q[k] = ri(p[k], 100);
        });
        const cv = p.curve.map(([x, y]) => [
          x,
          Math.round(clampN(x + (y - x) * s, 0, 255)),
        ]);
        for (let i = 1; i < cv.length; i++)
          if (cv[i][1] <= cv[i - 1][1])
            cv[i][1] = Math.min(255, cv[i - 1][1] + 1);
        q.curve = cv;
        q.hsl = p.hsl.map((b) => ({
          h: ri(b.h, 100),
          s: ri(b.s, 100),
          l: ri(b.l, 100),
        }));
        ["sh", "mid", "hi"].forEach((k) => {
          const sat = Math.round(clampN(p.grade[k].sat * s, 0, 100));
          q.grade[k] = { hue: sat ? Math.round(p.grade[k].hue) % 360 : 0, sat };
        });
        q.mods = Object.assign({}, mods);
        return q;
      }

      const sgn = (v) => (v >= 0 ? "+" : "") + v;
      function xmlEsc(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }
      function buildXMP(f, name, uuid) {
        const m = f.mods,
          a = [];
        if (m.wb)
          a.push(
            ["IncrementalTemperature", sgn(f.temp)],
            ["IncrementalTint", sgn(f.tint)],
          );
        if (m.tone)
          a.push(
            [
              "Exposure2012",
              (f.exposure >= 0 ? "+" : "") + f.exposure.toFixed(2),
            ],
            ["Contrast2012", sgn(f.contrast)],
            ["Highlights2012", sgn(f.highlights)],
            ["Shadows2012", sgn(f.shadows)],
            ["Whites2012", sgn(f.whites)],
            ["Blacks2012", sgn(f.blacks)],
          );
        if (m.color)
          a.push(
            ["Vibrance", sgn(f.vibrance)],
            ["Saturation", sgn(f.saturation)],
          );
        if (m.hsl) {
          BANDS.forEach((b, i) =>
            a.push(["HueAdjustment" + b.key, sgn(f.hsl[i].h)]),
          );
          BANDS.forEach((b, i) =>
            a.push(["SaturationAdjustment" + b.key, sgn(f.hsl[i].s)]),
          );
          BANDS.forEach((b, i) =>
            a.push(["LuminanceAdjustment" + b.key, sgn(f.hsl[i].l)]),
          );
        }
        if (m.grade)
          a.push(
            ["SplitToningShadowHue", f.grade.sh.hue],
            ["SplitToningShadowSaturation", f.grade.sh.sat],
            ["SplitToningHighlightHue", f.grade.hi.hue],
            ["SplitToningHighlightSaturation", f.grade.hi.sat],
            ["SplitToningBalance", 0],
            ["ColorGradeMidtoneHue", f.grade.mid.hue],
            ["ColorGradeMidtoneSat", f.grade.mid.sat],
            ["ColorGradeBlending", 50],
          );
        const attrs = a.map(([k, v]) => `   crs:${k}="${v}"`).join("\n");
        const curve = m.tone
          ? `\n   <crs:ToneCurvePV2012>\n    <rdf:Seq>\n${f.curve.map((q) => `     <rdf:li>${q[0]}, ${q[1]}</rdf:li>`).join("\n")}\n    </rdf:Seq>\n   </crs:ToneCurvePV2012>`
          : "";
        const nm = xmlEsc(name);
        return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
   xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:PresetType="Normal"
   crs:Cluster=""
   crs:UUID="${uuid}"
   crs:SupportsAmount="False"
   crs:SupportsColor="True"
   crs:SupportsMonochrome="True"
   crs:SupportsHighDynamicRange="True"
   crs:SupportsNormalDynamicRange="True"
   crs:SupportsSceneReferred="True"
   crs:SupportsOutputReferred="True"
   crs:CameraModelRestriction=""
   crs:Copyright=""
   crs:ContactInfo=""
   crs:Version="15.0"
   crs:ProcessVersion="11.0"
${attrs}
   crs:HasSettings="True">
   <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">${nm}</rdf:li></rdf:Alt></crs:Name>
   <crs:ShortName><rdf:Alt><rdf:li xml:lang="x-default"/></rdf:Alt></crs:ShortName>
   <crs:SortName><rdf:Alt><rdf:li xml:lang="x-default"/></rdf:Alt></crs:SortName>
   <crs:Group><rdf:Alt><rdf:li xml:lang="x-default">Grade Match</rdf:li></rdf:Alt></crs:Group>${curve}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`;
      }
      function settingsText(f, kelvinBase) {
        const L = [],
          m = f.mods,
          sg = (v) => (v > 0 ? "+" : "") + v;
        if (m.wb) L.push(`Temp ${sg(f.temp)}`, `Tint ${sg(f.tint)}`);
        if (m.tone)
          L.push(
            `Exposure ${(f.exposure > 0 ? "+" : "") + f.exposure.toFixed(2)}`,
            `Contrast ${sg(f.contrast)}`,
            `Highlights ${sg(f.highlights)}`,
            `Shadows ${sg(f.shadows)}`,
            `Whites ${sg(f.whites)}`,
            `Blacks ${sg(f.blacks)}`,
          );
        if (m.color)
          L.push(
            `Vibrance ${sg(f.vibrance)}`,
            `Saturation ${sg(f.saturation)}`,
          );
        if (m.tone)
          L.push(
            "",
            "Tone curve (input > output): " +
              f.curve.map((q) => `${q[0]}>${q[1]}`).join("  "),
          );
        if (m.hsl) {
          L.push("", "HSL (hue / sat / lum)");
          BANDS.forEach((b, i) =>
            L.push(
              `${b.name} ${sg(f.hsl[i].h)} / ${sg(f.hsl[i].s)} / ${sg(f.hsl[i].l)}`,
            ),
          );
        }
        if (m.grade)
          L.push(
            "",
            "Color grading (hue / sat)",
            `Shadows ${f.grade.sh.hue} / ${f.grade.sh.sat}`,
            `Midtones ${f.grade.mid.hue} / ${f.grade.mid.sat}`,
            `Highlights ${f.grade.hi.hue} / ${f.grade.hi.sat}`,
          );
        return L.join("\n");
      }
      function kelvinFor(base, t) {
        const mired = 1e6 / base - 0.6 * t;
        return Math.round(1e6 / Math.max(mired, 50) / 10) * 10;
      }

      const MODEL_FEATURES_PER_IMAGE = 101;
      const MODEL_INPUT_SIZE = MODEL_FEATURES_PER_IMAGE * 2;
      const MODEL_OUTPUT_SIZE = 50;
      const MODEL_CURVE_X = [0, 32, 64, 128, 192, 224, 255];

      function modelFeatures(stats) {
        const q = stats.dq,
          features = [];
        for (let i = 0; i < 20; i++) features.push(q[i]);
        for (let i = 20; i < 60; i++) features.push(q[i] / 0.4);
        stats.band.forEach((band) =>
          features.push(band.share, band.c / 0.4, band.dh / 45, band.l),
        );
        stats.zone.forEach((zone) =>
          features.push(zone.f, zone.a / 0.4, zone.b / 0.4),
        );
        if (
          features.length !== MODEL_FEATURES_PER_IMAGE ||
          features.some((value) => !Number.isFinite(value))
        )
          throw new Error("Could not create valid AI image features.");
        return features;
      }

      function modelInputVector(sourceStats, referenceStats) {
        const features = new Float32Array(MODEL_INPUT_SIZE);
        features.set(modelFeatures(sourceStats), 0);
        features.set(modelFeatures(referenceStats), MODEL_FEATURES_PER_IMAGE);
        return features;
      }

      function settingsFromModelOutput(output) {
        if (!output || output.length !== MODEL_OUTPUT_SIZE)
          throw new Error(
            `The AI model returned ${output ? output.length : 0} values; expected ${MODEL_OUTPUT_SIZE}.`,
          );
        const value = (index) => {
          const result = Number(output[index]);
          if (!Number.isFinite(result))
            throw new Error(`The AI model returned an invalid setting at index ${index}.`);
          return clampN(result, -1, 1);
        };
        const p = neutralParams();
        p.temp = value(0) * 100;
        p.tint = value(1) * 100;
        p.exposure = value(2) * 5;
        [
          "contrast",
          "highlights",
          "shadows",
          "whites",
          "blacks",
          "vibrance",
          "saturation",
        ].forEach((key, index) => {
          p[key] = value(index + 3) * 100;
        });
        p.curve = MODEL_CURVE_X.map((x, index) => [
          x,
          ((value(10 + index) + 1) / 2) * 255,
        ]);
        p.hsl = BANDS.map((_, band) => ({
          h: value(17 + band * 3) * 100,
          s: value(18 + band * 3) * 100,
          l: value(19 + band * 3) * 100,
        }));
        ["sh", "mid", "hi"].forEach((key, zone) => {
          const index = 41 + zone * 3,
            hue = (Math.atan2(value(index + 1), value(index)) * RAD + 360) % 360;
          p.grade[key] = {
            hue,
            sat: clampN(((value(index + 2) + 1) / 2) * 100, 0, 100),
          };
        });
        return p;
      }

      if (typeof module !== "undefined" && module.exports) {
        module.exports = {
          process,
          analyze,
          solve,
          distance,
          finalizeParams,
          neutralParams,
          ALL_MODS,
          rgbaToLinear,
          encodeToRGBA,
          buildXMP,
          settingsText,
          palette,
          makeCurve,
          BANDS,
          hsv2rgb,
          kelvinFor,
          labAngleToHue,
          hueToLabAngle,
          BAND_ANG,
          modelFeatures,
          modelInputVector,
          settingsFromModelOutput,
        };
      }
      const $ = (s, r) => (r || document).querySelector(s);
      const MINUS = "−";
      const sgnD = (n) => (n > 0 ? "+" : n < 0 ? MINUS : "") + Math.abs(n);
      const state = {
        src: null,
        ref: null,
        model: null,
        mods: ALL_MODS(),
        strength: 100,
        solved: null,
        final: null,
        metrics: null,
        after: null,
        kelvin: 5500,
        token: 0,
        xml: "",
        txt: "",
        uuid: "",
      };
      let downloads = null,
        outBuf = null,
        afterImg = null,
        rafPending = false,
        busy = false;

      function mulberry32(a) {
        return function () {
          a |= 0;
          a = (a + 0x6d2b79f5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      function drawScene(w, h, seed) {
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        const c = cv.getContext("2d"),
          rnd = mulberry32(seed);
        const hor = h * (0.55 + rnd() * 0.06),
          sx = w * (0.22 + rnd() * 0.56),
          sy = hor - h * (0.05 + rnd() * 0.1);
        let g = c.createLinearGradient(0, 0, 0, hor);
        g.addColorStop(0, "#2c4a78");
        g.addColorStop(0.55, "#d9896a");
        g.addColorStop(1, "#f5c48e");
        c.fillStyle = g;
        c.fillRect(0, 0, w, hor);
        g = c.createRadialGradient(sx, sy, 0, sx, sy, h * 0.55);
        g.addColorStop(0, "rgba(255,244,214,1)");
        g.addColorStop(0.07, "rgba(255,218,160,.9)");
        g.addColorStop(0.3, "rgba(255,172,112,.28)");
        g.addColorStop(1, "rgba(255,140,90,0)");
        c.fillStyle = g;
        c.fillRect(0, 0, w, hor);
        for (let i = 0; i < 16; i++) {
          const cx = rnd() * w,
            cy = rnd() * hor * 0.8,
            rx = 60 + rnd() * 160,
            ry = 8 + rnd() * 18;
          c.save();
          c.translate(cx, cy);
          c.scale(1, ry / rx);
          const cg = c.createRadialGradient(0, 0, 0, 0, 0, rx);
          cg.addColorStop(0, "rgba(255,205,170,.45)");
          cg.addColorStop(1, "rgba(255,205,170,0)");
          c.fillStyle = cg;
          c.beginPath();
          c.arc(0, 0, rx, 0, 7);
          c.fill();
          c.restore();
        }
        const ridge = (base, amp, col, ph) => {
          c.fillStyle = col;
          c.beginPath();
          c.moveTo(0, hor + 2);
          for (let x = 0; x <= w; x += 6)
            c.lineTo(
              x,
              base -
                amp *
                  (0.5 +
                    0.5 * Math.sin(x / 140 + ph) * Math.cos(x / 53 + ph * 2) +
                    0.25 * Math.sin(x / 23 + ph)),
            );
          c.lineTo(w, hor + 2);
          c.closePath();
          c.fill();
        };
        ridge(hor - 30, 70, "rgba(112,100,140,.85)", rnd() * 6);
        ridge(hor - 10, 50, "rgba(70,66,108,.92)", rnd() * 6);
        ridge(hor + 2, 28, "rgba(40,44,80,1)", rnd() * 6);
        g = c.createLinearGradient(0, hor, 0, h);
        g.addColorStop(0, "#e9a57a");
        g.addColorStop(0.35, "#47658a");
        g.addColorStop(1, "#14253c");
        c.fillStyle = g;
        c.fillRect(0, hor, w, h - hor);
        for (let i = 0; i < 120; i++) {
          const y = hor + 4 + Math.pow(rnd(), 1.6) * (h - hor) * 0.9,
            ww = (8 + rnd() * 60) * (1 + (y - hor) / 80);
          c.fillStyle = `rgba(255,${200 + ((rnd() * 40) | 0)},150,${0.1 + rnd() * 0.3})`;
          c.fillRect(sx - ww / 2 + (rnd() - 0.5) * 30, y, ww, 1.5 + rnd() * 2);
        }
        c.fillStyle = "#0d1018";
        c.beginPath();
        c.moveTo(0, h);
        let x = 0;
        c.lineTo(0, h * 0.86);
        while (x < w * 0.45) {
          x += 24 + rnd() * 40;
          c.lineTo(x, h * (0.8 + rnd() * 0.14));
        }
        c.lineTo(w * 0.47, h);
        c.closePath();
        c.fill();
        c.beginPath();
        c.moveTo(w, h);
        c.lineTo(w, h * 0.9);
        x = w;
        while (x > w * 0.72) {
          x -= 20 + rnd() * 30;
          c.lineTo(x, h * (0.84 + rnd() * 0.12));
        }
        c.lineTo(w * 0.7, h);
        c.closePath();
        c.fill();
        const tx = w * (0.58 + rnd() * 0.2),
          ty = hor - 6;
        c.fillStyle = "#1b1c2e";
        c.fillRect(tx - 5, ty - 46, 10, 46);
        c.beginPath();
        c.moveTo(tx - 8, ty - 46);
        c.lineTo(tx, ty - 58);
        c.lineTo(tx + 8, ty - 46);
        c.fill();
        c.fillStyle = "#ffd27a";
        c.fillRect(tx - 2, ty - 40, 4, 6);
        const id = c.getImageData(0, 0, w, h),
          d = id.data,
          nr = mulberry32(seed + 99);
        for (let i = 0; i < d.length; i += 4) {
          const nz = (nr() - 0.5) * 7;
          d[i] += nz;
          d[i + 1] += nz;
          d[i + 2] += nz;
        }
        c.putImageData(id, 0, 0);
        return cv;
      }
      function gradeCanvas(cv, params) {
        const w = cv.width,
          h = cv.height,
          n = w * h,
          cx = cv.getContext("2d"),
          id = cx.getImageData(0, 0, w, h);
        const lin = rgbaToLinear(id.data, n),
          out = new Float32Array(n * 3);
        process(lin, n, params, out);
        encodeToRGBA(out, n, id.data);
        cx.putImageData(id, 0, 0);
        return cv;
      }
      function makeSamples() {
        const flat = neutralParams();
        Object.assign(flat, {
          exposure: 0.1,
          contrast: -40,
          saturation: -35,
          blacks: 22,
          whites: -18,
          temp: -10,
          tint: 4,
        });
        const look = neutralParams();
        Object.assign(look, {
          exposure: -0.15,
          contrast: 32,
          highlights: -18,
          shadows: 12,
          blacks: 14,
          saturation: 8,
          vibrance: 10,
          temp: 6,
        });
        look.hsl[1].s = 22;
        look.hsl[5].h = -18;
        look.hsl[5].s = 12;
        look.grade.sh = { hue: 195, sat: 42 };
        look.grade.hi = { hue: 38, sat: 30 };
        look.grade.mid = { hue: 25, sat: 8 };
        return {
          src: gradeCanvas(drawScene(960, 640, 5), flat),
          ref: gradeCanvas(drawScene(960, 640, 21), look),
        };
      }

      async function decodeFile(file) {
        try {
          return await createImageBitmap(file, {
            imageOrientation: "from-image",
          });
        } catch (e) {
          return await new Promise((res, rej) => {
            const u = URL.createObjectURL(file),
              im = new Image();
            im.onload = () => {
              URL.revokeObjectURL(u);
              res(im);
            };
            im.onerror = () => {
              URL.revokeObjectURL(u);
              rej(new Error("decode"));
            };
            im.src = u;
          });
        }
      }
      function buildRecord(source, name, isSample) {
        const w0 = source.naturalWidth || source.width,
          h0 = source.naturalHeight || source.height;
        const fs = Math.min(1, 1000 / Math.max(w0, h0)),
          fw = Math.max(1, Math.round(w0 * fs)),
          fh = Math.max(1, Math.round(h0 * fs));
        const cv = document.createElement("canvas");
        cv.width = fw;
        cv.height = fh;
        const cx = cv.getContext("2d", { willReadFrequently: true });
        cx.imageSmoothingQuality = "high";
        cx.drawImage(source, 0, 0, fw, fh);
        const full = cx.getImageData(0, 0, fw, fh);
        const ss = Math.min(1, 256 / Math.max(fw, fh)),
          sw = Math.max(1, Math.round(fw * ss)),
          sh = Math.max(1, Math.round(fh * ss));
        const sc = document.createElement("canvas");
        sc.width = sw;
        sc.height = sh;
        const sx = sc.getContext("2d", { willReadFrequently: true });
        sx.imageSmoothingQuality = "high";
        sx.drawImage(cv, 0, 0, sw, sh);
        const small = sx.getImageData(0, 0, sw, sh),
          sn = sw * sh;
        const rec = {
          name,
          isSample,
          source,
          w0,
          h0,
          fw,
          fh,
          canvas: cv,
          full,
          fullLin: rgbaToLinear(full.data, fw * fh),
          sn,
          smallLin: rgbaToLinear(small.data, sn),
          stats: null,
          pal: null,
        };
        rec.stats = analyze(rec.smallLin, sn);
        rec.pal = palette(rec.smallLin, sn, 6);
        return rec;
      }
      function setSlot(which, rec) {
        const t = $("#thumb-" + which),
          s = Math.min(1, 480 / Math.max(rec.fw, rec.fh));
        t.width = Math.round(rec.fw * s);
        t.height = Math.round(rec.fh * s);
        t.getContext("2d").drawImage(rec.canvas, 0, 0, t.width, t.height);
        $("#meta-" + which).textContent =
          rec.name + " · " + rec.w0 + "×" + rec.h0;
        $("#pill-" + which).hidden = !rec.isSample;
        $("#err-" + which).hidden = true;
      }
      async function loadFile(which, file) {
        const err = $("#err-" + which);
        err.hidden = true;
        if (!file) return;
        try {
          const bmp = await decodeFile(file);
          const rec = buildRecord(bmp, file.name, false);
          state[which] = rec;
          setSlot(which, rec);
          if (which === "src") setupStage();
          recompute();
        } catch (e) {
          console.error(`Could not load ${file.name}.`, e);
          err.textContent =
            "Could not load this image: " +
            (e instanceof Error ? e.message : String(e)) +
            ". Use a valid JPEG, PNG or WebP. For RAW files, export a JPEG first.";
          err.hidden = false;
        }
      }

      function setupStage() {
        const s = state.src,
          b = $("#cv-before"),
          a = $("#cv-after");
        b.width = a.width = s.fw;
        b.height = a.height = s.fh;
        b.getContext("2d").putImageData(s.full, 0, 0);
        $("#stage").style.setProperty("--ratio", (s.fw / s.fh).toFixed(4));
        afterImg = new ImageData(s.fw, s.fh);
        outBuf = new Float32Array(s.fw * s.fh * 3);
        a.getContext("2d").putImageData(s.full, 0, 0);
      }
      function setSplit(pct) {
        pct = Math.max(0, Math.min(100, pct));
        $("#cv-after").style.clipPath = "inset(0 0 0 " + pct + "%)";
        $("#divider").style.left = pct + "%";
        $("#split").value = String(Math.round(pct));
      }
      function schedulePreview() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          renderPreview();
        });
      }
      function renderPreview() {
        const s = state.src;
        if (!s || !state.final || !afterImg || afterImg.width !== s.fw) return;
        const n = s.fw * s.fh;
        process(s.fullLin, n, state.final, outBuf);
        encodeToRGBA(outBuf, n, afterImg.data);
        $("#cv-after").getContext("2d").putImageData(afterImg, 0, 0);
      }

      const nextFrame = () => new Promise((r) => setTimeout(r, 16));
      async function recompute() {
        if (!state.src || !state.ref) return;
        const tk = ++state.token;
        $("#status").textContent = "Matching…";
        await nextFrame();
        if (tk !== state.token) return;
        if (state.model) {
          try {
            const input = modelInputVector(state.src.stats, state.ref.stats),
              feeds = {
                [state.model.inputNames[0]]: new ort.Tensor("float32", input, [
                  1,
                  MODEL_INPUT_SIZE,
                ]),
              },
              result = await state.model.run(feeds);
            if (tk !== state.token) return;
            state.solved = {
              params: settingsFromModelOutput(
                result[state.model.outputNames[0]].data,
              ),
            };
            $("#ai-status").textContent =
              "Experimental synthetic AI loaded · see README for validation limits";
          } catch (error) {
            if (tk !== state.token) return;
            console.error("AI inference failed; switching to the local solver.", error);
            state.model = null;
            $("#ai-status").textContent =
              "AI inference failed. Using the existing calculation-based matcher (not AI); see the console for details.";
          }
        }
        if (!state.model) {
          state.solved = solve(
            state.src.smallLin,
            state.src.sn,
            state.ref.stats,
            { modules: state.mods },
          );
        }
        applyStrength();
        $("#status").textContent = "";
      }
      function applyStrength() {
        const sv = state.solved,
          s = state.src;
        if (!sv) return;
        state.final = finalizeParams(sv.params, state.strength, state.mods);
        const tmp = new Float32Array(s.sn * 3);
        process(s.smallLin, s.sn, state.final, tmp);
        const after = analyze(tmp, s.sn);
        state.after = after;
        state.afterPal = palette(tmp, s.sn, 6);
        state.metrics = {
          before: distance(s.stats, state.ref.stats),
          after: distance(after, state.ref.stats),
        };
        state.uuid = (
          window.crypto && crypto.randomUUID
            ? crypto.randomUUID()
            : "A1B2C3D4-0000-4000-8000-000000000000"
        ).toUpperCase();
        state.xml = buildXMP(state.final, "Grade Match", state.uuid);
        state.txt = settingsText(state.final);
        $("#xml").value = state.xml;
        renderPanel();
        renderAnalysis();
        schedulePreview();
      }

      function bar(v, lim) {
        const p = Math.max(-1, Math.min(1, v / lim));
        return (
          '<div class="track"><i class="fill" style="--pos:' +
          Math.max(p, 0).toFixed(3) +
          ";--neg:" +
          Math.max(-p, 0).toFixed(3) +
          '"></i></div>'
        );
      }
      function row(label, v, lim, text, off, sub) {
        return (
          '<div class="row' +
          (off ? " off" : "") +
          '"><dt>' +
          label +
          "</dt><dd>" +
          bar(v, lim) +
          '</dd><dd class="val">' +
          (off ? "off" : text) +
          "</dd>" +
          (sub ? '<div class="sub">' + sub + "</div>" : "") +
          "</div>"
        );
      }
      function renderPanel() {
        const f = state.final,
          m = state.mods,
          mt = state.metrics;
        const pct =
          mt.before > 0.001
            ? Math.max(0, Math.round((1 - mt.after / mt.before) * 100))
            : 0;
        const mx = Math.max(mt.before, mt.after, 0.001),
          bw = Math.max(3, (mt.before / mx) * 100),
          aw = Math.max(3, (mt.after / mx) * 100);
        $("#meter").innerHTML =
          '<div class="meter-row"><span>Before</span><div class="meter-bar"><i style="width:' +
          bw.toFixed(1) +
          '%"></i></div><b>' +
          mt.before.toFixed(1) +
          "</b></div>" +
          '<div class="meter-row after"><span>After</span><div class="meter-bar"><i style="width:' +
          aw.toFixed(1) +
          '%"></i></div><b>' +
          mt.after.toFixed(1) +
          "</b></div>" +
          '<div class="tag" style="font:11px var(--font-mono)">Distance to the reference (lower is closer). ' +
          pct +
          "% closer.</div>";
        const kel =
          state.kelvin > 0
            ? "RAW: about " +
              kelvinFor(state.kelvin, f.temp).toLocaleString("en-US") +
              " K"
            : "";
        const sg = (n) => sgnD(n);
        const ex =
          (f.exposure > 0 ? "+" : f.exposure < 0 ? MINUS : "") +
          Math.abs(f.exposure).toFixed(2);
        $("#basic").innerHTML =
          '<div class="group">White balance</div><dl class="rows">' +
          row("Temp", f.temp, 100, sg(f.temp), !m.wb, kel) +
          row("Tint", f.tint, 100, sg(f.tint), !m.wb) +
          "</dl>" +
          '<div class="group">Tone</div><dl class="rows">' +
          row("Exposure", f.exposure, 3, ex, !m.tone) +
          row("Contrast", f.contrast, 100, sg(f.contrast), !m.tone) +
          row("Highlights", f.highlights, 100, sg(f.highlights), !m.tone) +
          row("Shadows", f.shadows, 100, sg(f.shadows), !m.tone) +
          row("Whites", f.whites, 100, sg(f.whites), !m.tone) +
          row("Blacks", f.blacks, 100, sg(f.blacks), !m.tone) +
          "</dl>" +
          '<div class="group">Presence</div><dl class="rows">' +
          row("Vibrance", f.vibrance, 100, sg(f.vibrance), !m.color) +
          row("Saturation", f.saturation, 100, sg(f.saturation), !m.color) +
          "</dl>";

        const cf = makeCurve(f.curve),
          P = 8,
          S = 184;
        let d = "";
        for (let i = 0; i <= 64; i++) {
          const x = i / 64,
            y = cf(x);
          d +=
            (i ? "L" : "M") +
            (P + x * S).toFixed(1) +
            " " +
            (P + (1 - y) * S).toFixed(1);
        }
        let grid = "";
        for (let i = 1; i < 4; i++) {
          const t = P + (S * i) / 4;
          grid +=
            '<line x1="' +
            P +
            '" x2="' +
            (P + S) +
            '" y1="' +
            t +
            '" y2="' +
            t +
            '" stroke="var(--line)" stroke-width="1"/><line y1="' +
            P +
            '" y2="' +
            (P + S) +
            '" x1="' +
            t +
            '" x2="' +
            t +
            '" stroke="var(--line)" stroke-width="1"/>';
        }
        const dots = f.curve
          .map(
            (q) =>
              '<circle cx="' +
              (P + (q[0] / 255) * S).toFixed(1) +
              '" cy="' +
              (P + (1 - q[1] / 255) * S).toFixed(1) +
              '" r="3.2" fill="var(--panel)" stroke="var(--accent)" stroke-width="1.5"/>',
          )
          .join("");
        $("#curve").style.opacity = m.tone ? 1 : 0.4;
        $("#curve").innerHTML =
          grid +
          '<line x1="' +
          P +
          '" y1="' +
          (P + S) +
          '" x2="' +
          (P + S) +
          '" y2="' +
          P +
          '" stroke="var(--muted)" stroke-dasharray="4 4" stroke-width="1"/><path d="' +
          d +
          '" fill="none" stroke="var(--accent)" stroke-width="2"/>' +
          dots;
        $("#pts").innerHTML = f.curve
          .map(
            (q) =>
              "<li><span>" + q[0] + "</span><span>" + q[1] + "</span></li>",
          )
          .join("");

        const cssOf = (h) => {
          const c = hsv2rgb(h, 1, 1);
          return "rgb(" + c.map((v) => Math.round(v * 255)).join(",") + ")";
        };
        const cell = (v) =>
          '<td class="' +
          (v === 0 || !m.hsl ? "z" : "") +
          '">' +
          (m.hsl ? (v === 0 ? "0" : sgnD(v)) : "off") +
          "</td>";
        $("#hsl").innerHTML =
          "<thead><tr><th>Band</th><th>Hue</th><th>Sat</th><th>Lum</th></tr></thead><tbody>" +
          BANDS.map(
            (b, i) =>
              '<tr><td><span class="dot" style="background:' +
              cssOf(b.hsv) +
              '"></span>' +
              b.name +
              "</td>" +
              cell(f.hsl[i].h) +
              cell(f.hsl[i].s) +
              cell(f.hsl[i].l) +
              "</tr>",
          ).join("") +
          "</tbody>";

        const gname = { sh: "Shadows", mid: "Midtones", hi: "Highlights" };
        $("#grades").innerHTML = ["sh", "mid", "hi"]
          .map((k) => {
            const g = f.grade[k],
              col = g.sat > 0 ? cssOf(g.hue) : "transparent",
              op = Math.max(0.25, Math.min(1, g.sat / 60));
            return (
              '<div class="grade"' +
              (m.grade ? "" : ' style="opacity:.4"') +
              '><span class="sw" style="background:' +
              col +
              ";opacity:" +
              op.toFixed(2) +
              '"></span><span>' +
              gname[k] +
              "</span><code>" +
              (m.grade ? "Hue " + g.hue + "° · Sat " + g.sat : "off") +
              "</code></div>"
            );
          })
          .join("");
      }
      function histPath(h, total, bins, W, H, ymax) {
        const o = new Array(bins).fill(0),
          per = h.length / bins;
        for (let k = 0; k < h.length; k++)
          o[Math.min(bins - 1, (k / per) | 0)] += h[k] / total;
        const sm = o.map(
          (v, i) =>
            (o[Math.max(0, i - 1)] + 2 * v + o[Math.min(bins - 1, i + 1)]) / 4,
        );
        return {
          d: sm
            .map(
              (v, i) =>
                (i ? "L" : "M") +
                ((i / (bins - 1)) * W).toFixed(1) +
                " " +
                (H - 4 - (v / ymax) * (H - 10)).toFixed(1),
            )
            .join(""),
          max: Math.max.apply(null, sm),
        };
      }
      function renderAnalysis() {
        const s = state.src,
          r = state.ref,
          W = 480,
          H = 120,
          bins = 64;
        const a = histPath(s.stats.hv, s.stats.n, bins, W, H, 1),
          b = histPath(state.after.hv, state.after.n, bins, W, H, 1),
          c = histPath(r.stats.hv, r.stats.n, bins, W, H, 1);
        const ymax = Math.max(a.max, b.max, c.max) * 1.08;
        const A = histPath(s.stats.hv, s.stats.n, bins, W, H, ymax).d,
          B = histPath(state.after.hv, state.after.n, bins, W, H, ymax).d,
          C = histPath(r.stats.hv, r.stats.n, bins, W, H, ymax).d;
        $("#hist").innerHTML =
          '<path d="' +
          C +
          "L" +
          W +
          " " +
          H +
          "L0 " +
          H +
          'Z" fill="var(--ink)" fill-opacity=".1" stroke="none"/>' +
          '<path d="' +
          C +
          '" stroke="var(--ink)" stroke-width="1.5"/><path d="' +
          A +
          '" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 4"/><path d="' +
          B +
          '" stroke="var(--accent)" stroke-width="2"/>';
        const pal = (list) =>
          '<div class="pal">' +
          list
            .map(
              (p) =>
                '<span style="flex:' +
                p.share.toFixed(3) +
                ";background:rgb(" +
                p.rgb.join(",") +
                ')"></span>',
            )
            .join("") +
          "</div>";
        $("#pals").innerHTML = [
          ["Your photo", s.pal],
          ["After match", state.afterPal],
          ["Reference", r.pal],
        ]
          .map(
            (x) =>
              '<div class="pal-row"><span>' +
              x[0] +
              "</span>" +
              pal(x[1]) +
              "</div>",
          )
          .join("");
      }

      function flash(btn, msg) {
        const t = btn.textContent;
        btn.textContent = msg;
        setTimeout(() => {
          btn.textContent = t;
        }, 1800);
      }
      async function copyText(text, btn, fallbackToXml) {
        try {
          await navigator.clipboard.writeText(text);
          flash(btn, "Copied");
        } catch (e) {
          const ta = $("#xml");
          $("#xml-wrap").open = true;
          ta.value = fallbackToXml ? state.xml : text;
          ta.focus();
          ta.select();
          flash(btn, "Press copy below");
        }
      }
      async function exportMatchedImage(btn) {
        const status = $("#image-export-status"),
          source = state.src && state.src.source,
          params = state.final;
        if (!source || !params) {
          status.textContent = "Add both photos and wait for the match before exporting.";
          return;
        }
        btn.disabled = true;
        status.textContent = "Rendering your matched image…";
        try {
          const sw = source.naturalWidth || source.width,
            sh = source.naturalHeight || source.height,
            scale = Math.min(1, 4096 / Math.max(sw, sh)),
            width = Math.max(1, Math.round(sw * scale)),
            height = Math.max(1, Math.round(sh * scale)),
            canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("Could not create an image canvas.");
          context.drawImage(source, 0, 0, width, height);
          const rowsPerChunk = 48;
          for (let y = 0; y < height; y += rowsPerChunk) {
            const rows = Math.min(rowsPerChunk, height - y);
            const image = context.getImageData(0, y, width, rows);
            const count = width * rows;
            const linear = rgbaToLinear(image.data, count);
            const output = new Float32Array(count * 3);
            process(linear, count, params, output);
            encodeToRGBA(output, count, image.data);
            context.putImageData(image, 0, y);
            if (y + rows < height)
              await new Promise((resolve) => requestAnimationFrame(resolve));
          }
          const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((result) => {
              if (result) resolve(result);
              else reject(new Error("The browser could not create the PNG."));
            }, "image/png");
          });
          const url = URL.createObjectURL(blob),
            link = document.createElement("a"),
            name = state.src.name.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
          link.href = url;
          link.download = (name || "grade-match") + "-matched.png";
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          status.textContent =
            "PNG downloaded · " + width + " × " + height + " px";
        } catch (error) {
          console.error("Matched image export failed:", error);
          status.textContent =
            error instanceof Error
              ? "Could not export image: " + error.message
              : "Could not export image.";
        } finally {
          btn.disabled = false;
        }
      }

      function wire() {
        const themeToggle = $("#theme-toggle");
        document.documentElement.dataset.theme = "light";
        themeToggle.addEventListener("click", () => {
          const dark = document.documentElement.dataset.theme !== "dark";
          document.documentElement.dataset.theme = dark ? "dark" : "light";
          themeToggle.setAttribute("aria-pressed", String(dark));
          themeToggle.innerHTML =
            '<span aria-hidden="true">' +
            (dark ? "☼" : "◐") +
            "</span> " +
            (dark ? "Light appearance" : "Dark appearance");
        });
        ["src", "ref"].forEach((which) => {
          const drop = $("#drop-" + which),
            input = $("#file-" + which);
          input.addEventListener("change", () => {
            loadFile(which, input.files[0]);
            input.value = "";
          });
          ["dragenter", "dragover"].forEach((ev) =>
            drop.addEventListener(ev, (e) => {
              e.preventDefault();
              drop.classList.add("over");
            }),
          );
          ["dragleave", "drop"].forEach((ev) =>
            drop.addEventListener(ev, (e) => {
              e.preventDefault();
              drop.classList.remove("over");
            }),
          );
          drop.addEventListener("drop", (e) => {
            const f = e.dataTransfer && e.dataTransfer.files[0];
            if (f) loadFile(which, f);
          });
        });
        const stage = $("#stage");
        let dragging = false;
        const move = (e) => {
          const r = stage.getBoundingClientRect();
          setSplit(((e.clientX - r.left) / r.width) * 100);
        };
        stage.addEventListener("pointerdown", (e) => {
          dragging = true;
          stage.setPointerCapture(e.pointerId);
          move(e);
        });
        stage.addEventListener("pointermove", (e) => {
          if (dragging) move(e);
        });
        ["pointerup", "pointercancel"].forEach((ev) =>
          stage.addEventListener(ev, () => {
            dragging = false;
          }),
        );
        $("#split").addEventListener("input", (e) => setSplit(+e.target.value));
        document
          .querySelectorAll("[data-pos]")
          .forEach((b) =>
            b.addEventListener("click", () => setSplit(+b.dataset.pos)),
          );
        $("#strength").addEventListener("input", (e) => {
          state.strength = +e.target.value;
          $("#strength-out").textContent = state.strength + "%";
          applyStrength();
        });
        document.querySelectorAll("[data-mod]").forEach((cb) =>
          cb.addEventListener("change", () => {
            state.mods[cb.dataset.mod] = cb.checked;
            recompute();
          }),
        );
        $("#kbase").addEventListener("input", (e) => {
          state.kelvin = +e.target.value || 0;
          if (state.final) renderPanel();
        });
        $("#btn-copy-xmp").addEventListener("click", (e) =>
          copyText(state.xml, e.currentTarget, true),
        );
        $("#btn-copy-txt").addEventListener("click", (e) =>
          copyText(state.txt, e.currentTarget, false),
        );
        $("#btn-export-image").addEventListener("click", (e) =>
          exportMatchedImage(e.currentTarget),
        );
        $("#btn-save").addEventListener("click", (e) => {
          const b = e.currentTarget;
          downloads
            .save({ filename: "Grade Match.xmp.txt", data: state.xml })
            .then(() => flash(b, "Saved"))
            .catch((err) => {
              if (!err || err.code !== "declined") flash(b, "Could not save");
            });
        });
      }
      async function initializeModel() {
        try {
          const response = await fetch("/models/color_matcher.onnx");
          const contentType = response.headers.get("content-type") || "";
          if (response.status === 404 || contentType.includes("text/html")) {
            $("#ai-status").textContent =
              "Trained AI model not found. Using the existing calculation-based matcher (not AI); see docs/ai-training.md.";
          } else if (!response.ok) {
            throw new Error(`Model request failed with HTTP ${response.status}.`);
          } else {
            const modelBytes = await response.arrayBuffer();
            if (import.meta.env.DEV) {
              ort.env.wasm.wasmPaths = "/node_modules/onnxruntime-web/dist/";
            }
            ort.env.wasm.numThreads = 1;
            state.model = await ort.InferenceSession.create(modelBytes, {
              executionProviders: ["wasm"],
            });
            $("#ai-status").textContent =
              "Experimental synthetic AI loaded · see README for validation limits";
            if (state.src && state.ref) await recompute();
          }
        } catch (error) {
          console.error("Could not load the local AI model.", error);
          $("#ai-status").textContent =
            "AI model could not be loaded. Using the existing calculation-based matcher (not AI). See the console for details.";
        }
      }

      async function init() {
        wire();
        setSplit(50);
        await nextFrame();
        void initializeModel();
        try {
          const sm = makeSamples();
          state.src = buildRecord(sm.src, "Harbor dusk, flat", true);
          state.ref = buildRecord(sm.ref, "Teal and orange look", true);
          setSlot("src", state.src);
          setSlot("ref", state.ref);
          setupStage();
          await recompute();
        } catch (e) {
          console.error("Could not initialize the color matcher.", e);
          $("#status").textContent = "Could not start. See the console for details.";
        }
        try {
          if (window.claude && window.claude.use) {
            downloads = await window.claude.use("downloads");
            if (downloads) $("#btn-save").hidden = false;
          }
        } catch (e) {
          downloads = null;
        }
      }
      init();
    