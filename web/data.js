import { $, esc, api, heading, toast, handle } from "./ui.js";
import { icon } from "./icons.js";
export async function renderData(root, meta) {
  let pending = null,
    page = 1,
    sourceQuery = "";
  root.innerHTML =
    heading(
      "",
      "题库与学习档案",
      "导入新题、核验来源、定期备份。所有内容都留在这台电脑。",
    ) +
    `
    <div class="data-grid"><section class="card import-card"><h2>导入题库</h2><p>上传 JSON 文件，先检查题目与重复项，再确认保存。</p><label class="upload-area">${icon("database")}<strong>选择 JSON 题库文件</strong><small>单次最多 30 MB · 按题目 ID 去重</small><input id="import-file" type="file" accept=".json,application/json" aria-describedby="import-help"></label><div id="import-preview" aria-live="polite"></div><p class="caption" id="import-help">支持本工具导出的完整 JSON、标准题目 JSON 和 fenbi-crawler 题目导出。统计 CSV 缺少题干和答案，不能用作题库。</p></section>
    <section class="card"><h2>备份学习档案</h2><p>数据库包含题目、作答、收藏和笔记。建议在导入新题库或更换电脑前保留一份。</p><a class="button primary wide" href="/api/backup" download>${icon("database")}下载数据库备份</a><a class="button secondary wide" href="/api/export" download>导出完整题库 JSON</a><div class="notice">数据库备份不含题图和原卷 PDF。完整迁移请停止服务后复制 data 中的题库、原题与图片；不要分享 session.private.json 等登录态文件。</div></section></div>
    <section class="card source-card"><div class="card-heading"><h2>题库来源</h2><a class="text-link" href="#library?quality=review">检查 ${meta.counts.review || 0} 道待核验题 ${icon("arrow")}</a></div><div class="source-tools"><label>查找试卷<input id="source-search" type="search" placeholder="输入试卷名称或年份"></label><span class="caption" id="source-count" aria-live="polite"></span></div><div class="table-scroll" id="sources-table"></div><div class="pagination" id="sources-pages"></div></section>
    <section class="card help-card"><h2>扩充与维护题库</h2><ol><li>从粉笔采集：运行 <code>tools/capture_fenbi_all.ps1</code>，按终端提示登录。采集只读取目录与题目，不交卷。</li><li>原始响应会保存到本地，使用 <code>scripts/import_fenbi_api.py</code> 整理入库。已有作答、收藏、笔记与人工修改会保留。</li><li>其他来源的 JSON 可以在上方导入；PDF 需先适配解析规则，不支持直接可靠导入任意版式。</li></ol><p class="caption">缺少答案、图片或原文损坏的题目保留为待核验，不猜测补全。请在题目详情中结合原卷编辑、核验。</p></section>`;
  function sources() {
    const papers = meta.papers.filter((p) =>
      `${p.title} ${p.year || ""}`
        .toLowerCase()
        .includes(sourceQuery.toLowerCase()),
    );
    const pages = Math.max(1, Math.ceil(papers.length / 15));
    page = Math.min(page, pages);
    $("#source-count", root).textContent =
      `共 ${papers.length.toLocaleString("zh-CN")} 套试卷`;
    $("#sources-table", root).innerHTML =
      `<table><thead><tr><th scope="col">题库来源</th><th scope="col">原题数</th><th scope="col">可练习</th><th scope="col">待核验</th></tr></thead><tbody>${
        papers
          .slice((page - 1) * 15, page * 15)
          .map(
            (p) =>
              `<tr><th scope="row"><a class="text-link" href="#library?paper_id=${encodeURIComponent(p.id)}">${esc(p.title)}</a></th><td>${p.total}</td><td class="teal">${p.ready || 0}</td><td>${p.total - p.ready}</td></tr>`,
          )
          .join("") ||
        '<tr><td colspan="4" class="empty">没有找到这套试卷。试试年份或更短的关键词。</td></tr>'
      }</tbody></table>`;
    $("#sources-pages", root).innerHTML =
      `<span>第 ${page} / ${pages} 页 · 每页 15 套</span><button class="secondary" id="sources-prev" ${page <= 1 ? "disabled" : ""}>上一页</button><button class="secondary" id="sources-next" ${page >= pages ? "disabled" : ""}>下一页</button>`;
    $("#sources-prev", root).onclick = () => {
      page--;
      sources();
    };
    $("#sources-next", root).onclick = () => {
      page++;
      sources();
    };
  }
  $("#source-search", root).oninput = (e) => {
    sourceQuery = e.target.value.trim();
    page = 1;
    sources();
  };
  sources();
  $("#import-file", root).onchange = handle(async (e) => {
    const file = e.target.files[0];
    pending = null;
    if (!file) return;
    $("#import-preview", root).innerHTML =
      '<p class="caption" role="status">正在检查文件…</p>';
    try {
      if (file.size > 30_000_000)
        throw new Error("文件超过 30 MB，请拆分后再导入");
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error("文件不是有效的 JSON，请检查文件内容后重试");
      }
      const p = await api("/api/import", { data, preview: true });
      pending = data;
      $("#import-preview", root).innerHTML =
        `<div class="notice"><strong>${esc(file.name)}</strong><p>${p.total} 道题 · ${p.review} 道待核验 · ${p.duplicates} 道重复将跳过</p><p>${p.papers.map(esc).join(" / ")}</p><button class="primary" id="confirm-import" ${p.total === p.duplicates ? "disabled" : ""}>确认导入 ${p.total - p.duplicates} 道新题</button></div>`;
      $("#confirm-import", root).onclick = handle(async (e) => {
        e.target.disabled = true;
        try {
          const r = await api("/api/import", { data: pending });
          toast(`已导入 ${r.added} 道题`);
          await renderData(root, await api("/api/meta"));
        } finally {
          if (e.target.isConnected) e.target.disabled = false;
        }
      });
    } catch (error) {
      $("#import-preview", root).innerHTML =
        `<div class="notice" role="alert">${esc(error.message)}。请重新选择文件。</div>`;
    }
  });
}
