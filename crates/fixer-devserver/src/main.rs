//! HTTP bridge exposing the exact same `fixer_core::dispatch` used by the Tauri app,
//! so the real frontend can be driven by Playwright in a headless browser.
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use std::{collections::HashMap, sync::Arc};

async fn call(
    State(core): State<Arc<fixer_core::Core>>,
    Path(cmd): Path<String>,
    Query(q): Query<HashMap<String, String>>,
    body: Bytes,
) -> Response {
    let res = tokio::task::spawn_blocking(move || {
        let (args, raw): (serde_json::Value, Option<Vec<u8>>) = if let Some(a) = q.get("args") {
            (serde_json::from_str(a).unwrap_or_default(), Some(body.to_vec()))
        } else {
            (serde_json::from_slice(&body).unwrap_or_default(), None)
        };
        fixer_core::dispatch(&core, &cmd, &args, raw.as_deref())
    })
    .await
    .unwrap();
    match res {
        Ok(fixer_core::Reply::Json(v)) => ([(header::CONTENT_TYPE, "application/json")], v.to_string()).into_response(),
        Ok(fixer_core::Reply::Bytes(b)) => ([(header::CONTENT_TYPE, "application/octet-stream")], b).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}")).into_response(),
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let port: u16 = std::env::var("FFL_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(1421);
    let cache = std::env::var("FFL_CACHE").unwrap_or_else(|_| std::env::temp_dir().join("fixer-film-lab-cache").to_string_lossy().into());
    let core = Arc::new(fixer_core::Core::new(cache.into()));
    let mut app = Router::new().route("/api/{cmd}", post(call)).with_state(core);
    if let Ok(dist) = std::env::var("FFL_DIST") {
        app = app.fallback_service(tower_http::services::ServeDir::new(dist));
    }
    let app = app.layer(axum::extract::DefaultBodyLimit::max(2 << 30));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    println!("fixer devserver on http://127.0.0.1:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}
