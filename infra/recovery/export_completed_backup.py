"""Encrypt a completed legacy VPS backup; run as ExecStartPost of its backup service.
Includes mainnet PostgreSQL and an online SQLite snapshot when admission is staged.
"""
import fcntl,json,os,shutil,tempfile,subprocess,tarfile
from datetime import datetime,timezone
from pathlib import Path
from backup_bundle import pack

def export():
    os.umask(0o077)
    source=Path('/opt/yac/infra/public/backups')
    output=Path('/srv/yac-backup-export')
    with open('/run/yamc-encrypted-export.lock','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        completed=source/'last-success'
        if datetime.now().timestamp()-completed.stat().st_mtime>3600:
            raise ValueError('No fresh completed source backup')
        # Bounded disk use, fail closed rather than silently prune recovery history.
        if sum(p.stat().st_size for p in output.iterdir() if p.is_file())>512*1024**2:
            raise ValueError('Export quota reached; operator retention review required')
        if shutil.disk_usage(output).free<2*1024**3:
            raise ValueError('Insufficient source disk headroom')
        db=max(source.glob('db-*.dump'),key=lambda p:p.stat().st_mtime)
        config=max(source.glob('config-*.tar.gz'),key=lambda p:p.stat().st_mtime)
        for p in (db,config):
            if p.is_symlink() or p.stat().st_size==0 or abs(completed.stat().st_mtime-p.stat().st_mtime)>3600:
                raise ValueError('Incomplete source set')
        with tempfile.TemporaryDirectory(prefix='yamc-encrypted-',dir='/var/lib/yamc-export') as temp:
            snapshot=Path(temp)
            shutil.copyfile(db,snapshot/'database.dump')
            shutil.copyfile(config,snapshot/'configuration.tar.gz')
            shutil.copytree(source/'manifests',snapshot/'manifests',symlinks=True)
            shutil.copyfile('/opt/yac/infra/public/secrets/deployment.json',snapshot/'deployment.json')
            mainnet=Path('/opt/yamc-mainnet')
            if (mainnet/'secrets/deployment.json').exists():
                extra=snapshot/'mainnet';extra.mkdir()
                with (extra/'database.dump').open('xb') as dump:
                    subprocess.run(['docker','exec','yac-postgres-1','pg_dump','-U','postgres','-Fc','yamc_mainnet_accounting'],stdout=dump,stderr=subprocess.DEVNULL,check=True,timeout=120)
                if (extra/'database.dump').stat().st_size==0:raise ValueError('Empty mainnet dump')
                admission=(mainnet/'secrets/admission.json').exists()
                if admission:
                    # Snapshot via SQLite backup API, never copy a live main DB alone.
                    out=extra/'admission';out.mkdir(mode=0o700);os.chown(out,1000,1000)
                    subprocess.run(['docker','run','--rm','--network','none','--read-only',
                        '--cap-drop','ALL','--security-opt','no-new-privileges:true',
                        '--user','1000:1000','--entrypoint','node',
                        '-v','yamc-mainnet-admission-data:/data',
                        '-v',str(out)+':/out',
                        'sha256:56ff4844d27dc1ffe8b1fec4fdcd7aa99e04ae82beeb355994fe1e9bfde34ce7',
                        'infra/admission/snapshot.mjs','/data/admission.db','/out/admission.db'],
                        check=True,timeout=120,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                    if not (out/'admission.db').is_file() or (out/'admission.db').stat().st_size==0:
                        raise ValueError('Missing admission snapshot')
                with tarfile.open(extra/'configuration.tar.gz','w:gz') as tar:
                    for name in ['secrets','.env','compose.yaml']:
                        tar.add(mainnet/name,arcname=name,recursive=True)
                    if (mainnet/'compose.admission.yaml').exists():
                        tar.add(mainnet/'compose.admission.yaml',arcname='compose.admission.yaml')
                shutil.copyfile(mainnet/'secrets/deployment.json',extra/'deployment.json')
                with tarfile.open(extra/'website.tar.gz','w:gz') as tar:
                    tar.add('/opt/yac/server/YetAnotherCat.Api/wwwroot',arcname='wwwroot',recursive=True)
                (extra/'snapshot.json').write_text(json.dumps({'environment':'mainnet-preparing','createdAt':datetime.now(timezone.utc).isoformat(),'admissionEnabled':False,'publisherEnabled':False,'admissionSnapshotIncluded':admission,'scope':'PostgreSQL dump, runtime configuration and optional consistent SQLite admission snapshot; reconcile against chain on restore.'}))
            metadata={'createdAt':datetime.now(timezone.utc).isoformat(),'environment':'existing-public-devnet','sourceCompletedAt':completed.read_text().strip(),'databaseSource':db.name,'configurationSource':config.name,'scope':'PostgreSQL dump, manifest mirror, deployment/configuration and staged mainnet admission snapshot when configured; reconcile chain on restore'}
            (snapshot/'snapshot.json').write_text(json.dumps(metadata,indent=2))
            result=pack(snapshot,output,Path('/etc/yamc-recovery/recipient.txt').read_text().strip())
        # Reader can read ciphertext only; it cannot create/change/delete files.
        import grp
        gid=grp.getgrnam('yac_backup_reader').gr_gid
        for p in output.iterdir():
            if p.name in (result['file'],result['file']+'.ready.json'):
                os.chown(p,0,gid);os.chmod(p,0o640)
        print(json.dumps(result))

if __name__=='__main__':
    try:export()
    except Exception as e:
        print(json.dumps({'status':'EXPORT_FAILED','type':type(e).__name__}))
        raise SystemExit(1)
