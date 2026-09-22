# 存档索引自动隐藏（v0.5.6）

用户要求今后生成和更新的照片目录索引自动隐藏，而不只是手动修改一个文件。

## 实现与边界

`exportService` 将索引完整写入唯一暂存文件，通过已有 Windows 桥的 `commit-archive-index` 操作原子提交，提交前设置 Hidden、提交后检查 Hidden。原来的 UXP `moveTo(overwrite)` 对隐藏目标在真实 Photoshop 中报 `operation not permitted`，因此不能仅在原有写入后添加隐藏。

桥只接受索引专用暂存名称、版本 1 的索引内容和普通文件；拒绝任意文件名、未知操作和重解析点。目标固定为同目录 `.idphoto-jpg-index.json`。`hide-archive-index` 用于重复导出时补设既有索引属性。两种操作都在打印机查询和打印前返回，回执必须匹配作业 ID、操作名、hidden=true、printed=false。

照片仍先保存，索引提交失败保留照片并暂停清理；单独的隐藏失败不会删除照片或索引。只处理本插件的照片存档索引，不隐藏用户其他 JSON。

## 验证

- 自动化覆盖首次创建、隐藏目标替换、重复导出、属性失败、错误回执、拒绝照片和无效暂存内容。
- 真实 Windows 桥连续创建/替换隐藏索引，校验字节和 Hidden 属性；无效内容保留原索引。
- 真实 Photoshop UXP 能枚举和读取隐藏索引、写暂存；结合本地桥连续提交三次，均检查新内容和 Hidden。证据 `.tmp/hidden-index-evidence/verification.json`。
- 单独 `.psjs` 不具备插件 manifest 的 `.idprint` 启动权限，未把该脚本宣称为插件面板端到端验证。实际插件已有该扩展名权限及安装关联；脚本验证拆分为 UXP 文件操作和 CLI 调用同一桥。
- 测试未创建、修改、关闭任何 Photoshop 照片，未调用打印。新版运行代码需在 Photoshop 重新加载插件后生效。

## 部署

172 项测试及六阶段发布检查通过。安装包 `dist/IDPhoto-MAX-Setup-v0.5.6.exe`，SHA256 `a0d6a74abb53b2a9117630ec1459f30dbbd9fb7078d8222439cc938fd0a2daa4`。

已原位更新 Adobe 登记的 `com.fuqingyinxiang.idphoto.panel_0.5.2` 目录中的 4 个变化文件，逐项哈希一致；本地桥与源码一致，Adobe 登记文件哈希保持不变。更新前文件保存在 `.tmp/hidden-index-evidence/runtime-before/`，桥备份为 `bridge-before.ps1`。桌面 2026 照片树中的 2 个既有索引已补设 Hidden。部署证据为 `deployment.json`；没有重启 Photoshop，当前进程尚需重新加载新版代码。
