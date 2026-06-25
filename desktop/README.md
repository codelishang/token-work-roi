# 元衡桌面版

桌面版是元衡的一个本地小窗。它适合放在 Dock、任务栏或托盘里，随时看今天的 token 压力、预算状态和当前建议。

它不是另一个产品，也不会重新采集一套数据。桌面版打开的还是本机 `127.0.0.1` 上的元衡服务，只是把 `/live` 做成一个更顺手的小窗，并在菜单里放了看板、复盘和可信度入口。

## 启动

桌面版目前面向源码仓库使用，不是签名安装包。先安装源码依赖：

```bash
npm install
npm run desktop:install
npm run desktop
```

如果第一次启动时看到 Electron 下载失败，先运行一次 `npm run desktop:install`。安装脚本默认使用 Electron 官方下载源；国内网络需要加速时，可以显式设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

## 它会做什么

- 如果本地服务已经在运行，桌面版会直接复用它。
- 如果本地服务没有运行，桌面版会启动同一套 Web/API 服务。
- 默认不会开启定时采集，也不会在启动时写入新的本机记录。
- 托盘菜单可以打开实时、看板、复盘和可信度页面。
- 退出桌面版时，只会停止它自己启动的服务进程。

## 它不会做什么

- 不上传数据。
- 不读取 prompt、response、transcript、diff、命令正文或完整本机路径。
- 不在桌面壳里实现新的采集器。
- 不默认启用启动即采集或定时采集。
- 不把用户自定义预算说成服务商订阅额度。

## 图标

桌面版使用同一套元衡图标：

- Web/PWA 使用 `public/token-work-icon.svg`。
- Windows/Linux 窗口图标使用 `public/token-work-icon.png`。
- macOS 的 `.icns` 图标供后续打包发布使用。运行桌面版不会修改 `node_modules/electron`。

开发运行时如果系统仍显示 Electron 默认图标，不影响功能；正式桌面图标应在打包发布阶段处理。

## 发布说明

`npm run desktop` 是给源码用户使用的本地启动入口，不是签名安装包。以后如果要给普通用户分发桌面版，应单独通过 GitHub Release 发布 Windows/macOS/Linux 安装包或便携包。
