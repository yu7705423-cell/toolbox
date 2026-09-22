/*
  工具箱外壳
  ————————————————————————————————————————————————
  这是「六个独立网页」变成「一个东西」的那一层。谁加载它，谁就自动获得：

    · 同一份工具名录（下面的 TOOLS，全站唯一一份）
    · 同一个日夜设置 —— 在任何一个工具里切，其他工具跟着变
    · 同一个「切换工具」面板 —— 不用退回首页再进去

  工具那边只要做两件事：
    1. <link rel="stylesheet" href="../theme.css"> 和 ../skin/<id>.css
    2. 在自己的顶栏里放两个按钮，标上 data-tb-home / data-tb-switch，
       再加一行 <script src="../shell.js" data-tool="<id>"></script>
  没放按钮也没关系，外壳会自己在角落里生一个。

  合集页（根目录 index.html）也加载它，但只用 TOOLS —— 它自己就是首页，
  不需要再长一条顶栏。
*/
(function () {
'use strict';

// ---------- 唯一的工具名录 ----------
// 加新工具就在这儿加一条，合集页的卡片和每个工具里的切换面板会同时多出来。
// group: 'diy' 拿来做东西的 / 'stash' 拿来存东西的
const TOOLS = [
  { id:'fanwai', name:'番外生成器', glyph:'番', group:'diy', path:'fanwai/',
    desc:'选几个梗，产出一段 Prompt',
    when:'想让 AI 写一段番外，但说不清自己要什么感觉的时候',
    store:'东西存本机 · 不用配 API（它只产 Prompt，拿去哪用你定）' },

  { id:'wbgen', name:'世界书生成器', glyph:'世', group:'diy', path:'worldbook/',
    desc:'写世界书，带审查和评分',
    when:'给 AI 角色定规矩、写长期设定的时候。写完存进世界书库',
    store:'东西存本机 · 要先配一个 API 密钥' },

  { id:'imgtest', name:'图床工具箱', glyph:'图', group:'diy', path:'imgtest/',
    desc:'自建图床的上传和管理',
    when:'要把一张图变成能到处贴的链接的时候',
    store:'配置存本机，图存你自己的 R2 · 要先填 R2 密钥' },

  { id:'read', name:'喵喵书阁', glyph:'书', group:'stash', path:'read/',
    desc:'存番外和长篇，能朗读',
    when:'写完或收集来的长篇，想当书一样翻的时候',
    store:'东西存本机 · 不用配任何东西' },

  { id:'archive', name:'Chat Archive', glyph:'档', group:'stash', path:'archive/',
    desc:'JSON 备份当聊天记录翻',
    when:'想回头看某段聊天的时候。一份备份 = 一段对话',
    store:'东西存本机 · 完全不联网' },

  { id:'wblib', name:'世界书库', glyph:'库', group:'stash', path:'worldbook/library.html',
    desc:'世界书的存放、导入导出和备份',
    when:'找一本写好的世界书，或者把别人的导进来的时候',
    store:'和生成器共用同一个库 · 不用配 API' },
];

const GROUP_LABEL = { diy:'DIY', stash:'收纳' };

// 仓库根目录：从 <script src> 反推，这样工具放在第几层都不用改代码
const me = document.currentScript;
const ROOT = new URL('.', me ? me.src : location.href).href;
const here = me ? (me.dataset.tool || '') : '';
const urlOf = t => ROOT + t.path;

// ---------- 日夜：全站一个设置 ----------
// 存在合集页那份配置里（同源，localStorage 是共享的），所以在工具里切完，
// 回到首页也是切好的状态。
const STORE = 'toolbox.v1';
const THEMES = ['auto', 'light', 'dark'];

function readState() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; }
  catch (e) { return {}; }
}
function writeTheme(theme) {
  try {
    const s = readState();
    s.theme = theme;
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch (e) {}
}
function currentTheme() {
  const t = readState().theme;
  return THEMES.includes(t) ? t : 'auto';
}
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) {
    const dark = theme === 'dark' ||
      (theme === 'auto' && matchMedia('(prefers-color-scheme:dark)').matches);
    meta.content = dark ? '#000000' : '#FFFFFF';
  }
  document.querySelectorAll('[data-tb-theme]:not(.tb-sheet-theme)').forEach(b => {
    b.textContent = { auto:'◐', light:'☀', dark:'☾' }[theme];
  });
  const row = document.querySelector('.tb-sheet-theme');
  if (row) row.textContent = { auto:'◐ 跟随系统', light:'☀ 白天', dark:'☾ 夜里' }[theme];
}
function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % 3];
  writeTheme(next);
  applyTheme(next);
}

applyTheme(currentTheme());

/*
  谁说了算：全站设置说了算。

  书阁、图床这些工具自己也记着一份主题，启动时会把 data-theme 改成它自己那份 ——
  那一下发生在我们之后，所以要在它启动完再压一次，否则在首页切成夜间、
  点进书阁又变回白的。

  压完之后再开始听：这时候 data-theme 再变，就真的是人点了工具自己的主题按钮，
  那就反过来记进全站设置，让其他工具跟着变。
*/
let listening = false;

new MutationObserver(() => {
  if (!listening) return;
  const t = document.documentElement.getAttribute('data-theme') || 'auto';
  if (THEMES.includes(t) && t !== currentTheme()) writeTheme(t);
}).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });

function seizeTheme() {
  applyTheme(currentTheme());
  setTimeout(() => { applyTheme(currentTheme()); listening = true; }, 260);
}
window.addEventListener('load', seizeTheme);
if (document.readyState === 'complete') seizeTheme();

// ---------- 切换工具的面板 ----------
let sheet = null;

function buildSheet() {
  const wrap = document.createElement('div');
  wrap.className = 'tb-sheet';
  wrap.innerHTML = '<div class="tb-sheet-scrim"></div>';
  const panel = document.createElement('div');
  panel.className = 'tb-sheet-panel';

  const home = document.createElement('a');
  home.className = 'tb-sheet-home';
  home.href = ROOT;
  home.textContent = '← 回工具箱';
  panel.appendChild(home);

  for (const key of ['diy', 'stash']) {
    const items = TOOLS.filter(t => t.group === key);
    if (!items.length) continue;
    const h = document.createElement('div');
    h.className = 'tb-sheet-sec';
    h.textContent = GROUP_LABEL[key];
    panel.appendChild(h);
    for (const t of items) {
      const a = document.createElement('a');
      a.className = 'tb-sheet-item' + (t.id === here ? ' on' : '');
      a.href = urlOf(t);
      a.innerHTML = '<span class="tb-g">' + t.glyph + '</span><span class="tb-n">' + t.name +
        '</span><span class="tb-d">' + t.desc + '</span>';
      panel.appendChild(a);
    }
  }
  // 日夜也放进来：这样每个工具里都有同一个入口，不用去翻它自己的设置
  const theme = document.createElement('button');
  theme.type = 'button';
  theme.className = 'tb-sheet-theme';
  theme.setAttribute('data-tb-theme', '');
  const paintTheme = () => {
    theme.textContent = { auto:'◐ 跟随系统', light:'☀ 白天', dark:'☾ 夜里' }[currentTheme()];
  };
  paintTheme();
  theme.addEventListener('click', () => { cycleTheme(); paintTheme(); });
  panel.appendChild(theme);

  wrap.appendChild(panel);
  wrap.addEventListener('click', e => { if (!panel.contains(e.target)) close(); });
  document.body.appendChild(wrap);
  return wrap;
}
function open() {
  if (!sheet) sheet = buildSheet();
  requestAnimationFrame(() => sheet.classList.add('on'));
}
function close() { if (sheet) sheet.classList.remove('on'); }

// ---------- 把按钮接上 ----------
function wire() {
  if (!here) return;   // 合集页自己不需要顶栏，它就是首页

  document.querySelectorAll('[data-tb-switch]').forEach(b => b.addEventListener('click', e => {
    e.preventDefault(); open();
  }));
  document.querySelectorAll('[data-tb-theme]').forEach(b => b.addEventListener('click', e => {
    e.preventDefault(); cycleTheme();
  }));
  document.querySelectorAll('[data-tb-home]').forEach(b => { if (!b.getAttribute('href')) b.setAttribute('href', ROOT); });

  // 工具没给按钮的位置，就在右下角自己生一个，保证任何工具都走得回去
  if (!document.querySelector('[data-tb-switch]')) {
    const fab = document.createElement('button');
    fab.className = 'tb-fab';
    fab.type = 'button';
    fab.textContent = '⇄';
    fab.title = '切换工具';
    fab.addEventListener('click', open);
    document.body.appendChild(fab);
  }
  applyTheme(currentTheme());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
else wire();

window.TOOLBOX = { TOOLS, GROUP_LABEL, ROOT, urlOf, currentTheme, cycleTheme, applyTheme, openSwitcher: open };
})();
