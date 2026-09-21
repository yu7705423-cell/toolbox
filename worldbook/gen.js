/*
  世界书生成器 · 视图与外壳
  ————————————————————————————————————————————————
  这个页面只做一件事：把世界书写出来、审出来、改出来。
  写完之后「保存到世界书库」是它唯一的出口 —— 导入、导出、改名、批量、
  整库备份全在 library.html，那边才是管存储的。
*/
'use strict';

__M['views/generate'] = (function () {
'use strict';
// 生成视图：需求 → 细调 → 生成 → 审查 → 反馈归因 → 修订 → 存库。

const { el, toast, copyText, uid, truncate, modal, fmtTime, extractJson } = __M['util'];
const { card, field, select, renderAudit, targetModelInput } = __M['views/common'];
const { generate, runAudit, buildContext, auditDigestText, trialRun } = __M['pipeline'];
const { put, query, getProfile } = __M['db'];
// 生成器只往书库里写，不直接产文件 —— 导出、改名、批量都在 library.html
const { makeBookRecord } = __M['exporter'];
const { buildAttributionSystem, buildAttributionUser, historyDigest, recordRemedy } = __M['memory'];
const { profileDigest } = __M['profile'];
const { chat } = __M['api'];
const { FORMAT_SPEC } = __M['prompt'];
const DEFAULT_DRAFT = {
  question: '', tuning: '', injected: '',
  lang: 'zh', format: 'natural', exampleCount: 2, lengthTarget: '',
  seriesIds: [], targetModelKey: '', banwords: [],
  withExamples: true, withSelfCheck: true, useProfile: true, reviewOutline: false
};

async function render(root, ctx) {
  const { state, refresh, navigate } = ctx;
  const d = state.draft;
  root.innerHTML = '';

  const mainPreset = state.presets.find(p => p.id === state.settings.mainPresetId);
  if (!mainPreset) {
    root.appendChild(card('先配一个模型', [
      el('div', { class: 'hint', text: '还没有指定主模型。到「设置」里加一个 API 预设，并把它选成主模型。' }),
      el('button', { class: 'primary', text: '去设置', onclick: () => navigate('settings') })
    ]));
    return;
  }

  // ---------- 需求（最上面） ----------
  const questionInput = el('textarea', { rows: 5, placeholder: '要解决什么问题？说症状就行 —— 比如「AI 总是把{{char}}写得像客服，一到冲突就和稀泥」。\n工具会先判断根因，再决定写哪几条约束。', value: d.question });
  questionInput.addEventListener('input', () => { d.question = questionInput.value; });

  root.appendChild(card('要解决的问题', [
    questionInput,
    el('div', { class: 'hint', text: '不用写成需求文档。你描述的是症状，第一阶段会先做根因判断，把同源的症状归成一族，再动笔。' })
  ], projectBadge(state)));

  // ---------- 细调 ----------
  const tuningInput = el('textarea', { rows: 3, placeholder: '补充要求：世界观基调、必须包含的设定、篇幅偏好……', value: d.tuning });
  tuningInput.addEventListener('input', () => { d.tuning = tuningInput.value; });
  const injectInput = el('textarea', { class: 'mono', rows: 4, placeholder: '这里写的内容会放在调用的最顶部，优先级高于本工具的全部规约。', value: d.injected });
  injectInput.addEventListener('input', () => { d.injected = injectInput.value; });

  const langSel = select([{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }], d.lang, v => { d.lang = v; });
  const fmtSel = select(Object.entries(FORMAT_SPEC).map(([k, v]) => ({ value: k, label: v.label })), d.format, v => { d.format = v; });
  const exCount = el('input', { type: 'number', value: d.exampleCount, min: 1, max: 5 });
  exCount.addEventListener('change', () => { d.exampleCount = Number(exCount.value) || 2; });
  const lenInput = el('input', { type: 'text', value: d.lengthTarget, placeholder: '例如 1500' });
  lenInput.addEventListener('change', () => { d.lengthTarget = lenInput.value.trim(); });

  const checks = el('div', { class: 'row' }, [
    checkbox('生成示例（正常/边界/易错）', d.withExamples, v => { d.withExamples = v; }),
    checkbox('要求模型自检', d.withSelfCheck, v => { d.withSelfCheck = v; }),
    checkbox('注入用户画像', d.useProfile, v => { d.useProfile = v; }),
    checkbox('大纲出来后先让我改一遍', d.reviewOutline, v => { d.reviewOutline = v; })
  ]);

  root.appendChild(card('细调', [
    el('div', { class: 'grid2' }, [
      field('语言', langSel),
      field('格式', fmtSel, 'YAML/XML 便于机器解析和拆条目；自然语言可读性最好。'),
      field('每类示例条数', exCount),
      field('篇幅期望（字）', lenInput, '留空则不限制。')
    ]),
    field('补充要求', tuningInput),
    field('前置注入（排在最顶部）', injectInput, '你自己写好的世界书片段放这儿。它的优先级高于生成器的全部规约，冲突时以它为准。'),
    checks
  ]));

  // ---------- 系列与目标模型 ----------
  const mine = state.books.filter(b => b.source !== 'imported');
  const seriesBox = el('div', { class: 'row tight' }, mine.length
    ? mine.map(b => el('span', {
        class: 'chip' + (d.seriesIds.includes(b.id) ? ' on' : ''),
        text: truncate(b.title, 22),
        onclick: (e) => {
          const i = d.seriesIds.indexOf(b.id);
          if (i >= 0) d.seriesIds.splice(i, 1); else d.seriesIds.push(b.id);
          e.target.className = 'chip' + (d.seriesIds.includes(b.id) ? ' on' : '');
        }
      }))
    : [el('div', { class: 'hint', text: '世界书库里还没有自制世界书。生成后保存进库，就能在这里选来组系列。' })]);

  root.appendChild(card('系列与目标模型', [
    field('同系列已有世界书（会告诉模型避开已有约束、形成体系）', seriesBox,
      '导入库里的世界书只作存储，不会出现在这里，也不会被注入。'),
    field('目标模型（这份世界书最终注入给谁）',
      targetModelInput(state.presets, d.targetModelKey, v => { d.targetModelKey = v; }),
      '模型档案按这个键累积：它犯过什么、什么招对它有用。试运行也用它。')
  ], genPresetBar(state, d, refresh)));

  // ---------- 运行 ----------
  const stagesBox = el('div', { class: 'col' });
  const liveBox = el('pre', { class: 'out short', style: { display: 'none' } });
  const runBtn = el('button', { class: 'primary', text: '开始生成（大纲 → 正文 → 示例 → 自检 → 审查）' });
  const quickBtn = el('button', { text: '快速模式（跳过大纲）' });
  const stopBtn = el('button', { class: 'danger', text: '中止', style: { display: 'none' } });

  const runCard = card('生成', [
    el('div', { class: 'row' }, [runBtn, quickBtn, stopBtn]),
    el('div', { class: 'hint', text: '分阶段跑，是为了让"先大纲后正文"和"自评对账"这两件事可核对。赶时间可以用快速模式，代价是 R6 判不了。' }),
    stagesBox, liveBox
  ]);
  root.appendChild(runCard);

  const resultBox = el('div');
  root.appendChild(resultBox);

  const doRun = async (mode) => {
    if (!d.question.trim()) { toast('先把要解决的问题写一下', true); return; }
    const controller = new AbortController();
    state.running = true;
    runBtn.disabled = quickBtn.disabled = true;
    stopBtn.style.display = '';
    stopBtn.onclick = () => { controller.abort(); toast('已中止'); };
    stagesBox.innerHTML = '';
    liveBox.style.display = '';
    liveBox.textContent = '';
    resultBox.innerHTML = '';

    const rows = new Map();
    const hooks = {
      signal: controller.signal,
      onStage: ({ key, label, status, error }) => {
        let row = rows.get(key);
        if (!row) {
          row = el('div', { class: 'stage' }, [el('span', { class: 'dot' }), el('span', { class: 'label' })]);
          rows.set(key, row);
          stagesBox.appendChild(row);
        }
        row.className = 'stage ' + (status === 'run' ? 'run' : status === 'done' ? 'done' : 'err');
        row.querySelector('.label').textContent = label + (status === 'run' ? ' …' : status === 'err' ? ' 失败：' + error : ' ✓');
      },
      onDelta: (key, acc) => {
        liveBox.textContent = acc.slice(-4000);
        liveBox.scrollTop = liveBox.scrollHeight;
      },
      onWarn: (msg) => { toast(msg, true); }
    };

    // 大纲是整份世界书的骨架，改这里的成本最低。勾了就在写正文之前停一下。
    if (mode === 'full' && d.reviewOutline) {
      hooks.pauseAfterOutline = async (outline) => {
        const ta = el('textarea', { class: 'mono', rows: 16, value: outline });
        const ok = await modal({
          title: '大纲确认', wide: true,
          body: el('div', { class: 'col' }, [
            el('div', { class: 'hint', text: '正文会严格按这份大纲展开，并按它算覆盖率。现在改，比正文写完再改便宜得多。' }),
            ta
          ]),
          confirmText: '按这份大纲写正文'
        });
        return ok ? ta.value : null;
      };
    }

    try {
      const project = await ensureProject(state, d);
      const auditPreset = state.presets.find(p => p.id === (state.settings.auditPreset === 'main' ? state.settings.mainPresetId : (state.settings.auxPresetId || state.settings.mainPresetId)));
      const version = await generate({
        project, config: JSON.parse(JSON.stringify(d)),
        mainPreset, auditPreset, settings: state.settings,
        books: state.books, mode
      }, hooks);
      state.currentProjectId = project.id;
      state.currentVersionId = version.id;
      liveBox.style.display = 'none';
      await ctx.reload();
      renderResult(resultBox, version, ctx);
      toast(`第 ${version.n} 版完成，综合分 ${version.audit.score}`);
    } catch (e) {
      toast('生成失败：' + e.message, true);
    } finally {
      state.running = false;
      runBtn.disabled = quickBtn.disabled = false;
      stopBtn.style.display = 'none';
    }
  };

  runBtn.onclick = () => doRun('full');
  quickBtn.onclick = () => doRun('quick');

  // 已有当前版本就直接展示
  if (state.currentVersionId) {
    const v = state.versions.find(x => x.id === state.currentVersionId);
    if (v) renderResult(resultBox, v, ctx);
  }
}

function checkbox(label, value, onChange) {
  const cb = el('input', { type: 'checkbox' });
  cb.checked = value !== false;
  cb.addEventListener('change', () => onChange(cb.checked));
  return el('label', { class: 'row tight', style: { cursor: 'pointer' } }, [cb, el('span', { class: 'hint', text: label })]);
}

function projectBadge(state) {
  const p = state.projects.find(x => x.id === state.currentProjectId);
  return el('span', { class: 'badge' + (p ? ' accent' : ''), text: p ? `项目：${truncate(p.title, 18)}` : '新项目' });
}

// 生成设置预设：把细调这一整套存下来复用
function genPresetBar(state, d, refresh) {
  const wrap = el('div', { class: 'row tight' });
  const sel = select(
    [{ value: '', label: '载入设置预设…' }].concat(state.genPresets.map(g => ({ value: g.id, label: g.name }))),
    '', async v => {
      if (!v) return;
      const g = state.genPresets.find(x => x.id === v);
      if (!g) return;
      Object.assign(d, g.config, { question: d.question });   // 需求不覆盖，只套设置
      toast(`已载入「${g.name}」`);
      refresh();
    });
  wrap.appendChild(sel);
  wrap.appendChild(el('button', { class: 'small', text: '存为设置预设', onclick: async () => {
    const nameInput = el('input', { type: 'text', placeholder: '预设名' });
    const ok = await modal({ title: '保存当前细调设置', body: el('div', { class: 'col' }, [
      el('div', { class: 'hint', text: '会保存语言、格式、示例数、前置注入、系列选择、目标模型等，不保存"要解决的问题"。' }), nameInput
    ]), onConfirm: () => nameInput.value.trim() || null });
    if (!ok) return;
    const cfg = JSON.parse(JSON.stringify(d));
    delete cfg.question;
    await put('genPresets', { id: uid('gp'), name: ok, config: cfg, createdAt: Date.now(), updatedAt: Date.now() });
    toast('已保存');
    refresh();
  }}));
  return wrap;
}

async function ensureProject(state, d) {
  if (state.currentProjectId) {
    const p = state.projects.find(x => x.id === state.currentProjectId);
    if (p) {
      p.updatedAt = Date.now();
      p.lastConfig = JSON.parse(JSON.stringify(d));
      await put('projects', p);
      return p;
    }
  }
  const p = {
    id: uid('pj'), title: truncate(d.question, 28) || '未命名项目',
    question: d.question, lastConfig: JSON.parse(JSON.stringify(d)),
    createdAt: Date.now(), updatedAt: Date.now()
  };
  await put('projects', p);
  state.currentProjectId = p.id;
  return p;
}

// ---------- 结果区 ----------

function renderResult(box, version, ctx) {
  box.innerHTML = '';
  const stages = version.stages || {};
  let tab = 'body';

  const pane = el('pre', { class: 'out' });
  const paint = () => {
    pane.textContent = tab === 'body' ? stages.body
      : tab === 'examples' ? (stages.examples || '（这一版没有生成示例）')
      : tab === 'outline' ? (stages.outline || '（这一版没有大纲阶段）')
      : stages.selfCheckRaw || '（这一版没有自检）';
    Array.from(tabs.children).forEach(c => { c.className = 'tab' + (c.dataset.k === tab ? ' active' : ''); });
  };
  const tabs = el('div', { class: 'tabs' }, [
    ['body', '正文'], ['examples', '示例'], ['outline', '大纲与根因'], ['self', '自检原文']
  ].map(([k, label]) => {
    const t = el('div', { class: 'tab', text: label, onclick: () => { tab = k; paint(); } });
    t.dataset.k = k;
    return t;
  }));

  const actions = el('div', { class: 'row', style: { marginTop: '10px' } }, [
    el('button', { class: 'small primary', text: '一键复制正文', onclick: () => copyText(stages.body) }),
    el('button', { class: 'small', text: '复制正文+示例', onclick: () => copyText(stages.body + (stages.examples ? '\n\n' + stages.examples : '')) }),
    el('button', { class: 'small', text: '手动修改', onclick: () => manualEdit(version, ctx) }),
    el('button', { class: 'small', text: '保存到世界书库', onclick: () => saveToLibrary(version, ctx) }),
    el('a', { class: 'btn small', href: 'library.html', text: '去世界书库 ↗' })
  ]);

  box.appendChild(card(`第 ${version.n} 版`, [tabs, pane, actions], [
    el('span', { class: 'badge', text: fmtTime(version.createdAt) }),
    el('span', { class: 'badge ' + (version.audit.score >= 75 ? 'ok' : version.audit.score >= 50 ? 'warn' : 'bad'), text: '综合分 ' + version.audit.score })
  ]));
  paint();

  box.appendChild(renderAudit(version.audit, {
    onRevise: () => reviseFlow(version, ctx, auditDigestText(version.audit), '')
  }));

  box.appendChild(feedbackCard(version, ctx));
  box.appendChild(trialCard(version, ctx));
}

// 手动改正文：单独存成一版，mode 标成 manual。
// 这类版本在画像分析里权重最高 —— 用户没说、但自己动手改掉的地方，才是真偏好。
async function manualEdit(version, ctx) {
  const { state } = ctx;
  const ta = el('textarea', { class: 'mono', rows: 18, value: version.stages.body });
  const noteInput = el('input', { type: 'text', placeholder: '这次改了什么？（可留空）' });
  const ok = await modal({
    title: `手动修改第 ${version.n} 版`, wide: true,
    body: el('div', { class: 'col' }, [
      el('div', { class: 'hint', text: '保存后会单独存成新的一版，并记下你改动的位置。这些改动是用户画像里权重最高的证据。' }),
      ta, noteInput
    ]),
    confirmText: '存为新版本',
    onConfirm: () => (ta.value.trim() && ta.value !== version.stages.body ? true : (toast('内容没有变化', true), null))
  });
  if (!ok) return;

  const cfg = version.config || {};
  const ctxObj = await buildContext(cfg, { books: state.books, settings: state.settings });
  // 手改版只跑本地静态审查：这一版的内容是用户自己定的，没必要再花钱让模型评一遍
  const audit = await runAudit({
    body: ta.value, outline: version.stages.outline, examples: version.stages.examples,
    ctx: ctxObj, selfCheck: null, auditPreset: null,
    settings: Object.assign({}, state.settings, { auditWithLLM: false })
  });
  const prior = await query('versions', 'projectId', version.projectId);
  const newVersion = {
    id: uid('v'), projectId: version.projectId, n: prior.length + 1,
    parentId: version.id, mode: 'manual',
    stages: { outline: version.stages.outline, body: ta.value, examples: version.stages.examples, selfCheckRaw: '' },
    selfCheck: null, audit, config: cfg,
    meta: Object.assign({}, version.meta, { durationMs: 0, instructions: '手动修改' }),
    note: noteInput.value.trim() || '手动修改',
    userEdited: true, editedFrom: version.id,
    createdAt: Date.now()
  };
  await put('versions', newVersion);
  state.currentVersionId = newVersion.id;
  await ctx.reload();
  toast(`已存为第 ${newVersion.n} 版`);
  ctx.rerender();
}

async function saveToLibrary(version, ctx) {
  const nameInput = el('input', { type: 'text', value: truncate(version.config?.question, 24) || '未命名世界书' });
  const withEx = el('input', { type: 'checkbox' });
  withEx.checked = true;
  const ok = await modal({
    title: '保存到世界书库',
    body: el('div', { class: 'col' }, [
      field('标题', nameInput),
      el('label', { class: 'row tight' }, [withEx, el('span', { class: 'hint', text: '把示例一起存进去' })]),
      el('div', { class: 'hint', text: '存进「自制」区。只有自制的世界书能被选进系列、参与注入。' })
    ]),
    onConfirm: () => nameInput.value.trim() || null
  });
  if (!ok) return;
  const rec = makeBookRecord({
    title: ok, content: version.stages.body,
    examples: withEx.checked ? version.stages.examples : '',
    format: version.config?.format || 'natural', lang: version.config?.lang || 'zh',
    source: 'mine', projectId: version.projectId, versionId: version.id
  });
  await put('books', rec);
  toast('已存入世界书库');
  await ctx.reload();
}

// ---------- 反馈 → 归因 → 修订 ----------

function feedbackCard(version, ctx) {
  const { state } = ctx;
  const input = el('textarea', { rows: 3, placeholder: '这一版哪里不对？照直说就行 —— 「读着还是很飘」「{{char}}还是太客气」。\n工具会结合实测审查结果和这个模型的历史，判断根因在哪，而不是直接按你指的地方打补丁。' });
  const outBox = el('div');
  const attrBtn = el('button', { class: 'primary small', text: '分析根因' });

  attrBtn.onclick = async () => {
    const say = input.value.trim();
    if (!say) { toast('先写点什么', true); return; }
    attrBtn.disabled = true; attrBtn.textContent = '分析中…';
    try {
      const preset = state.presets.find(p => p.id === (state.settings.auxPresetId || state.settings.mainPresetId));
      if (!preset) throw new Error('没有可用的模型预设');
      const modelKey = version.config?.targetModelKey || version.meta?.modelKey || '';
      const fbs = await query('feedback', 'projectId', version.projectId);
      const history = await historyDigest(modelKey, fbs.sort((a, b) => b.createdAt - a.createdAt));
      const profile = await getProfile();
      const r = await chat(preset, {
        system: buildAttributionSystem(),
        messages: [{ role: 'user', content: buildAttributionUser({
          feedback: say, body: version.stages.body,
          auditDigest: auditDigestText(version.audit),
          modelKey, history, profileDigest: profileDigest(profile)
        }) }],
        temperature: 0.3, json: true
      });
      const parsed = extractJson(r.text);
      if (!parsed) throw new Error('返回的内容解析不出 JSON');
      const fb = {
        id: uid('fb'), projectId: version.projectId, versionId: version.id,
        modelKey, userSay: say, attribution: parsed,
        rootCause: parsed.root_causes?.[0]?.cause || '',
        worked: null, createdAt: Date.now()
      };
      await put('feedback', fb);
      renderAttribution(outBox, parsed, fb, version, ctx);
    } catch (e) {
      toast('分析失败：' + e.message, true);
    }
    attrBtn.disabled = false; attrBtn.textContent = '分析根因';
  };

  return card('这一版哪里不好', [
    input,
    el('div', { class: 'row', style: { marginTop: '8px' } }, [
      attrBtn,
      el('button', { class: 'small', text: '跳过分析，直接按我说的改', onclick: () => {
        const say = input.value.trim();
        if (!say) { toast('先写点什么', true); return; }
        reviseFlow(version, ctx, auditDigestText(version.audit), say);
      }})
    ]),
    outBox
  ]);
}

function renderAttribution(box, a, fb, version, ctx) {
  box.innerHTML = '';
  const picked = new Set();
  const list = el('div', { class: 'list' });

  (a.root_causes || []).forEach((rc, i) => {
    list.appendChild(el('div', { class: 'item', style: { alignItems: 'flex-start' } }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'title', style: { whiteSpace: 'normal' }, text: `根因 ${i + 1}：${rc.cause}` }),
        el('div', { class: 'meta', style: { whiteSpace: 'normal' }, text: `置信度 ${rc.confidence || '?'} · ${rc.why || ''}` }),
        rc.also_explains ? el('div', { class: 'meta', style: { whiteSpace: 'normal', color: 'var(--accent)' }, text: '还能解释：' + rc.also_explains }) : null
      ])
    ]));
  });

  (a.remedies || []).forEach((rm, i) => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = i === 0;
    if (i === 0) picked.add(i);
    cb.addEventListener('change', () => { cb.checked ? picked.add(i) : picked.delete(i); });
    list.appendChild(el('div', { class: 'item', style: { alignItems: 'flex-start' } }, [
      cb,
      el('div', { class: 'grow' }, [
        el('div', { class: 'title', style: { whiteSpace: 'normal' }, text: '对策：' + rm.action }),
        el('div', { class: 'meta', style: { whiteSpace: 'normal' }, text:
          (rm.reused_from_history ? '♻ 复用历史有效手法：' + (rm.history_note || '') + ' · ' : '') +
          (rm.side_effect ? '副作用：' + rm.side_effect : '') }, )
      ])
    ]));
  });

  box.appendChild(el('div', { class: 'card', style: { marginTop: '12px' } }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: '根因分析' }),
      a.is_known_pattern ? el('span', { class: 'badge warn', text: '老问题' }) : null
    ]),
    el('div', { class: 'hint', text: '症状：' + (a.symptom || '') }),
    a.known_pattern_note ? el('div', { class: 'hint', text: a.known_pattern_note }) : null,
    list,
    a.not_a_problem ? el('div', { class: 'hint warnish', style: { marginTop: '8px' }, text: '注意：' + a.not_a_problem }) : null,
    el('div', { class: 'row', style: { marginTop: '10px' } }, [
      el('button', { class: 'primary small', text: '按选中的对策生成新版本', onclick: () => {
        const chosen = (a.remedies || []).filter((_, i) => picked.has(i));
        if (!chosen.length) { toast('至少选一条对策', true); return; }
        const text = chosen.map((r, i) => `${i + 1}. ${r.action}（针对根因：${r.targets_cause || ''}）`).join('\n');
        reviseFlow(version, ctx, auditDigestText(version.audit), `用户反馈：${fb.userSay}\n\n根因判断：${a.root_causes?.[0]?.cause || ''}\n\n本轮对策：\n${text}`, { fb, remedies: chosen });
      }})
    ])
  ]));
}

async function reviseFlow(version, ctx, auditDigest, instructions, extra = {}) {
  const { state } = ctx;
  if (!instructions) {
    const input = el('textarea', { rows: 4, placeholder: '这一轮要解决什么？' });
    const ok = await modal({
      title: '修订', body: el('div', { class: 'col' }, [
        el('div', { class: 'hint', text: '审查结论会一并带上。修订要求是"改根因不打补丁"，并且约束总数不许明显变多。' }), input
      ]), onConfirm: () => input.value.trim() || null
    });
    if (!ok) return;
    instructions = ok;
  }

  const mainPreset = state.presets.find(p => p.id === state.settings.mainPresetId);
  const auditPreset = state.presets.find(p => p.id === (state.settings.auxPresetId || state.settings.mainPresetId));
  const project = state.projects.find(p => p.id === version.projectId);
  if (!project) { toast('找不到项目', true); return; }

  const box = el('div', { class: 'col' }, [el('div', { class: 'stage run' }, [el('span', { class: 'dot' }), el('span', { text: '修订中…' })])]);
  const dlg = modal({ title: '正在修订', body: box, confirmText: '关闭', cancelText: '' });

  try {
    const newVersion = await generate({
      project, config: version.config, mainPreset, auditPreset, settings: state.settings,
      books: state.books, mode: 'revise',
      prevBody: version.stages.body, prevOutline: version.stages.outline,
      instructions, prevAudit: version.audit, parentId: version.id
    }, {
      onStage: ({ label, status }) => {
        box.appendChild(el('div', { class: 'stage ' + (status === 'done' ? 'done' : status === 'err' ? 'err' : 'run') }, [
          el('span', { class: 'dot' }), el('span', { text: label })
        ]));
      },
      onWarn: m => toast(m, true)
    });

    // 对策记进模型档案：有没有用等用户回答
    if (extra.remedies && extra.fb) {
      const modelKey = version.config?.targetModelKey || version.meta?.modelKey || '';
      for (const r of extra.remedies) await recordRemedy(modelKey, { text: r.action, note: r.targets_cause || '' });
      extra.fb.nextVersionId = newVersion.id;
      extra.fb.remedies = extra.remedies.map(r => r.action);
      await put('feedback', extra.fb);
    }

    state.currentVersionId = newVersion.id;
    await ctx.reload();
    const delta = newVersion.audit.score - version.audit.score;
    box.appendChild(el('div', { class: 'hint', text:
      `第 ${newVersion.n} 版完成：综合分 ${newVersion.audit.score}（${delta >= 0 ? '+' : ''}${delta}），约束紧度 ${newVersion.audit.overfit.tightness}` }));
    if (extra.fb) box.appendChild(workedButtons(extra.fb, version, newVersion, ctx));
    ctx.rerender();
  } catch (e) {
    box.appendChild(el('div', { class: 'hint warnish', text: '修订失败：' + e.message }));
  }
  await dlg;
}

// "这次有用吗" —— 模型档案里最值钱的一列就靠这个按钮攒出来
function workedButtons(fb, oldVersion, newVersion, ctx) {
  const mark = async (worked) => {
    fb.worked = worked;
    await put('feedback', fb);
    const modelKey = fb.modelKey;
    for (const text of (fb.remedies || [])) await recordRemedy(modelKey, { text, worked });
    toast(worked ? '已记为有效，以后会优先复用' : '已记为无效，以后不再优先推荐');
    await ctx.reload();
  };
  return el('div', { class: 'row', style: { marginTop: '10px' } }, [
    el('span', { class: 'hint', text: '这次的对策有用吗？' }),
    el('button', { class: 'small', text: '有用', onclick: () => mark(true) }),
    el('button', { class: 'small', text: '没用', onclick: () => mark(false) })
  ]);
}

// ---------- 试运行 ----------

function trialCard(version, ctx) {
  const { state } = ctx;
  const turn = el('textarea', { rows: 2, placeholder: '一句测试输入，例如：我今天不太想说话。' });
  const out = el('div');
  const btn = el('button', { class: 'primary small', text: '用测试模型跑一次' });

  btn.onclick = async () => {
    const preset = state.presets.find(p => p.id === state.settings.testPresetId);
    if (!preset) { toast('还没有指定测试模型，去设置里选一个', true); return; }
    if (!turn.value.trim()) { toast('写一句测试输入', true); return; }
    btn.disabled = true; btn.textContent = '运行中…';
    out.innerHTML = '';
    const pre = el('pre', { class: 'out short' });
    out.appendChild(pre);
    try {
      const ctxObj = await buildContext(version.config, { books: state.books, settings: state.settings });
      const r = await trialRun({
        worldbook: version.stages.body + (version.stages.examples ? '\n\n' + version.stages.examples : ''),
        userTurn: turn.value.trim(), testPreset: preset, settings: state.settings, ctx: ctxObj
      }, { onDelta: (k, acc) => { pre.textContent = acc; pre.scrollTop = pre.scrollHeight; } });
      const ban = r.banwords || {};
      out.appendChild(el('div', { class: 'row', style: { marginTop: '8px' } }, [
        el('span', { class: 'badge ' + (ban.status === 'pass' ? 'ok' : ban.status === 'warn' ? 'warn' : 'bad'), text: '禁词检查：' + (ban.summary || '') }),
        el('span', { class: 'badge', text: r.charCount + ' 字' })
      ]));
      if ((ban.evidence || []).length) {
        out.appendChild(el('div', { class: 'list', style: { marginTop: '6px' } },
          ban.evidence.slice(0, 6).map(ev => el('div', { class: 'evidence' }, [
            el('span', { class: 'ln', text: 'L' + ev.line }), el('span', { text: ev.snippet || ev.text }),
            el('div', { style: { color: 'var(--warn)' }, text: ev.note })
          ]))));
      }
    } catch (e) {
      out.appendChild(el('div', { class: 'hint warnish', text: '失败：' + e.message }));
    }
    btn.disabled = false; btn.textContent = '用测试模型跑一次';
  };

  return card('试运行', [
    el('div', { class: 'hint', text: '把这份世界书真的喂给测试模型，看它实际输出，再对输出查一遍禁词。"要求有没有生效"，最后只有这一步能回答。' }),
    turn,
    el('div', { class: 'row', style: { marginTop: '8px' } }, [btn]),
    out
  ]);
}

return { DEFAULT_DRAFT, render, renderResult };
})();

__M['views/versions'] = (function () {
'use strict';
// 版本：每个项目的历次生成、分数走势、任意两版 diff、回到某一版继续改。

const { el, fmtTime, truncate, confirmBox, modal } = __M['util'];
const { card, field, select, scoreMeter } = __M['views/common'];
const { renderResult } = __M['views/generate'];
const { diffLines, collapse, diffStats } = __M['diff'];
const { del } = __M['db'];
async function render(root, ctx) {
  const { state, navigate } = ctx;
  root.innerHTML = '';

  if (!state.projects.length) {
    root.appendChild(card('还没有项目', [
      el('div', { class: 'hint', text: '去「生成」写一个需求并跑一次，这里就会出现版本记录。' }),
      el('button', { class: 'primary', text: '去生成', onclick: () => navigate('generate') })
    ]));
    return;
  }

  const projSel = select(
    state.projects.map(p => ({ value: p.id, label: `${truncate(p.title, 30)}（${fmtTime(p.updatedAt)}）` })),
    state.currentProjectId || state.projects[0].id,
    v => { state.currentProjectId = v; state.currentVersionId = ''; ctx.rerender(); }
  );
  const pid = state.currentProjectId || state.projects[0].id;
  state.currentProjectId = pid;
  const project = state.projects.find(p => p.id === pid);
  const versions = state.versions.filter(v => v.projectId === pid).sort((a, b) => a.n - b.n);

  root.appendChild(card('项目', [
    field('选择项目', projSel),
    project ? el('div', { class: 'hint', style: { marginTop: '6px' }, text: '需求：' + truncate(project.question, 200) }) : null,
    el('div', { class: 'row', style: { marginTop: '8px' } }, [
      el('button', { class: 'small', text: '把这个项目的设置载入生成页', onclick: () => {
        if (project?.lastConfig) Object.assign(state.draft, project.lastConfig);
        navigate('generate');
      }}),
      el('button', { class: 'small', text: '新建项目', onclick: () => {
        state.currentProjectId = '';
        state.currentVersionId = '';
        navigate('generate');
      }}),
      el('button', { class: 'small danger', text: '删除项目', onclick: async () => {
        if (!await confirmBox('删除项目', `连同 ${versions.length} 个版本一起删掉，不能撤销。确定？`)) return;
        for (const v of versions) await del('versions', v.id);
        await del('projects', pid);
        state.currentProjectId = '';
        state.currentVersionId = '';
        await ctx.reload();
        ctx.rerender();
      }})
    ])
  ]));

  if (!versions.length) {
    root.appendChild(el('div', { class: 'empty', text: '这个项目还没有版本' }));
    return;
  }

  // 分数走势：一眼看出改动到底有没有变好
  const trend = el('div', { class: 'list' }, versions.map(v => {
    const isCur = v.id === state.currentVersionId;
    const prev = versions.find(x => x.n === v.n - 1);
    const delta = prev ? v.audit.score - prev.audit.score : 0;
    return el('div', { class: 'item clickable' + (isCur ? '' : ''), style: isCur ? { borderColor: 'var(--accent)' } : {}, onclick: () => {
      state.currentVersionId = v.id;
      ctx.rerender();
    }}, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'title', text: `第 ${v.n} 版${v.mode === 'revise' ? '（修订）' : v.mode === 'quick' ? '（快速）' : ''}${v.parentId ? ' ← 基于第 ' + (versions.find(x => x.id === v.parentId)?.n ?? '?') + ' 版' : ''}` }),
        el('div', { class: 'meta', text: `${fmtTime(v.createdAt)} · ${v.meta?.modelKey || ''} · 紧度 ${v.audit?.overfit?.tightness ?? '-'}${v.note ? ' · ' + truncate(v.note, 40) : ''}` }),
        scoreMeter(v.audit?.score || 0)
      ]),
      el('span', { class: 'badge ' + (v.audit.score >= 75 ? 'ok' : v.audit.score >= 50 ? 'warn' : 'bad'), text: String(v.audit.score) }),
      prev ? el('span', { class: 'badge ' + (delta > 0 ? 'ok' : delta < 0 ? 'bad' : ''), text: (delta >= 0 ? '+' : '') + delta }) : null,
      (v.audit.mismatches || []).length ? el('span', { class: 'badge bad', text: '自评不符 ' + v.audit.mismatches.length }) : null
    ]);
  }));

  root.appendChild(card(`版本（共 ${versions.length} 版）`, [
    el('div', { class: 'hint', text: '点一版查看全文和审查报告。右侧的 +/- 是相对上一版的分数变化。' }),
    trend
  ], el('button', { class: 'small', text: '对比两版', onclick: () => compareDialog(versions) })));

  const cur = versions.find(v => v.id === state.currentVersionId) || versions[versions.length - 1];
  state.currentVersionId = cur.id;
  const resultBox = el('div');
  root.appendChild(resultBox);
  renderResult(resultBox, cur, ctx);
}

async function compareDialog(versions) {
  let a = versions[Math.max(0, versions.length - 2)].id;
  let b = versions[versions.length - 1].id;
  const out = el('div');

  const paint = () => {
    const va = versions.find(v => v.id === a), vb = versions.find(v => v.id === b);
    out.innerHTML = '';
    if (!va || !vb) return;
    const rows = collapse(diffLines(va.stages.body, vb.stages.body), 2);
    const st = diffStats(diffLines(va.stages.body, vb.stages.body));
    out.appendChild(el('div', { class: 'row', style: { marginBottom: '8px' } }, [
      el('span', { class: 'badge ok', text: '+' + st.added + ' 行' }),
      el('span', { class: 'badge bad', text: '-' + st.removed + ' 行' }),
      el('span', { class: 'badge', text: `分数 ${va.audit.score} → ${vb.audit.score}` }),
      el('span', { class: 'badge', text: `紧度 ${va.audit.overfit?.tightness} → ${vb.audit.overfit?.tightness}` })
    ]));
    const box = el('div', { style: { maxHeight: '50vh', overflowY: 'auto', background: 'var(--bg-2)', borderRadius: '8px', padding: '8px' } });
    for (const r of rows) {
      box.appendChild(el('div', {
        class: 'diff-line ' + (r.type === 'add' ? 'add' : r.type === 'del' ? 'del' : 'same'),
        text: (r.type === 'add' ? '+ ' : r.type === 'del' ? '- ' : '  ') + r.text
      }));
    }
    out.appendChild(box);
  };

  const opts = versions.map(v => ({ value: v.id, label: `第 ${v.n} 版（${v.audit.score} 分）` }));
  const dlg = modal({
    title: '版本对比', wide: true,
    body: el('div', { class: 'col' }, [
      el('div', { class: 'grid2' }, [
        field('旧版本', select(opts, a, v => { a = v; paint(); })),
        field('新版本', select(opts, b, v => { b = v; paint(); }))
      ]),
      out
    ]),
    confirmText: '关闭'
  });
  paint();          // modal() 要等到关闭才 resolve，首绘必须排在 await 前面
  await dlg;
}

return { render };
})();

__M['views/insights'] = (function () {
'use strict';
// 洞察：用户画像 + 模型档案。
//
// 这两样是这个工具用得越久越值钱的部分：画像记住"你要什么"，
// 档案记住"这个模型会怎么不听话、以前什么招管用"。

const { el, toast, truncate, fmtTime, confirmBox, modal } = __M['util'];
const { card, field, select } = __M['views/common'];
const { all, del, getProfile, saveProfile } = __M['db'];
const { buildProfileSystem, buildProfileUser, applyProfileUpdate, buildProfileBlock } = __M['profile'];
const { listModelProfiles } = __M['memory'];
const { diffDigest } = __M['diff'];
const { chat } = __M['api'];
const { RULE_BY_ID } = __M['rules'];
const { extractJson } = __M['util'];
async function render(root, ctx) {
  const { state } = ctx;
  root.innerHTML = '';

  const profile = await getProfile();
  const feedbacks = (await all('feedback')).sort((a, b) => b.createdAt - a.createdAt);
  const edits = state.versions.filter(v => v.userEdited);

  // ---------- 用户画像 ----------
  const genBtn = el('button', { class: 'primary small', text: '重新分析画像' });
  genBtn.onclick = async () => {
    const preset = state.presets.find(p => p.id === (state.settings.auxPresetId || state.settings.mainPresetId));
    if (!preset) { toast('先在设置里配一个副模型（或主模型）', true); return; }
    if (!feedbacks.length && !edits.length) { toast('还没有反馈和改动记录，攒几条再来', true); return; }
    genBtn.disabled = true; genBtn.textContent = '分析中…';
    try {
      const samples = {
        feedbacks: feedbacks.slice(0, 25).map(f => ({
          text: f.userSay, rootCause: f.rootCause, worked: f.worked
        })),
        edits: edits.slice(0, 12).map(v => {
          const parent = state.versions.find(x => x.id === v.editedFrom);
          return {
            note: v.note || '',
            diff: parent ? diffDigest(parent.stages.body, v.stages.body, 40) : ''
          };
        }).filter(e => e.diff)
      };
      const r = await chat(preset, {
        system: buildProfileSystem(),
        messages: [{ role: 'user', content: buildProfileUser(samples, profile) }],
        temperature: 0.2, json: true
      });
      const parsed = extractJson(r.text);
      if (!parsed) throw new Error('返回的内容解析不出 JSON');
      await applyProfileUpdate(parsed, samples.feedbacks.length + samples.edits.length);
      toast('画像已更新');
      ctx.rerender();
    } catch (e) {
      toast('分析失败：' + e.message, true);
    }
    genBtn.disabled = false; genBtn.textContent = '重新分析画像';
  };

  const groups = [
    ['hardRules', '硬红线', '违反就会被直接推翻。注入时是硬约束。'],
    ['dislikes', '不喜欢', ''],
    ['preferences', '偏好', ''],
    ['styleNotes', '行文口味', '']
  ];
  const profileBody = [
    el('div', { class: 'hint', text: `原料 ${profile.sourceCount || 0} 条（反馈 ${feedbacks.length} 条 · 手动改动 ${edits.length} 次）${profile.updatedAt ? ' · 更新于 ' + fmtTime(profile.updatedAt) : ''}` }),
    el('div', { class: 'hint', text: '证据只有一条的条目不会被注入 —— 一条证据就写死，正是过拟合的来源。' })
  ];
  let any = false;
  for (const [key, label, note] of groups) {
    const items = profile[key] || [];
    if (!items.length) continue;
    any = true;
    profileBody.push(el('h3', { class: 'sub', text: label + (note ? ` —— ${note}` : '') }));
    profileBody.push(el('div', { class: 'list' }, items.map((x, i) => el('div', { class: 'item' }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'title', style: { whiteSpace: 'normal' }, text: x.text }),
        el('div', { class: 'meta', style: { whiteSpace: 'normal' }, text: `证据 ${x.count || 1} 条 · 置信度 ${x.confidence || 'low'}${x.evidence ? ' · ' + truncate(x.evidence, 60) : ''}` })
      ]),
      el('button', { class: 'small danger', text: '删', onclick: async () => {
        profile[key].splice(i, 1);
        await saveProfile(profile);
        toast('已删除');
        ctx.rerender();
      }})
    ]))));
  }
  if (!any) profileBody.push(el('div', { class: 'empty', text: '还没有画像。先在生成页给几次反馈、手动改几次，再回来分析。' }));
  if (profile.uncertain) {
    profileBody.push(el('div', { class: 'hint warnish', style: { marginTop: '8px' }, text: '尚不确定：' + profile.uncertain }));
  }
  if ((profile.observations || []).length) {
    profileBody.push(el('h3', { class: 'sub', text: '只出现过一次的观察（不注入）' }));
    profileBody.push(el('div', { class: 'hint', text: (profile.observations || []).join('；') }));
  }

  root.appendChild(card('用户画像', profileBody, [
    el('button', { class: 'small', text: '看注入时长什么样', onclick: () => {
      const block = buildProfileBlock(profile, { max: state.settings.maxProfileItems });
      modal({
        title: '注入到 prompt 里的画像块', wide: true,
        body: el('pre', { class: 'out', text: block || '（当前没有足够证据的条目，不会注入任何画像）' }),
        confirmText: '关闭'
      });
    }}),
    genBtn
  ]));

  // ---------- 手动加一条 ----------
  root.appendChild(card('手动补一条画像', [
    el('div', { class: 'hint', text: '有些偏好你自己最清楚，不必等它从反馈里统计出来。手动加的条目置信度直接记为 high。' }),
    el('div', { class: 'row', style: { marginTop: '8px' } }, [
      el('button', { class: 'small', text: '+ 添加', onclick: async () => {
        const text = el('input', { type: 'text', placeholder: '例如：不要用"接住"这类词' });
        let group = 'dislikes';
        const sel = select(groups.map(([k, label]) => ({ value: k, label })), group, v => { group = v; });
        const ok = await modal({
          title: '添加画像条目',
          body: el('div', { class: 'col' }, [field('归类', sel), field('内容', text)]),
          onConfirm: () => text.value.trim() || null
        });
        if (!ok) return;
        const p = await getProfile();
        p[group] = (p[group] || []).concat([{ text: ok, evidence: '手动添加', count: 3, confidence: 'high' }]);
        await saveProfile(p);
        toast('已添加');
        ctx.rerender();
      }})
    ])
  ]));

  // ---------- 模型档案 ----------
  const profiles = await listModelProfiles();
  const mpBox = el('div', { class: 'col' });
  if (!profiles.length) {
    mpBox.appendChild(el('div', { class: 'empty', text: '还没有模型档案。生成时指定「目标模型」，跑过审查之后这里就会积累。' }));
  }
  for (const mp of profiles) {
    const issues = (mp.issues || []).slice(0, 10);
    const remedies = (mp.remedies || []).sort((a, b) => (b.worked || 0) - (a.worked || 0));
    mpBox.appendChild(el('div', { class: 'card', style: { background: 'var(--bg-2)' } }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: mp.modelKey }),
        el('span', { class: 'badge', text: `${mp.runs || 0} 次生成` }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'small', text: '+ 记一条对策', onclick: () => addRemedy(mp.modelKey, ctx) }),
        el('button', { class: 'small danger', text: '清空', onclick: async () => {
          if (!await confirmBox('清空档案', `把 ${mp.modelKey} 的历史问题和对策全部删掉？`)) return;
          await del('modelProfiles', mp.modelKey);
          toast('已清空');
          ctx.rerender();
        }})
      ]),
      issues.length ? el('div', {}, [
        el('h3', { class: 'sub', text: '它反复栽在这些地方' }),
        el('div', { class: 'list' }, issues.map(i => {
          const rule = i.ruleId === 'OVERFIT' ? { name: '约束过密、发挥受限' } : RULE_BY_ID[i.ruleId];
          const rate = mp.runs ? Math.round((i.count / mp.runs) * 100) : 0;
          return el('div', { class: 'item' }, [
            el('div', { class: 'grow' }, [
              el('div', { class: 'title', text: `${i.ruleId} ${rule ? rule.name : ''}` }),
              el('div', { class: 'meta', text: `${i.count} 次（不通过 ${i.fails || 0} 次）· 占 ${rate}% 的生成${i.samples?.[0] ? ' · ' + i.samples[0] : ''}` })
            ]),
            el('span', { class: 'badge ' + (rate >= 50 ? 'bad' : rate >= 25 ? 'warn' : ''), text: rate + '%' })
          ]);
        }))
      ]) : el('div', { class: 'hint', text: '暂无问题记录' }),
      remedies.length ? el('div', {}, [
        el('h3', { class: 'sub', text: '对策与有效率' }),
        el('div', { class: 'list' }, remedies.map(r => {
          const rate = r.tried ? Math.round((r.worked / r.tried) * 100) : 0;
          return el('div', { class: 'item' }, [
            el('div', { class: 'grow' }, [
              el('div', { class: 'title', style: { whiteSpace: 'normal' }, text: r.text }),
              el('div', { class: 'meta', text: `用过 ${r.tried} 次 · 有效 ${r.worked} · 无效 ${r.failed || 0}${r.lastUsed ? ' · ' + fmtTime(r.lastUsed) : ''}` })
            ]),
            el('span', { class: 'badge ' + (rate >= 60 ? 'ok' : rate >= 30 ? 'warn' : 'bad'), text: rate + '%' })
          ]);
        }))
      ]) : null
    ]));
  }

  root.appendChild(card('模型档案', [
    el('div', { class: 'hint', text: '按「目标模型」累积。生成时会把高频问题和有效对策作为倾向性提示注入 —— 是先验，不是硬约束，和当前需求冲突时以需求为准。' }),
    el('div', { style: { height: '8px' } }),
    mpBox
  ]));

  // ---------- 反馈流水 ----------
  if (feedbacks.length) {
    root.appendChild(card('反馈记录', [
      el('div', { class: 'list' }, feedbacks.slice(0, 20).map(f => el('div', { class: 'item' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'title', style: { whiteSpace: 'normal' }, text: truncate(f.userSay, 90) }),
          el('div', { class: 'meta', style: { whiteSpace: 'normal' }, text: `${fmtTime(f.createdAt)} · ${f.modelKey || '未指定模型'}${f.rootCause ? ' · 根因：' + truncate(f.rootCause, 50) : ''}` })
        ]),
        el('span', { class: 'badge ' + (f.worked === true ? 'ok' : f.worked === false ? 'bad' : ''), text: f.worked === true ? '对策有效' : f.worked === false ? '对策无效' : '未标记' })
      ])))
    ]));
  }
}

async function addRemedy(modelKey, ctx) {
  const text = el('input', { type: 'text', placeholder: '例如：把"避免X"改写成"当遇到X时改做Y"' });
  const worked = el('input', { type: 'checkbox' });
  worked.checked = true;
  const ok = await modal({
    title: '记一条对策 · ' + modelKey,
    body: el('div', { class: 'col' }, [
      el('div', { class: 'hint', text: '把你自己摸索出来、对这个模型管用的写法记下来，以后生成时会优先复用。' }),
      text,
      el('label', { class: 'row tight' }, [worked, el('span', { class: 'hint', text: '这招有效' })])
    ]),
    onConfirm: () => text.value.trim() || null
  });
  if (!ok) return;
  const { recordRemedy } = __M['memory'];
  await recordRemedy(modelKey, { text: ok, worked: worked.checked });
  toast('已记录');
  ctx.rerender();
}

return { render };
})();

__M['views/settings'] = (function () {
'use strict';
// 设置：API 预设、主/副/测试模型指派、禁词表、开关。
// 整库备份不在这儿 —— 那是存储的事，在 library.html。

const { el, toast, confirmBox, uid, modal } = __M['util'];
const { card, field, select, presetSelect, pickModel } = __M['views/common'];
const { PROVIDERS, DEFAULT_BASE, normBase, testPreset } = __M['api'];
// 整库备份挪去了 library.html —— 那是存储的事
const { put, del, saveSettings } = __M['db'];
const { AI_CLICHES } = __M['lexicon'];
async function render(root, ctx) {
  const { state, refresh } = ctx;
  const presets = state.presets;
  const s = state.settings;
  root.innerHTML = '';

  // ---------- API 预设 ----------
  const listBox = el('div', { class: 'list' });
  if (!presets.length) listBox.appendChild(el('div', { class: 'empty', text: '还没有预设。先加一个，填好地址和密钥再拉模型列表。' }));

  for (const p of presets) {
    const role = [
      s.mainPresetId === p.id ? '主' : '',
      s.auxPresetId === p.id ? '副' : '',
      s.testPresetId === p.id ? '测试' : ''
    ].filter(Boolean).join('/');
    listBox.appendChild(el('div', { class: 'item' }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'title', text: (p.name || '未命名') + (role ? `  [${role}]` : '') }),
        el('div', { class: 'meta', text: `${PROVIDERS[p.provider]?.label || p.provider} · ${p.model || '未选模型'} · ${normBase(p.baseUrl, p.provider)}${p.apiKey ? '' : ' · 未填密钥'}` })
      ]),
      el('button', { class: 'small', text: '测试', onclick: async (e) => {
        const btn = e.target; btn.disabled = true; btn.textContent = '测试中';
        try {
          const r = await testPreset(p);
          toast(`连通，${r.ms}ms，返回「${r.sample}」`);
        } catch (err) { toast('失败：' + err.message, true); }
        btn.disabled = false; btn.textContent = '测试';
      }}),
      el('button', { class: 'small', text: '编辑', onclick: () => editPreset(p, refresh) }),
      el('button', { class: 'small danger', text: '删除', onclick: async () => {
        if (!await confirmBox('删除预设', `确定删除「${p.name}」？`)) return;
        await del('apiPresets', p.id);
        const patch = {};
        if (s.mainPresetId === p.id) patch.mainPresetId = '';
        if (s.auxPresetId === p.id) patch.auxPresetId = '';
        if (s.testPresetId === p.id) patch.testPresetId = '';
        if (Object.keys(patch).length) await saveSettings(patch);
        refresh();
      }})
    ]));
  }

  root.appendChild(card('API 预设', [
    el('div', { class: 'hint', text: '密钥保存在本机浏览器的 IndexedDB 里，不会发到除你填的地址以外的任何地方。共用设备的话，可以在编辑里关掉"保存密钥"，每次会话重填。' }),
    el('div', { style: { height: '8px' } }),
    listBox
  ], el('button', { class: 'primary small', text: '+ 新建预设', onclick: () => editPreset(null, refresh) })));

  // ---------- 角色指派 ----------
  root.appendChild(card('模型分工', [
    el('div', { class: 'grid2' }, [
      field('主模型（写世界书）', presetSelect(presets, s.mainPresetId, v => saveSettings({ mainPresetId: v }).then(refresh)), '负责大纲、正文、示例、自检。挑最强的那个。'),
      field('副模型（画像 / 归因 / 审查）', presetSelect(presets, s.auxPresetId, v => saveSettings({ auxPresetId: v }).then(refresh)), '都是结构化小活，便宜快的模型就够。留空则用主模型。'),
      field('测试模型（试运行）', presetSelect(presets, s.testPresetId, v => saveSettings({ testPresetId: v }).then(refresh)), '世界书最终要注入给谁，就选谁。试运行和模型档案都按它算。')
    ])
  ]));

  // ---------- 审查与注入开关 ----------
  const toggle = (key, label, hint) => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = s[key] !== false;
    cb.addEventListener('change', () => saveSettings({ [key]: cb.checked }).then(refresh));
    return el('label', { class: 'row', style: { cursor: 'pointer', alignItems: 'flex-start' } }, [
      cb, el('div', {}, [el('div', { text: label }), el('div', { class: 'hint', text: hint })])
    ]);
  };
  const numField = (key, label, hint) => {
    const inp = el('input', { type: 'number', value: s[key], min: 0, max: 20 });
    inp.addEventListener('change', () => saveSettings({ [key]: Number(inp.value) || 0 }).then(refresh));
    return field(label, inp, hint);
  };

  root.appendChild(card('审查与注入', [
    el('div', { class: 'col' }, [
      toggle('auditWithLLM', '本地审查之外，再跑一遍模型审查', '本地静态检查永远会跑（它不花钱也不会错判行号）。模型审查负责"抓没抓住根因""是不是东拉西扯"这类代码判不了的。'),
      toggle('memoryEnabled', '注入模型档案', '把目标模型的历史问题和以前有效的对策作为倾向性提示带进去。'),
      toggle('profileEnabled', '注入用户画像', '把你的长期偏好作为软提示带进去。硬红线以外都可以让位于当前需求。'),
      toggle('useBuiltinBanwords', '启用内置八股词表', `内置 ${AI_CLICHES.length} 条。词表本身也会过拟合 —— 觉得管得太宽就关掉，只用自己那份。`)
    ]),
    el('div', { class: 'grid2', style: { marginTop: '10px' } }, [
      field('详细分析', select([
        { value: 'separate', label: '单独跑一次（最深）' },
        { value: 'inline', label: '挤在审查那次里（省钱）' },
        { value: 'off', label: '不写' }
      ], s.analysisMode || 'separate', v => saveSettings({ analysisMode: v }).then(refresh)),
        '评分只说"哪儿不行"，分析要说"注进去会怎样、为什么是这个分、先改哪条"。修订时这段会连同评分一起带给主模型。单独跑那次能引着评分和证据写，最深，代价是每版多一次副模型调用。'),
      el('div')
    ]),
    el('div', { class: 'grid2', style: { marginTop: '10px' } }, [
      numField('maxProfileItems', '画像注入上限（条）', '超过这个数就不再往 prompt 里塞。这是反过拟合的硬闸。'),
      numField('maxMemoryItems', '模型档案注入上限（条）', '同上。')
    ])
  ]));

  // ---------- 禁词表 ----------
  const banInput = el('textarea', { class: 'mono', rows: 5, value: (s.banwords || []).join('\n'), placeholder: '一行一个词。留空表示只用内置词表。' });
  root.appendChild(card('自定义禁词表', [
    el('div', { class: 'hint', text: '这些词在世界书正文里出现一次就判不通过，并且会写进 prompt 明确要求避开。它们不是"坏词"，是被用滥到没有信息量的默认反射。' }),
    banInput,
    el('div', { class: 'row', style: { marginTop: '8px' } }, [
      el('button', { class: 'primary small', text: '保存禁词表', onclick: async () => {
        const words = banInput.value.split('\n').map(x => x.trim()).filter(Boolean);
        await saveSettings({ banwords: Array.from(new Set(words)) });
        toast(`已保存 ${words.length} 个禁词`);
        refresh();
      }}),
      el('button', { class: 'small', text: '查看内置词表', onclick: () => {
        const hard = AI_CLICHES.filter(w => w.s === 'hard').map(w => w.t);
        const soft = AI_CLICHES.filter(w => w.s !== 'hard').map(w => w.t);
        modal({
          title: `内置词表（${AI_CLICHES.length} 条）`,
          body: el('div', {}, [
            el('div', { class: 'hint', text: '硬命中：出现即判不通过。' }),
            el('pre', { class: 'out short', text: hard.join('、') }),
            el('div', { class: 'hint', style: { marginTop: '8px' }, text: '可疑：看语境，只提示不判死。' }),
            el('pre', { class: 'out short', text: soft.join('、') })
          ]),
          confirmText: '知道了'
        });
      }})
    ])
  ]));

}

// ---------- 预设编辑 ----------

async function editPreset(preset, refresh) {
  const isNew = !preset;
  const p = Object.assign({
    id: uid('ap'), name: '', provider: 'openai', baseUrl: '', apiKey: '', model: '',
    params: { temperature: 0.8, topP: '', maxTokens: 8192 }, extraHeaders: '', saveKey: true
  }, preset || {});

  const modelBtn = el('button', { class: 'small', text: p.model || '拉取模型列表…' });
  const baseInput = el('input', { type: 'text', value: p.baseUrl, placeholder: DEFAULT_BASE[p.provider] });
  const keyInput = el('input', { type: 'password', value: p.apiKey, placeholder: 'sk-…' });
  const nameInput = el('input', { type: 'text', value: p.name, placeholder: '给这个预设起个名' });
  const tempInput = el('input', { type: 'number', value: p.params.temperature, step: '0.1', min: '0', max: '2' });
  const maxInput = el('input', { type: 'number', value: p.params.maxTokens, min: '256', step: '256' });
  const headersInput = el('textarea', { class: 'mono', rows: 2, value: p.extraHeaders || '', placeholder: '额外请求头，一行一个：X-Foo: bar' });
  const saveKeyCb = el('input', { type: 'checkbox' });
  saveKeyCb.checked = p.saveKey !== false;

  const providerSel = select(
    Object.entries(PROVIDERS).map(([k, v]) => ({ value: k, label: v.label })),
    p.provider,
    v => { p.provider = v; baseInput.placeholder = DEFAULT_BASE[v]; }
  );

  modelBtn.addEventListener('click', async () => {
    const draft = Object.assign({}, p, {
      provider: providerSel.value, baseUrl: baseInput.value.trim(), apiKey: keyInput.value.trim()
    });
    if (!draft.apiKey) { toast('先填密钥再拉列表', true); return; }
    await pickModel(draft, m => { p.model = m; modelBtn.textContent = m; });
  });

  const body = el('div', { class: 'col' }, [
    field('名称', nameInput),
    field('类型', providerSel, 'OpenAI 兼容涵盖绝大多数中转站。'),
    field('接口地址', baseInput, '填到根地址即可，会自动补 /v1。想完全按你填的来，末尾加一个 # 。'),
    field('密钥', keyInput),
    field('模型', el('div', { class: 'row' }, [modelBtn]), '点开是全量列表 + 快速搜索，也可以手填。'),
    el('div', { class: 'grid2' }, [
      field('temperature', tempInput),
      field('max tokens', maxInput, '世界书正文比较长，建议 8192 以上。')
    ]),
    field('额外请求头', headersInput),
    el('label', { class: 'row', style: { cursor: 'pointer' } }, [
      saveKeyCb, el('div', { class: 'hint', text: '保存密钥到本机（共用设备可以关掉，关掉后每次打开要重填）' })
    ])
  ]);

  const ok = await modal({
    title: isNew ? '新建 API 预设' : '编辑预设',
    body, confirmText: '保存',
    onConfirm: () => {
      if (!nameInput.value.trim()) { toast('起个名字吧', true); return null; }
      return true;
    }
  });
  if (!ok) return;

  p.name = nameInput.value.trim();
  p.provider = providerSel.value;
  p.baseUrl = baseInput.value.trim();
  p.saveKey = saveKeyCb.checked;
  p.apiKey = p.saveKey ? keyInput.value.trim() : '';
  p.params = {
    temperature: Number(tempInput.value) || 0.8,
    topP: p.params.topP,
    maxTokens: Number(maxInput.value) || 8192
  };
  p.extraHeaders = headersInput.value.trim();
  p.updatedAt = Date.now();
  if (!p.createdAt) p.createdAt = Date.now();
  await put('apiPresets', p);
  toast('已保存');
  refresh();
}

return { render };
})();

__M['views/help'] = (function () {
'use strict';
// 使用说明。单文件版没有配套文档，说明得跟着页面走。

const { el } = __M['util'];
const { card } = __M['views/common'];
const { RULES } = __M['rules'];
const { AI_CLICHES } = __M['lexicon'];
const { storageState } = __M['db'];
const P = (...kids) => el('div', { class: 'hint', style: { marginBottom: '8px', fontSize: '13px' } }, kids);
const B = t => el('b', { text: t, style: { color: 'var(--fg)' } });

async function render(root, ctx) {
  root.innerHTML = '';

  root.appendChild(card('这个工具在解决什么', [
    P('不是"帮我写一份世界书"，而是', B('"我提了要求，模型没照做，而我说不清它哪儿没照做"'), '。'),
    P('所以整条流程是围绕"可核对"搭的：生成分阶段（大纲 → 正文 → 示例 → 自检），',
      '产物同时接受两套检查 —— 一套是代码判定的静态检查（给行号），一套是另一个模型的定性审查。',
      '审查给完评分和逐条判定之后，副模型还会写一段详细分析：注进去之后模型大概会怎么表现、这些扣分项背后是不是同一个根因、只改一处的话改哪里。修订时这段连同评分一起带给主模型，所以它不是写给你看完就算的。',
      '这个页面只管写。存好的世界书在「世界书库」那一页：导入、导出、改名、批量打包、整库备份都在那边。',
      '最后把模型自己的自检结果和实测结果对账，', B('自称做到了、实测没做到的条目会被单独标红置顶'), '。')
  ]));

  root.appendChild(card('五步上手', [
    el('div', { class: 'list' }, [
      ['1', '去「设置」新建 API 预设', '填地址和密钥，点「拉取模型列表」—— 能拉到的全部都会列出来，带快速搜索；拉不动也可以手填模型名。'],
      ['2', '指派三个角色', '主模型写世界书；副模型干画像、归因、审查这类结构化小活（便宜的就行）；测试模型是这份世界书最终要注入的那一个。'],
      ['3', '在「生成」写下要解决的问题', '写症状就行，不用写成需求文档。第一阶段会先做根因判断，把同源的症状归成一族再动笔。'],
      ['4', '看审查报告', '先看顶上的「自评与实测不符」，再看八条规则里判了 warn/fail 的，点开有原文和行号。'],
      ['5', '不满意就照直说', '在「这一版哪里不好」里写，先分析根因再改。改完标一下「这次的对策有用吗」——模型档案里最值钱的就是这一列。']
    ].map(([n, t, d]) => el('div', { class: 'item', style: { alignItems: 'flex-start' } }, [
      el('span', { class: 'badge accent', text: n }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'title', style: { whiteSpace: 'normal' }, text: t }),
        el('div', { class: 'meta', style: { whiteSpace: 'normal' }, text: d })
      ])
    ])))
  ]));

  root.appendChild(card('八条规则，各自怎么判', [
    P('“本地”是代码判的，确定、可复现、给行号；“模型”是另一个模型判的，负责代码判不了的语义问题。'),
    el('div', { class: 'list' }, RULES.map(r => el('div', { class: 'item', style: { alignItems: 'flex-start' } }, [
      el('span', { class: 'badge', text: r.id }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'title', style: { whiteSpace: 'normal' }, text: r.name }),
        el('div', { class: 'meta', style: { whiteSpace: 'normal' }, text: r.why })
      ]),
      el('span', { class: 'badge ' + (r.judge === 'local' ? 'ok' : r.judge === 'llm' ? 'warn' : ''), 
                   text: r.judge === 'local' ? '本地' : r.judge === 'llm' ? '模型' : '本地+模型' })
    ])))
  ]));

  root.appendChild(card('几个容易被忽略的设计', [
    P(B('反过拟合是一等公民。'), '报告里除了综合分还有一个「约束紧度」。约束太密会把模型的发挥空间压没，回应就会变呆板 —— 那本身就是失败。',
      '画像和模型档案注入时有条数硬上限，措辞是"软提示，与需求冲突时以需求为准"，证据不足一条的根本不注入。'),
    P(B('易错示例给的是正确写法。'), '只用一行标注"易错点：容易被写成什么"，示例正文本身必须是对的 —— 错误示范会被模型当成可模仿的样本。'),
    P(B('导入区和自制区物理隔离。'), '导入的世界书不参与注入、不出现在系列选择里、批量导出默认跳过。要用里面的内容只有一条路：显式「复制为自制」，副本带来源标注。'),
    P(B('前置注入排在最顶部。'), '你自己写好的世界书片段优先级高于本工具的全部规约，冲突时以你的为准。'),
    P(B('试运行才是最终答案。'), '把世界书真的喂给测试模型，看它实际输出，再对输出查一遍禁词。"要求有没有生效"，只有这一步能回答。')
  ]));

  root.appendChild(card('注意事项', [
    P(B('CORS：'), '浏览器直连第三方中转站，需要对方允许跨域。撞墙的话把接口地址指向你自己的中转服务即可。Anthropic 原生接口已自动带上浏览器直连所需的请求头。'),
    P(B('密钥：'), '存在本机浏览器里，只会发往你自己填的那个地址。共用设备可以在预设里关掉「保存密钥」，改成每次重填。'),
    P(B('存储：'), '当前模式为 ',
      el('span', { class: 'badge ' + (storageState.mode === 'idb' ? 'ok' : 'warn'),
                   text: storageState.mode === 'idb' ? 'IndexedDB（正常）' : storageState.mode === 'local' ? 'localStorage（降级）' : '内存（不持久）' }),
      '。换设备或清缓存之前，记得在「设置」里导出一份备份。'),
    P(B('禁词表：'), `内置 ${AI_CLICHES.length} 条，其中一部分标为"可疑"只提示不判死。词表本身也会过拟合，觉得管得太宽就在设置里关掉内置表，只用自己那份。`),
    P(B('模型审查：'), '依赖对方返回合法 JSON。解析失败会提示并降级为只用本地检查 —— 本地检查永远会跑。'),
    P(B('详细分析：'), '默认在审查之后单独跑一次，因为它要引着评分和证据说话。想省钱就在设置里改成挤进审查那一次的 JSON 里，或者干脆关掉；关掉之后修订带给主模型的就只剩评分和逐条结论。')
  ]));
}

return { render };
})();

__M['app'] = (function () {
'use strict';
// 路由与全局状态。视图只管渲染，数据统一从这里加载后传下去。

const { $, $$, el } = __M['util'];
const { getSettings, listSorted, all, initStorage, storageState } = __M['db'];
const generateView = __M['views/generate'];
const versionsView = __M['views/versions'];
const insightsView = __M['views/insights'];
const settingsView = __M['views/settings'];
const helpView = __M['views/help'];
const { modelKeyOf } = __M['api'];
const VIEWS = {
  generate: generateView,
  versions: versionsView,
  insights: insightsView,
  settings: settingsView,
  help: helpView
};

const DRAFT_KEY = 'wbgen.draft';

const state = {
  route: 'generate',
  settings: null,
  presets: [], genPresets: [], projects: [], versions: [], books: [],
  draft: Object.assign({}, generateView.DEFAULT_DRAFT),
  currentProjectId: '', currentVersionId: '',
  running: false
};

// 草稿存 localStorage：刷新页面不该把输了一半的需求弄丢
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) Object.assign(state.draft, JSON.parse(raw));
  } catch (e) {}
}
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state.draft)); } catch (e) {}
}

async function reload() {
  state.settings = await getSettings();
  const [presets, genPresets, projects, versions, books] = await Promise.all([
    listSorted('apiPresets'), listSorted('genPresets'), listSorted('projects'),
    all('versions'), listSorted('books')
  ]);
  state.presets = presets;
  state.genPresets = genPresets;
  state.projects = projects;
  state.versions = versions.sort((a, b) => b.createdAt - a.createdAt);
  state.books = books;
}

function paintChrome() {
  $$('.nav-item[data-route]').forEach(a => {
    a.classList.toggle('active', a.dataset.route === state.route);
  });
  const badge = $('#presetBadge');
  const main = state.presets.find(p => p.id === state.settings?.mainPresetId);
  if (main) {
    badge.className = 'badge ok';
    badge.textContent = main.model || main.name;
    badge.title = `主模型：${modelKeyOf(main)}`;
  } else {
    badge.className = 'badge warn';
    badge.textContent = '未配置模型';
    badge.title = '到设置里加一个 API 预设';
  }
}

const ctx = {
  state,
  reload,
  rerender: () => rerender(),
  // 视图改完数据调它：重新load一遍再重绘。reload 只取数不重绘，两个都要有。
  refresh: async () => { await reload(); await rerender(); },
  navigate: (route) => {
    state.route = route;
    location.hash = route;
    closeNav();
    rerender();
  }
};

let rendering = false;
async function rerender() {
  if (rendering) return;
  rendering = true;
  const view = VIEWS[state.route] || VIEWS.generate;
  const root = $('#view');
  try {
    paintChrome();
    await view.render(root, ctx);
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
  saveDraft();
}

// 存储降级了要说一声：内存模式下不导出备份，关掉页面就白干
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

function closeNav() {
  $('#nav').classList.remove('open');
  $('#navScrim').classList.remove('show');
}

async function boot() {
  loadDraft();
  const mode = await initStorage();
  if (mode !== 'idb') showStorageWarning();
  await reload();

  $$('.nav-item[data-route]').forEach(a => {
    a.addEventListener('click', () => ctx.navigate(a.dataset.route));
  });
  $('#navToggle').addEventListener('click', () => {
    $('#nav').classList.toggle('open');
    $('#navScrim').classList.toggle('show');
  });
  $('#navScrim').addEventListener('click', closeNav);

  window.addEventListener('hashchange', () => {
    const r = location.hash.replace('#', '');
    if (VIEWS[r] && r !== state.route) { state.route = r; rerender(); }
  });
  // 生成跑到一半刷新/关页面，跑的那次就没了 —— 先问一声
  window.addEventListener('beforeunload', (e) => {
    saveDraft();
    if (state.running) { e.preventDefault(); e.returnValue = ''; }
  });
  setInterval(saveDraft, 5000);

  const initial = location.hash.replace('#', '');
  if (VIEWS[initial]) state.route = initial;

  // 没有任何预设时直接落到设置页，省得用户在生成页面前干瞪眼
  if (!state.presets.length && !initial) state.route = 'settings';

  await rerender();
}

boot().catch(e => {
  document.getElementById('view').innerHTML =
    `<div class="card"><h2 class="sec">启动失败</h2><pre class="out">${String(e && e.stack || e)}</pre></div>`;
});

return { state };
})();
