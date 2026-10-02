# Flujo de la app INSTALADA abierta desde el menu Inicio (E7/E8). Uso: .\e7-flow.ps1 -Lnk "<ruta al .lnk>" -Evidence "<carpeta>"
# La app empaquetada no admite CDP/inspector (fuses), asi que se maneja con teclas reales de Windows, SOLO con la ventana de la app
# en primer plano, y se captura unicamente la ventana de la app (PrintWindow), nunca el escritorio.
param([Parameter(Mandatory)][string]$Lnk, [Parameter(Mandatory)][string]$Evidence, [string]$Prefix = 'e7')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public class N {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
'@
function Fg { $s = New-Object System.Text.StringBuilder 256; [void][N]::GetWindowText([N]::GetForegroundWindow(), $s, 256); $s.ToString() }
function AppProc { Get-Process Assessment -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
function Activate { $p = AppProc; if ($p) { [N]::keybd_event(0x12,0,0,[UIntPtr]::Zero); [N]::keybd_event(0x12,0,2,[UIntPtr]::Zero); [void][N]::SetForegroundWindow($p.MainWindowHandle) } }
function Shot($name) {
  $p = AppProc; $r = New-Object N+RECT; [void][N]::GetWindowRect($p.MainWindowHandle, [ref]$r)
  $w = $r.R - $r.L; $h = $r.B - $r.T
  $bmp = New-Object System.Drawing.Bitmap $w, $h; $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
  [void][N]::PrintWindow($p.MainWindowHandle, $dc, 2); $g.ReleaseHdc($dc); $g.Dispose()
  $bmp.Save((Join-Path $Evidence "$Prefix-$name.png")); $bmp.Dispose()
}
function Ok($cond, $msg) { if (-not $cond) { throw "FALLO: $msg" }; Write-Output "  ok  $msg" }

wsl.exe -d Ubuntu --exec bash -c 'docker ps -aq | xargs -r docker rm -f >/dev/null'
Get-Process Assessment -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 1

Write-Output "== abrir desde el acceso del menu Inicio"
Start-Process -FilePath $Lnk
$p = $null
for ($i = 0; $i -lt 30 -and -not $p; $i++) { Start-Sleep 1; $p = AppProc }
Ok ($null -ne $p) 'la app abre una ventana'
Ok ($p.MainWindowTitle -eq 'Assessment') "titulo de la ventana inicial: $($p.MainWindowTitle)"
Start-Sleep 3
Ok ([N]::IsZoomed($p.MainWindowHandle)) 'la ventana abre maximizada'
Ok ([N]::GetMenu($p.MainWindowHandle) -eq [IntPtr]::Zero) 'la ventana no tiene menu'
Activate; Start-Sleep -Milliseconds 800
Shot 'inicio'

Write-Output "== elegir alumno y examen (primer elemento) y pulsar Iniciar, sin tocar una terminal"
Ok ((Fg).StartsWith('Assessment')) 'la app tiene el foco antes de mandar teclas'
[System.Windows.Forms.SendKeys]::SendWait('{TAB}{TAB}{TAB}{ENTER}')
$name = ''
for ($i = 0; $i -lt 90 -and -not $name; $i++) { Start-Sleep 2; $name = (wsl.exe -d Ubuntu --exec docker ps --format '{{.Names}}' | Out-String).Trim() }
Ok ($name -match '^assessment-\d+-[0-9a-f]{6}$') "se levanto el contenedor $name"
$title = ''
for ($i = 0; $i -lt 90; $i++) { Start-Sleep 2; $title = (AppProc).MainWindowTitle; if ($title -like '*Ana Alumna*') { break } }
Ok ($title -like '*Ana Alumna*Examen Spring Boot*') "titulo con alumno y examen: $title"
Start-Sleep 25
Shot 'ide'
$branch = (wsl.exe -d Ubuntu --exec docker exec -u coder $name git -C /workspace rev-parse --abbrev-ref HEAD | Out-String).Trim()
Ok ($branch -match '^session-\d+-[0-9a-f]{6}$') "repo clonado en la rama $branch"
wsl.exe -d Ubuntu --exec docker exec -u coder $name test -f /workspace/pom.xml
Ok ($LASTEXITCODE -eq 0) 'el repo del examen esta en /workspace'
Write-Output "E7-FLOW OK"
