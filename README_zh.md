<div align="center">

# Inkwell

**为科研写作打造的本地优先 LaTeX 工作区。**

Inkwell 将论文编辑、PDF 预览、Agent 协作和 Git 版本管理放在同一个桌面应用中。从撰写初稿、审阅修改到编译与同步，让论文写作的各个环节保持连贯。

论文以普通文件保存在本地，你可以继续使用熟悉的工具，也可以选择自己的模型服务和 Agent。

[![Desktop build](https://github.com/Weifeng2Wu/inkwell/actions/workflows/desktop-build.yml/badge.svg)](https://github.com/Weifeng2Wu/inkwell/actions/workflows/desktop-build.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Weifeng2Wu/inkwell?style=flat)](https://github.com/Weifeng2Wu/inkwell)

[下载安装](https://github.com/Weifeng2Wu/inkwell/releases/latest) · [核心功能](#核心功能) · [快速开始](#快速开始)

[English](README.md) | **简体中文** | [한국어](README_ko.md)

</div>

![Inkwell 浅色与深色主题，以及 Agent 原位修改审阅](assets/readme/theme-preview.jpg)

## 核心功能

### 自动选择编译引擎，减少环境配置

根据项目源码和已安装的编译器，自动选择合适的 LaTeX 引擎。提供编译环境检测与安装辅助，减少手动配置步骤。

在同一工作区查看编译结果、检查错误，并通过 SyncTeX 在 PDF 与源码之间跳转。多语言文档可使用 XeLaTeX 或 LuaLaTeX，所需字体与宏包由项目决定。

### 用 Git 管理论文与同步进度

直接在工作区查看文件修改、比较差异、暂存与提交，并通过推送和拉取同步远程仓库。

为论文保留修改历史，在不同设备间继续工作，也可以与合作者通过 Git 共享项目。支持将项目发布到 GitHub，包括私有仓库。

### 使用内置 Agent，或连接本地 Agent

为内置 **Inkwell Agent** 配置 OpenAI、Anthropic 或 Gemini 兼容接口，即可在论文工作区中开展对话与修改。

也可以通过 **ACP（Agent Client Protocol）** 连接本机的 Agent，例如 Claude Code、Codex、OpenCode 和 Antigravity，沿用对应工具的账户与配置。

连接前会展示项目访问和数据使用说明，由你确认是否连接。

![通过 ACP 连接本地 Agent 前的确认弹窗](assets/readme/acp-connection.jpg)

### 在原文中审阅 Agent 修改

Agent 提出的修改以原位差异显示：红色标记原文，绿色标记建议内容。你可以逐处接受或拒绝，也可以统一处理整组建议。

修改建议、源码与 PDF 预览放在同一个工作区，便于检查措辞、公式和排版。

### 为 Agent 接入学术写作 Skills

通过 Skills 为 Agent 提供可复用的学术写作指导，涵盖论文组织、语言润色、投稿格式和审稿回复等任务。

支持从文件夹、ZIP、Markdown 文件或 GitHub 链接导入，并按项目启用需要的 Skills。内置 Agent 与受支持的 ACP Agent 可以共享项目启用的指导。

### 多套主题与工作区布局

提供多套浅色和深色主题，支持调整字体、快捷键与分栏布局。

根据当前任务安排源码、PDF、Agent 和终端的位置，在专注写作与对照审阅之间切换。

## 快速开始

### 1. 下载并安装

从 [GitHub Releases](https://github.com/Weifeng2Wu/inkwell/releases/latest) 下载适合你系统的安装包。

**macOS 首次运行**

打开 DMG，将 Inkwell 拖入“应用程序”。

当前版本尚未完成 Apple 开发者签名与公证，macOS 可能提示“应用已损坏”。确认安装包来自官方 Release 后，在终端执行：

```sh
sudo xattr -dr com.apple.quarantine "/Applications/Inkwell.app"
open "/Applications/Inkwell.app"
```

按提示输入 Mac 登录密码；输入时终端不会显示字符。

### 2. 打开论文项目

打开已有的 LaTeX 项目文件夹。Inkwell 会检测编译环境；如果缺少编译工具，可按应用内提示安装。

### 3. 配置 Agent

选择一种方式：

- **内置 Agent**：填写服务地址、模型和 API Key。
- **本地 Agent**：安装对应 Agent 及所需 ACP 适配器，在设置中选择它，并确认连接。

按需导入 Skills，为当前项目启用学术写作指导。

### 4. 开始写作

编辑论文或向 Agent 提出修改要求，检查并接受建议，然后编译查看 PDF。需要保存进度或同步时，通过 Git 提交并推送到远程仓库。

---

[MIT 许可证](LICENSE) · [第三方声明](packages/academic-agent/THIRD_PARTY_NOTICES.md) · [Agent 图标来源](apps/desktop/public/agent-logos/LICENSE.txt)
