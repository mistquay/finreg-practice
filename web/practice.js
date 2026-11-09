import {
  $,
  $$,
  esc,
  rich,
  api,
  heading,
  sourceLink,
  duration,
  pct,
  toast,
  handle,
  modal,
} from "./ui.js";
let cleanup = () => {};
export function leavePractice() {
  cleanup();
  cleanup = () => {};
}
export async function renderPractice(root, id) {
  let session = await api("/api/session/" + id),
    index = session.position,
    current,
    selected = [],
    elapsed = 0,
    last = performance.now(),
    paused = false,
    busy = false,
    dead = false,
    result = null;
  paused = Boolean(session.drafts.__paused);
  let interval, saveInterval;
  const key = "finreg-drafts-" + id;
  try {
    const local = JSON.parse(localStorage.getItem(key) || "null");
    if (local?.updated > 0) {
      session.drafts = { ...session.drafts, ...local.drafts };
      paused = Boolean(session.drafts.__paused);
      index = Math.min(local.position, session.question_ids.length - 1);
    }
  } catch {}
  function tick() {
    const time = performance.now();
    if (
      !paused &&
      !document.hidden &&
      !result &&
      !busy &&
      session.status === "active"
    )
      elapsed += Math.min(time - last, 2000);
    last = time;
    if (current)
      session.drafts[current.id] = {
        selected: [...selected],
        elapsed_ms: Math.round(elapsed),
      };
    const timer = $("#question-timer", root);
    if (timer) timer.textContent = duration(elapsed);
    persist();
  }
  function persist() {
    session.drafts.__paused = paused;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          drafts: session.drafts,
          position: index,
          updated: Date.now(),
        }),
      );
    } catch {}
  }
  function save(keepalive = false) {
    if (dead) return Promise.resolve();
    tick();
    const data = { position: index, drafts: session.drafts };
    return fetch("/api/session/" + id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      keepalive,
    }).then((r) => {
      if (!r.ok) throw new Error("进度保存失败，请检查服务");
    });
  }
  function exit() {
    tick();
    save(true).catch(() => {});
    dead = true;
    clearInterval(interval);
    clearInterval(saveInterval);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", hide);
  }
  function visibility() {
    last = performance.now();
    save(true).catch(() => {});
  }
  function hide() {
    save(true).catch(() => {});
  }
  cleanup = exit;
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", hide);
  function resultHTML() {
    if (!result) return "";
    if (current.type === "essay") return `<section class="answer-box"><h3>作答已保存 · 自行对照参考答案</h3><p class="caption">申论记录作答与用时，不自动判定对错，不计入客观题正确率。</p><h4>我的作答</h4><div class="prose">${rich(result.selected[0] || "")}</div><h4>参考答案与解析</h4><div class="prose">${rich(result.explanation) || "来源未提供参考解析"}</div></section>`;
    return `<section class="answer-box ${result.correct === 0 ? "incorrect" : ""}"><div class="answer-heading"><strong>${result.correct === 1 ? "回答正确" : result.correct === 0 ? "这道题值得再看一次" : "未自动判分"}</strong><span>你的答案 ${result.selected.join("、")} · 参考答案 ${result.answer.join("、") || "未提供"}</span></div><h3>答案解析</h3><div class="prose">${rich(result.explanation) || "来源未提供文字解析。此处保留参考答案，可通过来源入口核对。"}</div></section>`;
  }
  function paintOptions() {
    if (current.type === "essay") {
      if (result) { $("#answer-options",root).innerHTML = ""; return; }
      $("#answer-options", root).innerHTML = `<label class="field">我的作答<textarea id="essay-answer" rows="14" maxlength="30000" placeholder="结合给定资料作答，草稿会自动保存。" ${result || session.status !== "active" ? "disabled" : ""}>${esc(selected[0] || "")}</textarea></label><p class="caption" id="essay-count"></p>`;
      const input = $("#essay-answer", root);
      const count = () => { $("#essay-count", root).textContent = `已写 ${[...input.value.replace(/\s/g, "")].length} 字（不含空白）；字数要求以题干为准。`; };
      input.oninput = () => { selected = [input.value]; tick(); count(); };
      count();
      return;
    }
    $("#answer-options", root).innerHTML = Object.entries(current.options)
      .map(
        ([k, v]) =>
          `<button class="answer-option ${selected.includes(k) ? "chosen" : ""} ${result?.answer.includes(k) ? "correct" : ""} ${result && selected.includes(k) && !result.answer.includes(k) ? "incorrect" : ""}" data-option="${k}" aria-pressed="${selected.includes(k)}" ${result || session.status !== "active" ? "disabled" : ""}><span class="option-letter">${k}</span><span class="prose">${rich(v)}</span>${result?.answer.includes(k) ? '<span class="option-check">✓</span>' : ""}</button>`,
      )
      .join("");
    $$("[data-option]", root).forEach(
      (b) =>
        (b.onclick = () => {
          const k = b.dataset.option;
          selected =
            current.type === "single"
              ? [k]
              : selected.includes(k)
                ? selected.filter((x) => x !== k)
                : [...selected, k];
          tick();
          paintOptions();
        }),
    );
  }
  async function show() {
    if (dead) return;
    current = await api("/api/question/" + session.question_ids[index]);
    if (dead) return;
    const a = session.attempts.find((a) => a.question_id === current.id);
    const draft = session.drafts[current.id] || {};
    selected = a ? a.selected : [...(draft.selected || [])];
    elapsed = a ? a.elapsed_ms : draft.elapsed_ms || 0;
    result = null;
    if (a) {
      const q = await api("/api/question/" + current.id + "?answer=1");
      result = {
        correct: a.correct,
        selected: a.selected,
        answer: a.answer_snapshot,
        explanation: current.type === "essay" ? (a.answer_snapshot[0] || q.explanation) : q.explanation,
      };
    }
    last = performance.now();
    root.innerHTML =
      heading(
        "PRACTICE WITH PURPOSE",
        session.title,
        `${session.mode === "exam" ? "整卷练习 · 逐题反馈" : "专注当下这一道题"} · 进度自动保存`,
        '<a href="#library" class="button secondary">返回题库</a>',
      ) +
      `<div class="practice-layout"><section class="card question-card"><div class="practice-top"><div><span class="badge">${esc(current.category)}</span><span class="muted"> 第 ${index + 1} / ${session.question_ids.length} 题 · ${current.type === "essay" ? "申论 · 文字作答" : current.type === "multiple" ? "多选 · 全选对才得分" : "单选"}</span></div><div class="toolbar"><span id="question-timer" class="timer">${duration(elapsed)}</span><button class="quiet" id="pause-btn">${paused ? "继续计时" : "暂停"}</button></div></div>${current.material ? `<details class="material" open><summary>阅读材料</summary><div class="prose">${rich(current.material)}</div></details>` : ""}<div class="prose question-stem">${rich(current.stem)}</div><div id="answer-options"></div><div id="answer-result">${resultHTML()}</div><div class="practice-actions"><button class="secondary" id="previous" ${index === 0 ? "disabled" : ""}>上一题</button><div class="toolbar">${!result && session.status === "active" ? '<button class="primary" id="submit-answer">提交答案</button>' : ""}<button class="${result ? "primary" : "secondary"}" id="next">${index === session.question_ids.length - 1 ? "查看本次总结" : "下一题"}</button></div></div><div class="source-row"><span>${esc(current.source)} · 原卷第${current.number}题</span>${sourceLink(current)}</div></section><aside class="practice-aside"><section class="card answer-sheet"><div class="card-heading"><h3>答题卡</h3><span>${session.attempts.length}/${session.question_ids.length}</span></div><div class="number-grid">${session.question_ids
        .map((qid, i) => {
          const a = session.attempts.find((a) => a.question_id === qid);
          return `<button data-jump="${i}" class="${i === index ? "current" : ""} ${a ? (a.correct === null ? "answered" : a.correct === 1 ? "right" : "wrong") : ""}" aria-label="第${i + 1}题${a ? (a.correct === null ? "，已作答" : a.correct === 1 ? "，答对" : "，答错") : ""}">${i + 1}</button>`;
        })
        .join(
          "",
        )}</div><div class="sheet-legend">蓝框 当前题 · 绿 对 · 红 错 · 灰 已作答</div><button class="secondary wide" id="finish-session">${session.status === "completed" ? "查看总结" : "结束并总结"}</button></section><section class="card note-card"><button class="quiet" id="practice-favorite">${current.favorite ? "★ 已收藏" : "☆ 收藏这道题"}</button><label class="field">我的笔记<textarea id="practice-note" rows="5" placeholder="记下错因，下一次避开它。">${esc(current.note)}</textarea></label><button class="secondary wide" id="practice-save-note">保存笔记</button></section></aside></div>`;
    paintOptions();
    $("#pause-btn", root).onclick = () => {
      tick();
      paused = !paused;
      persist();
      save().catch((e) => toast(e.message));
      $("#pause-btn", root).textContent = paused ? "继续计时" : "暂停";
    };
    $("#previous", root).onclick = handle(() => move(index - 1));
    $("#next", root).onclick = handle(() =>
      index < session.question_ids.length - 1
        ? move(index + 1)
        : summary(false),
    );
    $$("[data-jump]", root).forEach(
      (b) => (b.onclick = handle(() => move(Number(b.dataset.jump)))),
    );
    $("#finish-session", root).onclick = () => summary(true);
    $("#practice-favorite", root).onclick = handle(async (e) => {
      const r = await api("/api/mark/" + current.id, {
        favorite: !current.favorite,
      });
      current.favorite = r.favorite;
      e.target.textContent = r.favorite ? "★ 已收藏" : "☆ 收藏这道题";
    });
    $("#practice-save-note", root).onclick = handle(async () => {
      await api("/api/mark/" + current.id, {
        note: $("#practice-note", root).value,
      });
      toast("笔记已保存");
    });
    const submit = $("#submit-answer", root);
    if (submit)
      submit.onclick = handle(async () => {
        if (busy) return;
        if (!selected.length || (current.type === "essay" && !selected[0].trim())) return toast(current.type === "essay" ? "先填写作答内容" : "先选择你的答案");
        tick();
        busy = true;
        submit.disabled = true;
        try {
          const r = await api("/api/session/" + id + "/answer", {
            question_id: current.id,
            selected,
            elapsed_ms: Math.round(elapsed),
          });
          result = r;
          session = await api("/api/session/" + id);
          await show();
        } finally {
          busy = false;
          last = performance.now();
          if (submit.isConnected) submit.disabled = false;
        }
      });
  }
  async function move(to) {
    if (busy || to < 0 || to >= session.question_ids.length) return;
    tick();
    await save();
    index = to;
    persist();
    await show();
    await save();
    window.scrollTo(0, 0);
  }
  function summary(end) {
    tick();
    const correct = session.attempts.filter((a) => a.correct === 1).length,
      graded = session.attempts.filter((a) => a.correct !== null).length;
    const d = modal(
      `<div class="eyebrow">SESSION REVIEW</div><h2>这次练习，你又前进了一步。</h2><div class="summary-score">${pct(graded ? Math.round((correct / graded) * 1000) / 10 : null)}<span>正确率</span></div><p>已答 ${session.attempts.length} / ${session.question_ids.length} 道，答对 ${correct} 道。</p><p>累计有效作答用时 ${duration(session.attempts.reduce((n, a) => n + a.elapsed_ms, 0))}。未答题与申论主观题不计入正确率。</p><p class="caption">这是练习正确率，不是官方考试的加权分数。</p><div class="toolbar"><button class="secondary" id="continue-session">返回练习</button>${session.status === "active" ? '<button class="primary" id="confirm-finish">结束本次练习</button>' : '<a class="button primary" href="#stats" id="open-stats">查看统计</a>'}</div>`,
    );
    $("#continue-session", d).onclick = () => d.close();
    const b = $("#confirm-finish", d);
    if (b)
      b.onclick = handle(async () => {
        await save();
        session = await api("/api/session/" + id, {
          status: "completed",
          position: index,
          drafts: session.drafts,
        });
        localStorage.removeItem(key);
        d.close();
        await show();
        toast("本次练习已保存，可以随时复盘");
      });
    const link = $("#open-stats", d);
    if (link) link.onclick = () => d.close();
  }
  await show();
  interval = setInterval(tick, 1000);
  saveInterval = setInterval(() => save().catch((e) => toast(e.message)), 5000);
}
