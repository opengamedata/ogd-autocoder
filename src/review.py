import polars as pl
from dataset import read_labels_for_username, get_labels_filename
from sklearn.metrics import cohen_kappa_score
from statsmodels.stats.inter_rater import aggregate_raters, fleiss_kappa
from numpy import isnan

def compare_labels(filepath, username):
    """
    Returns labels made by each `username` for each segment

    :param filepath:
    :return: df
    """
    labels_path = get_labels_filename(filepath)
    all_labels = read_labels_for_username(labels_path, None)
    pivot_df = all_labels.pivot("username", index=["segment_id", "user_id"], values="segment_labels")
    
    if not username in pivot_df.columns:
        pivot_df = pivot_df.with_columns(pl.lit(None).cast(pl.String).alias(username))

    return pivot_df

def copy_labels(filepath, from_username, to_username, ids):
    """
    Copy labels from one username to another

    :param filepath:
    :param from_username:
    :param to_username:
    :param ids: list of `user_id` + "_" + `segment_id` absolute row ids
    :return:
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

def inter_rater_reliability(filepath, username):
    """
    Using Cohen's Kappa and Fleiss' Kappa to calculate pairwise and overall inter-rater reliability
    For each evaluated pair, `dropped` means number of dropped rows with null values (needed to enable the algorithm to work properly)

    :param filepath:
    :return:list(objects)
    """
    compare_df = compare_labels(filepath, username).to_pandas()
    usernames = [col for col in compare_df.columns if col not in ["user_id", "segment_id"]]
    cohen_kappas = []
    for username1 in usernames:
        for username2 in usernames:
            if username1 > username2:
                no_nulls_df = compare_df[[username1, username2]].dropna()
                dropped = compare_df.shape[0] - no_nulls_df.shape[0]
                # avoid symmetric
                y1 = no_nulls_df[username1]
                y2 = no_nulls_df[username2]
                if no_nulls_df.shape[0]:
                    cohen_kappas.append({"users": f"{username1} / {username2}", "value": cohen_kappa_score(y1, y2), "dropped": dropped})

    # overall
    no_nulls_df = compare_df[usernames].dropna()
    if no_nulls_df.shape[0]:
        dropped = compare_df.shape[0] - no_nulls_df.shape[0]
        arr, cat = aggregate_raters(no_nulls_df)
        fleiss_k = fleiss_kappa(arr, method='fleiss')
        cohen_kappas.append({"users": f"overall", "value": "null" if isnan(fleiss_k) else fleiss_k, "dropped": dropped})

    # sort in descending order
    return sorted(cohen_kappas, key=lambda x: x["value"], reverse=True)