//! Texture library: indexes a folder (e.g. iCloud Drive/textures), classifies each file,
//! builds thumbnails, and handles iCloud cloud-only files.
//!
//! Originals are only ever *read*. Never moved, renamed or edited. If a file was
//! cloud-only before we touched it, it is offloaded again afterwards (`brctl evict`).

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const CATEGORIES: &[&str] = &[
    "glitch", "print", "blob", "dust", "scratches", "light-leak", "paper", "grain", "film-frame",
    "halftone", "stain", "bokeh", "other",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextureEntry {
    pub id: String,
    pub path: String,
    pub name: String,
    pub folder: String,
    pub category: String,
    pub reason: String,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    pub thumb: String,
    pub was_cloud_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TextureIndex {
    pub root: String,
    pub entries: Vec<TextureEntry>,
    pub errors: Vec<String>,
}

const EXTS: &[&str] = &["jpg", "jpeg", "png", "tif", "tiff", "webp", "heic", "heif", "psd", "bmp", "gif"];

/// Keyword rules, checked against lowercase folder + file name.
fn keyword_category(s: &str) -> Option<&'static str> {
    let rules: &[(&str, &[&str])] = &[
        ("light-leak", &["leak", "flare", "light", "burn", "lightleak", "light_leak", "prism", "rainbow"]),
        ("glitch", &["glitch", "vhs", "datamosh", "pixel sort", "pixelsort", "rgb", "scanline", "crt", "tv"]),
        ("dust", &["dust", "speck", "hair", "lint", "dirt"]),
        ("scratches", &["scratch", "scrat"]),
        ("print", &["print", "risograph", "riso", "offset", "xerox", "photocopy", "copy", "ink", "screenprint"]),
        ("halftone", &["halftone", "dot", "screen tone"]),
        ("blob", &["blob", "bubble", "drop", "liquid", "splash", "splat", "spot"]),
        ("paper", &["paper", "card", "kraft", "cardboard", "fold", "crumple", "parchment", "canvas"]),
        ("grain", &["grain", "noise"]),
        ("film-frame", &["frame", "border", "negative", "sprocket", "35mm", "120", "polaroid", "instax", "rebate"]),
        ("stain", &["stain", "coffee", "water", "grunge", "rust", "mold", "chemical", "emulsion"]),
        ("bokeh", &["bokeh", "sparkle", "glitter", "star"]),
    ];
    for (cat, kws) in rules {
        for k in *kws {
            if s.contains(k) {
                return Some(cat);
            }
        }
    }
    None
}

/// Fallback classification from pixel statistics of a small thumbnail.
pub fn analyze_category(rgb: &image::RgbImage) -> (&'static str, String) {
    let (w, h) = rgb.dimensions();
    let n = (w * h) as f32;
    let mut mean = 0f32;
    let mut sat = 0f32;
    let mut dark = 0f32;
    let mut bright = 0f32;
    let mut hf = 0f32;
    let mut hrow = 0f32;
    let lum = |p: &image::Rgb<u8>| (0.2126 * p[0] as f32 + 0.7152 * p[1] as f32 + 0.0722 * p[2] as f32) / 255.0;
    for y in 0..h {
        for x in 0..w {
            let p = rgb.get_pixel(x, y);
            let l = lum(p);
            mean += l;
            let mx = p.0.iter().max().copied().unwrap() as f32;
            let mn = p.0.iter().min().copied().unwrap() as f32;
            sat += if mx > 0.0 { (mx - mn) / mx } else { 0.0 };
            if l < 0.12 { dark += 1.0; }
            if l > 0.88 { bright += 1.0; }
            if x + 1 < w && y + 1 < h {
                let dx = (l - lum(rgb.get_pixel(x + 1, y))).abs();
                let dy = (l - lum(rgb.get_pixel(x, y + 1))).abs();
                hf += dx + dy;
                hrow += dy - dx; // > 0 when structure is horizontal bands
            }
        }
    }
    mean /= n; sat /= n; dark /= n; bright /= n; hf /= n; hrow /= n;
    let r = format!("image analysis: mean {mean:.2}, sat {sat:.2}, dark {dark:.2}, bright {bright:.2}, detail {hf:.3}");
    if sat > 0.35 && hrow > 0.01 { return ("glitch", r); }
    if sat > 0.3 && hf < 0.03 { return ("light-leak", r); }
    if dark > 0.75 && hf > 0.005 { return ("dust", r); }
    if bright > 0.75 && hf > 0.005 { return ("dust", r); }
    if mean > 0.6 && sat < 0.15 && hf < 0.06 { return ("paper", r); }
    if hf > 0.12 { return ("grain", r); }
    ("other", r)
}

fn id_for(path: &Path, size: u64, mtime: u64) -> String {
    let mut h = sha1_smol::Sha1::new();
    h.update(path.to_string_lossy().as_bytes());
    h.update(&size.to_le_bytes());
    h.update(&mtime.to_le_bytes());
    h.digest().to_string()[..16].to_string()
}

/// Real name of an iCloud placeholder: `.photo.jpg.icloud` -> `photo.jpg`.
pub fn icloud_real_name(name: &str) -> Option<String> {
    if name.starts_with('.') && name.ends_with(".icloud") {
        Some(name[1..name.len() - 7].to_string())
    } else {
        None
    }
}

/// True when the file's data is not on disk (iCloud "dataless" file or placeholder).
pub fn is_cloud_only(path: &Path) -> bool {
    if let Some(n) = path.file_name().and_then(|n| n.to_str()) {
        if icloud_real_name(n).is_some() {
            return true;
        }
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::macos::fs::MetadataExt;
        const SF_DATALESS: u32 = 0x4000_0000;
        if let Ok(m) = std::fs::metadata(path) {
            return m.st_flags() & SF_DATALESS != 0;
        }
    }
    false
}

/// Make sure the file content is local. Returns the real path. macOS only does anything.
pub fn ensure_downloaded(path: &Path) -> Result<PathBuf> {
    let real = match path.file_name().and_then(|n| n.to_str()).and_then(icloud_real_name) {
        Some(rn) => path.with_file_name(rn),
        None => path.to_path_buf(),
    };
    if !is_cloud_only(path) && real.exists() && !is_cloud_only(&real) {
        return Ok(real);
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("brctl").arg("download").arg(&real).status();
        let start = std::time::Instant::now();
        while start.elapsed().as_secs() < 300 {
            if real.exists() && !is_cloud_only(&real) {
                return Ok(real);
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        return Err(anyhow!("iCloud download timed out: {}", real.display()));
    }
    #[allow(unreachable_code)]
    Err(anyhow!("file is cloud-only and iCloud is only available on macOS: {}", real.display()))
}

/// Offload a file back to iCloud (keeps it in iCloud, removes local copy). Content never changes.
pub fn evict(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("brctl").arg("evict").arg(path).status();
    }
    let _ = path;
}

/// Decode any supported texture, falling back to macOS `sips` for HEIC/PSD.
fn decode_any(path: &Path, max: u32, tmp_dir: &Path) -> Result<image::DynamicImage> {
    match image::ImageReader::open(path)?.with_guessed_format()?.decode() {
        Ok(i) => Ok(if i.width().max(i.height()) > max { i.thumbnail(max, max) } else { i }),
        Err(e) => {
            #[cfg(target_os = "macos")]
            {
                let out = tmp_dir.join(format!("sips-{}.png", std::process::id()));
                let st = std::process::Command::new("sips")
                    .args(["-s", "format", "png", "-Z", &max.to_string()])
                    .arg(path).arg("--out").arg(&out).status()?;
                if st.success() {
                    let i = image::open(&out)?;
                    let _ = std::fs::remove_file(&out);
                    return Ok(i);
                }
            }
            let _ = tmp_dir;
            Err(anyhow!("cannot decode {}: {e}", path.display()))
        }
    }
}

pub fn index_folder(root: &Path, cache_dir: &Path, mut progress: impl FnMut(usize, usize, &str)) -> Result<TextureIndex> {
    let thumbs = cache_dir.join("texture-thumbs");
    std::fs::create_dir_all(&thumbs)?;
    let index_path = cache_dir.join("texture-index.json");
    let previous: TextureIndex = std::fs::read(&index_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();

    let mut files = Vec::new();
    for e in walkdir::WalkDir::new(root).follow_links(false).into_iter().filter_map(|e| e.ok()) {
        if !e.file_type().is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        let logical = icloud_real_name(&name).unwrap_or(name.clone());
        if logical.starts_with('.') {
            continue;
        }
        let ext = Path::new(&logical).extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
        if EXTS.contains(&ext.as_str()) {
            files.push(e.path().to_path_buf());
        }
    }
    files.sort();
    let mut idx = TextureIndex { root: root.to_string_lossy().into(), ..Default::default() };
    let total = files.len();
    for (i, f) in files.iter().enumerate() {
        let name = f.file_name().unwrap().to_string_lossy().to_string();
        let logical_name = icloud_real_name(&name).unwrap_or(name.clone());
        let real_path = f.with_file_name(&logical_name);
        progress(i, total, &logical_name);
        let meta = std::fs::metadata(f).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let mtime = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let rel_folder = real_path.parent().and_then(|p| p.strip_prefix(root).ok()).map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        let id = id_for(&real_path, size, mtime);
        if let Some(prev) = previous.entries.iter().find(|e| e.id == id && Path::new(&e.thumb).exists()) {
            idx.entries.push(prev.clone());
            continue;
        }
        let cloud = is_cloud_only(f);
        let local = match ensure_downloaded(f) {
            Ok(p) => p,
            Err(e) => {
                idx.errors.push(e.to_string());
                continue;
            }
        };
        let result = (|| -> Result<TextureEntry> {
            let img = decode_any(&local, 4096, cache_dir)?;
            let (w, h) = (img.width(), img.height());
            let thumb = img.thumbnail(384, 384).to_rgb8();
            let thumb_path = thumbs.join(format!("{id}.jpg"));
            thumb.save_with_format(&thumb_path, image::ImageFormat::Jpeg)?;
            let key = format!("{} {}", rel_folder.to_lowercase(), logical_name.to_lowercase());
            let (category, reason) = match keyword_category(&key) {
                Some(c) => (c.to_string(), "name / folder keyword".to_string()),
                None => {
                    let small = img.thumbnail(96, 96).to_rgb8();
                    let (c, r) = analyze_category(&small);
                    (c.to_string(), r)
                }
            };
            Ok(TextureEntry {
                id: id.clone(),
                path: local.to_string_lossy().into(),
                name: logical_name.clone(),
                folder: rel_folder.clone(),
                category,
                reason,
                width: w,
                height: h,
                bytes: std::fs::metadata(&local).map(|m| m.len()).unwrap_or(size),
                thumb: thumb_path.to_string_lossy().into(),
                was_cloud_only: cloud,
            })
        })();
        if cloud {
            evict(&local);
        }
        match result {
            Ok(e) => idx.entries.push(e),
            Err(e) => idx.errors.push(format!("{}: {e}", real_path.display())),
        }
    }
    std::fs::write(&index_path, serde_json::to_vec_pretty(&idx)?)?;
    Ok(idx)
}

/// Copy a texture into the app cache (downloading from iCloud if needed, offloading again after).
/// Returns the cache path, which is what texture layers read. The original is untouched.
pub fn cache_texture(path: &Path, cache_dir: &Path) -> Result<PathBuf> {
    let dir = cache_dir.join("texture-full");
    std::fs::create_dir_all(&dir)?;
    let cloud = is_cloud_only(path);
    let local = ensure_downloaded(path)?;
    let ext = local.extension().and_then(|e| e.to_str()).unwrap_or("bin").to_lowercase();
    let meta = std::fs::metadata(&local)?;
    let mt = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let dst = dir.join(format!("{}.{ext}", id_for(&local, meta.len(), mt)));
    if !dst.exists() {
        std::fs::copy(&local, &dst)?;
    }
    if cloud {
        evict(&local);
    }
    Ok(dst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_names() {
        assert_eq!(icloud_real_name(".leak 01.jpg.icloud").as_deref(), Some("leak 01.jpg"));
        assert_eq!(icloud_real_name("leak.jpg"), None);
    }

    #[test]
    fn indexes_and_classifies_without_touching_originals() {
        let tmp = std::env::temp_dir().join(format!("ffl-tex-{}", std::process::id()));
        let root = tmp.join("textures");
        let cache = tmp.join("cache");
        std::fs::create_dir_all(root.join("Glitch")).unwrap();
        std::fs::create_dir_all(root.join("misc")).unwrap();
        // keyword by folder
        image::RgbImage::from_fn(64, 64, |x, _| image::Rgb([(x * 4) as u8, 0, 255])).save(root.join("Glitch/a.png")).unwrap();
        // analysis: dark with specks => dust
        image::RgbImage::from_fn(200, 200, |x, y| if (x * 7 + y * 13) % 97 == 0 { image::Rgb([255, 255, 255]) } else { image::Rgb([5, 5, 5]) })
            .save(root.join("misc/untitled1.png")).unwrap();
        // analysis: smooth saturated warm => light leak
        image::RgbImage::from_fn(200, 200, |x, _| image::Rgb([255, (x / 2) as u8, 0])).save(root.join("misc/untitled2.jpg")).unwrap();
        let before: Vec<_> = walkdir::WalkDir::new(&root).into_iter().filter_map(|e| e.ok()).filter(|e| e.file_type().is_file())
            .map(|e| (e.path().to_path_buf(), std::fs::read(e.path()).unwrap())).collect();
        let idx = index_folder(&root, &cache, |_, _, _| {}).unwrap();
        assert_eq!(idx.entries.len(), 3, "{:?}", idx.errors);
        let cat = |n: &str| idx.entries.iter().find(|e| e.name == n).unwrap().category.clone();
        assert_eq!(cat("a.png"), "glitch");
        assert_eq!(cat("untitled1.png"), "dust");
        assert_eq!(cat("untitled2.jpg"), "light-leak");
        for e in &idx.entries {
            assert!(Path::new(&e.thumb).exists());
        }
        for (p, b) in before {
            assert_eq!(std::fs::read(&p).unwrap(), b, "original modified: {}", p.display());
        }
        // second run is incremental and identical
        let idx2 = index_folder(&root, &cache, |_, _, _| {}).unwrap();
        assert_eq!(idx2.entries.len(), 3);
        let c = cache_texture(Path::new(&idx.entries[0].path), &cache).unwrap();
        assert!(c.exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
