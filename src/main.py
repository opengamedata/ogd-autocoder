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
from flask import Flask, render_template, request, jsonify, send_file, request, abort, after_this_request
from datetime import datetime
from functools import wraps

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

def safe(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            print(traceback.format_exc())
            return jsonify({"error": str(e)})

    return wrapper

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
            and not os.path.splitext(f)[0].endswith("_labels")
            and f.endswith(".tsv")
            and "_" in f
        ]

        # timestamp descending order
        files = sorted(files, key=lambda x: x["fullname"], reverse=True)

    except FileNotFoundError:
        files = []

    return render_template("index.html", uploaded_files=files)


@app.route("/upload", methods=["POST"])
@safe
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
    df = read_dataset(filepath, None, False)
    cols = set(df.columns)
    
    if {"segment_id", "segment_labels"}.issubset(cols):
        # if loading an already labeled dataset (exported using download btn)
        labels_cols = ["segment_id", "user_id", "segment_labels"]
        if "label_justification" in cols:
            labels_cols.append("label_justification")
        
        df_labels = df.select(labels_cols).unique()
        
        if "label_justification" not in cols:
            df_labels = df_labels.with_columns(pl.lit(None).alias("label_justification"))

        df_labels = df_labels.with_columns(pl.lit(request.cookies.get("username")).alias("username"))

        labels_filepath = get_labels_filename(filepath)
        df_labels = df_labels.select(["username", "segment_id", "user_id", "segment_labels", "label_justification"])
        df_labels.write_csv(labels_filepath, separator="\t")

    return jsonify({"filename": filename, "formatted": formatted})


@app.route("/models_list", methods=["POST"])
@safe
def models_list():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )

    return jsonify({"data": get_models_list(filepath, request.cookies.get("username"))})


@app.route("/users_list", methods=["POST"])
@safe
def users_list():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    df = read_dataset(filepath, request.cookies.get("username"))
    return jsonify({"users": get_users_list(df)})


@app.route("/update_event_descriptions", methods=["POST"])
@safe
def update_event_descriptions():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    describe_events(filepath, request.json["descriptions_map"])

    return jsonify({"success": True})


@app.route("/dataset_info", methods=["POST"])
@safe
def dataset_info():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    df = read_dataset(filepath, request.cookies.get("username"), False)
    return jsonify({"data": get_dataset_info(df)})


@app.route("/dataset_filter", methods=["POST"])
@safe
def dataset_filter():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    event_filtering(filepath, request.json["included_events"])

    return jsonify({"success": True})


@app.route("/list_segment_ids/<user_id>", methods=["POST"])
@safe
def list_segment_ids(user_id):
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    df = read_dataset(filepath, request.cookies.get("username"))
    return jsonify({"data": segment_ids_for_user(df, user_id)})


@app.route("/labels_value_count", methods=["POST"])
@safe
def labels_value_count():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    df = read_dataset(filepath, request.cookies.get("username"))
    return jsonify({"data": segment_labels_count(df)})


@app.route("/list_labels", methods=["POST"])
@safe
def list_labels():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    df = read_dataset(filepath, request.cookies.get("username"))
    return jsonify({"data": list_seg_labels(df)})


@app.route("/list_available_features", methods=["POST"])
@safe
def list_available_features():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    return jsonify({"data": available_features(filepath, request.cookies.get("username"))})


@app.route("/correlation_matrix", methods=["POST"])
@safe
def correlation_matrix():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    return jsonify({"data": correlation(filepath, request.cookies.get("username"), request.json["include_labels"])})


@app.route("/events/<user_id>", methods=["POST"])
@safe
def events(user_id):
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    df = read_dataset(filepath, request.cookies.get("username"))
    user_events = find_by_user_and_segment(
        df, user_id, request.json.get("segment_id")
    )

    return jsonify(
        {"data": user_events}
    )  # "max_segment_id": user_events["segment_id"].fillna(0).max()


@app.route("/segment/<user_id>", methods=["POST"])
@safe
def segment(user_id):
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    selected_rows = request.json["selected_rows"]
    segment_id = request.json.get("segment_id")

    segment_rows(filepath, user_id, segment_id, selected_rows)
    return jsonify({"success": True})


@app.route("/label/<user_id>", methods=["POST"])
@safe
def label(user_id):
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    segment_id = request.json.get("segment_id")
    segment_labels = request.json.get("segment_labels")
    label_justification = request.json.get("label_justification")

    labels_filepath = get_labels_filename(filepath)
    label_rows(labels_filepath, request.cookies.get("username"), user_id, segment_id, segment_labels, label_justification)
    return jsonify({"success": True})


@app.route("/autosegment", methods=["POST"])
@safe
def autosegment():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    autosegment_by_event_type(filepath, request.json["sep_event_types"])

    return jsonify({"success": True})


@app.route("/autoselect", methods=["POST"])
@safe
def autoselect():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )

    return jsonify(
        {"features": autoselect_features(filepath, request.cookies.get("username"), request.json["include_labels"])}
    )


@app.route("/infere", methods=["POST"])
@safe
def infere():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    inference(filepath, request.cookies.get("username"), request.json["model_path"])

    return jsonify({"success": True})


@app.route("/predicted_label", methods=["POST"])
@safe
def predicted_label():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    label, confidence = get_predicted_label(
        filepath, request.json["user_id"], request.json["segment_id"]
    )

    return jsonify({"label": label, "confidence": confidence})


@app.route("/pca_details", methods=["POST"])
@safe
def get_pca_details():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )

    return jsonify(
        pca_details(
            filepath,
            request.cookies.get("username"),
            request.json["hyperparameters"],
            request.json["include_labels"],
            request.json["include_features"],
        )
    )


@app.route("/train_model", methods=["POST"])
@safe
def train():
    filepath = os.path.join(
        app.config["UPLOAD_FOLDER"], request.cookies.get("filename")
    )
    
    output, model_info = train_model(
        filepath,
        request.cookies.get("username"),
        request.json["model_type"],
        request.json["hyperparameters"],
        request.json["include_labels"],
        request.json["include_features"],
        app.config["MODELS_DIR"],
    )

    return jsonify({"output": output, "model_info": model_info})


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

    df = read_dataset(filepath, request.cookies.get("username"), False)
    temp_path = os.path.join(app.config["UPLOAD_FOLDER"], "download.tsv")
    df.drop(["predicted_labels", "prediction_confidence"], strict=False).write_csv(temp_path, separator="\t")
    
    @after_this_request
    def remove_temp_file(response):
        os.remove(temp_path)
        return response

    return send_file(
        temp_path, as_attachment=True, download_name=filename.split("_", maxsplit=1)[1]
    )


if __name__ == "__main__":
    app.run(debug=True)
