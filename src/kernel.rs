use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use regex::Regex;
use tracing::info;

use crate::config::{
    AliasConfig,
    CaseSensitivity,
    Condition,
    GlobalConfig,
    LoadedModel,
    ModelCatalog,
    ModelKind,
    RuleWhen,
    StaticConfig,
};
use crate::config::load_app_config;
use crate::error::AppError;
use crate::scripting::{ScriptEngineHandle, start_engine};

pub struct KernelState {
    pub config: GlobalConfig,
    pub catalog: ModelCatalog,
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
        let (global, catalog, models) = load_app_config(config_dir)
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
                ModelKind::Interactive => {}
            }

            model_map.insert(model.config.id.clone(), model);
        }

        let mut aliases = HashMap::new();
        for alias in &catalog.aliases {
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
            catalog,
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
    pub compiled: Vec<Option<CompiledWhen>>,
    pub default_index: Option<usize>,
}

pub struct CompiledWhen {
    pub any: Vec<CompiledCondition>,
    pub all: Vec<CompiledCondition>,
    pub none: Vec<CompiledCondition>,
}

pub enum CompiledCondition {
    Contains(String, CaseSensitivity),
    Equals(String, CaseSensitivity),
    StartsWith(String, CaseSensitivity),
    EndsWith(String, CaseSensitivity),
    Regex(Regex),
}

fn build_match_cache(cfg: &StaticConfig) -> Result<MatchCache, AppError> {
    let mut compiled = Vec::with_capacity(cfg.rules.len());
    let mut default_index = None;
    for (idx, rule) in cfg.rules.iter().enumerate() {
        match &rule.when {
            Some(when) => {
                let compiled_when = compile_when(when)?;
                compiled.push(Some(compiled_when));
            }
            None => {
                if rule.default && default_index.is_none() {
                    default_index = Some(idx);
                }
                compiled.push(None);
            }
        }
    }
    Ok(MatchCache {
        compiled,
        default_index,
    })
}

fn compile_when(when: &RuleWhen) -> Result<CompiledWhen, AppError> {
    let mut any = Vec::with_capacity(when.any.len());
    let mut all = Vec::with_capacity(when.all.len());
    let mut none = Vec::with_capacity(when.none.len());
    for cond in &when.any {
        any.push(compile_condition(cond)?);
    }
    for cond in &when.all {
        all.push(compile_condition(cond)?);
    }
    for cond in &when.none {
        none.push(compile_condition(cond)?);
    }
    Ok(CompiledWhen { any, all, none })
}

fn compile_condition(cond: &Condition) -> Result<CompiledCondition, AppError> {
    Ok(match cond {
        Condition::Contains { contains, case } => {
            CompiledCondition::Contains(contains.clone(), case.unwrap_or(CaseSensitivity::Sensitive))
        }
        Condition::Equals { equals, case } => {
            CompiledCondition::Equals(equals.clone(), case.unwrap_or(CaseSensitivity::Sensitive))
        }
        Condition::StartsWith { starts_with, case } => CompiledCondition::StartsWith(
            starts_with.clone(),
            case.unwrap_or(CaseSensitivity::Sensitive),
        ),
        Condition::EndsWith { ends_with, case } => CompiledCondition::EndsWith(
            ends_with.clone(),
            case.unwrap_or(CaseSensitivity::Sensitive),
        ),
        Condition::Regex { regex } => {
            let (pattern, flag_i) = parse_regex_literal(regex)
                .map_err(|e| AppError::internal(format!("invalid regex literal: {e}")))?;
            let mut builder = regex::RegexBuilder::new(pattern);
            if flag_i {
                builder.case_insensitive(true);
            }
            let compiled = builder
                .build()
                .map_err(|e| AppError::internal(format!("regex compile failed: {e}")))?;
            CompiledCondition::Regex(compiled)
        }
    })
}

pub fn compiled_matches(when: &CompiledWhen, text: &str) -> bool {
    let lower = text.to_lowercase();
    let any_ok = if when.any.is_empty() {
        true
    } else {
        when.any
            .iter()
            .any(|cond| condition_matches(cond, text, &lower))
    };
    let all_ok = when
        .all
        .iter()
        .all(|cond| condition_matches(cond, text, &lower));
    let none_ok = when
        .none
        .iter()
        .all(|cond| !condition_matches(cond, text, &lower));
    any_ok && all_ok && none_ok
}

fn condition_matches(cond: &CompiledCondition, text: &str, lower: &str) -> bool {
    match cond {
        CompiledCondition::Contains(needle, case) => match case {
            CaseSensitivity::Sensitive => text.contains(needle),
            CaseSensitivity::Insensitive => lower.contains(&needle.to_lowercase()),
        },
        CompiledCondition::Equals(value, case) => match case {
            CaseSensitivity::Sensitive => text == value,
            CaseSensitivity::Insensitive => lower == value.to_lowercase(),
        },
        CompiledCondition::StartsWith(value, case) => match case {
            CaseSensitivity::Sensitive => text.starts_with(value),
            CaseSensitivity::Insensitive => lower.starts_with(&value.to_lowercase()),
        },
        CompiledCondition::EndsWith(value, case) => match case {
            CaseSensitivity::Sensitive => text.ends_with(value),
            CaseSensitivity::Insensitive => lower.ends_with(&value.to_lowercase()),
        },
        CompiledCondition::Regex(re) => re.is_match(text),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ModelRule, PickStrategy, StaticReply};

    #[test]
    fn when_logic_any_all_none() {
        let when = RuleWhen {
            any: vec![Condition::Contains {
                contains: "hello".to_string(),
                case: None,
            }],
            all: vec![Condition::Contains {
                contains: "world".to_string(),
                case: None,
            }],
            none: vec![Condition::Contains {
                contains: "blocked".to_string(),
                case: None,
            }],
        };
        let compiled = compile_when(&when).expect("compile when");
        assert!(compiled_matches(&compiled, "hello world"));
        assert!(!compiled_matches(&compiled, "hello blocked"));
    }

    #[test]
    fn weighted_pick_defaults_to_one() {
        let cfg = StaticConfig {
            pick: Some(PickStrategy::Weighted),
            stream_chunk_chars: None,
            rules: vec![ModelRule {
                default: true,
                when: None,
                pick: None,
                replies: vec![
                    StaticReply {
                        content: "a".to_string(),
                        reasoning: None,
                        weight: Some(5),
                    },
                    StaticReply {
                        content: "b".to_string(),
                        reasoning: None,
                        weight: None,
                    },
                ],
            }],
        };

        let cache = build_match_cache(&cfg).expect("cache");
        assert_eq!(cache.default_index, Some(0));
    }
}
