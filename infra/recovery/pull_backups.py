"""Pull encrypted exports over pinned SSH, then ingest without overwriting history.
No deletion/retention pruning. Run on backup host only; config is local/private.
"""
import argparse, json, os, re, shlex, shutil, subprocess, tempfile
from pathlib import Path
from backup_bundle import ingest

def pull(config):
    c=json.loads(Path(config).read_text())
    host=c['source'];remote=c['exportPath']
    if not re.fullmatch(r'[a-z_][a-z0-9_-]*@[A-Za-z0-9.-]+',host):raise ValueError('Invalid SSH source')
    if not re.fullmatch(r'/[A-Za-z0-9_./-]*',remote) or '..' in remote.split('/'):raise ValueError('Invalid export path')
    identity=Path(c['sshIdentity']).resolve();known=Path(c['knownHosts']).resolve()
    if not identity.is_file() or not known.is_file():raise ValueError('SSH identity and pinned known_hosts required')
    store=Path(c['store']).resolve();store.mkdir(parents=True,exist_ok=True)
    if shutil.disk_usage(store).free < int(c.get('minimumFreeBytes',2*1024**3)):raise ValueError('Insufficient backup disk headroom')
    ssh=shlex.join(['ssh','-i',str(identity),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(known),'-o','ConnectTimeout=15'])
    with tempfile.TemporaryDirectory(prefix='.incoming-',dir=store.parent) as incoming:
        # rrsync must inspect server arguments; -s/--protect-args hides them.
        # Both remote path and user@host are restricted to shell-safe characters above.
        subprocess.run(['rsync','-rt','--timeout=60','--max-size='+str(int(c.get('maxBundleBytes',20*1024**3))),'--include=*.tar.age','--include=*.tar.age.ready.json','--exclude=*','-e',ssh,host+':'+remote.rstrip('/')+'/',incoming+'/'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        return ingest(incoming,store)

if __name__=='__main__':
    os.umask(0o077);p=argparse.ArgumentParser();p.add_argument('--config',required=True);a=p.parse_args()
    try:print(json.dumps(pull(a.config)))
    except Exception as e:print(json.dumps({'status':'PULL_FAILED','type':type(e).__name__}));raise SystemExit(1)
