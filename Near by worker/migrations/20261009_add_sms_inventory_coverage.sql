-- Additive schema only. Review, back up the database, and get approval before applying.
-- This migration has NOT been executed.
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS otp_challenge (
    id INTEGER PRIMARY KEY,
    phone VARCHAR(20) NOT NULL,
    role VARCHAR(10) NOT NULL,
    provider_sid VARCHAR(80) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_otp_challenge_phone ON otp_challenge (phone);

CREATE TABLE IF NOT EXISTS inventory_part (
    id INTEGER PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(80) NOT NULL,
    unit VARCHAR(30) NOT NULL,
    seller VARCHAR(120) NOT NULL,
    source_reference VARCHAR(300) NOT NULL,
    price_paise INTEGER,
    price_verified BOOLEAN NOT NULL DEFAULT 0,
    stock_quantity INTEGER,
    stock_verified BOOLEAN NOT NULL DEFAULT 0,
    stock_checked_at DATETIME,
    active BOOLEAN NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL,
    CONSTRAINT uq_inventory_part_seller UNIQUE (category, name, seller),
    CHECK (price_paise IS NULL OR price_paise >= 0),
    CHECK (stock_quantity IS NULL OR stock_quantity >= 0)
);

CREATE TABLE IF NOT EXISTS worker_labour_rate (
    id INTEGER PRIMARY KEY,
    worker_id INTEGER NOT NULL,
    service VARCHAR(120) NOT NULL,
    amount_paise INTEGER NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    active BOOLEAN NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL,
    CONSTRAINT uq_worker_labour_service UNIQUE (worker_id, service),
    CHECK (amount_paise >= 0)
);
CREATE INDEX IF NOT EXISTS ix_worker_labour_rate_worker_id ON worker_labour_rate (worker_id);

CREATE TABLE IF NOT EXISTS worker_coverage (
    worker_id INTEGER PRIMARY KEY,
    service_area VARCHAR(160) NOT NULL,
    radius_km FLOAT NOT NULL,
    updated_at DATETIME NOT NULL,
    CHECK (radius_km >= 1 AND radius_km <= 500)
);

CREATE TABLE IF NOT EXISTS booking_estimate (
    booking_id INTEGER PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at DATETIME NOT NULL
);

COMMIT;
