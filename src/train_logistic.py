import numpy as np
import os
import joblib
from datetime import datetime
import numpy as np
from sklearn.metrics import classification_report
from sklearn.linear_model import LogisticRegression
from sklearn.utils.class_weight import compute_class_weight
from metrics import fill_metrics


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
        # random_state=RANDOM_STATE,
        class_weight=class_weights,
        solver="liblinear",
        penalty=hyperparameters["penalty"],
        C=1 / (hyperparameters["lambda"] + 1e-5),  # avoid zero division
    )
    model.fit(x_train, y_train)

    y_prob_test = model.predict_proba(x_test)
    y_prob_train = model.predict_proba(x_train)
    metrics["train_accuracy"] = model.score(x_train, y_train)
    metrics["test_accuracy"] = model.score(x_test, y_test)
    output += f"Test Accuracy:\t{metrics['test_accuracy']}\n"
    output += f"Train Accuracy:\t{metrics['train_accuracy']}\n\n"

    fill_metrics(y_prob_train, y_prob_test, y_train, y_test, classes, metrics)

    test_pred_class = np.argmax(y_prob_test, axis=1)
    output += classification_report(y_test, test_pred_class, target_names=classes)

    output += f"\nClass Weights (greater means error is more critical):\n"
    for i, w in class_weights.items():
        output += f"  {classes[i]}\t{round(w, 2)}\n"
    output += "\n"

    metrics["model_path"] = os.path.join(
        models_dir, "logistic_" + datetime.now().strftime("%Y-%m-%dT%H-%M-%S") + ".pkl"
    )
    joblib.dump(model, metrics["model_path"])

    return output
