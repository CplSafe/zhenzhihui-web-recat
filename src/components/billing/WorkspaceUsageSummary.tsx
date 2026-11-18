import type { WorkspaceCanvasUsageSummary } from '@/api/canvasApi'
import { formatCredits } from '@/utils/creditsFormat'
import './WorkspaceUsageSummary.css'

export default function WorkspaceUsageSummary({
  summary,
  period = '累计',
}: {
  summary: WorkspaceCanvasUsageSummary
  period?: string
}) {
  // Older API versions expose assigned canvas costs only; never present that
  // partial figure as the complete workspace total during a rolling release.
  if (summary.workspace_total_used_credits == null || summary.unassigned_used_credits == null) return null
  return (
    <section className="workspace-usage-summary" aria-label="团队消耗对账">
      <h2>团队{period}消耗</h2>
      <dl>
        <div>
          <dt>团队总消耗</dt>
          <dd>
            {formatCredits(summary.workspace_total_used_credits, 3)} <small>积分</small>
          </dd>
        </div>
        <div>
          <dt>已归属画布</dt>
          <dd>
            {formatCredits(summary.total_used_credits, 3)} <small>积分</small>
          </dd>
        </div>
        <div>
          <dt>历史未分配</dt>
          <dd>
            {formatCredits(summary.unassigned_used_credits, 3)} <small>积分</small>
          </dd>
        </div>
      </dl>
      <p>
        团队总消耗 = 已归属画布 +
        历史未分配。仅计实际结算，不含冻结；未分配含尚无画布归属的其他消费，不会重复计入各画布。
      </p>
    </section>
  )
}
