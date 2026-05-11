use crate::clustering::BBox;
use crate::primitives::Primitives;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Pattern {
    Translation,
    Scale,    // expand or contract
    Rotation, // cw or ccw
    Stillness,
}

#[derive(Debug, Clone, Copy)]
pub struct Centroid {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone)]
pub enum PatternParams {
    Translation { direction_vx: f32, direction_vy: f32, speed_px_per_sec: f32 },
    Scale { expanding: bool, centroid: Centroid, rate: f32 },
    Rotation { cw: bool, centroid: Centroid, angular_speed_rad_per_sec: f32 },
    Stillness { duration_ms: f32 },
}

#[derive(Debug, Clone)]
pub struct Classification {
    pub pattern: Pattern,
    pub params: PatternParams,
    pub confidence: f32,
}

const TRANSLATION_SPEED_MIN: f32 = 0.5;     // px/frame
const STILLNESS_SPEED_MAX: f32 = 0.2;       // px/frame
const SCALE_DIVERGENCE_MIN: f32 = 0.05;     // unitless from primitives
const ROTATION_CURL_MIN: f32 = 0.05;

/// Classify a single-frame primitive observation. Frame-rate is needed to scale
/// per-frame velocities into per-second rates.
pub fn classify(
    primitives: &Primitives,
    bbox: &BBox,
    frame_rate_hz: f32,
) -> Classification {
    let speed = (primitives.mean_vx.powi(2) + primitives.mean_vy.powi(2)).sqrt();
    let divergence = primitives.divergence.abs();
    let curl = primitives.curl.abs();

    if speed < STILLNESS_SPEED_MAX && divergence < SCALE_DIVERGENCE_MIN && curl < ROTATION_CURL_MIN {
        return Classification {
            pattern: Pattern::Stillness,
            params: PatternParams::Stillness { duration_ms: 1000.0 / frame_rate_hz },
            confidence: 0.9,
        };
    }

    // Pick the dominant signal — whichever is strongest beats the others
    let trans_strength = speed;
    let scale_strength = divergence * 10.0;
    let rot_strength = curl * 10.0;

    let centroid = Centroid {
        x: bbox.x + bbox.w / 2.0,
        y: bbox.y + bbox.h / 2.0,
    };

    if trans_strength >= scale_strength
        && trans_strength >= rot_strength
        && trans_strength > TRANSLATION_SPEED_MIN
    {
        let speed_px_per_sec = speed * frame_rate_hz;
        let conf = (trans_strength
            / (scale_strength + rot_strength + 1e-6))
            .min(1.0)
            .max(0.5);
        return Classification {
            pattern: Pattern::Translation,
            params: PatternParams::Translation {
                direction_vx: primitives.mean_vx / speed.max(1e-6),
                direction_vy: primitives.mean_vy / speed.max(1e-6),
                speed_px_per_sec,
            },
            confidence: conf,
        };
    }
    if scale_strength >= rot_strength {
        return Classification {
            pattern: Pattern::Scale,
            params: PatternParams::Scale {
                expanding: primitives.divergence > 0.0,
                centroid,
                rate: primitives.divergence,
            },
            confidence: (scale_strength / (rot_strength + 1e-6)).min(1.0).max(0.5),
        };
    }
    Classification {
        pattern: Pattern::Rotation,
        params: PatternParams::Rotation {
            cw: primitives.curl < 0.0, // screen-space: positive curl by our convention = CCW
            centroid,
            angular_speed_rad_per_sec: primitives.curl * frame_rate_hz,
        },
        confidence: 0.7,
    }
}

/// Track pattern persistence across frames per region. Emits Phenomenon events
/// when a pattern starts and when it ends (gaining an `endTs`).
pub struct PatternTracker {
    last_seen: HashMap<String, (Pattern, f64)>,
}

#[derive(Debug, Clone)]
pub enum Phenomenon {
    Start { region_id: String, classification: Classification, ts_ms: f64 },
    End { region_id: String, pattern: Pattern, started_ms: f64, ended_ms: f64 },
}

impl PatternTracker {
    pub fn new() -> Self {
        Self { last_seen: HashMap::new() }
    }

    pub fn observe(
        &mut self,
        region_id: &str,
        classification: Classification,
        ts_ms: f64,
    ) -> Vec<Phenomenon> {
        let mut out = Vec::new();
        match self.last_seen.get(region_id).copied() {
            None => {
                self.last_seen.insert(region_id.to_string(), (classification.pattern, ts_ms));
                out.push(Phenomenon::Start {
                    region_id: region_id.to_string(),
                    classification,
                    ts_ms,
                });
            }
            Some((prev_pattern, started_ms)) if prev_pattern != classification.pattern => {
                out.push(Phenomenon::End {
                    region_id: region_id.to_string(),
                    pattern: prev_pattern,
                    started_ms,
                    ended_ms: ts_ms,
                });
                out.push(Phenomenon::Start {
                    region_id: region_id.to_string(),
                    classification: classification.clone(),
                    ts_ms,
                });
                self.last_seen.insert(region_id.to_string(), (classification.pattern, ts_ms));
            }
            Some(_) => {}
        }
        out
    }

    /// Emit End phenomena for regions whose `last_seen` is older than `stale_ms`.
    pub fn flush_stale(&mut self, now_ms: f64, stale_ms: f64) -> Vec<Phenomenon> {
        let stale: Vec<(String, Pattern, f64)> = self
            .last_seen
            .iter()
            .filter(|(_, (_, started))| now_ms - started > stale_ms)
            .map(|(k, (p, s))| (k.clone(), *p, *s))
            .collect();
        let mut out = Vec::new();
        for (region_id, pattern, started_ms) in stale {
            self.last_seen.remove(&region_id);
            out.push(Phenomenon::End { region_id, pattern, started_ms, ended_ms: now_ms });
        }
        out
    }
}

impl Default for PatternTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bbox() -> BBox {
        BBox { x: 0.0, y: 0.0, w: 10.0, h: 10.0 }
    }

    #[test]
    fn stillness_classified_when_all_signals_low() {
        let p = Primitives {
            mean_vx: 0.05, mean_vy: 0.05,
            divergence: 0.01, curl: 0.01,
            speed_variance: 0.0, point_count: 100,
        };
        assert_eq!(classify(&p, &bbox(), 60.0).pattern, Pattern::Stillness);
    }

    #[test]
    fn translation_classified_for_clean_horizontal_motion() {
        let p = Primitives {
            mean_vx: 3.0, mean_vy: 0.0,
            divergence: 0.0, curl: 0.0,
            speed_variance: 0.0, point_count: 100,
        };
        let result = classify(&p, &bbox(), 60.0);
        assert_eq!(result.pattern, Pattern::Translation);
        if let PatternParams::Translation { direction_vx, speed_px_per_sec, .. } = result.params {
            assert!((direction_vx - 1.0).abs() < 0.01);
            assert!((speed_px_per_sec - 180.0).abs() < 1.0); // 3 px/frame * 60 fps
        } else {
            panic!("expected Translation params");
        }
    }

    #[test]
    fn scale_classified_for_strong_divergence() {
        let p = Primitives {
            mean_vx: 0.1, mean_vy: 0.1,
            divergence: 0.5, curl: 0.0,
            speed_variance: 0.0, point_count: 100,
        };
        assert_eq!(classify(&p, &bbox(), 60.0).pattern, Pattern::Scale);
    }

    #[test]
    fn rotation_classified_for_strong_curl() {
        let p = Primitives {
            mean_vx: 0.0, mean_vy: 0.0,
            divergence: 0.0, curl: 0.5,
            speed_variance: 0.0, point_count: 100,
        };
        assert_eq!(classify(&p, &bbox(), 60.0).pattern, Pattern::Rotation);
    }

    #[test]
    fn tracker_emits_start_on_first_observation() {
        let mut t = PatternTracker::new();
        let p = Primitives { mean_vx: 3.0, mean_vy: 0.0, divergence: 0.0, curl: 0.0, speed_variance: 0.0, point_count: 100 };
        let events = t.observe("r1", classify(&p, &bbox(), 60.0), 100.0);
        assert!(matches!(events[0], Phenomenon::Start { .. }));
    }

    #[test]
    fn tracker_emits_end_then_start_on_pattern_change() {
        let mut t = PatternTracker::new();
        let translation = Primitives { mean_vx: 3.0, mean_vy: 0.0, divergence: 0.0, curl: 0.0, speed_variance: 0.0, point_count: 100 };
        let rotation = Primitives { mean_vx: 0.0, mean_vy: 0.0, divergence: 0.0, curl: 0.5, speed_variance: 0.0, point_count: 100 };
        t.observe("r1", classify(&translation, &bbox(), 60.0), 100.0);
        let events = t.observe("r1", classify(&rotation, &bbox(), 60.0), 200.0);
        assert!(matches!(events[0], Phenomenon::End { ended_ms, .. } if ended_ms == 200.0));
        assert!(matches!(events[1], Phenomenon::Start { ts_ms, .. } if ts_ms == 200.0));
    }
}
