"""Explicit one-shot Telegram delivery. Never print credentials or response bodies."""
import argparse
import json
import re
import urllib.request
from pathlib import Path

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def credentials(path):
    text = Path(path).read_text(encoding='utf-8-sig')
    token = re.search(r'\b\d{6,}:[A-Za-z0-9_-]{25,}', text)
    chat = re.search(r'(?im)^\s*chat[_ ]?id\s*[:=]\s*["\x27]?(-?\d+)', text)
    if not token or not chat:
        raise ValueError('Invalid Telegram credential file format')
    return token.group(0), chat.group(1)

def deliver(path, message):
    token, chat = credentials(path)
    data = json.dumps({'chat_id': chat, 'text': message, 'disable_web_page_preview': True}).encode()
    request = urllib.request.Request('https://api.telegram.org/bot'+token+'/sendMessage', data=data,
                                     headers={'Content-Type': 'application/json'}, method='POST')
    # No automatic retry: timeout may mean delivery succeeded but acknowledgement was lost.
    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
        result = json.load(response)
    if not result.get('ok'):
        raise RuntimeError('Telegram did not confirm delivery')
    return {'status': 'DELIVERED', 'message_id': result['result']['message_id']}

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('--credentials',required=True);p.add_argument('--send-test',action='store_true')
    a=p.parse_args()
    try:
        credentials(a.credentials)
        result=deliver(a.credentials,'YAMC — тест уведомлений. Бот подключён. Это одно проверочное сообщение; автоматические уведомления пока не включены.') if a.send_test else {'status':'CREDENTIAL_FORMAT_OK','sent':False}
        print(json.dumps(result))
    except Exception:
        print('Telegram check failed; credentials and response details withheld. Delivery may be uncertain; do not retry blindly.')
        raise SystemExit(1)
