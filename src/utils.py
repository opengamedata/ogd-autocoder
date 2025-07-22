import json
import numpy as np
import dask.dataframe as dd

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