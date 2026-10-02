use crate::{models::Activity, state::AppState};
use uuid::Uuid;

pub async fn log_activity(
    state: &AppState,
    home_id: Uuid,
    actor_id: Uuid,
    action: &str,
    resource_type: &str,
    description: &str,
) {
    let activity_id = Uuid::now_v7();
    let res: Result<Activity, sqlx::Error> = sqlx::query_as(
        "insert into activities (id, home_id, actor_id, action, resource_type, description)
         values ($1, $2, $3, $4, $5, $6)
         returning id, home_id, actor_id, action, resource_type, description, created_at",
    )
    .bind(activity_id)
    .bind(home_id)
    .bind(actor_id)
    .bind(action)
    .bind(resource_type)
    .bind(description)
    .fetch_one(&state.pool)
    .await;

    match res {
        Ok(activity) => {
            state.broadcast(crate::models::HomeEvent {
                home_id,
                event_type: "activity_created".into(),
                payload: serde_json::to_value(&activity).unwrap_or_default(),
            });
        }
        Err(e) => {
            tracing::warn!(error = %e, "failed to record activity log");
        }
    }
}
