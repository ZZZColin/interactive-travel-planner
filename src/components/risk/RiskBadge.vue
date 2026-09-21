<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElPopover, ElTag } from 'element-plus'
import { highestRiskSeverity, type RiskSignal, type RiskSeverity } from '../../risk/engine'
import { currentLocale } from '../../i18n'

const props = defineProps<{ risks: RiskSignal[] }>()
const open = ref(false)
const severity = computed(() => highestRiskSeverity(props.risks) ?? 'info')
const severityLabel: Record<RiskSeverity, string> = { info: '提示', attention: '注意', warning: '警告', critical: '严重' }
const tagType: Record<RiskSeverity, 'info' | 'warning' | 'danger'> = { info: 'info', attention: 'warning', warning: 'warning', critical: 'danger' }

function timeText(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(currentLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}
</script>

<template>
  <ElPopover v-model:visible="open" trigger="hover" placement="left-start" :width="330" :show-after="240" popper-class="risk-preview-popover">
    <template #reference>
      <button type="button" class="risk-badge" :class="`risk-${severity}`" :title="`${risks.length} 项风险提示`" @click.stop="open = !open" @mousedown.stop><i class="pi pi-exclamation-triangle" /><span>{{ risks.length }}</span></button>
    </template>
    <div class="risk-preview">
      <header><div><strong>风险提示</strong><span>{{ risks.length }} 项</span></div><ElTag :type="tagType[severity]" effect="light" size="small">最高{{ severityLabel[severity] }}</ElTag></header>
      <div class="risk-preview-list">
        <article v-for="risk in risks" :key="risk.id" class="risk-preview-item" :class="`risk-${risk.severity}`">
          <div class="risk-preview-title"><i /><strong>{{ risk.title }}</strong><span>{{ severityLabel[risk.severity] }}</span></div>
          <p>{{ risk.description }}</p>
          <small v-if="risk.sourceProvider">来源：{{ risk.sourceProvider }}</small>
          <small v-if="risk.effectiveAt || risk.expiresAt">有效期：{{ timeText(risk.effectiveAt) || '当前' }}—{{ timeText(risk.expiresAt) || '待更新' }}</small>
          <ul v-if="risk.actions?.length"><li v-for="action in risk.actions" :key="action">{{ action }}</li></ul>
        </article>
      </div>
    </div>
  </ElPopover>
</template>
