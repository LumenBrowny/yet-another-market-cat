"""Local-first encrypted backup export/ingest/restore. Requires age on PATH.
Input must be an already consistent DB/manifest snapshot, not a live DB directory.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, tarfile, tempfile, uuid
from datetime import datetime, timezone
from pathlib import Path

NAME=re.compile(r'^yamc-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}\.tar\.age$')
def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
def checked_files(root):
    files=[]
    for f in sorted(root.rglob('*')):
        if f.is_symlink():raise ValueError('Symlink in snapshot')
        if f.is_file():files.append(f)
        elif not f.is_dir():raise ValueError('Unsupported snapshot entry')
    if not files:raise ValueError('Empty snapshot')
    return files

def pack(snapshot, export, recipient):
    snapshot=Path(snapshot).resolve();export=Path(export).resolve()
    if export==snapshot or snapshot in export.parents:raise ValueError('Export cannot be inside snapshot')
    files=checked_files(snapshot)
    inventory={f.relative_to(snapshot).as_posix():digest(f) for f in files}
    if 'inventory.json' in inventory:raise ValueError('Reserved inventory filename')
    export.mkdir(parents=True,exist_ok=True)
    name='yamc-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex+'.tar.age'
    dest=export/name;part=export/(name+'.partial')
    # No plaintext tar persisted on the exporting host.
    with open(part,'xb') as output:
        proc=subprocess.Popen(['age','-r',recipient],stdin=subprocess.PIPE,stdout=output,stderr=subprocess.DEVNULL)
        try:
            with tarfile.open(fileobj=proc.stdin,mode='w|') as tar:
                for f in files:tar.add(f,arcname=f.relative_to(snapshot).as_posix(),recursive=False)
                import io
                data=json.dumps(inventory,sort_keys=True).encode();info=tarfile.TarInfo('inventory.json');info.size=len(data);info.mode=0o600
                tar.addfile(info,io.BytesIO(data))
            proc.stdin.close()
            if proc.wait()!=0:raise RuntimeError('Encryption failed')
        except BaseException:
            proc.kill();proc.wait();part.unlink(missing_ok=True);raise
        output.flush();os.fsync(output.fileno())
    part.rename(dest)
    ready=export/(name+'.ready.json');temp=export/(name+'.ready.partial')
    temp.write_text(json.dumps({'file':name,'sha256':digest(dest),'size':dest.stat().st_size}),encoding='utf-8');temp.rename(ready)
    return {'status':'EXPORTED','file':name,'files':len(files)}

def ingest(incoming, store):
    incoming=Path(incoming).resolve();store=Path(store).resolve();store.mkdir(parents=True,exist_ok=True)
    if incoming==store or incoming in store.parents or store in incoming.parents:raise ValueError('Separate directories required')
    accepted=0
    for marker in sorted(incoming.glob('*.ready.json')):
        if marker.is_symlink() or marker.stat().st_size>4096:raise ValueError('Invalid marker')
        m=json.loads(marker.read_text());name=m.get('file','')
        if not NAME.fullmatch(name) or marker.name!=name+'.ready.json':raise ValueError('Invalid backup name')
        source=incoming/name
        if source.is_symlink() or not source.is_file() or source.stat().st_size!=m['size'] or digest(source)!=m['sha256']:raise ValueError('Incomplete or corrupt encrypted backup')
        dest=store/name
        if dest.exists():
            if dest.is_symlink() or digest(dest)!=m['sha256']:raise ValueError('Existing backup conflict; refusing overwrite')
        else:
            # O_EXCL: no overwrite, including concurrent receivers. Failed copy is not acknowledged.
            try:
                with source.open('rb') as src, dest.open('xb') as out:shutil.copyfileobj(src,out);out.flush();os.fsync(out.fileno())
                if digest(dest)!=m['sha256']:raise ValueError('Received bytes changed')
            except BaseException:
                # Leave any partial file unacknowledged for operator investigation.
                raise
        ack=store/(name+'.ready.json')
        if not ack.exists():
            with ack.open('x',encoding='utf-8') as f:json.dump(m,f)
        accepted+=1
    if not accepted:raise ValueError('No complete backups received')
    return {'status':'RECEIVED','complete':accepted}

def restore(bundle, identity, destination):
    bundle=Path(bundle).resolve();destination=Path(destination).resolve()
    if destination.exists():raise ValueError('Restore destination must not exist')
    destination.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.yamc-restore-',dir=destination.parent) as tmp:
        tmp=Path(tmp);plain=tmp/'snapshot.tar';out=tmp/'verified';out.mkdir()
        with plain.open('xb') as f:
            result=subprocess.run(['age','-d','-i',str(Path(identity).resolve()),str(bundle)],stdout=f,stderr=subprocess.DEVNULL)
        if result.returncode:raise ValueError('Decryption/authentication failed')
        with tarfile.open(plain) as tar:
            names=set()
            for member in tar:
                name=member.name;relative=Path(name)
                if not member.isfile() or relative.is_absolute() or '..' in relative.parts or '\\' in name or name in names:raise ValueError('Unsafe archive member')
                names.add(name);target=out/relative;target.parent.mkdir(parents=True,exist_ok=True)
                with tar.extractfile(member) as src,target.open('xb') as dst:shutil.copyfileobj(src,dst)
        inventory=json.loads((out/'inventory.json').read_text())
        if names!=set(inventory)|{'inventory.json'}:raise ValueError('Inventory mismatch')
        for name,h in inventory.items():
            if digest(out/name)!=h:raise ValueError('Restored hash mismatch')
        (out/'inventory.json').unlink()
        out.rename(destination)
    return {'status':'RESTORED','files':len(inventory)}

if __name__=='__main__':
    os.umask(0o077)
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True)
    a=sub.add_parser('pack');a.add_argument('--snapshot',required=True);a.add_argument('--export',required=True);a.add_argument('--recipient',required=True)
    a=sub.add_parser('ingest');a.add_argument('--incoming',required=True);a.add_argument('--store',required=True)
    a=sub.add_parser('restore');a.add_argument('--bundle',required=True);a.add_argument('--identity',required=True);a.add_argument('--destination',required=True)
    a=vars(p.parse_args());command=a.pop('command')
    try:print(json.dumps(globals()[command](**a)))
    except Exception as e:
        print(json.dumps({'status':'FAILED','type':type(e).__name__}))
        raise SystemExit(1)
