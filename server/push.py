"""Optional Expo Push outbox. Disabled unless SHUL_ENABLE_PUSH=1.

Only generic notifications leave the server. Message content and member profiles
are fetched by the authenticated app. Acceptance is not a delivery receipt.
"""
import json
import logging
import os
import threading
import time
import urllib.request


def process_one(store, send=None):
    send = send or send_to_expo
    with store.db() as db:
        # A single worker owns the outbox; see README before running multiple processes.
        job = db.execute("SELECT * FROM outbox WHERE status='pending' AND available_at<=? ORDER BY available_at LIMIT 1", (time.time(),)).fetchone()
        if not job:
            return False
        user = db.execute('SELECT preferences FROM users WHERE id=?', (job['user_id'],)).fetchone()
        tokens = [r['token'] for r in db.execute('SELECT p.token FROM push_tokens p JOIN sessions s ON p.session_hash=s.hash WHERE p.user_id=? AND s.expires>?', (job['user_id'], time.time()))]
        enabled = user and json.loads(user['preferences']).get(job['preference'], False)
        if not enabled or not tokens:
            db.execute(f"UPDATE outbox SET status='skipped' WHERE id=?", (job['id'],))
            return True
    try:
        body = 'תגובה חדשה בקהילה' if job['preference'] == 'replies' else 'הודעה חדשה מהגבאים'
        data = dict(messageId=job['message_id'])
        payload = [dict(to=token, title='הקהילה שלי', body=body, data=data, channelId='community', sound='default') for token in tokens]
        result = send(payload)
        tickets = result.get('data', [])
        if len(tickets) != len(tokens):
            raise ValueError('Unexpected Expo response')
        retry = False
        with store.db() as db:
            for token, ticket in zip(tokens, tickets):
                if ticket.get('status') == 'ok':
                    continue
                if ticket.get('details', {}).get('error') == 'DeviceNotRegistered':
                    db.execute('DELETE FROM push_tokens WHERE token=?', (token,))
                else:
                    retry = True
        if retry:
            raise ValueError('Expo rejected at least one push ticket')
        with store.db() as db:
            db.execute(f"UPDATE outbox SET status='accepted' WHERE id=?", (job['id'],))
    except Exception:
        attempts = job['attempts'] + 1
        with store.db() as db:
            db.execute(f'UPDATE outbox SET attempts=?,available_at=?,status=? WHERE id=?', (attempts, time.time() + min(3600, 30 * 2 ** attempts), 'failed' if attempts >= 5 else 'pending', job['id']))
        logging.warning('Push attempt failed for outbox job %s; attempt %d', job['id'], attempts)
    return True


def send_to_expo(payload):
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    if os.environ.get('EXPO_ACCESS_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['EXPO_ACCESS_TOKEN']
    request = urllib.request.Request('https://exp.host/--/api/v2/push/send', data=json.dumps(payload).encode(), headers=headers, method='POST')
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def start_worker(store, stop):
    if os.environ.get('SHUL_ENABLE_PUSH') != '1':
        return None
    def work():
        while not stop.is_set():
            try:
                handled = process_one(store)
            except Exception:
                logging.exception('Push worker database error')
                handled = False
            stop.wait(0.25 if handled else 3)
    thread = threading.Thread(target=work, name='push-outbox', daemon=True)
    thread.start()
    return thread
