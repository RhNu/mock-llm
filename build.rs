use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

fn main() -> io::Result<()> {
    println!("cargo:rerun-if-changed=ui/dist");
    println!("cargo:rerun-if-changed=ui/index.html");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dist_dir = manifest_dir.join("ui").join("dist");
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let target_dir = out_dir.join("ui-dist");

    if target_dir.exists() {
        fs::remove_dir_all(&target_dir)?;
    }
    fs::create_dir_all(&target_dir)?;

    if dist_dir.exists() {
        copy_dir_recursive(&dist_dir, &target_dir)?;
        emit_rerun_if_changed(&dist_dir)?;
    } else {
        let placeholder = r#"<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>Mock LLM Admin</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.5; color: #1f2937; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
      .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; max-width: 720px; }
      h1 { margin-top: 0; }
    </style>
  </head>
  <body>
    <div class=\"card\">
      <h1>Admin UI is not built</h1>
      <p>The embedded admin panel is missing because <code>ui/dist</code> was not found.</p>
      <p>Run <code>pnpm install</code> and <code>pnpm run build</code> inside <code>ui/</code>, then rebuild the Rust binary.</p>
    </div>
  </body>
</html>
"#;
        fs::write(target_dir.join("index.html"), placeholder)?;
    }

    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

fn emit_rerun_if_changed(dir: &Path) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            emit_rerun_if_changed(&path)?;
        } else if let Some(path_str) = path.to_str() {
            println!("cargo:rerun-if-changed={}", path_str);
        }
    }
    Ok(())
}
