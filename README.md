# ogd-autocoder
Repository for our tool for human coding of Event data, with integration to feature extraction and automated building of models to apply codes to new data.


### Documentation
- [User's guide](https://opengamedata-doc.readthedocs.io/en/latest/guides/user/replay/autocoder/index.html)
- [Code organization](https://opengamedata-doc.readthedocs.io/en/latest/guides/user/replay/autocoder/index.html#code-organization)

### Dependencies
- https://github.com/astral-sh/uv

### Startup

Activate venv

`$ . .venv/bin/activate`

Install dependencies

`$ uv sync`

Change dir to `src`

`$ cd src`

Start server

`$ uv run main.py`
