"""Weather refresh job."""

from __future__ import annotations

import json
from argparse import Namespace
from pathlib import Path

from benchly.db import connect_database
from benchly.runs.repository import begin_run, finish_run
from benchly.weather.service import refresh_weather


def refresh_weather_job(args: Namespace) -> None:
    connection = connect_database(Path(args.database).resolve())
    run_id = begin_run(connection, "refresh-weather", "MeteoSwiss ICON-CH1 + PRECIP")
    try:
        stats = refresh_weather(connection, icon=not args.radar_only, radar=not args.icon_only)
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error)})
        raise
    finally:
        connection.close()
