import type { Mission, Driver } from '@/lib/types'

export interface LoadState {

  binsLoaded: number

  volumeLoadedM3: number

  maxBins: number

  maxVolumeM3: number
}

export function initLoadState(driver: Driver): LoadState {

  const dims    = driver.capacityDimensions
  const perBinM3 = driver.maxBinSizeM3 ?? 30
  const maxBins = dims?.nbBennes
    ? Math.max(1, dims.nbBennes)
    : (dims?.volume && perBinM3)
      ? Math.max(1, Math.floor(dims.volume / perBinM3))
      : Math.max(1, driver.vehicleCapacity ?? 1)
  const maxVolumeM3 = dims?.volume ?? (perBinM3 * maxBins)
  return { binsLoaded: 0, volumeLoadedM3: 0, maxBins, maxVolumeM3 }
}

export function needsDump(state: LoadState, mission: Mission): boolean {
  if (!isBinPickup(mission.type)) return false
  const binVolume = mission.binSizeM3 ?? 0
  return (
    state.binsLoaded >= state.maxBins ||
    (binVolume > 0 && state.volumeLoadedM3 + binVolume > state.maxVolumeM3)
  )
}

export function loadBin(state: LoadState, mission: Mission): LoadState {
  return {
    ...state,
    binsLoaded: state.binsLoaded + 1,
    volumeLoadedM3: state.volumeLoadedM3 + (mission.binSizeM3 ?? 0),
  }
}

export function dumpAll(state: LoadState): LoadState {
  return { ...state, binsLoaded: 0, volumeLoadedM3: 0 }
}

function isBinPickup(type: string): boolean {
  return type === 'RETIRER' || type === 'ECHANGER' || type === 'CHARGER_IMMEDIAT'
}

export function countDumpTrips(missions: Mission[], driver: Driver): number {
  let state = initLoadState(driver)
  let dumps = 0

  for (const m of missions) {
    if (isBinPickup(m.type)) {
      if (needsDump(state, m)) {
        dumps++
        state = dumpAll(state)
      }
      state = loadBin(state, m)
    }
  }

  if (state.binsLoaded > 0) dumps++

  return dumps
}
