//! JWT issue/verify, password hashing, and the `AuthUser` extractor.

use crate::{error::AppError, state::AppState};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{extract::FromRequestParts, http::request::Parts};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: Uuid,
    exp: usize,
    iat: usize,
}

pub fn issue_token(secret: &str, user_id: Uuid) -> anyhow::Result<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        iat: now.timestamp() as usize,
        exp: (now + Duration::days(30)).timestamp() as usize,
    };
    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

pub(crate) fn verify_token(secret: &str, token: &str) -> Option<Uuid> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .ok()
    .map(|d| d.claims.sub)
}

pub fn hash_password(pw: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(pw.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!(e))?
        .to_string())
}

pub fn verify_password(pw: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|h| Argon2::default().verify_password(pw.as_bytes(), &h).is_ok())
        .unwrap_or(false)
}

/// Extracts the authenticated user id from `Authorization: Bearer <jwt>`.
#[derive(Debug, Clone, Copy)]
pub struct AuthUser(pub Uuid);

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(AppError::Unauthorized)?;
        let token = header
            .strip_prefix("Bearer ")
            .ok_or(AppError::Unauthorized)?;
        verify_token(&state.jwt_secret, token)
            .map(AuthUser)
            .ok_or(AppError::Unauthorized)
    }
}

/// Fails with 403 unless `user_id` is a member of `home_id`.
pub async fn ensure_member(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    home_id: Uuid,
) -> Result<(), AppError> {
    let exists: Option<(i32,)> =
        sqlx::query_as("select 1 from home_members where home_id = $1 and user_id = $2")
            .bind(home_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    exists.map(|_| ()).ok_or(AppError::Forbidden)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_password_hashing_and_verification() {
        let password = "mysecretpassword123";
        let hash = hash_password(password).expect("hashing should succeed");
        assert!(verify_password(password, &hash));
        assert!(!verify_password("wrongpassword", &hash));
    }

    #[test]
    fn test_jwt_issuance_and_verification() {
        let secret = "super-secret-key-for-testing-12345";
        let user_id = Uuid::now_v7();

        let token = issue_token(secret, user_id).expect("issuing token should succeed");
        let decoded = verify_token(secret, &token);
        assert_eq!(decoded, Some(user_id));

        // Wrong secret should fail
        let wrong_decoded = verify_token("wrong-secret-key-for-testing", &token);
        assert_eq!(wrong_decoded, None);

        // Invalid token format
        let invalid = verify_token(secret, "invalid.token.payload");
        assert_eq!(invalid, None);
    }
}
