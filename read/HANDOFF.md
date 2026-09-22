# 喵喵书阁(meow-reader.html)项目交接文档

## 这是什么

一个纯前端、单文件 HTML 的"伪阅读器"应用,用来存放 AIRP(AI角色扮演)过程中 user 和 char 之间产生的番外剧情、长篇小说,并附带一些配套工具(搜索、文件解析导入、语音朗读、AI总结前文)。

- **无后端**,所有数据存在浏览器的 **IndexedDB** 里(数据库名 `meowReaderDB`,DB_VERSION = 2,详见下面的数据结构)
- **无构建流程**,纯 vanilla JS + 原生 HTML/CSS,一个 `.html` 文件打开就能用
- 引用了三个 CDN 库(写死在 `<head>` 里):
  - `JSZip 3.10.1` — 解压/生成 zip
  - `mammoth 1.6.0`(browser 版)— 解析 docx 提取文本
  - `pako 2.1.0` — 解压 gzip(给 tar.gz 用)
- 当前文件体积约 244KB,全部逻辑都在一个 `<script>` 标签里

仓库里的文件是 `index.html`(通过 GitHub Pages 直接访问)。

---

## 需求完成情况

### 最初的需求(V0)

| 需求 | 状态 |
|---|---|
| 简约风格 / 四个Tab / 明暗主题 + 自定义CSS | ✅ |
| 多个 char 和多个 user、角色可跨故事复用 | ✅ |
| 番外 = 要求 → 标题 → 正文;长篇 = 背景 + 章节 | ✅ 现在统一为 Story + Episode(type 区分) |
| 正文里嵌 HTML/CSS 要能显示和点击 | ✅ sandboxed iframe |
| 搜索:关键字 / 章节名 / 角色名 / 番外 + 分类筛选 | ✅ |
| 工具:txt/docx/zip/tar/tar.gz 解析,递归解到最深层 | ✅ |
| 素材库独立分类、分文件夹、多选批量复制/导出、手写新建 | ✅ |
| 每本书自定义背景 / 翻页 / 注入CSS / 字体URL | ✅ |
| 一键复制(背景+前文)方便续写 | ✅ 可用前情提要代替前文 |
| 整体设置可导出导入 | ✅ |
| 全站不用 emoji,改用 SVG 图标 | ✅ |
| 工具:RAR 解压 | ❌ 纯前端无可靠方案,已确认放弃 |

### 规格 V1

| 章节 | 需求 | 状态 |
|---|---|---|
| 二 | 角色 / 指令 / 故事 / 篇章 四层关系,两种查看方式 | ✅ |
| 三、四 | HTML夹独立分类,**完全隔离**(禁止拼进同一 DOM) | ✅ |
| 五 | 普通文字独立阅读器 | ✅ |
| 六 | 滚动 / 翻页严格限制在正文区 | ✅ |
| 七 | 沉浸式真全屏,不靠漏出的箭头展开 | ✅ |
| 八 | 背景上调正文位置 / 大小,阅读辅助线 | ✅ 横线 / 虚线 / 方格 |
| 九 | TTS 多 API 预设,拉取真实**版本模型**列表 | ✅ 拉取 / 重拉 / 选择 / 测试 / 设为默认;模型与音色分开 |
| 十 | 手动选择朗读内容(长按),暂停 / 继续 / 停止 | ✅ |
| 十一 | 规则识别旁白 / 角色对白 | ✅ |
| 十二 | 角色声音绑定,与故事解耦 | ✅ |
| 十三 | 旁白三模式:TTS / 系统语音 / 不朗读 | ✅ |
| 十四、十五 | AI 文本标注 + 独立 API + Prompt 可编辑 + **降级** | ✅ |
| 十六、十七 | (规格中缺失) | — |
| 十八~二十 | 核心对象结构与架构原则 | ✅ 见下 |
| 一、二十.6 | 音乐播放 / 网易云 Provider | ❌ 规格无正文,已确认不做 |

## 数据结构

数据库 `meowReaderDB`,**DB_VERSION = 2**。store:`characters` `instructions` `stories` `htmlDocs(未用,HTML走stories)` `materials` `presets` `voiceBindings` `settings`,外加 v1 遗留的 `books`。

### 四层关系(整个系统最重要的部分)

"指令"不是故事,也不是角色之间的关系,而是**多个角色共用的一个归类维度**。同一个《雨天见面》可以被角色A/B/C/D 各跑一遍,产出的四个故事**彼此完全独立、内容互不相干**:

```
Instruction(共同的指令 / 主题 / 系列)
     ├── Story ──> Character A     ← 各自独立
     ├── Story ──> Character B
     ├── Story ──> Character C
     └── Story ──> Character D
```

- 一个 Instruction 对应很多 Story;一个 Character 拥有很多 Story
- 一个 Story 对应一个具体角色,Story 之间彼此独立
- 四者**只靠 id 关联**,谁也不持有对方的副本

### `characters`
```js
{ id, name, roleDefault:'char'|'user', avatar, note, createdAt }
```

### `instructions`
```js
{ id, title, prompt, note, tags:[], source, createdAt, updatedAt }
```
`source` 只有从番外生成器收来的指令才有(`{app:'fanwai', storyId, version, sentAt}`),
手写的指令没有这个字段,渲染时不要假设它存在。这类指令的 id 是生成器给的
`fw-<番外id>`,不是 `uid()`。

### `stories`
```js
{
  id, kind:'text'|'html',
  title, cover, tags:[], category,
  characterId,        // 这是谁的故事
  instructionId,      // 归在哪个指令下(可空 = 未归类)
  participants: [{ characterId, name, avatar, role }],   // 故事里出现的其他角色
  background,
  episodes: [{ id, title, type:'chapter'|'extra', prompt, content, order, createdAt }],
  summary: { text, updatedAt, forChapterId } | null,
  progress: { episodeId, ratio, page?, total? } | null,
  readerSettings: { ... 见下 },
  legacyBookId,       // 迁移过来的才有
  createdAt, updatedAt
}
```

**篇章类型下放到 episode**:规格 2.4 里同一个故事本来就可能同时有正篇、章节和番外,原来"整本书要么是番外集要么是长篇"的二分法表达不了。所以 `type` 在 episode 上,故事级别不再有 extra/novel 之分。

### `readerSettings`
```js
{
  background, pageEffect, showPageNav, customCss, fontUrl,
  textOffsetX, textOffsetY, fontScale,          // 背景上的正文位置与字号
  textWidth,                                    // 正文块宽度百分比,100=满宽
  textHeight,                                   // 正文块高度百分比(vh),100=不限高;**只在翻页模式生效**
  textColor,                                    // 正文颜色,''=跟随主题
  ruleStyle:'none'|'solid'|'dashed'|'grid', ruleGap, ruleOffset,   // 阅读辅助线
  voicePresetId,                                 // 默认语音(没单独绑定的角色用它)
  narrationMode:'tts'|'system'|'off', narrationPresetId, systemVoiceURI, systemRate,
  annotatePresetId,                              // AI标注,可空
  summaryPresetId
}
```

### `voiceBindings`(角色声音,独立于故事)
```js
{ id, characterId, presetId, voiceId, updatedAt }
```
挂在**角色**上而不是故事上,所以同一个角色在任何故事里都用同一个声音。

### `presets`(三种,用 kind 区分)
```js
{ id, kind:'voice',    name, provider, characterId, endpoint, apiKey,
  model,          // 版本模型:speech-02-hd / tts-1-hd / eleven_multilingual_v2
  voiceId,        // 音色:female-yujie / nova / <ElevenLabs voice_id> —— 和 model 是两回事
  extraParams, promptInjection, bodyTemplate, headersTemplate, audioPath, chunkSize, createdAt }
{ id, kind:'summary',  name, provider, endpoint, apiKey, model, promptTemplate, createdAt }
{ id, kind:'appearance', name, data:{ 见 APPEARANCE_KEYS }, createdAt }   // 外观预设
{ id, kind:'annotate', name, provider, endpoint, apiKey, model, promptTemplate, createdAt }
```

### `settings`
```js
{ id:key, value }   // 目前只有 migratedToV2
```

---

## v1 → v2 迁移

`migrateBooksToStories()` 在 init 最开头跑,**在任何代码读 stories 之前**。

- 一本 book → 一个 story,`legacyBookId` 记来源
- `type:'extra'` 的 episodes → `type:'extra'` 并保留 prompt
- `type:'novel'` 的 chapters → `type:'chapter'` 并保留 background
- `characterId` 从 participants 里第一个 role==='char' 的推出来
- tags / 分类 / customCss / 翻页样式全部无损带过来

**旧的 `books` store 迁移后原样保留,永远不要删**——它是唯一的回滚依据。迁移只跑一次(`settings.migratedToV2`),重复加载不会重复建。导入 v1 备份(只有 books)时会把标记重置再跑一次迁移,否则旧备份导进来会变成看不见的数据。

## 与番外生成器的交接(收件箱)

番外生成器(`fanwai` 仓库)负责把脑洞和标签编译成 Prompt,喵喵书阁负责存正文。
两边的接口就是 **instruction**:生成器产出的一条 Prompt = 这边的一个指令,
正文写好之后按现有流程建故事、在向导里选这个指令即可。

**同源直通**(两个应用都在 `yu7705423-cell.github.io` 下,分别是 `/fanwai/` 和 `/read/`):

1. 生成器把条目写进 `localStorage['mmr_inbox_fanwai']`,格式
   `{type:'fanwai-to-meow', v:1, sentAt, items:[...]}`,然后跳到 `/read/#inbox`
2. 这边 `initFanwaiInbox()`(init 最后一步)读收件箱 → `importFanwaiItems()` 入库 →
   清空收件箱 → 切到「按指令」视图 → toast
3. 书阁标签页本来就开着的话,靠 `storage` 事件当场收,不用刷新

**要点**

- **id 是稳定的** `fw-<番外id>`:同一条番外改完再送是**更新**那条指令,不是新增。
  `createdAt` 保留第一次收到的时间,`title/prompt/tags/note` 覆盖。
- **收重了也没事**:新开的标签页和已经开着的标签页可能同时收,`fanwaiDraining`
  挡一层,真的撞上了也只是对同一个 id 覆盖两次。
- **收件箱内容坏了直接丢掉**,不要让启动流程每次都在这里炸。
- **不同源就走文件**(各自本地打开、或换了域名):生成器那边自动改成导出
  `fanwai-to-meow-*.json`,从「设置 → 数据备份 → 导入」进来,走的是同一个
  `importFanwaiItems()`。
- **这类文件绝对不能走 `importAllData()`**:它里面有「没有 stories 就重置
  `migratedToV2` 并重跑迁移」的逻辑,交接文件正好没有 stories,会把旧 books
  再迁一遍。所以导入处先判 `data.type === 'fanwai-to-meow'` 再分流。
- 收进来的指令跟手写的指令没有任何区别,导出备份时一起带走。

## 各模块实现要点

### 阅读器(第3块)
- 全屏 `.reader-overlay`,正文用 **sandboxed iframe**(`sandbox="allow-scripts"`)渲染,通过 `srcdoc` 注入生成的 HTML 文档,这样自定义CSS/字体/嵌入HTML都不会污染外层App样式,也能保证番外里嵌的HTML小组件正常显示和交互。
- 内容渲染逻辑(`renderContentHtml`):按空行分段落包成 `<p>`,但如果某一段本身以 `<` 开头(判断是完整HTML块),原样保留不做转义包裹——这样"大段文字里插一个小HTML卡片"和"整条内容就是一段HTML"两种情况都能正常显示。
- **工具栏可折叠**:顶部工具栏默认展开,点击顶栏的收起箭头、或点击正文空白处(iframe内部通过 `postMessage` 把点击事件传回父页面,排除了链接/按钮等交互元素的点击)都会让工具栏滑走,只留一个小箭头挂件在顶部中间,点一下再唤出来。翻页模式下的页码导航条同理跟随折叠。
- **一键复制**:番外可选是否带上"番外要求";长篇默认是"背景+从第一章到当前章"的正文,也可选是否带背景。用 `navigator.clipboard.writeText`,失败时降级用隐藏 textarea + `execCommand('copy')`。

### 关于 `<script>` 标签转义的坑(重要,继续改代码时必须注意)
`buildReaderDoc()` 函数会拼一段**字符串**作为 iframe 的 `srcdoc`,这段字符串里必然要包含 `<script>...</script>`。但因为这整个函数本身是写在外层 `.html` 文件的 `<script>` 标签**内部**的 JS 源码,如果字符串字面量里直接出现 `</script>`(哪怕只是JS字符串里的普通字符),**浏览器的HTML解析器会在扫描到这个字符序列时提前结束外层的 `<script>` 标签**,导致整个应用崩掉。

解决方法:在源码里凡是要拼出 `</script>` 的地方,必须写成 `<\/script>`(反斜杠转义),JS 求值后会变成正常的 `</script>` 字符串,但 HTML 解析阶段看到的是 `<`, `\`, `/` 这样不连续的字符,不会被误判为闭合标签。**以后改这部分代码,新增任何内嵌 `<script>` 都要用这个写法**,可以用这两条命令自查:
```bash
grep -c "</script>" meow-reader.html      # 应该恰好是 1(外层真正的闭合标签)
grep -c "<\\\\/script>" meow-reader.html   # 应该等于文件里内嵌script的数量
```

### 翻页模式(已修复,实测通过)

最早用的是 CSS `column-width` + `column-fill:auto` 让浏览器"高度不够时自动往右边生成新分栏"的特性做分页,这个特性表现不稳定,反复出现"只有第一页有内容,后面全空白"。现在改成 JS 精确测量,并修掉了三个真实存在的问题:

1. **上下留白的位置错了**。原本正文的 `padding:30px 22px 40px` 写在 `.inner` 上。多栏布局在**块方向**(上下)分片时,`padding-top` 只会给第一个分片、`padding-bottom` 只会给最后一个分片,所以从第2页起正文直接贴着屏幕顶端。现在上下 padding 挪到多栏容器 `#pages` 上(容器的 padding 会让每一栏都缩进),左右 padding 留在 `.inner`(**行内方向**的 padding 每个分片都会重复,本来就是对的)。
2. **留白高度不够,正文被工具栏和页码条盖住**。iframe 是铺满整个阅读页的,工具栏和底部页码条浮在它上面。现在由父页面用 `topbar.offsetHeight` / `pagenav.offsetHeight` 实测真实高度(已含 `env(safe-area-inset-*)`)传给 `buildReaderDoc(entry, book, insets)`,正文按这个高度留白。
3. **页数会算少,最后一段被裁掉**。`Math.ceil(总高度 / 屏幕高度)` 只是下限——行不能跨栏断开,实际需要的页数永远 ≥ 这个估算值。现在先用它当起点,套上多栏后实测 `.inner` 所有子元素的**最右边界**反推真实页数(放不下的内容会溢出到 declared width 之外的 "overflow columns",所以量得到),不一致就调整页数重来,最多迭代 6 轮。

另外补了 `document.fonts.ready` 之后重新测量,避免网络字体加载完成后分页错位。

代码位置:`buildReaderDoc()` 里 `isPaginate` 分支,以及生成的 iframe 内嵌 `<script>` 里的 `layout()` / `pagesUsed()` / `goTo()`。

### 翻页样式(六种)

`PAGE_EFFECTS` 数组定义,`isPaginatedEffect()` 判断是否属于"分页"类:

| id | 名称 | 做法 |
|---|---|---|
| `scroll` | 竖屏滑动 | 不分页,正常滚动 |
| `paginate` | 左右平移 | translateX 整条内容,唯一支持实时跟手拖动的样式 |
| `fade` | 淡入淡出 | 淡出 → 无动画跳到新页 → 淡入 |
| `vertical` | 上下翻页 | 纵向滑出屏幕 → 跳页 → 从另一侧纵向滑入 |
| `flip` | 立体翻转 | body 上加 perspective,rotateY 转到 ±88° 再转回来 |
| `instant` | 无动画 | 直接跳 |

**为什么没有"覆盖""仿真书页卷曲"**:这类效果要求同屏出现两页(新页压在旧页上),而当前只有一份正文 DOM。要做就得把正文复制一份到第二层,但 `innerHTML` 复制出来的副本里,正文中嵌入的 HTML 小组件会失去交互(脚本不会重新执行,事件监听也不会跟着走)——而"番外里嵌的 HTML 要能正常显示和点击"是这个项目的核心需求之一,不能为了动画牺牲。所以六种样式全部是对同一条内容做变换。

翻页动画进行中会置 `animating = true` 并忽略新的翻页请求,否则连点会让 `pageIndex` 和实际位移对不上。

### 翻页操作方式

- 左右滑动手势:`paginate` 样式下实时跟手(`DRAG_FOLLOWS`),首尾有阻尼回弹,松手不到阈值滑回原位;其余样式没有把相邻页渲染出来,跟不了手,所以按阈值触发。
- 鼠标拖拽(桌面端)走同一套 `dragStart/dragMove/dragEnd`。
- 点击屏幕左侧 30% / 右侧 30% 翻页,中间 40% 收起/展开工具栏。
- 键盘 ←/→ / PageUp / PageDown / 空格 / Home / End。
- 底部页码条可以在阅读设置里关掉(`readerSettings.showPageNav`)。关掉之后正文的底部留白会跟着缩回去(父页面传给 `buildReaderDoc` 的 `insets.bottom` 改成只留安全区),不会白空一条。

### 自定义 CSS 的类名

阅读页生成的每个元素都带 `mm-` 前缀的类名,方便用户写 CSS:

| 选择器 | 是什么 |
|---|---|
| `.mm-body` | 阅读页正文文档的 body |
| `.mm-page` | 翻页容器(分页时每一"页"就是它的一栏) |
| `.mm-content` | 正文内容区,左右留白在这上面 |
| `.mm-prompt` | 番外顶部的"番外要求"卡片 |
| `.mm-p` | 每一个正文段落 |
| `.mm-html` | 正文里嵌入的 HTML 块的外层容器 |

`CSS_HELP` 里维护了两份速查表(`reader` / `app`),`cssHelpPanel(scope)` 生成可展开面板,`bindCssHelp()` 绑定"点示例追加进输入框"。**以后改了类名或加了新的可定制元素,记得同步更新 `CSS_HELP`**,否则速查表会骗人。

### 浮层层级(已修复)

原来 `.modal-overlay` 是 90、`.reader-overlay` 是 70。这是为了让"从阅读页里打开的更多菜单/阅读设置/复制弹窗"能盖住阅读页,但代价是**从书籍详情进入阅读页之后,详情弹窗仍然盖在阅读页上面**——下半屏被挡住、翻页按钮完全点不到。

现在两种浮层共用一个动态层级:`nextOverlayZ()` 取当前所有浮层里最高的 z-index 再 +5,谁后开谁在上。于是阅读页盖住详情弹窗,阅读页里再开的弹窗又盖住阅读页,两个需求同时满足。toast 提到 9999 保证永远在最上层。

**以后新增任何全屏浮层,记得用 `nextOverlayZ()` 而不是在 CSS 里写死 z-index。**

## 第7、8块(已完成)

### 第7块:语音朗读

阅读页"更多"菜单 → **朗读正文**。取 `book.readerSettings.voicePresetId` 对应的预设(在"阅读设置"里选,没选会提示),把正文转成纯文本后按预设的 `chunkSize` 在段落/句子边界切块,逐块合成、连续播放,底部有个悬浮播放条(播放/暂停/停止 + 第几段进度)。

因为每家语音接口的字段名都不一样,请求和响应都做成可配置的:

- **请求体模板** `bodyTemplate`:用户自己写 JSON,占位符 `{{text}}` `{{voice}}` `{{prompt}}` `{{apiKey}}`。占位符是**填进已序列化的 JSON 字符串里**的,所以替换前会先 `JSON.stringify(值).slice(1,-1)` 转义,否则正文里一个引号或换行就会把模板打碎(`fillJsonTemplate()`)。填完会先 `JSON.parse` 验一遍,不合法直接报错并把填好的模板给用户看。留空则用默认结构 `{text, voice_id, prompt}` + 额外参数。
- **请求头模板** `headersTemplate`:同样支持 `{{apiKey}}`。留空默认发 `Authorization: Bearer <key>`。
- **响应解析**:先看 `Content-Type`,是 `audio/*` 或 `octet-stream` 就直接 `URL.createObjectURL(blob)`(用完会 revoke);否则按 JSON 解析,优先用用户填的 `audioPath`(点号路径,支持数组下标),没填就用 `findAudioValue()` 浅层遍历找 key 像 audio/url/speech 的长字符串兜底。拿到的值是链接、`data:` URI 还是裸 base64 都能认(`toAudioSrc()`)。
- **解析不出来就把原始响应整段显示出来**(`showApiErrorModal()`),用户可以照着调预设。`fetch` 本身抛错会提示大概率是 CORS。

一个坑:**Safari 只允许在用户手势里调用过 `play()` 的 `<audio>` 元素之后再用脚本播放**,而第一次合成要等好几个 await。所以 `startReadAloud()` 一进来就同步 `new Audio()` 并调一次 `play()` 把它"解锁",真正的异步流程放在里面的 async IIFE 里。

### 模型(版本)和音色是两个东西

**这一点最初做错过,现在修好了,以后别再混。**

- **模型 / 版本** = `speech-01` / `speech-02-hd` / `tts-1-hd` / `eleven_multilingual_v2`,存在 `preset.model`
- **音色 / Voice ID** = `female-yujie` / `nova` / ElevenLabs 的 `voice_id`,存在 `preset.voiceId`

规格 9.2 明确说"TTS 不能写死一个固定模型",所以模型**不能**留在请求体模板里。请求体用 `{{model}}` 占位符引用 `preset.model`,换模型不需要改模板。占位符现在有五个:`{{model}}` `{{text}}` `{{voice}}` `{{prompt}}` `{{apiKey}}`,接口地址里也能用。

模型这条链完整支持规格要求的五个动作:

| 动作 | 实现 |
|---|---|
| 拉取模型 | `fetchTtsModelList()`,打接口实际的 `/models` |
| 重新拉取 | 同一个按钮再点一次 |
| 选择模型 | 下拉框选中写回文本框(文本框始终保留,私有模型能手填) |
| 测试模型 | `testTtsModel()` 用当前设置真的合成一句话并播放 |
| 设置默认模型 | 保存下来的 `preset.model` 就是这个预设的默认模型 |

`apiBaseFor()` 负责从各种形状的接口地址推出 `/models` 的位置:

| 接口地址 | 推出来的 models 地址 |
|---|---|
| `…/v1/audio/speech` | `…/v1/models` |
| `…/v1/text-to-speech/<id>` | `…/v1/models` |
| `…/v1/chat/completions` | `…/v1/models` |
| `…/v1/t2a_v2?GroupId=x` | `…/v1/models` |
| `…/deployments/x/chat/completions`(没有 /vN) | `…/deployments/x/models` |

没有 `/vN` 的自建网关走"整段剥掉已知操作后缀"这条分支——只简单地砍掉最后一段路径的话,`/chat/completions` 会变成 `/chat/models`。这个分支改过一次才对,动它记得回归上面这张表。

MiniMax 没有公开的模型列表接口,所以内置了一份常见版本的候选,并在界面上标明"服务更新后可能有新的,直接手填即可"——不要把它当成权威列表。

### 快捷配置与拉取列表

`TTS_PROVIDERS`(MiniMax / OpenAI 语音 / ElevenLabs / 硅基流动 / 自定义)和 `LLM_PROVIDERS`(OpenAI / DeepSeek / 硅基流动 / Kimi / OpenRouter / 自定义)是**模板**不是保证:点一下只会覆盖接口地址、请求头、请求体、响应字段这几个"传输"字段,用户已经填的名称/Key/音色不动,填完还能随便改。个别服务需要按账号补东西(MiniMax 要在地址里填自己的 GroupId),这一点写在了每个服务的 note 里。

- **接口地址也支持占位符**(`resolveEndpoint()`),因为 ElevenLabs 这类服务把音色 ID 拼在 URL 路径里。
- **MiniMax 返回的是十六进制音频**,不是 base64。`toAudioSrc()` 会判断:全 `[0-9a-f]`、偶数长度、超过 100 字符就当十六进制解码成 Blob(真实音频的 base64 几乎必然含有 hex 之外的字符,所以这个判断是安全的),否则才当 base64。
- **拉取音色列表** `fetchVoiceList()`:有固定音色的服务(MiniMax、OpenAI)直接用内置列表,不发请求;ElevenLabs 这类去 `voicesEndpoint` 拉。
- **拉取模型列表** `fetchModelList()`:OpenAI 兼容的服务都在 `/v1/chat/completions` 旁边有 `/v1/models`,`modelsUrlFor()` 从聊天地址推导出来。
- 两个列表都过 `normaliseList()`,能吃 `{voices:[{voice_id,name}]}`、`{data:[{id}]}`、`{a:{b:["x","y"]}}` 等形状;指定路径找不到就退化成"找第一个非空数组"。
- 拉到的列表填进一个 `<select>`,选中会写回上面的文本输入框——文本框始终保留,因为克隆音色、私有模型这些 ID 是列表里没有的。

### 第8块:AI总结前文

只对长篇生效,阅读页"更多"菜单 → **前文总结**。取 `summaryPresetId` 对应的预设,把 背景 + 第一章到当前章的正文 发过去,用 OpenAI Chat Completions 格式:

```js
{ model: preset.model, messages: [
    { role:'system', content: preset.promptTemplate || 默认总结指令 },
    { role:'user', content: 组装好的正文 }
]}
```

响应解析 `pickSummaryText()` 依次尝试 OpenAI(`choices[0].message.content`)、Anthropic(`content[]` 里的 text 块)、Gemini(`candidates[0].content.parts`)等常见格式,都不行就把原始响应展示出来。

结果存在 `book.summary = { text, updatedAt, forChapterId }`,弹窗里可以手动改、复制、删除,也可以完全不调接口自己手写。

**一键复制**里,长篇只要有提要就多一个开关「用前情提要代替前面章节的正文」,勾选后复制的是 背景 + 提要 + **本章正文**(本章保留原文,因为续写最需要紧邻的上下文),这样写到几十章也不会一次复制出几十万字。

## V1 规格新增的模块

### 三维导航

书架顶部切换 **按角色 / 按指令 / 全部故事 / HTML夹**。三种视图都只是同一份 story 列表的不同分组,没有哪个视图"拥有"数据:

- **按角色** → 进角色看它自己的全部故事,按指令分组
- **按指令** → 进指令看各个角色**各自独立**的故事,按角色分组

改归类只动 `characterId` / `instructionId` 两个字段,故事内容一个字都不会变。**删指令或删角色只解除关联,下面的故事全部保留**(确认框里会写清楚保留多少个)。

### HTML夹与隔离(硬性要求)

HTML 作品是 `story.kind === 'html'`,正文原样交给独立的 `sandbox="allow-scripts"` iframe——**不给** `allow-same-origin`,所以每个文档拿到各自的 opaque origin。切换作品时整个 iframe 重建而不是改 srcdoc,否则上一个文档的定时器和监听器会在拆除期间继续跑。

作者的 markup 原样透传,只在 `<head>` **最开头**注入一小段(viewport / base target / 极简 reset / 顶栏留白)。放最开头是有意的:作者后面写的任何规则都会覆盖它。注入用 `replace` 的**函数形式**而不是字符串形式——用户 CSS 里出现 `$&` 或 `$1` 时,字符串形式会把它当反向引用展开成乱码。

**验证方式**:用两个处处撞名的作品(同样的 `.content`、同样的 `#main`、同样的全局 `SHARED` / `window.hits`、同样的函数名)对比。以后改这块务必重跑这个验证。

### 滚动限制与沉浸模式

- 滚动链用 `overscroll-behavior` 断掉;任何浮层打开时给 body 上锁(**计数**,因为浮层会叠)
- 上锁前记住 `window.scrollY`,解锁后还原。`overflow:hidden` 会把滚动位置清零,不还原的话"进故事再退出来"会被扔回书架顶部
- 沉浸模式下顶栏、页码条、箭头**全部消失**。展开靠一个完全不可见的触发区(顶部居中,背景和文字都透明),点它或在它上面下滑;正文中间点击、Esc 键也可以
- 沉浸时**不重建 iframe**,而是 postMessage 把新的可用区域告诉文档,文档改自己的 padding 变量再跑一次 `layout()`。重建会让正文里嵌的 HTML 组件重新执行、阅读位置也会丢

### 阅读位置

滚动模式记 scrollY 比例,翻页模式记页码(页数变了就退回按比例折算)。写库有防抖,关阅读页时会补写没落盘的那次。**读书不算编辑,不动 `updatedAt`**,否则书架顺序会被读书行为搅乱。

### 导入书籍(txt / epub)

两个入口都能进:「添加 → 导入书籍」,以及**工具页的「选择文件导入」**。后者原来只收素材、`accept` 里没有 `.epub`,选文件时 epub 是灰的——功能其实做好了,但从最顺手的那个入口进去像是"不支持"。**加了功能要顺着人已有的路径去接**,不能只开一个新入口。

- 单独一个 epub:直接进书籍导入(素材那条路会把它的 xhtml 拆成一堆噪音,没意义)
- 单独一个 txt:先问"进书架"还是"存成素材"
- 多选、或其它格式:照旧当素材,不打断原来的流程

`openImportBookFlow(presetFile)` 可以接一个已经选好的文件,这时不再显示"选择文件"按钮,直接进预览。

- **epub 的顺序看 spine,标题看目录**(NCX 的 navPoint 或 nav 的 a)。只信目录会漏掉不在目录里的正文,只信 spine 又拿不到人写的章节名,两者各取所长
- href 是相对 OPF 的,要拼上 OPF 所在目录再解 url 编码,否则封面和正文都读不到
- 章节标题(h1/h2)会被正文提取重复一遍,所以首段若与标题相同就删掉,不然页面上标题出现两次
- **txt 一次只用一种章节正则**:三种模式(第N章 / Chapter N / 1、)按顺序试,第一个能切出 ≥3 章的胜出。混着用会把书切碎;少于 3 处命中当作正文里偶然提到,不切——「他说第一章很好看」不该把书劈成两半

### 字体链接

**字体链接有两种,不是一种**:一种是声明 @font-face 的**样式表**(Google Fonts 那类),另一种是**字体文件本身**(放在对象存储上的 .ttf/.otf/.woff2)。把字体文件塞进 `<link rel="stylesheet">` 什么也不会发生——浏览器拿二进制当 CSS 解析,然后就没有然后了,表现和"设置不生效"一模一样。所以按扩展名分流:是文件就自己生成 `@font-face`(family 用文件名推出来的可读名字,format 按扩展名给),是样式表才走 `<link>`。

**字体名不能从 URL 猜**。原来只认 Google Fonts 的 `?family=` 形式,任何别的链接(自托管 css、别家字体站)都解析成空字符串——样式表加载了,正文却没引用那个字体,表现就是"输了链接没变化"。

现在从 `document.fonts` 读真实的 @font-face 族名:跨域样式表的 `cssRules` 会抛 SecurityError,但 FontFaceSet 里的**名字仍然读得到**。URL 解析保留作为立即生效的首选(不用等文件到),拿到真名后覆盖。

`document.fonts.ready` **不能只等一次**——它可能在链接的样式表还没解析完时就 resolve,那一刻 `document.fonts` 是空的。所以配合 link 的 load 事件 + 有限次轮询。

**加载失败要说出来**。阅读文档是 `sandbox="allow-scripts"` 的 opaque origin,取字体时带 `Origin: null`,服务器不给 CORS 头就会被拒。Google 的 `fonts.gstatic.com` 回 `*` 所以没事,自托管的多半没配。这种情况下字体名有、文字没变,最容易让人以为是 App 坏了,所以文档会把 `{mmFontStatus:{family, ok}}` 报回父页面,调整台里明说原因。**不要为此加 `allow-same-origin`**——那等于让作品里的 HTML 能碰 App 的同源数据,拿安全换一个字体不值。

### 外观调整台(openAppearanceStudio)

阅读设置里的「打开外观调整」进去,位置、辅助线、背景、正文颜色、自定义CSS 全部对着实时预览调。

- **舞台就是一份真的阅读文档**:同样的 `buildReaderDoc`,同样的 sandbox iframe,按真实屏幕尺寸布局再 `transform:scale` 缩小。所以预览天然保真,vh/px 全部当真
- 舞台必须跑**故事真实的翻页模式**。曾经为图省事写死 `pageEffect:'scroll'`,结果高度滑杆怎么拖预览都不动——因为高度只在翻页模式下成立,预览把它悄悄忽略了。写死预览的任何一项,就是在骗自己
- **自定义CSS 必须走 iframe**。用户写的是 `.mm-p{}`、`body{}` 这种选择器,注进 App 自己的 DOM 会把界面本身改掉。文档里留了一个 `<style id="mmUserCss">`,父页面用 `{mmCustomCss}` 消息改它的 textContent,规则永远出不了那份文档
- 滑杆改动走 postMessage(`mmTypography` / `mmBackground` / `mmCustomCss`),**不重建 iframe**,否则每拖一下都闪一次
- iframe 会吞掉指针事件,所以拖动正文是在它上面盖一层透明的 `.bga-grab` 上做的

**外观预设**存在 `presets` store 里(`kind:'appearance'`),内容就是 `APPEARANCE_KEYS` 那一组字段——背景、颜色、位置尺寸、辅助线、CSS、字体、翻页。**语音和 AI 的设置不属于外观,不进预设**,否则换个皮肤会把角色声音一起换掉。应用预设时所有控件和预览一起重画,不能只改数据不改界面。

### 正文位置 / 宽度 / 高度 / 字号 / 颜色 / 辅助线

- 位置用 **padding 不是 transform**:transform 会把文字挪出分页测量过的盒子,页数就算错了
- **宽度和位置是分开的两件事**。先用 `--mm-width`(无单位小数)定死正文块宽度,再让偏移在剩下的空间里滑动它。实现上**只 clamp 左边距,右边距由「总宽 - 块宽 - 左边距」推出来**——两边各自 clamp 的话,偏移大了会把块**挤窄**而不是**移过去**(宽度 30% 右移 220 会被压成 26px)
- 滑杆范围:上下 -200~800、左右 ±400、宽度 15%~100%、字号 25%~400%。放这么开是因为背景图的空白有时只有一小块,得能把正文缩小塞进角落
- **高度上限只加在翻页分支里**。滚动是一直往下流的,溢出没有去处,同样的 padding 加上去只会在正文下面堆出一片死空白(实测多出 474px),却一点也框不住。所以竖屏滑动下高度不生效,UI 直接说明并给一个改成翻页的按钮,而不是让滑杆假装能用
- **往上挪有个物理天花板**:padding 不能为负,`padding-top` 撞到 0 就是贴顶了,滑杆再往左拉也不动。这不是人为限制,别去"修";想再往上只能靠负 margin,但 multicol 里 block 方向的 margin 只作用在第一个分片上,后面的页不会跟着动
- 辅助线画在页面容器的 `background` 上,**纯装饰**:不进入布局、不改变换行、不影响页数
- 横线用 `repeating-linear-gradient`;虚线和方格用平铺的内联 SVG——CSS 渐变表达不了"每 N 像素画一条虚线"
- 实时预览靠 postMessage 改 CSS 变量,不重建 iframe;分页模式改完会重跑分页
- **正文颜色**存 `textColor`,空串 = 跟随主题。文档里 body 写的是 `color:var(--mm-ink)`,颜色和位置字号共用 `mmTypography` 这一条消息。`applyTypography` 里判的是 `textColor !== undefined` 而**不是**真值——否则"改回跟随主题"(空串)会被当成没传,永远回不去主题色;拿到空串时要填主题色 `THEME_INK`,不能把变量置空
- 颜色选择器(`inkRowHtml` / `bindInkRow`)在阅读设置和调整器里各有一份,选中态按当前值重画。自选的颜色不在预设里,重画时要把它写回 `<input type="color">`,不然自选完再回来会显示成上一个预设色

**背景调整器(`openBgAdjuster`)**:选完背景图会**自己弹出来**,不用先保存再看效果。一个手机形状的舞台放大图,示例正文压在上面,可以直接**拖文字**,也可以用滑杆。

- 舞台的宽高比按 `innerWidth/innerHeight` 算出来,**不能随便定个比例**:比例不对,`cover` 裁出来的构图就和真机不一样,照着调出来的位置到了阅读页就是错的
- 手机屏又窄又高,舞台高度给到 72vh 才够大到能瞄准,按钮因此会被挤到屏幕外,所以按钮行用 `position:sticky; bottom:0`
- 舞台里的 padding / 字号都按 `舞台宽 / 屏幕宽` 缩放画,交回去的数值再除回来,**存的始终是阅读页的真实像素**
- 正文颜色就用主题的 `--ink`,不额外加描边:深色图配浅色主题本来就看不清,预览要如实告诉用户这件事

**背景实时预览只能用 postMessage**。阅读器 iframe 是 `sandbox="allow-scripts"`(没有 `allow-same-origin`),处在 opaque origin,父页面碰 `iframe.contentWindow.document` 会直接抛 DOMException——所以背景改动走 `{mmBackground}` 消息,由文档内的 `applyBackground` 落地。清空背景时父页面要发主题色,别发空串,否则 body 会变透明。

### 朗读引擎

引擎只接收一串 `{type, character, text}` 片段和一个"这段用哪个声音"的解析器(`buildVoicePlan`),**自己完全不认识阅读器**。换 TTS 服务或加新服务不需要动引擎。

**说话人识别分两层**:

1. **规则**(`segmentByRules`,永远可用、永不失败):引号内是对白、其余是旁白;`名字：`前缀、引号**前**的"角色B笑了笑，说："、引号**后**的"…”角色A低声说。"三种都能认。做法是先定位所有引号区间,再左右各看 16 字取最近的名字——只看引号前面、或不剥标点,后两种情况会认不出来。
2. **AI 标注**(`annotateSegments`,可选增强):**绝不是单点故障**。没配预设、Key 错、模型不存在、网络不通、返回不是 JSON、数组为空,任何一种都自动退回规则识别。另外有一条**原文覆盖率校验**:模型改写或漏掉原文(去标点后字数偏离超过 10%/15%)就作废这次标注退回规则。

**旁白三模式**:TTS / 系统语音(`speechSynthesis`,不消耗任何 API)/ 不朗读。系统语音**必须有看门狗**:没有安装语音、或遇到 Chrome 长文本停顿时 `onend` 可能永远不触发,没有看门狗整个队列会卡死。另有 8 秒 `resume()` 保活。

**手动选读**是稳定兜底:长按正文某段 →「只朗读这一段 / 从这一段开始朗读」,有选中文字时多一项「朗读选中的文字」。长按结束的那次 click 会被吞掉,不会顺带翻页。

---

## 架构原则(改代码前先读)

1. **故事隔离** — 不同角色的故事即使用同一个 Instruction 也必须完全独立
2. **分类与内容解耦** — Character / Instruction / Story / Episode 只靠 id 关联,不互相写死
3. **HTML 完全隔离** — 不同 HTML 不得共用 DOM / CSS / JS 运行环境
4. **TTS 与阅读器解耦** — 换 Provider 不应该改阅读器核心
5. **AI 标注只是辅助** — 失败必须自动退回规则识别
6. **所有滚动都限制在阅读区域** — 禁止整页跟随正文滚动
7. **沉浸模式必须真正全屏** — 不能靠漏出箭头作为展开入口
8. **设置可复用** — 角色声音、背景、模型等配置存成独立对象,不要只绑在某个故事上
9. **为扩展留接口** — 加 TTS / AI Provider / 阅读背景 / HTML 类型,都应该能在现有架构上加而不是重设计

## 其他注意事项

- **RAR 完全没做**:纯前端没有可靠的RAR解析方案(专有格式,只有实验性WASM移植,RAR5/固实压缩/分卷经常直接失败),已经跟用户确认过放弃。TAR/TAR.GZ 因为格式简单、纯JS就能解析,所以顺手做了。
- 所有输入框字号强制设为 `16px`,是为了避免 iOS Safari 在输入框字号小于16px时聚焦自动放大页面的问题(之前真实踩过这个坑,表现为"主页面一直在放大缩小拉伸")。
- 弹窗系统 `.modal-overlay` 的 `z-index` 必须高于阅读页 `.reader-overlay`,否则从阅读页内打开的"更多菜单/阅读设置/复制"弹窗会被阅读页盖住(之前的真实bug,现在 modal-overlay 是 90,reader-overlay 是 70)。
- FAB(书架加号按钮)的底部间距要用 `calc(78px + env(safe-area-inset-bottom))`,不能写死数字,否则在有Home Indicator的手机上会被底部导航栏遮住。

- **音乐播放模块没有做**:规格 V1 的第十六、十七节缺失(编号从"十五 AI标注 API"直接跳到"十八"),而"核心目标"和"二十.6"都提到了音乐/网易云 Provider 却没有需求正文。已与使用者确认**不做**。
- **接口调用全部走浏览器 fetch**,所以对方接口必须允许跨域(CORS)。这是纯前端应用绕不过去的限制,已经在报错文案里写清楚了。
- 语音/总结的调试方式:仓库外可以起一个本地 mock 接口逐条验证请求体、请求头、响应解析和各种出错分支,比对着真实接口试要快得多。

祝接手顺利,喵喵书阁就交给你了 TvT
