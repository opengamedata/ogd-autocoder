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
from ogd.core.configs.generators.GeneratorCollectionConfig import GeneratorCollectionConfig
from ogd.common.models.DatasetKey import DatasetKey

import logging
import polars as pl

# Set the root logger level
logging.basicConfig(level=logging.INFO)

def list_ogd_features(app_id):
    features = []
    for ext_name, extractor in GeneratorCollectionConfig.FromFile(app_id).EnabledExtractors().items():
        allowed_types = ["float", "bool", "int"]
        if extractor._return_type in allowed_types:
            features.append(ext_name)

        if extractor.Subfeatures:
            features.extend([ext_name + "." + n for n, s in extractor.Subfeatures.items() if s._return_type in allowed_types])

    return features


def calculate_ogd_features(app_id, filepath):
    ogd_columns = GeneratorCollectionConfig.FromFile(app_id)

    # for name, e in ogd_columns.Extractors.IteratedExtractors.items():
    #     e.Enabled = False

    # for name, e in ogd_columns.Extractors.AggregateExtractors.items():
    #     if name != 'JobsCompleted':
    #         e.Enabled = False

    corecfg = CoreConfig.Default()
    corecfg.FailFast = True
    fromDT = DataTableConfig(
        name="default",
        table_location=None,
        store_name=None,
        store_config=FileStoreConfig("", filepath, None),
        schema_name="OGD_EVENT_FILE",
    )

    toDT = DataTableConfig(
        name="default",
        table_location=None,
        store_name=None,
        store_config=DictionaryStoreConfig("", None, None),
        schema_name="OGD_FEATURE_FILE",
    )
    r = Request(
        {ExportMode.PLAYER},
        DatasetFilterCollection(),
        corecfg,
        ogd_columns,
        custom_game_stores=GameStoreConfig("default", app_id, events_from=[fromDT], events_to=[], feats_to=[toDT], feats_from=[]),
        custom_dataset_key=DatasetKey(game_id=app_id, full_file=filepath)
    )
    r.Interfaces["default"]._data.drop(columns=["segment_id", "segment_labels", "label_justification", "filtered_in", "job_name", "predicted_labels", "prediction_confidence"], errors='ignore', inplace=True)
    r.Interfaces["default"]._data.dropna(inplace=True)
    ExportManager(CoreConfig.Default()).ExecuteRequest(r)
    dict_out = r.Outerfaces["default"]._out
    processed_out = []
    for entry in dict_out['players']['vals']:
        metrics = entry[7]
        values = entry[8]
        
        record = dict(zip(metrics, values))  # map metrics -> values
        record["user_id"] = entry[5]
        processed_out.append(record)

    return pl.DataFrame(processed_out)
#user_data {}, offset, app_version	app_branch	log_version event_source GAME