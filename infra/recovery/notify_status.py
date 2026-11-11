"""VPN-container notifier. Reads health only; no SSH keys or archive access."""
import argparse,fcntl,json,os,time
from pathlib import Path
from backup_monitor import LABELS,message,transition
from telegram_notify import credentials,deliver,NoRedirect
import urllib.request

def read_health(path,now):
    try:
        p=Path(path)
        if p.stat().st_size>16384:raise ValueError('Oversize report')
        r=json.loads(p.read_text())
        if not 0<=now-r['checkedAt']<=3600:raise ValueError('Stale report')
        if not isinstance(r['issues'],list) or any(x not in LABELS for x in r['issues']):raise ValueError('Unknown issue')
        return sorted(set(r['issues']))
    except Exception:return ['collector_unavailable']

def render(issues):
    if issues==['collector_unavailable']:return 'YAMC backup: receiver health checks are unavailable or older than one hour.'
    return message(issues)

def main():
    p=argparse.ArgumentParser();p.add_argument('--probe',action='store_true');p.add_argument('--test',action='store_true');p.add_argument('--dry-run',action='store_true');a=p.parse_args()
    os.umask(0o077);secret='/run/secrets/telegram.txt'
    if a.probe:
        token,_=credentials(secret)
        with urllib.request.build_opener(NoRedirect).open('https://api.telegram.org/bot'+token+'/getMe',timeout=15) as response:
            if not json.load(response).get('ok'):raise ValueError('Probe failed')
        print('TELEGRAM_IDENTITY_CONFIRMED');return
    now=time.time();issues=read_health('/health/health.json',now)
    print(json.dumps({'issues':issues,'dryRun':a.dry_run}))
    if a.dry_run:return
    root=Path('/state')
    with (root/'notify.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        path=root/'state.json';state=json.loads(path.read_text()) if path.exists() else {}
        if a.test:
            if state.get('testAttemptAt'):raise ValueError('Test already attempted')
            state['testAttemptAt']=now
            text='YAMC — тест уведомлений через wgmina. VPN-доставка подключена; резервное копирование по SSH работает отдельно.'
        elif transition(state,issues,now):state.update(issues=issues,attemptAt=now);text=render(issues)
        else:return
        tmp=root/'state.partial';tmp.write_text(json.dumps(state));tmp.replace(path)
        deliver(secret,text)
        state['confirmedAt']=time.time();tmp.write_text(json.dumps(state));tmp.replace(path)
        print('NOTIFICATION_CONFIRMED')

if __name__=='__main__':
    try:main()
    except Exception:
        print('NOTIFIER_FAILED; details withheld; no immediate send retry')
        raise SystemExit(1)
