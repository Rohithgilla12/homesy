use aws_credential_types::Credentials;
use aws_sdk_s3::{config::Region, presigning::PresigningConfig, Client, Config};
use std::time::Duration;
use uuid::Uuid;

pub const PUT_TTL: Duration = Duration::from_secs(15 * 60);
pub const GET_TTL: Duration = Duration::from_secs(10 * 60);

/// S3 client for the private attachments bucket. R2 speaks S3 with path-style addressing and region `auto`.
#[derive(Clone)]
pub struct Storage {
    client: Client,
    bucket: String,
}

pub fn object_key(home_id: Uuid, attachment_id: Uuid) -> String {
    format!("{home_id}/{attachment_id}")
}

fn env_var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

impl Storage {
    pub fn new(endpoint: String, access_key: String, secret_key: String, bucket: String) -> Self {
        let creds = Credentials::new(access_key, secret_key, None, None, "env");
        let config = Config::builder()
            .behavior_version_latest()
            .region(Region::new("auto"))
            .endpoint_url(endpoint)
            .credentials_provider(creds)
            .force_path_style(true)
            .build();
        Self {
            client: Client::from_conf(config),
            bucket,
        }
    }

    /// `None` when any R2 variable is missing or empty, which disables attachments without failing startup.
    pub fn from_env() -> Option<Self> {
        let endpoint = env_var("S3_ENDPOINT").or_else(|| {
            env_var("R2_ACCOUNT_ID").map(|a| format!("https://{a}.r2.cloudflarestorage.com"))
        })?;
        let access_key = env_var("R2_ACCESS_KEY_ID")?;
        let secret_key = env_var("R2_SECRET_ACCESS_KEY")?;
        let bucket = env_var("R2_BUCKET")?;
        Some(Self::new(endpoint, access_key, secret_key, bucket))
    }

    pub async fn presign_put(
        &self,
        key: &str,
        content_type: &str,
        size: i64,
    ) -> anyhow::Result<String> {
        let req = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .content_length(size)
            .presigned(PresigningConfig::expires_in(PUT_TTL)?)
            .await?;
        Ok(req.uri().to_string())
    }

    pub async fn presign_get(&self, key: &str) -> anyhow::Result<String> {
        let req = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .presigned(PresigningConfig::expires_in(GET_TTL)?)
            .await?;
        Ok(req.uri().to_string())
    }

    /// Size of the stored object, or `None` when it does not exist yet.
    pub async fn head_size(&self, key: &str) -> anyhow::Result<Option<i64>> {
        match self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
        {
            Ok(out) => Ok(out.content_length()),
            Err(e)
                if e.as_service_error()
                    .map(|s| s.is_not_found())
                    .unwrap_or(false) =>
            {
                Ok(None)
            }
            Err(e) => Err(e.into()),
        }
    }

    pub async fn delete(&self, key: &str) -> anyhow::Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn test_storage() -> Storage {
        Storage::new(
            "http://localhost:9000".into(),
            "test".into(),
            "testsecret".into(),
            "homesy-test".into(),
        )
    }

    #[test]
    fn object_key_is_home_then_attachment() {
        let h = Uuid::now_v7();
        let a = Uuid::now_v7();
        assert_eq!(object_key(h, a), format!("{h}/{a}"));
    }

    #[tokio::test]
    async fn presigned_put_targets_the_bucket_and_key_and_expires_in_15_minutes() {
        let url = test_storage()
            .presign_put("h/a", "image/jpeg", 123)
            .await
            .unwrap();
        assert!(
            url.starts_with("http://localhost:9000/homesy-test/h/a?"),
            "{url}"
        );
        assert!(url.contains("X-Amz-Expires=900"), "{url}");
    }

    #[tokio::test]
    async fn presigned_get_expires_in_10_minutes() {
        let url = test_storage().presign_get("h/a").await.unwrap();
        assert!(
            url.starts_with("http://localhost:9000/homesy-test/h/a?"),
            "{url}"
        );
        assert!(url.contains("X-Amz-Expires=600"), "{url}");
    }

    #[test]
    fn from_env_is_none_when_unset() {
        for k in [
            "R2_ACCOUNT_ID",
            "R2_ACCESS_KEY_ID",
            "R2_SECRET_ACCESS_KEY",
            "R2_BUCKET",
            "S3_ENDPOINT",
        ] {
            std::env::remove_var(k);
        }
        assert!(Storage::from_env().is_none());
    }
}
