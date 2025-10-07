"""
Code related to labeling the dataframe
"""

import polars as pl
from dataset import get_labels_filename, read_labels_for_username


def list_seg_labels(df):
    """
    List unique values of the `segment_labels` column
    """

    unique_labels = (
        df.select(pl.col("segment_labels")).drop_nulls().unique().to_series().to_list()
    )

    # for multilabel
    flattened = sorted(
        {item.strip() for part in unique_labels for item in part.split(", ")}
    )

    return flattened


def label_rows(labels_filepath, username, user_id, segment_id, segment_labels, label_justification):
    """
    For a `user_id` and `segment_id` apply segment_labels and label_justification
    If `segment_id` is specified, also filter by `segment_id`
    """
    df_labels = read_labels_for_username(labels_filepath, None)

    update_filter = (
        (pl.col("username") == str(username))
        & pl.col("segment_id").is_not_null()
        & (pl.col("user_id") == user_id)
        & (pl.col("segment_id") == str(segment_id))
    )
    
    segment_labels = None if segment_labels == "" else segment_labels

    if (df_labels.filter(update_filter).height == 0):
        new_item = pl.DataFrame([{
            "username": username,
            "segment_id": segment_id,
            "user_id": user_id,
            "segment_labels": segment_labels,
            "label_justification": None if label_justification == "" else label_justification
        }])
        df_labels = pl.concat([df_labels, new_item])
    else:
        df_labels = df_labels.with_columns(
            pl.when(update_filter)
            .then(pl.lit(segment_labels))
            .otherwise(pl.col("segment_labels"))
            .alias("segment_labels")
        )

        if (label_justification is not None):
            # skipped for the Apply tab (to not overwrite label_justification)
            update_val = None if label_justification == "" else label_justification
            df_labels = df_labels.with_columns(
                pl.when(update_filter)
                .then(pl.lit(update_val))
                .otherwise(pl.col("label_justification"))
                .alias("label_justification")
            )

    df_labels.write_csv(labels_filepath, separator="\t")
