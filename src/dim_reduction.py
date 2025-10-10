import numpy as np
import polars as pl
from sklearn.decomposition import PCA
from sklearn.feature_selection import SelectFromModel
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from preprocess import preprocess_df
from sklearn.preprocessing import (
    RobustScaler,
    StandardScaler,
    MinMaxScaler,
    MaxAbsScaler,
)

AVAILABLE_SCALERS = {
    "StandardScaler": StandardScaler,
    "MinMaxScaler": MinMaxScaler,
    "MaxAbsScaler": MaxAbsScaler,
    "RobustScaler": RobustScaler,
}

RANDOM_STATE = 13


def pca_details(filepath, username, hyperparameters, include_labels, include_features):
    """
    Returns a list with cumulative and explained variance after applying PCA

    :param filepath:
    :param username:
    :param hyperparameters:
    :param include_labels:
    :param include_features:
    :return: dict
    """

    df = preprocess_df(filepath, username).to_pandas()
    df = df[df["segment_labels"].isin(include_labels)]
    cols = [c for c in include_features if c in df.columns]
    x_train, _ = train_test_split(
        df[cols],
        train_size=float(hyperparameters["train_test_ratio"]),
        random_state=RANDOM_STATE,
        stratify=df["segment_labels"],
    )

    # FIXME notify the user that scaling is required or do this by default
    scaler_choice = hyperparameters.get("scaling", False)
    if scaler_choice in AVAILABLE_SCALERS:
        scaler = AVAILABLE_SCALERS[scaler_choice]()
        x_train = scaler.fit_transform(x_train)

    # n_components == min(n_samples, n_features)
    pca = PCA()
    pca.fit(x_train)

    explained_variance = pca.explained_variance_ratio_.tolist()
    cumulative_variance = np.cumsum(explained_variance).tolist()

    return {"explained_variance": explained_variance, "cumulative": cumulative_variance}


def correlation(filepath, username, include_labels):
    """
    Returns the correlation matrix of the features (target is excluded)

    :param filepath:
    :param username:
    :param include_labels:
    :return: dict
    """
    df = preprocess_df(filepath, username).drop(["segment_id"])
    # FIXME - calculated on whole dataframe, no splitting in train/test
    df = df.filter(pl.col("segment_labels").is_in(include_labels))
    df = df.drop(["segment_labels"])
    corr_matrix = df.corr().to_pandas().abs()
    corr_matrix.index = corr_matrix.columns
    np.fill_diagonal(corr_matrix.values, 0)  # fill 0s in self correlation

    return corr_matrix.fillna("null").to_dict(orient="dict")


def autoselect_features(filepath, username, include_labels):
    """
    Returns the features that are selected if a logistic regression with lasso is performed

    :param filepath:
    :param username:
    :param include_labels:
    :return: dict
    """
    df = preprocess_df(filepath, username)
    # fixme maybe we should also use the target col?
    df = df.filter(pl.col("segment_labels").is_in(include_labels))
    df = df.to_pandas()
    X, y = df.drop(columns=["segment_labels", "segment_id"]), df["segment_labels"]
    # fixme, maybe differ for each model_type
    selector = SelectFromModel(LogisticRegression(random_state=RANDOM_STATE, penalty='l1'))
    selector.fit(X, y)

    selected_features = X.columns[selector.get_support()].tolist()

    return selected_features
