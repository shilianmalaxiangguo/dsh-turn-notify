# dsh-turn-notify - bottom-right desktop popup renderer.
#
# Windows XP "Luna" message box, following the XP.css window recipe the
# reference project cites (themes/XP/_window.scss) for the frame and caption,
# and the Luna dialog metrics for the client area:
#
#   * a three-pixel blue frame built from six inset one-pixel edges
#     (#0831d9/#00138c, #166aee/#001ea0, #0855dd/#003bda),
#   * an eight-pixel top rounding that squares off at the bottom,
#   * the eight-stop Luna caption gradient with Trebuchet MS bold text and its
#     #0f1089 drop shadow, a 16px caption icon, and 21px title buttons
#     (one-pixel white border, three-pixel radius, red-orange close gradient,
#     1px 1px 0 #003bda shadow),
#   * a #ece9d8 client area laid out like a real message box: a 32px status
#     icon, the message beside it, a muted detail line, and a raised Luna
#     push button - not a sunken white text field.
#
# It is anchored to the bottom-right corner of the primary screen's working area
# and NEVER closes itself: the user dismisses it with the caption X, the close
# button, a right-click, or Esc.
#
# This file is deliberately ASCII-only. Windows PowerShell 5.1 decodes a .ps1
# without a BOM using the machine's ANSI code page, so every localized string
# travels in -Payload as base64(UTF-8 JSON) and is decoded explicitly below.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Payload
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- payload ---

try {
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))
    $cfg = $json | ConvertFrom-Json
} catch {
    exit 2
}

function Get-Cfg {
    param([string]$Key, $Default)
    $value = $cfg.PSObject.Properties[$Key]
    if ($null -eq $value -or $null -eq $value.Value) { return $Default }
    return $value.Value
}

# ------------------------------------------------------------------ win32 ---

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ('DshNotify.Native' -as [type])) {
    Add-Type -Namespace DshNotify -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);
[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr hWnd, System.IntPtr after, int x, int y, int cx, int cy, uint flags);
'@
}

# Per-monitor DPI awareness must be requested before any window exists, so the
# card is crisp on scaled displays; every pixel metric below is then scaled by
# hand. Font sizes stay in points, which GDI+ already resolves against the DPI.
try { [void][DshNotify.Native]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { }

function Get-ForegroundProcessName {
    try {
        $handle = [DshNotify.Native]::GetForegroundWindow()
        if ($handle -eq [IntPtr]::Zero) { return '' }
        $owner = 0
        [void][DshNotify.Native]::GetWindowThreadProcessId($handle, [ref]$owner)
        if ($owner -le 0) { return '' }
        return (Get-Process -Id $owner -ErrorAction Stop).ProcessName
    } catch {
        return ''
    }
}

# Skip silently when the user is already looking at the application.
$skipWhenFocused = [bool](Get-Cfg -Key 'skipWhenFocused' -Default $false)
$focusedProcess = [string](Get-Cfg -Key 'focusedProcess' -Default '')
if ($skipWhenFocused -and $focusedProcess) {
    $foreground = Get-ForegroundProcessName
    if ($foreground -and $foreground -ieq $focusedProcess) { exit 0 }
}

# ------------------------------------------------------------------ theme ---

$dpi = 96.0
try {
    $screenGraphics = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
    $dpi = [double]$screenGraphics.DpiX
    $screenGraphics.Dispose()
} catch { }
if ($dpi -le 0) { $dpi = 96.0 }
$scale = $dpi / 96.0

function Get-Color {
    param([string]$Value)
    return [System.Drawing.ColorTranslator]::FromHtml($Value)
}

function Get-Px {
    param([double]$Value)
    return [int][Math]::Round($Value * $scale)
}

# Luna badges are lit from the top: the same hue, lighter above and darker below.
function Get-Shade {
    param([System.Drawing.Color]$Color, [double]$Amount)
    if ($Amount -ge 0) {
        return [System.Drawing.Color]::FromArgb(
            $Color.A,
            [int]($Color.R + ((255 - $Color.R) * $Amount)),
            [int]($Color.G + ((255 - $Color.G) * $Amount)),
            [int]($Color.B + ((255 - $Color.B) * $Amount)))
    }
    $factor = 1 + $Amount
    return [System.Drawing.Color]::FromArgb($Color.A, [int]($Color.R * $factor), [int]($Color.G * $factor), [int]($Color.B * $factor))
}

# GDI+ resolves a point against the process DPI, so a design measured in pixels
# converts to points exactly once here.
function Get-Font {
    param([string]$Family, [double]$Px, [System.Drawing.FontStyle]$Style)
    try {
        return New-Object System.Drawing.Font($Family, ($Px * 0.75), $Style)
    } catch {
        return New-Object System.Drawing.Font('Tahoma', ($Px * 0.75), $Style)
    }
}

# A Latin-only family makes GDI+ fall back to a Song-style face for the Chinese
# text, which is what made the card look like 宋体. Prefer a modern CJK UI face.
function Resolve-UiFamily {
    param([string[]]$Candidates)
    $installed = @()
    try { $installed = @([System.Drawing.FontFamily]::Families | ForEach-Object { $_.Name }) } catch { }
    foreach ($candidate in $Candidates) {
        if ($installed -contains $candidate) { return $candidate }
    }
    return 'Tahoma'
}

$uiFamily = Resolve-UiFamily @('Microsoft YaHei UI', 'Microsoft YaHei', 'SimHei', 'Tahoma')

# ------------------------------------------------------------- XP tokens ----

$kind = [string](Get-Cfg -Key 'kind' -Default 'completed')
$accent = Get-Color -Value ([string](Get-Cfg -Key 'accent' -Default '#3CA03C'))

$frameTopA = Get-Color '#0831d9'
$frameTopB = Get-Color '#166aee'
$frameTopC = Get-Color '#0855dd'
$frameBottomA = Get-Color '#00138c'
$frameBottomB = Get-Color '#001ea0'
$frameBottomC = Get-Color '#003bda'
$face = Get-Color '#ece9d8'
$ink = Get-Color '#000000'
$detailInk = Get-Color '#4a4a4a'
$captionShadow = Get-Color '#0f1089'
$captionInk = Get-Color '#ffffff'
$buttonLine = Get-Color '#ffffff'
$buttonShadow = Get-Color '#003bda'
$closeA = Get-Color '#ffb19c'
$closeB = Get-Color '#e44821'
$closeC = Get-Color '#bc2515'
$closeDownA = Get-Color '#d4553f'
$closeDownB = Get-Color '#a92b18'

$captionStops = @(
    @(0.00, (Get-Color '#0997ff')),
    @(0.08, (Get-Color '#0053ee')),
    @(0.40, (Get-Color '#0050ee')),
    @(0.88, (Get-Color '#0066ff')),
    @(0.93, (Get-Color '#0066ff')),
    @(0.95, (Get-Color '#005bff')),
    @(0.96, (Get-Color '#003dd7')),
    @(1.00, (Get-Color '#003dd7'))
)

$captionFont = Get-Font -Family $uiFamily -Px 14 -Style ([System.Drawing.FontStyle]::Bold)
$headingFont = Get-Font -Family $uiFamily -Px 13 -Style ([System.Drawing.FontStyle]::Bold)
$bodyFont = Get-Font -Family $uiFamily -Px 12 -Style ([System.Drawing.FontStyle]::Regular)
$detailFont = Get-Font -Family $uiFamily -Px 11 -Style ([System.Drawing.FontStyle]::Regular)

# ---------------------------------------------------------------- geometry ---

$titleText = [string](Get-Cfg -Key 'title' -Default 'DSH')
$headingText = [string](Get-Cfg -Key 'heading' -Default '')
$bodyText = [string](Get-Cfg -Key 'body' -Default '')
$detailText = [string](Get-Cfg -Key 'meta' -Default '')

# Proportions follow the XP.css dialog recipe: a 26px caption, a 32px status
# icon aligned with the top of the message, 14px padding and a 14px gutter.
$frame = Get-Px 3
$captionHeight = Get-Px 26
$corner = Get-Px 8
$statusIcon = Get-Px 32
$titleButtonSize = Get-Px 21
$pad = Get-Px 14
$gapIconText = Get-Px 14
$gapBodyDetail = Get-Px 8
$maxBodyLines = 4
# The card hugs its content like a real message box; this only keeps a one-line
# notification from collapsing into a sliver.
$minClientHeight = Get-Px 96

$width = Get-Px ([int](Get-Cfg -Key 'width' -Default 380))
$margin = Get-Px ([int](Get-Cfg -Key 'margin' -Default 16))
$slot = [int](Get-Cfg -Key 'slot' -Default 0)

$textLeft = $frame + $pad + $statusIcon + $gapIconText
$textWidth = $width - $textLeft - $frame - $pad

$bodyHeight = 0
if ($bodyText -ne '') {
    $measured = [System.Windows.Forms.TextRenderer]::MeasureText(
        $bodyText,
        $bodyFont,
        (New-Object System.Drawing.Size($textWidth, 0)),
        [System.Windows.Forms.TextFormatFlags]::WordBreak)
    $lines = [Math]::Ceiling($measured.Height / [Math]::Max(1, $bodyFont.Height))
    $lines = [Math]::Max(1, [Math]::Min($maxBodyLines, [int]$lines))
    $bodyHeight = $lines * $bodyFont.Height
}

$detailHeight = if ($detailText -eq '') { 0 } else { $detailFont.Height }
# The conversation's own summary title sits above the prompt as a bold lead-in.
$headingHeight = if ($headingText -eq '') { 0 } else { $headingFont.Height + (Get-Px 3) }
$rowHeight = [Math]::Max($statusIcon, ($headingHeight + $bodyHeight))
$naturalClient = $pad + $rowHeight + $gapBodyDetail + $detailHeight + $pad
# The card hugs its content like a real message box; this only keeps a one-line
# notification from collapsing into a sliver.
$clientHeight = [Math]::Max($minClientHeight, $naturalClient)
$contentTop = $captionHeight + $pad
$bodyTop = $contentTop + $headingHeight
$detailTop = $contentTop + $rowHeight + $gapBodyDetail
$height = $captionHeight + $clientHeight + $frame

$work = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$left = $work.Right - $width - $margin
$top = $work.Bottom - $height - $margin - ($slot * ($height + (Get-Px 10)))
if ($top -lt $work.Top) { $top = $work.Top }

# ------------------------------------------------------------------- form ---

# A card that can be shown without stealing focus from whatever the user types
# in, double buffered so a hover repaint cannot tear the border and text, with
# the native drop shadow a floating window expects. Every type is fully
# qualified: the subclass needs System.ComponentModel.Primitives referenced too,
# and a class that fails to compile silently degrades to a plain Form - which is
# exactly how the card lost its buffering before.
$formType = [System.Windows.Forms.Form]
try {
    if (-not ('DshNotify.Card' -as [type])) {
        # Collect references from types that are already loadable. Never call
        # `Add-Type -AssemblyName System.ComponentModel.Primitives`: that assembly
        # does not exist in Windows PowerShell 5.1, and with the script's global
        # ErrorActionPreference = Stop its failure aborts the whole block, which
        # silently degrades the card to an unbuffered plain Form.
        $references = @([System.Windows.Forms.Form].Assembly.Location, [System.Drawing.Color].Assembly.Location)
        try {
            $component = [System.ComponentModel.Component].Assembly.Location
            if ($component -and ($references -notcontains $component)) { $references += $component }
        } catch { }
        Add-Type -ReferencedAssemblies $references -TypeDefinition @'
namespace DshNotify {
    public class Card : System.Windows.Forms.Form {
        public Card() {
            DoubleBuffered = true;
            SetStyle(System.Windows.Forms.ControlStyles.OptimizedDoubleBuffer
                | System.Windows.Forms.ControlStyles.AllPaintingInWmPaint
                | System.Windows.Forms.ControlStyles.UserPaint, true);
            UpdateStyles();
        }
        /** Readable from PowerShell so the buffering can be asserted. */
        public bool IsDoubleBuffered { get { return DoubleBuffered; } }
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override System.Windows.Forms.CreateParams CreateParams {
            get {
                System.Windows.Forms.CreateParams parameters = base.CreateParams;
                parameters.ClassStyle |= 0x00020000;
                return parameters;
            }
        }
    }
}
'@
    }
    $formType = [DshNotify.Card]
} catch {
    $formType = [System.Windows.Forms.Form]
}

$form = New-Object $formType
$form.Text = 'DSH'
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::None
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.BackColor = $face
$form.KeyPreview = $true
$form.Location = New-Object System.Drawing.Point -ArgumentList @($left, $top)
$form.Size = New-Object System.Drawing.Size -ArgumentList @($width, $height)

function New-TopRoundedPath {
    param([int]$W, [int]$H, [int]$Radius)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($Radius -le 0) {
        $path.AddRectangle((New-Object System.Drawing.Rectangle -ArgumentList @(0, 0, $W, $H)))
        return $path
    }
    $d = $Radius * 2
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddLine($Radius, 0, ($W - $Radius), 0)
    $path.AddArc(($W - $d), 0, $d, $d, 270, 90)
    $path.AddLine($W, $Radius, $W, $H)
    $path.AddLine($W, $H, 0, $H)
    $path.AddLine(0, $H, 0, $Radius)
    $path.CloseFigure()
    return $path
}

function New-RoundedPath {
    param([System.Drawing.Rectangle]$Rect, [int]$Radius)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = [Math]::Max(1, ($Radius * 2))
    $path.AddArc($Rect.X, $Rect.Y, $d, $d, 180, 90)
    $path.AddArc(($Rect.Right - $d), $Rect.Y, $d, $d, 270, 90)
    $path.AddArc(($Rect.Right - $d), ($Rect.Bottom - $d), $d, $d, 0, 90)
    $path.AddArc($Rect.X, ($Rect.Bottom - $d), $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

try {
    $form.Region = New-Object System.Drawing.Region -ArgumentList @((New-TopRoundedPath -W $width -H $height -Radius $corner))
} catch { }

# The caption close box sits centred in the 28px caption, five pixels from the
# client edge, exactly like the Luna caption buttons.
$titleButton = New-Object System.Drawing.Rectangle -ArgumentList @(
    ($width - $frame - (Get-Px 5) - $titleButtonSize),
    [int](($captionHeight - $titleButtonSize) / 2),
    $titleButtonSize,
    $titleButtonSize)
# Only the close box and its one-pixel drop shadow are repainted when the
# pointer crosses it, so the rest of the card never redraws.
$titleDirty = [System.Drawing.Rectangle]::Inflate($titleButton, 3, 3)

# --------------------------------------------------------------- behavior ---

$script:hoverTitle = $false
$script:pressingClose = $false
$script:dragging = $false
$script:dragOrigin = New-Object System.Drawing.Point -ArgumentList @(0, 0)

$form.Add_MouseMove({
    param($sender, $event)
    $overTitle = $titleButton.Contains($event.Location)
    # The pointer keeps the ordinary arrow: the legacy IDC_HAND resource only
    # ships at 32px on this system, so switching to it made the pointer look half
    # size on a 200% display. The hover highlight is the affordance instead.
    if ($overTitle -ne $script:hoverTitle) {
        $script:hoverTitle = $overTitle
        $form.Invalidate($titleDirty)
    }
    if (-not $script:dragging) { return }
    $now = [System.Windows.Forms.Cursor]::Position
    $form.Left += ($now.X - $script:dragOrigin.X)
    $form.Top += ($now.Y - $script:dragOrigin.Y)
    $script:dragOrigin = $now
})
$form.Add_MouseLeave({
    if ($script:hoverTitle) {
        $script:hoverTitle = $false
        $form.Invalidate($titleDirty)
    }
})
$form.Add_MouseDown({
    param($sender, $event)
    if ($event.Button -eq [System.Windows.Forms.MouseButtons]::Right) { $form.Close(); return }
    if ($event.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
    if ($titleButton.Contains($event.Location)) {
        $script:pressingClose = $true
        $form.Invalidate($titleDirty)
        return
    }
    $script:dragging = $true
    $script:dragOrigin = [System.Windows.Forms.Cursor]::Position
})
$form.Add_MouseUp({
    param($sender, $event)
    $script:dragging = $false
    if (-not $script:pressingClose) { return }
    $script:pressingClose = $false
    $form.Invalidate($titleDirty)
    if ($titleButton.Contains($event.Location)) { $form.Close() }
})
$form.Add_KeyDown({
    param($sender, $event)
    if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $form.Close() }
})

# ----------------------------------------------------------------- paint ----

function Draw-FrameRing {
    param($Graphics, [int]$Inset, [int]$Radius, $TopColor, $BottomColor)
    $x = $Inset + 0.5
    $y = $Inset + 0.5
    $w = $form.Width - ($Inset * 2) - 1
    $h = $form.Height - ($Inset * 2) - 1
    $topPen = New-Object System.Drawing.Pen -ArgumentList @($TopColor, 1)
    $bottomPen = New-Object System.Drawing.Pen -ArgumentList @($BottomColor, 1)
    $r = [Math]::Min($Radius, [Math]::Max(0, [int]($h / 2)))
    if ($r -gt 1) {
        $Graphics.DrawArc($topPen, $x, $y, ($r * 2), ($r * 2), 180, 90)
        $Graphics.DrawArc($topPen, ($x + $w - ($r * 2)), $y, ($r * 2), ($r * 2), 270, 90)
        $Graphics.DrawLine($topPen, ($x + $r), $y, ($x + $w - $r), $y)
        $Graphics.DrawLine($topPen, $x, ($y + $r), $x, ($y + $h))
        $Graphics.DrawLine($bottomPen, ($x + $w), ($y + $r), ($x + $w), ($y + $h))
    } else {
        $Graphics.DrawLine($topPen, $x, $y, ($x + $w), $y)
        $Graphics.DrawLine($topPen, $x, $y, $x, ($y + $h))
        $Graphics.DrawLine($bottomPen, ($x + $w), $y, ($x + $w), ($y + $h))
    }
    $Graphics.DrawLine($bottomPen, $x, ($y + $h), ($x + $w), ($y + $h))
    $topPen.Dispose()
    $bottomPen.Dispose()
}

# Draws the status glyph: a Luna-style round or triangular badge with a white or
# black mark, centred on the badge rather than on the em box.
function Draw-StatusIcon {
    param($Graphics, [int]$X, [int]$Y, [int]$Size)
    $smoothing = $Graphics.SmoothingMode
    $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $u = $Size / 32.0
    $triangle = $kind -ne 'completed' -and $kind -ne 'error' -and $kind -ne 'forked'

    if ($triangle) {
        # XP warning: yellow triangle, darker gold at the bottom, black bang.
        $points = [System.Drawing.PointF[]]@(
            (New-Object System.Drawing.PointF -ArgumentList @(($X + ($Size / 2.0)), ($Y + (1.6 * $u)))),
            (New-Object System.Drawing.PointF -ArgumentList @(($X + $Size - (1.2 * $u)), ($Y + $Size - (4.2 * $u)))),
            (New-Object System.Drawing.PointF -ArgumentList @(($X + (1.2 * $u)), ($Y + $Size - (4.2 * $u))))
        )
        $rect = New-Object System.Drawing.Rectangle -ArgumentList @($X, $Y, $Size, $Size)
        $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @(
            $rect, (Get-Color '#fffde8'), (Get-Color '#e8a400'), [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
        $blend = New-Object System.Drawing.Drawing2D.ColorBlend
        $blend.Colors = [System.Drawing.Color[]]@((Get-Color '#fffde8'), (Get-Color '#ffe25c'), (Get-Color '#e8a400'))
        $blend.Positions = [single[]]@(0.0, 0.55, 1.0)
        $brush.InterpolationColors = $blend
        $Graphics.FillPolygon($brush, $points)
        $brush.Dispose()
        $edge = New-Object System.Drawing.Pen -ArgumentList @((Get-Color '#7a6000'), (1.2 * $u))
        $edge.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
        $Graphics.DrawPolygon($edge, $points)
        $edge.Dispose()

        $cx = $X + ($Size / 2.0)
        $bar = New-Object System.Drawing.Pen -ArgumentList @($ink, (3.0 * $u))
        $bar.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $bar.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $Graphics.DrawLine($bar, $cx, ($Y + (12.5 * $u)), $cx, ($Y + (20.5 * $u)))
        $bar.Dispose()
        $dot = New-Object System.Drawing.SolidBrush -ArgumentList @($ink)
        $Graphics.FillEllipse($dot, ($cx - (1.6 * $u)), ($Y + (22.8 * $u)), (3.2 * $u), (3.2 * $u))
        $dot.Dispose()
        $Graphics.SmoothingMode = $smoothing
        return
    }

    # XP sphere: a solid body plus a radial highlight in the upper left, so the
    # colour stays saturated instead of being pulled dark across the whole disc.
    $rect = New-Object System.Drawing.Rectangle -ArgumentList @($X, $Y, $Size, $Size)
    $body = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @(
        $rect, (Get-Shade -Color $accent -Amount 0.24), (Get-Shade -Color $accent -Amount -0.30), [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $Graphics.FillEllipse($body, $rect)
    $body.Dispose()

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse($rect)
    $lit = Get-Shade -Color $accent -Amount 0.85
    $glow = New-Object System.Drawing.Drawing2D.PathGradientBrush -ArgumentList @($path)
    $glow.CenterPoint = New-Object System.Drawing.PointF -ArgumentList @(($X + ($Size * 0.38)), ($Y + ($Size * 0.31)))
    $glow.CenterColor = [System.Drawing.Color]::FromArgb(235, $lit.R, $lit.G, $lit.B)
    $glow.SurroundColors = [System.Drawing.Color[]]@([System.Drawing.Color]::FromArgb(0, $lit.R, $lit.G, $lit.B))
    $Graphics.FillPath($glow, $path)
    $glow.Dispose()
    $rim = New-Object System.Drawing.Pen -ArgumentList @((Get-Shade -Color $accent -Amount -0.42), (1.1 * $u))
    $Graphics.DrawPath($rim, $path)
    $rim.Dispose()
    $path.Dispose()

    # The small specular dot the XP system icons all carry.
    $spec = New-Object System.Drawing.SolidBrush -ArgumentList @([System.Drawing.Color]::FromArgb(115, 255, 255, 255))
    $Graphics.FillEllipse($spec, ($X + ($Size * 0.23)), ($Y + ($Size * 0.16)), ($Size * 0.29), ($Size * 0.19))
    $spec.Dispose()

    # The glyph carries the one-pixel dark offset every XP system icon has.
    $cx = $X + ($Size / 2.0)
    $cy = $Y + ($Size / 2.0)
    switch ($kind) {
        'completed' {
            $segments = @(
                @(($cx - (7.6 * $u)), ($cy - (0.8 * $u)), ($cx - (2.4 * $u)), ($cy + (4.6 * $u))),
                @(($cx - (2.4 * $u)), ($cy + (4.6 * $u)), ($cx + (8.0 * $u)), ($cy - (5.6 * $u)))
            )
        }
        'error' {
            $segments = @(
                @(($cx - (5.2 * $u)), ($cy - (5.2 * $u)), ($cx + (5.2 * $u)), ($cy + (5.2 * $u))),
                @(($cx + (5.2 * $u)), ($cy - (5.2 * $u)), ($cx - (5.2 * $u)), ($cy + (5.2 * $u)))
            )
        }
        default {
            $segments = @(
                @($cx, ($cy - (6.0 * $u)), $cx, ($cy + (1.4 * $u))),
                @($cx, ($cy + (5.0 * $u)), $cx, ($cy + (5.6 * $u)))
            )
        }
    }
    $shadowPen = New-Object System.Drawing.Pen -ArgumentList @((Get-Shade -Color $accent -Amount -0.5), (3.2 * $u))
    $markPen = New-Object System.Drawing.Pen -ArgumentList @((Get-Color '#ffffff'), (3.2 * $u))
    foreach ($pen in @($shadowPen, $markPen)) {
        $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $nudge = if ([object]::ReferenceEquals($pen, $shadowPen)) { 0.9 * $u } else { 0.0 }
        foreach ($segment in $segments) {
            $Graphics.DrawLine($pen, ($segment[0] + $nudge), ($segment[1] + $nudge), ($segment[2] + $nudge), ($segment[3] + $nudge))
        }
    }
    $shadowPen.Dispose()
    $markPen.Dispose()
    $Graphics.SmoothingMode = $smoothing
}

function Draw-Caption {
    param($Graphics)
    $path = New-TopRoundedPath -W $form.Width -H $captionHeight -Radius $corner
    $rect = New-Object System.Drawing.Rectangle -ArgumentList @(0, 0, $form.Width, $captionHeight)
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend
    $blend.Colors = [System.Drawing.Color[]]($captionStops | ForEach-Object { $_[1] })
    $blend.Positions = [single[]]($captionStops | ForEach-Object { [single]$_[0] })
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @(
        $rect, $captionStops[0][1], $captionStops[-1][1], [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $brush.InterpolationColors = $blend
    $Graphics.FillPath($brush, $path)
    $brush.Dispose()
    $path.Dispose()
}

function Draw-CaptionText {
    param($Graphics)
    # A real XP message box has no icon in the caption, just the left-aligned
    # title next to the frame.
    $textLeft = $frame + (Get-Px 6)
    $textRight = $titleButton.Left - (Get-Px 4)
    $rect = New-Object System.Drawing.Rectangle -ArgumentList @($textLeft, 0, ($textRight - $textLeft), $captionHeight)
    $flags = [System.Windows.Forms.TextFormatFlags]::VerticalCenter -bor [System.Windows.Forms.TextFormatFlags]::EndEllipsis -bor [System.Windows.Forms.TextFormatFlags]::NoPrefix
    $shadowRect = New-Object System.Drawing.Rectangle -ArgumentList @(($rect.X + 1), ($rect.Y + 1), $rect.Width, $rect.Height)
    [System.Windows.Forms.TextRenderer]::DrawText($Graphics, $titleText, $captionFont, $shadowRect, $captionShadow, $flags)
    [System.Windows.Forms.TextRenderer]::DrawText($Graphics, $titleText, $captionFont, $rect, $captionInk, $flags)
}


function Draw-TitleButton {
    param($Graphics)
    $path = New-RoundedPath -Rect (New-Object System.Drawing.Rectangle -ArgumentList @($titleButton.X, $titleButton.Y, ($titleButton.Width - 1), ($titleButton.Height - 1))) -Radius (Get-Px 3)
    $rect = New-Object System.Drawing.Rectangle -ArgumentList @($titleButton.X, $titleButton.Y, $titleButton.Width, $titleButton.Height)
    # Hover lights the whole button up; a press inverts it so the click is felt.
    $from = if ($script:pressingClose) { $closeDownA } else { $closeA }
    $to = if ($script:pressingClose) { $closeDownB } else { $closeC }
    $mid = if ($script:pressingClose) { $closeDownB } else { $closeB }
    if ($script:hoverTitle -and -not $script:pressingClose) {
        # The pointer keeps the plain arrow, so this highlight is the only hover
        # affordance the close box has: lift the entire gradient, not one stop.
        $from = Get-Shade -Color $from -Amount 0.55
        $mid = Get-Shade -Color $mid -Amount 0.42
        $to = Get-Shade -Color $to -Amount 0.30
    }
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @(
        $rect, $from, $to, [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend
    $blend.Colors = [System.Drawing.Color[]]@($from, $mid, $to)
    $blend.Positions = [single[]]@(0.0, 0.72, 1.0)
    $brush.InterpolationColors = $blend
    $Graphics.FillPath($brush, $path)
    $brush.Dispose()
    $edge = New-Object System.Drawing.Pen -ArgumentList @($buttonLine, 1)
    $Graphics.DrawPath($edge, $path)
    $edge.Dispose()
    $path.Dispose()

    $cast = New-Object System.Drawing.Pen -ArgumentList @($buttonShadow, 1)
    $Graphics.DrawLine($cast, ($titleButton.X + 1), $titleButton.Bottom, $titleButton.Right, $titleButton.Bottom)
    $Graphics.DrawLine($cast, $titleButton.Right, ($titleButton.Y + 1), $titleButton.Right, $titleButton.Bottom)
    $cast.Dispose()

    # Centre the cross on the button's pixel centre.
    $mark = New-Object System.Drawing.Pen -ArgumentList @((Get-Color '#ffffff'), (2.0 * $scale))
    $mark.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $mark.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $cx = $titleButton.X + (($titleButton.Width - 1) / 2.0)
    $cy = $titleButton.Y + (($titleButton.Height - 1) / 2.0)
    if ($script:pressingClose) { $cx += 0.5; $cy += 0.5 }
    $arm = $titleButton.Width * 0.21
    $Graphics.DrawLine($mark, ($cx - $arm), ($cy - $arm), ($cx + $arm), ($cy + $arm))
    $Graphics.DrawLine($mark, ($cx + $arm), ($cy - $arm), ($cx - $arm), ($cy + $arm))
    $mark.Dispose()
}

function Draw-Content {
    param($Graphics)
    # XP aligns the status icon with the top of the message, never centred on it.
    Draw-StatusIcon -Graphics $Graphics -X ($frame + $pad) -Y $contentTop -Size $statusIcon

    if ($headingHeight -gt 0) {
        $headingRect = New-Object System.Drawing.Rectangle -ArgumentList @($textLeft, $contentTop, $textWidth, $headingFont.Height)
        [System.Windows.Forms.TextRenderer]::DrawText(
            $Graphics, $headingText, $headingFont, $headingRect, $ink,
            ([System.Windows.Forms.TextFormatFlags]::EndEllipsis -bor [System.Windows.Forms.TextFormatFlags]::NoPrefix))
    }
    if ($bodyHeight -gt 0) {
        $bodyRect = New-Object System.Drawing.Rectangle -ArgumentList @($textLeft, $bodyTop, $textWidth, $bodyHeight)
        [System.Windows.Forms.TextRenderer]::DrawText(
            $Graphics, $bodyText, $bodyFont, $bodyRect, $ink,
            ([System.Windows.Forms.TextFormatFlags]::WordBreak -bor [System.Windows.Forms.TextFormatFlags]::EndEllipsis -bor [System.Windows.Forms.TextFormatFlags]::NoPrefix))
    }
    if ($detailHeight -gt 0) {
        $detailRect = New-Object System.Drawing.Rectangle -ArgumentList @($textLeft, $detailTop, $textWidth, $detailHeight)
        [System.Windows.Forms.TextRenderer]::DrawText(
            $Graphics, $detailText, $detailFont, $detailRect, $detailInk,
            ([System.Windows.Forms.TextFormatFlags]::EndEllipsis -bor [System.Windows.Forms.TextFormatFlags]::NoPrefix))
    }
}

$form.Add_Paint({
    param($sender, $event)
    $graphics = $event.Graphics
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear($face)
    Draw-Caption -Graphics $graphics
    Draw-CaptionText -Graphics $graphics
    Draw-Content -Graphics $graphics
    Draw-TitleButton -Graphics $graphics
    Draw-FrameRing -Graphics $graphics -Inset 0 -Radius $corner -TopColor $frameTopA -BottomColor $frameBottomA
    Draw-FrameRing -Graphics $graphics -Inset 1 -Radius ($corner - 1) -TopColor $frameTopB -BottomColor $frameBottomB
    Draw-FrameRing -Graphics $graphics -Inset 2 -Radius ($corner - 2) -TopColor $frameTopC -BottomColor $frameBottomC
})

$form.Add_Shown({
    # Some hosts (PowerShell 7 in particular) never push Form.TopMost down to the
    # handle, which leaves the card behind the application window; assert the
    # topmost band explicitly instead of trusting the property.
    try {
        [void][DshNotify.Native]::SetWindowPos($form.Handle, [IntPtr](-1), 0, 0, 0, 0, 0x0013)
    } catch { }
    if ([bool](Get-Cfg -Key 'sound' -Default $false)) {
        try {
            Add-Type -AssemblyName System.Windows.Extensions -ErrorAction SilentlyContinue
            [System.Media.SystemSounds]::Asterisk.Play()
        } catch { }
    }
})

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::Run($form)
