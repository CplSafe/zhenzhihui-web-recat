import { describe, expect, it } from 'vitest'
import homeIcon from '@/assets/sidebar/home.svg?raw'
import homeActiveIcon from '@/assets/sidebar/home-active.svg?raw'
import smartIcon from '@/assets/sidebar/smart.svg?raw'
import smartActiveIcon from '@/assets/sidebar/smart-active.svg?raw'
import projectsIcon from '@/assets/sidebar/projects.svg?raw'
import projectsActiveIcon from '@/assets/sidebar/projects-active.svg?raw'
import resourcesIcon from '@/assets/sidebar/resources.svg?raw'
import resourcesActiveIcon from '@/assets/sidebar/resources-active.svg?raw'
import settingsIcon from '@/assets/sidebar/settings.svg?raw'
import videoEditIcon from '@/assets/sidebar/videoedit.svg?raw'
import joinIcon from '@/assets/sidebar/join.svg?raw'

const sidebarIcons = [
  homeIcon,
  homeActiveIcon,
  smartIcon,
  smartActiveIcon,
  projectsIcon,
  projectsActiveIcon,
  resourcesIcon,
  resourcesActiveIcon,
  settingsIcon,
  videoEditIcon,
  joinIcon,
]

describe('侧栏 SVG 宽高比', () => {
  it.each(sidebarIcons.map((source, index) => [index, source] as const))(
    '图标 %s 始终保持原始比例',
    (_index, source) => {
      expect(source).toContain('preserveAspectRatio="xMidYMid meet"')
      expect(source).not.toContain('preserveAspectRatio="none"')
      expect(source).not.toMatch(/\bwidth="100%"/)
      expect(source).not.toMatch(/\bheight="100%"/)
    },
  )
})
