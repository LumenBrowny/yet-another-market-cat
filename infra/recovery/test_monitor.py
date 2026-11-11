import unittest
import tempfile,json,hashlib
from datetime import datetime,timezone,timedelta
from pathlib import Path
from backup_monitor import evaluate,transition,HOUR
from retention_plan import plan
from notify_status import read_health

class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.now=1000000;self.remote={'checkedAt':self.now,'sourceBackupAt':self.now,'backupServiceOk':True,'freeBytes':5*1024**3,'exportBytes':100}
    def check(self,remote=None,pull=None,archive=None,valid=True):
        return evaluate(self.now,self.remote if remote is None else remote,20*1024**3,self.now if pull is None else pull,self.now if archive is None else archive,valid)
    def test_healthy(self):self.assertEqual(self.check(),[])
    def test_mainnet_failure_and_recovery(self):
        self.remote['mainnetHealthy']=False
        self.assertIn('mainnet_unhealthy',self.check())
        self.remote['mainnetHealthy']=True
        self.assertEqual(self.check(),[])
    def test_fresh_pull_does_not_hide_stale_archive(self):self.assertIn('archive_stale',self.check(archive=self.now-31*HOUR))
    def test_telemetry_timeout(self):self.assertIn('source_unreachable',self.check(remote={'checkedAt':0}))
    def test_integrity(self):self.assertIn('archive_invalid',self.check(valid=False))
    def test_source_failed(self):self.remote['backupServiceOk']=False;self.assertIn('source_failed',self.check())
    def test_startup_quiet(self):self.assertFalse(transition({},[],self.now))
    def test_incident_and_recovery(self):
        self.assertTrue(transition({},['source_failed'],self.now))
        self.assertTrue(transition({'issues':['source_failed'],'attemptAt':self.now},[],self.now+60))
    def test_uncertain_delivery_not_immediately_retried(self):
        state={'issues':['source_failed'],'attemptAt':self.now}
        self.assertFalse(transition(state,['source_failed'],self.now+900))
        self.assertTrue(transition(state,['source_failed'],self.now+24*HOUR))

class RetentionTests(unittest.TestCase):
    def populate(self,root,count):
        now=datetime(2026,11,10,tzinfo=timezone.utc)
        for i in range(count):
            name='yamc-'+(now-timedelta(days=i)).strftime('%Y%m%dT%H%M%SZ')+'-'+f'{i:032x}'+'.tar.age'
            p=root/name;p.write_bytes(b'encrypted-test')
            (root/(name+'.ready.json')).write_text(json.dumps({'file':name,'size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}))
        return now
    def test_sparse_history_keeps_newest_seven_and_never_deletes(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);now=self.populate(root,7);before=set(root.iterdir())
            report=plan(root,now+timedelta(days=500))
            self.assertEqual(len(report['keep']),7);self.assertFalse(report['candidates'])
            self.assertEqual(set(root.iterdir()),before)
    def test_corruption_blocks_all_candidates(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);now=self.populate(root,90)
            self.assertTrue(plan(root,now)['candidates'])
            next(root.glob('*.tar.age')).write_bytes(b'corrupt')
            report=plan(root,now);self.assertTrue(report['deletionBlocked']);self.assertEqual(report['candidates'],[])

class NotifierTests(unittest.TestCase):
    def test_missing_stale_or_unknown_report_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'health.json'
            self.assertEqual(read_health(p,10000),['collector_unavailable'])
            for data in [{'checkedAt':0,'issues':[]},{'checkedAt':10000,'issues':['unexpected']}]:
                p.write_text(json.dumps(data));self.assertEqual(read_health(p,10000),['collector_unavailable'])
    def test_valid_report(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'health.json';p.write_text(json.dumps({'checkedAt':10000,'issues':['source_failed','source_failed']}))
            self.assertEqual(read_health(p,10001),['source_failed'])

if __name__=='__main__':unittest.main()
