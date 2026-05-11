mod classifier;
mod clustering;
mod image_io;
mod inference;
mod primitives;
mod protocol;

use anyhow::{Context, Result};
use classifier::{classify, Pattern, PatternParams, PatternTracker, Phenomenon};
use clustering::cluster_flow;
use image_io::{decode_png, to_tensor, DecodedFrame};
use inference::{load_model, run_inference};
use primitives::extract_primitives;
use protocol::{read_frame, write_event, GridSummary, OutboundEvent, RawKeypoint, SerBBox, SerPrimitives, Velocity};
use std::env;
use std::io::{stdin, stdout, BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::time::Instant;

const MODEL_INPUT_W: u32 = 512;
const MODEL_INPUT_H: u32 = 384;
const ASSUMED_FRAME_RATE_HZ: f32 = 30.0;
const MAX_RAW_KEYPOINTS: usize = 64;
const RAW_EMIT_INTERVAL_MS: f64 = 100.0; // 10 Hz
const GRID_COLS: u32 = 16;
const GRID_ROWS: u32 = 12;
const STALE_REGION_MS: f64 = 500.0;

fn main() -> Result<()> {
    let model_path: PathBuf = env::var("UIPE_FLOW_MODEL")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from("crates/uipe-vision/models/raft-small-int8.onnx")
        });

    eprintln!("uipe-vision v{} starting; model={}", env!("CARGO_PKG_VERSION"), model_path.display());

    let mut session = load_model(&model_path).with_context(|| format!("failed to load model at {}", model_path.display()))?;
    eprintln!("model loaded");

    let mut reader = BufReader::new(stdin().lock());
    let mut writer = BufWriter::new(stdout().lock());

    let mut prev_frame: Option<DecodedFrame> = None;
    let mut tracker = PatternTracker::new();
    let mut last_raw_emit_ms: f64 = f64::NEG_INFINITY;
    let session_start = Instant::now();

    loop {
        let frame_bytes = match read_frame(&mut reader)? {
            Some(b) => b,
            None => {
                eprintln!("stdin closed; exiting");
                break;
            }
        };
        let now_ms = session_start.elapsed().as_secs_f64() * 1000.0;

        let frame = match decode_png(&frame_bytes) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("decode error: {e}");
                continue;
            }
        };

        let prev = match prev_frame.take() {
            Some(p) => p,
            None => {
                prev_frame = Some(frame);
                continue;
            }
        };

        let tensor_prev = to_tensor(&prev, MODEL_INPUT_W, MODEL_INPUT_H);
        let tensor_curr = to_tensor(&frame, MODEL_INPUT_W, MODEL_INPUT_H);

        let inference_start = Instant::now();
        let flow = match run_inference(&mut session, &tensor_prev, &tensor_curr) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("inference error: {e}");
                prev_frame = Some(frame);
                continue;
            }
        };
        let inference_ms = inference_start.elapsed().as_secs_f64() * 1000.0;
        eprintln!("inference {inference_ms:.1}ms");

        // Raw event (rate-limited)
        if now_ms - last_raw_emit_ms >= RAW_EMIT_INTERVAL_MS {
            let raw = build_raw_event(&flow, now_ms);
            write_event(&mut writer, &raw)?;
            last_raw_emit_ms = now_ms;
        }

        // Region events + classifier
        let regions = cluster_flow(&flow);
        for region in &regions {
            let region_id = format!("r{}-{:.0}-{:.0}", region.id, region.bbox.x, region.bbox.y);
            let p = extract_primitives(region);
            let region_event = OutboundEvent::Region {
                ts: now_ms,
                frame_timestamp: now_ms,
                region_id: region_id.clone(),
                bbox: SerBBox { x: region.bbox.x, y: region.bbox.y, w: region.bbox.w, h: region.bbox.h },
                primitives: SerPrimitives {
                    mean_velocity: Velocity { vx: p.mean_vx, vy: p.mean_vy },
                    divergence: p.divergence,
                    curl: p.curl,
                    speed_variance: p.speed_variance,
                    point_count: p.point_count as u32,
                },
            };
            write_event(&mut writer, &region_event)?;

            let classification = classify(&p, &region.bbox, ASSUMED_FRAME_RATE_HZ);
            for phenom in tracker.observe(&region_id, classification, now_ms) {
                let event = build_motion_event(phenom);
                write_event(&mut writer, &event)?;
            }
        }

        for phenom in tracker.flush_stale(now_ms, STALE_REGION_MS) {
            let event = build_motion_event(phenom);
            write_event(&mut writer, &event)?;
        }

        writer.flush()?;
        prev_frame = Some(frame);
    }

    Ok(())
}

fn build_raw_event(flow: &inference::FlowField, ts: f64) -> OutboundEvent {
    let mut keypoints: Vec<RawKeypoint> = Vec::new();
    for y in 0..flow.height {
        for x in 0..flow.width {
            let (vx, vy) = flow.at(x, y);
            let mag = (vx * vx + vy * vy).sqrt();
            if mag < 0.5 {
                continue;
            }
            keypoints.push(RawKeypoint {
                x: x as f32,
                y: y as f32,
                vx,
                vy,
                magnitude: mag,
            });
        }
    }
    keypoints.sort_by(|a, b| b.magnitude.partial_cmp(&a.magnitude).unwrap_or(std::cmp::Ordering::Equal));
    keypoints.truncate(MAX_RAW_KEYPOINTS);

    // Coarse grid summary
    let cell_w = flow.width as f32 / GRID_COLS as f32;
    let cell_h = flow.height as f32 / GRID_ROWS as f32;
    let mut grid = vec![0.0f32; (GRID_COLS * GRID_ROWS * 2) as usize];
    let mut counts = vec![0u32; (GRID_COLS * GRID_ROWS) as usize];
    for y in 0..flow.height {
        for x in 0..flow.width {
            let (vx, vy) = flow.at(x, y);
            let gx = ((x as f32 / cell_w) as u32).min(GRID_COLS - 1);
            let gy = ((y as f32 / cell_h) as u32).min(GRID_ROWS - 1);
            let cell_idx = (gy * GRID_COLS + gx) as usize;
            grid[cell_idx * 2] += vx;
            grid[cell_idx * 2 + 1] += vy;
            counts[cell_idx] += 1;
        }
    }
    for cell_idx in 0..counts.len() {
        if counts[cell_idx] > 0 {
            grid[cell_idx * 2] /= counts[cell_idx] as f32;
            grid[cell_idx * 2 + 1] /= counts[cell_idx] as f32;
        }
    }

    OutboundEvent::Raw {
        ts,
        frame_timestamp: ts,
        keypoints,
        grid_summary: GridSummary { cols: GRID_COLS, rows: GRID_ROWS, vectors: grid },
    }
}

fn build_motion_event(phenom: Phenomenon) -> OutboundEvent {
    match phenom {
        Phenomenon::Start { region_id, classification, ts_ms } => OutboundEvent::Motion {
            ts: ts_ms,
            end_ts: None,
            region_id,
            pattern: pattern_str(classification.pattern).to_string(),
            params: pattern_params_json(classification.params),
            confidence: classification.confidence,
        },
        Phenomenon::End { region_id, pattern, started_ms, ended_ms } => OutboundEvent::Motion {
            ts: started_ms,
            end_ts: Some(ended_ms),
            region_id,
            pattern: pattern_str(pattern).to_string(),
            params: serde_json::json!({}),
            confidence: 1.0,
        },
    }
}

fn pattern_str(p: Pattern) -> &'static str {
    match p {
        Pattern::Translation => "translation",
        Pattern::Scale => "scale",
        Pattern::Rotation => "rotation",
        Pattern::Stillness => "stillness",
    }
}

fn pattern_params_json(p: PatternParams) -> serde_json::Value {
    match p {
        PatternParams::Translation { direction_vx, direction_vy, speed_px_per_sec } => serde_json::json!({
            "direction": { "vx": direction_vx, "vy": direction_vy },
            "speedPxPerSec": speed_px_per_sec,
        }),
        PatternParams::Scale { expanding, centroid, rate } => serde_json::json!({
            "sign": if expanding { "expand" } else { "contract" },
            "centroid": { "x": centroid.x, "y": centroid.y },
            "rate": rate,
        }),
        PatternParams::Rotation { cw, centroid, angular_speed_rad_per_sec } => serde_json::json!({
            "sign": if cw { "cw" } else { "ccw" },
            "centroid": { "x": centroid.x, "y": centroid.y },
            "angularSpeedRadPerSec": angular_speed_rad_per_sec,
        }),
        PatternParams::Stillness { duration_ms } => serde_json::json!({ "durationMs": duration_ms }),
    }
}
