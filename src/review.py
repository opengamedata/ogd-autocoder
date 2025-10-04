import polars as pl
from dataset import read_labels_for_username, get_labels_filename


def compare_labels(filepath):
    """
    Returns labels made by each <username>
    for each segment
    """
    labels_path = get_labels_filename(filepath)
    all_labels = read_labels_for_username(labels_path, None)
    pivot_df = all_labels.pivot("username", index=["segment_id", "user_id"], values="segment_labels")
    return pivot_df.fill_null("-").to_dicts()

def copy_labels(filepath, from_username, to_username, ids):
    """
    Copy labels from one username to another
    
    `ids` are user_id + "_" + segment_id absolute row id
    """

    labels_path = get_labels_filename(filepath)
    all_labels = read_labels_for_username(labels_path, None)
    
    filterFrom = (pl.col("username") == from_username)
    if ids is not None:
        filterFrom = filterFrom & (pl.col("user_id") + "_" + pl.col("segment_id")).is_in(ids)

    from_labels = all_labels.filter(filterFrom)
    from_labels = from_labels.with_columns(pl.lit(to_username).alias("username"))

    # dropping rows instead of overwriting in case there are less rows in the to_username
    filterTo = (pl.col("username") != to_username)
    if ids is not None:
        filterTo = filterTo | ~(pl.col("user_id") + "_" + pl.col("segment_id")).is_in(ids)

    all_labels = all_labels.filter(filterTo)

    all_labels = pl.concat([all_labels, from_labels])
    all_labels.write_csv(labels_path, separator="\t")