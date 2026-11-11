"""Home receiver health checks; fixed messages, persisted deduplication, no secret logs."""
import argparse,fcntl,json,os,shlex,shutil,subprocess,tempfile,time
from datetime import datetime,timezone
from pathlib import Path
from backup_bundle import NAME,digest
from telegram_notify import deliver

HOUR=3600
LABELS={'source_unreachable':'VPS backup telemetry unavailable',
        'mainnet_unhealthy':'Mainnet read-only API or indexer is unhealthy',
        'source_stale':'VPS backup is older than 30 hours',
        'source_failed':'VPS backup service failed',
        'source_disk':'VPS free space is below 3 GiB',
        'source_quota':'VPS encrypted export exceeds 400 MiB; retention review needed',
        'receiver_disk':'Backup receiver free space is below 10 GiB',
        'pull_stale':'No successful backup pull for 30 hours',
        'archive_stale':'No verified archive newer than 30 hours',
        'archive_invalid':'Newest stored archive failed integrity check'}

def evaluate(now,remote,free,pull_at,archive_at,archive_valid):
    issues=[]
    if remote is None or not 0<=now-remote.get('checkedAt',0)<=HOUR:issues.append('source_unreachable')
    else:
        if not 0<=now-remote.get('sourceBackupAt',0)<=30*HOUR:issues.append('source_stale')
        if remote.get('backupServiceOk') is not True:issues.append('source_failed')
        if remote.get('mainnetHealthy') is False:issues.append('mainnet_unhealthy')
        if remote.get('freeBytes',0)<3*1024**3:issues.append('source_disk')
        if remote.get('exportBytes',0)>400*1024**2:issues.append('source_quota')
    if free<10*1024**3:issues.append('receiver_disk')
    if not 0<=now-pull_at<=30*HOUR:issues.append('pull_stale')
    if not 0<=now-archive_at<=30*HOUR:issues.append('archive_stale')
    if not archive_valid:issues.append('archive_invalid')
    return sorted(issues)

def message(issues):
    return 'YAMC backup: '+ ('RECOVERED — all backup checks passed.' if not issues else '\n'+'\n'.join(LABELS[x] for x in issues))

def transition(state,issues,now):
    previous=state.get('issues',[])
    changed=previous!=issues
    # Healthy startup is silent; recoveries and changed incidents notify immediately.
    due=(changed and bool(previous or issues)) or (bool(issues) and now-state.get('attemptAt',0)>=24*HOUR)
    return due

def collect(home):
    now=time.time();remote=None
    try:
        # Deployment-specific fixed read-only SSH target, no arbitrary remote commands.
        ssh=['ssh','-i',str(home/'.ssh/vps_reader'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes',
             '-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(home/'.ssh/known_hosts'),'-o','ConnectTimeout=15']
        with tempfile.TemporaryDirectory(dir=home,prefix='.health-') as temp:
            target=Path(temp)/'status.json'
            subprocess.run(['rsync','-t','--max-size=4096','--timeout=30','-e',shlex.join(ssh),
                            'yac_backup_reader@91.84.98.22:/status.json',str(target)],check=True,timeout=45,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            remote=json.loads(target.read_text())
    except Exception:remote=None
    pull=home/'last-pull-success';archive_at=0;valid=False
    try:
        archives=sorted(p for p in (home/'vps-store').glob('*.tar.age') if NAME.fullmatch(p.name))
        newest=archives[-1]
        archive_at=datetime.strptime(newest.name[5:21],'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc).timestamp()
        marker=newest.with_name(newest.name+'.ready.json')
        assert not newest.is_symlink() and not marker.is_symlink() and marker.stat().st_size<=4096
        m=json.loads(marker.read_text());valid=m['file']==newest.name and m['size']==newest.stat().st_size and m['sha256']==digest(newest)
    except Exception:valid=False
    return evaluate(now,remote,shutil.disk_usage(home).free,pull.stat().st_mtime if pull.exists() else 0,archive_at,valid)

def main():
    p=argparse.ArgumentParser();p.add_argument('--home',default='/var/lib/yamc-backup');p.add_argument('--health-output');p.add_argument('--send',action='store_true');p.add_argument('--test',action='store_true');a=p.parse_args()
    os.umask(0o077);home=Path(a.home)
    with (home/'monitor.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        statefile=home/'monitor-state.json';state=json.loads(statefile.read_text()) if statefile.exists() else {}
        now=time.time();issues=collect(home)
        report=home/'health.partial';report.write_text(json.dumps({'checkedAt':now,'issues':issues,'sendEnabled':a.send}));report.replace(home/'health.json')
        # Separate read-only container mount; never expose archives/SSH keys to notifier.
        public=Path(a.health_output) if a.health_output else home/'health-output';public.mkdir(mode=0o700,exist_ok=True)
        copy=public/'health.partial';copy.write_bytes((home/'health.json').read_bytes());copy.replace(public/'health.json')
        print(json.dumps({'issues':issues,'sendEnabled':a.send}))
        if not a.send:return 1 if issues else 0
        if a.test:
            if state.get('testAttemptAt'):raise ValueError('Test already attempted; no automatic resend')
            state['testAttemptAt']=now
            text='YAMC — тест мониторинга резервных копий. Автоматические уведомления включены. '+('Все проверки пройдены.' if not issues else message(issues))
        elif transition(state,issues,now):
            state.update(issues=issues,attemptAt=now);text=message(issues)
        else:return
        # Record the attempt BEFORE sending: an acknowledgement may be lost.
        tmp=home/'monitor-state.partial';tmp.write_text(json.dumps(state));tmp.replace(statefile)
        deliver(home/'telegram.txt',text)
        print('NOTIFICATION_CONFIRMED')

if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception:
        print('MONITOR_FAILED: details withheld; inspect service and backup health. No immediate notification retry.')
        raise SystemExit(1)
