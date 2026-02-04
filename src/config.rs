use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

use anyhow::Context;
use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GlobalConfig {
    pub server: ServerConfig,
    pub response: ResponseConfig,
    #[serde(default)]
    pub routing: RoutingConfig,
    #[serde(default = "default_models_dir")]
    pub models_dir: String,
    pub default_model: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ServerConfig {
    pub listen: String,
    pub auth: AuthConfig,
    #[serde(default)]
    pub admin_auth: AdminAuthConfig,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AuthConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub api_key: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct AdminAuthConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub api_key: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResponseConfig {
    #[serde(default)]
    pub reasoning_mode: ReasoningMode,
    #[serde(default = "default_true")]
    pub include_usage: bool,
    #[serde(default = "default_true")]
    pub schema_strict: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningMode {
    Append,
    Field,
    Both,
}

impl Default for ReasoningMode {
    fn default() -> Self {
        ReasoningMode::Both
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelConfig {
    pub id: String,
    #[serde(default = "default_owned_by")]
    pub owned_by: String,
    pub created: Option<i64>,
    #[serde(rename = "type")]
    pub kind: ModelKind,
    pub r#static: Option<StaticConfig>,
    pub script: Option<ScriptConfig>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelKind {
    Static,
    Script,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StaticConfig {
    pub replies: Vec<StaticReply>,
    #[serde(default)]
    pub strategy: ReplyStrategy,
    pub stream_chunk_chars: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StaticReply {
    pub content: String,
    pub reasoning: Option<String>,
    #[serde(default)]
    pub r#match: Option<MatchSpec>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplyStrategy {
    RoundRobin,
    Random,
    Match,
}

impl Default for ReplyStrategy {
    fn default() -> Self {
        ReplyStrategy::RoundRobin
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum MatchSpec {
    One(MatchRule),
    Many(Vec<MatchRule>),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum MatchRule {
    Plain(String),
    Regex {
        regex: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct RoutingConfig {
    #[serde(default)]
    pub aliases: Vec<AliasConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AliasConfig {
    pub name: String,
    pub providers: Vec<String>,
    #[serde(default)]
    pub strategy: AliasStrategy,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AliasStrategy {
    RoundRobin,
    Random,
}

impl Default for AliasStrategy {
    fn default() -> Self {
        AliasStrategy::RoundRobin
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ScriptConfig {
    pub file: String,
    pub init_file: Option<String>,
    #[serde(default = "default_script_timeout_ms")]
    pub timeout_ms: u64,
    pub stream_chunk_chars: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct LoadedModel {
    pub config: ModelConfig,
    pub created: i64,
    pub base_dir: PathBuf,
}

pub fn load_app_config(config_dir: &Path) -> anyhow::Result<(GlobalConfig, Vec<LoadedModel>)> {
    let config_path = config_dir.join("config.yaml");
    let config_text = fs::read_to_string(&config_path)
        .with_context(|| format!("failed to read {}", config_path.display()))?;
    let mut global: GlobalConfig =
        serde_yaml_ng::from_str(&config_text).context("failed to parse config.yaml")?;

    let models_dir = config_dir.join(&global.models_dir);
    let scripts_dir = config_dir.join("scripts");
    let mut model_files = Vec::new();
    collect_yaml_files_flat(&models_dir, &mut model_files)
        .with_context(|| format!("failed to scan {}", models_dir.display()))?;

    let mut ids = HashSet::new();
    let mut models = Vec::new();
    for file in model_files {
        let text = fs::read_to_string(&file)
            .with_context(|| format!("failed to read {}", file.display()))?;
        let mut model: ModelConfig = serde_yaml_ng::from_str(&text)
            .with_context(|| format!("invalid yaml {}", file.display()))?;

        let stem = file
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| anyhow::anyhow!("invalid model filename {}", file.display()))?;

        if model.id.trim().is_empty() {
            anyhow::bail!("model id empty in {}", file.display());
        }
        if model.id != stem {
            anyhow::bail!(
                "model id {} does not match filename {} in {}",
                model.id,
                stem,
                file.display()
            );
        }
        if !ids.insert(model.id.clone()) {
            anyhow::bail!("duplicate model id {}", model.id);
        }

        let base_dir = match model.kind {
            ModelKind::Script => scripts_dir.clone(),
            ModelKind::Static => models_dir.clone(),
        };

        validate_model_config(&model, &scripts_dir, &file)?;

        let created = model.created.unwrap_or_else(|| Utc::now().timestamp());
        model.created = Some(created);

        models.push(LoadedModel {
            config: model,
            created,
            base_dir,
        });
    }

    if models.is_empty() {
        anyhow::bail!("no model yaml found under {}", models_dir.display());
    }

    let aliases = if global.routing.aliases.is_empty() {
        models
            .iter()
            .map(|model| AliasConfig {
                name: model.config.id.clone(),
                providers: vec![model.config.id.clone()],
                strategy: AliasStrategy::RoundRobin,
            })
            .collect()
    } else {
        global.routing.aliases.clone()
    };

    validate_aliases(&aliases, &models, &config_path)?;
    global.routing.aliases = aliases;

    Ok((global, models))
}

pub fn validate_model_config(
    model: &ModelConfig,
    scripts_dir: &Path,
    path: &Path,
) -> anyhow::Result<()> {
    match model.kind {
        ModelKind::Static => {
            let cfg = model
                .r#static
                .as_ref()
                .with_context(|| format!("static model missing config in {}", path.display()))?;
            if cfg.replies.is_empty() {
                anyhow::bail!("static model replies empty in {}", path.display());
            }
            if matches!(cfg.strategy, ReplyStrategy::Match) {
                if cfg.replies.last().and_then(|r| r.r#match.as_ref()).is_some() {
                    anyhow::bail!(
                        "match strategy requires last reply without match in {}",
                        path.display()
                    );
                }
                for (idx, reply) in cfg.replies.iter().enumerate().take(cfg.replies.len().saturating_sub(1)) {
                    if reply.r#match.is_none() {
                        anyhow::bail!(
                            "match strategy requires only last reply as default; unexpected no-match reply at index {} in {}",
                            idx,
                            path.display()
                        );
                    }
                }
            }
        }
        ModelKind::Script => {
            let cfg = model
                .script
                .as_ref()
                .with_context(|| format!("script model missing config in {}", path.display()))?;
            ensure_relative_path(&cfg.file, "script.file", path)?;
            let script_path = scripts_dir.join(&cfg.file);
            if !script_path.exists() {
                anyhow::bail!(
                    "script file not found: {} (from {})",
                    script_path.display(),
                    path.display()
                );
            }
            if let Some(init_file) = &cfg.init_file {
                ensure_relative_path(init_file, "script.init_file", path)?;
                let init_path = scripts_dir.join(init_file);
                if !init_path.exists() {
                    anyhow::bail!(
                        "init script file not found: {} (from {})",
                        init_path.display(),
                        path.display()
                    );
                }
            }
        }
    }
    Ok(())
}

fn validate_aliases(
    aliases: &[AliasConfig],
    models: &[LoadedModel],
    config_path: &Path,
) -> anyhow::Result<()> {
    let mut alias_names = HashSet::new();
    let model_ids: HashSet<&str> = models.iter().map(|m| m.config.id.as_str()).collect();

    for alias in aliases {
        if alias.name.trim().is_empty() {
            anyhow::bail!("alias name empty in {}", config_path.display());
        }
        if !alias_names.insert(alias.name.as_str()) {
            anyhow::bail!("duplicate alias name {}", alias.name);
        }
        if alias.providers.is_empty() {
            anyhow::bail!("alias {} has empty providers", alias.name);
        }
        for provider in &alias.providers {
            if !model_ids.contains(provider.as_str()) {
                anyhow::bail!(
                    "alias {} references unknown provider {}",
                    alias.name,
                    provider
                );
            }
        }
    }
    Ok(())
}

fn collect_yaml_files_flat(dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("nested model directories not supported: {}", path.display()),
            ));
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if ext.eq_ignore_ascii_case("yaml") || ext.eq_ignore_ascii_case("yml") {
                out.push(path);
            }
        }
    }
    Ok(())
}

fn ensure_relative_path(value: &str, field: &str, config_path: &Path) -> anyhow::Result<()> {
    let path = Path::new(value);
    if path.is_absolute() {
        anyhow::bail!(
            "{} must be a relative path in {}",
            field,
            config_path.display()
        );
    }
    for comp in path.components() {
        match comp {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                anyhow::bail!(
                    "{} must be a relative path in {}",
                    field,
                    config_path.display()
                );
            }
            _ => {}
        }
    }
    Ok(())
}

fn default_models_dir() -> String {
    "models".to_string()
}

fn default_owned_by() -> String {
    "llm-lab".to_string()
}

fn default_script_timeout_ms() -> u64 {
    1500
}

fn default_true() -> bool {
    true
}
