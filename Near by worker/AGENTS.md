# Project Instructions

## Overview
- This workspace contains a Flask marketplace with a responsive browser UI, JSON API, and SQLite persistence.
- `parts_catalogue.py` holds sample INR catalogue data; `app.py` seeds missing records without clearing existing data.

## Running
- Start the local app with `python app.py` from the workspace root.
- Install dependencies from `requirements.txt` first when using a fresh environment.

## Development
- Keep changes focused and consistent with the existing Flask structure.
- Keep existing user, worker, booking, review, and catalogue data intact; do not delete or recreate the SQLite database for tests.
- Use an isolated in-memory SQLite database for tests and never commit secrets or database URLs.
- After changing behavior, run focused tests when practical.