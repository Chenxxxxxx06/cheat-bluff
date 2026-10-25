<div align="center">
  <img src="docs/images/icon.png" width="80" alt="Cheat Bluff" />
  <h1>Cheat Bluff</h1>
  <p><strong>把经历讲清楚，把下一场面试准备好。</strong></p>
  <p>一个简洁的 Windows 面试准备与个人知识工作台。</p>
  <p><strong>简体中文</strong> · <a href="README.en.md">English</a></p>
  <p><a href="https://github.com/Chenxxxxxx06/cheat-bluff/releases/latest"><strong>↓ 下载 Windows 版</strong></a>　·　<a href="#三步开始">使用指南</a>　·　<a href="https://github.com/Chenxxxxxx06/cheat-bluff/issues">反馈建议</a></p>
</div>

<br />

![Cheat Bluff 首页](docs/images/home.png)

<p align="center"><sub>干净的界面，从你自己的资料开始。</sub></p>

## 从「做过」到「讲清楚」

项目做了不少，面试时却不知道从哪里讲起？把简历、论文、代码和笔记放在一起，围绕目标岗位准备问答，结束后再回看和复盘。

| 整理资料 | 准备面试 | 回看与复盘 |
| :--- | :--- | :--- |
| 建立自己的知识库 | 结合公司、岗位和 JD 练习 | 按时间线查看记录 |
| 知识卡保留原文依据 | 梳理项目介绍与常见追问 | 用关键词或 `Ctrl+F` 搜索 |
| 核对个人贡献与参考资料 | 简短引导，随时开始 | 命名、删除、恢复和补充笔记 |

深浅主题随系统切换，左右分栏可以拖动。材料和记录保存在本机；使用云端模型时，相关输入会发送给你自行配置的服务。

## 三步开始

**① 下载并安装**

前往 **[Releases](https://github.com/Chenxxxxxx06/cheat-bluff/releases/latest)**，下载 `Cheat-Bluff-Setup-0.6.0-x64.exe`，双击安装。适用于 Windows 10 / 11 x64，已包含应用运行环境和本地 OCR，无需安装 Node.js、Python 或编译代码。

安装包目前未进行受信任的代码签名，Windows 可能显示“未知发布者”。请只从本仓库的 Release 下载，并按需核对随附的 SHA-256 校验文件。

**② 放入自己的资料**

打开“个人资料与知识库”，创建档案，导入简历、项目材料、论文或代码。先核对知识卡，再拿它练习。

**③ 准备下一场面试**

在“AI 与本地数据”配置自己的模型连接，然后新建准备档案、填写岗位要求，开始梳理和练习。面试后可以回到记录页补充复盘。

> **空白开始，自行配置。** 安装包不带作者的账号、凭据、知识库或面试记录，也不提供共享额度。不配置模型也能浏览界面、管理材料；AI 回答需要可用的模型服务。实时语音使用 DashScope WebSocket 协议。

<details>
<summary>想从源码运行？</summary>

需要 Windows、Node.js 24 和 npm：

```bash
git clone https://github.com/Chenxxxxxx06/cheat-bluff.git
cd cheat-bluff
npm ci
npm start
```

```bash
npm test
npm run verify:public
npm run package:dir
```

源码仓库不包含体积较大的 OCR 运行时与模型；需要开箱即用的 OCR，请下载 Release 安装包。应用数据独立保存在 `%APPDATA%/CheatBluff/`，不会读取作者旧版的数据目录或其他 AI 软件的登录凭据。

</details>

## 简历也一起准备好

配套整理了一份 **[个人中文简历 LaTeX 模板 →](https://github.com/Chenxxxxxx06/chinese-resume-latex)**：中文排版、项目条目、可点击链接和 logo 插槽都准备好了。填写自己的内容，用 XeLaTeX 或 Overleaf 编译，生成 PDF 后就能导入 Cheat Bluff。

还有个小建议：**学一下阿酥，给自己的项目简单画个 logo，再放进简历里。** 不用复杂，缩小后清楚好认就行。把图片放进模板的 `assets/`：

```latex
\projectentry[assets/project-logo.png]
  {你的项目名称}{你的角色}{技术栈或一句话介绍}
```

关于 logo 的尺寸、矢量导出和 LaTeX 排版，后面会再补一份小教程。

## 接下来想做的

- [ ] 回答更口语化，少一点套话和“AI 味”。
- [ ] 持续修 bug，改进报错提示与使用细节。
- [ ] 打磨不同分辨率、缩放比例和窄窗口体验。
- [ ] 提升知识库去重、项目归属和引用准确性。
- [ ] 让模型配置更简单，支持更多兼容服务。
- [ ] 补充项目 logo → LaTeX 简历的小教程。
- [ ] 整理恢复代码，完善来源与许可记录。

## 为什么做这个？

最近 Tibo 老在 reset，干脆趁这个机会，把一直想做的面试小工具做了出来。希望它也能帮你把准备过程变得轻松一点。

**欢迎提 Issue！** 问题、疑问、想法和改进建议都可以发。我看到后会认真处理，能复现的问题会尽力修复，一起把它做得更顺手。

[报告问题 / 提个建议 →](https://github.com/Chenxxxxxx06/cheat-bluff/issues/new/choose)

<sub>反馈时请附上操作步骤，截图和日志记得遮住个人资料与凭据。</sub>

---

<p align="center">Made by <strong>undestand</strong> · <a href="docs/SOURCE_PROVENANCE.md">来源与许可说明</a></p>
