<div align="center">

# Inkwell

**专注研究，让 Agent 协作，由你决定每一次修改。**

本地优先的 AI 原生 LaTeX 桌面工作区，把论文写作、修改审阅和版本管理放在一起。

[![Desktop build](https://github.com/Weifeng2Wu/inkwell/actions/workflows/desktop-build.yml/badge.svg)](https://github.com/Weifeng2Wu/inkwell/actions/workflows/desktop-build.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Weifeng2Wu/inkwell?style=flat)](https://github.com/Weifeng2Wu/inkwell)

[English](README.md) | **简体中文** | [한국어](README_ko.md)

[产品功能](#围绕论文组织的工作区) · [快速开始](#快速开始) · [桌面构建](#桌面构建) · [文档](#文档)

</div>

---

## 为什么选择 Inkwell？

写论文不应该是在 LaTeX 编辑器、PDF 阅读器、AI 对话与终端之间反复复制粘贴。Inkwell 将它们集中在一个桌面工作区，并在 Agent 建议与正式稿件之间加入由你掌控的审阅环节。

提出修改要求，在原文位置检查建议，只接受认可的部分，然后编译和提交。项目始终是普通文件夹，不会被锁在专有文档格式中。

> **持续开发中。** 已配置 Windows、macOS、Linux 构建任务，但配置完成不代表各平台安装包都已通过原生构建与安装验证。详见[构建说明](docs/DESKTOP_BUILDS.md)。

## 围绕论文组织的工作区

| 工作流程 | 集成能力 |
| --- | --- |
| 写作 | Monaco 编辑器、LaTeX 高亮、参考文献补全、文件标签和分栏布局 |
| 审阅 | 原位显示 Agent 建议：红色原文、绿色建议，逐处接受或拒绝 |
| 编译 | 编译器检测、主文件选择、TeX 安装辅助、编译输出和辅助文件清理 |
| 阅读 | 内置 PDF 预览；存在同步数据时支持 SyncTeX 源码与 PDF 跳转 |
| 协作 | Git 状态、历史、暂存、提交、推送与拉取，以及发布到 GitHub |
| 定制 | 内置与第三方 Agent、可复用 Skills、终端、字体、快捷键和多组明暗主题 |

## 让 AI 修改可见、可控

Agent 辅助修改使用审阅工作副本，而不是静默覆盖正式源文件。

```text
你：    “把这段改得更简洁，但不要改变原有论点。”
Agent： 在审阅副本中提出修改。
你：    在同一编辑器中检查红色原文及紧随其后的绿色建议。
        逐处接受或拒绝，然后编译论文。
```

- 原文和建议在同一位置连续显示，不需要打开左右对照的新页面。
- 按修改片段接受或拒绝，不必一次性接受整篇重写。
- 可以切换文件标签，返回后继续处理尚未决定的建议。
- 内置和第三方 Agent 共享前置提示，明确审阅流程和个人回复偏好。

审阅机制是稿件修改流程，**不是操作系统级沙箱**。第三方进程仍拥有其被授予的权限，请使用可信工具并检查权限请求。

## 选择适合你的 Agent

可以为 **Inkwell Agent** 配置 OpenAI、Anthropic 或 Gemini 兼容接口，也可以通过 ACP（Agent Client Protocol）连接外部 Agent。

集成目录包括 **Pi、OpenCode、Claude Code、Codex、Antigravity、Qoder CLI、Grok Build、DeepSeek Harness、Kimi Code 和 ZCode**。默认选择器展示内置 Agent 与检测到的已安装 Agent，安装和适配器配置在 Agent 设置中单独管理。

受支持后端可复用回复偏好和当前项目启用的 Skills。内置 Agent 的接口地址、模型和 API Key 在设置中配置；外部 Agent 通过自己的 CLI 或受支持的适配器流程认证。连接失败不会静默切换到另一个 Agent。

不同适配器的认证、权限与工具能力存在差异；列入目录不代表每个上游版本都已完成端到端验证。详见[外部 Agent 文档](docs/external-agents.md)。

## 面向科研写作的 Skills

在一个 Skills 库里完成发现、安装与项目启用：

- 一个导入入口支持**文件夹、ZIP、Markdown Skill 文件和 GitHub 链接**。
- 筛选已安装 Skills，只为当前项目启用需要的能力。
- 卡片展示 GitHub 来源链接与简写 Star 数。
- 刷新库时，受支持的 GitHub 来源会按检查间隔尝试检查上游修订；已安装快照可随来源更新，结果取决于网络和检查状态，不会自动安装整个目录。
- 将投稿要求和受支持的作者工具包文件整理为可复用的格式指导。

以下集合在库中可选，**默认均不安装**：

| 集合 | 内容 | 来源 |
| --- | --- | --- |
| Research Paper Writing | 科研论文写作指导 | [Master-cai/Research-Paper-Writing-Skills](https://github.com/Master-cai/Research-Paper-Writing-Skills) |
| Nature Academic Writing Suite | 写作、润色、研究计划、引用、可用性声明、统计报告、模拟审稿、审稿回复与参考文献核验 | [Yuan1z0825/nature-skills](https://github.com/Yuan1z0825/nature-skills) |

Skills 提供指令，不会凭空提供缺失的工具：检索、引用核验和文档处理仍需相应能力。文本资源集成不会执行上游 Skill 脚本；期刊风格指导不等于官方政策，也不保证录用。

## LaTeX、PDF 与 Git 一起工作

通过编译器检测和安装辅助减少手动配置，使用受支持的引擎编译，在工作区查看错误，并借助 SyncTeX 在源码与 PDF 之间跳转。Unicode／中日韩文档能否正常编译仍取决于引擎、字体和宏包；通常可以从 XeLaTeX 或 LuaLaTeX 开始配置。

Git 以打开的工作区为单位：不同论文文件夹可拥有独立仓库与历史。本地查看状态、差异和提交不需要 GitHub 登录；访问远程需要对应凭据。GitHub 发布使用 GitHub CLI 认证，支持私有仓库。集成终端保留常规 CLI 操作空间。

## 本地优先

稿件保存在普通文件中。会话记录采用 JSONL；应用持久化层正在改为使用 SQLite 保存设置与索引。这里描述的是进行中的存储工作，不代表迁移已经完成。内置 Agent 的 API Key 使用操作系统凭据库，而不是明文项目设置。

无需注册 Inkwell 云账户，也没有托管应用后端。AI 请求会向你选择的服务商或 Agent 发送上下文；Git、更新与下载也可能联网。**本地优先不等于所有功能离线，也不等于内容绝不离开设备。**

## 快速开始

### 使用桌面应用

从 [GitHub Releases](https://github.com/Weifeng2Wu/inkwell/releases/latest) 下载对应平台的安装包。

**macOS 首次运行前：**打开 DMG，将 Inkwell 拖入“应用程序”。当前版本尚未使用 Apple 开发者证书签名和公证，因此 macOS 可能提示“应用已损坏”。确认安装包来自上述官方 Release 后，在终端执行：

```sh
sudo xattr -dr com.apple.quarantine "/Applications/Inkwell.app"
open "/Applications/Inkwell.app"
```

按提示输入 Mac 登录密码；输入时终端不会显示字符，输入完成后按回车即可。

1. 打开论文项目文件夹，配置 LaTeX 编译器。
2. 配置 Inkwell Agent，或连接已安装的外部 Agent。
3. 按需安装 Skills，并为当前项目启用。
4. 发起修改、审阅建议、编译，再提交到 Git。

### 从源码运行

前置依赖：**Node.js 24.x、pnpm 11.5.0、Rust stable、Git**，以及对应平台的 [Tauri 依赖](https://v2.tauri.app/start/prerequisites/)。论文编译需要 TeX 发行版；外部 Agent 安装可能需要 npm、uv 或服务商安装器。

```sh
git clone https://github.com/Weifeng2Wu/inkwell.git
cd inkwell
pnpm install
pnpm agent:setup  # 为当前系统与架构准备内置 SDK
pnpm tauri:dev
```

没有 pnpm 时使用 `npm install -g pnpm@11.5.0`。Agent 准备流程会联网下载并构建固定修订的上游运行时，不会发起模型生成请求。Windows 桌面应用应使用 Windows Node.js 准备运行时，不要混用 WSL 安装。

仅开发前端：`pnpm --filter @inkwell/desktop dev`。本地文件系统、编译、Git 和 Agent 等原生功能需要 Tauri 应用环境。

## 桌面构建

| 平台 | 安装包 | 说明 |
| --- | --- | --- |
| Windows x64 | NSIS `.exe` | 需要 WebView2；配置的安装器可下载引导程序 |
| macOS Apple Silicon／Intel | `.dmg` | 配置的最低版本为 macOS 13.5 |
| Linux x64 | `.deb`、`.AppImage` | CI 使用 Ubuntu 22.04，发行版兼容性需验证 |

在目标平台原生运行 `pnpm tauri:build`，或选择 **Actions → Desktop build → Run workflow**。打包入口会准备 Agent SDK 和 Node sidecar。**暂不配置开发者证书签名与公证**；测试安装包可能触发系统安全提示，仍需在对应平台安装、启动验证。详见[构建说明](docs/DESKTOP_BUILDS.md)。

## 开发

| 命令 | 用途 |
| --- | --- |
| `pnpm tauri:dev` | 带热更新的桌面开发 |
| `pnpm build` | 前端／工作区生产构建 |
| `pnpm tauri:build` | 准备运行时并生成原生安装包 |
| `pnpm --filter @inkwell/desktop typecheck` | 前端 TypeScript 检查 |
| `pnpm --filter @inkwell/desktop test` | 前端测试 |
| `pnpm agent:test` | Agent 测试 |
| `node --test scripts/test/*.test.mjs` | 打包辅助脚本测试 |
| `cd apps/desktop/src-tauri && cargo check` | Rust 后端检查 |
| `pnpm exec biome check .` | 规范与格式检查 |

技术栈为 **Tauri v2 + Rust**、**Next.js 静态导出 + React** 和 **Monaco**。功能模块位于 `apps/desktop/src/features`，原生命令位于 `apps/desktop/src-tauri/src/commands`，桌面架构不依赖 Next.js 服务端组件或托管后端。

## 文档

- [开发指南](docs/dev.md)
- [设计系统](docs/DESIGN.md)
- [Agent 与 Skills 框架](docs/AGENT_FRAMEWORK.md)
- [外部 Agent](docs/external-agents.md)
- [桌面构建](docs/DESKTOP_BUILDS.md)
- [贡献者约定](AGENTS.md)

## 许可证与致谢

Inkwell 使用 [MIT 许可证](LICENSE)。第三方运行时、Skills 与资源保留各自许可证，详见[第三方声明](packages/academic-agent/THIRD_PARTY_NOTICES.md)和 [Agent 图标来源](apps/desktop/public/agent-logos/LICENSE.txt)。

### 可编辑学术海报

在文件树右键选择“新建学术海报”，即可直接编辑文字、拖动和缩放元素，选择三种风格及横竖版尺寸，并导出可编辑的 PPTX/SVG 或打印用 PDF、PNG、JPEG。在技能市场安装 Academic Poster 后，Agent 可根据论文生成同一格式的海报。详见[调研与使用说明](ACADEMIC_POSTERS.md)。
