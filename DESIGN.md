---
name: SSH Workspace Manager
description: 融入 VS Code 的项目索引，以完整路径、清晰层级和明确操作状态组织项目。
colors:
  primary: "var(--vscode-button-background)"
  primary-text: "var(--vscode-button-foreground)"
  primary-hover: "var(--vscode-button-hoverBackground)"
  secondary-control: "var(--vscode-button-secondaryBackground)"
  secondary-control-text: "var(--vscode-button-secondaryForeground)"
  secondary-control-hover: "var(--vscode-button-secondaryHoverBackground)"
  workspace: "var(--vscode-editor-background)"
  text: "var(--vscode-foreground)"
  text-muted: "var(--vscode-descriptionForeground)"
  divider: "var(--vscode-panel-border)"
  control-border: "var(--vscode-button-border, var(--vscode-panel-border))"
  focus: "var(--vscode-focusBorder)"
  field: "var(--vscode-input-background)"
  field-text: "var(--vscode-input-foreground)"
  field-border: "var(--vscode-input-border, var(--vscode-panel-border))"
  link: "var(--vscode-textLink-foreground)"
  selection: "var(--vscode-list-activeSelectionBackground)"
  selection-text: "var(--vscode-list-activeSelectionForeground)"
  notice: "var(--vscode-textBlockQuote-background)"
  success: "var(--vscode-testing-iconPassed, var(--vscode-focusBorder))"
  success-text: "var(--vscode-testing-iconPassed, var(--vscode-foreground))"
  error: "var(--vscode-inputValidation-errorBackground)"
  error-border: "var(--vscode-inputValidation-errorBorder)"
  error-text: "var(--vscode-errorForeground)"
  progress: "var(--vscode-progressBar-background)"
  icon-ink: "#142D3B"
  icon-mint: "#88D6CD"
  activity-artwork: "#C5C5C5"
typography:
  headline:
    fontFamily: "var(--vscode-font-family, sans-serif)"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: "var(--vscode-font-family, sans-serif)"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
  project-name:
    fontFamily: "var(--vscode-font-family, sans-serif)"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "var(--vscode-font-family, sans-serif)"
    fontSize: "13px"
    lineHeight: 1.45
  metadata:
    fontFamily: "var(--vscode-font-family, sans-serif)"
    fontSize: "12px"
    lineHeight: 1.45
  path:
    fontFamily: "var(--vscode-editor-font-family, monospace)"
    fontSize: "12px"
    lineHeight: 1.45
rounded:
  control: "4px"
  feedback: "5px"
  section: "8px"
spacing:
  micro: "4px"
  actions: "4px"
  fields: "8px"
  compact: "12px"
  group: "16px"
  section: "12px"
  page: "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "4px 9px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.secondary-control}"
    textColor: "{colors.secondary-control-text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "4px 9px"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-control-hover}"
  button-project-action:
    typography: "{typography.metadata}"
    rounded: "{rounded.control}"
    padding: "3px 7px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.field-text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "5px 9px"
  section:
    rounded: "{rounded.section}"
    padding: "{spacing.section}"
  breadcrumb:
    backgroundColor: "transparent"
    textColor: "{colors.link}"
    typography: "{typography.metadata}"
    rounded: "{rounded.control}"
    padding: "2px 5px"
  directory-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.selection-text}"
  connection-status:
    backgroundColor: "{colors.notice}"
    typography: "{typography.body}"
    padding: "6px 9px"
  clone-result:
    backgroundColor: "{colors.notice}"
    typography: "{typography.body}"
    rounded: "{rounded.feedback}"
    padding: "10px 12px"
  clone-result-failed:
    backgroundColor: "{colors.error}"
---

# Design System: SSH Workspace Manager

## Overview

**Creative North Star: "开发者的项目索引"**

界面围绕查找、辨认和打开项目组织信息。原生左侧栏承载来源导航，右侧 Webview 提供项目名称、来源与完整路径的阅读空间。主要视觉线索是文字层级、细边框、操作强调色和可辨认的状态。

组件的描述为“克制、直接、状态明确”。工作区沿用 VS Code 的字体和主题语义，固定的品牌颜色保留在图标资源中。按钮、路径和提示优先呈现其用途；当前管理页没有自定义阴影、装饰性渐变或自定义过渡动画。

本文依据 [管理页样式](media/dashboard.css)、[结构](media/dashboard.html)、[交互](media/dashboard.js)、[原生侧栏](src/serverTree.ts)与现有图标记录，采用 [DESIGN.md 格式](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md)。本次观察了已安装扩展的桌面深色界面；断点、其他主题和任务状态的规格来自源码扫描，不代表它们都经过本轮实机验收。前置产品约束见 [PRODUCT.md](PRODUCT.md)。

**Key Characteristics:**

- 宿主主题决定工作区颜色，原生侧栏负责来源导航。
- 名称、来源与完整路径形成可扫描的项目行。
- 紧凑操作与可换行内容共存，长列表有自己的滚动区域。
- 连接与克隆使用文字、状态标识和进度共同反馈。

## Colors

工作区使用动态主题映射，颜色的描述采用用户确认的“操作强调色、工作区底色、正文色、辅助信息色”。frontmatter 中的 `var(...)` 是实际映射，不是待替换成某套固定十六进制配色的占位符；依赖静态色值的工具需要 VS Code 主题上下文才能解析。

### Primary

- **操作强调色**（`colors.primary` / `primary-text` / `primary-hover`）：用于连接、克隆和浏览区的新窗口打开等主操作，文字与背景使用宿主配对变量。
- **路径链接色**（`colors.link`）：用于面包屑；焦点和进度各自使用 `focus`、`progress`，不能因当前主题看起来相近而合并。

### Neutral

- **工作区底色**（`colors.workspace`）：管理页画布；分区本身没有另设实色卡片底。
- **正文色 / 辅助信息色**（`colors.text` / `text-muted`）：分别用于主要内容，以及数量、来源、时间、标签和说明。
- **分隔与控件色**（`divider`、`control-border`、`secondary-control*`、`field*`）：界定区域和输入，保留 CSS 中已有的主题变量回退链。
- **选中配对色**（`selection` / `selection-text`）：用于目录选中行，背景和文字一起切换。

### 状态与资源色

连接摘要和普通克隆反馈使用 `notice` 底色；克隆成功使用 `success` 与 `success-text`，失败使用 `error`、`error-border`、`error-text`，取消使用辅助信息色。状态同时有文字和标识，不只靠颜色。

`icon-ink` 与 `icon-mint` 仅来自 [图标源文件](media/icon.svg)，`activity-artwork` 来自 [活动栏图形](media/activity-bar.svg)。它们是资源颜色，不是管理页按钮、背景或文字的新主题。原生 TreeView 的图标颜色交由宿主处理。

**The Host Theme Rule.** 工作区保留宿主语义映射，不把某次截图的颜色固定到其他主题。

侧车文件中的八阶色带是基于原色生成的相对 OKLCH 预览，不是项目 CSS 已定义的色阶；不得据此扩展管理页调色板。动态主题变量仍需在预览宿主中提供。

## Typography

界面文字使用宿主 UI 字体，路径使用宿主编辑器等宽字体；两者都有 CSS 中已有的通用回退。没有引入额外网页字体或独立展示字体。

### Hierarchy

- **Headline**：页面主标题，取 `typography.headline`。
- **Title**：项目清单、目录浏览、本机克隆等分区标题，取 `typography.title`。
- **Project name**：项目行名称，取 `typography.project-name`；来源和时间保持辅助层级。
- **Body**：正文、标准控件和连接状态，取 `typography.body`。
- **Metadata**：来源、时间、数量、说明、面包屑和项目行操作，取 `typography.metadata`。
- **Path**：项目完整路径，取 `typography.path`。浏览路径输入框和本机父目录也使用编辑器字体；“将打开”的路径字号沿用正文。

长路径使用断词换行（`overflow-wrap: anywhere` / `word-break: break-word`），容器允许收缩。路径用 `<code>` 表达，基础 Webview 样式可能进一步影响其底色和前景；自有样式没有给所有代码文本统一指定另一套固定颜色。

## Layout

右侧管理页没有固定内容最大宽度。页面内边距默认 16px；顶部标题与记录按钮横向排列，标题和来源尽量同排。分区内边距和区间距默认 12px。源码包含多种按用途取值的细间距，不应描述成一个严格的等比或统一八点网格。

宽度至少 1080px 且高度至少 680px 时，服务器页和本地页把项目清单与目录浏览 / 本机克隆面板并排展示；可拖动中间 14px 的分隔区调整比例，服务器和本机页面分别记忆比例。项目清单与远程浏览内容独立滚动。其他页面保持单列。项目清单容器宽度至少 700px 时，项目行采用内容与操作两列（`minmax(0, 1fr) auto`），按钮组底边与完整路径底边对齐；不足 700px 时按钮排到路径下方。名称、来源、时间位于信息区，完整路径另起一行。按钮组可换行。窄窗口的服务器和本地页限制已保存项目区高度，仅列表内容收缩并内部滚动；历史、收藏和全部服务器页没有同样的高度限制。

### 响应式行为

断点依据 **Webview 的 CSS 视口宽度与高度**，不按操作系统或显示器宽度判断。

| 最大宽度 | 当前实现 |
| --- | --- |
| 1079px，或高度低于 680px | 服务器 / 本地页面改为单列并隐藏可拖动分隔区；项目列表与面板上下排列 |
| 720px | 页面和分区内边距均为 12px；页头、分区标题和筛选尽量同排；克隆结果的操作排到内容下方 |
| 460px | 页面与分区内边距收至 10px；页头、筛选和路径栏可换行；仓库地址与克隆按钮纵向排列；浏览选项纵向排列 |

**The Readable Path Rule.** 通过收缩、换行和局部滚动保留完整路径与操作入口，不把窄侧栏中的截断问题带回管理页。

这些数值记录现有实现，不构成所有小窗口都已验证的保证；特别是极短视口中，受限项目区的标题、筛选与内容的实际空间仍需真实布局检查。

## Elevation & Depth

管理页没有自定义 `box-shadow`。层级通过分区边框、分隔线、主题底色和选中背景表达；连接摘要用左侧强调线，克隆结果用边框、标题标识和文字区分状态。VS Code 原生提示框、选择器和侧栏自身的层次由宿主控制。

**The Flat Surface Rule.** 延续边框与底色分层的现有语法；记录或复用组件时不顺便添加悬浮卡片和阴影层级。

## Shapes

主要形态是轻微圆角矩形：标准按钮与输入使用 `rounded.control`，目录列表与反馈使用 `rounded.feedback`，分区使用 `rounded.section`。目录行内部按钮去掉圆角和边框，融入整行选中背景。边框通常是细实线（1px），连接状态左边框更明确（3px）。

活动栏是服务器加文件夹的线形图形（24 × 24 视图、1.6px 描边）；扩展图标在方形底上使用同一主题。原生侧栏使用 VS Code ThemeIcon：全部服务器 `layers`、本地 `folder`、历史 `history`、收藏 `star-full`、服务器 `server`。

## Components

### Buttons

**克制、直接、状态明确。** 标准规格和两个主要变体见 frontmatter；主按钮用于当前实现中的连接、克隆及浏览 / 结果区的新窗口打开，次按钮承载记录、添加、当前窗口和辅助动作。项目行中的打开按钮都使用较小的次按钮，不应把“新窗口”在所有位置都一律改成主按钮。

悬停使用各自主题背景。键盘焦点使用主题焦点线（1px，外偏移 2px）。禁用按钮降低透明度（0.45）并使用默认光标。没有自定义按下动画或过渡；进度中的取消按钮会显示“正在取消…”并暂时禁用。

### Inputs / Fields

**与宿主一致的描边字段。** 背景、前景和边框分别使用 `field*`；圆角、内边距、字体见 frontmatter，焦点沿用按钮同一轮廓。搜索与路径输入在可用宽度中伸展，路径输入使用编辑器字体。

复选框保留浏览器控件形态，强调色来自主按钮背景。源码已有搜索、路径、仓库地址的名称或标签；本次记录不代表全部辅助技术交互均已验收。字段未就绪时通过 `disabled` 限制操作，错误摘要显示在反馈区，当前没有统一的逐字段错误组件。

### Cards / Containers

**承载任务的边框分区。** 不使用独立卡片底色；标题、数量或说明和相关动作位于分区头部。主体依次放筛选、列表或操作字段。容器圆角和内边距取 frontmatter，响应式缩减见 Layout。

### Project List

**信息优先的重复行。** 每行以顶部分隔线界定，上下各留白 8px；名称突出，来源和时间收在同一辅助层级，路径另起一行。并排显示的按钮与路径底边对齐。收藏用星形按钮和 `aria-pressed` 表示，删除操作有针对项目的可访问名称；收藏列表显示“取消收藏”。空列表、无匹配结果分别使用文字提示。

### Navigation

**原生来源导航加页内路径导航。** 左侧沿用 TreeView 的行高、选择、悬停、图标和工具栏，不在 Webview 重画服务器栏。右侧面包屑是透明背景的链接色按钮，可折行，操作间以斜杠分隔；它仍保留按钮的键盘焦点轮廓。

### Directory List

**选择与进入分开可见。** 目录行包含可选中名称和“进入 →”按钮；单击名称选中，双击名称或点击进入导航。选中整行同时更换主题背景与文字。符号链接附方向标识；忙碌和未连接时禁用相应操作，空目录显示可继续打开当前目录的说明。

### Connection Status

**左侧强调线的摘要条。** 使用 `connection-status` 的底色与内边距，配合左边强调线说明当前连接或浏览状态；它没有另设阴影或圆角容器。信息会断词换行。

### Clone Progress / Result

**明显且可继续操作的任务反馈。** 全局结果位于页头之后、主要内容之前，处于正常文档流中，并非 `position: fixed` 或悬浮层。局部克隆控件旁也展示任务进度。

进行中用省略标识、阶段文字和进度条；未知百分比保持不定进度，获得对象进度后显示数值。成功、取消、失败分别有“✓”“−”“!”和明确标题；成功显示完整路径及两种打开操作，进行中显示取消，结束后允许关闭结果。状态使用 `role="status"`，全局反馈还有 `aria-live="polite"`。进度条高度为 5px，颜色沿用宿主语义；没有额外自定义动效。

## Do's and Don'ts

### Do:

- **Do** 使用宿主主题变量及其现有回退链，保留配对的背景色与文字色。
- **Do** 通过名称、辅助信息和等宽完整路径形成稳定的信息层级。
- **Do** 复用现有圆角、细边框、键盘焦点轮廓和按钮禁用状态。
- **Do** 在受限列表内保留滚动，并在窄视口中让文字与操作自然换行。
- **Do** 让连接、克隆和目录选择同时有文字或标识反馈。

### Don't:

- **Don't** 把当前深色截图、图标色或预览色带当作所有主题的工作区配色。
- **Don't** 把所有内容塞回原生窄侧栏，或用路径截断替代现有的完整路径换行。
- **Don't** 在记录现有系统时新增阴影、装饰渐变、字体或组件动效。
- **Don't** 隐去焦点轮廓，或只用颜色表达克隆结果与选中状态。
- **Don't** 把全局克隆反馈误写成悬浮固定栏，或把目录和项目行改成整行点击即打开。
