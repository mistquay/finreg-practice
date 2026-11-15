import { $, $$, esc, api, heading, handle, modal, toast, num, account } from "./ui.js";
import { icon } from "./icons.js";

const INVITE_STATUS = {
  open: ["未使用", ""],
  used: ["已注册", "done"],
  revoked: ["已撤销", "muted"],
  expired: ["已过期", "muted"],
};
const time = (v) => (v ? v.slice(0, 16).replace("T", " ") : "—");

function invitesHTML(invites) {
  if (!invites.length)
    return '<p class="empty-line">还没有邀请码。点“生成邀请码”，把码和网址发给朋友即可注册。</p>';
  return `<table><thead><tr><th scope="col">邀请码</th><th scope="col">生成时间</th><th scope="col">有效期至</th><th scope="col">状态</th><th scope="col"><span class="visually-hidden">操作</span></th></tr></thead><tbody>${invites
    .map((i) => {
      const [label, tone] = INVITE_STATUS[i.status];
      return `<tr><th scope="row"><code class="invite-code">${esc(i.code)}</code></th><td>${time(i.created_at)}</td><td>${time(i.expires_at)}</td><td><span class="pill ${tone}">${label}${i.used_by ? ` · ${esc(i.used_by)}` : ""}</span></td><td>${i.status === "open" ? `<button class="quiet" data-revoke="${esc(i.code)}">撤销</button>` : ""}</td></tr>`;
    })
    .join("")}</tbody></table>`;
}

function usersHTML(users) {
  return `<table><thead><tr><th scope="col">用户名</th><th scope="col">角色</th><th scope="col">注册时间</th><th scope="col">最近登录</th><th scope="col">作答次数</th><th scope="col">状态</th><th scope="col"><span class="visually-hidden">操作</span></th></tr></thead><tbody>${users
    .map((u) => {
      const self = u.id === account.user.id;
      const actions = self
        ? '<span class="caption">在右上角账号中修改密码</span>'
        : `<button class="quiet" data-reset="${u.id}">重置密码</button><button class="quiet" data-role="${u.id}" data-value="${u.role === "admin" ? "user" : "admin"}">${u.role === "admin" ? "设为普通用户" : "设为管理员"}</button><button class="quiet ${u.disabled ? "" : "danger"}" data-disable="${u.id}" data-value="${u.disabled ? 0 : 1}">${u.disabled ? "启用" : "停用"}</button>`;
      return `<tr><th scope="row">${esc(u.username)}${self ? ' <span class="pill">你</span>' : ""}</th><td>${u.role === "admin" ? "管理员" : "普通用户"}</td><td>${time(u.created_at)}</td><td>${time(u.last_login)}</td><td>${num(u.answers)}</td><td><span class="pill ${u.disabled ? "muted" : "done"}">${u.disabled ? "已停用" : "正常"}</span></td><td class="row-actions">${actions}</td></tr>`;
    })
    .join("")}</tbody></table>`;
}

export async function renderUsers(root, fresh = null) {
  const data = await api("/api/admin/users");
  root.innerHTML =
    heading(
      "用户管理",
      "邀请朋友注册，管理账号与权限。题库共用，每个人的作答、收藏和笔记相互独立。",
      `<button class="primary" id="new-invite">${icon("users")}生成邀请码</button>`,
    ) +
    `${
      fresh
        ? `<section class="notice invite-ready" aria-live="polite"><strong>新邀请码，${fresh.days} 天内有效，只能注册一个账号</strong><div class="invite-copy"><input id="fresh-code" readonly value="${esc(fresh.code)}" aria-label="新邀请码"><button class="secondary" id="copy-code">复制邀请信息</button></div><p class="caption">请朋友打开 ${esc(location.origin)}，点“注册账号”并填写邀请码。</p></section>`
        : ""
    }<section class="card admin-card"><div class="card-heading"><h2>邀请码</h2><span class="caption">一次性 · 7 天有效</span></div><div class="table-scroll">${invitesHTML(data.invites)}</div></section>
    <section class="card admin-card"><div class="card-heading"><h2>用户</h2><span class="caption">共 ${data.users.length} 人</span></div><div class="table-scroll">${usersHTML(data.users)}</div></section>
    <p class="caption">账号没有绑定邮箱：用户忘记密码时由管理员在此重置；管理员自己忘记密码，可在服务器上运行 <code>python auth.py reset-password 用户名</code>。停用账号会立即让它的登录失效，学习记录保留。</p>`;

  const refresh = () => renderUsers(root);
  $("#new-invite", root).onclick = handle(async (e) => {
    e.target.disabled = true;
    try {
      await renderUsers(root, await api("/api/admin/invites", {}));
    } finally {
      if (e.target.isConnected) e.target.disabled = false;
    }
  });
  const copy = $("#copy-code", root);
  if (copy)
    copy.onclick = async () => {
      const text = `知序邀请码：${fresh.code}\n注册地址：${location.origin}`;
      try {
        await navigator.clipboard.writeText(text);
        toast("已复制邀请码和注册地址");
      } catch {
        // Clipboard access needs HTTPS; fall back to a selected field.
        $("#fresh-code", root).select();
        toast("浏览器不允许自动复制，已选中邀请码，请手动复制");
      }
    };
  $$("[data-revoke]", root).forEach(
    (b) =>
      (b.onclick = handle(async () => {
        await api(`/api/admin/invites/${encodeURIComponent(b.dataset.revoke)}/revoke`, {});
        toast("邀请码已撤销");
        await refresh();
      })),
  );
  const update = (id, body, message) =>
    handle(async () => {
      await api(`/api/admin/users/${id}`, body);
      toast(message);
      await refresh();
    });
  $$("[data-role]", root).forEach(
    (b) =>
      (b.onclick = update(
        b.dataset.role,
        { role: b.dataset.value },
        b.dataset.value === "admin" ? "已设为管理员" : "已设为普通用户",
      )),
  );
  $$("[data-disable]", root).forEach(
    (b) =>
      (b.onclick = update(
        b.dataset.disable,
        { disabled: b.dataset.value === "1" },
        b.dataset.value === "1" ? "账号已停用，登录已失效" : "账号已启用",
      )),
  );
  $$("[data-reset]", root).forEach(
    (b) =>
      (b.onclick = () => {
        const user = data.users.find((u) => String(u.id) === b.dataset.reset);
        const d = modal(`<h2>重置 ${esc(user.username)} 的密码</h2><p class="caption">设置一个临时密码发给对方，对方登录后可在账号中自行修改。原有登录会失效。</p><form id="reset-form" class="password-form"><label>新密码<input name="password" type="password" autocomplete="new-password" maxlength="128" placeholder="至少 8 位" required></label><label>确认新密码<input name="confirm" type="password" autocomplete="new-password" maxlength="128" required></label><p class="form-error" role="alert" hidden></p><button class="primary" type="submit">重置密码</button></form>`);
        const form = $("#reset-form", d);
        form.onsubmit = async (event) => {
          event.preventDefault();
          const { password, confirm } = Object.fromEntries(new FormData(form));
          const error = $(".form-error", form);
          try {
            if (password !== confirm) throw new Error("两次输入的密码不一致");
            await api(`/api/admin/users/${user.id}`, { password });
            d.close();
            toast(`已重置 ${user.username} 的密码`);
          } catch (e) {
            error.textContent = e.message;
            error.hidden = false;
          }
        };
      }),
  );
}
