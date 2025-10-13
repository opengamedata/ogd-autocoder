"""
Code for listing and collecting OGD features
"""

from ogd.core.configs.GameStoreConfig import GameStoreConfig
from ogd.common.configs.DataTableConfig import DataTableConfig
from ogd.common.filters.collections.DatasetFilterCollection import (
    DatasetFilterCollection,
)
from ogd.common.models.enums.ExportMode import ExportMode
from ogd.core.requests.Request import Request
from ogd.common.configs.storage.FileStoreConfig import FileStoreConfig
from ogd.common.configs.storage.DictionaryStoreConfig import DictionaryStoreConfig
from ogd.core.managers.ExportManager import ExportManager
from ogd.core.configs.CoreConfig import CoreConfig
from ogd.core.configs.generators.GeneratorCollectionConfig import (
    GeneratorCollectionConfig,
)
from ogd.common.models.DatasetKey import DatasetKey

import logging
import polars as pl

# Set the root logger level
logging.basicConfig(level=logging.INFO)
broken_features = ["EventList", "SessionDuration"]


def list_ogd_features(app_id):
    features = []
    generators = GeneratorCollectionConfig.Load(app_id)
    for feat in broken_features:
        generators.Extractors.AggregateExtractors.pop(feat, None)

    generators.Extractors.IteratedExtractors.clear()

    for ext_name, extractor in generators.EnabledExtractors().items():
        allowed_types = ["float", "bool", "int"]
        if extractor._return_type in allowed_types:
            features.append({"name": ext_name, "description": extractor.Description})

        if extractor.Subfeatures:
            features.extend(
                [
                    {"name": ext_name + "-" + n, "description": s.Description}
                    for n, s in extractor.Subfeatures.items()
                    if s._return_type in allowed_types
                ]
            )

    return features


def calculate_ogd_features(app_id, filepath):
    generators = GeneratorCollectionConfig.Load(app_id)

    for feat in broken_features:
        generators.Extractors.AggregateExtractors.pop(feat, None)

    generators.Extractors.IteratedExtractors.clear()

    corecfg = CoreConfig.Default()
    corecfg.FailFast = True
    fromDT = DataTableConfig(
        name="default",
        table_location=None,
        store=FileStoreConfig("", filepath, None),
        table_schema="OGD_EVENT_FILE",
    )

    toDT = DataTableConfig(
        name="default",
        table_location=None,
        store=DictionaryStoreConfig("", None, None),
        table_schema="OGD_FEATURE_FILE",
    )
    r = Request(
        {ExportMode.PLAYER},
        DatasetFilterCollection(),
        corecfg,
        generators,
        custom_game_stores=GameStoreConfig(
            "default",
            app_id,
            events_from=[fromDT],
            events_to=[],
            feats_to=[toDT],
            feats_from=[],
        ),
        custom_dataset_key=DatasetKey(game_id=app_id, full_file=filepath),
    )

    em = ExportManager(CoreConfig.Default())
    result = em.ExecuteRequest(r)
    if result.Status != 2:
        print(result.Message)
    dict_out = em._feats_out["default"]._out
    processed_out = {}
    for entry in dict_out["players"]["vals"]:
        feature_name = entry[0]
        value = entry[7]
        user_id = entry[5]

        if user_id not in processed_out:
            processed_out[user_id] = {"user_id": user_id}

        processed_out[user_id][feature_name] = value

    df = pl.DataFrame(list(processed_out.values()))

    columns_filter = [
        c["name"] for c in list_ogd_features(app_id)
    ]  # only select available columns
    columns_filter.append("user_id")
    return df.select(columns_filter)
