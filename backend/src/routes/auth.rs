use crate::{
    auth::{hash_password, issue_token, verify_password, AuthUser},
    error::{AppError, AppResult},
    models::User,
    state::AppState,
};
use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/signup", post(signup))
        .route("/auth/login", post(login))
        .route("/me", get(me).patch(update_me))
}

#[derive(Deserialize)]
struct SignupBody {
    email: String,
    password: String,
    display_name: String,
}

#[derive(Deserialize)]
struct LoginBody {
    email: String,
    password: String,
}

#[derive(Serialize)]
struct AuthResponse {
    token: String,
    user: User,
}

const USER_COLS: &str = "id, email, display_name, created_at, avatar_id";

async fn signup(
    State(s): State<AppState>,
    Json(b): Json<SignupBody>,
) -> AppResult<Json<AuthResponse>> {
    let email = b.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err(AppError::BadRequest("invalid email".into()));
    }
    if b.password.len() < 8 {
        return Err(AppError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }
    let name = b.display_name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("display_name required".into()));
    }

    let hash = hash_password(&b.password)?;
    let id = Uuid::now_v7();
    let user: User = sqlx::query_as(&format!(
        "insert into users (id, email, password_hash, display_name) values ($1, $2, $3, $4) returning {USER_COLS}"
    ))
    .bind(id)
    .bind(&email)
    .bind(&hash)
    .bind(name)
    .fetch_one(&s.pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(d) = &e {
            if d.is_unique_violation() {
                return AppError::Conflict("email already registered".into());
            }
        }
        AppError::from(e)
    })?;

    let token = issue_token(&s.jwt_secret, user.id)?;
    Ok(Json(AuthResponse { token, user }))
}

async fn login(
    State(s): State<AppState>,
    Json(b): Json<LoginBody>,
) -> AppResult<Json<AuthResponse>> {
    let email = b.email.trim().to_lowercase();
    let row: Option<(Uuid, String)> =
        sqlx::query_as("select id, password_hash from users where email = $1")
            .bind(&email)
            .fetch_optional(&s.pool)
            .await?;

    let (id, hash) = row.ok_or(AppError::Unauthorized)?;
    if !verify_password(&b.password, &hash) {
        return Err(AppError::Unauthorized);
    }
    let user: User = sqlx::query_as(&format!("select {USER_COLS} from users where id = $1"))
        .bind(id)
        .fetch_one(&s.pool)
        .await?;
    let token = issue_token(&s.jwt_secret, id)?;
    Ok(Json(AuthResponse { token, user }))
}

async fn me(State(s): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<User>> {
    let user: User = sqlx::query_as(&format!("select {USER_COLS} from users where id = $1"))
        .bind(uid)
        .fetch_one(&s.pool)
        .await?;
    Ok(Json(decorate_user(&s, user).await?))
}

/// Embeds the presigned avatar URL; a no-op when storage is off.
pub async fn decorate_user(s: &AppState, mut user: User) -> AppResult<User> {
    if let Some(id) = user.avatar_id {
        let outs = crate::attachments::outs_for(&s.pool, s.storage.as_deref(), &[id]).await?;
        user.avatar = outs.get(&id).cloned();
    }
    Ok(user)
}

#[derive(Deserialize)]
struct UpdateMe {
    display_name: Option<String>,
    /// Absent keeps the avatar, `null` clears it, an id replaces it.
    #[serde(default, deserialize_with = "crate::attachments::double_option")]
    avatar_id: Option<Option<Uuid>>,
}

async fn update_me(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(b): Json<UpdateMe>,
) -> AppResult<Json<User>> {
    let current: User = sqlx::query_as(&format!("select {USER_COLS} from users where id = $1"))
        .bind(uid)
        .fetch_one(&s.pool)
        .await?;
    let name = match b.display_name {
        Some(n) if !n.trim().is_empty() => n.trim().to_string(),
        _ => current.display_name.clone(),
    };
    let avatar_id = match b.avatar_id {
        Some(Some(id)) => {
            let a = crate::attachments::load_ready(&s.pool, id).await?;
            if a.uploaded_by != uid || a.kind != "avatar" {
                return Err(AppError::BadRequest("not your avatar".into()));
            }
            Some(id)
        }
        Some(None) => None,
        None => current.avatar_id,
    };
    let user: User = sqlx::query_as(&format!(
        "update users set display_name = $1, avatar_id = $2 where id = $3 returning {USER_COLS}"
    ))
    .bind(&name)
    .bind(avatar_id)
    .bind(uid)
    .fetch_one(&s.pool)
    .await?;
    if let Some(old) = current.avatar_id.filter(|old| Some(*old) != avatar_id) {
        crate::routes::attachments::delete_many(&s, &[old]).await?;
    }
    let homes: Vec<(Uuid,)> = sqlx::query_as("select home_id from home_members where user_id = $1")
        .bind(uid)
        .fetch_all(&s.pool)
        .await?;
    for (home_id,) in homes {
        s.broadcast(crate::models::HomeEvent {
            home_id,
            event_type: "member_updated".into(),
            payload: serde_json::json!({ "user_id": uid }),
        });
    }
    Ok(Json(decorate_user(&s, user).await?))
}
