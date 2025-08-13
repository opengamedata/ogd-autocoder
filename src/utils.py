import json
import os
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


def add_new_columns(filepath):
    df = pl.read_csv(filepath, separator="\t", dtypes={"segment_id": pl.String})
    for col in ["segment_id", "segment_labels", "label_justification"]:
        if col not in df.columns:
            df = df.with_columns(pl.lit(None).alias(col))

    # df["job_name"] = df["game_state"].apply(extract_job_name)
    df = df.with_columns(pl.col("game_state").str.json_path_match("$.job_name").alias("job_name"))

    df.write_csv(filepath, separator="\t")


def get_models_list(filepath):
    models_filepath = get_models_filename(filepath)
    if os.path.exists(models_filepath):
        with open(models_filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    else:
        return []


def get_users_list(filepath):
    """
    List ordered user ids with segments count
    """
    df = pl.read_csv(filepath, separator="\t", dtypes={"segment_id": pl.String})

    df = (
        df.drop_nulls("user_id").group_by("user_id")
          .agg(pl.col("segment_id").drop_nulls().n_unique().alias("segment_count")).sort("user_id")
    )

    return df.to_dicts()


def get_event_types(filepath):
    """
    List unique values of the `event_name` column
    """
    df = pl.read_csv(filepath, separator="\t", dtypes={"segment_id": pl.String})

    return df.select(
            pl.col("event_name").drop_nulls()
            .unique().sort()
        ).to_series().to_list()


def segment_labels_count(filepath):
    """
    For each label - number of segments with that label
    """
    df = pl.read_csv(filepath, separator="\t", dtypes={"segment_id": pl.String})

    df = (
        df.unique(subset=["user_id", "segment_id"])
        .drop_nulls(["user_id", "segment_id", "segment_labels"])
        .group_by("segment_labels")
        .agg(pl.count().alias("count")) # value_counts()
        .sort("count", descending=True)
    )

    return df.to_dicts()


def segment_ids_for_user(filepath, user_id):
    """
    List ordered segment ids with their label for the selected `user_id`
    """
    # cast to int to sort correctly - fixme sort by timestamp
    df = pl.read_csv(filepath, separator="\t", dtypes={"segment_id": pl.Int64}) 

    df = (
        df.filter(pl.col("user_id") == user_id)
        .select(["segment_id", "segment_labels"])
        .drop_nulls(subset=["segment_id"])
        .unique()
        .sort("segment_id")
    )

    return df.to_dicts()



def list_seg_labels(filepath):
    """
    List unique values of the `segment_labels` column
    """
    df = pl.read_csv(filepath, separator="\t", dtypes={"segment_id": pl.String})

    unique_labels = (
        df.select(pl.col("segment_labels"))
        .drop_nulls()
        .unique()
        .to_series()
        .to_list()
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
    df = pl.read_csv(filepath, separator="\t", dtypes={"segment_id": pl.String})

    df = df.with_columns(
        pl.col("timestamp").str.strptime(pl.Datetime, strict=False)
    )

    df = df.with_columns( # otherwise precision errors on client side
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

    user_events = user_events = (
        df.sort("timestamp", descending=False)
        .with_columns(
            pl.col("timestamp").dt.strftime("%Y-%m-%d %H:%M:%S")
        )
    )

    return user_events.fill_null("-").to_dicts()


def label_rows(filepath, user_id, segment_id, segment_labels, label_justification):
    """
    For a `user_id` and `segment_id` apply segment_labels and label_justification
    If `segment_id` is specified, also filter by `segment_id` 
    """
    df = pl.read_csv(filepath, separator="\t", dtypes={"segment_id": pl.String})

    update_filter = (
        pl.col("segment_id").is_not_null()
        & (pl.col("user_id") == user_id)
        & (pl.col("segment_id") == str(segment_id))
    )
    update_val = None if segment_labels == "" else segment_labels
    df = df.with_columns(
        pl.when(update_filter).then(pl.lit(update_val)).otherwise(pl.col("segment_labels")).alias("segment_labels")
    )

    if label_justification is not None: # skipped for the Apply tab (to not override label_justification)
        update_val = None if label_justification == "" else label_justification
        df = df.with_columns(
            pl.when(update_filter).then(pl.lit(update_val)).otherwise(pl.col("label_justification")).alias("label_justification")
        )

    df.write_csv(filepath, separator="\t")


def segment_rows(filepath, user_id, segment_id, selected_rows):
    """
    For a `user_id` apply segment_id on selected_rows (row identifiers => index + session_id columns)
    Clears segment labels for all affected segments
    """
    df = pl.read_csv(filepath, separator="\t", dtypes={"segment_id": pl.String})

    df = df.with_columns(
        (pl.col("index").cast(pl.String) + "_" + pl.col("session_id").cast(pl.String)).alias("row_id")
    )
    selected_row_ids = [f"{x[0]}_{x[1]}" for x in selected_rows]
    update_filter = (pl.col("user_id") == user_id) & pl.col("row_id").is_in(selected_row_ids)

    old_segments = df.select(pl.col("segment_id"))
    update_val = None if segment_id == "" else str(segment_id)
    df = df.with_columns(
        pl.when(update_filter).then(pl.lit(update_val)).otherwise(pl.col("segment_id")).alias("segment_id")
    )

    # clear labels for segment if changed
    new_segments = df.select(pl.col("segment_id"))
    # affected segments
    changed_ids = set(
        old_segments.filter(pl.col("segment_id") != new_segments["segment_id"])
        .select("segment_id").unique().drop_nulls().to_series().to_list()
    )
    if update_val is not None:
        # target segment also
        changed_ids.add(str(update_val))

    change_filter = (pl.col("user_id") == user_id) & pl.col("segment_id").is_in(changed_ids)    

    df = df.with_columns([
        pl.when(change_filter).then(pl.lit(None)).otherwise(pl.col("segment_labels")).alias("segment_labels"),
        pl.when(change_filter).then(pl.lit(None)).otherwise(pl.col("label_justification")).alias("label_justification"),
    ])

    df = df.drop("row_id")
    df.write_csv(filepath, separator="\t")


def autosegment_by_event_type(filepath, sep_event_types):
    """
    Autosegments the whole dataframe.
    IMPORTANT: Clears segment_labels

    sep_event_types: list of event types by which we should separate ito segments
    """

    df = pl.read_csv(filepath, separator="\t", dtypes={"segment_id": pl.String})
    df = df.with_columns(
        pl.col("timestamp").str.strptime(pl.Datetime, strict=False)
    )

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
    cutoff_filter = pl.col("user_id").is_not_null() & pl.col("event_name").is_in(sep_event_types)
    df = df.with_columns(
        pl.when(cutoff_filter)
        .then(pl.col("segment_id").cast(pl.Int64) - 1)
        .otherwise(pl.col("segment_id"))
        .cast(pl.String)
        .alias("segment_id")
    )

    df = df.with_columns(pl.lit(None).alias("segment_labels"))
    df.write_csv(filepath, separator="\t")
