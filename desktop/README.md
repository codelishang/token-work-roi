# 元衡桌面小窗

桌面小窗用于常驻查看元衡的实时页面。它复用浏览器版的本地服务和 SQLite，不另建数据库，也不实现另一套采集器。

当前桌面入口面向源码仓库使用，不是签名安装包。

## 启动

需要 Node.js 24.0.0 或更高版本。

```bash
npm install
npm run desktop:install
npm run desktop
```

`desktop:install` 负责安装 Electron 运行组件。脚本默认使用 npmmirror；下载失败时可以重试，或通过 `ELECTRON_MIRROR` 指定其他镜像。

## 启动行为

- 已有元衡服务时，直接复用该服务。
- 没有服务时，启动本地 Web/API 服务并打开 `/live?surface=desktop`。
- 默认不执行本机采集，也不开启定时采集。
- 托盘菜单可以打开实时、看板、可信度和复盘页面。
- 退出时只停止由桌面小窗启动的服务，不影响用户另外启动的进程。

导入数据、补充复盘标签和导出报告仍建议在浏览器中完成。

## 数据与安全

桌面窗口只允许访问本机元衡页面：

- 不上传 token 数据；
- 不读取编辑器、终端或其他进程内存；
- 不在桌面壳中读取或保存 prompt、response、完整对话、diff 或命令正文；
- 不打开远程兜底页面；
- 拒绝新窗口和非本地导航。

## 图标

| 文件 | 用途 |
|---|---|
| `public/token-work-icon.png` | Windows/Linux 窗口图标 |
| `public/token-work-icon.icns` | macOS 应用与 Dock 图标 |
| `public/token-work-icon.svg` | Web 和 PWA 图标 |

开发运行时，macOS 可能短暂显示 Electron 进程名称或缓存图标。正式分发应使用打包后的 `.app`、`.exe` 或 Linux 应用包，并在构建阶段写入平台图标。

## 检查

```bash
npm run desktop:smoke
```

该命令检查 Electron 能否启动、加载本地页面并正常退出。发布安装包前还需要在目标系统上检查图标、托盘、窗口尺寸和关闭行为。
