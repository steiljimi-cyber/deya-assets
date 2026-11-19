# Licences

Fixer Film Lab is your own app. Every component it ships with allows free and commercial use.
Nothing needs an account, a subscription or a paid API.

| Component | Used for | Licence | Commercial use |
|---|---|---|---|
| Tauri 2, @tauri-apps/* | desktop shell, IPC, dialogs | MIT / Apache-2.0 | yes |
| LittleCMS 2 (via `lcms2`, compiled in) | ICC colour management | MIT | yes |
| `image` | decoding JPEG/PNG/TIFF/WebP | MIT / Apache-2.0 | yes |
| `jpeg-encoder` | JPEG encoding | (MIT / Apache-2.0) AND IJG | yes. IJG asks for an acknowledgement in the docs, given here: *this software is based in part on the work of the Independent JPEG Group*. |
| `png` | PNG encoding | MIT / Apache-2.0 | yes |
| `tiff` | TIFF encoding/decoding | MIT | yes |
| `half`, `rayon`, `serde`, `anyhow`, `bytemuck` | utilities | MIT / Apache-2.0 / Zlib | yes |
| `walkdir` | folder scanning | Unlicense / MIT | yes |
| `sha1_smol` | cache keys | BSD-3-Clause | yes (keep the notice) |
| Space Mono, Inter, DM Serif Display, VT323, Courier Prime (via @fontsource) | UI, rebate text, date stamp, text layers | SIL OFL 1.1 | yes. Fonts may be embedded and used in images; they may not be sold on their own. |
| OKLab colour space (Björn Ottosson) | saturation, vibrance, HSL | public domain / MIT | yes |
| Film grain model | grain | own implementation of the method in Newson, Delon & Galerne (2017). Algorithms are not copyrighted. | yes |

Development only (not shipped): Vite, TypeScript, Vitest, Playwright, axum/tokio (test server). All MIT / Apache-2.0.

## Planned for later phases, checked now
| Component | Phase | Licence | Note |
|---|---|---|---|
| LibRaw | 3 (RAW) | LGPL-2.1 **or** CDDL-1.0 (your choice) | fine for a free app. Under LGPL, linking dynamically (or shipping object files) keeps you compliant. |
| libheif + libde265 | 3/5 (HEIC) | LGPL-3.0 | same as above. macOS ImageIO can decode HEIC without it. |
| ag-psd / psd crates | 2 (PSD) | MIT | yes |
| AI models | 4 | varies per model | each will be listed with its licence before it is added. Some popular ones (e.g. some Stable Diffusion variants, SAM 2) differ, and any that forbid commercial use will be flagged. |
