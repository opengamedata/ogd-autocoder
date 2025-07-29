import os
import time
from utils import *
from train import train_model, available_features
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
    return jsonify({"user_ids": df.user_id.dropna().unique().tolist(), "filename": filename})

@app.route("/list_segment_ids/<user_id>", methods=["POST"])
def list_segment_ids(user_id):
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], request.json["filename"])

    return jsonify({"data": segment_ids_for_user(filepath, user_id)})

@app.route("/list_labels", methods=["POST"])
def list_labels():
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], request.json["filename"])

    return jsonify({"data": list_seg_labels(filepath)})

@app.route("/list_available_features", methods=["POST"])
def list_available_features():
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], request.json["filename"])
    return jsonify({"data": available_features(filepath)})


@app.route("/events/<user_id>", methods=["POST"])
def events(user_id):
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], request.json["filename"])
    user_events = get_events_for_user(filepath, user_id, request.json.get("segment_id"))

    return jsonify({"data": user_events.fillna("-").to_dict(orient="records")}) # "max_segment_id": user_events["segment_id"].fillna(0).max()

@app.route("/segment/<user_id>", methods=["POST"])
def segment(user_id):
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], request.json["filename"])
    selected_rows = request.json["selected_rows"]
    segment_id = request.json.get("segment_id")

    segment_rows(filepath, user_id, segment_id, selected_rows)
    # fixme - make this faster by returning updated rows...
    # fixme - store filepath in headers
    return jsonify({"success": True})

@app.route("/label/<user_id>", methods=["POST"])
def label(user_id):
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], request.json["filename"])
    segment_id = request.json.get("segment_id")
    segment_labels = request.json.get("segment_labels")
    label_justification = request.json.get("label_justification")

    label_rows(filepath, user_id, segment_id, segment_labels, label_justification)
    return jsonify({"success": True})

@app.route("/autosegment/<user_id>", methods=["POST"])
def autosegment(user_id):
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], request.json["filename"])
    autosegment_by_job(filepath, user_id)

    return jsonify({"success": True})

@app.route("/train_model", methods=["POST"])
def train():
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], request.json["filename"])
    output, metrics = train_model(filepath, request.json["model_type"], request.json["include_features"])
    return jsonify({"output": output, "metrics": metrics})

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
        filepath,
        as_attachment=True,
        download_name=filename.split("_", maxsplit=1)[1]
    )
if __name__ == "__main__":
    app.run(debug=True)
