use crate::models::HomeEvent;
use sqlx::PgPool;
use std::sync::Arc;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub jwt_secret: Arc<String>,
    pub events_tx: broadcast::Sender<HomeEvent>,
}

impl AppState {
    pub fn new(pool: PgPool, jwt_secret: String) -> Self {
        let (events_tx, _) = broadcast::channel(1024);
        Self {
            pool,
            jwt_secret: Arc::new(jwt_secret),
            events_tx,
        }
    }

    pub fn broadcast(&self, event: HomeEvent) {
        // Errors occur if there are no active receivers, which is normal.
        let _ = self.events_tx.send(event);
    }
}
