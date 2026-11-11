"""Publish secret-free backup telemetry for the restricted SSH reader."""
import grp,json,os,shutil,subprocess,time,urllib.request
from pathlib import Path

def main():
    os.umask(0o077)
    root=Path('/srv/yac-backup-export')
    marker=Path('/opt/yac/infra/public/backups/last-success')
    result=subprocess.check_output(['systemctl','show','yac-backup.service','-p','Result','--value'],text=True).strip()
    report={'checkedAt':time.time(),'sourceBackupAt':marker.stat().st_mtime if marker.exists() else 0,
            'freeBytes':shutil.disk_usage(root).free,
            'exportBytes':sum(p.stat().st_size for p in root.glob('*.tar.age')),
            'backupServiceOk':result=='success'}
    if Path('/opt/yamc-mainnet/secrets/deployment.json').exists():
        try:
            def read(route):
                with urllib.request.urlopen('http://127.0.0.1:5089/api/'+route,timeout=15) as response:
                    return json.load(response)
            identity=read('deployment');indexer=read('indexer/status');stats=read('stats')
            report['mainnetHealthy']=(identity.get('cluster')=='mainnet-beta'
                and identity.get('programId')=='GUyqmcRPYWxjdM3mXZDT89JAtxBtEWs31BNEKQ6KUT5H'
                and identity.get('mint')=='BcExYqanw2XzVAAsos1FdMCMX952FmaU7v7sqKm3QxAT'
                and indexer.get('healthy') is True and stats.get('stale') is False
                and stats.get('distributionStatus') not in (None,'UNKNOWN'))
        except Exception:report['mainnetHealthy']=False
    tmp=root/'status.partial';tmp.write_text(json.dumps(report))
    os.chown(tmp,0,grp.getgrnam('yac_backup_reader').gr_gid);os.chmod(tmp,0o640)
    tmp.replace(root/'status.json')

if __name__=='__main__':main()
