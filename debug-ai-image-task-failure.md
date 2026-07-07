# Debug Session: ai-image-task-failure

## Status
- [OPEN]

## Symptom
- 用户在“AI一键生成图片”时看到图片任务请求，请求体包含 `workspace_id=21`、`model_version_id=2`、`operation_code=image.text_to_image`、`params={ ratio: "16:9", quality: "low", count: 1 }`。
- 当前需要确认失败发生在任务创建阶段，还是任务创建成功后的执行/轮询阶段。

## Falsifiable Hypotheses
1. `POST /api/v1/ai/tasks` 直接返回业务错误，说明是提交阶段失败。
2. `POST /api/v1/ai/tasks` 成功返回任务 ID，但后续 `GET /api/v1/ai/tasks/{id}` 进入 `failed` 或 `payment_failed`，说明是模型执行阶段失败。
3. 当前工作空间 `21` 的模型 `model_version_id=2` 与 `image.text_to_image` 的参数 schema 不匹配，导致后端校验失败。
4. 会话或鉴权在请求过程中触发了 `refresh`，真实失败被续期/重试链路掩盖，Network 面板里看到的是表象而不是根因。
5. 一键批量生成并发触发多条任务，其中部分任务成功、部分任务失败，用户看到的是混合请求，误以为同一条任务重复报错。

## Current Evidence
- 已确认前端“AI一键生成图片”会批量生成缺图主体，并且每个主体会经过“提示词润色 -> 创建图片任务 -> 轮询任务状态”的链路。
- 已确认 `workspace_id=21` 这一段属于真正的图片任务提交请求体，而不是预估或润色接口。
- 已确认本地 `.env.local` 配置了 `VITE_ZZH_REMOTE_ORIGIN=https://zzh-dev.zhongdahengrui.com`，开发环境会经由 Vite 代理访问真实后端。
- 已尝试本地打开 `http://127.0.0.1:4173/`，但当前环境无登录态，页面在鉴权阶段返回“未登录”，因此无法直接复现用户那次已登录会话下的任务响应。

## Next Steps
1. 由用户提供 `POST /api/v1/ai/tasks` 的 Response / Preview。
2. 由用户提供后续 `GET /api/v1/ai/tasks/{id}` 的最终 Response / Preview。
3. 对照响应中的 `status`、`code`、`error_message`，排除或确认以上假设。
