import os
import copy
from datetime import datetime
import torch
import numpy as np
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from sklearn.metrics import classification_report
from sklearn.utils.class_weight import compute_class_weight
from metrics import fill_metrics
from cl_type_enum import ClType

device = "cpu"
if torch.cuda.is_available():
    device = "cuda"


def train_neural_net(
    x_train, x_test, y_train, y_test, classes, problem_type, hyperparameters, models_dir, metrics
):
    output = ""
    x_train_tensor = torch.tensor(x_train, dtype=torch.float32)
    y_train_tensor = torch.tensor(y_train, dtype=torch.float32)
    x_test_tensor = torch.tensor(x_test, dtype=torch.float32)
    y_test_tensor = torch.tensor(y_test, dtype=torch.float32)

    train_dataset = TensorDataset(x_train_tensor, y_train_tensor)
    train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)
    test_dataset = TensorDataset(x_test_tensor, y_test_tensor)
    test_loader = DataLoader(test_dataset, batch_size=32, shuffle=False)

    #if problem_type == ClType.MULTI_CLASS:
    y_train_int = np.argmax(y_train.numpy(), axis=1)  # transform to int from 1-hot
    class_labels = np.unique(y_train_int)
    class_weights = compute_class_weight(
        class_weight=(
            "balanced" if hyperparameters.get("balance_classes", False) else None
        ),
        classes=class_labels,
        y=y_train_int,
    )

    hyperparameters["epochs"] = hyperparameters.get("epochs", 10)
    hyperparameters["learning_rate"] = hyperparameters.get("learning_rate", 0.01)
    hyperparameters["n_layers"] = hyperparameters.get("n_layers", 0)
    hyperparameters["units_per_layer"] = hyperparameters.get("units_per_layer", [])

    model = CustomNeuralNet(
        x_train_tensor.shape[1], hyperparameters["units_per_layer"], len(classes)
    )
    if problem_type == ClType.MULTI_LABEL:
        criterion = nn.MultiLabelSoftMarginLoss(weight=torch.tensor(class_weights))
    else:
        criterion = nn.CrossEntropyLoss(weight=torch.tensor(class_weights))

    optimizer = optim.Adam(model.parameters(), lr=hyperparameters["learning_rate"])

    test_loss_hist, test_acc_hist = [], []
    best_acc = 0
    best_weights = None

    for epoch in range(hyperparameters["epochs"]):
        neural_train(model, train_loader, criterion, optimizer)
        val_loss, val_acc = neural_evaluate(model, test_loader, criterion, problem_type)

        test_loss_hist.append(val_loss)
        test_acc_hist.append(val_acc)

        # Track best model
        if val_acc > best_acc:
            best_acc = val_acc
            best_weights = copy.deepcopy(model.state_dict())

        print(f"Epoch {epoch+1}: Val Loss={val_loss:.4f}, Val Acc={val_acc*100:.2f}%")

    # Restore best model
    model.load_state_dict(best_weights)
    loss, accuracy = neural_evaluate(model, test_loader, criterion, problem_type)

    metrics["test_accuracy"] = accuracy
    output += f"Test Accuracy:\t{accuracy}\n"

    loss, accuracy = neural_evaluate(model, train_loader, criterion, problem_type)
    metrics["train_accuracy"] = accuracy
    output += f"Train Accuracy:\t{accuracy}\n\n"

    model.eval()
    if problem_type == ClType.MULTI_LABEL:
        with torch.no_grad():
            y_prob_test = nn.functional.sigmoid(model(x_test_tensor)).T
            y_prob_train = nn.functional.sigmoid(model(x_train_tensor)).T

        output += classification_report(y_test, y_prob_test.T.round(), target_names=classes)

        # used just because fill_metrics this shape of data [p_c == 0, p_c == 1]
        y_prob_test = torch.stack([1 - y_prob_test, y_prob_test], dim=2)
        y_prob_train = torch.stack([1 - y_prob_train, y_prob_train], dim=2)
        y_train_int = y_train
    else:
        with torch.no_grad():
            y_prob_test = nn.functional.softmax(model(x_test_tensor), dim=1)
            y_prob_train = nn.functional.softmax(model(x_train_tensor), dim=1)
        y_test = np.argmax(y_test, axis=1)

        test_pred_class = np.argmax(y_prob_test, axis=1)
        output += classification_report(y_test, test_pred_class, target_names=classes)

    fill_metrics(y_prob_train, y_prob_test, y_train_int, y_test, classes, metrics, problem_type)

    output += f"\nClass Weights (greater means error is more critical):\n"
    for i, w in zip(class_labels, class_weights):
        output += f"  {classes[i]}\t{round(w, 2)}\n"
    output += "\n"
    metrics["model_path"] = os.path.join(
        models_dir, "neural_net_" + datetime.now().strftime("%Y-%m-%dT%H-%M-%S") + ".h5"
    )
    torch.save(best_weights, metrics["model_path"])
    return output


def neural_evaluate(model, dataloader, loss_fn, problem_type):
    size = len(dataloader.dataset)
    num_batches = len(dataloader)
    model.eval()
    loss, accuracy = 0, 0
    with torch.no_grad():
        for X, y in dataloader:
            X, y = X.to(device), y.to(device)
            pred = model(X)
            loss += loss_fn(pred, y).item()
            if problem_type == ClType.MULTI_LABEL:
                pred = nn.functional.sigmoid(pred).round()
                # count object if all classes were assigned correctly
                accuracy += (
                    torch.all(pred == y, dim=1).float().sum().item()
                )
            else:
                accuracy += (
                    (torch.argmax(pred, 1) == torch.argmax(y, 1)).float().sum().item()
                )
    loss /= num_batches
    accuracy /= size

    return loss, accuracy


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
