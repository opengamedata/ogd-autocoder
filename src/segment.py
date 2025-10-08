"""
Code related to segmenting (manually or auto) the dataframe
"""

import polars as pl
from dataset import read_dataset, read_labels_for_username, get_labels_filename


def segment_ids_for_user(df, user_id, unlabeled_only, confidence_threshold = None):
    """
    List ordered segment ids with their label for the selected `user_id`
    if `unlabeled_only` = True - selects only unlabeled segments
    Also adds the `job_name` if column exists
    """
    if unlabeled_only:
        df = df.filter(pl.col("segment_labels").is_null())

    if confidence_threshold is not None and "prediction_confidence" in df.columns:
        df = df.filter(pl.col("prediction_confidence") > confidence_threshold)

    # cast to int to sort correctly - fixme sort by timestamp
    df_user = df.filter(pl.col("user_id") == user_id).with_columns(
        pl.col("segment_id").cast(pl.Int64)
    )

    cols = ["segment_id", "segment_labels"]
    if "job_name" in df_user.columns:
        cols.append("job_name")

    df_user = df_user.drop_nulls(subset=["segment_id"])

    # order by timestamp so we get the first job
    df_segments = df_user.sort("timestamp").unique(
        subset=["segment_id", "segment_labels"]
    )

    return df_segments.select(cols).sort("segment_id").to_dicts()


def segment_rows(filepath, user_id, segment_id, selected_rows):
    """
    For a `user_id` apply segment_id on selected_rows (row identifiers => index + session_id columns)
    Clears segment labels for all affected segments
    """

    labels_filename = get_labels_filename(filepath)
    labels_df = read_labels_for_username(labels_filename, None)
    
    df = read_dataset(filepath, None, False)

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

    df = df.drop("row_id")
    df.write_csv(filepath, separator="\t")

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

    change_filter = (
        (pl.col("user_id") == user_id)
        & pl.col("segment_id").is_in(changed_ids)
    )

    labels_df = labels_df.with_columns(
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
    labels_df.write_csv(labels_filename, separator="\t")


def autosegment_by_event_type(filepath, sep_event_types):
    """
    Autosegments the whole dataframe.
    IMPORTANT: Clears segment_labels

    sep_event_types: list of event types by which we should separate ito segments
    """

    labels_filename = get_labels_filename(filepath)
    labels_df = read_labels_for_username(labels_filename, None)

    df = read_dataset(filepath, None, False)
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

    df.write_csv(filepath, separator="\t")

    # clearing segment_labels column
    labels_df = labels_df.with_columns(pl.lit(None).alias("segment_labels"))
    labels_df.write_csv(labels_filename, separator="\t")