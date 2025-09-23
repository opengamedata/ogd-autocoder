"""
Code related to labeling the dataframe
"""

import polars as pl
from dataset import read_dataset


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
