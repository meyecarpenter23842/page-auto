import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { BrowserWindow, ipcMain } from 'electron'
import {
  ACCOUNT_BROWSER_DOCK_IPC,
  computeAccountBrowserDockLayout,
  type AccountBrowserDockCell,
  type AccountBrowserDockOpenResult
} from '../../shared/accountBrowserDock'

const execFileAsync = promisify(execFile)
const DOCK_GAP_PX = 4
const POWERSHELL_TIMEOUT_MS = 12_000
const SCROLL_POLL_MS = 80

export interface AccountBrowserDockTarget {
  accountId: number
  label: string
  profileDirectory: string
}

interface EmbeddedWindow {
  accountId: number
  label: string
  hwnd: string
  parent: string
  style: number
  exStyle: number
  x: number
  y: number
  width: number
  height: number
}

interface DockViewportState {
  width: number
  height: number
  scrollX: number
  scrollY: number
}

const NATIVE_DOCK_CSHARP = String.raw`
using System;
using System.Runtime.InteropServices;

public sealed class PageAutoDockSnapshot {
  public long Hwnd { get; set; }
  public long Parent { get; set; }
  public int Style { get; set; }
  public int ExStyle { get; set; }
  public int X { get; set; }
  public int Y { get; set; }
  public int Width { get; set; }
  public int Height { get; set; }
}

public static class PageAutoNativeDock {
  private const int GWL_STYLE = -16;
  private const int GWL_EXSTYLE = -20;
  private const uint WS_CHILD = 0x40000000;
  private const uint WS_POPUP = 0x80000000;
  private const uint WS_CAPTION = 0x00C00000;
  private const uint WS_THICKFRAME = 0x00040000;
  private const uint WS_EX_APPWINDOW = 0x00040000;
  private const uint SWP_NOSIZE = 0x0001;
  private const uint SWP_NOMOVE = 0x0002;
  private const uint SWP_NOZORDER = 0x0004;
  private const uint SWP_NOACTIVATE = 0x0010;
  private const uint SWP_FRAMECHANGED = 0x0020;
  private const uint SWP_SHOWWINDOW = 0x0040;
  private const int SW_RESTORE = 9;

  [StructLayout(LayoutKind.Sequential)]
  private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError = true)] private static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll", SetLastError = true)] private static extern int SetWindowLong(IntPtr hwnd, int index, int value);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool ShowWindow(IntPtr hwnd, int command);

  public static PageAutoDockSnapshot Dock(long hwndValue, long parentValue) {
    var hwnd = new IntPtr(hwndValue);
    var parent = new IntPtr(parentValue);
    if (!IsWindow(hwnd)) return null;
    RECT rect;
    if (!GetWindowRect(hwnd, out rect)) return null;

    var snapshot = new PageAutoDockSnapshot {
      Hwnd = hwndValue,
      Parent = GetParent(hwnd).ToInt64(),
      Style = GetWindowLong(hwnd, GWL_STYLE),
      ExStyle = GetWindowLong(hwnd, GWL_EXSTYLE),
      X = rect.Left,
      Y = rect.Top,
      Width = Math.Max(1, rect.Right - rect.Left),
      Height = Math.Max(1, rect.Bottom - rect.Top)
    };

    SetParent(hwnd, parent);
    var style = unchecked((uint)snapshot.Style);
    style |= WS_CHILD;
    style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME);
    SetWindowLong(hwnd, GWL_STYLE, unchecked((int)style));
    var exStyle = unchecked((uint)snapshot.ExStyle) & ~WS_EX_APPWINDOW;
    SetWindowLong(hwnd, GWL_EXSTYLE, unchecked((int)exStyle));
    ShowWindow(hwnd, SW_RESTORE);
    SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    return snapshot;
  }

  public static bool Move(long hwndValue, int x, int y, int width, int height) {
    var hwnd = new IntPtr(hwndValue);
    return IsWindow(hwnd) && SetWindowPos(hwnd, IntPtr.Zero, x, y, Math.Max(1, width), Math.Max(1, height), SWP_NOACTIVATE | SWP_SHOWWINDOW);
  }

  public static bool Restore(long hwndValue, long parentValue, int style, int exStyle, int x, int y, int width, int height) {
    var hwnd = new IntPtr(hwndValue);
    if (!IsWindow(hwnd)) return true;
    SetParent(hwnd, new IntPtr(parentValue));
    SetWindowLong(hwnd, GWL_STYLE, style);
    SetWindowLong(hwnd, GWL_EXSTYLE, exStyle);
    return SetWindowPos(hwnd, IntPtr.Zero, x, y, Math.Max(1, width), Math.Max(1, height), SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
  }
}
`

const DOCK_WINDOWS_SCRIPT = String.raw`
$targets = @((ConvertFrom-Json $env:PAGE_AUTO_DOCK_TARGETS))
$parent = [Int64]$env:PAGE_AUTO_DOCK_PARENT
$chrome = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue)
$matches = @()
foreach ($target in $targets) {
  $profile = [string]$target.profileDirectory
  $processInfo = $null
  foreach ($candidate in $chrome) {
    if (-not $candidate.CommandLine) { continue }
    if ($candidate.CommandLine.IndexOf($profile, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
    $process = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
    if ($process -and $process.MainWindowHandle -ne 0) { $processInfo = $process; break }
  }
  if ($processInfo) {
    $matches += [pscustomobject]@{ accountId = [int]$target.accountId; label = [string]$target.label; hwnd = [string]$processInfo.MainWindowHandle.ToInt64() }
  }
}
if ($matches.Count -eq 0) { ConvertTo-Json -InputObject @() -Compress; exit 0 }
Add-Type -TypeDefinition @'
${NATIVE_DOCK_CSHARP}
'@
$result = @()
foreach ($match in $matches) {
  $snapshot = [PageAutoNativeDock]::Dock([Int64]$match.hwnd, $parent)
  if (-not $snapshot) { continue }
  $result += [pscustomobject]@{
    accountId = [int]$match.accountId
    label = [string]$match.label
    hwnd = [string]$snapshot.Hwnd
    parent = [string]$snapshot.Parent
    style = [int]$snapshot.Style
    exStyle = [int]$snapshot.ExStyle
    x = [int]$snapshot.X
    y = [int]$snapshot.Y
    width = [int]$snapshot.Width
    height = [int]$snapshot.Height
  }
}
ConvertTo-Json -InputObject @($result) -Compress
`

const MOVE_WINDOWS_HOST_SCRIPT = String.raw`
Add-Type -TypeDefinition @'
${NATIVE_DOCK_CSHARP}
'@
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $items = @((ConvertFrom-Json $line))
    foreach ($item in $items) {
      [void][PageAutoNativeDock]::Move([Int64]$item.hwnd, [int]$item.x, [int]$item.y, [int]$item.width, [int]$item.height)
    }
  } catch {
  }
}
`

const RESTORE_WINDOWS_SCRIPT = String.raw`
Add-Type -TypeDefinition @'
${NATIVE_DOCK_CSHARP}
'@
$items = @((ConvertFrom-Json $env:PAGE_AUTO_DOCK_WINDOWS))
foreach ($item in $items) {
  [void][PageAutoNativeDock]::Restore(
    [Int64]$item.hwnd,
    [Int64]$item.parent,
    [int]$item.style,
    [int]$item.exStyle,
    [int]$item.x,
    [int]$item.y,
    [int]$item.width,
    [int]$item.height
  )
}
`

function windowHandleString(window: BrowserWindow): string {
  const handle = window.getNativeWindowHandle()
  if (handle.length >= 8) return handle.readBigUInt64LE(0).toString()
  return BigInt(handle.readUInt32LE(0)).toString()
}

function parseEmbeddedWindows(stdout: string): EmbeddedWindow[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  const parsed = JSON.parse(trimmed) as EmbeddedWindow | EmbeddedWindow[] | null
  if (!parsed) return []
  return Array.isArray(parsed) ? parsed : [parsed]
}

async function runPowerShell(script: string, env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      windowsHide: true,
      timeout: POWERSHELL_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    }
  )
  return stdout
}

const MANAGER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;background:#eaf7ff;font-family:Segoe UI,Arial,sans-serif}
body{overflow:auto}
#dock-root{position:relative;width:1px;height:1px;min-width:1px;min-height:1px}
#dock-empty{position:fixed;inset:0;display:grid;place-items:center;color:#52606d;font-size:14px;user-select:none}
#dock-empty[hidden]{display:none}
</style></head><body><div id="dock-root"><div id="dock-empty">Chưa có Chrome profile đang mở.</div></div>
<script>
window.pageAutoSetDockMetrics = function(width, height, empty) {
  var root = document.getElementById('dock-root');
  var placeholder = document.getElementById('dock-empty');
  root.style.width = Math.max(1, Math.round(width)) + 'px';
  root.style.height = Math.max(1, Math.round(height)) + 'px';
  placeholder.hidden = !empty;
};
window.pageAutoGetDockViewport = function() {
  return {
    width: Math.max(1, document.documentElement.clientWidth || window.innerWidth || 1),
    height: Math.max(1, document.documentElement.clientHeight || window.innerHeight || 1),
    scrollX: Math.max(0, Math.round(window.scrollX || 0)),
    scrollY: Math.max(0, Math.round(window.scrollY || 0))
  };
};
</script></body></html>`

export class AccountBrowserDockManager {
  private window: BrowserWindow | null = null
  private readonly embedded = new Map<number, EmbeddedWindow>()
  private readonly layoutCells = new Map<number, AccountBrowserDockCell>()
  private operation = Promise.resolve()
  private layoutTimer: NodeJS.Timeout | null = null
  private discoverTimer: NodeJS.Timeout | null = null
  private scrollTimer: NodeJS.Timeout | null = null
  private moveHost: ChildProcessWithoutNullStreams | null = null
  private closing = false
  private scrollReadBusy = false
  private lastScrollX = 0
  private lastScrollY = 0

  constructor(private readonly getTargets: () => AccountBrowserDockTarget[]) {
    ipcMain.handle(ACCOUNT_BROWSER_DOCK_IPC.open, (event) => this.openExplicit(BrowserWindow.fromWebContents(event.sender)))
  }

  /**
   * Compatibility entry point for the old account-open hook in ipc.ts.
   * Opening a profile must never auto-dock it. Only the explicit IPC above may open/sync the manager.
   */
  async open(_owner: BrowserWindow | null): Promise<AccountBrowserDockOpenResult> {
    return {
      status: 'idle',
      embeddedCount: this.embedded.size,
      message: 'Chrome chỉ được gom khi bấm Cửa sổ Chrome.'
    }
  }

  /** Compatibility no-op for the old post-open sync hook. */
  async sync(): Promise<void> {}

  accountClosed(accountId: number): void {
    if (!this.embedded.delete(accountId)) return
    this.layoutCells.delete(accountId)
    this.scheduleLayout()
  }

  dispose(): void {
    ipcMain.removeHandler(ACCOUNT_BROWSER_DOCK_IPC.open)
    if (this.layoutTimer) clearTimeout(this.layoutTimer)
    if (this.discoverTimer) clearTimeout(this.discoverTimer)
    if (this.scrollTimer) clearInterval(this.scrollTimer)
    this.layoutTimer = null
    this.discoverTimer = null
    this.scrollTimer = null
    this.stopMoveHost()
    this.layoutCells.clear()
    this.embedded.clear()
    this.closing = true
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  private async openExplicit(owner: BrowserWindow | null): Promise<AccountBrowserDockOpenResult> {
    if (process.platform !== 'win32') {
      return { status: 'unsupported', embeddedCount: 0, message: 'Quản lý cửa sổ Chrome chỉ hỗ trợ Windows.' }
    }

    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
      await this.enqueueSync()
      return {
        status: 'focused',
        embeddedCount: this.embedded.size,
        message: `Đang quản lý ${this.embedded.size} cửa sổ Chrome.`
      }
    }

    const manager = new BrowserWindow({
      width: 1100,
      height: 720,
      minWidth: 720,
      minHeight: 480,
      title: 'Quản lý cửa sổ Chrome',
      backgroundColor: '#eaf7ff',
      autoHideMenuBar: true,
      show: false,
      ...(owner && !owner.isDestroyed() ? { parent: owner } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.window = manager
    this.closing = false
    this.lastScrollX = 0
    this.lastScrollY = 0

    manager.on('resize', () => this.scheduleLayout())
    manager.on('close', (event) => {
      if (this.closing || this.embedded.size === 0) return
      event.preventDefault()
      this.closing = true
      if (this.scrollTimer) clearInterval(this.scrollTimer)
      this.scrollTimer = null
      void this.restoreAll().then(() => {
        if (!manager.isDestroyed()) manager.destroy()
      }).catch((error) => {
        this.closing = false
        this.startScrollWatcher()
        if (!manager.isDestroyed()) {
          manager.setTitle('Quản lý cửa sổ Chrome - lỗi tách cửa sổ')
          manager.show()
          manager.focus()
        }
        console.error('[PAGE-AUTO browser-dock] restore failed', error)
      })
    })
    manager.on('closed', () => {
      if (this.layoutTimer) clearTimeout(this.layoutTimer)
      if (this.discoverTimer) clearTimeout(this.discoverTimer)
      if (this.scrollTimer) clearInterval(this.scrollTimer)
      this.layoutTimer = null
      this.discoverTimer = null
      this.scrollTimer = null
      this.stopMoveHost()
      this.window = null
      this.layoutCells.clear()
      this.embedded.clear()
      this.closing = false
      this.scrollReadBusy = false
    })

    await manager.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(MANAGER_HTML)}`)
    manager.show()
    this.startScrollWatcher()
    await this.enqueueSync()
    return {
      status: 'opened',
      embeddedCount: this.embedded.size,
      message: this.embedded.size > 0
        ? `Đã gom ${this.embedded.size} cửa sổ Chrome vào trình quản lý.`
        : 'Đã mở trình quản lý. Chưa có Chrome profile nào đang mở.'
    }
  }

  private enqueueSync(): Promise<void> {
    this.operation = this.operation.then(() => this.syncNow()).catch((error) => {
      console.error('[PAGE-AUTO browser-dock] sync failed', error)
    })
    return this.operation
  }

  private async syncNow(): Promise<void> {
    const manager = this.window
    if (!manager || manager.isDestroyed() || this.closing) return

    const targetById = new Map(this.getTargets().map((target) => [target.accountId, target]))
    for (const accountId of [...this.embedded.keys()]) {
      if (!targetById.has(accountId)) {
        this.embedded.delete(accountId)
        this.layoutCells.delete(accountId)
      }
    }

    const missing = [...targetById.values()].filter((target) => !this.embedded.has(target.accountId))
    if (missing.length > 0) {
      const stdout = await runPowerShell(DOCK_WINDOWS_SCRIPT, {
        PAGE_AUTO_DOCK_PARENT: windowHandleString(manager),
        PAGE_AUTO_DOCK_TARGETS: JSON.stringify(missing)
      })
      for (const item of parseEmbeddedWindows(stdout)) this.embedded.set(item.accountId, item)
    }

    await this.layoutNow()
    const unresolved = [...targetById.keys()].some((accountId) => !this.embedded.has(accountId))
    if (unresolved) this.scheduleDiscover()
    else if (this.discoverTimer) {
      clearTimeout(this.discoverTimer)
      this.discoverTimer = null
    }
  }

  private scheduleDiscover(): void {
    if (this.discoverTimer || this.closing) return
    this.discoverTimer = setTimeout(() => {
      this.discoverTimer = null
      void this.enqueueSync()
    }, 700)
  }

  private scheduleLayout(): void {
    if (this.layoutTimer) clearTimeout(this.layoutTimer)
    this.layoutTimer = setTimeout(() => {
      this.layoutTimer = null
      this.operation = this.operation.then(() => this.layoutNow()).catch((error) => {
        console.error('[PAGE-AUTO browser-dock] layout failed', error)
      })
    }, 120)
  }

  private startScrollWatcher(): void {
    if (this.scrollTimer || this.closing) return
    this.scrollTimer = setInterval(() => void this.pollScroll(), SCROLL_POLL_MS)
  }

  private async pollScroll(): Promise<void> {
    if (this.scrollReadBusy || this.closing || this.embedded.size === 0) return
    const manager = this.window
    if (!manager || manager.isDestroyed()) return
    this.scrollReadBusy = true
    try {
      const viewport = await this.readViewport(manager)
      if (viewport.scrollX === this.lastScrollX && viewport.scrollY === this.lastScrollY) return
      this.lastScrollX = viewport.scrollX
      this.lastScrollY = viewport.scrollY
      this.positionEmbedded(viewport.scrollX, viewport.scrollY)
    } catch {
      // The manager can disappear between interval ticks; the close path owns cleanup.
    } finally {
      this.scrollReadBusy = false
    }
  }

  private async layoutNow(): Promise<void> {
    const manager = this.window
    if (!manager || manager.isDestroyed() || this.closing) return
    const entries = [...this.embedded.values()].sort((left, right) => left.accountId - right.accountId)

    manager.setTitle(entries.length > 0 ? `Quản lý cửa sổ Chrome (${entries.length})` : 'Quản lý cửa sổ Chrome')
    if (entries.length === 0) {
      this.layoutCells.clear()
      await this.setDockMetrics(manager, 1, 1, true)
      return
    }

    let viewport = await this.readViewport(manager)
    let layout = computeAccountBrowserDockLayout(
      viewport.width,
      entries.map((item) => ({ width: item.width, height: item.height })),
      DOCK_GAP_PX
    )
    await this.setDockMetrics(manager, layout.contentWidth, layout.contentHeight, false)

    const nextViewport = await this.readViewport(manager)
    if (nextViewport.width !== viewport.width) {
      viewport = nextViewport
      layout = computeAccountBrowserDockLayout(
        viewport.width,
        entries.map((item) => ({ width: item.width, height: item.height })),
        DOCK_GAP_PX
      )
      await this.setDockMetrics(manager, layout.contentWidth, layout.contentHeight, false)
    } else {
      viewport = nextViewport
    }

    this.layoutCells.clear()
    entries.forEach((item, index) => {
      const cell = layout.cells[index]
      if (cell) this.layoutCells.set(item.accountId, cell)
    })
    this.lastScrollX = viewport.scrollX
    this.lastScrollY = viewport.scrollY
    this.positionEmbedded(viewport.scrollX, viewport.scrollY)
  }

  private async setDockMetrics(manager: BrowserWindow, width: number, height: number, empty: boolean): Promise<void> {
    await manager.webContents.executeJavaScript(
      `window.pageAutoSetDockMetrics(${Math.max(1, Math.round(width))}, ${Math.max(1, Math.round(height))}, ${empty})`,
      true
    )
  }

  private async readViewport(manager: BrowserWindow): Promise<DockViewportState> {
    const raw = await manager.webContents.executeJavaScript('window.pageAutoGetDockViewport()', true) as Partial<DockViewportState>
    return {
      width: Math.max(1, Math.floor(Number(raw.width) || 1)),
      height: Math.max(1, Math.floor(Number(raw.height) || 1)),
      scrollX: Math.max(0, Math.floor(Number(raw.scrollX) || 0)),
      scrollY: Math.max(0, Math.floor(Number(raw.scrollY) || 0))
    }
  }

  private positionEmbedded(scrollX: number, scrollY: number): void {
    const entries = [...this.embedded.values()].sort((left, right) => left.accountId - right.accountId)
    const moveItems = entries.flatMap((item) => {
      const cell = this.layoutCells.get(item.accountId)
      if (!cell) return []
      return [{
        hwnd: item.hwnd,
        x: cell.x - scrollX,
        y: cell.y - scrollY,
        width: cell.width,
        height: cell.height
      }]
    })
    if (moveItems.length === 0) return
    this.sendMove(moveItems)
  }

  private ensureMoveHost(): ChildProcessWithoutNullStreams {
    const current = this.moveHost
    if (current && current.exitCode === null && !current.killed) return current

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', MOVE_WINDOWS_HOST_SCRIPT],
      { windowsHide: true }
    )
    child.stdout.resume()
    child.stderr.on('data', (chunk) => {
      const message = String(chunk).trim()
      if (message) console.error('[PAGE-AUTO browser-dock] move host:', message)
    })
    child.once('error', (error) => {
      if (this.moveHost === child) this.moveHost = null
      console.error('[PAGE-AUTO browser-dock] move host failed', error)
    })
    child.once('exit', () => {
      if (this.moveHost === child) this.moveHost = null
    })
    this.moveHost = child
    return child
  }

  private sendMove(items: Array<{ hwnd: string; x: number; y: number; width: number; height: number }>): void {
    try {
      const child = this.ensureMoveHost()
      if (!child.stdin.destroyed && child.stdin.writable) child.stdin.write(`${JSON.stringify(items)}\n`)
    } catch (error) {
      console.error('[PAGE-AUTO browser-dock] move failed', error)
    }
  }

  private stopMoveHost(): void {
    const child = this.moveHost
    this.moveHost = null
    if (!child) return
    try { child.stdin.end() } catch {}
    try { if (!child.killed) child.kill() } catch {}
  }

  private async restoreAll(): Promise<void> {
    const entries = [...this.embedded.values()]
    this.stopMoveHost()
    if (entries.length === 0) return
    await runPowerShell(RESTORE_WINDOWS_SCRIPT, { PAGE_AUTO_DOCK_WINDOWS: JSON.stringify(entries) })
    this.layoutCells.clear()
    this.embedded.clear()
  }
}
