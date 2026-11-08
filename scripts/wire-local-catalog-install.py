"""Read-only verification of committed catalogue installation wiring."""
from pathlib import Path
import re

def verify_sources(route, panel):
    mount = "router.use('/install', require('./localCatalogInstall').createLocalCatalogInstallRouter({connect}));"
    if route.count(mount) != 1:
        raise ValueError('Expected exactly one catalogue install route mount')
    guard = route.find("req.user?.role === 'admin'")
    if guard < 0 or guard > route.index(mount):
        raise ValueError('Catalogue install route must follow the administrator guard')
    imports = re.findall(r"^import LocalCatalogImportPanel from ['\"]\./LocalCatalogImportPanel['\"];?\s*$", panel, re.M)
    if len(imports) != 1:
        raise ValueError('Expected exactly one catalogue import component import')
    if len(re.findall(r'<LocalCatalogImportPanel\b', panel)) != 1:
        raise ValueError('Expected exactly one catalogue import component mount')

def main():
    root = Path(__file__).resolve().parents[1]
    route = (root / 'backend/src/routes/localCatalogStatus.js').read_text(encoding='utf-8')
    panel = (root / 'frontend/src/components/LocalCatalogStatusPanel.jsx').read_text(encoding='utf-8')
    verify_sources(route, panel)
    print('Verified one administrator-protected install route and one import panel; no files changed.')

if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        raise SystemExit(str(error))
