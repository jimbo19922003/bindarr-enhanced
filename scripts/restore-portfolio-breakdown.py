from pathlib import Path
line = "            <div>{t('dash.portfolioIncludes')}</div>\n"
paths = [Path('frontend/src/components/Dashboard.jsx'), Path('scripts/aligned-summary/summary.jsx')]
edits = []
for path in paths:
    text = path.read_text()
    if text.count(line) > 1:
        raise RuntimeError('Ambiguous portfolio subtitle in ' + str(path))
    if "t('dash.sealedIncluded'" not in text or "t('dash.portfolioValue')" not in text or 'summary-pricing-warning' not in text:
        raise RuntimeError('Expected portfolio breakdown or warning missing in ' + str(path))
    edits.append((path, text.replace(line, '', 1)))
for path, text in edits:
    path.write_text(text)
