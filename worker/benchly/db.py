"""Shared SQLite boundary for worker feature slices.

Legacy analytical reads still use SQLite's small, predictable row API.  Feature
repositories execute SQLAlchemy expressions built from SQLModel tables.  Both
paths share one connection and transaction through this deliberately tiny
adapter; pipeline modules never need to know which API performs a write.
"""

from __future__ import annotations

import sqlite3
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Optional

from sqlalchemy import event
from sqlalchemy.dialects import sqlite
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.pool import NullPool
from sqlmodel import create_engine


@lru_cache(maxsize=8)
def engine_for(path: Path) -> Engine:
    resolved = path.resolve()
    engine = create_engine(
        f"sqlite:///{resolved}",
        connect_args={"check_same_thread": False, "timeout": 30},
        poolclass=NullPool,
    )

    @event.listens_for(engine, "connect")
    def configure_sqlite(connection: sqlite3.Connection, _record: Any) -> None:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")
        connection.row_factory = sqlite3.Row

    return engine


class Database:
    """One transaction with a typed write API and SQLite-compatible reads."""

    def __init__(self, engine: Engine):
        self._connection: Connection = engine.connect()
        self._driver: sqlite3.Connection = self._connection.connection.driver_connection

    def execute(self, query: str, parameters: object = ()) -> sqlite3.Cursor:
        """Run an explicit analytical or schema-inspection query."""
        return self._driver.execute(query, parameters)

    def write(self, statement, parameters: Optional[object] = None):
        """Execute a SQLAlchemy expression created from a SQLModel table."""
        return self._connection.execute(statement, parameters or {})

    def create_tables(self, models: Iterable[type]) -> None:
        for model in models:
            model.__table__.create(bind=self._connection, checkfirst=True)

    def commit(self) -> None:
        self._connection.commit()

    def rollback(self) -> None:
        self._connection.rollback()

    def close(self) -> None:
        self._connection.close()

    def backup_to(self, target: sqlite3.Connection) -> None:
        self._driver.backup(target)

    def __enter__(self) -> "Database":
        return self

    def __exit__(self, exc_type, _exc, _traceback) -> None:
        if exc_type is None:
            self.commit()
        else:
            self.rollback()


def open_database(path: Path) -> Database:
    return Database(engine_for(path))


def connect_database(path: Path) -> Database:
    if not path.exists():
        raise RuntimeError(f"Database does not exist: {path}. Run `npm run db:migrate` first.")
    database = open_database(path)
    required = database.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='benches'"
    ).fetchone()
    if not required:
        database.close()
        raise RuntimeError("Benchly schema is missing. Run the app migration first.")
    return database


def write(database, statement, parameters: Optional[object] = None):
    """Execute a typed statement on the worker DB or a lightweight test DB.

    Unit tests use in-memory ``sqlite3.Connection`` instances.  Compiling the
    same SQLAlchemy expression for those connections keeps tests fast without
    introducing a second persistence implementation.
    """
    if isinstance(database, Database):
        return database.write(statement, parameters)
    if parameters is not None:
        raise TypeError("typed batch parameters require a Database connection")
    compiled = statement.compile(
        dialect=sqlite.dialect(paramstyle="qmark"),
        compile_kwargs={"render_postcompile": True},
    )
    values = tuple(compiled.params[name] for name in compiled.positiontup or ())
    return database.execute(str(compiled), values)
