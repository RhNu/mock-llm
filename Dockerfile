FROM rust:1.85-slim AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY config ./config

RUN cargo build --release

FROM debian:bookworm-slim

RUN useradd -m app
WORKDIR /app

COPY --from=builder /app/target/release/mock-llm /app/mock-llm
COPY config /app/config

EXPOSE 8000
USER app

CMD ["/app/mock-llm", "--config-dir", "/app/config"]
