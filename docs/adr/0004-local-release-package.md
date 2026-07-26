# 本地交付使用验证后的 ZIP

开发阶段的正式交付物是经过自动验证的版本化 ZIP，并附带 Windows 安装脚本；脚本仅在确认可写时部署到 Adobe UXP External 目录，否则明确引导使用已安装的 UXP Developer Tool。签名 `.ccx` 依赖 Adobe 签名环境，不由本仓库伪造或静默替代。
