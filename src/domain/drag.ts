export type DragPayload =
  | { type: 'pool'; placeId: string }
  | { type: 'stop'; uid: string }

const mime = 'application/x-trip-planner'

export function writeDragPayload(event: DragEvent, payload: DragPayload): void {
  event.dataTransfer?.setData(mime, JSON.stringify(payload))
  event.dataTransfer?.setData('text/plain', JSON.stringify(payload))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

export function readDragPayload(event: DragEvent): DragPayload | null {
  const raw = event.dataTransfer?.getData(mime) || event.dataTransfer?.getData('text/plain')
  if (!raw) return null
  try {
    const payload = JSON.parse(raw) as DragPayload
    return payload.type === 'pool' || payload.type === 'stop' ? payload : null
  } catch {
    return null
  }
}
