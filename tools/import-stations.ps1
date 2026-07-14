param(
    [string]$Source = "C:\Users\cte\Downloads\sarjIstasyonlari (1).xls",
    [string]$Output = "data\stations.json"
)

function Normalize-Text([object]$value) {
    $text = [string]$value
    if ($text.IndexOf([char]0x00C3) -ge 0 -or $text.IndexOf([char]0x00C4) -ge 0 -or $text.IndexOf([char]0x00C5) -ge 0) {
        try {
            $bytes = [System.Text.Encoding]::GetEncoding(1252).GetBytes($text)
            $repaired = [System.Text.Encoding]::UTF8.GetString($bytes)
            if ($repaired.IndexOf([char]0xFFFD) -lt 0) {
                $text = $repaired
            }
        }
        catch {
            # Keep the original text if code page repair is not possible.
        }
    }
    $text = $text -replace "\s+", " "
    return $text.Trim()
}

function Get-KnownDistricts {
    $iDotless = [char]0x0131
    $cCedillaUpper = [char]0x00C7
    $uDiaeresis = [char]0x00FC
    $sCedilla = [char]0x015F
    $aydincik = "Ayd$($iDotless)nc$($iDotless)k"
    $bozyazi = "Bozyaz$($iDotless)"
    $camliyayla = "$($cCedillaUpper)aml$($iDotless)yayla"
    $gulnar = "G$($uDiaeresis)lnar"
    $yenisehir = "Yeni$($sCedilla)ehir"

    return @(
        "Akdeniz",
        "Anamur",
        $aydincik,
        $bozyazi,
        $camliyayla,
        "Erdemli",
        $gulnar,
        "Mezitli",
        "Mut",
        "Silifke",
        "Tarsus",
        "Toroslar",
        $yenisehir
    )
}

function Get-District([string]$address) {
    if ([string]::IsNullOrWhiteSpace($address)) {
        return "Bilinmiyor"
    }

    $known = Get-KnownDistricts
    $bestName = $null
    $bestIndex = -1
    foreach ($name in $known) {
        $index = $address.LastIndexOf($name, [System.StringComparison]::CurrentCultureIgnoreCase)
        if ($index -gt $bestIndex) {
            $bestIndex = $index
            $bestName = $name
        }
    }

    if ($null -ne $bestName) {
        return $bestName
    }

    $knownPattern = ($known | ForEach-Object { [regex]::Escape($_) }) -join "|"
    $patterns = @(
        "([\p{L}\s]+)\s*/\s*MERS",
        "\b(" + $knownPattern + ")\b"
    )

    foreach ($pattern in $patterns) {
        $match = [regex]::Match($address, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($match.Success) {
            $district = Normalize-Text $match.Groups[1].Value
            foreach ($name in $known) {
                if ($district -ieq $name) {
                    return $name
                }
            }
            if ($district -ieq "Merkez") {
                return "Bilinmiyor"
            }
            return (Get-Culture).TextInfo.ToTitleCase($district.ToLower((Get-Culture)))
        }
    }

    return "Bilinmiyor"
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$workbook = $null

try {
    $resolvedSource = (Resolve-Path -LiteralPath $Source).Path
    $workbook = $excel.Workbooks.Open($resolvedSource)
    $sheet = $workbook.Worksheets.Item(1)
    $range = $sheet.UsedRange
    $rows = $range.Rows.Count
    $stations = New-Object System.Collections.Generic.List[object]
    $current = $null

    for ($row = 2; $row -le $rows; $row++) {
        $sequence = Normalize-Text $sheet.Cells.Item($row, 1).Text
        $stationNo = Normalize-Text $sheet.Cells.Item($row, 2).Text
        $socketNo = Normalize-Text $sheet.Cells.Item($row, 10).Text

        if ($socketNo -eq "Soket No" -or [string]::IsNullOrWhiteSpace($socketNo)) {
            if (-not [string]::IsNullOrWhiteSpace($stationNo)) {
                $address = Normalize-Text $sheet.Cells.Item($row, 9).Text
                $current = [ordered]@{
                    sequence = [int]$sequence
                    stationNo = $stationNo
                    name = Normalize-Text $sheet.Cells.Item($row, 3).Text
                    serviceType = Normalize-Text $sheet.Cells.Item($row, 4).Text
                    brand = Normalize-Text $sheet.Cells.Item($row, 5).Text
                    networkOperator = Normalize-Text $sheet.Cells.Item($row, 6).Text
                    stationOperator = Normalize-Text $sheet.Cells.Item($row, 7).Text
                    green = (Normalize-Text $sheet.Cells.Item($row, 8).Text) -match "Evet|Yes|1"
                    address = $address
                    district = Get-District $address
                    city = "Mersin"
                    latitude = $null
                    longitude = $null
                    sockets = @()
                }
                $stations.Add($current)
            }
            continue
        }

        if ($null -ne $current) {
            $powerText = Normalize-Text $sheet.Cells.Item($row, 13).Text
            $power = $null
            if ($powerText -match "^\d+([,.]\d+)?$") {
                $power = [decimal]($powerText -replace ",", ".")
            }
            $current.sockets += [ordered]@{
                socketNo = $socketNo
                currentType = Normalize-Text $sheet.Cells.Item($row, 11).Text
                connectorType = Normalize-Text $sheet.Cells.Item($row, 12).Text
                powerKw = $power
            }
        }
    }

    $payload = [ordered]@{
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        source = Split-Path -Leaf $Source
        city = "Mersin"
        stationCount = $stations.Count
        stations = $stations
    }

    $json = $payload | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText((Join-Path (Get-Location) $Output), $json, [System.Text.UTF8Encoding]::new($false))
}
finally {
    if ($workbook -ne $null) {
        $workbook.Close($false)
    }
    $excel.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
