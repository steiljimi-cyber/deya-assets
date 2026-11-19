# Fixer Film Lab — feature checklist

Every item from the brief. Ticked only when it works and is tested.

- `[x]` works, tested (automated test or verified in the running app)
- `[~]` built, but not yet verifiable here, or done in part. The note says which.
- `[ ]` not built yet. The phase it belongs to is given.

Where it was tested: the real frontend + Rust core in Chromium (WebGL2), plus the real Tauri app on
Linux (WebKit). **Nothing has run on macOS yet.** This build machine is a Linux cloud container,
see README → "What still needs your Mac".

## Phase 1: film look

### Settings shown in Labbet's public share links
- [x] Film stock + intensity
- [x] White balance, tint
- [x] Saturation, contrast, highlights, shadows, fade
- [x] Grain amount, grain size, grain colour (plus roughness)
- [x] Halation amount and spread (plus threshold)
- [x] Motion blur amount and angle
- [x] Vignette (amount, midpoint, roundness, feather)
- [x] 8-band HSL (red, orange, yellow, green, aqua, blue, purple, magenta × hue/sat/lum)
- [x] Several texture slots, each with intensity and rotation. 4 slots, each also has blend mode (24 modes), scale, offset, flip, invert, and photo-only or whole-canvas.
- [x] Text layers: font, weight, italic, size, colour, position, rotation, opacity, spacing, glow, align. Per-layer blend modes come with the Phase 2 layer stack.
- [x] Saved edits that store every setting

### Film stocks
- [x] Colour and black-and-white stocks, each with intensity. There are 20 stocks: colour negative, cine, slide, B&W, instant, expired, cross-processed.
- [~] Faithful Kodak 400-style colour negative ("Everyday 400"). It is modelled on the stock's known character (warm golden highlights, cyan-green shadow crossover, punchy saturation, RMS granularity ~13). It has **not been matched against real scans**. Send me 3–5 real scans, plus the same scene shot digitally if you can, and I will fit the curves.
- [x] Hiromix look ("Snapshot '97"): direct-flash fall-off, bright and slightly over, very high saturation, cool shadows, snapshot grain. Its starter edit leaves motion blur untouched (tested).
- [x] Physically based: per-channel negative H&D density curves (toe/straight line/shoulder), interlayer coupling (colour crossover), highlight roll-off, print-stock / reversal response. Mid-grey calibration and monotonic response are tested for every stock.

### Grain
- [x] Real silver/dye grain model: a Boolean model of Poisson grains with log-normal radii, after Newson et al. 2017. Soft dye clouds for colour, hard silver for B&W.
- [x] Generated at output resolution, at absolute pixel positions (seamless across tiles; 100% preview = export)
- [x] Per colour layer, with a colour control (shared vs independent grains per layer)
- [x] Strongest in the midtones (tested)
- [x] Tied to exposure (density), stock (clump size + published-style RMS granularity), ISO/push, and film format (35mm / half / 120 / 4x5 / instant / 110)
- [x] Amount, size, roughness, colour controls
- [x] Still reads as heavy grain after an A3→A4 downsize. Tested: grain keeps ≥85% of its contrast, while white noise drops to 71%.
- [x] Never digital noise or pixelation. Tested: grain is spatially correlated and isotropic. The GPU shader matches the CPU reference pixel by pixel.

### Effects
- [x] Halation (amount, spread, threshold). Re-exposes mostly the red layer, colour set per stock.
- [x] Bloom
- [x] Soft focus (diffusion)
- [x] Fade
- [x] Vignette (applied as exposure, in front of the film)
- [x] Chromatic fringing (lateral CA)
- [x] Light leaks: 4 styles (edge burn, corner flare, back-door stripe, fog), position, size, hue, shuffle. Exposed onto the film, plus your own leak textures.
- [x] Dust, hairs and scratches: procedural, resolution-independent, white on negatives / black on slides
- [x] Motion blur (exact 3-pass streak, no banding)
- [x] Frame jitter (gate weave)
- [x] Date stamp: 7-segment LED or dot-matrix, colour, size, glow, corner. Exposed onto the film.
- [x] Glitch: RGB split, slices, blocks, scanlines, seed

### Light and colour
- [x] Exposure, contrast, highlights, shadows, whites, blacks
- [x] Clarity, dehaze (dark-channel prior)
- [x] Vibrance (skin-protected), saturation, HSL. All in OKLab.
- [x] Tone curve (RGB + R, G, B, monotone cubic, no overshoot)
- [x] Levels (input black/white, gamma, output black/white)

### Borders (all vector or procedural, rendered at full export resolution)
- [x] 35mm with sprockets (real KS-perforation geometry), rebate text, frame numbers, DX-style code
- [x] 120 medium format (6×6, 6×4.5, 6×7, 6×9)
- [x] Half-frame
- [x] Instant film (square, wide, mini, go)
- [x] Contact sheet (strip, neighbouring frames, grease-pencil mark)
- [x] Slide mount
- [x] Scanned negative edge (inverted black rebate, or raw orange base)
- [x] Torn edge, paper print edge
- [x] Plain border in any colour
- [x] Any canvas ratio: presets plus a custom w:h field. Works with every border type.

### Edits (presets)
- [x] Save edits that store every setting, or only the groups you choose
- [x] Import / export `.ffedit` files
- [x] 10 starter edits

## Stack
- [x] Tauri 2 + TypeScript desktop app. Builds and runs on Linux. The macOS build is set up but not yet run, see README.
- [x] GPU rendering (WebGL2). WebGL2 rather than WebGPU because Safari/WKWebView WebGPU is newer and less tested.
- [~] 32-bit float linear-light pipeline: all processing and render targets are 32-bit float. The decoded **source** is held on the GPU as 16-bit half float (11-bit relative precision, finer than 16-bit integer in the shadows). Full 32-bit source upload is planned with RAW in Phase 3.
- [x] Tiled rendering. A3 at 300 ppi was exported and verified (4961×3588). Seams tested: different tile sizes give identical pixels.
- [~] Larger than A3: tiles make output size unlimited by GPU memory. Practical limits are RAM (about 12 bytes per output pixel during encode: A2 at 300 ppi ≈ 0.6 GB) and a 16384 px GPU limit on the *source* photo's sides.
- [ ] LibRaw for RAW (Phase 3)
- [x] LittleCMS 2 for all colour conversion and ICC profiles (compiled in, MIT)
- [x] Encode/decode: pure-Rust `image`, `jpeg-encoder`, `png` and `tiff` crates instead of libvips (simpler licensing, no system dependencies). libvips may be added for WebP/AVIF/HEIC in Phase 5.
- [ ] PSD library for layered PSD (Phase 2)
- [x] Licences checked, see LICENSES.md
- [x] Non-destructive: sidecar per photo (`photo.jpg.fflab`, written atomically)
- [x] Full undo history (1000 steps, kept in the sidecar), history panel
- [x] Snapshots
- [x] Copy / paste settings (choose which groups)
- [ ] Sync settings across photos (needs the library, Phase 3)

## Your files
- [~] Find `textures` in iCloud Drive (`~/Library/Mobile Documents/com~apple~CloudDocs`, case-insensitive). Implemented, **not run on your Mac**.
- [~] Download cloud-only files, use them, offload them again (`brctl download` / `brctl evict`, dataless-file detection). Implemented, **not run against real iCloud**.
- [x] Never move, rename or edit originals: only reads. Tested on a local folder: bytes and file list unchanged.
- [x] Index every texture, group by type (glitch, print, blob, dust, scratches, light-leak, paper, grain, film-frame, halftone, stain, bokeh, other) from folder/file names, else by image analysis. Thumbnails, browsable with filter chips, one click to add as a texture layer. Tested on a sample folder.
- [ ] Labbet reference recordings/screenshots: **`./reference` was empty**. I need them to match Labbet tool by tool.

## Phase 2: layers (Photoshop) — not started
- [ ] Layer stack: image, texture, text, shape, fill, adjustment; groups; opacity and fill; all blend modes (the 24 blend modes already exist in the shader); clipping masks
- [ ] Masks: brush, linear/radial gradient, luminosity range, colour range, AI subject/sky/background/click-to-select
- [ ] Transform, warp, perspective, crop, straighten, rotate, flip
- [ ] Healing, clone stamp, object removal, dodge & burn, liquify
- [ ] Filters: gaussian, lens and motion blur, sharpen, noise, glitch, halftone, displacement. All re-editable.
- [ ] Open/save layered PSD

## Phase 3: RAW and colour (Lightroom + Capture One) — not started
- [ ] RAW from all major cameras (LibRaw), plus HEIC and PSD input. JPEG, TIFF, PNG and WebP open today.
- [ ] Lens corrections, noise reduction, capture sharpening, texture, calibration
- [ ] Capture One-style colour editor (basic/advanced/skin tone), 3-way colour balance, luma curves, stackable styles with opacity
- [ ] Library: folders, ratings, flags, colour labels, filters, compare view
- [x] Before/after (toggle and split), clipping warnings
- [ ] Histogram
- [ ] Batch apply/sync and batch export

## Phase 4: AI, free and local — not started
- [ ] Tell you what your Mac can run, and how fast. I need your Mac model and RAM.
- [ ] AI upscaling 2x/4x, tiled, with grain/blur-preserving strength
- [ ] Prompt editing in a selected area, results on masked layers, variations
- [ ] Reference-based edits (incl. faces) from a second picture
- [ ] Generative fill, expand canvas, object removal, background replacement
- [ ] Style reference → editable settings + layers, savable as preset, honest match score; AI restyle mode
- [ ] Design tools: artboards, text/shape layout, guides, multi-size export
- [ ] Licence report for every model (commercial use)

## Phase 5: export and print — partly done early (export was needed to test Phase 1)
- [x] JPEG, PNG, TIFF (8 and 16-bit; TIFF: none / LZW / Deflate / PackBits)
- [ ] WebP, AVIF, HEIC, PSD, PDF
- [x] Quality, bit depth
- [ ] File-size limit
- [x] Colour space sRGB, Display P3, Adobe RGB (1998)-compatible, ProPhoto, with the ICC profile embedded (verified on read-back)
- [x] Resize by long edge; paper presets A5, A4, A3, A2, 4×6, 5×7, 8×10, 11×14, 13×19 in at any PPI
- [ ] Resize by short edge, width, height, megapixels, percent, custom cm/mm/in; "don't enlarge"; resampling choice (now automatic: Lanczos-3 when shrinking, bicubic/Lanczos when enlarging)
- [x] PPI written correctly into every file (JPEG JFIF, PNG pHYs, TIFF X/YResolution), verified on read-back
- [ ] Output sharpening (screen / matte / glossy × 3 strengths)
- [ ] Soft proofing with printer/paper ICC, gamut warning
- [ ] File-naming templates, watermark, export presets, batch export
- [~] Metadata: artist and copyright are written (EXIF/TIFF/PNG text). Full metadata control comes in Phase 5.

## Quality bar
- [x] Live preview on every slider (draft grain while dragging, full quality on release)
- [x] No banding: 8-bit output uses TPDF dither (tested); the display is dithered too
- [x] No tile seams (tested)
- [x] No pixelation: Lanczos/bicubic resampling, vector borders, grain at output resolution
- [x] Automated tests: colour maths, film model (every stock), grain statistics, GPU↔CPU parity, every current export format (size, bit depth, PPI, ICC read back), seams, presets, sidecars, undo, texture library, all borders
- [x] Dark, neutral-grey interface (equal R=G=B everywhere), Display P3 output on P3 screens
- [x] Keyboard shortcuts (press `?` in the app)
