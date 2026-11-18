from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from getpass import getpass
from os import environ
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool


load_dotenv(Path(__file__).with_name(".env"))


def connection_settings() -> dict[str, str | int]:
    required = ("PGDATABASE", "PGUSER")
    missing = [name for name in required if not environ.get(name)]
    if missing:
        raise ValueError("請在 .env 設定 " + "、".join(missing))

    return {
        "host": environ.get("PGHOST") or "127.0.0.1",
        "port": environ.get("PGPORT") or "5432",
        "dbname": environ["PGDATABASE"],
        "user": environ["PGUSER"],
        "connect_timeout": 5,
        "options": "-c search_path=submission_app",
    }


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    pool = AsyncConnectionPool(
        kwargs={**connection_settings(), "row_factory": dict_row},
        min_size=1,
        max_size=5,
        timeout=5,
        open=False,
    )
    try:
        await pool.open(wait=True, timeout=10)
        app.state.pool = pool
        yield
    finally:
        await pool.close()


async def getDB(request: Request) -> AsyncIterator[psycopg.AsyncConnection]:
    async with request.app.state.pool.connection() as connection:
        yield connection


def check_connection() -> None:
    settings = connection_settings()
    if not environ.get("PGPASSWORD") and not environ.get("PGPASSFILE"):
        password = getpass("PostgreSQL 密碼（輸入時不顯示，可直接 Enter 使用既有設定）：")
        if password:
            settings["password"] = password

    with psycopg.connect(**settings, row_factory=dict_row) as connection:
        row = connection.execute(
            """
            SELECT current_database() AS database, current_user AS username,
                   to_regclass('submission_app.users') IS NOT NULL AS has_users,
                   to_regclass('submission_app.submissions') IS NOT NULL AS has_submissions,
                   to_regclass('submission_app.review_history') IS NOT NULL AS has_review_history
            """
        ).fetchone()
    print(f"連線成功，資料庫 {row['database']}，帳號 {row['username']}")
    for table in ("users", "submissions", "review_history"):
        print(f"submission_app.{table}：{'已建立' if row[f'has_{table}'] else '尚未建立'}")


if __name__ == "__main__":
    try:
        check_connection()
    except (ValueError, psycopg.Error) as exc:
        raise SystemExit(f"連線檢查失敗：{exc}") from None
