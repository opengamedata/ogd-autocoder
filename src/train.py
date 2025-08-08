import os
import time
import joblib
import pandas as pd
import numpy as np
from datetime import datetime

from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    precision_score,
    recall_score,
    f1_score,
    log_loss,
    classification_report,
)
from sklearn.linear_model import LogisticRegression
from sklearn.utils.class_weight import compute_class_weight

import tensorflow as tf
from tensorflow import keras
from keras.layers import Input, Dense
from keras.models import Sequential
from keras.callbacks import EarlyStopping

from utils import get_models_filename


RANDOM_STATE = 13


def available_features(filepath):
    columns = []
    for c in (
        get_train_df(filepath).drop(columns=["segment_labels", "segment_id"]).columns
    ):
        if (len(columns) == 0) or (c.split("_")[-1] != columns[-1]["name"]):
            columns.append({"name": c.split("_")[-1], "children": [c]})
        else:
            columns[-1]["children"].append(c)

    columns.sort(key=lambda x: len(x["children"]))  # sort by number of children
    return columns


def train_model(
    filepath, model_type, hyperparameters, include_labels, include_features, models_dir
):
    start_time = time.time()

    train_df = get_train_df(filepath)
    # train_df = clean_agg_df.categorize(columns=["job_name"])
    # train_df = dd.get_dummies(train_df, columns=["job_name"], dtype=float)

    # filter by label (for now only single-label support)
    train_df = train_df[train_df["segment_labels"].isin(include_labels)]

    le = LabelEncoder()
    target_col = le.fit_transform(train_df["segment_labels"])  # converts to ints
    if model_type == "neural-net":
        target_col = keras.utils.to_categorical(
            target_col, num_classes=len(le.classes_)
        )  # converts to dummies

    x_train_full, x_test, y_train_full, y_test = train_test_split(
        train_df[
            include_features
        ],  # train_df.drop(columns=['segment_labels', 'segment_id']),
        target_col,
        train_size=float(hyperparameters["train_test_ratio"]),
        random_state=RANDOM_STATE,
        stratify=train_df["segment_labels"],  # same proportion in both splits
        # fixme - maybe try bootstrap
    )

    output = f"Row Count:\t{len(train_df)}\n"
    output += f"Input Columns:\t{x_train_full.shape[1]}\n"
    output += f"Classes Count:\n"
    for label, count in train_df["segment_labels"].value_counts().items():
        output += f"  {label}\t{count}\n"
    output += "\n"

    # add to (output +=)
    # print("x Train Shape: " + str(x_train.shape))
    # print("x Validation Shape: " + str(x_val.shape))
    # print("x Test Shape: " + str(x_test.shape))

    model_info = {}  # stores the metrics and some other model info (to save model)
    model_info["model_type"] = model_type
    model_info["num_features"] = x_train_full.shape[1]
    model_info["include_labels"] = include_labels
    model_info["include_features"] = include_features
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

    model_info["hyperparameters"] = (
        hyperparameters  # might have been updated inside train_ of specific model
    )
    model_info["output"] = output
    model_info["time_taken"] = time_taken
    model_info["timestamp_end"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # for model comparison
    models_filepath = get_models_filename(filepath)
    if os.path.exists(models_filepath):
        models_df = pd.read_json(models_filepath, orient="records")
        if "timestamp_end" in models_df.columns:
            models_df = models_df.astype({"timestamp_end": "string"})
    else:
        models_df = pd.DataFrame(columns=model_info.keys())

    for k, v in model_info.items():
        if k not in models_df.columns:
            models_df[k] = np.nan

    # insert new rows
    row = {col: model_info.get(col, np.nan) for col in models_df.columns}
    models_df.loc[len(models_df)] = row

    models_df.to_json(models_filepath, orient="records")

    return output, model_info


def get_train_df(filepath):
    # segment_id is the new task_id, segment_labels is the target
    df = pd.read_csv(filepath, sep="\t")  # , dtype=COL_DTYPES)
    # fixme - add support for multiple labels
    # fixme - job_name dummies
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="mixed")
    # fixme - the ID is the segment_id + user_id
    df["segment_id"] = df["user_id"] + "-" + df["segment_id"].astype(str)

    # additional feature: segment duration in seconds
    duration_df = (
        df.groupby("segment_id")["timestamp"]
        .agg(segment_start="min", segment_end="max")
        .assign(
            segment_duration=lambda x: (
                x["segment_end"] - x["segment_start"]
            ).dt.total_seconds()
        )
        .reset_index()[["segment_id", "segment_duration"]]
    )

    clean_df = df[["event_name", "segment_id", "segment_labels"]]  # , "job_name"
    # remove NA's
    clean_df = clean_df.dropna()
    # clean_df = clean_df.categorize(columns=["event_name"])
    clean_1hot_df = pd.get_dummies(
        clean_df, columns=["event_name"], dtype=float
    )  # , "job_name"
    grouped = clean_1hot_df.groupby(["segment_id", "segment_labels"])

    percent_df = grouped.mean() * 100
    sum_df = grouped.sum()
    count_df = grouped.size().rename("row_count")

    clean_agg_df = (
        percent_df.reset_index()
        .merge(
            sum_df.reset_index(),
            on=["segment_id", "segment_labels"],
            suffixes=("_percent", "_sum"),
        )
        .merge(count_df.reset_index(), on=["segment_id", "segment_labels"])
        .merge(duration_df, on="segment_id", how="left")
    )
    return clean_agg_df


def train_neural_net(
    x_train, x_test, y_train, y_test, classes, hyperparameters, models_dir, metrics
):
    output = ""
    x_train_tensor = tf.convert_to_tensor(x_train)
    y_train_tensor = tf.convert_to_tensor(y_train)
    x_test_tensor = tf.convert_to_tensor(x_test)
    y_test_tensor = tf.convert_to_tensor(y_test)

    y_train_int = np.argmax(y_train, axis=1)  # transform to int from 1-hot
    class_labels = np.unique(y_train_int)
    class_weights = compute_class_weight(
        class_weight=(
            "balanced" if hyperparameters.get("balance_classes", False) else None
        ),
        classes=class_labels,
        y=y_train_int,
    )
    class_weights = dict(zip(class_labels, class_weights))

    hyperparameters["epochs"] = hyperparameters.get("epochs", 10)
    hyperparameters["learning_rate"] = hyperparameters.get("learning_rate", 0.01)
    hyperparameters["n_layers"] = hyperparameters.get("n_layers", 0)
    hyperparameters["units_per_layer"] = hyperparameters.get("units_per_layer", [])
    model = Sequential()
    model.add(Input(shape=(x_train_tensor.shape[1],)))

    for l in range(hyperparameters["n_layers"]):
        model.add(Dense(hyperparameters["units_per_layer"][l], activation="relu"))

    model.add(Dense(len(classes), activation="softmax"))
    adam = keras.optimizers.Adam(learning_rate=hyperparameters["learning_rate"])
    model.compile(optimizer=adam, loss="categorical_crossentropy", metrics=["accuracy"])

    early_stopping = EarlyStopping(
        monitor="val_loss",
        patience=5,  # fixme - check if necessary...
        # restores model weights from the epoch with the best value of the monitored quantity
        restore_best_weights=True,
    )

    model.fit(
        x_train_tensor,
        y_train_tensor,
        epochs=hyperparameters["epochs"],
        class_weight=class_weights,
        batch_size=32,
        validation_data=(x_test_tensor, y_test_tensor),
        callbacks=[early_stopping],
    )
    loss, accuracy = model.evaluate(x_test_tensor, y_test_tensor)
    output += f"Class Weights (greater means error is more critical):\n"
    for i, w in class_weights.items():
        output += f"  {classes[i]}\t{round(w, 2)}\n"
    output += "\n"

    metrics["test_accuracy"] = accuracy
    output += f"Test Accuracy:\t{accuracy}\n"
    # output += (f"Test Loss:\t{loss}\n\n")

    loss, accuracy = model.evaluate(x_train_tensor, y_train_tensor)
    metrics["train_accuracy"] = accuracy
    output += f"Train Accuracy:\t{accuracy}\n\n"
    # output += (f"Train Loss:\t{loss}\n\n")

    y_pred_test = np.argmax(model.predict(x_test_tensor), axis=1)
    y_pred_train = np.argmax(model.predict(x_train_tensor), axis=1)
    y_test = np.argmax(y_test, axis=1)
    y_train = np.argmax(y_train, axis=1)

    metrics["train_f1"] = f1_score(y_train, y_pred_train, average="weighted")
    metrics["test_f1"] = f1_score(y_test, y_pred_test, average="weighted")

    add_label_oriented_metrics(
        metrics, y_test, y_pred_test, y_train, y_pred_train, classes
    )

    output += classification_report(y_test, y_pred_test, target_names=classes)

    metrics["model_path"] = os.path.join(models_dir, "neural_net_" + datetime.now().strftime("%Y-%m-%dT%H-%M-%S") + ".h5")
    model.save(metrics["model_path"])

    return output


def train_logistic(x_train, x_test, y_train, y_test, classes, hyperparameters, models_dir, metrics):
    output = ""

    hyperparameters["penalty"] = hyperparameters.get("penalty", None)
    hyperparameters["lambda"] = hyperparameters.get("lambda", 1.0)
    if hyperparameters["lambda"] == 0:
        hyperparameters["penalty"] = None

    class_labels = np.unique(y_train)
    class_weights = compute_class_weight(
        class_weight=(
            "balanced" if hyperparameters.get("balance_classes", False) else None
        ),
        classes=class_labels,
        y=y_train,
    )
    class_weights = dict(zip(class_labels, class_weights))

    model = LogisticRegression(
        random_state=RANDOM_STATE,
        class_weight=class_weights,
        solver="liblinear",
        penalty=hyperparameters["penalty"],
        C=1 / (hyperparameters["lambda"] + 1e-5),  # avoid zero division
    )
    model.fit(x_train, y_train)

    output += f"Class Weights (greater means error is more critical):\n"
    for i, w in class_weights.items():
        output += f"  {classes[i]}\t{round(w, 2)}\n"
    output += "\n"

    metrics["test_accuracy"] = model.score(x_test, y_test)
    output += f"Test Accuracy:\t{metrics['test_accuracy']}\n"
    # output += (f"Test Loss: {log_loss(y_test, model.predict(x_test))}\n\n")

    metrics["train_accuracy"] = model.score(x_train, y_train)
    output += f"Train Accuracy:\t{metrics['train_accuracy']}\n\n"
    # output += (f"Train Loss: {log_loss(y_train, model.predict(x_train))}\n\n")

    y_pred_test = model.predict(x_test)
    y_pred_train = model.predict(x_train)
    metrics["train_f1"] = f1_score(y_train, model.predict(x_train), average="weighted")
    metrics["test_f1"] = f1_score(y_test, y_pred_test, average="weighted")
    add_label_oriented_metrics(
        metrics, y_test, y_pred_test, y_train, y_pred_train, classes
    )

    output += classification_report(y_test, y_pred_test, target_names=classes)

    metrics["model_path"] = os.path.join(models_dir, "logistic_" + datetime.now().strftime("%Y-%m-%dT%H-%M-%S") + ".pkl")
    joblib.dump(model, metrics["model_path"])

    return output


def train_random_forest(
    x_train, x_test, y_train, y_test, classes, hyperparameters, models_dir, metrics
):
    output = ""
    hyperparameters["n_estimators"] = hyperparameters.get("n_estimators", 100)
    hyperparameters["max_depth"] = hyperparameters.get("max_depth", 3)

    class_labels = np.unique(y_train)
    class_weights = compute_class_weight(
        class_weight=(
            "balanced" if hyperparameters.get("balance_classes", False) else None
        ),
        classes=class_labels,
        y=y_train,
    )
    class_weights = dict(zip(class_labels, class_weights))

    model = RandomForestClassifier(
        random_state=RANDOM_STATE,
        class_weight=class_weights,
        n_estimators=hyperparameters["n_estimators"],
        max_depth=hyperparameters["max_depth"],
    )
    model.fit(x_train, y_train)

    metrics["test_accuracy"] = model.score(x_test, y_test)
    metrics["train_accuracy"] = model.score(x_train, y_train)

    output += f"Class Weights (greater means error is more critical):\n"
    for i, w in class_weights.items():
        output += f"  {classes[i]}\t{round(w, 2)}\n"
    output += "\n"

    output += f"Test Accuracy:\t{metrics['test_accuracy']}\n"
    output += f"Train Accuracy:\t{metrics['train_accuracy']}\n\n"

    y_pred_test = model.predict(x_test)
    y_pred_train = model.predict(x_train)
    metrics["train_f1"] = f1_score(y_train, model.predict(x_train), average="weighted")
    metrics["test_f1"] = f1_score(y_test, y_pred_test, average="weighted")
    add_label_oriented_metrics(
        metrics, y_test, y_pred_test, y_train, y_pred_train, classes
    )

    output += classification_report(y_test, y_pred_test, target_names=classes)

    metrics["model_path"] = os.path.join(models_dir, "random_forest_" + datetime.now().strftime("%Y-%m-%dT%H-%M-%S") + ".pkl")
    joblib.dump(model, metrics["model_path"])

    return output


def add_label_oriented_metrics(
    metrics, y_test, y_pred_test, y_train, y_pred_train, classes
):
    test_precisions = precision_score(y_test, y_pred_test, average=None)
    test_recalls = recall_score(y_test, y_pred_test, average=None)
    train_precisions = precision_score(y_train, y_pred_train, average=None)
    train_recalls = recall_score(y_train, y_pred_train, average=None)

    for i, class_name in enumerate(classes):
        key_safe = class_name.lower().replace(" ", "_")
        metrics[f"test_precision_{key_safe}"] = test_precisions[i]
        metrics[f"test_recall_{key_safe}"] = test_recalls[i]
        metrics[f"train_precision_{key_safe}"] = train_precisions[i]
        metrics[f"train_recall_{key_safe}"] = train_recalls[i]
