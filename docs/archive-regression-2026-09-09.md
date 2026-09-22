# 电子版只剩空文件夹回归：v0.5.3

## 直接证据

- 用户报告刚冲印后只创建日期目录、没有电子照片。
- 本机安装目录的 `exportService.js` 与修复前工作区 SHA256 一致：`A4BB13968C4BB127996323B2340A1CA7AEF68DE2D8A94EDA034A6E9E16CBBD21`。
- Photoshop 实际日志 `C:\Users\Administrator\AppData\Roaming\Adobe\Adobe Photoshop 2026\Logs\UXPLogs_2026-09-09_10-48-16_415660.log` 第 848 行（10:51:48）：`[export] failed Error: Format must be storage.formats.utf8 or storage.formats.binary`。紧接着记录关闭处理后单张和已冲印拼版。
- `C:\Users\Administrator\Desktop\2026\2026-09\2026-09-09` 修改时间 10:51:48，含隐藏文件检查在内为 0 个文件。日志中本次原片 `\\192.168.0.50\picture\1M9A4950.JPG` 仍存在，6,901,721 字节。

## 原因与修复

v0.5.1 新增的存档索引使用字符串 `"utf8"`，而 UXP 要求 `storage.formats.utf8` Symbol。v0.5.2 保留了错误参数；索引写入与 JPG 保存共用失败回滚，导致索引报错后删除已成功保存的 JPG。原测试桩接受任意格式参数，而且错误地把删除新 JPG 视作索引失败时的正确结果。这是实现和验证共同引入的回归。

v0.5.3 修正索引读写参数；设置备份的缺省格式也不再退回字符串。将 JPG 保存和辅助索引分开处理：只有 JPG 保存自身失败才清理不完整文件；索引读取、创建、写入、替换失败，均保留新旧照片、暂停删除并给出明确提示。已有损坏索引不会被覆盖。正常情况下仍按原片、底色、近似比例保留最大像素照片；索引异常时可能保留额外照片，以免再次丢失电子版。

API 合同：[Adobe UXP storage](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-js/modules/uxp/persistent-file-storage/storage)。

## 验证与交付

- 先让测试文件系统严格校验格式 Symbol：修复前 21 项存档测试中 12 项失败，重现相同宿主错误。
- 修复后全套 167/167 通过，包含首次索引创建/写入/重命名失败仍保留完整 JPG，索引损坏保留照片，真正 JPG 保存失败保留旧照片，以及三底色两尺寸的最大像素保留规则。
- `npm.cmd run package:exe` 六阶段发布检查通过。
- EXE：`D:\codex\dist\IDPhoto-MAX-Setup-v0.5.3.exe`，SHA256 `55b9b2f086402337b857e4ca9dd4f4ed5db85c67a5bb0cb02ea7d55f0f74a4d5`。
- 本机安装的 34 个运行文件与工作区一致。替换前备份在 `backups/archive-v0.5.3-before-install/`。EXE 内 39 项与对应源码逐项一致。
- 本轮证据在 `.tmp/archive-regression-evidence/`，包含宿主错误、空目录核查、红绿测试、发布检查与文件一致性记录。

## 当前限制

已定位真实宿主失败并替换本机安装文件，但仍需保存当前工作后重启 Photoshop 才能加载新版。尚未完成新版在真实宿主中的照片导出验收：界面捕获曾报 `SetIsBorderRequired ... 0x80004002`。用户随后同意暂用 Photoshop 验证，但下一次 Computer Use 调用报告收到物理 Escape 停止信号，并要求停止本轮操作，已遵从。已准备不含打印调用、只写本次证据目录的 `verify-storage.psjs`，尚未执行。

没有触发新的冲印，没有关闭用户原片，没有恢复此前漏存的电子版。原片仍在；此前漏存文件不会随代码修复自动出现，需要重新导出。
