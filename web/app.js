import { $, $$, esc, api, account, isAdmin } from "./ui.js";
import { icon } from "./icons.js";
import { renderHome } from "./home.js";
import { renderStats } from "./stats.js";
import { renderLibrary } from "./library.js";
import { renderPractice, leavePractice } from "./practice.js";
import { renderData } from "./data.js";
import { renderAuth, openAccount } from "./auth.js";
import { renderUsers } from "./users.js";
let routeToken = 0;
const names = {
  home: "学习中心",
  library: "我的题库",
  review: "错题与收藏",
  stats: "学习统计",
  data: "数据管理",
  users: "用户管理",
  practice: "专注练习",
};
const ADMIN_VIEWS = ["data", "users"];

function showAccount() {
  const user = account.user;
  $("#account-button").hidden = !user;
  $("#account-name").textContent = user?.username || "";
  $("#account-initial").textContent = [...(user?.username || "")][0] || "";
  $$("[data-admin]").forEach((a) => (a.hidden = !isAdmin()));
}

async function route() {
  const token = ++routeToken;
  leavePractice();
  const [path, search = ""] = location.hash.slice(1).split("?");
  let [view = "home", id] = path.split("/");
  const app = $("#app");
  const root = document.createElement("div");
  root.className = "route-view";
  app.replaceChildren(root);
  if (!account.user) {
    let info;
    try {
      info = await api("/api/auth/me");
    } catch (e) {
      if (token !== routeToken) return;
      root.innerHTML = `<div class="card empty"><h2>暂时无法连接服务</h2><p>${esc(e.message)}。请确认服务已启动后重试。</p><button class="primary" id="retry-load">重新载入</button></div>`;
      $("#retry-load").onclick = route;
      return;
    }
    if (token !== routeToken) return;
    account.user = info.user;
    showAccount();
    if (!account.user) {
      document.body.classList.add("is-auth");
      document.body.classList.remove("is-practice", "focus-mode");
      document.title = "登录 · 知序";
      return renderAuth(root, info.setup, route);
    }
  }
  document.body.classList.remove("is-auth");
  if (ADMIN_VIEWS.includes(view) && !isAdmin()) view = "home";
  document.body.classList.toggle("is-practice", view === "practice");
  if (view !== "practice") document.body.classList.remove("focus-mode");
  $$("nav a").forEach((a) => {
    const active = a.dataset.route === view;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("#route-name").textContent = names[view] || names.home;
  document.title = `${names[view] || names.home} · 知序`;
  root.innerHTML =
    '<div class="loading-state" role="status"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-panel"></div><p>正在载入学习档案…</p></div>';
  try {
    // A session already contains everything the practice screen needs.
    const meta =
      view === "practice" || view === "users" ? null : await api("/api/meta");
    if (token !== routeToken) return;
    const params = Object.fromEntries(new URLSearchParams(search));
    if (view === "stats") await renderStats(root, meta);
    else if (view === "library" || view === "review")
      await renderLibrary(root, meta, view, params);
    else if (view === "practice") await renderPractice(root, id);
    else if (view === "data") await renderData(root, meta);
    else if (view === "users") await renderUsers(root);
    else await renderHome(root, meta);
  } catch (e) {
    // A 401 already sent the app back to the sign-in screen.
    if (token !== routeToken || e.status === 401) return;
    root.innerHTML = `<div class="card empty"><h2>暂时无法载入</h2><p>${esc(e.message)}。请确认服务已启动后重试。</p><button class="primary" id="retry-load">重新载入</button></div>`;
    $("#retry-load").onclick = route;
    console.error(e);
  }
  window.scrollTo(0, 0);
}

function signedOut() {
  if (!account.user) return;
  account.user = null;
  showAccount();
  route();
}

$("#today").textContent = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "long",
  day: "numeric",
  weekday: "short",
}).format(new Date());
$$("[data-icon]").forEach((a) =>
  a.insertAdjacentHTML("afterbegin", icon(a.dataset.icon)),
);
$(".skip-link").onclick = (event) => {
  event.preventDefault();
  $("#app").focus();
};
$("#account-button").onclick = () => openAccount(signedOut);
window.addEventListener("finreg:signed-out", signedOut);
window.addEventListener("hashchange", route);
route();
