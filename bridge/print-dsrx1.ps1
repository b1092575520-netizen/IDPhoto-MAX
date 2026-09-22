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
$submissionAttempted = $false
$archiveIndexResult = $null

function Write-JsonUtf8NoBom {
  param([string]$Path, [object]$Value)
  $json = $Value | ConvertTo-Json -Depth 6 -Compress
  $pendingPath = $Path + "." + [guid]::NewGuid().ToString("N") + ".tmp"
  try {
    [System.IO.File]::WriteAllText($pendingPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    if ([System.IO.File]::Exists($Path)) {
      [System.IO.File]::Replace($pendingPath, $Path, [NullString]::Value)
    } else {
      [System.IO.File]::Move($pendingPath, $Path)
    }
  } finally {
    if ([System.IO.File]::Exists($pendingPath)) { [System.IO.File]::Delete($pendingPath) }
  }
}

function Try-ClaimPrintJob {
  param([string]$Path)
  try {
    $claim = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $claim.Dispose()
    return $true
  } catch [System.IO.IOException] {
    if ([System.IO.File]::Exists($Path)) { return $false }
    throw
  }
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

function Set-ArchiveDateSort {
  param([string]$FolderPath)
  $path = [System.IO.Path]::GetFullPath($FolderPath).TrimEnd('\')
  $date = [datetime]::MinValue
  $dayName = [System.IO.Path]::GetFileName($path)
  if (-not [datetime]::TryParseExact($dayName, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$date)) { return }
  $monthPath = [System.IO.Path]::GetDirectoryName($path)
  if ([System.IO.Path]::GetFileName($monthPath) -ne $date.ToString('yyyy-MM') -or
      [System.IO.Path]::GetFileName([System.IO.Path]::GetDirectoryName($monthPath)) -ne $date.ToString('yyyy')) { return }
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try { $keyName = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($path.ToLowerInvariant()))).Replace('-', '') }
  finally { $hasher.Dispose() }
  $cachePath = 'Registry::HKEY_CURRENT_USER\Software\IDPhotoMAX\ArchiveViews\' + $keyName
  $cached = Get-ItemProperty -LiteralPath $cachePath -ErrorAction SilentlyContinue
  if ($cached -and $cached.Path -eq $path -and $cached.Version -eq 1) { return }
  if (-not ('IDPhotoArchiveView' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32;
public static class IDPhotoArchiveView {
  const string Root = @"Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\Bags";
  [ComImport, Guid("55272A00-42CB-11CE-8135-00AA004BB851"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyBag {
    [PreserveSig] int Read([MarshalAs(UnmanagedType.LPWStr)] string name, [MarshalAs(UnmanagedType.Struct)] ref object value, IntPtr errorLog);
    [PreserveSig] int Write([MarshalAs(UnmanagedType.LPWStr)] string name, [MarshalAs(UnmanagedType.Struct)] ref object value);
  }
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)] static extern int SHParseDisplayName(string name, IntPtr bind, out IntPtr pidl, uint flags, out uint attributes);
  [DllImport("shlwapi.dll", CharSet=CharSet.Unicode)] static extern int SHGetViewStatePropertyBag(IntPtr pidl, string bag, uint flags, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyBag value);
  public static void SetDefaults(string path) {
    IntPtr pidl; uint attributes;
    Marshal.ThrowExceptionForHR(SHParseDisplayName(path,IntPtr.Zero,out pidl,0,out attributes));
    try {
      IPropertyBag bag; Guid iid=typeof(IPropertyBag).GUID;
      Marshal.ThrowExceptionForHR(SHGetViewStatePropertyBag(pidl,"Shell",0x80000005,ref iid,out bag));
      try { object marker=path; Marshal.ThrowExceptionForHR(bag.Write("IDPhotoArchivePath",ref marker)); }
      finally { Marshal.ReleaseComObject(bag); }
    } finally { Marshal.FreeCoTaskMem(pidl); }
    // The Shell allocates the folder's own bag. Never guess a slot or change AllFolders.
    string slot=null;
    using (var bags=Registry.CurrentUser.OpenSubKey(Root)) {
      foreach(string candidate in bags.GetSubKeyNames()) {
        using(var bag=bags.OpenSubKey(candidate+@"\Shell")) {
          if(bag!=null && String.Equals(bag.GetValue("IDPhotoArchivePath") as string,path,StringComparison.OrdinalIgnoreCase)) {
            if(slot!=null) throw new InvalidOperationException("Ambiguous archive folder view");
            slot=candidate;
          }
        }
      }
    }
    if(slot==null) throw new InvalidOperationException("Archive folder view was not allocated");
    // Native Windows Sort stream: one descending System.ItemDate column.
    byte[] sort=Convert.FromBase64String("AAAAAAAAAAAAAAAAAAAAAAEAAAC0dNv3h0IDQa+68bE9zXXPZAAAAP////8=");
    foreach(string type in new[]{"{B3690E58-E961-423B-B687-386EBFD83239}","{5C4F28B5-F869-4E84-8E60-F11DB97C5CC7}"}) {
      using(var view=Registry.CurrentUser.CreateSubKey(Root+@"\"+slot+@"\Shell\"+type)) {
        // Rev and mode are required for Explorer to accept a never-opened view.
        if(view.GetValue("Rev")==null) view.SetValue("Rev",2,RegistryValueKind.DWord);
        if(view.GetValue("Mode")==null) view.SetValue("Mode",1,RegistryValueKind.DWord);
        if(view.GetValue("LogicalViewMode")==null) view.SetValue("LogicalViewMode",3,RegistryValueKind.DWord);
        if(view.GetValue("IconSize")==null) view.SetValue("IconSize",96,RegistryValueKind.DWord);
        if(view.GetValue("FFlags")==null) view.SetValue("FFlags",1092616193,RegistryValueKind.DWord);
        if(view.GetValue("Vid")==null) view.SetValue("Vid","{0057D0E0-3573-11CF-AE69-08002B2E1262}");
        view.SetValue("Sort",sort,RegistryValueKind.Binary);
      }
    }
  }
}
'@
  }
  [IDPhotoArchiveView]::SetDefaults($path)
  $shell = New-Object -ComObject Shell.Application
  foreach ($view in @($shell.Windows())) {
    try {
      if ($view.Document.Folder.Self.Path -eq $path) { $view.Document.SortColumns = 'prop:-System.ItemDate;' }
    } catch { }
  }
  if (-not (Test-Path -LiteralPath $cachePath)) { New-Item -Path $cachePath -Force | Out-Null }
  New-ItemProperty -LiteralPath $cachePath -Name Path -Value $path -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $cachePath -Name Version -Value 1 -PropertyType DWord -Force | Out-Null
}

function Invoke-ArchiveIndexOperation {
  param($request)
  if ([string]$request.operation -cne 'hide-archive-index' -and [string]$request.operation -cne 'commit-archive-index') {
    Throw-BridgeError 'invalid-operation' 'Unsupported bridge operation'
  }
  $indexPath = [string]$request.indexPath
  if (-not [System.IO.Path]::IsPathRooted($indexPath)) {
    Throw-BridgeError 'invalid-index-path' 'The archive index path must be absolute'
  }
  $indexPath = [System.IO.Path]::GetFullPath($indexPath)
  $commitIndex = [string]$request.operation -ceq 'commit-archive-index'
  $indexName = [System.IO.Path]::GetFileName($indexPath)
  if (($commitIndex -and $indexName -cnotmatch '^\.idphoto-jpg-index\.json\.[a-z0-9]+-[a-z0-9.]+\.tmp$') -or
      (-not $commitIndex -and $indexName -cne '.idphoto-jpg-index.json')) {
    Throw-BridgeError 'invalid-index-path' 'Only the IDPhoto archive index can be hidden'
  }
  $indexFile = Get-Item -LiteralPath $indexPath -Force
  if ($indexFile.PSIsContainer -or ($indexFile.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    Throw-BridgeError 'invalid-index-path' 'The archive index must be a regular file'
  }
  if ($commitIndex) {
    $stagedIndex = Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($stagedIndex.version -ne 1 -or $stagedIndex.entries -isnot [pscustomobject]) {
      Throw-BridgeError 'invalid-index-content' 'Invalid staged archive index'
    }
    $committedPath = Join-Path $indexFile.DirectoryName '.idphoto-jpg-index.json'
    if (Test-Path -LiteralPath $committedPath) {
      $previousIndex = Get-Item -LiteralPath $committedPath -Force
      if ($previousIndex.PSIsContainer -or ($previousIndex.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        Throw-BridgeError 'invalid-index-path' 'The previous index must be a regular file'
      }
    }
    # Set Hidden before publishing, and replace hidden destinations using the native API.
    $indexFile.Attributes = $indexFile.Attributes -bor [System.IO.FileAttributes]::Hidden
    if ([System.IO.File]::Exists($committedPath)) {
      [System.IO.File]::Replace($indexPath, $committedPath, [NullString]::Value)
    } else {
      [System.IO.File]::Move($indexPath, $committedPath)
    }
    $indexPath = $committedPath
    $indexFile = Get-Item -LiteralPath $indexPath -Force
  }
  $indexFile.Attributes = $indexFile.Attributes -bor [System.IO.FileAttributes]::Hidden
  if (-not ((Get-Item -LiteralPath $indexPath -Force).Attributes -band [System.IO.FileAttributes]::Hidden)) {
    Throw-BridgeError 'index-not-hidden' 'The filesystem did not retain the Hidden attribute'
  }
  $receipt = [ordered]@{ operation = [string]$request.operation; ok = $true; hidden = $true; printed = $false }
  try { Set-ArchiveDateSort $indexFile.DirectoryName }
  catch { $receipt.sortWarning = $_.Exception.Message }
  return $receipt
}

try {
  Add-Type -AssemblyName System.Drawing

  if ($ValidateOnly) {
    $printer = Get-ValidatedPrinter
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
  if ($job.PSObject.Properties['operation']) {
    $archiveReceipt = Invoke-ArchiveIndexOperation $job
    $archiveReceipt.schemaVersion = $SchemaVersion
    $archiveReceipt.jobId = $jobId
    Write-JsonUtf8NoBom $resultPath $archiveReceipt
    exit 0
  }
  if ($job.archiveIndex) {
    try { $archiveIndexResult = Invoke-ArchiveIndexOperation $job.archiveIndex }
    catch { $archiveIndexResult = [ordered]@{ ok = $false; operation = [string]$job.archiveIndex.operation; message = $_.Exception.Message } }
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

  $printer = Get-ValidatedPrinter

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
      archiveIndexResult = $archiveIndexResult
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
  # Retain a tiny claim after completion: a second launch must never print this job again.
  if (-not (Try-ClaimPrintJob ($JobPath + ".submitted"))) { exit 0 }
  $submissionAttempted = $true
  $printDocument.Print()
  # Release the JPEG lock before publishing success; UXP cleans the job immediately.
  $printDocument.Dispose()
  $printDocument = $null
  $image.Dispose()
  $image = $null

  Write-JsonUtf8NoBom $resultPath ([ordered]@{
    schemaVersion = $SchemaVersion
    jobId = $jobId
    ok = $true
    printed = $true
    printerName = $ExpectedPrinterName
    paperName = $ExpectedPaperName
    copies = 1
    message = "Submitted one (6x4) copy to DS-RX1"
    archiveIndexResult = $archiveIndexResult
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
    printed = $(if ($submissionAttempted) { $null } else { $false })
    outcomeUnknown = $submissionAttempted
    reason = $reason
    message = $_.Exception.Message
    archiveIndexResult = $archiveIndexResult
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
