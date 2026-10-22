#!/usr/bin/env python3
"""Local development server. Supply a trusted certificate for mobile GPS over LAN."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import ssl

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host', default='127.0.0.1')
parser.add_argument('--port', type=int, default=8000)
parser.add_argument('--cert', help='PEM certificate trusted by the testing device')
parser.add_argument('--key', help='PEM private key; keep outside the checkout or in .local/')
args = parser.parse_args()
if bool(args.cert) != bool(args.key):
    parser.error('--cert and --key must be supplied together')

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(root)))
if args.cert:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(args.cert, args.key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
print(f'Augmentum development server: {"https" if args.cert else "http"} port {server.server_port}', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
