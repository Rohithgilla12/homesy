pub mod activity;
pub mod auth;
pub mod config;
pub mod error;
pub mod models;
pub mod routes;
pub mod state;

use axum::{routing::get, Router};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

pub fn create_app(state: state::AppState) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .merge(routes::auth::router())
        .merge(routes::homes::router())
        .merge(routes::lists::router())
        .merge(routes::vault::router())
        .merge(routes::bulletin::router())
        .merge(routes::bills::router())
        .layer(CorsLayer::permissive()) // tighten before prod
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
