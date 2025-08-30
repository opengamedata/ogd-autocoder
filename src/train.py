import os
import time
import joblib
import json
import pandas as pd
import polars as pl
import numpy as np
from datetime import datetime
import numpy as np
import copy

from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    classification_report,
)
from sklearn.linear_model import LogisticRegression
from sklearn.utils.class_weight import compute_class_weight

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
# from ogd_features import list_ogd_features, calculate_ogd_features

from utils import get_models_filename, read_dataset

RANDOM_STATE = 13

if torch.cuda.is_available():
    device = "cuda"
else:
    device = "cpu"


def available_features(filepath):
    # preprocess without using ogd pipeline to save some calculations
    columns = preprocess_df_no_ogd(filepath).drop(["segment_labels", "segment_id", "user_id"]).columns

    # load also OGD features
    game_id = get_game_id(filepath)
    # ogd_columns = list_ogd_features(game_id)
    ogd_columns = []
    return {"included_features": [{"name": c} for c in columns], "excluded_features": ogd_columns}


def correlation(filepath):
    df = preprocess_df(filepath).drop(["segment_labels", "segment_id"])

    corr_matrix = df.corr().to_pandas().abs()
    corr_matrix.index = corr_matrix.columns
    np.fill_diagonal(corr_matrix.values, 0) # fill 0s in self correlation
    
    return corr_matrix.fillna("null").to_dict(orient="dict")

def train_model(
    filepath, model_type, hyperparameters, include_labels, include_features, models_dir
):
    start_time = time.time()

    train_df = preprocess_df(filepath).to_pandas()
    # train_df = clean_agg_df.categorize(columns=["job_name"])
    # train_df = dd.get_dummies(train_df, columns=["job_name"], dtype=float)

    # filter by label (for now only single-label support)
    train_df = train_df[train_df["segment_labels"].isin(include_labels)]

    le = LabelEncoder()
    target_col = le.fit_transform(train_df["segment_labels"])  # converts to ints
    if model_type == "neural-net":
        target_col = nn.functional.one_hot(
            torch.tensor(target_col).long(), num_classes=len(le.classes_)
        )

    train_cols = [c for c in include_features if c in train_df.columns]
    empty_cols = [c for c in include_features if c not in train_df.columns]

    x_train_full, x_test, y_train_full, y_test = train_test_split(
        train_df[train_cols],
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

    # add to (output +=)
    # print("x Train Shape: " + str(x_train.shape))
    # print("x Validation Shape: " + str(x_val.shape))
    # print("x Test Shape: " + str(x_test.shape))

    # stores the metrics and some other model info (to save model)
    model_info = {}
    model_info["model_type"] = model_type
    model_info["num_features"] = x_train_full.shape[1]
    # to avoid saving label encoder object, may have different order from include_labels
    model_info["include_labels"] = le.classes_.tolist()
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
    output += f"Row Count:\t{len(train_df)}\n"
    output += f"Input Columns:\t{x_train_full.shape[1]}\n"
    output += f"Classes Count:\n"
    for label, count in train_df["segment_labels"].value_counts().items():
        output += f"  {label}\t{count}\n"

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


def preprocess_df_no_ogd(filepath):
    """
    Preprocess using one hot encoding (no ogd features)
    """
    # fixme - add support for multiple labels
    # segment_id is the new task_id, segment_labels is the target
    df = read_dataset(filepath)
    # fixme - add support for multiple labels
    # fixme - job_name dummies
    df = df.with_columns(pl.col("timestamp").str.strptime(pl.Datetime, strict=False))

    # additional feature: segment duration in seconds
    duration_df = (
        df.group_by(["user_id", "segment_id"])
        .agg(
            [
                pl.col("timestamp").min().alias("segment_start"),
                pl.col("timestamp").max().alias("segment_end"),
            ]
        )
        .with_columns(
            (pl.col("segment_end") - pl.col("segment_start"))
            .dt.total_seconds()
            .alias("segment_duration")
        )
        .select(["user_id", "segment_id", "segment_duration"])
    )

    # fixme replace N/A method
    clean_df = (
        df.select(["event_name", "user_id", "segment_id", "segment_labels"])
        .with_columns(
            pl.col("segment_labels").fill_null(
                "N/A"
            )  # to include these rows (needed for inference)
        )
        .drop_nulls()  # Drop rows with any remaining nulls
    )
    # clean_df = clean_df.categorize(columns=["event_name"])
    clean_1hot_df = clean_df.to_dummies(columns=["event_name"])

    grouped = clean_1hot_df.group_by(["user_id", "segment_id", "segment_labels"])
    count_df = grouped.len().rename({"len": "count_events"})
    sum_df = grouped.sum()
    sum_df = sum_df.rename(
        {
            col: f"{col}_sum"
            for col in sum_df.columns
            if col not in ["user_id", "segment_id", "segment_labels"]
        }
    )

    clean_agg_df = sum_df.join(
        count_df, on=["user_id", "segment_id", "segment_labels"]
    ).join(duration_df, on=["user_id", "segment_id"], how="left")

    numeric_cols = [
        c
        for c in sum_df.columns
        if c not in ["user_id", "segment_id", "segment_labels"]
    ]
    # add percentage columns
    clean_agg_df = clean_agg_df.with_columns(
        [
            (pl.col(c) / pl.col("count_events") * 100).alias(c + "_percent")
            for c in numeric_cols
        ]
    )

    return clean_agg_df


def get_game_id(filepath):
    # read first row for app_id
    df = pl.read_csv(
        filepath, n_rows=1, separator="\t", dtypes={"segment_id": pl.String}
    )
    return df[0, "app_id"]


def preprocess_df(filepath):
    # merge with ogd features
    df_no_ogd = preprocess_df_no_ogd(filepath)
    # game_id = get_game_id(filepath)

    # df_features = calculate_ogd_features(game_id, filepath)
    # if len(df_features):
    #     clean_agg_df_ogd = df_no_ogd.join(df_features, how="left", on=["user_id"])
    # else:
    clean_agg_df_ogd = df_no_ogd

    # fixme - the ID is the segment_id + user_id
    clean_agg_df_ogd = clean_agg_df_ogd.with_columns(
        (pl.col("user_id") + "_" + pl.col("segment_id")).alias("segment_id")
    )
    clean_agg_df_ogd = clean_agg_df_ogd.drop(["user_id"])

    return clean_agg_df_ogd


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
    if model_info["model_type"] == "neural-net":
        model = model.load_state_dict(torch.load(model_info["model_path"]))
        probs = nn.functional.softmax(model(X), dim=1)
    else:
        model = joblib.load(model_info["model_path"])
        probs = model.predict_proba(X)

    y_idx = np.argmax(probs, axis=1)
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


def train_neural_net(
    x_train, x_test, y_train, y_test, classes, hyperparameters, models_dir, metrics
):
    output = ""
    x_train_tensor = torch.tensor(x_train.to_numpy(), dtype=torch.float32)
    y_train_tensor = torch.tensor(y_train, dtype=torch.float32)
    x_test_tensor = torch.tensor(x_test.to_numpy(), dtype=torch.float32)
    y_test_tensor = torch.tensor(y_test, dtype=torch.float32)

    train_dataset = TensorDataset(x_train_tensor, y_train_tensor)
    train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)
    test_dataset = TensorDataset(x_test_tensor, y_test_tensor)
    test_loader = DataLoader(test_dataset, batch_size=32, shuffle=False)

    y_train_int = np.argmax(y_train.numpy(), axis=1)  # transform to int from 1-hot
    class_labels = np.unique(y_train_int)
    class_weights = compute_class_weight(
        class_weight=(
            "balanced" if hyperparameters.get("balance_classes", False) else None
        ),
        classes=class_labels,
        y=y_train_int,
    )
    # class_weights = dict(zip(class_labels, class_weights))

    hyperparameters["epochs"] = hyperparameters.get("epochs", 10)
    hyperparameters["learning_rate"] = hyperparameters.get("learning_rate", 0.01)
    hyperparameters["n_layers"] = hyperparameters.get("n_layers", 0)
    hyperparameters["units_per_layer"] = hyperparameters.get("units_per_layer", [])

    model = CustomNeuralNet(
        x_train_tensor.shape[1], hyperparameters["units_per_layer"], len(classes)
    )
    criterion = nn.CrossEntropyLoss(weight=torch.tensor(class_weights))
    optimizer = optim.Adam(model.parameters(), lr=hyperparameters["learning_rate"])

    test_loss_hist, test_acc_hist = [], []
    best_acc = 0
    best_weights = None

    for epoch in range(hyperparameters["epochs"]):
        neural_train(model, train_loader, criterion, optimizer)
        val_loss, val_acc = neural_evaluate(model, test_loader, criterion)

        test_loss_hist.append(val_loss)
        test_acc_hist.append(val_acc)

        # Track best model
        if val_acc > best_acc:
            best_acc = val_acc
            best_weights = copy.deepcopy(model.state_dict())

        print(f"Epoch {epoch+1}: Val Loss={val_loss:.4f}, Val Acc={val_acc*100:.2f}%")

    # Restore best model
    model.load_state_dict(best_weights)
    loss, accuracy = neural_evaluate(model, test_loader, criterion)

    metrics["test_accuracy"] = accuracy
    output += f"Test Accuracy:\t{accuracy}\n"
    # output += (f"Test Loss:\t{loss}\n\n")

    loss, accuracy = neural_evaluate(model, train_loader, criterion)
    metrics["train_accuracy"] = accuracy
    output += f"Train Accuracy:\t{accuracy}\n\n"
    # output += (f"Train Loss:\t{loss}\n\n")

    model.eval()
    with torch.no_grad():
        y_prob_test = nn.functional.softmax(model(x_test_tensor), dim=1)
        y_prob_train = nn.functional.softmax(model(x_train_tensor), dim=1)
    y_pred_test = np.argmax(y_prob_test, axis=1)
    y_pred_train = np.argmax(y_prob_train, axis=1)
    y_test = np.argmax(y_test, axis=1)
    y_train = np.argmax(y_train, axis=1)

    metrics["train_f1"] = f1_score(y_train, y_pred_train, average="weighted")
    metrics["test_f1"] = f1_score(y_test, y_pred_test, average="weighted")

    if len(np.unique(y_test)) == 2:
        # binary
        y_prob_test = y_prob_test[:, 1]
        y_prob_train = y_prob_train[:, 1]

    metrics["test_auc"] = roc_auc_score(
        y_test, y_prob_test, multi_class="ovr", average="weighted"
    )
    metrics["train_auc"] = roc_auc_score(
        y_train, y_prob_train, multi_class="ovr", average="weighted"
    )  # One-vs-rest

    add_label_oriented_metrics(
        metrics, y_test, y_pred_test, y_train, y_pred_train, classes
    )

    output += classification_report(y_test, y_pred_test, target_names=classes)

    output += f"\nClass Weights (greater means error is more critical):\n"
    for i, w in zip(class_labels, class_weights):
        output += f"  {classes[i]}\t{round(w, 2)}\n"
    output += "\n"
    metrics["model_path"] = os.path.join(
        models_dir, "neural_net_" + datetime.now().strftime("%Y-%m-%dT%H-%M-%S") + ".h5"
    )
    torch.save(best_weights, metrics["model_path"])
    return output


def train_logistic(
    x_train, x_test, y_train, y_test, classes, hyperparameters, models_dir, metrics
):
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

    y_prob_test = model.predict_proba(x_test)
    y_prob_train = model.predict_proba(x_train)
    if len(np.unique(y_test)) == 2:
        # binary
        y_prob_test = y_prob_test[:, 1]
        y_prob_train = y_prob_train[:, 1]

    metrics["test_auc"] = roc_auc_score(
        y_test, y_prob_test, multi_class="ovr", average="weighted"
    )
    metrics["train_auc"] = roc_auc_score(
        y_train, y_prob_train, multi_class="ovr", average="weighted"
    )  # One-vs-rest

    add_label_oriented_metrics(
        metrics, y_test, y_pred_test, y_train, y_pred_train, classes
    )

    output += classification_report(y_test, y_pred_test, target_names=classes)

    output += f"\nClass Weights (greater means error is more critical):\n"
    for i, w in class_weights.items():
        output += f"  {classes[i]}\t{round(w, 2)}\n"
    output += "\n"

    metrics["model_path"] = os.path.join(
        models_dir, "logistic_" + datetime.now().strftime("%Y-%m-%dT%H-%M-%S") + ".pkl"
    )
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

    output += f"Test Accuracy:\t{metrics['test_accuracy']}\n"
    output += f"Train Accuracy:\t{metrics['train_accuracy']}\n\n"

    y_pred_test = model.predict(x_test)
    y_pred_train = model.predict(x_train)
    metrics["train_f1"] = f1_score(y_train, model.predict(x_train), average="weighted")
    metrics["test_f1"] = f1_score(y_test, y_pred_test, average="weighted")

    y_prob_test = model.predict_proba(x_test)
    y_prob_train = model.predict_proba(x_train)
    if len(np.unique(y_test)) == 2:
        # binary
        y_prob_test = y_prob_test[:, 1]
        y_prob_train = y_prob_train[:, 1]

    metrics["test_auc"] = roc_auc_score(
        y_test, y_prob_test, multi_class="ovr", average="weighted"
    )
    metrics["train_auc"] = roc_auc_score(
        y_train, y_prob_train, multi_class="ovr", average="weighted"
    )  # One-vs-rest
    add_label_oriented_metrics(
        metrics, y_test, y_pred_test, y_train, y_pred_train, classes
    )

    output += classification_report(y_test, y_pred_test, target_names=classes)

    output += f"\nClass Weights (greater means error is more critical):\n"
    for i, w in class_weights.items():
        output += f"  {classes[i]}\t{round(w, 2)}\n"
    output += "\n"

    metrics["model_path"] = os.path.join(
        models_dir,
        "random_forest_" + datetime.now().strftime("%Y-%m-%dT%H-%M-%S") + ".pkl",
    )
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


def neural_evaluate(model, dataloader, loss_fn):
    size = len(dataloader.dataset)
    num_batches = len(dataloader)
    model.eval()
    test_loss, accuracy = 0, 0
    with torch.no_grad():
        for X, y in dataloader:
            X, y = X.to(device), y.to(device)
            pred = model(X)
            test_loss += loss_fn(pred, y).item()
            accuracy += (
                (torch.argmax(pred, 1) == torch.argmax(y, 1)).float().sum().item()
            )
    test_loss /= num_batches
    accuracy /= size

    return test_loss, accuracy


def neural_train(model, dataloader, loss_fn, optimizer):
    # Training loop with DataLoader
    size = len(dataloader.dataset)
    model.train()
    for batch, (X, y) in enumerate(dataloader):
        X, y = X.to(device), y.to(device)

        # Compute prediction error
        pred = model(X)
        loss = loss_fn(pred, y)

        # Backpropagation
        loss.backward()
        optimizer.step()
        optimizer.zero_grad()

        if batch % 10 == 0:
            loss, current = loss.item(), (batch + 1) * len(X)
            print(f"loss: {loss:>7f}  [{current:>5d}/{size:>5d}]")


class CustomNeuralNet(nn.Module):
    def __init__(self, input_dim, hidden_units, num_classes):
        super().__init__()
        layers = []
        layer_in_dim = input_dim
        for layer_out_dim in hidden_units:
            layers.append(nn.Linear(layer_in_dim, layer_out_dim))
            layer_in_dim = layer_out_dim

        self.hidden = nn.ModuleList(layers)
        self.act = nn.ReLU()
        self.output = nn.Linear(layer_in_dim, num_classes)

    def forward(self, x):
        for layer in self.hidden:
            x = self.act(layer(x))
        x = self.output(x)
        return x
