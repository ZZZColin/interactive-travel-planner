<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElButton, ElDatePicker, ElInput, ElInputNumber, ElOption, ElPopover, ElRadioButton, ElRadioGroup, ElSelect, ElTag } from 'element-plus'
import { billingUnitLabels, createExpenseDraft, expenseCategoryMeta, expenseItemAmountRange, expenseStatusMeta, formatMoney } from '../../domain/budget'
import type { ExpenseBillingUnit, ExpenseCategory, ExpenseItem, ExpenseOwnerType, ExpenseStatus, TransportMode } from '../../domain/types'
import { usePlannerStore } from '../../stores/planner'

const props = withDefaults(defineProps<{
  ownerType: ExpenseOwnerType
  ownerId: string
  title: string
  defaultCategory?: ExpenseCategory
  buttonLabel?: string
  transportMode?: TransportMode
}>(), { defaultCategory: 'other', buttonLabel: '' })

const store = usePlannerStore()
const open = ref(false)
const previewOpen = ref(false)
const editingId = ref<string | null>(null)
const inlineDrafts = ref<Record<string, { amount: number | null; minAmount: number | null; maxAmount: number | null }>>({})
const inlineSaveTimers = new Map<string, number>()
const pendingInlineItems = new Map<string, ExpenseItem>()
const priceMode = ref<'fixed' | 'range'>('fixed')
const draft = ref<ExpenseItem>(createExpenseDraft(props.ownerType, props.ownerId, props.defaultCategory))
const error = ref('')
const categories = Object.keys(expenseCategoryMeta) as ExpenseCategory[]
const statuses: ExpenseStatus[] = ['estimated', 'confirmed', 'paid', 'free', 'unknown']
const units = Object.keys(billingUnitLabels) as ExpenseBillingUnit[]
const items = computed(() => store.expensesForOwner(props.ownerType, props.ownerId))
const automaticLines = computed(() => props.ownerType === 'segment'
  ? store.getBudgetSummary(1).lines.filter((line) => line.ownerType === 'derived' && line.ownerId === props.ownerId && line.status !== 'unknown')
  : [])

function itemAmount(item: ExpenseItem): number | null {
  return expenseItemAmountRange(item)?.expected ?? null
}

const ownerTotal = computed(() => items.value.reduce((sum, item) => sum + (itemAmount(item) ?? 0), 0) + automaticLines.value.reduce((sum, line) => sum + line.expected, 0))
const hasUnknown = computed(() => items.value.some((item) => itemAmount(item) == null))
const hasPreview = computed(() => items.value.length > 0 || automaticLines.value.length > 0)
const referenceText = computed(() => {
  if (props.buttonLabel) return props.buttonLabel
  if (!hasPreview.value) return '+ 费用'
  if (!ownerTotal.value && hasUnknown.value) return '待核价'
  return formatMoney(ownerTotal.value)
})

function newDraft(): void {
  editingId.value = null
  priceMode.value = 'fixed'
  draft.value = createExpenseDraft(props.ownerType, props.ownerId, props.defaultCategory)
  draft.value.transportMode = props.transportMode
  error.value = ''
}

function edit(item: ExpenseItem): void {
  editingId.value = item.id
  draft.value = JSON.parse(JSON.stringify(item)) as ExpenseItem
  priceMode.value = item.minAmount != null || item.maxAmount != null ? 'range' : 'fixed'
  error.value = ''
}

function resetInlineDrafts(): void {
  inlineDrafts.value = Object.fromEntries(items.value.map((item) => [item.id, {
    amount: item.minAmount != null || item.maxAmount != null ? null : itemAmount(item),
    minAmount: item.minAmount,
    maxAmount: item.maxAmount,
  }]))
}

function inlineValue(item: ExpenseItem, field: 'amount' | 'minAmount' | 'maxAmount'): number | null {
  const current = inlineDrafts.value[item.id]
  if (current) return current[field]
  if (field === 'amount') return itemAmount(item)
  return item[field]
}

function persistInlineAmount(item: ExpenseItem): void {
  const values = inlineDrafts.value[item.id]
  if (!values) return
  const next = JSON.parse(JSON.stringify(item)) as ExpenseItem
  const rangeMode = item.minAmount != null || item.maxAmount != null
  if (rangeMode) {
    if (values.minAmount == null || values.maxAmount == null || values.maxAmount < values.minAmount) return
    if (item.minAmount === values.minAmount && item.maxAmount === values.maxAmount) return
    next.unitPrice = null
    next.minAmount = values.minAmount
    next.maxAmount = values.maxAmount
  } else {
    if (values.amount == null || values.amount < 0) return
    const currentAmount = itemAmount(item)
    if (currentAmount != null && Math.abs(currentAmount - values.amount) < 0.005) return
    if (next.quantity <= 0) next.quantity = 1
    next.unitPrice = values.amount / next.quantity
    next.minAmount = null
    next.maxAmount = null
  }
  if (next.status === 'unknown' || next.status === 'free') next.status = 'estimated'
  if ((next.status === 'confirmed' || next.status === 'paid') && !next.quotedAt) next.quotedAt = localDateKey()
  store.upsertExpense(next)
}

function flushInlineAmount(item: ExpenseItem): void {
  const timer = inlineSaveTimers.get(item.id)
  if (timer) window.clearTimeout(timer)
  inlineSaveTimers.delete(item.id)
  pendingInlineItems.delete(item.id)
  persistInlineAmount(item)
}

function updateInlineAmount(item: ExpenseItem, field: 'amount' | 'minAmount' | 'maxAmount', value: number | null | undefined): void {
  const current = inlineDrafts.value[item.id] ?? { amount: itemAmount(item), minAmount: item.minAmount, maxAmount: item.maxAmount }
  inlineDrafts.value[item.id] = { ...current, [field]: value ?? null }
  const existing = inlineSaveTimers.get(item.id)
  if (existing) window.clearTimeout(existing)
  pendingInlineItems.set(item.id, item)
  inlineSaveTimers.set(item.id, window.setTimeout(() => flushInlineAmount(item), 280))
}

function inlineRangeInvalid(item: ExpenseItem): boolean {
  const values = inlineDrafts.value[item.id]
  return Boolean(values && values.minAmount != null && values.maxAmount != null && values.maxAmount < values.minAmount)
}

function changeCategory(category: ExpenseCategory): void {
  const previousDefault = expenseCategoryMeta[draft.value.category].label
  draft.value.category = category
  if (!draft.value.name.trim() || draft.value.name === previousDefault) draft.value.name = expenseCategoryMeta[category].label
  draft.value.billingUnit = expenseCategoryMeta[category].unit
}

function localDateKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function save(): void {
  error.value = ''
  const item = { ...draft.value, name: draft.value.name.trim(), transportMode: props.transportMode ?? draft.value.transportMode }
  if (!item.name) { error.value = '请填写费用名称'; return }
  if (item.status === 'free' || item.status === 'unknown') {
    item.unitPrice = null
    item.minAmount = null
    item.maxAmount = null
  } else if (priceMode.value === 'fixed') {
    if (item.unitPrice == null) { error.value = '请填写单价'; return }
    item.minAmount = null
    item.maxAmount = null
  } else {
    item.unitPrice = null
    if (item.minAmount == null || item.maxAmount == null) { error.value = '请填写最低和最高总价'; return }
    if (item.maxAmount < item.minAmount) { error.value = '最高总价不能低于最低总价'; return }
  }
  if ((item.status === 'confirmed' || item.status === 'paid') && !item.quotedAt) item.quotedAt = localDateKey()
  store.upsertExpense(item)
  newDraft()
}

function statusType(status: ExpenseStatus): 'success' | 'warning' | 'info' | 'primary' | 'danger' {
  if (status === 'paid') return 'success'
  if (status === 'confirmed') return 'primary'
  if (status === 'unknown') return 'danger'
  if (status === 'free') return 'info'
  return 'warning'
}

watch(open, (value) => { if (value) newDraft() })
watch(previewOpen, (value) => { if (value) resetInlineDrafts() })
onBeforeUnmount(() => [...pendingInlineItems.values()].forEach((item) => flushInlineAmount(item)))
</script>

<template>
  <ElPopover v-model:visible="open" trigger="click" placement="bottom-start" :width="410" popper-class="expense-editor-popover">
    <template #reference>
      <span class="cost-chip-reference" @click.stop @mousedown.stop>
        <ElPopover v-model:visible="previewOpen" :disabled="!hasPreview" trigger="hover" placement="top" :width="360" :show-after="280" :hide-after="180" popper-class="expense-hover-preview">
          <template #reference>
            <ElButton text size="small" class="cost-chip" :class="{ empty: !hasPreview, unknown: hasUnknown }">
              <i class="pi pi-wallet" />{{ referenceText }}
            </ElButton>
          </template>
          <div class="expense-hover-content">
            <header><strong>费用明细</strong><b>{{ formatMoney(ownerTotal) }}</b></header>
            <div v-for="item in items" :key="item.id" class="expense-hover-row always-editable" :class="{ range: item.minAmount != null || item.maxAmount != null, invalid: inlineRangeInvalid(item) }">
              <span><b>{{ item.name }}</b><small>{{ expenseStatusMeta[item.status].label }} · {{ item.sourceLabel || '用户录入' }}</small></span>
              <div v-if="item.minAmount != null || item.maxAmount != null" class="expense-inline-range" @click.stop @mousedown.stop>
                <ElInputNumber :model-value="inlineValue(item, 'minAmount')" aria-label="最低总价" :min="0" :max="10000000" :precision="2" :controls="false" placeholder="最低" @update:model-value="updateInlineAmount(item, 'minAmount', $event)" @blur="flushInlineAmount(item)" />
                <span>—</span>
                <ElInputNumber :model-value="inlineValue(item, 'maxAmount')" aria-label="最高总价" :min="0" :max="10000000" :precision="2" :controls="false" placeholder="最高" @update:model-value="updateInlineAmount(item, 'maxAmount', $event)" @blur="flushInlineAmount(item)" />
              </div>
              <div v-else class="expense-inline-money" title="编辑合计金额；保存后会按照当前数量自动换算单价" @click.stop @mousedown.stop>
                <span>¥</span>
                <ElInputNumber :model-value="inlineValue(item, 'amount')" class="expense-inline-amount" :aria-label="`${item.name}费用金额`" :min="0" :max="10000000" :precision="2" :controls="false" placeholder="待核价" @update:model-value="updateInlineAmount(item, 'amount', $event)" @blur="flushInlineAmount(item)" />
              </div>
            </div>
            <div v-for="line in automaticLines" :key="line.id" class="expense-hover-row automatic">
              <span><b>{{ line.name }}</b><small>{{ line.sourceLabel || '自动计算' }}</small></span>
              <strong>{{ formatMoney(line.expected) }}</strong>
            </div>
          </div>
        </ElPopover>
      </span>
    </template>

    <div v-if="open" class="expense-editor">
      <header><div><strong>{{ title }}</strong><span>每个数字都保留状态和来源</span></div><ElButton v-if="editingId" text size="small" @click="newDraft">取消编辑</ElButton></header>

      <div v-if="items.length" class="expense-owner-list">
        <div v-for="item in items" :key="item.id" class="expense-owner-row">
          <span class="expense-category-dot" :class="`category-${item.category}`" />
          <div><b>{{ item.name }}</b><small>{{ item.quantity }} {{ billingUnitLabels[item.billingUnit] }} · {{ item.sourceLabel || (item.source === 'manual' ? '用户录入' : item.source) }}{{ item.quotedAt ? ` · ${item.quotedAt} 核价` : '' }}</small></div>
          <ElTag :type="statusType(item.status)" size="small" effect="light">{{ expenseStatusMeta[item.status].label }}</ElTag>
          <strong>{{ itemAmount(item) == null ? '待核价' : formatMoney(itemAmount(item)!) }}</strong>
          <ElButton text circle size="small" title="编辑费用" @click="edit(item)"><i class="pi pi-pencil" /></ElButton>
          <ElButton text circle size="small" type="danger" title="删除费用" @click="store.deleteExpense(item.id)"><i class="pi pi-trash" /></ElButton>
        </div>
      </div>
      <div v-if="automaticLines.length" class="expense-auto-list">
        <div v-for="line in automaticLines" :key="line.id" class="expense-auto-row"><i class="pi pi-calculator" /><div><b>{{ line.name }}</b><small>{{ line.sourceLabel || '根据当前路线自动计算' }}</small></div><ElTag type="warning" size="small" effect="light">预计</ElTag><strong>{{ formatMoney(line.expected) }}</strong></div>
      </div>

      <div class="expense-form">
        <div class="expense-form-grid">
          <label><span>费用类别</span><ElSelect :model-value="draft.category" :teleported="false" @change="changeCategory"><ElOption v-for="category in categories" :key="category" :label="expenseCategoryMeta[category].label" :value="category" /></ElSelect></label>
          <label><span>费用名称</span><ElInput v-model="draft.name" /></label>
        </div>
        <div class="expense-form-grid three">
          <label><span>状态</span><ElSelect v-model="draft.status" :teleported="false"><ElOption v-for="status in statuses" :key="status" :label="expenseStatusMeta[status].label" :value="status" /></ElSelect></label>
          <label><span>数量</span><ElInputNumber v-model="draft.quantity" :min="0" :max="9999" :step="1" controls-position="right" /></label>
          <label><span>计费单位</span><ElSelect v-model="draft.billingUnit" :teleported="false"><ElOption v-for="unit in units" :key="unit" :label="billingUnitLabels[unit]" :value="unit" /></ElSelect></label>
        </div>
        <template v-if="draft.status !== 'free' && draft.status !== 'unknown'">
          <ElRadioGroup v-model="priceMode" size="small"><ElRadioButton value="fixed">固定单价</ElRadioButton><ElRadioButton value="range">总价区间</ElRadioButton></ElRadioGroup>
          <label v-if="priceMode === 'fixed'"><span>单价（元）</span><ElInputNumber v-model="draft.unitPrice" :min="0" :max="10000000" :precision="2" controls-position="right" /></label>
          <div v-else class="expense-form-grid"><label><span>最低总价（元）</span><ElInputNumber v-model="draft.minAmount" :min="0" :max="10000000" :precision="2" controls-position="right" /></label><label><span>最高总价（元）</span><ElInputNumber v-model="draft.maxAmount" :min="0" :max="10000000" :precision="2" controls-position="right" /></label></div>
        </template>
        <div class="expense-form-grid"><label><span>价格来源</span><ElInput v-model="draft.sourceLabel" placeholder="官方公众号、订单或报价平台" /></label><label><span>核价日期</span><ElDatePicker v-model="draft.quotedAt" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" :teleported="false" clearable /></label></div>
        <label><span>备注 / 核价依据</span><ElInput v-model="draft.note" placeholder="例如：含摆渡车，不含索道；出发前需复核" /></label>
        <div v-if="error" class="expense-form-error"><i class="pi pi-exclamation-circle" />{{ error }}</div>
        <div class="expense-form-actions"><span>{{ editingId ? '正在编辑已有费用' : '新增费用项目' }}</span><ElButton type="primary" size="small" @click="save">{{ editingId ? '保存修改' : '添加费用' }}</ElButton></div>
      </div>
    </div>
  </ElPopover>
</template>
