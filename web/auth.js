import { $, esc, api, account, isAdmin, modal, toast } from "./ui.js";
import { icon } from "./icons.js";
import { subjectOrder } from "./builder.js";

const MODES = {
  login: {
    title: "登录知序",
    lead: "登录后继续你的练习、错题与笔记。",
    submit: "登录",
    path: "/api/auth/login",
  },
  register: {
    title: "注册账号",
    lead: "用管理员发给你的邀请码注册。每个人的学习记录相互独立。",
    submit: "注册并登录",
    code: "邀请码",
    path: "/api/auth/register",
  },
  setup: {
    title: "创建管理员账号",
    lead: "第一次使用：用服务启动日志里的初始化码创建管理员。已有的练习、错题和笔记会归入这个账号。",
    submit: "创建并登录",
    code: "初始化码",
    path: "/api/auth/register",
  },
};

function showError(form, message) {
  const box = $(".form-error", form);
  box.textContent = message;
  box.hidden = !message;
}

// Shared by sign-in and password forms: disable while posting, show the server's message inline.
async function submitForm(form, send) {
  const button = $("button[type=submit]", form);
  showError(form, "");
  button.disabled = true;
  try {
    await send(Object.fromEntries(new FormData(form)));
  } catch (e) {
    showError(form, e.message);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

export function renderAuth(root, setup, done) {
  let mode = setup ? "setup" : "login";
  function paint() {
    const m = MODES[mode];
    const fresh = mode !== "login";
    root.innerHTML = `<div class="auth-page"><div class="auth-intro" aria-hidden="true"><div class="auth-brand"><span class="brand-mark">知</span><span>知序<small>金融监管备考工作台</small></span></div><p class="auth-slogan">专项、真题、错题<br>每一道题都有迹可循</p><ul class="auth-points"><li>${icon("target")}按科目与考点组题，单选即判、多选确认</li><li>${icon("redo")}答错自动进错题本，随时重练</li><li>${icon("chart")}每日作答、正确率与覆盖率一目了然</li></ul></div><section class="auth-card glass" aria-labelledby="auth-title">
      <div class="auth-brand compact"><span class="brand-mark">知</span><span>知序</span></div>
      <h1 id="auth-title">${m.title}</h1><p class="auth-lead">${m.lead}</p>
      <form id="auth-form" novalidate>
        <label>用户名<input name="username" autocomplete="username" maxlength="32" required></label>
        <label>密码<input name="password" type="password" autocomplete="${fresh ? "new-password" : "current-password"}" maxlength="128" ${fresh ? 'placeholder="至少 8 位"' : ""} required></label>
        ${fresh ? `<label>确认密码<input name="confirm" type="password" autocomplete="new-password" maxlength="128" required></label><label>${m.code}<input name="code" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX" required></label>` : ""}
        <p class="form-error" role="alert" hidden></p>
        <button class="primary" type="submit">${m.submit}</button>
      </form>
      ${
        mode === "setup"
          ? '<p class="auth-help">初始化码只在还没有任何账号时有效，可在启动服务的终端或 <code>docker compose logs</code> 中找到。</p>'
          : `<p class="auth-switch">${mode === "login" ? "朋友给了你邀请码？" : "已经有账号？"}<button class="text-link" type="button" id="auth-switch">${mode === "login" ? "注册账号" : "返回登录"}</button></p>`
      }
    </section></div>`;
    const form = $("#auth-form", root);
    $("[name=username]", form).focus();
    form.onsubmit = (event) => {
      event.preventDefault();
      submitForm(form, async (data) => {
        if (!data.username.trim() || !data.password)
          throw new Error("请填写用户名和密码");
        if (fresh && data.password !== data.confirm)
          throw new Error("两次输入的密码不一致");
        await api(m.path, {
          username: data.username.trim(),
          password: data.password,
          ...(fresh ? { code: data.code } : {}),
        });
        done();
      });
    };
    const toggle = $("#auth-switch", root);
    if (toggle)
      toggle.onclick = () => {
        mode = mode === "login" ? "register" : "login";
        paint();
      };
  }
  paint();
}

export function openAccount(onSignedOut) {
  const user = account.user;
  const d = modal(`<div class="account-head"><span class="avatar large" aria-hidden="true">${esc([...user.username][0])}</span><div><h2>${esc(user.username)}</h2><p class="caption">${user.role === "admin" ? "管理员" : "普通用户"} · 作答、收藏与笔记只有自己可见</p></div></div>
    <div class="toolbar account-actions"><button class="secondary" id="account-settings">${icon("target")}考试与每日目标</button>${isAdmin() ? `<a class="secondary" href="#users" id="account-users">${icon("users")}用户管理</a>` : ""}<button class="secondary" id="account-logout">${icon("logout")}退出登录</button></div>
    <form id="password-form" class="password-form account-section"><h3>${icon("key")}修改密码</h3>
      <label>当前密码<input name="current" type="password" autocomplete="current-password" required></label>
      <label>新密码<input name="password" type="password" autocomplete="new-password" maxlength="128" placeholder="至少 8 位" required></label>
      <label>确认新密码<input name="confirm" type="password" autocomplete="new-password" maxlength="128" required></label>
      <p class="form-error" role="alert" hidden></p>
      <p class="caption">修改后，其他设备上的登录会失效。</p>
      <button class="primary" type="submit">保存新密码</button></form>`);
  const users = $("#account-users", d);
  if (users) users.onclick = () => d.close();
  $("#account-settings", d).onclick = () =>
    openSettings(() => {
      if (/^#?(home)?$/.test(location.hash)) window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  $("#account-logout", d).onclick = async (e) => {
    e.target.disabled = true;
    try {
      await api("/api/auth/logout", {});
    } catch {}
    d.close();
    onSignedOut();
  };
  const form = $("#password-form", d);
  form.onsubmit = (event) => {
    event.preventDefault();
    submitForm(form, async (data) => {
      if (data.password !== data.confirm)
        throw new Error("两次输入的新密码不一致");
      await api("/api/auth/password", {
        current: data.current,
        password: data.password,
      });
      form.reset();
      d.close();
      toast("密码已修改，其他设备需要重新登录");
    });
  };
}

// Exam date, daily goal and focus subjects drive the study-center countdown, checklist and mastery card.
export async function openSettings(onSaved = () => {}, part = "") {
  const [s, meta] = await Promise.all([api("/api/settings"), api("/api/meta")]);
  const modules = subjectOrder([...new Set(meta.facets.map((f) => f.module))]);
  const focus = new Set(s.focus);
  const d = modal(`<h2>考试与每日目标</h2><p class="muted">用于学习中心的考试倒计时、今日清单和科目掌握。只有你自己可见。</p>
    <form id="settings-form" class="settings-form" novalidate>
      <div class="settings-row"><label>考试名称<input name="exam_name" maxlength="30" placeholder="例如 金融监管笔试" value="${esc(s.exam_name)}"></label>
      <label>考试日期<input name="exam_date" type="date" value="${esc(s.exam_date)}"></label></div>
      <label>每日目标（题）<input name="daily_goal" type="number" min="5" max="500" step="5" value="${s.daily_goal}" inputmode="numeric"></label>
      <fieldset class="focus-field"><legend>主攻科目 <small>最多 3 个，显示在“科目掌握”</small></legend><div class="focus-picker">${modules
        .map(
          (m) =>
            `<button type="button" class="chip ${focus.has(m) ? "selected" : ""}" data-focus="${esc(m)}" aria-pressed="${focus.has(m)}">${esc(m)}</button>`,
        )
        .join("")}</div></fieldset>
      <p class="form-error" role="alert" hidden></p>
      <div class="toolbar dialog-actions"><button type="button" class="secondary" id="settings-cancel">取消</button><button class="primary" type="submit">保存设置</button></div>
    </form>`);
  const form = $("#settings-form", d);
  d.querySelectorAll("[data-focus]").forEach(
    (b) =>
      (b.onclick = () => {
        const m = b.dataset.focus;
        if (focus.has(m)) focus.delete(m);
        else if (focus.size >= 3) return toast("最多选择 3 个主攻科目");
        else focus.add(m);
        b.classList.toggle("selected", focus.has(m));
        b.setAttribute("aria-pressed", focus.has(m));
      }),
  );
  $("#settings-cancel", d).onclick = () => d.close();
  if (part === "focus") d.querySelector("[data-focus]")?.focus();
  form.onsubmit = (event) => {
    event.preventDefault();
    submitForm(form, async (data) => {
      await api("/api/settings", {
        exam_name: data.exam_name,
        exam_date: data.exam_date,
        daily_goal: data.daily_goal,
        focus: [...focus],
      });
      d.close();
      toast("设置已保存");
      onSaved();
    });
  };
}
