pub mod activity;
pub mod auth;
pub mod config;
pub mod error;
pub mod models;
pub mod routes;
pub mod state;

use axum::{
    http::{header, HeaderValue, Method},
    routing::get,
    Router,
};
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};

/// Builds the router. `cors_origins` comes from `CORS_ORIGINS`; `None` allows any origin (local development).
pub fn create_app(state: state::AppState, cors_origins: Option<&[String]>) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
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
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
}
