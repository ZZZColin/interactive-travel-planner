import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { aiProviderPresets } from '../ai/presets'
import { deleteAiSecret, readAiProviderState, readAiSecret, saveAiProviderState, saveAiSecret } from '../ai/storage'
import type { AiProviderProfile } from '../ai/types'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const useAiProvidersStore = defineStore('aiProviders', () => {
  const initial = readAiProviderState()
  const profiles = ref<AiProviderProfile[]>(initial.profiles)
  const activeId = ref(initial.activeId)
  const defaultProfile = computed(() => profiles.value.find((item) => item.id === activeId.value) ?? profiles.value[0] ?? null)
  const activeProfile = defaultProfile
  const configuredProfiles = computed(() => profiles.value.filter((profile) => Boolean(readAiSecret(profile.id).apiKey && profile.baseUrl && profile.model)))
  const defaultConfiguredProfile = computed(() => configuredProfiles.value.find((item) => item.id === activeId.value) ?? configuredProfiles.value[0] ?? null)
  const activeConfiguredProfile = defaultConfiguredProfile

  watch([profiles, activeId], () => saveAiProviderState({ profiles: profiles.value, activeId: activeId.value, defaultId: activeId.value }), { deep: true })

  function setDefault(id: string): void {
    if (profiles.value.some((item) => item.id === id)) activeId.value = id
  }

  const setActive = setDefault

  function updateProfile(profile: AiProviderProfile, apiKey: string, remember: boolean): void {
    const index = profiles.value.findIndex((item) => item.id === profile.id)
    if (index >= 0) profiles.value[index] = clone(profile)
    else profiles.value.push(clone(profile))
    if (!activeId.value || !profiles.value.some((item) => item.id === activeId.value)) activeId.value = profile.id
    saveAiSecret(profile.id, apiKey, remember)
  }

  function remove(id: string): void {
    profiles.value = profiles.value.filter((item) => item.id !== id)
    deleteAiSecret(id)
    if (activeId.value === id) activeId.value = profiles.value[0]?.id ?? ''
  }

  function applyPreset(profile: AiProviderProfile, presetId: string): AiProviderProfile {
    const preset = aiProviderPresets.find((item) => item.id === presetId)
    if (!preset) return profile
    return { ...profile, name: preset.name, presetId, protocol: preset.protocol, baseUrl: preset.baseUrl, models: [...preset.models], model: preset.models[0], contextWindowTokens: preset.contextWindowTokens, maxInputTokens: preset.maxInputTokens, maxOutputTokens: preset.maxOutputTokens }
  }

  return {
    profiles,
    activeId,
    activeProfile,
    defaultProfile,
    configuredProfiles,
    activeConfiguredProfile,
    defaultConfiguredProfile,
    setActive,
    setDefault,
    updateProfile,
    remove,
    applyPreset,
    readSecret: readAiSecret,
  }
})
