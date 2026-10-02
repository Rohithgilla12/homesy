use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Serialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Home {
    pub id: Uuid,
    pub name: String,
    pub emoji: String,
    pub invite_code: String,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Member {
    pub user_id: Uuid,
    pub display_name: String,
    pub email: String,
    pub role: String,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct List {
    pub id: Uuid,
    pub home_id: Uuid,
    pub kind: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    /// number of items not yet done — computed in the query
    pub open_count: i64,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ListItem {
    pub id: Uuid,
    pub list_id: Uuid,
    pub title: String,
    pub qty: Option<String>,
    pub note: Option<String>,
    pub done: bool,
    pub done_by: Option<Uuid>,
    pub done_at: Option<DateTime<Utc>>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct VaultEntry {
    pub id: Uuid,
    pub home_id: Uuid,
    pub category: String,
    pub label: String,
    pub value: String,
    pub is_secret: bool,
    pub pinned: bool,
    pub created_by: Uuid,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Activity {
    pub id: Uuid,
    pub home_id: Uuid,
    pub actor_id: Uuid,
    pub action: String,
    pub resource_type: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct BulletinNotice {
    pub id: Uuid,
    pub home_id: Uuid,
    pub title: String,
    pub content: String,
    pub priority: String,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct HouseholdBill {
    pub id: Uuid,
    pub home_id: Uuid,
    pub title: String,
    pub category: String,
    pub account_number: Option<String>,
    pub amount_cents: Option<i64>,
    pub due_date: Option<NaiveDate>,
    pub billing_period: String,
    pub is_paid: bool,
    pub paid_by: Option<Uuid>,
    pub paid_at: Option<DateTime<Utc>>,
    pub payment_ref: Option<String>,
    pub notes: Option<String>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(default)]
    pub paid_by_name: Option<String>,
    #[sqlx(default)]
    pub created_by_name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateBill {
    pub title: String,
    pub category: String,
    pub account_number: Option<String>,
    pub amount_cents: Option<i64>,
    pub due_date: Option<NaiveDate>,
    pub billing_period: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PayBill {
    pub amount_cents: Option<i64>,
    pub payment_ref: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UpdateBill {
    pub title: Option<String>,
    pub category: Option<String>,
    pub account_number: Option<String>,
    pub amount_cents: Option<i64>,
    pub due_date: Option<NaiveDate>,
    pub billing_period: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct NewCycleBill {
    pub billing_period: String,
    pub due_date: Option<NaiveDate>,
    pub amount_cents: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HomeEvent {
    pub home_id: Uuid,
    pub event_type: String,
    pub payload: serde_json::Value,
}
