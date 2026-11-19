//! Colour management built on LittleCMS (lcms2, MIT licence).
//!
//! Working space of the whole app: **linear-light Rec.2020 primaries, D65**, 32-bit float.
//! Every decoded image is converted into it, every export is converted out of it.

use anyhow::{anyhow, Result};
use lcms2::{
    CIExyY, CIExyYTRIPLE, Intent, Locale, PixelFormat, Profile, Tag, TagSignature, ToneCurve,
    Transform, MLU,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ColorSpace {
    Srgb,
    P3,
    AdobeRgb,
    ProPhoto,
    /// Linear Rec.2020: the internal working space.
    LinearRec2020,
}

impl ColorSpace {
    pub fn label(&self) -> &'static str {
        match self {
            ColorSpace::Srgb => "sRGB IEC61966-2.1",
            ColorSpace::P3 => "Display P3",
            ColorSpace::AdobeRgb => "Adobe RGB (1998) compatible",
            ColorSpace::ProPhoto => "ProPhoto RGB (ROMM)",
            ColorSpace::LinearRec2020 => "Linear Rec.2020 (Fixer Film Lab working space)",
        }
    }
}

const D65: CIExyY = CIExyY { x: 0.3127, y: 0.3290, Y: 1.0 };
const D50: CIExyY = CIExyY { x: 0.3457, y: 0.3585, Y: 1.0 };

fn prim(r: (f64, f64), g: (f64, f64), b: (f64, f64)) -> CIExyYTRIPLE {
    CIExyYTRIPLE {
        Red: CIExyY { x: r.0, y: r.1, Y: 1.0 },
        Green: CIExyY { x: g.0, y: g.1, Y: 1.0 },
        Blue: CIExyY { x: b.0, y: b.1, Y: 1.0 },
    }
}

fn srgb_trc() -> Result<ToneCurve> {
    // IEC 61966-2.1 piecewise curve (parametric type 4).
    ToneCurve::new_parametric(4, &[2.4, 1.0 / 1.055, 0.055 / 1.055, 1.0 / 12.92, 0.04045])
        .map_err(|e| anyhow!("tone curve: {e:?}"))
}

fn set_desc(p: &mut Profile, text: &str) {
    let mut mlu = MLU::new(1);
    mlu.set_text(text, Locale::none());
    p.write_tag(TagSignature::ProfileDescriptionTag, Tag::MLU(&mlu));
    let mut cprt = MLU::new(1);
    cprt.set_text("No copyright, use freely", Locale::none());
    p.write_tag(TagSignature::CopyrightTag, Tag::MLU(&cprt));
}

/// Build an ICC v4 matrix/shaper profile for one of the supported spaces.
pub fn profile(cs: ColorSpace) -> Result<Profile> {
    let mut p = match cs {
        ColorSpace::Srgb => {
            let c = srgb_trc()?;
            Profile::new_rgb(&D65, &prim((0.64, 0.33), (0.30, 0.60), (0.15, 0.06)), &[&c, &c, &c])
        }
        ColorSpace::P3 => {
            let c = srgb_trc()?;
            Profile::new_rgb(&D65, &prim((0.680, 0.320), (0.265, 0.690), (0.150, 0.060)), &[&c, &c, &c])
        }
        ColorSpace::AdobeRgb => {
            let c = ToneCurve::new(563.0 / 256.0);
            Profile::new_rgb(&D65, &prim((0.64, 0.33), (0.21, 0.71), (0.15, 0.06)), &[&c, &c, &c])
        }
        ColorSpace::ProPhoto => {
            // ROMM RGB: gamma 1.8 with a linear segment below 1/512 (16x slope) -> parametric type 4.
            let c = ToneCurve::new_parametric(4, &[1.8, 1.0, 0.0, 1.0 / 16.0, 1.0 / 32.0])
                .map_err(|e| anyhow!("tone curve: {e:?}"))?;
            Profile::new_rgb(
                &D50,
                &prim((0.7347, 0.2653), (0.1596, 0.8404), (0.0366, 0.0001)),
                &[&c, &c, &c],
            )
        }
        ColorSpace::LinearRec2020 => {
            let c = ToneCurve::new(1.0);
            Profile::new_rgb(&D65, &prim((0.708, 0.292), (0.170, 0.797), (0.131, 0.046)), &[&c, &c, &c])
        }
    }
    .map_err(|e| anyhow!("profile: {e:?}"))?;
    set_desc(&mut p, cs.label());
    Ok(p)
}

pub fn icc_bytes(cs: ColorSpace) -> Result<Vec<u8>> {
    profile(cs)?.icc().map_err(|e| anyhow!("icc: {e:?}"))
}

pub fn profile_description(icc: &[u8]) -> Option<String> {
    let p = Profile::new_icc(icc).ok()?;
    p.info(lcms2::InfoType::Description, Locale::none())
}

/// Convert interleaved RGB float from `src` profile to `dst` profile in place.
/// Float transforms in LittleCMS are unbounded for matrix/shaper profiles.
pub fn transform_rgb_f32(data: &mut [f32], src: &Profile, dst: &Profile, intent: Intent) -> Result<()> {
    let t: Transform<[f32; 3], [f32; 3], lcms2::GlobalContext, lcms2::DisallowCache> =
        Transform::new_flags_context(lcms2::GlobalContext::new(), src, PixelFormat::RGB_FLT, dst, PixelFormat::RGB_FLT, intent, lcms2::Flags::NO_CACHE)
            .map_err(|e| anyhow!("transform: {e:?}"))?;
    let px: &mut [[f32; 3]] = bytemuck::cast_slice_mut(data);
    use rayon::prelude::*;
    px.par_chunks_mut(65536).for_each(|c| t.transform_in_place(c));
    Ok(())
}

pub fn to_working(data: &mut [f32], src: &Profile) -> Result<()> {
    let w = profile(ColorSpace::LinearRec2020)?;
    transform_rgb_f32(data, src, &w, Intent::RelativeColorimetric)
}

pub fn from_working(data: &mut [f32], dst: ColorSpace, intent: Intent) -> Result<()> {
    let w = profile(ColorSpace::LinearRec2020)?;
    let d = profile(dst)?;
    transform_rgb_f32(data, &w, &d, intent)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srgb_roundtrip_through_working_space() {
        let src = profile(ColorSpace::Srgb).unwrap();
        let orig = vec![0.0f32, 0.0, 0.0, 0.5, 0.5, 0.5, 1.0, 0.2, 0.1, 0.18, 0.7, 0.95];
        let mut d = orig.clone();
        to_working(&mut d, &src).unwrap();
        // sRGB 0.5 grey -> linear ~0.214
        assert!((d[3] - 0.2140).abs() < 2e-3, "{}", d[3]);
        assert!((d[3] - d[4]).abs() < 1e-4 && (d[4] - d[5]).abs() < 1e-4, "grey stays neutral");
        from_working(&mut d, ColorSpace::Srgb, Intent::RelativeColorimetric).unwrap();
        for (a, b) in d.iter().zip(orig.iter()) {
            assert!((a - b).abs() < 2e-3, "{a} vs {b}");
        }
    }

    #[test]
    fn all_profiles_embed_and_describe() {
        for cs in [ColorSpace::Srgb, ColorSpace::P3, ColorSpace::AdobeRgb, ColorSpace::ProPhoto] {
            let b = icc_bytes(cs).unwrap();
            assert!(b.len() > 300);
            assert_eq!(profile_description(&b).unwrap(), cs.label());
        }
    }

    #[test]
    fn white_maps_to_white_in_all_spaces() {
        for cs in [ColorSpace::Srgb, ColorSpace::P3, ColorSpace::AdobeRgb, ColorSpace::ProPhoto] {
            let mut d = vec![1.0f32, 1.0, 1.0, 0.18, 0.18, 0.18];
            from_working(&mut d, cs, Intent::RelativeColorimetric).unwrap();
            for v in &d[0..3] {
                assert!((v - 1.0).abs() < 2e-3, "{cs:?} white {v}");
            }
            assert!((d[3] - d[4]).abs() < 2e-3 && (d[4] - d[5]).abs() < 2e-3, "{cs:?} grey neutral");
        }
    }
}
