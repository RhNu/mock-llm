use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use regex::Regex;
use tracing::info;

use crate::config::{AliasConfig, GlobalConfig, LoadedModel, MatchRule, MatchSpec, ModelKind};
use crate::config::load_app_config;
use crate::error::AppError;
use crate::scripting::{ScriptEngineHandle, start_engine};

pub struct KernelState {
    pub config: GlobalConfig,
    pub models: HashMap<String, LoadedModel>,
    pub engines: HashMap<String, ScriptEngineHandle>,
    pub match_cache: HashMap<String, MatchCache>,
    pub aliases: HashMap<String, AliasConfig>,
    pub rr_state: Mutex<HashMap<String, usize>>,
    pub alias_rr: Mutex<HashMap<String, usize>>,
    pub loaded_at: DateTime<Utc>,
    pub config_dir: PathBuf,
    pub config_path: PathBuf,
}

#[derive(Clone)]
pub struct KernelHandle {
    config_dir: PathBuf,
    inner: Arc<RwLock<Arc<KernelState>>>,
    reload_state: Arc<Mutex<ReloadState>>,
}

impl KernelHandle {
    pub fn new(config_dir: PathBuf) -> Result<Self, AppError> {
        let state = KernelState::load(&config_dir)?;
        Ok(KernelHandle {
            config_dir,
            inner: Arc::new(RwLock::new(Arc::new(state))),
            reload_state: Arc::new(Mutex::new(ReloadState { last_start: None })),
        })
    }

    pub fn current(&self) -> Arc<KernelState> {
        let guard = self.inner.read().unwrap_or_else(|err| err.into_inner());
        guard.clone()
    }

    pub fn reload(&self) -> Result<ReloadOutcome, AppError> {
        if self.is_debounced()? {
            return Ok(ReloadOutcome {
                state: self.current(),
                reloaded: false,
            });
        }

        let state = KernelState::load(&self.config_dir)?;
        let state = Arc::new(state);
        let mut guard = self.inner.write().unwrap_or_else(|err| err.into_inner());
        *guard = state.clone();

        let mut reload_state = self
            .reload_state
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        reload_state.last_start = Some(Instant::now());

        Ok(ReloadOutcome {
            state,
            reloaded: true,
        })
    }

    fn is_debounced(&self) -> Result<bool, AppError> {
        let mut guard = self
            .reload_state
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let Some(last) = guard.last_start else {
            return Ok(false);
        };
        if last.elapsed() < RELOAD_DEBOUNCE {
            info!("reload debounced: elapsed_ms={}", last.elapsed().as_millis());
            return Ok(true);
        }
        guard.last_start = Some(Instant::now());
        Ok(false)
    }
}

pub struct ReloadOutcome {
    pub state: Arc<KernelState>,
    pub reloaded: bool,
}

struct ReloadState {
    last_start: Option<Instant>,
}

const RELOAD_DEBOUNCE: Duration = Duration::from_millis(1500);

impl KernelState {
    pub fn load(config_dir: &Path) -> Result<Self, AppError> {
        let (global, models) = load_app_config(config_dir)
            .map_err(|e| AppError::internal(format!("load config failed: {e}")))?;

        let mut model_map = HashMap::new();
        let mut engines = HashMap::new();
        let mut match_cache = HashMap::new();

        for model in models {
            match model.config.kind {
                ModelKind::Script => {
                    let cfg = model
                        .config
                        .script
                        .as_ref()
                        .ok_or_else(|| AppError::internal("script config missing"))?;
                    let init_path = cfg.init_file.as_ref().map(|f| model.base_dir.join(f));
                    let engine =
                        start_engine(model.base_dir.join(&cfg.file), init_path, cfg.timeout_ms)?;
                    info!("script engine ready: id={}", model.config.id);
                    engines.insert(model.config.id.clone(), engine);
                }
                ModelKind::Static => {
                    if let Some(cfg) = model.config.r#static.as_ref() {
                        let cache = build_match_cache(cfg)?;
                        match_cache.insert(model.config.id.clone(), cache);
                    }
                }
            }

            model_map.insert(model.config.id.clone(), model);
        }

        let mut aliases = HashMap::new();
        for alias in &global.routing.aliases {
            aliases.insert(alias.name.clone(), alias.clone());
        }

        info!(
            "kernel loaded: models={}, aliases={}, config_dir={}",
            model_map.len(),
            aliases.len(),
            config_dir.display()
        );

        Ok(KernelState {
            config: global,
            models: model_map,
            engines,
            match_cache,
            aliases,
            rr_state: Mutex::new(HashMap::new()),
            alias_rr: Mutex::new(HashMap::new()),
            loaded_at: Utc::now(),
            config_dir: config_dir.to_path_buf(),
            config_path: config_dir.join("config.yaml"),
        })
    }
}

pub struct MatchCache {
    pub compiled: Vec<Option<CompiledSpec>>,
    pub fallback_index: Option<usize>,
}

pub struct CompiledSpec {
    pub rules: Vec<CompiledRule>,
}

pub enum CompiledRule {
    Plain(String),
    Regex(Regex),
}

fn build_match_cache(cfg: &crate::config::StaticConfig) -> Result<MatchCache, AppError> {
    let mut compiled = Vec::with_capacity(cfg.replies.len());
    let mut fallback_index = None;
    for (idx, reply) in cfg.replies.iter().enumerate() {
        match &reply.r#match {
            Some(spec) => {
                let compiled_spec = compile_match_spec(spec)?;
                compiled.push(Some(compiled_spec));
            }
            None => {
                if fallback_index.is_none() {
                    fallback_index = Some(idx);
                }
                compiled.push(None);
            }
        }
    }
    Ok(MatchCache {
        compiled,
        fallback_index,
    })
}

fn compile_match_spec(spec: &MatchSpec) -> Result<CompiledSpec, AppError> {
    let rules = match spec {
        MatchSpec::One(rule) => vec![compile_rule(rule)?],
        MatchSpec::Many(rules) => {
            let mut out = Vec::with_capacity(rules.len());
            for rule in rules {
                out.push(compile_rule(rule)?);
            }
            out
        }
    };
    Ok(CompiledSpec { rules })
}

fn compile_rule(rule: &MatchRule) -> Result<CompiledRule, AppError> {
    match rule {
        MatchRule::Plain(s) => Ok(CompiledRule::Plain(s.clone())),
        MatchRule::Regex { regex } => {
            let (pattern, flag_i) = parse_regex_literal(regex)
                .map_err(|e| AppError::internal(format!("invalid regex literal: {e}")))?;
            let mut builder = regex::RegexBuilder::new(pattern);
            if flag_i {
                builder.case_insensitive(true);
            }
            let compiled = builder
                .build()
                .map_err(|e| AppError::internal(format!("regex compile failed: {e}")))?;
            Ok(CompiledRule::Regex(compiled))
        }
    }
}

fn parse_regex_literal(source: &str) -> Result<(&str, bool), &'static str> {
    if !source.starts_with('/') {
        return Err("regex must be in /pattern/flags form");
    }
    let mut last = None;
    let mut escaped = false;
    for (i, ch) in source.char_indices().skip(1) {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '/' {
            last = Some(i);
        }
    }
    let end = last.ok_or("missing closing /")?;
    let pattern = &source[1..end];
    let flags = &source[end + 1..];
    let mut flag_i = false;
    for ch in flags.chars() {
        match ch {
            'i' => flag_i = true,
            ' ' | '\t' => {}
            _ => return Err("unsupported regex flags"),
        }
    }
    Ok((pattern, flag_i))
}
