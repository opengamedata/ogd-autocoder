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
        return game_state.get("job_name", None)
    except (json.JSONDecodeError, AttributeError):
        return None


def add_new_columns(filepath):
    df = pd.read_csv(filepath, sep="\t")  # , dtype=COL_DTYPES)
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
    df = pd.read_csv(filepath, sep="\t")  # , dtype=COL_DTYPES)

    return (
        df.groupby("user_id")["segment_id"]
        .nunique(dropna=True)
        .reset_index(name="segment_count")
    )


def get_event_types(filepath):
    df = pd.read_csv(filepath, sep="\t")  # , dtype=COL_DTYPES)

    return df.event_name.dropna().unique().tolist()


def segment_labels_count(filepath):
    df = pd.read_csv(filepath, sep="\t")  # , dtype=COL_DTYPES)

    return (
        df.drop_duplicates(subset=["user_id", "segment_id"])
        .segment_labels.value_counts()
        .reset_index(name="count")
    )


def segment_ids_for_user(filepath, user_id):
    df = pd.read_csv(filepath, sep="\t")  # , dtype=COL_DTYPES)

    df = df[df["user_id"] == user_id][["segment_id", "segment_labels"]].dropna(
        subset=["segment_id"]
    )
    df = df.astype(object).where(pd.notnull(df), None).drop_duplicates()
    return df.sort_values(by="segment_id")


def list_seg_labels(filepath):
    df = pd.read_csv(filepath, sep="\t")  # , dtype=COL_DTYPES)
    unique_labels = df.segment_labels.dropna().unique().tolist()
    flattened = sorted(
        set(item.strip() for part in unique_labels for item in part.split(", "))
    )
    return flattened


def get_events_for_user(filepath, user_id, segment_id):
    df = pd.read_csv(filepath, sep="\t")  # , dtype=COL_DTYPES)
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="mixed")

    if segment_id:
        df = df[
            df["segment_id"].notna()
            & (df["user_id"] == user_id)
            & (df["segment_id"].astype("Int64") == int(segment_id))
        ]
    else:
        df = df[df["user_id"] == user_id]

    user_events = df.sort_values(by="timestamp", ascending=True)

    user_events["timestamp"] = user_events["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")

    return user_events


def label_rows(filepath, user_id, segment_id, segment_labels, label_justification):
    # set segment_labels and label_justification
    df = pd.read_csv(filepath, sep="\t")  # , dtype=COL_DTYPES)

    update_filter = (
        df["segment_id"].notna()
        & (df["user_id"] == user_id)
        & (df["segment_id"].astype(pd.Int64Dtype()) == int(segment_id))
    )
    update_val = np.nan if segment_labels == "" else segment_labels
    df["segment_labels"] = df["segment_labels"].mask(update_filter, update_val)

    if label_justification is not None: # None just keeps the same, "" sets the field to NA
        update_val = np.nan if label_justification == "" else label_justification
        df["label_justification"] = df["label_justification"].mask(
            update_filter, update_val
        )

    df.to_csv(filepath, index=False, sep="\t")


def segment_rows(filepath, user_id, segment_id, selected_rows):
    # set segment_id
    df = pd.read_csv(filepath, sep="\t")  # , dtype=COL_DTYPES)

    df["row_id"] = (
        df["index"].astype(str)
        + "_"
        + pd.to_datetime(df["timestamp"], format="mixed").dt.strftime(
            "%Y-%m-%d %H:%M:%S"
        )
    )
    df["row_id"] = df["row_id"].astype(str)
    selected_row_ids = list(map(lambda x: f"{x[0]}_{x[1]}", selected_rows))
    update_filter = (df["user_id"] == user_id) & df["row_id"].isin(selected_row_ids)

    old_segments = df["segment_id"].astype("Int64").copy()
    update_val = np.nan if segment_id == "" else int(segment_id)
    df["segment_id"] = df["segment_id"].mask(update_filter, update_val)

    new_segments = df["segment_id"].astype("Int64")
    changed_ids = set(old_segments[old_segments != new_segments].unique())
    changed_ids.add(int(update_val))
    change_filter = (df["user_id"] == user_id) & df["segment_id"].astype("Int64").isin(changed_ids)

    # clear labels for segment if changed
    df["segment_labels"] = df["segment_labels"].mask(change_filter, np.nan)
    df["label_justification"] = df["label_justification"].mask(change_filter, np.nan)

    df = df.drop(columns=["row_id"])
    df.to_csv(filepath, index=False, sep="\t")


def autosegment_by_event_type(filepath, sep_event_types):
    """
    Autosegments the whole dataframe.
    IMPORTANT: Clears segment_labels

    sep_event_types: list of event types by which we should separate ito segments
    """

    df = pd.read_csv(filepath, sep="\t")  # , dtype=COL_DTYPES)
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="mixed")
    df = df.sort_values("timestamp")

    # hardcoded - when new session begins (index = 0), automatically sets it as new segment
    df["is_sep_event"] = (
        (df["event_name"].isin(sep_event_types) | (df["index"] == 0))
        .fillna(False)
        .astype(int)
    )
    df["segment_id"] = df.groupby("user_id")["is_sep_event"].cumsum()
    df = df.drop(columns=["is_sep_event"])

    # include cutoff events into the previous segment
    filter = (df["user_id"].notna()) & (df["event_name"].isin(sep_event_types))
    df.loc[filter, "segment_id"] = df.loc[filter, "segment_id"].astype(int) - 1

    df["segment_labels"] = np.nan

    df.to_csv(filepath, index=False, sep="\t")
