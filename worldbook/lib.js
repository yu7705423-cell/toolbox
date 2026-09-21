/*
  世界书库 · 视图与外壳
  ————————————————————————————————————————————————
  这个页面只管存：自制区、导入区、查看、改名、导出、批量打包、整库备份。
  它不生成、不审查、不调模型 —— 一个 API 密钥都不需要就能用。

  和生成器（index.html）同源，所以读写的是同一个 IndexedDB。
  生成器那边「保存到世界书库」存进来的书，这里刷新就能看见。
*/
'use strict';

__M['views/library'] = (function () {
'use strict';
// 世界书库：自制区和导入区物理隔开。
//
// 导入的世界书只作存储：不出现在系列选择里、不参与注入、批量导出默认不带上。
// 想用别人的内容只有一条路 —— 显式"复制为自制"，副本会标明来源。

const { el, toast, copyText, fmtTime, confirmBox, modal, pickFile } = __M['util'];
const { card } = __M['views/common'];
const { put, del } = __M['db'];
const { exportTxt, exportDocx, exportSillyTavern, exportBatch, parseImport, makeBookRecord, bookToText } = __M['exporter'];
async function render(root, ctx) {
  const { state } = ctx;
  root.innerHTML = '';
  const selected = new Set();

  const search = el('input', { type: 'text', placeholder: '搜索标题或内容' });
  const mineBox = el('div', { class: 'list' });
  const impBox = el('div', { class: 'list' });

  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const match = b => !q || (b.title || '').toLowerCase().includes(q) || (b.content || '').toLowerCase().includes(q);
    const mine = state.books.filter(b => b.source !== 'imported' && match(b));
    const imported = state.books.filter(b => b.source === 'imported' && match(b));

    mineBox.innerHTML = '';
    if (!mine.length) mineBox.appendChild(el('div', { class: 'empty', text: '还没有自制世界书。去生成器跑一版，保存进库就会出现在这儿。' }));
    mine.forEach(b => mineBox.appendChild(bookItem(b, ctx, selected, paint, true)));

    impBox.innerHTML = '';
    if (!imported.length) impBox.appendChild(el('div', { class: 'empty', text: '没有导入的世界书' }));
    imported.forEach(b => impBox.appendChild(bookItem(b, ctx, selected, paint, false)));
  };
  search.addEventListener('input', paint);

  root.appendChild(card('自制世界书', [
    search,
    el('div', { class: 'hint', style: { margin: '8px 0' }, text: '只有这一区里的世界书能被选进系列、参与注入。' }),
    mineBox
  ], [
    el('button', { class: 'small', text: '批量导出选中', onclick: () => batchDialog(state, selected) })
  ]));

  root.appendChild(card('导入的世界书（只作存储）', [
    el('div', { class: 'hint', text: '这一区和自制的完全分开：不参与注入、不出现在系列选择里、批量导出默认不带。要用里面的内容，先「复制为自制」。' }),
    el('div', { style: { height: '8px' } }),
    impBox
  ], [
    el('button', { class: 'small', text: '导入文件', onclick: () => doImport(ctx, paint) })
  ]));

  paint();
}

function bookItem(b, ctx, selected, paint, isMine) {
  const cb = el('input', { type: 'checkbox' });
  cb.checked = selected.has(b.id);
  cb.addEventListener('change', () => { cb.checked ? selected.add(b.id) : selected.delete(b.id); });

  const actions = [
    el('button', { class: 'small', text: '查看', onclick: () => viewBook(b) }),
    el('button', { class: 'small', text: '复制', onclick: () => copyText(b.content) })
  ];
  if (isMine) {
    actions.push(el('button', { class: 'small', text: '导出', onclick: () => exportDialog(b) }));
    actions.push(el('button', { class: 'small', text: '改名', onclick: async () => {
      const inp = el('input', { type: 'text', value: b.title });
      const ok = await modal({ title: '改名', body: inp, onConfirm: () => inp.value.trim() || null });
      if (!ok) return;
      b.title = ok; b.updatedAt = Date.now();
      await put('books', b);
      await ctx.reload(); ctx.rerender();
    }}));
  } else {
    actions.push(el('button', { class: 'small', text: '复制为自制', onclick: async () => {
      if (!await confirmBox('复制为自制', `会生成一份副本放进自制区，并标注来源是导入的《${b.title}》。原件保持不动。`)) return;
      const copy = makeBookRecord({
        title: b.title + '（副本）', content: b.content, examples: b.examples || '',
        format: b.format, lang: b.lang, source: 'mine',
        note: `复制自导入的《${b.title}》`
      });
      await put('books', copy);
      toast('已复制到自制区');
      await ctx.reload(); ctx.rerender();
    }}));
  }
  actions.push(el('button', { class: 'small danger', text: '删除', onclick: async () => {
    if (!await confirmBox('删除', `删掉《${b.title}》？不能撤销。`)) return;
    await del('books', b.id);
    selected.delete(b.id);
    await ctx.reload(); ctx.rerender();
  }}));

  return el('div', { class: 'item', style: { flexWrap: 'wrap' } }, [
    cb,
    el('div', { class: 'grow' }, [
      el('div', { class: 'title', text: b.title }),
      el('div', { class: 'meta', text: `${b.format || 'natural'} · ${(b.content || '').length} 字 · ${fmtTime(b.updatedAt)}${b.note ? ' · ' + b.note : ''}` })
    ]),
    el('div', { class: 'row tight' }, actions)
  ]);
}

async function viewBook(b) {
  await modal({
    title: b.title, wide: true,
    body: el('div', {}, [
      el('pre', { class: 'out', text: bookToText(b) })
    ]),
    confirmText: '关闭'
  });
}

async function exportDialog(b) {
  const fmt = { docx: true, txt: true, json: false };
  const cbs = ['docx', 'txt', 'json'].map(k => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = fmt[k];
    cb.addEventListener('change', () => { fmt[k] = cb.checked; });
    return el('label', { class: 'row tight' }, [cb, el('span', { text: k === 'json' ? 'SillyTavern 世界书 JSON' : k })]);
  });
  const ok = await modal({
    title: '导出《' + b.title + '》',
    body: el('div', { class: 'col' }, [el('div', { class: 'hint', text: '选一种或几种格式' }), ...cbs]),
    confirmText: '导出'
  });
  if (!ok) return;
  if (fmt.txt) exportTxt(b);
  if (fmt.docx) exportDocx(b);
  if (fmt.json) exportSillyTavern(b);
}

async function batchDialog(state, selected) {
  const books = state.books.filter(b => selected.has(b.id) && b.source !== 'imported');
  const skipped = state.books.filter(b => selected.has(b.id) && b.source === 'imported').length;
  if (!books.length) { toast('先勾选几本自制世界书', true); return; }

  const fmt = { docx: true, txt: true, json: false };
  const cbs = ['docx', 'txt', 'json'].map(k => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = fmt[k];
    cb.addEventListener('change', () => { fmt[k] = cb.checked; });
    return el('label', { class: 'row tight' }, [cb, el('span', { text: k === 'json' ? 'SillyTavern 世界书 JSON' : k })]);
  });
  const ok = await modal({
    title: `批量导出 ${books.length} 本`,
    body: el('div', { class: 'col' }, [
      el('div', { class: 'hint', text: '打成一个 zip，按格式分子目录。' }),
      skipped ? el('div', { class: 'hint warnish', text: `已跳过 ${skipped} 本导入的世界书 —— 导入区不参与导出，免得把别人的东西带出去。` }) : null,
      ...cbs
    ]),
    confirmText: '导出 zip'
  });
  if (!ok) return;
  const n = exportBatch(books, fmt);
  toast(`已导出 ${n} 本`);
}

async function doImport(ctx, paint) {
  const files = await pickFile('.json,.txt,.md');
  if (!files.length) return;
  let n = 0;
  for (const f of files) {
    try {
      const parsed = parseImport(f.name, await f.text());
      const rec = makeBookRecord({
        title: parsed.title, content: parsed.content, format: parsed.format,
        source: 'imported',
        note: parsed.entryCount ? `导入 · ${parsed.entryCount} 个条目` : '导入'
      });
      rec.raw = parsed.raw || null;
      await put('books', rec);
      n++;
    } catch (e) {
      toast(`${f.name} 导入失败：${e.message}`, true);
    }
  }
  if (n) toast(`已导入 ${n} 本（放在导入区，不参与注入）`);
  await ctx.reload();
  ctx.rerender();
}

return { render };
})();

__M['app/library'] = (function () {
'use strict';
// 书库的外壳。生成器那边的外壳要管路由、草稿、跑到一半的任务，这里都不需要 ——
// 一个视图、一份数据，刷新就重画。

const { $, el, toast, download, pickFile, confirmBox } = __M['util'];
const { initStorage, listSorted, getSettings, dumpAll, restoreAll, storageState } = __M['db'];
const { card } = __M['views/common'];
const libraryView = __M['views/library'];

const state = { books: [], settings: null };

async function reload() {
  state.settings = await getSettings();
  state.books = await listSorted('books');
}

const ctx = {
  state,
  reload,
  rerender: () => rerender(),
  refresh: async () => { await reload(); await rerender(); }
};

let rendering = false;
async function rerender() {
  if (rendering) return;
  rendering = true;
  const root = $('#view');
  try {
    await libraryView.render(root, ctx);
    root.appendChild(backupCard());
    root.scrollTop = 0;
  } catch (e) {
    console.error(e);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'card' }, [
      el('h2', { class: 'sec', text: '这个页面崩了' }),
      el('pre', { class: 'out', text: (e && e.stack) || String(e) })
    ]));
  }
  rendering = false;
}

// 整库备份：原来在生成器的设置页里，搬过来了 —— 备份是存储的事。
// 注意导的是整个库（含 API 预设、版本、画像），不只是世界书。
function backupCard() {
  return card('整库备份与恢复', [
    el('div', { class: 'hint', text: '全部数据都在这台设备的浏览器里：世界书、生成过的版本、API 预设、模型档案。清缓存或换设备之前记得导一份。' }),
    el('div', { class: 'row', style: { marginTop: '8px' } }, [
      el('button', { class: 'small', text: '导出备份（不含密钥）', onclick: () => doDump(false) }),
      el('button', { class: 'small', text: '导出备份（含密钥）', onclick: async () => {
        if (!await confirmBox('含密钥导出', '导出的文件里会有明文 API 密钥。确定要导吗？')) return;
        doDump(true);
      } }),
      el('button', { class: 'small', text: '从备份恢复', onclick: async () => {
        const files = await pickFile('.json');
        if (!files.length) return;
        try {
          const dump = JSON.parse(await files[0].text());
          const n = await restoreAll(dump, { merge: true });
          toast(`已恢复 ${n} 条记录`);
          ctx.refresh();
        } catch (e) { toast('恢复失败：' + e.message, true); }
      } })
    ])
  ]);
}

async function doDump(includeKeys) {
  const dump = await dumpAll({ includeKeys });
  download(`世界书备份-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(dump), 'application/json');
  toast('已导出');
}

// 存储降级了要说一声：内存模式下关掉页面就白干
function showStorageWarning() {
  const bar = el('div', {
    style: {
      background: storageState.mode === 'memory' ? '#4a2020' : '#3a3520',
      color: '#ffd9a0', padding: '8px 14px', fontSize: '12px',
      borderBottom: '1px solid var(--line)', lineHeight: '1.5'
    },
    text: (storageState.mode === 'memory' ? '⚠ ' : '') + storageState.note
  });
  document.querySelector('.body').before(bar);
}

async function boot() {
  const mode = await initStorage();
  if (mode !== 'idb') showStorageWarning();
  await reload();
  await rerender();
}

boot().catch(e => {
  document.getElementById('view').innerHTML =
    `<div class="card"><h2 class="sec">启动失败</h2><pre class="out">${String(e && e.stack || e)}</pre></div>`;
});

return { state };
})();
