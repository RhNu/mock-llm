mod admin;
mod config;
mod error;
mod handlers;
mod init;
mod interactive;
mod kernel;
mod scripting;
mod state;
mod streaming;
mod types;
mod ui;

use std::net::SocketAddr;
use std::path::PathBuf;

use axum::Router;
use clap::Parser;
use axum::http::{HeaderName, Request, Response};
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::admin::{
    admin_auth_status,
    delete_script as admin_delete_script,
    get_config as admin_get_config,
    get_models_bundle as admin_get_models_bundle,
    get_script as admin_get_script,
    list_scripts as admin_list_scripts,
    list_interactive_requests as admin_list_interactive_requests,
    patch_config as admin_patch_config,
    put_config as admin_put_config,
    put_models_bundle as admin_put_models_bundle,
    put_script as admin_put_script,
    reload,
    reply_interactive_request as admin_reply_interactive_request,
    status,
    stream_interactive as admin_stream_interactive,
};
use crate::handlers::{chat_completions, get_model, list_models};
use crate::init::ensure_config_layout;
use crate::interactive::InteractiveHub;
use crate::kernel::KernelHandle;
use crate::state::AppState;

#[derive(Parser, Debug)]
#[command(version, about = "Mock LLM (OpenAI-compatible)")]
struct Cli {
    #[arg(long, default_value = "./config")]
    config_dir: PathBuf,
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("mock_llm=info".parse()?))
        .init();

    let cli = Cli::parse();
    ensure_config_layout(&cli.config_dir)?;
    let kernel = KernelHandle::new(cli.config_dir.clone())
        .map_err(|e| anyhow::anyhow!("kernel init failed: {e:?}"))?;
    let interactive = std::sync::Arc::new(InteractiveHub::new());
    let state = AppState::new(kernel, interactive);

    let addr: SocketAddr = state
        .kernel
        .current()
        .config
        .server
        .listen
        .parse()
        .map_err(|e| anyhow::anyhow!("invalid listen addr: {e}"))?;

    let request_id_header = HeaderName::from_static("x-request-id");
    let trace_request_id_header = request_id_header.clone();
    let trace_layer = TraceLayer::new_for_http()
        .make_span_with(move |request: &Request<_>| {
            let request_id = request
                .headers()
                .get(&trace_request_id_header)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("-");
            tracing::info_span!(
                "http",
                method = %request.method(),
                uri = %request.uri(),
                request_id = %request_id
            )
        })
        .on_response(|response: &Response<_>, latency: std::time::Duration, span: &tracing::Span| {
            tracing::info!(
                parent: span,
                status = %response.status(),
                latency_ms = latency.as_millis(),
                "request completed"
            );
        });

    let app = Router::new()
        .route("/v0/admin/auth", axum::routing::get(admin_auth_status))
        .route("/v0/status", axum::routing::get(status))
        .route("/v0/reload", axum::routing::post(reload))
        .route(
            "/v0/config",
            axum::routing::get(admin_get_config)
                .put(admin_put_config)
                .patch(admin_patch_config),
        )
        .route(
            "/v0/models",
            axum::routing::get(admin_get_models_bundle).put(admin_put_models_bundle),
        )
        .route("/v0/scripts", axum::routing::get(admin_list_scripts))
        .route(
            "/v0/scripts/{name}",
            axum::routing::get(admin_get_script)
                .put(admin_put_script)
                .delete(admin_delete_script),
        )
        .route(
            "/v0/interactive/requests",
            axum::routing::get(admin_list_interactive_requests),
        )
        .route(
            "/v0/interactive/requests/{id}/reply",
            axum::routing::post(admin_reply_interactive_request),
        )
        .route(
            "/v0/interactive/stream",
            axum::routing::get(admin_stream_interactive),
        )
        .route("/v1/chat/completions", axum::routing::post(chat_completions))
        .route("/v1/models", axum::routing::get(list_models))
        .route("/v1/models/{id}", axum::routing::get(get_model))
        .merge(ui::router())
        .with_state(state.clone())
        .layer(trace_layer)
        .layer(PropagateRequestIdLayer::new(request_id_header.clone()))
        .layer(SetRequestIdLayer::new(request_id_header, MakeRequestUuid));

    tracing::info!("listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
