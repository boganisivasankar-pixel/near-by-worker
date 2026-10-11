import os
import unittest

os.environ["APP_ENV"] = "development"
os.environ["NEARBY_DATABASE_URL"] = "sqlite://"

from werkzeug.security import check_password_hash

from app import Booking, Worker, app, db


class MarketplaceTests(unittest.TestCase):
    def setUp(self):
        self.app_context = app.app_context()
        self.app_context.push()
        db.drop_all()
        db.create_all()
        self.client = app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.app_context.pop()

    def register_customer(self, phone="customer-1"):
        return self.client.post("/api/users/register", json={
            "name": "Test Customer",
            "phone": phone,
            "password": "test-password-123",
        })

    def login_customer(self, phone="customer-1"):
        response = self.client.post("/api/users/login", json={
            "phone": phone,
            "password": "test-password-123",
        })
        return response.get_json()["token"]

    def register_worker(self, phone="worker-1", **overrides):
        data = {
            "name": "Test Plumber",
            "phone": phone,
            "password": "test-password-123",
            "category": "plumbing",
            "services": "Leaks, faucets",
            "charge": 500,
            "latitude": 17.385,
            "longitude": 78.487,
        }
        data.update(overrides)
        return self.client.post("/api/workers/register", json=data)

    def login_worker(self, phone="worker-1"):
        response = self.client.post("/api/workers/login", json={
            "phone": phone,
            "password": "test-password-123",
        })
        return response.get_json()["token"]

    def auth_headers(self, client, token):
        headers = {"Authorization": f"Bearer {token}"}
        csrf_cookie = client.get_cookie("csrf_access_token")
        if csrf_cookie:
            headers["X-CSRF-TOKEN"] = csrf_cookie.value
        return headers

    def test_registration_hashes_password_and_validates_minimum(self):
        self.assertEqual(self.register_customer().status_code, 201)
        from app import User
        stored_user = User.query.filter_by(phone="customer-1").one()
        self.assertTrue(check_password_hash(stored_user.password, "test-password-123"))
        response = self.client.post("/api/users/register", json={
            "name": "Weak Password",
            "phone": "weak-password",
            "password": "short",
        })
        self.assertEqual(response.status_code, 400)

    def test_cookie_login_restore_csrf_and_logout(self):
        self.register_customer()
        login = self.client.post("/api/users/login", json={
            "phone": "customer-1",
            "password": "test-password-123",
        })
        self.assertEqual(login.status_code, 200)
        self.assertTrue(self.client.get_cookie("access_token_cookie").http_only)
        csrf = self.client.get_cookie("csrf_access_token")
        self.assertIsNotNone(csrf)
        self.assertEqual(self.client.get("/api/auth/me").get_json()["role"], "user")
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 401)
        logout = self.client.post("/api/auth/logout", headers={"X-CSRF-TOKEN": csrf.value})
        self.assertEqual(logout.status_code, 200)
        self.assertIn(self.client.get("/api/auth/me").status_code, (401, 422))

    def test_text_category_alias_search(self):
        worker = self.register_worker().get_json()
        for term in ("plumber", "plumbing"):
            results = self.client.get(f"/api/workers/search?service={term}").get_json()
            self.assertIn(worker["worker_id"], [item["id"] for item in results])
        results = self.client.get("/api/workers/search?category=plumbing&service=plumber").get_json()
        self.assertIn(worker["worker_id"], [item["id"] for item in results])

    def test_nearby_requires_real_coordinates_and_filters_radius(self):
        worker_id = self.register_worker().get_json()["worker_id"]
        self.register_worker(phone="unlocated-worker", latitude=None, longitude=None)
        results = self.client.get(
            "/api/workers/nearby?latitude=17.385&longitude=78.487&radius=5&category=plumbing&service=plumber"
        ).get_json()
        self.assertEqual([item["id"] for item in results], [worker_id])
        self.assertEqual(results[0]["distance_km"], 0)
        self.assertEqual(self.client.get("/api/workers/nearby?latitude=91&longitude=0").status_code, 400)
        self.assertEqual(self.client.get("/api/workers/nearby?latitude=0&longitude=0&radius=0").status_code, 400)

    def test_demo_profiles_are_not_live_nearby_or_bookable(self):
        demo = Worker(
            name="Demo Worker", phone="555-0101", password="unused",
            category="plumber", services="Leaks", latitude=17.385,
            longitude=78.487, available=True, charge=500
        )
        db.session.add(demo)
        db.session.commit()
        listed = self.client.get("/api/workers/search").get_json()
        demo_item = next(item for item in listed if item["id"] == demo.id)
        self.assertTrue(demo_item["is_sample_profile"])
        nearby = self.client.get("/api/workers/nearby?latitude=17.385&longitude=78.487&radius=5").get_json()
        self.assertNotIn(demo.id, [item["id"] for item in nearby])
        self.register_customer()
        token = self.login_customer()
        response = self.client.post("/api/bookings", headers=self.auth_headers(self.client, token), json={
            "worker_id": demo.id,
            "service": "Demo booking",
        })
        self.assertEqual(response.status_code, 400)

    def test_worker_profile_is_owner_only_and_location_updates(self):
        worker_client = app.test_client()
        customer_client = app.test_client()
        worker_id = self.register_worker().get_json()["worker_id"]
        worker_token = self.login_worker()
        customer_client.post("/api/users/register", json={
            "name": "Test Customer",
            "phone": "customer-profile-test",
            "password": "test-password-123",
        })
        customer_token = customer_client.post("/api/users/login", json={
            "phone": "customer-profile-test",
            "password": "test-password-123",
        }).get_json()["token"]
        response = worker_client.put(f"/api/workers/{worker_id}", headers=self.auth_headers(worker_client, worker_token), json={
            "name": "Updated Worker",
            "phone": "worker-1",
            "category": "plumbing",
            "services": "Tap repair",
            "charge": 650,
            "latitude": 17.39,
            "longitude": 78.49,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(worker_client.get(f"/api/workers/{worker_id}").get_json()["latitude"], 17.39)
        denied = customer_client.put(f"/api/workers/{worker_id}", headers=self.auth_headers(customer_client, customer_token), json={"name": "Not the worker"})
        self.assertEqual(denied.status_code, 403)

    def test_booking_transitions_and_role_permissions(self):
        customer_client = app.test_client()
        worker_client = app.test_client()
        customer_client.post("/api/users/register", json={
            "name": "Test Customer",
            "phone": "customer-booking-test",
            "password": "test-password-123",
        })
        customer_token = customer_client.post("/api/users/login", json={
            "phone": "customer-booking-test",
            "password": "test-password-123",
        }).get_json()["token"]
        worker_id = self.register_worker().get_json()["worker_id"]
        worker_token = self.login_worker()
        customer_headers = self.auth_headers(customer_client, customer_token)
        worker_headers = self.auth_headers(worker_client, worker_token)
        created = customer_client.post("/api/bookings", headers=customer_headers, json={
            "worker_id": worker_id,
            "service": "Repair tap",
            "address": "Test address",
        })
        self.assertEqual(created.status_code, 201)
        booking_id = created.get_json()["booking_id"]
        jump = worker_client.put(f"/api/bookings/{booking_id}", headers=worker_headers, json={"status": "completed"})
        self.assertEqual(jump.status_code, 400)
        for status in ("accepted", "in_progress", "completed"):
            response = worker_client.put(f"/api/bookings/{booking_id}", headers=worker_headers, json={"status": status})
            self.assertEqual(response.status_code, 200)
        customer_bookings = customer_client.get("/api/bookings", headers=customer_headers).get_json()
        self.assertEqual(customer_bookings[0]["status"], "completed")
        self.assertEqual(customer_client.get("/api/worker/bookings", headers=customer_headers).status_code, 403)


if __name__ == "__main__":
    unittest.main()
