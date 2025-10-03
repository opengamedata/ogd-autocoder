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