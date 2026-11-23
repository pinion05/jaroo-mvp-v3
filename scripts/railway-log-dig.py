#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""jaroo Railway 운영 로그 디깅 — 읽기 전용(Read-Only).

"딥스캔 위원 전멸" 후속 포렌식용. GraphQL(v2)을 통해서만 조회하며
설정 변경·재배포 등 어떤 뮤테이션도 수행하지 않는다.

사용법 (토큰은 환경변수로만 전달 — 스크립트/산출물에 절대 기록 금지):
  export RAILWAY_TOKEN='<token>'
  ./scripts/railway-log-dig.py deployments
  ./scripts/railway-log-dig.py logs <deploymentId> [--filter F] [--limit N]
      [--since ISO] [--until ISO] [--json]
  ./scripts/railway-log-dig.py battery <deploymentId> [--limit N] [--json]

예시:
  ./scripts/railway-log-dig.py battery 96de67c4-d978-48e8-80d5-f7807e636999
  ./scripts/railway-log-dig.py logs 96de67c4-... --filter committee-llm \
      --since 2026-11-09T03:00:00Z --until 2026-11-09T05:30:00Z

시각 인자: ISO-8601. 타임존 미지정 시 KST(UTC+9)로 해석, Z는 UTC.
"""
import argparse
import datetime as dt
import json
import os
import sys
import urllib.request

ENDPOINT = "https://backboard.railway.app/graphql/v2"
PROJECT_ID = "91cdd87e-70d1-4cdc-9805-84ae9b99055d"
SERVICE_ID = "691762e8-f5c3-415c-b973-eb3d3718b96e"  # jaroo
ENV_ID = "447abb35-e130-4774-9159-3d3c001fe576"  # production
KST = dt.timezone(dt.timedelta(hours=9))

# 후속 포렌식 표준 필터 세트 (전멸 전/후 정량 대조 + 잔존 리스크)
BATTERY_FILTERS = [
    "committee-llm",
    "llm-upstream-error",
    "soft-deadline",
    "watch-daily-batch",
    "deepscan-kr job",
    "refund",
    "402",
    "error",
    "timeout",
    "ECONN",
    "watchdog",
    "softDeadlineMs",
]


def gql(query: str, variables: dict | None = None):
    token = os.environ.get("RAILWAY_TOKEN")
    if not token:
        sys.exit("RAILWAY_TOKEN 환경변수가 필요합니다 (스크립트에 토큰을 넣지 말 것).")
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "curl/8.5.0",  # Cloudflare 1010 우회(urllib 기본 UA 차단)
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:500]}")
    if payload.get("errors"):
        for err in payload["errors"]:
            print(f"GraphQL error: {err.get('message')}", file=sys.stderr)
    return payload.get("data")


def parse_iso(s: str) -> float:
    """ISO-8601 → epoch seconds. 타임존 없으면 KST 간주."""
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    d = dt.datetime.fromisoformat(s)
    if d.tzinfo is None:
        d = d.replace(tzinfo=KST)
    return d.timestamp()


def ts_to_epoch(ts) -> float | None:
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        # epoch milliseconds 대응
        return ts / 1000.0 if ts > 1e11 else float(ts)
    try:
        return parse_iso(str(ts))
    except ValueError:
        return None


def fmt_epoch(ep: float | None) -> str:
    if ep is None:
        return "?"
    return dt.datetime.fromtimestamp(ep, KST).strftime("%Y-%m-%d %H:%M:%S KST")


def cmd_deployments(args):
    data = gql(
        """
        query($service: String!) {
          service(id: $service) {
            id name
            deployments {
              edges { node { id createdAt status meta } }
            }
          }
        }
        """,
        {"service": SERVICE_ID},
    )
    svc = (data or {}).get("service") or {}
    rows = []
    for edge in ((svc.get("deployments") or {}).get("edges") or []):
        n = edge["node"]
        rows.append(
            {
                "id": n["id"],
                "createdAt": n.get("createdAt"),
                "status": n.get("status"),
                "meta": n.get("meta"),
            }
        )
    rows.sort(key=lambda r: r.get("createdAt") or "", reverse=True)
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return
    for r in rows:
        meta = r.get("meta") or {}
        commit = meta.get("commitHash") or meta.get("commit") or ""
        msg = (meta.get("commitMessage") or meta.get("message") or "").splitlines()[0][:60]
        print(f"{r['id']}  {r.get('createdAt')}  {str(r.get('status')):8}  {commit[:8]}  {msg}")


LOGS_QUERY = """
query($id: String!, $filter: String, $limit: Int) {
  deploymentLogs(deploymentId: $id, filter: $filter, limit: $limit) {
    message
    timestamp
  }
}
"""


def fetch_logs(dep_id: str, flt: str | None, limit: int):
    data = gql(LOGS_QUERY, {"id": dep_id, "filter": flt, "limit": limit})
    return (data or {}).get("deploymentLogs") or []


def cmd_logs(args):
    rows = fetch_logs(args.deployment_id, args.filter, args.limit)
    since = parse_iso(args.since) if args.since else None
    until = parse_iso(args.until) if args.until else None
    out = []
    for r in rows:
        ep = ts_to_epoch(r.get("timestamp"))
        if since is not None and (ep is None or ep < since):
            continue
        if until is not None and (ep is None or ep > until):
            continue
        out.append({"timestamp": r.get("timestamp"), "epoch": ep, "message": r.get("message")})
    out.sort(key=lambda r: (r["epoch"] is None, r["epoch"] or 0))
    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return
    for r in out:
        msg = " ".join(str(r["message"]).splitlines())
        print(f"{fmt_epoch(r['epoch'])}\t{msg}")
    print(f"--- {len(out)} rows (filter={args.filter!r})", file=sys.stderr)


def cmd_battery(args):
    results = {}
    for flt in BATTERY_FILTERS:
        rows = fetch_logs(args.deployment_id, flt, args.limit)
        eps = [ts_to_epoch(r.get("timestamp")) for r in rows]
        eps = [e for e in eps if e is not None]
        results[flt] = {
            "count": len(rows),
            "first": fmt_epoch(min(eps)) if eps else None,
            "last": fmt_epoch(max(eps)) if eps else None,
        }
        print(f"{flt:22} {len(rows):5}건   ({results[flt]['first']} ~ {results[flt]['last']})")
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("deployments", help="서비스 배포 목록(메타데이터)")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_deployments)

    p = sub.add_parser("logs", help="배포 런타임 로그 조회")
    p.add_argument("deployment_id")
    p.add_argument("--filter", default=None)
    p.add_argument("--limit", type=int, default=500)
    p.add_argument("--since")
    p.add_argument("--until")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_logs)

    p = sub.add_parser("battery", help="표준 필터 세트 전수 카운트")
    p.add_argument("deployment_id")
    p.add_argument("--limit", type=int, default=500)
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_battery)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
