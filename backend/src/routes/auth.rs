use crate::{
    auth::{hash_password, issue_token, verify_password, AuthUser},
    error::{AppError, AppResult},
    models::User,
    state::AppState,
};
use axum::{extract::State, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/signup", post(signup))
        .route("/auth/login", post(login))
        .route("/me", get(me))
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

const USER_COLS: &str = "id, email, display_name, created_at";

async fn signup(State(s): State<AppState>, Json(b): Json<SignupBody>) -> AppResult<Json<AuthResponse>> {
    let email = b.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err(AppError::BadRequest("invalid email".into()));
    }
    if b.password.len() < 8 {
        return Err(AppError::BadRequest("password must be at least 8 characters".into()));
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

async fn login(State(s): State<AppState>, Json(b): Json<LoginBody>) -> AppResult<Json<AuthResponse>> {
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
    Ok(Json(user))
}
