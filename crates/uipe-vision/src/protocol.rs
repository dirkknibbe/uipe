use anyhow::{bail, Result};
use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

const MAX_FRAME_BYTES: u32 = 16 * 1024 * 1024; // 16 MB hard cap

pub fn read_frame<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let len = u32::from_be_bytes(len_buf);
    if len > MAX_FRAME_BYTES {
        bail!("frame length {len} exceeds MAX_FRAME_BYTES {MAX_FRAME_BYTES}");
    }
    let mut buf = vec![0u8; len as usize];
    reader.read_exact(&mut buf)?;
    Ok(Some(buf))
}

#[allow(dead_code)]
pub fn write_frame<W: Write>(writer: &mut W, bytes: &[u8]) -> Result<()> {
    writer.write_u32::<BigEndian>(bytes.len() as u32)?;
    writer.write_all(bytes)?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum OutboundEvent {
    #[serde(rename = "optical-flow-raw")]
    Raw {
        ts: f64,
        #[serde(rename = "frameTimestamp")]
        frame_timestamp: f64,
        keypoints: Vec<RawKeypoint>,
        #[serde(rename = "gridSummary")]
        grid_summary: GridSummary,
    },
    #[serde(rename = "optical-flow-region")]
    Region {
        ts: f64,
        #[serde(rename = "frameTimestamp")]
        frame_timestamp: f64,
        #[serde(rename = "regionId")]
        region_id: String,
        bbox: SerBBox,
        primitives: SerPrimitives,
    },
    #[serde(rename = "optical-flow-motion")]
    Motion {
        ts: f64,
        #[serde(rename = "endTs", skip_serializing_if = "Option::is_none")]
        end_ts: Option<f64>,
        #[serde(rename = "regionId")]
        region_id: String,
        pattern: String,
        params: serde_json::Value,
        confidence: f32,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RawKeypoint {
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
    pub magnitude: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GridSummary {
    pub cols: u32,
    pub rows: u32,
    pub vectors: Vec<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SerBBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SerPrimitives {
    #[serde(rename = "meanVelocity")]
    pub mean_velocity: Velocity,
    pub divergence: f32,
    pub curl: f32,
    #[serde(rename = "speedVariance")]
    pub speed_variance: f32,
    #[serde(rename = "pointCount")]
    pub point_count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Velocity {
    pub vx: f32,
    pub vy: f32,
}

pub fn write_event<W: Write>(writer: &mut W, event: &OutboundEvent) -> Result<()> {
    serde_json::to_writer(&mut *writer, event)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn read_frame_returns_none_on_empty_stream() {
        let bytes: Vec<u8> = Vec::new();
        let mut cursor = Cursor::new(bytes);
        assert!(read_frame(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn write_then_read_round_trips_a_frame() {
        let payload = vec![1u8, 2, 3, 4, 5];
        let mut buf: Vec<u8> = Vec::new();
        write_frame(&mut buf, &payload).unwrap();
        let mut cursor = Cursor::new(buf);
        let read = read_frame(&mut cursor).unwrap().expect("frame");
        assert_eq!(read, payload);
    }

    #[test]
    fn read_frame_rejects_oversize_length() {
        let mut buf: Vec<u8> = Vec::new();
        buf.extend_from_slice(&(MAX_FRAME_BYTES + 1).to_be_bytes());
        let mut cursor = Cursor::new(buf);
        assert!(read_frame(&mut cursor).is_err());
    }

    #[test]
    fn outbound_event_motion_serializes_with_kebab_case_type() {
        let evt = OutboundEvent::Motion {
            ts: 100.0,
            end_ts: None,
            region_id: "r1".into(),
            pattern: "translation".into(),
            params: serde_json::json!({"directionVx": 1.0, "directionVy": 0.0, "speedPxPerSec": 180.0}),
            confidence: 0.9,
        };
        let json = serde_json::to_string(&evt).unwrap();
        assert!(json.contains(r#""type":"optical-flow-motion""#));
        assert!(json.contains(r#""regionId":"r1""#));
        assert!(json.contains(r#""ts":100"#));
    }
}
