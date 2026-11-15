export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const rich = (v) =>
  esc(v).replace(
    /\[\[image:(\/assets\/[a-zA-Z0-9_.-]+)\]\]/g,
    '<img class="question-image" src="$1" alt="原题图表" loading="lazy">',
  );
export async function api(path, data) {
  const r = await fetch(
    path,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const b = await r.json();
  if (!r.ok) throw new Error(b.error || "请求失败");
  return b;
}
export const query = (o) =>
  new URLSearchParams(
    Object.entries(o).filter(([, v]) => v !== "" && v !== undefined),
  ).toString();
export const unique = (a) => [...new Set(a.filter(Boolean))];
// Older imports predate paper.subject; their titles identify the exam subject.
export const paperSubject = (paper) =>
  paper.subject ||
  (paper.title.includes("行测")
    ? "行测"
    : paper.title.includes("申论")
      ? "申论"
      : "计算机专业");
export const options = (list, value = "", all = "全部") =>
  `<option value="">${esc(all)}</option>` +
  list
    .map((x) => {
      const [v, t] = Array.isArray(x) ? x : [x, x];
      return `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(t)}</option>`;
    })
    .join("");
export const duration = (ms = 0) => {
  const s = Math.round(ms / 1000);
  return s < 60
    ? `${s}秒`
    : s < 3600
      ? `${Math.floor(s / 60)}分${s % 60}秒`
      : `${Math.floor(s / 3600)}小时${Math.floor((s % 3600) / 60)}分`;
};
export const pct = (v) => (v == null ? "—" : `${v}%`);
export const num = (n) => Number(n || 0).toLocaleString("zh-CN");
const TYPE_LABELS = { single: "单选题", multiple: "多选题", essay: "申论题" };
export const typeLabel = (type) => TYPE_LABELS[type] || "单选题";
// Category and topic selects depend on the chosen module; library and stats share this cascade.
export function cascadeFacets(root, facets, state) {
  const inModule = facets.filter((f) => !state.module || f.module === state.module);
  $("[name=category]", root).innerHTML = options(
    unique(inModule.map((f) => f.category)),
    state.category,
  );
  $("[name=topic]", root).innerHTML = options(
    unique(
      inModule
        .filter((f) => !state.category || f.category === state.category)
        .map((f) => f.topic),
    ),
    state.topic,
  );
}
// Persist free text after the user pauses typing; returns a flush function for blur/leave.
export function debounced(fn, wait = 800) {
  let timer;
  const run = () => {
    clearTimeout(timer);
    timer = null;
    return fn();
  };
  return {
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(run, wait);
    },
    flush() {
      return timer ? run() : undefined;
    },
  };
}
let timer;
export function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(timer);
  timer = setTimeout(() => $("#toast").classList.remove("show"), 3500);
}
export function handle(fn) {
  return async (event) => {
    try {
      await fn(event);
    } catch (e) {
      toast(e.message);
      console.error(e);
    }
  };
}
export function heading(title, description, action = "") {
  return `<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action}</div>`;
}
export function sourceLink(q) {
  if (q.source_page > 0)
    return `<a class="text-link" target="_blank" rel="noopener" href="/sources/${encodeURIComponent(q.source)}#page=${q.source_page}">原卷 · 第${q.source_page}页 ↗</a>`;
  if (/^https?:\/\//.test(q.source_url))
    return `<a class="text-link" href="${esc(q.source_url)}" target="_blank" rel="noopener">查看来源 ↗</a>`;
  return "";
}
let starting = false;
export async function startPractice(data) {
  if (starting) return;
  starting = true;
  try {
    const s = await api("/api/session", data);
    location.hash = `practice/${s.id}`;
  } finally {
    starting = false;
  }
}
export function modal(html) {
  const d = $("#dialog");
  d.innerHTML = `<button class="dialog-close secondary" aria-label="关闭">×</button>${html}`;
  $(".dialog-close", d).onclick = () => d.close();
  d.showModal();
  return d;
}
export function metric(s) {
  return `<div class="metrics"><div><span>刷题次数</span><strong>${s.count}</strong><small>覆盖 ${s.unique} 道题</small></div><div><span>正确率</span><strong>${pct(s.accuracy)}</strong><small>对 ${s.correct} · 错 ${s.wrong}</small></div><div><span>平均用时</span><strong>${duration(s.avg_ms)}</strong><small>按有效作答计时</small></div><div><span>累计用时</span><strong>${duration(s.elapsed_ms)}</strong><small>${s.graded} 次已判分</small></div></div>`;
}
