# ogd-autocoder
Repository for our tool for human coding of Event data, with integration to feature extraction and automated building of models to apply codes to new data.

# Dependencies
- https://github.com/astral-sh/uv

# Startup
(execute from root)

Activate venv

`$ . .venv/bin/activate`

Install dependencies

`$ uv sync`

Start server

`$ uv run src/segmentator.py`