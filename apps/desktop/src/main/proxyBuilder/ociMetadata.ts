import { Buffer } from 'node:buffer'

export interface OciVnicMetadata {
  region: string
  vnicId: string
  assignedIpv6Cidrs: string[]
  subnetIpv6Cidrs: string[]
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
}

export const OCI_VNIC_METADATA_PROBE_PY = String.raw`import json
import subprocess
import sys
import urllib.request

V2_HEADERS = {'Authorization': 'Bearer Oracle'}

def fetch(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=4) as response:
        return json.load(response)

def safe_fetch(url, headers=None):
    try:
        return fetch(url, headers)
    except Exception:
        return None

def as_records(payload):
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        nested = payload.get('vnics')
        if isinstance(nested, list):
            return [item for item in nested if isinstance(item, dict)]
        return [payload]
    return []

def ci_get(item, key):
    wanted = key.lower()
    for candidate, value in item.items():
        if str(candidate).lower() == wanted:
            return value
    return None

def clean_values(raw):
    seq = raw if isinstance(raw, list) else ([raw] if raw is not None else [])
    values = []
    for value in seq:
        text = str(value).strip()
        if not text or text.lower() == 'null':
            continue
        if text not in values:
            values.append(text)
    return values

iface = sys.argv[1] if len(sys.argv) > 1 else ''
try:
    wanted_mac = open('/sys/class/net/' + iface + '/address', encoding='utf-8').read().strip().lower()
except Exception:
    wanted_mac = ''

local_ipv4 = set()
try:
    result = subprocess.run(
        ['ip', '-o', '-4', 'addr', 'show', 'dev', iface],
        capture_output=True,
        text=True,
        timeout=3
    )
    for line in result.stdout.splitlines():
        parts = line.split()
        if 'inet' in parts:
            index = parts.index('inet')
            if index + 1 < len(parts):
                local_ipv4.add(parts[index + 1].split('/', 1)[0])
except Exception:
    pass

instance = (
    safe_fetch('http://169.254.169.254/opc/v2/instance/', V2_HEADERS)
    or safe_fetch('http://169.254.169.254/opc/v1/instance/')
    or {}
)
v2_records = as_records(safe_fetch('http://169.254.169.254/opc/v2/vnics/', V2_HEADERS))
v1_records = as_records(safe_fetch('http://169.254.169.254/opc/v1/vnics/'))
records = v2_records + v1_records

if not records:
    sys.exit(3)

def score(item):
    points = 0
    mac = str(ci_get(item, 'macAddr') or '').strip().lower()
    private_ip = str(ci_get(item, 'privateIp') or '').strip()
    if wanted_mac and mac == wanted_mac:
        points += 4
    if private_ip and private_ip in local_ipv4:
        points += 2
    return points

selected = max(records, key=score)
vnic_id = str(ci_get(selected, 'vnicId') or '').strip()
if not vnic_id.startswith('ocid1.vnic.'):
    sys.exit(4)

same_vnic = [
    item for item in records
    if str(ci_get(item, 'vnicId') or '').strip() == vnic_id
] or [selected]

def collect(key, fallback=None):
    values = []
    for item in same_vnic:
        raw = ci_get(item, key)
        if raw is None and fallback:
            raw = ci_get(item, fallback)
        for value in clean_values(raw):
            if value not in values:
                values.append(value)
    return values

region = str(ci_get(instance, 'region') or '').strip() if isinstance(instance, dict) else ''
assigned = collect('ipv6AddressCidrs')
subnets = collect('ipv6SubnetCidrBlocks', 'ipv6SubnetCidrBlock')

print('PA_OCI_REGION=' + region)
print('PA_OCI_VNIC=' + vnic_id)
print('PA_OCI_IPV6_CIDRS=' + ','.join(assigned))
print('PA_OCI_IPV6_SUBNETS=' + ','.join(subnets))
`

export function buildOciVnicMetadataProbeCommand(interfaceArg: string): string {
  const encoded = Buffer.from(OCI_VNIC_METADATA_PROBE_PY, 'utf8').toString('base64')
  return `python3 -c 'import base64;exec(base64.b64decode("${encoded}"))' ${interfaceArg}`
}

export function parseOciVnicMetadataProbeOutput(output: string): OciVnicMetadata | null {
  const values = new Map<string, string>()
  for (const rawLine of output.split(/\r?\n/)) {
    const index = rawLine.indexOf('=')
    if (index <= 0) continue
    values.set(rawLine.slice(0, index).trim(), rawLine.slice(index + 1).trim())
  }
  const vnicId = values.get('PA_OCI_VNIC') ?? ''
  if (!/^ocid1\.vnic\./.test(vnicId)) return null
  return {
    region: values.get('PA_OCI_REGION') ?? '',
    vnicId,
    assignedIpv6Cidrs: splitCsv(values.get('PA_OCI_IPV6_CIDRS')),
    subnetIpv6Cidrs: splitCsv(values.get('PA_OCI_IPV6_SUBNETS'))
  }
}
