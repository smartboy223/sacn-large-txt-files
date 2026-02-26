# Modern folder picker using Shell.Application COM (shows full file explorer tree)
# Falls back to OpenFileDialog trick if COM fails

try {
    $shell = New-Object -ComObject Shell.Application
    $folder = $shell.BrowseForFolder(0, "Select a folder to search", 0x0041, 0)
    if ($folder -ne $null) {
        $path = $folder.Self.Path
        if ($path) {
            Write-Output $path
            exit 0
        }
    }
    # User cancelled
    exit 0
} catch {
    # Fallback: OpenFileDialog trick - pick any file, return its directory
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $d = New-Object System.Windows.Forms.OpenFileDialog
        $d.Title = "Select any file in the folder you want (folder will be used)"
        $d.Filter = "All Files (*.*)|*.*"
        $d.CheckFileExists = $true
        $d.Multiselect = $false
        $d.ValidateNames = $true
        if ($d.ShowDialog() -eq "OK") {
            $dir = [System.IO.Path]::GetDirectoryName($d.FileName)
            Write-Output $dir
        }
    } catch {
        # Nothing worked
        exit 1
    }
}
