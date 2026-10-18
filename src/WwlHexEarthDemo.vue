<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { VdButton, VdSwitch } from '@vanduo-oss/vd3';
import HexEarth from './components/HexEarth.vue';
import FloatingPanel from './components/FloatingPanel.vue';
import StatsPanel from './components/StatsPanel.vue';
import { defaultTierFor, HEX_SIZE, tiersFor, type GridTier } from './earth/world';
import { DEFAULT_REGION, REGIONS, type MapRegion } from './earth/regions';
import { statsStore } from './earth/stats';

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false });
const narrow = ref(typeof window !== 'undefined' && window.innerWidth <= 640);
const statsOpen = ref(false);
function resize() {
  const next = window.innerWidth <= 640;
  if (next !== narrow.value) {
    narrow.value = next;
    statsOpen.value = false;
  }
}
onMounted(() => window.addEventListener('resize', resize));
onBeforeUnmount(() => window.removeEventListener('resize', resize));
const resetKey = ref(0);
function toggleStats() {
  statsOpen.value = !statsOpen.value;
}
function resetLayout() {
  resetKey.value++;
  statsOpen.value = false;
}
const map = ref<InstanceType<typeof HexEarth> | null>(null);
const region = ref<MapRegion['id']>(DEFAULT_REGION);
const tier = ref<GridTier['id']>(narrow.value ? 'low' : defaultTierFor(DEFAULT_REGION));
const pathMode = ref(false);
const status = ref('loading map…');

/** On-screen hex radius in CSS px (canvas is drawn at engine scale). */
const hexPx = computed(() => Math.round(HEX_SIZE * statsStore.scale));

function setRegion(next: MapRegion['id']): void {
  if (region.value === next) return;
  region.value = next;
  const preferred = defaultTierFor(next);
  const offered = tiersFor(next);
  tier.value = offered.some((tier) => tier.id === preferred)
    ? preferred
    : (offered[0]?.id ?? 'low');
}

function setTier(next: GridTier['id']): void {
  if (tier.value === next) return;
  tier.value = next;
}
</script>

<template>
  <div class="wwl-earth-demo" :class="{ 'wwl-earth-embedded': props.embedded }">
    <FloatingPanel
      :open="true"
      :closable="false"
      name="controls"
      title="Controls"
      :initial-y="16"
      :reset-key="resetKey"
    >
      <div class="controls-chrome">
        <span class="brand">wwl-hex-earth</span>
        <div class="controls-actions">
          <button
            class="vd-btn vd-btn-ghost vd-btn-sm"
            type="button"
            data-testid="stats-toggle"
            :aria-expanded="statsOpen"
            @click="toggleStats"
          >
            Stats
          </button>
          <button
            class="vd-btn vd-btn-ghost vd-btn-sm"
            type="button"
            data-testid="reset-layout"
            @click="resetLayout"
          >
            Reset
          </button>
          <a
            v-if="props.embedded"
            class="vd-btn vd-btn-ghost vd-btn-sm"
            href="#demos"
            data-testid="back-to-demos"
            >Back to demos</a
          >
          <slot name="theme" />
        </div>
      </div>
      <div class="toolbar">
        <div class="segmented" role="group" aria-label="Map region">
          <button
            v-for="r in REGIONS"
            :key="r.id"
            class="seg-btn"
            :class="{ active: region === r.id }"
            type="button"
            :data-testid="`region-${r.id}`"
            @click="setRegion(r.id)"
          >
            {{ r.label }}
          </button>
        </div>

        <div class="segmented" role="group" aria-label="Resolution tier">
          <button
            v-for="t in tiersFor(region)"
            :key="t.id"
            class="seg-btn"
            :class="{ active: tier === t.id }"
            type="button"
            :data-testid="`tier-${t.id}`"
            @click="setTier(t.id)"
          >
            {{ t.label }}
          </button>
        </div>

        <div data-testid="path-mode">
          <VdSwitch v-model="pathMode" label="Path mode" size="sm" />
        </div>

        <span class="status" data-testid="status">{{ status }}</span>

        <div class="spacer"></div>

        <span class="zoom-readout" data-testid="zoom-readout" title="On-screen hex radius"
          >{{ hexPx }}px hex</span
        >

        <div class="zoom-group">
          <VdButton data-testid="zoom-out" variant="ghost" size="sm" @click="map?.zoomOut()"
            >−</VdButton
          >
          <VdButton data-testid="zoom-in" variant="ghost" size="sm" @click="map?.zoomIn()"
            >+</VdButton
          >
          <VdButton data-testid="zoom-fit" variant="ghost" size="sm" @click="map?.resetView()"
            >Fit</VdButton
          >
        </div>

        <VdButton
          data-testid="run-benchmarks"
          variant="ghost"
          size="sm"
          :disabled="statsStore.benchmarkRunning"
          @click="map?.runBenchmarks()"
          >{{ statsStore.benchmarkRunning ? 'Measuring…' : 'Run benchmarks' }}</VdButton
        >
      </div>
    </FloatingPanel>

    <HexEarth
      ref="map"
      :tier="tier"
      :region="region"
      :path-mode="pathMode"
      @status="status = $event"
    />

    <StatsPanel :open="statsOpen" :reset-key="resetKey" @close="statsOpen = false" />

    <footer class="hint">
      drag to pan · wheel or buttons to zoom (deep enough for close inspection) · click A then B in
      path mode
    </footer>
  </div>
</template>

<style scoped>
.wwl-earth-demo {
  position: relative;
  overflow: hidden;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  height: 100dvh;
}

.wwl-earth-embedded {
  height: 100%;
  flex: 1;
  min-height: 0;
}
.controls-chrome {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 14px 0;
}
.controls-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.controls-actions :is(a, button) {
  min-height: 32px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: var(--vd-bg-secondary);
  border-bottom: 1px solid var(--vd-border-color);
  flex-wrap: wrap;
}

.brand {
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--vd-text-muted);
  font-size: 12px;
}

.segmented {
  display: flex;
  flex-wrap: wrap;
  width: max-content;
  max-width: 100%;
  min-width: 0;
  border: 1px solid var(--vd-border-color);
  border-radius: 999px;
  overflow: hidden;
}

.seg-btn {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: var(--vd-text-muted);
  padding: 5px 12px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}

.seg-btn.active {
  background: var(--vd-color-primary);
  color: var(--vd-color-primary-contrast, #fff);
}

.status {
  color: var(--vd-text-muted);
  font-size: 13px;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spacer {
  flex: 1;
}

.zoom-group {
  display: inline-flex;
  gap: 4px;
}

.zoom-readout {
  font-size: 12px;
  color: var(--vd-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.hint {
  text-align: center;
  font-size: 12px;
  color: var(--vd-text-muted);
  padding: 4px 0 6px;
  background: var(--vd-bg-primary);
}
</style>
