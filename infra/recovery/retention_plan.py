"""Report-only retention planner. Never deletes files or accepts an apply flag."""
import argparse,json
from datetime import datetime,timezone,timedelta
from pathlib import Path
from backup_bundle import NAME,digest

def plan(store,now):
    sets=[];invalid=[]
    for p in Path(store).glob('*.tar.age'):
        try:
            assert NAME.fullmatch(p.name) and not p.is_symlink()
            m=p.with_name(p.name+'.ready.json');assert not m.is_symlink() and m.stat().st_size<=4096
            v=json.loads(m.read_text());assert v['file']==p.name and v['size']==p.stat().st_size and v['sha256']==digest(p)
            date=datetime.strptime(p.name[5:21],'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
            assert date<=now+timedelta(minutes=5)
            sets.append((date,p))
        except Exception:invalid.append(p.name)
    sets.sort(reverse=True);keep=set()
    # Keep newest seven sets regardless of age, plus all recent sets and bucket samples.
    keep.update(p.name for _,p in sets[:7])
    keep.update(p.name for d,p in sets if now-d<timedelta(days=7))
    for key,count in [(lambda d:d.date(),7),(lambda d:d.isocalendar()[:2],4),(lambda d:(d.year,d.month),12)]:
        buckets=set()
        for date,p in sets:
            bucket=key(date)
            if bucket not in buckets and len(buckets)<count:buckets.add(bucket);keep.add(p.name)
    # Invalid/incomplete data requires investigation, not automated cleanup.
    return {'mode':'REPORT_ONLY','keep':sorted(keep),'candidates':[] if invalid else [p.name for _,p in sets if p.name not in keep],
            'invalid':invalid,'deletionBlocked':bool(invalid),'deleted':0}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--store',required=True);a=p.parse_args()
    print(json.dumps(plan(a.store,datetime.now(timezone.utc))))
