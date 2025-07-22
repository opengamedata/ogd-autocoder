import os
import time
import json
import dask.dataframe as dd
import numpy as np
from werkzeug.utils import secure_filename
from flask import Flask, render_template, request, jsonify, send_file, request, abort

app = Flask(__name__)
app.secret_key = "secret"  # Needed for session

UPLOAD_FOLDER = "uploads"
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

def extract_job_name(game_state_str):
  try:
    game_state = json.loads(game_state_str)
    return game_state.get('job_name', None)
  except (json.JSONDecodeError, AttributeError):
    return None

meta = {'app_branch': 'object', 'user_id': 'object', 'log_version': 'object', 'session_id': 'object', 'app_version': 'object', 'index': 'object', 'segment_labels': 'object'}

@app.route("/", methods=["GET", "POST"])
def index():
    return render_template("index.html")

@app.route("/upload", methods=["POST"])
def upload_file():
    file = request.files["file"]
    filename = secure_filename(file.filename)
    filename = str(time.time()) + filename
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    file.save(filepath)

    df = dd.read_csv(filepath, sep="\t", dtype=meta)
    if "segment_id" not in df.columns:
        df["segment_id"] = np.nan

    if "segment_labels" not in df.columns:
        df["segment_labels"] = np.nan

    df["job_name"] = df["game_state"].map_partitions(
        lambda part: part.apply(extract_job_name), meta=("job_name", "object")
    )

    df.to_csv(filepath, index=False, sep="\t", single_file=True)
    return jsonify({"user_ids": df.user_id.dropna().unique().compute().tolist(), "filename": filename})

@app.route("/events/<user_id>", methods=["POST"])
def events(user_id):
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], request.json["filename"])
    df = dd.read_csv(filepath, sep="\t", dtype=meta)

    df["timestamp"] = dd.to_datetime(df["timestamp"], format='mixed')
    user_events = df[df["user_id"] == user_id][["index", "event_name", "job_name", "timestamp", "segment_id", "segment_labels"]]
    user_events = user_events.sort_values(by="timestamp", ascending=True).compute()
    
    user_events["timestamp"] = user_events["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    
    # segment_id should start from 1
    return jsonify({"data": user_events.fillna("-").to_dict(orient="records"), "max_segment_id": user_events["segment_id"].fillna(0).max()})

@app.route("/update/<user_id>", methods=["POST"])
def update(user_id):
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], request.json["filename"])
    df = dd.read_csv(filepath, sep="\t", dtype=meta)

    df["row_id"] = df["index"].astype(str) + "_" + dd.to_datetime(df["timestamp"], format='mixed').dt.strftime("%Y-%m-%d %H:%M:%S")
    df["row_id"] = df["row_id"].astype(str)
    selected_row_ids = list(map(lambda x: f"{x[0]}_{x[1]}", request.json["selected_rows"]))
    update_filter = (df["user_id"] == user_id) & df["row_id"].isin(selected_row_ids)
    segment_id = request.json.get("segment_id")
    segment_labels = request.json.get("segment_labels")

    if request.json["upd_id_instead_label"]:
        # update segment_id
        update_val = np.nan if segment_id == "" else int(segment_id)
        df["segment_id"] = df["segment_id"].mask(update_filter, update_val)
    else:
        # update segment_labels
        update_val = np.nan if segment_labels == "" else segment_labels
        df["segment_labels"] = df["segment_labels"].mask(update_filter, update_val)

    df.drop(columns=["row_id"]).to_csv(filepath, compute=True, index=False, sep="\t", single_file=True)
    # fixme - make this faster by returning updated rows...
    # fixme - store filepath in headers
    return jsonify({"success": True})

@app.route("/autosegment/<user_id>", methods=["POST"])
def autosegment(user_id):
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], request.json["filename"])
    df = dd.read_csv(filepath, sep="\t", dtype=meta)
    
    # execute the operation in pandas
    absent_df = df[df['user_id'] == user_id].compute()
    # absent_df = absent_df.sort_values('timestamp') # originally its also sorted like that
    absent_df['segment_id'] = (absent_df['job_name'] != absent_df['job_name'].shift()).fillna(False).astype(int).cumsum()
    absent_df = absent_df[['segment_id', 'session_id', 'index']]

    df = df.merge(dd.from_pandas(absent_df, npartitions=1), on=['session_id', 'index'], how='left', suffixes=('', '_new'))

    df['segment_id'] = df['segment_id_new'].where(df['user_id'] == user_id, df['segment_id'])
    df = df.drop(columns=['segment_id_new'])

    df.to_csv(filepath, compute=True, index=False, sep="\t", single_file=True)
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
    #if not os.path.isfile(filepath):
    #    return abort(404, description="File not found.")

    # Send file for download
    return send_file(
        "../"+filepath,
        as_attachment=True,  # Prompts "Save as" dialog
        download_name=filename[17:]  # Optional: sets the name of the file
    )
if __name__ == "__main__":
    app.run(debug=True)
