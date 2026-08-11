# 心伴 AI-Pet

面向中国中小学生的日常心情记录与真人支持研究原型。项目来自 EITT 2026 投稿材料，产品定位是：

> 学生自我记录 × AI 低压力回应 × 教师人工支持

AI 只负责倾听、整理和提供小步骤；它不是心理测评、诊断、治疗或自动转介工具。教师端优先展示班级聚合趋势，只在学生主动请求支持或出现明确安全信号时进入人工核对队列。

[打开 GitHub Pages 静态演示](https://ling20251121.github.io/xinban-ai-pet/)

演示页无需登录，不依赖 ChatGPT 或 OpenAI 账号。它不上传或长期保存输入、不连接模型 API、不发送危机通知；教师端仅使用完全虚构的脱敏样例。请勿在演示页填写真实个人信息。

![心伴 AI-Pet 分享封面](public/og.png)

## 已实现

- 学生匿名编号、每日心情、可选文字和小目标
- “仅保存”与“保存并请小伴回应”分开授权
- 学生查看、导出和删除自己的记录
- DeepSeek、豆包（火山方舟）、Kimi 三种服务端适配
- 模型未配置或故障时的安全示例回应
- 自伤/即时危险关键词先经本地规则处理，不发送给外部模型
- D1 持久化与教师密钥保护
- 教师端班级汇总、心情趋势、支持队列与人工核对流程
- 普通聊天默认不保存，也不在教师端展示

## 为什么不能只用 GitHub Pages

GitHub Pages 适合静态演示，但不能安全保存模型密钥、学生记录或教师权限。正确结构是：

```text
GitHub 公开源代码
        ↓ 部署
受保护的全栈服务 + D1 数据库
        ↓ 服务端调用
DeepSeek / 豆包 / Kimi
```

任何 API Key 都不能写进前端代码、`localStorage`、公开仓库或 `VITE_*` / `NEXT_PUBLIC_*` 变量。本项目使用服务端环境变量，并通过 `.gitignore` 排除真实配置。

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
pnpm install
pnpm run dev
```

复制 `.env.example` 为 `.env.local` 后填写配置。未配置模型时，学生端仍可使用内置的安全示例回应。

## 模型配置

只启用一个经过学校审批并写入隐私告知的供应商：

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的服务端密钥
DEEPSEEK_MODEL=deepseek-v4-flash

# 或 AI_PROVIDER=doubao
DOUBAO_API_KEY=你的服务端密钥
DOUBAO_MODEL=你的模型 ID 或 Endpoint ID

# 或 AI_PROVIDER=kimi
KIMI_API_KEY=你的服务端密钥
KIMI_MODEL=kimi-k3
```

模型名称会变化，上线前请以厂商官方文档为准：

- [DeepSeek API](https://api-docs.deepseek.com/)
- [火山方舟 Chat Completions](https://api.volcengine.com/api-docs/view?action=ChatCompletions&serviceCode=ark&version=2024-01-01)
- [Kimi API](https://platform.kimi.com/docs/overview)

## 数据与教师端配置

```env
PARTICIPANT_HASH_PEPPER=一段长期稳定的随机秘密
TEACHER_ACCESS_KEY=至少12位的教师访问密钥
```

- 学生编号应随机发放，不使用姓名、学号、手机号或学校名称。
- `PARTICIPANT_HASH_PEPPER` 变化后，旧编号将无法查找原记录。
- 教师访问密钥只通过 HTTPS 传输，前端不保存。
- 正式项目应接入学校身份认证、角色权限、MFA、访问审计和危机联系人送达确认；当前密钥方式仅适合受控研究原型。

## 正式试点前的门槛

本仓库可以演示产品与技术路线，但不等于已获准收集真实未成年人数据。正式让学生使用前至少需要：

- 学校伦理/信息安全审批、监护人同意和学生本人知情同意
- 单独的儿童个人信息处理规则、保存期限和撤回/删除流程
- 明确模型供应商、发送的数据类别、处理地点与第三方协议
- 学校危机联系人、送达确认、超时升级和假期预案
- 未成年人模式、AI 身份标识、现实提醒、使用时长限制和便捷退出
- 将教师身份认证从共享密钥升级为学校认可的账号与最小权限体系

## 构建

```bash
pnpm run db:generate
pnpm run build
```

项目使用 vinext、Cloudflare Workers 兼容输出、D1 与 Drizzle。数据库迁移保存在 `drizzle/`，部署配置位于 `.openai/hosting.json`。

## 研究声明

这是 EITT 2026 研究原型。界面与功能不能用来声称干预已被证实有效，不能用于成绩、纪律、升学、学生排名或教师绩效评价。
