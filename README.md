# Fixer Film Lab

A professional photo editor for macOS that turns any photo into a convincing analog film image:
physically based film stocks, real grain, halation, borders and more. Exports at full print
quality. Your own app: free, offline, no subscriptions, no paid APIs.

Status: **Phase 1 (film look) is built and tested.** See [FEATURES.md](FEATURES.md) for the full
checklist.

## Build and run on your Mac (Apple Silicon or Intel, macOS 13+)

One-time setup:
```sh
xcode-select --install                                           # Apple build tools
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust
brew install node        # or install Node 20+ from nodejs.org
```

Then, in this folder:
```sh
npm install
npm run tauri dev        # run the app while developing
npm run tauri build      # build "Fixer Film Lab.app" + .dmg in target/release/bundle/
```

The app is not code-signed. The first time you open it, right-click it and choose Open.

You can also start the "macOS build" workflow under GitHub → Actions (it is manual-only). It
builds the .dmg on a GitHub Mac runner. That uses your Actions minutes, and macOS minutes count
10x on private repos.

## Tests
```sh
npm test                 # colour maths, film model, grain statistics (Vitest)
npm run test:rust        # colour management, encoders, read-back, texture library, banding
npm run build && npm run test:e2e   # the real app in Chromium + the real Rust core
```

## How it works
- `crates/fixer-core`: Rust core. Decode, LittleCMS colour management (working space: linear
  Rec.2020, float), encoders that write ICC profiles and PPI, read-back verification, iCloud-aware
  texture library.
- `src-tauri`: the macOS app shell. One generic command, plus a binary one for export tiles.
- `crates/fixer-devserver`: the same core over HTTP, so tests can drive the real UI in a browser.
- `src/engine`: WebGL2 pipeline in 32-bit float. It renders any rectangle of the output at any
  scale, so the live preview and every export tile use the same code. All randomness (grain, dust,
  glitch) is keyed to absolute output pixels: no tile seams.
- `src/film`: the film model. Spectral-sensitivity matrix → per-layer H&D curves with toe and
  shoulder → interlayer coupling (crossover) → grain on developed density → print/scan stage.
- Grain: Boolean model of Poisson grains with log-normal radii, evaluated per colour layer at
  output resolution. Amplitude is calibrated to each stock's RMS granularity.

## Files the app writes
- `<photo>.fflab` next to each photo: settings, history, snapshots (non-destructive sidecar)
- `~/Library/Application Support/com.fixerfilmlab.editor/edits/*.ffedit`: your saved edits
- `~/Library/Caches/com.fixerfilmlab.editor/`: texture thumbnails and cached textures
- Your iCloud textures are only read, never changed.

## What still needs your Mac
This was built in a Linux cloud container. It has no access to your Mac, your iCloud Drive or a
Mac GPU. Tested here: the real UI + Rust core in Chromium, and the real Tauri app on Linux (WebKit).
**Not yet run on macOS:** the macOS build itself, iCloud download/offload, the auto-found
`textures` folder, and real GPU speed.
