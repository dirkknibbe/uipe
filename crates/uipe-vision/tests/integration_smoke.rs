//! End-to-end smoke test that spawns the built binary and writes synthetic
//! frame pairs to its stdin, asserting that motion events come back on stdout.
//!
//! This test is `#[ignore]` because it requires a working ONNX model file.
//! Run with `cargo test --test integration_smoke -- --ignored` after the model
//! is set up via `pnpm run setup:flow-model`.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

fn png_for_color(r: u8, g: u8, b: u8, w: u32, h: u32) -> Vec<u8> {
    use image::{ImageBuffer, Rgb};
    let mut img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::new(w, h);
    for p in img.pixels_mut() {
        *p = Rgb([r, g, b]);
    }
    let mut bytes = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png).unwrap();
    bytes
}

#[test]
#[ignore = "requires ONNX model present at crates/uipe-vision/models/raft-small-int8.onnx"]
fn binary_emits_events_for_two_frames() {
    let bin = env!("CARGO_BIN_EXE_uipe-vision");
    let mut child = Command::new(bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn");

    let stdin = child.stdin.as_mut().expect("stdin");
    let frame_a = png_for_color(50, 50, 50, 128, 128);
    let frame_b = png_for_color(60, 60, 60, 128, 128);
    for frame in [&frame_a, &frame_b] {
        let len = frame.len() as u32;
        stdin.write_all(&len.to_be_bytes()).unwrap();
        stdin.write_all(frame).unwrap();
    }
    stdin.flush().unwrap();
    drop(child.stdin.take());

    let stdout = child.stdout.take().expect("stdout");
    let reader = BufReader::new(stdout);
    let mut got_event = false;
    for line in reader.lines() {
        let line = line.unwrap();
        if line.contains(r#""type":"optical-flow-"#) {
            got_event = true;
            break;
        }
    }
    assert!(got_event, "expected at least one optical-flow event on stdout");
    let _ = child.wait();
}
