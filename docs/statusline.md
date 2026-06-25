# 终端状态栏 / Statusline

`token-work statusline` 用来在终端里显示一行简短状态，例如最近 15 分钟用了多少词元、预算是否接近、有没有未处理建议。

`token-work statusline` prints one short line for a terminal prompt, tmux bar, script, or Claude Code statusline.

它只读本地 SQLite：

- 不扫描 AI 日志。
- 不运行 ccusage。
- 不启动后台服务。
- 不读取对话正文。

It reads local SQLite only. It does not scan logs, run ccusage, start a daemon, or read conversation content.

## 基本命令 / Basic Command

```bash
npx token-work statusline --format=text --window-minutes=15 --max-width=100
```

脚本使用 JSON：

```bash
npx token-work statusline --format=json --window-minutes=15
```

源码运行时，把 `npx token-work` 换成 `node src/cli.mjs`。

From a source checkout, replace `npx token-work` with `node src/cli.mjs`.

## Claude Code

把下面这条命令配置为 statusline 命令即可：

```bash
npx token-work statusline --format=text --window-minutes=15 --max-width=100
```

## tmux

```tmux
set -g status-right "#(npx token-work statusline --format=text --window-minutes=15 --max-width=80)"
```

## PowerShell Prompt

```powershell
function prompt {
  $ts = npx token-work statusline --format=text --window-minutes=15 --max-width=80
  "$ts PS $($PWD)> "
}
```

## 字段含义 / Output

| 字段 | 含义 |
|---|---|
| `tok` | 最近窗口内的词元数 |
| `burn` | 按当前速度折算的每小时词元数 |
| `cache` | 结构化事件里的缓存命中率 |
| `actions` | 未处理的建议数量 |
| `budget` | 自定义预算使用情况 |
| `reset` | 固定窗口下次重置时间，或滚动窗口长度 |
| `warn` | 当前最重要的提醒 |

预算只是自定义提醒，不是服务商套餐额度。

Budgets are custom reminders, not provider subscription quotas.
