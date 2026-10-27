"""Local/pilot HTTP API. Put behind HTTPS before connecting real devices remotely."""
import argparse
import json
import logging
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

from .push import start_worker
from .healing import start_worker as start_healing_worker
from .store import Store
from .validation import APIError
from .roster import start_roster_worker

DEFAULT_DB = Path(__file__).parent / 'data' / 'community.sqlite3'


def make_handler(store, allowed_origins=None):
    allowed_origins = set(allowed_origins or ())

    class Handler(BaseHTTPRequestHandler):
        server_version = 'CommunityAPI/0.1'
        sys_version = ''

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, format, *args):
            # Do not log request headers, bodies, credentials, or member data.
            logging.info('%s %s', self.command, urlsplit(self.path).path)

        def respond(self, status, data):
            binary = isinstance(data, bytes)
            encoded = data if binary else json.dumps(data, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/pdf' if binary else 'application/json; charset=utf-8')
            if binary:
                self.send_header('Content-Disposition', 'inline; filename=weekly-schedule.pdf')
            self.send_header('Content-Length', str(len(encoded)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            origin = self.headers.get('Origin')
            if origin in allowed_origins:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
            self.end_headers()
            self.wfile.write(encoded)

        def body(self, maximum=65536):
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                raise APIError(400, 'גודל הבקשה אינו תקין.')
            if not 0 < length <= maximum:
                raise APIError(413, 'גודל הבקשה אינו תקין או גדול מדי.')
            if self.headers.get_content_type() != 'application/json':
                raise APIError(415, 'יש לשלוח JSON.')
            try:
                data = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError):
                raise APIError(400, 'הבקשה אינה JSON תקין.')
            if not isinstance(data, dict):
                raise APIError(400, 'הבקשה חייבת להיות אובייקט JSON.')
            return data

        def do_OPTIONS(self):
            origin = self.headers.get('Origin')
            if origin not in allowed_origins:
                return self.respond(403, {'error': 'Origin not allowed'})
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Authorization,Content-Type')
            self.send_header('Vary', 'Origin')
            self.send_header('Content-Length', '0')
            self.end_headers()

        def route(self):
            path = urlsplit(self.path).path
            method = self.command
            if method == 'GET' and path == '/health':
                return 200, {'ok': True}
            if method == 'POST' and path == '/api/register':
                raise APIError(410, 'ההרשמה מתבצעת באמצעות מספר פלאפון וקוד SMS.')
            if method == 'POST' and path == '/api/auth/phone/request':
                return 200, store.request_phone_code(self.body(), self.client_address[0])
            if method == 'POST' and path == '/api/auth/phone/verify':
                return 200, store.verify_phone_code(self.body(), self.client_address[0])
            if method == 'POST' and path == '/api/login':
                data = self.body()
                if set(data) != {'email', 'password'}:
                    raise APIError(400, 'יש להזין אימייל וסיסמה.')
                return 200, store.login(data['email'], data['password'], self.client_address[0])
            auth = self.headers.get('Authorization', '')
            token = auth[7:] if auth.startswith('Bearer ') else ''
            user = store.authenticate(token)
            if method == 'GET':
                if path == '/api/me':
                    return 200, store.state(user)
                if path == '/api/community-settings':
                    return 200, store.community_settings(user)
                if path == '/api/messages':
                    return 200, store.list_messages(user)
                if path == '/api/admin/classifications':
                    return 200, store.classifications(user)
                if path == '/api/admin/association-members':
                    return 200, store.association_list(user)
                if path == '/api/admin/members':
                    return 200, store.members(user)
                if path == '/api/admin/aliyah-recommendations/calendar':
                    return 200, store.recommendation_calendar(user, parse_qs(urlsplit(self.path).query).get('year', [''])[0])
                if path == '/api/admin/aliyah-recommendations':
                    return 200, store.aliyah_recommendations(user, parse_qs(urlsplit(self.path).query).get('date', [''])[0], parse_qs(urlsplit(self.path).query).get('service', ['shacharit'])[0])
                if path == '/api/admin/aliyah-template':
                    return 200, store.aliyah_template(user, parse_qs(urlsplit(self.path).query).get('date', [''])[0], parse_qs(urlsplit(self.path).query).get('service', ['shacharit'])[0])
                if path.startswith('/api/admin/people/'):
                    return 200, store.person_details(user, path.rsplit('/', 1)[-1])
                if path.startswith('/api/documents/'):
                    return 200, store.document(user, path.rsplit('/', 1)[-1])
                if path == '/api/admin/roster':
                    return 200, store.roster(user)
                if path == '/api/admin/aliyah-services':
                    return 200, store.aliyah_services(user)
                if path == '/api/healing-prayers':
                    return 200, store.healing_prayers(user)
                if path == '/api/admin/healing-prayers':
                    return 200, store.healing_prayers(user, all_members=True)
                if path == '/api/seating':
                    return 200, store.seating(user)
                if path == '/api/admin/seating/events':
                    return 200, store.seating_events(user)
                parts = path.strip('/').split('/')
                if len(parts) == 6 and parts[:4] == ['api', 'admin', 'seating', 'events'] and parts[5] == 'summary':
                    return 200, store.seating_summary(user, parts[4])
            elif method == 'DELETE':
                parts = path.strip('/').split('/')
                if len(parts) == 3 and parts[:2] == ['api', 'healing-prayers']:
                    store.delete_healing_prayer(user, parts[2])
                    return 200, {'ok': True}
            elif method in ('POST', 'PUT'):
                if path == '/api/admin/association-members/import' and method == 'POST':
                    store.require_gabbai(user)
                    return 200, store.import_members(user, self.body(7 * 1024 * 1024))
                if path == '/api/admin/weekly-documents' and method == 'POST':
                    store.require_gabbai(user)
                    return 201, store.publish_document(user, self.body(14 * 1024 * 1024))
                data = self.body()
                parts = path.strip('/').split('/')
                if path.startswith('/api/admin/people/') and method == 'PUT':
                    return 200, store.save_person_details(user, path.rsplit('/', 1)[-1], data)
                if path == '/api/admin/aliyah-records' and method == 'POST':
                    return 201, store.save_complete_aliyot(user, data)
                if path.startswith('/api/admin/aliyah-records/') and method == 'PUT':
                    return 200, store.save_complete_aliyot(user, data, path.rsplit('/', 1)[-1])
                if method == 'POST' and path == '/api/admin/classifications':
                    return 201, store.add_classification(user, data)
                if method == 'POST' and path == '/api/logout':
                    store.logout(token)
                    return 200, {'ok': True}
                if method == 'PUT' and path == '/api/profile':
                    return 200, store.save_profile(user, data)
                if method == 'PUT' and path == '/api/preferences':
                    return 200, store.save_preferences(user, data)
                if method == 'PUT' and path == '/api/admin/community-settings':
                    return 200, store.save_community_settings(user, data)
                if method == 'POST' and path == '/api/healing-prayers':
                    return 201, store.add_healing_prayer(user, data)
                if method == 'POST' and len(parts) == 4 and parts[:2] == ['api', 'healing-prayers'] and parts[3] == 'keep':
                    return 200, store.keep_healing_prayer(user, parts[2], data)
                if method == 'PUT' and path == '/api/seating':
                    return 200, store.save_seating_report(user, data)
                if method == 'POST' and path == '/api/admin/seating/events':
                    return 201, store.save_seating_event(user, data)
                if method == 'PUT' and path == '/api/push-token':
                    store.set_push_token(user, token, data)
                    return 200, {'ok': True}
                if method == 'POST' and path == '/api/admin/messages':
                    return 201, store.publish(user, data)
                if method == 'POST' and path == '/api/admin/roster':
                    return 201, store.save_roster_person(user, data)
                if method == 'POST' and path == '/api/admin/aliyah-services':
                    return 201, store.save_aliyah_service(user, data)
                parts = path.strip('/').split('/')
                if method == 'PUT' and len(parts) == 5 and parts[:4] == ['api', 'admin', 'seating', 'events']:
                    return 200, store.save_seating_event(user, data, parts[4])
                if method == 'PUT' and len(parts) == 4 and parts[:2] == ['api', 'admin']:
                    if parts[2] == 'roster':
                        return 200, store.save_roster_person(user, data, parts[3])
                    if parts[2] == 'aliyah-services':
                        return 200, store.save_aliyah_service(user, data, parts[3])
                if method == 'POST' and len(parts) == 4 and parts[:2] == ['api', 'messages']:
                    if parts[3] == 'replies':
                        return 201, store.reply(user, parts[2], data)
                    if parts[3] == 'read':
                        store.mark_read(user, parts[2])
                        return 200, {'ok': True}
            raise APIError(404, 'הנתיב אינו קיים.')

        def dispatch(self):
            try:
                origin = self.headers.get('Origin')
                if origin and origin not in allowed_origins:
                    raise APIError(403, 'Origin not allowed')
                status, data = self.route()
                self.respond(status, data)
            except APIError as error:
                self.respond(error.status, {'error': error.message})
            except (BrokenPipeError, ConnectionResetError, socket.timeout):
                pass
            except Exception:
                logging.exception('API internal error')
                self.respond(500, {'error': 'אירעה שגיאת שרת. נסו שוב.'})

        do_GET = dispatch
        do_POST = dispatch
        do_PUT = dispatch
        do_DELETE = dispatch

    return Handler


def main():
    parser = argparse.ArgumentParser(description='Community member development API')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--db', default=os.environ.get('SHUL_DB', str(DEFAULT_DB)))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    origins = os.environ.get('SHUL_CORS_ORIGINS', 'http://localhost:8081,http://localhost:19006').split(',')
    store = Store(args.db)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(store, origins))
    stop = threading.Event()
    worker = start_worker(store, stop)
    roster_worker = start_roster_worker(store, stop)
    healing_worker = start_healing_worker(store, stop)
    print(f'Community API: http://{args.host}:{args.port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()
        if worker:
            worker.join(timeout=16)
        roster_worker.join(timeout=2)
        healing_worker.join(timeout=16)


if __name__ == '__main__':
    main()
