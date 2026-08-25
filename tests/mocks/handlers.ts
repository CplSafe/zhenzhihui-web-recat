import { http, HttpResponse, type RequestHandler } from 'msw'

/**
 * 素材流式下载。
 *
 * 全站的播放器与抽帧都会经 seekableMediaSource 抓一次整片（/download 不支持 Range，
 * 只有换成本地副本才能跳转），所以这条必须常驻——否则任何渲染视频的用例都会撞上
 * onUnhandledRequest: 'error'。返回一小段字节即可，jsdom 不会真的去解码。
 */
const assetDownload = http.get('/api/v1/assets/:assetId/download', () =>
  HttpResponse.arrayBuffer(new Uint8Array([0, 0, 0, 24]).buffer, {
    headers: { 'Content-Type': 'video/mp4' },
  }),
)

/**
 * 需求市场 / 社区接口的空页兜底：AppTopbar 的通知铃铛与首页 IP/需求市场 Tab 会在挂载后拉取，
 * 没有这些常驻 handler 时任何渲染顶栏的用例都会撞上 onUnhandledRequest: 'error'。
 */
const emptyPage = () => HttpResponse.json({ code: 0, data: { items: [], total: 0, limit: 100, offset: 0 } })
const marketAndCommunityFallbacks = [
  http.get('/api/v1/market/me/demands', emptyPage),
  http.get('/api/v1/market/me/applications', emptyPage),
  http.get('/api/v1/market/demands', emptyPage),
  http.get('/api/v1/community/users', emptyPage),
  http.get('/api/v1/community/works', emptyPage),
]

/** Shared deterministic API handlers. Individual tests may add scenario-specific handlers with server.use(). */
export const handlers: RequestHandler[] = [assetDownload, ...marketAndCommunityFallbacks]
