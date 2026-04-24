export const buildCdLoopStepDLightProfile = ({
  stepDBaseCfg,
  scoringWorkers,
  workerChunkSize
}) => ({
  ...(stepDBaseCfg ?? {}),
  prepareLockboxDuringStepD: false,
  writeFeaturePackRows: false,
  persistOnlineFeaturePackRows: false,
  reuseRuntimeCache: true,
  keepWorkerPoolAlive: true,
  scoringWorkers,
  workerChunkSize
})

export const buildStepDC1FamilyProbeProfile = ({
  stepDBaseCfg,
  scoringWorkers,
  workerChunkSize
}) => ({
  ...(stepDBaseCfg ?? {}),
  prepareLockboxDuringStepD: false,
  writeFeaturePackRows: false,
  persistOnlineFeaturePackRows: false,
  persistOnlineAuditArtifactsInFastMode:
    stepDBaseCfg?.persistOnlineAuditArtifactsInFastMode === true,
  writeDecisionCandidatesIndex: false,
  reuseRuntimeCache: true,
  keepWorkerPoolAlive: true,
  sampledDebugLog: {
    ...((stepDBaseCfg ?? {}).sampledDebugLog ?? {}),
    enabled: stepDBaseCfg?.sampledDebugLog?.enabled === true
  },
  falsePositiveDataset: {
    ...((stepDBaseCfg ?? {}).falsePositiveDataset ?? {}),
    enabled: false
  },
  adversarialReplayDataset: {
    ...((stepDBaseCfg ?? {}).adversarialReplayDataset ?? {}),
    enabled: false
  },
  agreementDataset: {
    ...((stepDBaseCfg ?? {}).agreementDataset ?? {}),
    enabled: false
  },
  dayTypeDataset: {
    ...((stepDBaseCfg ?? {}).dayTypeDataset ?? {}),
    enabled: false
  },
  scoringWorkers,
  workerChunkSize
})
