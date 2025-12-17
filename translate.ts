/*
 * @Author: yusha
 * @Date: 2025-12-17 14:16:31
 * @LastEditors: yusha
 * @LastEditTime: 2025-12-17 14:16:45
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
 *   4. 支持的语言: en (English), zh (中文), ja (日本語), ko (한국어)
 *
 * 目录结构:
 *   docs/
 *   ├── en/
 *   │   ├── overview.mdx
 *   │   └── api-reference/
 *   │       └── images/gpt-4o/generation.mdx
 *   ├── zh/
 *   │   ├── overview.mdx
 *   │   └── api-reference/
 *   │       └── images/gpt-4o/generation.mdx
 *   ├── ja/
 *   └── ko/
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

// 定义支持的语言（仅保留需要的4种语言）
const allLocales = [
  { code: "en", label: "English" },
  { code: "zh", label: "Chinese" },
  // { code: "ja", label: "Japanese" },  // 暂时注释，测试中文翻译
  // { code: "ko", label: "Korean" },     // 暂时注释，测试中文翻译
];

// 并发配置
const CONCURRENT_BATCH_SIZE = 6;
const BATCH_DELAY_MS = 200;

// 分片翻译配置
const MAX_CHUNK_SIZE = 5000;
const CHUNK_BATCH_SIZE = 10;

// 从 allLocales 生成语言映射
const languageMap: Record<string, string> = Object.fromEntries(
  allLocales.map((locale: any) => [locale.code, locale.label])
);

// 添加 tw 的特殊映射（因为 tw 实际对应繁体中文）
languageMap.tw = "Traditional Chinese";

const openai = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL || "https://ismaque.org/v1",
  apiKey: process.env.OPENAI_API_KEY || "sk-yuxwdMSXor5s2wUjHu3dUwrgkuYuLNbEWFf7acOIXbdQQ5eb",
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

  return `You are a professional translator.
Your task is to translate the string values within JSON objects.

Rules:
1. Translate accurately, conveying the original meaning.
2. **Maintain the original JSON structure.** Do not translate keys, only string values.
3. **TRANSLATE all user-facing text**, including:
   - Text content in component attribute values (e.g., title="Properties" → title="属性")
   - Descriptions, explanations, and documentation text
   - Section titles and headings (unless specified in do-not-translate list)
   - Any text that users will read in the UI or documentation
4. Preserve proper nouns, brand names, and specific technical terms.
5. **Keep original Markdown formatting EXACTLY**, including:
   - Bold: **text** → **翻译** (NO space between ** and text)
   - Italic: *text* → *翻译*
   - Links: [text](url) → [翻译](url)
   - Lists, code formatting, etc.
   - ⚠️ CRITICAL: **text** must become **翻译**, NOT ** 翻译** (no space after opening **)
   - **Punctuation: Keep English colons (:) as-is, do NOT convert to Chinese colon (：)**
   - Example: "Limitation: text" → "限制: 文本" (keep the English colon :)
6. **Ensure all quotes within JSON string values are properly escaped.**
7. **Do NOT translate:**
   - Code blocks (content between \`\`\` markers)
   - Inline code (content between \` markers)
   - URLs and file paths
   - Component names (e.g., <Card>, <ParamField>, <Expandable>)
   - Component attribute names (e.g., "title", "type", "required" - the key names themselves)
   - Technical terms in code contexts (variable names, function names)
   - API endpoints and method names${preserveH2 ? "\n   - **Markdown headers starting with ## (keep them in original language)**" : ""}
   - Lines that contain only technical terms or API names${termsSection}

8. **Important distinction:**
   - ❌ DO NOT translate: <Expandable title="Properties"> (the component name and attribute name)
   - ✅ DO translate: The attribute VALUE "Properties" → <Expandable title="属性">
   - ❌ DO NOT translate: <ParamField body="model" type="string"> (attribute names like "body", "type")
   - ✅ DO translate: Text content inside components

9. **Preserve all MDX/JSX component syntax exactly as-is.**${headersSection}

Output Format:
Provide ONLY the resulting JSON object where the original string values have been replaced by their translations.
Do not include any explanations, comments, code block markers, or any other text.`;
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

// 段落级 Hash 映射
interface SectionHashMap {
  [sectionId: string]: string;  // sectionId -> hash
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

// 生成 MDX 文件
function generateMdxFile(frontmatter: string, content: string): string {
  if (frontmatter) {
    return `---\n${frontmatter}\n---\n${content}`;
  }
  return content;
}

// 发现英文目录下的所有 MDX 文件
function findAllEnMdxFiles(projectPath: string): Array<{ filePath: string; relativePath: string }> {
  const enDir = join(projectPath, "en");
  const results: Array<{ filePath: string; relativePath: string }> = [];

  if (!existsSync(enDir)) {
    console.log(`⚠️  en/ 目录不存在，请先创建 en/ 目录并将英文文档放入其中`);
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
          // 相对于 en/ 目录的路径
          const relativePath = relative(enDir, itemPath);
          results.push({ filePath: itemPath, relativePath });
        }
      }
    } catch (error) {
      console.warn(`⚠️  扫描目录失败 ${currentPath}:`, error);
    }
  }

  scanDirectory(enDir);
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

// 读取段落级 Hash 映射
function loadSectionHashMap(hashFilePath: string): SectionHashMap {
  if (!existsSync(hashFilePath)) {
    return {};
  }

  try {
    const content = readFileSync(hashFilePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

// 保存段落级 Hash 映射
function saveSectionHashMap(hashFilePath: string, hashMap: SectionHashMap) {
  try {
    const hashDir = dirname(hashFilePath);
    if (!existsSync(hashDir)) {
      mkdirSync(hashDir, { recursive: true });
    }
    writeFileSync(hashFilePath, JSON.stringify(hashMap, null, 2), "utf-8");
  } catch (error) {
    console.warn(`  ⚠️  保存段落 hash 失败: ${error}`);
  }
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

  let mdxFiles = findAllEnMdxFiles(projectPath);
  if (mdxFiles.length === 0) {
    console.log("❌ 未找到任何 .mdx 文件");
    return;
  }

  // 如果指定了特定文件，过滤文件列表
  if (specificFiles.length > 0) {
    const normalizedSpecific = specificFiles.map((f) =>
      f.replace(/^en\//, "").replace(/\\/g, "/")
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
    console.log(`🔍 发现 ${mdxFiles.length} 个英文 .mdx 文件\n`);
  }

  // 从 allLocales 获取所有语言代码（排除 en）
  const targetLanguages = allLocales.filter((locale) => locale.code !== "en");

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const { filePath, relativePath } of mdxFiles) {
    // 生成 hash 文件路径（保存段落级 hash 的 JSON 文件）
    const hashPath = join(
      projectPath,
      "en",
      dirname(relativePath),
      `.${basename(relativePath)}.sections.json`
    );

    try {
      // 1. 解析英文源文件，分割成段落
      const enMdxContent = parseMdxFile(filePath);
      const enSections = splitMdxIntoSections(enMdxContent);

      // 2. 读取段落 hash 映射
      const storedHashMap = loadSectionHashMap(hashPath);

      // 3. 检测变更
      const changes = detectSectionChanges(enSections, storedHashMap);
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
        console.log(`📄 处理: en/${relativePath}`);
        console.log(
          `  🔍 变更: +${changes.added.length} ~${changes.modified.length} -${changes.deleted.length} =${changes.unchanged.length}`
        );
      } else {
        console.log(`📄 强制翻译: en/${relativePath}`);
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
            let existingTargetSections: Map<string, MdxSection> = new Map();
            if (existsSync(targetPath) && !forceUpdate) {
              try {
                const targetMdxContent = parseMdxFile(targetPath);
                const targetSections = splitMdxIntoSections(targetMdxContent);
                for (const section of targetSections) {
                  existingTargetSections.set(section.id, section);
                }
              } catch (error) {
                console.warn(`  ⚠️  无法读取现有翻译: ${error}`);
              }
            }

            // 构建最终的段落列表
            const finalSections: MdxSection[] = [];

            for (const enSection of enSections) {
              const needsTranslation =
                forceUpdate ||
                changes.added.includes(enSection.id) ||
                changes.modified.includes(enSection.id);

              if (needsTranslation) {
                // 翻译这个段落
                const sectionObj = { [enSection.id]: enSection.content };
                const translatedObj = await translateText(
                  "English",
                  locale.label,
                  sectionObj
                );
                const translatedContent = translatedObj[enSection.id];

                finalSections.push({
                  ...enSection,
                  content: translatedContent,
                });
              } else if (existingTargetSections.has(enSection.id)) {
                // 复用现有翻译
                finalSections.push(existingTargetSections.get(enSection.id)!);
              } else {
                // 如果既不需要翻译又没有现有翻译，翻译它
                const sectionObj = { [enSection.id]: enSection.content };
                const translatedObj = await translateText(
                  "English",
                  locale.label,
                  sectionObj
                );
                const translatedContent = translatedObj[enSection.id];

                finalSections.push({
                  ...enSection,
                  content: translatedContent,
                });
              }
            }

            // 从段落重建完整的 MDX 文件
            const translatedMdxContent = rebuildMdxFromSections(finalSections);

            // 保存文件
            writeFileSync(targetPath, translatedMdxContent.fullText, "utf-8");

            const changedCount = forceUpdate
              ? enSections.length
              : changes.added.length + changes.modified.length;

            console.log(
              `  ✅ ${locale.code}/${relativePath}: 翻译 ${changedCount} 个段落`
            );
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

      // 翻译成功后，保存段落 hash 映射
      const newHashMap = generateSectionHashMap(enSections);
      saveSectionHashMap(hashPath, newHashMap);
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
