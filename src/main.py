import os
import traceback
from dataset import *
from dim_reduction import pca_details, autoselect_features, correlation
from inference import get_models_list, get_predicted_label, inference
from preprocess import available_features
from segment import autosegment_by_event_type, segment_ids_for_user, segment_rows
from label import label_rows, list_seg_labels
from events import event_filtering, describe_events
from train import train_model
from werkzeug.utils import secure_filename
from flask import Flask, render_template, request, jsonify, send_file, request, abort
from datetime import datetime

app = Flask(__name__)
app.secret_key = "secret"  # Needed for session

BASE_DIR = os.path.dirname(os.path.abspath(__file__))  # directory of this app.py
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

if not os.path.exists(app.config["UPLOAD_FOLDER"]):
    os.makedirs(app.config["UPLOAD_FOLDER"])

app.config["MODELS_DIR"] = os.path.join(app.config["UPLOAD_FOLDER"], "models")

if not os.path.exists(app.config["MODELS_DIR"]):
    os.makedirs(app.config["MODELS_DIR"])


@app.route("/")
def index():
    try:
        files = [
            {
                "fullname": f,
                "formatted": f.split("_", 1)[1]
                + " "
                + f.split("_", 1)[0].replace("T", " "),  # format the datetime
            }
            for f in os.listdir(UPLOAD_FOLDER)
            if os.path.isfile(os.path.join(UPLOAD_FOLDER, f))
            and not os.path.splitext(f)[0].endswith("_models")
            and f.endswith(".tsv")
            and "_" in f
        ]

        # timestamp descending order
        files = sorted(files, key=lambda x: x["fullname"], reverse=True)

    except FileNotFoundError:
        files = []

    return render_template("index.html", uploaded_files=files)


@app.route("/upload", methods=["POST"])
def upload_file():
    file = request.files["file"]
    filename = secure_filename(file.filename)
    timestamp_str = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    filename = timestamp_str + "_" + filename
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    file.save(filepath)
    formatted = (
        filename.split("_", 1)[1] + " " + filename.split("_", 1)[0].replace("T", " ")
    )
    return jsonify({"filename": filename, "formatted": formatted})


@app.route("/models_list", methods=["POST"])
def models_list():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )

    return jsonify({"data": get_models_list(filepath)})


@app.route("/users_list", methods=["POST"])
def users_list():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    df = read_dataset(filepath)
    return jsonify({"users": get_users_list(df)})


@app.route("/update_event_descriptions", methods=["POST"])
def update_event_descriptions():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    describe_events(filepath, request.json["descriptions_map"])

    return jsonify({"success": True})


@app.route("/dataset_info", methods=["POST"])
def dataset_info():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )

    return jsonify({"data": get_dataset_info(filepath)})


@app.route("/dataset_filter", methods=["POST"])
def dataset_filter():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    event_filtering(filepath, request.json["included_events"])

    return jsonify({"success": True})


@app.route("/list_segment_ids/<user_id>", methods=["POST"])
def list_segment_ids(user_id):
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )

    return jsonify({"data": segment_ids_for_user(filepath, user_id)})


@app.route("/labels_value_count", methods=["POST"])
def labels_value_count():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    df = read_dataset(filepath)
    return jsonify({"data": segment_labels_count(df)})


@app.route("/list_labels", methods=["POST"])
def list_labels():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )

    return jsonify({"data": list_seg_labels(filepath)})


@app.route("/list_available_features", methods=["POST"])
def list_available_features():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    return jsonify({"data": available_features(filepath)})


@app.route("/correlation_matrix", methods=["POST"])
def correlation_matrix():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    return jsonify({"data": correlation(filepath, request.json["include_labels"])})


@app.route("/events/<user_id>", methods=["POST"])
def events(user_id):
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    user_events = find_by_user_and_segment(
        filepath, user_id, request.json.get("segment_id")
    )

    return jsonify(
        {"data": user_events}
    )  # "max_segment_id": user_events["segment_id"].fillna(0).max()


@app.route("/segment/<user_id>", methods=["POST"])
def segment(user_id):
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    selected_rows = request.json["selected_rows"]
    segment_id = request.json.get("segment_id")

    segment_rows(filepath, user_id, segment_id, selected_rows)
    return jsonify({"success": True})


@app.route("/label/<user_id>", methods=["POST"])
def label(user_id):
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    segment_id = request.json.get("segment_id")
    segment_labels = request.json.get("segment_labels")
    label_justification = request.json.get("label_justification")

    label_rows(filepath, user_id, segment_id, segment_labels, label_justification)
    return jsonify({"success": True})


@app.route("/autosegment", methods=["POST"])
def autosegment():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    autosegment_by_event_type(filepath, request.json["sep_event_types"])

    return jsonify({"success": True})


@app.route("/autoselect", methods=["POST"])
def autoselect():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )

    return jsonify(
        {"features": autoselect_features(filepath, request.json["include_labels"])}
    )


@app.route("/infere", methods=["POST"])
def infere():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    inference(filepath, request.json["model_path"])

    return jsonify({"success": True})


@app.route("/predicted_label", methods=["POST"])
def predicted_label():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    label, confidence = get_predicted_label(
        filepath, request.json["user_id"], request.json["segment_id"]
    )

    return jsonify({"label": label, "confidence": confidence})


@app.route("/pca_details", methods=["POST"])
def get_pca_details():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )

    return jsonify(
        pca_details(
            filepath,
            request.json["hyperparameters"],
            request.json["include_labels"],
            request.json["include_features"],
        )
    )


@app.route("/train_model", methods=["POST"])
def train():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    success = True
    try:
        output, model_info = train_model(
            filepath,
            request.json["model_type"],
            request.json["hyperparameters"],
            request.json["include_labels"],
            request.json["include_features"],
            app.config["MODELS_DIR"],
        )
    except Exception as e:
        print(traceback.format_exc())
        output = str(e)
        model_info = []
        success = False

    return jsonify({"output": output, "model_info": model_info, "success": success})


@app.route("/download", methods=["GET"])
def download_file():
    # Get file path from query string, e.g. /download?file=somefile.csv
    filename = request.args.get("file")

    if not filename:
        return abort(400, description="Missing 'file' query parameter.")

    # Full path to the file (adjust this path for your use case)
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    # Check if the file exists
    if not os.path.isfile(filepath):
        return abort(404, description="File not found.")

    return send_file(
        filepath, as_attachment=True, download_name=filename.split("_", maxsplit=1)[1]
    )


if __name__ == "__main__":
    app.run(debug=True)
