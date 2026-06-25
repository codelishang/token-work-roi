# 演示数据 / Demo Data

`token-work-demo.json` 是演示用合成数据，不是真实本机 AI 使用记录。

`token-work-demo.json` is synthetic demo data, not real local AI usage.

它不包含：

- prompt
- response
- 完整对话
- diff
- 命令正文
- 完整本机路径

It does not contain prompts, responses, full conversations, diffs, command bodies, or full local paths.

文件里有两部分：

- `usageSeed`：合成的 daily/session 用量数据。
- `annotationBackup`：用于演示导入导出的标注、产出链接和项目别名规则。

The file has two sections:

- `usageSeed`: synthetic daily/session usage rows.
- `annotationBackup`: annotations, output links, and project alias rules shaped like import/export data.

标注导入需要 SQLite 里已经有匹配的 session，因为标注通过 `device + source + session_id` 关联。

Annotation import expects matching sessions to already exist in SQLite because annotations are keyed by `device + source + session_id`.
