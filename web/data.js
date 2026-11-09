import { $, esc, api, heading, toast, handle } from "./ui.js";
export async function renderData(root, meta) {
  let pending = null;
  root.innerHTML =
    heading(
      "YOUR DATA, YOUR PACE",
      "题库与学习档案",
      "导入新题、核验来源、保存备份。所有内容都留在这台电脑。",
    ) +
    `<div class="data-grid"><section class="card import-card"><div class="eyebrow">ADD TO YOUR LIBRARY</div><h2>导入新的题目</h2><p>支持本工具导出的完整JSON、标准题目JSON，以及 fenbi-crawler 的题目导出。先预览，再保存。</p><label class="upload-area"><span class="upload-icon">＋</span><strong>选择 JSON 题库文件</strong><small>单次最多30MB · 按题目ID去重</small><input id="import-file" type="file" accept=".json,application/json"></label><div id="import-preview"></div><p class="caption">练习统计CSV只有作答记录，缺少题干和答案，不能直接导入为题库。粉笔原始接口数据需先运行随项目提供的整理脚本。</p></section><section class="card"><div class="eyebrow">KEEP A COPY</div><h2>保存你的学习成果</h2><p>完整数据库备份包含题目、作答、错题、收藏、笔记及题目原始字段；图片、原卷和接口归档保存在项目 data 文件夹。</p><a class="button primary wide" href="/api/backup" download>下载数据库备份</a><a class="button secondary wide" href="/api/export" download>导出完整题库 JSON</a><div class="notice">完整迁移：停止服务后复制整个项目 data 文件夹。仅数据库文件不包含原卷PDF和本地图片。</div></section></div><section class="card source-card"><div class="card-heading"><h2>来源与核验</h2><a class="text-link" href="#library?quality=review">查看 ${meta.counts.review} 道待核验题 →</a></div><div class="table-scroll"><table><thead><tr><th>题库来源</th><th>原题数</th><th>可练习</th><th>待核验</th></tr></thead><tbody>${meta.papers.map((p) => `<tr><th>${esc(p.title)}</th><td>${p.total}</td><td class="teal">${p.ready}</td><td>${p.total - p.ready}</td></tr>`).join("")}</tbody></table></div></section><section class="card help-card"><h2>后续扩充题库</h2><ol><li>粉笔采集：运行项目里的 <code>tools/capture_fenbi.ps1</code>，在打开的浏览器中登录。采集脚本只读取试卷与题目详情，不交卷。</li><li>每次采集保留原始试卷、题目字段与章节结构，再运行 <code>scripts/import_fenbi.py</code> 下载题图和转换。</li><li>通过本页导入生成的 <code>data/fenbi-bank.json</code>；已有题目按ID跳过，人工核验结果保留。</li><li>本地六套PDF已按专用解析器导入。其他版式的PDF需先检查解析规则，不能保证随意上传即可可靠识别。</li></ol><p class="caption">不生成猜测答案。无答案、图题缺图或原卷损坏的题目进入待核验；核验后可以在详情页改为“可练习”。题目详情可查看已保存的原始接口字段。</p></section>`;
  $("#import-file", root).onchange = handle(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 30_000_000) throw new Error("文件不能超过30MB");
    pending = JSON.parse(await file.text());
    const p = await api("/api/import", { data: pending, preview: true });
    $("#import-preview", root).innerHTML =
      `<div class="notice"><strong>${esc(file.name)}</strong><p>${p.total} 道题 · ${p.review} 道待核验 · ${p.duplicates} 道重复将跳过</p><p>${p.papers.map(esc).join(" / ")}</p><button class="primary" id="confirm-import">确认导入 ${p.total - p.duplicates} 道新题</button></div>`;
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
  });
}
