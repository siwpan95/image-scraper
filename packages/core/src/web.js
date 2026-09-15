// @scraper/core — Web 面板（ctx.web）。取代 Python 版 tkinter GUI（用户拍板：GUI 改 Web）。
//
// node:http 零依赖实现：
//   GET  /              单页面板（内联 HTML/CSS/JS，无外部资源）
//   GET  /api/sources   源清单（name / display / driver / needs_proxy / 传输通道）
//   POST /api/run       运行一批源 {sources:[], maxImages, query, pages, proxy, ...}
//                       单实例互斥（运行中返回 409）；每源完成即更新状态，可轮询
//   GET  /api/status    {running, startedAt, targets, results, lastResult}
//   GET  /api/logtail   最近 80 行日志（面板直接看运行输出）
import { Service } from 'cordis'
import http from 'node:http'

const PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>image-scraper 面板</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;font:14px/1.6 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;background:#14171c;color:#dde3ea}
header{display:flex;align-items:baseline;gap:12px;padding:14px 20px;background:#1b2027;border-bottom:1px solid #2a313b}
h1{font-size:17px;margin:0}
#badge{font-size:12px;padding:2px 10px;border-radius:10px;background:#2a313b}
#badge.on{background:#7a4d12;color:#ffd28a}
main{display:grid;grid-template-columns:280px 1fr;gap:16px;padding:16px 20px;max-width:1200px;margin:0 auto}
.panel{background:#1b2027;border:1px solid #2a313b;border-radius:10px;padding:14px}
h2{font-size:13px;margin:0 0 10px;color:#9fb0c3;text-transform:uppercase;letter-spacing:.05em}
#sources{display:flex;flex-direction:column;gap:2px;max-height:46vh;overflow:auto}
label.src{display:flex;gap:8px;align-items:center;padding:3px 6px;border-radius:6px;cursor:pointer}
label.src:hover{background:#232a33}
.tag{font-size:11px;padding:0 6px;border-radius:8px;background:#24303e;color:#7fb0dd;margin-left:auto}
.tag.p{background:#3d2a24;color:#e8a07f}
.row{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}
.field{display:flex;flex-direction:column;gap:2px;font-size:12px;color:#9fb0c3}
.field input{width:110px;background:#14171c;border:1px solid #2a313b;border-radius:6px;color:#dde3ea;padding:5px 8px}
button{background:#2b62c9;border:0;color:#fff;border-radius:8px;padding:9px 22px;font-size:14px;cursor:pointer}
button:disabled{background:#2a313b;color:#77808c;cursor:not-allowed}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #232a33}
th{color:#9fb0c3;font-weight:500}
.ok{color:#7fd18c}.bad{color:#e88}
#log{font:12px/1.5 Consolas,monospace;white-space:pre-wrap;max-height:34vh;overflow:auto;background:#101317;border-radius:8px;padding:10px;color:#a8b6c5}
.hint{font-size:12px;color:#77808c;margin-top:8px}
</style></head><body>
<header><h1>image-scraper 面板</h1><span id="badge">idle</span></header>
<main>
<section class="panel">
  <h2>源</h2>
  <div style="margin-bottom:8px"><button id="all" style="padding:3px 10px;font-size:12px;background:#2a313b">全选</button>
  <button id="none" style="padding:3px 10px;font-size:12px;background:#2a313b">清空</button></div>
  <div id="sources">加载中…</div>
  <div class="row">
    <div class="field">max-images<input id="maxImages" value="5"></div>
    <div class="field">query<input id="query" value=""></div>
    <div class="field">pages<input id="pages" value=""></div>
  </div>
  <div class="row">
    <div class="field">proxy（仅 needs_proxy 源用）<input id="proxy" value="" placeholder="socks5://127.0.0.1:1080"></div>
    <div class="field">concurrency<input id="concurrency" value=""></div>
  </div>
  <div class="row"><button id="run">运行</button></div>
  <div class="hint">输出：images/&lt;source&gt;/ · 失败清单：meta/failed_*.json（CLI 可 --retry-failed 重投）</div>
</section>
<section class="panel">
  <h2>结果</h2>
  <table id="tbl"><thead><tr><th>源</th><th>状态</th><th>获取</th><th>下载</th><th>跳过</th><th>失败</th><th>耗时</th><th>说明</th></tr></thead><tbody></tbody></table>
  <h2 style="margin-top:14px">日志尾部</h2>
  <div id="log">…</div>
</section>
</main>
<script>
const $=s=>document.querySelector(s)
let sources=[]
async function load(){
  const r=await fetch('/api/sources');sources=await r.json()
  $('#sources').innerHTML=sources.map(s=>
    '<label class="src"><input type="checkbox" value="'+s.name+'">'+s.name+
    '<span style="color:#77808c;font-size:12px">'+(s.display||'')+'</span>'+
    (s.needs_proxy?'<span class="tag p">needs_proxy</span>':'<span class="tag">'+s.driver+'</span>')+'</label>').join('')
}
$('#all').onclick=()=>document.querySelectorAll('#sources input').forEach(i=>i.checked=true)
$('#none').onclick=()=>document.querySelectorAll('#sources input').forEach(i=>i.checked=false)
$('#run').onclick=async()=>{
  const sel=[...document.querySelectorAll('#sources input:checked')].map(i=>i.value)
  if(!sel.length){alert('请勾选至少一个源');return}
  const body={sources:sel}
  for(const k of['maxImages','query','pages','proxy','concurrency']){const v=$('#'+k).value.trim();if(v)body[k]=k==='query'||k==='proxy'?v:Number(v)}
  const r=await fetch('/api/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  const j=await r.json()
  if(!r.ok)alert('启动失败: '+(j.error||r.status))
}
async function tick(){
  try{
    const st=await (await fetch('/api/status')).json()
    const b=$('#badge');b.textContent=st.running?('running '+st.targets.length+' 源'):'idle';b.className=st.running?'on':''
    $('#tbl tbody').innerHTML=Object.entries(st.results).map(([n,r])=>{
      const s=r.ok?r.stats:null
      return '<tr><td>'+n+'</td><td class="'+(r.ok?'ok':'bad')+'">'+(r.ok?'完成':(r.reason||'失败'))+'</td>'+
      (s?('<td>'+s.fetched+'</td><td>'+s.downloaded+'</td><td>'+s.skipped+'</td><td>'+s.errors+'</td><td>'+(s.endTime-s.startTime).toFixed(1)+'s</td><td></td>')
        :('<td></td><td></td><td></td><td></td><td></td><td>'+(r.message||'')+'</td>'))+'</tr>'
    }).join('')
    const lt=await (await fetch('/api/logtail')).json()
    $('#log').textContent=(lt.lines||[]).join('\\n');$('#log').scrollTop=$('#log').scrollHeight
  }catch{}
}
load();tick();setInterval(tick,2000)
</script></body></html>`

class WebService extends Service {
  constructor(ctx, cfg = {}) {
    super(ctx, 'web')
    this.port = cfg.port ?? 8642
    this.host = cfg.host ?? '127.0.0.1'
    this._running = false
    this._targets = []
    this._results = {}
    this.server = http.createServer((req, res) => this.route(req, res).catch((e) => {
      this.ctx.logger.error('[web] ' + (e && e.stack ? e.stack : e))
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: String(e && e.message ? e.message : e) }))
    }))
    this.server.on('error', (e) => {
      this.ctx.logger.warn(`[web] 监听失败 (${e && e.message ? e.message : e})——面板不可用，CLI 不受影响`)
    })
    ctx.effect(() => () => { try { this.server.close() } catch { /* ignore */ } })
    this.server.listen(this.port, this.host, () => {
      this.ctx.logger.info(`[web] 面板已启动: http://${this.host}:${this.port}/`)
    })
  }

  async route(req, res) {
    const u = new URL(req.url, 'http://x')
    if (req.method === 'GET' && u.pathname === '/') return this.html(res)
    if (req.method === 'GET' && u.pathname === '/api/sources') return this.json(res, this.apiSources())
    if (req.method === 'GET' && u.pathname === '/api/status') {
      return this.json(res, {
        running: this._running, startedAt: this._startedAt || null,
        targets: this._targets, results: this._results,
      })
    }
    if (req.method === 'GET' && u.pathname === '/api/logtail') return this.json(res, { lines: this.ctx.logfile.tail(80) })
    if (req.method === 'POST' && u.pathname === '/api/run') return this.apiRun(req, res)
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  }

  html(res) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PAGE)
  }

  json(res, obj) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  }

  apiSources() {
    return this.ctx.sources.names().map((n) => {
      const d = this.ctx.sources.get(n)
      return {
        name: n, display: d.display || '',
        driver: d.fetch === 'curl' ? 'curl' : (d.driver || 'http'),
        needs_proxy: !!d.needs_proxy,
      }
    })
  }

  async apiRun(req, res) {
    let body = ''
    for await (const c of req) body += c
    let opts
    try { opts = JSON.parse(body || '{}') } catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'bad json' })) }
    const names = Array.isArray(opts.sources) ? opts.sources.filter((n) => this.ctx.sources.has(n)) : []
    if (!names.length) { res.writeHead(400); return res.end(JSON.stringify({ error: '无有效源' })) }
    if (this._running) { res.writeHead(409); return res.end(JSON.stringify({ error: '已有任务在运行' })) }
    delete opts.sources
    this._running = true
    this._startedAt = new Date().toISOString()
    this._targets = names
    this._results = {}
    res.writeHead(200); res.end(JSON.stringify({ started: true, targets: names }))
    // 后台跑：每源完成即写入 results（对齐 scheduler.runMany 的并行语义，但为面板做增量汇报）
    await Promise.all(names.map(async (name) => {
      this._results[name] = await this.ctx.sources.run(name, opts)
    }))
    this._running = false
    this.ctx.logger.info('[web] 批次完成: ' + names.join(','))
  }
}

WebService.inject = ['config', 'sources', 'logfile']

export default function webPlugin(ctx, cfg) {
  ctx.plugin(WebService, cfg)
}
