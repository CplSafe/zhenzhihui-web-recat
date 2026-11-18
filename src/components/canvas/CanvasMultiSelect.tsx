import { Button, Select, theme, type SelectProps } from 'antd'
import { useState } from 'react'

export function CanvasMultiSelect(props: SelectProps<number[]>) {
  const [open, setOpen] = useState(false)
  const { token } = theme.useToken()

  return (
    <Select<number[]>
      {...props}
      mode="multiple"
      showSearch
      allowClear
      optionFilterProp="label"
      maxTagCount={2}
      maxTagTextLength={16}
      maxTagPlaceholder={(hidden) => `+${hidden.length}`}
      style={{ width: '100%', minWidth: 0 }}
      styles={{ popup: { root: { zIndex: 1500 } } }}
      open={open && !props.disabled}
      onOpenChange={setOpen}
      popupRender={(menu) => (
        <>
          {menu}
          <div
            onMouseDown={(event) => event.preventDefault()}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              marginTop: 4,
              padding: '5px 6px 1px',
              color: token.colorTextSecondary,
              fontSize: token.fontSizeSM,
            }}
          >
            <span>已选 {props.value?.length ?? 0} 项</span>
            <Button size="small" type="link" htmlType="button" onClick={() => setOpen(false)}>
              完成
            </Button>
          </div>
        </>
      )}
    />
  )
}
