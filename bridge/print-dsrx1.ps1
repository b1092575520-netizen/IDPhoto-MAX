param(
  [Parameter(Position = 0)]
  [string]$JobPath = "",
  [switch]$ValidateOnly,
  [switch]$RenderOnly
)

$ErrorActionPreference = "Stop"
$ExpectedPrinterName = "DS-RX1"
$ExpectedPaperName = "(6x4)"
$ExpectedWidthPx = 3600
$ExpectedHeightPx = 2400
$ExpectedPpi = 600
$SchemaVersion = 1
$resultPath = ""
$jobId = ""
$image = $null
$printDocument = $null
$renderBitmap = $null
$renderGraphics = $null

function Write-JsonUtf8NoBom {
  param([string]$Path, [object]$Value)
  $json = $Value | ConvertTo-Json -Depth 6 -Compress
  [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Throw-BridgeError {
  param([string]$Reason, [string]$Message)
  $exception = New-Object System.InvalidOperationException($Message)
  $exception.Data["Reason"] = $Reason
  throw $exception
}

function Get-ValidatedPrinter {
  $installedPrinter = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters |
    Where-Object { [string]$_ -ceq $ExpectedPrinterName })
  if ($installedPrinter.Count -ne 1) {
    Throw-BridgeError "printer-not-found" "Exact printer DS-RX1 was not found; no print job was submitted"
  }

  $settings = New-Object System.Drawing.Printing.PrinterSettings
  $settings.PrinterName = $ExpectedPrinterName
  if (-not $settings.IsValid) {
    Throw-BridgeError "printer-invalid" "DS-RX1 is not available; no print job was submitted"
  }

  $paperMatches = @($settings.PaperSizes |
    Where-Object { $_.PaperName -ceq $ExpectedPaperName })
  if ($paperMatches.Count -ne 1) {
    Throw-BridgeError "paper-not-found" "Exact paper (6x4) was not found; no print job was submitted"
  }

  return @{
    Settings = $settings
    Paper = $paperMatches[0]
  }
}

function Draw-ImageActualSize {
  param($Graphics, $SourceImage, [int]$PageWidth, [int]$PageHeight)

  $targetWidth = [int][Math]::Round(([double]$SourceImage.Width / [double]$ExpectedPpi) * 100)
  $targetHeight = [int][Math]::Round(([double]$SourceImage.Height / [double]$ExpectedPpi) * 100)
  if ($PageWidth -lt $targetWidth -or $PageHeight -lt $targetHeight) {
    Throw-BridgeError "paper-too-small" "The DS-RX1 page is smaller than the actual 6x4 image size; no print job was submitted"
  }
  $offsetX = [int][Math]::Floor(([double]($PageWidth - $targetWidth)) / 2)
  $offsetY = [int][Math]::Floor(([double]($PageHeight - $targetHeight)) / 2)

  $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $destination = New-Object System.Drawing.Rectangle($offsetX, $offsetY, $targetWidth, $targetHeight)
  $Graphics.DrawImage(
    $SourceImage,
    $destination,
    0,
    0,
    [int]$SourceImage.Width,
    [int]$SourceImage.Height,
    [System.Drawing.GraphicsUnit]::Pixel
  )
}

try {
  Add-Type -AssemblyName System.Drawing
  $printer = Get-ValidatedPrinter

  if ($ValidateOnly) {
    [pscustomobject]@{
      schemaVersion = $SchemaVersion
      ok = $true
      validatedOnly = $true
      printed = $false
      printerName = $ExpectedPrinterName
      paperName = $ExpectedPaperName
      message = "DS-RX1 bridge validation passed; ValidateOnly did not submit a print job"
    } | ConvertTo-Json -Compress
    exit 0
  }

  if (-not $JobPath) {
    Throw-BridgeError "missing-job" "The .idprint job path is missing; no print job was submitted"
  }
  $JobPath = [System.IO.Path]::GetFullPath($JobPath)
  if ([System.IO.Path]::GetExtension($JobPath) -cne ".idprint") {
    Throw-BridgeError "invalid-job-extension" "The job extension is not .idprint; no print job was submitted"
  }
  $resultPath = [System.IO.Path]::ChangeExtension($JobPath, ".result.json")
  if (-not (Test-Path -LiteralPath $JobPath -PathType Leaf)) {
    Throw-BridgeError "job-not-found" "The print job file was not found; no print job was submitted"
  }

  $job = Get-Content -Raw -Encoding UTF8 -LiteralPath $JobPath | ConvertFrom-Json
  $jobId = [string]$job.jobId
  if ([int]$job.schemaVersion -ne $SchemaVersion) {
    Throw-BridgeError "invalid-schema" "The print job schema is unsupported; no print job was submitted"
  }
  if (-not $jobId -or $jobId -notmatch '^[a-z0-9]+-[a-z0-9]+$') {
    Throw-BridgeError "invalid-job-id" "The print job id is invalid; no print job was submitted"
  }
  if ([string]$job.printerName -cne $ExpectedPrinterName) {
    Throw-BridgeError "wrong-printer" "The job does not target DS-RX1; no print job was submitted"
  }
  if ([string]$job.paperName -cne $ExpectedPaperName) {
    Throw-BridgeError "wrong-paper" "The job does not target exact paper (6x4); no print job was submitted"
  }
  if ([int]$job.copies -ne 1) {
    Throw-BridgeError "wrong-copies" "The job copy count is not one; no print job was submitted"
  }
  if ([int]$job.expectedWidthPx -ne $ExpectedWidthPx -or [int]$job.expectedHeightPx -ne $ExpectedHeightPx) {
    Throw-BridgeError "wrong-expected-size" "The expected canvas is not 3600x2400; no print job was submitted"
  }

  $imagePath = [System.IO.Path]::GetFullPath([string]$job.imagePath)
  if (-not (Test-Path -LiteralPath $imagePath -PathType Leaf)) {
    Throw-BridgeError "image-not-found" "The temporary print JPG was not found; no print job was submitted"
  }
  if ([System.IO.Path]::GetExtension($imagePath) -cne ".jpg") {
    Throw-BridgeError "invalid-image-extension" "The temporary image is not JPG; no print job was submitted"
  }

  $image = [System.Drawing.Image]::FromFile($imagePath)
  if ($image.Width -ne $ExpectedWidthPx -or $image.Height -ne $ExpectedHeightPx) {
    Throw-BridgeError "wrong-image-size" "The temporary image is not 3600x2400; no print job was submitted"
  }

  if ($RenderOnly) {
    $renderBitmap = New-Object System.Drawing.Bitmap([int]$printer.Paper.Width, [int]$printer.Paper.Height)
    $renderGraphics = [System.Drawing.Graphics]::FromImage($renderBitmap)
    Draw-ImageActualSize $renderGraphics $image $printer.Paper.Width $printer.Paper.Height
    [pscustomobject]@{
      schemaVersion = $SchemaVersion
      jobId = $jobId
      ok = $true
      renderedOnly = $true
      printed = $false
      printerName = $ExpectedPrinterName
      paperName = $ExpectedPaperName
      message = "RenderOnly completed; no print job was submitted"
    } | ConvertTo-Json -Compress
    exit 0
  }

  $printDocument = New-Object System.Drawing.Printing.PrintDocument
  $printDocument.PrinterSettings = $printer.Settings
  $printDocument.PrinterSettings.Copies = 1
  $printDocument.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  $printDocument.DocumentName = "IDPhoto MAX $jobId"
  $printDocument.OriginAtMargins = $false
  $printDocument.DefaultPageSettings.PaperSize = $printer.Paper
  $printDocument.DefaultPageSettings.Landscape = $false
  $printDocument.DefaultPageSettings.Color = $true
  $printDocument.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

  $printHandler = [System.Drawing.Printing.PrintPageEventHandler] {
    param($sender, $eventArgs)
    Draw-ImageActualSize $eventArgs.Graphics $image $eventArgs.PageBounds.Width $eventArgs.PageBounds.Height
    $eventArgs.HasMorePages = $false
  }
  $printDocument.add_PrintPage($printHandler)
  $printDocument.Print()

  Write-JsonUtf8NoBom $resultPath ([ordered]@{
    schemaVersion = $SchemaVersion
    jobId = $jobId
    ok = $true
    printed = $true
    printerName = $ExpectedPrinterName
    paperName = $ExpectedPaperName
    copies = 1
    message = "Submitted one (6x4) copy to DS-RX1"
    completedAt = [DateTime]::UtcNow.ToString("o")
  })
  exit 0
} catch {
  $reason = "bridge-error"
  if ($_.Exception.Data -and $_.Exception.Data.Contains("Reason")) {
    $reason = [string]$_.Exception.Data["Reason"]
  }
  $failure = [ordered]@{
    schemaVersion = $SchemaVersion
    jobId = $jobId
    ok = $false
    printed = $false
    reason = $reason
    message = $_.Exception.Message
    completedAt = [DateTime]::UtcNow.ToString("o")
  }
  if ($resultPath) {
    try {
      Write-JsonUtf8NoBom $resultPath $failure
    } catch {
      # The caller will time out if even the result file cannot be written.
    }
  } else {
    [pscustomobject]$failure | ConvertTo-Json -Compress
  }
  exit 2
} finally {
  if ($renderGraphics) {
    $renderGraphics.Dispose()
  }
  if ($renderBitmap) {
    $renderBitmap.Dispose()
  }
  if ($printDocument) {
    $printDocument.Dispose()
  }
  if ($image) {
    $image.Dispose()
  }
}
