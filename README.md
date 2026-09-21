# 工具箱

一个入口，装下自己写的那些网页工具。

`index.html` 就是整个合集页 —— 纯前端、无构建、无依赖，配色从 `theme.css` 取。

## 手机上怎么用

开了 GitHub Pages 之后网址是：

```
https://yu7705423-cell.github.io/toolbox/
```

打开后**添加到主屏幕**，它会以独立窗口全屏运行，像个 app。
加到主屏之后点卡片是原地跳转（不会甩回浏览器新标签），退回来用手势返回。

开 Pages：仓库 → Settings → Pages → Source 选 **Deploy from a branch** →
Branch 选 `main`、目录 `/ (root)` → Save，等一两分钟。

## 现在装了什么

| 卡片 | 仓库 | 地址 |
|---|---|---|
| 喵喵书阁 | `read` | `/read/` |
| 番外生成器 | `fanwai` | `/fanwai/` |
| Chat Archive | `memory` | `/memory/chat-archive.html` |
| 图床工具箱 | `imgtest` | `/imgtest/imagehosttoolkit.html` |

这几个仓库各自也要开 Pages 才有网址。注意 `fanwai` 和 `memory` 的默认分支是
`claude/` 开头的，Pages 的 Branch 要选对那个分支，不是 `main`。

## 怎么加一个工具

两种，效果一样：

1. **页面上加** —— 右上角 ✎ → 「＋ 添加一个」。存在这台设备的浏览器里，
   换手机不会跟着走，所以加完顺手「导出配置」存一份。
2. **代码里加** —— 改 `index.html` 里的 `BUILTIN` 数组，加一条：

   ```js
   {
     id:'rainyword',                       // 唯一就行，别和已有的重名
     name:'Rainy', glyph:'背', tint:'t-honey',
     desc:'背单词，八本词书',
     url:PAGES+'/rainyword/'
   },
   ```

   这样所有设备打开都会多一张卡。`tint` 可选 `t-violet` `t-rose` `t-blue`
   `t-green` `t-honey` `t-ink`。

页面上改过的名字/说明/地址存在本地覆盖层里，**不会**被代码里的改动冲掉 ——
所以以后在 `BUILTIN` 里更新说明文字是安全的。

## 统一风格

`theme.css` 是唯一的真相来源：一套 `--tb-*` 变量，亮色暗色各一份。

各个工具**不用改变量名**（你一个仓库叫 `--ink`，另一个叫 `--text`，还有叫
`--fg` 的，都留着），只要在它自己的 `:root` 里把值指过来：

```html
<link rel="stylesheet" href="https://yu7705423-cell.github.io/toolbox/theme.css">
<style>
  :root{
    --bg:      var(--tb-bg);
    --surface: var(--tb-surface);
    --ink:     var(--tb-ink);
    --line:    var(--tb-line);
    --accent:  var(--tb-accent);
  }
</style>
```

但那些工具都是「双击就能用」的单文件，挂一个外部 CSS 会让它们断网时变丑，
所以更稳的做法是**把 `theme.css` 的内容整段复制进那个文件的 `<style>` 开头**，
`theme.css` 只作为标准副本留在这儿。颜色定下来之后本来也不常改。

接入一个工具的实际工作量：改它 `:root` 里那 12~24 行值，再扫一遍写死的
二三十个色值（多半是阴影和报错红）。

## 文件

```
index.html    合集页本体
theme.css     共用的颜色/圆角/间距/字体
sw.js         离线外壳缓存。改了 index.html 或 theme.css 要把 VERSION 加一
manifest.json 加到主屏用的
icon-*.png    图标，藕紫底 + 四个格子
.nojekyll     让 GitHub Pages 原样发布，别拿 Jekyll 处理
```
