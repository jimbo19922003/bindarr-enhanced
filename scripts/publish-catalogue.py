from pathlib import Path
import hashlib, json, os, re, shutil, subprocess

root=Path('catalog-bundle')
manifest=json.loads((root/'manifest.json').read_text())
commit=manifest['commit']
if not re.fullmatch('[a-f0-9]{40}',commit):raise SystemExit('Invalid catalogue revision')
if manifest.get('schemaVersion')!=1 or not manifest.get('languages'):raise SystemExit('Invalid catalogue manifest')
output=Path('catalog-release-assets');output.mkdir()

def copy_checked(source,target,descriptor):
 data=source.read_bytes()
 if len(data)!=descriptor['bytes'] or hashlib.sha256(data).hexdigest()!=descriptor['sha256']:raise SystemExit('Catalogue asset checksum differs: '+target)
 (output/target).write_bytes(data)

shutil.copyfile(root/'manifest.json',output/'manifest.json')
copy_checked(root/'LICENSE','LICENSE',manifest['license'])
report=json.loads((root/'validation-report.json').read_text())
if not isinstance(report,dict):raise SystemExit('Invalid validation report')
shutil.copyfile(root/'validation-report.json',output/'validation-report.json')
for language,descriptors in manifest['languages'].items():
 if not re.fullmatch('[a-z]{2}(?:-[a-z]{2})?',language):raise SystemExit('Invalid catalogue language')
 for kind in ['cards','sets']:copy_checked(root/language/(kind+'.json'),language+'.'+kind+'.json',descriptors[kind])
tag='pokemon-catalog-'+commit+'-'+os.environ['GITHUB_RUN_ID']+'-'+os.environ['GITHUB_RUN_ATTEMPT']
repo='jimbo19922003/bindarr-enhanced'
assets=sorted(output.iterdir())
subprocess.run(['gh','release','create',tag,'--repo',repo,'--draft','--prerelease','--target',os.environ['GITHUB_SHA'],'--title','Verified Pokemon metadata '+commit[:12],'--notes','Validated metadata from tcgdex/cards-database. Upstream MIT notice is included in LICENSE. Metadata and artwork references only; no images, prices or scanner indexes.',*[str(item) for item in assets]],check=True)
release=json.loads(subprocess.check_output(['gh','release','view',tag,'--repo',repo,'--json','assets']))
actual={item['name']:item for item in release['assets']}
if set(actual)!={item.name for item in assets}:raise SystemExit('Uploaded catalogue asset list differs; release remains hidden as a draft')
for item in assets:
 if actual[item.name]['size']!=item.stat().st_size or actual[item.name].get('state')!='uploaded':raise SystemExit('Catalogue asset upload is incomplete; release remains hidden as a draft')
subprocess.run(['gh','release','edit',tag,'--repo',repo,'--draft=false','--prerelease'],check=True)
