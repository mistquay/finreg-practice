import {
  $,
  $$,
  esc,
  rich,
  api,
  query,
  options,
  unique,
  heading,
  sourceLink,
  modal,
  toast,
  startPractice,
  handle,
} from "./ui.js";
export async function questionDetail(id) {
  const q = await api("/api/question/" + encodeURIComponent(id) + "?answer=1");
  const d = modal(
    `<div class="eyebrow">${esc(q.source)} · 第${q.number}题</div><h2>${q.type === "multiple" ? "多选题" : "单选题"} <span class="badge ${q.quality === "review" ? "warn" : ""}">${q.quality === "review" ? "待核验" : "可练习"}</span></h2>${q.issues.length ? `<div class="notice">${q.issues.map(esc).join("；")}</div>` : ""}${q.material ? `<details class="material" open><summary>阅读材料</summary><div class="prose">${rich(q.material)}</div></details>` : ""}<div class="prose question-stem">${rich(q.stem)}</div><div class="detail-options">${Object.entries(
      q.options,
    )
      .map(([k, v]) => `<p><b>${k}.</b> ${rich(v)}</p>`)
      .join(
        "",
      )}</div><div class="answer-box"><strong>来源参考答案：${q.answer.join("、") || "未提供"}</strong><div class="prose">${rich(q.explanation) || "来源暂未提供文字解析。请结合原卷或课程核对。"}</div></div><p>${sourceLink(q)}</p><div class="toolbar"><button id="detail-favorite" class="secondary">${q.favorite ? "取消收藏" : "收藏题目"}</button><button id="detail-edit" class="secondary">编辑 / 核验</button></div><label class="field">我的笔记<textarea id="detail-note" rows="3">${esc(q.note)}</textarea></label><button id="save-note" class="primary">保存笔记</button>${q.provider ? `<details class="raw"><summary>来源字段 · ${esc(q.provider)} / ${esc(q.external_id)} · 难度 ${q.difficulty ?? "未提供"}</summary><p class="caption">完整原始业务字段保存在本地，未用到的字段也会保留。${q.raw?.platform_statistics?.totalCount != null ? `粉笔平台作答量 ${q.raw.platform_statistics.totalCount} 次，平台正确率 ${Number(q.raw.platform_statistics.correctRatio).toFixed(1)}%（采集时快照，与个人统计分开）。` : ""}</p><pre>${esc(JSON.stringify(q.raw, null, 2))}</pre></details>` : ""}`,
  );
  $("#detail-favorite", d).onclick = handle(async (e) => {
    const v = await api("/api/mark/" + id, { favorite: !q.favorite });
    q.favorite = v.favorite;
    e.target.textContent = q.favorite ? "取消收藏" : "收藏题目";
    toast("已保存");
  });
  $("#save-note", d).onclick = handle(async () => {
    await api("/api/mark/" + id, { note: $("#detail-note", d).value });
    toast("笔记已保存");
  });
  $("#detail-edit", d).onclick = () => edit(q, d);
}
function edit(q, d) {
  d.innerHTML = `<button class="dialog-close secondary" aria-label="关闭">×</button><h2>编辑与核验题目</h2><p class="caption">核验请以原卷为依据。保存会更新题目；历史作答仍保留当时的答案快照与判分。</p><p>${sourceLink(q)}</p><form id="edit-form"><label class="field">题干<textarea name="stem" rows="4" required>${esc(q.stem)}</textarea></label><label class="field">选项（每行 A=选项内容）<textarea name="options" rows="7">${esc(
    Object.entries(q.options)
      .map(([k, v]) => k + "=" + v.replaceAll("\n", " "))
      .join("\n"),
  )}</textarea></label><div class="form-grid"><label>参考答案<input name="answer" value="${q.answer.join("")}" placeholder="例如 A 或 ACD"></label><label>题型<select name="type"><option value="single" ${q.type === "single" ? "selected" : ""}>单选</option><option value="multiple" ${q.type === "multiple" ? "selected" : ""}>多选</option></select></label><label>核验状态<select name="quality"><option value="review" ${q.quality === "review" ? "selected" : ""}>待核验</option><option value="ready" ${q.quality === "ready" ? "selected" : ""}>可练习（已核验）</option></select></label><label>模块<input name="module" value="${esc(q.module)}" required></label><label>小类<input name="category" value="${esc(q.category)}" required></label><label>考点<input name="topic" value="${esc(q.topic)}" required></label></div><label class="field">标签（逗号分隔）<input name="tags" value="${esc(q.tags.join("，"))}"></label><label class="field">阅读材料<textarea name="material" rows="4">${esc(q.material)}</textarea></label><label class="field">解析<textarea name="explanation" rows="5">${esc(q.explanation)}</textarea></label><button class="primary" type="submit">保存修改</button></form>`;
  $(".dialog-close", d).onclick = () => d.close();
  $("#edit-form", d).onsubmit = handle(async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const lines = data.options.split("\n").filter((x) => x.trim());
    const opts = {};
    for (const line of lines) {
      const m = line.match(/^([A-H])\s*=\s*(.*)$/);
      if (!m) throw new Error("选项格式应为 A=内容，每行一个");
      if (opts[m[1]]) throw new Error("选项标签重复");
      opts[m[1]] = m[2];
    }
    data.options = opts;
    if (!/^[A-H,，\s]*$/.test(data.answer.toUpperCase()))
      throw new Error("答案只能填写 A-H");
    data.answer = unique(data.answer.toUpperCase().match(/[A-H]/g) || []);
    data.tags = data.tags
      .split(/[,，]/)
      .map((x) => x.trim())
      .filter(Boolean);
    data.issues = data.quality === "ready" ? [] : q.issues;
    await api("/api/edit/" + q.id, data);
    toast("题目已更新");
    d.close();
    await questionDetail(q.id);
  });
}
export async function renderLibrary(root, meta, view, params) {
  const state = {
    page: 1,
    module: "",
    category: "",
    topic: "",
    paper_id: "",
    quality: "",
    type: "",
    tag: "",
    search: "",
    ...params,
  };
  let scope = view === "review" ? "wrong" : "all";
  let seq = 0;
  root.innerHTML =
    heading(
      view === "review" ? "REVIEW & REFLECT" : "YOUR QUESTION LIBRARY",
      view === "review" ? "把错题，变成得分题。" : "我的题库",
      `${meta.counts.total} 道题已保存 · ${meta.counts.ready} 道可练习 · ${meta.counts.review} 道待核验`,
    ) +
    `<section class="card filter-bar" id="library-filters"><label>模块<select name="module">${options(unique(meta.facets.map((f) => f.module)), state.module)}</select></label><label>小类<select name="category"></select></label><label>试卷<select name="paper_id">${options(
      meta.papers.map((p) => [p.id, p.title]),
      state.paper_id,
    )}</select></label><label>题型<select name="type">${options(
      [
        ["single", "单选"],
        ["multiple", "多选"],
      ],
      state.type,
    )}</select></label><label>核验状态<select name="quality">${options(
      [
        ["ready", "可练习"],
        ["review", "待核验"],
      ],
      state.quality,
    )}</select></label><label class="search">搜索题干 / 解析<input name="search" placeholder="输入知识点或关键词" value="${esc(state.search)}"></label></section><div class="library-toolbar"><div class="segmented">${[
      ["all", "全部"],
      ["unseen", "未做"],
      ["wrong", "错题"],
      ["favorite", "收藏"],
    ]
      .map(
        ([k, t]) =>
          `<button data-scope="${k}" class="${scope === k ? "selected" : ""}">${t}</button>`,
      )
      .join(
        "",
      )}</div><div class="toolbar"><label class="inline-field">题量 <select id="practice-count"><option>10</option><option selected>20</option><option>30</option><option>50</option></select></label><button id="practice-current" class="primary">练习当前筛选</button></div></div><p class="caption">错题按最近一次作答判断；核验状态以题目结构完整性为依据，原题答案仍需结合来源辨别。分类可在题目详情中调整。</p><section id="questions-list" class="question-list"></section><div id="pagination" class="pagination"></div>`;
  function filters() {
    return { ...state, ...(scope !== "all" ? { [scope]: "1" } : {}) };
  }
  function facets() {
    $("[name=category]", root).innerHTML = options(
      unique(
        meta.facets
          .filter((f) => !state.module || f.module === state.module)
          .map((f) => f.category),
      ),
      state.category,
    );
  }
  async function load() {
    const n = ++seq;
    const d = await api("/api/questions?" + query(filters()));
    if (n !== seq) return;
    $("#questions-list", root).innerHTML = d.items.length
      ? d.items
          .map(
            (q) =>
              `<article class="card question-preview"><div class="question-meta"><span class="badge">${esc(q.module)}</span><span>${esc(q.category)}</span><span class="muted">${q.year || ""} · 第${q.number}题 · ${q.type === "multiple" ? "多选" : "单选"}</span>${q.quality === "review" ? '<span class="badge warn">待核验</span>' : ""}${q.last_correct === 0 ? '<span class="badge wrong">错题</span>' : ""}</div><button class="question-title" data-id="${esc(q.id)}">${esc(q.stem.replace(/\[\[image:[^\]]+\]\]/g, "[题图]").slice(0, 220))}</button><div class="question-bottom"><span>${esc(q.source)}</span><button class="quiet favorite" data-favorite="${esc(q.id)}" data-value="${q.favorite}">${q.favorite ? "★ 已收藏" : "☆ 收藏"}</button></div></article>`,
          )
          .join("")
      : `<div class="card empty"><h2>${scope === "wrong" ? "暂时没有待复习错题" : "没有符合条件的题目"}</h2><p>调整筛选，或开始一次新的练习。</p></div>`;
    $("#pagination", root).innerHTML =
      `<span>共 ${d.total} 道 · 第 ${d.page} / ${d.pages || 1} 页</span><button class="secondary" id="prev-page" ${d.page <= 1 ? "disabled" : ""}>上一页</button><button class="secondary" id="next-page" ${d.page >= d.pages ? "disabled" : ""}>下一页</button>`;
    $$("[data-id]", root).forEach(
      (b) => (b.onclick = handle(() => questionDetail(b.dataset.id))),
    );
    $$("[data-favorite]", root).forEach(
      (b) =>
        (b.onclick = handle(async () => {
          await api("/api/mark/" + b.dataset.favorite, {
            favorite: b.dataset.value !== "1",
          });
          await load();
        })),
    );
    $("#prev-page", root).onclick = handle(async () => {
      state.page--;
      await load();
    });
    $("#next-page", root).onclick = handle(async () => {
      state.page++;
      await load();
    });
  }
  facets();
  $$("#library-filters select", root).forEach(
    (e) =>
      (e.onchange = handle(async () => {
        state[e.name] = e.value;
        state.page = 1;
        if (e.name === "module") {
          state.category = "";
          facets();
        }
        await load();
      })),
  );
  let debounce;
  $("[name=search]", root).oninput = (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(
      handle(async () => {
        state.search = e.target.value;
        state.page = 1;
        await load();
      }),
      250,
    );
  };
  $$("[data-scope]", root).forEach(
    (b) =>
      (b.onclick = handle(async () => {
        scope = b.dataset.scope;
        state.page = 1;
        $$("[data-scope]", root).forEach((x) =>
          x.classList.toggle("selected", x === b),
        );
        await load();
      })),
  );
  $("#practice-current", root).onclick = handle(() =>
    startPractice({
      filters: filters(),
      mode: scope === "wrong" ? "review" : "practice",
      count: Number($("#practice-count", root).value),
      title:
        scope === "wrong" ? "错题复习" : `${state.module || "综合"}专项练习`,
    }),
  );
  await load();
}
