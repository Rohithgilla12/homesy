use crate::{
    activity::log_activity,
    auth::{ensure_member, AuthUser},
    error::{AppError, AppResult},
    models::{CreateBill, HouseholdBill, NewCycleBill, PayBill, UpdateBill},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    routing::{get, patch, post},
    Json, Router,
};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/homes/{id}/bills", get(list_bills).post(create_bill))
        .route("/bills/{id}", patch(update_bill).delete(delete_bill))
        .route("/bills/{id}/pay", post(pay_bill))
        .route("/bills/{id}/unpay", post(unpay_bill))
        .route("/bills/{id}/new-cycle", post(new_cycle_bill))
}

const BILL_SELECT: &str = r#"
    select
        b.id,
        b.home_id,
        b.title,
        b.category,
        b.account_number,
        b.amount_cents,
        b.due_date,
        b.billing_period,
        b.is_paid,
        b.paid_by,
        b.paid_at,
        b.payment_ref,
        b.notes,
        b.created_by,
        b.created_at,
        b.updated_at,
        u_paid.display_name as paid_by_name,
        u_created.display_name as created_by_name
    from household_bills b
    left join users u_paid on u_paid.id = b.paid_by
    left join users u_created on u_created.id = b.created_by
"#;

async fn bill_home(pool: &sqlx::PgPool, uid: Uuid, bill_id: Uuid) -> AppResult<Uuid> {
    let (home_id,): (Uuid,) = sqlx::query_as("select home_id from household_bills where id = $1")
        .bind(bill_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_member(pool, uid, home_id).await?;
    Ok(home_id)
}

async fn fetch_bill_with_names(pool: &sqlx::PgPool, bill_id: Uuid) -> AppResult<HouseholdBill> {
    let bill: HouseholdBill = sqlx::query_as(&format!("{BILL_SELECT} where b.id = $1"))
        .bind(bill_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(bill)
}

async fn get_user_display_name(pool: &sqlx::PgPool, uid: Uuid) -> AppResult<String> {
    let (name,): (String,) = sqlx::query_as("select display_name from users where id = $1")
        .bind(uid)
        .fetch_optional(pool)
        .await?
        .unwrap_or(("Someone".into(),));
    Ok(name)
}

async fn list_bills(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(home_id): Path<Uuid>,
) -> AppResult<Json<Vec<HouseholdBill>>> {
    ensure_member(&s.pool, uid, home_id).await?;
    let bills: Vec<HouseholdBill> = sqlx::query_as(&format!(
        "{BILL_SELECT} where b.home_id = $1 order by b.is_paid asc, b.due_date asc nulls last, b.created_at desc"
    ))
    .bind(home_id)
    .fetch_all(&s.pool)
    .await?;
    Ok(Json(bills))
}

async fn create_bill(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(home_id): Path<Uuid>,
    Json(b): Json<CreateBill>,
) -> AppResult<Json<HouseholdBill>> {
    ensure_member(&s.pool, uid, home_id).await?;
    let title = b.title.trim();
    if title.is_empty() {
        return Err(AppError::BadRequest("title required".into()));
    }
    let category = b.category.trim();
    if category.is_empty() {
        return Err(AppError::BadRequest("category required".into()));
    }
    let billing_period = b.billing_period.trim();
    if billing_period.is_empty() {
        return Err(AppError::BadRequest("billing_period required".into()));
    }
    if let Some(amt) = b.amount_cents {
        if amt < 0 {
            return Err(AppError::BadRequest("amount_cents cannot be negative".into()));
        }
    }

    let bill_id = Uuid::now_v7();
    sqlx::query(
        "insert into household_bills (
            id, home_id, title, category, account_number, amount_cents,
            due_date, billing_period, is_paid, notes, created_by, created_at, updated_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $10, now(), now())"
    )
    .bind(bill_id)
    .bind(home_id)
    .bind(title)
    .bind(category)
    .bind(b.account_number.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
    .bind(b.amount_cents)
    .bind(b.due_date)
    .bind(billing_period)
    .bind(b.notes.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
    .bind(uid)
    .execute(&s.pool)
    .await?;

    let bill = fetch_bill_with_names(&s.pool, bill_id).await?;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "bill_created".into(),
        payload: serde_json::to_value(&bill).unwrap_or_default(),
    });

    log_activity(
        &s,
        home_id,
        uid,
        "created",
        "bill",
        &format!("Added bill \"{}\"", bill.title),
    ).await;

    Ok(Json(bill))
}

async fn update_bill(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(bill_id): Path<Uuid>,
    Json(b): Json<UpdateBill>,
) -> AppResult<Json<HouseholdBill>> {
    let home_id = bill_home(&s.pool, uid, bill_id).await?;
    let existing = fetch_bill_with_names(&s.pool, bill_id).await?;

    let new_title = match b.title {
        Some(t) => {
            let t = t.trim().to_string();
            if t.is_empty() {
                return Err(AppError::BadRequest("title cannot be empty".into()));
            }
            t
        }
        None => existing.title,
    };

    let new_category = match b.category {
        Some(c) => {
            let c = c.trim().to_string();
            if c.is_empty() {
                return Err(AppError::BadRequest("category cannot be empty".into()));
            }
            c
        }
        None => existing.category,
    };

    let new_billing_period = match b.billing_period {
        Some(p) => {
            let p = p.trim().to_string();
            if p.is_empty() {
                return Err(AppError::BadRequest("billing_period cannot be empty".into()));
            }
            p
        }
        None => existing.billing_period,
    };

    if let Some(amt) = b.amount_cents {
        if amt < 0 {
            return Err(AppError::BadRequest("amount_cents cannot be negative".into()));
        }
    }

    let new_account_number = b.account_number.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).or(existing.account_number);
    let new_amount_cents = b.amount_cents.or(existing.amount_cents);
    let new_due_date = b.due_date.or(existing.due_date);
    let new_notes = b.notes.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).or(existing.notes);

    sqlx::query(
        "update household_bills
         set title = $1, category = $2, account_number = $3, amount_cents = $4,
             due_date = $5, billing_period = $6, notes = $7, updated_at = now()
         where id = $8"
    )
    .bind(&new_title)
    .bind(&new_category)
    .bind(new_account_number)
    .bind(new_amount_cents)
    .bind(new_due_date)
    .bind(&new_billing_period)
    .bind(new_notes)
    .bind(bill_id)
    .execute(&s.pool)
    .await?;

    let updated = fetch_bill_with_names(&s.pool, bill_id).await?;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "bill_updated".into(),
        payload: serde_json::to_value(&updated).unwrap_or_default(),
    });

    log_activity(
        &s,
        home_id,
        uid,
        "updated",
        "bill",
        &format!("Updated bill \"{}\"", updated.title),
    ).await;

    Ok(Json(updated))
}

async fn pay_bill(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(bill_id): Path<Uuid>,
    Json(b): Json<PayBill>,
) -> AppResult<Json<HouseholdBill>> {
    let home_id = bill_home(&s.pool, uid, bill_id).await?;
    let existing = fetch_bill_with_names(&s.pool, bill_id).await?;

    let payer = b.paid_by.unwrap_or(uid);
    if payer != uid {
        ensure_member(&s.pool, payer, home_id)
            .await
            .map_err(|_| AppError::BadRequest("paid_by must be a member of this home".into()))?;
    }
    if let Some(amt) = b.amount_cents {
        if amt < 0 {
            return Err(AppError::BadRequest("amount_cents cannot be negative".into()));
        }
    }

    let new_amount_cents = b.amount_cents.or(existing.amount_cents);
    let payment_ref = b.payment_ref.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).or(existing.payment_ref);

    sqlx::query(
        "update household_bills
         set is_paid = true, paid_by = $1, paid_at = now(), payment_ref = $2, amount_cents = $3, updated_at = now()
         where id = $4"
    )
    .bind(payer)
    .bind(payment_ref)
    .bind(new_amount_cents)
    .bind(bill_id)
    .execute(&s.pool)
    .await?;

    let updated = fetch_bill_with_names(&s.pool, bill_id).await?;
    let user_name = get_user_display_name(&s.pool, uid).await?;
    let paid_by_suffix = match (&updated.paid_by_name, payer != uid) {
        (Some(name), true) => format!(" (paid by {name})"),
        _ => String::new(),
    };

    let amount_str = match updated.amount_cents {
        Some(cents) => {
            if cents % 100 == 0 {
                format!(" (₹{})", cents / 100)
            } else {
                format!(" (₹{:.2})", cents as f64 / 100.0)
            }
        }
        None => String::new(),
    };
    let desc = format!(
        "{user_name} marked {}{amount_str} as PAID{paid_by_suffix} — DO NOT REPAY",
        updated.title
    );

    log_activity(
        &s,
        home_id,
        uid,
        "paid",
        "bill",
        &desc,
    ).await;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "bill_paid".into(),
        payload: serde_json::to_value(&updated).unwrap_or_default(),
    });

    Ok(Json(updated))
}

async fn unpay_bill(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(bill_id): Path<Uuid>,
) -> AppResult<Json<HouseholdBill>> {
    let home_id = bill_home(&s.pool, uid, bill_id).await?;
    let user_name = get_user_display_name(&s.pool, uid).await?;

    sqlx::query(
        "update household_bills
         set is_paid = false, paid_by = null, paid_at = null, payment_ref = null, updated_at = now()
         where id = $1"
    )
    .bind(bill_id)
    .execute(&s.pool)
    .await?;

    let updated = fetch_bill_with_names(&s.pool, bill_id).await?;

    let desc = format!("{user_name} marked {} as UNPAID", updated.title);
    log_activity(
        &s,
        home_id,
        uid,
        "unpaid",
        "bill",
        &desc,
    ).await;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "bill_unpaid".into(),
        payload: serde_json::to_value(&updated).unwrap_or_default(),
    });

    Ok(Json(updated))
}

async fn new_cycle_bill(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(bill_id): Path<Uuid>,
    Json(b): Json<NewCycleBill>,
) -> AppResult<Json<HouseholdBill>> {
    let home_id = bill_home(&s.pool, uid, bill_id).await?;

    let billing_period = b.billing_period.trim();
    if billing_period.is_empty() {
        return Err(AppError::BadRequest("billing_period required".into()));
    }

    let existing = fetch_bill_with_names(&s.pool, bill_id).await?;
    let new_due_date = b.due_date.or(existing.due_date);
    let new_amount_cents = b.amount_cents.or(existing.amount_cents);

    sqlx::query(
        "update household_bills
         set billing_period = $1,
             due_date = $2,
             amount_cents = $3,
             is_paid = false,
             paid_by = null,
             paid_at = null,
             payment_ref = null,
             updated_at = now()
         where id = $4"
    )
    .bind(billing_period)
    .bind(new_due_date)
    .bind(new_amount_cents)
    .bind(bill_id)
    .execute(&s.pool)
    .await?;

    let updated = fetch_bill_with_names(&s.pool, bill_id).await?;
    let user_name = get_user_display_name(&s.pool, uid).await?;

    log_activity(
        &s,
        home_id,
        uid,
        "new_cycle",
        "bill",
        &format!("{user_name} rolled over \"{}\" to {}", updated.title, updated.billing_period),
    ).await;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "bill_updated".into(),
        payload: serde_json::to_value(&updated).unwrap_or_default(),
    });

    Ok(Json(updated))
}

async fn delete_bill(
    State(s): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(bill_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let home_id = bill_home(&s.pool, uid, bill_id).await?;

    let existing: Option<(String,)> = sqlx::query_as("select title from household_bills where id = $1")
        .bind(bill_id)
        .fetch_optional(&s.pool)
        .await?;

    sqlx::query("delete from household_bills where id = $1")
        .bind(bill_id)
        .execute(&s.pool)
        .await?;

    s.broadcast(crate::models::HomeEvent {
        home_id,
        event_type: "bill_deleted".into(),
        payload: serde_json::json!({ "id": bill_id }),
    });

    let desc = match existing {
        Some((t,)) => format!("Deleted bill \"{}\"", t),
        None => "Deleted bill".to_string(),
    };
    log_activity(
        &s,
        home_id,
        uid,
        "deleted",
        "bill",
        &desc,
    ).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}
