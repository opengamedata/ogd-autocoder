import os
import json
import torch
import joblib
import numpy as np
import polars as pl
from dataset import read_dataset
from preprocess import preprocess_df
from train_neural_net import CustomNeuralNet


def get_models_filename(filepath):
    name, ext = os.path.splitext(filepath)
    model_filename = f"{name}_models.json"
    return model_filename


def get_models_list(filepath):
    models_filepath = get_models_filename(filepath)
    if os.path.exists(models_filepath):
        with open(models_filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    else:
        return []


def get_predicted_label(filepath, user_id, segment_id):
    """
    Get predicted label for selected `user_id` and `segment_id`
    """
    df = read_dataset(filepath)
    if ("predicted_labels" not in df.columns) or (segment_id is None):
        return None, None

    filtered = df.filter(
        (pl.col("user_id") == user_id) & (pl.col("segment_id") == str(segment_id))
    )

    row = filtered.select(["predicted_labels", "prediction_confidence"]).row(0)

    return row[0], row[1]


def find_model_info(filepath, model_path):
    models_filepath = get_models_filename(filepath)
    with open(models_filepath, "r") as f:
        data = json.load(f)

    matched = [row for row in data if row.get("model_path") == model_path]

    return matched[0] if matched else None


def inference(filepath, model_path):
    df_processed = preprocess_df(filepath)
    model_info = find_model_info(filepath, model_path)

    X = df_processed.select(model_info["include_features"]).to_numpy()

    if "preprocessor_path" in model_info.keys() and model_info["preprocessor_path"]:
        pipe = joblib.load(model_info["preprocessor_path"])
        X = pipe.transform(X)

    if model_info["model_type"] == "neural-net":
        model = CustomNeuralNet(
            X.shape[1],
            model_info["hyperparameters"]["units_per_layer"],
            len(model_info["include_labels"]),
        )
        model.load_state_dict(torch.load(model_info["model_path"]))
        model.eval()

        with torch.no_grad():
            X = torch.tensor(X, dtype=torch.float32)
            if model_info["is_multilabel"]:
                probs = torch.nn.functional.sigmoid(model(X)).T
                probs = torch.stack([1 - probs, probs], dim=2)
            else:
                probs = torch.nn.functional.softmax(model(X), dim=1)
    else:
        model = joblib.load(model_info["model_path"])
        probs = model.predict_proba(X)
    
    y_idx = np.argmax(probs, axis=-1).T
    if model_info["is_multilabel"]:
        y = [", ".join([model_info["include_labels"][j] for j, col in enumerate(row) if col == 1]) for row in y_idx]
        confidence = [np.prod([probs[j][i][col] for j, col in enumerate(row)]) for i, row in enumerate(y_idx)]
    else:
        y = [model_info["include_labels"][i] for i in y_idx]
        confidence = probs[np.arange(len(probs)), y_idx]
        
    df_processed = df_processed.with_columns(
        [
            pl.Series("predicted_labels", y),
            pl.Series("prediction_confidence", confidence),
        ]
    )

    df = read_dataset(filepath, False)
    df = df.drop(["predicted_labels", "prediction_confidence"], strict=False)

    df = df.with_columns(
        pl.col("segment_id").alias("old_segment_id"),
        (pl.col("user_id") + "_" + pl.col("segment_id")).alias("segment_id"),
    )

    df = df.join(
        df_processed.select(
            ["segment_id", "predicted_labels", "prediction_confidence"]
        ),
        how="left",
        on="segment_id",
    )

    df = df.with_columns(pl.col("old_segment_id").alias("segment_id"))
    df.drop("old_segment_id").write_csv(filepath, separator="\t")
