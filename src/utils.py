import json
import numpy as np
# dask for efficient handling of larger files
import dask.dataframe as dd
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import tensorflow as tf
from tensorflow import keras
from keras.layers import Input, Dense
from keras.models import Sequential
from keras.callbacks import EarlyStopping

COL_DTYPES = {
    'app_branch': 'object',
    'user_id': 'object',
    'log_version': 'object',
    'session_id': 'object',
    'app_version': 'object',
    'index': 'object',
    'segment_labels': 'object'
}

def extract_job_name(game_state_str):
  try:
    game_state = json.loads(game_state_str)
    return game_state.get('job_name', None)
  except (json.JSONDecodeError, AttributeError):
    return None
  
def add_new_columns(filepath):
    df = dd.read_csv(filepath, sep="\t", dtype=COL_DTYPES)
    if "segment_id" not in df.columns:
        df["segment_id"] = np.nan

    if "segment_labels" not in df.columns:
        df["segment_labels"] = np.nan

    df["job_name"] = df["game_state"].map_partitions(
        lambda part: part.apply(extract_job_name), meta=("job_name", "object")
    )

    df.to_csv(filepath, compute=True, index=False, sep="\t", single_file=True)

    return df

def get_events_for_user(filepath, user_id):
    df = dd.read_csv(filepath, sep="\t", dtype=COL_DTYPES)

    df["timestamp"] = dd.to_datetime(df["timestamp"], format='mixed')
    user_events = df[df["user_id"] == user_id][["index", "event_name", "job_name", "timestamp", "segment_id", "segment_labels"]]
    user_events = user_events.sort_values(by="timestamp", ascending=True).compute()

    user_events["timestamp"] = user_events["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    
    return user_events

def update_rows(filepath, user_id, upd_id_instead_label, segment_id, segment_labels, selected_rows):
    df = dd.read_csv(filepath, sep="\t", dtype=COL_DTYPES)

    df["row_id"] = df["index"].astype(str) + "_" + dd.to_datetime(df["timestamp"], format='mixed').dt.strftime("%Y-%m-%d %H:%M:%S")
    df["row_id"] = df["row_id"].astype(str)
    selected_row_ids = list(map(lambda x: f"{x[0]}_{x[1]}", selected_rows))
    update_filter = (df["user_id"] == user_id) & df["row_id"].isin(selected_row_ids)
    

    if upd_id_instead_label:
        # update segment_id
        update_val = np.nan if segment_id == "" else int(segment_id)
        df["segment_id"] = df["segment_id"].mask(update_filter, update_val)
    else:
        # update segment_labels
        update_val = np.nan if segment_labels == "" else segment_labels
        df["segment_labels"] = df["segment_labels"].mask(update_filter, update_val)

    df = df.drop(columns=["row_id"])
    df.to_csv(filepath, compute=True, index=False, sep="\t", single_file=True)

def autosegment_by_job(filepath, user_id):
    df = dd.read_csv(filepath, sep="\t", dtype=COL_DTYPES)
    # execute the operation in pandas
    absent_df = df[df['user_id'] == user_id].compute()
    # absent_df = absent_df.sort_values('timestamp') # originally its also sorted like that
    absent_df['segment_id'] = (absent_df['job_name'] != absent_df['job_name'].shift()).fillna(False).astype(int).cumsum()
    absent_df = absent_df[['segment_id', 'session_id', 'index']]

    df = df.merge(dd.from_pandas(absent_df, npartitions=1), on=['session_id', 'index'], how='left', suffixes=('', '_new'))

    df['segment_id'] = df['segment_id_new'].where(df['user_id'] == user_id, df['segment_id'])
    df = df.drop(columns=['segment_id_new'])
    df.to_csv(filepath, compute=True, index=False, sep="\t", single_file=True)


def train_model(filepath):
    # segment_id is the new task_id, segment_labels is the target
    df = dd.read_csv(filepath, sep="\t", dtype=COL_DTYPES)
    # fixme - add support for multiple labels
    # fixme - job_name dummies
    df["timestamp"] = dd.to_datetime(df["timestamp"], format='mixed')
    clean_df = df[["event_name", "segment_id", "segment_labels"]] #, "job_name"
    # remove NA's
    clean_df = clean_df.dropna()
    clean_df = clean_df.categorize(columns=["event_name"])
    clean_1hot_df = dd.get_dummies(clean_df, columns=["event_name"], dtype=float) # , "job_name"
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

    train_df = clean_agg_df.compute()
    #train_df = clean_agg_df.categorize(columns=["job_name"])
    #train_df = dd.get_dummies(train_df, columns=["job_name"], dtype=float)

    le = LabelEncoder()
    train_df['target'] = le.fit_transform(train_df['segment_labels'])
    output = (f"Row count: {len(train_df)}\n")
    output += (f"Classes count: {train_df['segment_labels'].value_counts()}\n")
    train_df = train_df.drop(columns=['segment_labels', 'segment_id'])
    x_train_full, x_test, y_train_full, y_test = train_test_split(
        train_df.drop(columns="target"),
        train_df["target"],
        test_size=0.25,
        random_state=42,
        stratify=train_df["target"] # same proportion in both splits
        # fixme - maybe try bootstrap
    )

    # x_train, x_val, y_train, y_val = train_test_split(
    #     x_train_full,
    #     y_train_full,
    #     test_size=0.25,
    #     random_state=42,
    #     stratify=y_train_full
    # )

    # print("x Train Shape: " + str(x_train.shape))
    # print("x Validation Shape: " + str(x_val.shape))
    # print("x Test Shape: " + str(x_test.shape))

    x_train_tensor = tf.convert_to_tensor(x_train_full)
    y_train_tensor = tf.convert_to_tensor(y_train_full)
    x_test_tensor = tf.convert_to_tensor(x_test)
    y_test_tensor = tf.convert_to_tensor(y_test)

    class_weight = {0: 1., 1: 1.4}

    model = Sequential()
    model.add(Input(shape=(x_train_tensor.shape[1],)))
    model.add(Dense(1000, activation='relu'))
    model.add(Dense(1000, activation='relu'))
    model.add(Dense(100, activation='relu'))
    model.add(Dense(1, activation='sigmoid'))
    adam = keras.optimizers.Adam(learning_rate=0.001)
    model.compile(optimizer=adam, loss="binary_crossentropy", metrics=['accuracy'])


    early_stopping = EarlyStopping(
        monitor='val_loss',
        patience=5,
        # restores model weights from the epoch with the best value of the monitored quantity
        restore_best_weights=True
    )

    model.fit(x_train_tensor, y_train_tensor, epochs=75, batch_size=32, class_weight=class_weight, validation_data=(x_test_tensor, y_test_tensor), callbacks=[early_stopping])
    loss, accuracy = model.evaluate(x_test_tensor, y_test_tensor)
    output += (f"Test Loss: {loss}\n")
    output += (f"Test Accuracy: {accuracy}\n\n")

    loss, accuracy = model.evaluate(x_train_tensor, y_train_tensor)
    output += (f"Train Loss: {loss}\n")
    output += (f"Train Accuracy: {accuracy}\n\n")

    y_pred_probs = model.predict(x_test_tensor)
    y_pred = np.argmax(y_pred_probs, axis=1)
    y_true = np.array(y_test)

    output += classification_report(y_true, y_pred, target_names=le.classes_)
    
    return output