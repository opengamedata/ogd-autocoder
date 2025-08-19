import sys
import os
from pathlib import Path

# Ensure this path is writable by the user the WSGI daemon runs as
os.environ['OGD_FLASK_APP_LOG_FILE'] = '/var/log/flask-apps/ogd-autocoder.log'

HOME_FOLDER = "placeholder home"

# Specifying the path used in the hosting environment, there might be a better way to do this
if not HOME_FOLDER in sys.path:
    sys.path.append(HOME_FOLDER)

old_path = os.getcwd()
os.chdir("./.venv/bin")
activation_file = Path(HOME_FOLDER) / ".venv" / "bin" / "activate_this.py"
with open(activation_file, encoding="UTF-8") as activate:
    activation_code = activate.read()
    exec(activation_code) # necessary HACK pylint: disable=exec-used
os.chdir(old_path)

# pylint: disable-next=wrong-import-position, unused-import
from main import app
