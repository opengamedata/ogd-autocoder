import os
import time
from utils import autosegment_by_job, update_rows, get_events_for_user, add_new_columns
from werkzeug.utils import secure_filename
from flask import Flask, render_template, request, jsonify, send_file, request, abort

app = Flask(__name__)
app.secret_key = "secret"  # Needed for session

UPLOAD_FOLDER = "uploads"
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

@app.route("/", methods=["GET", "POST"])
def index():
    return render_template("index.html")

@app.route("/upload", methods=["POST"])
def upload_file():
    file = request.files["file"]
    filename = secure_filename(file.filename)
    filename = str(time.time_ns()) + "_" + filename
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    file.save(filepath)

    df = add_new_columns(filepath)
    return jsonify({"user_ids": df.user_id.dropna().unique().compute().tolist(), "filename": filename})

@app.route("/events/<user_id>", methods=["POST"])
def events(user_id):
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], request.json["filename"])
    user_events = get_events_for_user(filepath, user_id)

    return jsonify({"data": user_events.fillna("-").to_dict(orient="records")}) # "max_segment_id": user_events["segment_id"].fillna(0).max()

@app.route("/update/<user_id>", methods=["POST"])
def update(user_id):
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], request.json["filename"])
    upd_id_instead_label = request.json["upd_id_instead_label"]
    selected_rows = request.json["selected_rows"]
    segment_id = request.json.get("segment_id")
    segment_labels = request.json.get("segment_labels")

    update_rows(filepath, user_id, upd_id_instead_label, segment_id, segment_labels, selected_rows)
    # fixme - make this faster by returning updated rows...
    # fixme - store filepath in headers
    return jsonify({"success": True})

@app.route("/autosegment/<user_id>", methods=["POST"])
def autosegment(user_id):
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], request.json["filename"])
    autosegment_by_job(filepath, user_id)

    return jsonify({"success": True})

@app.route('/download', methods=['GET'])
def download_file():
    # Get file path from query string, e.g. /download?file=somefile.csv
    filename = request.args.get('file')

    if not filename:
        return abort(400, description="Missing 'file' query parameter.")

    # Full path to the file (adjust this path for your use case)
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    # Check if the file exists
    if not os.path.isfile(filepath):
        return abort(404, description="File not found.")

    return send_file(
        "../" + filepath,
        as_attachment=True,
        download_name=filename.split("_", maxsplit=1)[1]
    )
if __name__ == "__main__":
    app.run(debug=True)
