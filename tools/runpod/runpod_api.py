#!/usr/bin/env python3
"""Minimal RunPod API client: GPU pricing, pod lifecycle.

Auth: RUNPOD_API_KEY env var, or ~/.runpod/api_key (single line).
Uses the REST v1 API for pod lifecycle and GraphQL for GPU pricing
(the GraphQL `gpuTypes.lowestPrice` shape has been stable for years).
"""

import json
import os
import sys
import time
from pathlib import Path

import requests

REST = "https://rest.runpod.io/v1"
GRAPHQL = "https://api.runpod.io/graphql"


class RunpodError(RuntimeError):
    pass


def api_key() -> str:
    key = os.environ.get("RUNPOD_API_KEY", "").strip()
    if not key:
        p = Path.home() / ".runpod" / "api_key"
        if p.exists():
            key = p.read_text(encoding="utf-8").strip()
    if not key:
        raise RunpodError(
            "No RunPod API key. Set RUNPOD_API_KEY or write it to ~/.runpod/api_key"
        )
    return key


def _headers():
    return {"Authorization": f"Bearer {api_key()}", "Content-Type": "application/json"}


def _rest(method, path, **kw):
    r = requests.request(method, f"{REST}{path}", headers=_headers(), timeout=60, **kw)
    if r.status_code >= 400:
        raise RunpodError(f"{method} {path} -> {r.status_code}: {r.text[:500]}")
    return r.json() if r.text.strip() else {}


def _gql(query, variables=None):
    r = requests.post(
        GRAPHQL,
        params={"api_key": api_key()},
        json={"query": query, "variables": variables or {}},
        timeout=60,
    )
    if r.status_code >= 400:
        raise RunpodError(f"graphql -> {r.status_code}: {r.text[:500]}")
    data = r.json()
    if data.get("errors"):
        raise RunpodError(f"graphql errors: {json.dumps(data['errors'])[:500]}")
    return data["data"]


# ---------------------------------------------------------------- gpu selection

GPU_QUERY = """
query GpuTypes {
  gpuTypes {
    id
    displayName
    memoryInGb
    secureCloud
    communityCloud
    lowestPrice(input: {gpuCount: 1}) {
      uninterruptablePrice
      minimumBidPrice
      stockStatus
    }
  }
}
"""


def gpu_catalog():
    out = []
    for g in _gql(GPU_QUERY)["gpuTypes"]:
        lp = g.get("lowestPrice") or {}
        price = lp.get("uninterruptablePrice")
        out.append(
            {
                "id": g["id"],
                "name": g["displayName"],
                "vram": g.get("memoryInGb") or 0,
                "price": price,
                "stock": lp.get("stockStatus"),
                "secure": bool(g.get("secureCloud")),
                "community": bool(g.get("communityCloud")),
            }
        )
    return out


def pick_gpu(min_vram=24, max_price=0.60, exclude=()):
    """Cheapest GPU with >= min_vram GB, priced at or below max_price, in stock."""
    cands = [
        g
        for g in gpu_catalog()
        if g["vram"] >= min_vram
        and g["price"] is not None
        and g["price"] <= max_price
        and g["id"] not in exclude
        and (g["stock"] or "").lower() not in ("", "none")
    ]
    cands.sort(key=lambda g: (g["price"], -g["vram"]))
    if not cands:
        raise RunpodError(
            f"No GPU with >={min_vram}GB VRAM at or below ${max_price:.2f}/hr is in stock. "
            "Raise the budget or retry later."
        )
    return cands


# ---------------------------------------------------------------- pod lifecycle


def create_pod(
    name,
    image,
    gpu_type_ids,
    public_key,
    container_disk_gb=80,
    volume_gb=0,
    volume_mount="/workspace",
    env=None,
    cloud_type="SECURE",
    ports=("22/tcp",),
):
    body = {
        "name": name,
        "imageName": image,
        "gpuTypeIds": list(gpu_type_ids),
        "gpuCount": 1,
        "containerDiskInGb": container_disk_gb,
        "ports": list(ports),
        "cloudType": cloud_type,
        "env": {"PUBLIC_KEY": public_key, **(env or {})},
        "dockerStartCmd": [
            "bash",
            "-lc",
            "mkdir -p ~/.ssh && echo \"$PUBLIC_KEY\" >> ~/.ssh/authorized_keys "
            "&& chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys "
            "&& service ssh start 2>/dev/null || /usr/sbin/sshd; sleep infinity",
        ],
    }
    if volume_gb:
        body["volumeInGb"] = volume_gb
        body["volumeMountPath"] = volume_mount
    return _rest("POST", "/pods", json=body)


def get_pod(pod_id):
    return _rest("GET", f"/pods/{pod_id}")


def list_pods():
    r = _rest("GET", "/pods")
    return r if isinstance(r, list) else r.get("pods", r.get("data", []))


def terminate_pod(pod_id):
    try:
        _rest("DELETE", f"/pods/{pod_id}")
        return True
    except RunpodError as e:
        print(f"[runpod] terminate failed: {e}", file=sys.stderr)
        return False


def ssh_endpoint(pod):
    """Return (host, port) for the pod's public port 22, or (None, None)."""
    for p in pod.get("portMappings") or []:
        if isinstance(p, dict) and str(p.get("privatePort")) == "22":
            return pod.get("publicIp"), p.get("publicPort")
    pm = pod.get("portMappings")
    if isinstance(pm, dict) and "22" in pm:
        return pod.get("publicIp"), pm["22"]
    for rt in pod.get("runtime", {}).get("ports", []) or []:
        if rt.get("privatePort") == 22 and rt.get("isIpPublic"):
            return rt.get("ip"), rt.get("publicPort")
    return None, None


def wait_for_ssh(pod_id, timeout=900, poll=10):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        pod = get_pod(pod_id)
        status = pod.get("desiredStatus") or pod.get("status")
        host, port = ssh_endpoint(pod)
        if host and port:
            return pod, host, port
        if status != last:
            print(f"[runpod] pod {pod_id} status={status}", flush=True)
            last = status
        time.sleep(poll)
    raise RunpodError(f"pod {pod_id} did not expose SSH within {timeout}s")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "gpus"
    if cmd == "gpus":
        for g in pick_gpu(
            min_vram=int(sys.argv[2]) if len(sys.argv) > 2 else 24,
            max_price=float(sys.argv[3]) if len(sys.argv) > 3 else 0.60,
        )[:15]:
            print(f"{g['price']:>6.3f}/hr  {g['vram']:>3}GB  {g['stock']:<6} {g['id']}")
    elif cmd == "pods":
        for p in list_pods():
            print(p.get("id"), p.get("name"), p.get("desiredStatus"), p.get("machine", {}).get("gpuTypeId"))
    elif cmd == "kill":
        print(terminate_pod(sys.argv[2]))
