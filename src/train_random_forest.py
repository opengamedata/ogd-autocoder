import os
import joblib
from datetime import datetime
import numpy as np
from sklearn.metrics import classification_report
from sklearn.ensemble import RandomForestClassifier
from sklearn.utils.class_weight import compute_class_weight
from metrics import fill_metrics
from cl_type_enum import ClType
from sklearn.multioutput import MultiOutputClassifier


def train_random_forest(
    x_train, x_test, y_train, y_test, classes, problem_type, hyperparameters, models_dir, metrics
):
    output = ""
    hyperparameters["n_estimators"] = hyperparameters.get("n_estimators", 100)
    hyperparameters["max_depth"] = hyperparameters.get("max_depth", 3)
    
    if problem_type == ClType.MULTI_CLASS:
        class_labels = np.unique(y_train)
        class_weights = compute_class_weight(
            class_weight=(
                "balanced" if hyperparameters.get("balance_classes", False) else None
            ),
            classes=class_labels,
            y=y_train,
        )
        class_weights = dict(zip(class_labels, class_weights))
    else:
        class_weights = []
        class_labels = np.array([0,1])
        for i in range(y_train.shape[1]):
            weights = compute_class_weight(
                class_weight=(
                    "balanced" if hyperparameters.get("balance_classes", False) else None
                ),
                classes=class_labels,
                y=y_train[:, i],
            )
            class_weights.append(dict(zip(class_labels, weights)))

    model = RandomForestClassifier(
        # random_state=RANDOM_STATE,
        class_weight=class_weights,
        n_estimators=hyperparameters["n_estimators"],
        max_depth=hyperparameters["max_depth"],
    )

    model.fit(x_train, y_train)

    y_prob_test = model.predict_proba(x_test)
    y_prob_train = model.predict_proba(x_train)
    metrics["train_accuracy"] = model.score(x_train, y_train)
    metrics["test_accuracy"] = model.score(x_test, y_test)
    output += f"Test Accuracy:\t{metrics['test_accuracy']}\n"
    output += f"Train Accuracy:\t{metrics['train_accuracy']}\n\n"

    fill_metrics(y_prob_train, y_prob_test, y_train, y_test, classes, metrics, problem_type)

    test_pred_class = model.predict(x_test)
    output += classification_report(y_test, test_pred_class, target_names=classes)

    output += f"\nClass Weights (greater means error is more critical):\n"
    if problem_type == ClType.MULTI_CLASS:
        for i, w in class_weights.items():
            output += f"  {classes[i]}\t{round(w, 2)}\n"
    else:
        for i in range(len(class_weights)):
            # display only positive class weight
            output += f"  {classes[i]}\t{round(class_weights[i][1], 2)}\n"

    output += "\n"
    metrics["model_path"] = os.path.join(
        models_dir,
        "random_forest_" + datetime.now().strftime("%Y-%m-%dT%H-%M-%S") + ".pkl",
    )
    joblib.dump(model, metrics["model_path"])

    return output
