import { describe, expect, it } from 'vitest'
import {
  GROUP_FRAME_PADDING,
  createGroupId,
  expandSelectionToGroups,
  formatGroupLabel,
  getGroupBounds,
  getNodeGroupId,
  getNodeGroupName,
  isCompleteGroupSelection,
  type GroupableNode,
} from '@/utils/canvasGrouping'

function node(id: string, groupId?: string, x = 0, y = 0, width = 100, height = 100): GroupableNode {
  return { id, position: { x, y }, width, height, data: groupId ? { groupId } : {} }
}

function namedNode(id: string, groupId: string, groupName: string, x = 0, y = 0): GroupableNode {
  return { id, position: { x, y }, width: 100, height: 100, data: { groupId, groupName } }
}

describe('canvasGrouping', () => {
  it('读分组标记时容忍缺失与空白', () => {
    expect(getNodeGroupId(node('a', 'g1'))).toBe('g1')
    expect(getNodeGroupId(node('b'))).toBe('')
    expect(getNodeGroupId({ id: 'c', position: { x: 0, y: 0 }, data: { groupId: '  ' } })).toBe('')
    expect(getNodeGroupId(null)).toBe('')
  })

  it('读分组名时容忍缺失与空白', () => {
    expect(getNodeGroupName(namedNode('a', 'g1', '主线镜头'))).toBe('主线镜头')
    expect(getNodeGroupName(node('b', 'g1'))).toBe('')
    expect(getNodeGroupName(null)).toBe('')
  })

  it('没起名的分组回退到带成员数的默认名，而不是显示空白', () => {
    expect(formatGroupLabel('', 3)).toBe('分组（3）')
    expect(formatGroupLabel('主线镜头', 3)).toBe('主线镜头')
  })

  it('分组 id 不会在同一毫秒内重复', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createGroupId()))
    expect(ids.size).toBe(50)
  })

  describe('expandSelectionToGroups', () => {
    it('选中组内一个成员即展开为整组——这是分组能一起拖动的前提', () => {
      const nodes = [node('a', 'g1'), node('b', 'g1'), node('c', 'g1'), node('d')]
      expect(expandSelectionToGroups(nodes, ['a']).sort()).toEqual(['a', 'b', 'c'])
    })

    it('未分组的节点原样保留，不会被顺带拉进任何组', () => {
      const nodes = [node('a', 'g1'), node('b', 'g1'), node('d')]
      expect(expandSelectionToGroups(nodes, ['d'])).toEqual(['d'])
    })

    it('跨组选中时两个组一起展开', () => {
      const nodes = [node('a', 'g1'), node('b', 'g1'), node('c', 'g2'), node('d', 'g2'), node('e')]
      expect(expandSelectionToGroups(nodes, ['a', 'c']).sort()).toEqual(['a', 'b', 'c', 'd'])
    })

    it('混选分组成员与散节点时，散节点也保留在结果里', () => {
      const nodes = [node('a', 'g1'), node('b', 'g1'), node('e')]
      expect(expandSelectionToGroups(nodes, ['a', 'e']).sort()).toEqual(['a', 'b', 'e'])
    })

    it('空选中返回空，不做任何展开', () => {
      expect(expandSelectionToGroups([node('a', 'g1')], [])).toEqual([])
    })
  })

  describe('isCompleteGroupSelection', () => {
    it('正好选中某组全部成员时判定为分组', () => {
      const nodes = [node('a', 'g1'), node('b', 'g1'), node('c')]
      expect(isCompleteGroupSelection(nodes, ['a', 'b'])).toBe(true)
    })

    it('只选中组里一部分不算——那时该给「打组」而不是「解组」', () => {
      const nodes = [node('a', 'g1'), node('b', 'g1'), node('c', 'g1')]
      expect(isCompleteGroupSelection(nodes, ['a', 'b'])).toBe(false)
    })

    it('选中里混着组外节点不算', () => {
      const nodes = [node('a', 'g1'), node('b', 'g1'), node('c')]
      expect(isCompleteGroupSelection(nodes, ['a', 'b', 'c'])).toBe(false)
    })

    it('两个不同组的成员凑在一起不算一个组', () => {
      const nodes = [node('a', 'g1'), node('b', 'g2')]
      expect(isCompleteGroupSelection(nodes, ['a', 'b'])).toBe(false)
    })

    it('全是未分组节点不算', () => {
      const nodes = [node('a'), node('b')]
      expect(isCompleteGroupSelection(nodes, ['a', 'b'])).toBe(false)
    })

    it('少于两个不算', () => {
      expect(isCompleteGroupSelection([node('a', 'g1')], ['a'])).toBe(false)
    })
  })

  describe('getGroupBounds', () => {
    it('尺寸以 React Flow 的实测值为准，不能只看顶层 width/height', () => {
      /*
       * 顶层 width/height 是「调用方显式指定的尺寸」，本项目并不写，节点上多数是空的；
       * 真实占位在 measured 上。只读顶层字段会让每个成员都按兜底的 250 计算，
       * 分组框比内容小一圈，节点就露在框外——这正是用户报的那个问题。
       */
      const nodes: GroupableNode[] = [
        { id: 'a', position: { x: 0, y: 0 }, measured: { width: 400, height: 300 }, data: { groupId: 'g1' } },
        { id: 'b', position: { x: 500, y: 0 }, style: { width: 320, height: 180 }, data: { groupId: 'g1' } },
      ]
      const [frame] = getGroupBounds(nodes)
      expect(frame.width).toBe(820 + GROUP_FRAME_PADDING * 2)
      expect(frame.height).toBe(300 + GROUP_FRAME_PADDING * 2)
    })

    it('三种尺寸来源都没有时才退回默认节点尺寸', () => {
      const nodes: GroupableNode[] = [
        { id: 'a', position: { x: 0, y: 0 }, data: { groupId: 'g1' } },
        { id: 'b', position: { x: 0, y: 0 }, data: { groupId: 'g1' } },
      ]
      const [frame] = getGroupBounds(nodes)
      expect(frame.width).toBe(250 + GROUP_FRAME_PADDING * 2)
    })

    it('按成员包围盒外扩固定留白', () => {
      const nodes = [node('a', 'g1', 0, 0, 100, 100), node('b', 'g1', 200, 50, 100, 100)]
      const [frame] = getGroupBounds(nodes)
      expect(frame.groupId).toBe('g1')
      expect(frame.x).toBe(-GROUP_FRAME_PADDING)
      expect(frame.y).toBe(-GROUP_FRAME_PADDING)
      expect(frame.width).toBe(300 + GROUP_FRAME_PADDING * 2)
      expect(frame.height).toBe(150 + GROUP_FRAME_PADDING * 2)
      expect(frame.memberCount).toBe(2)
    })

    it('只剩一个成员的组不再出框——多半是别的成员被删光了', () => {
      expect(getGroupBounds([node('a', 'g1'), node('b')])).toEqual([])
    })

    it('缺少尺寸时用默认节点尺寸兜底，不会算出 NaN 的框', () => {
      const nodes: GroupableNode[] = [
        { id: 'a', position: { x: 0, y: 0 }, data: { groupId: 'g1' } },
        { id: 'b', position: { x: 100, y: 0 }, data: { groupId: 'g1' } },
      ]
      const [frame] = getGroupBounds(nodes)
      expect(Number.isFinite(frame.width)).toBe(true)
      expect(frame.width).toBe(350 + GROUP_FRAME_PADDING * 2)
    })

    it('多个分组各自成框，顺序稳定', () => {
      const nodes = [node('a', 'g2'), node('b', 'g2'), node('c', 'g1'), node('d', 'g1')]
      expect(getGroupBounds(nodes).map((frame) => frame.groupId)).toEqual(['g1', 'g2'])
    })

    it('没有分组时返回空数组', () => {
      expect(getGroupBounds([node('a'), node('b')])).toEqual([])
    })

    it('带出分组名，供框上的标签显示', () => {
      const nodes = [namedNode('a', 'g1', '主线镜头'), namedNode('b', 'g1', '主线镜头', 200)]
      expect(getGroupBounds(nodes)[0].name).toBe('主线镜头')
    })

    it('成员间名字暂时不一致时取第一个有值的，不会退回空名', () => {
      // 增量同步中途可能出现这种瞬时状态：改名已写到一部分成员上
      const nodes = [node('a', 'g1'), namedNode('b', 'g1', '主线镜头', 200)]
      expect(getGroupBounds(nodes)[0].name).toBe('主线镜头')
    })

    it('全员未命名时 name 为空串，由展示层决定兜底文案', () => {
      expect(getGroupBounds([node('a', 'g1'), node('b', 'g1', 200)])[0].name).toBe('')
    })
  })
})
