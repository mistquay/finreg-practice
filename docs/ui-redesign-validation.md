# 界面、答题流程与接口性能验收

日期：2026-11-09。页面沿用本地 Python / SQLite / ES modules，不增加前端构建或云服务。

## 本轮交付

- 暖白与松绿视觉系统、可读字号、桌面侧栏、手机导航；学习中心突出继续练习、专项与真题。
- 题库的常用/更多筛选、考点与标签、网址保留筛选和页码、空状态恢复、页码跳转。
- 数据管理来源搜索与每页15套分页；导入无效JSON时就地提示；笔记、收藏、备份与核验入口保留。
- 练习：单选点击即判分，答对自动下一题，答错停留看解析；多选确认后判分；申论明确保存并自行对照解析。
- 考试：编辑草稿不产生判分记录，整卷交卷后在同一事务中判分、结束；结果答题卡可逐题复盘。
- 手机答题收起全局导航，固定底部上一题、确认/下一题/交卷；适配底部安全区及横屏。
- 会话只在进入时GET；选择/文字变化约1秒后保存，切题、暂停、隐藏、离开时同步；持续阅读15秒兜底，暂停及没有变化时不周期写入。
- 自动保存返回轻量确认，保存顺序串行；过期草稿不覆盖新草稿，迟到请求不重开已结束会话。

## 接口性能

全量库：1,308套、73,321道卷内题次。本轮没有在实际学习库制造测试作答。

原先 papers/facets/tags/counts 四项查询实测分别为410.67、377.80、477.97、338.10毫秒，合计1604.54毫秒。通过覆盖索引、计数复用、标签集合先去重、避免读取raw字段，降低了数据库扫描量。未引入需要失效处理的元数据缓存。

meta仅返回前端需要的试卷字段，JSON紧凑编码并按客户端Accept-Encoding支持gzip。题库导出仍保留完整原始字段；静态图片与数据库备份不做JSON压缩。响应包含Server-Timing，便于在浏览器核对服务端耗时。

- 实际HTTP耗时5次（毫秒）：[158.02, 79.48, 84.19, 90.48, 78.1]；中位数 **84.19毫秒**。
- 服务端计时：meta;dur=83.0, meta;dur=71.5, meta;dur=74.7, meta;dur=83.0, meta;dur=70.3。
- 原JSON响应 569,518 字节；当前gzip响应 **35,086字节**。

以上是本机、本次观测；查询与HTTP分开记录，不把静态页面的绘制时间当作接口时延。读取题目和列表时不再先解码完整raw对象；进入答题页完全跳过meta请求。

## 自动验证

18项Python单元/集成测试通过，包含既有导入/历史保护/统计与新增：

- 考试草稿不判分、可改答，逐题判分入口在活动考试中被拒绝。
- 整卷原子交卷、重复交卷幂等、无效答案整卷回退。
- 未答题和纯空白申论不生成作答；申论不自动判分。
- 陈旧保存不覆盖新草稿，完成状态不能被自动保存重新打开。
- 编辑、导入和新作答后meta立即反映变化；gzip及Server-Timing通过HTTP检查。

前端9个ES模块及浏览器测试脚本语法检查通过。浏览器使用Edge无头模式，测试写入data/qa-redesign.sqlite3、8767端口；脚本拒绝默认8765端口并要求FINREG_UI_QA=1。

浏览器回归通过10组场景，无未捕获页面错误：

- practice: no meta prerequisite, correct single auto advances, wrong single stays
- practice: multiple choice waits for confirmation and then auto advances
- essay: draft reload, manual save and reference comparison
- exam: editable drafts, reload, no grading or answer disclosure before submission
- exam: whole-paper grading, result sheet, review and idempotent finish
- autosave: one session GET, changes POST, no periodic saves while paused
- Pixel 10 and small phones: actions visible at every scroll position
- library: mode chooser, filters, pagination, empty recovery, favorites
- data and statistics: invalid import, source search, filtering and sorting
- all workspaces: no overflow at 1440,1024,820,768,390,320

Pixel 10按412×915的CSS视口模拟，并覆盖390×844、360×800、320×760和915×412横屏。页面顶部和底部均实际检查操作按钮在视口内；全站另覆盖1440、1024、820、768、390、320宽度。未将桌面浏览器模拟表述为实体Android手机或软键盘验收。

实际学习库另做只读来源分页/搜索、申论筛选和触控尺寸检查，拦截所有非GET请求；实际库题目数与来源数量保持原口径。最终服务重启前核对旧Miniforge进程工作目录为本项目，避免旧后端继续响应。

## 视觉验证与技能检查

- 已查看桌面、平板、手机的学习中心、题库、练习、统计和数据管理截图；人工检查后修正了手机按钮换行、品牌副标题换行、对比度、焦点及44px触控区域。
- 本轮impeccable detect输出为`[]`。
- 早期QA场景perf检查0 FAIL / 0 WARN，CLS 0；这不是全量库接口性能基准，完整接口测量见上文。
- 使用系统中文字体、统一SVG图标和真实产品UI。没有外部照片、虚构数据、素材占位或外部提交表单。
- 文案语气：平静、直接，以选题、作答、交卷和复盘命名。

最初整站改版的design-taste-frontend检测结果为 **GATE: OPEN 39 (rounds used up)**，不是PASS。它把工作台当成营销落地页，要求整屏hero、装饰moment、统一外部边缘，并把SPA哈希路由当成不存在的锚点。按impeccable Operate要求保留工作界面的导航与内容密度；没有改检测器、隐藏内容或创建豁免。实际对比度、焦点和触控尺寸问题已修正并另行验证。

下面保留这次营销模板检测的原始未关闭项，避免把它记成通过；这些是当时首页的记录，不代表它覆盖了随后新增的考试流程。

| 检查 | 当时目标 |
| --- | --- |
| no-visual | main#app > div.route-view "今天，从一道题开始。" |
| button-styles | (one screen) |
| button-styles | (the page) |
| copy-actions | button#quick-start "开始练习" |
| heading-scale | aside.home-aside > section.today-panel > div.today-count > strong "6" |
| off-grid | section.practice-builder > div.subject-list > button.subject-row:nth-of-type(2) > span.subject-symbol |
| links | aside.sidebar > a.brand "知 知序 金融监管备考" |
| links | aside.sidebar > nav > a.active "学习中心" |
| links | aside.sidebar > nav > a:nth-of-type(2) "我的题库" |
| links | aside.sidebar > nav > a:nth-of-type(3) "错题收藏" |
| links | aside.sidebar > nav > a:nth-of-type(4) "学习统计" |
| links | aside.sidebar > nav > a:nth-of-type(5) "数据管理" |
| links | main#app > div.route-view > div.page-heading > a.button.secondary "查看学习统计" |
| links | div.home-main > section.continue-panel > div.continue-copy > a.button.primary "继续上次练习" |
| links | div.home-main > section:nth-of-type(3) > div.section-title > a.text-link "全部题库" |
| links | div.home-columns > aside.home-aside > section.review-links > a:nth-of-type(1) "错题复习 再练一次，找出薄弱处 3" |
| links | div.home-columns > aside.home-aside > section.review-links > a:nth-of-type(2) "我的收藏 留住值得反复看的题 2" |
| links | aside.home-aside > section.recent-panel > div.session-list > a:nth-of-type(1) "计算机专业专项练习 11-09 21:46 · 20 题 继续练习" |
| links | aside.home-aside > section.recent-panel > div.session-list > a:nth-of-type(2) "申论专项练习 11-09 21:46 · 5 题 继续练习" |
| links | aside.home-aside > section.recent-panel > div.session-list > a:nth-of-type(3) "计算机专业专项练习 11-09 21:46 · 20 题 查看复盘" |
| links | aside.home-aside > section.recent-panel > div.session-list > a:nth-of-type(4) "计算机专业 · 专项练习 11-09 21:46 · 10 题 继续练习" |
| moment-none | (the page) |
| hero-screen | main#app > div.route-view "今天，从一道题开始。专注练习，认真复盘。把每一步积累留在这里。查看学习统计 上次" |
| section-height | div.shell > footer.footnote "知序 · 每一次练习，都有迹可循本地保存 · 来源可追溯" |
| section-height | main#app > div.route-view "今天，从一道题开始。专注练习，认真复盘。把每一步积累留在这里。查看学习统计 上次" |
| one-section | div.shell > footer.footnote "知序 · 每一次练习，都有迹可循本地保存 · 来源可追溯" |
| one-section | main#app > div.route-view "今天，从一道题开始。专注练习，认真复盘。把每一步积累留在这里。查看学习统计 上次" |
| one-heading | h2#continue-title "计算机专业专项练习" |
| container-edges | div.shell > header.topbar "我的备考空间 / 学习中心 本地运行11月9日周一" |
| container-edges | main#app > div.route-view "今天，从一道题开始。专注练习，认真复盘。把每一步积累留在这里。查看学习统计 上次" |
| container-edges | a.skip-link "跳到主要内容" |
| container-edges | aside.sidebar "知知序金融监管备考 学习空间 学习中心 我的题库 错题收藏 学习统计 数据管理 " |
| container-edges | aside.home-aside > section.today-panel > div.section-title > h2 "今日学习" |
| container-edges | aside.home-aside > section.recent-panel > div.section-title > h2 "最近练习" |
| container-edges | div.route-view > div.home-columns > div.home-main > section.continue-panel "上次的练习，还可以继续计算机专业专项练习上次停在第 1 题 · 共 20 道题，" |
| container-edges | div.home-columns > div.home-main > section.practice-builder > div.subject-list "计算机专业沿着知识点，打牢专业基础477道题经济金融基础理解概念，也掌握应用11" |
| cut-text | aside.sidebar > nav "学习中心 我的题库 错题收藏 学习统计 数据管理" |
| off-grid | select#quick-count "10 20 30 50" |
| container | page |

## 复跑与运行

```powershell
python -m unittest discover -s tests -v
npm run check
# 独立终端启动隔离服务，确认不是个人档案后：
$env:FINREG_DB='data/qa-redesign.sqlite3'
python app.py --port 8767
# 另一个终端（需要Playwright与Edge）：
$env:FINREG_UI_QA='1'
node tests/ui_smoke.mjs
```

若Playwright不在模块搜索路径，可用PLAYWRIGHT_MODULE指向已有安装。截图和详细工具报告在忽略目录output/redesign与output/playwright/redesign；Chrome临时配置在忽略目录.taste-skill。

本地正式服务为http://127.0.0.1:8765。更新后需刷新原有页面加载新的ES模块；旧页面内存中的5秒计时器不会因为后端重启而自动替换。
