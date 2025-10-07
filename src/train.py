import os
import time
import joblib
import torch
import pandas as pd
import numpy as np
from datetime import datetime
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.pipeline import Pipeline
from sklearn.decomposition import PCA

from train_logistic import train_logistic
from train_random_forest import train_random_forest
from train_neural_net import train_neural_net
from inference import get_models_filename
from preprocess import preprocess_df
from dim_reduction import AVAILABLE_SCALERS

RANDOM_STATE = 13


def train_model(
    filepath, username, model_type, hyperparameters, include_labels, include_features, models_dir
):
    start_time = time.time()

    train_df = preprocess_df(filepath, username).to_pandas()
    # train_df = clean_agg_df.categorize(columns=["job_name"])
    # train_df = dd.get_dummies(train_df, columns=["job_name"], dtype=float)

    # filter by label (for now only single-label support)
    train_df = train_df[train_df["segment_labels"].isin(include_labels)]

    le = LabelEncoder()
    target_col = le.fit_transform(train_df["segment_labels"])  # converts to ints
    if model_type == "neural-net":
        target_col = torch.nn.functional.one_hot(
            torch.tensor(target_col).long(), num_classes=len(le.classes_)
        )

    train_cols = [c for c in include_features if c in train_df.columns]
    empty_cols = [c for c in include_features if c not in train_df.columns]

    x_train_full, x_test, y_train_full, y_test = train_test_split(
        train_df[train_cols].to_numpy(),
        target_col,
        train_size=float(hyperparameters["train_test_ratio"]),
        random_state=RANDOM_STATE,
        stratify=train_df["segment_labels"],  # same proportion in both splits
        # fixme - maybe try bootstrap
    )

    output = (
        "[WARN] Empty columns (not selected): " + str(empty_cols) + "\n\n"
        if len(empty_cols) > 0
        else ""
    )

    # stores the metrics and some other model info (to save model)
    model_info = {}
    model_info["model_type"] = model_type
    model_info["num_features"] = x_train_full.shape[1]
    # to avoid saving label encoder object, may have different order from include_labels
    model_info["include_labels"] = le.classes_.tolist()
    model_info["include_features"] = include_features

    preprocess_pipe = []

    scaler_choice = hyperparameters.get("scaling", False)
    if scaler_choice in AVAILABLE_SCALERS:
        preprocess_pipe.append(("scaler", AVAILABLE_SCALERS[scaler_choice]()))

    pca_comps = hyperparameters.get("pca_comps", 0)
    if pca_comps > 0:
        preprocess_pipe.append(("pca", PCA(n_components=pca_comps)))

    if len(preprocess_pipe):
        pipe = Pipeline(preprocess_pipe)
        # important - only fit on train data to avoid leaks
        x_train_full = pipe.fit_transform(x_train_full)
        x_test = pipe.transform(x_test)
        model_info["preprocessor_path"] = os.path.join(
            models_dir,
            "preprocessor_" + datetime.now().strftime("%Y-%m-%dT%H-%M-%S") + ".pkl",
        )
        joblib.dump(pipe, model_info["preprocessor_path"])

    if model_type == "logistic":
        model_info["model_name"] = "Logistic Regression"
        output += train_logistic(
            x_train_full,
            x_test,
            y_train_full,
            y_test,
            le.classes_,
            hyperparameters,
            models_dir,
            model_info,
        )
    elif model_type == "random-forest":
        model_info["model_name"] = "Random Forest"
        output += train_random_forest(
            x_train_full,
            x_test,
            y_train_full,
            y_test,
            le.classes_,
            hyperparameters,
            models_dir,
            model_info,
        )
    elif model_type == "neural-net":
        model_info["model_name"] = "Neural Network"
        # y is one-hot encoded here !!
        output += train_neural_net(
            x_train_full,
            x_test,
            y_train_full,
            y_test,
            le.classes_,
            hyperparameters,
            models_dir,
            model_info,
        )
    else:
        output += "Invalid Model Selected"

    time_taken = time.time() - start_time

    output = f"{model_info['model_name']}: \t{round(time_taken, 2)} secs\n\n" + output
    output += f"Row Count:\t{len(train_df)}\n"
    output += f"Input Columns:\t{x_train_full.shape[1]}\n"
    output += f"Classes Count:\n"
    for label, count in train_df["segment_labels"].value_counts().items():
        output += f"  {label}\t{count}\n"

    # might have been updated inside train_ of specific model
    model_info["hyperparameters"] = hyperparameters

    model_info["output"] = output
    model_info["time_taken"] = time_taken
    model_info["timestamp_end"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    model_info["username"] = username

    # for model comparison
    models_filepath = get_models_filename(filepath)
    if os.path.exists(models_filepath):
        models_df = pd.read_json(models_filepath, orient="records")
        if "timestamp_end" in models_df.columns:
            models_df = models_df.astype({"timestamp_end": "string"})
    else:
        models_df = pd.DataFrame(columns=model_info.keys())

    for k in model_info.keys():
        if k not in models_df.columns:
            models_df[k] = np.nan

    # insert new rows
    row = {col: model_info.get(col, np.nan) for col in models_df.columns}
    models_df.loc[len(models_df)] = row

    models_df.to_json(models_filepath, orient="records")

    return output, model_info
