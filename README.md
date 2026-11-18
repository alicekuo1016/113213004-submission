# 投稿審查 API

啟動後開啟 [投稿審查首頁](http://127.0.0.1:8000/)。登入後會依帳號角色前往作者稿件清單或編輯待審清單。五個頁面及共用版面放在 `templates/`，樣式和瀏覽器操作放在 `www/`。

作者清單可點選標題查看正文與退回建議。編輯可在待審稿件詳情中通過稿件，或填寫必填的建議修改內容後退回。「通過、退回稿件」清單保存目前登入編輯的每次審查內容與時間，作者修改或刪除稿件後仍可查詢當次紀錄。

既有資料庫升級請執行 `upgrade_reviews.sql`，本次工作已在目前 `.env` 指定的資料庫套用。全新建表使用 `schema.sql` 即可。歷史資料從升級後的審查開始記錄，先前的通過與退回事實缺乏編輯身分和時間資料，無法回補。背景使用 `www/blue.jpg`。

## 啟動

首次安裝依賴後，在專案資料夾的 PowerShell 依下方「設定 PostgreSQL」填寫連線設定，再啟動開發伺服器。

```powershell
python -m pip install -r requirements.txt
fastapi dev main.py
```

開啟 [Swagger UI](http://127.0.0.1:8000/docs)，先在「登入」區執行 `POST /api/auth/login`，再測試該角色的路由。Swagger UI 會透過同一個瀏覽器的 session cookie 延續登入。稿件儲存在你設定的 PostgreSQL 資料庫。

## 路由規劃

`{submission_id}` 是新增稿件時回傳的 `id`。

| 角色 | 方法 | 路徑 | 用途 |
| --- | --- | --- | --- |
| 作者 | GET | `/api/author/submissions` | 列出自己所有稿件的編號、類別、標題與審查狀態。 |
| 作者 | POST | `/api/author/submissions` | 用類別、標題與正文建立稿件，初始狀態為編輯中。 |
| 作者 | GET | `/api/author/submissions/{submission_id}` | 讀取自己的單篇稿件與正文，供查看及帶入編輯表單。 |
| 作者 | PUT | `/api/author/submissions/{submission_id}` | 編輯自己仍在編輯中的稿件，需提供完整的類別、標題與正文。 |
| 作者 | DELETE | `/api/author/submissions/{submission_id}` | 刪除自己仍在編輯中的稿件，成功回傳 204。 |
| 作者 | POST | `/api/author/submissions/{submission_id}/submit` | 將自己的稿件從編輯中改為審查中。 |
| 編輯 | GET | `/api/editor/submissions` | 列出審查中的稿件，包含作者姓名、類別、標題、編號與狀態。 |
| 編輯 | GET | `/api/editor/submissions/{submission_id}` | 讀取審查中的稿件與正文。 |
| 編輯 | POST | `/api/editor/submissions/{submission_id}/approve` | 將稿件從審查中改為已通過。 |
| 編輯 | POST | `/api/editor/submissions/{submission_id}/return` | 將稿件從審查中退回編輯中，作者可修改後再送出。 |

新增與編輯使用 JSON 請求，類別目前為自由文字。送出、通過需提供稿件編號並以對應角色登入。退回還需提供 JSON，例如 {"revision_note":"請補充結論。"}。編輯審查歷史使用 GET /api/editor/submissions/history 查詢。

```json
{
  "category": "軟體工程",
  "title": "投稿審查系統",
  "content": "這是稿件的正文。"
}
```

## 狀態與錯誤

- `draft`（編輯中）→ 作者送出 → `in_review`（審查中）
- `in_review`（審查中）→ 編輯通過 → `approved`（已通過）
- `in_review`（審查中）→ 編輯退回 → `draft`（編輯中）

已通過的稿件仍會出現在作者清單。稿件的擁有者和狀態由後端決定。

| HTTP 狀態 | 何時回傳 |
| --- | --- |
| 401 | 尚未登入、登入已失效，或 Email／密碼錯誤。 |
| 403 | 帳號角色與路由不符。 |
| 404 | 找不到稿件，或作者嘗試存取別人的稿件。 |
| 409 | 稿件目前狀態不允許該操作。 |
| 422 | 路徑或 JSON 格式有誤，例如標題只含空白。 |

## 設定 PostgreSQL

五個網頁畫面與操作流程見 [PAGE_FLOW.md](PAGE_FLOW.md)。

### 設定你自己的 PostgreSQL

1. 在 pgAdmin 選擇你現有的 PostgreSQL 伺服器和要用的資料庫。記下連線的 Host、Port、資料庫名稱及 PostgreSQL 登入使用者。PostgreSQL 使用者是 pgAdmin 的伺服器連線帳號，例如 `postgres`。
2. 在該資料庫開啟 Query Tool，執行 [schema.sql](schema.sql)。它會在資料庫內建立 `submission_app` schema 和三張表。使用有權建立 schema 的帳號執行。
   - `users` 存帳號、姓名、密碼雜湊與角色。
   - `submissions` 存作者 ID、類別、標題、正文和狀態。
   - `review_history` 存編輯審查結果、當次稿件快照與時間。
3. 在同一個資料庫執行 [seed.sql](seed.sql)，供登入測試使用。這份檔案使用安裝在 `public` 的 `pgcrypto`，需要以有權安裝該擴充功能的帳號執行。

| 演示帳號 | 角色 |
| --- | --- |
| `author1@example.test` | 作者 |
| `author2@example.test` | 作者 |
| `editor@example.test` | 編輯 |

三個帳號的本機演示密碼皆為 `ReviewDemo2026`，以 PostgreSQL 的 `pgcrypto` 雜湊後存入表中。登入時會驗證資料庫內的密碼雜湊。

### 設定連線並啟動

在作業資料夾執行一次以下指令，建立本機連線設定。若已有 `.env`，直接編輯它。

```powershell
Copy-Item .env.example .env
```

用文字編輯器開啟 `.env`，填入 pgAdmin 的主機、連接埠、資料庫名稱、帳號與密碼。若使用 PostgreSQL 密碼檔，可將 `PGPASSWORD` 整行移除。若 PowerShell 已有同名環境變數，程式優先使用環境變數。

```powershell
python -m pip install -r requirements.txt
python db.py
fastapi dev main.py
```

`python db.py` 會顯示實際連到的資料庫及三張表是否存在。若啟動時關閉了自動重載，在 Windows 請改用上面的 `fastapi dev main.py`，它的重載子程序使用 psycopg 非同步連線所需的 Selector 事件迴圈。

FastAPI 啟動時會等待連線池取得連線。每條路由使用 `Depends(getDB)` 取得非同步連線，FastAPI 關閉時會關閉連線池。

### 登入與角色測試

登入沿用課堂範例的 session 寫法，使用 `Form(...)` 接收表單，並透過 `SessionMiddleware` 管理瀏覽器 cookie。請先執行 `python -m pip install -r requirements.txt` 安裝表單與 session 所需套件。

1. 在 Swagger UI 展開 `POST /api/auth/login`，按 **Try it out**，在 `username` 填 `author1@example.test`，在 `password` 填 `ReviewDemo2026`。按 **Execute** 後應收到 `200` 且角色為 `author`。
2. 用 `GET /api/auth/me` 確認登入身分。用作者路由新增稿件，用編輯路由查詢應收到 `403`。
3. 用 `POST /api/auth/logout` 登出，重新查詢作者清單應收到 `401`。登入第二個作者後，嘗試讀取前一個作者的稿件應收到 `404`。
4. 登出後用 `editor@example.test` 登入，便可從待審清單審查已送出的稿件。

本機 session 有八小時有效期。要讓重啟後仍可使用現有 session，可執行 `python -c "import secrets; print(secrets.token_urlsafe(32))"`，把輸出填入 `.env` 的 `SESSION_SECRET`。未設定時，服務每次重啟會產生新的簽章金鑰，測試時請重新登入。
