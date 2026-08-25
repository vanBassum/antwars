#!/usr/bin/env python3
"""Detached local failsafe: terminate a pod after N seconds, unconditionally.

Spawned by job.py the moment a pod is created, in its own process group, so it
keeps running if Claude/the terminal/the job dies. Deliberately dumb: it does
not check whether the job succeeded, because a job that is still running past
its own --max-runtime is exactly the case this exists to kill.

The pod stops billing when it is terminated, so an early kill costs nothing
beyond the work lost; a missed kill costs money indefinitely.

  RUNPOD_API_KEY=... python watchdog.py <pod_id> <delay_seconds>

The key comes from the environment, never argv - argv is visible to every
process on the machine.
"""

import os
import sys
import time

import requests


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    pod_id, delay = sys.argv[1], int(sys.argv[2])
    key = os.environ.get("RUNPOD_API_KEY", "").strip()
    if not key:
        return 2

    time.sleep(delay)

    # Already gone? Then the job finished cleanly and terminated it itself.
    try:
        r = requests.get(f"https://rest.runpod.io/v1/pods/{pod_id}",
                         headers={"Authorization": f"Bearer {key}"}, timeout=30)
        if r.status_code == 404:
            return 0
    except requests.RequestException:
        pass  # can't tell -> try to kill anyway

    for attempt in range(5):
        try:
            r = requests.delete(f"https://rest.runpod.io/v1/pods/{pod_id}",
                                headers={"Authorization": f"Bearer {key}"},
                                timeout=30)
            if r.status_code < 400 or r.status_code == 404:
                return 0
        except requests.RequestException:
            pass
        time.sleep(2 ** attempt * 5)
    return 1


if __name__ == "__main__":
    sys.exit(main())
