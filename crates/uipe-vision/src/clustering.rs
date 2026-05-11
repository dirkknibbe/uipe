use crate::inference::FlowField;
use linfa::DatasetBase;
use linfa::traits::Transformer;
use linfa_clustering::Dbscan;
// ndarray15 is ndarray 0.15, required to match linfa's ndarray version
use ndarray15::Array2;

#[derive(Debug, Clone)]
pub struct Region {
    pub id: usize,
    pub bbox: BBox,
    pub vectors: Vec<RegionVector>,
}

#[derive(Debug, Clone, Copy)]
pub struct BBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct RegionVector {
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
}

const MIN_MAGNITUDE: f32 = 0.5;        // ignore pixels with sub-half-pixel motion
const SPATIAL_SCALE: f32 = 1.0;        // px units
const VELOCITY_SCALE: f32 = 20.0;      // 1 px/frame ≈ 20 px in feature space
const DBSCAN_EPS: f32 = 30.0;          // feature-space radius
const DBSCAN_MIN_POINTS: usize = 8;

pub fn cluster_flow(field: &FlowField) -> Vec<Region> {
    let mut features: Vec<f32> = Vec::new();
    let mut sources: Vec<RegionVector> = Vec::new();
    for y in 0..field.height {
        for x in 0..field.width {
            let (vx, vy) = field.at(x, y);
            let mag = (vx * vx + vy * vy).sqrt();
            if mag < MIN_MAGNITUDE {
                continue;
            }
            features.push(x as f32 * SPATIAL_SCALE);
            features.push(y as f32 * SPATIAL_SCALE);
            features.push(vx * VELOCITY_SCALE);
            features.push(vy * VELOCITY_SCALE);
            sources.push(RegionVector {
                x: x as f32,
                y: y as f32,
                vx,
                vy,
            });
        }
    }
    if sources.is_empty() {
        return Vec::new();
    }

    let n = sources.len();
    // linfa's DBSCAN requires f64 and ndarray 0.15 arrays (linfa's ndarray version).
    // DatasetBase::from takes ownership of the array; Transformer impl for DatasetBase
    // is what DbscanValidParams actually satisfies (the &ArrayBase impl needs a ref).
    let features_f64: Vec<f64> = features.iter().map(|&v| v as f64).collect();
    let array = Array2::from_shape_vec((n, 4), features_f64).expect("feature shape");
    let dataset = DatasetBase::from(array);
    let labeled = Dbscan::params(DBSCAN_MIN_POINTS)
        .tolerance(DBSCAN_EPS as f64)
        .transform(dataset)
        .expect("dbscan");

    let mut by_cluster: std::collections::BTreeMap<usize, Vec<RegionVector>> =
        std::collections::BTreeMap::new();
    for (idx, label) in labeled.targets().iter().enumerate() {
        if let Some(cluster_id) = label {
            by_cluster.entry(*cluster_id).or_default().push(sources[idx]);
        }
    }

    by_cluster
        .into_iter()
        .map(|(cluster_id, vectors)| {
            let xs = vectors.iter().map(|v| v.x);
            let ys = vectors.iter().map(|v| v.y);
            let min_x = xs.clone().fold(f32::INFINITY, f32::min);
            let max_x = xs.fold(f32::NEG_INFINITY, f32::max);
            let min_y = ys.clone().fold(f32::INFINITY, f32::min);
            let max_y = ys.fold(f32::NEG_INFINITY, f32::max);
            Region {
                id: cluster_id,
                bbox: BBox {
                    x: min_x,
                    y: min_y,
                    w: max_x - min_x + 1.0,
                    h: max_y - min_y + 1.0,
                },
                vectors,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_field(width: usize, height: usize, moving_box: BBox, vx: f32, vy: f32) -> FlowField {
        let mut vectors = vec![0.0; width * height * 2];
        for y in 0..height {
            for x in 0..width {
                let in_box = (x as f32) >= moving_box.x
                    && (x as f32) < moving_box.x + moving_box.w
                    && (y as f32) >= moving_box.y
                    && (y as f32) < moving_box.y + moving_box.h;
                let idx = (y * width + x) * 2;
                if in_box {
                    vectors[idx] = vx;
                    vectors[idx + 1] = vy;
                }
            }
        }
        FlowField { width, height, vectors }
    }

    #[test]
    fn cluster_flow_isolates_single_moving_region() {
        let field = synthetic_field(64, 64, BBox { x: 20.0, y: 20.0, w: 16.0, h: 16.0 }, 3.0, 0.0);
        let regions = cluster_flow(&field);
        assert_eq!(regions.len(), 1, "expected exactly one region");
        let r = &regions[0];
        assert!(r.bbox.x >= 19.0 && r.bbox.x <= 21.0);
        assert!(r.bbox.w >= 14.0 && r.bbox.w <= 18.0);
    }

    #[test]
    fn cluster_flow_returns_empty_for_stationary_field() {
        let field = synthetic_field(64, 64, BBox { x: 0.0, y: 0.0, w: 0.0, h: 0.0 }, 0.0, 0.0);
        assert!(cluster_flow(&field).is_empty());
    }

    #[test]
    fn cluster_flow_separates_distant_regions() {
        let mut field = synthetic_field(128, 128, BBox { x: 10.0, y: 10.0, w: 16.0, h: 16.0 }, 3.0, 0.0);
        // Add a second moving region far away with a different velocity direction
        for y in 90..106 {
            for x in 90..106 {
                let idx = (y * field.width + x) * 2;
                field.vectors[idx] = 0.0;
                field.vectors[idx + 1] = 3.0;
            }
        }
        let regions = cluster_flow(&field);
        assert_eq!(regions.len(), 2, "expected two distinct regions");
    }

}
