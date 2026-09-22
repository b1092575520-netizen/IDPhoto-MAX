# v0.5.7：冲印与索引合并启动

## 原因

v0.5.6 的 `layoutWorkflow` 先调用 `printOneCopy`，随后导出单张。索引提交或补设 Hidden 又通过 `archiveIndexOperation` 调用一次 `shell.openPath`，同一张拼版产生两次启动及权限请求。真实日志 `UXPLogs_2026-09-10_11-07-02_410825.log` 确认加载 0.5.6，15:22:41 和 15:26:57 出现索引请求 `User denied.`。

## 修复

先保存单张及准备完整索引暂存；当本次需要快速打印时，存档通过回调把索引操作附在同一个打印作业中。Windows 桥提交/隐藏索引后执行原有打印检查和打印流程，分别返回索引与打印结果。回调返回后，存档仅在索引确认成功时清理较小照片。

本次已尝试合并请求后，任何拒绝、失败或未知结果都不再触发备用独立启动。无需存档或存档在准备阶段失败时，仍走一次普通打印。单独导出继续使用一次索引请求。没有更改 Photoshop 权限设置或禁用系统确认。

取消打印准备时停止后续模板；此前已经保存的电子版保留。原片不改动，拼版关闭仍以打印成功为条件。

## 验证范围

自动化覆盖新建索引/重复保存与打印合并、每张拼版一次调用、失败不二次启动、取消中断后续模板、独立回执、索引失败保留 JPG。真实 Windows 合并作业提交隐藏索引后拒绝错误打印机，确认索引成功且 printed=false。实际权限窗口次数需新版面板加载后确认，代码调用数测试不能替代 UI 验收。

证据存放 `.tmp/single-permission-evidence/`。测试未操作用户照片或提交实物打印。

178 项测试及六阶段发布检查通过。使用生成的空白测试 JPEG 完成一次真实 DS-RX1 驱动 `RenderOnly` 合并作业：`renderedOnly=true`、`printed=false`、`archiveIndexResult.hidden=true`，见 `render-result.json`。

已将变化的 4 个运行文件原位部署至 Adobe 登记的 `com.fuqingyinxiang.idphoto.panel_0.5.2`，逐项哈希一致；本地桥同步更新，Adobe 登记文件未改。备份位于 `runtime-before/`，部署记录 `deployment.json`。安装包 `dist/IDPhoto-MAX-Setup-v0.5.7.exe`，SHA256 `515135eaa51c82142d3fdd30a23228b24f075580c9003de0e636c59c7444eaed`。未重启 Photoshop，新版面板加载及实际弹窗次数待用户保存照片并重启后确认。
