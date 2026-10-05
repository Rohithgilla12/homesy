pub mod activity;
pub mod attachments;
pub mod auth;
pub mod config;
pub mod error;
pub mod models;
pub mod routes;
pub mod state;
pub mod storage;

use axum::{
    extract::State,
    http::{header, HeaderValue, Method},
    routing::get,
    Router,
};
use error::{AppError, AppResult};
use std::time::Duration;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};

/// Builds the router. `cors_origins` comes from `CORS_ORIGINS`; `None` allows any origin (local development).
pub fn create_app(state: state::AppState, cors_origins: Option<&[String]>) -> Router {
    Router::new()
        .route("/health", get(health))
        .merge(routes::attachments::router())
        .merge(routes::auth::router())
        .merge(routes::homes::router())
        .merge(routes::lists::router())
        .merge(routes::vault::router())
        .merge(routes::bulletin::router())
        .merge(routes::bills::router())
        .layer(cors_layer(cors_origins))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// Liveness plus a DB ping, bounded so a hung database fails fast instead of waiting out the pool timeout.
async fn health(State(s): State<state::AppState>) -> AppResult<&'static str> {
    match tokio::time::timeout(
        Duration::from_secs(2),
        sqlx::query("select 1").execute(&s.pool),
    )
    .await
    {
        Ok(Ok(_)) => Ok("ok"),
        Ok(Err(e)) => {
            tracing::warn!(error = %e, "health check: database unavailable");
            Err(AppError::Unavailable)
        }
        Err(_) => {
            tracing::warn!("health check: database ping timed out");
            Err(AppError::Unavailable)
        }
    }
}

fn cors_layer(origins: Option<&[String]>) -> CorsLayer {
    let Some(origins) = origins else {
        return CorsLayer::permissive();
    };
    let origins = origins
        .iter()
        .map(|o| HeaderValue::from_str(o).expect("origins are validated by config::parse_origins"));
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        // The web SSE client sends Cache-Control, which is not CORS-safelisted.
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::CACHE_CONTROL,
        ])
}
