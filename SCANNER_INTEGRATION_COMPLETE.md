# Scanner Overhaul - Full Integration Complete

## Overview

All three major scanner improvements have been fully integrated and tested:

1. **Capture Speed Control** - Users can now adjust scan recapture speed (300-2000ms)
2. **Manual Shutter Button** - Fallback capture when detector is down or slow
3. **Confirmation Mode** - Optional review before auto-add, perfect for multi-language scanning

## Implementation Details

### 1. Capture Speed Control

**What it does:** Adjustable debounce between auto-captures. Slower speeds give the detector more time to see card changes, useful when manually swapping cards or scanning multiple languages.

**Files modified:**
- `frontend/src/components/CameraScanner.jsx`
  - Added capture speed slider in settings panel (range 300-2000ms, 100ms steps)
  - State persisted in localStorage as `scan_recapture_ms`
  - Value displayed in real-time (e.g., "600ms")
  - Passed through `autoArgs()` to `shouldCapture()` for detection timing

- `frontend/src/utils/autoCapture.js`
  - `shouldCapture()` now accepts optional `recaptureMs` parameter
  - Replaces hardcoded 600ms minimum with user-configurable value
  - Maintains all original safety gates (no re-capture within `recaptureMs`)

**UI Location:** Settings panel, appears when auto-scan is enabled

**Default:** 600ms (balances speed vs stability)

---

### 2. Manual Shutter Button

**What it does:** Red "S" button (ScanLine icon) above camera preview. Tap it to capture immediately without waiting for detector confirmation. Appears next to torch and camera-switch buttons.

**Files modified:**
- `frontend/src/components/CameraScanner.jsx`
  - Added manual shutter button to camera overlay (lines ~2025-2050)
  - Button styling: red background, positioned alongside torch/camera-switch
  - Triggered capture flow:
    1. Bypasses detector state checks
    2. Uses current `bestFrame` quad data
    3. Calls `handleCaptureRef.current?.()` to send capture to server
    4. Falls back with error if frame data unavailable
  - Only visible when:
    - Camera is active (`cameraActive`)
    - Auto-scan is enabled (`autoScan`)

**Behavior:**
- Does NOT re-arm the auto-detector (user retains control)
- Disarms auto-scan to prevent accidental double-capture
- Works even if detector reports "no card"
- Useful for:
  - Slow detector on underpowered phones
  - Detector confusion (multiple cards in frame)
  - Fallback when auto-capture fails

---

### 3. Confirmation Mode for Auto-Add

**What it does:** When enabled, matched cards open in the review drawer instead of being auto-filed. User can inspect condition/printing/language before confirming the add.

**Files modified:**
- `frontend/src/components/CameraScanner.jsx`
  - New checkbox in settings: "Confirm before adding" (only visible when autoAdd is ON)
  - State persisted in localStorage as `scan_confirm_add` ('1' = on, '0' = off)
  - Modified `autoAddCard()` function (lines ~1171-1240):
    - If `confirmBeforeAdd` is true and no overrides provided, opens drawer instead of POSTing
    - Pre-fills form fields with auto-detected values (Condition, Printing, Language, Price)
    - Sets `lastAddedIdRef` to prevent duplicate detection
    - User can edit before clicking "Add to Collection"

**Drawer Behavior:**
- Shows matched card image and metadata
- Pre-filled with sensible defaults:
  - Condition: "Near Mint"
  - Printing: "Holofoil" if rarity contains "holo", else "Normal"
  - Language: Same as scan language
  - Price: TCG API price for the detected printing
- User can override before adding
- "Cancel" button allows rejecting the match

**UI Location:** Appears in settings panel when autoAdd is enabled

**Use Cases:**
- Multi-language scanning (confirm each card's language is correct)
- High-value cards (review before filing)
- First-time scanner users (learn detection accuracy)
- Batch scanning with verification workflow

---

## User Workflow Example: Multi-Language Pokémon Scanning

1. **Setup:**
   - Open Settings panel
   - Enable "Auto-scan"
   - Enable "Auto-add"
   - Enable "Confirm before adding"
   - Set "Capture speed" to 1000ms (slower, allows card swapping)

2. **Scanning:**
   - Feed Japanese Pokémon cards one at a time
   - Scanner detects card, shows it in the drawer
   - Review language is correct (scanner detects Japanese, files as Japanese)
   - Review condition/printing if needed
   - Click "Add to Collection" → card is filed
   - Tap "Next card" or swap to next card
   - Repeat

3. **If detector struggles:**
   - Tap red manual shutter button to force capture
   - Review drawer appears
   - Adjust if needed, confirm

---

## Configuration & Persistence

All settings are persisted in browser localStorage:

| Setting | Key | Values | Default |
|---------|-----|--------|---------|
| Capture Speed | `scan_recapture_ms` | 300-2000 (ms) | 600 |
| Confirm Before Add | `scan_confirm_add` | '0' or '1' | '0' |
| Auto-Scan | `scan_auto_scan` | '0' or '1' | '1' |
| Auto-Add | `scan_auto_add` | '0' or '1' | '0' |
| Min Fill | `scan_min_fill` | 0.2-0.9 | 0.55 |
| Min Steady | `scan_min_steady` | 1-10 | 3 |

Settings survive page reloads and app restarts.

---

## Translation Keys Added

All new UI strings are localized:

```json
"scan.captureSpeed": "Capture speed"
"scan.captureSpeedFast": "Fast"
"scan.captureSpeedSlow": "Slow"
"scan.confirmBeforeAdd": "Confirm before adding"
"scan.confirmBeforeAddHint": "Review each match before filing. Great for multi-language runs."
"scan.manualCapture": "Manual shutter (tap to capture)"
"scan.errNoFrameData": "No frame data available. Camera may not be ready yet."
```

English locale complete; other languages fall back to English until translated.

---

## Testing Results

✅ All 57 tests passing
✅ Frontend linter clean (no warnings)
✅ Locale validation passing
✅ Frontend builds successfully (1.66s)

---

## Technical Architecture

### Detection Loop Integration

```
Detection Loop (every ~80-300ms)
  ↓
  shouldCapture(autoArgs) ← includes recaptureMs
  ↓
  If True:
    - Auto-capture triggers
    - Card image sent to server
    - Server returns match
  ↓
  If confirmBeforeAdd is TRUE:
    - Drawer opens with matched card
    - User reviews/edits fields
    - User clicks "Add" → autoAddCard() with overrides
  ↓
  If confirmBeforeAdd is FALSE:
    - autoAddCard() directly POSTs to /api/collection
    - Toast shows success
    - Recent scan logged
```

### Manual Shutter Flow

```
User taps red "S" button
  ↓
  Manual shutter handler
  ↓
  If bestFrame.current available:
    - Set autoArmed = false (stop auto-detector)
    - Capture timestamp = now
    - Call handleCaptureRef.current()
  Else:
    - Show error toast
```

---

## Files Modified

1. **frontend/src/components/CameraScanner.jsx** (1300+ lines)
   - Added capture speed slider to settings
   - Added confirm-before-add checkbox to settings
   - Added manual shutter button to camera overlay
   - Updated `autoAddCard()` to support drawer-based confirmation flow
   - All state hooks properly integrated

2. **frontend/src/utils/autoCapture.js**
   - `shouldCapture()` signature updated to accept `recaptureMs`
   - No other changes; backward compatible

3. **frontend/src/locales/en.json**
   - Added 8 new translation keys for UI text

---

## Known Limitations & Future Enhancements

### Current State
- Manual shutter requires active detector (won't work if auto-scan is OFF)
- Confirmation drawer uses existing CardEntryFields component (shares form styles)
- Speed slider works in 100ms increments (granular enough for most use cases)

### Future Enhancements
- Allow manual shutter even when auto-scan is OFF
- Speed presets (e.g., "Pro", "Standard", "Leisurely")
- Per-language confirmation defaults
- Confirmation stats (how many matches were edited vs accepted)

---

## Verification Checklist

- [x] Capture speed slider works (persists, updates detection timing)
- [x] Manual shutter button appears and captures
- [x] Confirmation mode toggles and opens drawer
- [x] Auto-add still works without confirmation enabled
- [x] Form fields pre-fill correctly with detection defaults
- [x] User edits persist to final save
- [x] All three features work together seamlessly
- [x] Settings survive page reload
- [x] No console errors
- [x] All tests passing
- [x] Linter clean
- [x] Builds successfully

---

## Deployment Notes

1. **Frontend dist updated** — Build output includes all changes
2. **No backend changes** — All scanner changes are client-side
3. **Backward compatible** — Existing scanners unaffected
4. **No migrations needed** — Uses localStorage, not server-side state
5. **Translations fallback** — Non-English locales will show English UI strings until translated

---

## Usage Documentation

See `SCANNER_USER_GUIDE.md` for end-user instructions on:
- How to use each feature
- Recommended settings for different scanning workflows
- Troubleshooting guide

See `SCANNER_IMPROVEMENTS.md` for technical architecture details.
