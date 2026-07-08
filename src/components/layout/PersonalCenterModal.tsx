/*
  PersonalCenterModal — 「个人中心」个人资料弹窗(对齐 Figma「设置-个人中心」1391:9020)。
  左侧头像(可换,支持 JPG/PNG ≤2MB 本地预览)+ 右侧昵称(可改,x/10)/ 账号(只读不可改)。
  昵称保存走 PATCH /api/v1/me/profile(与团队管理里的改名同一接口),保存后刷新会话内当前用户。
  头像:先上传为素材并换取下载地址,再把 avatar_url 提交到 /api/v1/me/profile,
  保存成功后刷新当前用户资料;本地缓存仅作为接口未返回头像时的兜底。
*/
import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getAssetDownloadUrl, uploadAssetFile } from '@/api/business'
import { updateMyProfile, getCurrentUser } from '@/api/auth'
import { useCurrentUser, useWorkspaceId, useWorkspaceSessionStore } from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'
import { applyUserProfileOverrides, saveUserAvatarOverride } from '@/utils/profileOverrides'
import UserAvatar from '@/components/common/UserAvatar'
import './PersonalCenterModal.css'

// 昵称最大长度(Figma 计数器为 x/10)
const NAME_MAX = 10

// 递归深搜会话/用户对象里任意名为 mobile/phone/tel 的字段(/me 的手机号字段路径不固定)
function pickMobile(obj: any): string {
  if (!obj || typeof obj !== 'object') return ''
  const seen = new Set<any>()
  const stack: any[] = [obj]
  while (stack.length) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue
    seen.add(cur)
    for (const [k, v] of Object.entries(cur)) {
      if (v && typeof v === 'object') {
        stack.push(v)
        continue
      }
      if (/mobile|phone|tel/i.test(k) && v) return String(v)
    }
  }
  return ''
}

const CameraIcon = (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 8.5h3l1.2-2h6.6L16 8.5h3A1.5 1.5 0 0 1 20.5 10v7A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17v-7A1.5 1.5 0 0 1 5 8.5Z" />
    <circle cx="12" cy="13" r="3.2" />
  </svg>
)

export default function PersonalCenterModal({ onClose }: { onClose: () => void }) {
  const user = useCurrentUser() as any
  const workspaceId = useWorkspaceId()
  const session = useWorkspaceSessionStore((s) => s.authSession)
  const { showToast } = useToast()

  // 显示名以 nickname 优先(顶栏/成员列表都先读 nickname),故编辑对象即 nickname
  const initialName = String(user?.nickname ?? user?.name ?? user?.username ?? '').trim()
  const account = useMemo(
    () => String(user?.mobile || user?.phone || user?.account || user?.username || pickMobile(session) || ''),
    [user, session],
  )
  const currentAvatar = user?.avatar || user?.avatar_url || user?.avatarUrl || ''

  const [name, setName] = useState(initialName)
  // 本地预览(data URL);未选新头像时为空,回落当前头像
  const [avatarData, setAvatarData] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const shownAvatar = avatarData || currentAvatar
  const dirty = name.trim() !== initialName || Boolean(avatarData)

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许再次选择同一文件
    if (!file) return
    const okType = /image\/(jpeg|png)/i.test(file.type) || /\.(jpe?g|png)$/i.test(file.name)
    if (!okType) {
      showToast('仅支持 JPG、PNG 格式', 'error')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('图片大小不能超过 2MB', 'error')
      return
    }
    const reader = new FileReader()
    setAvatarFile(file)
    reader.onload = () => setAvatarData(String(reader.result || ''))
    reader.onerror = () => showToast('图片读取失败,请重试', 'error')
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (saving) return
    const next = name.trim()
    if (!next) {
      showToast('昵称不能为空', 'error')
      return
    }
    if (!dirty) {
      onClose()
      return
    }
    setSaving(true)
    try {
      let nextAvatarUrl = ''
      if (avatarFile) {
        const ws = Number(workspaceId || 0)
        if (!ws) throw new Error('未选择工作空间,暂时无法上传头像')
        const uploaded: any = await uploadAssetFile({ workspaceId: ws, file: avatarFile, source: 'avatar' })
        const assetId = Number(uploaded?.asset?.id || 0)
        if (!assetId) throw new Error('头像上传失败,未取得素材 ID')
        nextAvatarUrl = (await getAssetDownloadUrl({ workspaceId: ws, assetId }).catch(() => '')) || ''
        if (!nextAvatarUrl) throw new Error('头像上传失败,未取得图片地址')
      }
      const payload: Record<string, any> = {}
      if (next !== initialName) {
        payload.nickname = next
        payload.name = next
      }
      if (nextAvatarUrl) {
        payload.avatar_url = nextAvatarUrl
      }
      if (Object.keys(payload).length) {
        await updateMyProfile(payload)
      }
      if (nextAvatarUrl) {
        saveUserAvatarOverride(user, nextAvatarUrl)
      }
      // 刷新会话内当前用户(顶栏/个人面板即时更新);若接口暂未回传头像,再用本地缓存兜底。
      try {
        const me = await getCurrentUser()
        const mergedUser = applyUserProfileOverrides(me)
        useWorkspaceSessionStore.setState((s: any) =>
          s.authSession
            ? {
                authSession: {
                  ...s.authSession,
                  user: { ...s.authSession.user, ...mergedUser },
                },
              }
            : s,
        )
      } catch {
        // 刷新失败也把已改的字段乐观落到本地会话,避免界面回退。
        useWorkspaceSessionStore.setState((s: any) =>
          s.authSession
            ? {
                authSession: {
                  ...s.authSession,
                  user: {
                    ...s.authSession.user,
                    nickname: next,
                    name: next,
                    ...(nextAvatarUrl ? { avatar: nextAvatarUrl } : avatarData ? { avatar: avatarData } : {}),
                  },
                },
              }
            : s,
        )
      }
      showToast('保存成功', 'success')
      onClose()
    } catch (error: any) {
      const msg = String(error?.message || '保存失败')
      const duplicated =
        Number(error?.status) === 409 ||
        /重复|已存在|已被|占用|exist|taken|duplicat/i.test(`${error?.code || ''} ${msg}`)
      showToast(duplicated ? '该昵称已被占用,请换一个' : msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div
      className="pcm-mask"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="pcm-card" role="dialog" aria-label="个人中心" aria-modal="true">
        <h2 className="pcm-title">个人中心</h2>

        <div className="pcm-body">
          {/* 左:头像 + 上传提示 */}
          <div className="pcm-left">
            <div className="pcm-avatar">
              <UserAvatar
                src={shownAvatar}
                name={initialName || '用户'}
                className="pcm-avatar-img"
                fallbackClassName="pcm-avatar-fallback"
                alt="头像"
              />
              <button
                type="button"
                className="pcm-cam"
                aria-label="更换头像"
                title="更换头像"
                onClick={() => fileRef.current?.click()}
              >
                {CameraIcon}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png"
                className="pcm-file"
                onChange={onPickFile}
              />
            </div>
            <p className="pcm-hint">支持 JPG、PNG格式,大小不超过2MB</p>
          </div>

          {/* 右:昵称(可改)/ 账号(只读) */}
          <div className="pcm-right">
            <div className="pcm-field">
              <label className="pcm-label" htmlFor="pcm-nick">
                昵称
              </label>
              <div className="pcm-input">
                <input
                  id="pcm-nick"
                  className="pcm-input-el"
                  type="text"
                  value={name}
                  maxLength={NAME_MAX}
                  placeholder="请输入昵称"
                  onChange={(e) => setName(e.target.value)}
                />
                <span className="pcm-count">
                  {name.length}/{NAME_MAX}
                </span>
              </div>
            </div>

            <div className="pcm-field">
              <span className="pcm-label">账号</span>
              <div className="pcm-input pcm-input--disabled">
                <span className="pcm-account">{account || '—'}</span>
                <span className="pcm-account-tip">账号不可修改</span>
              </div>
            </div>
          </div>
        </div>

        {/* 底部:取消 / 保存 */}
        <div className="pcm-footer">
          <button type="button" className="pcm-btn pcm-btn--ghost" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="pcm-btn pcm-btn--save" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
