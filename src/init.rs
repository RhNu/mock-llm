use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Context;

const DEFAULT_CONFIG: &str = include_str!("../config/config.yaml");
const DEFAULT_MODEL_CATALOG: &str = include_str!("../config/models/_catalog.yaml");
const DEFAULT_MODEL_FLASH: &str = include_str!("../config/models/llm-flash.yaml");
const DEFAULT_MODEL_PRO: &str = include_str!("../config/models/llm-pro.yaml");
const DEFAULT_MODEL_ULTRA: &str = include_str!("../config/models/llm-ultra.yaml");
const DEFAULT_MODEL_INTERACTIVE: &str = include_str!("../config/models/llm-interactive.yaml");
const DEFAULT_SCRIPT_EXAMPLE: &str = include_str!("../config/scripts/example.js");
const DEFAULT_SCRIPT_INIT: &str = include_str!("../config/scripts/init.js");
const DEFAULT_TYPES: &str = include_str!("../config/scripts/types.d.ts");

pub fn ensure_config_layout(config_dir: &Path) -> anyhow::Result<()> {
    if !config_dir.exists() {
        fs::create_dir_all(config_dir)
            .with_context(|| format!("failed to create {}", config_dir.display()))?;
    }

    let models_dir = config_dir.join("models");
    if !models_dir.exists() {
        fs::create_dir_all(&models_dir)
            .with_context(|| format!("failed to create {}", models_dir.display()))?;
    }

    let scripts_dir = config_dir.join("scripts");
    if !scripts_dir.exists() {
        fs::create_dir_all(&scripts_dir)
            .with_context(|| format!("failed to create {}", scripts_dir.display()))?;
    }

    write_if_missing(config_dir.join("config.yaml"), DEFAULT_CONFIG)?;
    write_if_missing(models_dir.join("_catalog.yaml"), DEFAULT_MODEL_CATALOG)?;
    write_if_missing(models_dir.join("llm-flash.yaml"), DEFAULT_MODEL_FLASH)?;
    write_if_missing(models_dir.join("llm-pro.yaml"), DEFAULT_MODEL_PRO)?;
    write_if_missing(models_dir.join("llm-ultra.yaml"), DEFAULT_MODEL_ULTRA)?;
    write_if_missing(models_dir.join("llm-interactive.yaml"), DEFAULT_MODEL_INTERACTIVE)?;
    write_if_missing(scripts_dir.join("example.js"), DEFAULT_SCRIPT_EXAMPLE)?;
    write_if_missing(scripts_dir.join("init.js"), DEFAULT_SCRIPT_INIT)?;
    write_if_missing(scripts_dir.join("types.d.ts"), DEFAULT_TYPES)?;

    Ok(())
}

fn write_if_missing(path: PathBuf, content: &str) -> anyhow::Result<()> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let content = content.strip_prefix('\u{FEFF}').unwrap_or(content);
    fs::write(&path, content).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}
