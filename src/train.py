from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, log_loss
from sklearn.linear_model import LogisticRegression
import tensorflow as tf
from tensorflow import keras
from keras.layers import Input, Dense
from keras.models import Sequential
from keras.callbacks import EarlyStopping
import pandas as pd
import numpy as np
import time

RANDOM_STATE = 13

def train_model(filepath, model_type):
    start_time = time.time()
    # segment_id is the new task_id, segment_labels is the target
    df = pd.read_csv(filepath, sep="\t")#, dtype=COL_DTYPES)
    # fixme - add support for multiple labels
    # fixme - job_name dummies
    df["timestamp"] = pd.to_datetime(df["timestamp"], format='mixed')
    # fixme - the ID is the segment_id + user_id
    df["segment_id"] = df["user_id"] + "-" + df["segment_id"].astype(str)
    clean_df = df[["event_name", "segment_id", "segment_labels"]] #, "job_name"
    # remove NA's
    clean_df = clean_df.dropna()
    #clean_df = clean_df.categorize(columns=["event_name"])
    clean_1hot_df = pd.get_dummies(clean_df, columns=["event_name"], dtype=float) # , "job_name"
    grouped = clean_1hot_df.groupby(["segment_id", "segment_labels"])

    percent_df = grouped.mean() * 100
    sum_df = grouped.sum()
    count_df = grouped.size().rename("row_count")

    clean_agg_df = (
        percent_df
        .reset_index()
        .merge(sum_df.reset_index(), on=["segment_id", "segment_labels"], suffixes=('_percent', '_sum'))
        .merge(count_df.reset_index(), on=["segment_id", "segment_labels"])
    )

    train_df = clean_agg_df
    #train_df = clean_agg_df.categorize(columns=["job_name"])
    #train_df = dd.get_dummies(train_df, columns=["job_name"], dtype=float)

    le = LabelEncoder()
    target_col = le.fit_transform(train_df['segment_labels']) # converts to ints
    if model_type == "neural_net":
        target_col = keras.utils.to_categorical(target_col, num_classes = len(le.classes_)) # converts to dummies

    x_train_full, x_test, y_train_full, y_test = train_test_split(
        train_df.drop(columns=['segment_labels', 'segment_id']),
        target_col,
        test_size=0.25,
        random_state=RANDOM_STATE,
        stratify=train_df['segment_labels'] # same proportion in both splits
        # fixme - maybe try bootstrap
    )

    output = (f"Row count: {len(train_df)}\n")
    output += (f"Classes count:\n")
    for label, count in train_df['segment_labels'].value_counts().items():
        output += (f"{label}\t{count}\n")
    output += "\n"

    # add to (output +=)
    # print("x Train Shape: " + str(x_train.shape))
    # print("x Validation Shape: " + str(x_val.shape))
    # print("x Test Shape: " + str(x_test.shape))

    if (model_type == "logistic"):
        output += train_logistic(x_train_full, x_test, y_train_full, y_test, le.classes_)
    elif (model_type == "random_forest"):
        output += train_random_forest(x_train_full, x_test, y_train_full, y_test, le.classes_)
    elif (model_type == "neural_net"):
        output += train_neural_net(x_train_full, x_test, y_train_full, y_test, le.classes_)
    else:
        output += "Invalid Model Selected"

    output = f"Time taken:\t{time.time() - start_time} secs\n\n" + output
    return output

def train_neural_net(x_train, x_test, y_train, y_test, classes):
    output = "Neural Network\n\n"
    x_train_tensor = tf.convert_to_tensor(x_train)
    y_train_tensor = tf.convert_to_tensor(y_train)
    x_test_tensor = tf.convert_to_tensor(x_test)
    y_test_tensor = tf.convert_to_tensor(y_test)

    #class_weight = {0: 1., 1: 1.4}

    model = Sequential()
    model.add(Input(shape=(x_train_tensor.shape[1],)))
    model.add(Dense(1000, activation='relu'))
    model.add(Dense(1000, activation='relu'))
    model.add(Dense(100, activation='relu'))
    model.add(Dense(len(classes), activation='softmax'))
    adam = keras.optimizers.Adam(learning_rate=0.001)
    model.compile(optimizer=adam, loss="categorical_crossentropy", metrics=['accuracy'])


    early_stopping = EarlyStopping(
        monitor='val_loss',
        patience=5,
        # restores model weights from the epoch with the best value of the monitored quantity
        restore_best_weights=True
    )

    # class_weight=class_weight
    model.fit(x_train_tensor, y_train_tensor, epochs=75, batch_size=32, validation_data=(x_test_tensor, y_test_tensor), callbacks=[early_stopping])
    loss, accuracy = model.evaluate(x_test_tensor, y_test_tensor)
    output += (f"Test Accuracy:\t{accuracy}\n")
    #output += (f"Test Loss:\t{loss}\n\n")

    loss, accuracy = model.evaluate(x_train_tensor, y_train_tensor)
    output += (f"Train Accuracy:\t{accuracy}\n\n")
    #output += (f"Train Loss:\t{loss}\n\n")

    y_pred_probs = model.predict(x_test_tensor)
    y_pred = np.argmax(y_pred_probs, axis=1)
    y_true = np.argmax(y_test, axis=1)

    output += classification_report(y_true, y_pred, target_names=classes)

    return output


def train_logistic(x_train, x_test, y_train, y_test, classes):
    output = "Logistic Regression\n\n"
    model = LogisticRegression(penalty='l2')
    model.fit(x_train, y_train)

    output += (f"Test Accuracy:\t{model.score(x_test, y_test)}\n")
    #output += (f"Test Loss: {log_loss(y_test, model.predict(x_test))}\n\n")

    output += (f"Train Accuracy:\t{model.score(x_train, y_train)}\n\n")
    #output += (f"Train Loss: {log_loss(y_train, model.predict(x_train))}\n\n")

    y_pred = model.predict(x_test)

    output += classification_report(y_test, y_pred, target_names=classes)

    return output


def train_random_forest(x_train, x_test, y_train, y_test, classes):
    output = "Random Forest\n\n"
    model = RandomForestClassifier(random_state=RANDOM_STATE)
    model.fit(x_train, y_train)

    output += (f"Test Accuracy:\t{model.score(x_test, y_test)}\n")
    output += (f"Train Accuracy:\t{model.score(x_train, y_train)}\n\n")

    y_pred = model.predict(x_test)
    output += classification_report(y_test, y_pred, target_names=classes)

    return output