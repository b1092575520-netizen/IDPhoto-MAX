# Photoshop 证件照排版 MAX UXP 插件开发进度

## 2026-07-18 v0.4.9 DS-RX1 实际尺寸打印

- 用户实机确认快速打印已出纸，但照片被缩放铺满页面；期望与 Photoshop 打印设置中 100% 实际尺寸、居中且不勾选“缩放以适合介质”一致。
- 只读查询确认 DS-RX1 的 `(6x4)` 上报为 615×413 个 1/100 英寸，而拼版实际 6×4 英寸应为 600×400；旧桥把整图绘制到 615×413，造成约 2.3% 放大。
- 打印桥改为按 3600×2400 / 600 PPI 计算 600×400 实际尺寸矩形，并在驱动页面内居中；页面小于实际尺寸时 fail closed，不裁切也不缩小。
- 用真实作业完成 `RenderOnly` 无出纸回放，DS-RX1 队列前后均为零；针对性测试锁定实际尺寸和禁止铺满页面。

## 2026-07-18 v0.4.8 首次启动无文档弹窗修复

- Photoshop 首次启动且没有打开照片时，设置页初始化仍会尝试读取当前相机信息。
- DOM 已正确返回无活动文档，但旧逻辑随后继续调用 `batchPlay get target document`，Photoshop 在 JavaScript 捕获异常前显示“命令‘获取’当前不可用”宿主窗口。
- 在文档信息入口增加无活动文档短路；无论初始化链路被触发几次，都不会再发送该命令。
- 回归测试确认无文档时 `batchPlay` 调用数为 0，同时保留活动文档 DOM 信息不完整时的兜底读取。

## 2026-07-18 v0.4.7 Windows DrawImage 重载修复

- 插件 v0.4.6 已正常出现并生成 `.idprint`，用户允许权限后桥接窗口闪退且没有出纸。
- 对应 `.result.json` 精确记录 PowerShell 无法把 `RectangleF` 转换为 `Rectangle`；DS-RX1 队列为空，失败发生在提交前。
- 将共享填充绘制改为整数 `Rectangle` 重载，打印事件和离线回放复用同一函数。
- 新增 `RenderOnly` 模式，用用户失败的真实 3600x2400 作业、DS-RX1 和普通 `(6x4)` 完成无出纸渲染，队列继续为零。

## 2026-07-18 v0.4.6 第三方 manifest host 格式修复

- v0.4.5 已正确安装到系统 UXP `Plugins\External`，旧 Photoshop `Plug-ins` 副本也已删除，但重启后仍未显示。
- 13:13 的 Photoshop 27.4 UXP 日志精确报错：第三方插件的 `host` 应为对象，随后 `Failed to parse the manifest.json file`。
- 将 manifest `host` 从数组改为 `{ app: "PS", minVersion: "25.0.0" }`，安装器版本读取同步更新。
- 本机已正常加载的飞鱼图灵第三方插件 manifest 同样使用 host 对象，和日志要求一致。
- 新增第三方文件系统发现 manifest 格式回归测试。

## 2026-07-18 v0.4.5 UXP 安装发现目录修复

- 用户实机安装输出显示文件被复制到 `Adobe Photoshop 2026\Plug-ins`，但 Photoshop“增效工具”中没有插件。
- 安装文件、manifest 和开发模式配置均存在且正确；Photoshop 27.4 的 UXP 启动日志明确列出系统、用户和混合三个 `Adobe\UXP\Plugins\...\External` 发现目录，完全不扫描传统 `Plug-ins` 目录。
- 安装器改为部署到系统级 Adobe UXP `Plugins\External`，并清理 v0.4.4 留在 Photoshop `Plug-ins` 的错误副本。
- 新增正确发现目录回归测试；安装器 DryRun 必须显示 UXP 目标和旧副本清理目标。

## 2026-07-18 v0.4.4 Windows DS-RX1 固定打印桥

- 实机确认 PSD 的 `printOutput` 不包含可回放的 `osSpecificPrintInfo`，因此 v0.4.3 校准完整性判断无法通过；问题不是用户操作方式。
- 删除设置页校准卡片以及全部 Photoshop `printSettings` 读取、设置、校准、打印和恢复逻辑。
- 插件将最终 3600x2400 拼版另存为临时 JPG，并通过 `.idprint` 文件关联调用 Windows 打印桥；只在 `.result.json` 明确确认后报告成功。
- Windows PowerShell 5.1 桥固定校验 `DS-RX1`、普通 `(6x4)`、一份和 3600x2400 像素，使用 `StandardPrintController` 无对话框提交，不自动重试。
- 一键安装器部署桥到 `ProgramData\IDPhotoMAX` 并注册 `.idprint`；安装前通过 `ValidateOnly` 检查本机打印机和纸张，DryRun 不写系统。
- 桥接失败继续保留最终拼版，不阻断 JPG、NAS 或后续模板；视觉验收继续强制 `skipPrint: true`。

## 2026-07-18 v0.4.3 DS-RX1 完整驱动配置校准

- 实机日志确认信息条在 `10:31:28` 已完成，打印步骤到 `10:31:40` 才返回；对话框由打印设置切换触发，不是信息条错误。
- 根因是 v0.4.2 删除 `osSpecificPrintInfo` 后合成 DS-RX1 设置，Photoshop 将其判定为不受支持的打印动作格式。
- 设置页新增一次性 DS-RX1 校准，保存 Photoshop 当前返回的完整本机驱动配置；当前已是 DS-RX1 时快速打印也会自动更新配置。
- 无配置且当前为其他打印机时不再调用 `set printSettings`，只返回校准提示；有完整配置时才自动切换、验证、打印和恢复。
- 打印配置独立保存在本机 localStorage，不进入跨电脑设置备份。

## 2026-07-18 v0.4.2 快速打印主动选择 DS-RX1

- 快速打印不再要求 Photoshop 最后一次打印机预先为 DS-RX1；当前为其他设备时先修改当前拼版文档的 `printSettings`。
- 修改后重新读取并严格确认 `printerName`，只有 DS-RX1 才提交一份，切换被忽略或报错时 fail closed。
- 切换时移除来源打印机的 `osSpecificPrintInfo`，避免跨驱动复用私有数据；提交后恢复原 Photoshop 打印设置。
- 新增主动切换、二次验证、设置恢复、切换失败和恢复失败测试，原有打印失败隔离保持不变。

## 2026-07-18 v0.4.1 DS-RX1 专用快速打印

- 本机 Photoshop 2026 可执行文件和中文资源确认存在 `printOneCopy` / `Print One Copy` 命令。
- 新增 `printService`，先读取活动拼版文档 `printSettings.printerName`，严格匹配 `DS-RX1` 后才无弹窗打印一份。
- 打印机不匹配、名称缺失或打印命令异常均 fail closed，不影响已生成版面、JPG/NAS 和后续模板。
- 排版页新增会话级快速打印开关，Reload 后默认关闭；开启时主按钮改为“开始排版并打印”。
- 全模板视觉验收同时强制跳过 JPG、NAS 和打印。
- 打印 module、排版任务集成和 UI 静态约束已加入自动化回归测试。

## 2026-07-16 v0.4.0 架构收拢与本地发布

- 将完整排版事务从 `main.js` 收拢到 `layoutWorkflow`，临时文档清理由同一个 module 统一负责，并覆盖成功、画布失败、拼版失败和导出失败路径。
- 将七个 Photoshop module 的直接执行统一迁移到 `photoshopExecution` seam，保留现有宿主执行语义。
- 将分散设置迁移到 `schemaVersion: 1` 档案，新增 UXP JSON 备份/恢复；NAS 持久令牌继续独立保存，不进入备份。
- 设置恢复后同步刷新店铺文字、裁切策略、本店相机、NAS 标签和调试状态，并清空运行时模板覆盖。
- 新增全模板视觉验收：一次生成 11 个 Photoshop 拼版文档，强制关闭 DEBUG 标记并禁止 JPG/NAS 写入。
- 新增 `verify-release.ps1`、`package-plugin.ps1`、`install-plugin.ps1` 和一键 CMD；安装器已通过 PowerShell 5.1 解析与 DryRun。
- 为排版事务、Photoshop 执行、设置档案、备份恢复、视觉验收与发布脚本补充自动化回归测试。

## 2026-07-15 v0.3.14 Photoshop 27 文档旋转修复

- 根据实机弹窗复现 `rotateEventEnum` 缺少 `_target` 时的“命令‘旋转’当前不可用”。
- 对照本机 Photoshop 27 自带 UXP 运行时代码，确认文档旋转必须显式传入当前活动文档引用。
- 修正文档旋转 batchPlay 描述符并加入实机错误回归测试。
- 实机复测确认“选择主体”会显示耗时进度条，并把肩膀/裙子宽度用于扩图判断，导致 1寸结果人物明显缩小。
- 已删除自动“选择主体”服务和脚本加载，排版前不再运行 Photoshop 主体查找。
- 自动模式改为目标比例分流：非正方形横图居中裁左右、竖图保留顶部裁下方；1:1 正方形自动内容识别补边。
- `6960x4640 -> 1寸 2.7x3.8` 已加入回归测试，确认裁切宽度约 3297px、主体识别调用为 0、自动扩图调用为 0。
- 定位方形补边竖直接缝根因：内容识别选区原本精确停止在原图边界，缺少供 Photoshop 重建过渡的原图像素；现按短边 1.5%（12-96px）向内重叠，并覆盖横向、纵向及本轮 `1280x1918` 原图尺寸。

## 2026-07-15 v0.3.13 默认参数固化、结婚证方向与自动扩图

- 从 UXP localStorage 读取用户已验收的 9 组调试覆盖，并固化到 `templateRegistry.js`；保留调试覆盖以便继续微调。
- 结婚证竖向源图在比例检测时按旋转后的宽高计算，并在临时处理文档合成、裁切和缩放前自动旋转 90°。
- 定位错误裁切根因：当前本地策略仍保存为 `crop`，因此未进入内容识别服务；默认与旧环境首次迁移均改为 `auto`。
- 自动模式链路固定为内容识别填充扩图优先，Photoshop 填充失败才回退居中裁切。
- 新增方向检测、实际画布旋转、策略迁移、扩图优先级和默认模板参数测试。

## 2026-07-15 v0.3.12 联系方式补充与调试变换修复

- 小2寸从店名/日期双列调整为店名+日期右列、联系方式左列；香港台湾增加第三行联系方式。
- 定位调试自由变换失效根因：竖排多字符图层的总高度被错误换算为单字 point 字号。
- 调试保存改为保留 Photoshop 实际字号与变换后 bounds，下一次渲染按目标宽高精确缩放。
- Photoshop 未暴露字号时只保存几何 bounds，避免生成错误的大字号覆盖。
- 补充调试参数标准化与变换后尺寸重建测试。

## 2026-07-15 v0.3.11 信息条参考图校准

- 以 `_reference` 中 8 张待改模板图为唯一视觉标准，测量信息条边界、文字像素包围框、字段分组和方向。
- 标准2寸、巴西、毕业证改为店名与日期同列，电话独立一列；小2寸按参考图只保留店名和日期两列。
- 签证2寸改为店名与日期同行、电话第二行；香港台湾按参考图只保留店名和日期。
- 阿根廷补回参考图中的提示语并修正底条高度；结婚照修正底条高度和三行字号。
- 1寸与美签 5.1 按用户实测保持原配置，美签 5.0 无信息条保持不变。
- 8 个模板的字号、坐标、方向和字段组合已加入自动化回归测试。
- 调试模式现已识别并保存 `shopNameDate` 复合文字层，用户可逐模板实机微调后再将覆盖值固化回注册表。

## 2026-07-15 v0.3.10 按比例保留最大单张 JPG

- 去重范围从单纯原片文件名调整为“原片文件名 + 宽高比四舍五入两位”。
- 同组只保留像素面积最大的 JPG，较大尺寸会在保存成功后替换较小文件。
- 1寸与标准2寸归为近似比例组；1:1美签单独保留。
- 新文件名记录实际像素尺寸，旧格式仍可通过模板注册表识别。

## 2026-07-15 v0.3.9 单张 JPG 去重

- 同一天、同一输出目录内按原片文件名识别重复单张 JPG。
- 同一原片选择多个尺寸时只保存第一次选中尺寸生成的一份 JPG，其余拼版仍正常生成。
- 重复执行以及已有 `_2`、`_3` 历史文件均会被识别并跳过。
- 不同原片文件名保持独立导出，不引入人脸识别依赖。

## 2026-07-14 v0.3.8 换底模块下线

- 批量排版完成汇总后自动取消全部尺寸按钮选中状态，不再要求用户逐一点击取消。
- 双击尺寸立即执行不再依赖 UXP 是否派发原生 `dblclick`：第二次 click、原生 dblclick 和连续普通 click 均兼容，并在 700ms 内去重。
- 修复画布内复制信息条头像造成的层级错误：显式将头像提升到最顶层，保证随后创建的文字图层位于信息条背景和照片图层之上。
- 信息条小头像直接从当前拼版画布的第一张照片本地复制，去掉信息条阶段的第二次跨文档照片复制。
- Photoshop DOM 裁切改用包含 `left/top/right/bottom` 的矩形对象，消除每次比例不符时的失败调用与 `batchPlay` 回退。
- 继续优化批量排版：照片复制和信息条文字创建在单次任务内复用目标图层 ID 快照，同时保留每次操作后的唯一新图层校验。
- 批量排版性能优化：照片跨文档复制由每个槽位一次降为每个模板一次，其余槽位使用目标画布内复制。
- 图层服务和信息条渲染跳过重复文档激活，图层已在目标坐标时不再执行空移动。
- 尺寸按钮现在直接点选或取消，多选按点击顺序批量排版；Shift 仍支持连续范围选择。
- 双击尺寸按钮保留当前多选并立即执行，不再等待 180ms 单击计时器。
- 删除换底/去底主界面、Photoshop 服务、快捷键、图标及专属测试。
- 保留排版、裁剪、信息条、JPG 导出和 NAS 归档功能。

## 2026-07-13 v0.3.7 导出与配置一致性修复

- 同名 JPG 改为自动追加序号，保存失败时清理不完整文件。
- NAS 设置支持选择、更换、清除授权并显示当前状态。
- 未实现的生成式拓展已从 UI 和执行链移除，旧设置迁移为内容识别填充。
- 拼版成功与 JPG 导出失败分开汇总。
- Ctrl/Command 多选按用户点击顺序执行。

## 2026-06-07 换底、多选与文档保留修复

- 换底现在始终在源照片副本中执行，成功后保留新文档，原照片不变。
- 已修复合并副本 DOM 图层 ID 失效：后续重命名、蒙版、背景层移动和结果校验均使用 Photoshop 实时返回的 `layerID`。
- 去底统一使用 Select Subject + 蒙版，不再尝试未经实机验证的 `removeBackground` fallback。
- Photoshop 返回错误描述符时立即停止，失败副本自动关闭并恢复源文档；诊断日志输出完整 JSON。
- Ctrl/Command 多选和 Shift 范围多选改为按下时捕获修饰键，避免 UXP 延迟点击丢失状态。
- 临时文档关闭前会先激活自身，关闭后恢复拼版画布焦点，避免误关成品。
- 美签 5.1 显示文案改为“美签 51mm / 正方形”。

## 2026-06-07 稳定性基线修复

- 图层复制现在以目标文档完整图层 ID 快照为准，无法确认唯一新图层时立即失败。
- 照片和信息条头像已共用同一复制 interface；拼版结束前校验图层 ID 唯一和槽位数量。
- 图层移动 fallback 会按最新 bounds 重算偏移，最终误差超过 2px 时不再静默放行。
- 未完成拼版画布在布局或信息条失败时关闭且不保存；导出失败仍保留完成的拼版。
- 排版和换底已共用 Photoshop 写操作锁。
- 已增加 Node 24 内置测试，不引入第三方测试依赖。

## 项目名称

Photoshop 证件照排版 MAX UXP 插件

## 当前阶段

当前阶段 v0.5.8：通用尺寸近似比例去重、独立持久身份记录和日期目录默认排序；当前证据见 `docs/archive-2026-09-18.md`。更新器继续保留 Adobe 登记路径；此前登记修复及存档事故记录保留在 `docs/registered-path-2026-09-09.md`、`docs/duplicate-install-2026-09-09.md` 与 `docs/archive-regression-2026-09-09.md`。

当前 UI 原型、SVG 图标、快捷键、文档读取、比例检测、单张处理、6 寸画布、全部模板排版主干、信息条入口、单张 JPG 导出入口和 NAS 日期归档入口已经接入。本轮已停止算法猜测式拼版，改为严格以 `D:\codex\_reference\` 内 JPG 模板图为唯一布局标准。

## 2026-05-16 全面排查与关键修复

- 已按插件加载、UI、模板、拼版、信息条、Photoshop API、性能、导出/NAS、快捷键方向完成静态排查。
- `manifest.json` 已通过 JSON 解析检查。
- `index.html` 当前脚本加载顺序正确，核心服务均在 `src/main.js` 之前加载。
- `src/**/*.js` 已通过 `node --check` 语法检查。
- 11 个模板已通过静态 layout 校验：模板数量正确、`photoSlots.length` 与生成数量一致、槽位不越界、信息条不越界。
- 本轮未发现明确 P0。
- 已修复 P1：生成式拓展在 UXP descriptor 未稳定前改为无副作用 fail-fast，交给内容识别扩图/默认裁切 fallback，避免先改临时文档后重复扩图。
- 已修复 P1：特殊模板图层旋转在 `layer.rotate` 失败或不可用时 fallback 到 batchPlay `transform` 旋转。
- 已修复 P1：信息条小头像默认改为等比例 contain 缩放并居中，避免缩略图被裁掉或超出头像框。
- 本轮未改 UI 结构、未改 11 个模板照片槽位、未改正常拼版坐标。
- 仍需实机验证：Photoshop 27.4.0 中的复制图层、旋转、文字图层、JPG 保存、NAS 授权目录和全模板信息条视觉效果。

## 2026-05-16 非图像层源修复与批量/调试功能

- 修复当前活动图层为文字层、空图层、调整层时拼版源错误的问题。
- `src/photoshop/cropService.js` 现在先复制源文档为处理后单张临时文档，再在临时文档内生成完整可见画面的拼版源像素层。
- `src/photoshop/documentService.js` 新增 `prepareCompositeSourceLayer`、`createStampedVisibleLayer`、`cleanupTempSourceLayer`；优先在临时文档内 flatten 可见画面，失败时 fallback 到 copy merged / paste 盖印可见层。
- `src/photoshop/layerService.js` 不再直接拿当前活动图层当拼版源，优先查找 `证件照拼版源_盖印可见`，再使用临时文档扁平后的单层/背景层。
- 新增尺寸按钮多选：单击单选，Ctrl/Command + 单击追加或取消，Shift + 单击连续范围选择。
- 多选执行时按选中顺序依次生成多个拼版文档，单个尺寸失败不会中断剩余尺寸，状态栏显示已完成数量和失败项。
- `src/core/templateRegistry.js` 新增模板 `shortName` / `documentLabel`，批量文档名使用尺寸短名，如 `证件照排版_1寸_日期`。
- 新增开发者调试模式：`src/core/debugSettingsStore.js` 保存开关和模板覆盖参数，`src/core/templateOverrideService.js` 合并默认模板和当前模板覆盖参数。
- 店铺参数设置页新增调试面板，可调当前模板的 infoBar、avatar、textBlock、lineGap 和字体大小；可应用到当前模板、保存、重置。
- 调试覆盖只影响当前模板，不改 `templateRegistry` 默认模板和照片槽位；关闭开发者模式后仍使用已保存覆盖参数但隐藏面板。
- 本轮 `src/**/*.js` 已通过 `node --check`；`index.html` 已确认加载全部 JS；模板覆盖静态 layout 检查通过。

## 2026-05-03 模板图驱动布局变更

- 拼版参考源固定为 `D:\codex\_reference\`。
- `ui-target.png` 只用于 UI 视觉参考，不参与拼版算法。
- 11 个业务尺寸均已接入 JPG 参考模板。
- `src/core/templateRegistry.js` 已为每个模板硬编码 `referencePath`、`photoSlots`、`infoBar`、`layoutMode`。
- `src/core/layoutEngine.js` 不再根据可用宽高、行列间距、信息条预留区自行推导数量和坐标。
- `layoutEngine` 当前只读取 `template.photoSlots` 和 `template.infoBar` 生成排版计划；如果模板缺少 `photoSlots`，直接报错，禁止自行猜布局。
- UI 中的行距/列距当前只保留状态与日志记录，模板图驱动布局不会用它们改动参考坐标。
- `src/photoshop/layerService.js` 继续负责按 `photoSlots` 的 `x/y/rotate` 放置照片，并输出每张照片的目标坐标和槽位尺寸。
- `src/photoshop/infoBarRenderer.js` 已改为按模板 `infoBar` 的实际区域尺寸调整文字起点、字号和行距。

## 当前参考模板接入状态

| 业务模板 | 参考图 | photoSlots | infoBar |
| --- | --- | ---: | --- |
| 1寸 2.7x3.8 | `2.7x3.8.jpg` | 10 | bottom `0,1845,3592x555` |
| 标准2寸 3.5x4.9 | `3.5x4.9.jpg` | 8 | right `3400,0,200x2400` |
| 签证2寸 3.5x4.5 | `3.5x4.5.jpg` | 8 | bottom `0,2174,3600x226` |
| 小2寸 3.3x4.8 | `3.3x4.8.jpg` | 8 | right `3239,0,361x2400` |
| 香港台湾 3.0x4.0 | `3x4.jpg` | 8 | bottom `0,1950,3592x450` |
| 巴西 4.0x5.0 | `4x5.jpg` | 6 | right `2916,0,273x2400` |
| 阿根廷 4.0x4.0 | `4x4.jpg` | 6 | bottom `0,1945,3600x455` |
| 美签 5.0x5.0 | `5x5.jpg` | 6 | none |
| 美签 5.1x5.1 | `5.1x5.1.jpg` | 2 | bottom `0,1230,3590x556` |
| 毕业证 4.0x5.5 | `4x5.5.jpg` | 5 | right `2943,0,273x2400` |
| 结婚照 5.3x3.5 | `3.5x5.3.jpg` | 5 | bottom `0,1845,3592x555` |

当前没有缺失业务尺寸参考图。后续新增尺寸必须先补 JPG 模板图，再接入 `photoSlots` 和 `infoBar`。

## 2026-05-03 v0.3.1 专项修复

- 1寸 2.7x3.8 底部信息条已作为稳定基准专项修复。
- 1寸照片槽位未改动，仍严格使用 `2.7x3.8.jpg` 提取的 10 个 `photoSlots`。
- 1寸 `infoBar` 当前配置：
  - 背景：`x=0, y=1845, width=3592, height=555`
  - 小头像/占位：`x=24, y=1924, width=304, height=430`
  - 店铺名称：`x=365, y=2010, fontSize=13`
  - 日期：`x=365, y=2115, fontSize=11`
  - 电话：`x=365, y=2242, fontSize=10`
  - 提示语：`x=365, y=2350, fontSize=9.5`
- 修复信息条不可见问题：文字层改为读取模板显式 baseline 坐标，字号改为适合 3600x2400 / 600ppi 画布的较大点数。
- 修复小头像占位黑块问题：占位从通用 120px 深色小块改为 304x430 浅红占位和浅黄色边框。
- `src/photoshop/infoBarRenderer.js` 已优先读取 `infoBar.texts`，并保留边界日志；通用布局只作为其他未显式定义模板的 fallback。
- 已删除插件内部顶部无用装饰/占位模块：小圆点、装饰栏和菜单占位不再显示。
- 已删除主界面“间距微调”模块：行间距滑杆、列间距滑杆、px 数值框和对应事件绑定不再暴露。
- 状态栏不再显示行间距 / 列间距；内部默认 `rowGap/colGap` 仅保留给兼容调用和旧日志。
- 执行链路仍会创建一个处理后单张临时文档用于裁切、扩图、导出和复制图层，但主流程结束后会自动关闭，不保存，不留在 Photoshop 标签栏。
- 如果裁切/画布/拼版/导出中途失败，已在失败分支尝试关闭处理后单张临时文档。
- 店铺参数设置页新增“裁剪与扩图策略”：
  - 默认裁切
  - 内容识别填充扩图
  - 自动模式
- 裁剪策略保存到 `localStorage`，由 `src/core/cropStrategyStore.js` 统一读写；执行时也会读取当前 UI 选择。
- fallback 顺序：
  - 自动模式：非正方形无识别快速裁切；1:1 正方形自动内容识别补边
  - 内容识别填充扩图：内容识别填充扩图 -> 安全裁切
  - 默认裁切：无识别快速裁切，不自动补边
- 店铺参数设置页新增“快捷键设置”中心，当前显示完整快捷键表，后续再扩展为可配置。
- 当前没有实现真正 Photoshop 全局快捷键注册。现有快捷键仍是插件面板获得焦点时可用；输入框获得焦点时不会触发。Photoshop 全局绑定后续需要研究 UXP command/menu command 与宿主快捷键系统的兼容性。
- 信息条渲染改为完全读取 `template.infoBar`，不在 renderer 中猜位置。
- 信息条渲染现在会创建深红背景块、浅黄色文字和小头像占位，并输出边界日志：
  - template id
  - infoBar enabled / position / orientation
  - infoBar x/y/width/height
  - canvas width/height
  - 每个文字图层 x/y
  - 是否越界
- 信息条文字创建改为 batchPlay 绝对坐标 `textClickPoint`，避免 DOM `translate` 把文字移到不可见区域。

## 2026-05-03 中断恢复检查

- 当前目录不是 Git 仓库，无法使用 `git diff` / `git status` 查看版本差异；已改用文件列表、时间戳、语法检查和模块加载检查确认状态。
- `src/**/*.js` 已通过 `node --check` 语法检查。
- `manifest.json` 已通过 JSON 解析检查。
- `src/photoshop/layerService.js` 是完整 IIFE 文件，没有半截代码。
- `src/core/layoutEngine.js` 是完整 IIFE 文件，没有半截代码。
- `index.html` 已加载当前所需脚本：`errorService`、`pathService`、`cropService`、`layerService`、`infoBarRenderer`、`exportService` 等。
- 11 个模板的布局坐标静态检查已通过：每个模板都有可用位置，坐标不越界，坐标不重复。
- 当前仍在专项修复“照片堆叠在同一位置 / 数量不对”的实机 bug；已加入布局和图层放置调试日志。

## 当前已完成

- UXP 插件基础结构
- 深色紧凑型侧边工具面板 UI
- 本地 inline SVG 图标系统
- 主界面与店铺参数设置页
- 尺寸按钮、输出开关、状态栏
- 面板内快捷键
- `src/core/templateRegistry.js` 全部尺寸模板注册，并已接入参考图 `photoSlots` / `infoBar`
- `src/core/ratioChecker.js` 1% 容差比例检测
- `src/core/layoutEngine.js` 全部尺寸模板图驱动排版计划
- `src/core/dateService.js` 自动当天日期
- `src/core/pathService.js` 日期目录与 JPG 命名
- `src/core/settingsStore.js` 设置页 localStorage 暂存
- `src/core/errorService.js` 错误文本工具
- `src/photoshop/documentService.js` 当前活动文档读取
- `src/photoshop/cropService.js` 复制源文档、快速构图裁切/跳过裁切、处理为模板尺寸
- `src/photoshop/canvasService.js` 创建 3600x2400px / 600ppi 6 寸画布
- `src/photoshop/layerService.js` 复制处理后照片到拼版画布
- `src/photoshop/layerService.js` 已加入 duplicate / move 详细日志，先用 DOM `translate` 并校验 final bounds，未到目标位置时 fallback 到 batchPlay move
- `src/photoshop/infoBarRenderer.js` 绘制右侧/底部信息条文字入口
- `src/photoshop/exportService.js` 单张 JPG 导出与 UXP 文件夹授权入口
- `manifest.json` 已声明 `localFileSystem: request`，用于 UXP 输出目录授权
- 主执行入口统一为：读取文档 -> 比例检测 -> 单张处理 -> 创建 6 寸画布 -> 排版复制 -> 信息条 -> 单张 JPG 导出
- `src/core/layoutEngine.js` 已输出 referencePath / rows / cols / count / area / 每张照片 row、col、targetX、targetY、rotate 调试信息

## 已接入的模板主干

- 1寸 2.7x3.8：参考图 10 张，底部信息条
- 标准2寸 3.5x4.9：参考图 8 张，右侧信息条
- 签证2寸 3.5x4.5：参考图 8 张，底部信息条
- 小2寸 3.3x4.8：参考图 8 张，右侧信息条
- 香港台湾 3.0x4.0：参考图 8 张，底部信息条
- 巴西 4.0x5.0：参考图 6 张，右侧信息条
- 阿根廷 4.0x4.0：参考图 6 张，底部信息条
- 美签 5.0x5.0：参考图 6 张，不加信息条
- 美签 5.1x5.1：参考图 2 张，底部信息条
- 毕业证 4.0x5.5：参考图 5 张，上排正常、下排旋转，右侧信息条
- 结婚照 5.3x3.5：参考图 5 张，2x2 正常加右侧旋转，底部信息条

## 当前仍未接入或待实机验证

- 自动裁切不依赖主体识别；仍需用横图、竖图和不同头顶留白照片做实机构图验证
- NAS 目录使用 UXP 文件夹授权/持久 token 方式，可在设置页更换或清除
- 特殊模板旋转依赖 Photoshop 图层 `rotate` 能力，需要实机验证
- JPG 保存依赖 Photoshop DOM `saveAs.jpg`，需要实机验证
- 裁切/改尺寸 DOM 失败后会 fallback 到 batchPlay，但仍需 Photoshop 27.4.0 实机验证 descriptor 兼容性

## 重要业务规则摘要

- 一个版面只放一种尺寸，不混拼
- 纸张固定 15.24cm x 10.16cm
- 分辨率固定 600ppi
- 画布像素约为 3600 x 2400px
- 原始照片不直接修改，先复制为处理后单张文档
- 比例 1% 内视为符合并跳过裁切
- 比例不符时非正方形横图居中裁左右、竖图保留顶部裁下方；1:1 正方形自动补边
- 处理后单张按模板物理尺寸和 600ppi 输出
- 排版时不再缩放照片，只复制处理后单张
- 常规模板不旋转
- 只有毕业证、结婚照使用特殊旋转排法
- 拼版成品默认不保存
- 默认导出处理后单张 JPG
- NAS 日期归档受 UXP 文件夹授权限制
- 日期每次执行时实时读取系统当天日期

## 快捷键表

面板获得焦点时可用。输入框或 textarea 获得焦点时不会触发快捷键。

| 快捷键 | 动作 |
| --- | --- |
| 1 | 选择 1寸 2.7x3.8 |
| 2 | 选择 标准2寸 3.5x4.9 |
| 3 | 选择 签证2寸 3.5x4.5 |
| 4 | 选择 小2寸 3.3x4.8 |
| 5 | 选择 香港台湾 3.0x4.0 |
| 6 | 选择 巴西 4.0x5.0 |
| 7 | 选择 阿根廷 4.0x4.0 |
| 8 | 选择 美签 5.0x5.0 |
| 9 | 选择 美签 5.1x5.1 |
| 0 | 选择 毕业证 4.0x5.5 |
| - | 选择 结婚照 5.3x3.5 |
| Enter | 执行当前模板 |
| Ctrl + Enter | 执行当前模板并强制尝试导出单张 JPG |
| J/N | 切换 JPG 导出 / NAS 归档 |
| A/S | 自动排版大师 / 店铺参数设置 |

## 下一步建议

先在 Photoshop 27.4.0 中做全模板实机联调，重点验证裁切/改尺寸 API、图层复制、特殊模板旋转、信息条文字创建、JPG 导出和 NAS 授权目录。

## 后续开发启动约定

每次继续开发前，先读取：

- `DEV_PROGRESS.md`
- `TODO.md`
- `CHANGELOG.md`
## 2026-07-24 v0.5.0 UI 收尾与 EXE 安装包

- 完成窄面板交互收尾，删除底部“排版 / 设置”悬停切换，保留明确点击切换，避免鼠标经过时误触。
- 新增内嵌插件 ZIP 的 Windows WinExe 安装器和自动构建脚本；正常双击显示安装结果，`--dry-run` 只验证、不写系统。
- 发布目标收敛为新版 EXE 与 SHA256，历史安装包在新版验证通过后清理。

2026-09-10 v0.5.6：存档索引新建、更新及重复导出自动隐藏；真实 UXP 隐藏目标覆盖故障改用本地桥原子提交。实现和验证边界见 docs/hidden-index-2026-09-10.md。
