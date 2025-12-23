# 环境配置说明

## 配置文件位置

所有环境相关的 URL 配置都在 `snippets/_variables.mdx` 文件中统一管理。

## 如何修改环境配置

### 1. 修改 API 相关 URL

编辑 `snippets/_variables.mdx` 文件：

```javascript
export const dashboardUrl = 'https://test.aireiter.com';  // Dashboard 地址
export const apiKeyUrl = 'https://test.aireiter.com/keys'; // API Key 管理页面地址
```

**测试环境：**
- Dashboard: `https://test.aireiter.com`
- API Key 管理: `https://test.aireiter.com/keys`

**生产环境（示例）：**
- Dashboard: `https://apimart.ai`
- API Key 管理: `https://apimart.ai/console/token`

### 2. 修改 navbar 按钮链接

编辑 `docs.json` 文件的 `navbar.primary.href` 字段：

```json
{
  "navbar": {
    "primary": {
      "type": "button",
      "label": "Dashboard",
      "href": "https://test.aireiter.com"  // ← 修改这里
    }
  }
}
```

## 已配置化的文件

以下文件已经使用配置变量，无需手动修改：

### 中文文档 (zh/)
- `zh/overview.mdx`
- `zh/api-reference/images/gemini-3-pro/generation.mdx`
- `zh/api-reference/images/nano-banana/generation.mdx`
- `zh/api-reference/images/gpt-4o/generation.mdx`
- `zh/api-reference/images/seedream-4/generation.mdx`
- `zh/api-reference/images/seedream-4.5/generation.mdx`
- `zh/api-reference/videos/sora2/generation.mdx`
- `zh/api-reference/videos/sora2-pro/generation.mdx`
- `zh/api-reference/videos/veo3-1/generation.mdx`
- `zh/api-reference/videos/veo3-1-fast/generation.mdx`
- `zh/api-reference/tasks/status.mdx`

## 切换环境步骤

从测试环境切换到生产环境时：

1. 修改 `snippets/_variables.mdx`：
   ```javascript
   export const dashboardUrl = 'https://apimart.ai';
   export const apiKeyUrl = 'https://apimart.ai/console/token';
   ```

2. 修改 `docs.json` 中的 navbar.primary.href：
   ```json
   "href": "https://apimart.ai"
   ```

3. 保存后，Mintlify 会自动重新加载，所有页面的链接会自动更新

## 注意事项

- 修改 `snippets/_variables.mdx` 后，所有引用该变量的页面会自动更新
- `docs.json` 是 JSON 文件，无法引用 MDX 变量，需要手动修改
- 确保 URL 格式正确，不要在末尾添加斜杠 `/`
