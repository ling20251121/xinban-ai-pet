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
- 通义千问、DeepSeek、豆包（火山方舟）、Kimi 四种服务端文本适配
- Qwen3-ASR Flash 服务端语音转写（30 秒 / 2.5 MB，不保存音频）
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
AI_PROVIDER=qwen
QWEN_API_KEY=你的服务端密钥
QWEN_BASE_URL=https://你的业务空间ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3.7-plus-2026-05-26
QWEN_ASR_MODEL=qwen3-asr-flash-2026-02-10

# 或 AI_PROVIDER=deepseek
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

- [阿里云 Model Studio](https://help.aliyun.com/zh/model-studio/what-is-model-studio)
- [Qwen3-ASR API](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)
- [DeepSeek API](https://api-docs.deepseek.com/)
- [火山方舟 Chat Completions](https://api.volcengine.com/api-docs/view?action=ChatCompletions&serviceCode=ark&version=2024-01-01)
- [Kimi API](https://platform.kimi.com/docs/overview)

Qwen 的默认文本和语音模型使用北京快照名称，便于研究复现。正式环境建议把
`QWEN_BASE_URL` 换成北京业务空间专属域名；代码只允许 HTTPS 的阿里云北京
Model Studio 域名，配置成其他主机时会安全降级，不会转发学生内容。

## 语音转写接口

前端向 `POST /api/voice/transcribe` 发送：

```json
{ "dataUrl": "data:audio/webm;base64,...", "mimeType": "audio/webm;codecs=opus" }
```

成功时返回 `{ "text": "转写文字", "urgent": false }`；若文字命中本地危机规则，
还会返回固定真人求助提示。服务端只接受 Qwen3-ASR 官方支持且浏览器
常见的 WebM、Ogg、MP3、WAV，校验真实解码体积不超过 2.5 MB、容器时长不超过
30 秒，并用供应商返回的计费时长再次核对。音频只在本次请求内存中存在，不写入
D1、R2 或应用日志；供应商返回的语言、情绪推断字段也会被忽略。Safari 常见的
MP4/M4A 不在当前 Qwen3-ASR Flash 官方格式清单中，因此界面会回退为文字输入。

容器时长解析只是对正常浏览器录音的快速拒绝，不是可抵御伪造媒体文件的安全边界；
供应商必须返回 `usage.seconds`，否则接口失败关闭。本原型另有单实例内存令牌桶
（按客户端地址的加盐散列）、并发上限和短时重复音频阻断，但它们不会跨 Worker
实例持久化。正式公开试点必须再配置 Cloudflare 平台级持久限流、反自动化、全局
并发/费用预算和告警；学校共享出口 IP 还需要按匿名会话细分，不能只按 IP 限制。

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
