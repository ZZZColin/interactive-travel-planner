import { computed, onBeforeUnmount, onMounted, reactive, type Ref } from 'vue'

export interface FloatingPanelDefaults {
  top: number
  right: number
}

export function useFloatingPanel(container: Ref<HTMLElement | null>, defaults: FloatingPanelDefaults) {
  const position = reactive<{ x: number | null; y: number }>({ x: null, y: defaults.top })
  let cleanup: (() => void) | null = null

  const style = computed(() => position.x === null
    ? { right: `${defaults.right}px`, top: `${position.y}px` }
    : { left: `${position.x}px`, top: `${position.y}px` })

  function clamp(x: number, y: number, panel: HTMLElement): { x: number; y: number } {
    const root = container.value
    if (!root) return { x, y }
    return {
      x: Math.max(8, Math.min(x, root.clientWidth - panel.offsetWidth - 8)),
      y: Math.max(8, Math.min(y, root.clientHeight - panel.offsetHeight - 8)),
    }
  }

  function start(event: PointerEvent): void {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea, select, a')) return
    const root = container.value
    const handle = event.currentTarget as HTMLElement
    const panel = handle.closest('.floating-map-panel') as HTMLElement | null ?? handle
    if (!root || !panel) return

    event.preventDefault()
    const rootRect = root.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const originX = panelRect.left - rootRect.left
    const originY = panelRect.top - rootRect.top
    const pointerX = event.clientX
    const pointerY = event.clientY
    document.body.classList.add('is-panel-dragging')

    const move = (moveEvent: PointerEvent) => {
      const next = clamp(originX + moveEvent.clientX - pointerX, originY + moveEvent.clientY - pointerY, panel)
      position.x = next.x
      position.y = next.y
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      document.body.classList.remove('is-panel-dragging')
      cleanup = null
    }
    cleanup = end
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
  }

  function reset(): void {
    position.x = null
    position.y = defaults.top
  }

  function keepInBounds(): void {
    if (position.x === null) return
    const root = container.value
    if (!root) return
  }

  onMounted(() => window.addEventListener('resize', keepInBounds))
  onBeforeUnmount(() => {
    cleanup?.()
    window.removeEventListener('resize', keepInBounds)
  })

  return { style, start, reset }
}
