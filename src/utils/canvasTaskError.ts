/**
 * 画布生成任务的错误文案改写。
 *
 * 后端的报错常是站在服务端/供应商视角写的（「素材类型不适用于当前操作，请检查素材角色…」，
 * 或直接甩英文原码「PROVIDER_FAILED / Google image billing usage is missing…」），用户既看不懂、
 * 也不知道该去改什么，甚至会把「供应商计费问题」误解成自己欠费。这里把这类报错改写成用户能据此
 * 行动的说法——只改「说法」，不改判断逻辑（判断仍以后端返回为准）。
 */

/**
 * 供应商账户/计费/接入点/限流等「服务级」失败的识别（PROVIDER_FAILED 10502、Google 图片计费缺失、
 * 火山 AccountOverdue / InvalidEndpointOrModel / 配额限流等）：平台侧的模型服务问题，不是用户能修的。
 * 单独抽成常量，供文案改写规则与 isCanvasProviderServiceError 共用同一套判定。
 */
const PROVIDER_SERVICE_RE =
  /PROVIDER_FAILED|billing usage|AccountOverdue|AccountForbidden|InvalidEndpointOrModel|EndpointIsInvalid|ModelNotOpen|ModelNotFound|QuotaExceeded|RateLimitExceeded|ThrottlingException|ServiceUnavailable|InvalidAccessKey|SignatureDoesNotMatch|AccessDenied/i

/**
 * 命中即改写的规则表。
 *
 * 用关键词而不是整句匹配：后端同一类错误在不同接口上的措辞会有出入（标点、后缀不一），
 * 整句比对迟早会漏掉一种写法，用户就又看到那句原文了。
 */
const REWRITE_RULES: { match: RegExp; text: string }[] = [
  {
    // INVALID_MODEL_PARAMS：素材不适用于当前操作——可能是这张素材本身不是可用的生成输入
    // （上传/入库未完成、类型不符），也可能是该模型不接受这种输入。优先引导换素材，再兜底换模型。
    match: /素材类型不适用于当前操作|素材角色|INVALID_MODEL_PARAMS/i,
    text: '该素材不适用于当前操作，请重新上传或更换素材后重试；也可尝试更换其他模型',
  },
  {
    // 供应商账户/计费/接入点/限流等「服务级」失败——见 PROVIDER_SERVICE_RE。
    match: PROVIDER_SERVICE_RE,
    text: '该模型的服务商暂时不可用（计费未配置或额度/接入异常），请更换其他模型后重试，或联系管理员',
  },
]

/** 把后端错误文案改写成用户能据此行动的说法；没有命中规则时原样返回。 */
export function humanizeCanvasTaskError(message: unknown): string {
  const text = String(message ?? '').trim()
  if (!text) return ''
  const hit = REWRITE_RULES.find((rule) => rule.match.test(text))
  return hit ? hit.text : text
}

/**
 * 是否是「供应商服务级」失败（PROVIDER_FAILED / 计费 / 接入 / 限流等）。
 *
 * 这类失败后端会以业务错误码信封（如 code 10502）返回，requestJson 会直接 throw，
 * 于是画布轮询走进 catch，被误当成「状态查询失败，稍后自动重试」而反复空转。
 * 轮询侧用它判定：确认是这类终态失败时，落一个失败态 + 友好文案，别再让用户干等重试。
 */
export function isCanvasProviderServiceError(message: unknown): boolean {
  const text = String(message ?? '')
  return text ? PROVIDER_SERVICE_RE.test(text) : false
}
