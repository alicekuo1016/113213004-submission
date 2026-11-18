"use strict";

const { page, id, mode } = document.body.dataset;
const authorApi = "/api/author/submissions";
const editorApi = "/api/editor/submissions";
const statusText = { draft: "編輯中", in_review: "審查中", approved: "已通過" };
const titles = { delete: "刪除", submit: "送審", approve: "通過", return: "退回" };
const byId = (name) => document.getElementById(name);
const roleHome = (role) => role === "editor" ? "/editor/submissions" : "/author/submissions";

async function api(path, options) {
  const response = await fetch(path, options);
  if (response.ok) return response.status === 204 ? null : response.json();

  if (response.status === 401 && page !== "login") {
    navigate("/login", true);
    return null;
  }
  const body = await response.json().catch(() => ({}));
  throw new Error(typeof body.detail === "string" ? body.detail : "無法完成操作，請檢查輸入後再試一次。");
}

function showMessage(text, isError = false) {
  const element = byId("message");
  element.textContent = text;
  element.classList.toggle("error", isError);
  element.hidden = false;
  element.scrollIntoView({ block: "nearest" });
}

function run(button, action) {
  button.disabled = true;
  Promise.resolve().then(action).catch((error) => showMessage(error.message, true))
    .finally(() => { button.disabled = false; });
}

function textNode(tag, text, className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

function link(text, href) {
  const anchor = textNode("a", text, "quiet");
  anchor.href = href;
  return anchor;
}

function actionButton(text, action, className = "quiet") {
  const button = textNode("button", text, className);
  button.type = "button";
  button.addEventListener("click", () => run(button, action));
  return button;
}

async function mutate(path, action, after) {
  if (!window.confirm(`確定要${titles[action]}這篇稿件嗎？`)) return;
  const deleting = action === "delete";
  const result = await api(deleting ? path : `${path}/${action}`, { method: deleting ? "DELETE" : "POST" });
  if (!deleting && !result) return;
  await after();
}

function showRows(items, makeRow, emptyText) {
  byId("rows").replaceChildren(...items.map(makeRow));
  byId("empty").textContent = emptyText;
  byId("empty").hidden = items.length > 0;
}

async function loadAuthor() {
  const items = await api(authorApi);
  if (!items) return;
  for (const status of Object.keys(statusText)) {
    byId(`${status}-count`).textContent = items.filter((item) => item.status === status).length;
  }
  const visible = items;
  showRows(visible, (item) => {
    const row = document.createElement("tr");
    const status = document.createElement("td");
    status.append(textNode("span", statusText[item.status], `badge ${item.status}`));
    const controls = document.createElement("td");
    const actions = textNode("div", "", "actions");
    if (item.status === "draft") {
      const operations = {
        edit: () => link("編輯", `/author/submissions/${item.id}/edit`),
        delete: () => actionButton("刪除", () => authorAction(item.id, "delete"), "danger"),
        submit: () => actionButton("送審", () => authorAction(item.id, "submit")),
      };
      for (const operation of Object.keys(operations)) {
        actions.append(operations[operation]());
      }
    } else {
      actions.textContent = "—";
    }
    controls.append(actions);
    const category = textNode("td", item.category);
    if (item.status === "draft" && item.revision_note) {
      const warning = textNode("span", "⚠ ", "returned-warning");
      warning.title = "稿件已退回，請查看建議修改內容";
      warning.setAttribute("aria-label", "已退回");
      category.prepend(warning);
    }
    const title = document.createElement("td");
    title.append(actionButton(item.title, () => showAuthorDetail(item.id), "title-button"));
    row.append(category, title, status, controls);
    return row;
  }, mode ? "目前沒有編輯中的稿件。" : "目前沒有稿件。");
}

async function authorAction(submissionId, action) {
  await mutate(`${authorApi}/${submissionId}`, action, async () => {
    await loadAuthor();
    showMessage(action === "delete" ? "已刪除稿件。" : "已送出投稿。");
  });
}

async function loadForm() {
  const form = byId("submission-form");
  const fields = form.querySelector("fieldset");
  const path = id ? `${authorApi}/${id}` : authorApi;
  if (id) {
    const item = await api(path);
    if (!item) return;
    if (item.status !== "draft") throw new Error("只有編輯中的稿件可以修改。");
    for (const name of ["category", "title", "content"]) form.elements[name].value = item[name];
  }
  fields.disabled = false;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(event.submitter, async () => {
      const data = Object.fromEntries(new FormData(form));
      const result = await api(path, {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (result) navigate("/author/submissions");
    });
  });
}

function wireDialog(dialogId, closeId) {
  const dialog = byId(dialogId);
  byId(closeId).addEventListener("click", () => dialog.close());
  return dialog;
}

async function showAuthorDetail(submissionId) {
  const item = await api(`${authorApi}/${submissionId}`);
  if (!item) return;
  byId("detail-title").textContent = item.title;
  byId("detail-meta").textContent = `${item.category} · ${statusText[item.status]}`;
  byId("detail-content").textContent = item.content;
  byId("detail-note").textContent = item.revision_note || "目前沒有退回建議。";
  byId("author-detail").showModal();
}

async function loadEditor() {
  const history = mode === "history";
  const items = await api(history ? `${editorApi}/history` : editorApi);
  if (!items) return;
  wireDialog("history-detail", "close-history");
  showRows(items, (item) => {
    const row = document.createElement("tr");
    row.append(textNode("td", item.author_name), textNode("td", item.category), textNode("td", item.title));
    if (history) {
      const result = document.createElement("td");
      result.append(textNode("span", item.decision === "approved" ? "已通過" : "已退回",
        `badge ${item.decision === "approved" ? "approved" : "draft"}`));
      row.append(result, textNode("td", new Date(item.reviewed_at).toLocaleString("zh-TW")));
    }
    const controls = document.createElement("td");
    if (history) {
      controls.append(actionButton("查看紀錄", () => {
        byId("history-title").textContent = item.title;
        byId("history-meta").textContent = `${item.author_name} · ${item.category} · ${new Date(item.reviewed_at).toLocaleString("zh-TW")}`;
        byId("history-content").textContent = item.content;
        byId("history-note").textContent = item.revision_note || "此稿件已通過。";
        byId("history-detail").showModal();
      }));
    } else {
      controls.append(link("查看稿件內容", `/editor/submissions/${item.id}`));
    }
    row.append(controls);
    return row;
  }, history ? "目前沒有審查紀錄。" : "目前沒有待審稿件。");
}

async function loadReview() {
  const path = `${editorApi}/${id}`;
  const item = await api(path);
  if (!item) return;
  byId("article-title").textContent = item.title;
  byId("article-byline").textContent = `${item.author_name} · ${item.category}`;
  byId("article-content").textContent = item.content;
  const approve = byId("approve");
  approve.addEventListener("click", () => run(approve, () =>
    mutate(path, "approve", () => navigate("/editor/submissions?mode=history"))));
  const dialog = wireDialog("return-dialog", "cancel-return");
  byId("return").addEventListener("click", () => {
    byId("return-error").hidden = true;
    dialog.showModal();
  });
  byId("return-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const note = event.currentTarget.elements.revision_note.value.trim();
    if (!note) {
      byId("return-error").textContent = "請填寫建議修改內容。";
      byId("return-error").hidden = false;
      return;
    }
    button.disabled = true;
    try {
      const result = await api(`${path}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision_note: note }),
      });
      if (result) navigate("/editor/submissions?mode=history");
    } catch (error) {
      byId("return-error").textContent = error.message;
      byId("return-error").hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  byId("review").hidden = false;
}

function navigate(url, replace = false) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    replace ? location.replace(url) : location.assign(url);
    return;
  }
  document.body.classList.add("leaving");
  window.setTimeout(() => {
    replace ? location.replace(url) : location.assign(url);
  }, 180);
}

document.addEventListener("click", (event) => {
  const anchor = event.target.closest("a[href]");
  if (!anchor || event.defaultPrevented || event.button !== 0 ||
      event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
      anchor.target || anchor.hasAttribute("download") ||
      anchor.origin !== location.origin || anchor.hash) return;
  event.preventDefault();
  navigate(anchor.href);
});
window.addEventListener("pageshow", () => document.body.classList.remove("leaving"));

async function start() {
  if (page === "login") {
    byId("login").addEventListener("submit", (event) => {
      event.preventDefault();
      run(event.submitter, async () => {
        const user = await api("/api/auth/login", {
          method: "POST", body: new URLSearchParams(new FormData(byId("login"))),
        });
        navigate(roleHome(user.role));
      });
    });
    return;
  }
  const user = await api("/api/auth/me");
  if (!user) return;
  const expectedRole = ["author", "form"].includes(page) ? "author" : "editor";
  if (expectedRole !== user.role) {
    navigate(roleHome(user.role), true);
    return;
  }
  byId("identity").textContent = `${user.name} · ${user.role === "author" ? "作者" : "編輯"}`;
  const logout = byId("logout");
  logout.addEventListener("click", () => run(logout, async () => {
    await api("/api/auth/logout", { method: "POST" });
    navigate("/login", true);
  }));
  if (page === "author") wireDialog("author-detail", "close-detail");
  await { author: loadAuthor, form: loadForm, editor: loadEditor, review: loadReview }[page]();
}

start().catch((error) => {
  if (byId("empty")) byId("empty").hidden = true;
  showMessage(error.message, true);
});
