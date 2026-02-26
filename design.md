# Advanced Search Tool - Design Specification

## Overview
This document outlines the visual design system, layout structure, and color palette for the Advanced Search Tool. The design prioritizes information density, readability in low-light environments, and quick access to complex controls.

## Design Philosophy
*   **Style**: Technical Dashboard / "Mission Control"
*   **Theme**: Deep Dark Mode (Slate-950 base)
*   **Density**: High (Compact controls, minimal whitespace)
*   **Feedback**: Immediate visual response (hover states, active toggles, progress bars)

## Typography
*   **Primary UI Font**: `Inter` (Sans-serif) - Used for labels, buttons, and general UI text.
*   **Monospace Font**: `JetBrains Mono` - Used for file paths, search queries, regex patterns, and search results.
*   **Sizes**:
    *   **Labels**: 11-12px (Uppercase, tracking-wider)
    *   **Body**: 13-14px
    *   **Inputs**: 14px (Monospace)
    *   **Headers**: 11px (Bold, Uppercase)

## Color Palette

### Backgrounds
*   **App Background**: `#0f172a` (Slate-950) - Deepest layer.
*   **Panel/Row Background**: `#1e293b` (Slate-900) - Secondary layer for inputs and lists.
*   **Hover State**: `#334155` (Slate-800) - Interactive elements.

### Text Colors
*   **Primary Text**: `#e2e8f0` (Slate-200) - High contrast for main content.
*   **Secondary Text**: `#94a3b8` (Slate-400) - Labels and metadata.
*   **Muted Text**: `#64748b` (Slate-500) - Placeholders and disabled states.

### Accents & Status
*   **Primary Action (Blue)**: `#2563eb` (Blue-600) - Search button, active progress, focus rings.
*   **Success (Emerald)**: `#059669` (Emerald-600) - Save actions, "Ready" status, line numbers.
*   **Danger (Red)**: `#dc2626` (Red-600) - Stop button, Exclude field focus.
*   **Warning (Amber)**: `#d97706` (Amber-600) - Clear button.
*   **Info (Cyan)**: `#0891b2` (Cyan-600) - Copy actions.

## Layout Structure

The application follows a strict vertical stack layout (Rows 0-6).

### Row 0: Directory Bar
*   **Height**: Compact (~50px)
*   **Elements**:
    *   Current Path (Monospace, truncated, expands on hover)
    *   "Change Folder" Button (Secondary style)
    *   "Select Files" Button (Success style)
    *   File Count/Size Indicator (Badge style)

### Row 1: Input & Options
*   **Search Query**: Full-width input, monospace font, prominent label.
*   **Exclude Field**: Red-tinted focus ring to indicate "negative" action.
*   **Max Results**: Numeric input.
*   **Toggles**: Chip-style buttons for Regex, Case, Word, Fast Mode, Live.
*   **Display Options**: Checkbox group for toggling result columns (#, Line, File, Content).

### Row 2: Main Actions
*   **Grid**: Responsive grid (2 cols mobile, 7 cols desktop).
*   **Buttons**:
    *   **Search**: Primary Blue, largest visual weight.
    *   **Stop**: Red, visible only during activity.
    *   **Save/Quick Save**: Green variants.
    *   **Copy**: Cyan variants.
    *   **Clear**: Amber/Orange.

### Row 3: Tools
*   **Style**: Subtle toolbar.
*   **Buttons**: "Sort A-Z", "Replace", "Deduplicate".
*   **Visuals**: Ghost buttons with colored borders/text on hover.

### Row 4: Progress
*   **Bar**: Slim (4px) horizontal bar.
*   **Animation**: Smooth tweening, glows when active.
*   **Status Text**: "Ready", "Searching...", "Idle" (Uppercase, small).

### Row 5: Results Area
*   **Structure**: Virtualized list or scrollable container.
*   **Columns**:
    *   `#`: Index (Muted)
    *   `Line`: Line number (Emerald, Monospace)
    *   `Content`: Main text match (White, truncated)
    *   `File`: File path (Right-aligned, Muted)
*   **Interaction**: Hover highlights row, click to select.

### Row 6: Summary Footer
*   **Height**: Fixed (~30px)
*   **Content**: Total results count, processing time, system status indicator (Pulse animation).

## Component Styles

### Buttons
*   **Standard**: Rounded-lg, font-semibold, shadow-sm.
*   **Icon-only**: Used for small actions (Help).
*   **Toggle Chips**: Bordered, background fill on active state.

### Inputs
*   **Style**: Dark background (Slate-900), subtle border (Slate-700).
*   **Focus**: Ring-2 with color matching the context (Blue for search, Red for exclude).
*   **Font**: Always Monospace for data entry fields.

### Scrollbars
*   **Style**: Thin, unobtrusive.
*   **Track**: Transparent.
*   **Thumb**: Slate-700 (rounded).
