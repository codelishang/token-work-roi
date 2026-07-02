# 桌面版说明

桌面版是源码仓库里的本地启动入口，不是签名安装包。它主要用来看实时页面；复盘、导入和报告导出仍建议在浏览器中完成。

## 适合场景

- 常驻查看近 24 小时用量。
- 从托盘打开实时、看板、复盘和可信度页面。
- 查看 burn rate、预算窗口和重模型提醒。

复盘、导入和导出仍放在浏览器里处理。

## 启动

```bash
npm install
npm run desktop:install
npm run desktop
```

安装脚本默认从 npmmirror 下载 Electron。若下载失败，可重新执行：

```bash
npm run desktop:install
```

启动后，桌面版会检查 `127.0.0.1` 上是否已有元衡服务。有就复用；没有就启动本地服务，并打开 `/live?surface=desktop`。

## 数据边界

桌面版只连接本机服务，不读取编辑器、终端或进程内存。

默认行为：

- 不上传数据。
- 不访问远程兜底页面。
- 不读取 prompt、response、transcript、diff、命令正文或完整本机路径。
- 不在桌面壳里实现新的采集逻辑。
- 不默认启用定时采集或启动即采集。

需要刷新本机结构化记录时，先确认采集边界，再在浏览器或命令行中手动执行。

## 页面关系

- `/live`：实时页面，桌面版默认打开。
- `/`：看板。
- `/trust`：可信度。
- `/review`：复盘。

桌面版只是打开这些页面，不复制业务逻辑。

## 图标

图标文件在 `public/`：

- `token-work-icon.svg`：Web、PWA、小尺寸界面图标。
- `token-work-icon.png`：Windows/Linux Electron 窗口图标。
- `token-work-icon.icns`：macOS Dock 和应用图标。

运行 `npm run desktop` 不会修改 `public/` 或 `node_modules/electron`。

## 发布

如果要面向普通用户分发桌面版，应通过 GitHub Release 单独发布 Windows、macOS、Linux 安装包或便携包。发布前至少跑桌面启动检查、隐私检查和基础截图检查。
