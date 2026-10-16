# -*- coding: utf-8 -*-
"""services —— image-scraper 的 cordis 服务族（entry name 前缀 `services.`）。

每个模块导出 `default = <Service 类>`（cordis Loader 取 module.default）。

P1（本阶段）两个服务为「包装模式」——委托既有 legacy 模块，行为零变化：
  - services.config          → ConfigService（包装 config.py 的持久化/代理能力）
  - services.source_registry → 源注册表（包装 sources/registry.py）

⚠ 命名注意：本包名 `services`（新服务层）与既有 `sources` 包（源实现）仅差
一个字母，读代码时留意上下文。
"""
