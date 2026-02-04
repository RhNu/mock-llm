use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::config::{AliasConfig, GlobalConfig, LoadedModel, MatchRule, MatchSpec, ModelKind};
use crate::error::AppError;
use crate::scripting::{ScriptEngineHandle, start_engine};
use regex::Regex;

#[derive(Clone)]
pub struct AppState {
    pub config: GlobalConfig,
    pub models: Arc<HashMap<String, LoadedModel>>,
    pub rr_state: Arc<Mutex<HashMap<String, usize>>>,
    pub engines: Arc<HashMap<String, ScriptEngineHandle>>,
    pub match_cache: Arc<HashMap<String, MatchCache>>,
    pub aliases: Arc<HashMap<String, AliasConfig>>,
    pub alias_rr: Arc<Mutex<HashMap<String, usize>>>,
}

impl AppState {
    pub fn new(global: GlobalConfig, models: Vec<LoadedModel>) -> Result<Self, AppError> {
        let mut map = HashMap::new();
        let mut engines = HashMap::new();
        let mut match_cache = HashMap::new();
        let mut aliases = HashMap::new();
        for model in models {
            if matches!(model.config.kind, ModelKind::Script) {
                let cfg = model
                    .config
                    .script
                    .as_ref()
                    .ok_or_else(|| AppError::internal("script config missing"))?;
                let init_path = cfg.init_file.as_ref().map(|f| model.base_dir.join(f));
                let engine =
                    start_engine(model.base_dir.join(&cfg.file), init_path, cfg.timeout_ms)?;
                engines.insert(model.config.id.clone(), engine);
            }
            if matches!(model.config.kind, ModelKind::Static) {
                if let Some(cfg) = model.config.r#static.as_ref() {
                    let cache = build_match_cache(cfg)?;
                    match_cache.insert(model.config.id.clone(), cache);
                }
            }
            map.insert(model.config.id.clone(), model);
        }
        for alias in &global.routing.aliases {
            aliases.insert(alias.name.clone(), alias.clone());
        }
        Ok(AppState {
            config: global,
            models: Arc::new(map),
            rr_state: Arc::new(Mutex::new(HashMap::new())),
            engines: Arc::new(engines),
            match_cache: Arc::new(match_cache),
            aliases: Arc::new(aliases),
            alias_rr: Arc::new(Mutex::new(HashMap::new())),
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
