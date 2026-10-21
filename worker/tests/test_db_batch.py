import sqlite3

from sqlalchemy import Column, Integer, LargeBinary, MetaData, String, Table, insert

from benchly.db import write


def test_large_sqlite_batch_preserves_binding_order_nulls_and_binary_payloads():
    connection = sqlite3.connect(":memory:")
    connection.execute("CREATE TABLE fixture(id INTEGER PRIMARY KEY,label TEXT,optional INTEGER,payload BLOB)")
    table = Table("fixture", MetaData(), Column("id", Integer, primary_key=True), Column("label", String),
                  Column("optional", Integer), Column("payload", LargeBinary))
    records = [{"id": index, "label": f"value '{index}'", "optional": index if index % 2 else None,
                "payload": bytes([index % 256, 0, 255])} for index in range(1000)]
    write(connection, insert(table).values(records))
    assert connection.execute("SELECT COUNT(*) FROM fixture").fetchone()[0] == 1000
    for index in (0, 1, 479, 998, 999):
        assert connection.execute("SELECT label,optional,payload FROM fixture WHERE id=?", (index,)).fetchone() == (
            records[index]["label"], records[index]["optional"], records[index]["payload"])
    connection.close()
