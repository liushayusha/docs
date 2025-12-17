# 翻译系统使用说明

## 快速开始

修改文档后翻译：

```bash
# 1. 编辑英文源文件
vim en/overview.mdx

# 2. 运行翻译（自动检测变更，只翻译改动的段落）
npm run translate
```

就这么简单！系统会：
- ✅ 自动按 H2 标题（`## xxx`）分割段落
- ✅ 只翻译变更的段落
- ✅ 复用其他段落的已有翻译
- ✅ 节省 80-90% 的翻译时间和成本

## 命令

```bash
npm run translate                    # 段落级增量翻译（推荐）
npm run translate -- overview.mdx    # 只翻译指定文件
npm run translate:force              # 强制重新翻译所有内容
```

## 工作原理

### 段落分割示例

```markdown
---
title: Example    # 段落1: Frontmatter
---

介绍内容...       # 段落2: Introduction

## Quick Start   # 段落3
快速开始内容...

## Features      # 段落4
功能特性...
```

### 增量翻译流程

1. **第一次翻译**：翻译所有段落，生成 `.{filename}.mdx.sections.json` 记录段落 hash
2. **修改某段内容**：只翻译修改的那一段
3. **其他段落**：直接复用之前的翻译

### 实际效果

修改 `overview.mdx` 中的一句话：

```bash
npm run translate

# 输出：
# 📄 处理: en/overview.mdx
#   🔍 变更: +0 ~1 -0 =6     ← 只有1个段落变更，6个段落未变
#   ✅ zh/overview.mdx: 翻译 1 个段落
#   ✅ ja/overview.mdx: 翻译 1 个段落
#   ✅ ko/overview.mdx: 翻译 1 个段落
```

只翻译了 1 个段落，其他 6 个段落复用了已有翻译！

## 配置

### 环境变量（必需）

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"  # 可选
```

### 不翻译的术语

编辑 `translation-config.json`：

```json
{
  "doNotTranslate": {
    "headers": ["Authorization", "Response"],
    "terms": ["APIMart", "OpenAI", "API"]
  }
}
```

## 常见问题

**Q: 翻译没有检测到我的修改？**

删除 hash 文件重新翻译：
```bash
rm en/.overview.mdx.sections.json
npm run translate
```

**Q: 想修改某个特定语言的翻译？**

修改英文源文件（哪怕是小改动），然后运行 `npm run translate`，系统会重新翻译该段落。

**Q: 新增了一个 H2 标题？**

直接运行 `npm run translate`，系统会自动检测到新增的段落并翻译。

**Q: Hash 文件需要提交到 Git 吗？**

✅ **提交** `.sections.json` 文件 - 段落级 hash，团队共享翻译历史
❌ **不要提交** `.hash` 文件 - 旧系统文件，已废弃

**Q: 看到 `.generation.mdx.hash` 和 `.generation.mdx.sections.json` 两个文件？**

- `.hash` - 旧的文件级 hash（整个文件一个 hash）→ 可以删除
- `.sections.json` - 新的段落级 hash（每个段落一个 hash）→ 必须保留

## 支持的语言

- 🇬🇧 English (en) - 源语言
- 🇨🇳 中文 (zh)
- 🇯🇵 日本語 (ja)
- 🇰🇷 한국어 (ko)

## 注意事项

1. ⚠️ **始终编辑英文源文件** - 只修改 `en/` 目录下的文件
2. ⚠️ **不要手动编辑其他语言文件** - 翻译会覆盖手动修改
3. ✅ **Hash 文件自动管理** - `.sections.json` 文件由系统自动创建和更新

## 优势对比

| 操作 | 传统方式 | 段落级增量翻译 |
|------|---------|---------------|
| 改1句话 | 翻译整个文件 | 只翻译1个段落 |
| 成本 | 按整个文件计费 | 只按变更段落计费 |
| 时间 | 几分钟 | 几秒钟 |

**节省 80-90% 的成本和时间！**
