"use strict";

const { page, id, mode } = document.body.dataset;
const authorApi = "/api/author/submissions";
const editorApi = "/api/editor/submissions";
const statusText = { draft: "編輯中", in_review: "審查中", approved: "已通過" };
const titles = { delete: "刪除", submit: "送審", approve: "通過", return: "退回" };
const byId = (name) => document.getElementById(name);
const roleHome = (role) => role === "editor" ? "/editor/submissions" : "/author/submissions";
const toastStorageKey = "submission-pending-toast";

function toast(text, isError = false) {
  const element = textNode("div", "", isError ? "toast toast-error" : "toast");
  element.append(textNode("span", text));
  const close = textNode("button", "×", "toast-close");
  close.type = "button";
  close.setAttribute("aria-label", "關閉通知");
  const timer = window.setTimeout(() => element.remove(), 6000);
  close.addEventListener("click", () => {
    window.clearTimeout(timer);
    element.remove();
  });
  element.append(close);
  byId("toast-region").append(element);
}

function navigateWithToast(url, text) {
  sessionStorage.setItem(toastStorageKey, text);
  navigate(url);
}

async function api(path, options) {
  const headers = new Headers(options?.headers);
  headers.set("X-Tab-Session", sessionStorage.getItem("submission-tab-session") || "");
  const response = await fetch(path, { ...options, headers });
  if (response.ok) {
    if (path === "/api/auth/login") {
      const token = response.headers.get("X-Tab-Session");
      if (!token) throw new Error("登入失敗，請重新登入。");
      sessionStorage.setItem("submission-tab-session", token);
      sessionStorage.removeItem(toastStorageKey);
    }
    if (path === "/api/auth/logout") sessionStorage.removeItem("submission-tab-session");
    return response.status === 204 ? null : response.json();
  }

  if (response.status === 401 && page !== "login") {
    sessionStorage.removeItem("submission-tab-session");
    navigate("/login", true);
    throw new Error("登入已失效，請重新登入。");
  }
  const body = await response.json().catch(() => ({}));
  throw new Error(typeof body.detail === "string" ? body.detail : "無法完成操作，請檢查輸入後再試一次。");
}

function showMessage(text, isError = false) {
  toast(text, isError);
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
  renderNotifications(items);
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
    toast(action === "delete" ? "已刪除稿件。" : "已送出投稿。");
    await loadAuthor();
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
      if (result) navigateWithToast("/author/submissions", id ? "稿件修改已儲存。" : "已新增稿件。");
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
    mutate(path, "approve", () => navigateWithToast("/editor/submissions?mode=history", "稿件已通過，審查紀錄已保存。"))));
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
      if (result) navigateWithToast("/editor/submissions?mode=history", "稿件已退回，修改建議已傳給作者。");
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

function renderNotifications(items) {
  if (!byId("notification-bell")) return;
  const returned = items.filter((item) => item.status === "draft" && item.revision_note);
  const badge = byId("notification-count");
  badge.textContent = returned.length;
  badge.hidden = returned.length === 0;
  byId("notification-bell").setAttribute("aria-label", `退回稿件通知，${returned.length} 篇待修改`);
  const links = returned.map((item) => {
    const anchor = document.createElement("a");
    anchor.className = "notification-item";
    anchor.href = `/author/submissions?detail=${item.id}`;
    anchor.append(textNode("strong", item.title), textNode("span", item.revision_note));
    return anchor;
  });
  byId("notification-items").replaceChildren(...(links.length ? links : [textNode("p", "目前沒有待修改的退回稿件。", "muted")]));
}

async function setupNotifications() {
  const bell = byId("notification-bell");
  if (!bell) return;
  const panel = byId("notification-panel");
  function close() {
    panel.hidden = true;
    bell.setAttribute("aria-expanded", "false");
  }
  bell.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    bell.setAttribute("aria-expanded", String(!panel.hidden));
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".notification-wrap")) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      close();
      bell.focus();
    }
  });
  let refreshing = false;
  async function refresh() {
    if (refreshing || document.hidden) return;
    refreshing = true;
    try {
      const items = await api(authorApi);
      if (items) renderNotifications(items);
    } catch {
      // 暫時無法連線時保留現有通知，稍後再次查詢。
    } finally {
      refreshing = false;
    }
  }
  if (page !== "author") await refresh();
  window.setInterval(refresh, 30000);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
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
  const pendingToast = sessionStorage.getItem(toastStorageKey);
  sessionStorage.removeItem(toastStorageKey);
  if (pendingToast) toast(pendingToast);
  const logout = byId("logout");
  logout.addEventListener("click", () => run(logout, async () => {
    await api("/api/auth/logout", { method: "POST" });
    navigate("/login", true);
  }));
  if (page === "author") wireDialog("author-detail", "close-detail");
  await { author: loadAuthor, form: loadForm, editor: loadEditor, review: loadReview }[page]();
  await setupNotifications();
  if (page === "author") {
    const detailId = new URLSearchParams(location.search).get("detail");
    if (detailId && /^[1-9]\d*$/.test(detailId)) await showAuthorDetail(detailId);
  }
}

start().catch((error) => {
  if (byId("empty")) byId("empty").hidden = true;
  showMessage(error.message, true);
});
