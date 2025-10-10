
import copy
import torch
import pandas as pd
from datetime import datetime
from torch.utils.data import DataLoader, Dataset
from sklearn.model_selection import train_test_split
from transformers import DistilBertTokenizer, DistilBertForSequenceClassification

# BERT LLM Finetuning

# the file must have the event_description column
df = pd.read_csv("/kaggle/input/real-ogd-data/real_data.tsv", sep="\t")


ev_filter = ~df['event_name'].isin(['script_line_displayed', 'script_fired', 'room_changed'])
print("Filtering out:", 'script_line_displayed', 'script_fired', 'room_changed')
print("ROWS BEFORE:", df.shape[0], "\nAFTER:", df[ev_filter].shape[0])

# Concatenate all event_description for all events within single group (segment)
segment_df = df[ev_filter].groupby(['segment_id', 'segment_labels'])['event_description'].apply(lambda x: '\n'.join(x)).reset_index()

# convert labels to ints
labels, lbl_int_map = pd.factorize(segment_df["segment_labels"])
# 80/20 split
train_texts, val_texts, train_labels, val_labels = train_test_split(segment_df["event_description"].values.tolist(), labels, test_size=0.2)

device_type = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f'Running on {device_type}')

device = torch.device(device_type)

tokenizer = DistilBertTokenizer.from_pretrained("distilbert-base-uncased")
train_encodings = tokenizer(train_texts, truncation=True, padding=True).to(device)
val_encodings = tokenizer(val_texts, truncation=True, padding=True).to(device)

class CustomDataset(Dataset):
    def __init__(self, encodings, labels):
        self.encodings = encodings
        self.labels = labels

    def __getitem__(self, idx):
        item = {key: torch.tensor(val[idx]) for key, val in self.encodings.items()}
        item['labels'] = torch.tensor(self.labels[idx])
        return item

    def __len__(self):
        return len(self.labels)

train_dataset = CustomDataset(train_encodings, train_labels)
val_dataset = CustomDataset(val_encodings, val_labels)

# Create data loaders
train_loader = DataLoader(train_dataset, batch_size=16, shuffle=True)
val_loader = DataLoader(val_dataset, batch_size=16, shuffle=False)


# https://www.codegenes.net/blog/distilbert-pytorch/
# https://huggingface.co/docs/transformers/model_doc/distilbert#transformers.DistilBertForSequenceClassification.forward.example

num_labels = len(lbl_int_map)
model = DistilBertForSequenceClassification.from_pretrained("distilbert-base-uncased", num_labels=num_labels)

model.to(device)

# maybe use scheduler
# scheduler = lr_scheduler.LinearLR(optimizer, start_factor=1.0, end_factor=0.5, total_iters=30)
optimizer = torch.optim.Adam(model.parameters(), lr=5e-5)
print("[SUCCESS] Model Compiled")

val_accs = []
train_accs = []
for epoch in range(25):
    model.train()
    correct_predictions = 0
    total_predictions = 0
    for batch in train_loader:
        input_ids = batch['input_ids'].to(device)
        attention_mask = batch['attention_mask'].to(device)
        labels = batch['labels'].to(device)

        optimizer.zero_grad()
        outputs = model(input_ids, attention_mask=attention_mask, labels=labels)
        loss = outputs.loss
        loss.backward()
        optimizer.step()

        preds = outputs.logits.argmax(dim=-1)
        correct_predictions += (preds == labels).sum().item()
        total_predictions += labels.size(0)

    train_accuracy = correct_predictions / total_predictions
    train_accs.append(train_accuracy)
    # Validation
    model.eval()
    total_val_loss = 0
    correct_predictions = 0
    total_predictions = 0

    best_acc = 0
    best_weights = None

    with torch.no_grad():
        for batch in val_loader:
            input_ids = batch['input_ids'].to(device)
            attention_mask = batch['attention_mask'].to(device)
            labels = batch['labels'].to(device)

            outputs = model(input_ids, attention_mask=attention_mask, labels=labels)
            loss = outputs.loss
            total_val_loss += loss.item()

            # Get predicted class
            preds = torch.argmax(outputs.logits, dim=1)

            # Count correct predictions
            correct_predictions += (preds == labels).sum().item()
            total_predictions += labels.size(0)

    avg_val_loss = total_val_loss / len(val_loader)
    val_accuracy = correct_predictions / total_predictions
    val_accs.append(val_accuracy)

    if val_accuracy > best_acc:
        best_acc = val_accuracy
        best_weights = copy.deepcopy(model.state_dict())

    print(f'Epoch {epoch + 1}, Validation Loss: {avg_val_loss:.4f}, Train accuracy: {train_accuracy:.4f}, Test accuracy: {val_accuracy:.4f}')

# saving model weights locally
timestamp_str = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
filepath = "model_" + timestamp_str + ".h5"
torch.save(best_weights, filepath)
print(f"Model saved to {filepath}")