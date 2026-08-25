#!/usr/bin/env python3
"""Run a GPU job on RunPod end-to-end: provision -> setup -> run -> fetch -> terminate.

Cost guards (hard defaults): <= $0.60/hr GPU, <= $2.00 per job, <= 2h runtime,
1 GPU. The pod also arms its own self-destruct timer, so paid compute cannot
outlive this process (Claude crash, closed terminal, dropped network).

  python tools/runpod/job.py generate --views <dir> --out <dir> --name Turret
  python tools/runpod/job.py status
  python tools/runpod/job.py kill-all
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import runpod_api as rp  # noqa: E402

MAX_GPU_PRICE = 0.60      # $/hr
MAX_JOB_COST = 2.00       # $
MAX_RUNTIME_SEC = 7200    # 2h
MIN_VRAM_GB = 24
IMAGE = "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04"

HERE = Path(__file__).parent
KEY = Path.home() / ".ssh" / "runpod_ed25519"
PUBKEY = Path(str(KEY) + ".pub")
STATE = HERE / ".job_state.json"

SSH_OPTS = [
    "-i", str(KEY),
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "LogLevel=ERROR",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=240",
]


def log(m):
    print(f"[job {time.strftime('%H:%M:%S')}] {m}", flush=True)


def ensure_key():
    if not KEY.exists():
        KEY.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["ssh-keygen", "-t", "ed25519", "-f", str(KEY), "-N", "",
             "-C", "runpod-claude"],
            check=True, capture_output=True,
        )
        log(f"generated ssh key {KEY}")
    return PUBKEY.read_text(encoding="utf-8").strip()


def ssh(host, port, cmd, check=True, stream=True):
    argv = ["ssh", *SSH_OPTS, "-p", str(port), f"root@{host}", cmd]
    if stream:
        p = subprocess.run(argv)
    else:
        p = subprocess.run(argv, capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(
            f"ssh failed ({p.returncode}): {cmd[:120]}\n{getattr(p, 'stderr', '')}"
        )
    return p


def scp(host, port, src, dst, to_remote=True):
    if to_remote:
        a, b = str(src), f"root@{host}:{dst}"
    else:
        a, b = f"root@{host}:{src}", str(dst)
    p = subprocess.run(["scp", *SSH_OPTS, "-P", str(port), "-r", a, b],
                       capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"scp failed: {p.stderr}")


def wait_ssh_ready(host, port, timeout=420):
    deadline = time.time() + timeout
    while time.time() < deadline:
        p = ssh(host, port, "echo ready", check=False, stream=False)
        if p.returncode == 0 and "ready" in (p.stdout or ""):
            return
        time.sleep(8)
    raise RuntimeError("SSH never became reachable")


def provision(args):
    pub = ensure_key()
    cands = rp.pick_gpu(MIN_VRAM_GB, args.max_price)
    log("cheapest in-stock candidates:")
    for g in cands[:6]:
        log(f"   ${g['price']:.3f}/hr  {g['vram']:>3}GB  {g['stock']:<6} {g['id']}")

    top = cands[0]
    est = top["price"] * (args.max_runtime / 3600.0)
    log(f"worst-case cost at max runtime: ${est:.2f} (cap ${MAX_JOB_COST:.2f})")
    if est > MAX_JOB_COST and not args.yes:
        raise SystemExit(
            f"Worst-case ${est:.2f} exceeds the ${MAX_JOB_COST:.2f} per-job cap. "
            "Lower --max-runtime or pass --yes."
        )

    pod = rp.create_pod(
        name=args.name,
        image=IMAGE,
        gpu_type_ids=[g["id"] for g in cands[:5]],  # fall through if the top is gone
        public_key=pub,
        container_disk_gb=args.disk,
        volume_gb=args.volume,
        env={
            "RUNPOD_API_KEY": rp.api_key(),   # used only by the pod-side self-destruct
            "MAX_RUNTIME_SEC": str(args.max_runtime),
        },
        cloud_type=args.cloud,
    )
    pod_id = pod.get("id") or pod.get("podId")
    log(f"created pod {pod_id} (target {top['id']} @ ${top['price']:.3f}/hr)")
    STATE.write_text(json.dumps(
        {"pod_id": pod_id, "started": time.time(), "price": top["price"]}))
    pod, host, port = rp.wait_for_ssh(pod_id, timeout=min(args.max_runtime, 900))
    log(f"ssh endpoint {host}:{port}")
    wait_ssh_ready(host, port)
    return pod_id, host, port, top["price"]


def cmd_generate(args):
    views = Path(args.views).resolve()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)

    pod_id = host = port = None
    price = 0.0
    t_start = time.time()
    try:
        if args.pod_id:
            pod_id = args.pod_id
            ensure_key()
            _, host, port = rp.wait_for_ssh(pod_id, timeout=600)
            log(f"attached to existing pod {pod_id} at {host}:{port}")
            wait_ssh_ready(host, port)
        else:
            pod_id, host, port, price = provision(args)

        ssh(host, port, "mkdir -p /workspace/job/views /workspace/job/out")
        scp(host, port, HERE / "bootstrap_hunyuan3d.sh", "/workspace/bootstrap.sh")
        scp(host, port, HERE / "remote_generate.py", "/workspace/remote_generate.py")
        for v in ("front", "back", "left", "right"):
            p = views / f"{v}.png"
            if p.exists():
                scp(host, port, p, f"/workspace/job/views/{v}.png")
            else:
                log(f"note: {v}.png missing, generating without it")

        log("=== bootstrapping pod (first run on a fresh volume: 10-20 min) ===")
        ssh(host, port, "bash /workspace/bootstrap.sh")

        log("=== generating ===")
        remote_cmd = (
            "cd /workspace && HF_HOME=/workspace/hf python remote_generate.py "
            "--views /workspace/job/views --out /workspace/job/out "
            f"--steps {args.steps} --octree {args.octree} --guidance {args.guidance} "
            f"--seed {args.seed} --num-chunks {args.num_chunks} "
            f"--target-faces {args.target_faces}"
            + (" --no-texture" if args.no_texture else "")
        )
        ssh(host, port, remote_cmd)

        log("=== fetching results ===")
        got = []
        for fn in ("mesh_textured.glb", "mesh_shape.glb"):
            p = ssh(host, port,
                    f"test -f /workspace/job/out/{fn} && echo yes || echo no",
                    check=False, stream=False)
            if "yes" in (p.stdout or ""):
                scp(host, port, f"/workspace/job/out/{fn}", out / fn, to_remote=False)
                got.append(fn)
        if not got:
            raise RuntimeError("no output mesh produced - check the log above")
        for fn in got:
            f = out / fn
            log(f"downloaded {f} ({f.stat().st_size / 1024:.0f} KB)")
        return 0
    finally:
        elapsed = time.time() - t_start
        if pod_id and not args.keep:
            log(f"terminating pod {pod_id} after {elapsed / 60:.1f} min "
                f"(~${price * elapsed / 3600:.2f})")
            rp.terminate_pod(pod_id)
            if STATE.exists():
                STATE.unlink()
        elif pod_id:
            log(f"--keep set: pod {pod_id} LEFT RUNNING and still billing. "
                f"Kill it with: python tools/runpod/job.py kill {pod_id}")


def cmd_turret(args):
    """Whole turret job in ONE pod session: full mesh + P3-SAM segmentation +
    three per-component generations. Bootstrapping twice would double the
    pod-hours, so everything shares the session and the /workspace volume."""
    inp = Path(args.inputs).resolve()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)

    pod_id = host = port = None
    price = 0.0
    t_start = time.time()
    try:
        if args.pod_id:
            pod_id = args.pod_id
            ensure_key()
            _, host, port = rp.wait_for_ssh(pod_id, timeout=600)
            log(f"attached to existing pod {pod_id} at {host}:{port}")
            wait_ssh_ready(host, port)
            st = json.loads(STATE.read_text()) if STATE.exists() else {}
            price = st.get("price", 0.0)
        else:
            pod_id, host, port, price = provision(args)

        ssh(host, port, "mkdir -p /workspace/job/in /workspace/job/out")
        for f in ("bootstrap_hunyuan3d.sh", "bootstrap_p3sam.sh",
                  "remote_generate.py", "remote_turret_pipeline.py"):
            scp(host, port, HERE / f, f"/workspace/{f}")
        for d in sorted(inp.glob("views_turret*")):
            if d.is_dir():
                scp(host, port, d, "/workspace/job/in/")
                log(f"uploaded {d.name}")

        log("=== bootstrap: Hunyuan3D-2 (10-20 min on a fresh volume) ===")
        ssh(host, port, "bash /workspace/bootstrap_hunyuan3d.sh")
        if not args.skip_segment:
            log("=== bootstrap: P3-SAM ===")
            ssh(host, port, "bash /workspace/bootstrap_p3sam.sh")

        log("=== running pipeline ===")
        cmd = (
            "cd /workspace && HF_HOME=/workspace/hf python -u remote_turret_pipeline.py "
            "--in /workspace/job/in --out /workspace/job/out "
            f"--steps {args.steps} --octree {args.octree} --guidance {args.guidance} "
            f"--seed {args.seed} --faces {args.target_faces} "
            f"--part-octree {args.part_octree} --part-faces {args.part_faces}"
            + (" --skip-parts" if args.skip_parts else "")
            + (" --skip-segment" if args.skip_segment else "")
        )
        ssh(host, port, cmd)

        log("=== fetching results ===")
        scp(host, port, "/workspace/job/out/.", out, to_remote=False)
        files = sorted(p for p in out.rglob("*") if p.is_file())
        for f in files:
            log(f"  {f.relative_to(out)}  {f.stat().st_size / 1024:.0f} KB")
        if not files:
            raise RuntimeError("nothing came back - check the log above")
        return 0
    finally:
        elapsed = time.time() - t_start
        if pod_id and not args.keep:
            log(f"terminating pod {pod_id} after {elapsed / 60:.1f} min "
                f"(~${price * elapsed / 3600:.2f})")
            rp.terminate_pod(pod_id)
            if STATE.exists():
                STATE.unlink()
        elif pod_id:
            log(f"--keep set: pod {pod_id} LEFT RUNNING and still billing. "
                f"Kill it with: python tools/runpod/job.py kill {pod_id}")


def cmd_kill(args):
    if getattr(args, "pod_id", None):
        print(rp.terminate_pod(args.pod_id))
        return 0
    pods = rp.list_pods()
    if not pods:
        print("no pods running")
        return 0
    for p in pods:
        print(f"terminating {p.get('id')} {p.get('name')}")
        rp.terminate_pod(p.get("id"))
    return 0


def cmd_status(args):
    pods = rp.list_pods()
    if not pods:
        print("no pods running")
    for p in pods:
        keys = ("id", "name", "desiredStatus", "costPerHr", "publicIp")
        print(json.dumps({k: p.get(k) for k in keys}, default=str))
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate")
    g.add_argument("--views", required=True)
    g.add_argument("--out", required=True)
    g.add_argument("--name", default="hunyuan3d-job")
    g.add_argument("--steps", type=int, default=50)
    g.add_argument("--octree", type=int, default=384)
    g.add_argument("--guidance", type=float, default=5.0)
    g.add_argument("--seed", type=int, default=1234)
    g.add_argument("--num-chunks", type=int, default=8000)
    g.add_argument("--target-faces", type=int, default=60000)
    g.add_argument("--no-texture", action="store_true")
    g.add_argument("--max-price", type=float, default=MAX_GPU_PRICE)
    g.add_argument("--max-runtime", type=int, default=MAX_RUNTIME_SEC)
    g.add_argument("--disk", type=int, default=80)
    g.add_argument("--volume", type=int, default=60)
    g.add_argument("--cloud", default="SECURE", choices=["SECURE", "COMMUNITY"])
    g.add_argument("--pod-id", default=None,
                   help="attach to an existing pod instead of creating one")
    g.add_argument("--keep", action="store_true", help="DANGER: leave the pod running")
    g.add_argument("--yes", action="store_true")
    g.set_defaults(func=cmd_generate)

    t = sub.add_parser("turret")
    t.add_argument("--inputs", default="assets/reference",
                   help="dir containing views_turret/ and views_turret_<part>/")
    t.add_argument("--out", required=True)
    t.add_argument("--name", default="turret-parts")
    t.add_argument("--steps", type=int, default=50)
    t.add_argument("--octree", type=int, default=384)
    t.add_argument("--guidance", type=float, default=5.0)
    t.add_argument("--seed", type=int, default=1234)
    t.add_argument("--target-faces", type=int, default=80000)
    t.add_argument("--part-octree", type=int, default=320)
    t.add_argument("--part-faces", type=int, default=40000)
    t.add_argument("--skip-parts", action="store_true")
    t.add_argument("--skip-segment", action="store_true")
    t.add_argument("--max-price", type=float, default=MAX_GPU_PRICE)
    t.add_argument("--max-runtime", type=int, default=MAX_RUNTIME_SEC)
    t.add_argument("--disk", type=int, default=80)
    t.add_argument("--volume", type=int, default=80)
    t.add_argument("--cloud", default="SECURE", choices=["SECURE", "COMMUNITY"])
    t.add_argument("--pod-id", default=None)
    t.add_argument("--keep", action="store_true")
    t.add_argument("--yes", action="store_true")
    t.set_defaults(func=cmd_turret)

    k = sub.add_parser("kill")
    k.add_argument("pod_id", nargs="?")
    k.set_defaults(func=cmd_kill)

    ka = sub.add_parser("kill-all")
    ka.set_defaults(func=cmd_kill, pod_id=None)

    s = sub.add_parser("status")
    s.set_defaults(func=cmd_status)

    args = ap.parse_args()
    sys.exit(args.func(args) or 0)


if __name__ == "__main__":
    main()
