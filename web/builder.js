// "自选专项" drawer: pick subjects (one or several), optionally a category, then mode and count.
import { $, $$, esc, num, toast, handle, startPractice } from "./ui.js";
import { icon } from "./icons.js";

export const SUBJECTS = ["计算机专业", "经济金融基础", "英语", "行测", "申论"];
export const SUBJECT_ICONS = {
  计算机专业: "monitor",
  经济金融基础: "chart",
  英语: "globe",
  行测: "book",
  申论: "pen",
};
const DESCRIPTIONS = {
  计算机专业: "沿着知识点，打牢专业基础",
  经济金融基础: "理解概念，也掌握应用",
  英语: "在真题中积累阅读经验",
  行测: "练习解题方法与作答速度",
  申论: "阅读材料，组织有依据的表达",
};
const PREFS = "finreg-builder";

export function readyBy(facets, key, filter = () => true) {
  const counts = {};
  facets.filter(filter).forEach((f) => {
    counts[f[key]] = (counts[f[key]] || 0) + f.ready;
  });
  return counts;
}
export function subjectOrder(list) {
  const rank = (m) => (SUBJECTS.includes(m) ? SUBJECTS.indexOf(m) : SUBJECTS.length);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS) || "{}");
  } catch {
    return {};
  }
}

/** Open the drawer. `preset` may carry {modules, category, mode}. `mastery` maps module → accuracy. */
export function openBuilder(meta, preset = {}, mastery = {}) {
  const d = $("#drawer");
  const modules = readyBy(meta.facets, "module");
  const available = subjectOrder(Object.keys(modules).filter((m) => modules[m] > 0));
  const prefs = loadPrefs();
  const state = {
    modules: (preset.modules || prefs.modules || available.slice(0, 1)).filter((m) =>
      available.includes(m),
    ),
    category: preset.category || "",
    mode: preset.mode || prefs.mode || "practice",
    count: prefs.count || 20,
    unseen: Boolean(prefs.unseen),
  };
  if (!state.modules.length) state.modules = available.slice(0, 1);

  d.innerHTML = `<div class="drawer-head"><div><h2>自选专项</h2><p>科目可多选，多科时按科目平均分配题量；只选一科可再选小类。</p></div><button class="dialog-close" aria-label="关闭">${icon("close")}</button></div>
    <div class="drawer-body">${
      available.length
        ? `<section class="builder-block" aria-labelledby="builder-subjects"><h3 id="builder-subjects">科目</h3><div class="subject-grid">${available
            .map((m) => {
              const acc = mastery[m];
              return `<button class="subject-card" data-module="${esc(m)}" role="checkbox"><span class="subject-icon">${icon(SUBJECT_ICONS[m] || "book")}</span><span class="subject-copy"><strong>${esc(m)}</strong><small>${esc(DESCRIPTIONS[m] || "按模块练习，逐步积累")}</small></span><span class="subject-meta"><b class="num">${num(modules[m])}</b><small>${acc == null ? "道可练" : `正确率 ${acc}%`}</small></span><span class="subject-check">${icon("check")}</span></button>`;
            })
            .join("")}</div></section>
          <section class="builder-block" id="category-block" aria-labelledby="builder-category"><h3 id="builder-category">小类</h3><div class="chip-row" id="category-picker" role="group" aria-label="知识小类"></div></section>
          <section class="builder-block builder-options"><div><h3>方式</h3><div class="segmented" role="group" aria-label="练习方式">${[
            ["practice", "练习模式"],
            ["exam", "考试模式"],
          ]
            .map(([v, t]) => `<button data-mode="${v}">${t}</button>`)
            .join("")}</div><p class="caption" id="mode-hint"></p></div><div><h3>题量</h3><div class="segmented" role="group" aria-label="每组题量">${[10, 20, 30, 50]
            .map((n) => `<button data-count="${n}">${n} 题</button>`)
            .join("")}</div></div><label class="check-field"><input id="quick-unseen" type="checkbox" ${state.unseen ? "checked" : ""}>只练还没做过的题</label></section>`
        : `<div class="empty"><h3>题库还没有可练习的题目</h3><p>请管理员先导入题库。</p></div>`
    }</div>
    <div class="drawer-foot"><p class="hint" id="builder-hint"></p><button class="primary" id="quick-start" ${available.length ? "" : "disabled"}>${icon("play")}开始练习</button></div>`;
  $(".dialog-close", d).onclick = () => d.close();
  if (!d.open) d.showModal();
  if (!available.length) return;

  function paint() {
    $$("[data-module]", d).forEach((b) => {
      const on = state.modules.includes(b.dataset.module);
      b.classList.toggle("selected", on);
      b.setAttribute("aria-checked", on);
    });
    $$("[data-mode]", d).forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === state.mode));
    $$("[data-count]", d).forEach((b) =>
      b.setAttribute("aria-pressed", Number(b.dataset.count) === state.count),
    );
    $("#mode-hint", d).textContent =
      state.mode === "exam"
        ? "考试模式：先作答，整组交卷后统一判分。"
        : "练习模式：单选即判，多选确认后判分。";
    const block = $("#category-block", d);
    if (state.modules.length > 1) {
      block.hidden = true;
      $("#builder-hint", d).textContent = `${state.modules.join(" + ")} · 共 ${num(state.modules.reduce((n, m) => n + modules[m], 0))} 道 · 随机混合`;
      return;
    }
    const [module] = state.modules;
    const counts = readyBy(meta.facets, "category", (f) => f.module === module);
    const categories = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    block.hidden = categories.length < 2;
    $("#category-picker", d).innerHTML = [["", "全部小类", modules[module]]]
      .concat(categories.map((k) => [k, k, counts[k]]))
      .map(
        ([v, t, n]) =>
          `<button class="chip ${v === state.category ? "selected" : ""}" data-category="${esc(v)}" aria-pressed="${v === state.category}">${esc(t)}<small>${num(n)}</small></button>`,
      )
      .join("");
    $$("[data-category]", d).forEach(
      (b) =>
        (b.onclick = () => {
          state.category = b.dataset.category;
          paint();
        }),
    );
    $("#builder-hint", d).textContent = `${module}${state.category ? ` · ${state.category}` : ""} · ${state.count} 题 · 自动跳过待核验题`;
  }
  $$("[data-module]", d).forEach(
    (b) =>
      (b.onclick = () => {
        const m = b.dataset.module;
        if (!state.modules.includes(m))
          state.modules = available.filter((x) => x === m || state.modules.includes(x));
        else if (state.modules.length > 1) state.modules = state.modules.filter((x) => x !== m);
        else return toast("至少选择一个科目");
        state.category = "";
        paint();
      }),
  );
  $$("[data-mode]", d).forEach(
    (b) =>
      (b.onclick = () => {
        state.mode = b.dataset.mode;
        paint();
      }),
  );
  $$("[data-count]", d).forEach(
    (b) =>
      (b.onclick = () => {
        state.count = Number(b.dataset.count);
        paint();
      }),
  );
  paint();

  const start = $("#quick-start", d);
  start.onclick = handle(async () => {
    state.unseen = $("#quick-unseen", d).checked;
    try {
      localStorage.setItem(
        PREFS,
        JSON.stringify({ modules: state.modules, mode: state.mode, count: state.count, unseen: state.unseen }),
      );
    } catch {}
    start.disabled = true;
    try {
      await startPractice({
        filters: {
          module: state.modules.length > 1 ? state.modules : state.modules[0],
          ...(state.category ? { category: state.category } : {}),
          ...(state.unseen ? { unseen: "1" } : {}),
        },
        mode: state.mode,
        count: state.count,
        title:
          state.modules.length > 1
            ? `${state.modules.join("、")} · 综合练习`
            : `${state.category || state.modules[0]} · 专项练习`,
      });
      d.close();
    } finally {
      start.disabled = false;
    }
  });
}
