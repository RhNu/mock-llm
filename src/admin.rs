use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::config::{AdminAuthConfig, GlobalConfig, ModelConfig, ResponseConfig, RoutingConfig, validate_model_config};
use crate::error::AppError;
use crate::kernel::KernelState;
use crate::state::AppState;

pub async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    check_admin_auth(&kernel.config.server.admin_auth, &headers)?;
    let body = build_status(&kernel, state.started_at);
    Ok(Json(body).into_response())
}

pub async fn reload(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    check_admin_auth(&kernel.config.server.admin_auth, &headers)?;

    let start = Instant::now();
    match state.kernel.reload() {
        Ok(outcome) => {
            if outcome.reloaded {
                tracing::info!("reload ok: took_ms={}", start.elapsed().as_millis());
            } else {
                tracing::info!("reload debounced: took_ms={}", start.elapsed().as_millis());
            }
            let mut body = build_status(&outcome.state, state.started_at);
            body["reloaded"] = json!(outcome.reloaded);
            Ok(Json(body).into_response())
        }
        Err(err) => {
            tracing::error!("reload failed: took_ms={}, err={:?}", start.elapsed().as_millis(), err);
            Err(err)
        }
    }
}

pub async fn get_config(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    check_admin_auth(&kernel.config.server.admin_auth, &headers)?;
    let body = PublicConfig::from_global(&kernel.config);
    Ok(Json(body).into_response())
}

pub async fn put_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PublicConfig>,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    check_admin_auth(&kernel.config.server.admin_auth, &headers)?;
    let mut config = read_config(&kernel.config_path)?;
    payload.apply_to(&mut config);
    write_config(&kernel.config_path, &config)?;
    Ok(Json(PublicConfig::from_global(&config)).into_response())
}

pub async fn patch_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(raw): Json<Value>,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    check_admin_auth(&kernel.config.server.admin_auth, &headers)?;
    if raw.get("server").is_some() {
        return Err(AppError::bad_request("server config is not editable via /v0"));
    }
    let patch: ConfigPatch = serde_json::from_value(raw)
        .map_err(|_| AppError::bad_request("invalid config patch"))?;
    let mut config = read_config(&kernel.config_path)?;
    patch.apply_to(&mut config);
    write_config(&kernel.config_path, &config)?;
    Ok(Json(PublicConfig::from_global(&config)).into_response())
}

pub async fn list_models(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    check_admin_auth(&kernel.config.server.admin_auth, &headers)?;
    let disk_config = read_config(&kernel.config_path)?;
    let dir = models_dir_from_config(&kernel, &disk_config);
    let mut models = Vec::new();
    for path in list_yaml_files(&dir)? {
        let text = fs::read_to_string(&path)
            .map_err(|e| AppError::internal(format!("read model failed: {e}")))?;
        let model: ModelConfig = serde_yaml_ng::from_str(&text)
            .map_err(|e| AppError::bad_request(format!("invalid model yaml: {e}")))?;
        models.push(model);
    }
    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(Json(json!({ "data": models })).into_response())
}

pub async fn get_model(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    check_admin_auth(&kernel.config.server.admin_auth, &headers)?;
    ensure_simple_name(&id)?;
    let disk_config = read_config(&kernel.config_path)?;
    let dir = models_dir_from_config(&kernel, &disk_config);
    let path = model_path_from_dir(&dir, &id);
    let text = fs::read_to_string(&path)
        .map_err(|e| AppError::internal(format!("read model failed: {e}")))?;
    let model: ModelConfig = serde_yaml_ng::from_str(&text)
        .map_err(|e| AppError::bad_request(format!("invalid model yaml: {e}")))?;
    Ok(Json(model).into_response())
}

pub async fn put_model(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(model): Json<ModelConfig>,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    check_admin_auth(&kernel.config.server.admin_auth, &headers)?;
    ensure_simple_name(&id)?;
    if !model.id.is_empty() && model.id != id {
        return Err(AppError::bad_request("model.id must match path id"));
    }

    let mut model = model;
    model.id = id.clone();

    let disk_config = read_config(&kernel.config_path)?;
    let dir = models_dir_from_config(&kernel, &disk_config);
    let scripts_dir = scripts_dir(&kernel);
    validate_model_config(&model, &scripts_dir, &model_path_from_dir(&dir, &id))
        .map_err(|e| AppError::bad_request(format!("invalid model: {e}")))?;

    let yaml = serde_yaml_ng::to_string(&model)
        .map_err(|e| AppError::internal(format!("serialize model failed: {e}")))?;
    let path = model_path_from_dir(&dir, &id);
    ensure_dir(path.parent())?;
    fs::write(&path, yaml).map_err(|e| AppError::internal(format!("write model failed: {e}")))?;
    Ok(Json(model).into_response())
}

pub async fn delete_model(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    check_admin_auth(&kernel.config.server.admin_auth, &headers)?;
    ensure_simple_name(&id)?;
    let disk_config = read_config(&kernel.config_path)?;
    let dir = models_dir_from_config(&kernel, &disk_config);
    let path = model_path_from_dir(&dir, &id);
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| AppError::internal(format!("delete model failed: {e}")))?;
    }
    Ok(Json(json!({ "ok": true })).into_response())
}

pub async fn list_scripts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    check_admin_auth(&kernel.config.server.admin_auth, &headers)?;
    let dir = scripts_dir(&kernel);
    let mut names = Vec::new();
    if dir.exists() {
        for entry in fs::read_dir(&dir)
            .map_err(|e| AppError::internal(format!("read scripts dir failed: {e}")))? {
            let entry = entry.map_err(|e| AppError::internal(format!("read scripts dir failed: {e}")))?;
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                    names.push(name.to_string());
                }
            }
        }
    }
    names.sort();
    Ok(Json(json!({ "files": names })).into_response())
}

pub async fn get_script(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(name): axum::extract::Path<String>,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    check_admin_auth(&kernel.config.server.admin_auth, &headers)?;
    ensure_simple_name(&name)?;
    let path = script_path(&kernel, &name);
    let content = fs::read_to_string(&path)
        .map_err(|e| AppError::internal(format!("read script failed: {e}")))?;
    Ok(Json(json!({ "name": name, "content": content })).into_response())
}

pub async fn put_script(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(name): axum::extract::Path<String>,
    Json(payload): Json<ScriptUpdate>,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    check_admin_auth(&kernel.config.server.admin_auth, &headers)?;
    ensure_simple_name(&name)?;
    let path = script_path(&kernel, &name);
    ensure_dir(path.parent())?;
    fs::write(&path, payload.content)
        .map_err(|e| AppError::internal(format!("write script failed: {e}")))?;
    Ok(Json(json!({ "ok": true })).into_response())
}

pub async fn delete_script(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(name): axum::extract::Path<String>,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    check_admin_auth(&kernel.config.server.admin_auth, &headers)?;
    ensure_simple_name(&name)?;
    let path = script_path(&kernel, &name);
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| AppError::internal(format!("delete script failed: {e}")))?;
    }
    Ok(Json(json!({ "ok": true })).into_response())
}

fn build_status(kernel: &KernelState, started_at: Instant) -> Value {
    let uptime_sec = started_at.elapsed().as_secs();

    let mut model_ids: Vec<String> = kernel.models.keys().cloned().collect();
    model_ids.sort();

    let mut alias_names: Vec<String> = kernel.aliases.keys().cloned().collect();
    alias_names.sort();

    let mtime = fs::metadata(&kernel.config_path)
        .and_then(|meta| meta.modified())
        .ok()
        .map(|ts| DateTime::<Utc>::from(ts).to_rfc3339());

    json!({
        "ok": true,
        "version": env!("CARGO_PKG_VERSION"),
        "uptime_sec": uptime_sec,
        "loaded_at": kernel.loaded_at.to_rfc3339(),
        "config": {
            "dir": kernel.config_dir.to_string_lossy(),
            "path": kernel.config_path.to_string_lossy(),
            "mtime": mtime
        },
        "models": {
            "count": model_ids.len(),
            "ids": model_ids
        },
        "aliases": {
            "count": alias_names.len(),
            "names": alias_names
        }
    })
}

fn check_admin_auth(admin: &AdminAuthConfig, headers: &HeaderMap) -> Result<(), AppError> {
    if !admin.enabled {
        return Ok(());
    }
    let expected = admin.api_key.as_str();
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if auth == format!("Bearer {}", expected) {
        Ok(())
    } else {
        Err(AppError::unauthorized("unauthorized"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicConfig {
    pub response: ResponseConfig,
    #[serde(default)]
    pub routing: RoutingConfig,
    pub models_dir: String,
    pub default_model: Option<String>,
}

impl PublicConfig {
    fn from_global(config: &GlobalConfig) -> Self {
        PublicConfig {
            response: config.response.clone(),
            routing: config.routing.clone(),
            models_dir: config.models_dir.clone(),
            default_model: config.default_model.clone(),
        }
    }

    fn apply_to(&self, config: &mut GlobalConfig) {
        config.response = self.response.clone();
        config.routing = self.routing.clone();
        config.models_dir = self.models_dir.clone();
        config.default_model = self.default_model.clone();
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConfigPatch {
    pub response: Option<ResponseConfig>,
    pub routing: Option<RoutingConfig>,
    pub models_dir: Option<String>,
    pub default_model: Option<Option<String>>,
}

impl ConfigPatch {
    fn apply_to(&self, config: &mut GlobalConfig) {
        if let Some(response) = &self.response {
            config.response = response.clone();
        }
        if let Some(routing) = &self.routing {
            config.routing = routing.clone();
        }
        if let Some(models_dir) = &self.models_dir {
            config.models_dir = models_dir.clone();
        }
        if let Some(default_model) = &self.default_model {
            config.default_model = default_model.clone();
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScriptUpdate {
    pub content: String,
}

fn read_config(path: &Path) -> Result<GlobalConfig, AppError> {
    let text = fs::read_to_string(path)
        .map_err(|e| AppError::internal(format!("read config failed: {e}")))?;
    serde_yaml_ng::from_str(&text)
        .map_err(|e| AppError::internal(format!("invalid config yaml: {e}")))
}

fn write_config(path: &Path, config: &GlobalConfig) -> Result<(), AppError> {
    let yaml = serde_yaml_ng::to_string(config)
        .map_err(|e| AppError::internal(format!("serialize config failed: {e}")))?;
    fs::write(path, yaml)
        .map_err(|e| AppError::internal(format!("write config failed: {e}")))?;
    Ok(())
}

fn models_dir_from_config(kernel: &KernelState, config: &GlobalConfig) -> PathBuf {
    kernel.config_dir.join(&config.models_dir)
}

fn scripts_dir(kernel: &KernelState) -> PathBuf {
    kernel.config_dir.join("scripts")
}

fn model_path_from_dir(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.yaml"))
}

fn script_path(kernel: &KernelState, name: &str) -> PathBuf {
    scripts_dir(kernel).join(name)
}

fn ensure_dir(path: Option<&Path>) -> Result<(), AppError> {
    if let Some(path) = path {
        if !path.exists() {
            fs::create_dir_all(path)
                .map_err(|e| AppError::internal(format!("create dir failed: {e}")))?;
        }
    }
    Ok(())
}

fn list_yaml_files(dir: &Path) -> Result<Vec<PathBuf>, AppError> {
    let mut out = Vec::new();
    if !dir.exists() {
        return Ok(out);
    }
    for entry in fs::read_dir(dir).map_err(|e| AppError::internal(format!("read models dir failed: {e}")))? {
        let entry = entry.map_err(|e| AppError::internal(format!("read models dir failed: {e}")))?;
        let path = entry.path();
        if path.is_dir() {
            return Err(AppError::bad_request(format!(
                "nested model directories not supported: {}",
                path.display()
            )));
        }
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if ext.eq_ignore_ascii_case("yaml") || ext.eq_ignore_ascii_case("yml") {
                out.push(path);
            }
        }
    }
    Ok(out)
}

fn ensure_simple_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::bad_request("name cannot be empty"));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(AppError::bad_request("name must not contain path separators"));
    }
    if name.contains("..") {
        return Err(AppError::bad_request("name must not contain .."));
    }
    Ok(())
}
