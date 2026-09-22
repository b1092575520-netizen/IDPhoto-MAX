# 再次漏存：重复安装与 v0.5.4 交付

## 发现与处理

用户重启后仍漏存。Photoshop 日志 `UXPLogs_2026-09-09_12-14-29_969568.log` 在 12:17:59、12:22:31 再次记录旧实现的 `Format must be storage.formats.utf8 or storage.formats.binary` 导出异常。

实际同时存在两个相同 manifest ID 的插件：

- `C:\Program Files\Common Files\Adobe\UXP\Plugins\External\com.fuqingyinxiang.idphoto.panel`，上轮仅更新此目录为 0.5.3。
- `C:\Program Files\Common Files\Adobe\UXP\Plugins\External\com.fuqingyinxiang.idphoto.panel_0.5.2`，2026-09-09 09:19:55 创建，仍含旧的格式参数与删除新 JPG 的回滚代码，SHA256 与已确认故障的旧实现相同。

上轮验证只比较了指定安装路径，没有检查 Photoshop 发现目录内的重复 ID；因此不能证明宿主加载的是已更新的文件。新代码把索引失败作为保留照片的告警处理，而本次日志仍是旧式导出异常，结合重复旧版本安装，解释了重启后继续漏存。

v0.5.4 的安装器按 manifest ID 扫描发现目录，将同 ID 的其他副本移至发现目录之外备份；保留其他插件，支持只读预览和重复执行。启动时记录实际版本和插件路径。

本机旧副本已移到：`C:\ProgramData\IDPhotoMAX\plugin-backups\com.fuqingyinxiang.idphoto.panel_0.5.2-bdbafab8f96b42ccab1700d7d66c9f7b`。发现目录现在仅有一份本插件；34 个运行文件与 v0.5.4 工作区一致。

## 验证与边界

- 168 项自动化测试通过，包括实际临时文件夹上验证重复安装迁移、无关插件保护、备份、预览无写入和重复执行。
- 真实 Photoshop 通过 COM `Application.ExecuteAction` 直接启动 UXP `.psjs` 验证，未调用打印。不能从 ExtendScript 再嵌套启动 UXP 脚本；一次该方式探测返回 8800，随后改用应用的直接接口。
- 真实 UXP 文件接口复现旧字符串格式错误；正确的 Symbol 参数完成索引读写与同目录覆盖替换。
- 最终验证将工作区实际 `photoshopExecution`、`pathService`、`photoVariantService`、`exportService` 代码直接嵌入 UXP 脚本。使用预先按明确像素单位创建并核对 ID 的两个合成文档，只注入输出根目录和合成身份/底色分组，不调用生产排版或打印。9 次导出（每组小、大、小）最终留下 3 个 JPG；独立 Pillow 解码确认均为 827×1157，且 JSON 索引可读。
- 该验证覆盖真实宿主里的存档实现，不代表已经完成当前外部插件重启加载后的完整按钮流程，也不代表真实 NAS 或物理打印验收。当前 Photoshop 进程仍可能持有旧版内存代码，需要保存工作后完整退出再启动。
- 证据：`.tmp/duplicate-install-evidence/host-export-result.json`、`installer-tests.log`、`release.log`、`runtime-check.txt`、`package-check.txt`。
- 安装包：`dist/IDPhoto-MAX-Setup-v0.5.4.exe`；SHA256 `00812db39456eb2199e9a74efc74579aabd7b6ba7c7dec38c69dc0dd31616636`。内嵌 39 项与源码对应一致。

## 验证操作事故与补存

首次临时验证脚本没有核对 `app.createDocument` 返回对象的真实 ID 与像素尺寸，得到前一活动文档对象并把它当作临时文档保存、关闭。结果误关了用户的 `1M9A4953.JPG` 分层文档。此前 `host-result.json` 中的 `ok:true` 只检查接口调用及非空文件，不能作为测试图正确性证据：独立解码发现 `host-sample.jpg` 实际是修图后的 827×1063 客户照片，而不是预期 64×64 测试图。本报告明确撤销该项 JPG 正确性结论。随后脚本创建文档也有滞后对象问题，最终改为原生接口按明确像素单位创建测试文档，核对真实 ID 和尺寸，再由 UXP 导出，测试文档由原生接口按 ID 和名称清理。

已将首次保存的完整修图后 JPG 补存并重新打开；第一张此前的分层状态未恢复，这是本次操作造成的损失。第二张 `1M9A4955.JPG` 保持打开，先另存分层 PSD，再补存 JPG：

- `C:\Users\Administrator\Desktop\2026\2026-09\2026-09-09\补存\1M9A4953_827x1063_补存.jpg`，554,245 字节，已目视检查内容与独立解码。
- `C:\Users\Administrator\Desktop\2026\2026-09\2026-09-09\补存\1M9A4955_827x1063_补存.jpg`，478,235 字节，独立解码为 827×1063。
- `D:\codex\backups\1M9A4955-before-verification.psd`，第二张分层备份。

补存保留当前原片尺寸与外观，没有冒充此前模板裁切后的精确电子版；未覆盖原始 JPG。所有本次创建的 Photoshop 测试文档已按已知 ID 和名称关闭，保留用户第二张分层文档和重新打开的第一张补存 JPG。
