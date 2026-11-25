// One outstanding command per socket. Notifications can arrive independently
// from the command reply and never grant permission by themselves.
export function connectCanvasLockSocket<T>(
  path: string,
  onChanged: () => void,
  onRevision?: (revision: number) => void,
) {
  let socket: WebSocket | undefined
  let pending: { resolve: (state: T) => void; reject: (error: Error) => void; timeout: number } | undefined
  let reconnect: number | undefined
  let stopped = false

  function takePending() {
    const request = pending
    pending = undefined
    window.clearTimeout(request?.timeout)
    return request
  }

  function connect() {
    const url = new URL(path, window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    let connection: WebSocket
    try {
      connection = new WebSocket(url)
    } catch {
      return
    }
    socket = connection
    let opened = false
    connection.onopen = () => {
      opened = true
    }
    connection.onclose = () => {
      takePending()?.reject(new Error('Canvas lock connection closed'))
      if (opened && !stopped) reconnect = window.setTimeout(connect, 500)
    }
    connection.onmessage = ({ data }) => {
      try {
        const message = JSON.parse(data)
        if (message.type === 'changed') onChanged()
        else if (message.type === 'revision') {
          if (Number.isSafeInteger(message.revision) && message.revision >= 0) onRevision?.(message.revision)
        } else if (message.type === 'state') takePending()?.resolve(message.data)
        else takePending()?.reject(new Error('Canvas lock request rejected'))
      } catch {
        connection.close()
      }
    }
  }

  connect()
  return {
    send(body: string) {
      const connection = socket
      if (!connection || connection.readyState !== WebSocket.OPEN) return undefined
      return new Promise<T>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          takePending()?.reject(new Error('Canvas lock request timed out'))
          connection.close()
        }, 4000)
        pending = { resolve, reject, timeout }
        try {
          connection.send(body)
        } catch {
          takePending()?.reject(new Error('Canvas lock request could not be sent'))
          connection.close()
        }
      })
    },
    close() {
      stopped = true
      window.clearTimeout(reconnect)
      socket?.close()
    },
  }
}
