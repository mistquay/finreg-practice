---
name: 知序
description: 金融监管备考工作台 · 晨雾玻璃
colors:
  ground: "#e9eff3"
  paper: "#ffffff"
  paper-sunk: "#f4f7f9"
  line: "#e1e8ed"
  line-strong: "#cbd6de"
  track: "#e3eaef"
  ink: "#13232e"
  ink-2: "#4b5d6b"
  ink-3: "#66798a"
  primary: "#1572a1"
  primary-hover: "#0f5f88"
  primary-soft: "#e0eff7"
  primary-ink: "#0d5a80"
  amber: "#e2832a"
  amber-soft: "#fcecd9"
  amber-ink: "#95500f"
  good: "#1d9460"
  good-soft: "#dbf2e6"
  bad: "#d4463d"
  bad-soft: "#fbe3e1"
  violet: "#5b6ee0"
  dark-ground: "#0c1419"
  dark-paper: "#141e25"
  dark-ink: "#e5edf2"
  dark-primary: "#5bb8e6"
typography:
  page-title:
    fontFamily: "PingFang SC, HarmonyOS Sans SC, MiSans, Microsoft YaHei UI, Noto Sans SC, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.3
  card-title:
    fontFamily: "PingFang SC, HarmonyOS Sans SC, MiSans, Microsoft YaHei UI, Noto Sans SC, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "PingFang SC, HarmonyOS Sans SC, MiSans, Microsoft YaHei UI, Noto Sans SC, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  stem:
    fontFamily: "PingFang SC, HarmonyOS Sans SC, MiSans, Microsoft YaHei UI, Noto Sans SC, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.85
  metric:
    fontFamily: "Segoe UI Variable Display, SF Pro Display, Segoe UI, Roboto, sans-serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  caption:
    fontFamily: "PingFang SC, HarmonyOS Sans SC, MiSans, Microsoft YaHei UI, Noto Sans SC, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "10px"
  md: "14px"
  lg: "20px"
  sheet: "24px"
  pill: "999px"
spacing:
  gap: "14px"
  pad: "18px"
  content: "1440px"
  bar: "56px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    height: "42px"
    padding: "0 18px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    height: "42px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "42px"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "36px"
    padding: "0 14px"
  chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "42px"
  question-sheet:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.sheet}"
    padding: "26px 32px"
  nav-tab-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    height: "38px"
---

# Design System: 知序

## Overview

**晨雾玻璃。** 面向长时间备考的工作台：浅雾底上铺四团静止的柔光色场（青蓝、青绿、琥珀、淡紫），外壳与仪表做成半透明磨砂玻璃，读题和数据表格放在实心纸面上。参考了用户提供的后台设计分享（柔光背景、悬浮胶囊导航、卡内微型图表），按 Operate 场景收敛：玻璃只承载导航与概览，正文永远在纸面。

使用场景：备考者在白天的书桌或夜里的卧室里连续刷题一两个小时，浅色与深色都要可读；深色由系统设置或顶栏的主题按钮切换（跟随系统 → 浅色 → 深色）。

源文件：`web/tokens.css`（全部颜色、阴影、字号、圆角）、`base.css`（背景、导航）、`components.css`（通用部件）、`pages.css`（登录、学习中心、抽屉）、`practice.css`（答题页）、`views.css`（题库、统计、管理）。

## Colors

主色青蓝，琥珀做“当前 / 提醒 / 多选”，对错用独立的语义绿红。颜色以整块胶囊、实心标签和图表系列出现，不做零散描边点缀。

### Primary
- **青蓝** `#1572a1`（深色 `#5bb8e6`）：主按钮、进度、单选题标签、图表主系列、选中态。
- **青蓝浅底** `#e0eff7`：选中背景、徽标底、分段控件中的强调。

### Secondary
- **琥珀** `#e2832a`：今日（周打卡）、进行中的练习、多选题标签、今日清单进度、正确率折线。琥珀底上的文字一律用深色 `#2a1606`，不用白字。

### Tertiary
- **淡紫** `#5b6ee0`：第三图表系列（正确率微图、科目掌握第三段）。

### Neutral
- 雾底 `#e9eff3`、纸面 `#ffffff`、下沉纸面 `#f4f7f9`、分隔线 `#e1e8ed`、轨道 `#e3eaef`。
- 正文 `#13232e`、次级 `#4b5d6b`、说明 `#66798a`（白底上均 ≥ 4.5:1）。
- 深色：底 `#0c1419`、纸面 `#141e25`、正文 `#e5edf2`，其余见 `tokens.css` 的两处深色块（跟随系统与手动选择保持一致）。

### Named Rules
- **语义色不当强调色**：答对 `#1d9460`、答错 `#d4463d` 只表示判分结果、正确率区间与涨跌。
- **玻璃只用于外壳**：导航、仪表卡、侧板、抽屉；题干、选项、解析、数据表用纸面。

## Typography

单一系统中文无衬线字体，不加载外部字体（服务部署在公网也不依赖 CDN）。数字使用 `--font-num` 与等宽数字。

### Hierarchy
- 页面标题 26px / 650（学习中心问候 28px）。
- 卡片标题 13px / 600，次级色——卡片靠内容说话，标题退后。
- 指标数字 30px / 400、-0.01em；单位与对比说明 12px。
- 题干 18px / 1.85；选项与解析 15px / 1.75–1.9；正文 15px / 1.65。
- 说明文字 12px。

## Layout

- 内容最宽 1440px，侧边距 20px（手机 14px，叠加安全区）。
- 学习中心与统计用 12 栏网格，卡片间距 14px：1180px 以下改两列，640px 以下单列。
- 顶部悬浮导航高 56px，粘性；760px 以下导航改为底部标签栏，顶栏只留标志、主题和头像。
- 答题页：题卡 + 300px 侧栏（1100px 以下 260px，900px 以下侧栏落到题目下方并可折叠）；760px 以下或横屏矮屏时，上一题 / 确认 / 下一题固定在底部。
- 有阅读材料的题在 1200px 以上材料与题目并排，材料粘性滚动。

## Elevation & Depth

两层阴影，均带偏移与柔和模糊，深色下改为黑色阴影：
- `--shadow-1` 卡片与纸面；`--shadow-2` 弹窗、抽屉、筛选弹层；`--shadow-btn` 主按钮与标志。
- 玻璃：白 62% + `blur(22px) saturate(160%)` + 1px 白描边；不支持 backdrop-filter 或用户要求减少透明度时退回 94% 不透明底。
- 760px 以下顶栏不用 backdrop-filter（否则底部标签栏的 fixed 定位会以顶栏为参照）。

## Shapes

卡片 20px，题卡与弹窗 24px，输入框 14px，按钮、标签、分段控件、导航全部为胶囊形。单选字母为圆形，多选字母为圆角方形。

## Components

### Buttons
主按钮青蓝实心；“继续 / 开始下一组”这类卡内主操作用墨色实心（`.primary.ink`）；次按钮纸面描边；玻璃上的次操作用 `.ghost`；行内操作用 `.quiet`。

### Chips
快捷入口与小类选择用胶囊 chip，选中为墨色实心；状态用 22px 高的 `.pill`（good / bad / warn / info / muted）；涨跌用 `.delta`。

### Cards / Containers
`.card` 为玻璃卡，`.card.paper` / `.sheet-paper` 为纸面。卡片不嵌套卡片。

### Inputs / Fields
42px 高，14px 圆角（筛选区下拉为胶囊），聚焦时青蓝描边加 3px 浅底光圈。

### Navigation
顶部悬浮胶囊：标志、学习中心 / 题库 / 错题收藏 / 统计，管理员另有数据 / 用户（以细分隔线隔开）、全局搜索、主题、头像。当前页为墨色胶囊。登录页与答题页不显示全局导航。

### 指标卡（KPI）
固定结构：卡片标题 + 时间范围 → 大数字 + 单位 + 涨跌胶囊 → 对比说明 → 14 天微型柱状或折线（零值画成轨道短桩，最后一天加深）。

### 自选专项抽屉
右侧抽屉（手机为底部抽屉）：科目卡片可多选 → 单科时显示小类胶囊 → 方式与题量分段 → 只练未做 → 底部提示与“开始练习”。记住上次的选择。

## Do's and Don'ts

### Do:
- 让每个数字带上“和什么比”：昨日、前一周期或目标。
- 状态用形状和颜色同时表达（胶囊、实心标签、对错图标），不只靠数字。
- 新页面先用 `tokens.css` 变量；颜色、阴影不写字面量（琥珀底深字除外）。
- 在 1440 / 1024 / 820 / 768 / 390 / 320 宽度检查，两种主题各看一遍。

### Don't:
- 不在题干、选项、解析、数据表下面放玻璃或柔光。
- 不用彩色发光阴影、渐变文字、emoji 图标；图标统一 24px viewBox、1.7 线宽的内联 SVG（`icons.js`）。
- 不让背景色场动起来；交互反馈 160ms，尊重减少动效设置。
- 不在营销式大 hero、整屏分节上浪费首屏：学习中心首屏就是今天的数据与入口。

## 验收约定

前端验收使用隔离数据库与 8767/8768 端口，不能向实际学习档案写入测试记录。浏览器回归脚本 `tests/ui_smoke.mjs` 覆盖学习中心、练习与考试流程、自动保存、手机操作栏、题库、统计、账号与全部页面的溢出检查。
