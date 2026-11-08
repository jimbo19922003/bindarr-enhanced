import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('catalog_wiring', Path(__file__).with_name('wire-local-catalog-install.py'))
wiring = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wiring)
MOUNT = "router.use('/install', require('./localCatalogInstall').createLocalCatalogInstallRouter({connect}));"
GUARD = "router.use((req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).end());"
IMPORT = "import LocalCatalogImportPanel from './LocalCatalogImportPanel';"

class WiringTests(unittest.TestCase):
    def test_collapsed_maintenance_needs_no_old_copy_or_footer(self):
        panel = IMPORT + '\n<details>{maintenanceOpen && <LocalCatalogImportPanel language={language} />}</details>'
        wiring.verify_sources(GUARD + '\n' + MOUNT, panel)
        wiring.verify_sources(GUARD + '\n' + MOUNT, panel)

    def test_missing_or_duplicate_component_is_rejected(self):
        for panel in (IMPORT, IMPORT + '\n<LocalCatalogImportPanel /><LocalCatalogImportPanel />'):
            with self.assertRaises(ValueError):
                wiring.verify_sources(GUARD + MOUNT, panel)

    def test_missing_duplicate_or_unprotected_route_is_rejected(self):
        panel = IMPORT + '\n<LocalCatalogImportPanel />'
        for route in (GUARD, GUARD + MOUNT + MOUNT, MOUNT, MOUNT + GUARD):
            with self.assertRaises(ValueError):
                wiring.verify_sources(route, panel)

    def test_verifier_reads_but_does_not_rewrite_repository_files(self):
        source = Path(wiring.__file__).read_text(encoding='utf-8')
        self.assertNotIn('write_text(', source)
        self.assertNotIn('write_bytes(', source)
        self.assertNotIn('subprocess', source)

if __name__ == '__main__':
    unittest.main()
