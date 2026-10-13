param(
    [int]$Port = 8799
)

# Lokaler Entwicklungsserver (kein Node nötig): liefert den Ordner www/ aus.
$root = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'www'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Serving $root on http://localhost:$Port/"

$mimeMap = @{
    ".html" = "text/html; charset=utf-8"; ".css" = "text/css; charset=utf-8"; ".js" = "application/javascript; charset=utf-8"
    ".json" = "application/json"; ".webmanifest" = "application/manifest+json"; ".wav" = "audio/wav"; ".mp3" = "audio/mpeg"
    ".svg" = "image/svg+xml"; ".png" = "image/png"; ".jpg" = "image/jpeg"; ".ico" = "image/x-icon"
}
$fullRoot = (Resolve-Path $root).Path
try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $response = $context.Response
        try {
            $path = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)
            if ($path -eq "/") { $path = "/index.html" }
            $filePath = Join-Path $root ($path.TrimStart("/"))
            if ((Test-Path $filePath -PathType Leaf) -and ((Resolve-Path $filePath).Path.StartsWith($fullRoot))) {
                $ext = [System.IO.Path]::GetExtension($filePath)
                $ct = $mimeMap[$ext]; if (-not $ct) { $ct = "application/octet-stream" }
                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                $response.ContentType = $ct
                $response.Headers.Add("Cache-Control", "no-store")
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $response.StatusCode = 404
                $nf = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
                $response.OutputStream.Write($nf, 0, $nf.Length)
            }
        } catch { $response.StatusCode = 500 } finally { $response.OutputStream.Close() }
    }
} finally { $listener.Stop() }
