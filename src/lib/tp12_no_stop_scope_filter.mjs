import path from "node:path"

import { writeJson } from "./io.mjs"
import {
  filterPerfectPrototype1dRegimeCellPack,
} from "./perfect_prototype_1d_regime_cell_pack_filter.mjs"
import {
  PERFECT_PROTOTYPE_1D_REGIME_CELL_LOW,
  PERFECT_PROTOTYPE_1D_REGIME_CELL_MID,
  PERFECT_PROTOTYPE_1D_REGIME_CELL_TOP,
} from "./perfect_prototype_1d_regime_cell_contract.mjs"
import {
  filterPerfectPrototypeTp12LowSubscopePack,
  PERFECT_PROTOTYPE_TP12_LOW_SUBSCOPE_GAP_TOP,
} from "./perfect_prototype_tp12_low_subscope_filter.mjs"

export const TP12_NO_STOP_SCOPE_ID_LOW_GAP_TOP = "LOW_GAP_TOP"
export const TP12_NO_STOP_SCOPE_ID_LOW = "LOW"
export const TP12_NO_STOP_SCOPE_ID_MID = "MID"
export const TP12_NO_STOP_SCOPE_ID_TOP = "TOP"

const toText = (value) => String(value ?? "").trim()

const TP12_NO_STOP_SCOPE_SPECS = Object.freeze([
  Object.freeze({
    scopeId: TP12_NO_STOP_SCOPE_ID_LOW_GAP_TOP,
    label: "LOW_GAP_TOP",
    filterKind: "low_subscope",
    filterId: PERFECT_PROTOTYPE_TP12_LOW_SUBSCOPE_GAP_TOP,
  }),
  Object.freeze({
    scopeId: TP12_NO_STOP_SCOPE_ID_LOW,
    label: "LOW",
    filterKind: "regime_cell",
    filterId: PERFECT_PROTOTYPE_1D_REGIME_CELL_LOW,
  }),
  Object.freeze({
    scopeId: TP12_NO_STOP_SCOPE_ID_MID,
    label: "MID",
    filterKind: "regime_cell",
    filterId: PERFECT_PROTOTYPE_1D_REGIME_CELL_MID,
  }),
  Object.freeze({
    scopeId: TP12_NO_STOP_SCOPE_ID_TOP,
    label: "TOP",
    filterKind: "regime_cell",
    filterId: PERFECT_PROTOTYPE_1D_REGIME_CELL_TOP,
  }),
])

export const listTp12NoStopScopeIds = () => TP12_NO_STOP_SCOPE_SPECS.map((entry) => entry.scopeId)

export const resolveTp12NoStopScopeSpec = (scopeId) =>
  TP12_NO_STOP_SCOPE_SPECS.find((entry) => entry.scopeId === toText(scopeId)) ?? null

export const filterTp12NoStopScopePack = async ({
  inputPath,
  outDir,
  scopeId,
  sourceRunId = null,
  sourceStageLabel = null,
  rowContract = "open_eval_recent_impulse_1d",
  requireNonEmpty = true,
} = {}) => {
  const scopeSpec = resolveTp12NoStopScopeSpec(scopeId)
  if (!scopeSpec) {
    throw new Error(`unknown TP12 no-stop scopeId=${scopeId}`)
  }
  let baseSummary
  if (scopeSpec.filterKind === "low_subscope") {
    baseSummary = await filterPerfectPrototypeTp12LowSubscopePack({
      inputPath,
      outDir,
      subscopeId: scopeSpec.filterId,
      sourceRunId,
      sourceStageLabel,
      rowContract,
      requireNonEmpty,
    })
  } else if (scopeSpec.filterKind === "regime_cell") {
    baseSummary = await filterPerfectPrototype1dRegimeCellPack({
      inputPath,
      outDir,
      cellId: scopeSpec.filterId,
      sourceRunId,
      sourceStageLabel,
      rowContract,
      requireNonEmpty,
    })
  } else {
    throw new Error(`unsupported TP12 no-stop scope filter kind=${scopeSpec.filterKind}`)
  }

  const summary = {
    ...(baseSummary && typeof baseSummary === "object" ? baseSummary : {}),
    scopeId: scopeSpec.scopeId,
    scopeLabel: scopeSpec.label,
    scopeFilterKind: scopeSpec.filterKind,
    scopeFilterId: scopeSpec.filterId,
  }
  const summaryPath = path.join(path.resolve(String(outDir ?? "").trim()), "filter_summary.json")
  await writeJson(summaryPath, summary)
  return summary
}
