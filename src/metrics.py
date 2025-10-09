import numpy as np
from sklearn.metrics import f1_score, roc_auc_score, precision_score, recall_score


def fill_metrics(y_prob_train, y_prob_test, y_train, y_test, classes, metrics):
    """
    Computes and saves to `metrics`: f1 score, auc, precision and recall for each class.

    :param y_prob_train: predicted probabilities for each class in train
    :param y_prob_test: predicted probabilities for each class in test
    :param y_train: real train labels
    :param y_test: real test labels
    :param classes: list of class names (mappings int to str)
    :param metrics: object where the metrics will be stored
    :return:
    """

    # converts probabilities to int classes
    y_pred_test = np.argmax(y_prob_test, axis=1)
    y_pred_train = np.argmax(y_prob_train, axis=1)
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

    # label specific metrics
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
