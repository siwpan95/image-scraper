// @scraper/core — 驱动注册表（ctx.drivers）。
// 驱动 = 「单页抓取」的传输实现：http / curl（P4 起还有 browser / browser_html）。
// 取代 Python 版 engine.py 里的 `if driver == "browser" ... elif fetch == "curl"` 字符串分支。
import { RegistryService } from './registry.js'

class DriversService extends RegistryService {
  constructor(ctx, cfg) {
    super(ctx, 'drivers', cfg)
  }
}

DriversService.inject = ['config', 'logfile']

export default function driversPlugin(ctx, cfg) {
  ctx.plugin(DriversService, cfg)
}
