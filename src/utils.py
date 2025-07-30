import json
import os
import numpy as np
import pandas as pd

# COL_DTYPES = {
#     'app_branch': 'object',
#     'user_id': 'object',
#     'log_version': 'object',
#     'session_id': 'object',
#     'app_version': 'object',
#     'index': 'object',
#     'segment_labels': 'object'
# }

def get_models_filename(filepath):
    name, ext = os.path.splitext(filepath)
    model_filename = f"{name}_models.json"
    return model_filename

def extract_job_name(game_state_str):
  try:
    game_state = json.loads(game_state_str)
    return game_state.get('job_name', None)
  except (json.JSONDecodeError, AttributeError):
    return None
  
def add_new_columns(filepath):
    df = pd.read_csv(filepath, sep="\t")#, dtype=COL_DTYPES)
    if "segment_id" not in df.columns:
        df["segment_id"] = np.nan

    if "segment_labels" not in df.columns:
        df["segment_labels"] = np.nan
    
    if "label_justification" not in df.columns:
        df["label_justification"] = np.nan

    df["job_name"] = df["game_state"].apply(extract_job_name)

    df.to_csv(filepath, index=False, sep="\t")

def get_models_list(filepath):
    models_filepath = get_models_filename(filepath)
    if os.path.exists(models_filepath):
        with open(models_filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    else:
        return []

def get_users_list(filepath):
    df = pd.read_csv(filepath, sep="\t")#, dtype=COL_DTYPES)

    return df.user_id.dropna().unique().tolist()

def segment_ids_for_user(filepath, user_id):
    df = pd.read_csv(filepath, sep="\t")#, dtype=COL_DTYPES)

    return sorted(df[df["user_id"] == user_id].segment_id.dropna().astype("int").unique().tolist())

def list_seg_labels(filepath):
    df = pd.read_csv(filepath, sep="\t")#, dtype=COL_DTYPES)
    unique_labels = df.segment_labels.dropna().unique().tolist()
    flattened = sorted(set(item.strip() for part in unique_labels for item in part.split(', ')))
    return flattened


def get_events_for_user(filepath, user_id, segment_id):
    df = pd.read_csv(filepath, sep="\t")#, dtype=COL_DTYPES)
    df["timestamp"] = pd.to_datetime(df["timestamp"], format='mixed')
    
    if segment_id:
        df = df[df["segment_id"].notna() & (df["user_id"] == user_id) & (df["segment_id"].astype('Int64') == int(segment_id))]
    else:
        df = df[df["user_id"] == user_id]

    user_events = df[["index", "event_name", "job_name", "timestamp", "segment_id", "segment_labels", "label_justification"]]
    user_events = user_events.sort_values(by="timestamp", ascending=True)

    user_events["timestamp"] = user_events["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    
    return user_events

def label_rows(filepath, user_id, segment_id, segment_labels, label_justification):
    # set segment_labels and label_justification
    df = pd.read_csv(filepath, sep="\t")#, dtype=COL_DTYPES)

    update_filter = df["segment_id"].notna() & (df["user_id"] == user_id) & (df["segment_id"].astype(pd.Int64Dtype()) == int(segment_id))
    update_val = np.nan if segment_labels == "" else segment_labels
    df["segment_labels"] = df["segment_labels"].mask(update_filter, update_val)

    update_val = np.nan if label_justification == "" else label_justification
    df["label_justification"] = df["label_justification"].mask(update_filter, update_val)

    df.to_csv(filepath, index=False, sep="\t")

def segment_rows(filepath, user_id, segment_id, selected_rows):
    # set segment_id
    df = pd.read_csv(filepath, sep="\t")#, dtype=COL_DTYPES)

    df["row_id"] = df["index"].astype(str) + "_" + pd.to_datetime(df["timestamp"], format='mixed').dt.strftime("%Y-%m-%d %H:%M:%S")
    df["row_id"] = df["row_id"].astype(str)
    selected_row_ids = list(map(lambda x: f"{x[0]}_{x[1]}", selected_rows))
    update_filter = (df["user_id"] == user_id) & df["row_id"].isin(selected_row_ids)

    update_val = np.nan if segment_id == "" else int(segment_id)
    df["segment_id"] = df["segment_id"].mask(update_filter, update_val)

    df = df.drop(columns=["row_id"])
    df.to_csv(filepath, index=False, sep="\t")

def autosegment_by_job(filepath, user_id):
    df = pd.read_csv(filepath, sep="\t")#, dtype=COL_DTYPES)
    # execute the operation in pandas
    absent_df = df[df['user_id'] == user_id]
    # absent_df = absent_df.sort_values('timestamp') # originally its also sorted like that
    absent_df['segment_id'] = (absent_df['job_name'] != absent_df['job_name'].shift()).fillna(False).astype(int).cumsum()
    absent_df = absent_df[['segment_id', 'session_id', 'index']]

    df = df.merge(absent_df, on=['session_id', 'index'], how='left', suffixes=('', '_new'))

    df['segment_id'] = df['segment_id_new'].where(df['user_id'] == user_id, df['segment_id'])
    df = df.drop(columns=['segment_id_new'])
    df.to_csv(filepath, index=False, sep="\t")