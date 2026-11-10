# Scanner Improvements & Overhaul

## Summary

This update provides a comprehensive overhaul of the Bindarr scanner to address speed issues, improve error handling, and add better controls for multi-language scanning workflows.

## Changes Made

### 1. **Configurable Capture Speed** ⚡
**Problem:** Scanner was capturing too quickly (600ms minimum), making it hard to scan multiple cards without hitting the next one.

**Solution:** Added adjustable recapture delay (300-2000ms) in scan settings.

**Files Modified:**
- `frontend/src/utils/autoCapture.js` - Added `MIN_RECAPTURE_MIN=300`, `MIN_RECAPTURE_MAX=2000`, and `recaptureMs` parameter to `shouldCapture()`
- `frontend/src/components/CameraScanner.jsx` - Added `recaptureMs` state (persisted in localStorage as `scan_recapture_ms`)

**Usage:**
- Users can adjust `Scan Settings → Capture Speed` from Turbo (300ms) to Careful (2000ms)
- Default remains 600ms for backward compatibility
- Perfect for multi-language scanning or batching cards of various languages

---

### 2. **Better Product Map Error Messages** 📋
**Problem:** Users got cryptic errors: "ready-made pokemon catalog recognized a card but this install has no card data to name it"

**Solution:** Improved error messages with actionable guidance.

**Files Modified:**
- `backend/src/routes/collection.js` - Enhanced error response for unresolved TCGplayer product IDs

**Changes:**
- **If map is still syncing:** Shows progress (`X rows loaded`) and tells user to wait
- **If map not synced yet:** Clear instructions to visit `Admin → Catalogs → TCGplayer Product Map` and try downloading card data first
- Includes practical next steps instead of just stating the problem

**Example Error Response:**
```json
{
  "error": "Card identified but TCGplayer product map not yet synced. An admin must sync it at Admin → Catalogs → TCGplayer Product Map. Try downloading card data from a set first.",
  "unresolvedPublished": true,
  "productMapRows": 0
}
```

---

### 3. **Manual Shutter Button** 📸
**Problem:** When the detector fails (on older phones, poor lighting), users had no way to manually capture a card.

**Solution:** Added fallback manual shutter capability.

**Files Modified:**
- `frontend/src/components/CameraScanner.jsx` - Added `manualShutterReady` state and UI

**Features:**
- Always available as a fallback
- Triggers scan without waiting for detector confidence
- Especially useful when:
  - Detector fails on older devices
  - Unusual card angles or lighting
  - Detector service is down

---

### 4. **Confirmation Mode for Auto-Add** ✅
**Problem:** Auto-add could accidentally add wrong cards during fast scanning (especially in multi-language mode).

**Solution:** Added optional confirmation before auto-add.

**Files Modified:**
- `frontend/src/components/CameraScanner.jsx` - Added `confirmBeforeAdd` state (persisted as `scan_confirm_add`)

**Features:**
- When enabled: Shows matched card in drawer for review before auto-filing
- Perfect for batch-scanning multi-language cards
- User can verify card details (condition, printing, quantity) before save
- Setting persists across sessions

**Workflow:**
```
Scan → Card matches → Confirmation drawer opens → Review/edit → Confirm add
(without confirmation mode, saves immediately)
```

---

### 5. **Improved Language Selection UI** 🌍
**Problem:** Multi-language scanning was hard to configure and monitor.

**Solution:** Better language handling and UI hints.

**Files Modified:**
- `frontend/src/components/CameraScanner.jsx` - Improved language state management

**Features:**
- Selected language persists per game
- Fallback to English when language isn't supported for a game
- `LangFallbackNote` component shows when scanning returns English art for non-English cards
- Language-specific set filtering already implemented

**Notes:**
- Korean, Japanese, and Chinese Pokémon sets are separate releases (not translations)
- Scans of those languages will match to English printing but file as the scanned language
- Component clearly indicates this with a tooltip

---

## Settings & Configuration

### New Scanner Settings

All settings are persisted in localStorage and survive app restarts:

| Setting | Key | Values | Default |
|---------|-----|--------|---------|
| Capture Speed | `scan_recapture_ms` | 300-2000 ms | 600 |
| Confirm before Add | `scan_confirm_add` | 0 or 1 | 0 (off) |
| Auto-Add | `scan_auto_add` | 0 or 1 | 1 (on) |
| Scanner Game | `scanner_game` | game code | user's default |
| Scanner Language | `scanner_lang` | language code | 'en' |
| Min Fill % | `scan_min_fill` | 0-1 | 0.55 |
| Min Steady Frames | `scan_min_steady` | 1-10 | 3 |
| Scan Detail | `scan_detail` | 0-3 | 2 (Balanced) |
| Show Outline | `scan_outline` | 0 or 1 | 1 (on) |
| Debug Mode | `scan_debug` | 0 or 1 | 0 (off) |

---

## Recommended Workflows

### Fast Single-Language Batch
1. Set Capture Speed: **Turbo** (300ms)
2. Auto-Add: **On**
3. Language: Select single language
4. Scan and place cards in rapid succession

### Multi-Language Careful Batch
1. Set Capture Speed: **Careful** (1500-2000ms)
2. Confirm before Add: **On**
3. Change language between cards as needed
4. Verify each card before filing

### Troubleshooting Detector Issues
1. Enable Manual Shutter fallback
2. If detector keeps failing: Check lighting, try adjusting Min Fill % (lower = easier)
3. Check **Scan Detail** setting—lower detail (Turbo) is faster but less accurate

---

## Technical Details

### Speed Control Logic
- `MIN_RECAPTURE_MS` (default 600ms) controls minimum time between captures
- Adjustable via UI from 300-2000ms
- Setting passed to `shouldCapture()` function in auto-capture loop
- Stored per-session, survives app restart

### Error Handling Flow
1. Scan matches card via catalog
2. Try to resolve card ID to name via `tcgplayer_product` table
3. If not found, query TCGplayer's own catalog
4. If still not resolved and using ready-made catalog:
   - Check product map sync status
   - Return actionable error with next steps

### Language Fallback for CJK
- Korean (ko), Japanese (ja), Chinese (zh) Pokémon are separate releases
- Scanning returns English printing (same artwork, English metadata)
- Card is filed in the scanned language, not English
- `LangFallbackNote` component alerts user to this

---

## Testing & Validation

- ✅ All existing tests pass
- ✅ Speed settings persist across sessions
- ✅ Error messages tested for clarity
- ✅ Manual shutter doesn't interfere with auto-capture
- ✅ Language fallback properly noted to users

---

## Future Enhancements

1. **Batch Language Switching** - UI to quickly switch language without changing auto-add settings
2. **Scan Preview** - Show previous scan for comparison before auto-capturing next
3. **Duplicate Detection** - Warn if about to re-scan same card
4. **Scan Analytics** - Track which languages/sets are scanned most
5. **Detector Performance Metrics** - Show real-time detection stats for tuning
