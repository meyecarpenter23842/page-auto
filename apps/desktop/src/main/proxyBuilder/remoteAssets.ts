export const PROXY_RUNTIME_PY = String.raw`#!/usr/bin/env python3
import asyncio
import base64
import json
import socket
from pathlib import Path
from urllib.parse import urlsplit

MANIFEST = Path('/etc/page-auto-proxy/manifest.json')
MAX_HEADER = 65536


def load_manifest():
    return json.loads(MANIFEST.read_text(encoding='utf-8'))


def parse_authority(value, default_port):
    value = value.strip()
    if value.startswith('['):
        end = value.find(']')
        if end < 0:
            raise ValueError('invalid IPv6 authority')
        host = value[1:end]
        rest = value[end + 1:]
        port = int(rest[1:]) if rest.startswith(':') else default_port
        return host, port
    if value.count(':') == 1:
        host, port = value.rsplit(':', 1)
        return host, int(port)
    return value, default_port


def authorized(headers, auth):
    if auth.get('type') != 'basic':
        return True
    header = headers.get('proxy-authorization', '')
    if not header.lower().startswith('basic '):
        return False
    try:
        raw = base64.b64decode(header.split(' ', 1)[1], validate=True).decode('utf-8')
    except Exception:
        return False
    return raw == f"{auth.get('username', '')}:{auth.get('password', '')}"


def outbound_family(mapping):
    return socket.AF_INET6 if mapping['type'] == 'ipv6' else socket.AF_INET


async def open_outbound(mapping, host, port):
    source = mapping['source_ip']
    family = outbound_family(mapping)
    return await asyncio.wait_for(
        asyncio.open_connection(host, port, family=family, local_addr=(source, 0)),
        timeout=20,
    )


async def pump(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (asyncio.CancelledError, ConnectionError, OSError):
        pass
    finally:
        try:
            writer.write_eof()
        except (AttributeError, OSError, RuntimeError):
            pass


async def tunnel(client_reader, client_writer, remote_reader, remote_writer):
    left = asyncio.create_task(pump(client_reader, remote_writer))
    right = asyncio.create_task(pump(remote_reader, client_writer))
    await asyncio.wait({left, right}, return_when=asyncio.FIRST_COMPLETED)
    for task in (left, right):
        if not task.done():
            task.cancel()
    await asyncio.gather(left, right, return_exceptions=True)


def parse_headers(block):
    text = block.decode('iso-8859-1')
    lines = text.split('\r\n')
    request_line = lines[0]
    headers = {}
    ordered = []
    for line in lines[1:]:
        if not line or ':' not in line:
            continue
        name, value = line.split(':', 1)
        headers[name.strip().lower()] = value.strip()
        ordered.append((name.strip(), value.strip()))
    return request_line, headers, ordered


def build_forward_head(request_line, ordered_headers):
    method, target, version = request_line.split(' ', 2)
    parsed = urlsplit(target) if '://' in target else None
    if parsed and parsed.scheme:
        path = parsed.path or '/'
        if parsed.query:
            path += '?' + parsed.query
        target = path
    kept = []
    for name, value in ordered_headers:
        lower = name.lower()
        if lower in ('proxy-authorization', 'proxy-connection', 'connection'):
            continue
        kept.append((name, value))
    kept.append(('Connection', 'close'))
    lines = [f'{method} {target} {version}'] + [f'{name}: {value}' for name, value in kept]
    return ('\r\n'.join(lines) + '\r\n\r\n').encode('iso-8859-1')


async def handle_client(mapping, auth, client_reader, client_writer):
    try:
        block = await asyncio.wait_for(client_reader.readuntil(b'\r\n\r\n'), timeout=20)
        if len(block) > MAX_HEADER:
            raise ValueError('headers too large')
        request_line, headers, ordered = parse_headers(block)
        if not authorized(headers, auth):
            client_writer.write(b'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="PageAuto"\r\nConnection: close\r\n\r\n')
            await client_writer.drain()
            return
        method, target, _version = request_line.split(' ', 2)
        if method.upper() == 'CONNECT':
            host, port = parse_authority(target, 443)
            remote_reader, remote_writer = await open_outbound(mapping, host, port)
            client_writer.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
            await client_writer.drain()
            await tunnel(client_reader, client_writer, remote_reader, remote_writer)
            remote_writer.close()
            await remote_writer.wait_closed()
            return

        parsed = urlsplit(target) if '://' in target else None
        if parsed and parsed.hostname:
            host = parsed.hostname
            port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        else:
            host_header = headers.get('host')
            if not host_header:
                raise ValueError('Host header is required')
            host, port = parse_authority(host_header, 80)
        remote_reader, remote_writer = await open_outbound(mapping, host, port)
        remote_writer.write(build_forward_head(request_line, ordered))
        await remote_writer.drain()
        await tunnel(client_reader, client_writer, remote_reader, remote_writer)
        remote_writer.close()
        await remote_writer.wait_closed()
    except asyncio.IncompleteReadError:
        pass
    except Exception:
        try:
            client_writer.write(b'HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
            await client_writer.drain()
        except Exception:
            pass
    finally:
        client_writer.close()
        try:
            await client_writer.wait_closed()
        except Exception:
            pass


async def main():
    manifest = load_manifest()
    auth = manifest.get('auth', {'type': 'none'})
    servers = []
    for mapping in manifest.get('mappings', []):
        handler = lambda r, w, m=mapping: handle_client(m, auth, r, w)
        server = await asyncio.start_server(handler, host='0.0.0.0', port=int(mapping['port']), backlog=512)
        servers.append(server)
    if not servers:
        raise RuntimeError('manifest has no proxy mappings')
    await asyncio.gather(*(server.serve_forever() for server in servers))


if __name__ == '__main__':
    asyncio.run(main())
`

export const PROXY_RESTORE_PY = String.raw`#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path

MANIFEST = Path('/etc/page-auto-proxy/manifest.json')


def run(*args):
    return subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


def main():
    if not MANIFEST.exists():
        return
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    interface = manifest.get('interface')
    if not interface:
        return
    for cidr in manifest.get('managed_ipv6', []):
        run('ip', '-6', 'addr', 'add', cidr, 'dev', interface)


if __name__ == '__main__':
    main()
`

export const PROXY_PROVISIONER_PY = String.raw`#!/usr/bin/env python3
import base64
import ipaddress
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ETC_DIR = Path('/etc/page-auto-proxy')
LIB_DIR = Path('/usr/local/lib/page-auto-proxy')
MANIFEST = ETC_DIR / 'manifest.json'
RUNTIME = LIB_DIR / 'runtime.py'
RESTORE = LIB_DIR / 'restore.py'
SERVICE = Path('/etc/systemd/system/page-auto-proxy.service')
SERVICE_NAME = 'page-auto-proxy.service'


def progress(phase, percent, message):
    safe = str(message).replace('\n', ' ').replace('|', '/')
    print(f'PA_PROGRESS={phase}|{percent}|{safe}', flush=True)


def run(args, check=True, timeout=60, text=True):
    result = subprocess.run(args, capture_output=True, text=text, timeout=timeout, check=False)
    if check and result.returncode != 0:
        stderr = (result.stderr or '').strip() if text else ''
        raise RuntimeError(stderr or f'command failed: {args[0]}')
    return result


def probe_outbound(address, family):
    endpoint = 'https://api64.ipify.org' if family == 6 else 'https://api.ipify.org'
    args = ['curl', '-6' if family == 6 else '-4', '-fsS', '--interface', address, '--connect-timeout', '3', '--max-time', '7', endpoint]
    result = run(args, check=False, timeout=10)
    if result.returncode != 0:
        return None
    try:
        observed = ipaddress.ip_address(result.stdout.strip())
    except ValueError:
        return None
    if observed.version != family:
        return None
    return str(observed)


def source_probe(address, family):
    observed = probe_outbound(address, family)
    if not observed:
        return False
    try:
        return ipaddress.ip_address(observed) == ipaddress.ip_address(address)
    except ValueError:
        return False


def current_addresses(family):
    flag = '-6' if family == 6 else '-4'
    result = run(['ip', '-o', flag, 'addr', 'show', 'scope', 'global'])
    out = []
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 4:
            out.append(parts[3])
    return out


def port_busy(port):
    result = run(['ss', '-ltnH'], check=False)
    suffixes = (f':{port}', f'.{port}')
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 4 and fields[3].endswith(suffixes):
            return True
    return False


def add_ipv6(address, prefix, interface):
    cidr = f'{address}/{prefix}'
    result = run(['ip', '-6', 'addr', 'add', cidr, 'dev', interface], check=False)
    if result.returncode != 0 and 'File exists' not in (result.stderr or ''):
        raise RuntimeError((result.stderr or '').strip() or f'cannot add {cidr}')
    return cidr


def del_ipv6(cidr, interface):
    run(['ip', '-6', 'addr', 'del', cidr, 'dev', interface], check=False)


def load_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception:
        return default


def install_file(src, dst, mode):
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    os.chmod(dst, mode)


def allocate_ipv6(count, interface, old_manifest, newly_added):
    if count <= 0:
        return []
    global_cidrs = current_addresses(6)
    old_managed = list(old_manifest.get('managed_ipv6', [])) if isinstance(old_manifest, dict) else []
    chosen = []
    for cidr in old_managed:
        try:
            iface = ipaddress.ip_interface(cidr)
        except ValueError:
            continue
        if source_probe(str(iface.ip), 6):
            chosen.append(cidr)
            if len(chosen) == count:
                return chosen

    seeds = [cidr for cidr in global_cidrs if cidr not in old_managed]
    if not seeds:
        seeds = global_cidrs
    if not seeds:
        raise RuntimeError('VPS không có IPv6 global để xây pool.')
    seed = ipaddress.ip_interface(seeds[0])
    network = seed.network
    existing_ips = {str(ipaddress.ip_interface(cidr).ip) for cidr in global_cidrs}
    start_host = max(256, int(seed.ip) - int(network.network_address) + 256)
    attempts = max(128, count * 12)
    for offset in range(attempts):
        candidate_int = int(network.network_address) + start_host + offset
        if candidate_int >= int(network.broadcast_address):
            break
        address = str(ipaddress.ip_address(candidate_int))
        if address in existing_ips:
            continue
        cidr = add_ipv6(address, network.prefixlen, interface)
        newly_added.append(cidr)
        existing_ips.add(address)
        if source_probe(address, 6):
            chosen.append(cidr)
            if len(chosen) == count:
                return chosen
        else:
            del_ipv6(cidr, interface)
            newly_added.remove(cidr)
    raise RuntimeError(f'Chỉ xác minh được {len(chosen)}/{count} IPv6 source-bind; đã rollback candidate lỗi.')


def usable_ipv4():
    result = []
    seen_outbound = set()
    for cidr in current_addresses(4):
        try:
            address = str(ipaddress.ip_interface(cidr).ip)
        except ValueError:
            continue
        observed = probe_outbound(address, 4)
        if not observed or observed in seen_outbound:
            continue
        seen_outbound.add(observed)
        result.append({'source_ip': address, 'outbound_ip': observed})
    return result


def choose_counts(mode, count, ipv4_pool):
    if mode == 'ipv4':
        if len(ipv4_pool) < count:
            raise RuntimeError(f'IPv4 usable chỉ có {len(ipv4_pool)}, không đủ {count} proxy.')
        return count, 0
    if mode == 'ipv6':
        return 0, count
    if count < 2:
        raise RuntimeError('Chế độ IPv4 + IPv6 cần tối thiểu 2 proxy.')
    if not ipv4_pool:
        raise RuntimeError('Chế độ IPv4 + IPv6 cần ít nhất 1 IPv4 source-bind hợp lệ.')
    ipv4_count = min(len(ipv4_pool), max(1, count // 2))
    ipv6_count = count - ipv4_count
    if ipv6_count < 1:
        ipv4_count = count - 1
        ipv6_count = 1
    return ipv4_count, ipv6_count


def self_test(mapping, auth):
    endpoint = 'https://api64.ipify.org' if mapping['type'] == 'ipv6' else 'https://api.ipify.org'
    args = ['curl', '-fsS', '--connect-timeout', '3', '--max-time', '12', '-x', f"http://127.0.0.1:{mapping['port']}"]
    if auth.get('type') == 'basic':
        args.extend(['--proxy-user', f"{auth.get('username', '')}:{auth.get('password', '')}"])
    args.append(endpoint)
    result = run(args, check=False, timeout=15)
    if result.returncode != 0:
        return False
    try:
        expected = mapping.get('outbound_ip', mapping['source_ip'])
        return ipaddress.ip_address(result.stdout.strip()) == ipaddress.ip_address(expected)
    except ValueError:
        return False


def backup_files(backup_dir):
    backup_dir.mkdir(parents=True, exist_ok=True)
    files = {'manifest': MANIFEST, 'runtime': RUNTIME, 'restore': RESTORE, 'service': SERVICE}
    existed = {}
    for key, path in files.items():
        existed[key] = path.exists()
        if path.exists():
            target = backup_dir / key
            shutil.copy2(path, target)
    return existed


def restore_files(backup_dir, existed):
    files = {'manifest': MANIFEST, 'runtime': RUNTIME, 'restore': RESTORE, 'service': SERVICE}
    for key, path in files.items():
        backup = backup_dir / key
        if existed.get(key) and backup.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(backup, path)
        elif path.exists():
            path.unlink()


def main():
    if len(sys.argv) != 6:
        raise RuntimeError('invalid provisioner arguments')
    request_path, staged_runtime, staged_restore, staged_service, run_id = sys.argv[1:]
    request = load_json(request_path, {})
    interface = request.get('interface')
    if not interface:
        raise RuntimeError('Không xác định được default network interface.')
    count = int(request.get('count', 0))
    start_port = int(request.get('startPort', 0))
    mode = request.get('ipMode')
    listen_host = request.get('listenHost') or request.get('host')
    auth = request.get('proxyAuth') or {'type': 'none'}
    if count < 1 or start_port < 1 or start_port + count - 1 > 65535:
        raise RuntimeError('Số lượng proxy hoặc dải port không hợp lệ.')
    if mode not in ('ipv4', 'ipv6', 'both'):
        raise RuntimeError('Loại proxy không hợp lệ.')

    old_manifest = load_json(MANIFEST, {})
    old_managed = list(old_manifest.get('managed_ipv6', [])) if isinstance(old_manifest, dict) else []
    backup_dir = Path(f'/tmp/page-auto-proxy-backup-{run_id}')
    newly_added = []
    existed = backup_files(backup_dir)
    completed = False

    def abort(_signum, _frame):
        raise KeyboardInterrupt('provision cancelled')
    signal.signal(signal.SIGTERM, abort)
    signal.signal(signal.SIGHUP, abort)
    signal.signal(signal.SIGINT, abort)

    try:
        progress('preflight', 40, 'Đang xác minh IPv4 và dải port')
        for port in range(start_port, start_port + count):
            if port_busy(port):
                old_ports = {int(item.get('port', -1)) for item in old_manifest.get('mappings', [])} if isinstance(old_manifest, dict) else set()
                if port not in old_ports:
                    raise RuntimeError(f'Port {port} đang được process khác sử dụng.')

        ipv4_pool = usable_ipv4()
        ipv4_count, ipv6_count = choose_counts(mode, count, ipv4_pool)
        progress('provisioning', 55, f'IPv4 usable: {len(ipv4_pool)}; cần IPv6: {ipv6_count}')
        ipv6_cidrs = allocate_ipv6(ipv6_count, interface, old_manifest, newly_added)
        ipv6_pool = [str(ipaddress.ip_interface(cidr).ip) for cidr in ipv6_cidrs]

        mappings = []
        port = start_port
        for candidate in ipv4_pool[:ipv4_count]:
            mappings.append({
                'port': port,
                'type': 'ipv4',
                'source_ip': candidate['source_ip'],
                'outbound_ip': candidate['outbound_ip'],
            })
            port += 1
        for address in ipv6_pool:
            mappings.append({'port': port, 'type': 'ipv6', 'source_ip': address, 'outbound_ip': address})
            port += 1
        if len(mappings) != count:
            raise RuntimeError(f'Provision plan chỉ tạo được {len(mappings)}/{count} mapping.')

        manifest = {
            'version': 1,
            'interface': interface,
            'listen_host': listen_host,
            'auth': auth,
            'managed_ipv6': ipv6_cidrs,
            'mappings': mappings,
            'updated_at': int(time.time()),
        }
        ETC_DIR.mkdir(parents=True, exist_ok=True)
        LIB_DIR.mkdir(parents=True, exist_ok=True)
        install_file(staged_runtime, RUNTIME, 0o755)
        install_file(staged_restore, RESTORE, 0o755)
        install_file(staged_service, SERVICE, 0o644)
        MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        os.chmod(MANIFEST, 0o600)

        progress('service', 75, 'Đang bật service và khôi phục IP pool')
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'enable', SERVICE_NAME])
        run(['systemctl', 'restart', SERVICE_NAME])
        time.sleep(1.0)
        active = run(['systemctl', 'is-active', SERVICE_NAME], check=False)
        if active.returncode != 0 or active.stdout.strip() != 'active':
            status = run(['systemctl', 'status', SERVICE_NAME, '--no-pager', '-n', '20'], check=False)
            raise RuntimeError((status.stdout or status.stderr or 'Proxy service không active.').strip()[-1600:])

        progress('self_test', 88, 'Đang self-test từng listener qua proxy thật')
        for mapping in mappings:
            if not self_test(mapping, auth):
                expected = mapping.get('outbound_ip', mapping['source_ip'])
                raise RuntimeError(f"Self-test port {mapping['port']} không ra đúng outbound {expected}.")

        new_managed = set(ipv6_cidrs)
        for cidr in old_managed:
            if cidr not in new_managed:
                del_ipv6(cidr, interface)
        completed = True
        result = {
            'listenHost': listen_host,
            'authMode': auth.get('type', 'none'),
            'username': auth.get('username') if auth.get('type') == 'basic' else None,
            'mappings': mappings,
        }
        encoded = base64.b64encode(json.dumps(result, separators=(',', ':')).encode('utf-8')).decode('ascii')
        progress('complete', 100, f'Đã tạo {len(mappings)} proxy và xác minh outbound IP')
        print('PA_RESULT_JSON=' + encoded, flush=True)
    except BaseException:
        progress('rollback', 92, 'Có lỗi; đang rollback resource do phiên này tạo')
        run(['systemctl', 'stop', SERVICE_NAME], check=False)
        for cidr in list(newly_added):
            del_ipv6(cidr, interface)
        restore_files(backup_dir, existed)
        run(['systemctl', 'daemon-reload'], check=False)
        if existed.get('service'):
            run(['systemctl', 'restart', SERVICE_NAME], check=False)
        raise
    finally:
        if completed:
            shutil.rmtree(backup_dir, ignore_errors=True)


if __name__ == '__main__':
    main()
`

export const PROXY_SYSTEMD_SERVICE = String.raw`[Unit]
Description=Page-Auto Proxy Builder runtime
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
ExecStartPre=/usr/bin/python3 /usr/local/lib/page-auto-proxy/restore.py
ExecStart=/usr/bin/python3 /usr/local/lib/page-auto-proxy/runtime.py
Restart=always
RestartSec=2
LimitNOFILE=65536
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
`
