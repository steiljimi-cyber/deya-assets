//! Read an exported file back and report what is actually inside it.

use anyhow::{anyhow, Result};
use image::{ImageDecoder, ImageReader};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReport {
    pub format: String,
    pub width: u32,
    pub height: u32,
    pub bits_per_channel: u32,
    pub ppi_x: Option<f64>,
    pub ppi_y: Option<f64>,
    pub icc_description: Option<String>,
    pub file_bytes: u64,
}

fn jpeg_ppi(b: &[u8]) -> Option<(f64, f64)> {
    let mut i = 2;
    while i + 4 < b.len() {
        if b[i] != 0xFF {
            return None;
        }
        let m = b[i + 1];
        let len = u16::from_be_bytes([b[i + 2], b[i + 3]]) as usize;
        if m == 0xE0 && b.get(i + 4..i + 9) == Some(b"JFIF\0") {
            let unit = b[i + 11];
            let x = u16::from_be_bytes([b[i + 12], b[i + 13]]) as f64;
            let y = u16::from_be_bytes([b[i + 14], b[i + 15]]) as f64;
            return match unit {
                1 => Some((x, y)),
                2 => Some((x * 2.54, y * 2.54)),
                _ => None,
            };
        }
        if m == 0xDA {
            return None;
        }
        i += 2 + len;
    }
    None
}

/// The `image` crate does not expose TIFF ICC profiles, so read tag 34675 directly.
pub fn tiff_icc(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut d = tiff::decoder::Decoder::new(std::io::Cursor::new(bytes)).ok()?;
    d.get_tag_u8_vec(tiff::tags::Tag::IccProfile).ok()
}

pub fn verify(path: &Path) -> Result<FileReport> {
    let bytes = std::fs::read(path)?;
    let reader = ImageReader::new(std::io::Cursor::new(&bytes)).with_guessed_format()?;
    let fmt = reader.format().ok_or_else(|| anyhow!("unknown format"))?;
    let mut dec = reader.into_decoder()?;
    let (w, h) = dec.dimensions();
    let ct = dec.color_type();
    let bits = (ct.bits_per_pixel() / ct.channel_count() as u16) as u32;
    let icc = dec.icc_profile().ok().flatten().or_else(|| if fmt == image::ImageFormat::Tiff { tiff_icc(&bytes) } else { None });
    let icc_description = icc.as_deref().and_then(crate::color::profile_description);
    let ppi = match fmt {
        image::ImageFormat::Jpeg => jpeg_ppi(&bytes),
        image::ImageFormat::Png => {
            let d = png::Decoder::new(std::io::Cursor::new(&bytes));
            let r = d.read_info()?;
            r.info().pixel_dims.and_then(|p| match p.unit {
                png::Unit::Meter => Some((p.xppu as f64 * 0.0254, p.yppu as f64 * 0.0254)),
                _ => None,
            })
        }
        image::ImageFormat::Tiff => {
            use tiff::tags::Tag;
            let mut d = tiff::decoder::Decoder::new(std::io::Cursor::new(&bytes))?;
            let unit = d.get_tag_u32(Tag::ResolutionUnit).unwrap_or(2);
            let rx = d.get_tag(Tag::XResolution).ok();
            let ry = d.get_tag(Tag::YResolution).ok();
            let rat = |v: Option<tiff::decoder::ifd::Value>| -> Option<f64> {
                match v? {
                    tiff::decoder::ifd::Value::Rational(n, dd) => Some(n as f64 / dd as f64),
                    tiff::decoder::ifd::Value::List(l) => match l.first()? {
                        tiff::decoder::ifd::Value::Rational(n, dd) => Some(*n as f64 / *dd as f64),
                        _ => None,
                    },
                    _ => None,
                }
            };
            match (rat(rx), rat(ry)) {
                (Some(x), Some(y)) => Some(if unit == 3 { (x * 2.54, y * 2.54) } else { (x, y) }),
                _ => None,
            }
        }
        _ => None,
    };
    Ok(FileReport {
        format: format!("{fmt:?}"),
        width: w,
        height: h,
        bits_per_channel: bits,
        ppi_x: ppi.map(|p| p.0),
        ppi_y: ppi.map(|p| p.1),
        icc_description,
        file_bytes: bytes.len() as u64,
    })
}
