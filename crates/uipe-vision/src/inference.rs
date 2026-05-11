use anyhow::Result;
use ort::session::Session;
use std::path::Path;

pub fn load_model(path: impl AsRef<Path>) -> Result<Session> {
    let session = Session::builder()?
        .commit_from_file(path)?;
    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_model_fails_on_missing_file() {
        let result = load_model("/tmp/this-does-not-exist.onnx");
        assert!(result.is_err(), "expected error for missing model file");
    }
}
