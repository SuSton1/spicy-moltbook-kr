import path from "node:path"

export const PERFECT_PROTOTYPE_WORKER_SLOT_COMMAND_FILENAME = "slot_command.json"
export const PERFECT_PROTOTYPE_WORKER_SLOT_STATE_FILENAME = "slot_state.json"
export const PERFECT_PROTOTYPE_WORKER_SLOT_SESSION_FILENAME = "slot_session.json"
export const PERFECT_PROTOTYPE_WORKER_SLOT_POLL_MS = 50
export const PERFECT_PROTOTYPE_WORKER_SLOT_READY_TIMEOUT_MS = 120000

export const buildPerfectPrototypeWorkerSlotPaths = (slotDir) => {
  const resolvedSlotDir = path.resolve(slotDir)
  return {
    slotDir: resolvedSlotDir,
    commandPath: path.join(
      resolvedSlotDir,
      PERFECT_PROTOTYPE_WORKER_SLOT_COMMAND_FILENAME,
    ),
    statePath: path.join(
      resolvedSlotDir,
      PERFECT_PROTOTYPE_WORKER_SLOT_STATE_FILENAME,
    ),
    sessionPath: path.join(
      resolvedSlotDir,
      PERFECT_PROTOTYPE_WORKER_SLOT_SESSION_FILENAME,
    ),
  }
}
