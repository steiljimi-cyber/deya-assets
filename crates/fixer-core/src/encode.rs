//! Encoders: JPEG (jpeg-encoder), PNG (png), TIFF (tiff). All embed the ICC profile and write PPI.
//! Input is always linear Rec.2020 f32 RGB; conversion to the target space goes through LittleCMS.

use crate::color::{self, ColorSpace};
use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Jpeg,
    Png,
    Tiff,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TiffCompression {
    #[default]
    None,
    Lzw,
    Deflate,
    Packbits,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub copyright: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSpec {
    pub path: String,
    pub format: Format,
    pub width: u32,
    pub height: u32,
    #[serde(default = "d8")]
    pub bit_depth: u8,
    #[serde(default = "dq")]
    pub quality: u8,
    #[serde(default = "dcs")]
    pub color_space: ColorSpace,
    #[serde(default = "dppi")]
    pub ppi: f64,
    #[serde(default)]
    pub tiff_compression: TiffCompression,
    #[serde(default)]
    pub metadata: Metadata,
}
fn d8() -> u8 { 8 }
fn dq() -> u8 { 92 }
fn dcs() -> ColorSpace { ColorSpace::Srgb }
fn dppi() -> f64 { 300.0 }

#[inline]
fn hash(mut x: u32) -> u32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846ca68b);
    x ^= x >> 16;
    x
}

/// Quantize encoded [0,1] floats to 8 bit with triangular (TPDF) dither: no banding in gradients.
pub fn quantize8(data: &[f32]) -> Vec<u8> {
    use rayon::prelude::*;
    data.par_iter()
        .enumerate()
        .map(|(i, v)| {
            let a = hash(i as u32 ^ 0x9e3779b9) as f32 / u32::MAX as f32;
            let b = hash((i as u32).wrapping_mul(2654435761) ^ 0x85ebca6b) as f32 / u32::MAX as f32;
            let d = a - b; // triangular in [-1,1] LSB
            (v.clamp(0.0, 1.0) * 255.0 + d).round().clamp(0.0, 255.0) as u8
        })
        .collect()
}

pub fn quantize16(data: &[f32]) -> Vec<u16> {
    use rayon::prelude::*;
    data.par_iter().map(|v| (v.clamp(0.0, 1.0) * 65535.0).round() as u16).collect()
}

/// Minimal EXIF (TIFF IFD0) block with Artist / Copyright / Software / ImageDescription.
fn exif_block(m: &Metadata) -> Vec<u8> {
    let mut entries: Vec<(u16, Vec<u8>)> = Vec::new();
    let mut push = |tag: u16, s: &str| {
        if !s.is_empty() {
            let mut v = s.as_bytes().to_vec();
            v.push(0);
            entries.push((tag, v));
        }
    };
    push(0x010e, &m.description);
    push(0x0131, "Fixer Film Lab");
    push(0x013b, &m.artist);
    push(0x8298, &m.copyright);
    entries.sort_by_key(|e| e.0);
    let n = entries.len() as u16;
    let mut out = b"Exif\0\0".to_vec();
    let base = out.len();
    out.extend_from_slice(b"MM\0\x2a\0\0\0\x08");
    out.extend_from_slice(&n.to_be_bytes());
    let mut data_off = 8 + 2 + 12 * n as u32 + 4;
    let mut data = Vec::new();
    for (tag, v) in &entries {
        out.extend_from_slice(&tag.to_be_bytes());
        out.extend_from_slice(&2u16.to_be_bytes()); // ASCII
        out.extend_from_slice(&(v.len() as u32).to_be_bytes());
        if v.len() <= 4 {
            let mut b = v.clone();
            b.resize(4, 0);
            out.extend_from_slice(&b);
        } else {
            out.extend_from_slice(&data_off.to_be_bytes());
            data.extend_from_slice(v);
            if data.len() % 2 == 1 {
                data.push(0);
            }
            data_off = 8 + 2 + 12 * n as u32 + 4 + data.len() as u32;
        }
    }
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(&data);
    let _ = base;
    out
}

/// Encode a full linear-Rec.2020 RGB f32 image to disk.
pub fn encode(spec: &ExportSpec, mut rgb: Vec<f32>) -> Result<()> {
    let (w, h) = (spec.width, spec.height);
    if rgb.len() != (w as usize) * (h as usize) * 3 {
        bail!("pixel buffer size mismatch");
    }
    color::from_working(&mut rgb, spec.color_space, lcms2::Intent::RelativeColorimetric)?;
    let icc = color::icc_bytes(spec.color_space)?;
    let path = Path::new(&spec.path);
    if let Some(p) = path.parent() {
        if !p.as_os_str().is_empty() {
            std::fs::create_dir_all(p)?;
        }
    }
    match spec.format {
        Format::Jpeg => {
            if w > 65535 || h > 65535 {
                bail!("JPEG is limited to 65535 px per side");
            }
            let px = quantize8(&rgb);
            let mut enc = jpeg_encoder::Encoder::new_file(path, spec.quality.clamp(1, 100))
                .map_err(|e| anyhow!("jpeg: {e}"))?;
            let ppi = spec.ppi.round().clamp(1.0, 65535.0) as u16;
            enc.set_density(jpeg_encoder::PixelDensity {
                density: (ppi, ppi),
                unit: jpeg_encoder::PixelDensityUnit::Inches,
            });
            if spec.quality >= 90 {
                enc.set_sampling_factor(jpeg_encoder::SamplingFactor::F_1_1); // 4:4:4, no chroma loss
            }
            enc.set_optimized_huffman_tables(true);
            enc.add_icc_profile(&icc).map_err(|e| anyhow!("jpeg icc: {e}"))?;
            enc.add_app_segment(1, exif_block(&spec.metadata)).map_err(|e| anyhow!("jpeg exif: {e}"))?;
            enc.encode(&px, w as u16, h as u16, jpeg_encoder::ColorType::Rgb)
                .map_err(|e| anyhow!("jpeg encode: {e}"))?;
        }
        Format::Png => {
            let f = BufWriter::new(File::create(path)?);
            let mut info = png::Info::with_size(w, h);
            info.icc_profile = Some(std::borrow::Cow::Owned(icc));
            info.color_type = png::ColorType::Rgb;
            info.bit_depth = if spec.bit_depth == 16 { png::BitDepth::Sixteen } else { png::BitDepth::Eight };
            let ppm = (spec.ppi / 0.0254).round() as u32;
            info.pixel_dims = Some(png::PixelDimensions { xppu: ppm, yppu: ppm, unit: png::Unit::Meter });
            let mut enc = png::Encoder::with_info(f, info).map_err(|e| anyhow!("png: {e}"))?;
            enc.set_compression(png::Compression::Balanced);
            for (k, v) in [("Software", "Fixer Film Lab"), ("Author", spec.metadata.artist.as_str()), ("Copyright", spec.metadata.copyright.as_str()), ("Description", spec.metadata.description.as_str())] {
                if !v.is_empty() {
                    enc.add_text_chunk(k.into(), v.into())?;
                }
            }
            let mut wr = enc.write_header()?;
            if spec.bit_depth == 16 {
                let px = quantize16(&rgb);
                let be: Vec<u8> = px.iter().flat_map(|v| v.to_be_bytes()).collect();
                wr.write_image_data(&be)?;
            } else {
                wr.write_image_data(&quantize8(&rgb))?;
            }
            wr.finish()?;
        }
        Format::Tiff => {
            use tiff::encoder::{colortype, Compression, DeflateLevel, Predictor, Rational, TiffEncoder};
            use tiff::tags::{ResolutionUnit, Tag};
            let f = BufWriter::new(File::create(path)?);
            let (comp, pred) = match spec.tiff_compression {
                TiffCompression::None => (Compression::Uncompressed, Predictor::None),
                TiffCompression::Lzw => (Compression::Lzw, Predictor::Horizontal),
                TiffCompression::Deflate => (Compression::Deflate(DeflateLevel::Balanced), Predictor::Horizontal),
                TiffCompression::Packbits => (Compression::Packbits, Predictor::None),
            };
            let mut enc = TiffEncoder::new(f)?.with_compression(comp).with_predictor(pred);
            let res = Rational { n: (spec.ppi * 100.0).round() as u32, d: 100 };
            macro_rules! write_img {
                ($ct:ty, $data:expr) => {{
                    let mut im = enc.new_image::<$ct>(w, h)?;
                    im.resolution(ResolutionUnit::Inch, res);
                    im.encoder().write_tag(Tag::IccProfile, &icc[..])?;
                    im.encoder().write_tag(Tag::Software, "Fixer Film Lab")?;
                    if !spec.metadata.artist.is_empty() {
                        im.encoder().write_tag(Tag::Artist, spec.metadata.artist.as_str())?;
                    }
                    if !spec.metadata.copyright.is_empty() {
                        im.encoder().write_tag(Tag::Copyright, spec.metadata.copyright.as_str())?;
                    }
                    if !spec.metadata.description.is_empty() {
                        im.encoder().write_tag(Tag::ImageDescription, spec.metadata.description.as_str())?;
                    }
                    im.write_data($data)?;
                }};
            }
            if spec.bit_depth == 16 {
                let px = quantize16(&rgb);
                write_img!(colortype::RGB16, &px);
            } else {
                let px = quantize8(&rgb);
                write_img!(colortype::RGB8, &px);
            }
        }
    }
    Ok(())
}

/// Assembles tiles streamed from the GPU into one full-resolution float buffer.
pub struct ExportSession {
    pub spec: ExportSpec,
    pub rgb: Vec<f32>,
    pub filled_px: u64,
}

impl ExportSession {
    pub fn new(spec: ExportSpec) -> Result<Self> {
        let n = spec.width as usize * spec.height as usize * 3;
        if spec.width == 0 || spec.height == 0 {
            bail!("empty export");
        }
        Ok(Self { spec, rgb: vec![0.0; n], filled_px: 0 })
    }

    /// `data` = RGBA f32 tile rows, top-to-bottom.
    pub fn put_tile(&mut self, x: u32, y: u32, tw: u32, th: u32, data: &[f32]) -> Result<()> {
        if x + tw > self.spec.width || y + th > self.spec.height || data.len() < (tw * th * 4) as usize {
            bail!("tile out of bounds");
        }
        let w = self.spec.width as usize;
        for row in 0..th as usize {
            let dst = ((y as usize + row) * w + x as usize) * 3;
            let src = row * tw as usize * 4;
            for c in 0..tw as usize {
                self.rgb[dst + c * 3] = data[src + c * 4];
                self.rgb[dst + c * 3 + 1] = data[src + c * 4 + 1];
                self.rgb[dst + c * 3 + 2] = data[src + c * 4 + 2];
            }
        }
        self.filled_px += (tw * th) as u64;
        Ok(())
    }

    pub fn finish(self) -> Result<()> {
        let total = self.spec.width as u64 * self.spec.height as u64;
        if self.filled_px < total {
            bail!("export incomplete: {} of {} px", self.filled_px, total);
        }
        encode(&self.spec, self.rgb)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A very slow 8-bit gradient must not show bands: TPDF dither keeps the local average exact
    /// and breaks up long runs of identical codes.
    #[test]
    fn eight_bit_gradients_do_not_band() {
        let n = 8192usize;
        let rows = 32usize;
        let mut v = Vec::with_capacity(n * rows);
        for _ in 0..rows {
            for i in 0..n {
                v.push(0.40 + 0.02 * i as f32 / n as f32); // ~5 code values across 8192 px
            }
        }
        let q = quantize8(&v);
        // local mean (32x64 box) tracks the true value to well under one code
        let mut worst = 0f32;
        for x0 in (0..n - 64).step_by(64) {
            let mut acc = 0f32;
            let mut tru = 0f32;
            for r in 0..rows {
                for x in x0..x0 + 64 {
                    acc += q[r * n + x] as f32;
                    tru += v[r * n + x] * 255.0;
                }
            }
            worst = worst.max(((acc - tru) / (64.0 * rows as f32)).abs());
        }
        assert!(worst < 0.12, "local mean error {worst} codes");
        // without dither a row would contain runs ~1600 px long; with dither runs stay short
        let mut longest = 0;
        let mut run = 1;
        for x in 1..n {
            if q[x] == q[x - 1] { run += 1; longest = longest.max(run); } else { run = 1; }
        }
        assert!(longest < 64, "longest flat run {longest} px");
    }
}
