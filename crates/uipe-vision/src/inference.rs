use anyhow::{Context, Result};
use ndarray::Array4;
use ort::inputs;
use ort::session::Session;
use ort::value::Tensor;
use std::path::Path;

pub struct FlowField {
    pub width: usize,
    pub height: usize,
    pub vectors: Vec<f32>, // length = 2 * width * height, layout (vx0, vy0, vx1, vy1, ...)
}

impl FlowField {
    pub fn at(&self, x: usize, y: usize) -> (f32, f32) {
        let idx = (y * self.width + x) * 2;
        (self.vectors[idx], self.vectors[idx + 1])
    }
}

pub fn load_model(path: impl AsRef<Path>) -> Result<Session> {
    let session = Session::builder()?.commit_from_file(path)?;
    Ok(session)
}

/// Run RAFT inference on a pair of [1, 3, H, W] tensors.
/// Returns a FlowField with the model's native output resolution.
pub fn run_inference(
    session: &mut Session,
    frame_a: &Array4<f32>,
    frame_b: &Array4<f32>,
) -> Result<FlowField> {
    let input_a = Tensor::from_array(frame_a.view())?;
    let input_b = Tensor::from_array(frame_b.view())?;

    // RAFT ONNX exports vary in input naming. Verify against the model with
    // a quick `Session::inputs()` introspection if this fails at runtime.
    let outputs = session
        .run(inputs!["frame_a" => input_a, "frame_b" => input_b]?)
        .context("RAFT inference failed; verify input tensor names")?;

    let (_name, flow) = outputs
        .iter()
        .next()
        .context("model returned no outputs")?;
    let flow_view = flow.try_extract_tensor::<f32>()?;
    let view = flow_view.view();
    let shape = view.shape();
    // Expected shape: [1, 2, H, W]
    let (n, c, h, w) = (shape[0], shape[1], shape[2], shape[3]);
    anyhow::ensure!(n == 1 && c == 2, "unexpected flow output shape: {shape:?}");

    let mut vectors = Vec::with_capacity(2 * h * w);
    for y in 0..h {
        for x in 0..w {
            let vx = view[[0, 0, y, x]];
            let vy = view[[0, 1, y, x]];
            vectors.push(vx);
            vectors.push(vy);
        }
    }

    Ok(FlowField { width: w, height: h, vectors })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_model_fails_on_missing_file() {
        let result = load_model("/tmp/this-does-not-exist.onnx");
        assert!(result.is_err());
    }

    #[test]
    #[ignore = "requires raft-small-int8.onnx — run with --ignored after setup:flow-model"]
    fn inference_returns_flow_field_with_expected_shape() {
        let model_path = "crates/uipe-vision/models/raft-small-int8.onnx";
        let mut session = load_model(model_path).expect("model load");
        let a = Array4::<f32>::zeros((1, 3, 384, 512));
        let b = Array4::<f32>::zeros((1, 3, 384, 512));
        let flow = run_inference(&mut session, &a, &b).expect("inference");
        // Identical frames → near-zero flow
        let max_mag = flow
            .vectors
            .chunks(2)
            .map(|c| (c[0] * c[0] + c[1] * c[1]).sqrt())
            .fold(0.0f32, f32::max);
        assert!(max_mag < 1.0, "expected near-zero flow for identical frames, got max magnitude {max_mag}");
    }
}
