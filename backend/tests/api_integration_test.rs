use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use homesy_api::{create_app, state::AppState};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool};
use tower::ServiceExt;
use uuid::Uuid;

async fn setup_test_db() -> (PgPool, AppState) {
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://homesy:homesy@localhost:5432/homesy".into());
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .expect("Failed to connect to test database");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run migrations");

    let state = AppState::new(pool.clone(), "test-jwt-secret-for-api-tests-123".into());
    (pool, state)
}

async fn parse_json_response(body: Body) -> Value {
    let bytes = body.collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap_or_default()
}

#[tokio::test]
async fn test_full_api_flow() {
    let (_pool, state) = setup_test_db().await;
    let app = create_app(state, None);

    // 1. Health check
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 2. Signup User 1
    let u1_email = format!("u1_{}@example.com", Uuid::now_v7());
    let signup_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/signup")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "email": u1_email,
                        "password": "password1234",
                        "display_name": "User One"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(signup_res.status(), StatusCode::OK);
    let u1_data = parse_json_response(signup_res.into_body()).await;
    let u1_token = u1_data["token"].as_str().unwrap().to_string();
    let u1_id = u1_data["user"]["id"].as_str().unwrap().to_string();

    // Duplicate signup with same email should return 409 Conflict
    let dup_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/signup")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "email": u1_email,
                        "password": "password1234",
                        "display_name": "User One Again"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(dup_res.status(), StatusCode::CONFLICT);

    // 3. Login User 1
    let login_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "email": u1_email,
                        "password": "password1234"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(login_res.status(), StatusCode::OK);

    // 4. GET /me
    let me_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/me")
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(me_res.status(), StatusCode::OK);
    let me_data = parse_json_response(me_res.into_body()).await;
    assert_eq!(me_data["id"], u1_id);

    // 5. Create Home
    let home_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/homes")
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "name": "Cozy Flat",
                        "emoji": "🏡"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(home_res.status(), StatusCode::OK);
    let home_data = parse_json_response(home_res.into_body()).await;
    let home_id = home_data["id"].as_str().unwrap().to_string();
    let invite_code = home_data["invite_code"].as_str().unwrap().to_string();

    // 6. User 2 Signup and Join Home
    let u2_email = format!("u2_{}@example.com", Uuid::now_v7());
    let u2_signup = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/signup")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "email": u2_email,
                        "password": "password1234",
                        "display_name": "User Two"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let u2_token = parse_json_response(u2_signup.into_body()).await["token"]
        .as_str()
        .unwrap()
        .to_string();

    // Join with invite code
    let join_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/homes/join")
                .header(header::AUTHORIZATION, format!("Bearer {u2_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "code": invite_code
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(join_res.status(), StatusCode::OK);

    // 7. GET /homes/{id} shows both members
    let detail_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/homes/{home_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(detail_res.status(), StatusCode::OK);
    let detail_data = parse_json_response(detail_res.into_body()).await;
    assert_eq!(detail_data["members"].as_array().unwrap().len(), 2);

    // 8. Default lists check (grocery, laundry, todo)
    let lists_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/homes/{home_id}/lists"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(lists_res.status(), StatusCode::OK);
    let lists_data = parse_json_response(lists_res.into_body()).await;
    let lists_arr = lists_data.as_array().unwrap();
    assert_eq!(lists_arr.len(), 3);
    let grocery_list_id = lists_arr[0]["id"].as_str().unwrap().to_string();

    // 9. Create Custom List
    let custom_list_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/homes/{home_id}/lists"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "kind": "custom",
                        "name": "Packing List"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(custom_list_res.status(), StatusCode::OK);

    // 10. List items: create, get, update, delete
    let item_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/lists/{grocery_list_id}/items"))
                .header(header::AUTHORIZATION, format!("Bearer {u2_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "title": "Oat Milk",
                        "qty": "2 cartons",
                        "note": "Barista edition"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(item_res.status(), StatusCode::OK);
    let item_data = parse_json_response(item_res.into_body()).await;
    let item_id = item_data["id"].as_str().unwrap().to_string();
    assert_eq!(item_data["title"], "Oat Milk");
    assert_eq!(item_data["done"], false);

    // Patch item (mark done)
    let patch_item_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/items/{item_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "done": true
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(patch_item_res.status(), StatusCode::OK);
    let patched_data = parse_json_response(patch_item_res.into_body()).await;
    assert_eq!(patched_data["done"], true);

    // 11. Vault: create, list, patch, delete
    let vault_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/homes/{home_id}/vault"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "category": "access",
                        "label": "Wi-Fi Password",
                        "value": "supersecretwifipass",
                        "is_secret": true,
                        "pinned": true
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(vault_res.status(), StatusCode::OK);
    let vault_data = parse_json_response(vault_res.into_body()).await;
    let vault_id = vault_data["id"].as_str().unwrap().to_string();
    assert_eq!(vault_data["is_secret"], true);

    // List vault
    let list_vault_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/homes/{home_id}/vault"))
                .header(header::AUTHORIZATION, format!("Bearer {u2_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_vault_res.status(), StatusCode::OK);

    // Patch vault entry
    let patch_vault_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/vault/{vault_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {u2_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "value": "updated-password-999"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(patch_vault_res.status(), StatusCode::OK);
    let updated_vault = parse_json_response(patch_vault_res.into_body()).await;
    assert_eq!(updated_vault["value"], "updated-password-999");

    // Delete vault entry
    let del_vault_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/vault/{vault_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(del_vault_res.status(), StatusCode::OK);

    // Delete item
    let del_item_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/items/{item_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(del_item_res.status(), StatusCode::OK);

    // 12. Lists enhancement: Clear completed items
    // Add two items, mark one done, then clear-completed
    let c1_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/lists/{grocery_list_id}/items"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "title": "Done Item", "done": false }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let c1_id = parse_json_response(c1_res.into_body()).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/items/{c1_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "done": true }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/lists/{grocery_list_id}/items"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "title": "Pending Item", "done": false }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    let clear_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/lists/{grocery_list_id}/clear-completed"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(clear_res.status(), StatusCode::OK);
    let clear_data = parse_json_response(clear_res.into_body()).await;
    assert_eq!(clear_data["deleted"], 1);

    // 13. Bulletin Notices: create, list, delete
    let notice_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/homes/{home_id}/bulletin"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "title": "Quiet hours",
                        "content": "Please keep noise down after 10pm",
                        "priority": "urgent"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(notice_res.status(), StatusCode::OK);
    let notice_data = parse_json_response(notice_res.into_body()).await;
    let notice_id = notice_data["id"].as_str().unwrap().to_string();
    assert_eq!(notice_data["title"], "Quiet hours");
    assert_eq!(notice_data["priority"], "urgent");

    let list_notices_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/homes/{home_id}/bulletin"))
                .header(header::AUTHORIZATION, format!("Bearer {u2_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_notices_res.status(), StatusCode::OK);
    let notices_list = parse_json_response(list_notices_res.into_body()).await;
    assert_eq!(notices_list.as_array().unwrap().len(), 1);

    let del_notice_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/bulletin/{notice_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(del_notice_res.status(), StatusCode::OK);

    // 14. Household Bills & Utilities Tracker Lifecycle
    // a. Create bills (Electricity and Internet)
    let bill1_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/homes/{home_id}/bills"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "title": "Electricity (BESCOM)",
                        "category": "electricity",
                        "account_number": "BESCOM-12345",
                        "amount_cents": 245000,
                        "due_date": "2026-10-15",
                        "billing_period": "October 2026",
                        "notes": "Meter in basement"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bill1_res.status(), StatusCode::OK);
    let bill1_data = parse_json_response(bill1_res.into_body()).await;
    let bill1_id = bill1_data["id"].as_str().unwrap().to_string();
    assert_eq!(bill1_data["title"], "Electricity (BESCOM)");
    assert_eq!(bill1_data["category"], "electricity");
    assert_eq!(bill1_data["account_number"], "BESCOM-12345");
    assert_eq!(bill1_data["amount_cents"], 245000);
    assert_eq!(bill1_data["is_paid"], false);
    assert_eq!(bill1_data["created_by_name"], "User One");

    let bill2_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/homes/{home_id}/bills"))
                .header(header::AUTHORIZATION, format!("Bearer {u2_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "title": "Airtel Fiber",
                        "category": "internet",
                        "account_number": "AIRTEL-98765",
                        "amount_cents": 117900,
                        "due_date": "2026-10-20",
                        "billing_period": "October 2026"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bill2_res.status(), StatusCode::OK);
    let bill2_data = parse_json_response(bill2_res.into_body()).await;
    let bill2_id = bill2_data["id"].as_str().unwrap().to_string();

    // b. List bills (GET /homes/{id}/bills)
    let list_bills_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/homes/{home_id}/bills"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_bills_res.status(), StatusCode::OK);
    let bills_list = parse_json_response(list_bills_res.into_body()).await;
    assert_eq!(bills_list.as_array().unwrap().len(), 2);

    // c. Update bill (PATCH /bills/{id})
    let patch_bill_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/bills/{bill1_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "notes": "Meter in basement - updated note"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(patch_bill_res.status(), StatusCode::OK);
    let patched_bill = parse_json_response(patch_bill_res.into_body()).await;
    assert_eq!(patched_bill["notes"], "Meter in basement - updated note");

    // d. Pay bill (POST /bills/{id}/pay) - User 2 marks bill 1 as paid
    let pay_bill_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/bills/{bill1_id}/pay"))
                .header(header::AUTHORIZATION, format!("Bearer {u2_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "payment_ref": "UPI-TXN-49201"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(pay_bill_res.status(), StatusCode::OK);
    let paid_bill = parse_json_response(pay_bill_res.into_body()).await;
    assert_eq!(paid_bill["is_paid"], true);
    assert_eq!(paid_bill["paid_by_name"], "User Two");
    assert_eq!(paid_bill["payment_ref"], "UPI-TXN-49201");
    assert!(!paid_bill["paid_at"].is_null());

    // e. Double-payment prevention alert in activity
    let act_check_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/homes/{home_id}/activity?limit=10"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let act_check_list = parse_json_response(act_check_res.into_body()).await;
    let pay_activity = act_check_list
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["action"] == "paid" && a["resource_type"] == "bill")
        .expect("Activity for bill payment should exist");
    let desc = pay_activity["description"].as_str().unwrap();
    assert!(
        desc.contains("DO NOT REPAY"),
        "Activity description must warn against double payment: {}",
        desc
    );
    assert!(
        desc.contains("User Two marked Electricity (BESCOM) (₹2450) as PAID — DO NOT REPAY"),
        "Expected exact wording: {}",
        desc
    );

    // f. Unpay bill (POST /bills/{id}/unpay)
    let unpay_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/bills/{bill1_id}/unpay"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unpay_res.status(), StatusCode::OK);
    let unpaid_bill = parse_json_response(unpay_res.into_body()).await;
    assert_eq!(unpaid_bill["is_paid"], false);
    assert!(unpaid_bill["paid_by"].is_null());
    assert!(unpaid_bill["paid_at"].is_null());
    assert!(unpaid_bill["payment_ref"].is_null());

    // g. Roll over to new billing cycle (POST /bills/{id}/new-cycle)
    // First mark as paid again
    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/bills/{bill1_id}/pay"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "payment_ref": "UPI-REC-1" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    let new_cycle_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/bills/{bill1_id}/new-cycle"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "billing_period": "November 2026",
                        "due_date": "2026-11-15",
                        "amount_cents": 260000
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(new_cycle_res.status(), StatusCode::OK);
    let cycled_bill = parse_json_response(new_cycle_res.into_body()).await;
    assert_eq!(cycled_bill["is_paid"], false);
    assert_eq!(cycled_bill["billing_period"], "November 2026");
    assert_eq!(cycled_bill["due_date"], "2026-11-15");
    assert_eq!(cycled_bill["amount_cents"], 260000);
    assert!(cycled_bill["paid_by"].is_null());
    assert!(cycled_bill["payment_ref"].is_null());

    // h. Delete bill (DELETE /bills/{id})
    let del_bill_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/bills/{bill2_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {u2_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(del_bill_res.status(), StatusCode::OK);

    // Verify list now has only 1 bill
    let list_after_del = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/homes/{home_id}/bills"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let remaining_bills = parse_json_response(list_after_del.into_body()).await;
    assert_eq!(remaining_bills.as_array().unwrap().len(), 1);

    // 15. Activity Log: check recent activity
    let activity_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/homes/{home_id}/activity?limit=50"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(activity_res.status(), StatusCode::OK);
    let activity_list = parse_json_response(activity_res.into_body()).await;
    let activities = activity_list.as_array().unwrap();
    assert!(!activities.is_empty(), "Activities should be logged");
    // Verify that various resource_types exist
    let resource_types: Vec<&str> = activities
        .iter()
        .filter_map(|a| a["resource_type"].as_str())
        .collect();
    assert!(resource_types.contains(&"member"));
    assert!(resource_types.contains(&"list"));
    assert!(resource_types.contains(&"item"));
    assert!(resource_types.contains(&"vault"));
    assert!(resource_types.contains(&"notice"));
    assert!(resource_types.contains(&"bill"));

    // 16. Non-member access test (User 3)
    let u3_email = format!("u3_{}@example.com", Uuid::now_v7());
    let u3_signup = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/signup")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "email": u3_email,
                        "password": "password1234",
                        "display_name": "User Three"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let u3_data = parse_json_response(u3_signup.into_body()).await;
    let u3_token = u3_data["token"].as_str().unwrap().to_string();
    let u3_id = u3_data["user"]["id"].as_str().unwrap().to_string();

    let forbidden_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/homes/{home_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {u3_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forbidden_res.status(), StatusCode::FORBIDDEN);

    // A bill can only be marked as paid by someone in the home
    let outsider_payer_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/bills/{bill1_id}/pay"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "paid_by": u3_id }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(outsider_payer_res.status(), StatusCode::BAD_REQUEST);

    // User 1 records that User 2 paid
    let u2_id = paid_bill["paid_by"].as_str().unwrap().to_string();
    let on_behalf_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/bills/{bill1_id}/pay"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "paid_by": u2_id, "payment_ref": "Cash" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(on_behalf_res.status(), StatusCode::OK);
    let on_behalf_bill = parse_json_response(on_behalf_res.into_body()).await;
    assert_eq!(on_behalf_bill["paid_by"], u2_id.as_str());
    assert_eq!(on_behalf_bill["paid_by_name"], "User Two");

    // 17. Leave home: User 2 (member) leaves home
    let leave_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/homes/{home_id}/leave"))
                .header(header::AUTHORIZATION, format!("Bearer {u2_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(leave_res.status(), StatusCode::OK);

    // Sole owner cannot leave without transferring ownership
    let owner_leave_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/homes/{home_id}/leave"))
                .header(header::AUTHORIZATION, format!("Bearer {u1_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(owner_leave_res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_sse_events_broadcast() {
    let (_pool, state) = setup_test_db().await;
    let home_id = Uuid::now_v7();

    // Subscribe to events
    let mut rx = state.events_tx.subscribe();

    // Broadcast an event
    state.broadcast(homesy_api::models::HomeEvent {
        home_id,
        event_type: "item_created".into(),
        payload: json!({
            "id": Uuid::now_v7().to_string(),
            "title": "Fresh Apples"
        }),
    });

    let received = rx.recv().await.expect("Should receive broadcast event");
    assert_eq!(received.home_id, home_id);
    assert_eq!(received.event_type, "item_created");
    assert_eq!(received.payload["title"], "Fresh Apples");
}

#[tokio::test]
async fn test_bills_sse_events_and_ordering() {
    let (_pool, state) = setup_test_db().await;
    let app = create_app(state.clone(), None);

    // Setup user and home
    let u_email = format!("bill_user_{}@example.com", Uuid::now_v7());
    let signup_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/signup")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "email": u_email,
                        "password": "password1234",
                        "display_name": "Bill Tester"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let u_token = parse_json_response(signup_res.into_body()).await["token"]
        .as_str()
        .unwrap()
        .to_string();

    let home_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/homes")
                .header(header::AUTHORIZATION, format!("Bearer {u_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "name": "Bill Home", "emoji": "⚡" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let home_id = parse_json_response(home_res.into_body()).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Subscribe to SSE broadcasts
    let mut rx = state.events_tx.subscribe();

    // 1. Create a bill with variable amount (amount_cents: null)
    let c1_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/homes/{home_id}/bills"))
                .header(header::AUTHORIZATION, format!("Bearer {u_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "title": "Water Meter",
                        "category": "water",
                        "billing_period": "October 2026",
                        "due_date": "2026-10-25"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(c1_res.status(), StatusCode::OK);
    let c1_data = parse_json_response(c1_res.into_body()).await;
    let bill_id = c1_data["id"].as_str().unwrap().to_string();

    // Verify SSE bill_created
    let event = rx.recv().await.unwrap();
    assert_eq!(event.event_type, "bill_created");
    assert_eq!(event.payload["title"], "Water Meter");

    // Skip activity_created SSE
    let _ = rx.recv().await.unwrap();

    // 2. Pay bill with amount specified during payment
    let pay_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/bills/{bill_id}/pay"))
                .header(header::AUTHORIZATION, format!("Bearer {u_token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "amount_cents": 85000,
                        "payment_ref": "Water Board Portal"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(pay_res.status(), StatusCode::OK);
    let pay_data = parse_json_response(pay_res.into_body()).await;
    assert_eq!(pay_data["is_paid"], true);
    assert_eq!(pay_data["amount_cents"], 85000);

    // Verify SSE bill_paid and activity log
    // Activity log event first, then bill_paid event
    let event_a = rx.recv().await.unwrap();
    let event_b = rx.recv().await.unwrap();
    let has_paid_event = event_a.event_type == "bill_paid" || event_b.event_type == "bill_paid";
    assert!(has_paid_event, "Should receive bill_paid SSE");

    // 3. Unpay bill
    let unpay_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/bills/{bill_id}/unpay"))
                .header(header::AUTHORIZATION, format!("Bearer {u_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unpay_res.status(), StatusCode::OK);

    let event_a = rx.recv().await.unwrap();
    let event_b = rx.recv().await.unwrap();
    let has_unpaid_event =
        event_a.event_type == "bill_unpaid" || event_b.event_type == "bill_unpaid";
    assert!(has_unpaid_event, "Should receive bill_unpaid SSE");

    // 4. Delete bill
    let _del_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/bills/{bill_id}/delete"))
                .header(header::AUTHORIZATION, format!("Bearer {u_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    // Route is /bills/{id} not /bills/{id}/delete
    let del_res2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/bills/{bill_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {u_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(del_res2.status(), StatusCode::OK);
}

/// State whose pool never connects. Enough for routes that do not touch the database.
fn unconnected_state() -> AppState {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://homesy:homesy@127.0.0.1:1/homesy")
        .unwrap();
    AppState::new(pool, "test-jwt-secret-for-api-tests-123".into())
}

fn preflight(origin: &str, method: &str) -> Request<Body> {
    Request::builder()
        .method("OPTIONS")
        .uri("/items/00000000-0000-0000-0000-000000000000")
        .header(header::ORIGIN, origin)
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, method)
        .header(
            header::ACCESS_CONTROL_REQUEST_HEADERS,
            // What the web SSE client sends (mobile/src/api/events.ts).
            "authorization,content-type,cache-control",
        )
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn test_cors_allows_preflight_from_listed_origin() {
    let origins = vec!["https://homesy-app.gilla.fun".to_string()];
    let app = create_app(unconnected_state(), Some(&origins));

    for method in ["PATCH", "DELETE"] {
        let res = app
            .clone()
            .oneshot(preflight("https://homesy-app.gilla.fun", method))
            .await
            .unwrap();
        let headers = res.headers();
        assert_eq!(
            headers[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "https://homesy-app.gilla.fun"
        );
        assert!(headers[header::ACCESS_CONTROL_ALLOW_METHODS]
            .to_str()
            .unwrap()
            .contains(method));
        let allowed = headers[header::ACCESS_CONTROL_ALLOW_HEADERS]
            .to_str()
            .unwrap()
            .to_lowercase();
        for h in ["authorization", "content-type", "cache-control"] {
            assert!(
                allowed.contains(h),
                "preflight must allow {h}, got {allowed}"
            );
        }
    }
}

#[tokio::test]
async fn test_cors_rejects_unlisted_origin() {
    let origins = vec!["https://homesy-app.gilla.fun".to_string()];
    let app = create_app(unconnected_state(), Some(&origins));

    let res = app
        .oneshot(preflight("https://evil.example", "PATCH"))
        .await
        .unwrap();
    assert!(res
        .headers()
        .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
        .is_none());
}

#[tokio::test]
async fn test_health_reports_unreachable_database_promptly() {
    let app = create_app(unconnected_state(), None);
    let started = std::time::Instant::now();

    let res = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(5),
        "health must not wait for the pool timeout"
    );
    let body = parse_json_response(res.into_body()).await;
    assert_eq!(body["error"], "database unavailable");
}

fn storage_for_tests() -> Option<homesy_api::storage::Storage> {
    // CI runs MinIO; locally `docker compose up -d` starts it too. Without it these tests return early.
    let endpoint = std::env::var("S3_ENDPOINT").ok()?;
    Some(homesy_api::storage::Storage::new(
        endpoint,
        "homesy".into(),
        "homesyhomesy".into(),
        "homesy-test".into(),
    ))
}

async fn signup_and_home(app: &axum::Router) -> (String, String) {
    let email = format!("att_{}@example.com", Uuid::now_v7());
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/signup")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({"email": email, "password": "password123", "display_name": "Att"})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let token = parse_json_response(res.into_body()).await["token"]
        .as_str()
        .unwrap()
        .to_string();
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/homes")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({"name": "Att Home"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let home = parse_json_response(res.into_body()).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    (token, home)
}

fn json_post(uri: String, token: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn authed(method: &str, uri: String, token: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn attachments_are_disabled_without_storage() {
    let (_pool, state) = setup_test_db().await;
    let app = create_app(state, None);
    let (token, home) = signup_and_home(&app).await;
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/config")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        parse_json_response(res.into_body()).await["attachments"],
        json!(false)
    );
    let res = app
        .oneshot(json_post(
            format!("/homes/{home}/attachments"),
            &token,
            json!({"kind":"bill_receipt","content_type":"image/jpeg","size_bytes":10}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn attachment_create_complete_read_delete() {
    let Some(storage) = storage_for_tests() else {
        return;
    };
    let (_pool, state) = setup_test_db().await;
    let app = create_app(state.with_storage(Some(storage)), None);
    let (token, home) = signup_and_home(&app).await;

    let res = app
        .clone()
        .oneshot(json_post(
            format!("/homes/{home}/attachments"),
            &token,
            json!({"kind":"bill_receipt","content_type":"image/png","size_bytes":4}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let created = parse_json_response(res.into_body()).await;
    let id = created["id"].as_str().unwrap().to_string();
    let upload_url = created["upload_url"].as_str().unwrap().to_string();

    let res = app
        .clone()
        .oneshot(authed(
            "POST",
            format!("/attachments/{id}/complete"),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT, "complete before upload");

    let client = reqwest::Client::new();
    let put = client
        .put(&upload_url)
        .header("content-type", "image/png")
        .body(vec![1u8, 2, 3, 4])
        .send()
        .await
        .unwrap();
    assert!(put.status().is_success(), "{}", put.status());

    let res = app
        .clone()
        .oneshot(authed(
            "POST",
            format!("/attachments/{id}/complete"),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let out = parse_json_response(res.into_body()).await;
    assert_eq!(out["size_bytes"], json!(4));
    let get = client
        .get(out["url"].as_str().unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(get.bytes().await.unwrap().to_vec(), vec![1u8, 2, 3, 4]);

    let res = app
        .clone()
        .oneshot(authed("DELETE", format!("/attachments/{id}"), &token))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let get = client
        .get(out["url"].as_str().unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(get.status(), 404);
}

#[tokio::test]
async fn attachment_rejects_bad_type_and_non_members() {
    let Some(storage) = storage_for_tests() else {
        return;
    };
    let (_pool, state) = setup_test_db().await;
    let app = create_app(state.with_storage(Some(storage)), None);
    let (token, home) = signup_and_home(&app).await;
    let (other_token, _other_home) = signup_and_home(&app).await;
    let bad = app
        .clone()
        .oneshot(json_post(
            format!("/homes/{home}/attachments"),
            &token,
            json!({"kind":"avatar","content_type":"application/pdf","size_bytes":10}),
        ))
        .await
        .unwrap();
    assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
    let forbidden = app
        .oneshot(json_post(
            format!("/homes/{home}/attachments"),
            &other_token,
            json!({"kind":"avatar","content_type":"image/png","size_bytes":10}),
        ))
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
}

/// Creates, uploads 4 bytes and completes an attachment; returns its id.
async fn upload_ready(app: &axum::Router, token: &str, home: &str, kind: &str) -> String {
    let res = app
        .clone()
        .oneshot(json_post(
            format!("/homes/{home}/attachments"),
            token,
            json!({"kind": kind, "content_type":"image/png","size_bytes":4}),
        ))
        .await
        .unwrap();
    let created = parse_json_response(res.into_body()).await;
    reqwest::Client::new()
        .put(created["upload_url"].as_str().unwrap())
        .header("content-type", "image/png")
        .body(vec![1u8, 2, 3, 4])
        .send()
        .await
        .unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    app.clone()
        .oneshot(authed("POST", format!("/attachments/{id}/complete"), token))
        .await
        .unwrap();
    id
}

#[tokio::test]
async fn bill_receipt_attaches_and_rejects_foreign_attachment() {
    let Some(storage) = storage_for_tests() else {
        return;
    };
    let (_pool, state) = setup_test_db().await;
    let app = create_app(state.with_storage(Some(storage)), None);
    let (token, home) = signup_and_home(&app).await;
    let (other_token, other_home) = signup_and_home(&app).await;
    let mine = upload_ready(&app, &token, &home, "bill_receipt").await;
    let theirs = upload_ready(&app, &other_token, &other_home, "bill_receipt").await;

    let res = app
        .clone()
        .oneshot(json_post(
            format!("/homes/{home}/bills"),
            &token,
            json!({"title":"Gas","category":"gas","billing_period":"Oct","receipt_id": theirs}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST, "foreign attachment");

    let res = app
        .clone()
        .oneshot(json_post(
            format!("/homes/{home}/bills"),
            &token,
            json!({"title":"Gas","category":"gas","billing_period":"Oct","receipt_id": mine}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bill = parse_json_response(res.into_body()).await;
    assert_eq!(bill["receipt"]["id"].as_str().unwrap(), mine);
    assert!(bill["receipt"]["url"].as_str().unwrap().starts_with("http"));
}

#[tokio::test]
async fn vault_entry_documents_replace_and_cascade() {
    let Some(storage) = storage_for_tests() else {
        return;
    };
    let (pool, state) = setup_test_db().await;
    let app = create_app(state.with_storage(Some(storage)), None);
    let (token, home) = signup_and_home(&app).await;
    let d1 = upload_ready(&app, &token, &home, "vault_document").await;
    let d2 = upload_ready(&app, &token, &home, "vault_document").await;
    let res = app
        .clone()
        .oneshot(json_post(
            format!("/homes/{home}/vault"),
            &token,
            json!({"category":"documents","label":"Lease","value":"Flat 4B","attachment_ids":[d1, d2]}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let entry = parse_json_response(res.into_body()).await;
    assert_eq!(entry["attachments"].as_array().map(|a| a.len()), Some(2));
    let entry_id = entry["id"].as_str().unwrap().to_string();

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/vault/{entry_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({"attachment_ids":[d2]}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let entry = parse_json_response(res.into_body()).await;
    assert_eq!(entry["attachments"][0]["id"].as_str().unwrap(), d2);
    let (n,): (i64,) = sqlx::query_as("select count(*) from attachments where id = $1")
        .bind(Uuid::parse_str(&d1).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0, "dropped document is deleted");

    app.clone()
        .oneshot(authed("DELETE", format!("/vault/{entry_id}"), &token))
        .await
        .unwrap();
    let (n,): (i64,) = sqlx::query_as("select count(*) from attachments where id = $1")
        .bind(Uuid::parse_str(&d2).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0, "entry delete removes its documents");
}

#[tokio::test]
async fn avatar_and_cover_are_set_through_patch() {
    let Some(storage) = storage_for_tests() else {
        return;
    };
    let (_pool, state) = setup_test_db().await;
    let app = create_app(state.with_storage(Some(storage)), None);
    let (token, home) = signup_and_home(&app).await;
    let avatar = upload_ready(&app, &token, &home, "avatar").await;
    let cover = upload_ready(&app, &token, &home, "home_cover").await;

    let patch = |uri: String, body: Value| {
        Request::builder()
            .method("PATCH")
            .uri(uri)
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    };

    let res = app
        .clone()
        .oneshot(patch("/me".into(), json!({"avatar_id": avatar})))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        parse_json_response(res.into_body()).await["avatar"]["id"]
            .as_str()
            .unwrap(),
        avatar
    );

    let res = app
        .clone()
        .oneshot(patch(format!("/homes/{home}"), json!({"cover_id": cover})))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .oneshot(authed("GET", format!("/homes/{home}"), &token))
        .await
        .unwrap();
    let detail = parse_json_response(res.into_body()).await;
    assert_eq!(detail["cover"]["id"].as_str().unwrap(), cover);
    assert_eq!(
        detail["members"][0]["avatar"]["id"].as_str().unwrap(),
        avatar
    );
}

#[tokio::test]
async fn stale_pending_attachments_are_swept() {
    let Some(storage) = storage_for_tests() else {
        return;
    };
    let (pool, state) = setup_test_db().await;
    let state = state.with_storage(Some(storage));
    let app = create_app(state.clone(), None);
    let (token, home) = signup_and_home(&app).await;
    let res = app
        .clone()
        .oneshot(json_post(
            format!("/homes/{home}/attachments"),
            &token,
            json!({"kind":"avatar","content_type":"image/png","size_bytes":4}),
        ))
        .await
        .unwrap();
    let id = Uuid::parse_str(
        parse_json_response(res.into_body()).await["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    sqlx::query("update attachments set created_at = now() - interval '2 days' where id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let n = homesy_api::sweep::delete_stale_pending(&state, chrono::Duration::days(1))
        .await
        .unwrap();
    assert!(n >= 1);
    let (left,): (i64,) = sqlx::query_as("select count(*) from attachments where id = $1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0);
}
