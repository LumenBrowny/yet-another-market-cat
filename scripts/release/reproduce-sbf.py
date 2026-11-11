#!/usr/bin/env python3
"""Local release evidence. Two clean builds; never deploys or changes live target/."""
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--identity-file', help='Verified public identities; change program ID only in isolated snapshot')
args = parser.parse_args()

ROOT = pathlib.Path(__file__).resolve().parents[2]
STAMP = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
OUT = ROOT / '.dev' / ('sbf-repro-' + STAMP)
OUT.mkdir(parents=True, exist_ok=False)
ENV = dict(os.environ)
ENV['PATH'] = str(pathlib.Path.home()/'.cargo/bin') + ':' + str(pathlib.Path.home()/'.local/share/solana/install/active_release/bin') + ':/usr/local/bin:/usr/bin:/bin'
# Prevent inherited build overrides from silently changing the candidate.
for name in list(ENV):
    if name.startswith(('CARGO_TARGET_', 'CARGO_PROFILE_')) or name in ('RUSTFLAGS','CARGO_ENCODED_RUSTFLAGS','SBF_OUT_PATH','RUSTUP_TOOLCHAIN','CARGO_BUILD_TARGET','CARGO_BUILD_RUSTFLAGS','RUSTC_WRAPPER','RUSTC_WORKSPACE_WRAPPER'):
        ENV.pop(name)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def capture(cmd):
    return subprocess.check_output(cmd, cwd=ROOT, env=ENV, text=True).strip()

files = [pathlib.Path(p) for p in ('Cargo.toml','Cargo.lock','Anchor.toml','programs/cat_shit_mining/Cargo.toml','protocol/settlement-vectors.json')]
files += sorted(p.relative_to(ROOT) for p in (ROOT/'programs/cat_shit_mining/src').rglob('*.rs'))
source = OUT/'source'
for name in files:
    dest = source/name
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT/name, dest)
workspace_manifest = {str(p): sha(ROOT/p) for p in files}
identity = None
if args.identity_file:
    identity_file = pathlib.Path(args.identity_file).resolve()
    node = shutil.which('node') or shutil.which('node.exe')
    if not node:
        raise RuntimeError('Node is required to verify public identity proofs')
    def node_path(p):
        return subprocess.check_output(['wslpath','-w',str(p)],text=True).strip() if node.endswith('.exe') else str(p)
    subprocess.run([node, node_path(ROOT/'tools/offline-key-custody/keys.mjs'), 'verify-public', node_path(identity_file)], check=True)
    identity = json.loads(identity_file.read_text())
    program = identity['roles']['program']['address']
    old = 'BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW'
    if program == old:
        raise RuntimeError('Rehearsal program ID is forbidden')
    for filename, count in [('programs/cat_shit_mining/src/lib.rs',1),('Anchor.toml',2)]:
        file = source/filename
        value = file.read_text()
        if value.count(old) != count:
            raise RuntimeError('Unexpected identity replacement count: '+filename)
        file.write_text(value.replace(old,program))
    (OUT/'public-identities.json').write_text(json.dumps(identity,indent=2)+'\n')
manifest = {str(p): sha(source/p) for p in files}
(OUT/'source-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
report = {
    'scope': 'Local same-machine clean-build reproducibility; not independent verified build or mainnet release',
    'status': 'BUILDING', 'sourceManifestSha256': sha(OUT/'source-manifest.json'),
    'gitHeadForContextOnly': capture(['git','rev-parse','HEAD']),
    'gitDirty': bool(capture(['git','status','--porcelain'])),
    'versions': {name: capture(cmd) for name,cmd in {
        'hostRust': ['rustc','--version'], 'hostCargo': ['cargo','--version'],
        'sbf': ['cargo-build-sbf','--version'],
        'anchor': [str(ROOT/'.dev/anchor/bin/anchor'),'--version'],
    }.items()},
    'referenceElfSha256': sha(ROOT/'target/deploy/cat_shit_mining.so'),
    'sharedIdlSha256': sha(ROOT/'packages/shared/src/idl.json'), 'builds': [],
    'candidateProgramId': identity['roles']['program']['address'] if identity else None,
    'identitySourceSha256': sha(identity_file) if identity else None,
    'identityChangeScope': 'isolated snapshot only' if identity else None,
}
if report['versions']['sbf'] != 'solana-cargo-build-sbf 3.1.10\nplatform-tools v1.52\nrustc 1.89.0':
    raise RuntimeError('Unexpected SBF toolchain; review before changing pins')
try:
    for number in (1,2):
        directory = OUT / ('build-' + str(number))
        shutil.copytree(source, directory)
        env = dict(ENV); env['CARGO_TARGET_DIR'] = str(directory/'target')
        cmd = ['cargo-build-sbf','--manifest-path','programs/cat_shit_mining/Cargo.toml',
               '--tools-version','v1.52','--skip-tools-install','--offline','--arch','v0',
               '--sbf-out-dir',str(directory/'output'),'--','--locked']
        with (OUT/('build-'+str(number)+'.log')).open('w') as log:
            subprocess.run(cmd, cwd=directory, env=env, stdout=log, stderr=log, check=True)
        elf = directory/'output/cat_shit_mining.so'
        if manifest != {str(p): sha(directory/p) for p in files}:
            raise RuntimeError('Build mutated source/lockfile')
        report['builds'].append({'number':number,'command':cmd,'elfSha256':sha(elf),'bytes':elf.stat().st_size})
        print('Build',number,'finished:',sha(elf),flush=True)
    report['sourceStillMatchesWorkspace'] = manifest == {str(p):sha(ROOT/p) for p in files}
    report['workspaceUnchangedDuringBuild'] = workspace_manifest == {str(p):sha(ROOT/p) for p in files}
    report['cleanBuildsMatch'] = report['builds'][0]['elfSha256'] == report['builds'][1]['elfSha256']
    report['matchesRehearsedElf'] = report['builds'][0]['elfSha256'] == report['referenceElfSha256']
    required = ('workspaceUnchangedDuringBuild','cleanBuildsMatch') if identity else ('sourceStillMatchesWorkspace','cleanBuildsMatch','matchesRehearsedElf')
    report['status'] = 'PASS_LOCAL_REPRODUCIBILITY' if all(report[k] for k in required) else 'REVIEW_REQUIRED'
except Exception as error:
    report['status'] = 'FAILED'; report['error'] = str(error)
    raise
finally:
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print('Evidence:',OUT,flush=True)
