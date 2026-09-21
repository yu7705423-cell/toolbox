/*
  世界书 · 共用内核
  ————————————————————————————————————————————————
  生成器（index.html）和世界书库（library.html）都加载这一份。
  这里只有纯逻辑和通用 UI 组件，加载时不碰 DOM，所以两边谁先谁后都无所谓。

  模块都挂在全局 __M 上，用法和拆分前一模一样：__M['util']、__M['db'] ……
  两个页面同源，所以共用同一个 IndexedDB（wbgen）—— 生成器存进去的书，
  书库那边刷新就能看见，反之亦然。
*/
'use strict';
var __M = window.__M || (window.__M = {});

__M['util'] = (function () {
'use strict';
// 零件盒：DOM、提示、剪贴板、下载、时间。没有依赖，别往这里塞业务逻辑。

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function uid(prefix = '') {
  const r = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  return prefix ? prefix + '_' + r.replace(/-/g, '').slice(0, 16) : r;
}

let toastTimer = null;
function toast(msg, bad = false) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, bad ? 4200 : 2200);
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
}

function debounce(fn, ms = 200) {
  let timer = null;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制');
    return true;
  } catch (e) {
    // 非安全上下文 / iOS 老版本：退回到 textarea + execCommand
    try {
      const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      toast(ok ? '已复制' : '复制失败，请手动选择', !ok);
      return ok;
    } catch (e2) {
      toast('复制失败：' + e2.message, true);
      return false;
    }
  }
}

function download(filename, data, mime = 'text/plain;charset=utf-8') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  // 锚点不能马上删：blob 下载是异步落地的，锚点先没了浏览器就读不到 download
  // 属性，文件会被存成没有扩展名的 "download"。等一秒再清，顺带回收 URL。
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

function pickFile(accept = '*') {
  return new Promise(resolve => {
    const input = el('input', { type: 'file', accept, multiple: true, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(Array.from(input.files || [])); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

// 确认/输入弹窗。返回 Promise —— resolve(值) 或 resolve(null) 表示取消。
function modal({ title, body, confirmText = '确定', cancelText = '取消', onConfirm, wide = false }) {
  return new Promise(resolve => {
    const root = document.getElementById('modalRoot');
    const close = val => { scrim.remove(); resolve(val); };
    const content = typeof body === 'string' ? el('div', { html: body }) : body;
    const okBtn = el('button', {
      class: 'primary',
      text: confirmText,
      onclick: async () => {
        const val = onConfirm ? await onConfirm(content) : true;
        if (val === undefined || val === null || val === false) return; // 校验没过就别关
        close(val);
      }
    });
    const scrim = el('div', { class: 'modal-scrim', onclick: e => { if (e.target === scrim) close(null); } }, [
      el('div', { class: 'modal', style: wide ? { width: 'min(880px,100%)' } : {} }, [
        el('div', { class: 'modal-head' }, [el('h3', { text: title })]),
        el('div', { class: 'modal-body' }, [content]),
        el('div', { class: 'modal-foot' }, [
          el('button', { class: 'ghost', text: cancelText, onclick: () => close(null) }),
          okBtn
        ])
      ])
    ]);
    root.appendChild(scrim);
    const first = content.querySelector('input, textarea, select');
    if (first) setTimeout(() => first.focus(), 30);
  });
}

async function confirmBox(title, message) {
  const r = await modal({ title, body: el('div', { class: 'hint', text: message }), confirmText: '确定' });
  return !!r;
}

// 数字夹逼 + 百分比取整，报告里到处要用
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// 从模型输出里抠 JSON：优先 ```json 围栏，其次 <tag>，最后第一个平衡的花括号。
function extractJson(text, tag) {
  if (!text) return null;
  const tryParse = s => { try { return JSON.parse(s); } catch (e) { return null; } };
  if (tag) {
    const m = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (m) {
      const inner = m[1].replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '');
      const v = tryParse(inner.trim());
      if (v) return v;
    }
  }
  const fence = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
  if (fence) { const v = tryParse(fence[1].trim()); if (v) return v; }
  const start = text.search(/[[{]/);
  if (start >= 0) {
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, escNext = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escNext) { escNext = false; continue; }
      if (ch === '\\') { escNext = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        const v = tryParse(text.slice(start, i + 1));
        if (v) return v;
        break;
      }
    }
  }
  return null;
}

// 去掉围栏，留正文。模型很爱把整篇世界书包进 ```yaml。
function stripFence(text) {
  const t = String(text || '').trim();
  const m = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : t;
}

function truncate(s, n = 80) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

// 粗略 token 估算：CJK 约 1 字 1 token，其余约 4 字符 1 token。够用来做预算提示。
function estimateTokens(text) {
  const s = String(text || '');
  const cjk = (s.match(/[㐀-鿿぀-ヿ가-힯]/g) || []).length;
  return Math.round(cjk + (s.length - cjk) / 3.6);
}

return { $, $$, el, esc, uid, toast, fmtTime, debounce, copyText, download, pickFile, modal, confirmBox, clamp, pct, extractJson, stripFence, truncate, estimateTokens };
})();

__M['db'] = (function () {
'use strict';
// 存储层。三级降级：IndexedDB → localStorage → 内存。
//
// 这是个单文件工具，会被拷到各种地方打开 —— 有的环境（隐私模式、某些 file://、
// 禁了站点数据的浏览器）开不了 IndexedDB。开不了就退到 localStorage，
// 再不行退到内存并在界面上挂一条警告，让人知道要及时导出备份，而不是白屏。

const DB_NAME = 'wbgen';
const DB_VERSION = 1;
const STORES = ['apiPresets', 'genPresets', 'projects', 'versions', 'books', 'feedback', 'modelProfiles', 'settings'];
const KEY_OF = { modelProfiles: 'modelKey' };
const keyField = store => KEY_OF[store] || 'id';

// 用对象而不是两个 let：打包成单文件后，跨模块读的是同一个对象的属性，
// 不会因为解构而拿到初始化之前的快照。
const storageState = { mode: 'idb', note: '' };

// ---------- 后端 1：IndexedDB ----------

let dbPromise = null;
function openIDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) return reject(new Error('没有 IndexedDB'));
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { return reject(e); }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: keyField(name) });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 打不开'));
    req.onblocked = () => reject(new Error('IndexedDB 被另一个标签页占住了'));
    setTimeout(() => reject(new Error('IndexedDB 打开超时')), 4000);
  });
  return dbPromise;
}

const idbBackend = {
  tx(store, mode, fn) {
    return openIDB().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
      if (req) { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }
      else t.oncomplete = () => resolve();
    }));
  },
  get: (s, k) => idbBackend.tx(s, 'readonly', st => st.get(k)),
  all: (s) => idbBackend.tx(s, 'readonly', st => st.getAll()),
  put: (s, v) => idbBackend.tx(s, 'readwrite', st => st.put(v)),
  del: (s, k) => idbBackend.tx(s, 'readwrite', st => st.delete(k)),
  clear: (s) => idbBackend.tx(s, 'readwrite', st => st.clear())
};

// ---------- 后端 2：localStorage（每个仓库一个 JSON 数组） ----------

const lsKey = store => 'wbgen.' + store;
const lsBackend = {
  read(store) {
    try { return JSON.parse(localStorage.getItem(lsKey(store)) || '[]'); }
    catch (e) { return []; }
  },
  write(store, rows) {
    try {
      localStorage.setItem(lsKey(store), JSON.stringify(rows));
    } catch (e) {
      // 配额爆了：别静默丢数据，往上抛，由调用处提示
      throw new Error('本地存储写满了（localStorage 上限约 5MB）。先导出备份，再删掉一些旧版本。');
    }
  },
  async get(store, key) { return lsBackend.read(store).find(r => r[keyField(store)] === key); },
  async all(store) { return lsBackend.read(store); },
  async put(store, value) {
    const rows = lsBackend.read(store);
    const kf = keyField(store);
    const i = rows.findIndex(r => r[kf] === value[kf]);
    if (i >= 0) rows[i] = value; else rows.push(value);
    lsBackend.write(store, rows);
    return value;
  },
  async del(store, key) {
    lsBackend.write(store, lsBackend.read(store).filter(r => r[keyField(store)] !== key));
  },
  async clear(store) { lsBackend.write(store, []); }
};

// ---------- 后端 3：内存（最后兜底，刷新即失） ----------

const mem = new Map();
const memRows = store => { if (!mem.has(store)) mem.set(store, []); return mem.get(store); };
const memBackend = {
  async get(store, key) { return memRows(store).find(r => r[keyField(store)] === key); },
  async all(store) { return memRows(store).slice(); },
  async put(store, value) {
    const rows = memRows(store), kf = keyField(store);
    const i = rows.findIndex(r => r[kf] === value[kf]);
    if (i >= 0) rows[i] = value; else rows.push(value);
    return value;
  },
  async del(store, key) { mem.set(store, memRows(store).filter(r => r[keyField(store)] !== key)); },
  async clear(store) { mem.set(store, []); }
};

let backend = idbBackend;

async function initStorage() {
  try {
    await openIDB();
    storageState.mode = 'idb';
    backend = idbBackend;
    return storageState.mode;
  } catch (e) {
    dbPromise = null;
    try {
      const probe = '__wbgen_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      backend = lsBackend;
      storageState.mode = 'local';
      storageState.note = 'IndexedDB 不可用（' + e.message + '），已退到 localStorage。容量约 5MB，版本攒多了要及时清。';
    } catch (e2) {
      backend = memBackend;
      storageState.mode = 'memory';
      storageState.note = '这个环境不允许任何本地存储（' + e.message + '）。数据只在内存里，关掉页面就没了 —— 做完记得在设置里导出备份。';
    }
    return storageState.mode;
  }
}

// ---------- 对外接口 ----------

const get = (store, key) => backend.get(store, key);
const all = (store) => backend.all(store).then(rows => rows || []);
const put = (store, value) => backend.put(store, value).then(() => value);
const del = (store, key) => backend.del(store, key);

// 记录量是几百条这个量级，按字段过滤就够，不值得为它维护一套索引
async function query(store, field, value) {
  const rows = await all(store);
  return rows.filter(r => r && r[field] === value);
}

// ---------- 设置（单例） ----------

const DEFAULT_SETTINGS = {
  id: 'app',
  mainPresetId: '',     // 写世界书的模型
  auxPresetId: '',      // 副 API：画像、归因、审查这类小活
  testPresetId: '',     // 试运行用的目标模型
  auditWithLLM: true,   // 本地审查之外再跑一遍模型审查
  auditPreset: 'aux',   // 'aux' | 'main'
  // 副模型写不写详细分析。评分和逐条结论只告诉你"哪儿不行"，
  // 分析要回答"注进去之后会怎样、为什么是这个分、先改哪一条"。
  // 'separate' 审查完单独再跑一次（能引评分和证据，最深，多花一次调用）
  // 'inline'   挤在审查那一次的 JSON 里（不额外花钱，但浅，且长文本塞 JSON 容易解析失败）
  // 'off'      不写
  analysisMode: 'separate',
  banwords: [],         // 用户自定义禁词，和内置词表叠加
  useBuiltinBanwords: true,
  profileEnabled: true,
  memoryEnabled: true,
  maxProfileItems: 6,   // 画像注入上限 —— 反过拟合的硬闸
  maxMemoryItems: 5
};

async function getSettings() {
  const s = await get('settings', 'app');
  return Object.assign({}, DEFAULT_SETTINGS, s || {});
}

async function saveSettings(patch) {
  const cur = await getSettings();
  const next = Object.assign(cur, patch, { id: 'app' });
  await put('settings', next);
  return next;
}

// ---------- 用户画像（单例，塞在 settings 仓库里省一个 store） ----------

const EMPTY_PROFILE = {
  id: 'profile',
  dislikes: [], preferences: [], hardRules: [], styleNotes: [],
  updatedAt: 0, sourceCount: 0
};

async function getProfile() {
  const p = await get('settings', 'profile');
  return Object.assign({}, EMPTY_PROFILE, p || {});
}
async function saveProfile(profile) {
  return put('settings', Object.assign({}, profile, { id: 'profile', updatedAt: Date.now() }));
}

// ---------- 杂项 ----------

async function listSorted(store, field = 'updatedAt', desc = true) {
  const rows = await all(store);
  rows.sort((a, b) => (desc ? (b[field] || 0) - (a[field] || 0) : (a[field] || 0) - (b[field] || 0)));
  return rows;
}

async function dumpAll({ includeKeys = false } = {}) {
  const out = { _format: 'wbgen-backup', _version: DB_VERSION, exportedAt: Date.now(), data: {} };
  for (const name of STORES) {
    let rows = await all(name);
    if (name === 'apiPresets' && !includeKeys) rows = rows.map(r => Object.assign({}, r, { apiKey: '' }));
    out.data[name] = rows;
  }
  return out;
}

async function restoreAll(dump, { merge = true } = {}) {
  if (!dump || dump._format !== 'wbgen-backup') throw new Error('不是本工具导出的备份文件');
  let count = 0;
  for (const [name, rows] of Object.entries(dump.data || {})) {
    if (!STORES.includes(name) || !Array.isArray(rows)) continue;
    if (!merge) await backend.clear(name);
    for (const row of rows) { await put(name, row); count++; }
  }
  return count;
}

return { storageState, initStorage, get, all, put, del, query, DEFAULT_SETTINGS, getSettings, saveSettings, EMPTY_PROFILE, getProfile, saveProfile, listSorted, dumpAll, restoreAll };
})();

__M['api'] = (function () {
'use strict';
// 调用层：openai 兼容 / anthropic / gemini 三种。统一进出口。
//
// 关于 baseUrl：各家中转站的写法不统一，有人填 https://api.x.com，有人填到 /v1。
// 规则是：已经带 /v1 的原样用；末尾写 # 表示"就按我填的来，别自动补"。

const PROVIDERS = {
  openai:    { label: 'OpenAI 兼容（含各类中转）', keyLabel: 'API Key', needsBase: true },
  anthropic: { label: 'Anthropic 原生', keyLabel: 'API Key', needsBase: true },
  gemini:    { label: 'Gemini 原生', keyLabel: 'API Key', needsBase: true }
};

const DEFAULT_BASE = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com'
};

function normBase(raw, provider) {
  let b = String(raw || '').trim();
  if (!b) b = DEFAULT_BASE[provider] || '';
  if (b.endsWith('#')) return b.slice(0, -1).replace(/\/+$/, '');   // 显式收尾，不再补
  b = b.replace(/\/+$/, '');
  if (provider === 'openai' && !/\/v\d+([a-z]*)?$/i.test(b)) b += '/v1';
  return b;
}

function modelKeyOf(preset) {
  if (!preset) return '';
  return `${preset.provider || 'openai'}:${preset.model || '?'}`;
}

function authHeaders(preset) {
  const key = String(preset.apiKey || '').trim();
  const extra = {};
  for (const line of String(preset.extraHeaders || '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) extra[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (preset.provider === 'anthropic') {
    return Object.assign({
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      // 浏览器直连 Anthropic 必须显式打开，否则被服务端拒绝
      'anthropic-dangerous-direct-browser-access': 'true'
    }, extra);
  }
  if (preset.provider === 'gemini') {
    return Object.assign({ 'content-type': 'application/json', 'x-goog-api-key': key }, extra);
  }
  return Object.assign({ 'content-type': 'application/json', 'authorization': 'Bearer ' + key }, extra);
}

async function readError(res) {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message || j?.message || j?.error || text;
    } catch (e) { detail = text; }
  } catch (e) {}
  if (typeof detail !== 'string') detail = JSON.stringify(detail);
  return `${res.status} ${res.statusText}${detail ? ' — ' + detail.slice(0, 400) : ''}`;
}

// ---------------- 模型列表 ----------------
// 要求：能把拉到的【全部】列表吐出来，不截断。搜索在 UI 层做。

async function listModels(preset) {
  const base = normBase(preset.baseUrl, preset.provider);
  const headers = authHeaders(preset);
  let url, pick;
  if (preset.provider === 'gemini') {
    url = `${base}/v1beta/models?pageSize=1000`;
    pick = j => (j.models || []).map(m => ({
      id: String(m.name || '').replace(/^models\//, ''),
      note: (m.supportedGenerationMethods || []).includes('generateContent') ? '' : '不支持对话'
    }));
  } else if (preset.provider === 'anthropic') {
    url = `${base}/v1/models?limit=1000`;
    pick = j => (j.data || []).map(m => ({ id: m.id, note: m.display_name || '' }));
  } else {
    url = `${base}/models`;
    pick = j => (j.data || j.models || []).map(m => ({ id: m.id || m.name, note: m.owned_by || '' }));
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(await readError(res));
  const json = await res.json();
  const rows = pick(json).filter(r => r.id);
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

// ---------------- 对话 ----------------
// opts: { system, messages:[{role,content}], temperature, maxTokens, json }
// hooks: { signal, onDelta(chunk) } —— 传了 onDelta 就走流式。

async function chat(preset, opts = {}, hooks = {}) {
  if (!preset) throw new Error('没有选择 API 预设');
  if (!preset.model) throw new Error(`预设「${preset.name || '未命名'}」还没有选模型`);
  const provider = preset.provider || 'openai';
  const base = normBase(preset.baseUrl, provider);
  const headers = authHeaders(preset);
  const stream = typeof hooks.onDelta === 'function';
  const p = preset.params || {};
  const temperature = opts.temperature ?? p.temperature ?? 0.8;
  const maxTokens = opts.maxTokens ?? p.maxTokens ?? 8192;
  const messages = opts.messages || [];

  let url, body, parseChunk, parseWhole;

  if (provider === 'anthropic') {
    url = `${base}/v1/messages`;
    body = {
      model: preset.model, max_tokens: maxTokens, temperature, stream,
      system: opts.system || undefined,
      messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
    };
    parseChunk = j => (j.type === 'content_block_delta' ? (j.delta?.text || '') : '');
    parseWhole = j => (j.content || []).map(c => c.text || '').join('');
  } else if (provider === 'gemini') {
    const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    url = `${base}/v1beta/models/${encodeURIComponent(preset.model)}:${method}`;
    body = {
      systemInstruction: opts.system ? { parts: [{ text: opts.system }] } : undefined,
      contents: messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      generationConfig: Object.assign(
        { temperature, maxOutputTokens: maxTokens },
        opts.json ? { responseMimeType: 'application/json' } : {}
      )
    };
    const textOf = j => (j.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('');
    parseChunk = textOf;
    parseWhole = textOf;
  } else {
    url = `${base}/chat/completions`;
    const msgs = opts.system ? [{ role: 'system', content: opts.system }, ...messages] : messages;
    body = { model: preset.model, messages: msgs, temperature, stream };
    if (p.topP != null && p.topP !== '') body.top_p = Number(p.topP);
    if (maxTokens) body.max_tokens = maxTokens;
    if (opts.json) body.response_format = { type: 'json_object' };
    parseChunk = j => j.choices?.[0]?.delta?.content || '';
    parseWhole = j => j.choices?.[0]?.message?.content || '';
  }

  const res = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(body), signal: hooks.signal
  });
  if (!res.ok) throw new Error(await readError(res));

  if (!stream) {
    const json = await res.json();
    const text = parseWhole(json) || '';
    return { text, usage: json.usage || json.usageMetadata || null };
  }

  // SSE：三家格式不同但都是 data: 行，差别只在 chunk 的取值方式
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', text = '', usage = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let j;
      try { j = JSON.parse(payload); } catch (e) { continue; }
      if (j.usage) usage = j.usage;
      if (j.usageMetadata) usage = j.usageMetadata;
      const piece = parseChunk(j) || '';
      if (piece) { text += piece; hooks.onDelta(piece, text); }
    }
  }
  if (!text) throw new Error('模型没有返回任何内容（可能是上游限流或模型名不对）');
  return { text, usage };
}

// 连通性自测：最省钱的一次调用
async function testPreset(preset) {
  const t0 = Date.now();
  const r = await chat(preset, {
    messages: [{ role: 'user', content: '回复两个字：收到' }],
    maxTokens: 32, temperature: 0
  });
  return { ok: true, ms: Date.now() - t0, sample: (r.text || '').trim().slice(0, 40) };
}

return { PROVIDERS, DEFAULT_BASE, normBase, modelKeyOf, listModels, chat, testPreset };
})();

__M['lexicon'] = (function () {
'use strict';
// 词库。审查器的判定基础，也是唯一需要按使用习惯长期维护的东西。
//
// 每条带 severity：
//   hard —— 基本上出现就是套路化表达，命中直接算问题
//   soft —— 高频可疑，要看语境，命中只提示不判失败
// 用户可以在设置里整体关掉内置词表，只用自己的 —— 词表本身也会过拟合。

const AI_CLICHES = [
  // 陪伴/情绪类：这类词一旦成为模型的默认反射，每个角色都会变成同一个人
  { t: '我就在这', s: 'hard' }, { t: '我一直都在', s: 'hard' }, { t: '我会一直在', s: 'hard' },
  { t: '我哪儿也不去', s: 'hard' }, { t: '有我在', s: 'soft' },
  { t: '接住', s: 'hard' }, { t: '稳稳接住', s: 'hard' }, { t: '稳稳地接住', s: 'hard' },
  { t: '破碎感', s: 'hard' }, { t: '钝痛', s: 'soft' }, { t: '安全感', s: 'soft' },
  // 身体动作类：高频到失去信息量
  { t: '喉结', s: 'soft' }, { t: '指尖微颤', s: 'hard' }, { t: '指腹摩挲', s: 'hard' },
  { t: '尾音', s: 'soft' }, { t: '勾唇', s: 'hard' }, { t: '勾了勾唇', s: 'hard' },
  { t: '挑眉', s: 'soft' }, { t: '眯起眼', s: 'soft' }, { t: '危险地', s: 'hard' },
  { t: '呼吸一滞', s: 'hard' }, { t: '心脏漏了一拍', s: 'hard' }, { t: '心跳漏了一拍', s: 'hard' },
  { t: '瞳孔地震', s: 'hard' }, { t: '掌心的温度', s: 'soft' },
  // 叙述腔调类
  { t: '空气仿佛凝固', s: 'hard' }, { t: '时间仿佛静止', s: 'hard' }, { t: '仿佛整个世界', s: 'hard' },
  { t: '某种意义上', s: 'soft' }, { t: '在这一刻', s: 'soft' }, { t: '下一秒', s: 'soft' },
  { t: '与此同时', s: 'soft' }, { t: '不容拒绝', s: 'hard' }, { t: '命令般', s: 'hard' },
  { t: '低沉沙哑', s: 'hard' }, { t: '蛊惑', s: 'soft' }, { t: '沦陷', s: 'soft' },
  { t: '宣示主权', s: 'hard' }, { t: '占有欲', s: 'soft' }, { t: '致命的', s: 'soft' },
  { t: '揉进骨血', s: 'hard' }, { t: '刻进骨子里', s: 'hard' },
  // 收尾八股
  { t: '而这一切才刚刚开始', s: 'hard' }, { t: '故事还在继续', s: 'hard' },
  { t: '未完待续', s: 'soft' },
  // 英文侧
  { t: 'delve into', s: 'hard', en: true }, { t: 'tapestry', s: 'hard', en: true },
  { t: 'testament to', s: 'hard', en: true }, { t: 'navigate the complexities', s: 'hard', en: true },
  { t: "it's important to note", s: 'hard', en: true }, { t: 'in conclusion', s: 'soft', en: true },
  { t: 'ever-evolving', s: 'hard', en: true }, { t: 'palpable', s: 'soft', en: true },
  { t: 'a whirlwind of', s: 'soft', en: true }, { t: 'sent shivers down', s: 'hard', en: true }
];

// 禁止性标记。注意 "别" "勿" 这种单字容易误伤（"别的"），所以带上下文一起匹配。
const PROHIBIT = [
  '不要', '不得', '不能', '不可', '不准', '禁止', '严禁', '杜绝', '切勿', '避免', '不应', '不许',
  '请勿', '别去', '别再', '不准许', '一律不', '绝不', '永远不'
];
const PROHIBIT_EN = ['never', "don't", 'do not', 'must not', 'avoid', 'refrain from', 'no longer', 'forbidden'];

// 引导性标记：告诉模型"要怎么做"
const GUIDE = [
  '应当', '应该', '应', '需要', '须', '请', '采用', '优先', '改为', '使用', '写成', '保持', '按照',
  '以…方式', '当', '若', '如果', '一律', '统一', '默认', '倾向于', '侧重', '聚焦', '控制在', '限定在'
];
const GUIDE_EN = ['use', 'prefer', 'write', 'keep', 'ensure', 'favor', 'when', 'if', 'should', 'default to', 'aim for'];

// 替代方案标记：R2 要的就是"禁止之后紧跟这个"
const ALTERNATIVE = [
  '而是', '而应', '改为', '改写为', '取而代之', '正确做法', '正确写法', '应改成', '替代',
  '换成', '用…代替', '相应地', '作为替代', '与之相对', '正面写法'
];
const ALTERNATIVE_EN = ['instead', 'rather than', 'replace with', 'in its place', 'the correct form'];

// 祈使动词：句首命中就算执行性语句
const IMPERATIVE_VERBS = [
  '写', '用', '保持', '列出', '给出', '输出', '生成', '按', '以', '设定', '设置', '限制', '控制',
  '优先', '拆分', '合并', '标注', '引用', '检查', '确认', '替换', '删去', '保留', '补充', '扩展',
  '描述', '刻画', '呈现', '安排', '选择', '采用', '遵循', '参照', '区分', '判断', '记录', '维持'
];

// 散文信号：比喻词 + 情绪形容词密集 = 更像散文而不是指令
const PROSE_MARKERS = ['仿佛', '宛如', '如同', '像是', '似乎', '好像', '恍若', '犹如', '宛若'];

// 条件-动作结构：可执行语句最强的形态
const CONDITION_MARKERS = ['当', '若', '如果', '一旦', '每当', '在…时', '遇到', '涉及', '除非'];

// 占位符：世界书里 user/char 只能以占位符出现
const PLACEHOLDERS = ['{{char}}', '{{user}}'];

const CJK = /[㐀-鿿]/;

// 把词条编译成匹配器：中文直接找子串，英文加词边界且大小写不敏感。
function compileTerms(terms) {
  return terms.map(item => {
    const obj = typeof item === 'string' ? { t: item, s: 'hard' } : item;
    const t = obj.t;
    const isEn = obj.en || !CJK.test(t);
    let re = null;
    if (isEn) {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(`(^|[^a-zA-Z])(${esc})(?![a-zA-Z])`, 'gi');
    }
    return { term: t, severity: obj.s || 'hard', isEn, re };
  });
}

// 在文本里找命中，返回 [{term, severity, line, col, snippet}]
function scanTerms(text, compiled) {
  const lines = String(text || '').split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    for (const c of compiled) {
      if (c.isEn) {
        c.re.lastIndex = 0;
        let m;
        while ((m = c.re.exec(line))) {
          hits.push({ term: c.term, severity: c.severity, line: i + 1, col: m.index, snippet: line.trim() });
          if (m.index === c.re.lastIndex) c.re.lastIndex++;
        }
      } else {
        let from = 0, idx;
        while ((idx = line.indexOf(c.term, from)) !== -1) {
          hits.push({ term: c.term, severity: c.severity, line: i + 1, col: idx, snippet: line.trim() });
          from = idx + c.term.length;
        }
      }
    }
  });
  return hits;
}

// 合并内置词表和用户自定义词表
function buildBanwordSet({ useBuiltin = true, custom = [] } = {}) {
  const list = [];
  if (useBuiltin) list.push(...AI_CLICHES);
  for (const w of custom) {
    const t = String(w || '').trim();
    if (t) list.push({ t, s: 'hard' });
  }
  return compileTerms(list);
}

return { AI_CLICHES, PROHIBIT, PROHIBIT_EN, GUIDE, GUIDE_EN, ALTERNATIVE, ALTERNATIVE_EN, IMPERATIVE_VERBS, PROSE_MARKERS, CONDITION_MARKERS, PLACEHOLDERS, compileTerms, scanTerms, buildBanwordSet };
})();

__M['rules'] = (function () {
'use strict';
// 八条规则的定义。数据驱动 —— 要加第九条，在这里加一条，再在 audit.js 里补一个判定函数。
//
// judge 字段说明判定归属：
//   local  只靠代码判（确定、可复现）
//   llm    只靠模型判（代码判不了）
//   both   代码先量化，模型再定性

const RULES = [
  {
    id: 'R1',
    name: '引导优先于禁止',
    short: '引导>禁止',
    judge: 'both',
    weight: 1.2,
    ask: '正文里"禁止性语句"和"引导性语句"的比例是否健康？剩下的禁止句是不是真的属于必须硬拦的重要场景？',
    why: '禁止只划掉一条路，引导给出一条路。模型拿到一串"不要"，剩下的空间还是要自己猜，猜错的概率不比之前低。禁止不是不能用，是只留给硬红线。'
  },
  {
    id: 'R2',
    name: '指出问题必须给出替代做法',
    short: '禁止配替代',
    judge: 'both',
    weight: 1.3,
    ask: '每一条禁止性语句，是否在同句或紧邻位置给出了"那应该怎么做"？',
    why: '"不要写成散文"后面必须跟"写成可判定的条件-动作句"。否则模型只知道自己错了，不知道往哪儿走。'
  },
  {
    id: 'R3',
    name: '抓根因、按类归并',
    short: '抓根因',
    judge: 'llm',
    weight: 1.4,
    ask: '这些约束是针对"一类问题"写的，还是针对用户提到的"那一个具体例子"打补丁？有没有几条其实是同一个根因的不同表现，应该合并？',
    why: '用户说"这里不好"，逐点改就会变成打地鼠：改完这处那处又冒出来。要问的是"为什么会出现这一类现象"，一条规则盖住一族问题。'
  },
  {
    id: 'R4',
    name: '不照搬用户原话',
    short: '不照搬',
    judge: 'local',
    weight: 1.0,
    ask: '正文里有没有整段复制需求描述的片段？',
    why: '照搬说明没有消化。用户的话是症状描述，世界书要写的是可执行规约，两者的语言层级不一样。'
  },
  {
    id: 'R5',
    name: '有结构，不是拼凑',
    short: '有结构',
    judge: 'both',
    weight: 1.3,
    ask: '章节职责是否清晰、同一个约束是否散落在多处、格式是否自洽？',
    why: '东拉西扯的世界书，模型读的时候权重是乱的：同一件事说三遍会被当成三条不同的强约束，互相打架。'
  },
  {
    id: 'R6',
    name: '先大纲、由浅入深，再写正文',
    short: '大纲先行',
    judge: 'local',
    weight: 1.1,
    ask: '大纲的每个节点是否都在正文里落地了？正文有没有跑出大纲之外的内容？',
    why: '先有骨架，正文才有推进顺序；没有大纲的长文本一定是想到哪写到哪。'
  },
  {
    id: 'R7',
    name: '执行性语句，而非散文',
    short: '执行性',
    judge: 'both',
    weight: 1.2,
    ask: '句子是"可判定、可执行"的指令，还是描述气氛的散文？',
    why: '世界书是给模型看的运行时规约，不是给人看的设定集。"这是一个充满神秘气息的世界"无法执行；"提到地名时补一句该地的气候"可以。'
  },
  {
    id: 'R8',
    name: '无 AI 八股',
    short: '无八股',
    judge: 'both',
    weight: 1.2,
    ask: '有没有命中禁词表？有没有词表之外、但同样套路化的表达？',
    why: '八股词是模型的默认反射。世界书里出现一次，生成时就会被放大成整篇的腔调。'
  }
];

const RULE_BY_ID = Object.fromEntries(RULES.map(r => [r.id, r]));

const STATUS_LABEL = { pass: '通过', warn: '提示', fail: '不通过', skip: '未检查' };
const STATUS_ORDER = { fail: 0, warn: 1, pass: 2, skip: 3 };

// 综合分：按权重加权，fail 拿 0 分、warn 拿 55 分、pass 用各自实际分
function overallScore(results) {
  let sum = 0, wsum = 0;
  for (const r of results) {
    if (r.status === 'skip') continue;
    const w = (RULE_BY_ID[r.id]?.weight) || 1;
    const s = r.score != null ? r.score : (r.status === 'pass' ? 90 : r.status === 'warn' ? 55 : 20);
    sum += s * w; wsum += w;
  }
  return wsum ? Math.round(sum / wsum) : 0;
}

return { RULES, RULE_BY_ID, STATUS_LABEL, STATUS_ORDER, overallScore };
})();

__M['audit'] = (function () {
'use strict';
// 本地审查：不调模型，纯代码判定。
//
// 为什么非要有这一层：让模型自己声明"我遵守了"是不可信的 —— 它会在自检里写
// "已避免禁止性语句"，正文里躺着七条"不要"。凡是能用代码判死的（禁词、照搬、
// 禁止句有没有配替代方案、大纲覆盖率、执行句比例、结构完整性）都在这里判，
// 判出行号和证据。模型审查只负责代码判不了的部分（见 pipeline.js）。

const { PROHIBIT, PROHIBIT_EN, GUIDE, GUIDE_EN, ALTERNATIVE, ALTERNATIVE_EN, IMPERATIVE_VERBS, PROSE_MARKERS, CONDITION_MARKERS, buildBanwordSet, scanTerms } = __M['lexicon'];
const { RULES, overallScore } = __M['rules'];
const { pct, clamp } = __M['util'];
const MODAL = ['应当', '应该', '应', '须', '必须', '需要', '需', '优先', '统一', '默认', '一律', '限定', '控制在'];

// ---------- 文本切分 ----------

function splitSentences(text) {
  const out = [];
  String(text || '').split('\n').forEach((line, i) => {
    const raw = line.trim();
    if (!raw) return;
    // 标题行、YAML 键行、XML 标签行不参与句式统计 —— 它们是结构不是语句
    if (/^[#>\-*\s]*$/.test(raw)) return;
    const body = raw.replace(/^[#\-*>\s]+/, '');
    for (const piece of body.split(/(?<=[。！？!?；;])\s*|(?<=\.)\s+(?=[A-Z])/)) {
      const s = String(piece || '').trim();
      if (s.length >= 2) out.push({ text: s, line: i + 1 });
    }
  });
  return out;
}

function normalizeForCompare(s) {
  return String(s || '')
    .replace(/\{\{(char|user)\}\}/gi, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
}

const hasAny = (s, list) => list.some(w => s.includes(w));
const hasAnyEn = (s, list) => { const l = s.toLowerCase(); return list.some(w => l.includes(w)); };

function isProhibitive(s) { return hasAny(s, PROHIBIT) || hasAnyEn(s, PROHIBIT_EN); }
function isGuiding(s) { return hasAny(s, GUIDE) || hasAnyEn(s, GUIDE_EN); }
function hasAlternative(s) { return hasAny(s, ALTERNATIVE) || hasAnyEn(s, ALTERNATIVE_EN); }

function startsImperative(s) {
  const t = s.replace(/^[「『"'（(\[【\s]+/, '');
  if (IMPERATIVE_VERBS.some(v => t.startsWith(v))) return true;
  if (/^[a-z]+\s/i.test(t) && hasAnyEn(t.split(/\s+/)[0], ['use', 'write', 'keep', 'set', 'list', 'give', 'apply', 'follow', 'limit', 'prefer', 'ensure'])) return true;
  return false;
}

function isExecutable(s) {
  if (startsImperative(s)) return true;
  if (hasAny(s, MODAL)) return true;
  if (hasAny(s, CONDITION_MARKERS) && (hasAny(s, IMPERATIVE_VERBS) || hasAny(s, MODAL))) return true;
  if (isProhibitive(s)) return true;      // 禁止句也是执行性的，只是形态不好（R1 管它）
  return false;
}

function isProse(s) {
  if (isExecutable(s)) return false;
  if (hasAny(s, PROSE_MARKERS)) return true;
  return s.length >= 14;                  // 不可执行又不短 = 在描述而不是在规定
}

// ---------- 单条规则 ----------

function ruleR1(sents) {
  const prohibit = sents.filter(s => isProhibitive(s.text));
  const guide = sents.filter(s => !isProhibitive(s.text) && isGuiding(s.text));
  const total = prohibit.length + guide.length;
  const ratio = total ? prohibit.length / total : 0;
  let status = 'pass', score = 92;
  if (!prohibit.length) { status = 'pass'; score = 96; }
  else if (ratio <= 0.25) { status = 'pass'; score = 88; }
  else if (ratio <= 0.45) { status = 'warn'; score = 58; }
  else { status = 'fail'; score = 26; }
  return {
    id: 'R1', status, score,
    summary: `禁止句 ${prohibit.length} 条 / 引导句 ${guide.length} 条，禁止占比 ${pct(prohibit.length, total || 1)}%`,
    metrics: { prohibit: prohibit.length, guide: guide.length, ratio: +ratio.toFixed(3) },
    evidence: prohibit.slice(0, 8).map(s => ({ line: s.line, text: s.text, note: '禁止性语句' })),
    advice: status === 'pass' ? '' : '把其中不属于硬红线的几条改写成"应该怎么做"。禁止留给真正不能越的线。'
  };
}

function ruleR2(sents) {
  const prohibit = sents.filter(s => isProhibitive(s.text));
  if (!prohibit.length) {
    return { id: 'R2', status: 'pass', score: 96, summary: '没有禁止性语句，本条自动通过', evidence: [], metrics: { total: 0 } };
  }
  const uncovered = [];
  prohibit.forEach(s => {
    const idx = sents.indexOf(s);
    const next = sents[idx + 1];
    // 同句里有替代方案标记，或下一句直接是可执行指令，都算给了出路
    const covered = hasAlternative(s.text)
      || (next && next.line <= s.line + 1 && (hasAlternative(next.text) || startsImperative(next.text)));
    if (!covered) uncovered.push(s);
  });
  const coverRate = (prohibit.length - uncovered.length) / prohibit.length;
  let status = 'pass', score = 90;
  if (coverRate >= 0.95) { status = 'pass'; score = 94; }
  else if (coverRate >= 0.6) { status = 'warn'; score = 60; }
  else { status = 'fail'; score = 24; }
  return {
    id: 'R2', status, score,
    summary: `${prohibit.length} 条禁止句里，${uncovered.length} 条没有给出替代做法（覆盖率 ${pct(prohibit.length - uncovered.length, prohibit.length)}%）`,
    metrics: { total: prohibit.length, uncovered: uncovered.length, coverRate: +coverRate.toFixed(3) },
    evidence: uncovered.slice(0, 8).map(s => ({ line: s.line, text: s.text, note: '缺少"那应该怎么做"' })),
    advice: status === 'pass' ? '' : '给每条禁止补一句正面写法：不是 X，而是 Y。'
  };
}

// R3 代码判不了根因，只能给"这几条像是同一族"的线索，最终由模型审查定性。
function ruleR3(sents) {
  const constraints = sents.filter(s => isExecutable(s.text));
  const byToken = new Map();
  for (const s of constraints) {
    const tokens = new Set((s.text.match(/[一-鿿]{2,4}/g) || []).filter(t => t.length >= 2));
    for (const tk of tokens) {
      if (!byToken.has(tk)) byToken.set(tk, []);
      byToken.get(tk).push(s);
    }
  }
  const clusters = [];
  for (const [tk, list] of byToken) {
    if (list.length >= 3 && tk.length >= 2) clusters.push({ token: tk, lines: list.slice(0, 4) });
  }
  clusters.sort((a, b) => b.lines.length - a.lines.length);
  const top = clusters.slice(0, 3);
  return {
    id: 'R3', status: 'skip', score: null,
    summary: top.length ? `代码只能给线索：有 ${top.length} 组约束反复围绕同一个词，可能是同一个根因的不同表现` : '本条由模型审查判定',
    metrics: { clusters: top.length },
    evidence: top.map(c => ({
      line: c.lines[0].line,
      text: c.lines.map(l => `L${l.line} ${l.text}`).join('\n'),
      note: `${c.lines.length} 条都提到「${c.token}」，考虑合并成一条`
    })),
    advice: ''
  };
}

function ruleR4(body, sources) {
  const N = 10;                                   // 连续 10 个有效字符重合就算照搬
  const grams = new Set();
  for (const src of sources) {
    const n = normalizeForCompare(src);
    for (let i = 0; i + N <= n.length; i++) grams.add(n.slice(i, i + N));
  }
  if (!grams.size) {
    return { id: 'R4', status: 'skip', score: null, summary: '没有可对比的原始需求文本', evidence: [], metrics: {} };
  }
  const hits = [];
  let copiedChars = 0, totalChars = 0;
  String(body || '').split('\n').forEach((line, i) => {
    const norm = normalizeForCompare(line);
    totalChars += norm.length;
    if (norm.length < N) return;
    let runStart = -1, runEnd = -1;
    for (let j = 0; j + N <= norm.length; j++) {
      if (grams.has(norm.slice(j, j + N))) {
        if (runStart < 0) runStart = j;
        runEnd = j + N;
      } else if (runStart >= 0 && j > runEnd) {
        hits.push({ line: i + 1, text: norm.slice(runStart, runEnd), note: `与需求原文重合 ${runEnd - runStart} 字` });
        copiedChars += runEnd - runStart;
        runStart = -1;
      }
    }
    if (runStart >= 0) {
      hits.push({ line: i + 1, text: norm.slice(runStart, runEnd), note: `与需求原文重合 ${runEnd - runStart} 字` });
      copiedChars += runEnd - runStart;
    }
  });
  const rate = totalChars ? copiedChars / totalChars : 0;
  let status = 'pass', score = 94;
  if (!hits.length) { status = 'pass'; score = 96; }
  else if (rate < 0.04) { status = 'warn'; score = 62; }
  else { status = 'fail'; score = 25; }
  return {
    id: 'R4', status, score,
    summary: hits.length ? `发现 ${hits.length} 处照搬片段，占正文 ${(rate * 100).toFixed(1)}%` : '没有发现照搬需求原文的片段',
    metrics: { hits: hits.length, rate: +rate.toFixed(4) },
    evidence: hits.slice(0, 8),
    advice: hits.length ? '这些片段是用户的症状描述，要翻译成可执行规约再写进去，而不是原样搬运。' : ''
  };
}

function ruleR5(body, format) {
  const lines = String(body || '').split('\n');
  const problems = [];
  let structureScore = 90;

  if (format === 'yaml') {
    let topKeys = 0, bad = 0, checked = 0;
    const seen = new Set();
    lines.forEach((l, i) => {
      if (!l.trim() || l.trim().startsWith('#')) return;
      checked++;
      const m = l.match(/^(\s*)([^\s:#][^:]*):(\s|$)/);
      if (m) {
        if (m[1].length === 0) {
          topKeys++;
          const k = m[2].trim();
          if (seen.has(k)) problems.push({ line: i + 1, text: l.trim(), note: '顶层键重复，后一个会覆盖前一个' });
          seen.add(k);
        }
        if (m[1].length % 2 !== 0) problems.push({ line: i + 1, text: l.trim(), note: '缩进不是 2 的倍数' });
      } else if (!/^\s*-\s+/.test(l) && !/^\s{2,}\S/.test(l)) {
        bad++;
        if (problems.length < 10) problems.push({ line: i + 1, text: l.trim(), note: '既不是键、列表项，也不像续行' });
      }
    });
    if (topKeys < 2) problems.push({ line: 1, text: '', note: `顶层只有 ${topKeys} 个键，分节不足` });
    if (checked && bad / checked > 0.2) structureScore = 30;
    else if (problems.length) structureScore = 58;
  } else if (format === 'xml') {
    const stack = [];
    lines.forEach((l, i) => {
      const re = /<\/?([A-Za-z_][\w.-]*)(\s[^>]*)?\/?>/g;
      let m;
      while ((m = re.exec(l))) {
        const tag = m[1], whole = m[0];
        if (whole.startsWith('</')) {
          if (!stack.length || stack[stack.length - 1].tag !== tag) {
            problems.push({ line: i + 1, text: whole, note: '闭合标签对不上' });
          } else stack.pop();
        } else if (!whole.endsWith('/>')) stack.push({ tag, line: i + 1 });
      }
    });
    for (const s of stack.slice(0, 6)) problems.push({ line: s.line, text: '<' + s.tag + '>', note: '标签没有闭合' });
    structureScore = problems.length ? (problems.length > 3 ? 28 : 55) : 92;
  } else {
    const headings = lines.filter(l => /^(#{1,4}\s|【.+】|第[一二三四五六七八九十]+[章节部分]|\d+[.、]\s*\S|[一二三四五六七八九十]+、)/.test(l.trim()));
    const chars = body.length;
    if (!headings.length && chars > 900) {
      problems.push({ line: 1, text: '', note: `${chars} 字没有任何分节标题，读起来是一整块` });
      structureScore = 34;
    } else if (headings.length < 3 && chars > 2000) {
      problems.push({ line: 1, text: '', note: `${chars} 字只有 ${headings.length} 个小节` });
      structureScore = 56;
    }
  }

  // 不分格式都要查：同一条约束散落在多处
  const norm = lines.map((l, i) => ({ i: i + 1, raw: l.trim(), n: normalizeForCompare(l) })).filter(x => x.n.length >= 8);
  const dupes = [];
  for (let a = 0; a < norm.length; a++) {
    for (let b = a + 1; b < norm.length; b++) {
      if (norm[b].i - norm[a].i < 3) continue;          // 相邻行重复多半是列表，不算
      const sim = jaccard(norm[a].n, norm[b].n);
      if (sim >= 0.72) {
        dupes.push({ line: norm[a].i, text: `L${norm[a].i}: ${norm[a].raw}\nL${norm[b].i}: ${norm[b].raw}`, note: `两处高度重复（${Math.round(sim * 100)}%），同一约束被说了两遍` });
        break;
      }
    }
    if (dupes.length >= 5) break;
  }
  if (dupes.length >= 3) structureScore = Math.min(structureScore, 40);
  else if (dupes.length) structureScore = Math.min(structureScore, 60);

  const all = problems.concat(dupes);
  const status = structureScore >= 75 ? 'pass' : structureScore >= 50 ? 'warn' : 'fail';
  return {
    id: 'R5', status, score: structureScore,
    summary: all.length ? `结构问题 ${all.length} 处（其中重复约束 ${dupes.length} 处）` : '结构自洽，分节清晰',
    metrics: { problems: problems.length, dupes: dupes.length },
    evidence: all.slice(0, 8),
    advice: dupes.length ? '重复的约束合并到一处。说三遍不会让模型更听话，只会让权重打架。' : ''
  };
}

function bigrams(s) {
  const set = new Set();
  for (let i = 0; i + 2 <= s.length; i++) set.add(s.slice(i, i + 2));
  return set;
}
function jaccard(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function ruleR6(outline, body) {
  if (!outline || !outline.trim()) {
    return { id: 'R6', status: 'skip', score: null, summary: '没有可对照的大纲，这一条跳过', evidence: [], metrics: {} };
  }
  const nodes = outline.split('\n')
    .map(l => l.trim())
    .filter(l => /^([-*•]|\d+[.、)]|[一二三四五六七八九十]+[、.)]|#{1,4}\s)/.test(l))
    .map(l => l.replace(/^([-*•]|\d+[.、)]|[一二三四五六七八九十]+[、.)]|#{1,4})\s*/, '').split(/[：:—-]/)[0].trim())
    .filter(t => t.length >= 2);
  if (!nodes.length) {
    return { id: 'R6', status: 'warn', score: 55, summary: '大纲里找不到可识别的层级节点', evidence: [], metrics: {} };
  }
  const bodyNorm = normalizeForCompare(body);
  const missing = [];
  let hit = 0;
  for (const node of nodes) {
    const n = normalizeForCompare(node);
    if (!n) continue;
    if (bodyNorm.includes(n)) { hit++; continue; }
    // 标题未必原样出现，退一步比 bigram 覆盖率
    const grams = bigrams(n);
    let found = 0;
    for (const g of grams) if (bodyNorm.includes(g)) found++;
    if (grams.size && found / grams.size >= 0.7) hit++;
    else missing.push(node);
  }
  const cov = hit / nodes.length;
  const status = cov >= 0.85 ? 'pass' : cov >= 0.6 ? 'warn' : 'fail';
  return {
    id: 'R6', status, score: Math.round(cov * 100),
    summary: `大纲 ${nodes.length} 个节点，正文落地 ${hit} 个（覆盖率 ${Math.round(cov * 100)}%）`,
    metrics: { nodes: nodes.length, hit, coverage: +cov.toFixed(3) },
    evidence: missing.slice(0, 8).map(t => ({ line: 0, text: t, note: '大纲里有，正文里没找到' })),
    advice: missing.length ? '要么把漏掉的节点补进正文，要么把大纲里不该有的节点删掉 —— 两边必须对得上。' : ''
  };
}

function ruleR7(sents) {
  const exec = [], prose = [];
  for (const s of sents) {
    if (isExecutable(s.text)) exec.push(s);
    else if (isProse(s.text)) prose.push(s);
  }
  const total = exec.length + prose.length;
  const ratio = total ? exec.length / total : 0;
  const status = ratio >= 0.6 ? 'pass' : ratio >= 0.4 ? 'warn' : 'fail';
  return {
    id: 'R7', status, score: Math.round(clamp(ratio * 125, 0, 100)),
    summary: `执行性语句 ${exec.length} 句 / 散文性语句 ${prose.length} 句，执行度 ${pct(exec.length, total || 1)}%`,
    metrics: { exec: exec.length, prose: prose.length, ratio: +ratio.toFixed(3) },
    evidence: prose.slice(0, 8).map(s => ({ line: s.line, text: s.text, note: '不可判定，更像设定集而不是规约' })),
    advice: status === 'pass' ? '' : '把描述句改成"条件→动作"：什么时候、做什么、做到什么程度。'
  };
}

function ruleR8(body, banwordSet) {
  const hits = scanTerms(body, banwordSet);
  const hard = hits.filter(h => h.severity === 'hard');
  const soft = hits.filter(h => h.severity !== 'hard');
  const status = hard.length ? 'fail' : soft.length > 2 ? 'warn' : 'pass';
  const byTerm = new Map();
  for (const h of hits) byTerm.set(h.term, (byTerm.get(h.term) || 0) + 1);
  const listed = Array.from(byTerm.entries()).sort((a, b) => b[1] - a[1]);
  return {
    id: 'R8', status,
    score: hard.length ? Math.max(10, 50 - hard.length * 8) : soft.length ? 70 : 96,
    summary: hits.length
      ? `命中禁词 ${hits.length} 次（硬命中 ${hard.length}）：${listed.slice(0, 6).map(([t, c]) => t + (c > 1 ? `×${c}` : '')).join('、')}`
      : '没有命中禁词表',
    metrics: { hits: hits.length, hard: hard.length, soft: soft.length },
    evidence: hits.slice(0, 10).map(h => ({ line: h.line, text: h.snippet, note: `命中「${h.term}」（${h.severity === 'hard' ? '硬' : '可疑'}）` })),
    advice: hard.length ? '八股词写进世界书，生成时会被放大成整篇的腔调。换成这个世界里具体的东西。' : ''
  };
}

// ---------- 过拟合指标 ----------
// 规则本身不能变成新的八股。约束太密会把模型的发挥空间压没，回应就会僵。

function overfitMetrics(body, sents) {
  const constraints = sents.filter(s => isExecutable(s.text));
  const prohibit = sents.filter(s => isProhibitive(s.text));
  const chars = String(body || '').length;
  const density = sents.length ? constraints.length / sents.length : 0;
  const prohibitDensity = constraints.length ? prohibit.length / constraints.length : 0;
  const perKiloChar = chars ? (constraints.length / chars) * 1000 : 0;
  // 紧度：约束密度和"每千字约束条数"各占一半，禁止密度做加权惩罚
  const tightness = Math.round(clamp(density * 55 + clamp(perKiloChar / 18, 0, 1) * 35 + prohibitDensity * 20, 0, 100));
  let verdict = 'ok', note = '约束密度在合理区间，既给了方向也留了发挥空间。';
  if (tightness > 76) { verdict = 'tight'; note = '约束过密，模型几乎每句话都在被规定，回应容易变呆板。挑出最关键的几条，其余降级为倾向性描述。'; }
  else if (tightness < 24) { verdict = 'loose'; note = '约束偏松，关键行为没有可判定的落点，模型会按自己的默认习惯来。'; }
  return {
    tightness, verdict, note,
    constraints: constraints.length, sentences: sents.length,
    perKiloChar: +perKiloChar.toFixed(1), chars,
    band: [35, 68]
  };
}

// ---------- 总入口 ----------

function auditLocal({ body, outline = '', question = '', injected = '', format = 'natural', banwordSet }) {
  const text = String(body || '');
  const sents = splitSentences(text);
  const set = banwordSet || buildBanwordSet({ useBuiltin: true, custom: [] });
  const results = [
    ruleR1(sents),
    ruleR2(sents),
    ruleR3(sents),
    ruleR4(text, [question, injected].filter(Boolean)),
    ruleR5(text, format),
    ruleR6(outline, text),
    ruleR7(sents),
    ruleR8(text, set)
  ];
  return {
    results,
    overfit: overfitMetrics(text, sents),
    score: overallScore(results),
    at: Date.now()
  };
}

// ---------- 自评对账 ----------
// 模型自称通过、本地实测不通过的那一条，是整份报告里信息量最大的地方。

function reconcile(localResults, llmResults, selfCheck) {
  const byId = new Map();
  for (const r of localResults) byId.set(r.id, Object.assign({}, r, { from: 'local' }));

  for (const r of (llmResults || [])) {
    const cur = byId.get(r.id);
    if (!cur) { byId.set(r.id, Object.assign({}, r, { from: 'llm' })); continue; }
    const merged = Object.assign({}, cur);
    merged.llm = { status: r.status, summary: r.summary, advice: r.advice };
    // 本地判定优先（它是确定的）；本地 skip 的（R3 这种）直接采用模型结论。
    if (cur.status === 'skip' && r.status) {
      merged.status = r.status;
      merged.score = r.score != null ? r.score : (r.status === 'pass' ? 88 : r.status === 'warn' ? 55 : 25);
      merged.summary = r.summary || cur.summary;
      merged.from = 'llm';
      if (cur.evidence?.length) merged.evidence = cur.evidence.concat(r.evidence || []);
      else merged.evidence = r.evidence || [];
    } else if (cur.status === 'pass' && r.status === 'fail') {
      // 代码说通过、模型说不通过：多半是代码判不到的语义问题，降到提示级别别直接翻案
      merged.status = 'warn';
      merged.score = Math.min(cur.score ?? 80, 58);
      merged.summary = cur.summary + ' ｜ 模型审查有异议：' + (r.summary || '');
      merged.evidence = (cur.evidence || []).concat(r.evidence || []);
    } else if (r.evidence?.length) {
      merged.evidence = (cur.evidence || []).concat(r.evidence);
    }
    byId.set(r.id, merged);
  }

  const results = RULES.map(rule => byId.get(rule.id) || { id: rule.id, status: 'skip', summary: '未检查', evidence: [] });

  // 和模型的 <self_check> 对账
  const mismatches = [];
  if (selfCheck && Array.isArray(selfCheck.checks)) {
    for (const c of selfCheck.checks) {
      const actual = byId.get(c.id);
      if (!actual || actual.status === 'skip') continue;
      const claimed = String(c.status || '').toLowerCase();
      const claimedPass = claimed === 'pass' || claimed === 'yes' || c.ok === true;
      if (claimedPass && actual.status === 'fail') {
        mismatches.push({ id: c.id, claim: c.note || '自称已遵守', actual: actual.summary, level: 'fail' });
      } else if (claimedPass && actual.status === 'warn') {
        mismatches.push({ id: c.id, claim: c.note || '自称已遵守', actual: actual.summary, level: 'warn' });
      }
    }
  }
  return { results, mismatches, score: overallScore(results) };
}

return { splitSentences, normalizeForCompare, overfitMetrics, auditLocal, reconcile };
})();

__M['prompt'] = (function () {
'use strict';
// 所有 prompt 的组装。工具真正的资产在这里 —— 别的都是外壳。
//
// 一个贯穿始终的立场：世界书不是给人看的设定集，是给另一个模型在运行时读的规约。
// 凡是"不可判定"的句子，对被注入的那个模型来说就等于没写。

const { RULES } = __M['rules'];
const FORMAT_SPEC = {
  yaml: {
    label: 'YAML',
    zh: `输出格式：YAML。
- 顶层按职责分节（例如 world / rules / style / taboo / examples），每节职责单一，不重叠。
- 值里如果有冒号、井号、引号，整个值用双引号包起来。
- 多行文本用 |- 块标量，不要靠续行符硬接。
- 不要输出 \`\`\` 围栏，不要在 YAML 之外写任何解释文字。`,
    en: `Output format: YAML. Group top-level keys by single responsibility; quote values containing ':' or '#'; use |- block scalars for multi-line text; emit no code fences and no prose outside the YAML.`
  },
  xml: {
    label: 'XML',
    zh: `输出格式：XML。
- 用语义化标签分节（例如 <world>、<rule>、<style>、<taboo>、<example>），每个标签职责单一。
- 标签必须成对闭合，属性值用双引号。
- 正文里出现 < > & 时转义。
- 不要输出 \`\`\` 围栏，不要在 XML 之外写任何解释文字。`,
    en: `Output format: XML. Use semantic single-purpose tags, close every tag, quote attributes, escape < > &, emit no code fences and no prose outside the XML.`
  },
  natural: {
    label: '自然语言',
    zh: `输出格式：自然语言，但必须有明确分节。
- 用 ## 二级标题分节，每节一个职责。
- 节内用短条目，一条一个约束，不要写成大段。
- 不要输出 \`\`\` 围栏，不要写开场白和总结语。`,
    en: `Output format: structured natural language. Use '##' headings, one responsibility per section, one constraint per bullet, no code fences, no preamble or closing summary.`
  }
};

const LANG_SPEC = {
  zh: '世界书正文用简体中文书写。',
  en: 'Write the world book body in English.'
};

// 写作契约：八条规则翻译成"怎么写"，而不是"别怎么写" —— 规约本身也要守 R1。
function contractBlock(lang) {
  if (lang === 'en') {
    return RULES.map(r => `${r.id} ${r.name}: ${r.ask}`).join('\n');
  }
  return [
    'R1 引导优先于禁止：默认写"应该怎么做"。确实需要硬拦的红线才用禁止句，数量控制在全文的少数。',
    'R2 禁止必须配替代：每出现一条禁止，紧跟着给出正面写法（不是 X，而是 Y），让被注入的模型知道往哪儿走。',
    'R3 抓根因、按类归并：用户描述的是症状。先判断这些症状背后是同一个根因还是几个，然后一条规则盖住一族问题，不要为每个例子单独写一条。',
    'R4 不照搬用户原话：用户的话是症状描述，你要输出的是可执行规约。概念保留，表述重写。',
    'R5 有结构：每节职责单一，同一条约束只在一处出现。同一件事说三遍，会被读成三条互相打架的强约束。',
    'R6 先大纲后正文：按已确定的大纲逐节展开，不跑题也不漏节点。',
    'R7 执行性语句：写成"条件 → 动作 → 程度"。"这是一个神秘的世界"无法执行；"提到地名时补一句该地当下的气候"可以执行。',
    'R8 无 AI 八股：不使用套路化的固定表达。要写具体的、只属于这个世界的东西。'
  ].join('\n');
}

function antiOverfitBlock(lang) {
  if (lang === 'en') {
    return `Anti-overfitting: constraints exist to point in a direction, not to script every sentence. Keep only the constraints that change behaviour. Over-specified world books make the target model rigid and repetitive.`;
  }
  return `反过拟合（同等重要）：
- 约束是用来指方向的，不是用来把每句话都写死的。只保留"会改变行为"的约束，可有可无的一律删掉。
- 示例是示范而不是模板。要明确写出"示例展示的是方法，不是可以直接复用的句子"。
- 规定"做什么"和"做到什么程度"，把"具体怎么说"留给被注入的模型。
- 宁可少写三条，也不要写出一份让模型只能填空的清单 —— 那会让回应变呆板，这本身就是失败。`;
}

const PLACEHOLDER_BLOCK = `占位符规则：
- 角色一律写成 {{char}}，用户一律写成 {{user}}，不要写死具体名字。
- 占位符原样输出，不要翻译、不要加空格、不要改大小写。`;

// ---------- 上下文拼装 ----------
// injected（用户自己写的世界书片段）永远排在最前：它的优先级高于本工具的规约。

function buildSystem(ctx) {
  const lang = ctx.lang === 'en' ? 'en' : 'zh';
  const parts = [];

  if (ctx.injected && ctx.injected.trim()) {
    parts.push(`<user_injected_worldbook priority="highest">
以下是用户自己提供的世界书片段。它的优先级高于本文档中其他任何规约：
凡是与下面内容冲突的要求，一律以下面为准。

${ctx.injected.trim()}
</user_injected_worldbook>`);
  }

  parts.push(lang === 'en'
    ? `You are a world book (lorebook) engineer. Your output is not a setting document for humans to read: it is a runtime specification that another language model will read while generating. A sentence that cannot be acted on is a sentence that does not exist.`
    : `你是一名世界书工程师。你的产物不是给人读的设定集，而是会被注入到另一个语言模型上下文里、在它生成时约束它行为的**运行时规约**。
一句无法判定、无法执行的话，对那个模型来说等于没写。`);

  parts.push((lang === 'en' ? 'WRITING CONTRACT (you will be asked to self-check against each item):\n' : '写作契约（最后要逐条自检）：\n') + contractBlock(lang));
  parts.push(antiOverfitBlock(lang));
  if (lang === 'zh') parts.push(PLACEHOLDER_BLOCK);
  else parts.push(`Placeholders: always write {{char}} and {{user}} verbatim; never hard-code names.`);
  parts.push(LANG_SPEC[lang]);

  if (ctx.banwords && ctx.banwords.length) {
    parts.push(`禁词表（正文里一次都不能出现，包括变体）：
${ctx.banwords.map(w => '· ' + w).join('\n')}
这些词不是"不好的词"，而是被用滥到失去信息量的默认反射。要表达同样的意思，就写这个世界里具体的人、物、规矩。`);
  }

  if (ctx.seriesBlock) parts.push(ctx.seriesBlock);
  if (ctx.memoryBlock) parts.push(ctx.memoryBlock);
  if (ctx.profileBlock) parts.push(ctx.profileBlock);

  return parts.join('\n\n---\n\n');
}

function requirementBlock(ctx) {
  const rows = [`【需求】\n${(ctx.question || '').trim() || '（未填写）'}`];
  if (ctx.tuning && ctx.tuning.trim()) rows.push(`【细调要求】\n${ctx.tuning.trim()}`);
  if (ctx.targetModelKey) rows.push(`【目标模型】这份世界书最终会注入给 ${ctx.targetModelKey} 使用。`);
  if (ctx.lengthTarget) rows.push(`【篇幅期望】正文约 ${ctx.lengthTarget} 字上下，不要为凑字数注水。`);
  return rows.join('\n\n');
}

// ---------- 阶段 A：大纲 ----------

function buildOutlineUser(ctx) {
  return `${requirementBlock(ctx)}

现在只做第一步：写大纲。不要写正文。

先做一次根因判断，再写大纲：
1. 用户描述的是症状。判断这些症状背后是**一个根因**还是**几个根因**，分别是什么。
2. 如果几条症状同源，合并成一条，不要为每个例子各写一条。

然后输出由浅入深的层级大纲：
- 第一层：这份世界书分几节，每节的职责一句话说清。
- 第二层：每节下面准备写哪几条约束，每条一句话。
- 顺序要求由浅入深：先定"是什么"（世界/角色的基本设定），再定"怎么动"（行为与交互规则），最后才是"边界与红线"。

输出格式：
## 根因判断
（编号列出，每条：症状 → 根因 → 打算用哪一节盖住它）

## 大纲
（层级列表，用 - 和缩进。每个节点写清标题，标题后用 ：补一句职责说明）

只输出这两节，不要写正文，不要写解释。`;
}

// ---------- 阶段 B：正文 ----------

function buildBodyUser(ctx, outline) {
  const fmt = FORMAT_SPEC[ctx.format] || FORMAT_SPEC.natural;
  return `${requirementBlock(ctx)}

已确定的大纲如下，正文必须严格按它展开 —— 每个节点都要落地，不要新增大纲之外的节，也不要漏：

${outline}

${ctx.lang === 'en' ? fmt.en : fmt.zh}

写正文时再确认一遍：
- 每一条都是"条件 → 动作 → 程度"，能被判定有没有做到。
- 出现禁止句时，紧跟正面写法。
- 同一条约束只出现在一处。
- {{char}} / {{user}} 原样写。
- 不要照搬需求原文的措辞。
- 留出发挥空间：规定做什么和做到什么程度，不要规定每句话怎么说。

现在只输出世界书正文本身。不要前言、不要结语、不要解释、不要围栏。`;
}

// ---------- 阶段 C：示例 ----------

function buildExamplesUser(ctx, body) {
  const n = ctx.exampleCount || 2;
  return `下面是刚写好的世界书正文：

<worldbook>
${body}
</worldbook>

现在补三类示例，帮被注入的模型理解这些约束**怎么落地**。

三类各 ${n} 条：
1. **正常例**：最常见的使用情形下，符合约束的正确写法。
2. **边界例**：约束的边缘地带（规则之间打架、信息不足、用户跑题）。给出在这种情形下的正确处理方式。
3. **易错例**：最容易写错的那几处。**输出的仍然是正确写法**，只在示例前用一行「易错点：……」说明它容易被写成什么样，示例正文本身必须是正确的 —— 绝不要写出错误示范，错误示范会被模型当成可模仿的样本。

每条示例的结构：
- 情境：一句话
- 正确写法：具体内容（用 {{char}} / {{user}}）
- 为什么对：一句话，指回它对应的是哪条约束

最后加一句：示例展示的是方法，不是可以直接复用的句子。

只输出示例部分，格式与正文保持一致（${(FORMAT_SPEC[ctx.format] || FORMAT_SPEC.natural).label}）。`;
}

// ---------- 阶段 D：自检 ----------

function buildSelfCheckUser(ctx, body, examples) {
  const ruleLines = RULES.map(r => `- ${r.id} ${r.name}：${r.ask}`).join('\n');
  return `这是你刚刚写完的世界书（正文 + 示例）：

<worldbook>
${body}
${examples ? '\n' + examples : ''}
</worldbook>

现在对照写作契约逐条自检。要求：

1. **逐条给结论**，不许跳过，不许含糊。
2. 每条必须带**证据定位**：通过就引一句能证明的原文，不通过就引出问题的那句原文。引不出原文的，一律判 fail。
3. 你的自检会和一套独立的静态检查对账。自称通过而实测不通过的条目会被单独标出来 —— 所以宁可判 fail 也不要含混地判 pass。

契约：
${ruleLines}

只输出一个 JSON，包在 <self_check> 标签里：

<self_check>
{
  "checks": [
    { "id": "R1", "status": "pass|warn|fail", "evidence": "原文片段", "note": "一句话说明" }
  ],
  "known_weakness": "这一版你自己最不满意的一处，一句话",
  "left_open": "你刻意没有写死、留给模型发挥的是哪些方面，一句话"
}
</self_check>`;
}

// ---------- 独立审查（换一个上下文，不让它看见生成器的规约） ----------

function buildAuditSystem() {
  return `你是世界书的审查员。你只做审查，不改写、不生成。

你面前这份世界书是给另一个语言模型在运行时读的规约。判断标准只有一个：
**被注入的模型读完，能不能明确知道自己该做什么、做到什么程度。**

审查时注意：
- 你没有看到写作者的思路，也不需要看到。只看成品。
- 每条结论必须引原文。引不出原文的结论不要写。
- 区分"确实是问题"和"你个人偏好"。只报前者。
- 同时注意反向问题：约束是不是过密，把模型的发挥空间压没了 —— 这同样是缺陷。`;
}

function buildAuditUser(body, focusRules, extra = {}) {
  const rules = (focusRules && focusRules.length ? RULES.filter(r => focusRules.includes(r.id)) : RULES);
  // inline 模式：把分析挤进同一份 JSON。省一次调用，但它是边判边写，
  // 深度不如单独跑那一次 —— 所以字段说明里明确要求写成段落而不是复述结论。
  const analysisField = extra.inlineAnalysis
    ? `,\n  "analysis": "详细分析：这份世界书注入之后模型大概会怎么表现，为什么是这些结论，先改哪一条收益最大。写成连贯段落，不要复述上面的逐条结论。"`
    : '';
  return `<worldbook>
${body}
</worldbook>
${extra.question ? `\n<original_request>\n${extra.question}\n</original_request>\n` : ''}
逐条审查：

${rules.map(r => `${r.id} ${r.name}
  判断要点：${r.ask}
  为什么重要：${r.why}`).join('\n\n')}

只输出 JSON：

{
  "results": [
    { "id": "R1", "status": "pass|warn|fail", "summary": "一句话结论",
      "evidence": [{ "text": "原文片段", "note": "这一处的问题/佐证" }],
      "advice": "要改的话，改成什么样（给正面写法）" }
  ],
  "biggest_problem": "如果只能改一处，改哪一处，为什么",
  "overfit_risk": "none|low|medium|high",
  "overfit_note": "约束密度是否压住了发挥空间，一句话"${analysisField}
}`;
}

// ---------- 详细分析（单独跑的那一次） ----------
// 和审查分开是有道理的：审查要的是克制和可引证，一条一条判；
// 分析要的是把这些孤立的判断串成因果，并且它手里已经有了评分和证据，
// 不用再自己判一遍。两件事混在一次调用里，模型往往两头都做不深。

function buildAnalysisSystem() {
  return `你是世界书的分析师。审查已经做完了 —— 评分、逐条结论、原文证据都在下面，
你不需要重新判一遍，也不要推翻它们。

你要回答的是审查报告回答不了的那部分：

- 这份世界书被注入之后，那个模型实际会写成什么样。具体到它会怎么处理对话、
  怎么处理场景、哪些地方它会自由发挥、哪些地方它会照着模板走。
- 这些分散的扣分项背后是不是同一个根因。是的话，根因是什么。
- 如果只有一次修改机会，改哪里收益最大；改完之后分数大概能到哪一档。
- 哪些地方**不要**动。分数低的地方未必都该改 —— 有些是留白，改了反而把模型框死。

写成连贯的段落，不要列一二三四，不要复述逐条结论，不要客套。
引原文时用引号带上原句。`;
}

function buildAnalysisUser({ body, auditDigest, question, format, score }) {
  return `<worldbook>
${body}
</worldbook>
${question ? `\n<original_request>\n${question}\n</original_request>\n` : ''}
<audit_report score="${score}">
${auditDigest}
</audit_report>

格式：${(FORMAT_SPEC[format] || FORMAT_SPEC.natural).label}

按上面的要求写分析。直接给正文，不要标题、不要 JSON、不要围栏。`;
}

// ---------- 修订（带着审查结论去改） ----------

function buildReviseUser(ctx, prevBody, instructions, auditDigest) {
  return `这是当前版本的世界书：

<worldbook>
${prevBody}
</worldbook>

${auditDigest ? `独立审查的结论（含评分、逐条判定和详细分析）：\n${auditDigest}\n` : ''}
${instructions ? `本轮要解决的问题：\n${instructions}\n` : ''}
修订要求：
- **改根因，不打补丁**。如果这次的问题和上一轮是同一族，就改那条总规则，而不是再加一条特例。
- 只改需要改的地方，其余原样保留。不要借机重写全文。
- 改完之后总约束条数不应明显增加。若新增了约束，检查是不是有旧的该删了 —— 越改越长是过拟合的征兆。
- 保持原格式（${(FORMAT_SPEC[ctx.format] || FORMAT_SPEC.natural).label}）和原有的分节结构。

只输出修订后的完整世界书正文，不要解释、不要 diff、不要围栏。`;
}


return { FORMAT_SPEC, buildSystem, buildOutlineUser, buildBodyUser, buildExamplesUser, buildSelfCheckUser, buildAuditSystem, buildAuditUser, buildAnalysisSystem, buildAnalysisUser, buildReviseUser };
})();

__M['diff'] = (function () {
'use strict';
// 行级 diff。版本对比用，顺便给用户画像提供"用户到底改了哪儿"的原料。
// 经典 LCS 动态规划，世界书这个量级（几百行）完全够用。

function diffLines(oldText, newText) {
  const a = String(oldText || '').split('\n');
  const b = String(newText || '').split('\n');
  const n = a.length, m = b.length;

  // 行数太多时退化成"整块替换"，避免 O(n*m) 把页面卡死
  if (n * m > 4000000) {
    return [{ type: 'del', text: a.join('\n') }, { type: 'add', text: b.join('\n') }];
  }

  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i++] }); }
    else { out.push({ type: 'add', text: b[j++] }); }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}

function diffStats(rows) {
  return {
    added: rows.filter(r => r.type === 'add').length,
    removed: rows.filter(r => r.type === 'del').length,
    same: rows.filter(r => r.type === 'same').length
  };
}

// 折叠连续的未改动行，只留上下文。报告和画像分析都不需要看全文。
function collapse(rows, context = 2) {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => {
    if (r.type === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = true;
  });
  const out = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    if (keep[i]) {
      if (skipped) { out.push({ type: 'gap', text: `… 省略 ${skipped} 行未改动 …` }); skipped = 0; }
      out.push(r);
    } else skipped++;
  });
  if (skipped) out.push({ type: 'gap', text: `… 省略 ${skipped} 行未改动 …` });
  return out;
}

// 给模型看的紧凑 diff 文本（画像分析的输入）
function diffDigest(oldText, newText, maxLines = 60) {
  const rows = collapse(diffLines(oldText, newText), 1).filter(r => r.type !== 'same');
  return rows.slice(0, maxLines)
    .map(r => (r.type === 'add' ? '+ ' : r.type === 'del' ? '- ' : '  ') + r.text)
    .join('\n');
}

return { diffLines, diffStats, collapse, diffDigest };
})();

__M['series'] = (function () {
'use strict';
// 系列世界书：新的一本要和已有的几本形成体系，而不是各写各的。
//
// 三件事：把已有世界书里的约束抽出来 → 生成时告诉模型"这些已经有人管了，别重复也别打架"
// → 生成后回头检测有没有撞车。

const { normalizeForCompare } = __M['audit'];
const { PROHIBIT, GUIDE } = __M['lexicon'];
const { truncate } = __M['util'];
// 抽约束：带上所属小节，这样提示里能说清"第几本的哪一节已经管了这件事"
function extractConstraints(text) {
  const lines = String(text || '').split('\n');
  let section = '';
  const out = [];
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (!l) return;
    const h = l.match(/^(?:#{1,4}\s*|【)([^】]+)【?】?$/) || l.match(/^([A-Za-z_一-鿿][\w一-鿿 ]*):\s*$/);
    if (h) { section = h[1].trim(); return; }
    const body = l.replace(/^[-*•\d.、)\s]+/, '').replace(/^[\w一-鿿]+:\s*/, '');
    if (body.length < 6) return;
    out.push({ section, text: body, line: i + 1 });
  });
  return out;
}

// 注入块：排在 system 里，告诉模型已有的地盘在哪
function buildSeriesBlock(books, { maxPerBook = 14 } = {}) {
  if (!books || !books.length) return '';
  const blocks = books.map((b, idx) => {
    const cons = extractConstraints(b.content).slice(0, maxPerBook);
    return `【第 ${idx + 1} 本：${b.title || '未命名'}】
${cons.map(c => `- ${c.section ? '[' + c.section + '] ' : ''}${truncate(c.text, 90)}`).join('\n') || '（没能抽出明确约束）'}`;
  }).join('\n\n');

  return `<series_context>
这份世界书属于一个系列。同系列已有的世界书，它们的约束如下：

${blocks}

写新的一本时：
1. **不要重复**上面已经明确规定过的东西。已经有人管的地盘，一句话带过并指明"沿用既有设定"即可。
2. **不要打架**。新约束与上面任何一条冲突时，优先服从已有的；确实需要改动既有设定的，单独在末尾列一节「对既有设定的调整」，写清改哪一条、为什么。
3. **形成体系**：新的一本要补上已有几本没覆盖到的位置，而不是在同一层面再写一遍。明确说出这一本在系列里的定位。
4. 如果发现已有世界书里有**应该删掉或收紧**的约束（比如被新内容取代、或者当初写得过死），在末尾「对既有设定的调整」里提出来。
</series_context>`;
}

// 生成后回头查：和已有世界书撞车没有
function detectConflicts(newBody, books) {
  const news = extractConstraints(newBody);
  const issues = [];
  for (const book of books || []) {
    const olds = extractConstraints(book.content);
    for (const n of news) {
      const nn = normalizeForCompare(n.text);
      if (nn.length < 8) continue;
      for (const o of olds) {
        const on = normalizeForCompare(o.text);
        if (on.length < 8) continue;
        const sim = overlap(nn, on);
        if (sim < 0.42) continue;
        // 极性要先判：说的是同一件事而一个要求做、一个要求不做，这是冲突不是重复。
        // 反过来先判相似度的话，"应当使用现代词汇"和"不要使用现代词汇"会被当成重复放过去。
        if (polarity(n.text) * polarity(o.text) < 0) {
          issues.push({ kind: 'conflict', book: book.title, line: n.line, newText: n.text, oldText: o.text, sim });
        } else if (sim >= 0.7) {
          issues.push({ kind: 'dup', book: book.title, line: n.line, newText: n.text, oldText: o.text, sim });
        }
      }
    }
  }
  const seen = new Set();
  return issues.filter(x => {
    const k = x.kind + x.line + x.oldText.slice(0, 20);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => (a.kind === 'conflict' ? -1 : 1) - (b.kind === 'conflict' ? -1 : 1)).slice(0, 20);
}

function polarity(s) {
  const neg = PROHIBIT.some(w => s.includes(w));
  const pos = GUIDE.some(w => s.includes(w));
  return neg ? -1 : pos ? 1 : 0;
}

function overlap(a, b) {
  const grams = x => { const s = new Set(); for (let i = 0; i + 2 <= x.length; i++) s.add(x.slice(i, i + 2)); return s; };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

return { extractConstraints, buildSeriesBlock, detectConflicts };
})();

__M['memory'] = (function () {
'use strict';
// 模型档案：这个模型容易犯什么、以前什么招管用。
//
// 用户说"这里不好"的时候，那是**感受**，不一定是根因。要判断根因，需要三样东西：
// 这一版的实测审查结果、这个模型的历史问题、以前用过什么对策且是否有效。
// 归因（attribute）就是把这三样喂给模型，让它给出根因假设而不是补丁。

const { get, put, all } = __M['db'];
const { RULE_BY_ID } = __M['rules'];
const { truncate, fmtTime, uid } = __M['util'];
async function getModelProfile(modelKey) {
  if (!modelKey) return null;
  const p = await get('modelProfiles', modelKey);
  return p || { modelKey, issues: [], remedies: [], runs: 0, updatedAt: 0 };
}

async function listModelProfiles() {
  const rows = await all('modelProfiles');
  return rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// 每次审查完把结果记进档案：哪条规则又栽了
async function recordAudit(modelKey, results, { overfit } = {}) {
  if (!modelKey) return null;
  const p = await getModelProfile(modelKey);
  p.runs = (p.runs || 0) + 1;
  for (const r of results || []) {
    if (r.status !== 'fail' && r.status !== 'warn') continue;
    let item = p.issues.find(x => x.ruleId === r.id);
    if (!item) { item = { ruleId: r.id, count: 0, fails: 0, samples: [] }; p.issues.push(item); }
    item.count++;
    if (r.status === 'fail') item.fails++;
    item.lastSeen = Date.now();
    const sample = truncate(r.summary, 70);
    if (sample && !item.samples.includes(sample)) item.samples = [sample, ...item.samples].slice(0, 3);
  }
  if (overfit && overfit.verdict === 'tight') {
    let item = p.issues.find(x => x.ruleId === 'OVERFIT');
    if (!item) { item = { ruleId: 'OVERFIT', count: 0, fails: 0, samples: [] }; p.issues.push(item); }
    item.count++; item.lastSeen = Date.now();
    item.samples = [`约束紧度 ${overfit.tightness}`].concat(item.samples).slice(0, 3);
  }
  p.issues.sort((a, b) => b.count - a.count);
  p.updatedAt = Date.now();
  await put('modelProfiles', p);
  return p;
}

// 记一次对策 + 它有没有用。"有没有用"是这个档案里最值钱的一列。
async function recordRemedy(modelKey, { text, ruleId = '', worked = null, note = '' }) {
  if (!modelKey || !text) return null;
  const p = await getModelProfile(modelKey);
  let item = p.remedies.find(x => x.text === text);
  if (!item) { item = { id: uid('rem'), text, ruleId, tried: 0, worked: 0, failed: 0, note }; p.remedies.push(item); }
  item.tried++;
  if (worked === true) item.worked++;
  else if (worked === false) item.failed++;
  item.lastUsed = Date.now();
  if (note) item.note = note;
  p.updatedAt = Date.now();
  await put('modelProfiles', p);
  return p;
}

async function setRemedyOutcome(modelKey, remedyId, worked) {
  const p = await getModelProfile(modelKey);
  const item = p.remedies.find(x => x.id === remedyId);
  if (!item) return p;
  if (worked) item.worked++; else item.failed++;
  p.updatedAt = Date.now();
  await put('modelProfiles', p);
  return p;
}

// 注入块。刻意写成"倾向性提示"而不是硬约束 —— 历史问题是先验，不是当前需求。
async function buildMemoryBlock(modelKey, { max = 5 } = {}) {
  const p = await getModelProfile(modelKey);
  if (!p || (!p.issues.length && !p.remedies.length)) return '';
  const issues = p.issues.filter(i => i.count >= 1).slice(0, max);
  const remedies = p.remedies
    .filter(r => r.worked > 0)
    .sort((a, b) => (b.worked / Math.max(1, b.tried)) - (a.worked / Math.max(1, a.tried)))
    .slice(0, max);
  if (!issues.length && !remedies.length) return '';

  const lines = [`<model_memory model="${modelKey}" runs="${p.runs || 0}">`,
    '以下是这个目标模型在过去若干版里的**实测倾向**。它是先验，不是当前需求：',
    '与本次需求冲突时，一律以需求为准；不要为了迎合这些倾向而写出多余的约束。'];
  if (issues.length) {
    lines.push('', '【它反复栽在这些地方】');
    for (const i of issues) {
      const rule = i.ruleId === 'OVERFIT' ? { name: '约束过密导致发挥受限' } : RULE_BY_ID[i.ruleId];
      lines.push(`- ${i.ruleId} ${rule ? rule.name : ''}：出现 ${i.count} 次（其中判定不通过 ${i.fails || 0} 次）${i.samples?.[0] ? '，例如「' + i.samples[0] + '」' : ''}`);
    }
    lines.push('针对这几处，写的时候把要求写得更可判定一些，但**不要额外加条数**。');
  }
  if (remedies.length) {
    lines.push('', '【以前对它有效的写法】');
    for (const r of remedies) lines.push(`- ${r.text}（用过 ${r.tried} 次，有效 ${r.worked} 次）`);
    lines.push('这些手法可以优先复用。');
  }
  lines.push('</model_memory>');
  return lines.join('\n');
}

// ---------- 归因 ----------

function buildAttributionSystem() {
  return `你在做的是**归因**，不是修改。

用户给出的是感受（"这里不好""怪怪的"），感受指向的位置常常不是问题的根源：
用户能感觉到的是症状最明显的那一处，而成因往往在上游 —— 可能在结构，可能在某条
约束写得不可判定，也可能是这个模型本身的默认倾向盖过了约束。

你要输出的是根因假设和对策，判断标准：
- 改完之后，**同一族的其他表现**是不是也会跟着消失？如果只解决用户指的那一处，那就不是根因。
- 历史上对这个模型有效过的手法，优先复用，并说清为什么这次也适用。
- 每条对策都要预估副作用：会不会把约束堆得更密、让回应更僵。`;
}

function buildAttributionUser({ feedback, body, auditDigest, modelKey, history, profileDigest }) {
  return `【目标模型】${modelKey || '未指定'}

【用户这次的说法】
${feedback}

【当前版本的世界书】
<worldbook>
${truncate(body, 6000)}
</worldbook>

${auditDigest ? `【这一版的实测审查结果】\n${auditDigest}\n` : ''}
${history ? `【这个模型的历史记录】\n${history}\n` : ''}
${profileDigest ? `【用户画像】\n${profileDigest}\n` : ''}
输出 JSON：

{
  "symptom": "把用户的说法翻译成可观察的现象，一句话",
  "is_known_pattern": true/false,
  "known_pattern_note": "如果是老问题，说明和以前哪次是同一族",
  "root_causes": [
    { "cause": "根因假设", "confidence": "high|medium|low",
      "why": "为什么这个根因会表现成用户说的那样",
      "also_explains": "这个根因还能解释哪些暂时没被提出来的现象" }
  ],
  "remedies": [
    { "action": "具体改什么，给出正面写法", "targets_cause": "对应上面哪条根因",
      "reused_from_history": true/false, "history_note": "复用的是以前哪一招",
      "side_effect": "可能的副作用，尤其是会不会让约束更密" }
  ],
  "not_a_problem": "如果判断用户指出的某点其实不是问题（是模型正常发挥或者是个人口味），在这里说明；没有就留空"
}`;
}

// 给归因用的历史摘要
async function historyDigest(modelKey, feedbacks = []) {
  const p = await getModelProfile(modelKey);
  const lines = [];
  if (p?.issues?.length) {
    lines.push('反复出现的问题：');
    for (const i of p.issues.slice(0, 6)) {
      const rule = RULE_BY_ID[i.ruleId];
      lines.push(`- ${i.ruleId}${rule ? ' ' + rule.name : ''} ×${i.count}${i.samples?.[0] ? '（' + i.samples[0] + '）' : ''}`);
    }
  }
  if (p?.remedies?.length) {
    lines.push('用过的对策：');
    for (const r of p.remedies.slice(0, 8)) {
      lines.push(`- ${r.text} → 用过 ${r.tried} 次，有效 ${r.worked} 次，无效 ${r.failed} 次`);
    }
  }
  const recent = feedbacks.slice(0, 5);
  if (recent.length) {
    lines.push('最近几次用户反馈：');
    for (const f of recent) {
      lines.push(`- [${fmtTime(f.createdAt)}] ${truncate(f.userSay, 60)}${f.worked === true ? ' → 对策有效' : f.worked === false ? ' → 对策无效' : ''}`);
    }
  }
  return lines.join('\n');
}

return { getModelProfile, listModelProfiles, recordAudit, recordRemedy, setRemedyOutcome, buildMemoryBlock, buildAttributionSystem, buildAttributionUser, historyDigest };
})();

__M['profile'] = (function () {
'use strict';
// 用户画像：用户不喜欢什么、在意什么、动手改的是哪些地方。
//
// 原料有两种，后一种比前一种可信得多：
//   1. 用户说了什么（反馈原话）
//   2. 用户实际改了什么（版本之间的 diff）—— 嘴上没说但动手改了的，才是真偏好。
//
// 画像是"软提示"。注入时限条数、标注可让位 —— 画像一旦变成硬约束，
// 就会把每一本世界书都拉回同一个模子，这正是要避免的过拟合。

const { getProfile, saveProfile } = __M['db'];
const { truncate } = __M['util'];
function buildProfileSystem() {
  return `你在做用户偏好画像。原料是用户对生成结果的反馈，以及用户亲手改动的内容。

判定原则：
- **动手改的权重高于嘴上说的**。用户没说但自己改掉的地方，是最可信的偏好证据。
- 区分"稳定偏好"和"这一次的具体要求"。只有反复出现的才算偏好；只出现一次的写进 observations，不要升格成偏好。
- 区分"品味"和"硬红线"。硬红线是那种一旦违反用户一定会重做的（比如某类词绝对不能出现）。
- 每条都要带证据条数。证据只有一条的，confidence 必须是 low。
- 宁可少写。画像会被注入到以后每一次生成里，写多了会把所有世界书拉成一个模子。`;
}

function buildProfileUser(samples, existing) {
  const feedbackText = samples.feedbacks.map((f, i) =>
    `[反馈 ${i + 1}] ${f.text}${f.rootCause ? `\n  （当时判定的根因：${f.rootCause}）` : ''}${f.worked === true ? '\n  （对策有效）' : f.worked === false ? '\n  （对策无效）' : ''}`
  ).join('\n') || '（暂无）';

  const editText = samples.edits.map((e, i) =>
    `[改动 ${i + 1}] ${e.note ? e.note + '\n' : ''}${truncate(e.diff, 1200)}`
  ).join('\n\n') || '（暂无）';

  const existingText = existing && (existing.dislikes.length || existing.preferences.length)
    ? JSON.stringify({
        dislikes: existing.dislikes, preferences: existing.preferences,
        hardRules: existing.hardRules, styleNotes: existing.styleNotes
      }, null, 1)
    : '（还没有画像）';

  return `【已有画像】
${existingText}

【用户说过的话】
${feedbackText}

【用户实际改动的内容（+ 是用户加的，- 是用户删的）】
${editText}

在已有画像的基础上更新（不是推倒重来）：证据增加的条目提升 confidence，被新证据推翻的条目删掉或改写。

输出 JSON：

{
  "dislikes":    [{ "text": "不喜欢什么，写成可判定的一句话", "evidence": "最有代表性的一条证据", "count": 证据条数, "confidence": "high|medium|low" }],
  "preferences": [{ "text": "...", "evidence": "...", "count": n, "confidence": "..." }],
  "hardRules":   [{ "text": "一旦违反用户一定会重做的红线", "evidence": "...", "count": n, "confidence": "..." }],
  "styleNotes":  [{ "text": "行文口味上的倾向", "evidence": "...", "count": n, "confidence": "..." }],
  "observations": ["只出现过一次、还不足以成为偏好的现象"],
  "uncertain": "你最拿不准的一条判断，以及需要什么证据才能确认"
}`;
}

function mergeProfile(prev, incoming, sourceCount) {
  const pick = arr => (Array.isArray(arr) ? arr : [])
    .filter(x => x && x.text)
    .map(x => ({
      text: String(x.text).trim(),
      evidence: truncate(x.evidence || '', 140),
      count: Number(x.count) || 1,
      confidence: ['high', 'medium', 'low'].includes(x.confidence) ? x.confidence : 'low'
    }));
  return Object.assign({}, prev, {
    dislikes: pick(incoming.dislikes),
    preferences: pick(incoming.preferences),
    hardRules: pick(incoming.hardRules),
    styleNotes: pick(incoming.styleNotes),
    observations: (incoming.observations || []).map(String).slice(0, 12),
    uncertain: incoming.uncertain || '',
    sourceCount: sourceCount || prev.sourceCount || 0
  });
}

async function applyProfileUpdate(incoming, sourceCount) {
  const prev = await getProfile();
  const next = mergeProfile(prev, incoming, sourceCount);
  await saveProfile(next);
  return next;
}

// 注入块。证据不足的条目不注入 —— 一条证据就写死，正是过拟合的来源。
function buildProfileBlock(profile, { max = 6, minConfidence = 'low' } = {}) {
  if (!profile) return '';
  const rank = { low: 0, medium: 1, high: 2 };
  const floor = rank[minConfidence] ?? 0;
  const ok = x => (rank[x.confidence] ?? 0) >= floor && (x.count >= 2 || x.confidence !== 'low');

  const hard = (profile.hardRules || []).filter(ok).slice(0, 4);
  const dis = (profile.dislikes || []).filter(ok).slice(0, max);
  const pref = (profile.preferences || []).filter(ok).slice(0, max);
  const style = (profile.styleNotes || []).filter(ok).slice(0, 3);
  if (!hard.length && !dis.length && !pref.length && !style.length) return '';

  const lines = ['<user_profile>', '这是使用者的长期偏好，由历次反馈和改动统计出来。'];
  if (hard.length) {
    lines.push('', '【硬红线：违反会被直接推翻】');
    hard.forEach(x => lines.push(`- ${x.text}`));
  }
  if (dis.length) {
    lines.push('', '【明确不喜欢】');
    dis.forEach(x => lines.push(`- ${x.text}`));
  }
  if (pref.length) {
    lines.push('', '【偏好】');
    pref.forEach(x => lines.push(`- ${x.text}`));
  }
  if (style.length) {
    lines.push('', '【行文口味】');
    style.forEach(x => lines.push(`- ${x.text}`));
  }
  lines.push('',
    '除硬红线外，以上都是**软提示**：与本次需求冲突时以需求为准。',
    '不要为了照顾偏好而额外增加约束条数，也不要把偏好直接抄成世界书里的条目。',
    '</user_profile>');
  return lines.join('\n');
}

function profileDigest(profile) {
  if (!profile) return '';
  const row = (label, arr) => (arr && arr.length ? `${label}：` + arr.slice(0, 4).map(x => x.text).join('；') : '');
  return [
    row('硬红线', profile.hardRules),
    row('不喜欢', profile.dislikes),
    row('偏好', profile.preferences),
    row('口味', profile.styleNotes)
  ].filter(Boolean).join('\n');
}

return { buildProfileSystem, buildProfileUser, mergeProfile, applyProfileUpdate, buildProfileBlock, profileDigest };
})();

__M['exporter'] = (function () {
'use strict';
// 导出与导入：txt / docx / zip 批量 / SillyTavern 世界书 JSON。
//
// docx 就是一个 zip，所以这里自带一个最小 ZIP 写入器（只用 store 存储模式，
// 不压缩 —— Word 完全接受，省掉一个第三方依赖）。

const { download, uid, truncate } = __M['util'];
// ---------- CRC32 + ZIP ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

// files: [{ name, data: string | Uint8Array }]
function makeZip(files) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime();
  const entries = files.map(f => {
    const nameBytes = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    return { nameBytes, data, crc: crc32(data) };
  });

  let total = 0;
  for (const e of entries) total += 30 + e.nameBytes.length + e.data.length + 46 + e.nameBytes.length;
  total += 22;

  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  let off = 0;
  const offsets = [];

  for (const e of entries) {
    offsets.push(off);
    view.setUint32(off, 0x04034b50, true);
    view.setUint16(off + 4, 20, true);
    view.setUint16(off + 6, 0x0800, true);      // UTF-8 文件名
    view.setUint16(off + 8, 0, true);           // store，不压缩
    view.setUint16(off + 10, time, true);
    view.setUint16(off + 12, date, true);
    view.setUint32(off + 14, e.crc, true);
    view.setUint32(off + 18, e.data.length, true);
    view.setUint32(off + 22, e.data.length, true);
    view.setUint16(off + 26, e.nameBytes.length, true);
    view.setUint16(off + 28, 0, true);
    off += 30;
    buf.set(e.nameBytes, off); off += e.nameBytes.length;
    buf.set(e.data, off); off += e.data.length;
  }

  const cdStart = off;
  entries.forEach((e, i) => {
    view.setUint32(off, 0x02014b50, true);
    view.setUint16(off + 4, 20, true);
    view.setUint16(off + 6, 20, true);
    view.setUint16(off + 8, 0x0800, true);
    view.setUint16(off + 10, 0, true);
    view.setUint16(off + 12, time, true);
    view.setUint16(off + 14, date, true);
    view.setUint32(off + 16, e.crc, true);
    view.setUint32(off + 20, e.data.length, true);
    view.setUint32(off + 24, e.data.length, true);
    view.setUint16(off + 28, e.nameBytes.length, true);
    view.setUint16(off + 30, 0, true);
    view.setUint16(off + 32, 0, true);
    view.setUint16(off + 34, 0, true);
    view.setUint16(off + 36, 0, true);
    view.setUint32(off + 38, 0, true);
    view.setUint32(off + 42, offsets[i], true);
    off += 46;
    buf.set(e.nameBytes, off); off += e.nameBytes.length;
  });

  view.setUint32(off, 0x06054b50, true);
  view.setUint16(off + 4, 0, true);
  view.setUint16(off + 6, 0, true);
  view.setUint16(off + 8, entries.length, true);
  view.setUint16(off + 10, entries.length, true);
  view.setUint32(off + 12, off - cdStart, true);
  view.setUint32(off + 16, cdStart, true);
  view.setUint16(off + 20, 0, true);

  return buf;
}

// ---------- DOCX ----------

const xmlEsc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');   // 控制字符会让 Word 直接判文件损坏

function docxParagraph(text, style) {
  const runProps = style === 'Code' ? '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="等线"/><w:sz w:val="19"/></w:rPr>' : '';
  const pStyle = style && style !== 'Code' ? `<w:pStyle w:val="${style}"/>` : '';
  const spacing = style === 'Code' ? '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>' : '';
  return `<w:p><w:pPr>${pStyle}${spacing}</w:pPr><w:r>${runProps}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r></w:p>`;
}

// 行首的 #、## 变标题；其余按格式决定是正文还是等宽块
function docxBody(text, { mono = false } = {}) {
  return String(text || '').split('\n').map(line => {
    const h1 = line.match(/^#\s+(.*)$/);
    const h2 = line.match(/^#{2,3}\s+(.*)$/);
    if (h1) return docxParagraph(h1[1], 'Heading1');
    if (h2) return docxParagraph(h2[1], 'Heading2');
    return docxParagraph(line, mono ? 'Code' : '');
  }).join('');
}

const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="280" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="220" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>`;

function buildDocx({ title, blocks }) {
  // blocks: [{ heading?, text, mono? }]
  const parts = [];
  if (title) parts.push(docxParagraph(title, 'Heading1'));
  for (const b of blocks) {
    if (b.heading) parts.push(docxParagraph(b.heading, 'Heading2'));
    parts.push(docxBody(b.text, { mono: b.mono }));
  }
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  return makeZip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'word/styles.xml', data: DOCX_STYLES },
    { name: 'word/document.xml', data: doc }
  ]);
}

// ---------- 世界书 → 各种形态 ----------

const safeName = s => String(s || '未命名').replace(/[\\/:*?"<>|\n\r\t]/g, '_').slice(0, 60);

function bookToText(book, { withExamples = true, withOutline = false } = {}) {
  const rows = [`# ${book.title || '未命名世界书'}`, ''];
  if (book.note) rows.push(book.note, '');
  if (withOutline && book.outline) rows.push('## 大纲', book.outline, '');
  rows.push(book.content || '');
  if (withExamples && book.examples) rows.push('', '## 示例', book.examples);
  return rows.join('\n');
}

function exportTxt(book, opts) {
  download(safeName(book.title) + '.txt', bookToText(book, opts));
}

function exportDocx(book, opts = {}) {
  const mono = book.format === 'yaml' || book.format === 'xml';
  const blocks = [{ text: book.content || '', mono }];
  if (opts.withExamples !== false && book.examples) blocks.push({ heading: '示例', text: book.examples, mono });
  const bytes = buildDocx({ title: book.title || '未命名世界书', blocks });
  download(safeName(book.title) + '.docx', new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }));
}

// 批量：一个 zip 里放 docx / txt / json，各自一个子目录
function exportBatch(books, { docx = true, txt = true, json = false } = {}) {
  const files = [];
  const used = new Set();
  for (const b of books) {
    let base = safeName(b.title);
    let name = base, i = 2;
    while (used.has(name)) name = `${base}(${i++})`;
    used.add(name);
    if (docx) files.push({ name: `docx/${name}.docx`, data: buildDocx({ title: b.title, blocks: [{ text: b.content || '', mono: b.format === 'yaml' || b.format === 'xml' }].concat(b.examples ? [{ heading: '示例', text: b.examples }] : []) }) });
    if (txt) files.push({ name: `txt/${name}.txt`, data: bookToText(b) });
    if (json) files.push({ name: `json/${name}.json`, data: JSON.stringify(toSillyTavern(b), null, 2) });
  }
  if (!files.length) return 0;
  const zip = makeZip(files);
  const stamp = new Date().toISOString().slice(0, 10);
  download(`世界书导出-${stamp}.zip`, new Blob([zip], { type: 'application/zip' }));
  return books.length;
}

// ---------- SillyTavern 世界书格式 ----------
// 拆条目：按 ## 标题 / 【标题】/ YAML 顶层键 / XML 顶层标签切。切不动就整篇一条。

function splitEntries(content, format) {
  const text = String(content || '');
  const entries = [];
  const pushEntry = (title, body) => {
    const t = String(body || '').trim();
    if (t) entries.push({ title: String(title || '').trim(), content: t });
  };

  if (format === 'xml') {
    const re = /<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
    let m, found = false;
    while ((m = re.exec(text))) { pushEntry(m[1], m[2]); found = true; }
    if (found) return entries;
  }
  if (format === 'yaml') {
    const lines = text.split('\n');
    let cur = null, found = false;
    for (const l of lines) {
      const m = l.match(/^([^\s:#][^:]*):\s*(.*)$/);
      if (m) {
        if (cur) pushEntry(cur.title, cur.body.join('\n'));
        cur = { title: m[1].trim(), body: m[2] ? [m[2]] : [] };
        found = true;
      } else if (cur) cur.body.push(l);
    }
    if (cur) pushEntry(cur.title, cur.body.join('\n'));
    if (found) return entries;
  }
  const lines = text.split('\n');
  let cur = null;
  for (const l of lines) {
    const h = l.match(/^#{1,4}\s+(.*)$/) || l.match(/^【(.+?)】\s*$/);
    if (h) {
      if (cur) pushEntry(cur.title, cur.body.join('\n'));
      cur = { title: h[1], body: [] };
    } else if (cur) cur.body.push(l);
    else if (l.trim()) cur = { title: '正文', body: [l] };
  }
  if (cur) pushEntry(cur.title, cur.body.join('\n'));
  return entries.length ? entries : [{ title: '正文', content: text.trim() }];
}

// 触发词：标题里的中文词和英文词，供 ST 做关键词命中
function keysFromTitle(title) {
  const t = String(title || '').trim();
  if (!t) return [];
  const keys = new Set([t]);
  for (const w of t.split(/[\s、，,/|·:：-]+/)) if (w.length >= 2) keys.add(w);
  return Array.from(keys).slice(0, 6);
}

function toSillyTavern(book) {
  const parts = splitEntries(book.content, book.format);
  if (book.examples) parts.push({ title: '示例', content: book.examples });
  const entries = {};
  parts.forEach((p, i) => {
    entries[String(i)] = {
      uid: i, key: keysFromTitle(p.title), keysecondary: [],
      comment: p.title || `条目 ${i + 1}`, content: p.content,
      constant: i === 0,               // 第一条通常是世界总设定，常驻
      selective: true, order: 100 + i, position: 0, disable: false,
      probability: 100, useProbability: true, depth: 4, addMemo: true,
      excludeRecursion: false, displayIndex: i, vectorized: false,
      group: '', groupOverride: false, groupWeight: 100,
      scanDepth: null, caseSensitive: null, matchWholeWords: null
    };
  });
  return { name: book.title || '未命名世界书', entries };
}

function exportSillyTavern(book) {
  download(safeName(book.title) + '.json', JSON.stringify(toSillyTavern(book), null, 2), 'application/json');
}

// 导入：吃 ST 的 json、本工具导出的 json、以及纯文本
function parseImport(filename, text) {
  const base = filename.replace(/\.[^.]+$/, '');
  try {
    const j = JSON.parse(text);
    const src = j.entries || j.originalData?.entries;
    if (src) {
      const list = Array.isArray(src) ? src : Object.values(src);
      const content = list
        .filter(e => e && (e.content || '').trim())
        .map(e => `## ${e.comment || (e.key || []).join('/') || '条目'}\n${e.content.trim()}`)
        .join('\n\n');
      return {
        title: j.name || base, content, format: 'natural',
        entryCount: list.length, raw: j
      };
    }
    if (j.title && j.content) return { title: j.title, content: j.content, format: j.format || 'natural', raw: j };
  } catch (e) { /* 不是 json 就按纯文本处理 */ }
  return { title: base, content: text, format: /^\s*</.test(text) ? 'xml' : /^[\w一-鿿]+:\s/m.test(text) ? 'yaml' : 'natural' };
}

function makeBookRecord({ title, content, examples = '', format = 'natural', lang = 'zh', source = 'mine', projectId = '', versionId = '', note = '', raw = null }) {
  return {
    id: uid('bk'), source, title: title || '未命名世界书', content, examples, format, lang,
    projectId, versionId, note, raw: raw || null,
    summary: truncate(content, 100),
    createdAt: Date.now(), updatedAt: Date.now()
  };
}

return { makeZip, buildDocx, bookToText, exportTxt, exportDocx, exportBatch, splitEntries, toSillyTavern, exportSillyTavern, parseImport, makeBookRecord };
})();

__M['pipeline'] = (function () {
'use strict';
// 生成编排：大纲 → 正文 → 示例 → 自检 → 审查（本地 + 模型）→ 对账 → 存版本。
//
// 分阶段而不是一次性生成，是因为 R6 要可核对：有大纲才能算覆盖率，
// 有独立的自检才能和本地审查对账。快速模式可以跳过大纲，代价是 R6 判不了。

const { chat, modelKeyOf } = __M['api'];
const P = __M['prompt'];
const { auditLocal, reconcile } = __M['audit'];
const { buildBanwordSet } = __M['lexicon'];
const { buildSeriesBlock, detectConflicts } = __M['series'];
const { buildMemoryBlock, recordAudit } = __M['memory'];
const { buildProfileBlock } = __M['profile'];
const { put, query, getSettings, getProfile } = __M['db'];
const { uid, stripFence, extractJson, estimateTokens } = __M['util'];
const { RULE_BY_ID, STATUS_LABEL } = __M['rules'];
// 组装一次生成所需要的全部上下文
async function buildContext(config, { books = [], settings } = {}) {
  const s = settings || await getSettings();
  const banwords = (s.useBuiltinBanwords === false ? [] : [])
    .concat(config.banwords || [])
    .concat(s.banwords || [])
    .map(x => String(x).trim()).filter(Boolean);

  const seriesBooks = (config.seriesIds || [])
    .map(id => books.find(b => b.id === id))
    // 导入库只作存储，不参与注入。这里是最后一道闸，UI 那边也不给选。
    .filter(b => b && b.source !== 'imported');

  const ctx = {
    question: config.question || '',
    tuning: config.tuning || '',
    injected: config.injected || '',
    lang: config.lang || 'zh',
    format: config.format || 'natural',
    lengthTarget: config.lengthTarget || '',
    exampleCount: config.exampleCount || 2,
    targetModelKey: config.targetModelKey || '',
    banwords: Array.from(new Set(banwords)),
    seriesBooks
  };
  ctx.seriesBlock = seriesBooks.length ? buildSeriesBlock(seriesBooks) : '';
  ctx.memoryBlock = (s.memoryEnabled && config.targetModelKey)
    ? await buildMemoryBlock(config.targetModelKey, { max: s.maxMemoryItems })
    : '';
  ctx.profileBlock = (s.profileEnabled && config.useProfile !== false)
    ? buildProfileBlock(await getProfile(), { max: s.maxProfileItems })
    : '';
  return ctx;
}

// 一次模型调用 + 阶段事件
async function step(hooks, key, label, fn) {
  hooks.onStage?.({ key, label, status: 'run' });
  try {
    const out = await fn();
    hooks.onStage?.({ key, label, status: 'done', text: out });
    return out;
  } catch (e) {
    hooks.onStage?.({ key, label, status: 'err', error: e.message });
    throw e;
  }
}

function callText(preset, system, user, hooks, key, opts = {}) {
  let acc = '';
  return chat(preset, Object.assign({ system, messages: [{ role: 'user', content: user }] }, opts), {
    signal: hooks.signal,
    onDelta: (piece) => { acc += piece; hooks.onDelta?.(key, acc, piece); }
  }).then(r => r.text);
}

// ---------- 审查（可以对任意一段正文单独跑） ----------

async function runAudit({ body, outline, examples, ctx, selfCheck, auditPreset, settings }, hooks = {}) {
  const s = settings || await getSettings();
  const banwordSet = buildBanwordSet({
    useBuiltin: s.useBuiltinBanwords !== false,
    custom: ctx.banwords || []
  });
  const local = auditLocal({
    body, outline, question: ctx.question, injected: ctx.tuning,
    format: ctx.format, banwordSet
  });

  const analysisMode = s.analysisMode || 'separate';

  let llm = null;
  if (s.auditWithLLM && auditPreset) {
    try {
      const text = await step(hooks, 'audit', '独立审查', () => callText(
        auditPreset, P.buildAuditSystem(),
        // 代码判不了的交给模型；代码已经判死的（R4/R6）不用再问一遍，省 token 也避免它翻案
        P.buildAuditUser(body, ['R1', 'R2', 'R3', 'R5', 'R7', 'R8'], {
          question: ctx.question,
          inlineAnalysis: analysisMode === 'inline'
        }),
        hooks, 'audit', { temperature: 0.2, json: true }
      ));
      const parsed = extractJson(text);
      if (parsed && Array.isArray(parsed.results)) {
        llm = parsed;
      } else {
        hooks.onWarn?.('模型审查返回的不是可解析的 JSON，本次只用本地审查结果');
      }
    } catch (e) {
      hooks.onWarn?.('模型审查失败：' + e.message + '（本地审查结果仍然有效）');
    }
  }

  const merged = reconcile(local.results, llm?.results, selfCheck);
  const conflicts = ctx.seriesBooks?.length ? detectConflicts(body, ctx.seriesBooks) : [];

  const audit = {
    local, llm, results: merged.results, mismatches: merged.mismatches,
    score: merged.score, overfit: local.overfit, conflicts,
    biggestProblem: llm?.biggest_problem || '',
    overfitRisk: llm?.overfit_risk || '',
    overfitNote: llm?.overfit_note || '',
    analysis: '', analysisMode,
    at: Date.now()
  };

  // 详细分析。单独跑的那一次要等审查先出结果 —— 它读的就是那份结果，
  // 所以只能串行，不能和审查并发。
  if (analysisMode === 'inline') {
    audit.analysis = String(llm?.analysis || '').trim();
  } else if (analysisMode === 'separate' && auditPreset) {
    try {
      audit.analysis = (await step(hooks, 'analysis', '详细分析', () => callText(
        auditPreset, P.buildAnalysisSystem(),
        P.buildAnalysisUser({
          body,
          // 把刚出炉的评分和逐条结论原样喂回去，分析才能引着它们说话
          auditDigest: auditDigestText(audit, { withAnalysis: false }),
          question: ctx.question, format: ctx.format, score: audit.score
        }),
        hooks, 'analysis', { temperature: 0.35 }
      ))).trim();
    } catch (e) {
      // 分析挂了不影响审查结果 —— 评分和逐条结论已经拿到手了
      hooks.onWarn?.('详细分析失败：' + e.message + '（评分和逐条结论不受影响）');
    }
  }

  return audit;
}

// ---------- 主流程 ----------
// mode: 'full'（大纲→正文→示例）| 'quick'（直接正文）| 'revise'（在旧版本上改）

async function generate(opts, hooks = {}) {
  const {
    project, config, mainPreset, auditPreset, settings,
    books = [], mode = 'full', prevBody = '', prevOutline = '', instructions = '', prevAudit = null, parentId = ''
  } = opts;

  const s = settings || await getSettings();
  const ctx = await buildContext(config, { books, settings: s });
  const system = P.buildSystem(ctx);
  const t0 = Date.now();

  let outline = '', body = '', examples = '', selfCheckRaw = '', selfCheck = null;

  if (mode === 'revise') {
    // 沿用父版的大纲：修订同样要对得上原来的骨架，不然 R6 就断档了
    outline = prevOutline || '';
    const digest = prevAudit ? auditDigestText(prevAudit) : '';
    body = stripFence(await step(hooks, 'body', '修订正文', () => callText(
      mainPreset, system, P.buildReviseUser(ctx, prevBody, instructions, digest), hooks, 'body'
    )));
  } else {
    if (mode === 'full') {
      outline = (await step(hooks, 'outline', '大纲与根因判断', () => callText(
        mainPreset, system, P.buildOutlineUser(ctx), hooks, 'outline', { temperature: 0.7 }
      ))).trim();
      if (hooks.pauseAfterOutline) {
        const edited = await hooks.pauseAfterOutline(outline);
        if (edited === null) throw new Error('已取消');
        outline = edited;
      }
    }
    const bodyUser = mode === 'full'
      ? P.buildBodyUser(ctx, outline)
      : P.buildBodyUser(ctx, '（本次跳过了大纲阶段，自行按"先是什么、再怎么动、最后边界"的顺序组织）');
    body = stripFence(await step(hooks, 'body', '正文', () => callText(
      mainPreset, system, bodyUser, hooks, 'body'
    )));
  }

  if (config.withExamples !== false) {
    examples = stripFence(await step(hooks, 'examples', '示例（正常/边界/易错）', () => callText(
      mainPreset, system, P.buildExamplesUser(ctx, body), hooks, 'examples'
    )));
  }

  if (config.withSelfCheck !== false) {
    try {
      selfCheckRaw = await step(hooks, 'selfcheck', '模型自检', () => callText(
        mainPreset, system, P.buildSelfCheckUser(ctx, body, examples), hooks, 'selfcheck', { temperature: 0.1 }
      ));
      selfCheck = extractJson(selfCheckRaw, 'self_check');
      if (!selfCheck) hooks.onWarn?.('自检返回的内容解析不出 JSON，对账这一步跳过');
    } catch (e) {
      hooks.onWarn?.('自检阶段失败：' + e.message);
    }
  }

  const audit = await runAudit({ body, outline, examples, ctx, selfCheck, auditPreset, settings: s }, hooks);

  const prior = await query('versions', 'projectId', project.id);
  const version = {
    id: uid('v'),
    projectId: project.id,
    n: prior.length + 1,
    parentId: parentId || '',
    mode,
    stages: { outline, body, examples, selfCheckRaw },
    selfCheck,
    audit,
    config: JSON.parse(JSON.stringify(config)),
    meta: {
      model: mainPreset?.model || '',
      modelKey: modelKeyOf(mainPreset),
      targetModelKey: config.targetModelKey || '',
      auditModel: s.auditWithLLM ? modelKeyOf(auditPreset) : '',
      durationMs: Date.now() - t0,
      tokens: estimateTokens(body) + estimateTokens(examples),
      instructions
    },
    note: instructions ? instructions.slice(0, 120) : '',
    createdAt: Date.now()
  };
  await put('versions', version);

  // 档案挂在【目标模型】上：这份世界书是要注入给它的，问题也该记在它头上。
  // 没指定目标模型时退回到写作模型，总比不记强。
  const memKey = config.targetModelKey || modelKeyOf(mainPreset);
  if (s.memoryEnabled && memKey) {
    await recordAudit(memKey, audit.results, { overfit: audit.overfit });
  }

  hooks.onStage?.({ key: 'done', label: '完成', status: 'done' });
  return version;
}

// 审查结论压成一段文字，喂给修订和归因
// 修订的时候把这段整个丢给主模型。评分、逐条判定、证据、分析都在里面 ——
// 让它知道"扣在哪、为什么扣"，而不是只知道"改一下"。
// withAnalysis=false 是给分析那一步自己用的，免得自己引自己。
function auditDigestText(audit, { withAnalysis = true } = {}) {
  if (!audit) return '';
  const lines = [`综合分 ${audit.score}/100，约束紧度 ${audit.overfit?.tightness ?? '?'}（${audit.overfit?.note || ''}）`];
  for (const r of audit.results || []) {
    if (r.status === 'pass' || r.status === 'skip') continue;
    const rule = RULE_BY_ID[r.id];
    lines.push(`- ${r.id} ${rule ? rule.name : ''}：${STATUS_LABEL[r.status]} —— ${r.summary}`);
    for (const ev of (r.evidence || []).slice(0, 2)) {
      lines.push(`    证据${ev.line ? `（第 ${ev.line} 行）` : ''}：${String(ev.text).slice(0, 120)}${ev.note ? ' ←' + ev.note : ''}`);
    }
    if (r.advice) lines.push(`    建议：${r.advice}`);
  }
  for (const m of audit.mismatches || []) {
    lines.push(`- ⚠ 自评与实测不符：${m.id} 自称「${m.claim}」，实测 ${m.actual}`);
  }
  if (audit.biggestProblem) lines.push(`- 审查员认为最该改的一处：${audit.biggestProblem}`);
  if (withAnalysis && audit.analysis) {
    lines.push('', '审查员的详细分析：', audit.analysis);
  }
  return lines.join('\n');
}

// ---------- 试运行：把世界书真的喂给目标模型，看它实际输出 ----------

async function trialRun({ worldbook, userTurn, testPreset, settings, ctx }, hooks = {}) {
  const s = settings || await getSettings();
  const system = `${worldbook}\n\n以上是本次对话的世界书设定，严格按它生成。`;
  const text = await callText(testPreset, system, userTurn, hooks, 'trial', { temperature: 0.9 });
  const banwordSet = buildBanwordSet({
    useBuiltin: s.useBuiltinBanwords !== false,
    custom: (ctx?.banwords || []).concat(s.banwords || [])
  });
  // 只对回复查"看得见的违规"：八股词、执行度。回复本来就该是散文，
  // 所以这里的执行度只做参考，不参与判定。
  const local = auditLocal({ body: text, format: 'natural', banwordSet });
  const banRule = local.results.find(r => r.id === 'R8');
  return {
    text,
    banwords: banRule,
    charCount: text.length,
    at: Date.now()
  };
}

return { buildContext, runAudit, generate, auditDigestText, trialRun };
})();

__M['views/common'] = (function () {
'use strict';
// 视图共用零件：审查报告、模型选择器、预设下拉。

const { el, esc, toast, truncate, modal } = __M['util'];
const { RULES, RULE_BY_ID, STATUS_LABEL } = __M['rules'];
const { listModels, modelKeyOf, PROVIDERS } = __M['api'];
function card(title, children, actions) {
  const head = el('div', { class: 'card-head' }, [el('h2', { text: title })]);
  if (actions) { head.appendChild(el('div', { class: 'spacer' })); [].concat(actions).forEach(a => head.appendChild(a)); }
  return el('div', { class: 'card' }, [head].concat(children || []));
}

function field(label, control, hint) {
  return el('div', { class: 'field' }, [
    el('label', { text: label }),
    control,
    hint ? el('div', { class: 'hint', text: hint }) : null
  ]);
}

function select(options, value, onChange, attrs = {}) {
  const s = el('select', attrs, options.map(o =>
    el('option', { value: o.value, selected: String(o.value) === String(value) }, [o.label])));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function statusBadge(status) {
  const cls = status === 'pass' ? 'ok' : status === 'warn' ? 'warn' : status === 'fail' ? 'bad' : '';
  return el('span', { class: 'badge ' + cls, text: STATUS_LABEL[status] || status });
}

function scoreMeter(score) {
  const cls = score >= 75 ? 'ok' : score >= 50 ? 'warn' : 'bad';
  return el('div', { class: 'meter ' + cls }, [el('i', { style: { width: Math.max(2, score) + '%' } })]);
}

// ---------- 审查报告 ----------

function renderAudit(audit, { onRevise } = {}) {
  if (!audit) return el('div', { class: 'empty', text: '还没有审查结果' });
  const wrap = el('div');

  // 总览
  const ov = audit.overfit || {};
  wrap.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'kpi' }, [
      el('div', {}, [
        el('div', { class: 'k', text: '综合分' }),
        el('div', { class: 'v', text: String(audit.score ?? '-') }),
        scoreMeter(audit.score || 0)
      ]),
      el('div', {}, [
        el('div', { class: 'k', text: '约束紧度' }),
        el('div', { class: 'v', text: String(ov.tightness ?? '-') }),
        el('div', { class: 'meter ' + (ov.verdict === 'ok' ? 'ok' : 'warn') }, [el('i', { style: { width: (ov.tightness || 0) + '%' } })])
      ]),
      el('div', {}, [
        el('div', { class: 'k', text: '约束条数' }),
        el('div', { class: 'v', text: String(ov.constraints ?? '-') })
      ]),
      el('div', {}, [
        el('div', { class: 'k', text: '每千字' }),
        el('div', { class: 'v', text: String(ov.perKiloChar ?? '-') })
      ])
    ]),
    el('div', { class: 'hint' + (ov.verdict === 'ok' ? '' : ' warnish'), text: ov.note || '' }),
    audit.overfitNote ? el('div', { class: 'hint', text: '审查员：' + audit.overfitNote }) : null,
    audit.biggestProblem ? el('div', { class: 'hint', style: { marginTop: '6px' }, text: '最该改的一处：' + audit.biggestProblem }) : null
  ]));

  // 详细分析：审查员把分散的扣分项串成一段话。放在总览下面、逐条上面 ——
  // 先读"大概是怎么回事"，再去看具体哪一条。
  if (audit.analysis) {
    wrap.appendChild(card('详细分析', [
      el('div', { class: 'hint', style: { marginBottom: '8px' },
        text: audit.analysisMode === 'inline'
          ? '副模型在审查的同一次调用里写的。修订时这段会连同评分一起带给主模型。'
          : '副模型拿到评分和逐条证据之后单独写的。修订时这段会连同评分一起带给主模型。' }),
      el('div', { class: 'prose', text: audit.analysis })
    ]));
  }

  // 自评对账：整份报告里信息量最大的一块，放最上面
  if (audit.mismatches && audit.mismatches.length) {
    wrap.appendChild(el('div', { class: 'card', style: { borderColor: '#5a2c2c' } }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: '自评与实测不符' }),
        el('span', { class: 'badge bad', text: audit.mismatches.length + ' 处' })
      ]),
      el('div', { class: 'hint', text: '模型声称做到了，静态检查说没有。这类条目是"要求没生效"最直接的证据。' }),
      el('div', { class: 'list', style: { marginTop: '8px' } }, audit.mismatches.map(m => {
        const rule = RULE_BY_ID[m.id];
        return el('div', { class: 'evidence' }, [
          el('div', { html: `<b>${esc(m.id)} ${esc(rule ? rule.name : '')}</b>` }),
          el('div', { text: '自称：' + truncate(m.claim, 120) }),
          el('div', { style: { color: 'var(--bad)' }, text: '实测：' + m.actual })
        ]);
      }))
    ]));
  }

  // 系列冲突
  if (audit.conflicts && audit.conflicts.length) {
    wrap.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: '与系列内已有世界书的撞车' }),
        el('span', { class: 'badge warn', text: audit.conflicts.length + ' 处' })
      ]),
      el('div', { class: 'list' }, audit.conflicts.map(c => el('div', { class: 'evidence' }, [
        el('div', { html: `<b>${c.kind === 'conflict' ? '冲突' : '重复'}</b> · 与《${esc(c.book || '')}》` }),
        el('div', { text: '新：' + truncate(c.newText, 100) }),
        el('div', { text: '旧：' + truncate(c.oldText, 100) })
      ])))
    ]));
  }

  // 八条规则
  const rulesWrap = el('div');
  const ordered = RULES.map(r => (audit.results || []).find(x => x.id === r.id)).filter(Boolean);
  for (const r of ordered) {
    const rule = RULE_BY_ID[r.id] || {};
    const body = el('div', { class: 'rule-body', style: { display: 'none' } }, [
      el('div', { class: 'hint', text: rule.why || '' }),
      r.advice ? el('div', { style: { marginTop: '8px', color: 'var(--fg)' }, text: '建议：' + r.advice }) : null,
      r.llm ? el('div', { class: 'hint', style: { marginTop: '6px' }, text: `模型审查：${STATUS_LABEL[r.llm.status] || r.llm.status} —— ${r.llm.summary || ''}${r.llm.advice ? '｜' + r.llm.advice : ''}` }) : null,
      ...(r.evidence || []).slice(0, 10).map(ev => el('div', { class: 'evidence' }, [
        ev.line ? el('span', { class: 'ln', text: 'L' + ev.line }) : null,
        el('span', { text: String(ev.text || '') }),
        ev.note ? el('div', { style: { color: 'var(--warn)', marginTop: '3px' }, text: '↑ ' + ev.note }) : null
      ]))
    ]);
    const head = el('div', { class: 'rule-head', onclick: () => { body.style.display = body.style.display === 'none' ? 'block' : 'none'; } }, [
      statusBadge(r.status),
      el('span', { class: 'name', text: `${r.id} ${rule.name || ''}` }),
      el('span', { class: 'hint', text: truncate(r.summary, 60) }),
      el('span', { class: 'hint', text: '▾' })
    ]);
    rulesWrap.appendChild(el('div', { class: 'rule ' + r.status }, [head, body]));
  }
  wrap.appendChild(card('逐条检查', [
    el('div', { class: 'hint', style: { marginBottom: '8px' }, text: '点任意一条展开证据。本地静态检查给行号，模型审查给定性判断，两者冲突时以本地为准、模型意见降级为提示。' }),
    rulesWrap
  ], onRevise ? el('button', { class: 'primary small', text: '按审查结论修订', onclick: onRevise }) : null));

  return wrap;
}

// ---------- 模型选择器：拉全量列表 + 快速搜索 ----------

async function pickModel(preset, onPick) {
  const listBox = el('div', { class: 'model-list' }, [el('div', { class: 'empty', text: '正在拉取模型列表…' })]);
  const search = el('input', { type: 'text', placeholder: '快速搜索：输入片段，空格分隔多个关键词' });
  const counter = el('div', { class: 'hint', text: '' });
  let models = [];
  let chosen = preset.model || '';

  const paint = () => {
    const q = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = models.filter(m => q.every(w => m.id.toLowerCase().includes(w) || String(m.note || '').toLowerCase().includes(w)));
    counter.textContent = `共 ${models.length} 个模型${q.length ? `，命中 ${rows.length} 个` : ''}`;
    listBox.innerHTML = '';
    if (!rows.length) { listBox.appendChild(el('div', { class: 'empty', text: '没有匹配的模型' })); return; }
    // 不做分页截断：用户要的就是"能拉到的全部都能看到"
    for (const m of rows) {
      listBox.appendChild(el('div', {
        class: 'model-row' + (m.id === chosen ? ' sel' : ''),
        onclick: () => { chosen = m.id; paint(); }
      }, [m.id + (m.note ? `  · ${m.note}` : '')]));
    }
  };
  search.addEventListener('input', paint);

  const body = el('div', { class: 'col' }, [
    el('div', { class: 'hint', text: `预设：${preset.name || '未命名'}（${PROVIDERS[preset.provider]?.label || preset.provider}）` }),
    search, counter, listBox,
    el('div', { class: 'hint', text: '列表拉不动时，也可以直接在下面手填模型名。' }),
    el('input', { type: 'text', placeholder: '手填模型名', value: preset.model || '', id: 'manualModel' })
  ]);

  const p = modal({
    title: '选择模型', body, confirmText: '使用这个模型',
    onConfirm: (content) => {
      const manual = content.querySelector('#manualModel').value.trim();
      const val = manual && manual !== preset.model ? manual : chosen;
      if (!val) { toast('还没有选模型', true); return null; }
      return val;
    }
  });

  listModels(preset).then(rows => {
    models = rows;
    paint();
  }).catch(e => {
    listBox.innerHTML = '';
    listBox.appendChild(el('div', { class: 'empty', text: '拉取失败：' + e.message }));
    counter.textContent = '可以在下面手填模型名';
  });

  const picked = await p;
  if (picked) onPick(picked);
  return picked;
}

function presetSelect(presets, value, onChange, { allowEmpty = true, emptyLabel = '（未指定）' } = {}) {
  const opts = (allowEmpty ? [{ value: '', label: emptyLabel }] : []).concat(
    presets.map(p => ({ value: p.id, label: `${p.name || '未命名'} · ${p.model || '未选模型'}` })));
  return select(opts, value, onChange);
}

// 目标模型下拉：预设里的模型 + 常见几家，允许手填
function targetModelInput(presets, value, onChange) {
  const known = Array.from(new Set(presets.map(modelKeyOf).filter(k => k && !k.endsWith(':?'))));
  const input = el('input', { type: 'text', value: value || '', placeholder: '例如 gemini:gemini-2.5-pro' });
  input.addEventListener('change', () => onChange(input.value.trim()));
  const chips = el('div', { class: 'row tight', style: { marginTop: '6px' } },
    known.slice(0, 8).map(k => el('span', {
      class: 'chip' + (k === value ? ' on' : ''),
      text: k,
      onclick: () => { input.value = k; onChange(k); }
    })));
  return el('div', {}, [input, known.length ? chips : null]);
}

return { card, field, select, statusBadge, scoreMeter, renderAudit, pickModel, presetSelect, targetModelInput };
})();
