use anyhow::{bail, Context};
use axum::http::HeaderValue;

pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub port: u16,
    /// Browser origins allowed by CORS. `None` allows any origin, for local development.
    pub cors_origins: Option<Vec<String>>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL not set")?,
            jwt_secret: std::env::var("JWT_SECRET").context("JWT_SECRET not set")?,
            port: std::env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(8080),
            cors_origins: std::env::var("CORS_ORIGINS")
                .ok()
                .map(|raw| parse_origins(&raw))
                .transpose()?,
        })
    }
}

/// Parses a comma-separated `CORS_ORIGINS` value, rejecting entries a browser would never send
/// as `Origin` (no scheme, a path, a trailing slash). Those would otherwise silently block the web app.
pub fn parse_origins(raw: &str) -> anyhow::Result<Vec<String>> {
    let origins: Vec<String> = raw
        .split(',')
        .map(str::trim)
        .filter(|o| !o.is_empty())
        .map(String::from)
        .collect();
    if origins.is_empty() {
        bail!("CORS_ORIGINS is set but lists no origins");
    }
    for origin in &origins {
        let host = origin
            .strip_prefix("https://")
            .or_else(|| origin.strip_prefix("http://"))
            .with_context(|| {
                format!("CORS origin {origin:?} must start with http:// or https://")
            })?;
        if host.is_empty() || host.contains('/') {
            bail!("CORS origin {origin:?} must be scheme://host[:port], with no path or trailing slash");
        }
        HeaderValue::from_str(origin)
            .with_context(|| format!("CORS origin {origin:?} is not a valid header value"))?;
    }
    Ok(origins)
}

#[cfg(test)]
mod tests {
    use super::parse_origins;

    #[test]
    fn parses_and_trims_a_comma_separated_list() {
        let origins =
            parse_origins(" https://app.homesy.gilla.fun , http://localhost:8081 ").unwrap();
        assert_eq!(
            origins,
            vec!["https://app.homesy.gilla.fun", "http://localhost:8081"]
        );
    }

    #[test]
    fn rejects_a_trailing_slash() {
        // Browsers never send a trailing slash in Origin, so this entry would silently match nothing.
        assert!(parse_origins("https://app.homesy.gilla.fun/").is_err());
    }

    #[test]
    fn rejects_a_missing_scheme() {
        assert!(parse_origins("app.homesy.gilla.fun").is_err());
    }

    #[test]
    fn rejects_a_list_with_no_origins() {
        assert!(parse_origins(" , ").is_err());
    }
}
