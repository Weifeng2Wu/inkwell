# Markdown 双链与知识图谱

在 Markdown 中写 `[[文档名]]`、`[[notes/文档名|显示文字]]`，或使用普通的
`[文字](../notes/文档名.md)` 链接。在预览中点击即可打开文档；底部“反向链接”
展示哪些文档引用了当前文档。主界面顶部的网络图标打开星空知识图谱。

- 简写名称先找同文件夹，再找工作区中唯一的同名笔记；重名时需要补充路径。
- Wiki 文件夹路径从项目根目录开始，`./`、`../` 和普通 Markdown 链接相对当前文档。
- 节点覆盖 `.md`、`.markdown`、`.mdown` 和 `.pdf`，支持中文名称、别名；Markdown 支持 `#标题` 跳转。
- PDF 可通过 `[[papers/论文.pdf]]` 或 `[论文](papers/论文.pdf)` 引用，没有链接的 PDF 也会显示。
- `论文.pdf.notes.md` 自动连接同目录的 `论文.pdf`；双击 PDF 节点使用现有 PDF 阅读器打开。
- 代码、公式、HTML 块、注释、frontmatter 和图片不形成文档关系；`![[嵌入]]` 暂不支持。
- 点击图谱节点查看入链、出链和未解析链接；双击或 Enter 打开，空格选择，Esc 关闭。
- 侧栏的入链、出链和搜索结果点击后在图谱内定位该节点，悬停时高亮对应节点；顶部卡片打开文档。
- 悬停节点高亮其连线；超过 60 个节点时只显示选中、相邻和悬停节点的标签，放大到 150% 或搜索时显示全部。
- 连线收束到节点边缘，箭头不被节点遮挡；无链接的孤立节点使用弱化描边。
- 拖动空白处可水平 360° 环绕旋转、俯仰接近正上/正下，星空为包裹场景的球壳；Shift + 拖动平移，滚轮缩放；支持搜索、全局/相邻文档过滤和恢复布局。
- 星光错峰闪烁，选中节点有呼吸光晕，关联连线沿引用方向流动；悬停和键盘聚焦放大节点。
- 入场、筛选和恢复布局时，节点与连线同步平滑过渡；拖动节点即时跟随指针。
- 节点由三维力导向布局分布在以画布中心为球心的球体内，透视投影带来近大远小、前后遮挡和远处淡化；星光与空间参考环同步旋转。
- 拖动节点时在正对视线的平面内移动，任意旋转角度下都紧跟指针。
- 鼠标移动时轻微转动视角，移出画布后回到手动设置的角度；拖拽和缩放时保持坐标稳定。
- 拖动节点会轻微牵动直接相邻的节点，松手后邻居回位；已手动放置的其他节点保持原位。
- 遵循系统“减少动态效果”设置；窗口进入后台时暂停动画，关闭图谱后清理动画任务。
- 普通 Markdown 的实时缓冲区覆盖磁盘索引；PDF 侧记使用原有保护性保存流程，保存后更新。
- 关系来自显式链接及 PDF 与侧记的文件配对；不解析 PDF 正文推断关系，不创建缺失文件，不自动重写重命名后的链接。

`lib/use-markdown-graph.ts` 负责本地索引、并发读取和项目切换取消；
`lib/markdown-links.ts` 负责路径解析、入链和出链；共享语法解析器位于
`src/lib/markdown-links.ts`，供图谱和 Markdown 渲染器使用。
`lib/graph-layout.ts` 提供确定性布局，SVG 弹窗通过功能入口延迟加载。
`lib/use-graph-animation.ts` 仅在布局过渡期间逐帧更新坐标；持续的星光、光晕和连线动效
使用局部 CSS 动画，不持续执行力学模拟或触发 React 渲染。
`lib/graph-space.ts` 负责三维旋转、透视投影和视线平面内的节点拖动，PDF 仅索引路径，不作为文本读取。
`lib/use-graph-parallax.ts` 按需更新视角，跟随结束后停止逐帧任务；
`lib/graph-drag.ts` 计算有界的邻居位移，连线与节点共用显示坐标。

验证命令（在 `apps/desktop` 下）：

```bash
pnpm exec vitest run src/lib/markdown-links.test.ts src/features/markdown-graph \
  src/components/markdown/markdown-content.test.ts \
  src/features/editor/components/draft-editor.test.ts \
  src/features/editor/components/pdf-viewer.test.ts src/features/i18n/i18n.test.ts
pnpm exec tsc --noEmit
```
