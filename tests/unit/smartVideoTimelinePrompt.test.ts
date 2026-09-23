import { describe, expect, it } from 'vitest'
import {
  buildPhysicalInteractionGenerationGuidance,
  buildSegmentEditPolishContext,
  buildTimelinePrompt,
  buildVideoEditPolishContext,
} from '@/api/smartVideo'
import { buildRealPersonVideoIdentityConstraint } from '@/utils/smartRealPerson'

const shots = [
  { no: '分镜1', desc: '人物走进店里', duration: '5s', line: '这家店我来对了' },
  { no: '分镜2', desc: '特写产品', duration: '5s' },
]

describe('buildTimelinePrompt', () => {
  it('为视频修改润色构建带精确边界的分镜时间线', () => {
    const context = buildVideoEditPolishContext([
      { desc: '扳手夹紧六角螺母', duration: '3s' },
      { desc: '扳手水平旋转拧紧螺母', duration: '3s' },
      { desc: '工具静置展示', duration: '3s' },
    ])

    expect(context).toContain('当前视频分镜时间线（权威上下文）')
    expect(context).toContain('00:00–00:03 镜头1：扳手夹紧六角螺母')
    expect(context).toContain('00:03–00:06 镜头2：扳手水平旋转拧紧螺母')
    expect(context).toContain('00:06–00:09 镜头3：工具静置展示')
    expect(buildVideoEditPolishContext([])).toBe('')
  })
  it('分段修改润色上下文只列选中秒数范围内的镜头', () => {
    const timeline = [
      { desc: '扳手夹紧六角螺母', duration: '3s' },
      { desc: '扳手水平旋转拧紧螺母', duration: '3s' },
      { desc: '工具静置展示', duration: '3s' },
      { desc: '收尾 logo', duration: '3s' },
    ]
    const context = buildSegmentEditPolishContext(timeline, { start: 5, end: 10 })

    expect(context).toContain('【本次修改范围】00:05–00:10（共约 5 秒）')
    expect(context).toContain('范围外的画面与原音轨保持不变')
    // 00:03–00:06 与 00:06–00:09、00:09–00:12 都与 5–10 秒有交集；00:00–00:03 不在范围内
    expect(context).not.toContain('镜头1')
    expect(context).toContain('00:03–00:06 镜头2：扳手水平旋转拧紧螺母')
    expect(context).toContain('00:06–00:09 镜头3：工具静置展示')
    expect(context).toContain('00:09–00:12 镜头4：收尾 logo')

    // 没有分镜（如从项目管理直接进入的老草稿）时只给范围
    const bare = buildSegmentEditPolishContext([], { start: 0, end: 5 })
    expect(bare).toContain('【本次修改范围】00:00–00:05')
    expect(bare).not.toContain('该范围内的镜头画面')
  })
  it('不传身份约束时保持原样，仍以时间线说明开头', () => {
    const prompt = buildTimelinePrompt({ shots, basePrompt: '一条奶茶店广告' })
    expect(prompt.startsWith('请按照下面的时间线生成一条短视频广告')).toBe(true)
    expect(prompt).not.toContain('真人出镜身份强约束')
    expect(prompt).toContain('广告描述:一条奶茶店广告')
  })

  it('真人成片把身份约束放在时间线与广告描述之前', () => {
    const identityConstraint = buildRealPersonVideoIdentityConstraint('测试人物')
    const prompt = buildTimelinePrompt({ shots, basePrompt: '一条奶茶店广告', identityConstraint })

    expect(prompt.startsWith('【真人出镜身份强约束：测试人物】')).toBe(true)
    expect(prompt.indexOf('真人出镜身份强约束')).toBeLessThan(prompt.indexOf('请按照下面的时间线'))
    expect(prompt.indexOf('真人出镜身份强约束')).toBeLessThan(prompt.indexOf('广告描述'))
    // 约束是附加项，不能吃掉原有的时间线内容
    expect(prompt).toContain('人物走进店里')
    expect(prompt).toContain('这家店我来对了')
  })

  it('空白约束按未传处理，不留空行', () => {
    const prompt = buildTimelinePrompt({ shots, identityConstraint: '   ' })
    expect(prompt.startsWith('请按照下面的时间线生成一条短视频广告')).toBe(true)
  })

  /*
   * 字幕开关必须严格跟着脚本走(产品确认的行为):
   * - 填了字幕 → 模型按镜头时间段「原样」显示指定文字,禁止改写(防乱码),
   *   且除指定字幕外不得出现其他文字;
   * - 全部删掉 → 完全禁止画面出现文字。模糊的「对齐字幕」指令曾让模型在
   *   删掉字幕后仍自己编出乱码字(Framora 1.0 实测)。
   */
  it('填了字幕:按镜头原样显示指定文本,其余文字仍被禁止', () => {
    const prompt = buildTimelinePrompt({
      shots: [
        { no: '分镜1', desc: '人物走进店里', duration: '5s', line: '这家店我来对了', subtitle: '新店开业全场8折' },
        { no: '分镜2', desc: '特写产品', duration: '5s' },
      ],
      basePrompt: '一条奶茶店广告',
    })

    expect(prompt).toContain('字幕(原样显示在画面下方):「新店开业全场8折」')
    expect(prompt).toContain('不得改写、增减、翻译或变形')
    expect(prompt).toContain('未指定字幕的镜头不显示任何文字')
    expect(prompt).toContain('除各镜头指定的字幕外,画面中不得出现任何其他文字')
    // 旧版那句诱导模型自由发挥的「对齐字幕」指令不能回来
    expect(prompt).not.toContain('对齐画面、旁白、字幕')
  })

  /*
   * 旁白必须被「读出来」:此前提示词写「由后期配音完成」,等于告诉支持配音的模型
   * (万相 3.0/Framora 等)不要出声,成片只剩环境音效。改为明确要求普通话朗读+对口型;
   * 不支持配音的模型会忽略这条,无副作用。
   */
  it('填了旁白:要求作为音频朗读并对口型,文字仍不上画面', () => {
    const prompt = buildTimelinePrompt({ shots, basePrompt: '一条奶茶店广告' })

    expect(prompt).toContain('请将其作为音频用自然流畅的普通话朗读出来')
    expect(prompt).toContain('口型要与台词匹配')
    expect(prompt).toContain('旁白(用普通话配音朗读,文字不上画面):「这家店我来对了」')
    expect(prompt).not.toContain('由后期配音完成')
  })

  it('没有任何旁白时不出现朗读指令', () => {
    const prompt = buildTimelinePrompt({
      shots: [{ no: '分镜1', desc: '特写产品', duration: '5s' }],
      basePrompt: '一条奶茶店广告',
    })

    expect(prompt).not.toContain('朗读')
    expect(prompt).not.toContain('旁白(')
  })

  /*
   * 音频语义也跟脚本走:标注了什么配什么,全删则明确禁止模型自作主张配声音。
   * (完全静音还需入口「背景音」开关配合;这里锁的是提示词侧不再点菜。)
   */
  it('台词音效字幕全删:提示词明确不要任何人声/配乐/特效音,也无任何文字内容', () => {
    const prompt = buildTimelinePrompt({
      shots: [
        { no: '分镜1', desc: '人物走进店里', duration: '5s', line: '', subtitle: '', sfx: '' },
        { no: '分镜2', desc: '特写产品', duration: '5s' },
      ],
      basePrompt: '一条奶茶店广告',
    })

    expect(prompt).toContain('不要添加任何旁白、人声、背景音乐与人为特效音')
    expect(prompt).not.toContain('朗读')
    expect(prompt).not.toContain('字幕(原样显示在画面下方)')
    expect(prompt).not.toContain('音效:')
    expect(prompt).toContain('画面中不得出现任何文字、字幕、标题、标语、水印或字符')
  })

  it('只有旁白没有音效:允许人声但不要配乐和特效音', () => {
    const prompt = buildTimelinePrompt({ shots, basePrompt: '一条奶茶店广告' })
    expect(prompt).toContain('除旁白人声外,不要添加背景音乐与人为特效音')
  })

  it('标注了音效:未标注的镜头不得加额外特效音', () => {
    const prompt = buildTimelinePrompt({
      shots: [{ no: '分镜1', desc: '开瓶', duration: '5s', sfx: '气泡声' }],
    })
    expect(prompt).toContain('音效标注用于生成对应的环境音与效果音')
    expect(prompt).toContain('未标注音效的镜头不要添加额外特效音')
    expect(prompt).toContain('音效:气泡声')
  })

  it('精细物理交互镜头追加结构、接触和受力连续性约束', () => {
    const prompt = buildTimelinePrompt({
      shots: [{ no: '分镜1', desc: '人物手持活动扳手缓慢拧紧管件接口', duration: '3s' }],
    })

    expect(prompt).toMatch(/精细物理交互.*关键结构完整.*夹持.*受力关系.*穿模.*微调手指/)
  })

  it('活动扳手旋转镜头补齐标准结构、受力面、旋转轴和运动平面规则', () => {
    const prompt = buildTimelinePrompt({
      shots: [
        {
          no: '分镜1',
          desc: '从俯视方向，右手使用活动扳手顺时针拧紧六角螺母',
          duration: '3s',
        },
      ],
    })

    expect(prompt).toMatch(/优先于普通画面描述[\s\S]*一个固定钳口.*一个活动钳口.*唯一开口/)
    expect(prompt).toMatch(/相对的两个平面.*不接触螺纹.*钳口间距/)
    expect(prompt).toMatch(/指定中心轴.*指定平面.*圆弧运动.*上下提拉/)
  })

  it('普通镜头不生成物理动作专项规则', () => {
    expect(buildPhysicalInteractionGenerationGuidance([{ desc: '城市夜景固定远景' }])).toBe('')
  })

  it.each([
    ['人物运动', '人物从起跑线快速奔跑后停下', /支撑脚.*重心转移.*结束姿态/],
    ['体育动作', '运动员起跳投篮，篮球飞向篮筐', /发力链.*释放时刻.*目标位置/],
    ['烹饪操作', '厨师用菜刀在砧板上切菜', /刀刃.*接触面.*手指避开刀刃/],
    ['产品操作', '双手拆封包装并打开瓶盖', /品牌外观.*可动部件.*开始状态.*结束状态/],
    ['多人互动', '两个人握手后分开', /肢体归属.*动作先后.*身份互换/],
    ['穿戴配饰', '女性戴上手表并整理头发', /左右侧.*佩戴身体部位.*最终朝向/],
    ['交通动作', '人物骑行自行车并捏下刹车', /车把.*踏板.*背景视差/],
    ['流体颗粒', '将饮料从瓶口倒入玻璃杯，液面上升', /实际出口.*流动轨迹.*液面/],
    ['镜头运动', '相机环绕产品后缓慢拉远', /相机位移.*光学变焦.*起止构图/],
  ])('%s场景仅按语义补充可执行规则', (_name, desc, expected) => {
    expect(buildPhysicalInteractionGenerationGuidance([{ desc }])).toMatch(expected)
  })

  it('动态规则不会把无关的活动扳手约束注入其他场景', () => {
    const guidance = buildPhysicalInteractionGenerationGuidance([{ desc: '人物起跳投篮，篮球飞向篮筐' }])
    expect(guidance).toContain('体育动作')
    expect(guidance).not.toContain('活动扳手专项')
    expect(guidance).not.toContain('烹饪操作')
  })

  it('普通无接触镜头不添加精细物理交互约束', () => {
    const prompt = buildTimelinePrompt({
      shots: [{ no: '分镜1', desc: '远景展示安静的城市夜景', duration: '3s' }],
    })

    expect(prompt).not.toContain('精细物理交互')
  })

  it('删光字幕:字幕文本与对齐指令都不进提示词,完全禁止画面文字', () => {
    const prompt = buildTimelinePrompt({
      shots: [
        { no: '分镜1', desc: '人物走进店里', duration: '5s', line: '这家店我来对了', subtitle: '' },
        { no: '分镜2', desc: '特写产品', duration: '5s', subtitle: '   ' },
      ],
      basePrompt: '一条奶茶店广告',
    })

    expect(prompt).not.toContain('字幕(原样显示在画面下方)')
    expect(prompt).not.toContain('部分镜头指定了字幕')
    // 旁白仍要求配音朗读,但文字不上画面
    expect(prompt).toContain('旁白(用普通话配音朗读,文字不上画面):「这家店我来对了」')
    expect(prompt).toContain('画面中不得出现任何文字、字幕、标题、标语、水印或字符')
  })
})
