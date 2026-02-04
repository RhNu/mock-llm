mod config;
mod error;
mod handlers;
mod init;
mod scripting;
mod state;
mod streaming;
mod types;

use std::net::SocketAddr;
use std::path::PathBuf;

use axum::Router;
use clap::Parser;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::config::load_app_config;
use crate::handlers::{chat_completions, list_models, get_model};
use crate::init::ensure_config_layout;
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
    let (global, models) = load_app_config(&cli.config_dir)?;
    let state = AppState::new(global, models)
        .map_err(|e| anyhow::anyhow!("state init failed: {e:?}"))?;

    let addr: SocketAddr = state
        .config
        .server
        .listen
        .parse()
        .map_err(|e| anyhow::anyhow!("invalid listen addr: {e}"))?;

    let app = Router::new()
        .route("/v1/chat/completions", axum::routing::post(chat_completions))
        .route("/v1/models", axum::routing::get(list_models))
        .route("/v1/models/:id", axum::routing::get(get_model))
        .with_state(state.clone())
        .layer(TraceLayer::new_for_http());

    tracing::info!("listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
