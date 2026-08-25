#!/usr/bin/env bash
# Arm the pod's own kill timer. Sourced/run first by every bootstrap script,
# and runnable standalone so the smoke test can verify it.
#
# Needs RUNPOD_API_KEY + RUNPOD_POD_ID in the pod env (job.py sets both) and
# honours MAX_RUNTIME_SEC. Detached from the caller, so it survives the SSH
# session ending, the controlling process dying, or the network dropping.

FAILSAFE_LOG=${FAILSAFE_LOG:-/workspace/failsafe.log}
FAILSAFE_STAMP=/tmp/.selfdestruct_armed

if [ -z "${RUNPOD_API_KEY:-}" ] || [ -z "${RUNPOD_POD_ID:-}" ]; then
  echo "[failsafe] WARNING: RUNPOD_API_KEY/RUNPOD_POD_ID not in pod env; NOT armed"
  return 1 2>/dev/null || exit 1
fi

if [ -f "$FAILSAFE_STAMP" ]; then
  echo "[failsafe] already armed ($(cat $FAILSAFE_STAMP))"
  return 0 2>/dev/null || exit 0
fi

SECS=${MAX_RUNTIME_SEC:-7200}
echo "armed $(date -u +%FT%TZ) for ${SECS}s" > "$FAILSAFE_STAMP"

setsid nohup bash -c "
  sleep ${SECS}
  echo \"[failsafe] max runtime reached \$(date -u +%FT%TZ), terminating pod\" >> ${FAILSAFE_LOG}
  curl -s -X DELETE -H 'Authorization: Bearer ${RUNPOD_API_KEY}' \
    https://rest.runpod.io/v1/pods/${RUNPOD_POD_ID} >> ${FAILSAFE_LOG} 2>&1
" >/dev/null 2>&1 < /dev/null &
disown 2>/dev/null

echo "[failsafe] self-destruct armed: ${SECS}s from now (pod ${RUNPOD_POD_ID})"
