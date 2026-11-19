//! Fixer Film Lab core: everything that touches files. Shared by the Tauri app and the dev server.

pub mod color;
pub mod decode;
pub mod encode;
pub mod textures;
pub mod verify;

use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Core {
    pub cache_dir: PathBuf,
    sessions: Mutex<HashMap<u64, encode::ExportSession>>,
    next_id: Mutex<u64>,
}

impl Core {
    pub fn new(cache_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&cache_dir);
        Self { cache_dir, sessions: Mutex::new(HashMap::new()), next_id: Mutex::new(1) }
    }

    pub fn open_image(&self, path: &str) -> Result<Vec<u8>> {
        let p = textures::ensure_downloaded(Path::new(path))?;
        let d = decode::decode_file(&p, None)?;
        decode::pack_f16(&d)
    }

    pub fn open_texture(&self, path: &str, max_long_edge: u32) -> Result<Vec<u8>> {
        let cached = textures::cache_texture(Path::new(path), &self.cache_dir)?;
        let d = decode::decode_file(&cached, Some(max_long_edge))?;
        decode::pack_f16(&d)
    }

    pub fn export_begin(&self, spec_json: &str) -> Result<u64> {
        let spec: encode::ExportSpec = serde_json::from_str(spec_json)?;
        let s = encode::ExportSession::new(spec)?;
        let mut id = self.next_id.lock().unwrap();
        let this = *id;
        *id += 1;
        self.sessions.lock().unwrap().insert(this, s);
        Ok(this)
    }

    pub fn export_tile(&self, id: u64, x: u32, y: u32, w: u32, h: u32, data: &[u8]) -> Result<()> {
        let f: &[f32] = bytemuck::try_cast_slice(data).map_err(|e| anyhow!("tile bytes: {e:?}"))?;
        let mut s = self.sessions.lock().unwrap();
        s.get_mut(&id).ok_or_else(|| anyhow!("no export session"))?.put_tile(x, y, w, h, f)
    }

    pub fn export_finish(&self, id: u64) -> Result<verify::FileReport> {
        let s = self.sessions.lock().unwrap().remove(&id).ok_or_else(|| anyhow!("no export session"))?;
        let path = s.spec.path.clone();
        s.finish()?;
        verify::verify(Path::new(&path))
    }

    pub fn export_cancel(&self, id: u64) {
        self.sessions.lock().unwrap().remove(&id);
    }

    pub fn verify(&self, path: &str) -> Result<verify::FileReport> {
        verify::verify(Path::new(path))
    }

    pub fn index_textures(&self, root: &str) -> Result<textures::TextureIndex> {
        textures::index_folder(Path::new(root), &self.cache_dir, |_, _, _| {})
    }

    pub fn read_file(&self, path: &str) -> Result<Vec<u8>> {
        Ok(std::fs::read(path)?)
    }

    pub fn write_text(&self, path: &str, text: &str) -> Result<()> {
        let p = Path::new(path);
        if let Some(d) = p.parent() {
            std::fs::create_dir_all(d)?;
        }
        // atomic replace so a crash never leaves a half-written sidecar
        let tmp = p.with_extension("tmp-ffl");
        std::fs::write(&tmp, text)?;
        std::fs::rename(&tmp, p)?;
        Ok(())
    }

    pub fn read_text(&self, path: &str) -> Result<Option<String>> {
        match std::fs::read_to_string(path) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// `~/Library/Mobile Documents/com~apple~CloudDocs/<textures>` (case-insensitive match).
    pub fn default_textures_root() -> Option<String> {
        let home = std::env::var("HOME").ok()?;
        let icloud = Path::new(&home).join("Library/Mobile Documents/com~apple~CloudDocs");
        let rd = std::fs::read_dir(&icloud).ok()?;
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().eq_ignore_ascii_case("textures") {
                return Some(e.path().to_string_lossy().into());
            }
        }
        None
    }

    pub fn list_dir_images(&self, dir: &str) -> Result<Vec<String>> {
        let mut v: Vec<String> = std::fs::read_dir(dir)?
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                let e = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                ["jpg", "jpeg", "png", "tif", "tiff", "webp"].contains(&e.as_str())
            })
            .map(|p| p.to_string_lossy().into())
            .collect();
        v.sort();
        Ok(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use encode::*;

    fn gradient(w: u32, h: u32) -> Vec<f32> {
        let mut v = Vec::with_capacity((w * h * 3) as usize);
        for y in 0..h {
            for x in 0..w {
                // in-gamut for every output space: near-neutral ramp
                let t = x as f32 / (w - 1) as f32;
                let s = y as f32 / h as f32;
                v.extend_from_slice(&[t * t * 0.85, t * t * (0.75 + 0.1 * s), t * t * 0.8]);
            }
        }
        v
    }

    #[test]
    fn every_format_reads_back_with_size_ppi_and_profile() {
        let dir = std::env::temp_dir().join(format!("ffl-enc-{}", std::process::id()));
        let cases = [
            (Format::Jpeg, 8, color::ColorSpace::Srgb, "a.jpg", TiffCompression::None),
            (Format::Png, 8, color::ColorSpace::P3, "b.png", TiffCompression::None),
            (Format::Png, 16, color::ColorSpace::AdobeRgb, "c.png", TiffCompression::None),
            (Format::Tiff, 16, color::ColorSpace::ProPhoto, "d.tif", TiffCompression::Lzw),
            (Format::Tiff, 8, color::ColorSpace::Srgb, "e.tif", TiffCompression::Deflate),
            (Format::Tiff, 16, color::ColorSpace::Srgb, "f.tif", TiffCompression::None),
        ];
        for (fmt, bits, cs, name, comp) in cases {
            let spec = ExportSpec {
                path: dir.join(name).to_string_lossy().into(),
                format: fmt,
                width: 321,
                height: 123,
                bit_depth: bits,
                quality: 95,
                color_space: cs,
                ppi: 300.0,
                tiff_compression: comp,
                metadata: Metadata { artist: "Test".into(), copyright: "(c) Test".into(), description: String::new() },
            };
            encode(&spec, gradient(321, 123)).unwrap();
            let r = verify::verify(Path::new(&spec.path)).unwrap();
            assert_eq!((r.width, r.height), (321, 123), "{name}");
            assert_eq!(r.bits_per_channel, bits as u32, "{name}");
            assert!((r.ppi_x.unwrap() - 300.0).abs() < 0.01, "{name} ppi {:?}", r.ppi_x);
            assert_eq!(r.icc_description.as_deref(), Some(cs.label()), "{name}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn decode_roundtrip_is_accurate() {
        let dir = std::env::temp_dir().join(format!("ffl-dec-{}", std::process::id()));
        let path = dir.join("g.tif");
        let spec = ExportSpec {
            path: path.to_string_lossy().into(), format: Format::Tiff, width: 64, height: 16, bit_depth: 16,
            quality: 100, color_space: color::ColorSpace::Srgb, ppi: 240.0, tiff_compression: TiffCompression::None,
            metadata: Default::default(),
        };
        let src = gradient(64, 16);
        encode(&spec, src.clone()).unwrap();
        let d = decode::decode_file(&path, None).unwrap();
        assert_eq!((d.info.width, d.info.height), (64, 16));
        let maxerr = d.rgb.iter().zip(src.iter()).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
        assert!(maxerr < 1e-3, "16-bit sRGB roundtrip error {maxerr}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tiled_session_assembles_exactly() {
        let dir = std::env::temp_dir().join(format!("ffl-ses-{}", std::process::id()));
        let core = Core::new(dir.join("cache"));
        let spec = format!(r#"{{"path":"{}","format":"png","width":10,"height":7,"bitDepth":16,"colorSpace":"srgb","ppi":300}}"#, dir.join("t.png").display());
        let id = core.export_begin(&spec).unwrap();
        for (x, y, w, h) in [(0, 0, 6, 4), (6, 0, 4, 4), (0, 4, 6, 3), (6, 4, 4, 3)] {
            let data: Vec<f32> = (0..w * h).flat_map(|_| [0.5f32, 0.5, 0.5, 1.0]).collect();
            core.export_tile(id, x, y, w, h, bytemuck::cast_slice(&data)).unwrap();
        }
        let r = core.export_finish(id).unwrap();
        assert_eq!((r.width, r.height), (10, 7));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Result of a dispatched command: JSON or raw bytes.
pub enum Reply {
    Json(serde_json::Value),
    Bytes(Vec<u8>),
}

/// One entry point for every command, shared by the Tauri app and the dev/test server.
/// `raw` carries binary payloads (export tiles).
pub fn dispatch(core: &Core, cmd: &str, args: &serde_json::Value, raw: Option<&[u8]>) -> Result<Reply> {
    use serde_json::json;
    let s = |k: &str| -> Result<String> {
        args.get(k).and_then(|v| v.as_str()).map(|v| v.to_string()).ok_or_else(|| anyhow!("missing arg {k}"))
    };
    let u = |k: &str| -> Result<u64> { args.get(k).and_then(|v| v.as_u64()).ok_or_else(|| anyhow!("missing arg {k}")) };
    Ok(match cmd {
        "open_image" => Reply::Bytes(core.open_image(&s("path")?)?),
        "open_texture" => Reply::Bytes(core.open_texture(&s("path")?, u("max").unwrap_or(4096) as u32)?),
        "export_begin" => Reply::Json(json!({ "id": core.export_begin(&args.get("spec").ok_or_else(|| anyhow!("missing spec"))?.to_string())? })),
        "export_tile" => {
            core.export_tile(u("id")?, u("x")? as u32, u("y")? as u32, u("w")? as u32, u("h")? as u32, raw.ok_or_else(|| anyhow!("no tile data"))?)?;
            Reply::Json(json!(true))
        }
        "export_finish" => Reply::Json(serde_json::to_value(core.export_finish(u("id")?)?)?),
        "export_cancel" => {
            core.export_cancel(u("id")?);
            Reply::Json(json!(true))
        }
        "verify" => Reply::Json(serde_json::to_value(core.verify(&s("path")?)?)?),
        "index_textures" => Reply::Json(serde_json::to_value(core.index_textures(&s("root")?)?)?),
        "read_file" => Reply::Bytes(core.read_file(&s("path")?)?),
        "read_text" => Reply::Json(json!(core.read_text(&s("path")?)?)),
        "write_text" => {
            core.write_text(&s("path")?, &s("text")?)?;
            Reply::Json(json!(true))
        }
        "default_textures_root" => Reply::Json(json!(Core::default_textures_root())),
        "list_dir_images" => Reply::Json(json!(core.list_dir_images(&s("dir")?)?)),
        "home_dir" => Reply::Json(json!(std::env::var("HOME").ok())),
        "startup_path" => Reply::Json(json!(std::env::args().skip(1).find(|a| !a.starts_with('-') && std::path::Path::new(a).is_file()))),
        "list_dir" => {
            let dir = s("dir")?;
            let ext = s("ext").unwrap_or_default().to_lowercase();
            let mut v: Vec<String> = match std::fs::read_dir(&dir) {
                Ok(rd) => rd
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| ext.is_empty() || p.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase() == ext).unwrap_or(false))
                    .map(|p| p.to_string_lossy().into())
                    .collect(),
                Err(_) => vec![],
            };
            v.sort();
            Reply::Json(json!(v))
        }
        "delete_file" => {
            // only app-owned files (edits, sidecars) are ever deleted, never photos or textures
            let p = s("path")?;
            if !(p.ends_with(".ffedit") || p.ends_with(".fflab")) {
                anyhow::bail!("refusing to delete {p}");
            }
            let _ = std::fs::remove_file(&p);
            Reply::Json(json!(true))
        }
        _ => anyhow::bail!("unknown command {cmd}"),
    })
}
