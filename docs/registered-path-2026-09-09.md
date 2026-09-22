# 重启后插件消失：v0.5.5 恢复已有 Adobe 登记

## 确认原因

2026-09-09 14:30:59 的真实 Photoshop 日志 `UXPLogs_2026-09-09_14-30-59_519277.log` 第 94–95 行明确报错：无法读取 `C:\Program Files\Common Files\Adobe\UXP\Plugins\External\com.fuqingyinxiang.idphoto.panel_0.5.2\manifest.json`，因此不能初始化插件。

`C:\Program Files\Common Files\Adobe\UXP\PluginsInfo\v1\PS.json` 的 `com.fuqingyinxiang.idphoto.panel` 登记路径正是 `$systemPlugins\\External\\com.fuqingyinxiang.idphoto.panel_0.5.2`。UPIA `/list all` 也报告此插件登记为 enabled、0.5.2。

此前把目录名中的 0.5.2 当作应清理的版本副本，移动了 Adobe 实际登记的位置。复制到不带版本号目录的代码并未更新 Adobe 登记数据库。这是前一轮实施与验收的错误：目录名不决定宿主实际使用的登记位置，文件一致性检查也不能替代登记及启动检查。

## 修复

- 已恢复上述准确登记路径，在其中部署 v0.5.5；34 个运行文件逐项与工作区相同。Adobe 登记文件保持原样，没有手工改写其其他插件条目。目录后缀仍为 0.5.2，但 manifest 和运行代码为 0.5.5。
- 更新器改为先读取唯一 Adobe 登记并校验路径边界，然后原位更新。取消按 manifest ID 自动移动目录的逻辑。无登记、登记不唯一或路径不支持时，在部署前停止。
- EXE 现在显示实际 PowerShell 错误内容，不再把所有失败一律说成 Photoshop 或打印驱动问题。
- 此 EXE 明确用于已有 Adobe 登记的升级。首次安装仍需通过 Adobe 的登记流程或 Developer Tool 开发加载，不把复制目录当成注册完成。

## Adobe 安装工具尝试与限制

已按 [Adobe 官方 UPIA 文档](https://blog.developer.adobe.com/en/publish/2022/03/how-to-install-uxp-plugins-using-command-line-tools) 尝试安装 CCX。UPIA 在此机报告 `Failed to install, status = -198!`，但进程退出码却为 0，因此没有把退出码视作成功。补齐缺失的用户 UXP 空目录后再次尝试仍返回 -198。没有反复重试或改写 Adobe 数据库，采用恢复已有合法登记位置的修复。

## 验证与交付

- 168 项自动化测试通过；新的真实文件夹测试覆盖版本后缀登记路径、缺失目录时仍选择登记路径、只读解析、未登记和路径越界拒绝。
- `npm.cmd run package:exe` 六阶段发布检查通过。
- 本机执行安装脚本 `-DryRun` 正确定位登记目录，登记文件哈希不变。
- 安装包 `D:\codex\dist\IDPhoto-MAX-Setup-v0.5.5.exe`，SHA256 `382df172dc4db2ab0f3e9cfe870737e9624c4ca2a81027b993834774c15d5be8`。
- 证据目录 `.tmp/registered-path-evidence/`。

## 宿主验收状态

已告知用户先保存未保存照片，再完整退出并重启 Photoshop。修复期间未关闭、修改或测试用户照片，未触发打印。新版实际加载路径和面板可见性需要以重启后的日志和界面确认；文件部署成功不等同于已经加载。
