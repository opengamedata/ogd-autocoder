"""
Code related to modifications using the "event_name" column
"""

import json
import polars as pl
from dataset import read_dataset


def event_filtering(filepath, included_events):
    """
    Updates filtered_in column setting to `True` if event_name in the included_events list
    """
    df = read_dataset(filepath, None, False)

    df = df.with_columns(
        (pl.col("event_name").is_in(included_events)).alias("filtered_in")
    )

    df.write_csv(filepath, separator="\t")


def safe_format_description(template, ev_data, g_state):
    try:
        return template.format_map(
            {"event_data": json.loads(ev_data), "game_state": json.loads(g_state)}
        )
    except Exception as e:
        return None


def describe_events(filepath, descriptions_map):
    """
    Fills new column "event_description" using descriptions_map (dictionary mapping event_name to template)
    """
    df = read_dataset(filepath, None, False)
    for ev_name, template in descriptions_map.items():
        df = df.with_columns(
            pl.when(pl.col("event_name") == ev_name)
            .then(
                pl.struct(["event_data", "game_state"]).map_elements(
                    lambda row: safe_format_description(
                        template, row["event_data"], row["game_state"]
                    ),
                    return_dtype=pl.Utf8,
                )
            )
            .otherwise(pl.col("event_description"))
            .alias("event_description")
        )

    df.write_csv(filepath, separator="\t")
