use anyhow::Result;
use image::{ImageBuffer, Rgb};
use ndarray::Array4;

pub struct DecodedFrame {
    pub width: u32,
    pub height: u32,
    pub rgb: ImageBuffer<Rgb<u8>, Vec<u8>>,
}

pub fn decode_png(bytes: &[u8]) -> Result<DecodedFrame> {
    let img = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)?;
    let rgb = img.to_rgb8();
    Ok(DecodedFrame {
        width: rgb.width(),
        height: rgb.height(),
        rgb,
    })
}

/// Convert an RGB frame to a normalized [1, 3, H, W] float tensor in (0, 1).
/// Resize via triangle filter to (target_w, target_h) so timing stays predictable.
pub fn to_tensor(frame: &DecodedFrame, target_w: u32, target_h: u32) -> Array4<f32> {
    let resized = image::imageops::resize(
        &frame.rgb,
        target_w,
        target_h,
        image::imageops::FilterType::Triangle,
    );
    let mut arr = Array4::<f32>::zeros((1, 3, target_h as usize, target_w as usize));
    for (x, y, pixel) in resized.enumerate_pixels() {
        let [r, g, b] = pixel.0;
        arr[[0, 0, y as usize, x as usize]] = r as f32 / 255.0;
        arr[[0, 1, y as usize, x as usize]] = g as f32 / 255.0;
        arr[[0, 2, y as usize, x as usize]] = b as f32 / 255.0;
    }
    arr
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};
    use std::io::Cursor;

    fn make_test_png() -> Vec<u8> {
        let mut img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::new(4, 4);
        for (x, y, pixel) in img.enumerate_pixels_mut() {
            *pixel = Rgb([(x * 60) as u8, (y * 60) as u8, 0]);
        }
        let mut bytes = Vec::new();
        img.write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
            .unwrap();
        bytes
    }

    #[test]
    fn decode_png_round_trips_dimensions() {
        let bytes = make_test_png();
        let decoded = decode_png(&bytes).unwrap();
        assert_eq!(decoded.width, 4);
        assert_eq!(decoded.height, 4);
    }

    #[test]
    fn to_tensor_produces_normalized_values() {
        let bytes = make_test_png();
        let decoded = decode_png(&bytes).unwrap();
        let tensor = to_tensor(&decoded, 8, 8);
        assert_eq!(tensor.shape(), &[1, 3, 8, 8]);
        let max = tensor.iter().cloned().fold(0.0f32, f32::max);
        let min = tensor.iter().cloned().fold(1.0f32, f32::min);
        assert!(min >= 0.0 && max <= 1.0, "values must be in [0, 1] — got [{min}, {max}]");
    }
}
