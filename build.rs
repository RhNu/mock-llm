use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

fn main() -> io::Result<()> {
    println!("cargo:rerun-if-changed=ui/dist");
    println!("cargo:rerun-if-changed=ui/index.html");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dist_dir = manifest_dir.join("ui").join("dist");
    let public_dir = manifest_dir.join("ui").join("public");
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let target_dir = out_dir.join("ui-dist");

    println!("cargo:rustc-env=UI_DIST_DIR={}", target_dir.display());

    if target_dir.exists() {
        fs::remove_dir_all(&target_dir)?;
    }
    fs::create_dir_all(&target_dir)?;

    if dist_dir.exists() {
        copy_dir_recursive(&dist_dir, &target_dir)?;
        emit_rerun_if_changed(&dist_dir)?;
    } else {
        let placeholder = r#"<!doctype html>
<html lang=\"zh-CN\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <link rel=\"icon\" href=\"/favicon.ico\" sizes=\"any\" />
    <link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\" />
    <title>LLM 站点</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.5; color: #1f2937; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
      .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; max-width: 720px; }
      h1 { margin-top: 0; }
    </style>
  </head>
  <body>
    <div class=\"card\">
      <h1>LLM 站点</h1>
      <p>这是一个 LLM API 站点。</p>
      <p>调用路径：<code>/v1</code></p>
    </div>
  </body>
</html>
"#;
        fs::write(target_dir.join("index.html"), placeholder)?;
        let favicon_svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#111827"/>
  <circle cx="32" cy="32" r="14" fill="#9ca3af"/>
</svg>
"##;
        fs::write(target_dir.join("favicon.svg"), favicon_svg)?;
        let public_ico = public_dir.join("favicon.ico");
        if public_ico.exists() {
            fs::copy(&public_ico, target_dir.join("favicon.ico"))?;
        }
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
