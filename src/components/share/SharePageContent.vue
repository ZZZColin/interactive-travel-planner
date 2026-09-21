<script setup lang="ts">
import { computed } from 'vue'
import type { ShareDayDraft, ShareDraft, ShareStyleId } from '../../share/generator'

export interface SharePageModel {
  id: string
  kind: 'cover' | 'map' | 'overview' | 'day' | 'tips' | 'long'
  day?: ShareDayDraft
}

const props = defineProps<{
  page: SharePageModel
  draft: ShareDraft
  styleId: ShareStyleId
  meta: string
  metrics: string
  photo?: string
  mapImage?: string
}>()

const allPlaces = computed(() => props.draft.days.flatMap((day) => day.places).slice(0, 10))
const agendaGlyphs: Record<string, string> = { attraction: '景', food: '食', lodging: '住', viewpoint: '观', culture: '文', nature: '野', transport: '行', shopping: '购', other: '点' }
const factGlyphs: Record<string, string> = { weather: '天', lodging: '住', food: '食', transport: '行', budget: '¥', people: '人', schedule: '时', other: '记' }

function agendaGlyph(category: string): string { return agendaGlyphs[category] ?? '点' }
function factGlyph(kind: string): string { return factGlyphs[kind] ?? '记' }
</script>

<template>
  <article class="share-export-page" :class="[`share-style-${styleId}`, `share-kind-${page.kind}`, { 'share-has-background': Boolean(photo) }]">
    <div class="share-art-orb one" /><div class="share-art-orb two" />
    <template v-if="photo && page.kind !== 'cover' && page.kind !== 'map'"><img class="share-card-background" :src="photo" alt="卡片背景"><div class="share-card-background-shade" /></template>
    <template v-if="page.kind === 'cover'">
      <img v-if="photo" class="share-cover-photo" :src="photo" alt="旅行封面">
      <div class="share-cover-shade" />
      <header class="share-brand"><span>途</span><b>行途规划</b></header>
      <div class="share-cover-copy">
        <em>TRAVEL PLAN</em><h1>{{ draft.title }}</h1><h2>{{ draft.subtitle }}</h2><p>{{ draft.coverHook }}</p>
        <div class="share-cover-meta"><span>{{ meta }}</span><span>{{ metrics }}</span></div>
      </div>
      <div class="share-route-mini"><span v-for="(place,index) in allPlaces.slice(0,6)" :key="`${place}-${index}`"><i>{{ index+1 }}</i><b>{{ place }}</b></span></div>
    </template>

    <template v-else-if="page.kind === 'map'">
      <div class="share-map-page-image">
        <img v-if="mapImage" :src="mapImage" alt="全程路线地图">
        <div v-else class="share-map-fallback"><span v-for="(place,index) in allPlaces" :key="`${place}-${index}`"><i>{{ index+1 }}</i><b>{{ place }}</b></span></div>
      </div>
      <div class="share-map-page-overlay"><em>FULL ROUTE MAP</em><h1>{{ draft.title }}</h1><p>{{ metrics }}</p><span>{{ mapImage ? '高德静态路线图' : '路线示意图 · 配置高德 Web 服务 Key 后显示真实底图' }}</span></div>
      <footer class="share-page-footer"><span>{{ meta }}</span><b>行途规划</b></footer>
    </template>

    <template v-else-if="page.kind === 'overview'">
      <header class="share-page-header"><span>行程总览</span><b>{{ draft.title }}</b></header>
      <section class="share-overview-copy"><h2>{{ draft.coverHook }}</h2><p>{{ draft.overview }}</p></section>
      <div v-if="draft.overviewFacts.length" class="share-overview-facts"><article v-for="fact in draft.overviewFacts" :key="`${fact.kind}-${fact.label}`" :class="`fact-${fact.kind}`"><i>{{ factGlyph(fact.kind) }}</i><div><span>{{ fact.label }}</span><b>{{ fact.value }}</b></div></article></div>
      <div class="share-overview-days"><div v-for="day in draft.days" :key="day.label"><b>{{ day.label }}</b><span>{{ day.route || day.title }}</span></div></div>
      <footer class="share-page-footer"><span>{{ meta }}</span><b>行途规划</b></footer>
    </template>

    <template v-else-if="page.kind === 'day' && page.day">
      <header class="share-page-header"><span>{{ page.day.label }}</span><b>{{ draft.title }}</b></header>
      <section class="share-day-title"><em>DAY PLAN</em><h2>{{ page.day.title }}</h2><p>{{ page.day.summary }}</p></section>
      <ol v-if="page.day.agenda.length" class="share-agenda-list" :class="{ dense: page.day.agenda.length > 5 }">
        <li v-for="(item,index) in page.day.agenda.slice(0,7)" :key="`${item.name}-${index}`">
          <i :class="`agenda-${item.category}`">{{ agendaGlyph(item.category) }}</i>
          <div><header><b>{{ item.name }}</b><time v-if="item.time">{{ item.time }}</time></header><p><strong>{{ item.categoryLabel }}</strong><span v-if="item.detail">{{ item.detail }}</span></p></div>
        </li>
      </ol>
      <ol v-else class="share-place-list"><li v-for="(place,index) in page.day.places" :key="`${place}-${index}`"><i>{{ index+1 }}</i><span>{{ place }}</span></li></ol>
      <p v-if="page.day.agenda.length > 7" class="share-agenda-more">另有 {{ page.day.agenda.length - 7 }} 项安排，完整内容以计划为准</p>
      <div v-if="page.day.facts.length" class="share-day-facts"><article v-for="fact in page.day.facts" :key="`${fact.kind}-${fact.label}`" :class="`fact-${fact.kind}`"><i>{{ factGlyph(fact.kind) }}</i><div><span>{{ fact.label }}</span><b>{{ fact.value }}</b></div></article></div>
      <div v-if="page.day.highlights.length" class="share-highlights"><span v-for="item in page.day.highlights" :key="item">{{ item }}</span></div>
      <footer class="share-page-footer"><span>{{ meta }}</span><b>{{ page.day.label }}</b></footer>
    </template>

    <template v-else-if="page.kind === 'tips'">
      <header class="share-page-header"><span>出行提醒</span><b>{{ draft.title }}</b></header>
      <section class="share-tips"><h2>出发前再确认一次</h2><div v-for="(tip,index) in draft.tips" :key="tip"><i>{{ String(index+1).padStart(2,'0') }}</i><p>{{ tip }}</p></div></section>
      <div class="share-tags"><span v-for="tag in draft.hashtags" :key="tag">#{{ tag }}</span></div>
      <footer class="share-page-footer"><span>{{ metrics }}</span><b>行途规划</b></footer>
    </template>

    <template v-else>
      <header class="share-page-header"><span>完整行程</span><b>{{ draft.title }}</b></header>
      <section class="share-long-intro"><h1>{{ draft.title }}</h1><p>{{ draft.overview }}</p><div v-if="draft.overviewFacts.length" class="share-overview-facts"><article v-for="fact in draft.overviewFacts" :key="`${fact.kind}-${fact.label}`"><i>{{ factGlyph(fact.kind) }}</i><div><span>{{ fact.label }}</span><b>{{ fact.value }}</b></div></article></div></section>
      <div v-if="mapImage" class="share-long-map"><img :src="mapImage" alt="全程路线地图"></div>
      <section v-for="day in draft.days" :key="day.label" class="share-long-day">
        <div class="share-long-day-head"><b>{{ day.label }}</b><span>{{ day.route }}</span></div><h2>{{ day.title }}</h2><p>{{ day.summary }}</p>
        <ol class="share-long-agenda"><li v-for="(item,index) in day.agenda" :key="`${item.name}-${index}`"><i :class="`agenda-${item.category}`">{{ agendaGlyph(item.category) }}</i><div><b>{{ item.name }}</b><span>{{ [item.time, item.categoryLabel, item.detail].filter(Boolean).join(' · ') }}</span></div></li></ol>
        <div v-if="day.facts.length" class="share-long-facts"><span v-for="fact in day.facts" :key="`${fact.kind}-${fact.label}`"><b>{{ fact.label }}</b>{{ fact.value }}</span></div>
      </section>
      <section class="share-long-tips"><b>出行提醒</b><p v-for="tip in draft.tips" :key="tip">• {{ tip }}</p></section>
      <footer class="share-page-footer"><span>{{ meta }}</span><b>行途规划</b></footer>
    </template>
  </article>
</template>
