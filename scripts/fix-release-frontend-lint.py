from pathlib import Path
import hashlib

fixes = {
    'frontend/src/App.jsx': ('e76af02c724d7e653d80c608c36d38d76f6ad6b8', [
        ("useLayoutEffect, useRef, lazy", "useLayoutEffect, useRef, useCallback, lazy"),
        ("  const showTab = (tab) => {\n    scrollByTabRef.current[shownTabRef.current] = window.scrollY;\n    setActiveTab(tab);\n  };", "  const showTab = useCallback((tab) => {\n    scrollByTabRef.current[shownTabRef.current] = window.scrollY;\n    setActiveTab(tab);\n  }, []);"),
        ("  const goTab = (tab) => {\n    if (tab === activeTab) return;\n    const prev = activeTab;\n    tabGuardRef.current = pushBackGuard(() => { tabGuardRef.current = null; showTab(prev); });\n    showTab(tab);\n  };", "  const goTab = useCallback((tab) => {\n    if (tab === activeTab) return;\n    const prev = activeTab;\n    tabGuardRef.current = pushBackGuard(() => { tabGuardRef.current = null; showTab(prev); });\n    showTab(tab);\n  }, [activeTab, showTab]);"),
        ("    return () => window.removeEventListener('bindarr_open_sales_history', open);\n  }, [activeTab]);", "    return () => window.removeEventListener('bindarr_open_sales_history', open);\n  }, [goTab]);"),
    ]),
    'frontend/src/components/Dashboard.jsx': ('ead2319758952f17238049c9e0c8371528cd9892', [
        ("import { TrendingUp, Coins, Library, Trophy, Plus, ArrowUpRight, Package, Zap }", "import { TrendingUp, Library, Trophy, Plus, Package, Zap }"),
        ("  const sealedUnits = stats && stats.summary.sealed ? stats.summary.sealed.remainingUnits : 0;\n", ""),
    ]),
    'frontend/src/components/RipForm.jsx': ('76ed16f145895219a8f820fbd6c392097a42e435', [
        ("  useEffect(() => { live.current = true; inputRef.current?.focus(); return () => { live.current = false; request.current++; }; }, []);", "  useEffect(() => {\n    const requestRef = request;\n    live.current = true;\n    inputRef.current?.focus();\n    return () => { live.current = false; requestRef.current++; };\n  }, []);"),
        ("unless a sale has frozen the opening's acquisition basis.</small>", "unless a sale has frozen the opening&apos;s acquisition basis.</small>"),
    ]),
    'frontend/src/components/SaleDialogHost.jsx': ('8fd94a617ab90111257293a31fd91934588bffc1', [
        ("Confirming also freezes this completed rip's cost allocation.", "Confirming also freezes this completed rip&apos;s cost allocation."),
    ]),
}

outputs = []
for name, (expected, replacements) in fixes.items():
    path = Path(name)
    original = path.read_bytes()
    digest = hashlib.sha1(b'blob ' + str(len(original)).encode() + b'\0' + original).hexdigest()
    if digest != expected:
        raise SystemExit(f'{name}: source changed; refusing to overwrite it')
    text = original.decode('utf-8')
    for old, new in replacements:
        if text.count(old) != 1:
            raise SystemExit(f'{name}: expected exactly one matching edit')
        text = text.replace(old, new, 1)
    outputs.append((path, text))
for path, text in outputs:
    path.write_bytes(text.encode('utf-8'))
