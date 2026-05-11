mod classifier;
mod clustering;
mod image_io;
mod inference;
mod primitives;
mod protocol;

fn main() {
    eprintln!("uipe-vision v{}", env!("CARGO_PKG_VERSION"));
}
