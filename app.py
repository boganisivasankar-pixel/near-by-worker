import os
import json
import math
import re
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from flask import Flask, request, jsonify, render_template
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import inspect
from sqlalchemy.engine import make_url
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    set_access_cookies,
    unset_jwt_cookies,
    jwt_required,
    get_jwt_identity
)
from flask_cors import CORS
from math import radians, sin, cos, sqrt, atan2
from parts_catalogue import PARTS_CATALOGUE
from sms_provider import SmsProviderError, SmsProviderNotConfigured, TwilioVerifyProvider


# =========================================================
# APP CONFIGURATION
# =========================================================

app = Flask(__name__)
CORS(app)

database_url = (
    os.environ.get("NEARBY_DATABASE_URL")
    or os.environ.get("DATABASE_URL")
    or "sqlite:///nearby_worker.db"
)
database_url_configured = bool(
    os.environ.get("NEARBY_DATABASE_URL") or os.environ.get("DATABASE_URL")
)
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)
elif database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)

app_environment = os.environ.get("APP_ENV", "development").lower()
jwt_secret_key = os.environ.get("JWT_SECRET_KEY")
if app_environment == "production":
    if not jwt_secret_key:
        raise RuntimeError("JWT_SECRET_KEY must be set when APP_ENV=production")
    if not database_url_configured:
        raise RuntimeError("Set NEARBY_DATABASE_URL or DATABASE_URL in production")
    if database_url.startswith("sqlite:"):
        if os.environ.get("NEARBY_ALLOW_PERSISTENT_SQLITE") != "1":
            raise RuntimeError("Production SQLite requires explicit persistent-storage opt-in")
        sqlite_path = make_url(database_url).database
        if not sqlite_path or not Path(sqlite_path).is_absolute():
            raise RuntimeError("Production SQLite requires an absolute database path")
        if not Path(sqlite_path).is_file():
            raise RuntimeError("The production SQLite database file must already exist")
    elif not database_url.startswith("postgresql+psycopg://"):
        raise RuntimeError("Production database URL must use PostgreSQL or explicitly enabled persistent SQLite")

app.config["SQLALCHEMY_DATABASE_URI"] = database_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["JWT_SECRET_KEY"] = jwt_secret_key or "local-development-key-not-for-deployment"
app.config["JWT_TOKEN_LOCATION"] = ["cookies", "headers"]
app.config["JWT_COOKIE_SECURE"] = app_environment == "production"
app.config["JWT_COOKIE_HTTPONLY"] = True
app.config["JWT_COOKIE_SAMESITE"] = "Lax"
app.config["JWT_COOKIE_CSRF_PROTECT"] = True
app.config["JWT_ACCESS_CSRF_HEADER_NAME"] = "X-CSRF-TOKEN"

db = SQLAlchemy(app)
jwt = JWTManager(app)

WORKER_CATEGORY_ALIASES = {
    "electrician": {"electrician", "electricians", "electrical"},
    "plumber": {"plumber", "plumbers", "plumbing"},
    "carpenter": {"carpenter", "carpenters", "carpentry"},
    "mechanic": {"mechanic", "mechanics"},
    "cleaner": {"cleaner", "cleaners", "cleaning"},
}
SAMPLE_WORKER_PHONES = {f"555-010{number}" for number in range(1, 7)}


def canonical_worker_category(value):
    normalized = value.strip().lower()
    for canonical, aliases in WORKER_CATEGORY_ALIASES.items():
        if normalized in aliases:
            return canonical
    return normalized


def is_sample_worker(worker):
    return worker.phone in SAMPLE_WORKER_PHONES


def normalize_coordinates(latitude, longitude):
    if latitude in (None, "") and longitude in (None, ""):
        return None, None
    if latitude in (None, "") or longitude in (None, ""):
        raise ValueError("latitude and longitude must be supplied together")
    latitude = float(latitude)
    longitude = float(longitude)
    if not math.isfinite(latitude) or not math.isfinite(longitude):
        raise ValueError("coordinates must be finite numbers")
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ValueError("coordinates are out of range")
    return latitude, longitude


def extended_schema_ready():
    return bool(app.config.get("EXTENDED_SCHEMA_READY", False))


def require_extended_schema():
    if not extended_schema_ready():
        return jsonify({"error": "Additive feature tables are not installed; apply the reviewed migration first"}), 503
    return None


def require_inventory_admin():
    if not str(get_jwt_identity() or "").startswith("admin:"):
        return jsonify({"error": "Administrator access is required"}), 403
    return None


def inr_to_paise(value):
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError("price must be a valid INR amount") from None
    if not amount.is_finite() or amount < 0 or amount.as_tuple().exponent < -2:
        raise ValueError("price must be a non-negative INR amount with at most two decimals")
    return int(amount * 100)


def serialize_inventory_part(part):
    stock_status = "unknown"
    stock_quantity = None
    if part.stock_verified:
        stock_quantity = part.stock_quantity
        stock_status = "in_stock" if (part.stock_quantity or 0) > 0 else "out_of_stock"
    return {
        "id": part.id,
        "name": part.name,
        "category": part.category,
        "unit": part.unit,
        "seller": part.seller,
        "price_inr": part.price_paise / 100 if part.price_verified and part.price_paise is not None else None,
        "price_verified": bool(part.price_verified),
        "stock_quantity": stock_quantity,
        "stock_verified": bool(part.stock_verified),
        "stock_status": stock_status,
        "source_reference": part.source_reference,
        "last_updated": part.updated_at.isoformat(timespec="seconds") + "Z" if part.updated_at else None,
        "is_sample_estimate": False,
    }


def parse_inventory_part(data, existing=None):
    required_text = ("name", "category", "unit", "seller", "source_reference")
    values = {}
    for field in required_text:
        value = data.get(field, getattr(existing, field, "") if existing else "")
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > 300:
            raise ValueError(f"{field} is required and must be at most 300 characters")
        values[field] = value.strip()

    price_verified = data.get("price_verified", existing.price_verified if existing else False)
    stock_verified = data.get("stock_verified", existing.stock_verified if existing else False)
    active = data.get("active", existing.active if existing else True)
    if not all(isinstance(value, bool) for value in (price_verified, stock_verified, active)):
        raise ValueError("verification and active fields must be booleans")

    price_value = data.get("price_inr")
    if price_value is None and existing and "price_inr" not in data and existing.price_paise is not None:
        price_paise = existing.price_paise
    elif price_verified:
        if price_value is None:
            raise ValueError("A verified price is required")
        price_paise = inr_to_paise(price_value)
    else:
        price_paise = None
    if price_verified and not values["source_reference"]:
        raise ValueError("A source reference is required for verified prices")

    stock_value = data.get("stock_quantity")
    stock_was_checked_now = "stock_verified" in data or "stock_quantity" in data
    if stock_value is None and existing and "stock_quantity" not in data and existing.stock_quantity is not None:
        stock_quantity = existing.stock_quantity
    elif stock_verified:
        if isinstance(stock_value, bool):
            raise ValueError("stock_quantity must be a non-negative integer")
        try:
            stock_quantity = int(stock_value)
        except (TypeError, ValueError):
            raise ValueError("Verified stock requires a non-negative integer quantity") from None
        if stock_quantity < 0 or str(stock_value).strip() != str(stock_quantity):
            raise ValueError("stock_quantity must be a non-negative integer")
    else:
        stock_quantity = None

    if not price_verified:
        price_paise = None
    if not stock_verified:
        stock_quantity = None
    return {
        **values,
        "price_paise": price_paise,
        "price_verified": price_verified,
        "stock_quantity": stock_quantity,
        "stock_verified": stock_verified,
        "stock_checked_at": (
            datetime.utcnow() if stock_verified and stock_was_checked_now
            else existing.stock_checked_at if existing and stock_verified
            else None
        ),
        "active": active,
        "updated_at": datetime.utcnow(),
    }


@app.route("/api/inventory/categories", methods=["GET"])
def inventory_categories():
    schema_error = require_extended_schema()
    if schema_error:
        return schema_error
    categories = db.session.query(InventoryPart.category).filter_by(active=True).distinct().order_by(InventoryPart.category).all()
    return jsonify([category for (category,) in categories])


@app.route("/api/inventory/parts", methods=["GET"])
def inventory_parts():
    schema_error = require_extended_schema()
    if schema_error:
        return schema_error
    query = InventoryPart.query.filter_by(active=True)
    category = request.args.get("category", "").strip()
    search = request.args.get("q", "").strip()
    if len(category) > 80 or len(search) > 100:
        return jsonify({"error": "Search filters are too long"}), 400
    if category:
        query = query.filter(InventoryPart.category.ilike(f"%{category}%"))
    if search:
        query = query.filter(db.or_(
            InventoryPart.name.ilike(f"%{search}%"),
            InventoryPart.category.ilike(f"%{search}%")
        ))
    return jsonify([serialize_inventory_part(part) for part in query.order_by(InventoryPart.category, InventoryPart.name).all()])


@app.route("/api/admin/inventory", methods=["GET"])
@jwt_required()
def admin_inventory_list():
    denied = require_inventory_admin()
    if denied:
        return denied
    schema_error = require_extended_schema()
    if schema_error:
        return schema_error
    return jsonify([serialize_inventory_part(part) for part in InventoryPart.query.order_by(InventoryPart.category, InventoryPart.name).all()])


def save_inventory_part(data, part=None):
    try:
        values = parse_inventory_part(data, part)
    except (TypeError, ValueError) as error:
        return jsonify({"error": str(error)}), 400
    created = part is None
    if created:
        part = InventoryPart(**values)
        db.session.add(part)
    else:
        for field, value in values.items():
            setattr(part, field, value)
    db.session.commit()
    return jsonify(serialize_inventory_part(part)), 201 if created else 200


@app.route("/api/admin/inventory", methods=["POST"])
@jwt_required()
def admin_inventory_create():
    denied = require_inventory_admin()
    if denied:
        return denied
    schema_error = require_extended_schema()
    if schema_error:
        return schema_error
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON data is required"}), 400
    return save_inventory_part(data)


@app.route("/api/admin/inventory/<int:part_id>", methods=["PUT"])
@jwt_required()
def admin_inventory_update(part_id):
    denied = require_inventory_admin()
    if denied:
        return denied
    schema_error = require_extended_schema()
    if schema_error:
        return schema_error
    part = db.session.get(InventoryPart, part_id)
    if not part:
        return jsonify({"error": "Inventory item not found"}), 404
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON data is required"}), 400
    return save_inventory_part(data, part)


@app.route("/api/workers/<int:worker_id>/labour-rates", methods=["GET"])
def get_worker_labour_rates(worker_id):
    schema_error = require_extended_schema()
    if schema_error:
        return schema_error
    worker = db.session.get(Worker, worker_id)
    if not worker:
        return jsonify({"error": "Worker not found"}), 404
    rates = WorkerLabourRate.query.filter_by(worker_id=worker_id, active=True).order_by(WorkerLabourRate.service).all()
    return jsonify([{
        "id": rate.id,
        "worker_id": rate.worker_id,
        "service": rate.service,
        "amount_inr": rate.amount_paise / 100,
        "currency": rate.currency,
        "updated_at": rate.updated_at.isoformat(timespec="seconds") + "Z",
        "quote_source": "worker"
    } for rate in rates])


@app.route("/api/workers/<int:worker_id>/labour-rates", methods=["POST"])
@jwt_required()
def save_worker_labour_rate(worker_id):
    if get_jwt_identity() != f"worker:{worker_id}":
        return jsonify({"error": "Only this worker can manage labour rates"}), 403
    schema_error = require_extended_schema()
    if schema_error:
        return schema_error
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON data is required"}), 400
    service = data.get("service")
    active = data.get("active", True)
    if not isinstance(service, str) or not service.strip() or len(service.strip()) > 120:
        return jsonify({"error": "service is required and must be at most 120 characters"}), 400
    if not isinstance(active, bool):
        return jsonify({"error": "active must be a boolean"}), 400
    try:
        amount_paise = inr_to_paise(data.get("amount_inr"))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    rate = WorkerLabourRate.query.filter_by(worker_id=worker_id, service=service.strip()).first()
    if rate is None:
        rate = WorkerLabourRate(worker_id=worker_id, service=service.strip())
        db.session.add(rate)
    rate.amount_paise = amount_paise
    rate.active = active
    rate.currency = "INR"
    rate.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"message": "Worker labour quote saved", "id": rate.id, "service": rate.service, "amount_inr": rate.amount_paise / 100, "currency": rate.currency})


@app.route("/api/workers/<int:worker_id>/coverage", methods=["GET"])
def get_worker_coverage(worker_id):
    schema_error = require_extended_schema()
    if schema_error:
        return schema_error
    coverage = db.session.get(WorkerCoverage, worker_id)
    if not coverage:
        return jsonify({"error": "Worker service area has not been set"}), 404
    return jsonify({"worker_id": coverage.worker_id, "service_area": coverage.service_area, "radius_km": coverage.radius_km, "updated_at": coverage.updated_at.isoformat(timespec="seconds") + "Z"})


@app.route("/api/workers/<int:worker_id>/coverage", methods=["PUT"])
@jwt_required()
def update_worker_coverage(worker_id):
    if get_jwt_identity() != f"worker:{worker_id}":
        return jsonify({"error": "Only this worker can update service coverage"}), 403
    schema_error = require_extended_schema()
    if schema_error:
        return schema_error
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON data is required"}), 400
    area = data.get("service_area")
    try:
        radius = float(data.get("radius_km"))
    except (TypeError, ValueError):
        return jsonify({"error": "radius_km must be a number"}), 400
    if not isinstance(area, str) or not area.strip() or len(area.strip()) > 160:
        return jsonify({"error": "service_area is required and must be at most 160 characters"}), 400
    if not math.isfinite(radius) or not 1 <= radius <= 500:
        return jsonify({"error": "radius_km must be between 1 and 500"}), 400
    coverage = db.session.get(WorkerCoverage, worker_id)
    if coverage is None:
        coverage = WorkerCoverage(worker_id=worker_id, service_area=area.strip(), radius_km=radius)
        db.session.add(coverage)
    else:
        coverage.service_area = area.strip()
        coverage.radius_km = radius
        coverage.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"worker_id": worker_id, "service_area": coverage.service_area, "radius_km": coverage.radius_km, "updated_at": coverage.updated_at.isoformat(timespec="seconds") + "Z"})


# =========================================================
# USER MODEL
# =========================================================

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)


# =========================================================
# WORKER MODEL
# =========================================================

class Worker(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)

    category = db.Column(db.String(50), nullable=False)
    services = db.Column(db.String(500))

    rating = db.Column(db.Float, default=0)
    reviews = db.Column(db.Integer, default=0)

    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)

    available = db.Column(db.Boolean, default=True)

    charge = db.Column(db.Float, default=0)
    spare_parts = db.Column(db.String(500))


# =========================================================
# BOOKING MODEL
# =========================================================

class Booking(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    user_id = db.Column(db.Integer, nullable=False)
    worker_id = db.Column(db.Integer, nullable=False)

    service = db.Column(db.String(200), nullable=False)

    status = db.Column(db.String(50), default="pending")

    charge = db.Column(db.Float, default=0)
    spare_parts = db.Column(db.String(500))

    address = db.Column(db.String(300))


# =========================================================
# REVIEW MODEL
# =========================================================

class Review(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    user_id = db.Column(db.Integer, nullable=False)
    worker_id = db.Column(db.Integer, nullable=False)

    rating = db.Column(db.Float, nullable=False)
    review = db.Column(db.String(500))


class PartCatalog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    category = db.Column(db.String(80), nullable=False)
    min_price = db.Column(db.Integer, nullable=False)
    max_price = db.Column(db.Integer, nullable=False)
    unit = db.Column(db.String(30), nullable=False, default="piece")
    __table_args__ = (
        db.UniqueConstraint("category", "name", name="uq_part_category_name"),
    )


class OtpChallenge(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    phone = db.Column(db.String(20), nullable=False, index=True)
    role = db.Column(db.String(10), nullable=False)
    provider_sid = db.Column(db.String(80), nullable=False)
    status = db.Column(db.String(16), nullable=False, default="pending")
    attempts = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)


class InventoryPart(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    category = db.Column(db.String(80), nullable=False)
    unit = db.Column(db.String(30), nullable=False)
    seller = db.Column(db.String(120), nullable=False)
    source_reference = db.Column(db.String(300), nullable=False)
    price_paise = db.Column(db.Integer)
    price_verified = db.Column(db.Boolean, nullable=False, default=False)
    stock_quantity = db.Column(db.Integer)
    stock_verified = db.Column(db.Boolean, nullable=False, default=False)
    stock_checked_at = db.Column(db.DateTime)
    active = db.Column(db.Boolean, nullable=False, default=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    __table_args__ = (
        db.UniqueConstraint("category", "name", "seller", name="uq_inventory_part_seller"),
    )


class WorkerLabourRate(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    worker_id = db.Column(db.Integer, nullable=False, index=True)
    service = db.Column(db.String(120), nullable=False)
    amount_paise = db.Column(db.Integer, nullable=False)
    currency = db.Column(db.String(3), nullable=False, default="INR")
    active = db.Column(db.Boolean, nullable=False, default=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    __table_args__ = (
        db.UniqueConstraint("worker_id", "service", name="uq_worker_labour_service"),
    )


class WorkerCoverage(db.Model):
    worker_id = db.Column(db.Integer, primary_key=True)
    service_area = db.Column(db.String(160), nullable=False)
    radius_km = db.Column(db.Float, nullable=False)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class BookingEstimate(db.Model):
    booking_id = db.Column(db.Integer, primary_key=True)
    payload = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class OtpChallenge(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    phone = db.Column(db.String(20), nullable=False, index=True)
    role = db.Column(db.String(10), nullable=False)
    provider_sid = db.Column(db.String(80), nullable=False)
    status = db.Column(db.String(16), nullable=False, default="pending")
    attempts = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)


class InventoryPart(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    category = db.Column(db.String(80), nullable=False)
    unit = db.Column(db.String(30), nullable=False)
    seller = db.Column(db.String(120), nullable=False)
    source_reference = db.Column(db.String(300), nullable=False)
    price_paise = db.Column(db.Integer)
    price_verified = db.Column(db.Boolean, nullable=False, default=False)
    stock_quantity = db.Column(db.Integer)
    stock_verified = db.Column(db.Boolean, nullable=False, default=False)
    stock_checked_at = db.Column(db.DateTime)
    active = db.Column(db.Boolean, nullable=False, default=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    __table_args__ = (
        db.UniqueConstraint("category", "name", "seller", name="uq_inventory_part_seller"),
    )


class WorkerLabourRate(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    worker_id = db.Column(db.Integer, nullable=False, index=True)
    service = db.Column(db.String(120), nullable=False)
    amount_paise = db.Column(db.Integer, nullable=False)
    currency = db.Column(db.String(3), nullable=False, default="INR")
    active = db.Column(db.Boolean, nullable=False, default=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    __table_args__ = (
        db.UniqueConstraint("worker_id", "service", name="uq_worker_labour_service"),
    )


class WorkerCoverage(db.Model):
    worker_id = db.Column(db.Integer, primary_key=True)
    service_area = db.Column(db.String(160), nullable=False)
    radius_km = db.Column(db.Float, nullable=False)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


# =========================================================
# HOME
# =========================================================

@app.route("/")
def home():
    return render_template("index.html")


# =========================================================
# HEALTH CHECK
# =========================================================

@app.route("/api/health")
def health():
    return jsonify({
        "status": "OK",
        "message": "Backend is healthy"
    })


@app.route("/api/auth/me", methods=["GET"])
@jwt_required()
def current_account():
    identity = get_jwt_identity()
    try:
        role, account_id = identity.split(":", 1)
        account_id = int(account_id)
    except (AttributeError, ValueError):
        return jsonify({"error": "Invalid account identity"}), 401

    if role == "user":
        account = db.session.get(User, account_id)
    elif role == "worker":
        account = db.session.get(Worker, account_id)
    elif role == "admin":
        return jsonify({"id": identity.split(":", 1)[1], "role": role, "name": "Inventory administrator"})
    else:
        account = None
    if account is None:
        return jsonify({"error": "Account no longer exists"}), 401
    return jsonify({"id": account.id, "role": role, "name": account.name})


@app.route("/api/auth/logout", methods=["POST"])
@jwt_required()
def logout():
    response = jsonify({"message": "Signed out"})
    unset_jwt_cookies(response)
    return response


@app.route("/api/admin/login", methods=["POST"])
def admin_login():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON data is required"}), 400
    username = os.environ.get("INVENTORY_ADMIN_USERNAME", "").strip()
    password_hash = os.environ.get("INVENTORY_ADMIN_PASSWORD_HASH", "")
    if not username or not password_hash:
        return jsonify({"error": "Inventory administrator is not configured on the server"}), 503
    submitted_username = data.get("username")
    submitted_password = data.get("password")
    if not isinstance(submitted_username, str) or not isinstance(submitted_password, str):
        return jsonify({"error": "Invalid administrator credentials"}), 401
    if submitted_username.strip() != username or not check_password_hash(password_hash, submitted_password):
        return jsonify({"error": "Invalid administrator credentials"}), 401
    token = create_access_token(identity=f"admin:{username}")
    response = jsonify({"message": "Administrator login successful", "token": token, "admin_id": username})
    set_access_cookies(response, token)
    return response


@app.route("/api/auth/otp/request", methods=["POST"])
def request_sms_otp():
    try:
        provider = TwilioVerifyProvider.from_environment()
    except SmsProviderNotConfigured:
        return jsonify({"error": "SMS sign-in is not configured. Ask the site administrator to configure the SMS provider."}), 503

    schema_error = require_extended_schema()
    if schema_error:
        return schema_error

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON data is required"}), 400
    phone = data.get("phone")
    role = data.get("role")
    if not isinstance(phone, str) or not re.fullmatch(r"\+[1-9][0-9]{7,14}", phone.strip()):
        return jsonify({"error": "Enter a phone number in international E.164 format, such as +14155552671"}), 400
    phone = phone.strip()
    if role not in {"user", "worker"}:
        return jsonify({"error": "Choose a customer or worker account"}), 400

    account = (User.query.filter_by(phone=phone).first() if role == "user"
               else Worker.query.filter_by(phone=phone).first())
    if account is None:
        return jsonify({"message": "If this number belongs to an account, a verification code will be sent."}), 202

    now = datetime.utcnow()
    recent_count = OtpChallenge.query.filter(
        OtpChallenge.phone == phone,
        OtpChallenge.role == role,
        OtpChallenge.created_at >= now - timedelta(hours=1)
    ).count()
    latest = OtpChallenge.query.filter_by(phone=phone, role=role).order_by(OtpChallenge.created_at.desc()).first()
    if recent_count >= 5:
        return jsonify({"error": "Too many code requests. Try again later."}), 429
    if latest and latest.created_at > now - timedelta(seconds=60):
        return jsonify({"error": "Please wait before requesting another code."}), 429

    try:
        provider_sid = provider.send_code(phone)
    except SmsProviderError:
        return jsonify({"error": "SMS provider could not send the verification code."}), 502
    if not provider_sid:
        return jsonify({"error": "SMS provider did not confirm a verification request."}), 502

    db.session.add(OtpChallenge(
        phone=phone,
        role=role,
        provider_sid=provider_sid,
        status="pending",
        expires_at=now + timedelta(minutes=5),
    ))
    db.session.commit()
    return jsonify({"message": "Verification code requested. It expires in five minutes."}), 202


@app.route("/api/auth/otp/verify", methods=["POST"])
def verify_sms_otp():
    try:
        provider = TwilioVerifyProvider.from_environment()
    except SmsProviderNotConfigured:
        return jsonify({"error": "SMS sign-in is not configured on the server."}), 503

    schema_error = require_extended_schema()
    if schema_error:
        return schema_error

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON data is required"}), 400
    phone = data.get("phone")
    role = data.get("role")
    code = data.get("code")
    if not isinstance(phone, str) or not re.fullmatch(r"\+[1-9][0-9]{7,14}", phone.strip()):
        return jsonify({"error": "Phone number is invalid"}), 400
    if role not in {"user", "worker"} or not isinstance(code, str) or not re.fullmatch(r"[0-9]{4,10}", code):
        return jsonify({"error": "Verification code or account role is invalid"}), 400

    phone = phone.strip()
    now = datetime.utcnow()
    challenge = OtpChallenge.query.filter_by(phone=phone, role=role, status="pending").order_by(OtpChallenge.created_at.desc()).first()
    if challenge is None or challenge.expires_at < now:
        return jsonify({"error": "Verification code expired or not requested"}), 401
    if challenge.attempts >= 5:
        return jsonify({"error": "Too many verification attempts. Request a new code later."}), 429

    challenge.attempts += 1
    db.session.commit()
    try:
        verified = provider.verify_code(phone, code)
    except SmsProviderError:
        return jsonify({"error": "SMS provider could not verify the code. Try again later."}), 502
    if not verified:
        if challenge.attempts >= 5:
            challenge.status = "locked"
            db.session.commit()
        return jsonify({"error": "Verification code is invalid"}), 401

    challenge.status = "approved"
    db.session.commit()
    account = User.query.filter_by(phone=phone).first() if role == "user" else Worker.query.filter_by(phone=phone).first()
    if account is None:
        return jsonify({"error": "No account is registered for this phone and role"}), 401

    token = create_access_token(identity=f"{role}:{account.id}")
    response = jsonify({"message": "SMS sign-in successful", "token": token, f"{role}_id": account.id})
    set_access_cookies(response, token)
    return response


@app.route("/api/categories", methods=["GET"])
def get_categories():
    return jsonify([
        "electrician", "plumber", "carpenter", "mechanic", "cleaner"
    ])


@app.route("/api/parts/categories", methods=["GET"])
def get_part_categories():
    categories = db.session.query(PartCatalog.category).distinct().order_by(PartCatalog.category).all()
    return jsonify([category for (category,) in categories])


@app.route("/api/parts", methods=["GET"])
def search_parts():
    query = PartCatalog.query
    category = request.args.get("category", "").strip()
    search = request.args.get("q", "").strip()

    if len(search) > 100 or len(category) > 80:
        return jsonify({"error": "Search filters are too long"}), 400
    if category:
        query = query.filter(PartCatalog.category == category)
    if search:
        query = query.filter(PartCatalog.name.ilike(f"%{search}%"))

    return jsonify([
        {
            "id": part.id,
            "name": part.name,
            "category": part.category,
            "min_price": part.min_price,
            "max_price": part.max_price,
            "unit": part.unit,
            "currency": "INR",
            "is_sample_estimate": True
        }
        for part in query.order_by(PartCatalog.category, PartCatalog.name).all()
    ])


# =========================================================
# USER REGISTER
# =========================================================

@app.route("/api/users/register", methods=["POST"])
def user_register():

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "JSON data is required"
        }), 400

    name = data.get("name")
    phone = data.get("phone")
    password = data.get("password")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
        return jsonify({"error": "Name is required and must be at most 100 characters"}), 400
    if not isinstance(phone, str) or not phone.strip() or len(phone.strip()) > 20:
        return jsonify({"error": "Phone is required and must be at most 20 characters"}), 400
    if not isinstance(password, str) or len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400
    try:
        latitude, longitude = normalize_coordinates(data.get("latitude"), data.get("longitude"))
    except (TypeError, ValueError) as error:
        return jsonify({"error": str(error)}), 400

    phone = phone.strip()

    if User.query.filter_by(phone=phone).first():
        return jsonify({
            "error": "User already exists"
        }), 409

    user = User(
        name=name.strip(),
        phone=phone,
        password=generate_password_hash(password),
        latitude=latitude,
        longitude=longitude
    )

    db.session.add(user)
    db.session.commit()

    return jsonify({
        "message": "User registered successfully",
        "user_id": user.id
    }), 201


# =========================================================
# USER LOGIN
# =========================================================

@app.route("/api/users/login", methods=["POST"])
def user_login():

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "JSON data is required"
        }), 400

    phone = data.get("phone")
    phone = phone.strip() if isinstance(phone, str) else ""
    password = data.get("password")
    password = password if isinstance(password, str) else ""
    user = User.query.filter_by(phone=phone).first()

    if not user:
        return jsonify({
            "error": "Invalid phone or password"
        }), 401

    if not check_password_hash(
        user.password,
        password
    ):
        return jsonify({
            "error": "Invalid phone or password"
        }), 401

    token = create_access_token(
        identity=f"user:{user.id}"
    )

    response = jsonify({
        "message": "Login successful",
        "token": token,
        "user_id": user.id
    })
    set_access_cookies(response, token)
    return response


# =========================================================
# WORKER REGISTER
# =========================================================

@app.route("/api/workers/register", methods=["POST"])
def worker_register():

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "JSON data is required"
        }), 400

    required = [
        "name",
        "phone",
        "password",
        "category"
    ]

    for field in required:
        if not data.get(field):
            return jsonify({
                "error": f"{field} is required"
            }), 400

    for field, limit in (("name", 100), ("phone", 20), ("category", 50)):
        value = data.get(field)
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
            return jsonify({"error": f"{field} must be non-empty and at most {limit} characters"}), 400
    if not isinstance(data.get("password"), str) or len(data["password"]) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400
    services = data.get("services", "")
    spare_parts = data.get("spare_parts", "")
    if not isinstance(services, str) or len(services) > 500:
        return jsonify({"error": "services must be text no longer than 500 characters"}), 400
    if not isinstance(spare_parts, str) or len(spare_parts) > 500:
        return jsonify({"error": "spare_parts must be text no longer than 500 characters"}), 400

    try:
        charge = float(data.get("charge", 0))
        latitude, longitude = normalize_coordinates(data.get("latitude"), data.get("longitude"))
    except (TypeError, ValueError) as error:
        return jsonify({"error": str(error) if str(error) else "charge must be a number"}), 400
    if not math.isfinite(charge) or charge < 0:
        return jsonify({"error": "charge must be a finite, non-negative amount"}), 400
    available = data.get("available", True)
    if not isinstance(available, bool):
        return jsonify({"error": "available must be a boolean"}), 400

    phone = data["phone"].strip()

    if Worker.query.filter_by(
        phone=phone
    ).first():

        return jsonify({
            "error": "Worker already exists"
        }), 409

    worker = Worker(
        name=data["name"].strip(),
        phone=phone,
        password=generate_password_hash(data["password"]),
        category=canonical_worker_category(data["category"]),
        services=services.strip(),
        latitude=latitude,
        longitude=longitude,
        charge=charge,
        spare_parts=spare_parts.strip(),
        available=available
    )

    db.session.add(worker)
    db.session.commit()

    return jsonify({
        "message": "Worker registered successfully",
        "worker_id": worker.id
    }), 201


# =========================================================
# WORKER LOGIN
# =========================================================

@app.route("/api/workers/login", methods=["POST"])
def worker_login():

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "JSON data is required"
        }), 400

    phone = data.get("phone")
    phone = phone.strip() if isinstance(phone, str) else ""
    password = data.get("password")
    password = password if isinstance(password, str) else ""
    worker = Worker.query.filter_by(phone=phone).first()

    if not worker:
        return jsonify({
            "error": "Invalid phone or password"
        }), 401

    if not check_password_hash(
        worker.password,
        password
    ):
        return jsonify({
            "error": "Invalid phone or password"
        }), 401

    token = create_access_token(
        identity=f"worker:{worker.id}"
    )

    response = jsonify({
        "message": "Login successful",
        "token": token,
        "worker_id": worker.id
    })
    set_access_cookies(response, token)
    return response


# =========================================================
# WORKER PROFILE
# =========================================================

@app.route("/api/workers/<int:worker_id>", methods=["GET"])
def worker_profile(worker_id):

    worker = db.session.get(
        Worker,
        worker_id
    )

    if not worker:
        return jsonify({
            "error": "Worker not found"
        }), 404

    labour_rates = []
    coverage_data = None
    if extended_schema_ready():
        labour_rates = WorkerLabourRate.query.filter_by(worker_id=worker_id, active=True).order_by(WorkerLabourRate.service).all()
        coverage = db.session.get(WorkerCoverage, worker_id)
        if coverage:
            coverage_data = {
                "service_area": coverage.service_area,
                "radius_km": coverage.radius_km,
                "updated_at": coverage.updated_at.isoformat(timespec="seconds") + "Z"
            }

    return jsonify({
        "id": worker.id,
        "name": worker.name,
        "phone": worker.phone,
        "category": worker.category,
        "services": worker.services,
        "rating": worker.rating,
        "reviews": worker.reviews,
        "latitude": worker.latitude,
        "longitude": worker.longitude,
        "available": worker.available,
        "charge": worker.charge,
        "spare_parts": worker.spare_parts,
        "is_sample_profile": is_sample_worker(worker),
        "labour_rates": [{
            "id": rate.id,
            "service": rate.service,
            "amount_inr": rate.amount_paise / 100,
            "currency": rate.currency,
            "updated_at": rate.updated_at.isoformat(timespec="seconds") + "Z"
        } for rate in labour_rates],
        "coverage": coverage_data
    })


@app.route("/api/workers/<int:worker_id>", methods=["PUT"])
@jwt_required()
def update_worker_profile(worker_id):
    if get_jwt_identity() != f"worker:{worker_id}":
        return jsonify({"error": "Only this worker can update this profile"}), 403

    worker = db.session.get(Worker, worker_id)
    if not worker:
        return jsonify({"error": "Worker not found"}), 404

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON data is required"}), 400

    name = data.get("name", worker.name)
    phone = data.get("phone", worker.phone)
    category = data.get("category", worker.category)
    services = data.get("services", worker.services or "")
    spare_parts = data.get("spare_parts", worker.spare_parts or "")

    for field, value, limit in (
        ("name", name, 100),
        ("phone", phone, 20),
        ("category", category, 50),
        ("services", services, 500),
        ("spare_parts", spare_parts, 500),
    ):
        if not isinstance(value, str) or len(value.strip()) > limit:
            return jsonify({"error": f"{field} must be text no longer than {limit} characters"}), 400
        if field in {"name", "phone", "category"} and not value.strip():
            return jsonify({"error": f"{field} is required"}), 400

    phone = phone.strip()
    existing_worker = Worker.query.filter(
        Worker.phone == phone,
        Worker.id != worker.id
    ).first()
    if existing_worker:
        return jsonify({"error": "That phone number is already in use"}), 409

    try:
        charge = float(data.get("charge", worker.charge or 0))
    except (TypeError, ValueError):
        return jsonify({"error": "charge must be a number"}), 400
    if not math.isfinite(charge) or charge < 0:
        return jsonify({"error": "charge must be a finite, non-negative amount"}), 400

    latitude = data.get("latitude", worker.latitude)
    longitude = data.get("longitude", worker.longitude)
    if (latitude is None) != (longitude is None):
        return jsonify({"error": "latitude and longitude must be supplied together"}), 400
    if latitude is not None:
        try:
            latitude = float(latitude)
            longitude = float(longitude)
        except (TypeError, ValueError):
            return jsonify({"error": "coordinates must be numbers"}), 400
        if not math.isfinite(latitude) or not math.isfinite(longitude):
            return jsonify({"error": "coordinates must be finite numbers"}), 400
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            return jsonify({"error": "coordinates are out of range"}), 400

    worker.name = name.strip()
    worker.phone = phone
    worker.category = canonical_worker_category(category)
    worker.services = services.strip()
    worker.spare_parts = spare_parts.strip()
    worker.charge = charge
    worker.latitude = latitude
    worker.longitude = longitude
    db.session.commit()

    return jsonify({
        "message": "Worker profile updated",
        "id": worker.id,
        "name": worker.name,
        "phone": worker.phone,
        "category": worker.category,
        "services": worker.services,
        "latitude": worker.latitude,
        "longitude": worker.longitude,
        "available": worker.available,
        "charge": worker.charge,
        "spare_parts": worker.spare_parts
    })
        "labour_rates": [{
            "id": rate.id,
            "service": rate.service,
            "amount_inr": rate.amount_paise / 100,
            "currency": rate.currency,
            "updated_at": rate.updated_at.isoformat(timespec="seconds") + "Z"
        } for rate in labour_rates],


# =========================================================
# SEARCH WORKERS
# =========================================================

@app.route("/api/workers/search", methods=["GET"])
def search_workers():

    category = request.args.get("category")

    query = Worker.query

    if category:
        canonical_category = canonical_worker_category(category)
        query = query.filter(
            Worker.category.ilike(
                f"%{canonical_category}%"
            )
        )

    service = (request.args.get("service") or "").strip()
    if service:
        canonical_service_category = canonical_worker_category(service)
        query = query.filter(
            db.or_(
                Worker.services.ilike(f"%{service}%"),
                Worker.name.ilike(f"%{service}%"),
                Worker.category.ilike(f"%{service}%"),
                Worker.category.ilike(f"%{canonical_service_category}%")
            )
        )

    workers = query.all()

    result = []

    for worker in workers:

        result.append({
            "id": worker.id,
            "name": worker.name,
            "phone": worker.phone,
            "category": worker.category,
            "services": worker.services,
            "rating": worker.rating,
            "reviews": worker.reviews,
            "available": worker.available,
            "charge": worker.charge,
            "spare_parts": worker.spare_parts,
            "latitude": worker.latitude,
            "longitude": worker.longitude,
            "is_sample_profile": is_sample_worker(worker)
        })

    return jsonify(result)


# =========================================================
# NEARBY WORKERS
# =========================================================

@app.route("/api/workers/nearby", methods=["GET"])
def nearby_workers():
    schema_error = require_extended_schema()
    if schema_error:
        return schema_error

    try:
        user_lat = float(
            request.args.get("latitude")
        )

        user_lon = float(
            request.args.get("longitude")
        )

        radius = float(
            request.args.get("radius", 10)
        )

    except (TypeError, ValueError):

        return jsonify({
            "error": "latitude and longitude are required"
        }), 400

    if not all(math.isfinite(value) for value in (user_lat, user_lon, radius)):
        return jsonify({"error": "Coordinates and radius must be finite numbers"}), 400
    if not -90 <= user_lat <= 90 or not -180 <= user_lon <= 180:
        return jsonify({"error": "latitude or longitude is out of range"}), 400
    if not 0 < radius <= 500:
        return jsonify({"error": "radius must be greater than 0 and at most 500 km"}), 400

    category = request.args.get("category")
    canonical_category = canonical_worker_category(category) if category else ""
    service = (request.args.get("service") or "").strip().lower()
    if len(service) > 100:
        return jsonify({"error": "service search is too long"}), 400

    workers = Worker.query.filter_by(
        available=True
    ).all()
    coverage_by_worker = {
        coverage.worker_id: coverage
        for coverage in WorkerCoverage.query.filter(
            WorkerCoverage.worker_id.in_([worker.id for worker in workers])
        ).all()
    } if workers else {}

    result = []

    for worker in workers:

        if is_sample_worker(worker):
            continue

        if worker.latitude is None:
            continue

        if worker.longitude is None:
            continue

        if category and canonical_worker_category(worker.category) != canonical_category:
            continue

        if service:
            searchable_text = " ".join((worker.name or "", worker.category or "", worker.services or "")).lower()
            service_category = canonical_worker_category(service)
            if service not in searchable_text and service_category not in searchable_text:
                continue

        coverage = coverage_by_worker.get(worker.id)
        if coverage is None:
            continue

        lat1 = radians(user_lat)
        lon1 = radians(user_lon)

        lat2 = radians(worker.latitude)
        lon2 = radians(worker.longitude)

        dlat = lat2 - lat1
        dlon = lon2 - lon1

        a = (
            sin(dlat / 2) ** 2
            +
            cos(lat1)
            * cos(lat2)
            * sin(dlon / 2) ** 2
        )

        a = min(1.0, max(0.0, a))
        c = 2 * atan2(
            sqrt(a),
            sqrt(1.0 - a)
        )

        distance = 6371 * c

        if distance <= min(radius, coverage.radius_km):

            result.append({
                "id": worker.id,
                "name": worker.name,
                "category": worker.category,
                "services": worker.services,
                "rating": worker.rating,
                "reviews": worker.reviews,
                "distance_km": round(distance, 2),
                "available": worker.available,
                "charge": worker.charge,
                "spare_parts": worker.spare_parts
                ,"service_area": coverage.service_area,
                "service_radius_km": coverage.radius_km
            })

    result.sort(
        key=lambda x: x["distance_km"]
    )

    return jsonify(result)


# =========================================================
# WORKER AVAILABILITY
# =========================================================

@app.route(
    "/api/workers/<int:worker_id>/availability",
    methods=["PUT"]
)
@jwt_required()
def update_availability(worker_id):

    identity = get_jwt_identity()
    if identity != f"worker:{worker_id}":
        return jsonify({"error": "Only this worker can update availability"}), 403

    worker = db.session.get(
        Worker,
        worker_id
    )

    if not worker:
        return jsonify({
            "error": "Worker not found"
        }), 404

    data = request.get_json()

    if not isinstance(data, dict) or "available" not in data:
        return jsonify({
            "error": "available is required"
        }), 400

    if not isinstance(data["available"], bool):
        return jsonify({"error": "available must be a boolean"}), 400

    worker.available = data["available"]

    db.session.commit()

    return jsonify({
        "message": "Availability updated",
        "available": worker.available
    })


# =========================================================
# CREATE BOOKING
# =========================================================

def validate_booking_estimate(worker_id, submitted):
    if not extended_schema_ready():
        return None, (jsonify({"error": "Itemized estimates require the reviewed database migration"}), 503)
    if not isinstance(submitted, dict):
        return None, (jsonify({"error": "estimate must be an object"}), 400)
    try:
        labour_rate_id = int(submitted.get("labour_rate_id"))
    except (TypeError, ValueError):
        return None, (jsonify({"error": "Choose a worker labour quote"}), 400)
    labour_rate = WorkerLabourRate.query.filter_by(
        id=labour_rate_id, worker_id=worker_id, active=True, currency="INR"
    ).first()
    if not labour_rate:
        return None, (jsonify({"error": "Worker labour quote is unavailable; refresh rates"}), 409)

    submitted_parts = submitted.get("parts", [])
    if not isinstance(submitted_parts, list) or len(submitted_parts) > 50:
        return None, (jsonify({"error": "estimate parts must be a list of at most 50 items"}), 400)

    snapshot_parts = []
    seen_part_ids = set()
    subtotal_paise = 0
    for line in submitted_parts:
        if not isinstance(line, dict):
            return None, (jsonify({"error": "estimate part entries must be objects"}), 400)
        try:
            part_id = int(line.get("id"))
            quantity = int(line.get("quantity"))
        except (TypeError, ValueError):
            return None, (jsonify({"error": "each estimate part needs an item ID and integer quantity"}), 400)
        if part_id in seen_part_ids or not 1 <= quantity <= 999:
            return None, (jsonify({"error": "duplicate parts or invalid quantity"}), 400)
        seen_part_ids.add(part_id)
        part = db.session.get(InventoryPart, part_id)
        if not part or not part.active:
            return None, (jsonify({"error": "A selected inventory item is unavailable"}), 409)
        if not part.price_verified or part.price_paise is None:
            return None, (jsonify({"error": f"Price is not verified for {part.name}"}), 409)
        if part.stock_verified and (part.stock_quantity or 0) < quantity:
            return None, (jsonify({"error": f"Insufficient verified stock for {part.name}"}), 409)

        line_total = part.price_paise * quantity
        subtotal_paise += line_total
        snapshot_parts.append({
            "inventory_part_id": part.id,
            "name": part.name,
            "category": part.category,
            "seller": part.seller,
            "quantity": quantity,
            "unit": part.unit,
            "unit_price_paise": part.price_paise,
            "line_total_paise": line_total,
            "price_source": part.source_reference,
            "stock_status_at_quote": (
                "in_stock" if (part.stock_quantity or 0) > 0 else "out_of_stock"
            ) if part.stock_verified else "unknown",
            "stock_checked_at": part.stock_checked_at.isoformat(timespec="seconds") + "Z" if part.stock_checked_at else None,
        })

    labour_paise = labour_rate.amount_paise
    total_paise = subtotal_paise + labour_paise
    return {
        "currency": "INR",
        "is_sample_estimate": False,
        "repair_service": labour_rate.service,
        "worker_id": worker_id,
        "labour_rate_id": labour_rate.id,
        "labour_amount_paise": labour_paise,
        "parts": snapshot_parts,
        "parts_subtotal_paise": subtotal_paise,
        "total_paise": total_paise,
        "stock_note": "Stock is not reserved by this estimate; reconfirm availability with the seller/worker.",
        "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }, None

@app.route("/api/bookings", methods=["POST"])
@jwt_required()
def create_booking():

    identity = get_jwt_identity()

    if not identity.startswith("user:"):
        return jsonify({
            "error": "Only users can create bookings"
        }), 403

    user_id = int(
        identity.split(":")[1]
    )

    data = request.get_json()

    if not data:
        return jsonify({
            "error": "JSON data is required"
        }), 400

    if not data.get("worker_id"):
        return jsonify({
            "error": "worker_id is required"
        }), 400

    if not data.get("service"):
        return jsonify({
            "error": "service is required"
        }), 400

    worker = db.session.get(
        Worker,
        data["worker_id"]
    )

    if not worker:
        return jsonify({
            "error": "Worker not found"
        }), 404

    if not worker.available:
        return jsonify({
            "error": "Worker is currently unavailable"
        }), 400
    if is_sample_worker(worker):
        return jsonify({
            "error": "Example profiles cannot receive real booking requests"
        }), 400

    estimate_snapshot = None
    if "estimate" in data:
        estimate_snapshot, error_response = validate_booking_estimate(worker.id, data["estimate"])
        if error_response:
            return error_response

    service = data.get("service")
    if not isinstance(service, str) or not service.strip() or len(service.strip()) > 200:
        return jsonify({"error": "service is required and must be at most 200 characters"}), 400

    booking = Booking(
        user_id=user_id,
        worker_id=worker.id,
        service=service.strip(),
        status="pending",
        charge=0 if estimate_snapshot else float(data.get("charge", worker.charge)),
        spare_parts=data.get("spare_parts", worker.spare_parts) if estimate_snapshot is None else None,
        address=data.get(
            "address",
            ""
        )
    )

    db.session.add(booking)
    if estimate_snapshot:
        db.session.flush()
        db.session.add(BookingEstimate(
            booking_id=booking.id,
            payload=json.dumps(estimate_snapshot, ensure_ascii=False),
        ))
    db.session.commit()

    return jsonify({
        "message": "Service booked successfully",
        "booking_id": booking.id,
        "status": booking.status,
        "charge": booking.charge,
        "estimate": estimate_snapshot
    }), 201


# =========================================================
# GET USER BOOKINGS
# =========================================================

def booking_estimate_snapshot(booking_id):
    if not extended_schema_ready():
        return None
    record = db.session.get(BookingEstimate, booking_id)
    if not record:
        return None
    try:
        return json.loads(record.payload)
    except (TypeError, ValueError):
        return None

@app.route("/api/bookings", methods=["GET"])
@jwt_required()
def get_bookings():

    identity = get_jwt_identity()

    if not identity.startswith("user:"):
        return jsonify({
            "error": "Only users can view these bookings"
        }), 403

    user_id = int(
        identity.split(":")[1]
    )

    bookings = Booking.query.filter_by(
        user_id=user_id
    ).all()

    result = []

    for booking in bookings:

        result.append({
            "id": booking.id,
            "worker_id": booking.worker_id,
            "service": booking.service,
            "status": booking.status,
            "charge": booking.charge,
            "spare_parts": booking.spare_parts,
            "address": booking.address,
            "estimate": booking_estimate_snapshot(booking.id)
        })

    return jsonify(result)


@app.route("/api/worker/bookings", methods=["GET"])
@jwt_required()
def get_worker_bookings():
    identity = get_jwt_identity()
    if not identity.startswith("worker:"):
        return jsonify({"error": "Only workers can view service requests"}), 403

    worker_id = int(identity.split(":", 1)[1])
    bookings = Booking.query.filter_by(worker_id=worker_id).order_by(Booking.id.desc()).all()
    return jsonify([
        {
            "id": booking.id,
            "user_id": booking.user_id,
            "service": booking.service,
            "status": booking.status,
            "charge": booking.charge,
            "spare_parts": booking.spare_parts,
            "address": booking.address,
            "estimate": booking_estimate_snapshot(booking.id)
        }
        for booking in bookings
    ])


# =========================================================
# UPDATE BOOKING
# =========================================================

@app.route(
    "/api/bookings/<int:booking_id>",
    methods=["PUT"]
)
@jwt_required()
def update_booking(booking_id):

    identity = get_jwt_identity()

    booking = db.session.get(
        Booking,
        booking_id
    )

    if not booking:
        return jsonify({
            "error": "Booking not found"
        }), 404

    if identity.startswith("user:"):
        if identity != f"user:{booking.user_id}":
            return jsonify({"error": "You can only update your own requests"}), 403
    elif identity.startswith("worker:"):
        if identity != f"worker:{booking.worker_id}":
            return jsonify({"error": "You can only update requests assigned to you"}), 403
    else:
        return jsonify({"error": "Invalid account role"}), 403

    data = request.get_json()

    if not data:
        return jsonify({
            "error": "JSON data is required"
        }), 400

    if "status" in data:
        allowed_status = [
            "pending",
            "accepted",
            "rejected",
            "in_progress",
            "completed",
            "cancelled"
        ]

        if data["status"] not in allowed_status:
            return jsonify({
                "error": "Invalid booking status"
            }), 400

        if identity.startswith("worker:"):
            worker_transitions = {
                "pending": {"accepted", "rejected"},
                "accepted": {"in_progress", "rejected"},
                "in_progress": {"completed"},
            }
            allowed_transitions = worker_transitions.get(booking.status, set())
            if data["status"] not in allowed_transitions:
                return jsonify({"error": "That worker booking status transition is not allowed"}), 400
        if identity.startswith("user:") and data["status"] != "cancelled":
            return jsonify({"error": "Customers can only cancel requests"}), 400
        if identity.startswith("user:") and booking.status not in {"pending", "accepted"}:
            return jsonify({"error": "This request can no longer be cancelled"}), 400

        booking.status = data["status"]

    if "charge" in data:
        booking.charge = float(
            data["charge"]
        )

    if "spare_parts" in data:
        booking.spare_parts = data[
            "spare_parts"
        ]

    db.session.commit()

    return jsonify({
        "message": "Booking updated successfully",
        "booking_id": booking.id,
        "status": booking.status,
        "charge": booking.charge,
        "spare_parts": booking.spare_parts
    })


# =========================================================
# ADD REVIEW
# =========================================================

@app.route(
    "/api/workers/<int:worker_id>/reviews",
    methods=["POST"]
)
@jwt_required()
def add_review(worker_id):

    identity = get_jwt_identity()

    if not identity.startswith("user:"):
        return jsonify({
            "error": "Only users can add reviews"
        }), 403

    user_id = int(
        identity.split(":")[1]
    )

    worker = db.session.get(
        Worker,
        worker_id
    )

    if not worker:
        return jsonify({
            "error": "Worker not found"
        }), 404

    data = request.get_json()

    if not data or "rating" not in data:
        return jsonify({
            "error": "rating is required"
        }), 400

    try:
        rating = float(
            data["rating"]
        )
    except (TypeError, ValueError):
        return jsonify({
            "error": "rating must be a number"
        }), 400

    if rating < 1 or rating > 5:
        return jsonify({
            "error": "rating must be between 1 and 5"
        }), 400

    review_text = data.get(
        "review",
        ""
    )

    review = Review(
        user_id=user_id,
        worker_id=worker_id,
        rating=rating,
        review=review_text
    )

    db.session.add(review)

    old_total = worker.rating * worker.reviews

    worker.reviews += 1

    worker.rating = (
        old_total + rating
    ) / worker.reviews

    db.session.commit()

    return jsonify({
        "message": "Review added successfully",
        "rating": worker.rating,
        "reviews": worker.reviews
    }), 201


# =========================================================
# GET WORKER REVIEWS
# =========================================================

@app.route(
    "/api/workers/<int:worker_id>/reviews",
    methods=["GET"]
)
def get_reviews(worker_id):

    reviews = Review.query.filter_by(
        worker_id=worker_id
    ).all()

    result = []

    for review in reviews:

        result.append({
            "id": review.id,
            "user_id": review.user_id,
            "rating": review.rating,
            "review": review.review
        })

    return jsonify(result)


# =========================================================
# DATABASE CREATE
# =========================================================

with app.app_context():
    legacy_tables = [
        User.__table__, Worker.__table__, Booking.__table__, Review.__table__,
        PartCatalog.__table__
    ]
    if app_environment == "production":
        db.create_all(tables=legacy_tables)
    else:
        db.create_all()

    extended_tables = {
        "otp_challenge", "inventory_part", "worker_labour_rate",
        "worker_coverage", "booking_estimate"
    }
    app.config["EXTENDED_SCHEMA_READY"] = extended_tables.issubset(
        set(inspect(db.engine).get_table_names())
    )

    for category, name, min_price, max_price, unit in PARTS_CATALOGUE:
        existing_part = PartCatalog.query.filter_by(category=category, name=name).first()
        if existing_part is None:
            db.session.add(PartCatalog(
                category=category,
                name=name,
                min_price=min_price,
                max_price=max_price,
                unit=unit
            ))

    db.session.commit()

    if Worker.query.filter(Worker.phone.like("555-01%")).count() < 6:
        sample_workers = [
            {
                "name": "Marco Reyes", "phone": "555-0101",
                "category": "electrician", "services": "Wiring, lighting, outlet repair",
                "rating": 4.9, "reviews": 128, "latitude": 37.7795,
                "longitude": -122.4140, "charge": 65,
                "spare_parts": "Switches from $8; wiring from $12/m",
                "available": True
            },
            {
                "name": "Nina Patel", "phone": "555-0102",
                "category": "plumber", "services": "Leaks, faucets, drain clearing",
                "rating": 4.8, "reviews": 96, "latitude": 37.7698,
                "longitude": -122.4260, "charge": 55,
                "spare_parts": "Faucet cartridges from $15; seals from $4",
                "available": True
            },
            {
                "name": "Andre Lewis", "phone": "555-0103",
                "category": "carpenter", "services": "Furniture repair, shelving, doors",
                "rating": 4.7, "reviews": 74, "latitude": 37.7830,
                "longitude": -122.4310, "charge": 70,
                "spare_parts": "Hinges from $9; boards quoted by size",
                "available": True
            },
            {
                "name": "Sofia Kim", "phone": "555-0104",
                "category": "mechanic", "services": "Battery, brakes, basic diagnostics",
                "rating": 4.9, "reviews": 112, "latitude": 37.7615,
                "longitude": -122.4142, "charge": 80,
                "spare_parts": "Batteries from $95; brake pads from $35",
                "available": True
            },
            {
                "name": "Ellis Carter", "phone": "555-0105",
                "category": "cleaner", "services": "Home cleaning, move-out, deep clean",
                "rating": 4.8, "reviews": 83, "latitude": 37.7905,
                "longitude": -122.4080, "charge": 45,
                "spare_parts": "Cleaning supplies included",
                "available": True
            },
            {
                "name": "Priya Shah", "phone": "555-0106",
                "category": "electrician", "services": "Ceiling fans, safety checks, lighting",
                "rating": 4.6, "reviews": 51, "latitude": 37.7720,
                "longitude": -122.4385, "charge": 60,
                "spare_parts": "Fan brackets from $14; bulbs from $6",
                "available": False
            }
        ]

        for sample in sample_workers:
            if Worker.query.filter_by(phone=sample["phone"]).first():
                continue
            sample["password"] = generate_password_hash("demo1234")
            db.session.add(Worker(**sample))

        db.session.commit()


# =========================================================
# RUN SERVER
# =========================================================

if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=int(os.environ.get("PORT", "5000")),
        debug=app_environment != "production"
    )