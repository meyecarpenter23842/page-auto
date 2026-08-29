import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { BrowserWindow } from 'electron'
import {
  computeAccountBrowserDockCells,
  type AccountBrowserDockOpenResult
} from '../../shared/accountBrowserDock'

const execFileAsync = promisify(execFile)
const DOCK_GAP_PX = 4
const POWERSHELL_TIMEOUT_MS = 12_000

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
  [DllImport("user32.dll", SetLastError = true)] private static extern bool MoveWindow(IntPtr hwnd, int x, int y, int width, int height, bool repaint);
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

const MOVE_WINDOWS_SCRIPT = String.raw`
Add-Type -TypeDefinition @'
${NATIVE_DOCK_CSHARP}
'@
$items = @((ConvertFrom-Json $env:PAGE_AUTO_DOCK_WINDOWS))
foreach ($item in $items) {
  [void][PageAutoNativeDock]::Move([Int64]$item.hwnd, [int]$item.x, [int]$item.y, [int]$item.width, [int]$item.height)
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

const EMPTY_MANAGER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body,#dock-root{margin:0;width:100%;height:100%;overflow:hidden;background:#eaf7ff;font-family:Segoe UI,Arial,sans-serif}
#dock-empty{position:absolute;inset:0;display:grid;place-items:center;color:#52606d;font-size:14px;user-select:none}
</style></head><body><div id="dock-root"><div id="dock-empty">Chưa có Chrome profile đang mở.</div></div>
<script>
window.pageAutoSetDockEmpty = function(empty) {
  var root = document.getElementById('dock-root');
  root.innerHTML = empty ? '<div id="dock-empty">Chưa có Chrome profile đang mở.</div>' : '';
};
</script></body></html>`

export class AccountBrowserDockManager {
  private window: BrowserWindow | null = null
  private readonly embedded = new Map<number, EmbeddedWindow>()
  private operation = Promise.resolve()
  private resizeTimer: NodeJS.Timeout | null = null
  private discoverTimer: NodeJS.Timeout | null = null
  private closing = false

  constructor(private readonly getTargets: () => AccountBrowserDockTarget[]) {}

  async open(owner: BrowserWindow | null): Promise<AccountBrowserDockOpenResult> {
    if (process.platform !== 'win32') {
      return { status: 'unsupported', embeddedCount: 0, message: 'Quản lý cửa sổ Chrome chỉ hỗ trợ Windows.' }
    }

    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
      await this.sync()
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

    manager.on('resize', () => this.scheduleRetile())
    manager.on('close', (event) => {
      if (this.closing || this.embedded.size === 0) return
      event.preventDefault()
      this.closing = true
      void this.restoreAll().then(() => {
        if (!manager.isDestroyed()) manager.destroy()
      }).catch((error) => {
        this.closing = false
        if (!manager.isDestroyed()) {
          manager.setTitle('Quản lý cửa sổ Chrome - lỗi tách cửa sổ')
          manager.show()
          manager.focus()
        }
        console.error('[PAGE-AUTO browser-dock] restore failed', error)
      })
    })
    manager.on('closed', () => {
      if (this.resizeTimer) clearTimeout(this.resizeTimer)
      if (this.discoverTimer) clearTimeout(this.discoverTimer)
      this.resizeTimer = null
      this.discoverTimer = null
      this.window = null
      this.embedded.clear()
      this.closing = false
    })

    await manager.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(EMPTY_MANAGER_HTML)}`)
    manager.show()
    await this.sync()
    return {
      status: 'opened',
      embeddedCount: this.embedded.size,
      message: this.embedded.size > 0
        ? `Đã gom ${this.embedded.size} cửa sổ Chrome vào trình quản lý.`
        : 'Đã mở trình quản lý. Chưa có Chrome profile nào đang mở.'
    }
  }

  async sync(): Promise<void> {
    this.operation = this.operation.then(() => this.syncNow()).catch((error) => {
      console.error('[PAGE-AUTO browser-dock] sync failed', error)
    })
    return this.operation
  }

  accountClosed(accountId: number): void {
    if (!this.embedded.delete(accountId)) return
    this.scheduleRetile()
  }

  dispose(): void {
    if (this.resizeTimer) clearTimeout(this.resizeTimer)
    if (this.discoverTimer) clearTimeout(this.discoverTimer)
    this.resizeTimer = null
    this.discoverTimer = null
    this.embedded.clear()
    this.closing = true
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  private async syncNow(): Promise<void> {
    const manager = this.window
    if (!manager || manager.isDestroyed() || this.closing) return

    const targetById = new Map(this.getTargets().map((target) => [target.accountId, target]))
    for (const accountId of [...this.embedded.keys()]) {
      if (!targetById.has(accountId)) this.embedded.delete(accountId)
    }

    const missing = [...targetById.values()].filter((target) => !this.embedded.has(target.accountId))
    if (missing.length > 0) {
      const stdout = await runPowerShell(DOCK_WINDOWS_SCRIPT, {
        PAGE_AUTO_DOCK_PARENT: windowHandleString(manager),
        PAGE_AUTO_DOCK_TARGETS: JSON.stringify(missing)
      })
      for (const item of parseEmbeddedWindows(stdout)) this.embedded.set(item.accountId, item)
    }

    await this.retileNow()
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
      void this.sync()
    }, 700)
  }

  private scheduleRetile(): void {
    if (this.resizeTimer) clearTimeout(this.resizeTimer)
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null
      this.operation = this.operation.then(() => this.retileNow()).catch((error) => {
        console.error('[PAGE-AUTO browser-dock] retile failed', error)
      })
    }, 120)
  }

  private async retileNow(): Promise<void> {
    const manager = this.window
    if (!manager || manager.isDestroyed() || this.closing) return
    const entries = [...this.embedded.values()].sort((left, right) => left.accountId - right.accountId)
    const bounds = manager.getContentBounds()
    const cells = computeAccountBrowserDockCells(bounds.width, bounds.height, entries.length, DOCK_GAP_PX)
    const moveItems = entries.map((item, index) => {
      const cell = cells[index]
      if (!cell) return null
      return {
        hwnd: item.hwnd,
        x: cell.x,
        y: cell.y,
        width: cell.width,
        height: cell.height
      }
    }).filter((item): item is NonNullable<typeof item> => item !== null)

    manager.setTitle(entries.length > 0 ? `Quản lý cửa sổ Chrome (${entries.length})` : 'Quản lý cửa sổ Chrome')
    await manager.webContents.executeJavaScript(`window.pageAutoSetDockEmpty(${entries.length === 0})`, true).catch(() => undefined)
    if (moveItems.length === 0) return
    await runPowerShell(MOVE_WINDOWS_SCRIPT, { PAGE_AUTO_DOCK_WINDOWS: JSON.stringify(moveItems) })
  }

  private async restoreAll(): Promise<void> {
    const entries = [...this.embedded.values()]
    if (entries.length === 0) return
    await runPowerShell(RESTORE_WINDOWS_SCRIPT, { PAGE_AUTO_DOCK_WINDOWS: JSON.stringify(entries) })
    this.embedded.clear()
  }
}
