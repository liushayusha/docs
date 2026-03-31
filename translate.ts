/*
 * @Author: yusha
 * @Date: 2025-12-17 14:16:31
 * @LastEditors: yusha
 * @LastEditTime: 2026-03-31 16:30:18
 * @Description: 
 */
/**
 * MDX 文档翻译脚本 - 段落级增量翻译
 *
 * 用法:
 *   npm run setup-i18n               # 初始化多语言目录（首次使用前必须运行）
 *   npm run translate                # 段落级增量翻译（默认，推荐）
 *   npm run translate -- file.mdx    # 只翻译指定文件
 *   npm run translate:force          # 强制全量翻译
 *
 * 段落级增量翻译说明:
 *   1. 自动按 H2 标题（## xxx）分割段落
 *   2. 只翻译变更的段落，其他段落复用已有翻译
 *   3. 大幅减少翻译时间和成本（80-90%）
 *   4. 源语言: zh (中文)，目标语言: en (English), ja (日本語), ko (한국어)
 *
 * 目录结构:
 *   docs/
 *   ├── zh/                          # 源语言（中文）
 *   │   ├── overview.mdx
 *   │   └── api-reference/
 *   │       └── images/gpt-4o/generation.mdx
 *   ├── en/                          # 翻译成英文
 *   │   ├── overview.mdx
 *   │   └── api-reference/
 *   │       └── images/gpt-4o/generation.mdx
 *   ├── ja/                          # 翻译成日语
 *   └── ko/                          # 翻译成韩语
 */

import OpenAI from "openai";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "fs";
import { join, dirname, relative, basename, extname } from "path";
import { createHash } from "crypto";

// 加载翻译配置
let translationConfig: any = {};
try {
  const configPath = join(process.cwd(), "translation-config.json");
  if (existsSync(configPath)) {
    translationConfig = JSON.parse(readFileSync(configPath, "utf-8"));
  }
} catch (error) {
  console.warn("⚠️  无法加载 translation-config.json，使用默认配置");
}

// 定义源语言和目标语言
const SOURCE_LOCALE = { code: "zh", label: "Chinese" };

// 定义目标语言（从中文翻译到这些语言）
const allLocales = [
  { code: "en", label: "English" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

// 并发配置
const CONCURRENT_BATCH_SIZE = 6;
const BATCH_DELAY_MS = 200;

// 分片翻译配置
const MAX_CHUNK_SIZE = 5000;
const CHUNK_BATCH_SIZE = 10;

// 生成语言映射（包含源语言和目标语言）
const languageMap: Record<string, string> = {
  [SOURCE_LOCALE.code]: SOURCE_LOCALE.label,
  ...Object.fromEntries(allLocales.map((locale: any) => [locale.code, locale.label]))
};

// 添加 tw 的特殊映射（因为 tw 实际对应繁体中文）
languageMap.tw = "Traditional Chinese";

const openai = new OpenAI({
  baseURL: "https://api.tu-zi.com/v1",
  apiKey: "sk-OxiNcFAfHhG0SVfZA3PCzeqjCk73oXxoO3Jsq0gQ3YpIfngJ",
});

// 生成翻译系统提示词（包含配置文件中的不翻译词汇）
function generateTranslateSystemPrompt(): string {
  const doNotTranslateTerms = translationConfig?.doNotTranslate?.terms || [];
  const doNotTranslateHeaders = translationConfig?.doNotTranslate?.headers || [];
  const preserveH2 = translationConfig?.preserveFormatting?.h2Headers !== false;

  let termsSection = "";
  if (doNotTranslateTerms.length > 0) {
    termsSection = `\n   - These specific terms: ${doNotTranslateTerms.join(", ")}`;
  }

  let headersSection = "";
  if (doNotTranslateHeaders.length > 0) {
    const examples = doNotTranslateHeaders.map(h => `- "## ${h}" → keep as "## ${h}"`).join("\n");
    headersSection = `\n\nExamples of headers NOT to translate:\n${examples}`;
  }

  return `You are a professional technical translator specializing in MDX (Markdown + JSX) documentation.
Your task is to translate the string values within JSON objects while preserving all technical formatting.

=== TERMINOLOGY GLOSSARY (CRITICAL) ===
Use these EXACT translations for common terms to ensure consistency:

**API Documentation Terms:**
- 属性 → Properties (NOT Attributes)
- 参数 → Parameters
- 请求 → Request
- 响应 → Response
- 限制 → Limitations (for section headers or general constraints)
- 限制 → Limit (for specific numeric limits like "rate limit")
- 示例 → Example / Examples
- 描述 → Description
- 必填 → Required
- 可选 → Optional
- 类型 → Type
- 默认值 → Default / Default Value
- 返回值 → Return Value / Returns
- 错误 → Error
- 状态 → Status
- 端点 → Endpoint
- 请求体 → Request Body
- 响应体 → Response Body
- 头部 → Header / Headers
- 查询参数 → Query Parameters
- 路径参数 → Path Parameters

**Common Phrases:**
- 生成 → Generate
- 创建 → Create
- 获取 → Get / Retrieve
- 更新 → Update
- 删除 → Delete
- 查询 → Query
- 提交 → Submit
- 处理 → Process
- 成功 → Success
- 失败 → Failed / Failure
- 完成 → Completed
- 进行中 → In Progress / Processing

=== TRANSLATION RULES ===

1. **Translate accurately** while conveying the original meaning and tone.
   - **Use the terminology glossary above for consistency**
   - **Grammar adaptation:**
     * English: Apply proper pluralization ("5个文件" → "5 files", NOT "5 file")
     * English: Add articles (a, an, the) where natural ("获取密钥" → "Get the API key")
     * English: Use appropriate verb tenses (Chinese lacks tense markers)
     * English: Add spaces between numbers and units ("5秒" → "5 seconds")
     * CJK: No spaces between numbers and units ("5秒" → "5秒")

2. **JSON Structure (CRITICAL):**
   - Maintain original structure. Do not translate keys, only string values.
   - Keep all JSON keys in English (e.g., "description", "title", "prompt")

3. **TRANSLATE all user-facing text:**
   - **Markdown Content:** Paragraphs, headers (#), lists, blockquotes
   - **Component Text Content:** Text between tags
     * \`<Note>这是一个提示</Note>\` → \`<Note>This is a tip</Note>\`
   - **Component Attributes (String Display ONLY):**
     * \`title="..."\`, \`description="..."\`, \`label="..."\`, \`placeholder="..."\`
     * Example: \`<Card title="核心功能">\` → \`<Card title="Core Features">\`
   - **Table Content:** Headers and cell content (keep structure)
   - **Code Blocks - Selective Translation (IMPORTANT):**
     * ✅ TRANSLATE user-facing string values (Context Aware):
       - \`"prompt": "瀑布..."\` → \`"prompt": "Waterfall..."\` (Human-readable content)
       - \`"error": "找不到文件"\` → \`"error": "File not found"\`
     * ✅ TRANSLATE explanatory comments:
       - \`// 发送请求\` → \`// Send request\`
       - \`# 变量定义\` → \`# Variable definition\`
     * ❌ DO NOT translate JSON Keys:
       - \`"description": "文本"\` → Keep \`"description"\`, translate only the value to \`"Text"\`
     * ❌ DO NOT translate code syntax/structure:
       - Variable names, Function calls, Keywords (if, for, class)
     * ❌ DO NOT translate technical identifiers/Enums:
       - \`"model": "sora-2"\`, \`status="pending"\`, \`/api/v1/generate\`
     * ❌ DO NOT translate commented-out code:
       - \`// console.log(response)\` → Keep as-is

4. **DO NOT translate - Technical & Logic:**
   - **Component Names:** \`<Card>\`, \`<Step>\`, \`<Note>\`, \`<ParamField>\` (NEVER translate tag names)
   - **Functional Attributes:** \`href\`, \`icon\`, \`type\`, \`name\`, \`id\`, \`className\`, \`key\`, \`src\`
     * \`<Card icon="rocket">\` → Keep "rocket" (identifier)
   - **JSX Expressions:** Content inside \`{}\`
     * \`value={isOpen}\` → Keep exactly as-is
     * \`options={['A', 'B']}\` → Keep exactly as-is
   - **Placeholder/Template Variables (CRITICAL):**
     * \`{username}\`, \`{id}\`, \`{{variable}}\` (curly braces)
     * \`\${name}\`, \`$USER\`, \`$API_KEY\` (dollar signs)
     * \`%s\`, \`%d\`, \`%f\` (printf-style)
     * \`<username>\`, \`<email>\` (angle brackets)
     * \`YOUR_API_KEY\`, \`<token>\` (all-caps/angle bracket placeholders)
   - **Technical Terms (Common Patterns):**
     * Brand names: Sora2, GPT-4o, Gemini, VEO3, MiniMax, Seedream
     * Data types: string, integer, boolean, array, object, null
     * Status values: "submitted", "pending", "completed", "failed", "success"
     * HTTP methods: GET, POST, PUT, DELETE, PATCH
     * URLs, file extensions, MIME types, timestamps, environment variables${preserveH2 ? "\n   - **Markdown headers:** Keep ## headers in original language" : ""}${termsSection}

5. **Markdown Format (CRITICAL):**
   - **Bold/Italic:** \`**粗体**\` → \`**Bold**\`
   - **Links:** \`[显示文本](URL)\` → \`[Translated Text](URL)\`
     * **NO SPACE between brackets:** \`[Text](url)\` is correct. \`[Text] (url)\` is WRONG.
     * Update internal links: \`/zh/...\` → \`/en/...\`
   - **Images:** \`![Alt文本](path)\` → \`![Translated Alt](path)\`
   - **Inline code:** \` \\\`code\\\` \` → Keep as-is (do NOT translate)
   - **Code blocks:** \` \\\`\\\`\\\`json \` → Keep language identifier lowercase
   - **Admonitions/Callouts:**
     * \`:::tip 提示\` → \`:::tip Note\` (Translate custom title if present)

6. **Punctuation Conversion:**
   - Convert Chinese full-width punctuation to Target Language standard
   - **English:** \`，\`→\`,\` | \`。\`→\`.\` | \`：\`→\`:\` | \`（）\`→\`()\`
   - **CJK:** Keep full-width if appropriate (。、「」 for Japanese)

7. **Numbers and Units:**
   - Keep numbers (5, 10.5) as-is
   - **English:** "5分钟" → "5 minutes" (add space)
   - **Japanese/Korean:** "5分钟" → "5分" (no space or follow conventions)
   - **Chinese measure words (量词):** Remove in English
     * "5个文件" → "5 files"
     * "3张图片" → "3 images"

8. **Format Preservation (NEVER MODIFY):**
   - Line breaks (\\n): keep exact count
   - Indentation/whitespace: preserve exactly
   - Quote style: " vs ' must stay the same
   - **Smart Quotes (CRITICAL):** NEVER use \`"\` or \`"\` (curly quotes). Use ONLY \`"\` or \`'\` (straight quotes).
   - Code block language: \`\`\`json, \`\`\`bash, \`\`\`python (keep lowercase)
   - Tag spacing: <Tag> NOT < Tag > or <Tag >
   - **JSX Props Spacing:** \`<Card title="Text">\` NOT \`<Card title = "Text">\`
   - Table structure: | Header | → | 标题 | (same | count and spacing)
   - Table separators: |---|---| → |---|---| (never change)
   - Empty lines: preserve all blank lines

9. **Special Elements:**
   - **Emoji:** Keep exactly as-is (🎉, 💡, ⚠️, ✅, ❌)
   - **HTML Comments:** \`<!-- 注释 -->\` → \`<!-- Comment -->\`
   - **Line Breaks:** Preserve empty lines and structural indentation

10. **JSON Escaping:**
    - Properly escape quotes in string values
    - Preserve existing escape sequences: \\n, \\t, \\", \\\\${headersSection}

=== OUTPUT FORMAT ===
Return ONLY the JSON object with translated values.
NO explanations, NO comments, NO markdown code blocks, NO extra text.`;

}

const translateSystemPrompt = generateTranslateSystemPrompt();

const createTranslateUserPrompt = (
  sourceLang: string,
  targetLang: string,
  texts: any
) => `Translate the following JSON object from ${sourceLang} to ${targetLang}:

${JSON.stringify({ translation: texts }, null, 2)}`;

// 生成短 hash (8 字符)
function shortHash(text: string): string {
  return createHash("md5").update(text).digest("hex").slice(0, 8);
}

// 解析 MDX 文件的 frontmatter 和内容
interface MdxContent {
  frontmatter: string;
  content: string;
  fullText: string;
}

function parseMdxFile(filePath: string): MdxContent {
  const fullText = readFileSync(filePath, "utf-8");

  // 匹配 frontmatter (--- 包裹的部分)
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = fullText.match(frontmatterRegex);

  if (match) {
    return {
      frontmatter: match[1],
      content: match[2],
      fullText: fullText,
    };
  }

  // 如果没有 frontmatter
  return {
    frontmatter: "",
    content: fullText,
    fullText: fullText,
  };
}

// 段落接口
interface MdxSection {
  id: string;        // 段落标识符
  title: string;     // 段落标题（用于显示）
  content: string;   // 段落内容
  hash: string;      // 段落内容的 hash
}

// 段落级 Hash 映射（旧格式，兼容性保留）
interface SectionHashMap {
  [sectionId: string]: string;  // sectionId -> hash
}

// 段落历史记录（新格式）
interface SectionHistory {
  id: string;      // 段落ID
  hash: string;    // 中文内容hash
  index: number;   // 历史位置
}

// 将 MDX 内容按段落分割
function splitMdxIntoSections(mdxContent: MdxContent): MdxSection[] {
  const sections: MdxSection[] = [];

  // 1. Frontmatter 作为单独一段
  if (mdxContent.frontmatter) {
    sections.push({
      id: "__frontmatter__",
      title: "Frontmatter",
      content: mdxContent.frontmatter,
      hash: shortHash(mdxContent.frontmatter),
    });
  }

  // 2. 按 H2 标题分割内容
  const content = mdxContent.content;

  // 匹配所有 H2 标题及其位置
  const h2Regex = /^## (.+)$/gm;
  const matches: Array<{ title: string; index: number }> = [];
  let match;

  while ((match = h2Regex.exec(content)) !== null) {
    matches.push({
      title: match[1],
      index: match.index,
    });
  }

  // 如果有 H2 之前的内容，作为单独一段
  if (matches.length > 0 && matches[0].index > 0) {
    const prologueContent = content.substring(0, matches[0].index).trim();
    if (prologueContent) {
      sections.push({
        id: "__prologue__",
        title: "Introduction",
        content: prologueContent,
        hash: shortHash(prologueContent),
      });
    }
  }

  // 处理每个 H2 段落
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i < matches.length - 1 ? matches[i + 1].index : content.length;
    const sectionContent = content.substring(start, end).trim();

    // 生成段落 ID（用标题生成，确保唯一性）
    const sectionId = matches[i].title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "");

    sections.push({
      id: `section-${i}-${sectionId}`,
      title: matches[i].title,
      content: sectionContent,
      hash: shortHash(sectionContent),
    });
  }

  // 如果没有 H2 标题，整个内容作为一段
  if (matches.length === 0 && content.trim()) {
    sections.push({
      id: "__content__",
      title: "Content",
      content: content.trim(),
      hash: shortHash(content.trim()),
    });
  }

  return sections;
}

// 从段落列表重建完整的 MDX 内容
function rebuildMdxFromSections(sections: MdxSection[]): MdxContent {
  let frontmatter = "";
  let content = "";

  for (const section of sections) {
    if (section.id === "__frontmatter__") {
      frontmatter = section.content;
    } else if (section.id === "__prologue__") {
      content += section.content + "\n\n";
    } else if (section.id === "__content__") {
      content += section.content;
    } else {
      // 正常段落（包含 H2 标题）
      content += section.content + "\n\n";
    }
  }

  const fullText = generateMdxFile(frontmatter, content.trim());

  return {
    frontmatter,
    content: content.trim(),
    fullText,
  };
}

// 生成段落级 Hash 映射
function generateSectionHashMap(sections: MdxSection[]): SectionHashMap {
  const hashMap: SectionHashMap = {};
  for (const section of sections) {
    hashMap[section.id] = section.hash;
  }
  return hashMap;
}

// 比较两个 Hash 映射，找出变更的段落
function detectSectionChanges(
  currentSections: MdxSection[],
  storedHashMap: SectionHashMap
): {
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
} {
  const added: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];
  const currentIds = new Set(currentSections.map((s) => s.id));
  const storedIds = new Set(Object.keys(storedHashMap));

  // 检查当前段落
  for (const section of currentSections) {
    if (!storedIds.has(section.id)) {
      added.push(section.id);
    } else if (storedHashMap[section.id] !== section.hash) {
      modified.push(section.id);
    } else {
      unchanged.push(section.id);
    }
  }

  // 检查已删除的段落
  const deleted = Array.from(storedIds).filter((id) => !currentIds.has(id));

  return { added, modified, deleted, unchanged };
}

// V3.0 智能diff算法：基于hash指纹匹配
interface SectionMapping {
  sourceIndex: number;          // 当前中文段落的位置
  targetIndex: number | null;   // 对应的英文段落位置（null表示需要翻译）
  action: 'keep' | 'translate'; // keep=复用英文, translate=重新翻译
  reason?: string;              // 调试信息
}

function smartDiffSectionsV3(
  currentSections: MdxSection[],     // 当前中文段落
  historySections: SectionHistory[], // 历史中文段落记录
  targetSections: MdxSection[]       // 当前英文段落
): SectionMapping[] {
  const mappings: SectionMapping[] = [];

  // 构建历史hash -> 位置的映射（快速查找）
  const historyHashToIndex = new Map<string, number>();
  for (const item of historySections) {
    historyHashToIndex.set(item.hash, item.index);
  }

  // 为每个当前中文段落找到对应的英文翻译
  for (let currentIndex = 0; currentIndex < currentSections.length; currentIndex++) {
    const currentSection = currentSections[currentIndex];

    // 检查这个中文段落是否在历史中存在（通过hash匹配）
    const historicIndex = historyHashToIndex.get(currentSection.hash);

    if (historicIndex !== undefined) {
      // 这个中文段落未变，尝试复用英文翻译
      if (historicIndex < targetSections.length) {
        // 英文文件中对应位置存在段落，复用
        mappings.push({
          sourceIndex: currentIndex,
          targetIndex: historicIndex,
          action: 'keep',
          reason: `复用历史位置 ${historicIndex} 的英文翻译`
        });
      } else {
        // 英文文件段落数不够（可能是首次翻译某些语言），需要翻译
        mappings.push({
          sourceIndex: currentIndex,
          targetIndex: null,
          action: 'translate',
          reason: '英文文件缺失该段落'
        });
      }
    } else {
      // 这个中文段落是新增或修改的，需要翻译
      mappings.push({
        sourceIndex: currentIndex,
        targetIndex: null,
        action: 'translate',
        reason: '新增或修改的段落'
      });
    }
  }

  return mappings;
}

// 生成 MDX 文件
function generateMdxFile(frontmatter: string, content: string): string {
  if (frontmatter) {
    return `---\n${frontmatter}\n---\n${content}`;
  }
  return content;
}

// 发现源语言目录下的所有 MDX 文件
function findAllSourceMdxFiles(projectPath: string): Array<{ filePath: string; relativePath: string }> {
  const sourceDir = join(projectPath, SOURCE_LOCALE.code);
  const results: Array<{ filePath: string; relativePath: string }> = [];

  if (!existsSync(sourceDir)) {
    console.log(`⚠️  ${SOURCE_LOCALE.code}/ 目录不存在，请先创建 ${SOURCE_LOCALE.code}/ 目录并将源文档放入其中`);
    return results;
  }

  function scanDirectory(currentPath: string) {
    try {
      const items = readdirSync(currentPath);
      for (const item of items) {
        const itemPath = join(currentPath, item);
        const stat = statSync(itemPath);

        // 跳过隐藏目录
        if (stat.isDirectory()) {
          if (!item.startsWith(".") && item !== "node_modules") {
            scanDirectory(itemPath);
          }
        } else if (extname(item) === ".mdx") {
          // 相对于源语言目录的路径
          const relativePath = relative(sourceDir, itemPath);
          results.push({ filePath: itemPath, relativePath });
        }
      }
    } catch (error) {
      console.warn(`⚠️  扫描目录失败 ${currentPath}:`, error);
    }
  }

  scanDirectory(sourceDir);
  return results;
}



// 解析 AI 返回的 JSON
function parseJsonFromAI(content: string): any {
  // 尝试直接解析
  try {
    return JSON.parse(content);
  } catch {
    // 尝试提取 JSON 块
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    throw new Error("无法解析 AI 返回的 JSON");
  }
}

// 翻译单个块
async function translateSingleChunk(sourceLang: string, targetLang: string, textObj: any): Promise<any> {
  try {
    const userPrompt = createTranslateUserPrompt(sourceLang, targetLang, textObj);
    const response = await openai.chat.completions.create({
      model: process.env.TRANSLATE_MODEL || "gpt-4.1-mini",
      messages: [
        { role: "system", content: translateSystemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const translatedContent = response.choices[0].message.content?.trim();
    if (!translatedContent) {
      throw new Error("翻译响应为空");
    }

    const translatedJson = parseJsonFromAI(translatedContent);
    return translatedJson.translation;
  } catch (error) {
    console.error(`翻译错误: ${error}`);
    throw error;
  }
}

// 翻译文本对象（简化版，仅用于 MDX）
async function translateText(sourceLang: string, targetLang: string, textObj: any): Promise<any> {
  return translateSingleChunk(sourceLang, targetLang, textObj);
}

// 读取段落历史（支持新旧格式）
function loadSectionHistory(hashFilePath: string): SectionHistory[] {
  if (!existsSync(hashFilePath)) {
    return [];
  }

  try {
    const content = readFileSync(hashFilePath, "utf-8");
    const data = JSON.parse(content);

    // 新格式：数组
    if (Array.isArray(data)) {
      return data;
    }

    // 旧格式：对象，转换为新格式
    const history: SectionHistory[] = [];
    let index = 0;
    for (const [id, hash] of Object.entries(data)) {
      history.push({ id, hash: hash as string, index });
      index++;
    }
    return history;
  } catch {
    return [];
  }
}

// 保存段落历史
function saveSectionHistory(hashFilePath: string, sections: MdxSection[]) {
  try {
    const hashDir = dirname(hashFilePath);
    if (!existsSync(hashDir)) {
      mkdirSync(hashDir, { recursive: true });
    }

    const history: SectionHistory[] = sections.map((section, index) => ({
      id: section.id,
      hash: section.hash,
      index
    }));

    writeFileSync(hashFilePath, JSON.stringify(history, null, 2), "utf-8");
  } catch (error) {
    console.warn(`  ⚠️  保存段落 hash 失败: ${error}`);
  }
}

// 兼容性：读取旧格式的 Hash 映射
function loadSectionHashMap(hashFilePath: string): SectionHashMap {
  const history = loadSectionHistory(hashFilePath);
  const hashMap: SectionHashMap = {};
  for (const item of history) {
    hashMap[item.id] = item.hash;
  }
  return hashMap;
}

// 检查 MDX 文件是否有段落变更
function hasAnyChanges(
  currentSections: MdxSection[],
  storedHashMap: SectionHashMap
): boolean {
  const changes = detectSectionChanges(currentSections, storedHashMap);
  return (
    changes.added.length > 0 ||
    changes.modified.length > 0 ||
    changes.deleted.length > 0
  );
}

// 翻译 MDX 文件（支持段落级增量更新）
async function translateMdxFiles(
  projectPath: string,
  forceUpdate: boolean = false,
  specificFiles: string[] = []
) {
  console.log("🚀 开始翻译 MDX 文件（段落级增量）...\n");

  let mdxFiles = findAllSourceMdxFiles(projectPath);
  if (mdxFiles.length === 0) {
    console.log("❌ 未找到任何 .mdx 文件");
    return;
  }

  // 如果指定了特定文件，过滤文件列表
  if (specificFiles.length > 0) {
    const normalizedSpecific = specificFiles.map((f) =>
      f.replace(new RegExp(`^${SOURCE_LOCALE.code}\\/`), "").replace(/\\/g, "/")
    );
    mdxFiles = mdxFiles.filter((f) =>
      normalizedSpecific.some((spec) => f.relativePath.includes(spec))
    );

    if (mdxFiles.length === 0) {
      console.log("❌ 未找到指定的文件");
      return;
    }
    console.log(`📋 指定翻译 ${mdxFiles.length} 个文件\n`);
  } else {
    console.log(`🔍 发现 ${mdxFiles.length} 个源语言 (${SOURCE_LOCALE.code}) .mdx 文件\n`);
  }

  // 目标语言列表（所有配置的语言）
  const targetLanguages = allLocales;

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const { filePath, relativePath } of mdxFiles) {
    // 生成 hash 文件路径（保存段落级 hash 的 JSON 文件）
    const hashPath = join(
      projectPath,
      SOURCE_LOCALE.code,
      dirname(relativePath),
      `.${basename(relativePath)}.sections.json`
    );

    try {
      // 1. 解析源语言文件，分割成段落
      const sourceMdxContent = parseMdxFile(filePath);
      const sourceSections = splitMdxIntoSections(sourceMdxContent);

      // 2. 读取历史段落记录（V3.0 新格式）
      const historySections = loadSectionHistory(hashPath);

      // 3. 检测变更（用于显示统计信息）
      const storedHashMap = loadSectionHashMap(hashPath);
      const changes = detectSectionChanges(sourceSections, storedHashMap);
      const hasChanges =
        changes.added.length > 0 ||
        changes.modified.length > 0 ||
        changes.deleted.length > 0;

      // 如果没有变更且不是强制更新，跳过
      if (!hasChanges && !forceUpdate) {
        console.log(`📄 ${relativePath}: 无变更，跳过`);
        skippedCount += targetLanguages.length;
        continue;
      }

      // 显示变更信息
      if (hasChanges) {
        console.log(`📄 处理: ${SOURCE_LOCALE.code}/${relativePath}`);
        console.log(
          `  🔍 变更: +${changes.added.length} ~${changes.modified.length} -${changes.deleted.length} =${changes.unchanged.length}`
        );
      } else {
        console.log(`📄 强制翻译: ${SOURCE_LOCALE.code}/${relativePath}`);
      }

      // 4. 翻译每种语言
      for (let i = 0; i < targetLanguages.length; i += CONCURRENT_BATCH_SIZE) {
        const batch = targetLanguages.slice(i, i + CONCURRENT_BATCH_SIZE);

        const batchPromises = batch.map(async (locale) => {
          try {
            const targetDir = join(projectPath, locale.code, dirname(relativePath));
            const targetPath = join(projectPath, locale.code, relativePath);

            // 创建目标目录
            if (!existsSync(targetDir)) {
              mkdirSync(targetDir, { recursive: true });
            }

            // 读取目标语言文件（如果存在）
            let existingTargetSections: MdxSection[] = [];

            if (existsSync(targetPath) && !forceUpdate) {
              try {
                const targetMdxContent = parseMdxFile(targetPath);
                existingTargetSections = splitMdxIntoSections(targetMdxContent);
              } catch (error) {
                console.warn(`  ⚠️  无法读取现有翻译: ${error}`);
              }
            }

            // 构建最终的段落列表
            const finalSections: MdxSection[] = [];

            if (existingTargetSections.length > 0 && !forceUpdate && historySections.length > 0) {
              // V3.0 增量翻译模式：基于hash指纹智能匹配
              let keepCount = 0;
              let translateCount = 0;

              // 使用V3.0智能diff算法
              const mappings = smartDiffSectionsV3(
                sourceSections,
                historySections,
                existingTargetSections
              );

              for (const mapping of mappings) {
                const sourceSection = sourceSections[mapping.sourceIndex];

                if (mapping.action === 'keep' && mapping.targetIndex !== null) {
                  // 复用历史位置的英文翻译
                  finalSections.push({
                    ...sourceSection,
                    content: existingTargetSections[mapping.targetIndex].content,
                  });
                  keepCount++;
                } else {
                  // 需要翻译（新增或修改）
                  const sectionObj = { [sourceSection.id]: sourceSection.content };
                  const translatedObj = await translateText(
                    SOURCE_LOCALE.label,
                    locale.label,
                    sectionObj
                  );
                  const translatedContent = translatedObj[sourceSection.id];

                  finalSections.push({
                    ...sourceSection,
                    content: translatedContent,
                  });
                  translateCount++;
                }
              }

              console.log(
                `  ✅ ${locale.code}/${relativePath}: ` +
                `复用 ${keepCount} | 翻译 ${translateCount}`
              );
            } else {
              // 全量翻译模式：目标文件不存在、强制更新、或无历史记录
              for (const sourceSection of sourceSections) {
                const sectionObj = { [sourceSection.id]: sourceSection.content };
                const translatedObj = await translateText(
                  SOURCE_LOCALE.label,
                  locale.label,
                  sectionObj
                );
                const translatedContent = translatedObj[sourceSection.id];

                finalSections.push({
                  ...sourceSection,
                  content: translatedContent,
                });
              }

              console.log(
                `  ✅ ${locale.code}/${relativePath}: 全量翻译 ${sourceSections.length} 个段落`
              );
            }

            // 从段落重建完整的 MDX 文件
            const translatedMdxContent = rebuildMdxFromSections(finalSections);

            // 保存文件
            writeFileSync(targetPath, translatedMdxContent.fullText, "utf-8");

            return { success: true, skipped: false };
          } catch (error) {
            console.error(`  ❌ ${locale.code}/${relativePath}: ${error}`);
            return { success: false, skipped: false };
          }
        });

        const results = await Promise.allSettled(batchPromises);
        results.forEach((result) => {
          if (result.status === "fulfilled") {
            if (result.value.skipped) {
              skippedCount++;
            } else if (result.value.success) {
              successCount++;
            } else {
              errorCount++;
            }
          } else {
            errorCount++;
          }
        });

        if (i + CONCURRENT_BATCH_SIZE < targetLanguages.length) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      // 翻译成功后，保存段落历史记录（V3.0 新格式）
      saveSectionHistory(hashPath, sourceSections);
    } catch (error) {
      console.error(`  ❌ 处理文件失败: ${error}`);
      errorCount += targetLanguages.length;
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log(`✅ 成功: ${successCount}, ⏭️  跳过: ${skippedCount}, ❌ 失败: ${errorCount}`);
  console.log("🎉 MDX 翻译完成！");
}

// 主函数
async function main() {
  const args = process.argv.slice(2);

  // 解析参数
  let forceUpdate = false;
  const specificFiles: string[] = [];

  for (const arg of args) {
    if (arg === "--force" || arg === "-f") {
      forceUpdate = true;
    } else if (!arg.startsWith("-")) {
      // 不以 - 开头的参数视为文件路径
      specificFiles.push(arg);
    }
  }

  try {
    // 直接使用当前目录作为项目路径
    const projectPath = process.cwd();

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎯 MDX 文档翻译${forceUpdate ? " (强制更新)" : " (段落级增量)"}`);
    console.log(`📁 项目路径: ${projectPath}`);
    if (specificFiles.length > 0) {
      console.log(`📋 指定文件: ${specificFiles.join(", ")}`);
    }
    console.log(`${"=".repeat(60)}\n`);

    // MDX 翻译模式（支持段落级增量更新）
    await translateMdxFiles(projectPath, forceUpdate, specificFiles);
  } catch (error) {
    console.error("❌ 脚本运行失败:", error);
    process.exit(1);
  }
}

main();
