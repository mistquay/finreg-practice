// Browser regression uses a separate local QA service; it creates isolated study records.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const base = process.env.FINREG_QA_URL || "http://127.0.0.1:8767";
assert(
  ["127.0.0.1", "localhost"].includes(new URL(base).hostname) &&
    new URL(base).port !== "8765",
);
assert.equal(
  process.env.FINREG_UI_QA,
  "1",
  "Set FINREG_UI_QA=1 only for an isolated database",
);
await fs.mkdir("output/playwright/redesign", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [],
  checks = [],
  requests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
async function request(path, data) {
  const r = data
    ? await page.request.post(base + path, { data })
    : await page.request.get(base + path);
  assert(r.ok(), `${path}: ${await r.text()}`);
  return r.json();
}
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log("PASS", name);
}
async function open(hash, selector) {
  await page.goto(`${base}/#${hash}`);
  await page.locator(selector).first().waitFor();
}
async function position(n) {
  await page.waitForFunction(
    (n) =>
      document
        .querySelector(".practice-top")
        ?.textContent.includes(`第 ${n} /`),
    n,
  );
}
async function create(mode = "practice") {
  return request("/api/session", {
    mode,
    full_paper: true,
    shuffle: false,
    filters: { paper_id: "ui-flow" },
    title: `界面回归 · ${mode}`,
  });
}
const q = (id, number, type, answer) => ({
  id,
  paper_id: "ui-flow",
  number,
  year: 2026,
  stem:
    type === "essay"
      ? "请结合给定材料说明你的理解。"
      : "在面向对象数据库（OODB）中，包含其他对象的对象，称为？",
  options:
    type === "essay"
      ? {}
      : { A: "复合对象", B: "持久对象", C: "超对象", D: "嵌套对象" },
  answer,
  explanation:
    type === "essay"
      ? "参考解析：按材料逐点分析。"
      : "参考解析：请区分对象的组成关系与持久性。",
  material:
    type === "essay"
      ? "给定材料：" + "认真阅读资料，归纳关键事实。".repeat(50)
      : "",
  type,
  module: type === "essay" ? "申论" : "计算机专业",
  category: "界面测试",
  topic: "对象模型",
  tags: ["界面回归"],
  source: "隔离测试题库",
  source_page: 0,
  source_url: "",
  quality: "ready",
  issues: [],
  raw: {},
  provider: "qa",
  external_id: id,
});
const payload = {
  version: 1,
  papers: [
    {
      id: "ui-flow",
      title: "隔离界面测试卷",
      year: 2026,
      source: "QA",
      questions: [
        q("ui-one", 1, "single", ["A"]),
        q("ui-two", 2, "single", ["B"]),
        q("ui-multi", 3, "multiple", ["A", "C"]),
        q("ui-essay", 4, "essay", []),
      ],
    },
  ],
};
let practice, exam;
try {
  await request("/api/import", { data: payload });
  await check(
    "practice: no meta prerequisite, correct single auto advances, wrong single stays",
    async () => {
      practice = await create();
      const start = requests.length;
      await open(`practice/${practice.id}`, "[data-option]");
      assert.equal(
        requests.slice(start).filter((r) => r.url.includes("/api/meta")).length,
        0,
      );
      await page.locator('[data-option="A"]').click();
      await position(2);
      await page.locator('[data-option="A"]').click();
      await page.locator(".answer-box.incorrect").waitFor();
      assert.match(await page.locator(".practice-top").innerText(), /第 2/);
      assert.match(
        await page.locator("#answer-result").innerText(),
        /参考答案 B/,
      );
      await page.locator("#next").click();
      await position(3);
    },
  );
  await check(
    "practice: multiple choice waits for confirmation and then auto advances",
    async () => {
      await page.locator('[data-option="A"]').click();
      assert.equal(await page.locator("#answer-result .answer-box").count(), 0);
      await page.locator('[data-option="C"]').click();
      assert.equal(
        await page.locator('.answer-option[aria-pressed="true"]').count(),
        2,
      );
      await page.locator("#submit-answer").click();
      await position(4);
    },
  );
  await check(
    "essay: draft reload, manual save and reference comparison",
    async () => {
      await page
        .locator("#essay-answer")
        .fill("这是隔离测试草稿，刷新后应恢复。");
      await page.reload();
      await page.locator("#essay-answer").waitFor();
      assert.match(
        await page.locator("#essay-answer").inputValue(),
        /刷新后应恢复/,
      );
      await page.locator("#submit-answer").click();
      await page.locator("#answer-result .answer-box").waitFor();
      assert.match(
        await page.locator("#answer-result").innerText(),
        /不自动判定对错/,
      );
      await page.locator("#practice-note").fill("复盘对象模型");
      await page.locator("#practice-save-note").click();
      if ((await page.locator("#practice-favorite").innerText()) !== "已收藏")
        await page.locator("#practice-favorite").click();
    },
  );
  await check(
    "exam: editable drafts, reload, no grading or answer disclosure before submission",
    async () => {
      exam = await create("exam");
      await open(`practice/${exam.id}`, "[data-option]");
      await page.locator('[data-option="B"]').click();
      await page.locator('[data-option="A"]').click();
      await page.locator("#next").click();
      await position(2);
      await page.locator('[data-option="B"]').click();
      await page.reload();
      await page.locator('[data-option="B"][aria-pressed="true"]').waitFor();
      await page.locator("#next").click();
      await position(3);
      await page.locator('[data-option="A"]').click();
      await page.locator('[data-option="C"]').click();
      assert.equal(await page.locator("#submit-answer").count(), 0);
      assert.equal(
        await page
          .locator(
            ".answer-option.correct,.answer-option.incorrect,.answer-box",
          )
          .count(),
        0,
      );
      const fresh = await request(`/api/session/${exam.id}`);
      assert.equal(fresh.attempts.length, 0);
      await page.locator("#next").click();
      await position(4);
      await page.locator("#essay-answer").fill("考试作答要点。");
    },
  );
  await check(
    "exam: whole-paper grading, result sheet, review and idempotent finish",
    async () => {
      await page.locator("#next").click();
      await page.locator("#confirm-finish").waitFor();
      assert.match(await page.locator("dialog").innerText(), /交卷后统一判分/);
      await page.locator("#confirm-finish").click();
      await page.locator(".summary-score").waitFor();
      assert.match(await page.locator(".summary-score").innerText(), /100%/);
      assert.equal(await page.locator("dialog .number-grid .right").count(), 3);
      const finished = await request(`/api/session/${exam.id}`);
      assert.equal(finished.status, "completed");
      assert.equal(finished.attempts.length, 4);
      const again = await request(`/api/session/${exam.id}/finish`, {
        drafts: {},
      });
      assert.equal(again.attempts.length, 4);
      await page.locator('dialog [data-jump="0"]').click();
      await position(1);
      assert(await page.locator('[data-option="A"]').isDisabled());
      assert.equal(await page.locator("#answer-result .answer-box").count(), 1);
    },
  );
  await check(
    "autosave: one session GET, changes POST, no periodic saves while paused",
    async () => {
      const s = await create("exam"),
        start = requests.length;
      await open(`practice/${s.id}`, "[data-option]");
      await page.locator('[data-option="A"]').click();
      await page.locator("#pause-btn").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#save-status")?.textContent === "已自动保存",
      );
      const before = requests.filter(
        (r) => r.url.endsWith(`/api/session/${s.id}`) && r.method === "POST",
      ).length;
      await page.waitForTimeout(16000);
      assert.equal(
        requests.filter(
          (r) => r.url.endsWith(`/api/session/${s.id}`) && r.method === "POST",
        ).length,
        before,
      );
      assert.equal(
        requests
          .slice(start)
          .filter(
            (r) => r.url.endsWith(`/api/session/${s.id}`) && r.method === "GET",
          ).length,
        1,
      );
      await page.locator("#pause-btn").click();
    },
  );
  await check(
    "Pixel 10 and small phones: actions visible at every scroll position",
    async () => {
      const s = await create("exam");
      for (const [width, height] of [
        [412, 915],
        [390, 844],
        [360, 800],
        [320, 760],
        [915, 412],
      ]) {
        await page.setViewportSize({ width, height });
        await open(`practice/${s.id}`, "#next");
        for (const bottom of [false, true]) {
          await page.evaluate(
            (bottom) =>
              window.scrollTo(
                0,
                bottom ? document.documentElement.scrollHeight : 0,
              ),
            bottom,
          );
          const b = await page.locator("#next").boundingBox();
          assert(
            b.y >= 0 && b.y + b.height <= height + 1,
            `next button not visible at ${width}x${height}`,
          );
        }
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
        );
        if (width <= 760)
          assert.equal(await page.locator("nav").isVisible(), false);
      }
      await page.setViewportSize({ width: 412, height: 915 });
      await open(`practice/${s.id}`, "#next");
      await page.screenshot({
        path: "output/playwright/redesign/pixel-10-practice.png",
      });
    },
  );
  await check(
    "library: mode chooser, filters, pagination, empty recovery, favorites",
    async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await open("library?module=行测", ".question-title");
      await page.locator("#next-page").click();
      await page.waitForURL(/page=2/);
      await page.reload();
      await page.locator(".question-title").first().waitFor();
      assert.equal(await page.locator("[name=module]").inputValue(), "行测");
      assert.match(await page.locator("#pagination").innerText(), /第 2/);
      await page.locator("[name=search]").fill("UI_QA_NO_RESULT_8705");
      await page.locator("#empty-reset").waitFor();
      assert(await page.locator("#practice-current").isDisabled());
      await page.locator("#empty-reset").click();
      await page.locator(".question-title").first().waitFor();
      await page.locator("#practice-mode").selectOption("exam");
      await page.locator("#practice-current").click();
      await page.locator("#next").waitFor();
      assert.match(
        await page.locator(".page-heading p").innerText(),
        /考试模式/,
      );
      await open(
        "review?scope=favorite&search=" +
          encodeURIComponent("请结合给定材料说明你的理解"),
        ".question-title",
      );
      await page.locator('[data-id="ui-essay"]').click();
      await page.locator("dialog[open]").waitFor();
      assert.equal(
        await page.locator("#detail-note").inputValue(),
        "复盘对象模型",
      );
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "data and statistics: invalid import, source search, filtering and sorting",
    async () => {
      await open("data", "#source-search");
      assert((await page.locator("#sources-table tbody tr").count()) <= 15);
      await page.locator("#source-search").fill("NOT_A_PAPER_8705");
      assert.match(
        await page.locator("#sources-table").innerText(),
        /没有找到/,
      );
      await page.locator("#import-file").setInputFiles({
        name: "bad.json",
        mimeType: "application/json",
        buffer: Buffer.from("{bad"),
      });
      await page.locator("#import-preview [role=alert]").waitFor();
      await open("stats", "#group-table");
      await page.locator("[name=days]").selectOption("30");
      await page.waitForFunction(
        () =>
          document.querySelector(".stats-pair h2")?.textContent === "近30天",
      );
      await page.locator("[data-sort=accuracy]").click();
      assert.equal(
        await page
          .locator("[data-sort=accuracy]")
          .locator("..")
          .getAttribute("aria-sort"),
        "descending",
      );
    },
  );
  await check(
    "all workspaces: no overflow at 1440,1024,820,768,390,320",
    async () => {
      for (const width of [1440, 1024, 820, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [route, ready] of [
          ["home", "#quick-start"],
          ["library", ".question-title"],
          ["review?scope=favorite", ".question-title"],
          ["stats", "#group-table"],
          ["data", "#source-search"],
        ]) {
          await open(route, ready);
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
            false,
            `${route} overflows at ${width}`,
          );
        }
      }
    },
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "output/playwright/redesign/smoke-results.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(`${checks.length} browser scenarios passed.`);
} finally {
  await browser.close();
}
