#!/usr/bin/env python3
"""Run a GPU job on RunPod end-to-end: provision -> setup -> run -> fetch -> terminate.

Cost guards: <= $0.60/hr GPU, <= $2.00 per job, <= 2h runtime, 1 GPU.

Three independent things have to fail before a pod can outlive its usefulness:
  1. PodSession terminates on every exit path, including exceptions (the pod id
     is recorded the instant the API returns, before anything can go wrong).
  2. A detached local watchdog process DELETEs the pod after --max-runtime.
     Survives this process dying; not a machine reboot.
  3. The pod arms its own kill timer in arm_failsafe.sh. Survives everything
     except the pod losing network.

  python tools/runpod/job.py smoke
  python tools/runpod/job.py turret --out out/turret
  python tools/runpod/job.py status | kill-all
"""

import argparse
import json
import os
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


# A non-interactive `ssh host cmd` gets neither RunPod's injected env vars
# (they live in /etc/rp_environment, sourced only by login shells) nor CUDA on
# PATH. Every remote command goes through this.
REMOTE_PRELUDE = (
    "export PATH=/usr/local/cuda/bin:$PATH; "
    "[ -f /etc/rp_environment ] && . /etc/rp_environment; "
    "[ -f /workspace/job.env ] && . /workspace/job.env; "
)


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
    p = subprocess.run(argv) if stream else subprocess.run(
        argv, capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(
            f"ssh failed ({p.returncode}): {cmd[:120]}\n{getattr(p, 'stderr', '')}")
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
    attempt = 0
    while time.time() < deadline:
        attempt += 1
        p = ssh(host, port, "echo ready", check=False, stream=False)
        if p.returncode == 0 and "ready" in (p.stdout or ""):
            log(f"ssh up after {attempt} attempt(s)")
            return
        if attempt in (3, 10, 20):
            log(f"ssh not up yet ({attempt} tries): "
                f"{(p.stderr or '').strip()[:160]}")
        time.sleep(8)
    raise RuntimeError(f"SSH never became reachable on {host}:{port}")


def spawn_watchdog(pod_id, delay_sec):
    """Detached local process that kills the pod even if this one dies."""
    script = HERE / "watchdog.py"
    env = dict(os.environ, RUNPOD_API_KEY=rp.api_key())
    kwargs = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
              "stdin": subprocess.DEVNULL, "env": env}
    if os.name == "nt":
        kwargs["creationflags"] = (subprocess.DETACHED_PROCESS
                                   | subprocess.CREATE_NEW_PROCESS_GROUP)
    else:
        kwargs["start_new_session"] = True
    try:
        p = subprocess.Popen(
            [sys.executable, str(script), pod_id, str(int(delay_sec))], **kwargs)
        log(f"local watchdog pid {p.pid} will kill {pod_id} in {delay_sec/60:.0f} min")
        return p.pid
    except Exception as e:  # never let the watchdog stop the job
        log(f"WARNING: could not spawn local watchdog: {e}")
        return None


class PodSession:
    """Owns a pod's lifetime. Terminates on every exit path."""

    def __init__(self, args):
        self.args = args
        self.pod_id = None
        self.price = 0.0
        self.host = None
        self.port = None
        self.t0 = time.time()
        self.terminated = False

    # ---------------------------------------------------------------- lifetime
    def __enter__(self):
        """Provision a usable pod, or terminate whatever was created and raise.

        Python does NOT call __exit__ when __enter__ raises, so an exception in
        here (SSH never coming up being the common one) would otherwise leak a
        running, billing pod that only the local watchdog could clean up. Every
        failure path has to terminate before it re-raises.
        """
        try:
            return self._enter()
        except BaseException:
            if self.pod_id and not self.terminated:
                log(f"provisioning failed - terminating {self.pod_id}")
                try:
                    self.terminate()
                except Exception as e:
                    log(f"WARNING: cleanup terminate failed: {e} "
                        f"- the local watchdog is now the only backstop")
            raise

    def _enter(self):
        ensure_key()
        if self.args.pod_id:
            self.pod_id = self.args.pod_id
            st = json.loads(STATE.read_text()) if STATE.exists() else {}
            self.price = st.get("price", 0.0)
            log(f"attaching to existing pod {self.pod_id}")
            self._connect()
            return self

        attempts = getattr(self.args, "attempts", 3)
        for i in range(1, attempts + 1):
            self._create()
            self._connect()
            problem = (None if getattr(self.args, "skip_gpu_check", False)
                       else self._gpu_problem())
            if not problem:
                return self
            log(f"attempt {i}/{attempts}: {problem}")
            log("discarding this host and trying another")
            self.terminate()
            self.pod_id, self.terminated = None, False
        raise RuntimeError(
            f"no usable host after {attempts} attempts - CUDA was unavailable "
            "on every one. Try again later or --cloud SECURE.")

    # Some community hosts hand out a GPU that nvidia-smi reports happily but
    # CUDA cannot initialise ("CUDA unknown error"), e.g. driver 580/CUDA 13
    # boxes against this cu124 torch build. A healthy host passes on the first
    # probe, so this is a short sanity window, not a wait for warm-up - keep it
    # tight, every second of it is billed.
    GPU_READY_TIMEOUT = 75
    GPU_POLL = 10

    GPU_PROBE = (
        'python -c "'
        "import torch;"
        "a=torch.cuda.is_available();"
        "print('avail',a,'count',torch.cuda.device_count());"
        "print('alloc', (torch.zeros(1).cuda().sum().item() if a else 'skipped'))"
        '" 2>&1'
    )

    def _gpu_problem(self):
        """None once the GPU is actually usable, else why not (after polling)."""
        deadline = time.time() + self.GPU_READY_TIMEOUT
        last = ""
        while time.time() < deadline:
            out = (self.sh(self.GPU_PROBE, check=False,
                           stream=False).stdout or "").strip()
            last = out.replace("\n", " | ")[:300]
            if "avail True" in out and "alloc 0.0" in out:
                log(f"cuda ready: {last}")
                return None
            log(f"waiting for cuda: {last}")
            time.sleep(self.GPU_POLL)
        return f"CUDA never became usable in {self.GPU_READY_TIMEOUT}s: {last}"

    def __exit__(self, exc_type, exc, tb):
        elapsed = time.time() - self.t0
        if self.pod_id and not self.args.keep:
            log(f"terminating pod {self.pod_id} after {elapsed/60:.1f} min "
                f"(~${self.price * elapsed / 3600:.3f})")
            self.terminate()
        elif self.pod_id:
            log(f"--keep set: pod {self.pod_id} LEFT RUNNING at "
                f"${self.price:.3f}/hr -> {self.host}:{self.port}")
            log(f"kill it with: python tools/runpod/job.py kill {self.pod_id}")
        return False  # never swallow the exception

    def terminate(self):
        if self.pod_id and not self.terminated:
            self.terminated = rp.terminate_pod(self.pod_id)
            if STATE.exists():
                STATE.unlink()

    # ---------------------------------------------------------------- internals
    def _create(self):
        a = self.args
        secure = a.cloud == "SECURE"
        cands = rp.pick_gpu(getattr(a, "min_vram", None) or MIN_VRAM_GB,
                            a.max_price, secure=secure)
        if getattr(a, "gpu_type", None):
            cands = [g for g in cands if g["id"] == a.gpu_type] or [
                {"id": a.gpu_type, "price": a.max_price, "vram": MIN_VRAM_GB,
                 "stock": "pinned"}]
        log(f"cheapest in-stock {a.cloud} candidates:")
        for g in cands[:6]:
            log(f"   ${g['price']:.3f}/hr  {g['vram']:>3}GB  {g['stock']:<6} {g['id']}")

        est = cands[0]["price"] * (a.max_runtime / 3600.0)
        log(f"worst-case cost at max runtime: ${est:.2f} (cap ${MAX_JOB_COST:.2f})")
        if est > MAX_JOB_COST and not a.yes:
            raise SystemExit(
                f"Worst-case ${est:.2f} exceeds the ${MAX_JOB_COST:.2f} per-job "
                "cap. Lower --max-runtime or pass --yes.")

        pod = rp.create_pod(
            name=a.name,
            image=getattr(a, "image", None) or IMAGE,
            gpu_type_ids=[g["id"] for g in cands[:5]],
            public_key=PUBKEY.read_text(encoding="utf-8").strip(),
            container_disk_gb=a.disk,
            volume_gb=a.volume,
            env={"RUNPOD_API_KEY": rp.api_key(),
                 "MAX_RUNTIME_SEC": str(a.max_runtime)},
            cloud_type=a.cloud,
        )
        # Record the id BEFORE anything else can raise - this is what makes the
        # session leak-proof.
        self.pod_id = pod.get("id") or pod.get("podId")
        self.price = cands[0]["price"]
        STATE.write_text(json.dumps({"pod_id": self.pod_id, "started": time.time(),
                                     "price": self.price}))
        log(f"created pod {self.pod_id}")
        spawn_watchdog(self.pod_id, a.max_runtime)
        self._verify_price()

    def _verify_price(self):
        """The quoted price is per-GPU-type; the pod's real rate can differ.
        Check what we are actually being charged and bail out if it is over."""
        actual = None
        for _ in range(6):
            pod = rp.get_pod(self.pod_id)
            actual = pod.get("costPerHr")
            if actual:
                break
            time.sleep(5)
        if not actual:
            log("WARNING: could not read costPerHr; continuing on the estimate")
            return
        actual = float(actual)
        self.price = actual
        if actual > self.args.max_price:
            log(f"ACTUAL RATE ${actual:.3f}/hr EXCEEDS the ${self.args.max_price:.2f} "
                "cap - terminating immediately")
            self.terminate()
            raise SystemExit(
                f"Pod was provisioned at ${actual:.3f}/hr, over the "
                f"${self.args.max_price:.2f}/hr cap. Terminated, nothing ran. "
                "Try --cloud COMMUNITY, or raise --max-price deliberately.")
        log(f"confirmed billing rate ${actual:.3f}/hr")

    def _connect(self):
        _, self.host, self.port = rp.wait_for_ssh(
            self.pod_id, timeout=min(self.args.max_runtime, 900))
        log(f"ssh endpoint {self.host}:{self.port}")
        wait_ssh_ready(self.host, self.port)
        self.sh("mkdir -p /workspace")
        self.write_env()
        self._arm_failsafe()

    def _arm_failsafe(self):
        """Arm the pod's own kill timer as soon as it is reachable.

        This used to happen at the top of each bootstrap, which left a window:
        a pod cycling in the CUDA gate, or one whose bootstrap had not started
        yet, was protected only by the detached LOCAL watchdog - and that dies
        with the machine it was launched from. Arming here means a pod can
        always terminate itself, whatever happens to the controller.

        Idempotent: arm_failsafe.sh no-ops if /tmp/.selfdestruct_armed exists,
        so the bootstrap re-running it later changes nothing.
        """
        try:
            self.put(HERE / "arm_failsafe.sh", "/workspace/arm_failsafe.sh")
            r = self.sh("bash /workspace/arm_failsafe.sh", check=False,
                        stream=False)
            out = (r.stdout or "").strip().splitlines()
            log(out[-1] if out else "failsafe armed")
        except Exception as e:
            log(f"WARNING: could not arm the pod-side failsafe: {e} "
                f"- the local watchdog is the only backstop for this pod")

    # ---------------------------------------------------------------- helpers
    def sh(self, cmd, raw=False, **kw):
        return ssh(self.host, self.port,
                   cmd if raw else REMOTE_PRELUDE + cmd, **kw)

    def write_env(self):
        """Hand the pod the values its failsafe needs. RunPod does inject these,
        but only into the container's main process, not into SSH sessions."""
        lines = [
            f"export RUNPOD_POD_ID={self.pod_id}",
            f"export MAX_RUNTIME_SEC={self.args.max_runtime}",
            f"export SKIP_TEXGEN={1 if getattr(self.args, 'shape_only', False) else 0}",
            f"export RUNPOD_API_KEY={rp.api_key()}",
        ]
        f = HERE / ".job_env.tmp"
        # LF only - a CRLF export line makes bash treat \r as part of the value.
        f.write_bytes(("\n".join(lines) + "\n").encode())
        self.put(f, "/workspace/job.env")
        self.sh("chmod 600 /workspace/job.env")
        f.unlink(missing_ok=True)

    def put(self, src, dst):
        scp(self.host, self.port, src, dst)

    def get(self, src, dst):
        scp(self.host, self.port, src, dst, to_remote=False)

    def upload_tools(self, names):
        for f in names:
            self.put(HERE / f, f"/workspace/{f}")


# --------------------------------------------------------------------- commands


def cmd_smoke(args):
    """Cheapest end-to-end check of the orchestration layer: provision, prove
    SSH/scp/failsafe/GPU work, terminate. Installs nothing. ~2-4 min."""
    ok = {}
    with PodSession(args) as s:
        ok["gpu"] = s.sh("nvidia-smi --query-gpu=name,memory.total "
                         "--format=csv,noheader", check=False,
                         stream=False).stdout.strip()
        log(f"GPU: {ok['gpu']}")

        p = s.sh('python -c "import torch;print(torch.__version__, '
                 'torch.version.cuda, torch.cuda.is_available())"',
                 check=False, stream=False)
        ok["torch"] = (p.stdout or p.stderr or "").strip()
        log(f"torch: {ok['torch']}")

        p = s.sh("nvcc --version | tail -2", check=False, stream=False)
        ok["nvcc"] = (p.stdout or "").strip() or "MISSING"
        log(f"nvcc: {ok['nvcc'][:120]}")

        # Binary round-trip, byte-exact: the real payload is GLBs, and the
        # earlier text+sed version only ever tested Windows line endings.
        probe = HERE / ".smoke_probe.bin"
        payload = bytes(range(256)) * 8
        probe.write_bytes(payload)
        s.sh("mkdir -p /workspace/job")
        s.put(probe, "/workspace/job/probe.bin")
        remote_ls = s.sh("ls -l /workspace/job/probe.bin", check=False,
                         stream=False).stdout.strip()
        log(f"uploaded {len(payload)} B -> {remote_ls}")
        back = HERE / ".smoke_probe_back.bin"
        s.get("/workspace/job/probe.bin", back)
        ok["scp_roundtrip"] = back.is_file() and back.read_bytes() == payload
        log(f"scp round-trip: {ok['scp_roundtrip']}")
        probe.unlink(missing_ok=True)
        back.unlink(missing_ok=True)

        s.upload_tools(["arm_failsafe.sh"])
        p = s.sh("cd /workspace && bash arm_failsafe.sh; "
                 "echo '---'; cat /tmp/.selfdestruct_armed 2>/dev/null; "
                 "echo '---'; pgrep -fa 'sleep' | head -3",
                 check=False, stream=False)
        out = (p.stdout or "").strip()
        ok["failsafe_armed"] = ("self-destruct armed" in out.lower()
                                and "not armed" not in out.lower())
        log(f"failsafe:\n{out}")

        p = s.sh("echo POD=$RUNPOD_POD_ID; df -h /workspace | tail -1; "
                 "free -g | head -2", check=False, stream=False)
        log(f"pod env:\n{(p.stdout or '').strip()}")

    log("=== SMOKE RESULT ===")
    for k, v in ok.items():
        log(f"  {k}: {v}")
    bad = [k for k in ("scp_roundtrip", "failsafe_armed") if not ok.get(k)]
    if bad or "MISSING" in ok.get("nvcc", "") or "True" not in ok.get("torch", ""):
        log(f"FAILED checks: {bad or ok}")
        return 1
    return 0


def cmd_turret(args):
    """Whole turret job in ONE pod session: full mesh + P3-SAM segmentation +
    three per-component generations. Bootstrapping twice would double pod-hours."""
    inp = Path(args.inputs).resolve()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)

    with PodSession(args) as s:
        s.sh("mkdir -p /workspace/job/in /workspace/job/out")
        s.upload_tools(["arm_failsafe.sh", "bootstrap_hunyuan3d.sh",
                        "bootstrap_p3sam.sh", "remote_generate.py",
                        "remote_turret_pipeline.py"])
        for d in sorted(inp.glob("views_turret*")):
            if d.is_dir():
                s.put(d, "/workspace/job/in/")
                log(f"uploaded {d.name}")

        log("=== bootstrap: Hunyuan3D-2 (10-20 min on a fresh volume) ===")
        s.sh("bash /workspace/bootstrap_hunyuan3d.sh")
        if not args.skip_segment:
            log("=== bootstrap: P3-SAM ===")
            s.sh("bash /workspace/bootstrap_p3sam.sh")

        log("=== running pipeline ===")
        s.sh("cd /workspace && HF_HOME=/workspace/hf python -u "
             "remote_turret_pipeline.py --in /workspace/job/in "
             "--out /workspace/job/out "
             f"--steps {args.steps} --octree {args.octree} "
             f"--guidance {args.guidance} --seed {args.seed} "
             f"--faces {args.target_faces} --part-octree {args.part_octree} "
             f"--part-faces {args.part_faces}"
             + (" --no-texture" if args.shape_only else "")
             + (" --skip-parts" if args.skip_parts else "")
             + (" --skip-segment" if args.skip_segment else ""))

        log("=== fetching results ===")
        s.get("/workspace/job/out/.", out)

    files = sorted(p for p in out.rglob("*") if p.is_file())
    for f in files:
        log(f"  {f.relative_to(out)}  {f.stat().st_size / 1024:.0f} KB")
    if not files:
        raise RuntimeError("nothing came back - check the log above")
    return 0


def cmd_diag(args):
    """Provision a pod and dump GPU/env state. Bypasses the CUDA gate so it can
    inspect a host that the gate would reject."""
    args.skip_gpu_check = True
    with PodSession(args) as s:
        def show(title, cmd, raw):
            out = s.sh(cmd, raw=raw, check=False, stream=False)
            body = ((out.stdout or "") + (out.stderr or "")).strip()
            log(f"--- {title} ---" + chr(10) + body[:900])

        show("nvidia-smi (raw ssh)", "nvidia-smi", True)
        show("cuda-related env, RAW ssh", "env | grep -i -E 'cuda|nvidia' | sort", True)
        show("cuda-related env, WITH prelude",
             "env | grep -i -E 'cuda|nvidia' | sort", False)
        show("/etc/rp_environment", "cat /etc/rp_environment 2>&1", True)
        probe = ('python -c "import torch;print(torch.cuda.is_available(),'
                 'torch.cuda.device_count());import os;'
                 "print('CVD=',repr(os.environ.get('CUDA_VISIBLE_DEVICES')))" '" 2>&1')
        show("torch, RAW ssh (no prelude)", probe, True)
        show("torch, WITH prelude", probe, False)
        show("torch, prelude but CVD unset",
             "unset CUDA_VISIBLE_DEVICES; " + probe, False)
        show("nvidia device nodes", "ls -l /dev/nvidia* 2>&1", True)
        show("uvm module on host", "cat /proc/modules | grep -i uvm 2>&1", True)
        show("dmesg/driver", "cat /proc/driver/nvidia/version 2>&1", True)
    return 0


def cmd_run(args):
    """Generic: bootstrap a pod, upload inputs, run a command, fetch results.

    The bake-off models each need their own environment (PartCrafter wants
    torch 2.5.1 against Hunyuan's 2.4.1), so each gets its own pod rather than
    one shared env.
    """
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)

    with PodSession(args) as s:
        s.sh("mkdir -p /workspace/job/in /workspace/job/out")
        s.upload_tools(["arm_failsafe.sh"])
        for f in args.script or []:
            s.put(Path(f), f"/workspace/{Path(f).name}")
        for u in args.upload or []:
            up = Path(u)
            s.put(up, "/workspace/job/in/")
            log(f"uploaded {up.name}")

        if args.bootstrap:
            bs = Path(args.bootstrap)
            s.put(bs, f"/workspace/{bs.name}")
            log(f"=== bootstrap: {bs.name} ===")
            s.sh(f"bash /workspace/{bs.name}")

        log("=== running ===")
        s.sh(f"cd /workspace && {args.cmd}")

        log("=== fetching ===")
        s.get("/workspace/job/out/.", out)

    files = sorted(p for p in out.rglob("*") if p.is_file())
    for f in files[:40]:
        log(f"  {f.relative_to(out)}  {f.stat().st_size/1024:.0f} KB")
    if not files:
        raise RuntimeError("nothing came back - check the log above")
    return 0


def cmd_kill(args):
    if getattr(args, "pod_id", None):
        print(rp.terminate_pod(args.pod_id))
        return 0
    pods = rp.list_pods()
    if not pods:
        print("no pods running")
        return 0
    for p in pods:
        print(f"terminating {p.get('id')} {p.get('name')} "
              f"${p.get('costPerHr')}/hr")
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


def _add_pod_args(p, runtime=MAX_RUNTIME_SEC, disk=80, volume=80):
    p.add_argument("--name", default="turret-job")
    p.add_argument("--max-price", type=float, default=MAX_GPU_PRICE)
    p.add_argument("--max-runtime", type=int, default=runtime)
    p.add_argument("--disk", type=int, default=disk)
    p.add_argument("--volume", type=int, default=volume)
    p.add_argument("--gpu-type", default=None,
                   help="pin one GPU type id instead of picking the cheapest")
    p.add_argument("--attempts", type=int, default=3,
                   help="how many hosts to try before giving up. Whole "
                        "datacenters sometimes hand out GPUs that pass "
                        "nvidia-smi but fail CUDA init, and 3 rotations can "
                        "land inside one of them.")
    p.add_argument("--shape-only", action="store_true",
                   help="skip texture generation. Exported to the pod as "
                        "SKIP_TEXGEN, which the bootstraps read to avoid "
                        "building paint-pipeline CUDA extensions they will "
                        "not use.")
    p.add_argument("--min-vram", type=int, default=None,
                   help=f"minimum GPU VRAM in GB (default {MIN_VRAM_GB}). "
                        "P3-SAM needs 48 at full prompt count; Hunyuan3D-2.1's "
                        "texture pass needs 48.")
    p.add_argument("--cloud", default="COMMUNITY",
                   choices=["SECURE", "COMMUNITY"],
                   help="COMMUNITY is 2-3x cheaper for this workload")
    p.add_argument("--pod-id", default=None,
                   help="attach to an existing pod instead of creating one")
    p.add_argument("--keep", action="store_true",
                   help="DANGER: leave the pod running after the job")
    p.add_argument("--yes", action="store_true")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    sm = sub.add_parser("smoke")
    _add_pod_args(sm, runtime=900, disk=20, volume=0)
    sm.set_defaults(func=cmd_smoke, name="smoke-test")

    t = sub.add_parser("turret")
    t.add_argument("--inputs", default="assets/reference")
    t.add_argument("--out", required=True)
    t.add_argument("--steps", type=int, default=50)
    t.add_argument("--octree", type=int, default=384)
    t.add_argument("--guidance", type=float, default=5.0)
    t.add_argument("--seed", type=int, default=1234)
    t.add_argument("--target-faces", type=int, default=80000)
    t.add_argument("--part-octree", type=int, default=320)
    t.add_argument("--part-faces", type=int, default=40000)
    t.add_argument("--skip-parts", action="store_true")
    t.add_argument("--skip-segment", action="store_true")
    _add_pod_args(t)
    t.set_defaults(func=cmd_turret)

    d = sub.add_parser("diag")
    _add_pod_args(d, runtime=900, disk=20, volume=0)
    d.set_defaults(func=cmd_diag, name="diag")

    r = sub.add_parser("run")
    r.add_argument("--out", required=True)
    r.add_argument("--cmd", required=True, help="command to run on the pod")
    r.add_argument("--bootstrap", default=None, help="setup script to run first")
    r.add_argument("--script", action="append", help="file to upload to /workspace")
    r.add_argument("--upload", action="append", help="file/dir -> /workspace/job/in/")
    r.add_argument("--image", default=None, help="override the docker image")
    _add_pod_args(r)
    r.set_defaults(func=cmd_run)

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
