# Cheat Bluff · undestand

应用名称为 **Cheat Bluff**，软件包标识为 `cheat-bluff`。新增界面、记录发现、连接管理等修改署名为用户指定的 **undestand**（按原拼写保留）。`out/main/brand.mjs` 和构建清单提供可检索的标记；没有暗中联网追踪。标记可被修改，不能单独证明抄袭或阻止复制。

检查发现的旧名称主要是内部 DOM 属性、IPC、存储键和历史注释。对外品牌和图标已更新；公开版使用独立数据目录，内部协议键保持兼容。依赖和恢复代码的原有版权/许可信息不移除，不将其改为个人原创署名。来源说明见 SOURCE_PROVENANCE.md。

## 图标

使用内置 imagegen 工具生成，采用 CB 字母与对话气泡的负形组合、炭灰底、米白主体与少量暖黄色。项目资源为 `out/renderer/assets/cheat-bluff-icon.png`，Windows 多尺寸图标为 `resources/build/icon.ico`。ICO 仅进行尺寸和格式转换。

生成提示词：

> Design a single polished desktop application icon for 'Cheat Bluff', a local-first interview preparation and personal knowledge assistant. A bold, distinctive geometric monogram combining C and B with one subtle dialogue-bubble negative space. Premium minimalist Swiss typography inspired symbol, not literal text. Ivory symbol on a deep charcoal rounded-square tile, tiny muted warm amber accent integrated into the geometry. Flat vector-like solid colors, balanced optical weight, extremely legible at 24 px, centered with generous safe margins. No robot, no brain, no sparkles, no hat, no mascot, no gradients, no shadows, no lettering outside the symbol, no mockup, no multiple variants. Square composition suitable for Windows icon. Transparent canvas outside the rounded-square tile.

## 连接管理参考

参考 [CC Switch 官方连接配置文档](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/2-providers/2.1-add.md) 的独立连接档案与启用方式。本项目重新实现自己的本地连接管理，没有复制 CC Switch 源码。支持 OpenAI Chat Completions 兼容接口；不宣称兼容其全部账户登录、路由、Responses 或 Anthropic 原生协议。
