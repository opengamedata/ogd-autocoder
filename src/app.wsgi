import sys
import os
from pathlib import Path

# Ensure this path is writable by the user the WSGI daemon runs as
os.environ['OGD_FLASK_APP_LOG_FILE'] = '/var/log/flask-apps/ogd-autocoder.log'

HOME_FOLDER = "placeholder home"

# Specifying the path used in the hosting environment, there might be a better way to do this
if not HOME_FOLDER in sys.path:
    sys.path.append(HOME_FOLDER)

activation_file = Path(HOME_FOLDER) / ".venv" / "bin" / "activate_this.py"
with open(activation_file) as activate:
    exec(activate.read())

from main import app
