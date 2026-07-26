# 快速打印使用固定 DS-RX1 Windows 桥并 fail closed

快速打印是排版任务中的可选副作用，开关默认关闭且不持久化。实机确认 Photoshop UXP 无法从当前 PSD 获得可重放的完整 Windows 驱动数据；读取或设置 `printSettings` 会依赖 Photoshop 当前/上一次打印机，并可能弹出“不支持此打印动作的格式”。因此插件不再校准、读取、修改或恢复 Photoshop 打印设置，也不调用 Photoshop `Print One Copy`。

插件把完成的 3600x2400 拼版另存为 UXP 数据目录中的临时 JPG 副本，写入 schema 版本化的 `.idprint` 作业，并通过 manifest 允许的 `.idprint` 文件关联启动一键安装的 Windows PowerShell 5.1 打印桥。桥接层只接受打印机名称精确为 `DS-RX1`、纸张名称精确为普通 `(6x4)`、份数为一且图片为 3600x2400 的作业；使用 `StandardPrintController` 无对话框提交一次，不自动重试。绘制固定按 600 PPI 输出为 600x400 个 1/100 英寸（6x4 英寸）并在驱动页面中居中，禁止适合介质或填满页面缩放；驱动页面小于实际尺寸时直接阻止打印。

找不到打印机、纸张或图片，作业字段不匹配，文件关联未安装，启动失败、结果异常或超时时均 fail closed。只有 `.result.json` 同时确认作业编号、打印机、纸张、份数与成功状态，插件才报告已打印。打印失败保留最终拼版并继续 JPG、NAS 和后续模板；视觉验收始终跳过打印。
