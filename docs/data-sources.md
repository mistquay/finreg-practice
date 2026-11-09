# 采集途径与字段说明

> 本页保留首轮三套地市卷的采集记录。当前已扩展为1,302套粉笔试卷，完整流程和接口见 [粉笔完整试卷接口采集](fenbi-api-capture.md)。通过网页正常 getPaperSolution 接口，已补齐此前缺失的文字解析。

核对日期：2026-11-09。仅描述本次实际检查结果，接口可能随粉笔更新发生变化。

## 参考工具

- https://github.com/Jacqueline-Sun/fenbi-practice-data ：主用途是抓个人已完成练习并导出分析CSV。实际 data_extractor.py 的列以练习ID、题目ID、模块、正确性、用时、来源等为主，CSV缺少可直接练习的完整题干。参考其公开的标准题目详情接口，没有整体复制代码。
- https://github.com/EricPeng1027/fenbi-crawler ：可提取题干、材料、选项、答案、解析与图片；默认流程会提交白卷。本项目没有运行它的自动交卷流程；兼容其导出文件结构。

## 实际采用的流程

本人在独立Playwright浏览器会话登录 → 正常打开指定地市级真题 → 保存页面加载的试卷业务响应 → 用标准题目详情接口补全答案与难度 → 获取平台题目元信息、考点及父级详情 → 下载原题图片 → 归档完整响应 → 导入本地SQLite。

不保存账号密码，不自动交卷。浏览器登录由浏览器自身会话管理。打开试卷会在粉笔显示未完成练习，本地学习记录与粉笔练习记录分开。

## 已确认并使用的只读业务数据

| 数据               | 已保存字段 / 结构                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 试卷静态响应       | name、materials、questions、card章节树，所有嵌套字段                                                                                             |
| 标准题目详情       | id、content、material、type、difficulty、createdTime、shortSource、accessories、correctAnswer、hasVideo等，原样保留                              |
| question/meta      | id、wrongCount、totalCount、mostWrongAnswer、correctRatio，整份响应                                                                              |
| solution/keypoints | 考点id/name/status及原始数组；按请求ID顺序关联，校验条目数                                                                                       |
| keypoints          | parentId、level、children、desc、count、requestNum、requestType、optional、additional、keypointType、giantOnly、choiceOnly等，沿父级保存相关分类 |
| 图片               | 原始URL、下载后的本地文件、URL到本地文件的映射                                                                                                   |
| 来源               | 平台、外部题号、原卷题号、完整原始版本摘要、采集清单和时间                                                                                       |

字段按原值存储。比如 `wrongCount=0` 与 `correctRatio<100` 可以同时出现，不能自行推断其业务含义或改写。平台 correctRatio 是平台快照，不是当前用户的正确率。choice字段按该API的0起始索引转换为本地A/B/C/D，同时保留原对象。

完整响应保存在 `data/raw/fenbi`，规范化题目的 `raw` 字段保留对应原题、平台统计、考点、材料关联等。`data/fenbi` 保存本轮采集的可重建输入；归档文件以内容摘要区分版本。导入器保留上传文件整份JSON到 imported_documents 表。

## 当前边界

- 这次范围是2024—2026三套国考地市级行测，不是粉笔全站题库。
- 标准题目详情接口返回答案但未返回文字解析；未完成练习的 getSolution 明确提示“练习还未提交”，没有执行提交操作。该情况标记为来源未提供解析，不生成替代解释。
- 原始JSON和图片是个人题库数据，Git默认忽略，不公开上传。
- 网络失败会停止相应采集并保留已经下载的数据，不以空数据覆盖缺失响应。图片失败的题目进入待核验。

## 最终核验数量

390道粉笔题均保存平台统计和考点接口原响应，其中388道有非空考点，2道接口返回空考点数组，保留章节分类，不编造考点。相关考点与父级共195条。211个原始图片URL映射到175个本地图片文件（协议形式等不同URL可指向同一文件），题目图片引用缺失数为0。
