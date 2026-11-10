# Scanner Quick Start Guide

**For technical details on the scanner architecture, see [SCANNER_IMPROVEMENTS.md](./SCANNER_IMPROVEMENTS.md) and [SCANNER_INTEGRATION_COMPLETE.md](./SCANNER_INTEGRATION_COMPLETE.md).**

## Getting Started

### Opening the Scanner
- Click **Camera** or **Scanner** button in main navigation
- Allow camera access when prompted
- Scanner starts in auto-capture mode (automatic)

---

## Speed Control for Multi-Language Scanning

Your issue of scanning "too fast" is solved! ⚡

### Adjust Capture Speed
1. Open **Scan Settings** (gear icon in scanner)
2. Find **Capture Speed** slider
3. Choose preset or set exact value:
   - **Turbo** (300ms) - Maximum speed, single language
   - **Fast** (800ms) - Balanced, recommended default
   - **Balanced** (1200ms) - Careful, multi-language OK
   - **Careful** (2000ms) - Slowest, multi-language safe

### Multi-Language Workflow
For scanning cards in many languages (Thai, Spanish, Japanese, French, etc.):

1. **Before you start:**
   - Go to **Scan Settings**
   - Set Capture Speed → **Careful** (2000ms)
   - Enable **Confirm Before Add** ✓
   - Select your first language

2. **While scanning:**
   - Place card in frame
   - Wait for "READY" indicator (shows when card is steady)
   - Card captures automatically
   - Review the matched card in drawer
   - Click **Confirm & Add** or edit details first

3. **Switching language:**
   - After confirming a card, change language in scanner
   - Next card will scan in new language

---

## Fixing "Card Recognized But No Data" Error

### Symptom
> "Card identified but TCGplayer product map not yet synced."

### Quick Fix
1. Go to **Admin → Catalogs**
2. Under "TCGplayer Product Map", click **Sync**
3. This builds the mapping of product IDs to actual card data
4. Wait until sync shows progress has completed
5. Try scanning again

### Faster Alternative
1. Download card data for a set first (Pre-builds the product map)
2. Go to **Admin → Catalogs → Local Pokémon**
3. Click **Download** on a set (like Base Set, Jungle, etc.)
4. Once download finishes, sync should be quicker

### Why This Happens
- The ready-made scanner catalog recognizes cards by their TCGplayer product ID
- But it needs a mapping table to convert that ID to actual card details
- This table is built lazily when you:
  - Download card data (via set walk)
  - Sync the TCGplayer product map

---

## Manual Capture (If Auto-Capture Fails)

If scanner doesn't capture automatically (detector issues):

1. Open **Scan Settings**
2. Look for **Manual Shutter** button
3. Click to capture without waiting for detector
4. Scanner still uses the same matching engine

---

## Confirmation Mode (Avoid Scanning Wrong Cards)

When batch-scanning mixed languages or sets:

1. **Scan Settings** → Enable **Confirm Before Add** ✓
2. Now each scan shows a **drawer with the matched card**
3. Verify the match is correct
4. Adjust condition/printing/quantity if needed
5. Click **Confirm & Add**

This prevents accidentally adding the wrong card when scanning fast.

---

## Settings That Help

### For Speed
- **Capture Speed** → Move slider left (faster)
- **Auto-Add** → Keep ON (skips confirmation)

### For Accuracy
- **Capture Speed** → Move slider right (slower, more time)
- **Confirm Before Add** → Turn ON (review each card)
- **Min Fill %** → Lower if cards don't fill guide box
- **Scan Detail** → Higher (Accurate) if mismatches happen

### For Detector Issues
- **Manual Shutter** → Available as fallback
- **Min Fill %** → Lower (easier to detect)
- **Scan Detail** → Lower (Turbo) for faster detection

---

## Common Issues & Fixes

| Issue | Solution |
|-------|----------|
| **Scanner captures too fast** | Increase Capture Speed (slider right) |
| **Scanner never captures** | Check Min Fill % (too high?), try lower value |
| **Card not detected at all** | Enable Manual Shutter; check lighting |
| **"No confident match" error** | Card may not be in catalog; try scanning clearer photo |
| **Wrong card identified** | Enable Confirm Before Add and review each match |
| **Product map error** | Run sync at Admin → Catalogs → TCGplayer Product Map |

---

## Pro Tips 🎯

1. **Batch by Language** - Set language once, scan 10+ cards before switching
2. **Use Manual Shutter as Backup** - If auto-capture glitches, shutter always works
3. **Enable Confirmation for Mistakes** - If you notice wrong cards getting added, turn on Confirm mode
4. **Adjust Min Fill % Tactically** - Lower % = easier detection but riskier (false positives)
5. **Decent Lighting Matters** - Poor lighting causes false positives and missed detections
6. **Steady Guide Box** - Keep card still in the dotted guide box for best results

---

## Camera Tips

- **1080p Resolution:** Scanner requests high resolution for accuracy (may not work on all phones)
- **Torch/Flash:** Available if device supports it (button shows 💡)
- **Exposure Control:** Available on some devices (manual brightness adjustment)
- **Zoom:** Available on devices with variable zoom
- **Lens Picker:** Switch between front/back cameras if device has multiple lenses

---

Need help? Check Admin → Catalogs for:
- Scan catalog build status
- Product map sync progress
- Local cache statistics
