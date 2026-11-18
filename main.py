from enum import Enum
from datetime import datetime
from os import getenv
from pathlib import Path as FilePath
from secrets import token_urlsafe
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, FastAPI, Form, HTTPException, Path, Request, Response
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from psycopg import AsyncConnection
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.sessions import SessionMiddleware

from db import getDB, lifespan


class SubmissionStatus(str, Enum):
    DRAFT = "draft"
    IN_REVIEW = "in_review"
    APPROVED = "approved"


class Role(str, Enum):
    AUTHOR = "author"
    EDITOR = "editor"


class User(BaseModel):
    id: int
    name: str
    role: Role


class SubmissionInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    category: str = Field(min_length=1, examples=["軟體工程"])
    title: str = Field(min_length=1, examples=["投稿審查系統"])
    content: str = Field(min_length=1, examples=["這是稿件的正文。"])


class SubmissionSummary(BaseModel):
    id: int
    category: str
    title: str
    status: SubmissionStatus
    revision_note: str = ""


class ReturnInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    revision_note: str = Field(min_length=1, max_length=5000)


class ReviewHistory(BaseModel):
    id: int
    submission_id: int | None
    author_name: str
    category: str
    title: str
    content: str
    decision: str
    revision_note: str
    reviewed_at: datetime


class ReviewSummary(SubmissionSummary):
    author_name: str


class Submission(ReviewSummary):
    author_id: int
    content: str



Database = Annotated[AsyncConnection, Depends(getDB)]


async def get_current_user(request: Request, db: Database) -> User:
    user_id = request.session.get("user_id")
    if user_id is None:
        raise HTTPException(401, "請先登入")
    cursor = await db.execute("SELECT id, name, role FROM users WHERE id = %s", (user_id,))
    row = await cursor.fetchone()
    if row is None:
        request.session.clear()
        raise HTTPException(401, "登入身分已失效，請重新登入")
    return User.model_validate(row)


async def require_author(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role != Role.AUTHOR:
        raise HTTPException(403, "此操作限作者")
    return user


async def require_editor(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role != Role.EDITOR:
        raise HTTPException(403, "此操作限編輯")
    return user


Author = Annotated[User, Depends(require_author)]
Editor = Annotated[User, Depends(require_editor)]
SubmissionId = Annotated[int, Path(gt=0)]

app = FastAPI(
    title="投稿審查 API",
    description="先登入建立 session，接著依帳號角色使用投稿或審查 API。",
    lifespan=lifespan,
)
app.add_middleware(
    SessionMiddleware,
    secret_key=getenv("SESSION_SECRET") or token_urlsafe(32),
    session_cookie="submission_session",
    max_age=8 * 60 * 60,
    same_site="lax",
)
auth = APIRouter(prefix="/api/auth", tags=["登入"])
author = APIRouter(prefix="/api/author/submissions", tags=["作者"])
editor = APIRouter(prefix="/api/editor/submissions", tags=["編輯"])


@auth.post("/login", summary="登入")
async def login(
    request: Request,
    db: Database,
    username: Annotated[str, Form(min_length=1, description="帳號 Email")],
    password: Annotated[str, Form(min_length=1, max_length=72)],
) -> User:
    if len(password.encode("utf-8")) > 72 or "\x00" in password + username:
        raise HTTPException(401, "Email 或密碼錯誤")
    cursor = await db.execute(
        """
        SELECT id, name, role FROM users
        WHERE email = %s AND password_hash = public.crypt(%s, password_hash)
        """,
        (username.strip().lower(), password),
    )
    row = await cursor.fetchone()
    if row is None:
        raise HTTPException(401, "Email 或密碼錯誤")

    user = User.model_validate(row)
    request.session.clear()
    request.session["user_id"] = user.id
    return user


@auth.get("/me", summary="查詢目前登入者")
async def read_current_user(user: Annotated[User, Depends(get_current_user)]) -> User:
    return user


@auth.post("/logout", summary="登出", status_code=204)
async def logout(request: Request) -> Response:
    request.session.clear()
    return Response(status_code=204)


async def get_submission(
    db: AsyncConnection, submission_id: int, *, owner: User | None = None, lock: bool = False
) -> Submission:
    query = """
        SELECT s.id, s.category, s.title, s.content, s.status, s.author_id, s.revision_note,
               u.name AS author_name
        FROM submissions AS s
        JOIN users AS u ON u.id = s.author_id
        WHERE s.id = %s
    """
    params = (submission_id,)
    if owner is not None:
        query += " AND s.author_id = %s"
        params += (owner.id,)
    if lock:
        query += " FOR UPDATE OF s"
    cursor = await db.execute(query, params)
    row = await cursor.fetchone()
    if row is None:
        raise HTTPException(404, "找不到稿件")
    return Submission.model_validate(row)


def require_status(submission: Submission, expected: SubmissionStatus) -> None:
    if submission.status != expected:
        raise HTTPException(409, "稿件目前的狀態無法執行此操作")


async def change_status(
    db: AsyncConnection,
    submission: Submission,
    expected: SubmissionStatus,
    target: SubmissionStatus,
) -> Submission:
    require_status(submission, expected)
    await db.execute("UPDATE submissions SET status = %s WHERE id = %s", (target.value, submission.id))
    await db.commit()
    return submission.model_copy(update={"status": target})


@author.get("", summary="列出自己的稿件")
async def list_my_submissions(user: Author, db: Database) -> list[SubmissionSummary]:
    cursor = await db.execute(
        "SELECT id, category, title, status, revision_note FROM submissions WHERE author_id = %s ORDER BY id",
        (user.id,),
    )
    rows = await cursor.fetchall()
    return [SubmissionSummary.model_validate(row) for row in rows]


@author.post("", summary="新增稿件", status_code=201)
async def create_submission(data: SubmissionInput, user: Author, db: Database) -> Submission:
    cursor = await db.execute(
        """
        INSERT INTO submissions (author_id, category, title, content)
        VALUES (%s, %s, %s, %s)
        RETURNING id, author_id, category, title, content, status
        """,
        (user.id, data.category, data.title, data.content),
    )
    row = await cursor.fetchone()
    submission = Submission.model_validate({**row, "author_name": user.name})
    await db.commit()
    return submission


@author.get("/{submission_id}", summary="查看自己的稿件")
async def read_my_submission(submission_id: SubmissionId, user: Author, db: Database) -> Submission:
    return await get_submission(db, submission_id, owner=user)


@author.put("/{submission_id}", summary="編輯稿件")
async def update_submission(
    submission_id: SubmissionId, data: SubmissionInput, user: Author, db: Database
) -> Submission:
    submission = await get_submission(db, submission_id, owner=user, lock=True)
    require_status(submission, SubmissionStatus.DRAFT)
    await db.execute(
        "UPDATE submissions SET category = %s, title = %s, content = %s WHERE id = %s",
        (data.category, data.title, data.content, submission_id),
    )
    await db.commit()
    return submission.model_copy(update=data.model_dump())


@author.delete("/{submission_id}", summary="刪除編輯中的稿件", status_code=204)
async def delete_submission(submission_id: SubmissionId, user: Author, db: Database) -> Response:
    submission = await get_submission(db, submission_id, owner=user, lock=True)
    require_status(submission, SubmissionStatus.DRAFT)
    await db.execute("DELETE FROM submissions WHERE id = %s", (submission_id,))
    await db.commit()
    return Response(status_code=204)


@author.post("/{submission_id}/submit", summary="送出投稿")
async def submit_submission(submission_id: SubmissionId, user: Author, db: Database) -> Submission:
    submission = await get_submission(db, submission_id, owner=user, lock=True)
    return await change_status(db, submission, SubmissionStatus.DRAFT, SubmissionStatus.IN_REVIEW)


@editor.get("", summary="列出待審稿件")
async def list_pending_submissions(_user: Editor, db: Database) -> list[ReviewSummary]:
    cursor = await db.execute(
        """
        SELECT s.id, s.category, s.title, s.status, u.name AS author_name
        FROM submissions AS s
        JOIN users AS u ON u.id = s.author_id
        WHERE s.status = 'in_review'
        ORDER BY s.id
        """
    )
    rows = await cursor.fetchall()
    return [ReviewSummary.model_validate(row) for row in rows]


@editor.get("/history", summary="查看自己通過與退回的歷史")
async def review_history(user: Editor, db: Database) -> list[ReviewHistory]:
    cursor = await db.execute(
        "SELECT * FROM review_history WHERE editor_id = %s ORDER BY id DESC", (user.id,)
    )
    return [ReviewHistory.model_validate(row) for row in await cursor.fetchall()]


async def record_review(
    db: AsyncConnection, submission: Submission, user: User, decision: str, note: str = ""
) -> Submission:
    require_status(submission, SubmissionStatus.IN_REVIEW)
    await db.execute(
        """
        INSERT INTO review_history
        (submission_id, editor_id, author_name, category, title, content, decision, revision_note)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (submission.id, user.id, submission.author_name, submission.category,
         submission.title, submission.content, decision, note),
    )
    target = SubmissionStatus.APPROVED if decision == "approved" else SubmissionStatus.DRAFT
    await db.execute(
        "UPDATE submissions SET status = %s, revision_note = %s WHERE id = %s",
        (target.value, note, submission.id),
    )
    await db.commit()
    return submission.model_copy(update={"status": target, "revision_note": note})


@editor.get("/{submission_id}", summary="查看待審稿件內容")
async def read_pending_submission(submission_id: SubmissionId, _user: Editor, db: Database) -> Submission:
    submission = await get_submission(db, submission_id)
    require_status(submission, SubmissionStatus.IN_REVIEW)
    return submission


@editor.post("/{submission_id}/approve", summary="通過稿件")
async def approve_submission(submission_id: SubmissionId, user: Editor, db: Database) -> Submission:
    submission = await get_submission(db, submission_id, lock=True)
    return await record_review(db, submission, user, "approved")


@editor.post("/{submission_id}/return", summary="退回稿件")
async def return_submission(
    submission_id: SubmissionId, data: ReturnInput, user: Editor, db: Database
) -> Submission:
    submission = await get_submission(db, submission_id, lock=True)
    return await record_review(db, submission, user, "returned", data.revision_note)


app.include_router(auth)
app.include_router(author)
app.include_router(editor)

project_dir = FilePath(__file__).resolve().parent
templates = Jinja2Templates(directory=project_dir / "templates")
app.mount("/www", StaticFiles(directory=project_dir / "www"), name="static")


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
@app.get("/login", response_class=HTMLResponse, include_in_schema=False)
async def login_page(request: Request) -> Response:
    return templates.TemplateResponse(request, "login.html", {"page": "login"})


@app.get("/author/submissions", response_class=HTMLResponse, include_in_schema=False)
async def author_page(
    request: Request, mode: Literal["edit", "delete", "submit"] | None = None
) -> Response:
    return templates.TemplateResponse(
        request, "author_submissions.html", {"page": "author", "mode": ""}
    )


@app.get("/author/submissions/new", response_class=HTMLResponse, include_in_schema=False)
@app.get(
    "/author/submissions/{submission_id}/edit",
    response_class=HTMLResponse,
    include_in_schema=False,
)
async def submission_form_page(request: Request, submission_id: int | None = None) -> Response:
    return templates.TemplateResponse(
        request, "submission_form.html", {"page": "form", "submission_id": submission_id or ""}
    )


@app.get("/editor/submissions", response_class=HTMLResponse, include_in_schema=False)
async def editor_page(
    request: Request, mode: Literal["read", "approve", "return", "history"] | None = None
) -> Response:
    return templates.TemplateResponse(
        request, "editor_queue.html", {"page": "editor", "mode": mode or ""}
    )


@app.get("/editor/submissions/{submission_id}", response_class=HTMLResponse, include_in_schema=False)
async def review_page(
    request: Request, submission_id: SubmissionId, mode: Literal["approve", "return"] | None = None
) -> Response:
    return templates.TemplateResponse(
        request, "review_detail.html",
        {"page": "review", "submission_id": submission_id, "mode": mode or ""},
    )
