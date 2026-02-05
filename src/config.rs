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
}

#[derive(Debug, Clone, Deserialize)]
struct DiskConfig {
    pub server: ServerConfig,
    pub response: ResponseConfig,
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
    #[serde(default = "default_zero")]
    pub stream_first_delay_ms: u64,
    #[serde(default = "default_true")]
    pub include_usage: bool,
    #[serde(default = "default_true")]
    pub schema_strict: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningMode {
    None,
    #[serde(alias = "append")]
    Prefix,
    #[serde(alias = "both")]
    Field,
}

impl Default for ReasoningMode {
    fn default() -> Self {
        ReasoningMode::Field
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelCatalog {
    pub schema: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(default)]
    pub aliases: Vec<AliasConfig>,
    #[serde(default)]
    pub defaults: ModelDefaults,
    #[serde(default)]
    pub templates: Vec<ModelTemplate>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ModelDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owned_by: Option<String>,
    #[serde(default)]
    pub r#static: StaticDefaults,
    #[serde(default)]
    pub script: ScriptDefaults,
    #[serde(default)]
    pub interactive: InteractiveDefaults,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct StaticDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_chunk_chars: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ScriptDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_chunk_chars: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct InteractiveDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_chunk_chars: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fake_reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_text: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelTemplate {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<ModelKind>,
    #[serde(default)]
    pub meta: ModelMeta,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#static: Option<StaticConfigPartial>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<ScriptConfigPartial>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interactive: Option<InteractiveConfigPartial>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ModelMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owned_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelFile {
    pub schema: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default)]
    pub extends: Vec<String>,
    #[serde(default)]
    pub meta: ModelMeta,
    pub kind: ModelKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#static: Option<StaticConfigPartial>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<ScriptConfigPartial>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interactive: Option<InteractiveConfigPartial>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelConfig {
    pub id: String,
    pub owned_by: String,
    pub created: i64,
    pub kind: ModelKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<ModelMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#static: Option<StaticConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script: Option<ScriptConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interactive: Option<InteractiveConfig>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelKind {
    Static,
    Script,
    Interactive,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct StaticConfigPartial {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pick: Option<PickStrategy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_chunk_chars: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rules: Option<Vec<ModelRule>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StaticConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pick: Option<PickStrategy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_chunk_chars: Option<usize>,
    pub rules: Vec<ModelRule>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ScriptConfigPartial {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub init_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_chunk_chars: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct InteractiveConfigPartial {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_chunk_chars: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fake_reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_text: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ScriptConfig {
    pub file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub init_file: Option<String>,
    pub timeout_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_chunk_chars: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct InteractiveConfig {
    pub timeout_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_chunk_chars: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fake_reasoning: Option<String>,
    pub fallback_text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StaticReply {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weight: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelRule {
    #[serde(default)]
    pub default: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<RuleWhen>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pick: Option<PickStrategy>,
    pub replies: Vec<StaticReply>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct RuleWhen {
    #[serde(default)]
    pub any: Vec<Condition>,
    #[serde(default)]
    pub all: Vec<Condition>,
    #[serde(default)]
    pub none: Vec<Condition>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Condition {
    Contains {
        contains: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        case: Option<CaseSensitivity>,
    },
    Equals {
        equals: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        case: Option<CaseSensitivity>,
    },
    StartsWith {
        starts_with: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        case: Option<CaseSensitivity>,
    },
    EndsWith {
        ends_with: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        case: Option<CaseSensitivity>,
    },
    Regex {
        regex: String,
    },
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaseSensitivity {
    Sensitive,
    Insensitive,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PickStrategy {
    RoundRobin,
    Random,
    Weighted,
}

impl Default for PickStrategy {
    fn default() -> Self {
        PickStrategy::RoundRobin
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AliasConfig {
    pub name: String,
    pub providers: Vec<String>,
    #[serde(default)]
    pub strategy: AliasStrategy,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
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

#[derive(Debug, Clone)]
pub struct LoadedModel {
    pub config: ModelConfig,
    pub created: i64,
    pub base_dir: PathBuf,
}

pub fn parse_global_config(config_text: &str) -> anyhow::Result<GlobalConfig> {
    let disk: DiskConfig =
        serde_yaml_ng::from_str(config_text).context("failed to parse config.yaml")?;
    Ok(GlobalConfig {
        server: disk.server,
        response: disk.response,
    })
}

pub fn parse_model_catalog(config_text: &str) -> anyhow::Result<ModelCatalog> {
    let catalog: ModelCatalog = serde_yaml_ng::from_str(config_text)
        .context("failed to parse models/_catalog.yaml")?;
    if catalog.schema != 2 {
        anyhow::bail!("catalog schema must be 2");
    }
    Ok(catalog)
}

pub fn parse_model_file(config_text: &str) -> anyhow::Result<ModelFile> {
    let model: ModelFile =
        serde_yaml_ng::from_str(config_text).context("failed to parse model yaml")?;
    if model.schema != 2 {
        anyhow::bail!("model schema must be 2");
    }
    Ok(model)
}

pub fn load_app_config(config_dir: &Path) -> anyhow::Result<(GlobalConfig, ModelCatalog, Vec<LoadedModel>)> {
    let config_path = config_dir.join("config.yaml");
    let config_text = fs::read_to_string(&config_path)
        .with_context(|| format!("failed to read {}", config_path.display()))?;
    let global = parse_global_config(&config_text)?;

    let models_dir = config_dir.join("models");
    let scripts_dir = config_dir.join("scripts");
    let catalog_path = models_dir.join("_catalog.yaml");
    let catalog_text = fs::read_to_string(&catalog_path)
        .with_context(|| format!("failed to read {}", catalog_path.display()))?;
    let catalog = parse_model_catalog(&catalog_text)?;

    let mut model_files = Vec::new();
    collect_yaml_files_flat(&models_dir, &mut model_files)
        .with_context(|| format!("failed to scan {}", models_dir.display()))?;

    let mut ids = HashSet::new();
    let mut models = Vec::new();
    for file in model_files {
        let text = fs::read_to_string(&file)
            .with_context(|| format!("failed to read {}", file.display()))?;
        let model = parse_model_file(&text)
            .with_context(|| format!("invalid yaml {}", file.display()))?;

        let stem = file
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| anyhow::anyhow!("invalid model filename {}", file.display()))?;

        let id = model
            .id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| stem.to_string());
        if let Some(provided) = model.id.as_ref() {
            if provided.trim().is_empty() {
                anyhow::bail!("model id empty in {}", file.display());
            }
            if provided != stem {
                anyhow::bail!(
                    "model id {} does not match filename {} in {}",
                    provided,
                    stem,
                    file.display()
                );
            }
        }
        if !ids.insert(id.clone()) {
            anyhow::bail!("duplicate model id {}", id);
        }

        let resolved = resolve_model_file(
            model,
            &id,
            &catalog,
            &scripts_dir,
            &file,
        )?;

        let base_dir = match resolved.kind {
            ModelKind::Script => scripts_dir.clone(),
            ModelKind::Static | ModelKind::Interactive => models_dir.clone(),
        };

        models.push(LoadedModel {
            created: resolved.created,
            config: resolved,
            base_dir,
        });
    }

    if models.is_empty() {
        anyhow::bail!("no model yaml found under {}", models_dir.display());
    }

    validate_aliases(&catalog.aliases, &models, &models_dir)?;
    validate_default_model(&catalog, &models)?;

    Ok((global, catalog, models))
}

pub fn validate_bundle(
    catalog: &ModelCatalog,
    models: &[ModelFile],
    models_dir: &Path,
    scripts_dir: &Path,
) -> anyhow::Result<Vec<ModelConfig>> {
    if catalog.schema != 2 {
        anyhow::bail!("catalog schema must be 2");
    }
    let mut template_names = HashSet::new();
    for template in &catalog.templates {
        if template.name.trim().is_empty() {
            anyhow::bail!("template name empty in {}", models_dir.display());
        }
        if !template_names.insert(template.name.as_str()) {
            anyhow::bail!("duplicate template name {}", template.name);
        }
    }

    let mut ids = HashSet::new();
    let mut loaded = Vec::new();
    for model in models {
        let id = model
            .id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| anyhow::anyhow!("model id missing in bundle"))?;
        if !ids.insert(id.clone()) {
            anyhow::bail!("duplicate model id {}", id);
        }
        let path = models_dir.join(format!("{id}.yaml"));
        let resolved = resolve_model_file(model.clone(), &id, catalog, scripts_dir, &path)?;
        loaded.push(LoadedModel {
            created: resolved.created,
            base_dir: match resolved.kind {
                ModelKind::Script => scripts_dir.to_path_buf(),
                ModelKind::Static | ModelKind::Interactive => models_dir.to_path_buf(),
            },
            config: resolved.clone(),
        });
    }

    if loaded.is_empty() {
        anyhow::bail!("bundle models empty");
    }

    validate_aliases(&catalog.aliases, &loaded, models_dir)?;
    validate_default_model(catalog, &loaded)?;

    Ok(loaded.into_iter().map(|m| m.config).collect())
}

pub fn resolve_model_file(
    model: ModelFile,
    id: &str,
    catalog: &ModelCatalog,
    scripts_dir: &Path,
    path: &Path,
) -> anyhow::Result<ModelConfig> {
    let mut meta = ModelMeta::default();
    if let Some(owned_by) = &catalog.defaults.owned_by {
        if !owned_by.trim().is_empty() {
            meta.owned_by = Some(owned_by.clone());
        }
    }

    let mut static_partial = StaticConfigPartial::default();
    if let Some(value) = catalog.defaults.r#static.stream_chunk_chars {
        static_partial.stream_chunk_chars = Some(value);
    }

    let mut script_partial = ScriptConfigPartial::default();
    if let Some(value) = catalog.defaults.script.timeout_ms {
        script_partial.timeout_ms = Some(value);
    }
    if let Some(value) = catalog.defaults.script.stream_chunk_chars {
        script_partial.stream_chunk_chars = Some(value);
    }
    let mut interactive_partial = InteractiveConfigPartial::default();
    if let Some(value) = catalog.defaults.interactive.timeout_ms {
        interactive_partial.timeout_ms = Some(value);
    }
    if let Some(value) = catalog.defaults.interactive.stream_chunk_chars {
        interactive_partial.stream_chunk_chars = Some(value);
    }
    if let Some(value) = catalog.defaults.interactive.fake_reasoning.as_ref() {
        if !value.trim().is_empty() {
            interactive_partial.fake_reasoning = Some(value.clone());
        }
    }
    if let Some(value) = catalog.defaults.interactive.fallback_text.as_ref() {
        if !value.trim().is_empty() {
            interactive_partial.fallback_text = Some(value.clone());
        }
    }

    for name in &model.extends {
        let template = catalog
            .templates
            .iter()
            .find(|tpl| tpl.name == *name)
            .ok_or_else(|| anyhow::anyhow!("unknown template {} in {}", name, path.display()))?;
        if let Some(kind) = template.kind {
            if kind != model.kind {
                anyhow::bail!(
                    "template {} kind {:?} does not match model kind {:?} in {}",
                    template.name,
                    kind,
                    model.kind,
                    path.display()
                );
            }
        }
        merge_meta(&mut meta, &template.meta);
        if let Some(static_cfg) = &template.r#static {
            if model.kind != ModelKind::Static {
                anyhow::bail!(
                    "template {} provides static config for non-static model in {}",
                    template.name,
                    path.display()
                );
            }
            merge_static(&mut static_partial, static_cfg);
        }
        if let Some(script_cfg) = &template.script {
            if model.kind != ModelKind::Script {
                anyhow::bail!(
                    "template {} provides script config for non-script model in {}",
                    template.name,
                    path.display()
                );
            }
            merge_script(&mut script_partial, script_cfg);
        }
        if let Some(interactive_cfg) = &template.interactive {
            if model.kind != ModelKind::Interactive {
                anyhow::bail!(
                    "template {} provides interactive config for non-interactive model in {}",
                    template.name,
                    path.display()
                );
            }
            merge_interactive(&mut interactive_partial, interactive_cfg);
        }
    }

    merge_meta(&mut meta, &model.meta);
    if let Some(static_cfg) = &model.r#static {
        merge_static(&mut static_partial, static_cfg);
    }
    if let Some(script_cfg) = &model.script {
        merge_script(&mut script_partial, script_cfg);
    }
    if let Some(interactive_cfg) = &model.interactive {
        merge_interactive(&mut interactive_partial, interactive_cfg);
    }

    let owned_by = meta
        .owned_by
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(default_owned_by);

    let created = meta.created.unwrap_or_else(|| Utc::now().timestamp());

    let meta_out = if meta.description.is_some() || !meta.tags.is_empty() {
        Some(ModelMeta {
            owned_by: None,
            created: None,
            description: meta.description,
            tags: meta.tags,
        })
    } else {
        None
    };

    match model.kind {
        ModelKind::Static => {
            if model.script.is_some() {
                anyhow::bail!("static model cannot include script config in {}", path.display());
            }
            if model.interactive.is_some() {
                anyhow::bail!(
                    "static model cannot include interactive config in {}",
                    path.display()
                );
            }
            let rules = static_partial
                .rules
                .ok_or_else(|| anyhow::anyhow!("static model rules missing in {}", path.display()))?;
            let cfg = StaticConfig {
                pick: static_partial.pick,
                stream_chunk_chars: static_partial.stream_chunk_chars,
                rules,
            };
            validate_static_rules(&cfg, path)?;
            Ok(ModelConfig {
                id: id.to_string(),
                owned_by,
                created,
                kind: ModelKind::Static,
                meta: meta_out,
                r#static: Some(cfg),
                script: None,
                interactive: None,
            })
        }
        ModelKind::Script => {
            if model.r#static.is_some() {
                anyhow::bail!("script model cannot include static config in {}", path.display());
            }
            if model.interactive.is_some() {
                anyhow::bail!(
                    "script model cannot include interactive config in {}",
                    path.display()
                );
            }
            let file = script_partial
                .file
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| anyhow::anyhow!("script.file missing in {}", path.display()))?;
            ensure_relative_path(&file, "script.file", path)?;
            let script_path = scripts_dir.join(&file);
            if !script_path.exists() {
                anyhow::bail!(
                    "script file not found: {} (from {})",
                    script_path.display(),
                    path.display()
                );
            }

            let init_file = script_partial
                .init_file
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            if let Some(init_file) = init_file.as_ref() {
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

            let timeout_ms = script_partial
                .timeout_ms
                .unwrap_or_else(default_script_timeout_ms);

            Ok(ModelConfig {
                id: id.to_string(),
                owned_by,
                created,
                kind: ModelKind::Script,
                meta: meta_out,
                r#static: None,
                script: Some(ScriptConfig {
                    file,
                    init_file,
                    timeout_ms,
                    stream_chunk_chars: script_partial.stream_chunk_chars,
                }),
                interactive: None,
            })
        }
        ModelKind::Interactive => {
            if model.r#static.is_some() {
                anyhow::bail!(
                    "interactive model cannot include static config in {}",
                    path.display()
                );
            }
            if model.script.is_some() {
                anyhow::bail!(
                    "interactive model cannot include script config in {}",
                    path.display()
                );
            }
            let timeout_ms = interactive_partial
                .timeout_ms
                .unwrap_or_else(default_interactive_timeout_ms);
            let fallback_text = interactive_partial
                .fallback_text
                .as_ref()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    anyhow::anyhow!("interactive.fallback_text missing in {}", path.display())
                })?;
            let fake_reasoning = interactive_partial
                .fake_reasoning
                .as_ref()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());

            Ok(ModelConfig {
                id: id.to_string(),
                owned_by,
                created,
                kind: ModelKind::Interactive,
                meta: meta_out,
                r#static: None,
                script: None,
                interactive: Some(InteractiveConfig {
                    timeout_ms,
                    stream_chunk_chars: interactive_partial.stream_chunk_chars,
                    fake_reasoning,
                    fallback_text,
                }),
            })
        }
    }
}

fn merge_meta(base: &mut ModelMeta, overlay: &ModelMeta) {
    if let Some(value) = overlay.owned_by.as_ref() {
        if !value.trim().is_empty() {
            base.owned_by = Some(value.clone());
        }
    }
    if let Some(value) = overlay.created {
        base.created = Some(value);
    }
    if overlay.description.is_some() {
        base.description = overlay.description.clone();
    }
    if !overlay.tags.is_empty() {
        base.tags = overlay.tags.clone();
    }
}

fn merge_static(base: &mut StaticConfigPartial, overlay: &StaticConfigPartial) {
    if overlay.pick.is_some() {
        base.pick = overlay.pick;
    }
    if overlay.stream_chunk_chars.is_some() {
        base.stream_chunk_chars = overlay.stream_chunk_chars;
    }
    if overlay.rules.is_some() {
        base.rules = overlay.rules.clone();
    }
}

fn merge_script(base: &mut ScriptConfigPartial, overlay: &ScriptConfigPartial) {
    if overlay.file.is_some() {
        base.file = overlay.file.clone();
    }
    if overlay.init_file.is_some() {
        base.init_file = overlay.init_file.clone();
    }
    if overlay.timeout_ms.is_some() {
        base.timeout_ms = overlay.timeout_ms;
    }
    if overlay.stream_chunk_chars.is_some() {
        base.stream_chunk_chars = overlay.stream_chunk_chars;
    }
}

fn merge_interactive(
    base: &mut InteractiveConfigPartial,
    overlay: &InteractiveConfigPartial,
) {
    if overlay.timeout_ms.is_some() {
        base.timeout_ms = overlay.timeout_ms;
    }
    if overlay.stream_chunk_chars.is_some() {
        base.stream_chunk_chars = overlay.stream_chunk_chars;
    }
    if overlay.fake_reasoning.is_some() {
        base.fake_reasoning = overlay.fake_reasoning.clone();
    }
    if overlay.fallback_text.is_some() {
        base.fallback_text = overlay.fallback_text.clone();
    }
}

fn validate_static_rules(cfg: &StaticConfig, path: &Path) -> anyhow::Result<()> {
    if cfg.rules.is_empty() {
        anyhow::bail!("static model rules empty in {}", path.display());
    }
    let mut default_count = 0usize;
    for (idx, rule) in cfg.rules.iter().enumerate() {
        if rule.replies.is_empty() {
            anyhow::bail!("static rule replies empty at index {} in {}", idx, path.display());
        }
        if rule.default {
            default_count += 1;
            if rule.when.is_some() {
                anyhow::bail!(
                    "default rule must not include when at index {} in {}",
                    idx,
                    path.display()
                );
            }
        } else {
            let Some(when) = &rule.when else {
                anyhow::bail!(
                    "non-default rule must include when at index {} in {}",
                    idx,
                    path.display()
                );
            };
            if when.any.is_empty() && when.all.is_empty() && when.none.is_empty() {
                anyhow::bail!(
                    "rule when must include conditions at index {} in {}",
                    idx,
                    path.display()
                );
            }
        }
    }
    if default_count != 1 {
        anyhow::bail!(
            "static rules must include exactly one default rule in {}",
            path.display()
        );
    }
    Ok(())
}

fn validate_aliases(
    aliases: &[AliasConfig],
    models: &[LoadedModel],
    models_dir: &Path,
) -> anyhow::Result<()> {
    let mut alias_names = HashSet::new();
    let model_ids: HashSet<&str> = models.iter().map(|m| m.config.id.as_str()).collect();

    for alias in aliases {
        if alias.name.trim().is_empty() {
            anyhow::bail!("alias name empty in {}", models_dir.display());
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

fn validate_default_model(catalog: &ModelCatalog, models: &[LoadedModel]) -> anyhow::Result<()> {
    let Some(default_model) = catalog.default_model.as_ref() else {
        return Ok(());
    };
    let model_ids: HashSet<&str> = models.iter().map(|m| m.config.id.as_str()).collect();
    let alias_ids: HashSet<&str> = catalog.aliases.iter().map(|a| a.name.as_str()).collect();
    if !model_ids.contains(default_model.as_str()) && !alias_ids.contains(default_model.as_str()) {
        anyhow::bail!("default_model {} not found", default_model);
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
        }
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if ext.eq_ignore_ascii_case("yaml") || ext.eq_ignore_ascii_case("yml") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if stem.starts_with('_') {
                        continue;
                    }
                }
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

fn default_owned_by() -> String {
    "llm-lab".to_string()
}

fn default_script_timeout_ms() -> u64 {
    1500
}

fn default_interactive_timeout_ms() -> u64 {
    15000
}

fn default_zero() -> u64 {
    0
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir() -> PathBuf {
        let base = std::env::temp_dir();
        let name = format!(
            "mock-llm-test-{}-{}",
            Utc::now().timestamp(),
            std::process::id()
        );
        let dir = base.join(name);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn parse_and_resolve_static_model() {
        let catalog = ModelCatalog {
            schema: 2,
            default_model: Some("llm-test".to_string()),
            aliases: vec![],
            defaults: ModelDefaults {
                owned_by: Some("test-lab".to_string()),
                r#static: StaticDefaults {
                    stream_chunk_chars: Some(8),
                },
                script: ScriptDefaults::default(),
                interactive: InteractiveDefaults::default(),
            },
            templates: vec![],
        };

        let model = ModelFile {
            schema: 2,
            id: Some("llm-test".to_string()),
            extends: vec![],
            meta: ModelMeta::default(),
            kind: ModelKind::Static,
            r#static: Some(StaticConfigPartial {
                pick: None,
                stream_chunk_chars: None,
                rules: Some(vec![ModelRule {
                    default: true,
                    when: None,
                    pick: None,
                    replies: vec![StaticReply {
                        content: "hi".to_string(),
                        reasoning: None,
                        weight: None,
                    }],
                }]),
            }),
            script: None,
            interactive: None,
        };

        let dir = temp_dir();
        let scripts_dir = dir.join("scripts");
        fs::create_dir_all(&scripts_dir).unwrap();
        let path = dir.join("llm-test.yaml");

        let resolved = resolve_model_file(model, "llm-test", &catalog, &scripts_dir, &path)
            .expect("resolve model");
        assert_eq!(resolved.owned_by, "test-lab");
        assert!(resolved.r#static.is_some());
    }

    #[test]
    fn missing_default_rule_fails() {
        let catalog = ModelCatalog {
            schema: 2,
            default_model: None,
            aliases: vec![],
            defaults: ModelDefaults::default(),
            templates: vec![],
        };

        let model = ModelFile {
            schema: 2,
            id: Some("llm-test".to_string()),
            extends: vec![],
            meta: ModelMeta::default(),
            kind: ModelKind::Static,
            r#static: Some(StaticConfigPartial {
                pick: None,
                stream_chunk_chars: None,
                rules: Some(vec![ModelRule {
                    default: false,
                    when: Some(RuleWhen {
                        any: vec![Condition::Contains {
                            contains: "hi".to_string(),
                            case: None,
                        }],
                        all: vec![],
                        none: vec![],
                    }),
                    pick: None,
                    replies: vec![StaticReply {
                        content: "hi".to_string(),
                        reasoning: None,
                        weight: None,
                    }],
                }]),
            }),
            script: None,
            interactive: None,
        };

        let dir = temp_dir();
        let scripts_dir = dir.join("scripts");
        fs::create_dir_all(&scripts_dir).unwrap();
        let path = dir.join("llm-test.yaml");

        let err = resolve_model_file(model, "llm-test", &catalog, &scripts_dir, &path)
            .unwrap_err();
        assert!(err.to_string().contains("default rule"));
    }

    #[test]
    fn template_merge_applies_defaults() {
        let catalog = ModelCatalog {
            schema: 2,
            default_model: None,
            aliases: vec![],
            defaults: ModelDefaults {
                owned_by: Some("default-lab".to_string()),
                r#static: StaticDefaults::default(),
                script: ScriptDefaults::default(),
                interactive: InteractiveDefaults::default(),
            },
            templates: vec![ModelTemplate {
                name: "base".to_string(),
                kind: Some(ModelKind::Static),
                meta: ModelMeta::default(),
                r#static: Some(StaticConfigPartial {
                    pick: Some(PickStrategy::Random),
                    stream_chunk_chars: Some(12),
                    rules: None,
                }),
                script: None,
                interactive: None,
            }],
        };

        let model = ModelFile {
            schema: 2,
            id: Some("llm-test".to_string()),
            extends: vec!["base".to_string()],
            meta: ModelMeta::default(),
            kind: ModelKind::Static,
            r#static: Some(StaticConfigPartial {
                pick: None,
                stream_chunk_chars: None,
                rules: Some(vec![ModelRule {
                    default: true,
                    when: None,
                    pick: None,
                    replies: vec![StaticReply {
                        content: "ok".to_string(),
                        reasoning: None,
                        weight: None,
                    }],
                }]),
            }),
            script: None,
            interactive: None,
        };

        let dir = temp_dir();
        let scripts_dir = dir.join("scripts");
        fs::create_dir_all(&scripts_dir).unwrap();
        let path = dir.join("llm-test.yaml");

        let resolved = resolve_model_file(model, "llm-test", &catalog, &scripts_dir, &path)
            .expect("resolve model");
        let static_cfg = resolved.r#static.expect("static cfg");
        assert_eq!(static_cfg.pick, Some(PickStrategy::Random));
        assert_eq!(static_cfg.stream_chunk_chars, Some(12));
    }

    #[test]
    fn reasoning_mode_both_alias_maps_to_field() {
        let yaml = r#"
reasoning_mode: both
"#;
        let cfg: ResponseConfig =
            serde_yaml_ng::from_str(yaml).expect("parse response config");
        assert!(matches!(cfg.reasoning_mode, ReasoningMode::Field));
    }

    #[test]
    fn interactive_fallback_text_required() {
        let catalog = ModelCatalog {
            schema: 2,
            default_model: None,
            aliases: vec![],
            defaults: ModelDefaults::default(),
            templates: vec![],
        };

        let model = ModelFile {
            schema: 2,
            id: Some("llm-test".to_string()),
            extends: vec![],
            meta: ModelMeta::default(),
            kind: ModelKind::Interactive,
            r#static: None,
            script: None,
            interactive: Some(InteractiveConfigPartial {
                timeout_ms: None,
                stream_chunk_chars: None,
                fake_reasoning: Some("thinking".to_string()),
                fallback_text: None,
            }),
        };

        let dir = temp_dir();
        let scripts_dir = dir.join("scripts");
        fs::create_dir_all(&scripts_dir).unwrap();
        let path = dir.join("llm-test.yaml");

        let err = resolve_model_file(model, "llm-test", &catalog, &scripts_dir, &path)
            .unwrap_err();
        assert!(err.to_string().contains("interactive.fallback_text"));
    }
}
