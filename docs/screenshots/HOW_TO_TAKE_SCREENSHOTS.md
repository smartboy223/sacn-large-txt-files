# How to take the README screenshots

Run the app (`start.bat`), then capture each view and save it here.

## Screenshots needed

| Filename | What to capture |
|---|---|
| `main.png` | Full app window after a search — query filled in, results visible, progress bar complete |
| `file-browser.png` | The Files modal open, showing a list of `.txt` files with checkboxes |
| `results-full.png` | Results with all columns on: #, Line, File, Content |
| `save-toast.png` | The green success toast after Quick Save |

## Recommended tool
- **Windows Snipping Tool** (`Win + Shift + S`) — select the browser window
- Crop to just the app (no browser chrome)
- Save as `.png`

## After saving
The README references them as:
```
![Main Interface](docs/screenshots/main.png)
```
So the path must match exactly — no spaces in filename.
