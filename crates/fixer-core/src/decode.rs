//! Image decoding into the linear Rec.2020 working space.
//! JPEG / PNG / TIFF / WebP via the `image` crate (MIT/Apache-2.0).
//! RAW, HEIC and PSD are added in later phases (see FEATURES.md).

use crate::color::{self, ColorSpace};
use anyhow::{anyhow, Context, Result};
use image::{DynamicImage, ImageDecoder, ImageReader};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedInfo {
    pub width: u32,
    pub height: u32,
    pub source_width: u32,
    pub source_height: u32,
    pub format: String,
    pub bits_per_channel: u32,
    pub source_profile: String,
    pub has_alpha: bool,
}

pub struct Decoded {
    pub info: DecodedInfo,
    /// Interleaved RGB, linear Rec.2020, f32.
    pub rgb: Vec<f32>,
}

pub fn decode_file(path: &Path, max_long_edge: Option<u32>) -> Result<Decoded> {
    let reader = ImageReader::open(path)
        .with_context(|| format!("open {}", path.display()))?
        .with_guessed_format()?;
    let format = reader.format().map(|f| format!("{f:?}")).unwrap_or_else(|| "unknown".into());
    let mut dec = reader.into_decoder().map_err(|e| anyhow!("decoder: {e}"))?;
    let mut icc = dec.icc_profile().ok().flatten();
    if icc.is_none() && format == "Tiff" {
        icc = std::fs::read(path).ok().and_then(|b| crate::verify::tiff_icc(&b));
    }
    let orientation = dec.orientation().ok();
    let mut img = DynamicImage::from_decoder(dec).map_err(|e| anyhow!("decode: {e}"))?;
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    let (sw, sh) = (img.width(), img.height());
    let bits = match img.color() {
        image::ColorType::L16 | image::ColorType::La16 | image::ColorType::Rgb16 | image::ColorType::Rgba16 => 16,
        image::ColorType::Rgb32F | image::ColorType::Rgba32F => 32,
        _ => 8,
    };
    let has_alpha = img.color().has_alpha();
    if let Some(m) = max_long_edge {
        if sw.max(sh) > m {
            img = img.resize(m, m, image::imageops::FilterType::Lanczos3);
        }
    }
    let rgbf = img.to_rgb32f();
    let (w, h) = (rgbf.width(), rgbf.height());
    let mut rgb = rgbf.into_raw();

    let (src_profile, src_name) = match icc.as_deref().and_then(|b| lcms2::Profile::new_icc(b).ok()) {
        Some(p) => {
            let n = p.info(lcms2::InfoType::Description, lcms2::Locale::none()).unwrap_or_else(|| "embedded".into());
            (p, n)
        }
        None => (color::profile(ColorSpace::Srgb)?, "sRGB (assumed, no profile embedded)".to_string()),
    };
    color::to_working(&mut rgb, &src_profile)?;

    Ok(Decoded {
        info: DecodedInfo {
            width: w,
            height: h,
            source_width: sw,
            source_height: sh,
            format,
            bits_per_channel: bits,
            source_profile: src_name,
            has_alpha,
        },
        rgb,
    })
}

/// Pack a decoded image as `u32 json_len | json | f16 RGBA pixels (alpha = 1)` for the frontend.
pub fn pack_f16(d: &Decoded) -> Result<Vec<u8>> {
    let json = serde_json::to_vec(&d.info)?;
    let mut out = Vec::with_capacity(4 + json.len() + d.rgb.len() * 2 + 8);
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    // pad so pixel data starts 4-byte aligned for typed-array views
    while out.len() % 4 != 0 {
        out.push(b' ');
    }
    let pad = out.len();
    out[0..4].copy_from_slice(&((pad - 4) as u32).to_le_bytes());
    use rayon::prelude::*;
    let one = half::f16::from_f32(1.0);
    let halfs: Vec<half::f16> = d
        .rgb
        .par_chunks(3)
        .flat_map_iter(|p| [half::f16::from_f32(p[0]), half::f16::from_f32(p[1]), half::f16::from_f32(p[2]), one])
        .collect();
    out.extend_from_slice(bytemuck::cast_slice(&halfs));
    Ok(out)
}
