import { $, esc, api } from "./ui.js";
import { icon } from "./icons.js";
import { renderHome } from "./home.js";
import { renderStats } from "./stats.js";
import { renderLibrary } from "./library.js";
import { renderPractice, leavePractice } from "./practice.js";
import { renderData } from "./data.js";
let routeToken = 0;
const names = {
  home: "学习中心",
  library: "我的题库",
  review: "错题与收藏",
  stats: "学习统计",
  data: "数据管理",
  practice: "专注练习",
};
async function route() {
  const token = ++routeToken;
  leavePractice();
  const [path, search = ""] = location.hash.slice(1).split("?");
  const [view = "home", id] = path.split("/");
  document.body.classList.toggle("is-practice", view === "practice");
  if (view !== "practice") document.body.classList.remove("focus-mode");
  document.querySelectorAll("nav a").forEach((a) => {
    const active = a.dataset.route === (view || "home");
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("#route-name").textContent = names[view] || names.home;
  document.title = `${names[view] || names.home} · 知序`;
  const app = $("#app");
  const root = document.createElement("div");
  root.className = "route-view";
  app.replaceChildren(root);
  root.innerHTML =
    '<div class="loading-state" role="status"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-panel"></div><p>正在载入学习档案…</p></div>';
  try {
    // A session already contains everything the practice screen needs.
    const meta = view === "practice" ? null : await api("/api/meta");
    if (token !== routeToken) return;
    const params = Object.fromEntries(new URLSearchParams(search));
    if (view === "stats") await renderStats(root, meta);
    else if (view === "library" || view === "review")
      await renderLibrary(root, meta, view, params);
    else if (view === "practice") await renderPractice(root, id);
    else if (view === "data") await renderData(root, meta);
    else await renderHome(root, meta);
  } catch (e) {
    if (token !== routeToken) return;
    root.innerHTML = `<div class="card empty"><h2>暂时无法载入</h2><p>${esc(e.message)}。请确认本地服务已启动后重试。</p><button class="primary" id="retry-load">重新载入</button></div>`;
    $("#retry-load").onclick = route;
    console.error(e);
  }
  window.scrollTo(0, 0);
}
$("#today").textContent = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "long",
  day: "numeric",
  weekday: "short",
}).format(new Date());
document
  .querySelectorAll("[data-icon]")
  .forEach((a) => a.insertAdjacentHTML("afterbegin", icon(a.dataset.icon)));
$(".skip-link").onclick = (event) => {
  event.preventDefault();
  $("#app").focus();
};
window.addEventListener("hashchange", route);
route();
