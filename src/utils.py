import os
import re
import json
import polars as pl

# COL_DTYPES = {
#     'app_branch': 'object',
#     'user_id': 'object',
#     'log_version': 'object',
#     'session_id': 'object',
#     'app_version': 'object',
#     'index': 'object',
#     'segment_labels': 'object'
# }


def read_dataset(filepath, filtered_only=True):
    """
    Returns the whole or filtered dataset

    IMPORTANT: Set filtered_only = False if you want to write_csv afterwards
    """
    df = pl.read_csv(filepath, separator="\t", dtypes={"segment_id": pl.String})

    if filtered_only:
        df = df.filter(pl.col("filtered_in") == True)

    return df


def unique_count(df, cols):
    return df.select(pl.struct(cols).drop_nulls().n_unique()).item()

def get_models_filename(filepath):
    name, ext = os.path.splitext(filepath)
    model_filename = f"{name}_models.json"
    return model_filename


# def extract_job_name(game_state_str):
#     try:
#         game_state = json.loads(game_state_str)
#         return game_state.get("job_name", None)
#     except (json.JSONDecodeError, AttributeError):
#         return None


def read_handling_miss_cols(filepath):
    """
    Read datasets, but if auxiliary/app specific columns doesn't exist, create and fill them
    """
    df = read_dataset(filepath, False)
    old_cols = set(df.columns)

    for col in ["segment_id", "segment_labels", "label_justification"]:
        if col not in df.columns:
            df = df.with_columns(pl.lit(None).alias(col))

    if "event_description" not in df.columns:
        df = df.with_columns(df["event_name"].alias("event_description"))

    if "filtered_in" not in df.columns:
        df = df.with_columns(pl.lit(True).alias("filtered_in"))

    if "job_name" not in df.columns:
        df = df.with_columns(
            pl.col("game_state").str.json_path_match("$.job_name").alias("job_name")
        )

    new_cols = set(df.columns)
    if not new_cols.issubset(old_cols):
        # write if new columns were added
        df.write_csv(filepath, separator="\t")

    return df

def get_dataset_info(filepath):
    """
    Returns useful dataset info such as row count, segments count, user session count
    """
    df = read_handling_miss_cols(filepath)
    df = df.with_columns(pl.col("timestamp").str.strptime(pl.Datetime, strict=False))
    timestamp_min = df.select(pl.col("timestamp").drop_nulls().min()).item()
    timestamp_max = df.select(pl.col("timestamp").drop_nulls().max()).item()
    date_range = f"{timestamp_min:%m/%d/%Y} - {timestamp_max:%m/%d/%Y}"

    # Filtered / excluded subsets
    df_filtered = df.filter(pl.col("filtered_in") == True)
    included_events = (
        df_filtered.select(pl.col("event_name").unique()).to_series().to_list()
    )
    all_events = set(
        df.select(pl.col("event_name").unique()).to_series().to_list()
    )
    excluded_events = list(all_events.difference(set(included_events)))
    return {
        "models_count": len(get_models_list(filepath)),
        "date_range": date_range,
        "events_types": get_event_types(df_filtered),
        "users": get_users_list(df_filtered),
        "original": {
            "rows": df.height,
            "users": unique_count(df, ["user_id"]),
            "segments": unique_count(df, ["user_id", "segment_id"]),
            "sessions": unique_count(df, ["session_id"]),
        },
        "filtered": {
            "rows": df_filtered.height,
            "users": unique_count(df_filtered, ["user_id"]),
            "segments": unique_count(df_filtered, ["user_id", "segment_id"]),
            "sessions": unique_count(df_filtered, ["session_id"]),
        },
        "included_events": [{"name": ev} for ev in included_events],
        "excluded_events": [{"name": ev} for ev in excluded_events],
        "labels_distribution": segment_labels_count(df_filtered),
    }


def event_filtering(filepath, included_events):
    """
    Updates filtered_in column setting to `True` if event_name in the included_events list
    """
    df = read_dataset(filepath, False)

    df = df.with_columns(
        (pl.col("event_name").is_in(included_events)).alias("filtered_in")
    )

    df.write_csv(filepath, separator="\t")


def get_models_list(filepath):
    models_filepath = get_models_filename(filepath)
    if os.path.exists(models_filepath):
        with open(models_filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    else:
        return []


def get_users_list(df):
    """
    List ordered user ids with segments count
    """

    df = (
        df.drop_nulls("user_id")
        .group_by("user_id")
        .agg(pl.col("segment_id").drop_nulls().n_unique().alias("segment_count"))
        .sort("user_id")
    )

    return df.to_dicts()


def get_event_types(df):
    """
    List unique values of the `event_name` column
    """

    return (
        df.select(pl.col("event_name").drop_nulls().unique().sort())
        .to_series()
        .to_list()
    )


def segment_labels_count(df):
    """
    For each label - number of segments with that label
    """

    df = (
        df.unique(subset=["user_id", "segment_id"])
        .drop_nulls(["user_id", "segment_id", "segment_labels"])
        .group_by("segment_labels")
        .agg(pl.count().alias("count"))  # value_counts()
        .sort("count", descending=True)
    )

    return df.to_dicts()


def segment_ids_for_user(filepath, user_id):
    """
    List ordered segment ids with their label for the selected `user_id`
    """
    df = read_dataset(filepath)

    # cast to int to sort correctly - fixme sort by timestamp
    df_user = df.filter(pl.col("user_id") == user_id).with_columns(pl.col("segment_id").cast(pl.Int64))
    
    cols = ["segment_id", "segment_labels"]
    if "job_name" in df_user.columns:
        cols.append("job_name")

    df_user = df_user.drop_nulls(subset=["segment_id"])

    # order by timestamp so we get the first job
    df_segments = df_user.sort("timestamp").unique(subset=["segment_id", "segment_labels"])

    return df_segments.select(cols).sort("segment_id").to_dicts()


def list_seg_labels(filepath):
    """
    List unique values of the `segment_labels` column
    """
    df = read_dataset(filepath)

    unique_labels = (
        df.select(pl.col("segment_labels")).drop_nulls().unique().to_series().to_list()
    )

    # for multilabel
    flattened = sorted(
        {item.strip() for part in unique_labels for item in part.split(", ")}
    )

    return flattened


def get_events_for_user(filepath, user_id, segment_id):
    """
    List events for `user id`
    If `segment_id` is specified, also filter by `segment_id`
    """
    df = read_dataset(filepath)

    df = df.with_columns(pl.col("timestamp").str.strptime(pl.Datetime, strict=False))

    df = df.with_columns(  # otherwise precision errors on client side
        pl.col("session_id").cast(pl.String).alias("session_id")
    )

    if segment_id:
        df = df.filter(
            pl.col("segment_id").is_not_null()
            & (pl.col("user_id") == user_id)
            & (pl.col("segment_id") == str(segment_id))
        )
    else:
        df = df.filter(pl.col("user_id") == user_id)

    user_events = user_events = df.sort("timestamp", descending=False).with_columns(
        pl.col("timestamp").dt.strftime("%Y-%m-%d %H:%M:%S")
    )

    return user_events.fill_null("-").to_dicts()


def label_rows(filepath, user_id, segment_id, segment_labels, label_justification):
    """
    For a `user_id` and `segment_id` apply segment_labels and label_justification
    If `segment_id` is specified, also filter by `segment_id`
    """
    df = read_dataset(filepath, False)

    update_filter = (
        pl.col("segment_id").is_not_null()
        & (pl.col("user_id") == user_id)
        & (pl.col("segment_id") == str(segment_id))
    )
    update_val = None if segment_labels == "" else segment_labels
    df = df.with_columns(
        pl.when(update_filter)
        .then(pl.lit(update_val))
        .otherwise(pl.col("segment_labels"))
        .alias("segment_labels")
    )

    if (
        label_justification is not None
    ):  # skipped for the Apply tab (to not override label_justification)
        update_val = None if label_justification == "" else label_justification
        df = df.with_columns(
            pl.when(update_filter)
            .then(pl.lit(update_val))
            .otherwise(pl.col("label_justification"))
            .alias("label_justification")
        )

    df.write_csv(filepath, separator="\t")


def segment_rows(filepath, user_id, segment_id, selected_rows):
    """
    For a `user_id` apply segment_id on selected_rows (row identifiers => index + session_id columns)
    Clears segment labels for all affected segments
    """
    df = read_dataset(filepath, False)

    df = df.with_columns(
        (
            pl.col("index").cast(pl.String) + "_" + pl.col("session_id").cast(pl.String)
        ).alias("row_id")
    )
    selected_row_ids = [f"{x[0]}_{x[1]}" for x in selected_rows]
    update_filter = (pl.col("user_id") == user_id) & pl.col("row_id").is_in(
        selected_row_ids
    )

    old_segments = df.select(pl.col("segment_id"))
    update_val = None if segment_id == "" else str(segment_id)
    df = df.with_columns(
        pl.when(update_filter)
        .then(pl.lit(update_val))
        .otherwise(pl.col("segment_id"))
        .alias("segment_id")
    )

    # clear labels for segment if changed
    new_segments = df.select(pl.col("segment_id"))
    # affected segments
    changed_ids = set(
        old_segments.filter(pl.col("segment_id") != new_segments["segment_id"])
        .select("segment_id")
        .unique()
        .drop_nulls()
        .to_series()
        .to_list()
    )
    if update_val is not None:
        # target segment also
        changed_ids.add(str(update_val))

    change_filter = (pl.col("user_id") == user_id) & pl.col("segment_id").is_in(
        changed_ids
    )

    df = df.with_columns(
        [
            pl.when(change_filter)
            .then(pl.lit(None))
            .otherwise(pl.col("segment_labels"))
            .alias("segment_labels"),
            pl.when(change_filter)
            .then(pl.lit(None))
            .otherwise(pl.col("label_justification"))
            .alias("label_justification"),
        ]
    )

    df = df.drop("row_id")
    df.write_csv(filepath, separator="\t")


def autosegment_by_event_type(filepath, sep_event_types):
    """
    Autosegments the whole dataframe.
    IMPORTANT: Clears segment_labels

    sep_event_types: list of event types by which we should separate ito segments
    """

    df = read_dataset(filepath, False)
    df = df.with_columns(pl.col("timestamp").str.strptime(pl.Datetime, strict=False))

    df = df.sort("timestamp")

    # hardcoded - when new session begins (index = 0), automatically sets it as new segment
    df = df.with_columns(
        (pl.col("event_name").is_in(sep_event_types) | (pl.col("index") == 0))
        .fill_null(False)
        .cast(pl.Int32)
        .alias("is_sep_event")
    )
    df = df.with_columns(
        pl.col("is_sep_event").cum_sum().over("user_id").alias("segment_id")
    )
    df = df.drop("is_sep_event")

    # include cutoff events (except index = 0) into the previous segment
    cutoff_filter = pl.col("user_id").is_not_null() & pl.col("event_name").is_in(
        sep_event_types
    )
    df = df.with_columns(
        pl.when(cutoff_filter)
        .then(pl.col("segment_id").cast(pl.Int64) - 1)
        .otherwise(pl.col("segment_id"))
        .cast(pl.String)
        .alias("segment_id")
    )

    df = df.with_columns(pl.lit(None).alias("segment_labels"))
    df.write_csv(filepath, separator="\t")

def safe_format_description(template, ev_data, g_state):
    try:
        return template.format_map({"event_data": json.loads(ev_data), "game_state": json.loads(g_state)})
    except Exception as e:
        return None

def describe_events(filepath, descriptions_map):
    """
    Fills new column "event_description" using descriptions_map (dictionary mapping event_name to template)
    """
    df = read_dataset(filepath, False)
    for ev_name, template in descriptions_map.items():
        df = df.with_columns(
            pl.when(pl.col("event_name") == ev_name).then(
            pl.struct(["event_data", "game_state"]).map_elements(
                lambda row: safe_format_description(template, row["event_data"], row["game_state"]),
                return_dtype=pl.Utf8
            ))
            .otherwise(pl.col("event_description"))
            .alias("event_description")
        )

    df.write_csv(filepath, separator="\t")