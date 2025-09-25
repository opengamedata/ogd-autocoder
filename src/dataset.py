"""
Code related to reading dataframe, dataset info
"""

import polars as pl


def read_dataset(filepath, filtered_only=True):
    """
    Returns the whole or filtered (by default) dataset
    Adds auxiliary columns - which are NOT written back to the file (unless you do it outside)

    IMPORTANT: Set filtered_only = False if you want to write_csv afterwards
    """
    df = pl.read_csv(filepath, separator="\t", dtypes={"segment_id": pl.String})

    columns = df.columns
    for col in ["segment_id", "segment_labels", "label_justification"]:
        if col not in columns:
            df = df.with_columns(pl.lit(None).alias(col))

    if "event_description" not in columns:
        df = df.with_columns(pl.col("event_name").alias("event_description"))

    if "filtered_in" not in columns:
        df = df.with_columns(pl.lit(True).alias("filtered_in"))

    if "job_name" not in columns:
        df = df.with_columns(
            pl.col("game_state").str.json_path_match("$.job_name").alias("job_name")
        )

    if filtered_only:
        df = df.filter(pl.col("filtered_in") == True)

    return df


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


def unique_count(df, cols):
    return df.select(pl.struct(cols).drop_nulls().n_unique()).item()


def get_dataset_info(filepath):
    """
    Returns useful dataset info such as row count, segments count, user session count
    """
    df = read_dataset(filepath, False)
    df = df.with_columns(pl.col("timestamp").str.strptime(pl.Datetime, strict=False))
    timestamp_min = df.select(pl.col("timestamp").drop_nulls().min()).item()
    timestamp_max = df.select(pl.col("timestamp").drop_nulls().max()).item()
    date_range = f"{timestamp_min:%m/%d/%Y} - {timestamp_max:%m/%d/%Y}"

    # Filtered / excluded subsets
    df_filtered = df.filter(pl.col("filtered_in") == True)
    included_events = (
        df_filtered.select(pl.col("event_name").drop_nulls().unique().sort())
        .to_series()
        .to_list()
    )
    all_events = set(df.select(pl.col("event_name").unique()).to_series().to_list())
    excluded_events = list(all_events.difference(set(included_events)))
    return {
        "date_range": date_range,
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


def find_by_user_and_segment(filepath, user_id, segment_id):
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
