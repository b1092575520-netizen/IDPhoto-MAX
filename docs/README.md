# 项目文档

## 文档分区

- `CONTEXT.md`：项目术语和领域约束。
- `DEV_PROGRESS.md`：按版本记录的开发进度与实机验证结果。
- `CHANGELOG.md`：面向发布版本的变更记录。
- `TODO.md`：待处理事项与后续验证清单。
- `adr/`：已经确认的架构决策。

## 目录约定

- `src/`：插件运行时代码，按 `core`、`photoshop`、`ui` 分层。
- `tests/`：Node 内置测试及测试辅助 seam。
- `bridge/`：Windows DS-RX1 打印桥源码。
- `scripts/`：验证、打包、安装和 EXE 构建脚本。
- `_reference/`：信息条和拼版参考图目录；参考图不随发布包复制。
- `dist/`：本地生成的发布产物，不纳入 Git。
- `backups/`：本地安全备份，不纳入 Git。

## 清理原则

源码、测试、参考目录和决策文档保留在仓库中。`dist/`、`backups/`、运行时打印作业和本地缓存属于生成或机器相关内容，只保留在工作区并由 `.gitignore` 排除。
