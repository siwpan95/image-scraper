// @scraper/core — JSON 声明式引擎（纯函数层）。忠实移植 Python 版 sources/engine.py 的
// 「模板替换 → 抓取 → 解析 → 字段映射 → 任务构建」核心，不含任何 IO。
//
// 移植时逐一对齐的语义（正确性关键，改动前先看 legacy/sources/engine.py）：
//   1. _subst：未知占位符**保持原样**；值为 null/undefined 时不替换
//   2. _get_path：dotted 路径 + 数字索引；非法索引返回 null
//   3. pyFindAll：Python re.findall 在**含 1 个捕获组时返回组内容**（giphy 依赖此语义
//      把媒体 ID 还原成 URL），含多个组时返回数组
//   4. regex_replace：Python re.sub 全量替换，且 repl 用 \1 反向引用（JS 是 $1，需转换）
//   5. _apply_extractor：default 取第一个非空；path 空则 fallback；transform 仅在非空时套用
//   6. _build_tasks：URL 去重（seen）、item_filter（picsum 作者过滤）、max_images 截断

/** Python re.sub → JS replace 的 repl 转换：\1..\9 → $1..$9（另支持 \g<1>） */
export function convertRepl(repl) {
  return String(repl)
    .replace(/\\g<(\d+)>/g, '$$$1')
    .replace(/\\(\d+)/g, '$$$1')
}

/** 等价于 Python re.sub(pattern, repl, s)：全量替换 */
export function pySub(pattern, repl, s, flags = '') {
  try {
    return String(s).replace(new RegExp(pattern, flags + 'g'), convertRepl(repl))
  } catch {
    return String(s)
  }
}

/** 等价于 Python re.findall 的返回值语义（见头部注释第 3 点） */
export function pyFindAll(pattern, text, flags = '') {
  const out = []
  let re
  try {
    re = new RegExp(pattern, flags + 'g')
  } catch (e) {
    return { items: out, error: e.message }
  }
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.length === 1) out.push(m[0])
    else if (m.length === 2) out.push(m[1])
    else out.push(m.slice(1))
    if (m.index === re.lastIndex) re.lastIndex++ // 防御零宽匹配死循环
  }
  return { items: out, error: '' }
}

/** _subst：替换 {var}；未知占位符保持原样 */
export function subst(template, mapping) {
  const s = String(template ?? '')
  if (!s.includes('{')) return s
  return s.replace(/\{(\w+)\}/g, (whole, key) => {
    if (Object.prototype.hasOwnProperty.call(mapping, key) && mapping[key] !== null && mapping[key] !== undefined) {
      return String(mapping[key])
    }
    return whole
  })
}

/** _subst_any：递归对 dict/list/str 做模板替换 */
export function substAny(value, mapping) {
  if (typeof value === 'string') return subst(value, mapping)
  if (Array.isArray(value)) return value.map((v) => substAny(v, mapping))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = substAny(v, mapping)
    return out
  }
  return value
}

/** _get_path：dotted 路径取值，支持数字索引 */
export function getPath(obj, p) {
  if (obj === null || obj === undefined || !p) return obj ?? null
  let cur = obj
  for (const part of String(p).split('.')) {
    if (cur === null || cur === undefined) return null
    if (Array.isArray(cur)) {
      const i = Number(part)
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return null
      cur = cur[i]
    } else if (typeof cur === 'object') {
      cur = cur[part] ?? null
    } else {
      return null
    }
  }
  return cur === undefined ? null : cur
}

/** _to_int：容忍千分位与浮点字符串 */
export function toInt(v, d = 0) {
  if (v === null || v === undefined || v === '') return d
  try {
    let s = typeof v === 'string' ? v.trim().replace(/,/g, '') : v
    const n = Math.trunc(Number(s))
    return Number.isFinite(n) ? n : d
  } catch {
    return d
  }
}

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp']

/** _check_filter：is_image 过滤（含 redd.it 特例） */
export function checkFilter(flt, value) {
  if (!flt) return true
  if ('is_image' in flt && flt.is_image) {
    if (typeof value !== 'string') return false
    const s = value.toLowerCase().split('?')[0]
    if (IMAGE_EXTS.some((e) => s.endsWith(e))) return true
    if (s.startsWith('https://i.redd.it/') || s.startsWith('https://preview.redd.it/')) return true
    return false
  }
  return true
}

/** _apply_transforms：值变换管线 */
export function applyTransforms(value, transforms) {
  let v = value
  for (const t of transforms || []) {
    if (v === null || v === undefined) break
    const op = t.op
    if (op === 'regex_replace') {
      if (typeof v === 'string') v = pySub(t.pattern || '', t.repl || '', v)
    } else if (op === 'append_query') {
      v = String(v) + (t.value || '')
    } else if (op === 'lower') {
      v = String(v).toLowerCase()
    } else if (op === 'upper') {
      v = String(v).toUpperCase()
    } else if (op === 'to_int') {
      v = toInt(v, t.default ?? 0)
    }
  }
  return v
}

/** Python urllib.parse.quote（默认 safe='/'）的精确等价实现。
 *  必须按 UTF-8 字节逐个编码——不能基于 encodeURIComponent 的输出再"解回来"，
 *  否则多字节序列（中文）会被拆成非法的半截 %XX 导致 URIError。 */
export function pyQuote(s, safe = '/') {
  const str = String(s ?? '')
  const bytes = Buffer.from(str, 'utf8')
  let out = ''
  for (const b of bytes) {
    const ch = String.fromCharCode(b)
    const unreserved =
      (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || (b >= 0x30 && b <= 0x39) ||
      b === 0x5f || b === 0x2d || b === 0x2e || b === 0x7e // _ - . ~
    if (unreserved || safe.includes(ch)) out += ch
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0')
  }
  return out
}

const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

/** _apply_extractor：解析单个字段的 extractor */
export function applyExtractor(ext, item, ctxVars) {
  if (ext === null || ext === undefined) return ''
  if (typeof ext === 'string' || typeof ext === 'number' || typeof ext === 'boolean') {
    if (typeof ext === 'string' && ext.includes('{')) return subst(ext, ctxVars)
    return ext
  }
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) return ''

  if ('const' in ext) {
    const v = ext.const
    if (typeof v === 'string' && v.includes('{')) return subst(v, ctxVars)
    return v
  }
  if ('template' in ext) {
    const flat = item && typeof item === 'object' ? { ...item } : {}
    return subst(ext.template, { ...ctxVars, ...flat })
  }
  if ('default' in ext) {
    for (const sub of ext.default || []) {
      const v = applyExtractor(sub, item, ctxVars)
      if (!isEmpty(v)) return v
    }
    return ''
  }
  if ('path' in ext) {
    let v = getPath(item, ext.path)
    if ('filter' in ext && !checkFilter(ext.filter, v)) v = null
    if ((v === null || v === undefined || v === '') && 'fallback' in ext) {
      v = applyExtractor(ext.fallback, item, ctxVars)
    }
    if (v !== null && v !== undefined && v !== '') {
      v = applyTransforms(v, ext.transform)
    }
    return v === null || v === undefined ? '' : v
  }
  return ''
}

/** _deep_merge：深层合并（alt / request_by_mode 用） */
export function deepMerge(base, over) {
  const out = structuredClone(base ?? {})
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v)
    } else {
      out[k] = structuredClone(v)
    }
  }
  return out
}

/** _active：决定当前生效的 request/parse/item（处理 alt 兜底与 request_by_mode） */
export function activeConfig(cfg, ctxVars) {
  if (cfg.needs_key && !ctxVars.key) {
    const alt = cfg.alt
    if (alt) {
      return {
        request: alt.request || {},
        parse: alt.parse || { format: 'json' },
        item: alt.item || {},
        viaAlt: true,
      }
    }
  }
  const request = structuredClone(cfg.request || {})
  const parse = structuredClone(cfg.parse || { format: 'json' })
  const item = structuredClone(cfg.item || {})
  const rbym = cfg.request_by_mode
  if (rbym) {
    const mv = ctxVars.mode || ''
    if (mv in rbym) {
      const blk = rbym[mv]
      return {
        request: deepMerge(request, blk.request || {}),
        parse: deepMerge(parse, blk.parse || {}),
        item,
        viaAlt: false,
      }
    }
  }
  return { request, parse, item, viaAlt: false }
}

/** _extract_json：JSON 列表抽取（list_path + merge_keys） */
export function extractJson(data, parse) {
  const listPath = parse.list_path || ''
  let items = listPath ? getPath(data, listPath) : data
  if (items === null || items === undefined) return []
  const mergeKeys = parse.merge_keys
  if (mergeKeys && mergeKeys.length) {
    const out = []
    const src = items && typeof items === 'object' && !Array.isArray(items) ? items : (data || {})
    for (const k of mergeKeys) {
      const v = src && typeof src === 'object' ? src[k] : null
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...Object.values(v))
      else if (Array.isArray(v)) out.push(...v)
    }
    items = out
  }
  if (!Array.isArray(items)) return []
  return items.slice()
}

/** _extract_html：HTML 抽取（url_extract 正则 / block_extract 分块） */
export function extractHtml(html, parse, pageUrl = '', { sourceName = '', logger = console } = {}) {
  const ue = parse.url_extract
  if (ue) {
    let urls = []
    for (const pat of ue.patterns || []) {
      const { items, error } = pyFindAll(pat, html)
      if (error) logger.warn?.(`  [${sourceName}] 正则错误: ${error}`)
      else urls.push(...items)
    }
    const post = ue.post_replace || {}
    for (const [k, v] of Object.entries(post)) {
      urls = urls.map((u) => String(u).split(k).join(v))
    }
    if (ue.url_decode) urls = urls.map((u) => { try { return decodeURIComponent(u) } catch { return u } })
    urls = urls.map((u) => String(u).trim()).filter((u) => u && u.trim())
    // 相对 URL 解析为绝对 URL（含 <base href> 支持）
    if (ue.url_resolve && pageUrl) {
      let base = pageUrl
      const bm = /<base[^>]+href\s*=\s*["']([^"']+)/i.exec(html)
      if (bm) {
        try { base = new URL(bm[1], pageUrl).href } catch { /* ignore */ }
      }
      urls = urls.map((u) => { try { return new URL(u, base).href } catch { return u } })
    }
    urls = urls.filter((u) => u && !u.toLowerCase().startsWith('data:') && u.length > 8)
    return urls.map((u) => ({ url: u }))
  }

  const be = parse.block_extract
  if (be) {
    const flags = (be.block_flags || '').includes('S') ? 's' : ''
    const out = []
    const { items: blocks } = pyFindAll(be.block || '', html, flags)
    for (const block of blocks) {
      const tm = new RegExp(be.title || '<title>(.*?)</title>', 's').exec(block)
      const title = tm ? tm[1].trim() : ''
      const { items: found } = pyFindAll(be.url || '', block)
      for (const u of found) out.push({ url: u, title })
    }
    return out
  }
  return []
}

/** _build_tasks：字段映射 → ImageTask（含 item_filter / url_transform / 去重 / 截断）。
 *  就地追加到 tasks（与 Python 版一致，跨页累积），返回同一数组。 */
export function buildTasks(rawItems, { cfg, ctxVars, maxImages, active, sourceName, tasks = [] }) {
  const itemMap = active.item || {}
  const ifilter = cfg.item_filter
  const seen = new Set(tasks.map((t) => t.url))

  for (const raw0 of rawItems) {
    if (tasks.length >= maxImages) break
    const raw = raw0 && typeof raw0 === 'object' && !Array.isArray(raw0) ? raw0 : { url: raw0 }

    if (ifilter) {
      const fv = getPath(raw, ifilter.path || '')
      const wanted = (ctxVars[ifilter.contains || ''] ?? '') || ''
      if (wanted && typeof fv === 'string' && !fv.toLowerCase().includes(String(wanted).toLowerCase())) continue
    }

    let url = applyExtractor(itemMap.url || {}, raw, ctxVars)
    const ut = (active.parse && active.parse.url_transform) || []
    if (ut.length && url) url = applyTransforms(url, ut)
    if (!url || seen.has(url)) continue
    seen.add(url)

    const metaExt = itemMap.meta
    const meta = {}
    if (metaExt && typeof metaExt === 'object') {
      for (const [mk, me] of Object.entries(metaExt)) meta[mk] = applyExtractor(me, raw, ctxVars)
    }

    tasks.push({
      url,
      source: sourceName,
      title: String(applyExtractor(itemMap.title || {}, raw, ctxVars) ?? ''),
      author: String(applyExtractor(itemMap.author || {}, raw, ctxVars) ?? ''),
      width: toInt(applyExtractor(itemMap.width || {}, raw, ctxVars)),
      height: toInt(applyExtractor(itemMap.height || {}, raw, ctxVars)),
      referer: String(applyExtractor(itemMap.referer || {}, raw, ctxVars) ?? ''),
      localPath: '',
      downloaded: false,
      meta,
    })
  }
  return tasks
}

/** _resolve_int：容忍模板串（如 "{limit}"）与字符串数字 */
export function resolveInt(val, ctxVars = {}, d = 1) {
  if (val === null || val === undefined) return d
  if (typeof val === 'number') return Number.isFinite(val) ? val : d
  if (typeof val === 'string') {
    const s = subst(val, ctxVars).trim()
    if (s === '') return d
    const n = Number(s)
    return Number.isFinite(n) ? Math.trunc(n) : d
  }
  return d
}

/** _page_count：page 型分页的总页数 */
export function pageCount(pag, ctxVars, maxImages) {
  const cv = pag.count_var
  if (cv) return Math.max(1, resolveInt(ctxVars[cv] ?? 1, ctxVars, 1))
  const pp = pag.per_page
  if (pp) {
    const per = resolveInt(pp, ctxVars, 1)
    if (per > 0) return Math.max(1, Math.ceil(maxImages / per))
  }
  return pag.count ?? 1
}

/** _stop_page：stop_path 提前停止（如 civitai metadata.totalPages） */
export function stopPage(pag, pageVal, lastJson) {
  const sp = pag.stop_path
  if (sp && lastJson && typeof lastJson === 'object') {
    const val = getPath(lastJson, sp)
    if (typeof val === 'number' && pageVal >= val) return true
  }
  return false
}

/** _next_cursor：cursor 型分页游标 */
export function nextCursor(pag, lastJson) {
  const cp = pag.cursor_path
  if (cp && lastJson && typeof lastJson === 'object') {
    const v = getPath(lastJson, cp)
    return v || null
  }
  return null
}

/** _list_queries：list 型分页的查询列表 */
export function listQueries(pag, ctxVars) {
  const q = ctxVars.query || ''
  if (q) return [q]
  return (pag.default_queries || []).slice()
}

/** _maybe_log_api_error：JSON API 错误信封日志（避免静默「无任务」） */
export function apiError(data, sourceName, logger = console) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return
  let msg = data.message || data.error || data.errorMessage || ''
  const errs = data.errors
  if (Array.isArray(errs) && errs.length) msg = errs.map((e) => String(e)).join('; ')
  else if (typeof errs === 'string' && errs) msg = errs
  if (msg) {
    logger.warn?.(`  [${sourceName}] API 返回错误: ${msg}`)
    return
  }
  if (data.isSuccess === false) {
    logger.warn?.(`  [${sourceName}] API 返回 isSuccess=false` + (data.errorCode != null ? ` (errorCode=${data.errorCode})` : ''))
  } else if (data.errorCode != null && ![0, 1, '', '0', '1', '200'].includes(data.errorCode)) {
    logger.warn?.(`  [${sourceName}] API 返回 errorCode=${data.errorCode}` + (data.message ? ` message=${data.message}` : ''))
  }
}
