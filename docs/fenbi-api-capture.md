# 粉笔完整试卷接口采集

核对日期：2026-11-09。入口为 `tools/capture_fenbi_all.ps1`，执行代码为 `tools/fenbi_api.py`、`scripts/import_fenbi_api.py`。旧 `capture_fenbi.ps1` 保留为三套地市真题的历史流程，新增采集请使用本页。

## 范围和流程

网页目录的分页接口是范围依据，不枚举猜测题号：

| 科目 | labelId | 目录 | 本次目录数量 |
| --- | --- | --- | --- |
| 行测 | 1 | 国考真题，包含副省级、地市级、行政执法及早期通用卷 | 36 |
| 行测 | 2972 | 国考模拟题 | 495 |
| 申论 | 101 | 国考真题，各类别 | 41 |
| 申论 | 3379 | 通用申论小模考，网站没有标注为国考专属 | 730 |

这些是本次登录账号通过上述四个目录可见的试卷，不代表粉笔所有产品、付费专属课程或未来新增试卷。每次重跑会重新分页发现新增试卷。通用小模考以独立类型保存，不混入“国考真题”。没有抓取各省公务员真题目录。

1. 浏览器完成登录，导出本地 Playwright storage state。
2. Python 使用 CookieJar 按 Cookie 原有域、路径、有效期复用登录态，仅向对应粉笔域发送 Cookie。
3. GET 分页目录，读取每卷的 `id/combineKey/encodeCheckInfo`。
4. GET 网页“查看试卷解析”使用的接口，再读取返回的静态 JSON URL。无需新建练习或提交白卷。
5. 按科目去重题号，批量获取详情、平台统计、考点和父级考点。
6. 下载题干、选项、材料、解析中的图片（包括公式图片）；完整原始对象归档；逐卷转换、校验和入库。

## 已验证接口

公共参数：`app=web&kav=131&av=134&hav=128&version=3.0.0.0`。

- `GET https://tiku.fenbi.com/api/{prefix}/papers/v2?labelId=...&toPage=0&pageSize=15`：`prefix` 为 `xingce` 或 `shenlun`。按照 `pageInfo.totalPage` 读取全部页面，保留列表所有字段。
- `GET https://tiku.fenbi.com/combine/exercise/getPaperSolution?format=html&key=...&routecs=...&paperId=...&checkId=...`：保留完整入口响应；读取 `data.staticUrl.urls` 中的正常业务链接。
- 静态试卷 JSON：完整保留 `name/materials/solutions/card` 和嵌套对象。`solutions` 中包含题干、附件选项、答案、`solution` 文字解析、`solutionAccessories` 申论参考答案/讲解、考点等。
- `GET https://tiku.fenbi.com/api/{prefix}/questions?ids=...`：每批100题，保留创建时间、难度、来源、视频标记及其他返回字段。
- `GET https://tiku.fenbi.com/api/{prefix}/question/meta?ids=...`：平台作答次数、正确率、易错选项等全部字段。申论的 `correctRatio=0` 原样保存，不视为个人成绩。
- `GET https://tiku.fenbi.com/api/{prefix}/solution/keypoints?ids=...`：按请求顺序对应的考点数组，包含状态字段；校验数组长度后关联。
- `GET https://tiku.fenbi.com/api/{prefix}/keypoints?ids=...`：考点对象、父级、层级和所有其他字段。

这里的 `getPaperSolution` 与旧的未提交练习 `getSolution` 不同。前者已在网页正常“查看试卷解析”流程和直接 GET 中验证，因此本次能补全行测文字解析和申论参考解析。

## 重跑和断点恢复

```powershell
cd D:\project\finreg-practice
# 首次会打开浏览器，登录后在终端按回车
.\tools\capture_fenbi_all.ps1
# 已有 finreg-source 登录会话时
.\tools\capture_fenbi_all.ps1 -UseOpenSession
```

Python 3.10+ 和 Node/npm/npx 必需；练习应用本身仍只依赖 Python 标准库。图片下载在已安装 requests 时使用连接池加速，未安装则使用标准库。`requests` 是采集加速的可选依赖。

也可以分阶段运行，已成功保存的试卷和题目批次默认跳过：

```powershell
python tools/fenbi_api.py catalog
python tools/fenbi_api.py papers
python tools/fenbi_api.py enrich
python scripts/import_fenbi_api.py
```

`papers --refresh` 可刷新整卷源数据；在导入后会生成新的内容摘要归档。题目补全批次默认缓存，不主动刷新平台统计快照。需要刷新快照时先备份相应 `enrichment` 目录，再移开旧批次文件后重跑 enrich。不要在采集/导入未完成时并行启动另一个相同阶段。

业务请求默认3个工作线程，统一间隔至少0.3秒；429/服务端错误有有限次数退避重试，401/403停止，不绕过权限或验证。图片使用8线程独立连接池，启动请求间隔至少0.08秒；启用 requests 时尊重429的 Retry-After 并有限退避重试，进度每100张写盘，重启复用已下载文件。

## 数据落点

- `data/fenbi/session.private.json`：本地登录态，含敏感 Cookie。已被 Git 忽略；不要分享或上传。失效时从已登录浏览器重新导出。
- `data/fenbi-api/catalog.json`、`catalogs/`：目录索引和每页完整响应。
- `data/fenbi-api/papers/`：逐卷完整入口响应与静态解析，包含所有材料和章节关系。
- `data/fenbi-api/enrichment/`：带科目、请求题号和采集时间的详情/统计/考点完整批次。旧行测批次未带 prefix 时按 xingce 读取。
- `data/fenbi-api/keypoints-{prefix}.json`：两科目的考点及父级对象、完整响应批次。
- `data/raw/fenbi-api/`：逐卷内容摘要版本归档。
- `data/fenbi-api/normalized/`：逐卷标准题库 JSON，可单独在界面导入，也可据此重建数据库。
- `data/fenbi-api/capture-report.json`、`enrichment-report.json`、`image-report.json`、`import-report.json`：成功、失败、权限限制、图片问题和入库清单。
- `data/assets/`、`data/asset-map.json`：离线图片和原始 URL 映射。
- `data/practice.sqlite3`：正式练习库。导入脚本直接逐卷入库，不必从网页上传数百 MB 的合并文件。
- `data/backups/before-expanded-bank.sqlite3`：本轮扩大题库前的数据库快照。

原始数据与登录态均不提交 Git。跨试卷重复引用同一源题时，保留各卷内题目关系和顺序，用 `(科目, 外部题号)` 关联补全接口；汇报题量区分卷内题次与去重后的源题数。

## 申论与历史数据保护

申论以 `type=essay` 保存，参考答案和讲解放在 `explanation`；完整附件及字数、分值等保留在 raw。给定资料通过章节 `materialKeys` 关联并保留原资料编号。题干字数限制为准，界面不把接口附件的 wordCount 强行当作限制。

文字作答仍沿用练习草稿/作答表，提交后 `correct=NULL`，只统计题量和用时，不自动打分、不进入错题。提交时保存参考解析快照。不对接粉笔付费批改或提交用户作答。

原来的2024—2026三套地市级卷沿用原ID，补全解析而不重复增加。来源刷新保护 `edited=1` 的人工字段，以及全部作答、收藏、笔记。其他卷按科目和源试卷ID建立稳定ID。数据库结构采用增量迁移，不重建用户库。