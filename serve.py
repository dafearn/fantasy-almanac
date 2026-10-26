#!/usr/bin/env python3
"""Serve the league app locally: python3 serve.py [port], then open http://localhost:8000"""
import http.server, os, socketserver, sys

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *args):
        pass

with socketserver.TCPServer(('', port), Handler) as httpd:
    print(f'League almanac: http://localhost:{port}  (Ctrl+C to stop)')
    httpd.serve_forever()
