use axum::body::Body;
use axum::extract::Path;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use include_dir::{include_dir, Dir};

const UI_DIR: Dir = include_dir!("$OUT_DIR/ui-dist");

pub fn router<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/", get(index))
        .route("/assets/{*path}", get(assets))
        .route("/{*path}", get(spa_fallback))
}

async fn index() -> Response {
    serve_index()
}

async fn spa_fallback() -> Response {
    serve_index()
}

async fn assets(Path(path): Path<String>) -> Response {
    if path.is_empty() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if path.contains("..") || path.contains('\\') {
        return StatusCode::NOT_FOUND.into_response();
    }
    let full_path = format!("assets/{}", path);
    serve_file(&full_path, CachePolicy::Long)
}

fn serve_index() -> Response {
    serve_file("index.html", CachePolicy::NoCache)
}

fn serve_file(path: &str, cache: CachePolicy) -> Response {
    let Some(file) = UI_DIR.get_file(path) else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = Response::new(Body::from(file.contents()));
    *response.status_mut() = StatusCode::OK;

    let headers = response.headers_mut();
    let content_type = HeaderValue::from_str(mime.as_ref())
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));
    headers.insert(header::CONTENT_TYPE, content_type);

    match cache {
        CachePolicy::NoCache => {
            headers.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("no-cache"),
            );
        }
        CachePolicy::Long => {
            headers.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=31536000, immutable"),
            );
        }
    }

    response
}

enum CachePolicy {
    NoCache,
    Long,
}
