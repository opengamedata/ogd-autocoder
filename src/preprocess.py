import polars as pl
# from ogd_features import calculate_ogd_features, list_ogd_features
from dataset import read_dataset


def get_game_id(filepath):
    """
    read first row for app_id
    """
    df = pl.read_csv(
        filepath, n_rows=1, separator="\t", dtypes={"segment_id": pl.String}
    )
    return df[0, "app_id"]


def available_features(filepath, username):
    # preprocess without using ogd pipeline to save some calculations
    columns = (
        preprocess_df_no_ogd(filepath, username)
        .drop(["segment_labels", "segment_id", "user_id"])
        .columns
    )

    # load also OGD features
    game_id = get_game_id(filepath)
    # ogd_columns = list_ogd_features(game_id)
    ogd_columns = []
    return {
        "included_features": [{"name": c} for c in columns],
        "excluded_features": ogd_columns,
    }


def preprocess_df(filepath, username):
    """
    Gets the ready-for-training df (ogd features included)
    """
    df_no_ogd = preprocess_df_no_ogd(filepath, username)
    game_id = get_game_id(filepath)

    # df_features = calculate_ogd_features(game_id, filepath)
    df_features = []
    if len(df_features):
        clean_agg_df_ogd = df_no_ogd.join(df_features, how="left", on=["user_id"])
    else:
        clean_agg_df_ogd = df_no_ogd

    # fixme - the ID is the segment_id + user_id
    clean_agg_df_ogd = clean_agg_df_ogd.with_columns(
        (pl.col("user_id") + "_" + pl.col("segment_id")).alias("segment_id")
    )
    clean_agg_df_ogd = clean_agg_df_ogd.drop(["user_id"])

    return clean_agg_df_ogd


def preprocess_df_no_ogd(filepath, username):
    """
    Preprocess using one hot encoding (no ogd features)
    """
    # segment_id is the new task_id, segment_labels is the target
    df = read_dataset(filepath, username)
    # fixme - add support for multiple labels
    df = df.with_columns(pl.col("timestamp").str.strptime(pl.Datetime, strict=False))

    # additional feature: segment duration in seconds
    duration_df = (
        df.group_by(["user_id", "segment_id"])
        .agg(
            [
                pl.col("timestamp").min().alias("segment_start"),
                pl.col("timestamp").max().alias("segment_end"),
            ]
        )
        .with_columns(
            (pl.col("segment_end") - pl.col("segment_start"))
            .dt.total_seconds()
            .alias("segment_duration")
        )
        .select(["user_id", "segment_id", "segment_duration"])
    )

    # fixme replace N/A method
    clean_df = (
        df.select(["event_name", "user_id", "segment_id", "segment_labels"])
        .with_columns(
            pl.col("segment_labels").fill_null(
                "N/A"
            )  # to include these rows (needed for inference)
        )
        .drop_nulls()  # Drop rows with any remaining nulls
    )
    # clean_df = clean_df.categorize(columns=["event_name"])
    clean_1hot_df = clean_df.to_dummies(columns=["event_name"])

    grouped = clean_1hot_df.group_by(["user_id", "segment_id", "segment_labels"])
    count_df = grouped.len().rename({"len": "count_events"})
    sum_df = grouped.sum()
    sum_df = sum_df.rename(
        {
            col: f"{col}_sum"
            for col in sum_df.columns
            if col not in ["user_id", "segment_id", "segment_labels"]
        }
    )

    clean_agg_df = sum_df.join(
        count_df, on=["user_id", "segment_id", "segment_labels"]
    ).join(duration_df, on=["user_id", "segment_id"], how="left")

    numeric_cols = [
        c
        for c in sum_df.columns
        if c not in ["user_id", "segment_id", "segment_labels"]
    ]
    # add percentage columns
    clean_agg_df = clean_agg_df.with_columns(
        [
            (pl.col(c) / pl.col("count_events") * 100).alias(c + "_percent")
            for c in numeric_cols
        ]
    )

    return clean_agg_df
