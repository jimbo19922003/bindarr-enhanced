from pathlib import Path
import json, os, re, shutil, subprocess
root=Path('catalog-bundle')
manifest=json.loads((root/'manifest.json').read_text())
commit=manifest['commit']
if not re.fullmatch('[a-f0-9]{40}',commit):raise SystemExit('Invalid catalogue revision')
output=Path('catalog-release-assets');output.mkdir()
for name in ['manifest.json','LICENSE']:
 shutil.copyfile(root/name,output/name)
for language in manifest['languages']:
 if not re.fullmatch('[a-z]{2}(?:-[a-z]{2})?',language):raise SystemExit('Invalid catalogue language')
 for kind in ['cards','sets']:
  shutil.copyfile(root/language/(kind+'.json'),output/(language+'.'+kind+'.json'))
tag='pokemon-catalog-'+commit+'-'+os.environ['GITHUB_RUN_ID']+'-'+os.environ['GITHUB_RUN_ATTEMPT']
subprocess.run(['gh','release','create',tag,'--repo','jimbo19922003/bindarr-enhanced','--prerelease','--target',os.environ['GITHUB_SHA'],'--title','Verified Pokemon metadata '+commit[:12],'--notes','Validated metadata from tcgdex/cards-database. Upstream MIT notice is included in LICENSE. These assets contain metadata and artwork references, not image files, prices or scanner indexes.',*[str(item) for item in sorted(output.iterdir())]],check=True)
