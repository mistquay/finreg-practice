import {
  $,
  $$,
  esc,
  rich,
  api,
  sourceLink,
  duration,
  pct,
  toast,
  handle,
  modal,
  startPractice,
  typeLabel,
  debounced,
} from "./ui.js";
import { icon } from "./icons.js";
import { sessionSync } from "./session-sync.js";
let cleanup = () => {};
export function leavePractice() {
  cleanup();
  cleanup = () => {};
}

export async function renderPractice(root, id) {
  let session = await api(`/api/session/${id}`);
  if (!root.isConnected) return;
  let index = session.position,
    current,
    selected = [],
    elapsed = 0,
    result = null;
  let last = performance.now(),
    paused = false,
    busy = false,
    moving = false,
    dead = false,
    sheetOpen = false;
  let noteSaver = debounced(() => {}),
    interval,
    saveInterval,
    localSignature = "",
    revision = session.drafts.__updated || 0;
  const key = `finreg-drafts-${id}`,
    questions = new Map(),
    results = new Map();
  const exam = () => session.mode === "exam";
  const active = () => session.status === "active";
  try {
    const local = JSON.parse(localStorage.getItem(key) || "null");
    if (!active()) localStorage.removeItem(key);
    else if (local?.updated > revision) {
      session.drafts = { ...session.drafts, ...local.drafts };
      index = Math.max(
        0,
        Math.min(local.position, session.question_ids.length - 1),
      );
      revision = local.updated;
    }
  } catch {}
  paused = Boolean(session.drafts.__paused);
  const sync = sessionSync(
    id,
    () => {
      if (!active()) return null;
      tick();
      return { position: index, drafts: session.drafts };
    },
    (message) => {
      const s = $("#save-status", root);
      if (s) s.textContent = message;
    },
  );

  function persist() {
    if (!active()) return;
    session.drafts.__paused = paused;
    const signature = JSON.stringify({
      position: index,
      drafts: { ...session.drafts, __updated: undefined },
    });
    if (signature === localSignature) return;
    localSignature = signature;
    revision = Math.max(Date.now(), revision + 1);
    session.drafts.__updated = revision;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          position: index,
          drafts: session.drafts,
          updated: revision,
        }),
      );
    } catch {
      toast("浏览器草稿空间不足，请保持本地服务运行以保存进度");
    }
  }
  function tick() {
    const now = performance.now();
    if (!paused && !document.hidden && !result && !busy && active())
      elapsed += Math.min(now - last, 2000);
    last = now;
    if (current && active() && (!result || exam()))
      session.drafts[current.id] = {
        selected: [...selected],
        elapsed_ms: Math.round(elapsed),
      };
    const timer = $("#question-timer", root);
    if (timer) timer.textContent = duration(elapsed);
    persist();
  }
  function saveError(e) {
    if (!dead) toast(e.message);
  }
  function visibility() {
    tick();
    if (document.hidden) sync.save(true).catch(saveError);
    last = performance.now();
  }
  function hide() {
    tick();
    sync.save(true).catch(() => {});
  }
  function exit() {
    noteSaver.flush();
    hide();
    dead = true;
    clearInterval(interval);
    clearInterval(saveInterval);
    sync.cancel();
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", hide);
    document.removeEventListener("keydown", keyboard);
  }
  cleanup = exit;
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", hide);
  document.addEventListener("keydown", keyboard);

  function keyboard(event) {
    if (
      dead ||
      busy ||
      moving ||
      paused ||
      event.repeat ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      document.querySelector("dialog[open]")
    )
      return;
    if (event.target.closest("input,textarea,select,[contenteditable=true]"))
      return;
    if (
      event.target.closest("button,a,summary") &&
      !event.target.closest("[data-option]")
    )
      return;
    const k = event.key.toUpperCase();
    if (/^[A-H]$/.test(k)) {
      const b = $(`[data-option="${k}"]`, root);
      if (b && !b.disabled) {
        event.preventDefault();
        b.click();
      }
    } else if (event.key === "Enter") {
      const b = $(exam() || result ? "#next" : "#submit-answer", root);
      if (b && !b.disabled) {
        event.preventDefault();
        b.click();
      }
    } else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      handle(() => move(index + (event.key === "ArrowRight" ? 1 : -1)))();
    }
  }
  function answered(qid) {
    const attempt = session.attempts.find((a) => a.question_id === qid);
    if (!exam() || !active()) return Boolean(attempt);
    return Boolean(
      (session.drafts[qid]?.selected || attempt?.selected || []).some((v) =>
        String(v).trim(),
      ),
    );
  }
  function answerCount() {
    return session.question_ids.filter(answered).length;
  }
  function sheetHTML() {
    return session.question_ids
      .map((qid, i) => {
        const a = session.attempts.find((a) => a.question_id === qid);
        const state =
          exam() && active()
            ? answered(qid)
              ? "answered"
              : ""
            : a
              ? a.correct === null
                ? "answered"
                : a.correct
                  ? "right"
                  : "wrong"
              : "";
        return `<button data-jump="${i}" class="${i === index ? "current" : ""} ${state}" aria-label="第${i + 1}题${state === "right" ? "，答对" : state === "wrong" ? "，答错" : answered(qid) ? "，已作答" : "，未作答"}">${i + 1}</button>`;
      })
      .join("");
  }
  function refreshSheet() {
    $("#answer-numbers", root).innerHTML = sheetHTML();
    $("#sheet-count", root).textContent =
      `${answerCount()} / ${session.question_ids.length}`;
    $(".practice-progress", root).value = answerCount();
    $("#top-count", root).textContent = `${answerCount()} / ${session.question_ids.length}`;
    $$("[data-jump]", root).forEach(
      (b) => (b.onclick = handle(() => move(Number(b.dataset.jump)))),
    );
  }
  function resultHTML() {
    if (!result) return "";
    if (current.type === "essay")
      return `<section class="answer-box"><h3>${result.unanswered ? "本题未作答" : "作答已保存"} · 对照参考解析</h3><p class="caption">申论不自动判定对错，不计入客观题正确率。</p><h4>我的作答</h4><div class="prose">${rich(result.selected[0] || "未作答")}</div><h4>参考答案与解析</h4><div class="prose">${rich(result.explanation) || "来源未提供参考解析"}</div></section>`;
    const verdict = result.unanswered
      ? ["muted", "", "本题未作答"]
      : result.correct === 1
        ? ["good", "check", "回答正确"]
        : result.correct === 0
          ? ["bad", "close", "回答错误 · 看懂再继续"]
          : ["muted", "", "未自动判分"];
    return `<section class="answer-box ${result.correct === 0 ? "incorrect" : result.correct === 1 ? "correct" : ""}"><div class="answer-heading"><strong class="verdict ${verdict[0]}">${verdict[1] ? icon(verdict[1]) : ""}${verdict[2]}</strong><span class="answer-keys">你的答案 <b>${result.selected.join("、") || "未作答"}</b><span class="dot-sep"></span>参考答案 <b>${result.answer.join("、") || "未提供"}</b></span></div><h3>答案解析</h3><div class="prose">${rich(result.explanation) || "来源未提供文字解析，可通过原卷入口核对。"}</div></section>`;
  }
  function paintOptions() {
    const locked = busy || paused || Boolean(result) || !active();
    if (current.type === "essay") {
      $("#answer-options", root).innerHTML = result
        ? ""
        : `<label class="field">我的作答<textarea id="essay-answer" rows="12" maxlength="30000" placeholder="结合给定资料作答，草稿自动保存。" ${locked ? "disabled" : ""}>${esc(selected[0] || "")}</textarea></label><p id="essay-count" class="caption"></p>`;
      const input = $("#essay-answer", root);
      if (input) {
        const count = () =>
          ($("#essay-count", root).textContent =
            `已写 ${[...input.value.replace(/\s/g, "")].length} 字（不含空白）`);
        input.oninput = () => {
          selected = [input.value];
          tick();
          refreshSheet();
          count();
          sync.schedule(saveError);
        };
        count();
      }
      return;
    }
    $("#answer-options", root).innerHTML = Object.entries(current.options)
      .map(
        ([k, v]) =>
          `<button class="answer-option ${selected.includes(k) ? "chosen" : ""} ${result?.answer.includes(k) ? "correct" : ""} ${result && selected.includes(k) && !result.answer.includes(k) ? "incorrect" : ""}" data-option="${k}" aria-pressed="${selected.includes(k)}" ${locked ? "disabled" : ""}><span class="option-letter">${k}</span><span class="prose">${rich(v)}</span>${result?.answer.includes(k) ? `<span class="option-check">${icon("check")}</span>` : ""}</button>`,
      )
      .join("");
    $$("[data-option]", root).forEach(
      (b) =>
        (b.onclick = handle(async () => {
          if (busy || moving || paused) return;
          const k = b.dataset.option;
          selected =
            current.type === "single"
              ? [k]
              : selected.includes(k)
                ? selected.filter((x) => x !== k)
                : [...selected, k];
          tick();
          paintOptions();
          refreshSheet();
          if (!exam() && current.type === "single") await submit();
          else sync.schedule(saveError);
        })),
    );
  }
  function actionsHTML() {
    const lastQuestion = index === session.question_ids.length - 1;
    const confirm = active() && !exam() && !result && current.type !== "single";
    return `<button class="secondary" id="previous" ${index === 0 || paused ? "disabled" : ""}>上一题</button><span class="action-position">${index + 1} / ${session.question_ids.length}</span><div class="toolbar">${confirm ? `<button class="primary" id="submit-answer" ${paused ? "disabled" : ""}>${current.type === "essay" ? "保存作答" : "确认答案"}</button>` : ""}<button id="next" class="${!confirm ? "primary" : "secondary"}" ${paused ? "disabled" : ""}>${lastQuestion ? (exam() && active() ? "交卷" : "查看总结") : "下一题"}</button></div>`;
  }
  async function show() {
    if (dead) return;
    noteSaver.flush();
    const qid = session.question_ids[index];
    const attempt = session.attempts.find((a) => a.question_id === qid);
    if (!questions.has(qid))
      questions.set(
        qid,
        await api(`/api/question/${encodeURIComponent(qid)}?compact=1`),
      );
    if (dead) return;
    current = questions.get(qid);
    const draft = session.drafts[qid] || {};
    selected =
      exam() && active()
        ? [...(draft.selected || attempt?.selected || [])]
        : attempt
          ? [...attempt.selected]
          : [...(draft.selected || [])];
    elapsed =
      attempt && !(exam() && active())
        ? attempt.elapsed_ms
        : draft.elapsed_ms || 0;
    result = null;
    if ((attempt && !(exam() && active())) || (exam() && !active())) {
      if (!results.has(qid)) {
        const q = await api(
          `/api/question/${encodeURIComponent(qid)}?answer=1&compact=1`,
        );
        if (dead) return;
        results.set(qid, {
          correct: attempt?.correct ?? null,
          selected: attempt?.selected || [],
          answer:
            current.type === "essay"
              ? []
              : attempt?.answer_snapshot || q.answer,
          explanation:
            current.type === "essay"
              ? attempt?.answer_snapshot?.[0] || q.explanation
              : q.explanation,
          unanswered: !attempt,
        });
      }
      result = results.get(qid);
    }
    last = performance.now();
    const total = session.question_ids.length;
    const focusOn = document.body.classList.contains("focus-mode");
    const modeText = exam()
      ? active()
        ? "考试模式 · 交卷后统一判分"
        : "考试复盘 · 已交卷"
      : "练习模式 · 单选即答，多选确认后判分";
    const legend =
      exam() && active()
        ? '<span><i class="key current"></i>当前</span><span><i class="key answered"></i>已填写</span><span class="caption">交卷前不显示对错</span>'
        : '<span><i class="key current"></i>当前</span><span><i class="key right"></i>答对</span><span><i class="key wrong"></i>答错</span><span><i class="key answered"></i>未判分</span>';
    root.innerHTML = `<header class="practice-bar glass page-heading">
        <a class="icon-button" id="back-library" href="#library" aria-label="返回题库" title="返回题库">${icon("left")}</a>
        <div class="practice-title"><h1>${esc(session.title)}</h1><p>${modeText}</p></div>
        <div class="practice-meter"><progress class="practice-progress" max="${total}" value="${answerCount()}" aria-label="本次已作答进度"></progress><span class="num" id="top-count">${answerCount()} / ${total}</span></div>
        <div class="practice-tools"><span id="question-timer" class="timer num" title="本题有效用时">${duration(elapsed)}</span><button class="ghost" id="pause-btn" ${!active() ? "disabled" : ""}>${icon(paused ? "play" : "pause")}<span>${paused ? "继续" : "暂停"}</span></button><button id="focus-toggle" class="ghost" aria-pressed="${focusOn}" title="隐藏答题卡与笔记">${icon("focus")}<span>${focusOn ? "退出专注" : "专注"}</span></button></div>
      </header>
      <div class="practice-layout ${current.material ? "has-material" : ""}"><section class="question-card sheet-paper" aria-label="第 ${index + 1} 题">
        <div class="practice-top"><span class="type-tag type-${esc(current.type)}">${typeLabel(current.type)}</span><span class="badge">${esc(current.category)}</span><span class="q-position">第 ${index + 1} / ${total} 题</span>${current.type === "multiple" && active() && !exam() && !result ? '<span class="type-hint">可多选，选齐后点“确认答案”</span>' : ""}<span class="practice-top-end"><span id="save-status" class="save-status" role="status">${active() ? "进度自动保存" : "本次练习已结束"}</span><button class="quiet fav-button ${current.favorite ? "on" : ""}" id="practice-favorite" aria-pressed="${Boolean(current.favorite)}">${icon("star")}<span>${current.favorite ? "已收藏" : "收藏"}</span></button></span></div>
        ${paused && active() ? `<div class="notice paused-notice">${icon("pause")}已暂停，继续计时后可以作答。</div>` : ""}
        <div class="question-body">${current.material ? `<details class="material" open><summary>阅读材料</summary><div class="prose">${rich(current.material)}</div></details>` : ""}<div class="question-pane"><div class="prose question-stem">${rich(current.stem)}</div><div id="answer-options" data-type="${esc(current.type)}"></div><div id="answer-result" aria-live="polite">${resultHTML()}</div></div></div>
        <div class="practice-actions" aria-label="答题操作">${actionsHTML()}</div>
        <div class="source-row"><span>${esc(current.source)} · 原卷第${current.number}题</span>${sourceLink(current)}</div>
        <p class="keyboard-hint"><kbd>A</kbd>–<kbd>H</kbd> 选择<kbd>Enter</kbd> 确认 / 下一题<kbd>←</kbd><kbd>→</kbd> 切题</p>
      </section>
      <aside class="practice-aside"><section class="card answer-sheet ${sheetOpen ? "" : "mobile-collapsed"}"><div class="card-heading"><h2>答题卡 <small id="sheet-count" class="num">${answerCount()} / ${total}</small></h2><button class="quiet mobile-sheet-toggle" id="sheet-toggle" aria-expanded="${sheetOpen}" aria-controls="answer-numbers">${sheetOpen ? "收起" : "展开"}</button></div><div class="number-grid" id="answer-numbers">${sheetHTML()}</div><div class="sheet-legend">${legend}</div><button class="secondary wide" id="finish-session">${active() ? (exam() ? "交卷并查看结果" : "结束并总结") : "查看总结"}</button></section>
      <section class="card note-card"><label class="field" for="practice-note"><span class="note-label">${icon("note")}我的笔记</span></label><textarea id="practice-note" rows="5" placeholder="记录知识点与错因，停止输入后自动保存">${esc(current.note)}</textarea><button class="ghost wide" id="practice-save-note">保存笔记</button></section></aside></div>`;
    paintOptions();
    bindActions();
    refreshSheet();
    $("#focus-toggle", root).onclick = () => {
      const on = document.body.classList.toggle("focus-mode");
      $("#focus-toggle", root).setAttribute("aria-pressed", on);
      $("#focus-toggle", root).innerHTML =
        `${icon("focus")}<span>${on ? "退出专注" : "专注"}</span>`;
    };
    $("#sheet-toggle", root).onclick = () => {
      sheetOpen = !sheetOpen;
      $(".answer-sheet", root).classList.toggle("mobile-collapsed", !sheetOpen);
      $("#sheet-toggle", root).setAttribute("aria-expanded", sheetOpen);
      $("#sheet-toggle", root).textContent = sheetOpen ? "收起" : "展开";
    };
    try {
      const back = sessionStorage.getItem("finreg-library-route");
      if (/^#(?:library|review)(?:\?|$)/.test(back || ""))
        $("#back-library", root).href = back;
    } catch {}
    $("#pause-btn", root).onclick = handle(async () => {
      tick();
      paused = !paused;
      persist();
      await show();
      await sync.save();
    });
    $("#finish-session", root).onclick = summary;
    $("#practice-favorite", root).onclick = handle(async () => {
      const r = await api(`/api/mark/${current.id}`, {
        favorite: !current.favorite,
      });
      current.favorite = r.favorite;
      const fav = $("#practice-favorite", root);
      fav.classList.toggle("on", Boolean(r.favorite));
      fav.setAttribute("aria-pressed", Boolean(r.favorite));
      fav.innerHTML = `${icon("star")}<span>${r.favorite ? "已收藏" : "收藏"}</span>`;
    });
    const noteInput = $("#practice-note", root);
    const noteQuestion = current;
    const saveNote = async () => {
      const note = noteInput.value;
      if (note === noteQuestion.note) return;
      await api(`/api/mark/${noteQuestion.id}`, { note });
      noteQuestion.note = note;
      if (noteInput.isConnected) $("#save-status", root).textContent = "笔记已保存";
    };
    noteSaver = debounced(() => saveNote().catch(saveError), 1000);
    noteInput.oninput = () => noteSaver.schedule();
    noteInput.onblur = () => noteSaver.flush();
    $("#practice-save-note", root).onclick = handle(async () => {
      noteSaver.flush();
      await saveNote();
      toast("笔记已保存");
    });
  }
  function bindActions() {
    $("#previous", root).onclick = handle(() => move(index - 1));
    $("#next", root).onclick = handle(() =>
      index < session.question_ids.length - 1 ? move(index + 1) : summary(),
    );
    const b = $("#submit-answer", root);
    if (b) b.onclick = handle(submit);
  }
  async function submit() {
    if (busy || dead || paused || result || !active() || exam()) return;
    if (!selected.length || (current.type === "essay" && !selected[0].trim()))
      return toast(
        current.type === "essay" ? "请先填写作答内容" : "请先选择答案",
      );
    tick();
    busy = true;
    paintOptions();
    const qid = current.id;
    try {
      const r = await api(`/api/session/${id}/answer`, {
        question_id: qid,
        selected,
        elapsed_ms: Math.round(elapsed),
      });
      session.attempts.push({
        question_id: qid,
        correct: r.correct,
        selected: r.selected,
        elapsed_ms: r.elapsed_ms,
        answer_snapshot: current.type === "essay" ? [r.explanation] : r.answer,
      });
      results.set(qid, r);
      result = r;
      persist();
      busy = false;
      if (dead) return;
      if (r.correct === 1 && index < session.question_ids.length - 1) {
        toast("回答正确，已进入下一题");
        await move(index + 1);
      } else {
        await show();
        if (r.correct === 1 && answerCount() === session.question_ids.length)
          summary();
        else revealResult();
      }
    } finally {
      busy = false;
      last = performance.now();
      if (!dead) paintOptions();
    }
  }
  // Bring the feedback heading and first lines into view while keeping as much of the stem visible as possible.
  function revealResult() {
    const box = $("#answer-result", root).getBoundingClientRect();
    const bar = $(".practice-actions", root);
    const covered =
      bar && getComputedStyle(bar).position === "fixed" ? bar.offsetHeight : 0;
    const overflow =
      box.top + Math.min(box.height, 220) - (innerHeight - covered - 16);
    if (overflow > 0)
      window.scrollBy({
        top: overflow,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
  }
  async function move(to) {
    if (
      busy ||
      moving ||
      dead ||
      paused ||
      to < 0 ||
      to >= session.question_ids.length
    )
      return;
    moving = true;
    try {
      tick();
      index = to;
      persist();
      sync.save().catch(saveError);
      await show();
      window.scrollTo(0, 0);
    } finally {
      moving = false;
    }
  }
  function summary() {
    if (dead || busy || moving) return;
    tick();
    const total = session.question_ids.length,
      count = answerCount(),
      correct = session.attempts.filter((a) => a.correct === 1).length,
      graded = session.attempts.filter((a) => a.correct !== null).length;
    const reviewing = !active(),
      hiddenScore = exam() && active();
    const wrongIds = reviewing
      ? session.attempts.filter((a) => a.correct === 0).map((a) => a.question_id)
      : [];
    const d = modal(
      `<h2>${reviewing ? "本次练习总结" : exam() ? "确认交卷" : "本次练习总结"}</h2>${hiddenScore ? `<p class="finish-note">已填写 ${count} / ${total} 道${count < total ? `，还有 ${total - count} 道未作答` : ""}。交卷后统一判分，答案将不能修改。</p>` : `<div class="summary-score">${pct(graded ? Math.round((correct / graded) * 1000) / 10 : null)}<span>正确率</span></div><p>已答 ${count} / ${total} 道 · 答对 ${correct} 道 · ${total - count} 道未作答</p><p class="caption">未答题与申论不计入客观题正确率。累计作答用时 ${duration(session.attempts.reduce((n, a) => n + a.elapsed_ms, 0))}。</p>`}${reviewing ? `<div class="number-grid summary-grid">${sheetHTML()}</div>` : ""}<div class="toolbar"><button class="secondary" id="continue-session">${reviewing ? "返回复盘" : "继续作答"}</button>${active() ? `<button class="primary" id="confirm-finish">${exam() ? "确认交卷" : "结束本次练习"}</button>` : `${wrongIds.length ? `<button class="primary" id="retry-wrong">重练本次 ${wrongIds.length} 道错题</button>` : ""}<a href="#stats" class="button ${wrongIds.length ? "secondary" : "primary"}" id="open-stats">查看统计</a>`}</div>`,
    );
    $("#continue-session", d).onclick = () => d.close();
    $$("[data-jump]", d).forEach(
      (b) =>
        (b.onclick = handle(async () => {
          d.close();
          paused = false;
          await move(Number(b.dataset.jump));
        })),
    );
    const b = $("#confirm-finish", d);
    if (b)
      b.onclick = handle(async () => {
        if (busy) return;
        busy = true;
        b.disabled = true;
        tick();
        try {
          await sync.save();
          const finished = await api(`/api/session/${id}/finish`, {
            position: index,
            drafts: session.drafts,
          });
          session = finished;
          paused = false;
          results.clear();
          sync.cancel();
          try {
            localStorage.removeItem(key);
          } catch {}
          d.close();
          busy = false;
          await show();
          summary();
          toast("结果已保存，可以逐题复盘");
        } finally {
          busy = false;
          if (b.isConnected) b.disabled = false;
        }
      });
    const retry = $("#retry-wrong", d);
    if (retry)
      retry.onclick = handle(async () => {
        retry.disabled = true;
        try {
          d.close();
          await startPractice({
            question_ids: wrongIds,
            mode: "review",
            title: `${session.title.replace(/ · 错题重练$/, "")} · 错题重练`,
          });
        } finally {
          retry.disabled = false;
        }
      });
    const link = $("#open-stats", d);
    if (link) link.onclick = () => d.close();
  }
  await show();
  if (dead) return;
  interval = setInterval(tick, 1000);
  saveInterval = setInterval(() => {
    if (active() && !paused && !document.hidden && !result)
      sync.save().catch(saveError);
  }, 15000);
}
