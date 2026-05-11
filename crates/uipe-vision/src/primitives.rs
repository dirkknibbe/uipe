use crate::clustering::{Region, RegionVector};

#[derive(Debug, Clone, Copy)]
pub struct Primitives {
    pub mean_vx: f32,
    pub mean_vy: f32,
    pub divergence: f32,
    pub curl: f32,
    pub speed_variance: f32,
    pub point_count: usize,
}

pub fn extract_primitives(region: &Region) -> Primitives {
    let n = region.vectors.len() as f32;
    if n == 0.0 {
        return Primitives {
            mean_vx: 0.0,
            mean_vy: 0.0,
            divergence: 0.0,
            curl: 0.0,
            speed_variance: 0.0,
            point_count: 0,
        };
    }

    let (sum_vx, sum_vy) = region
        .vectors
        .iter()
        .fold((0.0f32, 0.0f32), |(sx, sy), v| (sx + v.vx, sy + v.vy));
    let mean_vx = sum_vx / n;
    let mean_vy = sum_vy / n;

    // Centroid of the region
    let (sum_x, sum_y) = region
        .vectors
        .iter()
        .fold((0.0f32, 0.0f32), |(sx, sy), v| (sx + v.x, sy + v.y));
    let cx = sum_x / n;
    let cy = sum_y / n;

    // Divergence proxy: mean of (radial velocity) — positive when vectors point outward from centroid
    // Curl proxy: mean of (tangential velocity) — positive CCW (screen-space conventions: +y down → flip sign at use site)
    let (sum_div, sum_curl) = region.vectors.iter().fold((0.0f32, 0.0f32), |(d, c), v| {
        let dx = v.x - cx;
        let dy = v.y - cy;
        let r = (dx * dx + dy * dy).sqrt().max(1e-6);
        let radial = (v.vx * dx + v.vy * dy) / r;
        let tangential = (-v.vx * dy + v.vy * dx) / r;
        (d + radial, c + tangential)
    });
    let divergence = sum_div / n;
    let curl = sum_curl / n;

    let speeds: Vec<f32> = region
        .vectors
        .iter()
        .map(|v| (v.vx * v.vx + v.vy * v.vy).sqrt())
        .collect();
    let mean_speed = speeds.iter().sum::<f32>() / n;
    let speed_variance =
        speeds.iter().map(|s| (s - mean_speed).powi(2)).sum::<f32>() / n;

    Primitives {
        mean_vx,
        mean_vy,
        divergence,
        curl,
        speed_variance,
        point_count: region.vectors.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clustering::BBox;

    fn region_from(vectors: Vec<RegionVector>) -> Region {
        let xs: Vec<f32> = vectors.iter().map(|v| v.x).collect();
        let ys: Vec<f32> = vectors.iter().map(|v| v.y).collect();
        let min_x = xs.iter().cloned().fold(f32::INFINITY, f32::min);
        let max_x = xs.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let min_y = ys.iter().cloned().fold(f32::INFINITY, f32::min);
        let max_y = ys.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        Region {
            id: 0,
            bbox: BBox { x: min_x, y: min_y, w: max_x - min_x + 1.0, h: max_y - min_y + 1.0 },
            vectors,
        }
    }

    #[test]
    fn pure_translation_has_zero_divergence_and_curl() {
        let vectors: Vec<RegionVector> = (0..10)
            .flat_map(|y| (0..10).map(move |x| RegionVector { x: x as f32, y: y as f32, vx: 2.0, vy: 0.0 }))
            .collect();
        let p = extract_primitives(&region_from(vectors));
        assert!((p.mean_vx - 2.0).abs() < 1e-4);
        assert!(p.mean_vy.abs() < 1e-4);
        assert!(p.divergence.abs() < 1e-3);
        assert!(p.curl.abs() < 1e-3);
    }

    #[test]
    fn pure_expansion_has_positive_divergence() {
        // Vectors point radially outward from (5,5)
        let mut vectors = Vec::new();
        for y in 0..10 {
            for x in 0..10 {
                if x == 5 && y == 5 { continue; }
                let dx = x as f32 - 5.0;
                let dy = y as f32 - 5.0;
                let r = (dx * dx + dy * dy).sqrt();
                vectors.push(RegionVector { x: x as f32, y: y as f32, vx: dx / r, vy: dy / r });
            }
        }
        let p = extract_primitives(&region_from(vectors));
        assert!(p.divergence > 0.5, "expected strongly positive divergence, got {}", p.divergence);
        assert!(p.curl.abs() < 0.2);
    }

    #[test]
    fn pure_rotation_has_nonzero_curl() {
        let mut vectors = Vec::new();
        for y in 0..10 {
            for x in 0..10 {
                if x == 5 && y == 5 { continue; }
                let dx = x as f32 - 5.0;
                let dy = y as f32 - 5.0;
                let r = (dx * dx + dy * dy).sqrt();
                // Tangential vectors (rotation about centroid): (-dy, dx) / r
                vectors.push(RegionVector { x: x as f32, y: y as f32, vx: -dy / r, vy: dx / r });
            }
        }
        let p = extract_primitives(&region_from(vectors));
        assert!(p.curl.abs() > 0.5, "expected strongly nonzero curl, got {}", p.curl);
        assert!(p.divergence.abs() < 0.2);
    }
}
