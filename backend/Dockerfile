# Builds the homesy-api binary and ships it on distroless. cargo-chef caches the dependency layer
# separately so source-only changes rebuild fast. Migrations are embedded by sqlx::migrate!.
FROM lukemathwalker/cargo-chef:latest-rust-1-bookworm AS chef
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY . .
RUN cargo build --release --bin homesy-api

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=builder /app/target/release/homesy-api /app/homesy-api
EXPOSE 8080
ENTRYPOINT ["/app/homesy-api"]
